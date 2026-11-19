import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { loadHookEnv, parseDotEnv } = jiti("../src/client/hook-env.ts");
const { parseTranscriptJsonl, extractCaptureDelta } = jiti("../src/client/hook-transcript.ts");
const { createEmptySessionState, sessionStateFilePath } = jiti("../src/client/hook-state.ts");
const { runMemoryHookCli } = jiti("../src/client/memory-hook-cli.ts");

function outputCollector() {
  let text = "";
  return {
    stream: { write(chunk) { text += String(chunk); return true; } },
    text: () => text,
  };
}

function makeTempDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

describe("hook-env configuration loading", () => {
  it("parses dotenv syntax and lets process env override file values", () => {
    const homeDir = makeTempDir("hook-env-home-");
    try {
      const envDir = path.join(homeDir, ".config", "agent-memory");
      mkdirSync(envDir, { recursive: true });
      const envFile = path.join(envDir, "hook.env");
      writeFileSync(
        envFile,
        [
          "# comment line",
          'export MEMORY_SERVER_URL="http://10.0.0.5:7337"',
          "MEMORY_SERVER_TOKEN='file-secret-token'",
          "MEMORY_HOOK_RECALL_MAX_ITEMS=4 # inline comment",
        ].join("\n"),
        { encoding: "utf8", mode: 0o600 },
      );

      assert.deepEqual(parseDotEnv('export A="x\\ny"\nB=\'lit\'\nC=val # note'), {
        A: "x\ny",
        B: "lit",
        C: "val",
      });

      const loaded = loadHookEnv(
        { MEMORY_SERVER_URL: "http://127.0.0.1:7337" },
        { homeDir, platform: "darwin" },
      );
      assert.equal(loaded.envFileLoaded, true);
      assert.equal(loaded.env.MEMORY_SERVER_URL, "http://127.0.0.1:7337");
      assert.equal(loaded.env.MEMORY_SERVER_TOKEN, "file-secret-token");
      assert.equal(loaded.env.MEMORY_HOOK_RECALL_MAX_ITEMS, "4");
      assert.deepEqual(loaded.warnings, []);

      chmodSync(envFile, 0o644);
      const insecure = loadHookEnv({}, { homeDir, platform: "darwin" });
      assert.equal(insecure.warnings.length, 1);
      assert.match(insecure.warnings[0], /chmod 600/);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});

describe("multi-schema transcript parser and incremental watermark", () => {
  it("parses Claude Code / WorkBuddy JSONL and strips tool results, meta, sidechains, and injected memory blocks", () => {
    const jsonl = [
      JSON.stringify({
        type: "user",
        isMeta: true,
        message: { role: "user", content: "internal meta message" },
      }),
      JSON.stringify({
        type: "user",
        isSidechain: true,
        message: { role: "user", content: "subagent sidechain message" },
      }),
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: "<relevant-memories>\n- [fact:global] old recalled item\n</relevant-memories>\n<system-reminder>ignore</system-reminder>\nWe standardized on PostgreSQL 16 for billing.",
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hidden chain of thought" },
            { type: "tool_use", name: "memory_recall", input: { query: "billing" } },
            { type: "text", text: "Noted — I will target PostgreSQL 16 for billing migrations." },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "1", content: "MCP memory_recall result should never loop back" },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "/compact" },
      }),
    ].join("\n");

    const turns = parseTranscriptJsonl(jsonl);
    assert.deepEqual(turns, [
      { role: "user", text: "We standardized on PostgreSQL 16 for billing." },
      { role: "assistant", text: "Noted — I will target PostgreSQL 16 for billing migrations." },
    ]);
  });

  it("parses Codex rollout JSONL cleanly without doubling event_msg and response_item", () => {
    const rollout = [
      JSON.stringify({ type: "session_meta", payload: { id: "thr-1" } }),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "<environment_context>macOS</environment_context>\nUse pnpm across this monorepo." }],
        },
      }),
      JSON.stringify({
        type: "event_msg",
        payload: { type: "user_message", message: "Use pnpm across this monorepo." },
      }),
      JSON.stringify({
        type: "response_item",
        payload: { type: "function_call", name: "memory_recall", arguments: "{}" },
      }),
      JSON.stringify({
        type: "event_msg",
        payload: { type: "agent_message", message: "Got it, I will run pnpm commands instead of npm." },
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Got it, I will run pnpm commands instead of npm." }],
        },
      }),
    ].join("\n");

    const turns = parseTranscriptJsonl(rollout);
    assert.deepEqual(turns, [
      { role: "user", text: "Use pnpm across this monorepo." },
      { role: "assistant", text: "Got it, I will run pnpm commands instead of npm." },
    ]);
  });

  it("slices only incremental turns across consecutive Stop calls and caps first-run long histories", () => {
    const dir = makeTempDir("hook-transcript-");
    try {
      const transcriptPath = path.join(dir, "session.jsonl");
      const lines = [];
      for (let i = 1; i <= 10; i += 1) {
        lines.push(JSON.stringify({ type: "user", message: { role: "user", content: `Historical fact number ${i}.` } }));
        lines.push(JSON.stringify({ type: "assistant", message: { role: "assistant", content: `Acknowledged fact ${i}.` } }));
      }
      writeFileSync(transcriptPath, `${lines.join("\n")}\n`, "utf8");

      const state = createEmptySessionState("claude-code", "claude-code:sess-1");
      const first = extractCaptureDelta({ transcriptPath, state });
      assert.equal(first.source, "transcript");
      assert.equal(first.turnCount, 6, "first run without cursor caps stale history to newest 6 turns");
      assert.doesNotMatch(first.conversationText, /Historical fact number 1\./);
      assert.match(first.conversationText, /Historical fact number 10\./);
      assert.equal(first.nextCursor.seenTurnCount, 20);

      state.transcriptCursor = first.nextCursor;
      state.lastCapturedHash = first.contentHash;

      // Second call without new lines produces no delta.
      const noop = extractCaptureDelta({ transcriptPath, state });
      assert.equal(noop.conversationText, "");
      assert.equal(noop.source, "none");

      // Append a brand-new turn and verify only the new turn is returned.
      lines.push(JSON.stringify({ type: "user", message: { role: "user", content: "Deploy staging to Frankfurt region." } }));
      lines.push(JSON.stringify({ type: "assistant", message: { role: "assistant", content: "Will deploy staging to eu-central-1." } }));
      writeFileSync(transcriptPath, `${lines.join("\n")}\n`, "utf8");

      const second = extractCaptureDelta({ transcriptPath, state });
      assert.equal(second.source, "transcript");
      assert.equal(second.turnCount, 2);
      assert.match(second.conversationText, /Deploy staging to Frankfurt region/);
      assert.doesNotMatch(second.conversationText, /Historical fact number 10/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to cached lastPrompt + lastAssistantMessage when transcript_path is missing", () => {
    const state = createEmptySessionState("workbuddy", "workbuddy:wb-1");
    state.lastPrompt = { text: "Always write migration rollback scripts.", at: Date.now() };
    const delta = extractCaptureDelta({
      transcriptPath: "/nonexistent/path/transcript.jsonl",
      state,
      lastAssistantMessage: "Understood, every migration will include a rollback script.",
    });
    assert.equal(delta.source, "fallback-pair");
    assert.equal(delta.consumedLastPrompt, true);
    assert.match(delta.conversationText, /Always write migration rollback scripts/);
    assert.match(delta.conversationText, /include a rollback script/);
  });
});

