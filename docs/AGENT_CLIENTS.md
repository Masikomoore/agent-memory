# Agent Client Integration

The standalone Memory Server is the shared memory authority. Claude Code, Codex CLI, WorkBuddy, Cursor, Gemini CLI, Grok Build, VS Code agents, and other Streamable HTTP MCP clients should connect to the same `/mcp` endpoint. OpenClaw keeps a thin native adapter so its lifecycle hooks can perform automatic recall/capture. Hosts with Session/Turn Hooks can pair MCP with `agent-memory-hook` for automatic recall and capture.

All extraction, admission, deduplication, merge/supersede, lifecycle decay, tiering, embedding, and LanceDB access remain on the Memory Server. Clients only transport context and recall queries.

## Prerequisites

Start the server first. For a local-only deployment:

```bash
export MEMORY_SERVER_TOKEN="replace-with-a-long-random-secret"
export MEMORY_EMBEDDING_API_KEY="..."
export MEMORY_LLM_API_KEY="..."
npm run build
npm run memory-server
```

The MCP endpoint is then:

```text
http://127.0.0.1:7337/mcp
```

For LAN/WAN use, follow the binding, Host/Origin allowlist, TLS/private-network, and Bearer-token guidance in [`MEMORY_SERVER.md`](./MEMORY_SERVER.md). Do not expose an unauthenticated Memory Server to a shared network.

The examples below use the logical MCP server name `agent-memory`. Configuration templates live in [`examples/mcp-clients`](../examples/mcp-clients).

## Let your AI agent do the setup

If you are already inside a capable coding agent, you do not need to translate every client recipe by hand. Copy the ready-made [`agent-install-prompt.md`](../examples/mcp-clients/agent-install-prompt.md) into your agent and let it inspect the machine, preserve existing configuration, deploy or connect the Memory Server, configure the clients it finds, add the shared-memory behavior rules, and verify the real capture/recall path.

The setup prompt deliberately tells the agent to keep credentials out of chat history and repositories, preserve unrelated settings, and finish with functional MCP and cross-client verification instead of stopping after editing config files.

## Shared agent behavior

MCP configuration only makes the tools available; it does not guarantee that every agent will call them at the right time. Give each client persistent instructions based on [`examples/mcp-clients/agent-memory-instructions.md`](../examples/mcp-clients/agent-memory-instructions.md).

Use a stable logical `agentId` per client, for example:

| Client | Recommended `agentId` |
| --- | --- |
| Claude Code | `claude-code` |
| Codex CLI | `codex` |
| Cursor | `cursor` |
| Antigravity CLI | `antigravity-cli` |
| Gemini CLI | `gemini-cli` |
| Grok Build | `grok` |
| Hermes Agent | `hermes` |
| WorkBuddy | `workbuddy` |
| VS Code agent | `vscode` |

The server remains authoritative for scope ACLs. Leaving `scope` unset uses the normal shared/default scope policy.

The MCP server also publishes common behavioral `instructions` during initialization. Keep host-specific instruction files short: they should establish a stable `agentId` and reinforce when recall/capture is useful, while the server remains the shared contract.

## Claude Code

Claude Code supports remote HTTP MCP servers and header authentication. Project-scoped configuration can live in `.mcp.json`.

Use [`claude-code.mcp.json`](../examples/mcp-clients/claude-code.mcp.json), or add the server from the CLI:

```bash
export MEMORY_SERVER_TOKEN="..."
claude mcp add --scope user --transport http agent-memory http://127.0.0.1:7337/mcp \
  --header "Authorization: Bearer ${MEMORY_SERVER_TOKEN}"
claude mcp get agent-memory
```

For a checked-in project `.mcp.json`, Claude Code supports environment expansion in HTTP `url` and `headers`; the example therefore avoids committing the token.

Put the shared-memory behavior rules into the project's existing Claude instructions so that recall/capture calls consistently use `agentId: "claude-code"`.

## Codex CLI

Codex supports Streamable HTTP MCP servers in `~/.codex/config.toml` and can source the Bearer token from an environment variable.

Use [`codex-config.toml`](../examples/mcp-clients/codex-config.toml), or run:

```bash
export MEMORY_SERVER_TOKEN="..."
codex mcp add agent-memory \
  --url http://127.0.0.1:7337/mcp \
  --bearer-token-env-var MEMORY_SERVER_TOKEN
codex mcp get agent-memory
```

