import { createHash, randomBytes } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const HOOK_STATE_VERSION = 1;
export const DEFAULT_SESSION_STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOCK_STALE_MS = 60_000;
const LOCK_WAIT_MS = 10_000;
const LOCK_RETRY_MIN_MS = 25;
const LOCK_RETRY_MAX_MS = 120;
const MAX_RECALLED_IDS = 200;

export interface HookTranscriptCursor {
  path: string;
  seenTurnCount: number;
  lastTranscriptSize: number;
}

export interface HookSessionState {
  version: typeof HOOK_STATE_VERSION;
  agentId: string;
  sessionKey: string;
  updatedAt: number;
  turnCount: number;
  recalledAtTurn: Record<string, number>;
  lastPrompt?: {
    text: string;
    at: number;
  };
  transcriptCursor?: HookTranscriptCursor;
  lastCapturedHash?: string;
}

export function resolveHookStateDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = homedir(),
  overrideDir?: string,
): string {
  const explicit = overrideDir?.trim() || env.MEMORY_HOOK_STATE_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  const xdgCache = env.XDG_CACHE_HOME?.trim();
  const baseDir = xdgCache || path.join(homeDir, ".cache");
  return path.join(baseDir, "agent-memory-hook");
}

export function sessionStateKeyHash(agentId: string, sessionKey: string): string {
  return createHash("sha256")
    .update(`${agentId}\0${sessionKey}`)
    .digest("hex")
    .slice(0, 32);
}

export function sessionStateFilePath(stateDir: string, agentId: string, sessionKey: string): string {
  return path.join(stateDir, `session-${sessionStateKeyHash(agentId, sessionKey)}.json`);
}

export function createEmptySessionState(
  agentId: string,
  sessionKey: string,
  now: number = Date.now(),
): HookSessionState {
  return {
    version: HOOK_STATE_VERSION,
    agentId,
    sessionKey,
    updatedAt: now,
    turnCount: 0,
    recalledAtTurn: {},
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function loadSessionState(
  stateDir: string,
  agentId: string,
  sessionKey: string,
  now: number = Date.now(),
): HookSessionState {
  const filePath = sessionStateFilePath(stateDir, agentId, sessionKey);
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!isPlainRecord(raw) || raw.version !== HOOK_STATE_VERSION) {
      return createEmptySessionState(agentId, sessionKey, now);
    }

    const recalledAtTurn: Record<string, number> = {};
    if (isPlainRecord(raw.recalledAtTurn)) {
      for (const [id, turn] of Object.entries(raw.recalledAtTurn)) {
        if (typeof turn === "number" && Number.isFinite(turn)) {
          recalledAtTurn[id] = Math.floor(turn);
        }
      }
    }

    let lastPrompt: HookSessionState["lastPrompt"];
    if (
      isPlainRecord(raw.lastPrompt) &&
      typeof raw.lastPrompt.text === "string" &&
      raw.lastPrompt.text.trim() &&
      typeof raw.lastPrompt.at === "number" &&
      Number.isFinite(raw.lastPrompt.at)
    ) {
      lastPrompt = { text: raw.lastPrompt.text, at: raw.lastPrompt.at };
    }

    let transcriptCursor: HookTranscriptCursor | undefined;
    if (
      isPlainRecord(raw.transcriptCursor) &&
      typeof raw.transcriptCursor.path === "string" &&
      typeof raw.transcriptCursor.seenTurnCount === "number" &&
      Number.isInteger(raw.transcriptCursor.seenTurnCount) &&
      raw.transcriptCursor.seenTurnCount >= 0 &&
      typeof raw.transcriptCursor.lastTranscriptSize === "number" &&
      Number.isFinite(raw.transcriptCursor.lastTranscriptSize) &&
      raw.transcriptCursor.lastTranscriptSize >= 0
    ) {
      transcriptCursor = {
        path: raw.transcriptCursor.path,
        seenTurnCount: raw.transcriptCursor.seenTurnCount,
        lastTranscriptSize: raw.transcriptCursor.lastTranscriptSize,
      };
    }

    return {
      version: HOOK_STATE_VERSION,
      agentId,
      sessionKey,
      updatedAt: typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
      turnCount: typeof raw.turnCount === "number" && Number.isInteger(raw.turnCount) && raw.turnCount >= 0
        ? raw.turnCount
        : 0,
      recalledAtTurn,
      ...(lastPrompt ? { lastPrompt } : {}),
      ...(transcriptCursor ? { transcriptCursor } : {}),
      ...(typeof raw.lastCapturedHash === "string" && raw.lastCapturedHash
        ? { lastCapturedHash: raw.lastCapturedHash }
        : {}),
    };
  } catch {
    return createEmptySessionState(agentId, sessionKey, now);
  }
}