describe("agent-memory-hook handle lifecycle across Claude Code, Codex, and WorkBuddy", () => {
  it("injects hookSpecificOutput.additionalContext on UserPromptSubmit, suppresses repeats, and skips trivial prompts", async () => {
    const homeDir = makeTempDir("hook-handle-home-");
    const stateDir = path.join(homeDir, "state");
    const recallRequests = [];

    const createClient = () => ({
      baseUrl: "http://127.0.0.1:7337",
      async health() { return { status: "ok", memories: 1, captureEnabled: true }; },
      async capture() { return { created: 0 }; },
      async recall(request) {
        recallRequests.push(request);
        return {
          count: 1,
          memories: [{
            id: "mem-pref-1",
            text: "User prefers TypeScript strict mode and pnpm.",
            score: 0.92,
            scope: "global",
            metadata: { memory_category: "preferences" },
          }],
        };
      },
    });

    try {
      // 1. Trivial prompt short-circuits without hitting the server.
      const trivialOut = outputCollector();
      const trivialCode = await runMemoryHookCli(
        ["handle", "--host", "workbuddy", "--state-dir", stateDir],
        { MEMORY_SERVER_URL: "http://127.0.0.1:7337" },
        {
          stdin: Readable.from([JSON.stringify({
            hook_event_name: "UserPromptSubmit",
            session_id: "wb-session-1",
            prompt: "ok",
            client: "WorkBuddy",
          })]),
          stdout: trivialOut.stream,
        },
        { createClient, homeDir },
      );
      assert.equal(trivialCode, 0);
      assert.equal(trivialOut.text(), "");
      assert.equal(recallRequests.length, 0);

      // 2. Meaningful prompt recalls with source=auto-recall and outputs WorkBuddy/Claude/Codex JSON envelope.
      const out1 = outputCollector();
      const code1 = await runMemoryHookCli(
        ["handle", "--host", "workbuddy", "--state-dir", stateDir],
        { MEMORY_SERVER_URL: "http://127.0.0.1:7337" },
        {
          stdin: Readable.from([JSON.stringify({
            hook_event_name: "UserPromptSubmit",
            session_id: "wb-session-1",
            prompt: "What package manager and TypeScript conventions should I follow here?",
            client: "WorkBuddy",
          })]),
          stdout: out1.stream,
        },
        { createClient, homeDir },
      );
      assert.equal(code1, 0);
      assert.equal(recallRequests.length, 1);
      assert.equal(recallRequests[0].agentId, "workbuddy");
      assert.equal(recallRequests[0].scope, undefined, "keeps server default global scope policy");
      assert.equal(recallRequests[0].source, "auto-recall");

      const parsedOut1 = JSON.parse(out1.text());
      assert.equal(parsedOut1.hookSpecificOutput.hookEventName, "UserPromptSubmit");
      assert.match(parsedOut1.hookSpecificOutput.additionalContext, /<relevant-memories>/);
      assert.match(parsedOut1.hookSpecificOutput.additionalContext, /TypeScript strict mode/);

      // 3. Immediate follow-up turn suppresses the same memory ID (minRepeated=8).
      const out2 = outputCollector();
      const code2 = await runMemoryHookCli(
        ["handle", "--host", "workbuddy", "--state-dir", stateDir],
        { MEMORY_SERVER_URL: "http://127.0.0.1:7337" },
        {
          stdin: Readable.from([JSON.stringify({
            hook_event_name: "UserPromptSubmit",
            session_id: "wb-session-1",
            prompt: "Can you also check our TypeScript tsconfig setup?",
          })]),
          stdout: out2.stream,
        },
        { createClient, homeDir },
      );
      assert.equal(code2, 0);
      assert.equal(out2.text(), "", "recently injected memory should be suppressed within repeat window");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("spawns detached background capture without persisting secrets, and _worker executes incremental capture", async () => {
    const homeDir = makeTempDir("hook-worker-home-");
    const stateDir = path.join(homeDir, "state");
    const envDir = path.join(homeDir, ".config", "agent-memory");
    mkdirSync(envDir, { recursive: true });
    writeFileSync(
      path.join(envDir, "hook.env"),
      "MEMORY_SERVER_URL=http://127.0.0.1:7337\nMEMORY_SERVER_TOKEN=super-secret-token\n",
      { encoding: "utf8", mode: 0o600 },
    );

    const transcriptPath = path.join(homeDir, ".codex", "sessions", "rollout-1.jsonl");
    mkdirSync(path.dirname(transcriptPath), { recursive: true });
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Our production Redis runs on port 6380." } }),
        JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "Noted, Redis port is 6380." } }),
      ].join("\n") + "\n",
      "utf8",
    );

    const spawnedTasks = [];
    const capturedCalls = [];
    const seenTokens = [];
    const createClient = (config) => {
      seenTokens.push(config.token);
      return {
        baseUrl: config.baseUrl,
        async health() { return { status: "ok", memories: 0, captureEnabled: true }; },
        async recall() { return { count: 0, memories: [] }; },
        async capture(req) { capturedCalls.push(req); return { created: 1 }; },
      };
    };

    try {
      // Stop enqueues detached task and returns immediately.
      const stopCode = await runMemoryHookCli(
        ["handle", "--host", "codex", "--state-dir", stateDir],
        {},
        {
          stdin: Readable.from([JSON.stringify({
            hook_event_name: "Stop",
            session_id: "codex-thread-9",
            transcript_path: transcriptPath,
            stop_hook_active: false,
          })]),
          stdout: outputCollector().stream,
        },
        {
          homeDir,
          spawnWorker: (taskFile) => { spawnedTasks.push(taskFile); },
        },
      );
      assert.equal(stopCode, 0);
      assert.equal(spawnedTasks.length, 1);

      const taskFile = spawnedTasks[0];
      const rawTask = readFileSync(taskFile, "utf8");
      assert.ok(!rawTask.includes("super-secret-token"), "task file must never persist bearer tokens");

      // Execute _worker as the detached child process would.
      const workerCode = await runMemoryHookCli(
        ["_worker", taskFile],
        {},
        { stdout: outputCollector().stream },
        { createClient, homeDir },
      );
      assert.equal(workerCode, 0);
      assert.equal(existsSync(taskFile), false, "worker must remove its temp task file");
      assert.equal(capturedCalls.length, 1);
      assert.equal(seenTokens[0], "super-secret-token", "worker reloads token from hook.env");
      assert.equal(capturedCalls[0].agentId, "codex");
      assert.equal(capturedCalls[0].sessionKey, "codex:codex-thread-9");
      assert.equal(capturedCalls[0].scope, undefined);
      assert.match(capturedCalls[0].conversationText, /Redis runs on port 6380/);

      // stop_hook_active=true skips spawning another capture worker.
      const loopCode = await runMemoryHookCli(
        ["handle", "--host", "codex", "--state-dir", stateDir],
        {},
        {
          stdin: Readable.from([JSON.stringify({
            hook_event_name: "Stop",
            session_id: "codex-thread-9",
            transcript_path: transcriptPath,
            stop_hook_active: true,
          })]),
          stdout: outputCollector().stream,
        },
        {
          homeDir,
          spawnWorker: (file) => { spawnedTasks.push(file); },
        },
      );
      assert.equal(loopCode, 0);
      assert.equal(spawnedTasks.length, 1);

      // SessionEnd with --sync cleans up the session state file after flushing.
      const stateFile = sessionStateFilePath(stateDir, "codex", "codex:codex-thread-9");
      assert.equal(existsSync(stateFile), true);
      const endCode = await runMemoryHookCli(
        ["handle", "--host", "codex", "--state-dir", stateDir, "--sync"],
        {},
        {
          stdin: Readable.from([JSON.stringify({
            hook_event_name: "SessionEnd",
            session_id: "codex-thread-9",
            transcript_path: transcriptPath,
          })]),
          stdout: outputCollector().stream,
        },
        { createClient, homeDir },
      );
      assert.equal(endCode, 0);
      assert.equal(existsSync(stateFile), false, "SessionEnd removes local session state file");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("fails open (exit 0) when server fails or env file is missing during handle", async () => {
    const homeDir = makeTempDir("hook-failopen-");
    try {
      const stdout = outputCollector();
      const stderr = outputCollector();
      const code = await runMemoryHookCli(
        ["handle", "--host", "claude-code", "--env-file", path.join(homeDir, "missing.env")],
        {},
        {
          stdin: Readable.from([JSON.stringify({
            hook_event_name: "UserPromptSubmit",
            session_id: "s1",
            prompt: "What database are we using for analytics?",
          })]),
          stdout: stdout.stream,
          stderr: stderr.stream,
        },
        { homeDir },
      );
      assert.equal(code, 0);
      assert.equal(stdout.text(), "");
      assert.equal(stderr.text(), "");

      const netCode = await runMemoryHookCli(
        ["handle", "--host", "claude-code", "--state-dir", path.join(homeDir, "st")],
        { MEMORY_SERVER_URL: "http://127.0.0.1:7337" },
        {
          stdin: Readable.from([JSON.stringify({
            hook_event_name: "UserPromptSubmit",
            session_id: "s2",
            prompt: "Remind me what deployment platform we chose.",
          })]),
          stdout: stdout.stream,
          stderr: stderr.stream,
        },
        {
          homeDir,
          createClient: () => ({
            baseUrl: "http://127.0.0.1:7337",
            async health() { throw new Error("down"); },
            async capture() { throw new Error("down"); },
            async recall() { throw new Error("timeout"); },
          }),
        },
      );
      assert.equal(netCode, 0);
      assert.equal(stdout.text(), "");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});

describe("agent-memory-hook install and doctor for Claude Code, Codex, and WorkBuddy", () => {
  it("installs idempotently into ~/.claude/settings.json, ~/.codex/hooks.json, and ~/.workbuddy/settings.json without clobbering existing config", async () => {
    const homeDir = makeTempDir("hook-install-home-");
    const cwd = makeTempDir("hook-install-cwd-");
    try {
      // Seed pre-existing WorkBuddy settings with unrelated keys and custom hooks.
      const wbPath = path.join(homeDir, ".workbuddy", "settings.json");
      mkdirSync(path.dirname(wbPath), { recursive: true });
      writeFileSync(
        wbPath,
        JSON.stringify({
          theme: "dark",
          hooks: {
            PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo safe" }] }],
          },
        }, null, 2),
        "utf8",
      );

      // Dry-run does not modify disk.
      const dryOut = outputCollector();
      const dryCode = await runMemoryHookCli(
        ["install", "workbuddy", "--command", "agent-memory-hook"],
        {},
        { stdout: dryOut.stream },
        { homeDir, cwd },
      );
      assert.equal(dryCode, 0);
      assert.match(dryOut.text(), /Dry run only/);
      assert.equal(JSON.parse(readFileSync(wbPath, "utf8")).hooks.UserPromptSubmit, undefined);

      // Apply to all three hosts.
      for (const host of ["claude-code", "codex", "workbuddy"]) {
        const out = outputCollector();
        const code = await runMemoryHookCli(
          ["install", host, "--command", "agent-memory-hook", "--apply", "--json"],
          {},
          { stdout: out.stream },
          { homeDir, cwd },
        );
        assert.equal(code, 0);
        const res = JSON.parse(out.text());
        assert.equal(res.applied, true);
        assert.equal(res.changed, true);
      }

      // Verify WorkBuddy preserved existing settings + PreToolUse hook and installed into ~/.workbuddy/settings.json.
      const wbCfg = JSON.parse(readFileSync(wbPath, "utf8"));
      assert.equal(wbCfg.theme, "dark");
      assert.equal(wbCfg.hooks.PreToolUse.length, 1);
      assert.deepEqual(
        Object.keys(wbCfg.hooks).sort(),
        ["PreCompact", "PreToolUse", "SessionEnd", "Stop", "UserPromptSubmit"],
      );

      // Verify Codex hooks.json strictly omits unsupported Claude-only fields like `async`.
      const codexPath = path.join(homeDir, ".codex", "hooks.json");
      const codexCfg = JSON.parse(readFileSync(codexPath, "utf8"));
      assert.deepEqual(Object.keys(codexCfg), ["hooks"]);
      assert.deepEqual(Object.keys(codexCfg.hooks).sort(), ["Stop", "UserPromptSubmit"]);
      for (const event of ["UserPromptSubmit", "Stop"]) {
        const group = codexCfg.hooks[event][0];
        assert.deepEqual(Object.keys(group), ["hooks"]);
        assert.equal("async" in group.hooks[0], false, "Codex hooks.json must not include async");
      }

      // Verify Claude Code settings.json enables async on Stop.
      const claudePath = path.join(homeDir, ".claude", "settings.json");
      const claudeCfg = JSON.parse(readFileSync(claudePath, "utf8"));
      assert.equal(claudeCfg.hooks.Stop[0].hooks[0].async, true);

      // Re-running install is idempotent (changed=false, no duplicates).
      const rerunOut = outputCollector();
      const rerunCode = await runMemoryHookCli(
        ["install", "workbuddy", "--command", "agent-memory-hook", "--apply", "--json"],
        {},
        { stdout: rerunOut.stream },
        { homeDir, cwd },
      );
      assert.equal(rerunCode, 0);
      assert.equal(JSON.parse(rerunOut.text()).changed, false);
      assert.equal(JSON.parse(readFileSync(wbPath, "utf8")).hooks.Stop.length, 1);

      // Doctor reports all 3 hosts and never prints secrets.
      const doctorOut = outputCollector();
      const doctorCode = await runMemoryHookCli(
        ["doctor", "--json"],
        { MEMORY_SERVER_URL: "http://127.0.0.1:7337", MEMORY_SERVER_TOKEN: "top-secret-doctor-token" },
        { stdout: doctorOut.stream },
        {
          homeDir,
          cwd,
          createClient: () => ({
            baseUrl: "http://127.0.0.1:7337",
            async health() { return { status: "ok", memories: 42, captureEnabled: true }; },
            async recall() { return { count: 0, memories: [] }; },
            async capture() { return { created: 0 }; },
          }),
        },
      );
      assert.equal(doctorCode, 0);
      assert.ok(!doctorOut.text().includes("top-secret-doctor-token"));
      const report = JSON.parse(doctorOut.text());
      assert.equal(report.tokenConfigured, true);
      assert.equal(report.serverHealth.ok, true);
      assert.equal(report.hosts.length, 3);
      for (const item of report.hosts) {
        assert.ok(item.userInstalledEvents.includes("UserPromptSubmit"));
        assert.ok(item.userInstalledEvents.includes("Stop"));
      }

      // Uninstall cleanly removes only managed entries and preserves unrelated WorkBuddy hooks.
      const unOut = outputCollector();
      const unCode = await runMemoryHookCli(
        ["install", "workbuddy", "--uninstall", "--apply", "--json"],
        {},
        { stdout: unOut.stream },
        { homeDir, cwd },
      );
      assert.equal(unCode, 0);
      const wbAfterUninstall = JSON.parse(readFileSync(wbPath, "utf8"));
      assert.equal(wbAfterUninstall.theme, "dark");
      assert.deepEqual(Object.keys(wbAfterUninstall.hooks), ["PreToolUse"]);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("ships valid example hook templates for Claude Code, Codex, and WorkBuddy", () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
    for (const rel of [
      "examples/hooks/claude-code.settings.json",
      "examples/hooks/codex.hooks.json",
      "examples/hooks/workbuddy.settings.json",
    ]) {
      const content = JSON.parse(readFileSync(path.join(repoRoot, rel), "utf8"));
      assert.ok(content.hooks?.UserPromptSubmit?.length >= 1, `${rel} missing UserPromptSubmit`);
      assert.ok(content.hooks?.Stop?.length >= 1, `${rel} missing Stop`);
    }
    const codexTemplate = JSON.parse(readFileSync(path.join(repoRoot, "examples/hooks/codex.hooks.json"), "utf8"));
    assert.equal("async" in codexTemplate.hooks.Stop[0].hooks[0], false);
  });

  it("runs compiled dist CLI end-to-end with real detached background capture against a loopback HTTP server", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
    const cli = path.join(repoRoot, "dist", "src", "client", "memory-hook-cli.js");
    assert.equal(existsSync(cli), true, "compiled dist/src/client/memory-hook-cli.js must exist");

    const runCli = (args, input) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => { stdout += d; });
      child.stderr.on("data", (d) => { stderr += d; });
      child.on("error", reject);
      child.on("close", (code) => resolve({ status: code, stdout, stderr }));
      if (input !== undefined) child.stdin.write(input);
      child.stdin.end();
    });

    const dir = makeTempDir("hook-dist-e2e-");
    const stateDir = path.join(dir, "state");
    const envFile = path.join(dir, "hook.env");
    const transcript = path.join(dir, "session.jsonl");
    const received = [];

    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      received.push({ url: req.url, auth: req.headers.authorization, body });
      if (req.url === "/v1/recall") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          count: 1,
          memories: [{ id: "m1", text: "Deploy via Coolify.", score: 0.9, scope: "global", metadata: { memory_category: "fact" } }],
        }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ created: 1, merged: 0 }));
    });

    try {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = server.address().port;
      writeFileSync(
        envFile,
        `MEMORY_SERVER_URL=http://127.0.0.1:${port}\nMEMORY_SERVER_TOKEN=real-e2e-token\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      writeFileSync(
        transcript,
        `${JSON.stringify({ type: "user", message: { role: "user", content: "We switched CI to Node 22." } })}\n`,
        "utf8",
      );

      const r1 = await runCli(
        [cli, "handle", "--host", "workbuddy", "--env-file", envFile, "--state-dir", stateDir],
        JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "wb-e2e", prompt: "How do we deploy our memory server?" }),
      );
      assert.equal(r1.status, 0);
      const out1 = JSON.parse(r1.stdout);
      assert.equal(out1.hookSpecificOutput.hookEventName, "UserPromptSubmit");
      assert.match(out1.hookSpecificOutput.additionalContext, /Deploy via Coolify/);

      const r2 = await runCli(
        [cli, "handle", "--host", "workbuddy", "--env-file", envFile, "--state-dir", stateDir],
        JSON.stringify({ hook_event_name: "Stop", session_id: "wb-e2e", transcript_path: transcript }),
      );
      assert.equal(r2.status, 0);

      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && !received.some((r) => r.url === "/v1/capture")) {
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      const cap = received.find((r) => r.url === "/v1/capture");
      assert.ok(cap, "detached worker should post incremental delta to /v1/capture");
      assert.equal(cap.auth, "Bearer real-e2e-token");
      assert.equal(cap.body.agentId, "workbuddy");
      assert.match(cap.body.conversationText, /Node 22/);

      const cleanupDeadline = Date.now() + 2_000;
      while (Date.now() < cleanupDeadline && readdirSync(stateDir).some((f) => f.startsWith("task-"))) {
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      assert.deepEqual(readdirSync(stateDir).filter((f) => f.startsWith("task-")), []);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
