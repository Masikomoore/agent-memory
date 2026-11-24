# Changelog

All notable public Agent Memory changes will be recorded here.

## Unreleased

### Async Capture Queue & Magpie Capture Timeout Hardening

- **Server-side asynchronous capture queue (`POST /v1/capture` + MCP `memory_capture`)**:
  - Added `CaptureJobQueue` (`src/server/capture-queue.ts`) with synchronous input/scope validation, SHA-256 content & `idempotencyKey` deduplication (`MEMORY_CAPTURE_DEDUP_WINDOW_MS`, default `300000` ms), bounded queue backpressure (`HTTP 429` + `Retry-After`, `MEMORY_CAPTURE_MAX_QUEUE=128`), configurable execution concurrency (`MEMORY_CAPTURE_CONCURRENCY=1` default to serialize SmartExtractor LLM/embedding work), disk spool crash recovery (`MEMORY_CAPTURE_SPOOL=true`), and graceful shutdown drain (`MEMORY_CAPTURE_SHUTDOWN_TIMEOUT_MS=30000`).
  - `POST /v1/capture` and MCP `memory_capture` now queue asynchronously by default, returning `202 Accepted` + `Location: /v1/capture/:jobId` (and `GET /v1/capture/:jobId` polling) so slow LLM extraction + 2560-dim embedding + dedup-merge cycles never hit client ~55s–60s tool timeouts or trigger duplicate retry merges; `"wait": true` / `?wait=true` / `MEMORY_CAPTURE_ASYNC=false` remain supported for synchronous `200 OK` callers.
  - Updated `MemoryHttpClient` (`captureStatus`), `agent-memory-hook` worker (`mode: "async"` + `idempotencyKey`, plus `--wait` flag), Docker Compose, `.env.example`, and `docs/MEMORY_SERVER.md`.
- **Magpie plugin capture hardening (`magpie-agent-memory` v0.3.0)**:
  - Raised `recallTimeoutMs` upper bound to `25000` ms and decoupled `capture` MCP tool HTTP requests onto an independent `captureTimeoutMs` (`150000` ms / 150s default) so Magpie's 55s host tool timeout cannot abort an in-flight server write.
  - Added `captureSoftWaitMs` (`45000` ms default) clean background handoff (`pending_server_processing`, `doNotRetry: true`) when connected to slower synchronous servers, plus SHA-256 client-side deduplication (`captureDedupWindowMs`, default `180000` ms) and `onResponse` abort-deduplication to suppress redundant immediate retries.
- Verified with `npm run build`, `node --test test/memory-server-http.test.mjs test/mcp-shared-memory-clients.test.mjs test/openclaw-remote-mode.test.mjs test/memory-hook-cli.test.mjs test/agent-hooks-lifecycle.test.mjs test/magpie-gateway-plugin.test.mjs test/memory-core-assembly.test.mjs`, `npm run verify-package-runtime`, `node scripts/verify-ci-test-manifest.mjs`, `git diff --check`, and standalone `magpie-agent-memory` `npm test` + `npm pack --dry-run`.

### Magpie Gateway Hook + MCP Tools Plugin (`magpie-agent-memory`)

