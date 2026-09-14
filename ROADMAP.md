# Agent Memory Roadmap

Agent Memory is being built as a vendor-neutral, self-hosted memory plane for personal AI agents.

## Now — make shared memory dependable

- [x] Host-independent Memory Core
- [x] Standalone HTTP server
- [x] Streamable HTTP MCP endpoint
- [x] REST recall/capture endpoints
- [x] Bearer authentication and Host/Origin validation
- [x] Claude Code ↔ Codex real-environment shared-memory acceptance
- [x] OpenClaw remote-memory mode
- [x] Client templates for Claude Code, Codex, Cursor, Gemini CLI, and VS Code
- [ ] Publish repeatable Docker/Coolify deployment validation
- [ ] Add backup/restore runbook for the standalone server
- [ ] Add memory delete/forget endpoint with audit-safe semantics

## Next — make it pleasant to operate

- [ ] Web UI for inspection, search, correction, and lifecycle visibility
- [ ] Metrics and health diagnostics
- [ ] Structured audit log for capture, recall, mutation, and maintenance
- [ ] Backup scheduling and restore verification
- [ ] Easier provider setup and model diagnostics
- [ ] Container images and versioned release artifacts
- [ ] Upgrade/migration story independent of OpenClaw

## Then — make it safe for multiple users and agents

- [ ] Per-client credentials
- [ ] Server-enforced identity instead of trusting logical `agentId`
- [ ] User/project ACLs
- [ ] Tenant isolation
- [ ] Rate limits and quotas
- [ ] Token rotation
- [ ] Optional TLS termination guidance / private-network profiles

## Memory quality

- [ ] Public evaluation harness for recall quality
- [ ] LongMemEval / LoCoMo reproducible baselines
- [ ] Better duplicate/supersession evaluation
- [ ] Explainable recall scoring
- [ ] Memory confidence and provenance surfaces
- [ ] Safer automatic correction and contradiction handling

## Ecosystem

- [ ] More verified MCP clients
- [ ] IDE extension examples
- [ ] Mobile/personal-assistant integrations
- [ ] Home Assistant / automation examples
- [ ] SDKs for common languages
- [ ] Importers from common memory/chat formats

## Non-goals for now

- Requiring a knowledge graph
- Becoming a full chat-history warehouse
- Locking memory to one model vendor or agent runtime
- Hiding data ownership behind a hosted-only service

If one of these areas matters to you, open an issue before a large implementation so we can agree on boundaries and interfaces first.
