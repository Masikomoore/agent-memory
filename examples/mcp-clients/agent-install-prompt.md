# Agent-assisted setup & update prompt

Copy the prompt below into Claude Code, Codex CLI, WorkBuddy, Grok Build, Gemini CLI, Cursor, VS Code, or another capable coding agent. It handles **both fresh installation and seamless in-place updates** — inspecting your machine first so existing settings and hooks are preserved.

> Help me install and configure Agent Memory from https://github.com/Masikomoore/agent-memory as my shared long-term memory service (or update my existing setup if it is already installed).
>
> 1. **Inspect first (preserve existing config):** Inspect my OS, Node.js path, any existing Agent Memory server or local clone, installed AI clients (Claude Code, Codex CLI, WorkBuddy, Grok Build, Gemini CLI, Cursor, VS Code), existing MCP configs, existing Session/Turn hook configs (`~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.workbuddy/settings.json`), and existing instruction files so you preserve existing working configuration and unrelated hooks.
> 2. **Deploy or update the Memory Server:** If no Memory Server is running, use the repository's documented Docker/local deployment path and ask me only for provider settings or credentials you truly need. If an existing local checkout is present, pull updates and run `npm run build` so `dist/src/client/memory-hook-cli.js` is fresh. Never print, copy into chat, or commit API keys, Bearer tokens, passwords, or other secrets; prefer environment variables, `~/.config/agent-memory/hook.env` (`chmod 600`), or the client's secure credential mechanism.
> 3. **Configure MCP (explicit on-demand track):** Connect every supported client I use to the same `/mcp` endpoint, choose a stable `agentId` for each client (`claude-code`, `codex`, `workbuddy`, `grok`, `gemini-cli`, `cursor`, `vscode`), and add the repository's Shared Agent Memory behavior rules to the client's persistent instructions without deleting my existing instructions.
> 4. **Inspect, install/update, and verify Session/Turn Hooks (automatic background track):** For any installed Claude Code, Codex CLI, or WorkBuddy client, set up or update `agent-memory-hook` in dual-track mode alongside MCP:
>    - Ensure `~/.config/agent-memory/hook.env` (`chmod 600`) has `MEMORY_SERVER_URL` and `MEMORY_SERVER_TOKEN` (deriving them safely from existing local env/MCP config without printing secrets, or prompting me if absent) so both terminal CLIs and GUI hosts work seamlessly.
>    - Prefer a stable absolute Node binary path (e.g. `/opt/homebrew/bin/node` rather than a versioned Cellar path) with the compiled `dist/src/client/memory-hook-cli.js` entrypoint.
>    - Preview first with `agent-memory-hook install <claude-code|codex|workbuddy>` (dry-run) to confirm existing hooks are preserved and no duplicate or schema-invalid fields are introduced (especially keeping Codex `hooks.json` free of unsupported keys), then apply with `--apply`.
> 5. **Verify end-to-end before finishing:** Run `agent-memory-hook doctor` to verify server health, env loading, state directory writability, and installed hooks for every detected client; run a read-only `UserPromptSubmit` hook smoke check; and verify authenticated MCP initialize/tool discovery, `memory_recall`, and a harmless capture-then-recall test from at least two independent clients when available. Fix any configuration errors you find, keep existing unrelated settings intact, and only report completion after both the hook and MCP paths pass.

## If your Memory Server already exists

Add your non-secret server URL so the agent connects directly without deploying a second server:

```text
My existing Agent Memory server is reachable at https://memory.example.com. Inspect this machine, connect my installed AI clients over MCP, install/update agent-memory-hook for Claude Code / Codex / WorkBuddy while preserving existing hooks, and verify everything with `agent-memory-hook doctor` plus a real recall check. Ask me for any secret only when it cannot be sourced from an existing env var or secure credential store.
```

## One-line update prompt (already installed)

```text
Update my local Agent Memory checkout from https://github.com/Masikomoore/agent-memory, rebuild dist, re-check and refresh agent-memory-hook for Claude Code / Codex / WorkBuddy without overwriting my other hooks, and verify with `agent-memory-hook doctor`.
```

Do not paste a real token into a reusable prompt that may be stored in chat history. Let the agent use an existing environment variable, `~/.config/agent-memory/hook.env` (`chmod 600`), a secure credential store, or an interactive secret prompt instead.
