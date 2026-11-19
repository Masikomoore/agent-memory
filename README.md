<div align="center">

# 🧠 Agent Memory

### One memory. Every agent.

**A self-hosted long-term memory layer shared by Claude Code, Codex CLI, WorkBuddy, Cursor, Gemini CLI, Grok Build, VS Code agents, OpenClaw, and any MCP-capable client — combining on-demand MCP tools with zero-friction Session/Turn Hooks.**

[![CI](https://github.com/Masikomoore/agent-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/Masikomoore/agent-memory/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Streamable_HTTP-7c3aed)](docs/AGENT_CLIENTS.md)
[![LanceDB](https://img.shields.io/badge/Storage-LanceDB-f59e0b)](https://lancedb.com/)
[![GitHub stars](https://img.shields.io/github/stars/Masikomoore/agent-memory?style=flat)](https://github.com/Masikomoore/agent-memory/stargazers)

[Quick Start](#quick-start) · [Connect Agents](docs/AGENT_CLIENTS.md) · [Architecture](#architecture) · [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md) · [Discussions](https://github.com/Masikomoore/agent-memory/discussions) · [中文](README_CN.md)

</div>

---

> [!TIP]
> **If you use more than one AI coding agent, Agent Memory is for you.** Star the repository if you want an open, self-hosted memory layer that stays with *you* instead of one vendor, IDE, or model.

## Why I built this

Agent Memory started with a painful lesson: my Codex Pro account was suspended, and I discovered that I had never kept a complete copy of my history. The local Codex project files were still on my machine, but some browser conversations, planning discussions, and the back-and-forth that shaped development decisions were simply gone.

It was the first time I had personally experienced what losing access to an AI account could mean. I use products from nearly every major AI company—Claude, Codex, Grok, Gemini, and others—and that immediately made the problem feel much bigger than one account. If each agent keeps the only copy of part of my working memory, then changing tools, losing an account, or having a service disappear can also erase part of the history behind my projects.

So I built **Agent Memory** as an independent memory layer that does not belong to any of those agent IDEs or CLIs. Today I use it across Claude Code, Codex CLI, Grok Build, and Gemini CLI, with one shared memory service behind them. The experience has been smooth enough that I am publishing it for other people who regularly use **two or more agents** and want their long-term working memory to stay under their own control.

## Your agents should not have separate memories

Most AI tools remember in isolation. Claude Code learns something, Codex starts from zero. Cursor discovers a project convention, Gemini CLI never sees it. Switching tools means repeating yourself.

Agent Memory gives them **one private, continuously maintained memory service**:

```text
Claude Code ───┐  MCP (/mcp) + Hooks (UserPromptSubmit / Stop / PreCompact / SessionEnd)
Codex CLI ─────┤  MCP (/mcp) + Hooks (UserPromptSubmit / Stop)
WorkBuddy ─────┤  MCP (/mcp) + Hooks (~/.workbuddy/settings.json)
Cursor ────────┼──► Agent Memory Server ─► Memory Core ─► LanceDB
Gemini CLI ────┤       MCP + REST           │
Grok Build ────┤                            ├─ SmartExtractor + transient retry
VS Code ───────┤                            ├─ Hybrid retrieval (Vector + full-layer BM25)
OpenClaw ──────┘                            ├─ decay / reinforcement / dedup / compaction
                                            └─ scopes / lifecycle
```

Your agents call the memory service. **The memory service—not a specific IDE or agent—owns the long-term memory.**

### The 30-second version

| Today | With Agent Memory |
|---|---|
| Every agent starts with a different history | Agents recall from one authoritative memory plane |
| Important decisions live in chat transcripts | Durable facts are extracted into retrievable memory |
| Switching tools means repeating context | Claude Code, Codex, WorkBuddy, Cursor, Gemini CLI, Grok Build, VS Code, and OpenClaw can share it |
| Memory is tied to a vendor or local plugin | Memory runs as your own MCP/REST service |
| "Remember everything" becomes noisy over time | Decay, reinforcement, deduplication, tiers, and scopes manage lifecycle |

**Who should try it now?** Developers and small teams who already switch between multiple AI agents, prefer self-hosting, and want shared memory without maintaining a knowledge graph.

## Why Agent Memory?

| | Agent Memory |
|---|---|
| **Shared across tools** | One memory backend for independent agents and IDEs |
| **Dual-track automatic** | **Session/Turn Hooks** (`agent-memory-hook`) auto-recall before every turn and async-capture in the background, coexisting with **MCP** for explicit search/capture |
| **Self-hosted** | Run locally, on a homelab, LAN, VPN, or private server |
| **Protocol-first** | Streamable HTTP MCP for agents + REST for hooks and native adapters |
| **Durable & full-layer BM25** | LanceDB persistence indexing `text` + L0/L1/L2 summary layers (`search_text`), duplicate-ID write safety, and redacted LLM error diagnostics |
| **Memory lifecycle** | Smart extraction with transient retry, deduplication, decay, reinforcement, scope-isolated compaction, tiering, and scope controls |
| **Provider-flexible** | OpenAI-compatible embedding/LLM APIs or local Ollama |
| **No knowledge graph required** | Deliberately focused on durable agent memory, not graph administration |

## Real cross-agent proof

This is not only an MCP configuration demo. A real acceptance test has already verified the core promise:

> **Real acceptance has verified Claude Code → Codex recall, and a separate Codex capture → Claude Code + Grok recall through the same shared memory service.**

Current integration status:

| Client | MCP | Session/Turn Hooks (`agent-memory-hook`) | Status |
|---|---|---|---|
| Claude Code | Streamable HTTP `/mcp` | `~/.claude/settings.json` (`UserPromptSubmit`, async `Stop`, `PreCompact`, `SessionEnd`) | ✅ real-environment verified (MCP + Hooks) |
| Codex CLI | Streamable HTTP `/mcp` | `~/.codex/hooks.json` (`UserPromptSubmit`, `Stop` + detached async worker) | ✅ real-environment verified (MCP + Hooks) |
| WorkBuddy | Streamable HTTP `/mcp` | `~/.workbuddy/settings.json` (`UserPromptSubmit`, `Stop`, `PreCompact`, `SessionEnd` + `hook.env`) | ✅ hook installer, templates & E2E verified |
| Grok Build | Streamable HTTP `/mcp` | — | ✅ real-environment verified |
| OpenClaw | REST remote-memory mode | Native lifecycle plugin (`memory.mode: "remote"`) | ✅ automated integration coverage |
| Gemini CLI | Streamable HTTP `/mcp` | — | ✅ authenticated MCP transport verified |
| Cursor | Streamable HTTP `/mcp` | — | 🧩 config template ready |
| VS Code agents | Streamable HTTP `/mcp` | — | 🧩 config template ready |
| Any MCP / Hook client | `/mcp` | `agent-memory-hook recall/capture/health` | 🧩 protocol-compatible |

See [docs/AGENT_CLIENTS.md](docs/AGENT_CLIENTS.md) for full MCP and Session/Turn Hook setup guides.

## Dual-track integration: MCP + Session/Turn Hooks

MCP alone gives an agent tools, but still relies on the model remembering to call them. **`agent-memory-hook`** closes that gap for **Claude Code**, **Codex CLI**, and **WorkBuddy** without replacing MCP:

- **Automatic pre-turn recall (`UserPromptSubmit`)**: skips trivial greetings/slash commands locally, suppresses recently injected memories for 8 turns, enforces a strict fail-open timeout, and injects bounded `<relevant-memories>` via `hookSpecificOutput.additionalContext`.
- **Non-blocking incremental capture (`Stop` / `PreCompact` / `SessionEnd`)**: spawns a detached background worker (parent hook returns in ~50ms), parses only newly added turns from Claude/WorkBuddy JSONL or Codex rollout JSONL (with cached-prompt + `last_assistant_message` fallback), strips `<relevant-memories>` and `tool_use`/`tool_result` blocks so MCP and Hooks never loop, and never persists secrets to temp task files.
- **Desktop GUI friendly**: loads `~/.config/agent-memory/hook.env` (`chmod 600`) when process env vars are absent, so GUI clients work without inheriting `.zshrc` exports.
- **Non-destructive install & diagnostics**: `agent-memory-hook install <claude-code|codex|workbuddy>` merges idempotently while keeping your existing settings and hooks untouched; `agent-memory-hook doctor` verifies server health, env loading, cache dir, and installed hooks in one command.

## Architecture

```mermaid
flowchart LR
    CC[Claude Code] --> MCP[MCP /mcp]
    CX[Codex CLI] --> MCP
    CU[Cursor] --> MCP
    GM[Gemini CLI] --> MCP
    GR[Grok Build] --> MCP
    WB[WorkBuddy] --> MCP
    VS[VS Code] --> MCP
    OC[OpenClaw] --> REST[REST /v1]

    MCP --> S[Agent Memory Server]
    REST --> S
    S --> C[Memory Core]
    C --> EX[Smart Extraction]
    C --> RT[Hybrid Retrieval]
    C --> LC[Lifecycle + Scopes]
    C --> DB[(LanceDB)]
    EX --> LLM[LLM Provider / Ollama]
    RT --> EMB[Embedding Provider / Ollama]
```

The important boundary is the server: clients never open their own competing databases. They share one authoritative memory plane.

## Quick Start

### Option 1 — One-sentence Agent-Assisted Install & Update (Recommended)

Already using Claude Code, Codex CLI, WorkBuddy, Grok Build, Gemini CLI, or Cursor? Paste this one-line request into your agent (or copy the full checklist from [`examples/mcp-clients/agent-install-prompt.md`](examples/mcp-clients/agent-install-prompt.md)):

```text
Install or update Agent Memory from https://github.com/Masikomoore/agent-memory: inspect my installed clients and existing configs/hooks without overwriting them, connect MCP, set up ~/.config/agent-memory/hook.env (chmod 600) and agent-memory-hook for Claude Code / Codex / WorkBuddy, and verify everything with `agent-memory-hook doctor` plus a real recall/capture check.
```

What the agent automatically checks, installs, and verifies for you:

1. **Client & Hook inspection**: detects installed clients (`~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.workbuddy/settings.json`), preserves unrelated settings and existing hooks, and picks a stable Node path + compiled `dist/src/client/memory-hook-cli.js`.
2. **Non-destructive MCP + Hook setup & updates**: connects `/mcp`, configures `~/.config/agent-memory/hook.env` (`chmod 600`, zero secrets printed), previews via `agent-memory-hook install <host>` (dry-run), and applies idempotently with `--apply` (safe to re-run on updates).
3. **End-to-end verification**: runs `agent-memory-hook doctor`, validates live `UserPromptSubmit` hook recall, and verifies authenticated MCP capture-then-recall before reporting done.

### Option 2 — Manual Install (Server + Client Hooks)

#### Step A — Start the Memory Server (Docker Compose or Direct)

Requirements: Docker Compose and an x86_64/arm64 host supported by LanceDB.

```bash
git clone https://github.com/Masikomoore/agent-memory.git
cd agent-memory
cp .env.example .env

# Put a long random value in MEMORY_SERVER_TOKEN.
openssl rand -hex 32

docker compose up -d
curl http://127.0.0.1:7337/health
```

The default compose stack uses your configured OpenAI-compatible embedding & SmartExtractor LLM providers, a persistent LanceDB volume, and loopback-only host publishing. For an all-local Ollama stack, layer `docker-compose.ollama.yaml`:

```bash
docker compose -f docker-compose.yaml -f docker-compose.ollama.yaml up -d
```

Or run the server directly without Docker:

```bash
npm ci && npm run build
export MEMORY_EMBEDDING_API_KEY="..."
export MEMORY_EMBEDDING_MODEL="text-embedding-3-small"
export MEMORY_LLM_API_KEY="..."
export MEMORY_LLM_MODEL="your-model"
export MEMORY_SERVER_TOKEN="replace-with-a-long-random-secret"
npm run memory-server
```

Connect MCP clients to `http://127.0.0.1:7337/mcp` with `Authorization: Bearer <MEMORY_SERVER_TOKEN>`. For LAN/WAN binding, Host/Origin allowlists, and Coolify deployment, see [docs/MEMORY_SERVER.md](docs/MEMORY_SERVER.md) and [docs/DEPLOY_COOLIFY.md](docs/DEPLOY_COOLIFY.md).

#### Step B — Enable Session/Turn Hooks for Claude Code, Codex CLI, and WorkBuddy

```bash
# 1. Build the compiled hook CLI (fast startup, no runtime transpiler needed)
npm ci && npm run build

# 2. Save server URL & token once (works for both terminal CLIs and desktop GUI clients)
mkdir -p ~/.config/agent-memory
cat > ~/.config/agent-memory/hook.env <<'EOF'
MEMORY_SERVER_URL=http://127.0.0.1:7337
MEMORY_SERVER_TOKEN=replace-with-your-memory-server-token
EOF
chmod 600 ~/.config/agent-memory/hook.env

# 3. Preview (dry-run by default), then apply idempotently (preserves existing hooks)
node dist/src/client/memory-hook-cli.js install claude-code --apply
node dist/src/client/memory-hook-cli.js install codex --apply
node dist/src/client/memory-hook-cli.js install workbuddy --apply

# 4. Verify server health, env loading, state dir, and installed hooks
node dist/src/client/memory-hook-cli.js doctor
```

#### Seamless updates

- **Server**: `git pull && docker compose up -d --build` (or click **Redeploy** in Coolify). Existing LanceDB tables migrate automatically on startup (including `search_text` column creation, summary-layer backfill, and FTS index cutover) with zero manual database migration.
- **Client hooks**: `git pull && npm run build && node dist/src/client/memory-hook-cli.js doctor` (re-run `install <host> --apply` only when new hook events are added; existing hooks are updated in place without duplicates).

## How agents should use it

Giving an agent MCP access is only half the integration. The agent also needs a durable behavior rule:

1. **Recall** before answering when prior decisions, preferences, project state, people, recurring entities, or historical context may matter.
2. **Capture** after a durable preference, decision, constraint, fact, or project state is established.
3. Send a stable logical `agentId` such as `claude-code`, `codex`, or `cursor`.
4. Never store passwords, API keys, auth tokens, or transient command output.
5. Current user instructions always override recalled memory.

Reusable instructions and client examples live in [`examples/mcp-clients`](examples/mcp-clients).

## Memory model

Agent Memory is designed around a simple idea: **memory is infrastructure, not a chat transcript archive**.

The server combines:

- semantic embeddings + full-layer BM25 (`search_text` indexing `text`, `l0_abstract`, `l1_overview`, and `l2_content`)
- retrieval fusion and reranking
- smart extraction with transient retry and `llmUnavailable` deferral
- deduplication, supersession, and duplicate-ID-safe metadata updates
- redacted LLM JSON error diagnostics (no conversation text leaked to logs)
- time decay, access reinforcement, and scope-isolated compaction
- memory tiers and global / agent / user / project scopes
- canonical-memory compatibility for OpenClaw adapters

The standalone server keeps those capabilities independent from any one host application's lifecycle.

## Deployment

Agent Memory is intended to run as a small private service. Common deployment targets:

- local workstation
- home server / NAS
- private LAN or VPN
- Coolify / Docker host
- small cloud VM behind TLS and authentication

See [docs/DEPLOY_COOLIFY.md](docs/DEPLOY_COOLIFY.md) for Coolify guidance.

> **Security default:** the server listens on loopback unless configured otherwise. Non-loopback mode requires a Bearer token and explicit Host allowlisting.

## Project status

**Alpha / early community release.** The shared-memory architecture and Claude Code ↔ Codex interoperability have been proven, but the public project is still being separated into cleaner server/core/adapter packages.

Good areas for contributors right now:

- more real-client acceptance tests
- memory inspection / administration UI
- stronger multi-user authentication and ACLs
- backup / restore UX
- observability and metrics
- deployment templates
- additional agent adapters
- benchmark and memory-quality evaluation

See the full [Roadmap](ROADMAP.md).

### What we want help with right now

You do **not** need to understand the memory engine to contribute. The highest-value community work today is concrete and testable:

| Area | Good contribution |
|---|---|
| Agent integrations | Verify Cursor/VS Code against a real server, or complete Gemini's model-authenticated agent-level acceptance path |
| Operations | Improve backup/restore, diagnostics, metrics, Docker, NAS, or Coolify workflows |
| Memory quality | Reproduce a bad recall/capture case with a small fixture and expected behavior |
| Security | Improve client identity, ACLs, token rotation, and safe remote deployment |
| UX | Prototype a small memory inspection/search/admin interface |
| Docs | Make one setup path reproducible for someone who has never used the project |

Look for [`good first issue`](https://github.com/Masikomoore/agent-memory/labels/good%20first%20issue) and [`help wanted`](https://github.com/Masikomoore/agent-memory/labels/help%20wanted), or start a [Discussion](https://github.com/Masikomoore/agent-memory/discussions) before a larger design change.

## Contributing

This project is intentionally being opened early. If the idea of a **personal memory layer that survives agent switching** is useful to you, there are several valuable ways to help:

- ⭐ Star the project so other agent-tool users can find it
- 🧪 Test it with your agent stack and report what breaks
- 🔌 Add an adapter or verified client recipe
- 🧠 Improve memory quality, retrieval, or lifecycle behavior
- 🔐 Improve authentication, tenancy, backup, or operations
- 📖 Fix docs where setup is confusing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Small, focused pull requests are welcome.

Consistent contributors are also welcome to help with **issue triage, client verification, documentation review, and roadmap shaping**. The goal is to grow Agent Memory as a community-maintained interoperability layer, not a one-person integration dump.

## Philosophy

- **One owner for memory.** Agents are clients; the memory service is authoritative.
- **Automatic by default.** Humans should not need to curate every memory manually.
- **Private first.** Self-hosting and local-network deployment are first-class use cases.
- **Interoperable.** MCP and REST are boundaries; no single agent vendor owns the data plane.
- **Useful forgetting matters.** Long-term memory needs lifecycle management, not infinite accumulation.
- **No graph ceremony.** A knowledge graph should not be required just to remember what matters.

## License & provenance

Agent Memory is released under the [MIT License](LICENSE).

The independent server, remote-client architecture, MCP integration, deployment work, and public project organization in this repository are maintained as **Agent Memory**. Portions of the underlying memory engine were adapted from the MIT-declared `memory-lancedb-pro` codebase. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for provenance and attribution.

This repository is published as an independent project with its own history and release process; it is not a GitHub fork and does not depend on an upstream Git remote.

---

<div align="center">

**If you switch between AI agents, your memory shouldn't reset with the tool.**

⭐ Star · 🐛 Report · 🔧 Contribute · 🧠 Remember

</div>