Add the shared-memory behavior rules to the relevant `AGENTS.md`, with `agentId: "codex"`.

## Cursor

Cursor supports remote MCP servers through project `.cursor/mcp.json` or global `~/.cursor/mcp.json`. Remote server fields support environment interpolation.

Set:

```bash
export MEMORY_SERVER_URL="http://127.0.0.1:7337"
export MEMORY_SERVER_TOKEN="..."
```

Then use [`cursor-mcp.json`](../examples/mcp-clients/cursor-mcp.json). Keep the shared-memory behavior rules in an Always Apply Cursor rule or `AGENTS.md`, using `agentId: "cursor"`.

## Gemini CLI

Gemini CLI reads MCP servers from `settings.json`. It uses `httpUrl` for HTTP streaming and supports custom headers with environment expansion.

Use [`gemini-settings.json`](../examples/mcp-clients/gemini-settings.json) in `~/.gemini/settings.json` or project `.gemini/settings.json`, then run:

```text
/mcp list
```

Put the shared-memory behavior rules into `GEMINI.md`, using `agentId: "gemini-cli"`.

Gemini's own model-provider authentication and workspace trust are separate from Agent Memory authentication. A correctly configured `agent-memory` server can still be suppressed in an untrusted folder, and a headless Gemini invocation still needs Gemini/Google provider authentication before the agent can decide to call MCP tools. Keep those host security controls enabled and trust real workspaces normally rather than disabling them globally.

## Grok Build

Grok Build supports Streamable HTTP MCP servers in `~/.grok/config.toml` for user scope and `.grok/config.toml` for project scope. HTTP servers support custom headers.

Use [`grok-config.toml`](../examples/mcp-clients/grok-config.toml) as the native configuration shape, or add the server from the CLI:

```bash
export MEMORY_SERVER_TOKEN="..."
grok mcp add --scope user --transport http agent-memory http://127.0.0.1:7337/mcp \
  --header "Authorization: Bearer ${MEMORY_SERVER_TOKEN}"
grok mcp doctor agent-memory
```

The CLI command above expands the shell variable before writing the user configuration, so `~/.grok/config.toml` becomes secret-bearing. Keep that file private and never commit a real token. For a project-scoped `.grok/config.toml`, use a safe team credential strategy instead of checking an Authorization token into source control.

Put the shared-memory behavior rules into `AGENTS.md`, using `agentId: "grok"`.

Grok also has its own optional local cross-session memory feature. That storage is separate from Agent Memory. If your goal is one memory plane shared with Claude, Codex, and other clients, treat Agent Memory Server as the authoritative durable memory rather than assuming Grok's local memory will synchronize across tools.

## WorkBuddy

WorkBuddy connects to the same Streamable HTTP `/mcp` endpoint with Bearer authentication and `agentId: "workbuddy"`, and supports Session/Turn Hooks via `~/.workbuddy/settings.json` (or `.workbuddy/settings.local.json` per project).

