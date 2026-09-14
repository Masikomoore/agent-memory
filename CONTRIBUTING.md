# Contributing to Agent Memory

Thanks for helping build a shared, self-hosted memory layer for AI agents.

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

## Architecture rule

The standalone server is the authority for shared memory. New client integrations should call the server through MCP/REST instead of opening another independent database.

Core memory algorithms should remain host-independent whenever practical. Agent-specific lifecycle code belongs in adapters.

## Security-sensitive changes

Authentication, authorization, memory isolation, secret handling, remote networking, and destructive memory operations deserve additional review. Please open an issue before a large security-sensitive redesign.

For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Community expectations

Be specific, technical, and respectful. Critique code and behavior, not people. Assume contributors have different agent stacks, languages, and deployment environments.
