# Changelog

All notable public Agent Memory changes will be recorded here.

## Unreleased

### Universal agent client integration

- Made native Streamable HTTP MCP the primary shared-memory path for Claude Code, Codex CLI, Cursor, Gemini CLI, Grok Build, VS Code agents, and other capable clients, with common server-side usage instructions.
- Added Grok Build as a first-class Streamable HTTP MCP client with a native `config.toml` template, setup/diagnostic guidance, stable `agentId`, and regression coverage.
- Added verified ChatOnSteroids integration guidance, including its HTTPS/loopback MCP URL boundary, stable `chat-on-steroids` identity, plugin-schema refresh behavior, and functional health/recall/capture acceptance criteria.
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