Configure MCP with `http://127.0.0.1:7337/mcp` (or your private Memory Server URL) and add the shared-memory behavior rules from [`agent-memory-instructions.md`](../examples/mcp-clients/agent-memory-instructions.md) using `agentId: "workbuddy"`. To enable automatic pre-turn recall and background incremental capture alongside MCP, see [Session & Turn Hooks (`agent-memory-hook`)](#session--turn-hooks-agent-memory-hook) below.

## VS Code agents

VS Code supports Streamable HTTP MCP servers. Workspace configuration can live in `.vscode/mcp.json`. The included template uses a password-style `${input:...}` variable, which is appropriate for normal VS Code/extension-host sessions because VS Code stores the prompted value securely.

Use [`vscode-mcp.json`](../examples/mcp-clients/vscode-mcp.json). In VS Code, run `MCP: List Servers` to confirm that `agentMemory` is connected.

For sessions running on the newer VS Code Agent Host, interactive `${input:...}` MCP entries are not forwarded. Put a non-interactive configuration in workspace `.mcp.json` or user `~/.copilot/mcp-config.json` instead and keep the token outside source control. The exact credential source should follow the Agent Host version you run; do not copy the interactive-input template into a portable Agent Host config and assume it will be forwarded.

Give the agent the same persistent memory rules and use `agentId: "vscode"`.

## OpenClaw native lifecycle adapter

OpenClaw should use the plugin's `memory.mode: "remote"`. In this mode the plugin does not initialize a local embedder or LanceDB database. Manual memory tools and lifecycle hooks call the central Memory Server over REST.

The canonical remote configuration is under `memory.remote`:

```json
{
  "memory": {
    "mode": "remote",
    "remote": {
      "url": "http://127.0.0.1:7337",
      "token": { "source": "env", "id": "MEMORY_SERVER_TOKEN" },
      "agentId": "openclaw",
      "autoRecall": true,
      "autoCapture": true,
      "captureAssistant": false,
      "autoRecallMaxItems": 3,
      "autoRecallMaxChars": 600,
      "maxCaptureChars": 8000
    }
  }
}
```

Existing top-level `autoRecall`, `autoCapture`, `captureAssistant`, `autoRecallMinLength`, `autoRecallMinRepeated`, `autoRecallMaxItems`, `autoRecallMaxChars`, `autoRecallPerItemMaxChars`, `autoRecallMaxQueryLength`, and `extractMaxChars` settings remain compatibility fallbacks for remote mode. When the corresponding `memory.remote.*` value is present, it takes precedence.

Remote `autoRecall` uses OpenClaw's pre-prompt lifecycle to inject bounded, untrusted historical notes. Remote `autoCapture` submits the completed conversation to `/v1/capture`; the central server then decides whether anything deserves long-term storage.

## Session & Turn Hooks (`agent-memory-hook`)

For hosts that support native lifecycle hooks — **Claude Code**, **Codex CLI**, **WorkBuddy**, **Grok Build**, **Antigravity CLI**, **Cursor**, and **Hermes Agent** — `agent-memory-hook` pairs cleanly with Streamable HTTP MCP in a **dual-track setup**:

- **Hooks (automatic background lifecycle)**: pre-turn recall runs a fast, bounded `auto-recall` (fail-open, repeat-suppressed, short-prompt skipped) and injects `<relevant-memories>` using each host's native stdout contract; turn-end / pre-compact / session-end events spawn a detached background worker that parses only newly added turns (filtering out `tool_use` / `tool_result` / `<relevant-memories>` blocks to avoid feedback loops) and posts them to `/v1/capture` using the server's shared default scope.
- **MCP (on-demand explicit control)**: keeps `memory_recall` / `memory_capture` / `memory_health` available when the agent needs deeper search or explicit storage.

### Host hook matrix

| Host (`--host` / `install`) | User config path | Project config path | Installed events | Stdout / protocol notes |
| --- | --- | --- | --- | --- |
| `claude-code` | `~/.claude/settings.json` | `.claude/settings.local.json` | `UserPromptSubmit`, async `Stop`, `PreCompact`, `SessionEnd` | `hookSpecificOutput.additionalContext` |
| `codex` | `~/.codex/hooks.json` | `.codex/hooks.json` | `UserPromptSubmit`, `Stop` | Strict Codex schema (no `async` key); `hookSpecificOutput.additionalContext` |
| `workbuddy` | `~/.workbuddy/settings.json` | `.workbuddy/settings.local.json` | `UserPromptSubmit`, `Stop`, `PreCompact`, `SessionEnd` | `hookSpecificOutput.additionalContext` |
| `grok` (`grok-build`) | `~/.grok/hooks/agent-memory.json` | `.grok/hooks/agent-memory.json` | `UserPromptSubmit`, `Stop`, `PreCompact`, `SessionEnd` | Drop-in JSON (never touches `config.toml`); note Grok also scans `~/.claude/settings.json` unless `[compat.claude] hooks = false` |
| `antigravity-cli` (`agy`) | `~/.gemini/config/hooks.json` | `.agents/hooks.json` | `SessionStart`, `PreInvocation`, `Stop` | Named `"agent-memory"` entry preserving sibling hooks; emits `injectSteps.systemMessage.systemMessage` (`invocationNum > 1` skipped) & `{"decision":""}` on `Stop`; parses `USER_INPUT`/`PLANNER_RESPONSE` transcripts |
| `cursor` | `~/.cursor/hooks.json` | `.cursor/hooks.json` | `sessionStart`, `beforeSubmitPrompt`, `stop`, `preCompact`, `sessionEnd` | `version: 1` flat arrays; injects project context on `sessionStart` via `additional_context` and always emits `{"continue":true}` on `beforeSubmitPrompt` |
| `hermes` (`hermes-agent`) | `~/.hermes/config.yaml` | `.hermes/config.yaml` | `pre_llm_call`, `post_llm_call`, `on_session_finalize` | Surgical comment-preserving YAML `hooks:` merge; emits `{"context":"..."}` on `pre_llm_call` and captures `extra.user_message` + `extra.assistant_response` on `post_llm_call`. Approve once via TTY prompt or `hermes --accept-hooks` (checked by `doctor`) |

### 1. Configure credentials once

Interactive shells can export `MEMORY_SERVER_URL` and `MEMORY_SERVER_TOKEN`. For GUI hosts that do not inherit shell rc exports, store them in `~/.config/agent-memory/hook.env` (see [`examples/hooks/hook.env.example`](../examples/hooks/hook.env.example)):

```bash
mkdir -p ~/.config/agent-memory
cat > ~/.config/agent-memory/hook.env <<'EOF'
MEMORY_SERVER_URL=http://127.0.0.1:7337
MEMORY_SERVER_TOKEN=replace-with-your-memory-server-token
EOF
chmod 600 ~/.config/agent-memory/hook.env
```

Process environment variables always override `hook.env`. Tokens are never written into hook config files or background worker task files.

### 2. Install hooks for any supported host

`install` previews the non-destructive merge by default (`--dry-run`) and writes atomically when `--apply` is passed:

```bash
# Preview changes (default dry-run)
agent-memory-hook install claude-code
agent-memory-hook install codex
agent-memory-hook install workbuddy
agent-memory-hook install grok
agent-memory-hook install antigravity-cli   # alias: agy
agent-memory-hook install cursor
agent-memory-hook install hermes

# Apply to user-level configs (non-destructive, idempotent)
agent-memory-hook install claude-code --apply
agent-memory-hook install codex --apply
agent-memory-hook install workbuddy --apply
agent-memory-hook install grok --apply
agent-memory-hook install antigravity-cli --apply
agent-memory-hook install cursor --apply
agent-memory-hook install hermes --apply

# Verify server reachability, env loading, state dir, and installed hooks
agent-memory-hook doctor
```

Use `--project` to write into the current workspace (`.claude/settings.local.json`, `.codex/hooks.json`, `.workbuddy/settings.local.json`, `.grok/hooks/agent-memory.json`, `.agents/hooks.json`, `.cursor/hooks.json`, `.hermes/config.yaml`), or `--uninstall --apply` to cleanly remove only Agent Memory entries while preserving all other host settings and hooks. Reference templates live under [`examples/hooks`](../examples/hooks).

### 3. Generic plain-text REST bridge

When integrating another host that only pipes plain text into scripts, the low-level subcommands remain available:

```bash
printf '%s' "$CURRENT_PROMPT" | agent-memory-hook recall --limit 3
printf '%s' "$CONVERSATION_TRANSCRIPT" | \
  agent-memory-hook capture --session-key "$SESSION_KEY"
agent-memory-hook health
```

## Cross-agent verification

After two clients are connected, verify actual shared memory rather than only tool discovery. Real-environment acceptance has verified both Claude Code → Codex recall and Codex capture → Claude Code + Grok recall through the same central server.

1. In client A, establish a harmless durable fact, for example: `Remember that the cross-agent verification phrase is sapphire-742.`
2. Confirm that client A calls `memory_capture` with its own stable `agentId`.
3. Start a separate session in client B and ask: `What is the cross-agent verification phrase? Check shared memory.`
4. Confirm that client B calls `memory_recall` with its own stable `agentId` and returns `sapphire-742`.
5. Remove or supersede the test memory later once `memory_forget` is implemented; until then, use a clearly labeled verification fact rather than sensitive data.

The repository also contains an automated transport-level regression test, `test/mcp-shared-memory-clients.test.mjs`, which opens two independent MCP client sessions against one Memory Server instance and verifies that a capture through one client is visible to recall through the other.

## Security notes

- Never commit `MEMORY_SERVER_TOKEN`.
- Prefer loopback for one-machine use and a private network/TLS boundary for LAN/WAN use.
- Do not place secrets, passwords, API keys, or authentication tokens in `memory_capture` input.
- The MCP client name is not used as a security identity. `agentId` is logical memory context; authorization is enforced by the Memory Server token and, as the ACL layer evolves, server-side scope policy.
