[English](README.md) | [简体中文](README.zh-CN.md)

# ProxyBurst 客户端 (v2.0) - 更智能的分布式请求方式

欢迎使用 ProxyBurst 系统的官方客户端！这个软件包是你接入强大的 ProxyBurst 分布式计算网络的唯一入口。

## 1. 这是什么？为什么我应该使用它？

想象一下, 你需要向一个服务器单独发起 10,000 次 API 调用。如果在一个普通的脚本里按顺序执行, 这可能会花费几分钟甚至几小时。

**ProxyBurst 正是为解决此问题而生。** 它允许你将所有这 10,000 个请求打包成一个 "任务" 并提交。在幕后, 一整个 "执行器" (Executor) 工作集群将会接收你的请求, 并同时 (并行) 运行它们, 将总耗时从几小时戏剧性地缩短到短短几秒。

本客户端就是你用来操控这个执行器集群的 "遥控器"。它的设计目标是既强大又简单, 将所有复杂的分布式逻辑都隐藏在一个干净、现代的 JavaScript API 背后。

---

## 2. 为初学者准备的核心概念

### “项目经理与施工队”的比喻
- **你 (项目经理)**: 你有一个大工程, 比如建一栋摩天大楼。
- **`ProxyBurstClient` (你的助理)**: 本客户端就是你值得信赖的助理。你将你的工程计划交给这位助理。
- **工程计划 (一个 "任务")**: 这是你想要发起的所有独立请求所组成的数组。
- **施工队 (`ProxyBurstExecutor` 集群)**: 这是一支由 5 个、50 个、甚至 500 个工人组成的、随时待命的团队。
- **魔法发生的过程**: 你的助理 (`client`) 接收你的工程计划, 将其拆解成数千个独立的工单, 并把它们贴在一个 "任务板" 上 (这是一个 Redis 队列)。工人们 (`executors`) 会一拥而上, 从任务板上领取工单, 完成它, 然后报告结果。助理会一直等到每一张工单都被完成后, 收集所有的报告, 并将它们整理成一份漂亮的报告交还给你。

### 获取报告的两种方式: Promise vs. Stream
客户端提供了两种不同的方式来接收你的最终报告, 具体取决于你工程的规模。

1.  **Promise 模式 (`.request()`)**: **大多数情况下使用此模式。**
    -   *比喻*: 你的助理等到所有工人都完工后, 将他们所有的报告收集到一个巨大的文件夹里, 然后一次性地将整个文件夹交给你。
    -   *使用场景*: 简单、便捷, 非常适合当你预期的结果数量在合理范围内时。通过一个 `await` 就能一次性获得所有东西。

2.  **Stream 模式 (`.requestStream()`)**: **当工程极其巨大时使用此模式。**
    -   *比喻*: 你的工程太庞大了, 一个文件夹根本装不下。于是, 你的助理采取了新的策略：任何一个工人只要完成一张工单, 他就立刻跑过来将这张报告单独交给你。这样, 你会持续地收到一个由单张报告组成的 "流"。
    -   *使用场景*: 当你预期有成千上万甚至数百万的返回结果, 且每个结果都可能很大时, 此模式可以防止你的程序因内存占用过高而崩溃。

---

## 3. 快速上手: 你的第一个分布式请求

### 第 1 步: 安装
```bash
npm install proxyburst-client
```

### 第 2 步: 初始化客户端
在你的项目中, 创建一个客户端实例。这个实例应该是长生命周期的, 就像一个数据库连接一样。
```javascript
const { ProxyBurstClient } = require('proxyburst-client');

// 这些选项必须指向你的执行器集群所连接的同一个 Redis 服务器。
const redisOptions = {
  host: '127.0.0.1',
  port: 6379,
};

const client = new ProxyBurstClient(redisOptions);
```

### 第 3 步: 创建并发送请求 (Promise 模式)
这是使用本客户端最常见的方式。

