import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { createMemoryHttpServer } = jiti("../src/server/http-server.ts");
const { loadMemoryServerConfig } = jiti("../src/server/config.ts");

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
    server = createMemoryHttpServer(runtime, {
      host: "127.0.0.1",
      port: 0,
      token: "test-secret",
      allowedHosts: ["127.0.0.1", "localhost"],
      allowedOrigins: ["127.0.0.1", "localhost"],
      maxBodyBytes: 1024 * 1024,
    }, {
      info() {},
      warn() {},
      error() {},
      debug() {},
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
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

  it("defaults REST capture to the shared global scope", async () => {
    const response = await fetch(`${baseUrl}/v1/capture`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ conversationText: "Remember that I prefer dark mode" }),
    });
    assert.equal(response.status, 200);
    assert.equal(calls.capture.at(-1).agentId, "main");
    assert.equal(calls.capture.at(-1).scope, "global");
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

  it("enforces secure configuration when binding beyond loopback", () => {
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
  });
});
