import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import {
  buildBoundedTranscript,
  normalizeAutoCaptureText,
  type ConversationTurn,
} from "../auto-capture-cleanup.js";
import type { HookSessionState, HookTranscriptCursor } from "./hook-state.js";

export const DEFAULT_MAX_CAPTURE_CHARS = 8_000;
export const DEFAULT_MAX_ASSISTANT_TURN_CHARS = 1_200;
export const DEFAULT_UNKNOWN_WATERMARK_MAX_TURNS = 6;

const INJECTED_BLOCK_PATTERNS: RegExp[] = [
  /<relevant-memories>[\s\S]*?<\/relevant-memories>/gi,
  /<system-reminder>[\s\S]*?<\/system-reminder>/gi,
  /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/gi,
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi,
  /<command-name>[\s\S]*?<\/command-name>/gi,
  /<command-message>[\s\S]*?<\/command-message>/gi,
  /<command-args>[\s\S]*?<\/command-args>/gi,
  /<environment_context>[\s\S]*?<\/environment_context>/gi,
  /<user_instructions>[\s\S]*?<\/user_instructions>/gi,
  /<permissions\s+instructions>[\s\S]*?<\/permissions\s+instructions>/gi,
];

const IGNORED_JSONL_TYPES = new Set([
  "system",
  "summary",
  "progress",
  "file-history-snapshot",
  "queue-operation",
  "session_meta",
  "turn_context",
  "compacted",
]);

const TEXT_BLOCK_TYPES = new Set(["text", "input_text", "output_text"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function stripInjectedHookContext(text: string): string {
  let cleaned = text;
  for (const pattern of INJECTED_BLOCK_PATTERNS) {
    cleaned = cleaned.replace(pattern, "\n");
  }
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

export function sanitizeHookTurnText(
  role: "user" | "assistant",
  rawText: string,
  maxAssistantChars: number = DEFAULT_MAX_ASSISTANT_TURN_CHARS,
): string {
  const withoutInjected = stripInjectedHookContext(rawText);
  if (!withoutInjected) return "";
  const normalized = normalizeAutoCaptureText(role, withoutInjected);
  if (!normalized) return "";
  if (role === "user" && /^\/[a-zA-Z0-9_-]+(?:\s.*)?$/.test(normalized)) {
    return "";
  }
  if (role === "assistant" && maxAssistantChars > 0 && normalized.length > maxAssistantChars) {
    return `${normalized.slice(0, maxAssistantChars - 1).trimEnd()}…`;
  }
  return normalized;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      if (block.trim()) parts.push(block);
      continue;
    }
    const record = asRecord(block);
    if (!record) continue;
    const type = typeof record.type === "string" ? record.type : "";
    // Strictly skip tool_use / tool_result / thinking / reasoning / media blocks
    // so recalled memory tool outputs and large code diffs never loop back into capture.
    if (type && !TEXT_BLOCK_TYPES.has(type)) continue;
    const text = asString(record.text) ?? asString(record.content);
    if (text) parts.push(text);
  }
  return parts.join("\n").trim();
}

function collapseAdjacentDuplicates(turns: ConversationTurn[]): ConversationTurn[] {
  const deduped: ConversationTurn[] = [];
  for (const turn of turns) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.role === turn.role && prev.text === turn.text) continue;
    deduped.push(turn);
  }
  return deduped;
}

export interface ParseTranscriptOptions {
  includeAssistant?: boolean;
  maxAssistantTurnChars?: number;
}

/**
 * Parse Claude Code, Codex rollout, and WorkBuddy JSONL transcripts into clean
 * user/assistant turns. Tool invocations, tool results, meta/sidechain records,
 * and injected <relevant-memories> blocks are stripped to avoid feedback loops.
 */
