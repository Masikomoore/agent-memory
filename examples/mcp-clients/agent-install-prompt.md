# Agent-assisted setup prompt

Copy the prompt below into Claude Code, Codex CLI, Grok Build, Gemini CLI, ChatOnSteroids, Cursor, VS Code, or another capable coding agent. The agent should inspect your actual environment before changing anything.

> Help me install and configure Agent Memory from https://github.com/Masikomoore/agent-memory as my shared long-term memory service. First inspect my OS, existing Agent Memory deployment, installed AI clients, MCP configuration, and existing instruction files so you preserve existing working configuration. If no Memory Server is running, use the repository's documented Docker/local deployment path and ask me only for provider settings or credentials you truly need. Never print, copy into chat, or commit API keys, Bearer tokens, passwords, or other secrets; prefer environment variables or the client's secure credential mechanism. Connect every supported client I use to the same `/mcp` endpoint, choose a stable `agentId` for each client, and add the repository's Shared Agent Memory behavior rules to the client's persistent instructions without deleting my existing instructions. For ChatOnSteroids, use an HTTPS or loopback HTTP MCP URL; if my Memory Server is reachable only by private plain HTTP, preserve that restriction and create a safe loopback/TLS bridge instead of weakening the client's URL policy. After configuration, verify server health, authenticated MCP initialize/tool discovery, `memory_recall`, and a harmless capture-then-recall test from at least two independent clients when available. Fix any configuration errors you find, keep existing unrelated settings intact, and only report completion after the real read/write path works.

If your Memory Server already exists, you can make the request more specific by adding its non-secret URL, for example:

```text
My existing Agent Memory server is reachable at https://memory.example.com. Configure this machine and my installed AI clients to use it. Ask me for any secret only when the client cannot use an existing environment variable or secure credential store.
```

Do not paste a real token into a reusable prompt that may be stored in chat history. Let the agent use an existing environment variable, secure credential store, or an interactive secret prompt instead.
