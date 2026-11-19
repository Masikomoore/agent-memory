export type SupportedHookHost = "claude-code" | "codex" | "workbuddy";
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
];

export interface ParsedHookEvent {
  eventName?: HookEventName;
  rawEventName?: string;
  sessionId?: string;
  transcriptPath?: string;
  cwd?: string;
  prompt?: string;
  lastAssistantMessage?: string;
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

export function normalizeHookEventName(value: string | undefined): HookEventName | undefined {
  if (!value) return undefined;
  const compact = value.trim().toLowerCase().replace(/[_-\s]+/g, "");
  switch (compact) {
    case "userpromptsubmit":
    case "beforepromptbuild":
    case "promptsubmit":
      return "UserPromptSubmit";
    case "stop":
    case "turnend":
    case "agentend":
      return "Stop";
    case "precompact":
    case "beforecompact":
      return "PreCompact";
    case "sessionend":
      return "SessionEnd";
    case "sessionstart":
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
  return undefined;
}

export function detectHookHost(
  explicitHost: string | undefined,
  payload: ParsedHookEvent,
  env: NodeJS.ProcessEnv = process.env,
): HookHost {
  const normalized = normalizeHookHost(explicitHost);
  if (normalized && normalized !== "auto") return normalized;

  if (payload.client && /workbuddy|codebuddy/i.test(payload.client)) {
    return "workbuddy";
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

  if (env.WORKBUDDY_CONFIG_DIR || env.CODEBUDDY_CONFIG_DIR || env.WORKBUDDY_PROJECT_DIR) {
    return "workbuddy";
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

  const rawEventName = firstString(
    eventOverride && eventOverride !== "auto" ? eventOverride : undefined,
    rawRecord.hook_event_name,
    rawRecord.hookEventName,
    rawRecord.event,
    rawRecord.eventName,
  );
  const eventName = normalizeHookEventName(rawEventName);

  const sessionId = firstString(
    rawRecord.session_id,
    rawRecord.sessionId,
    rawRecord.thread_id,
    rawRecord.threadId,
    rawRecord.conversation_id,
  );
  const transcriptPath = firstString(
    rawRecord.transcript_path,
    rawRecord.transcriptPath,
    rawRecord.rollout_path,
  );
  const cwd = firstString(rawRecord.cwd, rawRecord.workspace_dir, rawRecord.workspaceDir);
  const prompt = firstString(rawRecord.prompt, rawRecord.user_prompt, rawRecord.userPrompt, rawRecord.message);
  const lastAssistantMessage = firstString(
    rawRecord.last_assistant_message,
    rawRecord.lastAssistantMessage,
    rawRecord.assistant_message,
  );
  const stopHookActive = rawRecord.stop_hook_active === true || rawRecord.stopHookActive === true;
  const reason = firstString(rawRecord.reason, rawRecord.stop_reason, rawRecord.stopReason);
  const client = firstString(rawRecord.client, rawRecord.host);

  return {
    eventName,
    rawEventName,
    sessionId,
    transcriptPath,
    cwd,
    prompt,
    lastAssistantMessage,
    stopHookActive,
    reason,
    client,
    raw: rawRecord,
  };
}

/**
 * Format structured hook output compatible with Claude Code, Codex CLI, and
 * WorkBuddy (all three read hookSpecificOutput.additionalContext).
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
