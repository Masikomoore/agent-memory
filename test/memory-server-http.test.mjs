import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { createMemoryHttpServer } = jiti("../src/server/http-server.ts");
const { loadMemoryServerConfig } = jiti("../src/server/config.ts");
const { CaptureJobQueue } = jiti("../src/server/capture-queue.ts");
const { MemoryServiceError } = jiti("../src/core/memory-service.ts");

function makeEntry(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    text: "User prefers dark mode",
    vector: [0.1, 0.2],
    category: "preference",
    scope: "global",
    importance: 0.8,
    timestamp: 1_789_000_000_000,
    metadata: JSON.stringify({ memory_category: "preferences", state: "confirmed" }),
    ...overrides,
  };
}

const SILENT_LOGGER = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

async function startTestServer(runtime, logger = SILENT_LOGGER) {
  const server = createMemoryHttpServer(runtime, {
    host: "127.0.0.1",
    port: 0,
    token: "test-secret",
    allowedHosts: ["127.0.0.1", "localhost"],
    allowedOrigins: ["127.0.0.1", "localhost"],
    maxBodyBytes: 1024 * 1024,
  }, logger);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

describe("standalone memory-server HTTP + MCP transport", () => {
  let server;
  let baseUrl;
  const calls = { recall: [], capture: [] };

  before(async () => {
    const runtime = {
      defaultAgentId: "main",
      defaultWriteScope: "global",
      async health() {
        return { status: "ok", memories: 7, captureEnabled: true, vectorDim: 1536 };
      },
      service: {
        async recall(request) {
          calls.recall.push(request);
          return [{ entry: makeEntry(), score: 0.93 }];
        },
        async capture(request) {
          calls.capture.push(request);
          return { created: 1, merged: 0, skipped: 0, boundarySkipped: 0 };
        },
      },
    };
    const started = await startTestServer(runtime);
    server = started.server;
    baseUrl = started.baseUrl;
  });

  after(async () => {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
  });

  it("serves an unauthenticated minimal health endpoint", async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      memories: 7,
      captureEnabled: true,
      vectorDim: 1536,
    });
  });

  it("requires the Bearer token for REST memory operations", async () => {
    const denied = await fetch(`${baseUrl}/v1/recall`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "dark mode" }),
    });
    assert.equal(denied.status, 401);

    const response = await fetch(`${baseUrl}/v1/recall`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: "dark mode", agentId: "codex" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.count, 1);
    assert.equal(body.memories[0].text, "User prefers dark mode");
    assert.equal("vector" in body.memories[0], false, "REST must never serialize embedding vectors");
    assert.equal(calls.recall.at(-1).agentId, "codex");
  });

  it("preserves the caller recall source for central lifecycle semantics", async () => {
    const response = await fetch(`${baseUrl}/v1/recall`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: "dark mode", source: "auto-recall" }),
    });
    assert.equal(response.status, 200);
    assert.equal(calls.recall.at(-1).source, "auto-recall");
  });

  it("queues REST capture asynchronously by default (202 + Location + status polling) and supports sync wait=true", async () => {
    const asyncRes = await fetch(`${baseUrl}/v1/capture`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ conversationText: "Remember that I prefer dark mode" }),
    });
    assert.equal(asyncRes.status, 202);
    const accepted = await asyncRes.json();
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.mode, "async");
    assert.equal(accepted.agentId, "main");
    assert.equal(accepted.scope, "global");
    assert.match(accepted.jobId, /^[0-9a-f-]+$/);
    assert.equal(asyncRes.headers.get("location"), `/v1/capture/${accepted.jobId}`);

    let jobStatus;
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const poll = await fetch(`${baseUrl}/v1/capture/${accepted.jobId}`, {
        headers: { authorization: "Bearer test-secret" },
      });
      assert.equal(poll.status, 200);
      jobStatus = await poll.json();
      if (jobStatus.status === "succeeded" || jobStatus.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(jobStatus.status, "succeeded");
    assert.deepEqual(jobStatus.result, { created: 1, merged: 0, skipped: 0, boundarySkipped: 0 });
    assert.equal(calls.capture.at(-1).agentId, "main");
    assert.equal(calls.capture.at(-1).scope, "global");

    const syncRes = await fetch(`${baseUrl}/v1/capture?wait=true`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ conversationText: "Remember that I prefer monospace fonts" }),
    });
    assert.equal(syncRes.status, 200);
    assert.deepEqual(await syncRes.json(), { created: 1, merged: 0, skipped: 0, boundarySkipped: 0 });

    const missingJob = await fetch(`${baseUrl}/v1/capture/missing-job-id`, {
      headers: { authorization: "Bearer test-secret" },
    });
    assert.equal(missingJob.status, 404);

    const wrongMethod = await fetch(`${baseUrl}/v1/capture/${accepted.jobId}`, {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
    });
    assert.equal(wrongMethod.status, 405);

    const conflictRes = await fetch(`${baseUrl}/v1/capture?wait=true`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ conversationText: "Conflicting flags", mode: "async" }),
    });
    assert.equal(conflictRes.status, 400);
  });

  it("negotiates the 2026 MCP era and calls tools over Streamable HTTP", async () => {
    const client = new Client(
      { name: "memory-server-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      authProvider: { token: async () => "test-secret" },
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.deepEqual(
        tools.tools.map((tool) => tool.name).sort(),
        ["memory_capture", "memory_health", "memory_recall"],
      );

      const result = await client.callTool({
        name: "memory_recall",
        arguments: { query: "dark mode", agentId: "claude-code" },
      });
      assert.equal(result.isError ?? false, false);
      assert.equal(result.structuredContent.count, 1);
      assert.equal(result.structuredContent.memories[0].scope, "global");
      assert.equal(calls.recall.at(-1).agentId, "claude-code");
    } finally {
      await client.close();
    }
  });

  it("enforces secure configuration and parses capture queue env vars", () => {
    assert.throws(
      () => loadMemoryServerConfig({
        MEMORY_SERVER_HOST: "0.0.0.0",
        MEMORY_EMBEDDING_BASE_URL: "http://127.0.0.1:11434/v1",
      }, "/tmp"),
      /MEMORY_SERVER_TOKEN is required/,
    );
    assert.throws(
      () => loadMemoryServerConfig({
        MEMORY_SERVER_HOST: "0.0.0.0",
        MEMORY_SERVER_TOKEN: "secret",
        MEMORY_EMBEDDING_BASE_URL: "http://127.0.0.1:11434/v1",
      }, "/tmp"),
      /MEMORY_SERVER_ALLOWED_HOSTS is required/,
    );

    const cfg = loadMemoryServerConfig({
      MEMORY_EMBEDDING_BASE_URL: "http://127.0.0.1:11434/v1",
      MEMORY_CAPTURE_ASYNC: "false",
      MEMORY_CAPTURE_CONCURRENCY: "2",
      MEMORY_CAPTURE_MAX_QUEUE: "64",
      MEMORY_CAPTURE_DEDUP_WINDOW_MS: "15000",
      MEMORY_CAPTURE_SHUTDOWN_TIMEOUT_MS: "5000",
      MEMORY_CAPTURE_SPOOL: "false",
    }, "/tmp");
    assert.deepEqual(cfg.captureQueue, {
      asyncDefault: false,
      concurrency: 2,
      maxQueueSize: 64,
      dedupWindowMs: 15_000,
      shutdownTimeoutMs: 5_000,
      spoolEnabled: false,
    });
  });
});

