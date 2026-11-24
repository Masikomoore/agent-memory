import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  extractAssistantReplyText,
  onRequest,
  onResponse,
  resetSessionStateForTests,
} from "../integrations/magpie/agent-memory.hooks.mjs";
import * as toolsEntry from "../integrations/magpie/index.mjs";

function makeTempDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

async function withMockMemoryServer(handler, fn) {
  const received = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    received.push({ url: req.url, auth: req.headers.authorization, headers: req.headers, body });
    await handler(req, res, body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn({ baseUrl, received });
  } finally {
    server.close();
  }
}

describe("Magpie gateway hook plugin (integrations/magpie)", () => {
  it("satisfies Magpie dual-capability (hooks + tools) manifest and marketplace publishing contract", () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
    const pkgDir = path.join(repoRoot, "integrations", "magpie");
    const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    assert.equal(pkg.name, "magpie-agent-memory");
    assert.notEqual(pkg.private, true, "publishable npm package must not be private");
    assert.equal(pkg.license, "MIT");
    assert.equal(pkg.main, "./index.mjs");
    assert.equal(existsSync(path.join(pkgDir, pkg.main)), true);
    assert.equal(pkg.magpie?.hooks, "./agent-memory.hooks.mjs");
    assert.equal(existsSync(path.join(pkgDir, pkg.magpie.hooks)), true);

    assert.match(pkg.magpie?.icon ?? "", /^data:image\/svg\+xml;base64,/);
    const decodedSvg = Buffer.from(pkg.magpie.icon.replace(/^data:image\/svg\+xml;base64,/, ""), "base64").toString("utf8");
    assert.match(decodedSvg, /^<svg\b/);

    assert.equal(typeof pkg.magpie?.options?.serverUrl, "string");
    assert.equal(typeof pkg.magpie?.options?.gatewayTimeoutMs, "number");
    assert.equal(typeof pkg.magpie?.options?.recallTimeoutMs, "number");
    assert.equal(typeof pkg.magpie?.options?.captureTimeoutMs, "number");
    assert.equal(typeof pkg.magpie?.options?.captureSoftWaitMs, "number");
    assert.equal(typeof pkg.magpie?.options?.captureDedupWindowMs, "number");
    assert.ok(Array.isArray(pkg.magpie?.options?.skipCaptureAgents));

    assert.ok(Array.isArray(pkg.files) && pkg.files.length >= 5);
    for (const rel of pkg.files) {
      assert.equal(existsSync(path.join(pkgDir, rel)), true, `missing packaged file: ${rel}`);
    }

    const reg = JSON.parse(readFileSync(path.join(pkgDir, "registry-entry.json"), "utf8"));
    assert.equal(reg.package, pkg.name);
    assert.equal(reg.name, "agent-memory");
    assert.equal(reg.kind, "middleware");
    assert.ok(typeof reg.summary?.en === "string" && reg.summary.en.length > 10);
    assert.ok(typeof reg.summary?.zh === "string" && reg.summary.zh.length > 10);
  });

  it("exports a single OpenCode plugin function providing recall, capture (202 Accepted), and health MCP tools", async () => {
    resetSessionStateForTests();
    const exportedFunctions = Object.entries(toolsEntry).filter(([, v]) => typeof v === "function");
    assert.equal(exportedFunctions.length, 1, "index.mjs must export only the single plugin entry function");

    await withMockMemoryServer(
      async (req, res) => {
        if (req.url === "/health") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "ok", memories: 7, captureEnabled: true }));
          return;
        }
        if (req.url === "/v1/recall") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ count: 1, memories: [{ id: "t1", text: "Stored fact", score: 0.9 }] }));
          return;
        }
        res.writeHead(202, { "content-type": "application/json" });
        res.end(JSON.stringify({ accepted: true, mode: "async", jobId: "job-123", status: "queued" }));
      },
      async ({ baseUrl, received }) => {
        const hooks = await toolsEntry.AgentMemoryToolsPlugin({}, { serverUrl: baseUrl, token: "tool-secret" });
        assert.deepEqual(Object.keys(hooks.tool).sort(), ["capture", "health", "recall"]);

        const abort = new AbortController().signal;
        const h = await hooks.tool.health.execute({}, { agent: "claude", abort });
        assert.equal(h.serverUrl, baseUrl);
        assert.equal(h.tokenConfigured, true);
        assert.equal(h.health.memories, 7);
        assert.ok(!JSON.stringify(h).includes("tool-secret"), "health output must never expose token");

        const r = await hooks.tool.recall.execute({ query: "stored fact", limit: 3 }, { agent: "agy", abort });
        assert.equal(r.count, 1);

        const c = await hooks.tool.capture.execute({ text: "We use Bun for Magpie plugins." }, { agent: "claude", abort });
        assert.equal(c.accepted, true);
        assert.equal(c.jobId, "job-123");

        const recallReq = received.find((x) => x.url === "/v1/recall");
        assert.equal(recallReq.auth, "Bearer tool-secret");
        assert.equal(recallReq.body.agentId, "antigravity-cli");
        assert.equal(recallReq.body.source, "manual");

        const captureReq = received.find((x) => x.url === "/v1/capture");
        assert.equal(captureReq.auth, "Bearer tool-secret");
        assert.equal(captureReq.body.agentId, "claude-code");
        assert.equal(captureReq.body.mode, "async");
        assert.match(captureReq.body.idempotencyKey, /^[0-9a-f]{64}$/);
        assert.equal(captureReq.headers["idempotency-key"], captureReq.body.idempotencyKey);
        assert.match(captureReq.body.conversationText, /Bun for Magpie plugins/);
      },
    );
  });

  it("hands off slow synchronous captures before Magpie's tool cutoff, keeps the background POST alive, deduplicates retries, and clears dedup on fast errors", async () => {
    resetSessionStateForTests();
    let capturePostCount = 0;
    let serverCompleted = false;
    let failNext = false;

    await withMockMemoryServer(
      async (req, res) => {
        if (failNext) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "internal_error", message: "boom" }));
          return;
        }
        capturePostCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 350));
        serverCompleted = true;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ created: 1, merged: 0 }));
      },
      async ({ baseUrl }) => {
        const hooks = await toolsEntry.AgentMemoryToolsPlugin({}, {
          serverUrl: baseUrl,
          token: "tool-secret",
          captureTimeoutMs: 5_000,
          captureSoftWaitMs: 120,
          captureDedupWindowMs: 60_000,
        });

        // 1. Soft handoff triggers at ~120ms BEFORE ctx.abort (220ms), returning background acceptance.
        const slowResult = await hooks.tool.capture.execute(
          { text: "Style 05 royal crimson gem coin branding selected." },
          { agent: "agy", abort: AbortSignal.timeout(220) },
        );
        assert.equal(slowResult.accepted, true);
        assert.equal(slowResult.background, true);
        assert.equal(slowResult.doNotRetry, true);
        assert.equal(slowResult.status, "pending_server_processing");
        assert.equal(capturePostCount, 1);

        // 2. Immediate duplicate retry while in-flight does NOT issue a second POST.
        const dupInFlight = await hooks.tool.capture.execute(
          { text: "Style 05 royal crimson gem coin branding selected." },
          { agent: "agy", abort: new AbortController().signal },
        );
        assert.equal(dupInFlight.accepted, true);
        assert.equal(dupInFlight.deduplicated, true);
        assert.equal(dupInFlight.doNotRetry, true);
        assert.equal(dupInFlight.status, "in_flight");
        assert.equal(capturePostCount, 1);

        // 3. Wait for the decoupled background fetch to finish on the server.
        const deadline = Date.now() + 2_000;
        while (Date.now() < deadline && !serverCompleted) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(serverCompleted, true, "background capture fetch must finish despite caller ctx.abort");

        // 4. Duplicate retry after completion still suppresses redundant POST.
        const dupCompleted = await hooks.tool.capture.execute(
          { text: "Style 05 royal crimson gem coin branding selected." },
          { agent: "agy", abort: new AbortController().signal },
        );
        assert.equal(dupCompleted.accepted, true);
        assert.equal(dupCompleted.deduplicated, true);
        assert.equal(dupCompleted.doNotRetry, true);
        assert.equal(capturePostCount, 1);

        // 5. Fast HTTP error rejects immediately AND clears dedup record so retry succeeds.
        failNext = true;
        await assert.rejects(
          () => hooks.tool.capture.execute(
            { text: "Transient error payload" },
            { agent: "agy", abort: new AbortController().signal },
          ),
          /Agent Memory Server error \(500\): internal_error: boom/,
        );

        failNext = false;
        const retryAfterError = await hooks.tool.capture.execute(
          { text: "Transient error payload" },
          { agent: "agy", abort: new AbortController().signal },
        );
        assert.equal(retryAfterError.accepted, true);
        assert.equal(capturePostCount, 2);
      },
    );
  });

  it("recalls and injects across chat, responses, anthropic, and gemini without altering model/stream/tools, then captures onResponse", async () => {
    resetSessionStateForTests();
    const envDir = makeTempDir("magpie-hook-env-");
    const envFile = path.join(envDir, "hook.env");

    await withMockMemoryServer(
      async (req, res) => {
        if (req.url === "/v1/recall") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            count: 1,
            memories: [{
              id: "mem-1",
              text: "Primary deployment target is Coolify on CA node.",
              score: 0.92,
              scope: "global",
              metadata: { memory_category: "fact" },
            }],
          }));
          return;
        }
        res.writeHead(202, { "content-type": "application/json" });
        res.end(JSON.stringify({ accepted: true, jobId: "hook-job-1" }));
      },
      async ({ baseUrl, received }) => {
        writeFileSync(envFile, `MEMORY_SERVER_URL=${baseUrl}\nMEMORY_SERVER_TOKEN=magpie-secret\n`, { mode: 0o600 });

        const cases = [
          {
            protocol: "chat",
            agent: "grok",
            session: "sess-chat",
            body: {
              model: "grok/grok-4.7",
              stream: true,
              tools: [{ type: "function", function: { name: "bash" } }],
              messages: [
                { role: "system", content: "You are helpful." },
                { role: "user", content: "Where do we deploy agent-memory?" },
              ],
            },
            reply: { choices: [{ message: { role: "assistant", content: "We deploy on Coolify." } }] },
            checkInjected(mutated) {
              assert.equal(mutated.model, "grok/grok-4.7");
              assert.equal(mutated.stream, true);
              assert.equal(mutated.tools.length, 1);
              assert.equal(mutated.messages[0].content, "You are helpful.", "system prompt stays cache-stable");
              assert.match(mutated.messages[1].content, /<relevant-memories>/);
              assert.match(mutated.messages[1].content, /Coolify on CA node/);
            },
          },
          {
            protocol: "responses",
            agent: "cursor",
            session: "sess-resp",
            body: {
              model: "openai/gpt-5",
              stream: true,
              instructions: "Follow repo rules.",
              input: [{ role: "user", content: [{ type: "input_text", text: "Remind me our deployment setup." }] }],
            },
            reply: {
              output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Coolify deploys main." }] }],
            },
            checkInjected(mutated) {
              assert.equal(mutated.instructions, "Follow repo rules.");
              assert.equal(mutated.input[0].content.length, 2);
              assert.match(mutated.input[0].content[1].text, /<relevant-memories>/);
            },
          },
          {
            protocol: "anthropic",
            agent: "vscode",
            session: "sess-anth",
            body: {
              model: "claude-sonnet-4-6",
              stream: true,
              system: "System prompt",
              messages: [{ role: "user", content: [{ type: "text", text: "How is our memory service deployed?" }] }],
            },
            reply: {
              content: [
                { type: "thinking", thinking: "internal thought" },
                { type: "text", text: "It runs via Coolify." },
              ],
            },
            checkInjected(mutated) {
              assert.equal(mutated.system, "System prompt");
              assert.equal(mutated.messages[0].content.length, 2);
              assert.match(mutated.messages[0].content[1].text, /Coolify on CA node/);
            },
          },
          {
            protocol: "gemini",
            agent: "gemini-cli",
            session: "sess-gem",
            body: {
              systemInstruction: { parts: [{ text: "Gemini system" }] },
              contents: [{ role: "user", parts: [{ text: "What hosts our memory backend?" }] }],
            },
            reply: {
              candidates: [{
                content: {
                  parts: [
                    { text: "hidden thought", thought: true },
                    { text: "It is hosted on Coolify." },
                  ],
                },
              }],
            },
            checkInjected(mutated) {
              assert.equal(mutated.systemInstruction.parts.length, 1);
              assert.equal(mutated.contents[0].parts.length, 2);
              assert.match(mutated.contents[0].parts[1].text, /Coolify on CA node/);
            },
          },
        ];

        for (const tc of cases) {
          const reports = [];
          const ctx = {
            origin: "local",
            protocol: tc.protocol,
            agent: tc.agent,
            session: tc.session,
            cwd: "/work/agent-memory",
            query: "",
            options: { envFile },
            state: {},
            signal: new AbortController().signal,
            report: (code, bytes) => reports.push({ code, bytes }),
          };

          const mutated = await onRequest(structuredClone(tc.body), ctx);
          assert.ok(mutated, `${tc.protocol} should return mutated body`);
          tc.checkInjected(mutated);
          assert.equal(reports[0].code, "ready");
          assert.ok(reports[0].bytes > 0);

          await onResponse(tc.reply, { ...ctx, success: true, signal: new AbortController().signal });
          // Duplicate onResponse with identical turn is deduplicated.
          await onResponse(tc.reply, { ...ctx, success: true, signal: new AbortController().signal });
        }

        const captures = received.filter((r) => r.url === "/v1/capture");
        assert.equal(captures.length, 4);
        assert.ok(captures.every((c) => c.auth === "Bearer magpie-secret"));
        assert.ok(captures.every((c) => c.body.mode === "async" && /^[0-9a-f]{64}$/.test(c.body.idempotencyKey)));
        // Verify thinking blocks were stripped in Anthropic and Gemini captures.
        const anthCap = captures.find((c) => c.body.agentId === "vscode");
        assert.ok(!anthCap.body.conversationText.includes("internal thought"));
        assert.match(anthCap.body.conversationText, /It runs via Coolify/);
        const gemCap = captures.find((c) => c.body.agentId === "gemini-cli");
        assert.ok(!gemCap.body.conversationText.includes("hidden thought"));
        assert.match(gemCap.body.conversationText, /hosted on Coolify/);
      },
    );

    rmSync(envDir, { recursive: true, force: true });
  });

  it("does not re-post onResponse capture after an AbortError timeout", async () => {
    resetSessionStateForTests();
    let captureCount = 0;
    let releaseFirst;
    await withMockMemoryServer(
      async (req, res) => {
        if (req.url === "/v1/capture") {
          captureCount += 1;
          await new Promise((resolve) => { releaseFirst = resolve; });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ created: 1 }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ count: 0, memories: [] }));
      },
      async ({ baseUrl }) => {
        const ctx = {
          origin: "local",
          protocol: "chat",
          agent: "grok",
          session: "sess-abort",
          query: "How should we avoid duplicate capture retries?",
          options: { serverUrl: baseUrl, token: "t1", recallEnabled: false },
          state: {},
          signal: new AbortController().signal,
          report() {},
        };
        await onRequest({ messages: [{ role: "user", content: ctx.query }] }, ctx);
        const reply = { choices: [{ message: { role: "assistant", content: "Use idempotency keys." } }] };
        await onResponse(reply, { ...ctx, success: true, signal: AbortSignal.timeout(40) });
        await onResponse(reply, { ...ctx, success: true, signal: new AbortController().signal });
        assert.equal(captureCount, 1);
        releaseFirst?.();
      },
    );
  });

  it("enforces local-origin gate, skips tool continuations and already-injected client hooks, and respects skipAgents/skipCaptureAgents", async () => {
    resetSessionStateForTests();
    await withMockMemoryServer(
      async (req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        if (req.url === "/v1/recall") {
          res.end(JSON.stringify({
            count: 1,
            memories: [{ id: "m2", text: "Fact", score: 0.9, scope: "global" }],
          }));
        } else {
          res.end(JSON.stringify({ created: 1 }));
        }
      },
      async ({ baseUrl, received }) => {
        const makeCtx = (overrides = {}) => {
          const { options: optOverrides, ...restOverrides } = overrides;
          const reports = [];
          return {
            reports,
            ctx: {
              origin: "local",
              protocol: "anthropic",
              agent: "claude-code",
              session: "s1",
              query: "What database are we using for telemetry?",
              state: {},
              signal: new AbortController().signal,
              report: (code, bytes) => reports.push({ code, bytes }),
              ...restOverrides,
              options: { serverUrl: baseUrl, token: "t1", ...optOverrides },
            },
          };
        };

        // 1. Non-local origin is skipped by default.
        {
          const { ctx, reports } = makeCtx({ origin: "remote" });
          const res = await onRequest({ messages: [{ role: "user", content: "What database are we using?" }] }, ctx);
          assert.equal(res, undefined);
          assert.equal(reports[0].code, "skipped");
        }

        // 2. Client already injected <relevant-memories> -> skips recall AND capture.
        {
          const { ctx, reports } = makeCtx();
          const res = await onRequest({
            messages: [{
              role: "user",
              content: "<relevant-memories>\n- [fact:global] Already here\n</relevant-memories>\nWhat database are we using?",
            }],
          }, ctx);
          assert.equal(res, undefined);
          assert.equal(reports[0].code, "skipped");
          await onResponse({ content: [{ type: "text", text: "PostgreSQL." }] }, { ...ctx, success: true });
        }

        // 3. Tool-result continuation round -> skipped.
        {
          const { ctx, reports } = makeCtx();
          const res = await onRequest({
            messages: [{
              role: "user",
              content: [{ type: "tool_result", tool_use_id: "tu_1", content: "ok" }],
            }],
          }, ctx);
          assert.equal(res, undefined);
          assert.equal(reports[0].code, "skipped");
        }

        // 4. skipAgents skips recall & capture.
        {
          const { ctx, reports } = makeCtx({ options: { skipAgents: ["claude-code"] } });
          const res = await onRequest({ messages: [{ role: "user", content: "What database are we using?" }] }, ctx);
          assert.equal(res, undefined);
          assert.equal(reports[0].code, "skipped");
        }

        assert.equal(received.length, 0, "none of the guarded requests should hit the memory server");

        // 5. skipCaptureAgents matches both Magpie short ID ("claude" / "agy") and canonical ID ("claude-code" / "antigravity-cli").
        {
          const { ctx, reports } = makeCtx({ agent: "claude", options: { skipCaptureAgents: ["claude-code"] } });
          const res = await onRequest({ messages: [{ role: "user", content: "What database are we using?" }] }, ctx);
          assert.ok(res);
          assert.equal(reports[0].code, "ready");
          await onResponse({ content: [{ type: "text", text: "ClickHouse." }] }, { ...ctx, success: true });
          const recalls = received.filter((r) => r.url === "/v1/recall");
          assert.equal(recalls.length, 1);
          assert.equal(recalls[0].body.agentId, "claude-code");
          assert.equal(received.filter((r) => r.url === "/v1/capture").length, 0);
        }
      },
    );
  });

  it("reports unauthorized on HTTP 401 and fails open cleanly", async () => {
    resetSessionStateForTests();
    await withMockMemoryServer(
      async (_req, res) => {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
      },
      async ({ baseUrl }) => {
        const reports = [];
        const res = await onRequest(
          { messages: [{ role: "user", content: "How should we rotate our API keys?" }] },
          {
            origin: "local",
            protocol: "chat",
            agent: "grok",
            session: "s-unauth",
            query: "How should we rotate our API keys?",
            options: { serverUrl: baseUrl },
            state: {},
            signal: new AbortController().signal,
            report: (code, bytes) => reports.push({ code, bytes }),
          },
        );
        assert.equal(res, undefined);
        assert.equal(reports[0].code, "unauthorized");
      },
    );

    assert.equal(extractAssistantReplyText("chat", { choices: [{ message: { content: "Hello" } }] }), "Hello");
  });
});
