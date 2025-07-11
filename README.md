[English](README.md) | [简体中文](README.zh-CN.md)

# ProxyBurst Client (v2.0) - A Smarter Way to Distribute Requests

Welcome to the official client for the ProxyBurst system! This package is your sole entry point to the powerful ProxyBurst distributed computing network.

> **Interested in the "Construction Crew"?** Check out the [**`proxyburst-executor`**](https://github.com/cityO/proxyburst-executor) repository to see how the other half works!

## 1. What Is This & Why Should I Use It?

Imagine you need to make 10,000 individual API calls to a server. Running this sequentially in a normal script could take minutes, or even hours.

**ProxyBurst is built to solve this exact problem.** It allows you to package all 10,000 requests into a single "task" and submit it. Behind the scenes, a whole cluster of "Executor" workers will receive your requests and run them all at the same time (in parallel), dramatically cutting the total time from hours to mere seconds.

This client is the "remote control" you use to command that executor cluster. It's designed to be both powerful and simple, hiding all the complex distributed logic behind a clean, modern JavaScript API.

---

## 2. Core Concepts for Beginners

### The "Project Manager & Construction Crew" Analogy
- **You (The Project Manager)**: You have a big project, like building a skyscraper.
- **`ProxyBurstClient` (Your Assistant)**: This client is your trusted assistant. You hand your project plan to this assistant.
- **The Project Plan (A "Task")**: This is the array of all the individual requests you want to make.
- **The Construction Crew (`ProxyBurstExecutor` Cluster)**: This is a team of 5, 50, or even 500 workers, always on standby.
- **Where the Magic Happens**: Your assistant (`client`) takes your project plan, breaks it down into thousands of individual work orders, and posts them on a "job board" (a Redis queue). The workers (`executors`) swarm the job board, grab a work order, complete it, and report the result. The assistant waits until every single work order is done, collects all the reports, and hands them back to you in one neat package.

### Two Ways to Get Your Report: Promise vs. Stream
The client offers two different ways to receive your final report, depending on the scale of your project.

1.  **Promise Mode (`.request()`)**: **Use this most of the time.**
    -   *Analogy*: Your assistant waits for all workers to finish, collects all their reports into one giant folder, and hands you the entire folder at once.
    -   *Use Case*: Simple, convenient, and perfect for when you expect a reasonable number of results. You get everything at once with a single `await`.

2.  **Stream Mode (`.requestStream()`)**: **Use this for extremely large projects.**
    -   *Analogy*: Your project is so massive that one folder can't hold all the reports. So, your assistant adopts a new strategy: as soon as any worker completes a work order, they immediately run over and hand you that single report. You receive a continuous "stream" of individual reports.
    -   *Use Case*: Prevents your application from crashing due to high memory usage when you expect tens of thousands or even millions of results, and each result might be large.

---

## 3. Quick Start: Your First Distributed Request

### Step 1: Installation
```bash
npm install proxyburst-client
```

### Step 2: Initialize the Client
In your project, create a client instance. This instance should be long-lived, much like a database connection.
```javascript
const { ProxyBurstClient } = require('proxyburst-client');

// These options must point to the same Redis server your executor cluster is connected to.
const redisOptions = {
  host: '127.0.0.1',
  port: 6379,
};

const client = new ProxyBurstClient(redisOptions);
```

### Step 3: Create and Send a Request (Promise Mode)
This is the most common way to use the client.

```javascript
async function getMyUsers() {
  try {
    console.log('Building requests...');
    // a) Use the built-in .createRequest() helper to build each individual request.
    const request1 = client.createRequest({ url: 'https://jsonplaceholder.typicode.com/users/1' });
    const request2 = client.createRequest({ url: 'https://jsonplaceholder.typicode.com/users/2' });
    const request3 = client.createRequest({ url: 'https://jsonplaceholder.typicode.com/users/invalid' }); // This one will fail

    // b) Organize them into a task array.
    const myTask = [request1, request2, request3];

    console.log('Sending task to the distributed network...');
    // c) Send the entire task and await the final, aggregated result.
    const results = await client.request(myTask);

    console.log('Task complete! All results have been returned.');

    // d) Process your results.
    const successfulUsers = results.filter(r => r.success);
    const failedRequests = results.filter(r => !r.success);

    console.log(`Successfully fetched ${successfulUsers.length} users.`);
    console.log(`Failed to fetch ${failedRequests.length} users.`);

    if (failedRequests.length > 0) {
      console.log('Details of the first failed request:', failedRequests[0].error.message);
    }

  } catch (error) {
    // This will catch catastrophic errors, like a failure to connect to the queue.
    console.error('The entire task failed!', error);
  } finally {
    // e) Before your app shuts down, close the connection.
    await client.close();
  }
}

getMyUsers();
```

---

## 4. In-Depth API Guide

### `client.createRequest(userConfig)`
A helper function to build standardized, trackable request objects.
- `userConfig` (object): A user-friendly object describing your request.
  - `url` (string): **Required**. The target endpoint URL.
  - `method` (string): Optional, defaults to `GET`.
  - `params` (object): Optional. For `GET` requests, these are the query string parameters. For `POST`/`PUT`, this is the request body.
  - `headers` (object): Optional. Any HTTP headers.
- **Returns**: A standard configuration object that can be directly executed by `axios`. You don't need to worry about the internal structure of this object; just pass it to `.request()` or `.requestStream()`.

### `client.request(requestsArray, [taskConfig])` - Promise Mode
Sends a task and returns a `Promise` that resolves to an array containing all results when the task is complete.
- `requestsArray` (Array): **Required**. An array of objects created by `client.createRequest()`.
- `taskConfig` (object): Optional. Configuration for the entire task.
  - `taskName` (string): A human-readable name for the task, used for logging (e.g., `'fetch-all-user-profiles'`).
  - You can also pass any standard BullMQ job options here, like `priority`, `attempts`, `backoff`.
- **Returns**: A `Promise` that resolves to an `Array`. The order of the result array is guaranteed to match the order of your input `requestsArray`.

**Result Object Structure:**
Every object in the returned array will have this structure:
```javascript
// On success
{
  success: true,
  input: { ... }, // The original request object you created
  status: 200,
  data: { ... }    // The actual data returned from the API
}

// On failure
{
  success: false,
  input: { ... }, // The original request object you created
  error: {
    message: "Request failed with status code 404",
    status: 404,
    // ... and other error details
  }
}
```

### `client.requestStream(requestsArray, [taskConfig])` - Stream Mode
Sends a task and returns an `AsyncGenerator` that `yield`s results one by one as they are completed.
- Arguments are identical to `.request()`.
- **Returns**: An `AsyncGenerator`. You can consume it using a `for await...of` loop.

```javascript
async function streamProcessAvatars() {
  const requests = Array.from({ length: 5000 }, (_, i) =>
    client.createRequest({ url: `https://my-api.com/avatars/${i}` })
  );

  const resultsStream = client.requestStream(requests);
  let processedCount = 0;

  console.log('Starting to process avatar stream...');
  for await (const result of resultsStream) {
    // This loop body will execute 5000 times, once for each result as it comes in.
    // Memory usage remains extremely low because we aren't storing all results at once.
    if (result.success) {
      // processAvatar(result.data);
      processedCount++;
    }
  }
  console.log(`Stream processing finished. Processed ${processedCount} avatars.`);
}
```

### `client.close()`
An `async` method that gracefully closes all connections to Redis. Always call this before your application exits to ensure a clean shutdown. 