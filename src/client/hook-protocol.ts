export type SupportedHookHost =
  | "claude-code"
  | "codex"
  | "workbuddy"
  | "grok"
  | "antigravity-cli"
  | "cursor"
  | "hermes";
export type HookHost = SupportedHookHost | "generic";
export type HookEventName =
  | "UserPromptSubmit"
  | "Stop"
  | "PreCompact"
  | "SessionEnd"
  | "SessionStart";

export const SUPPORTED_HOOK_HOSTS: readonly SupportedHookHost[] = [
  "claude-code",
  "codex",
  "workbuddy",
  "grok",
  "antigravity-cli",
  "cursor",
  "hermes",
];

export interface ParsedHookEvent {
  eventName?: HookEventName;
  rawEventName?: string;
  sessionId?: string;
  transcriptPath?: string;
  cwd?: string;
  prompt?: string;
  userMessage?: string;
  lastAssistantMessage?: string;
  invocationNum?: number;
  stopHookActive: boolean;
  reason?: string;
  client?: string;
  raw: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function firstStringFromArray(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) {
      return item.trim();
    }
  }
  return undefined;
}

function asPositiveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

export function normalizeHookEventName(value: string | undefined): HookEventName | undefined {
  if (!value) return undefined;
  const compact = value.trim().toLowerCase().replace(/[_-\s]+/g, "");
  switch (compact) {
    case "userpromptsubmit":
    case "beforepromptbuild":
    case "promptsubmit":
    case "beforesubmitprompt":
    case "preinvocation":
    case "prellmcall":
      return "UserPromptSubmit";
    case "stop":
    case "turnend":
    case "agentend":
    case "afteragentresponse":
    case "postllmcall":
      return "Stop";
    case "precompact":
    case "beforecompact":
      return "PreCompact";
    case "sessionend":
    case "onsessionend":
    case "onsessionfinalize":
    case "onsessionreset":
      return "SessionEnd";
    case "sessionstart":
    case "onsessionstart":
      return "SessionStart";
    default:
      return undefined;
  }
}

export function normalizeHookHost(value: string | undefined): SupportedHookHost | "auto" | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "auto") return "auto";
  if (normalized === "claude" || normalized === "claude-code" || normalized === "claudecode") {
    return "claude-code";
  }
  if (normalized === "codex" || normalized === "codex-cli" || normalized === "codexcli") {
    return "codex";
  }
  if (normalized === "workbuddy" || normalized === "codebuddy") {
    return "workbuddy";
  }
  if (normalized === "grok" || normalized === "grok-build" || normalized === "grokbuild" || normalized === "grok-cli") {
    return "grok";
  }
  if (
    normalized === "antigravity-cli" ||
    normalized === "antigravity" ||
    normalized === "agy" ||
    normalized === "agy-cli"
  ) {
    return "antigravity-cli";
  }
  if (normalized === "cursor" || normalized === "cursor-cli" || normalized === "cursor-ide") {
    return "cursor";
  }
  if (normalized === "hermes" || normalized === "hermes-agent" || normalized === "hermesagent") {
    return "hermes";
  }
  return undefined;
}