export function parseTranscriptJsonl(
  content: string,
  options: ParseTranscriptOptions = {},
): ConversationTurn[] {
  const includeAssistant = options.includeAssistant !== false;
  const maxAssistantTurnChars = options.maxAssistantTurnChars ?? DEFAULT_MAX_ASSISTANT_TURN_CHARS;
  const claudeOrGenericTurns: ConversationTurn[] = [];
  const codexEventTurns: ConversationTurn[] = [];
  const codexResponseTurns: ConversationTurn[] = [];

  const pushTurn = (target: ConversationTurn[], role: "user" | "assistant", rawText: string) => {
    if (role === "assistant" && !includeAssistant) return;
    const cleaned = sanitizeHookTurnText(role, rawText, maxAssistantTurnChars);
    if (cleaned) target.push({ role, text: cleaned });
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = asRecord(parsed);
    if (!entry) continue;
    if (entry.isMeta === true || entry.isSidechain === true) continue;

    const entryType = typeof entry.type === "string" ? entry.type : undefined;
    if (entryType && IGNORED_JSONL_TYPES.has(entryType)) continue;

    // 1. Codex rollout event_msg format (preferred for Codex rollouts because it
    //    carries clean human/agent turns without developer bootstrap wrappers).
    if (entryType === "event_msg") {
      const payload = asRecord(entry.payload);
      const payloadType = typeof payload?.type === "string" ? payload.type : undefined;
      if (payloadType === "user_message") {
        const text = asString(payload?.message) ?? asString(payload?.text) ?? extractTextFromContent(payload?.content);
        if (text) pushTurn(codexEventTurns, "user", text);
      } else if (payloadType === "agent_message") {
        const text = asString(payload?.message) ?? asString(payload?.text) ?? extractTextFromContent(payload?.content);
        if (text) pushTurn(codexEventTurns, "assistant", text);
      }
      continue;
    }

    // 2. Codex rollout response_item format (fallback when event_msg is absent).
    if (entryType === "response_item") {
      const payload = asRecord(entry.payload);
      if (payload?.type !== "message") continue;
      const role = payload.role;
      if (role !== "user" && role !== "assistant") continue;
      const text = extractTextFromContent(payload.content);
      if (text) pushTurn(codexResponseTurns, role, text);
      continue;
    }

    // 3. Claude Code / WorkBuddy JSONL format (`type: "user" | "assistant"` with `message.content`).
    if (entryType === "user" || entryType === "assistant") {
      const message = asRecord(entry.message);
      const text = extractTextFromContent(message?.content ?? entry.content ?? entry.text);
      if (text) pushTurn(claudeOrGenericTurns, entryType, text);
      continue;
    }

    // 4. Generic chat JSONL fallback (`{ role: "user" | "assistant", content }`).
    const role = entry.role;
    if (role === "user" || role === "assistant") {
      const text = extractTextFromContent(entry.content ?? entry.text);
      if (text) pushTurn(claudeOrGenericTurns, role, text);
    }
  }

  // Codex rollouts often emit both event_msg and response_item for the same turn.
  // Prefer event_msg when present to avoid doubling turns or pulling bootstrap wrappers.
  if (codexEventTurns.length > 0) {
    return collapseAdjacentDuplicates(codexEventTurns);
  }
  if (claudeOrGenericTurns.length > 0) {
    return collapseAdjacentDuplicates(claudeOrGenericTurns);
  }
  if (codexResponseTurns.length > 0) {
    return collapseAdjacentDuplicates(codexResponseTurns);
  }
  return [];
}

export interface ExtractCaptureDeltaParams {
  transcriptPath?: string;
  state: HookSessionState;
  lastAssistantMessage?: string;
  includeAssistant?: boolean;
  maxCaptureChars?: number;
  maxAssistantTurnChars?: number;
  unknownWatermarkMaxTurns?: number;
}