- Added a standalone, publishable, zero-dependency [Magpie](https://github.com/yetone/magpie) plugin `magpie-agent-memory` (v0.2.0) under [`integrations/magpie`](integrations/magpie/README.md) combining asynchronous gateway hooks (`magpie.hooks`) with built-in Plugin MCP Tools (`main: "./index.mjs"` exposing `magpie-agent-memory_recall`, `magpie-agent-memory_capture`, and `magpie-agent-memory_health` via `/mcp/magpie/tools`), complete with embedded SVG `magpie.icon`, pre-populated GUI `magpie.options` template, standalone `LICENSE`, marketplace-grade `README.md`, `registry-entry.json` (`"name": "agent-memory"`), and `PUBLISHING.md`.
- Supports `onRequest` bounded pre-request recall across all 4 Magpie gateway protocols (`chat`, `responses`, `anthropic`, `gemini`) by appending `<relevant-memories>` to the latest user turn (preserving system/prefix prompt caching and never mutating `model`, `stream`, `tools`, or `tool_choice`), plus fire-and-forget `onResponse` capture with content-hash deduplication and thinking/tool-block stripping.
- Enforces Magpie's `ctx.origin === "local"` privacy default (`allowNonLocal: false`), automatically skips tool-continuation rounds and requests already carrying `<relevant-memories>` from client-side hooks, maps Magpie agent IDs (`claude`, `agy`, etc.) cleanly to canonical Agent Memory `agentId`s, and reuses `~/.config/agent-memory/hook.env` (`chmod 600`) without duplicating secrets.
- Verified with `test/magpie-gateway-plugin.test.mjs`, `npm pack --dry-run`, `scripts/verify-ci-test-manifest.mjs`, and real local `magpie plugin add github:Masikomoore/magpie-agent-memory` + `/mcp/magpie/tools` MCP tool verification.

### Session & Turn Hooks for Claude Code, Codex CLI, WorkBuddy, Grok Build, Antigravity CLI, Cursor, and Hermes Agent

- Upgraded `agent-memory-hook` with native Session/Turn Hook lifecycle handling (`handle`, `install`, `doctor`, and detached async background capture) for **Claude Code** (`~/.claude/settings.json`), **Codex CLI** (`~/.codex/hooks.json`), **WorkBuddy** (`~/.workbuddy/settings.json`), **Grok Build** (`~/.grok/hooks/agent-memory.json`), **Antigravity CLI** (`~/.gemini/config/hooks.json`, alias `agy`), **Cursor** (`~/.cursor/hooks.json`), and **Hermes Agent** (`~/.hermes/config.yaml`), designed to coexist with Streamable HTTP MCP.
- Added host-native hook protocol support across all 7 clients:
  - **Grok Build**: non-destructive drop-in `~/.grok/hooks/agent-memory.json` (never mutates `config.toml`), matcherless Claude-compatible handlers.
  - **Antigravity CLI**: named `"agent-memory"` entry in `~/.gemini/config/hooks.json` preserving sibling hooks, `PreInvocation` `injectSteps.systemMessage.systemMessage` output with same-turn tool-loop repeat suppression (handling 0-based/1-based and protojson string `invocationNum`), `USER_INPUT`/`PLANNER_RESPONSE` transcript parsing, and guaranteed JSON stdout (`{}` / `{"decision":""}`).
  - **Cursor**: `version: 1` flat `hooks.json` arrays, project-context `sessionStart` recall via `additional_context`, always-allowing `{"continue":true}` on `beforeSubmitPrompt`, and `stop` / `afterAgentResponse` / `preCompact` / `sessionEnd` capture.
  - **Hermes Agent**: surgical comment-preserving YAML `hooks:` merge in `~/.hermes/config.yaml` (`pre_llm_call` -> `{"context": "..."}`, `post_llm_call` direct `extra.user_message + extra.assistant_response` capture, `on_session_finalize` cleanup) plus read-only `~/.hermes/shell-hooks-allowlist.json` status reporting in `doctor`.
- Added multi-schema JSONL transcript parsing (Claude Code / WorkBuddy / Grok / Cursor JSONL, Codex rollout JSONL, Antigravity `USER_INPUT`/`PLANNER_RESPONSE` JSONL, plus cached-prompt / Hermes `extra` fallback), per-session incremental watermarks, first-run history capping, repeat-recall suppression, fail-open timeouts, and loop filtering for `<relevant-memories>` and tool outputs.
- Added `~/.config/agent-memory/hook.env` loading (with process-env precedence and `chmod 600` permission warnings) so GUI hosts can authenticate without inheriting shell exports, while never persisting tokens into hook configs or worker task files.
- Added ready-to-use hook templates under `examples/hooks/` and updated `docs/AGENT_CLIENTS.md`.
- Rewrote `README.md`, `README_CN.md`, and `examples/mcp-clients/agent-install-prompt.md` to highlight dual-track MCP + Session/Turn Hooks integration, core engine hardening (`search_text` full-layer BM25, duplicate-ID safety, log redaction, transient retry), and seamless one-sentence Agent-assisted / manual install-and-update flows with explicit client hook inspection, non-destructive installation, and `doctor` verification.
- Verified with `npm run verify-package-runtime`, `node scripts/verify-ci-test-manifest.mjs`, `npm run test:core-regression`, `test/mcp-shared-memory-clients.test.mjs`, real Hermes Python `shell_hooks._parse_hooks_block` compatibility check, and real compiled-binary detached-worker E2E coverage in `test/agent-hooks-lifecycle.test.mjs`.

### Core memory engine hardening

- Indexed BM25 full-text search on a derived `search_text` column covering `text` plus `l0_abstract`, `l1_overview`, and `l2_content`, with automatic schema migration, backfill, and the `backfill-search-text` maintenance command.
- Hardened duplicate-ID handling in `MemoryStore.applyManualRecallMetadataBatch` and `backfillSearchText` so sibling physical rows keep their distinct vectors and metadata intact.
- Redacted raw LLM response text and quoted `JSON.parse` snippets from `completeJson()` failure diagnostics across all transports, and added `LlmClient.completeText()`.
- Enforced per-scope isolation in `memory-compactor.ts` so similarity clusters never merge entries across scopes.
- Added single transient retry and `ExtractionStats.llmUnavailable` distinction in `SmartExtractor` so temporary upstream LLM outages defer instead of failing closed.

### Universal agent client integration

- Made native Streamable HTTP MCP the primary shared-memory path for Claude Code, Codex CLI, Cursor, Gemini CLI, Grok Build, VS Code agents, and other capable clients, with common server-side usage instructions.
- Added Grok Build as a first-class Streamable HTTP MCP client with a native `config.toml` template, setup/diagnostic guidance, stable `agentId`, and regression coverage.
- Added WorkBuddy integration guidance covering Streamable HTTP MCP and `~/.workbuddy/settings.json` Session/Turn Hooks with the stable `workbuddy` identity.
- Added a copy/paste agent-assisted setup prompt so users can ask their existing coding agent to inspect the machine, deploy or connect Agent Memory, configure installed clients, preserve existing settings, keep credentials private, and verify real cross-client memory behavior.
- Recorded stronger real-environment interoperability evidence: Codex capture was recalled independently by Claude Code and Grok through the same central Memory Server; Gemini's authenticated MCP initialize/tool/recall path was also verified separately from its model-provider login.
- Documented that Gemini workspace trust/provider authentication are host-level gates separate from Agent Memory authentication, and that Grok's optional local memory is not the shared Agent Memory backend.
- Kept OpenClaw as a thin remote lifecycle adapter and moved its canonical remote auto-recall/auto-capture controls under `memory.remote.*`, while retaining compatibility with the existing top-level settings.
- Added the `agent-memory-hook` executable as a thin REST lifecycle bridge for hosts that can run hooks/scripts but cannot automatically inject MCP memory calls.
- Marked recalled memory as untrusted historical data in the shared MCP instructions and hook output so stored text is not treated as executable instruction authority.
- Documented the client integration hierarchy and the VS Code Agent Host limitation around interactive `${input:...}` MCP credentials.
- Verified the changes with TypeScript build, OpenClaw remote-mode tests, shared MCP/REST transport tests, hook CLI tests, and plugin-manifest regression coverage.

### Community launch polish

- Added the founder story explaining how loss of Codex account history motivated a vendor-independent shared memory layer for people who use multiple AI agents.
- Strengthened the README around the core cross-agent value proposition, 30-second project summary, contributor entry points, and community ownership.
- Expanded the public roadmap with help-wanted areas and a clear path for contributors to influence priorities.
- Expanded the contributing guide with role-based contribution paths, a suggested PR workflow, and non-code maintenance roles.
- Added a dedicated real-client verification issue template and routed setup/design questions to GitHub Discussions.
- Removed Docker/Coolify model-name defaults and decoupled the default Compose deployment from bundled Ollama: provider URLs, credentials, embedding dimensions, and SmartExtractor model are now operator-supplied, with local Ollama available as an optional overlay.
- Fixed the public CI core-regression job to build `dist/` before running tests that import the compiled runtime.

## 0.1.0 - Initial public release

### Shared memory server

- Added a host-independent Memory Core for storage, retrieval, extraction, decay, tiering, and scopes.
- Added the standalone Agent Memory Server with REST and Streamable HTTP MCP endpoints.
- Added Bearer authentication plus Host/Origin validation for non-loopback deployment.
- Added shared global-memory defaults with explicit agent/project scope support.

### Agent integrations

- Added MCP client templates for Claude Code, Codex CLI, Cursor, Gemini CLI, and VS Code.
- Added OpenClaw remote-memory mode so OpenClaw can use the central server instead of opening a separate local database.
- Verified a real cross-agent path: Claude Code capture → Codex CLI recall from the same server.

### Deployment

- Added a production Dockerfile.
- Added self-contained Docker Compose deployment with LanceDB persistence and local Ollama models.
- Made model bootstrap deterministic across Docker Compose/Coolify by running embedding and extraction-model pulls as separate direct Ollama jobs instead of shell-composed commands.
- Fixed the single-embedding operation guard so an explicitly configured provider timeout (for example 60s on CPU-only Ollama) is not cut off by the historical 10s outer timeout.
- Added Coolify deployment guidance.

### Project launch

- Reorganized the project around a vendor-neutral shared-memory server rather than a single-agent plugin.
- Added independent project documentation, roadmap, contributing guide, security policy, and provenance notice.