export function detectHookHost(
  explicitHost: string | undefined,
  payload: ParsedHookEvent,
  env: NodeJS.ProcessEnv = process.env,
): HookHost {
  const normalized = normalizeHookHost(explicitHost);
  if (normalized && normalized !== "auto") return normalized;

  if (payload.client) {
    if (/workbuddy|codebuddy/i.test(payload.client)) return "workbuddy";
    if (/grok/i.test(payload.client)) return "grok";
    if (/antigravity|\bagy\b/i.test(payload.client)) return "antigravity-cli";
    if (/cursor/i.test(payload.client)) return "cursor";
    if (/hermes/i.test(payload.client)) return "hermes";
    if (/codex/i.test(payload.client)) return "codex";
    if (/claude/i.test(payload.client)) return "claude-code";
  }

  const transcript = (payload.transcriptPath ?? "").replace(/\\/g, "/").toLowerCase();
  if (transcript.includes("/.workbuddy/") || transcript.includes("/.codebuddy/")) {
    return "workbuddy";
  }
  if (transcript.includes("/.codex/")) {
    return "codex";
  }
  if (transcript.includes("/.claude/")) {
    return "claude-code";
  }
  if (transcript.includes("/.grok/")) {
    return "grok";
  }
  if (
    transcript.includes("/.gemini/antigravity") ||
    transcript.includes("/antigravity-cli/") ||
    transcript.includes("/antigravity-ide/")
  ) {
    return "antigravity-cli";
  }
  if (transcript.includes("/.cursor/")) {
    return "cursor";
  }
  if (transcript.includes("/.hermes/")) {
    return "hermes";
  }

  // Host-specific event/payload shape hints before falling back to ambient env vars.
  const rawCompact = (payload.rawEventName ?? "").trim().toLowerCase().replace(/[_-\s]+/g, "");
  if (
    rawCompact === "preinvocation" ||
    rawCompact === "postinvocation" ||
    typeof payload.raw.conversationId === "string" ||
    typeof payload.raw.lastUserInput === "string" ||
    Array.isArray(payload.raw.workspacePaths)
  ) {
    return "antigravity-cli";
  }
  if (
    rawCompact === "prellmcall" ||
    rawCompact === "postllmcall" ||
    rawCompact === "onsessionfinalize" ||
    rawCompact === "onsessionreset" ||
    rawCompact === "onsessionstart" ||
    rawCompact === "onsessionend"
  ) {
    return "hermes";
  }
  if (
    rawCompact === "beforesubmitprompt" ||
    rawCompact === "afteragentresponse" ||
    Array.isArray(payload.raw.workspace_roots)
  ) {
    return "cursor";
  }
  if (typeof payload.raw.workspaceRoot === "string" || typeof payload.raw.promptId === "string") {
    return "grok";
  }

  if (env.WORKBUDDY_CONFIG_DIR || env.CODEBUDDY_CONFIG_DIR || env.WORKBUDDY_PROJECT_DIR) {
    return "workbuddy";
  }
  if (env.GROK_HOOK_EVENT || env.GROK_WORKSPACE_ROOT || env.GROK_SESSION_ID) {
    return "grok";
  }
  if (env.ANTIGRAVITY_CONFIG_DIR) {
    return "antigravity-cli";
  }
  if (env.CURSOR_VERSION || env.CURSOR_PROJECT_DIR) {
    return "cursor";
  }
  if (env.HERMES_HOME || env.HERMES_SESSION_ID) {
    return "hermes";
  }
  if (env.CLAUDE_PROJECT_DIR || env.CLAUDE_ENV_FILE || env.CLAUDECODE) {
    return "claude-code";
  }
  if (env.CODEX_HOME || env.CODEX_THREAD_ID) {
    return "codex";
  }

  return "generic";
}

export function defaultAgentIdForHost(host: HookHost): string {
  switch (host) {
    case "claude-code":
      return "claude-code";
    case "codex":
      return "codex";
    case "workbuddy":
      return "workbuddy";
    case "grok":
      return "grok";
    case "antigravity-cli":
      return "antigravity-cli";
    case "cursor":
      return "cursor";
    case "hermes":
      return "hermes";
    default:
      return "agent-hook";
  }
}

