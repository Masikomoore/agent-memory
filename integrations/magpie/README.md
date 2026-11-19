# Agent Memory — Magpie Gateway Hook Plugin

An asynchronous [Magpie](https://github.com/yetone/magpie) gateway hook plugin (`magpie.hooks`) that connects every agent routed through Magpie's local LLM gateway to your **Agent Memory Server**.

- **Automatic pre-request recall (`onRequest`)**: calls `/v1/recall` before routing across all 4 gateway protocols (`chat`, `responses`, `anthropic`, `gemini`), appends bounded `<relevant-memories>` to the latest user turn (preserving system/prefix prompt caching), and fails open without ever altering `model`, `stream`, `tools`, or `tool_choice`.
- **Fire-and-forget capture (`onResponse`)**: after streaming finishes (never delaying client EOF), extracts the clean user + assistant turn and posts it to `/v1/capture`.
- **Dual-layer safe**: automatically skips recall when `<relevant-memories>` is already present in the request (e.g. injected by a client-side `agent-memory-hook`), and supports `skipAgents` / `skipCaptureAgents` for fine-grained control.
- **Origin safe**: follows Magpie's security contract by skipping non-local / unknown `ctx.origin` traffic unless `allowNonLocal: true` is explicitly opted in.

## Install

```bash
# Option A: install from the local checkout folder
magpie plugin add ./integrations/magpie

# Option B: install the standalone single-file hook directly
magpie plugin add ./integrations/magpie/agent-memory.hooks.mjs
```

## Credentials & Options

By default, the plugin automatically reads `MEMORY_SERVER_URL` and `MEMORY_SERVER_TOKEN` from `~/.config/agent-memory/hook.env` (`chmod 600`) or environment variables — so you do not need to duplicate secrets into Magpie's config.

Set `gatewayTimeoutMs` (recommended `5000`–`8000` so `onResponse` capture has headroom while `onRequest` stays capped by `recallTimeoutMs: 2500`):

```bash
magpie plugin options agent-memory-magpie-hooks '{
  "gatewayTimeoutMs": 8000,
  "recallTimeoutMs": 2500,
  "skipCaptureAgents": ["claude-code", "codex", "antigravity-cli", "hermes"]
}'
```

### Supported options

| Option | Default | Description |
| --- | --- | --- |
| `gatewayTimeoutMs` | `1000` (Magpie default; recommend `5000`–`8000`) | Magpie host timeout budget (`100`–`10000` ms) applied to `onRequest` and `onResponse` |
| `serverUrl` | `MEMORY_SERVER_URL` / `http://127.0.0.1:7337` | Agent Memory Server base URL |
| `token` | `MEMORY_SERVER_TOKEN` (env or `hook.env`) | Optional Bearer token override |
| `envFile` | `~/.config/agent-memory/hook.env` | Path to dotenv credentials file |
| `scope` | server default (`global`) | Optional target memory scope |
| `recallEnabled` | `true` | Toggle `onRequest` recall |
| `captureEnabled` | `true` | Toggle `onResponse` capture |
| `recallTimeoutMs` | `2500` | Inner timeout for `onRequest` `/v1/recall` (capped at 8000 ms) |
| `maxItems` / `maxChars` | `3` / `600` | Bounded memory injection budget |
| `minRepeatedTurns` | `8` | Turns before the same memory ID can be re-injected in a session |
| `skipAgents` | `[]` | Agent names to skip completely (recall + capture) |
| `onlyAgents` | `[]` | If non-empty, only run for these agent names |
| `skipCaptureAgents` | `[]` | Agent names to skip `onResponse` capture (e.g. hosts already running client-side `Stop` hooks) |
| `captureWhenClientRecalled` | `false` | Set `true` to still capture via Magpie even when `<relevant-memories>` was already injected client-side |
| `allowNonLocal` | `false` | Allow requests where `ctx.origin !== "local"` (off by default per Magpie privacy rules) |
