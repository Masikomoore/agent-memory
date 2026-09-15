# Agent Client Integration

The standalone Memory Server is the shared memory authority. Claude Code, Codex CLI, Cursor, Gemini CLI, VS Code agents, and other Streamable HTTP MCP clients should connect directly to the same `/mcp` endpoint. OpenClaw keeps a thin native adapter so its lifecycle hooks can perform automatic recall/capture. Hosts without a suitable native lifecycle integration can use the generic `agent-memory-hook` REST bridge.

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

## Shared agent behavior

MCP configuration only makes the tools available; it does not guarantee that every agent will call them at the right time. Give each client persistent instructions based on [`examples/mcp-clients/agent-memory-instructions.md`](../examples/mcp-clients/agent-memory-instructions.md).

Use a stable logical `agentId` per client, for example:

| Client | Recommended `agentId` |
| --- | --- |
| Claude Code | `claude-code` |
| Codex CLI | `codex` |
| Cursor | `cursor` |
| Gemini CLI | `gemini-cli` |
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

## Generic lifecycle-hook bridge

Use the `agent-memory-hook` executable when a host exposes lifecycle scripts/hooks but does not have a better native way to perform automatic memory calls. It is intentionally thin and reuses the same REST API as the OpenClaw remote adapter.

Configure the connection once in the hook environment:

```bash
export MEMORY_SERVER_URL="http://127.0.0.1:7337"
export MEMORY_SERVER_TOKEN="..."
export MEMORY_AGENT_ID="my-agent"
# Optional: export MEMORY_SCOPE="project:agentmemory"
```

For a pre-turn hook, send the user prompt on stdin. The default output is a bounded `<relevant-memories>` block suitable for context injection:

```bash
printf '%s' "$CURRENT_PROMPT" | agent-memory-hook recall --limit 3
```

For a post-turn or session-end hook, send the conversation transcript on stdin. The bridge does not extract or classify memory locally:

```bash
printf '%s' "$CONVERSATION_TRANSCRIPT" | \
  agent-memory-hook capture --session-key "$SESSION_KEY"
```

Operational checks can call:

```bash
agent-memory-hook health
agent-memory-hook recall --query "What did we decide about the memory architecture?" --json
```

Prefer native MCP for ordinary agent tool use and the host's native lifecycle integration where available. The bridge exists to avoid writing a separate memory SDK for every hook system. Hook systems that send structured JSON on stdin should extract the documented prompt/transcript field before piping text into this bridge, or wrap the bridge with a very small host-specific script.

## Cross-agent verification

After two clients are connected, verify actual shared memory rather than only tool discovery.

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
