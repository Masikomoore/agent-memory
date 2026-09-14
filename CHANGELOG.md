# Changelog

All notable public Agent Memory changes will be recorded here.

## Unreleased

### Community launch polish

- Strengthened the README around the core cross-agent value proposition, 30-second project summary, contributor entry points, and community ownership.
- Expanded the public roadmap with help-wanted areas and a clear path for contributors to influence priorities.
- Expanded the contributing guide with role-based contribution paths, a suggested PR workflow, and non-code maintenance roles.
- Added a dedicated real-client verification issue template and routed setup/design questions to GitHub Discussions.
- Made the Docker/Coolify SmartExtractor model configurable and changed the Compose default to CPU-friendly `qwen2.5:1.5b` with a 180-second timeout so CPU-only deployments do not routinely hit the previous 120-second `qwen2.5:3b` deadline.
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
