# Deploy Agent Memory with Coolify

Agent Memory can be managed from Coolify as a Docker Compose application/service so operators can control lifecycle, logs, environment variables, and persistent volumes from the WebUI.

## Recommended source

Use this Git repository as the source and deploy the root `docker-compose.yaml`. The default deployment runs only the Memory Server and connects to operator-supplied embedding and LLM providers.

## Required configuration

Set at least:

```text
MEMORY_SERVER_TOKEN=<long random secret>
MEMORY_EMBEDDING_BASE_URL=<OpenAI-compatible embedding base URL>
MEMORY_EMBEDDING_API_KEY=<provider key, blank if the provider does not require one>
MEMORY_EMBEDDING_MODEL=<your embedding model>
MEMORY_EMBEDDING_DIMENSIONS=<that model's vector dimension>
MEMORY_LLM_BASE_URL=<OpenAI-compatible LLM base URL>
MEMORY_LLM_API_KEY=<provider key>
MEMORY_LLM_MODEL=<your extraction model>
```

For private-server access, also set:

```text
MEMORY_SERVER_BIND_ADDRESS=0.0.0.0
MEMORY_SERVER_ALLOWED_HOSTS=<hostname-or-ip-used-by-clients>,memory-server,localhost,127.0.0.1
MEMORY_SERVER_ALLOWED_ORIGINS=<same-hosts-as-needed>
```

Prefer a VPN/private network or TLS reverse proxy. Do not expose the raw service unauthenticated.

The Compose file deliberately does not choose model names for you. Configure
provider URLs, credentials, the embedding dimension, and model names in
Coolify. `MEMORY_LLM_THINK_LEVEL` is optional; when blank, Agent Memory does
not send an explicit reasoning effort and leaves that choice to the provider.
Timeouts remain independently tunable through `MEMORY_EMBEDDING_TIMEOUT_MS`
and `MEMORY_LLM_TIMEOUT_MS`.

For an all-local Ollama stack, layer `docker-compose.ollama.yaml` on top of the
base file. That optional overlay starts Ollama and pulls the operator-selected
embedding and LLM models.

## Persistent data

The default compose stack declares one persistent volume:

- `agent-memory-data` — LanceDB database

The optional local-Ollama overlay additionally declares `ollama-models` for
the local model cache.

Back up `agent-memory-data` as sensitive user data.

## Health check

Coolify can use:

```text
GET /health
```

The health endpoint is intentionally unauthenticated. Memory operations under `/mcp` and `/v1/*` require the Bearer token when configured.
