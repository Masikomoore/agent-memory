# Standalone Memory Server

The standalone server runs the same LanceDB store, retriever, decay/tier lifecycle and SmartExtractor as the OpenClaw plugin, but without an OpenClaw host process. It exposes both REST and MCP Streamable HTTP from one Node.js process.

## Start locally

```bash
export MEMORY_EMBEDDING_API_KEY="..."
export MEMORY_EMBEDDING_MODEL="text-embedding-3-small"

# Smart extraction defaults to the embedding provider credentials/base URL.
# Override these when the extraction LLM is a different provider.
export MEMORY_LLM_API_KEY="..."
export MEMORY_LLM_BASE_URL="https://your-openai-compatible-provider/v1"
export MEMORY_LLM_MODEL="openai/gpt-oss-120b"

npm run build
npm run memory-server
```

Defaults:

- listen address: `127.0.0.1:7337`
- database: `./data/memory-server`
- MCP: `POST /mcp`
- REST recall: `POST /v1/recall`
- REST capture: `POST /v1/capture`
- health: `GET /health`
- caller identity: `main`
- capture write scope: `global` (shared by agents)

The MCP endpoint follows the 2026-07-28 Streamable HTTP protocol and the SDK also accepts 2025-era stateless clients.

For Claude Code, Codex CLI, Cursor, Gemini CLI, and VS Code configuration examples, see [`AGENT_CLIENTS.md`](./AGENT_CLIENTS.md).

## REST examples

```bash
curl http://127.0.0.1:7337/health

curl -X POST http://127.0.0.1:7337/v1/recall \
  -H 'content-type: application/json' \
  -d '{"query":"preferred editor","agentId":"codex"}'

curl -X POST http://127.0.0.1:7337/v1/capture \
  -H 'content-type: application/json' \
  -d '{"conversationText":"The user prefers dark mode in every IDE.","agentId":"cursor"}'
```

## OpenClaw remote mode

OpenClaw can use this process as its central memory backend instead of opening a local LanceDB database. Set the plugin's `memory.mode` to `remote`:

```json
{
  "memory": {
    "mode": "remote",
    "remote": {
      "url": "http://127.0.0.1:7337",
      "token": {
        "source": "env",
        "id": "MEMORY_SERVER_TOKEN"
      }
    }
  },
  "autoRecall": true,
  "autoCapture": true
}
```

In remote mode OpenClaw does not require `embedding` or `dbPath` settings and does not open a local memory database. `memory_recall`, `memory_search`, `memory_get`, `memory_store`, auto-recall, and auto-capture are sent to the configured server over REST. Network or authentication failures are reported as remote errors; they do not silently fall back to a separate local database.

`memory.remote.agentId` can provide a fallback caller identity, while `memory.remote.scope` can pin OpenClaw to one server-authorized scope. Leaving `scope` unset lets the central server apply its normal scope defaults and ACL rules. Runtime `agentId` and `sessionKey` context are forwarded whenever OpenClaw provides them.

Local management/maintenance features that require direct store access, such as the embedded management CLI, compaction, and dreaming scheduler, stay on the server side in this mode. They are not run against a second OpenClaw-local database.

## LAN/WAN mode

Listening outside loopback is fail-closed. A Bearer token is mandatory. Wildcard binds also require an explicit Host allowlist.

```bash
export MEMORY_SERVER_HOST="0.0.0.0"
export MEMORY_SERVER_TOKEN="replace-with-a-long-random-secret"
export MEMORY_SERVER_ALLOWED_HOSTS="192.168.1.20,memory.home.example"
export MEMORY_SERVER_ALLOWED_ORIGINS="192.168.1.20,memory.home.example"
npm run memory-server
```

Clients then send:

```text
Authorization: Bearer <MEMORY_SERVER_TOKEN>
```

`Origin` is only required/checked when a client sends one; non-browser MCP clients usually omit it. Host and Origin validation remain active to reduce DNS-rebinding exposure.

## Main environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `MEMORY_SERVER_HOST` | `127.0.0.1` | Listen interface |
| `MEMORY_SERVER_PORT` | `7337` | HTTP port |
| `MEMORY_SERVER_DB_PATH` | `data/memory-server` | LanceDB directory |
| `MEMORY_SERVER_TOKEN` | unset locally | Bearer token; required off-loopback |
| `MEMORY_SERVER_ALLOWED_HOSTS` | loopback hosts | Comma-separated hostnames/IPs |
| `MEMORY_SERVER_ALLOWED_ORIGINS` | allowed hosts | Comma-separated browser Origin hostnames |
| `MEMORY_SERVER_DEFAULT_AGENT` | `main` | Caller identity fallback |
| `MEMORY_SERVER_DEFAULT_WRITE_SCOPE` | `global` | Shared capture scope |
| `MEMORY_CAPTURE_ENABLED` | `true` | Enable SmartExtractor capture |
| `MEMORY_EMBEDDING_API_KEY` | — | Embedding provider key |
| `MEMORY_EMBEDDING_BASE_URL` | OpenAI default | OpenAI-compatible embedding endpoint |
| `MEMORY_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model |
| `MEMORY_EMBEDDING_TIMEOUT_MS` | provider default | Embedding request/operation timeout; increase for CPU-only local models |
| `MEMORY_LLM_API_KEY` | embedding key | SmartExtractor LLM key |
| `MEMORY_LLM_BASE_URL` | embedding base URL | SmartExtractor LLM endpoint |
| `MEMORY_LLM_MODEL` | `openai/gpt-oss-120b` | SmartExtractor LLM model |

To run a retrieval-only service, set `MEMORY_CAPTURE_ENABLED=false`; no extraction LLM is then created.
