import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jitiFactory from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const pluginSdkStubPath = path.resolve(testDir, "helpers", "openclaw-plugin-sdk-stub.mjs");
const jiti = jitiFactory(import.meta.url, {
  interopDefault: true,
  alias: { "openclaw/plugin-sdk": pluginSdkStubPath },
});

const pluginModule = jiti("../index.ts");
const memoryPlugin = pluginModule.default || pluginModule;
const { parseMemoryConnectionConfig, resetRegistration } = pluginModule;
const { createMemoryHttpClient, MemoryHttpClientError } = jiti("../src/client/memory-http-client.ts");

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) });
  res.end(payload);
}

function createHarness(pluginConfig) {
  const tools = new Map();
  const hooks = new Map();
  const services = [];
  const logs = { info: [], warn: [], debug: [], error: [] };
  let resolvePathCalls = 0;
  const api = {
    pluginConfig,
    resolvePath(value) {
      resolvePathCalls += 1;
      return value;
    },
    logger: Object.fromEntries(
      Object.keys(logs).map((level) => [level, (message) => logs[level].push(String(message))]),
    ),
    registerTool(toolOrFactory, meta) {
      tools.set(meta.name, typeof toolOrFactory === "function" ? toolOrFactory : () => toolOrFactory);
    },
    registerCli() {},
    registerService(service) {
      services.push(service);
    },
    on(name, handler, meta) {
      const list = hooks.get(name) || [];
      list.push({ handler, meta });
      hooks.set(name, list);
    },
    registerHook(name, handler, meta) {
      const list = hooks.get(name) || [];
      list.push({ handler, meta });
      hooks.set(name, list);
    },
  };
  return { api, tools, hooks, services, logs, getResolvePathCalls: () => resolvePathCalls };
}

function findHook(harness, name, priority = 10) {
  return (harness.hooks.get(name) || []).find((entry) => entry.meta?.priority === priority)?.handler
    ?? (harness.hooks.get(name) || [])[0]?.handler;
}

