# Contributing to Agent Memory

Thanks for helping build a shared, self-hosted memory layer for AI agents.

You can contribute without becoming a memory-engine expert. Agent Memory needs people who know specific clients, deployment environments, security boundaries, documentation, and real-world failure cases just as much as it needs core algorithm work.

## Choose a contribution path

| If you know... | A useful first contribution is... |
|---|---|
| Claude/Codex/Cursor/Gemini/VS Code/MCP | Verify a real client and document exact setup + behavior |
| Docker/NAS/Coolify/homelab | Make one deployment path reproducible and observable |
| Security/auth | Review identity, token, ACL, and remote-network boundaries |
| Frontend | Prototype memory inspection/search/admin UX |
| Testing/evaluation | Add a focused failing fixture for recall/capture quality |
| Technical writing | Remove one setup ambiguity or document one operator workflow |

## Good first contributions

You do not need to understand the whole memory engine to contribute. High-value starting points include:

- verify a new MCP client and add a reproducible recipe
- improve Docker/Coolify/self-hosting docs
- add tests for REST or MCP edge cases
- improve health/diagnostic output
- improve documentation and examples
- add observability without leaking memory content
- reproduce a memory-quality failure with a focused fixture

Check the roadmap and open issues before starting a large change.

You can also use the `client verification` issue template when you want to test an MCP-capable client that is not yet real-environment verified.

## Development setup

Requirements: Node.js 22+.

```bash
npm ci
npm run build
```

Useful test commands:

```bash
npm run test:cli-smoke
npm run test:core-regression
node test/memory-server-http.test.mjs
node test/mcp-shared-memory-clients.test.mjs
node test/openclaw-remote-mode.test.mjs
```

## Pull requests

Keep pull requests focused. A strong PR includes:

1. the problem being solved
2. the chosen behavior and why
3. tests for observable behavior
4. documentation when configuration or interfaces change
5. no secrets, tokens, personal memories, or production data

Please avoid unrelated formatting or refactors in the same PR.

### Suggested workflow

1. Pick an existing issue, or open one for a non-trivial change.
2. Comment that you are working on it if the issue is open to contributors.
3. Create a branch from `main`.
4. Add the smallest implementation and tests that prove the behavior.
5. Run the relevant checks locally.
6. Open a PR and describe observable behavior, not only changed files.

For small documentation fixes, you do not need to open an issue first.

## Architecture rule

The standalone server is the authority for shared memory. New client integrations should call the server through MCP/REST instead of opening another independent database.

Core memory algorithms should remain host-independent whenever practical. Agent-specific lifecycle code belongs in adapters.

## Security-sensitive changes

Authentication, authorization, memory isolation, secret handling, remote networking, and destructive memory operations deserve additional review. Please open an issue before a large security-sensitive redesign.

For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Community expectations

Be specific, technical, and respectful. Critique code and behavior, not people. Assume contributors have different agent stacks, languages, and deployment environments.

## Helping maintain the project

Code is not the only path to project ownership. Contributors can also help by:

- reproducing and triaging issues
- verifying client integrations on real machines
- reviewing deployment/documentation changes
- keeping roadmap items linked to concrete issues
- improving tests and benchmark fixtures

As the contributor base grows, consistent contributors may be invited to take on more triage and review responsibility. The goal is a durable community project, not a repository where every decision bottlenecks on one person.
