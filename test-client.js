const { ProxyBurstClient } = require('./index');

// --- 测试用例 1: Promise 模式 ---
async function runPromiseTest(client) {
  console.log('\n[测试 1/3] 准备测试 Promise 模式...');

  const req1 = client.createRequest({
    url: 'https://jsonplaceholder.typicode.com/posts/1',
    method: 'GET',
  });
  const req2 = client.createRequest({
    url: 'https://jsonplaceholder.typicode.com/posts',
    method: 'POST',
    params: { title: 'foo', body: 'bar', userId: 1 },
    headers: { 'Content-type': 'application/json; charset=UTF-8' },
  });
  const req3 = client.createRequest({
    url: 'https://jsonplaceholder.typicode.com/posts/invalid-post',
    method: 'GET',
  });

  const requests = [req1, req2, req3];

  try {
    const results = await client.request(requests, { taskName: 'promise-mode-test' });
    console.log(`[测试 1/3] Promise 模式任务完成，收到 ${results.length} 个结果。`);

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    if (successful.length === 2 && failed.length === 1) {
      console.log('[测试 1/3] ✅ 通过: 成功和失败的计数符合预期 (成功: 2, 失败: 1)。');
      return true;
    } else {
      console.error(`[测试 1/3] ❌ 失败: 成功或失败的计数不符合预期 (成功: ${successful.length}, 失败: ${failed.length})。`);
      return false;
    }
  } catch (error) {
    console.error(`[测试 1/3] ❌ 失败: Promise 模式测试中捕获到意外错误: ${error.message}`);
    return false;
  }
}

// --- 测试用例 2: Stream 模式 ---
async function runStreamTest(client) {
  console.log('\n[测试 2/3] 准备测试 Stream 模式...');

  const requests = Array.from({ length: 10 }, (_, i) =>
    client.createRequest({
      url: `https://jsonplaceholder.typicode.com/todos/${i + 1}`,
      method: 'GET'
    })
  );

  try {
    const resultsStream = client.requestStream(requests, { taskName: 'stream-mode-test' });
    const receivedResults = [];

    for await (const result of resultsStream) {
      receivedResults.push(result);
      console.log(`[测试 2/3] Stream: 收到第 ${receivedResults.length} 个结果...`);
    }

    if (receivedResults.length === requests.length) {
      console.log(`[测试 2/3] ✅ 通过: Stream 模式成功接收了所有 ${receivedResults.length} 个结果。`);
      return true;
    } else {
      console.error(`[测试 2/3] ❌ 失败: Stream 模式接收的结果数量不匹配 (预期: ${requests.length}, 收到: ${receivedResults.length})。`);
      return false;
    }
  } catch (error) {
    console.error(`[测试 2/3] ❌ 失败: Stream 模式测试中捕获到意外错误: ${error.message}`);
    return false;
  }
}

// --- 测试用例 3: 并发混合模式测试 ---
async function runConcurrentMixedTest(client) {
  console.log('\n[测试 3/3] 准备并发执行 Promise 和 Stream 模式任务...');

  const promiseTask = runPromiseTest(client);
  const streamTask = runStreamTest(client);

  const [promiseResult, streamResult] = await Promise.all([
    promiseTask,
    streamTask
  ]);

  if (promiseResult && streamResult) {
    console.log('[测试 3/3] ✅ 通过: Promise 和 Stream 模式并发测试均成功。');
    return true;
  } else {
    console.error('[测试 3/3] ❌ 失败: 并发测试中存在失败的子任务。');
    return false;
  }
}


/**
 * 主集成测试函数
 */
async function runIntegrationTest() {
  console.log('--- 启动 ProxyBurst v2 客户端集成测试 ---');

  const redisOptions = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  };

  const client = new ProxyBurstClient(redisOptions);

  const testResults = [];

  try {
    testResults.push(await runPromiseTest(client));
    testResults.push(await runStreamTest(client));
    // 注意：并发测试实际上已经包含了前两个测试，为清晰起见可独立运行或合并
    // 为了确保顺序和清晰度，我们在此独立运行它们，然后可以再运行一次并发测试
    testResults.push(await runConcurrentMixedTest(client));

  } catch (e) {
    console.error(`测试过程中出现意外的顶层错误: ${e.message}`);
    testResults.push(false);
  } finally {
    await client.close();
    console.log('\n客户端连接已关闭。');
    console.log('--- ProxyBurst v2 客户端集成测试结束 ---');

    if (testResults.includes(false)) {
      console.log('\n结论: 存在失败的测试项。');
      process.exit(1);
    } else {
      console.log('\n结论: 所有测试项均通过。');
    }
  }
}

runIntegrationTest(); 