describe("OpenClaw remote memory mode", () => {
  let server;
  let baseUrl;
  const calls = [];

  before(async () => {
    server = http.createServer(async (req, res) => {
      if (req.url === "/health" && req.method === "GET") {
        calls.push({ path: req.url, method: req.method, authorization: req.headers.authorization });
        writeJson(res, 200, { status: "ok", memories: 3, captureEnabled: true, vectorDim: 1536 });
        return;
      }
      if (req.headers.authorization !== "Bearer central-secret") {
        writeJson(res, 401, { error: "unauthorized", message: "bad token" });
        return;
      }
      const body = await readJson(req);
      calls.push({ path: req.url, method: req.method, authorization: req.headers.authorization, body });
      if (req.url === "/v1/recall" && req.method === "POST") {
        writeJson(res, 200, {
          count: 1,
          memories: [{
            id: "remote-1",
            text: "Use the central memory server",
            score: 0.91,
            category: "decision",
            scope: body.scope ?? "global",
            importance: 0.8,
            timestamp: Date.now(),
            metadata: { memory_category: "decision", state: "confirmed" },
          }],
        });
        return;
      }
      if (req.url === "/v1/capture" && req.method === "POST") {
        writeJson(res, 200, { created: 1, merged: 0, skipped: 0, boundarySkipped: 0 });
        return;
      }
      writeJson(res, 404, { error: "not_found", message: "missing" });
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
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    calls.length = 0;
    resetRegistration();
  });

  it("parses remote mode without embedding config and keeps embedded as the default", () => {
    assert.deepEqual(parseMemoryConnectionConfig({ embedding: { apiKey: "x" } }), { mode: "embedded" });
    const parsed = parseMemoryConnectionConfig({
      memory: {
        mode: "remote",
        remote: {
          url: baseUrl,
          token: "central-secret",
          scope: "global",
          autoRecall: true,
          autoCapture: false,
          captureAssistant: true,
          autoRecallMinLength: 9,
          autoRecallMinRepeated: 2,
          autoRecallMaxItems: 4,
          autoRecallMaxChars: 900,
          autoRecallPerItemMaxChars: 220,
          autoRecallMaxQueryLength: 1500,
          maxCaptureChars: 12000,
        },
      },
      autoRecall: false,
      autoCapture: true,
      extractMaxChars: 1111,
    });
    assert.equal(parsed.mode, "remote");
    assert.equal(parsed.remote.url, baseUrl);
    assert.equal(parsed.remote.scope, "global");
    assert.equal(parsed.remote.autoRecall, true);
    assert.equal(parsed.remote.autoCapture, false);
    assert.equal(parsed.remote.captureAssistant, true);
    assert.equal(parsed.remote.autoRecallMinLength, 9);
    assert.equal(parsed.remote.autoRecallMinRepeated, 2);
    assert.equal(parsed.remote.autoRecallMaxItems, 4);
    assert.equal(parsed.remote.autoRecallMaxChars, 900);
    assert.equal(parsed.remote.autoRecallPerItemMaxChars, 220);
    assert.equal(parsed.remote.autoRecallMaxQueryLength, 1500);
    assert.equal(parsed.remote.maxCaptureChars, 12000);

    const legacy = parseMemoryConnectionConfig({
      memory: { mode: "remote", remote: { url: baseUrl } },
      autoRecall: true,
      autoCapture: false,
      captureAssistant: true,
      autoRecallMaxItems: 7,
      extractMaxChars: 4321,
    });
    assert.equal(legacy.mode, "remote");
    assert.equal(legacy.remote.autoRecall, true);
    assert.equal(legacy.remote.autoCapture, false);
    assert.equal(legacy.remote.captureAssistant, true);
    assert.equal(legacy.remote.autoRecallMaxItems, 7);
    assert.equal(legacy.remote.maxCaptureChars, 4321);
    assert.throws(
      () => parseMemoryConnectionConfig({ memory: { mode: "sidecar" } }),
      /memory\.mode must be either 'embedded' or 'remote'/,
    );
  });

  it("registers remote tools and hooks without resolving a local database or embedding config", async () => {
    const harness = createHarness({
      memory: {
        mode: "remote",
        remote: {
          url: baseUrl,
          token: "central-secret",
          scope: "global",
          timeoutMs: 2_000,
          autoRecall: true,
          autoRecallMinLength: 1,
          autoCapture: true,
          captureAssistant: true,
        },
      },
    });

    assert.doesNotThrow(() => memoryPlugin.register(harness.api));
    assert.equal(harness.getResolvePathCalls(), 0, "remote registration must not resolve/open a local LanceDB path");
    assert.deepEqual(
      [...harness.tools.keys()].sort(),
      ["memory_get", "memory_recall", "memory_search", "memory_store"],
    );
    assert.equal(harness.services.length, 1);

    const recallTool = harness.tools.get("memory_recall")({ agentId: "tool-agent", sessionKey: "agent:tool-agent:main" });
    const recallResult = await recallTool.execute(
      "call-1",
      { query: "central memory" },
      undefined,
      undefined,
      { agentId: "tool-agent", sessionKey: "agent:tool-agent:main" },
    );
    assert.match(recallResult.content[0].text, /Use the central memory server/);
    const recallCall = calls.at(-1);
    assert.equal(recallCall.authorization, "Bearer central-secret");
    assert.equal(recallCall.body.agentId, "tool-agent");
    assert.equal(recallCall.body.scope, "global");
    assert.equal(recallCall.body.source, "manual");

    const storeTool = harness.tools.get("memory_store")({ agentId: "tool-agent", sessionKey: "agent:tool-agent:main" });
    const storeResult = await storeTool.execute(
      "call-2",
      { text: "Remember the architecture decision" },
      undefined,
      undefined,
      { agentId: "tool-agent", sessionKey: "agent:tool-agent:main" },
    );
    assert.match(storeResult.content[0].text, /central memory service/);
    const storeCall = calls.at(-1);
    assert.equal(storeCall.path, "/v1/capture");
    assert.equal(storeCall.body.agentId, "tool-agent");
    assert.equal(storeCall.body.sessionKey, "agent:tool-agent:main");
    assert.match(storeCall.body.conversationText, /Remember the architecture decision/);
  });

  it("propagates OpenClaw agent, scope, session and auto-recall source to the central server", async () => {
    const harness = createHarness({
      memory: {
        mode: "remote",
        remote: {
          url: baseUrl,
          token: "central-secret",
          scope: "project:agentmemory",
          timeoutMs: 2_000,
          autoRecall: true,
          autoRecallMinLength: 1,
          autoRecallMinRepeated: 0,
          autoCapture: true,
          captureAssistant: true,
        },
      },
    });
    memoryPlugin.register(harness.api);

    const messageHook = findHook(harness, "message_received", undefined);
    messageHook({ content: "What did we decide about memory?" }, { channelId: "ch-1" });
    const recallHook = findHook(harness, "before_prompt_build");
    const recalled = await recallHook(
      { prompt: "assembled prompt" },
      { channelId: "ch-1", agentId: "openclaw-main", sessionId: "s-1", sessionKey: "agent:openclaw-main:main" },
    );
    assert.equal(recalled.ephemeral, true);
    assert.match(recalled.prependContext, /mode:remote/);
    const autoRecallCall = calls.at(-1);
    assert.equal(autoRecallCall.body.agentId, "openclaw-main");
    assert.equal(autoRecallCall.body.scope, "project:agentmemory");
    assert.equal(autoRecallCall.body.source, "auto-recall");

    const captureHook = findHook(harness, "agent_end");
    captureHook({
      success: true,
      messages: [
        { role: "user", content: "Use one central service." },
        { role: "assistant", content: "Confirmed." },
      ],
    }, {
      agentId: "openclaw-main",
      sessionId: "s-1",
      sessionKey: "agent:openclaw-main:main",
    });
    await captureHook.__lastRun;
    const captureCall = calls.at(-1);
    assert.equal(captureCall.path, "/v1/capture");
    assert.equal(captureCall.body.agentId, "openclaw-main");
    assert.equal(captureCall.body.scope, "project:agentmemory");
    assert.equal(captureCall.body.sessionKey, "agent:openclaw-main:main");
    assert.match(captureCall.body.conversationText, /Use one central service/);
    assert.match(captureCall.body.conversationText, /Confirmed/);
  });

  it("surfaces a clear network error and never falls back to local storage", async () => {
    const client = createMemoryHttpClient({ baseUrl: "http://127.0.0.1:1", timeoutMs: 300 });
    await assert.rejects(
      () => client.recall({ query: "unavailable" }),
      (error) => {
        assert.ok(error instanceof MemoryHttpClientError);
        assert.equal(error.code, "network_error");
        assert.match(error.message, /memory server request failed/);
        return true;
      },
    );
  });
});
