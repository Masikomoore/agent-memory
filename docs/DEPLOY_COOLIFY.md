# Deploy Agent Memory with Coolify

Agent Memory can be managed from Coolify as a Docker Compose application/service so operators can control lifecycle, logs, environment variables, and persistent volumes from the WebUI.

## Recommended source

Use this Git repository as the source and deploy the root `docker-compose.yaml`. The repository builds the Memory Server from `Dockerfile` and runs Ollama as a companion service.

## Required configuration

Set at least:

```text
MEMORY_SERVER_TOKEN=<long random secret>
```

For private-server access, also set:

```text
MEMORY_SERVER_BIND_ADDRESS=0.0.0.0
MEMORY_SERVER_ALLOWED_HOSTS=<hostname-or-ip-used-by-clients>,memory-server,localhost,127.0.0.1
MEMORY_SERVER_ALLOWED_ORIGINS=<same-hosts-as-needed>
```

Prefer a VPN/private network or TLS reverse proxy. Do not expose the raw service unauthenticated.

For CPU-only hosts, the Compose default uses `qwen2.5:1.5b` for SmartExtractor
with a 180-second LLM timeout. Faster CPU/GPU hosts can set
`MEMORY_LLM_MODEL=qwen2.5:3b` (or another Ollama model) and tune
`MEMORY_LLM_TIMEOUT_MS` without editing the Compose file. The model bootstrap
job pulls the same configured model before the Memory Server starts.

## Persistent data

The compose stack declares two persistent volumes:

- `agent-memory-data` — LanceDB database
- `ollama-models` — local model cache

Back up `agent-memory-data` as sensitive user data.

## Health check

Coolify can use:

```text
GET /health
```

The health endpoint is intentionally unauthenticated. Memory operations under `/mcp` and `/v1/*` require the Bearer token when configured.
