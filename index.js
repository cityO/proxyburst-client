const { Queue, QueueEvents, FlowProducer, Job } = require('bullmq');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('redis');

/**
 * ProxyBurst v2 客户端, 支持 Promise 和 Stream 模式。
 */
class ProxyBurstClient {
  /**
   * @param {object} redisOptions - BullMQ 和 Redis Pub/Sub 的连接选项。
   * @param {string} [queueName='proxyburst-v2-jobs'] - 要连接的队列名称。
   */
  constructor(redisOptions, queueName = 'proxyburst-v2-jobs') {
    if (!redisOptions || !redisOptions.host || !redisOptions.port) {
      throw new Error('Redis connection options (host, port) are required.');
    }
    this.redisConnectionOptions = redisOptions;
    this.queueName = queueName;

    // BullMQ 连接
    this.requestQueue = new Queue(this.queueName, { connection: this.redisConnectionOptions });
    this.queueEvents = new QueueEvents(this.queueName, { connection: this.redisConnectionOptions });
    this.flowProducer = new FlowProducer({ connection: this.redisConnectionOptions });

    // 标准 Redis 客户端, 用于 Pub/Sub
    this.redisClient = createClient({
      socket: {
        host: redisOptions.host,
        port: redisOptions.port,
      },
      password: redisOptions.password,
      database: redisOptions.db || 0,
    });
    this.redisClient.connect().catch(err => console.error('Redis client connection error:', err));
  }

  /**
   * (核心辅助函数) 创建一个标准化的、可被追踪的子请求对象。
   * @param {object} userConfig - 用户提供的请求配置。
   * @param {string} userConfig.url - 目标 URL。
   * @param {string} [userConfig.method='GET'] - HTTP 方法。
   * @param {object} [userConfig.params] - GET 请求的查询参数或 POST/PUT 的请求体。
   * @param {object} [userConfig.headers] - HTTP 头。
   * @returns {object} - 一个标准的 axios 配置对象, 附加了 meta 信息。
   */
  createRequest(userConfig) {
    const { url, method = 'GET', params, headers, ...rest } = userConfig;
    const subRequestId = uuidv4();

    const axiosConfig = { url, method, headers: headers || {}, ...rest };

    if (method.toUpperCase() === 'GET') {
      axiosConfig.params = params;
    } else {
      axiosConfig.data = params;
    }

    axiosConfig.meta = { subRequestId };
    return axiosConfig;
  }

  /**
   * (Promise 模式) 发送一个批量请求任务, 并等待所有结果聚合后返回。
   * @param {Array<object>} requestsArray - 由 createRequest() 生成的请求对象数组。
   * @param {object} [taskConfig={}] - 任务级别的配置。
   * @param {string} [taskConfig.taskName='proxyburst-parent-job'] - 任务的业务名称。
   * @returns {Promise<Array<object>>} - 一个包含所有子请求结果的数组。
   */
  async request(requestsArray, taskConfig = {}) {
    const { taskName = 'proxyburst-parent-job', ...bullmqOpts } = taskConfig;
    const taskId = bullmqOpts.jobId || uuidv4();

    const children = requestsArray.map(axiosConfig => ({
      name: 'execute-sub-request',
      data: { axiosConfig, reportBy: 'return' }, // 子任务完成后返回值
      queueName: this.queueName,
      opts: {
        jobId: axiosConfig.meta.subRequestId, // 使用唯一的子请求ID作为jobId
      }
    }));

    const flow = await this.flowProducer.add({
      name: taskName,
      queueName: this.queueName,
      data: { taskName, taskId, requestCount: children.length },
      opts: { ...bullmqOpts, jobId: taskId },
      children,
    });

    // 正确的等待方式: 在 flow.job 上调用 waitUntilFinished
    await flow.job.waitUntilFinished(this.queueEvents);
    const childrenValues = await flow.job.getChildrenValues();

    const resultsObj = Object.values(childrenValues).filter(Boolean);

    const resultsMap = new Map();
    resultsObj.forEach(result => {
      if (result && result.input && result.input.meta) {
        resultsMap.set(result.input.meta.subRequestId, result);
      }
    });

    return requestsArray.map(
      request => resultsMap.get(request.meta.subRequestId) || {
        success: false,
        input: request,
        error: { message: 'Job result not found. The job may have failed catastrophically.' }
      }
    );
  }

  /**
   * (Stream 模式) 发送一个批量请求任务, 并返回一个可以逐个消费结果的异步迭代器。
   * @param {Array<object>} requestsArray - 由 createRequest() 生成的请求对象数组。
   * @param {object} [taskConfig={}] - 任务级别的配置。
   * @returns {AsyncGenerator<object, void, void>} - 用于消费结果的异步迭代器。
   */
  async* requestStream(requestsArray, taskConfig = {}) {
    const { taskName = 'proxyburst-parent-stream-job', ...bullmqOpts } = taskConfig;
    const taskId = bullmqOpts.jobId || uuidv4();
    const channelName = `proxyburst-stream:${taskId}`;

    const subscriber = this.redisClient.duplicate();
    await subscriber.connect();

    const children = requestsArray.map(axiosConfig => ({
      name: 'execute-sub-request',
      data: { axiosConfig, reportBy: 'pubsub', channelName }, // 报告模式改为 pubsub
      queueName: this.queueName,
      opts: {
        jobId: axiosConfig.meta.subRequestId,
      }
    }));

    // 父任务也需要知道 channelName, 以便在最后发送结束信号
    const flow = await this.flowProducer.add({
      name: taskName,
      queueName: this.queueName,
      data: { taskName, taskId, requestCount: children.length, channelName },
      opts: { ...bullmqOpts, jobId: taskId },
      children,
    });

    let resultQueue = [];
    let finished = false;
    let resolvePromise = () => { };

    await subscriber.subscribe(channelName, (message) => {
      if (message === 'STREAM_END') {
        finished = true;
      } else {
        try {
          resultQueue.push(JSON.parse(message));
        } catch (e) {
          // 忽略无法解析的消息
        }
      }
      resolvePromise(); // 通知迭代器有新数据或已结束
    });

    try {
      while (!finished || resultQueue.length > 0) {
        if (resultQueue.length > 0) {
          yield resultQueue.shift();
        } else {
          await new Promise(resolve => {
            resolvePromise = resolve;
          });
        }
      }
    } finally {
      // 清理
      await subscriber.unsubscribe(channelName);
      await subscriber.quit();
    }
  }

  /**
   * 优雅地关闭所有连接。
   */
  async close() {
    await this.requestQueue.close();
    await this.queueEvents.close();
    await this.flowProducer.close();
    // 关闭 Pub/Sub 客户端
    if (this.redisClient.isOpen) {
      await this.redisClient.quit();
    }
  }
}

module.exports = { ProxyBurstClient };