```javascript
async function getMyUsers() {
  try {
    console.log('正在构建请求...');
    // a) 使用内置的 .createRequest() 辅助函数来创建每一个独立的请求。
    const request1 = client.createRequest({ url: 'https://jsonplaceholder.typicode.com/users/1' });
    const request2 = client.createRequest({ url: 'https://jsonplaceholder.typicode.com/users/2' });
    const request3 = client.createRequest({ url: 'https://jsonplaceholder.typicode.com/users/invalid' }); // 这是一个会失败的请求

    // b) 将它们组织成一个任务数组。
    const myTask = [request1, request2, request3];

    console.log('正在将任务发送到分布式网络...');
    // c) 发送整个任务, 并等待最终聚合后的结果。
    const results = await client.request(myTask);

    console.log('任务完成！所有结果均已返回。');

    // d) 处理你的结果。
    const successfulUsers = results.filter(r => r.success);
    const failedRequests = results.filter(r => !r.success);

    console.log(`成功获取 ${successfulUsers.length} 个用户。`);
    console.log(`获取失败 ${failedRequests.length} 个用户。`);

    if (failedRequests.length > 0) {
      console.log('第一个失败请求的详情:', failedRequests[0].error.message);
    }

  } catch (error) {
    // 这里会捕获灾难性的错误, 例如无法连接到队列。
    console.error('整个任务失败!', error);
  } finally {
    // e) 在你的应用关闭前, 关闭连接。
    await client.close();
  }
}

getMyUsers();
```

---

## 4. API 深度指南

### `client.createRequest(userConfig)`
这是一个用来构建标准化的、可追踪的请求对象的辅助函数。
- `userConfig` (object): 一个用户友好的、描述你请求的对象。
  - `url` (string): **必需**。目标端点 URL。
  - `method` (string): 可选, 默认为 `GET`。
  - `params` (object): 可选。对于 `GET` 请求, 这是查询字符串参数。对于 `POST`/`PUT` 请求, 这是请求体。
  - `headers` (object): 可选。任何 HTTP 头。
- **返回**: 一个标准的、可被 `axios` 直接执行的配置对象。你无需关心此对象的内部结构, 只需将其传递给 `.request()` 或 `.requestStream()` 即可。

### `client.request(requestsArray, [taskConfig])` - Promise 模式
发送一个任务, 并在任务完成时, 返回一个包含所有结果的 `Promise` 数组。
- `requestsArray` (Array): **必需**。一个由 `client.createRequest()` 创建的对象组成的数组。
- `taskConfig` (object): 可选。用于整个任务的配置。
  - `taskName` (string): 一个人类可读的任务名称, 用于日志记录 (例如, `'fetch-all-user-profiles'`)。
  - 你也可以在这里传递任何标准的 BullMQ 任务选项, 例如 `priority`, `attempts`, `backoff`。
- **返回**: 一个 `Promise`, 它会解析为一个 `Array` 数组。该结果数组的顺序保证与你输入的 `requestsArray` 的顺序一致。

**结果对象的结构:**
返回数组中的每一个对象都将拥有此结构:
```javascript
// 成功时
{
  success: true,
  input: { ... }, // 你最初创建的那个请求对象
  status: 200,
  data: { ... }    // 从 API 返回的真实数据
}

// 失败时
{
  success: false,
  input: { ... }, // 你最初创建的那个请求对象
  error: {
    message: "Request failed with status code 404",
    status: 404,
    // ... 以及其他错误详情
  }
}
```

### `client.requestStream(requestsArray, [taskConfig])` - Stream 模式
发送一个任务, 并返回一个异步迭代器 (`AsyncGenerator`), 它会在结果完成时逐个地 `yield` 它们。
- 参数与 `.request()` 完全相同。
- **返回**: 一个 `AsyncGenerator`。你可以通过 `for await...of` 循环来消费它。

```javascript
async function streamProcessAvatars() {
  const requests = Array.from({ length: 5000 }, (_, i) =>
    client.createRequest({ url: `https://my-api.com/avatars/${i}` })
  );

  const resultsStream = client.requestStream(requests);
  let processedCount = 0;

  console.log('开始处理头像数据流...');
  for await (const result of resultsStream) {
    // 这个循环体会执行 5000 次, 每当一个结果返回时就执行一次。
    // 内存使用率保持在极低的水平, 因为我们没有一次性将所有结果都存储起来。
    if (result.success) {
      // processAvatar(result.data);
      processedCount++;
    }
  }
  console.log(`数据流处理完毕。共处理了 ${processedCount} 个头像。`);
}
```

### `client.close()`
一个 `async` 方法, 它会优雅地关闭所有到 Redis 的连接。请总是在你的应用退出前调用它, 以确保干净地关闭。