export function parseHookPayload(rawStdin: string, eventOverride?: string): ParsedHookEvent {
  let rawRecord: Record<string, unknown> = {};
  const trimmed = rawStdin.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const record = asRecord(parsed);
      if (record) rawRecord = record;
    } catch {
      // Plain text stdin fallback when invoked manually without JSON envelope.
      rawRecord = { prompt: trimmed };
    }
  }

  const extraRecord = asRecord(rawRecord.extra);

  const rawEventName = firstString(
    eventOverride && eventOverride !== "auto" ? eventOverride : undefined,
    rawRecord.hook_event_name,
    rawRecord.hookEventName,
    rawRecord.event,
    rawRecord.eventName,
  );
  const eventName = normalizeHookEventName(rawEventName);
  const rawCompact = (rawEventName ?? "").trim().toLowerCase().replace(/[_-\s]+/g, "");

  const sessionId = firstString(
    rawRecord.session_id,
    rawRecord.sessionId,
    rawRecord.thread_id,
    rawRecord.threadId,
    rawRecord.conversation_id,
    rawRecord.conversationId,
  );
  const transcriptPath = firstString(
    rawRecord.transcript_path,
    rawRecord.transcriptPath,
    rawRecord.rollout_path,
  );
  const cwd = firstString(
    rawRecord.cwd,
    rawRecord.workspace_dir,
    rawRecord.workspaceDir,
    rawRecord.workspaceRoot,
    firstStringFromArray(rawRecord.workspacePaths),
    firstStringFromArray(rawRecord.workspace_roots),
  );
  const userMessage = firstString(
    extraRecord?.user_message,
    extraRecord?.userMessage,
  );
  const prompt = firstString(
    rawRecord.prompt,
    rawRecord.user_prompt,
    rawRecord.userPrompt,
    rawRecord.lastUserInput,
    userMessage,
    rawRecord.message,
  );
  const lastAssistantMessage = firstString(
    rawRecord.last_assistant_message,
    rawRecord.lastAssistantMessage,
    rawRecord.assistant_message,
    extraRecord?.assistant_response,
    extraRecord?.assistantResponse,
    rawCompact === "afteragentresponse" ? rawRecord.text : undefined,
  );
  const invocationNum = asPositiveNumber(rawRecord.invocationNum ?? rawRecord.invocation_num);
  const stopHookActive =
    rawRecord.stop_hook_active === true ||
    rawRecord.stopHookActive === true ||
    rawRecord.continuationActive === true;
  const reason = firstString(
    rawRecord.reason,
    rawRecord.stop_reason,
    rawRecord.stopReason,
    rawRecord.terminationReason,
    extraRecord?.reason,
  );
  const client = firstString(rawRecord.client, rawRecord.host);

  return {
    eventName,
    rawEventName,
    sessionId,
    transcriptPath,
    cwd,
    prompt,
    userMessage,
    lastAssistantMessage,
    invocationNum,
    stopHookActive,
    reason,
    client,
    raw: rawRecord,
  };
}

/**
 * Format structured hook output compatible with Claude Code, Codex CLI,
 * WorkBuddy, and Grok (all read hookSpecificOutput.additionalContext).
 */
export function formatAdditionalContextOutput(
  eventName: "UserPromptSubmit" | "SessionStart",
  additionalContext: string,
): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext,
    },
  });
}

/**
 * Format host-specific stdout JSON for lifecycle hook events.
 * Returns an empty string when the host expects silent stdout on no-op.
 */
export function formatHookOutput(
  host: HookHost,
  eventName: HookEventName | undefined,
  additionalContext?: string,
): string {
  const cleanContext = additionalContext?.trim() ? additionalContext : undefined;

  if (host === "antigravity-cli") {
    if (eventName === "Stop") {
      return JSON.stringify({ decision: "" });
    }
    if (cleanContext && (eventName === "UserPromptSubmit" || eventName === "SessionStart")) {
      return JSON.stringify({
        injectSteps: [
          {
            systemMessage: {
              systemMessage: cleanContext,
            },
          },
        ],
      });
    }
    return "{}";
  }

  if (host === "cursor") {
    if (eventName === "UserPromptSubmit") {
      return cleanContext
        ? JSON.stringify({ continue: true, additional_context: cleanContext })
        : JSON.stringify({ continue: true });
    }
    if (eventName === "SessionStart") {
      return cleanContext
        ? JSON.stringify({ additional_context: cleanContext })
        : "{}";
    }
    return "{}";
  }

  if (host === "hermes") {
    if (cleanContext && (eventName === "UserPromptSubmit" || eventName === "SessionStart")) {
      return JSON.stringify({ context: cleanContext });
    }
    return "";
  }

  // Claude Code, Codex CLI, WorkBuddy, Grok, and generic hosts.
  if (cleanContext && (eventName === "UserPromptSubmit" || eventName === "SessionStart")) {
    return formatAdditionalContextOutput(eventName, cleanContext);
  }
  return "";
}
