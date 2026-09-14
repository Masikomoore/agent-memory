# Agent Memory Roadmap

Agent Memory is being built as a vendor-neutral, self-hosted memory plane for personal AI agents.

This roadmap is intentionally public and contribution-driven. Items marked **Help wanted** are good places to join without needing to redesign the whole system. If you want to own one, open or comment on an issue so work is not duplicated.

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

**Help wanted now:** real-client verification, backup/restore documentation, deployment reproducibility.

## Next — make it pleasant to operate

- [ ] Web UI for inspection, search, correction, and lifecycle visibility
- [ ] Metrics and health diagnostics
- [ ] Structured audit log for capture, recall, mutation, and maintenance
- [ ] Backup scheduling and restore verification
- [ ] Easier provider setup and model diagnostics
- [ ] Container images and versioned release artifacts
- [ ] Upgrade/migration story independent of OpenClaw

**Help wanted:** web UI prototypes, metrics/diagnostics, release automation, operator docs.

## Then — make it safe for multiple users and agents

- [ ] Per-client credentials
- [ ] Server-enforced identity instead of trusting logical `agentId`
- [ ] User/project ACLs
- [ ] Tenant isolation
- [ ] Rate limits and quotas
- [ ] Token rotation
- [ ] Optional TLS termination guidance / private-network profiles

**Design-heavy / help wanted:** identity model, ACL boundaries, token rotation, tenant isolation.

## Memory quality

- [ ] Public evaluation harness for recall quality
- [ ] LongMemEval / LoCoMo reproducible baselines
- [ ] Better duplicate/supersession evaluation
- [ ] Explainable recall scoring
- [ ] Memory confidence and provenance surfaces
- [ ] Safer automatic correction and contradiction handling

**Help wanted:** small reproducible evaluation cases are especially valuable. A failing fixture with a clear expected result is more useful than a broad "memory quality is bad" report.

## Ecosystem

- [ ] More verified MCP clients
- [ ] IDE extension examples
- [ ] Mobile/personal-assistant integrations
- [ ] Home Assistant / automation examples
- [ ] SDKs for common languages
- [ ] Importers from common memory/chat formats

**Help wanted:** verify a real client, add a reproducible integration recipe, or contribute an importer with tests.

## Community ownership

Agent Memory is intended to become community-maintained as usage grows. Useful non-code ownership includes:

- triaging reproducible issues
- validating agent/client integrations
- reviewing documentation and deployment recipes
- maintaining benchmark fixtures
- helping shape interfaces before large changes land

Consistent contributors who demonstrate good judgment in one of these areas can take on more review and maintenance responsibility over time. The project should not depend on a single maintainer understanding every client and deployment target.

## How to influence the roadmap

1. For a concrete bug or scoped feature, open an Issue.
2. For a larger interface, architecture, or product-direction idea, start a GitHub Discussion first.
3. For an item you want to implement, say so on the issue before doing a large amount of work.
4. Prefer small, independently reviewable steps over one large roadmap PR.

## Non-goals for now

- Requiring a knowledge graph
- Becoming a full chat-history warehouse
- Locking memory to one model vendor or agent runtime
- Hiding data ownership behind a hosted-only service

If one of these areas matters to you, open an issue before a large implementation so we can agree on boundaries and interfaces first.