function trimRecalledMap(recalledAtTurn: Record<string, number>): Record<string, number> {
  const entries = Object.entries(recalledAtTurn);
  if (entries.length <= MAX_RECALLED_IDS) return recalledAtTurn;
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, MAX_RECALLED_IDS));
}

export function saveSessionState(
  stateDir: string,
  state: HookSessionState,
  now: number = Date.now(),
): void {
  mkdirSync(stateDir, { recursive: true });
  const filePath = sessionStateFilePath(stateDir, state.agentId, state.sessionKey);
  const tmpPath = `${filePath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  const payload: HookSessionState = {
    ...state,
    version: HOOK_STATE_VERSION,
    updatedAt: now,
    recalledAtTurn: trimRecalledMap(state.recalledAtTurn),
  };
  try {
    writeFileSync(tmpPath, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // ignore temp cleanup failure
    }
    throw error;
  }
}

export function deleteSessionState(stateDir: string, agentId: string, sessionKey: string): void {
  try {
    rmSync(sessionStateFilePath(stateDir, agentId, sessionKey), { force: true });
  } catch {
    // ignore cleanup failure
  }
}

export function pruneExpiredSessionStates(
  stateDir: string,
  maxAgeMs: number = DEFAULT_SESSION_STATE_TTL_MS,
  now: number = Date.now(),
): number {
  let removed = 0;
  let entries: string[];
  try {
    entries = readdirSync(stateDir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    if (!name.startsWith("session-") && !name.startsWith("task-")) continue;
    const fullPath = path.join(stateDir, name);
    try {
      const stats = statSync(fullPath);
      if (now - stats.mtimeMs > maxAgeMs) {
        rmSync(fullPath, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      // ignore concurrent removal
    }
  }
  return removed;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serialize per-session state updates across concurrent background workers
 * using an atomic mkdir lock with stale-lock takeover.
 */
export async function withSessionLock<T>(
  stateDir: string,
  agentId: string,
  sessionKey: string,
  fn: () => Promise<T>,
  options: { waitMs?: number; staleMs?: number } = {},
): Promise<T> {
  mkdirSync(stateDir, { recursive: true });
  const lockDir = path.join(stateDir, `lock-${sessionStateKeyHash(agentId, sessionKey)}`);
  const waitMs = options.waitMs ?? LOCK_WAIT_MS;
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  const deadline = Date.now() + waitMs;
  let acquired = false;

  while (!acquired) {
    try {
      mkdirSync(lockDir);
      acquired = true;
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "EEXIST") throw error;

      try {
        const stats = statSync(lockDir);
        if (Date.now() - stats.mtimeMs > staleMs) {
          rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }

      if (Date.now() >= deadline) {
        // Fail-open rather than stalling a host hook indefinitely.
        break;
      }
      const jitter = LOCK_RETRY_MIN_MS + Math.floor(Math.random() * (LOCK_RETRY_MAX_MS - LOCK_RETRY_MIN_MS));
      await sleep(jitter);
    }
  }

  try {
    return await fn();
  } finally {
    if (acquired) {
      try {
        rmSync(lockDir, { recursive: true, force: true });
      } catch {
        // ignore lock cleanup failure
      }
    }
  }
}