describe("CaptureJobQueue + HTTP backpressure, dedup, serialization, spool recovery, and drain", () => {
  it("deduplicates concurrent & recently succeeded payloads and idempotencyKey retries, while releasing keys on failure or llmUnavailable", async () => {
    let captureCount = 0;
    let mode = "succeed";
    let releaseSlow;
    const captureQueue = new CaptureJobQueue(
      {
        validateCapture(req) {
          if (!req.conversationText?.trim()) {
            throw new MemoryServiceError("empty", "invalid_conversation", 400);
          }
          if (req.scope === "forbidden") {
            throw new MemoryServiceError("denied", "scope_access_denied", 403);
          }
          return {
            ...req,
            agentId: req.agentId ?? "main",
            scope: req.scope ?? "global",
            sessionKey: req.sessionKey ?? "unknown",
          };
        },
        async recall() {
          return [];
        },
        async capture(req) {
          captureCount += 1;
          if (mode === "slow") {
            await new Promise((resolve) => { releaseSlow = resolve; });
            return { created: 1, merged: 0, skipped: 0, boundarySkipped: 0 };
          }
          if (mode === "fail") {
            throw new MemoryServiceError("boom", "capture_failed", 500);
          }
          if (mode === "llm_unavailable") {
            return { created: 0, merged: 0, skipped: 0, boundarySkipped: 0, llmUnavailable: true };
          }
          return { created: 1, merged: 0, skipped: 0, boundarySkipped: 0, echoed: req.conversationText };
        },
      },
      { concurrency: 1, maxQueueSize: 2, dedupWindowMs: 60_000, logger: SILENT_LOGGER },
    );

    const started = await startTestServer({
      defaultAgentId: "main",
      defaultWriteScope: "global",
      captureQueue,
      service: {
        async recall() { return []; },
        async capture() { throw new Error("should go through queue"); },
      },
      async health() {
        return { status: "ok", memories: 0, captureEnabled: true, captureQueue: captureQueue.stats() };
      },
    });

    try {
      // 1. Synchronous validation failure rejects before 202.
      const forbidden = await fetch(`${started.baseUrl}/v1/capture`, {
        method: "POST",
        headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
        body: JSON.stringify({ conversationText: "Fact", scope: "forbidden" }),
      });
      assert.equal(forbidden.status, 403);
      assert.equal(captureCount, 0);

      // 2. Concurrent & recent completed dedup (both content-hash and explicit idempotencyKey).
      mode = "slow";
      const firstRes = await fetch(`${started.baseUrl}/v1/capture`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-secret",
          "content-type": "application/json",
          "idempotency-key": "idem-1",
        },
        body: JSON.stringify({ conversationText: "Remember Style 05 coin." }),
      });
      assert.equal(firstRes.status, 202);
      const firstBody = await firstRes.json();

      const dupInFlight = await fetch(`${started.baseUrl}/v1/capture`, {
        method: "POST",
        headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
        body: JSON.stringify({ conversationText: "Remember Style 05 coin." }),
      });
      assert.equal(dupInFlight.status, 202);
      const dupBody = await dupInFlight.json();
      assert.equal(dupBody.jobId, firstBody.jobId);
      assert.equal(dupBody.deduplicated, true);

      // Queue capacity backpressure: fill running (first) + maxQueueSize=2 pending -> 429 on 4th.
      const q1 = await fetch(`${started.baseUrl}/v1/capture`, {
        method: "POST",
        headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
        body: JSON.stringify({ conversationText: "Queued item 1" }),
      });
      const q2 = await fetch(`${started.baseUrl}/v1/capture`, {
        method: "POST",
        headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
        body: JSON.stringify({ conversationText: "Queued item 2" }),
      });
      assert.equal(q1.status, 202);
      assert.equal(q2.status, 202);

      const overflow = await fetch(`${started.baseUrl}/v1/capture`, {
        method: "POST",
        headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
        body: JSON.stringify({ conversationText: "Queued item 3 overflow" }),
      });
      assert.equal(overflow.status, 429);
      assert.equal(overflow.headers.get("retry-after"), "5");
      assert.equal((await overflow.json()).error, "capture_queue_full");

      mode = "succeed";
      releaseSlow();
      const q2Body = await q2.json();
      const drainDeadline = Date.now() + 2_000;
      while (Date.now() < drainDeadline) {
        const snap = captureQueue.getJob(q2Body.jobId);
        if (snap?.status === "succeeded") break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await captureQueue.enqueueAndWait({ request: { conversationText: "Drain marker" } });
      assert.equal(captureCount, 4); // first + q1 + q2 + drain marker (dupInFlight & overflow skipped)

      // Different payload reusing same idempotencyKey still deduplicates to firstBody.jobId.
      const idemReuse = await fetch(`${started.baseUrl}/v1/capture`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-secret",
          "content-type": "application/json",
          "idempotency-key": "idem-1",
        },
        body: JSON.stringify({ conversationText: "Completely new text under same idempotencyKey" }),
      });
      assert.equal(idemReuse.status, 202);
      const idemBody = await idemReuse.json();
      assert.equal(idemBody.jobId, firstBody.jobId);
      assert.equal(idemBody.deduplicated, true);
      assert.equal(captureCount, 4);

      // 3. Failure releases dedup key so retry executes.
      mode = "fail";
      await assert.rejects(() => captureQueue.enqueueAndWait({ request: { conversationText: "Retryable fail" } }));
      assert.equal(captureCount, 5);
      mode = "succeed";
      const recovered = await captureQueue.enqueueAndWait({ request: { conversationText: "Retryable fail" } });
      assert.equal(recovered.created, 1);
      assert.equal(captureCount, 6);

      // 4. llmUnavailable releases dedup key so retry executes.
      mode = "llm_unavailable";
      const softFail = await captureQueue.enqueueAndWait({ request: { conversationText: "LLM blip" } });
      assert.equal(softFail.llmUnavailable, true);
      assert.equal(captureCount, 7);
      mode = "succeed";
      const afterBlip = await captureQueue.enqueueAndWait({ request: { conversationText: "LLM blip" } });
      assert.equal(afterBlip.created, 1);
      assert.equal(captureCount, 8);
    } finally {
      await started.close();
    }
  });

  it("serializes jobs under concurrency=1, recovers spooled jobs (dropping poison pills), and drains cleanly", async () => {
    const spoolDir = await mkdtemp(path.join(tmpdir(), "capture-spool-"));
    try {
      // Write one recoverable spool record (attempts=1 < maxRecoveryAttempts=2)
      // and one poison-pill record (attempts=2 >= maxRecoveryAttempts=2).
      await writeFile(
        path.join(spoolDir, "job-recover.json"),
        JSON.stringify({
          jobId: "job-recover",
          queuedAt: "2026-11-23T00:00:00.000Z",
          attempts: 1,
          request: {
            conversationText: "Recovered conversation",
            agentId: "codex",
            scope: "global",
            sessionKey: "s-rec",
          },
        }),
      );
      await writeFile(
        path.join(spoolDir, "job-poison.json"),
        JSON.stringify({
          jobId: "job-poison",
          queuedAt: "2026-11-22T00:00:00.000Z",
          attempts: 2,
          request: {
            conversationText: "Poison pill conversation",
            agentId: "codex",
            scope: "global",
            sessionKey: "s-poison",
          },
        }),
      );

      let inFlight = 0;
      let maxObservedInFlight = 0;
      const executed = [];
      const queue = new CaptureJobQueue(
        {
          async recall() { return []; },
          async capture(req) {
            inFlight += 1;
            maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 25));
            executed.push(req.conversationText);
            inFlight -= 1;
            return { created: 1, merged: 0, skipped: 0, boundarySkipped: 0 };
          },
        },
        { concurrency: 1, spoolDir, maxRecoveryAttempts: 2, logger: SILENT_LOGGER },
      );

      const recoveredCount = await queue.recoverPendingJobs();
      assert.equal(recoveredCount, 1);

      await queue.enqueue({ request: { conversationText: "Second serialized job" } });
      await queue.enqueue({ request: { conversationText: "Third serialized job" } });

      const drainResult = await queue.drain(2_000);
      assert.deepEqual(drainResult, { drained: true, remaining: 0 });
      assert.equal(maxObservedInFlight, 1);
      assert.deepEqual(executed, [
        "Recovered conversation",
        "Second serialized job",
        "Third serialized job",
      ]);
      assert.deepEqual(await readdir(spoolDir), []);

      await assert.rejects(
        () => queue.enqueue({ request: { conversationText: "After shutdown" } }),
        (err) => err instanceof MemoryServiceError && err.statusCode === 503 && err.code === "server_shutting_down",
      );
    } finally {
      await rm(spoolDir, { recursive: true, force: true });
    }
  });
});
