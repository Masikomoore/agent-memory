# Agent Memory for Magpie (`magpie-agent-memory`)

**Shared long-term memory for every agent routed through [Magpie](https://github.com/yetone/magpie) — automatic pre-request recall and background capture powered by your self-hosted [Agent Memory Server](https://github.com/Masikomoore/agent-memory).**

Once enabled in Magpie, every local AI coding client passing through the gateway (Claude Code, Codex CLI, Grok Build, Cursor, Antigravity CLI, Hermes Agent, Gemini CLI, VS Code, etc.) shares one private long-term memory plane — even clients whose native hooks do not yet support pre-prompt context injection.

---

## How It Works

`magpie-agent-memory` is a zero-dependency Magpie plugin combining **asynchronous gateway hooks** (`magpie.hooks`) with **built-in Plugin MCP Tools** (`/mcp/magpie/tools`):

1. **Before routing (`onRequest` gateway hook)**:
   - Extracts the latest human prompt and calls `POST /v1/recall` on your Agent Memory Server within a bounded fail-open timeout (`recallTimeoutMs`, default `2500` ms).
   - Appends a bounded `<relevant-memories>` block (tagged as `[UNTRUSTED DATA]`) to the **latest user turn** across all 4 Magpie gateway protocols (**OpenAI Chat**, **OpenAI Responses**, **Anthropic Messages**, and **Google Gemini**) — keeping system/prefix prompt caching intact and never mutating `model`, `stream`, `tools`, or `tool_choice`.
   - Suppresses recently recalled memory IDs for `minRepeatedTurns` turns (default `8`), skips trivial greetings/slash commands, and skips mid-loop tool-result continuations.
2. **After streaming completes (`onResponse` gateway hook)**:
   - Runs fire-and-forget after client EOF (never adds latency to replies).
   - Extracts the clean user + assistant exchange (stripping `thinking`, `reasoning`, `tool_use`, `functionCall`, and `<relevant-memories>` blocks), deduplicates by SHA-256 content hash, and posts it to `POST /v1/capture`.
3. **On-demand MCP tools (`/mcp/magpie/tools`)**:
   - Exposes `magpie-agent-memory_recall`, `magpie-agent-memory_capture`, and `magpie-agent-memory_health` through Magpie's built-in Plugin Tools MCP server (`http://127.0.0.1:3425/mcp/magpie/tools`), letting any MCP-capable client explicitly search, store, or health-check shared memory without extra per-client setup.

---

## Prerequisites

You need a running **[Agent Memory Server](https://github.com/Masikomoore/agent-memory)** (local, LAN, Docker Compose, or Coolify) reachable from the machine running Magpie.

---

## Install

### From Magpie (GUI or CLI)

In Magpie desktop: **Settings → Plugins → Discover → Agent Memory → Install**.

Or from the CLI:

```bash
magpie plugin add magpie-agent-memory
```

For local development from an `agent-memory` checkout:

```bash
magpie plugin add ./integrations/magpie
```

---

## Credentials & Configuration

### Recommended: Reuse `~/.config/agent-memory/hook.env` (No Plaintext Tokens in Magpie Options)

By default, `magpie-agent-memory` automatically reads `MEMORY_SERVER_URL` and `MEMORY_SERVER_TOKEN` from `~/.config/agent-memory/hook.env` (`chmod 600`) or environment variables:

```bash
mkdir -p ~/.config/agent-memory
cat > ~/.config/agent-memory/hook.env <<'EOF'
MEMORY_SERVER_URL=http://127.0.0.1:7337
MEMORY_SERVER_TOKEN=replace-with-your-memory-server-token
EOF
chmod 600 ~/.config/agent-memory/hook.env
```

This keeps your Bearer token in one `0600` file shared with `agent-memory-hook` instead of storing it in Magpie's plugin options.

### Configure Plugin Options (GUI or CLI)

In Magpie desktop, open **Settings → Plugins → Installed → Agent Memory → Options** (pre-populated from `magpie.options`).

Or via CLI:

```bash
magpie plugin options magpie-agent-memory '{
  "gatewayTimeoutMs": 8000,
  "recallTimeoutMs": 2500,
  "skipCaptureAgents": ["claude-code", "codex", "grok", "antigravity-cli", "cursor", "hermes"]
}'
```

> **Tip on `gatewayTimeoutMs`**: Magpie's default hook timeout is `1000` ms for both `onRequest` and `onResponse`. Setting `gatewayTimeoutMs: 8000` gives background `/v1/capture` (which invokes SmartExtractor LLM) plenty of room, while `recallTimeoutMs: 2500` keeps interactive `onRequest` recall fast and fail-open.

### Options Reference

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `gatewayTimeoutMs` | integer (`100`–`10000`) | `8000` (recommended) | Magpie host timeout budget for `onRequest` and `onResponse` |
| `serverUrl` | string | `MEMORY_SERVER_URL` or `http://127.0.0.1:7337` | Agent Memory Server base URL |
| `token` | string | `MEMORY_SERVER_TOKEN` (env / `hook.env`) | Optional Bearer token override |
| `envFile` | string | `~/.config/agent-memory/hook.env` | Path to dotenv credentials file |
| `scope` | string | Server default (`global`) | Optional target memory scope |
| `agentId` | string | Auto-detected from `ctx.agent` | Optional fixed logical `agentId` override |
| `recallEnabled` | boolean | `true` | Enable `onRequest` automatic memory recall |
| `captureEnabled` | boolean | `true` | Enable `onResponse` fire-and-forget memory capture |
| `recallTimeoutMs` | integer (`1`–`8000`) | `2500` | Inner timeout for `/v1/recall` |
| `maxItems` | integer | `3` | Maximum memories injected per turn |
| `maxChars` | integer | `600` | Total character budget for injected memory summaries |
| `perItemMaxChars` | integer | `220` | Character cap per individual memory line |
| `minRepeatedTurns` | integer | `8` | Suppress re-injecting the same memory ID for N turns in a session |
| `minQueryLength` | integer | `6` (`4` for CJK) | Skip recall for shorter prompts |
| `skipAgents` | string[] | `[]` | Agents to skip completely (matches both Magpie short IDs like `claude`, `agy` and canonical IDs like `claude-code`, `antigravity-cli`) |
| `onlyAgents` | string[] | `[]` | If non-empty, only run for listed agents |
| `skipCaptureAgents` | string[] | `[]` | Agents to skip `onResponse` capture (useful when client-side `Stop` hooks already capture) |
| `captureWhenClientRecalled` | boolean | `false` | Still capture via Magpie even if `<relevant-memories>` was already injected client-side |
| `allowNonLocal` | boolean | `false` | Opt-in to allow non-local `ctx.origin` traffic (disabled by default for privacy) |

---

## Coexisting with Client-Side Hooks (`agent-memory-hook`)

If some clients on your machine already run `agent-memory-hook` (e.g. Claude Code, Codex CLI, Antigravity CLI, Hermes, Grok, Cursor):

- **No duplicate recall**: `onRequest` automatically inspects the incoming messages/system prompt for `<relevant-memories>`. If a client-side hook already injected memories, Magpie skips recall cleanly (`skipped`).
- **No duplicate capture**: add those clients to `skipCaptureAgents` so their native `Stop` hooks own capture while Magpie covers recall/capture for every other routed client.
- **Canonical `agentId` alignment**: Magpie short IDs (`claude`, `agy`) are automatically mapped to canonical Agent Memory IDs (`claude-code`, `antigravity-cli`) so memories stay consistent across MCP, client hooks, and Magpie.

---

## Privacy & Safety

- **Local-only by default**: follows Magpie's gateway-hook security contract — requests with `ctx.origin !== "local"` (remote LAN/WAN callers, named gateway keys, or unknown origins) are skipped unless `allowNonLocal: true` is explicitly configured.
- **Zero credential leakage**: Magpie never forwards client `Authorization` headers to gateway hooks, and this plugin never logs prompts, replies, or tokens.
- **Strictly fail-open**: timeouts, server downtime, or malformed payloads never block or alter your agent's request.

---

## Diagnostics & Troubleshooting

In Magpie's **Settings → Plugins** row for **Agent Memory**, check the gateway hook outcome code:

| Code | Meaning | Action |
| --- | --- | --- |
| `ready` | Relevant memories recalled and injected | Working normally |
| `empty` | Server responded, no new relevant memories above threshold/dedup window | Normal |
| `skipped` | Non-local origin, trivial prompt, tool-continuation turn, `skipAgents`, or `<relevant-memories>` already present | Normal |
| `unauthorized` | Server returned HTTP 401/403 | Verify `MEMORY_SERVER_TOKEN` in `~/.config/agent-memory/hook.env` or `options.token` |
| `unavailable` | Server unreachable, HTTP 5xx, or `recallTimeoutMs` exceeded | Check `curl <serverUrl>/health` or raise `recallTimeoutMs` / `gatewayTimeoutMs` |
| `unbound` | `serverUrl` is empty | Set `MEMORY_SERVER_URL` in `hook.env` or `options.serverUrl` |

---

## License

MIT — see [LICENSE](./LICENSE).