export interface ExtractedCaptureDelta {
  conversationText: string;
  contentHash: string;
  source: "transcript" | "fallback-pair" | "none";
  turnCount: number;
  nextCursor?: HookTranscriptCursor;
  consumedLastPrompt: boolean;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Extract only the newly added turns since the session's last watermark.
 * Falls back to pairing the cached UserPromptSubmit prompt with Stop's
 * last_assistant_message when transcript_path is missing, unflushed, or
 * uses an unexpected schema.
 */
export function extractCaptureDelta(params: ExtractCaptureDeltaParams): ExtractedCaptureDelta {
  const includeAssistant = params.includeAssistant !== false;
  const maxCaptureChars = params.maxCaptureChars ?? DEFAULT_MAX_CAPTURE_CHARS;
  const maxAssistantTurnChars = params.maxAssistantTurnChars ?? DEFAULT_MAX_ASSISTANT_TURN_CHARS;
  const unknownWatermarkMaxTurns = params.unknownWatermarkMaxTurns ?? DEFAULT_UNKNOWN_WATERMARK_MAX_TURNS;

  let nextCursor: HookTranscriptCursor | undefined = params.state.transcriptCursor;
  let candidateTurns: ConversationTurn[] = [];
  let source: ExtractedCaptureDelta["source"] = "none";

  const transcriptPath = params.transcriptPath?.trim();
  if (transcriptPath) {
    try {
      const stats = statSync(transcriptPath);
      const raw = readFileSync(transcriptPath, "utf8");
      const allTurns = parseTranscriptJsonl(raw, { includeAssistant, maxAssistantTurnChars });

      if (allTurns.length > 0) {
        const prev = params.state.transcriptCursor;
        const sameUnrewoundFile = Boolean(
          prev &&
          prev.path === transcriptPath &&
          stats.size >= prev.lastTranscriptSize &&
          allTurns.length >= prev.seenTurnCount,
        );

        if (sameUnrewoundFile) {
          candidateTurns = allTurns.slice(prev!.seenTurnCount);
        } else if (!prev) {
          // First run on a pre-existing long session: cap the initial batch so
          // stale history is not blasted into a single expensive extraction.
          candidateTurns = allTurns.length > unknownWatermarkMaxTurns
            ? allTurns.slice(-unknownWatermarkMaxTurns)
            : allTurns;
        } else {
          // Rewound or compacted transcript: take bounded tail and re-baseline.
          candidateTurns = allTurns.length > unknownWatermarkMaxTurns
            ? allTurns.slice(-unknownWatermarkMaxTurns)
            : allTurns;
        }

        nextCursor = {
          path: transcriptPath,
          seenTurnCount: allTurns.length,
          lastTranscriptSize: stats.size,
        };
        if (candidateTurns.some((turn) => turn.role === "user")) {
          source = "transcript";
        } else {
          candidateTurns = [];
        }
      }
    } catch {
      // Fall through to cached prompt + lastAssistantMessage pair fallback.
    }
  }

  let consumedLastPrompt = false;
  if (candidateTurns.length === 0 && params.state.lastPrompt?.text) {
    const cleanUser = sanitizeHookTurnText("user", params.state.lastPrompt.text, maxAssistantTurnChars);
    if (cleanUser) {
      candidateTurns.push({ role: "user", text: cleanUser });
      if (includeAssistant && params.lastAssistantMessage) {
        const cleanAssistant = sanitizeHookTurnText(
          "assistant",
          params.lastAssistantMessage,
          maxAssistantTurnChars,
        );
        if (cleanAssistant) {
          candidateTurns.push({ role: "assistant", text: cleanAssistant });
        }
      }
      source = "fallback-pair";
      consumedLastPrompt = true;
    }
  } else if (source === "transcript") {
    consumedLastPrompt = true;
  }

  if (candidateTurns.length === 0) {
    return {
      conversationText: "",
      contentHash: "",
      source: "none",
      turnCount: 0,
      nextCursor,
      consumedLastPrompt: false,
    };
  }

  const conversationText = buildBoundedTranscript(candidateTurns, maxCaptureChars);
  if (!conversationText) {
    return {
      conversationText: "",
      contentHash: "",
      source: "none",
      turnCount: 0,
      nextCursor,
      consumedLastPrompt: false,
    };
  }

  const contentHash = sha256Hex(conversationText);
  if (params.state.lastCapturedHash && params.state.lastCapturedHash === contentHash) {
    return {
      conversationText: "",
      contentHash,
      source: "none",
      turnCount: 0,
      nextCursor,
      consumedLastPrompt,
    };
  }

  return {
    conversationText,
    contentHash,
    source,
    turnCount: candidateTurns.length,
    nextCursor,
    consumedLastPrompt,
  };
}
