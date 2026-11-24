import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MemoryServiceError,
  type MemoryCaptureRequest,
  type MemoryService,
  type ValidatedMemoryCaptureRequest,
} from "../core/memory-service.js";
import type { ExtractionStats } from "../memory-categories.js";

export type CaptureJobStatus = "queued" | "running" | "succeeded" | "failed";

export interface CaptureJobError {
  code: string;
  message: string;
}

export interface CaptureJobSnapshot {
  accepted: true;
  mode: "async";
  jobId: string;
  status: CaptureJobStatus;
  deduplicated?: boolean;
  queuePosition?: number;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  agentId: string;
  scope: string;
  sessionKey?: string;
  result?: ExtractionStats;
  error?: CaptureJobError;
}

export interface CaptureQueueStats {
  mode: "async" | "sync";
  queued: number;
  running: number;
  completed: number;
  failed: number;
  deduplicated: number;
  maxQueueSize: number;
  concurrency: number;
}

export interface CaptureQueueLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface CaptureJobQueueConfig {
  defaultAsync?: boolean;
  concurrency?: number;
  maxQueueSize?: number;
  dedupWindowMs?: number;
  jobTtlMs?: number;
  maxRetainedJobs?: number;
  spoolDir?: string;
  maxRecoveryAttempts?: number;
  logger?: CaptureQueueLogger;
}

export interface EnqueueCaptureInput {
  request: MemoryCaptureRequest;
  idempotencyKey?: string;
}

interface CaptureJobRecord {
  jobId: string;
  status: CaptureJobStatus;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  finishedAtMs?: number;
  attempts: number;
  request: ValidatedMemoryCaptureRequest;
  idempotencyKey?: string;
  dedupKeys: string[];
  result?: ExtractionStats;
  error?: CaptureJobError;
  promise: Promise<ExtractionStats>;
  resolve: (value: ExtractionStats) => void;
  reject: (reason: unknown) => void;
}

interface DedupEntry {
  jobId: string;
  expiresAt: number;
}

interface SpoolRecord {
  jobId: string;
  queuedAt: string;
  attempts: number;
  request: ValidatedMemoryCaptureRequest;
  idempotencyKey?: string;
}

const NOOP_LOGGER: CaptureQueueLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const DEFAULT_CONCURRENCY = 1;
const DEFAULT_MAX_QUEUE_SIZE = 128;
const DEFAULT_DEDUP_WINDOW_MS = 300_000;
const DEFAULT_JOB_TTL_MS = 3_600_000;
const DEFAULT_MAX_RETAINED_JOBS = 500;
const DEFAULT_MAX_RECOVERY_ATTEMPTS = 2;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function computeDedupKeys(
  validated: ValidatedMemoryCaptureRequest,
  idempotencyKey?: string,
): { idemKey?: string; contentKey: string; all: string[] } {
  const contentKey = `content:${sha256Hex(
    JSON.stringify({
      agentId: validated.agentId,
      scope: validated.scope,
      text: validated.conversationText.trim(),
    }),
  )}`;
  const normalizedIdem = idempotencyKey?.trim();
  const idemKey = normalizedIdem
    ? `idem:${sha256Hex(
        JSON.stringify({
          agentId: validated.agentId,
          scope: validated.scope,
          key: normalizedIdem,
        }),
      )}`
    : undefined;
  return {
    idemKey,
    contentKey,
    all: idemKey ? [idemKey, contentKey] : [contentKey],
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Background callers may not await promise; prevent UnhandledPromiseRejection.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

/**
 * Bounded, deduplicating async job queue for memory capture requests.
 *
 * Validates capture authorization synchronously before returning `202 Accepted`,
 * serializes or bounds extraction/embedding concurrency, coalesces identical
 * retries, and optionally spools queued work to disk for crash recovery.
 */
export class CaptureJobQueue {
  readonly defaultAsync: boolean;
  private readonly concurrency: number;
  private readonly maxQueueSize: number;
  private readonly dedupWindowMs: number;
  private readonly jobTtlMs: number;
  private readonly maxRetainedJobs: number;
  private readonly spoolDir?: string;
  private readonly maxRecoveryAttempts: number;
  private readonly logger: CaptureQueueLogger;

  private readonly jobs = new Map<string, CaptureJobRecord>();
  private readonly dedupIndex = new Map<string, DedupEntry>();
  private readonly pending: CaptureJobRecord[] = [];
  private readonly drainWaiters = new Set<() => void>();

  private runningCount = 0;
  private completedCount = 0;
  private failedCount = 0;
  private deduplicatedCount = 0;
  private closing = false;

  constructor(
    private readonly service: MemoryService,
    config: CaptureJobQueueConfig = {},
  ) {
    this.defaultAsync = config.defaultAsync ?? true;
    this.concurrency = Math.max(1, Math.floor(config.concurrency ?? DEFAULT_CONCURRENCY));
    this.maxQueueSize = Math.max(1, Math.floor(config.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE));
    this.dedupWindowMs = Math.max(0, Math.floor(config.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS));
    this.jobTtlMs = Math.max(1_000, Math.floor(config.jobTtlMs ?? DEFAULT_JOB_TTL_MS));
    this.maxRetainedJobs = Math.max(1, Math.floor(config.maxRetainedJobs ?? DEFAULT_MAX_RETAINED_JOBS));
    this.spoolDir = config.spoolDir?.trim() || undefined;
    this.maxRecoveryAttempts = Math.max(1, Math.floor(config.maxRecoveryAttempts ?? DEFAULT_MAX_RECOVERY_ATTEMPTS));
    this.logger = config.logger ?? NOOP_LOGGER;
  }

  private validateRequest(request: MemoryCaptureRequest): ValidatedMemoryCaptureRequest {
    if (this.service.validateCapture) {
      return this.service.validateCapture(request);
    }
    if (!request.conversationText?.trim()) {
      throw new MemoryServiceError(
        "Memory capture conversationText cannot be empty",
        "invalid_conversation",
        400,
      );
    }
    return {
      ...request,
      sessionKey: request.sessionKey?.trim() || "unknown",
      agentId: request.agentId?.trim() || "main",
      scope: request.scope?.trim() || "global",
    };
  }

  private isTerminal(job: CaptureJobRecord): boolean {
    return job.status === "succeeded" || job.status === "failed";
  }

  private deleteDedupKeysForJob(job: CaptureJobRecord): void {
    for (const key of job.dedupKeys) {
      const entry = this.dedupIndex.get(key);
      if (entry?.jobId === job.jobId) {
        this.dedupIndex.delete(key);
      }
    }
  }

  private prune(now: number = Date.now()): void {
    for (const [key, entry] of this.dedupIndex.entries()) {
      const job = this.jobs.get(entry.jobId);
      if (!job) {
        this.dedupIndex.delete(key);
        continue;
      }
      if (this.isTerminal(job) && entry.expiresAt <= now) {
        this.dedupIndex.delete(key);
      }
    }

    for (const [jobId, job] of this.jobs.entries()) {
      if (!this.isTerminal(job) || job.finishedAtMs === undefined) continue;
      if (job.finishedAtMs + this.jobTtlMs <= now) {
        this.deleteDedupKeysForJob(job);
        this.jobs.delete(jobId);
      }
    }

    if (this.jobs.size > this.maxRetainedJobs) {
      for (const [jobId, job] of this.jobs.entries()) {
        if (this.jobs.size <= this.maxRetainedJobs) break;
        if (!this.isTerminal(job)) continue;
        this.deleteDedupKeysForJob(job);
        this.jobs.delete(jobId);
      }
    }
  }

  private toSnapshot(job: CaptureJobRecord, deduplicated = false): CaptureJobSnapshot {
    let queuePosition: number | undefined;
    if (job.status === "running") {
      queuePosition = 0;
    } else if (job.status === "queued") {
      const idx = this.pending.indexOf(job);
      if (idx >= 0) queuePosition = idx + 1;
    }

    return {
      accepted: true,
      mode: "async",
      jobId: job.jobId,
      status: job.status,
      ...(deduplicated ? { deduplicated: true } : {}),
      ...(queuePosition !== undefined ? { queuePosition } : {}),
      queuedAt: job.queuedAt,
      ...(job.startedAt ? { startedAt: job.startedAt } : {}),
      ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
      agentId: job.request.agentId,
      scope: job.request.scope,
      ...(job.request.sessionKey ? { sessionKey: job.request.sessionKey } : {}),
      ...(job.result !== undefined ? { result: job.result } : {}),
      ...(job.error !== undefined ? { error: job.error } : {}),
    };
  }

  private spoolPath(jobId: string): string | undefined {
    return this.spoolDir ? path.join(this.spoolDir, `${jobId}.json`) : undefined;
  }

  private async writeSpool(job: CaptureJobRecord): Promise<void> {
    const filePath = this.spoolPath(job.jobId);
    if (!filePath || !this.spoolDir) return;
    try {
      await mkdir(this.spoolDir, { recursive: true });
      const payload: SpoolRecord = {
        jobId: job.jobId,
        queuedAt: job.queuedAt,
        attempts: job.attempts,
        request: job.request,
        ...(job.idempotencyKey ? { idempotencyKey: job.idempotencyKey } : {}),
      };
      const tmpPath = `${filePath}.${randomUUID()}.tmp`;
      await writeFile(tmpPath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
      await rename(tmpPath, filePath);
    } catch (error) {
      this.logger.warn(
        `capture-queue: failed to persist spool record ${job.jobId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async removeSpool(jobId: string): Promise<void> {
    const filePath = this.spoolPath(jobId);
    if (!filePath) return;
    try {
      await rm(filePath, { force: true });
    } catch (error) {
      this.logger.warn(
        `capture-queue: failed to remove spool record ${jobId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private createAndRegisterJob(
    validated: ValidatedMemoryCaptureRequest,
    dedupKeys: string[],
    options: { jobId?: string; queuedAt?: string; attempts?: number; idempotencyKey?: string } = {},
  ): CaptureJobRecord {
    const deferred = createDeferred<ExtractionStats>();
    const job: CaptureJobRecord = {
      jobId: options.jobId ?? randomUUID(),
      status: "queued",
      queuedAt: options.queuedAt ?? new Date().toISOString(),
      attempts: options.attempts ?? 0,
      request: validated,
      idempotencyKey: options.idempotencyKey,
      dedupKeys,
      promise: deferred.promise,
      resolve: deferred.resolve,
      reject: deferred.reject,
    };

    this.jobs.set(job.jobId, job);
    if (this.dedupWindowMs > 0) {
      const expiresAt = Date.now() + this.dedupWindowMs;
      for (const key of dedupKeys) {
        this.dedupIndex.set(key, { jobId: job.jobId, expiresAt });
      }
    }
    return job;
  }

  async enqueue(
    input: EnqueueCaptureInput,
  ): Promise<{ snapshot: CaptureJobSnapshot; promise: Promise<ExtractionStats> }> {
    if (this.closing) {
      throw new MemoryServiceError(
        "Memory server is shutting down",
        "server_shutting_down",
        503,
      );
    }

    const validated = this.validateRequest(input.request);
    const now = Date.now();
    this.prune(now);

    const keys = computeDedupKeys(validated, input.idempotencyKey);
    if (this.dedupWindowMs > 0) {
      for (const key of keys.all) {
        const entry = this.dedupIndex.get(key);
        if (!entry) continue;
        const existing = this.jobs.get(entry.jobId);
        if (!existing) {
          this.dedupIndex.delete(key);
          continue;
        }
        const reusable =
          existing.status === "queued" ||
          existing.status === "running" ||
          (existing.status === "succeeded" && existing.result?.llmUnavailable !== true);
        if (!reusable) continue;

        this.deduplicatedCount += 1;
        return {
          snapshot: this.toSnapshot(existing, true),
          promise: existing.promise,
        };
      }
    }

    if (this.pending.length >= this.maxQueueSize) {
      throw new MemoryServiceError(
        "Capture queue is full; retry later",
        "capture_queue_full",
        429,
      );
    }

    const job = this.createAndRegisterJob(validated, keys.all, {
      idempotencyKey: input.idempotencyKey?.trim() || undefined,
    });
    await this.writeSpool(job);
    this.pending.push(job);
    this.pump();

    return {
      snapshot: this.toSnapshot(job, false),
      promise: job.promise,
    };
  }

  async enqueueAndWait(input: EnqueueCaptureInput): Promise<ExtractionStats> {
    const { promise } = await this.enqueue(input);
    return await promise;
  }

  private pump(): void {
    while (this.runningCount < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift()!;
      this.runningCount += 1;
      job.status = "running";
      job.startedAt = new Date().toISOString();
      job.attempts += 1;
      void this.runJob(job);
    }
  }

  private async runJob(job: CaptureJobRecord): Promise<void> {
    try {
      await this.writeSpool(job);
      const stats = await this.service.capture(job.request);
      const now = Date.now();
      job.status = "succeeded";
      job.finishedAt = new Date(now).toISOString();
      job.finishedAtMs = now;
      job.result = stats;
      this.completedCount += 1;

      if (stats.llmUnavailable === true) {
        this.deleteDedupKeysForJob(job);
      } else if (this.dedupWindowMs > 0) {
        const expiresAt = now + this.dedupWindowMs;
        for (const key of job.dedupKeys) {
          this.dedupIndex.set(key, { jobId: job.jobId, expiresAt });
        }
      }

      await this.removeSpool(job.jobId);
      job.resolve(stats);
    } catch (error) {
      const now = Date.now();
      const code = error instanceof MemoryServiceError ? error.code : "capture_failed";
      const message = error instanceof Error ? error.message : String(error);
      job.status = "failed";
      job.finishedAt = new Date(now).toISOString();
      job.finishedAtMs = now;
      job.error = { code, message };
      this.failedCount += 1;

      this.deleteDedupKeysForJob(job);
      await this.removeSpool(job.jobId);
      this.logger.error(`capture-queue: job ${job.jobId} failed (${code}): ${message}`);
      job.reject(error);
    } finally {
      this.runningCount -= 1;
      this.prune();
      if (this.runningCount === 0 && this.pending.length === 0) {
        for (const notify of this.drainWaiters) notify();
      }
      this.pump();
    }
  }

  getJob(jobId: string): CaptureJobSnapshot | undefined {
    this.prune();
    const job = this.jobs.get(jobId);
    return job ? this.toSnapshot(job, false) : undefined;
  }

  stats(): CaptureQueueStats {
    this.prune();
    return {
      mode: this.defaultAsync ? "async" : "sync",
      queued: this.pending.length,
      running: this.runningCount,
      completed: this.completedCount,
      failed: this.failedCount,
      deduplicated: this.deduplicatedCount,
      maxQueueSize: this.maxQueueSize,
      concurrency: this.concurrency,
    };
  }

  async recoverPendingJobs(): Promise<number> {
    if (!this.spoolDir || this.closing) return 0;

    let entries: string[];
    try {
      entries = await readdir(this.spoolDir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (code === "ENOENT") return 0;
      throw error;
    }

    const candidates: SpoolRecord[] = [];
    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      const fullPath = path.join(this.spoolDir, name);
      try {
        const raw = await readFile(fullPath, "utf8");
        const parsed = JSON.parse(raw) as Partial<SpoolRecord>;
        if (
          typeof parsed.jobId !== "string" ||
          !parsed.jobId ||
          typeof parsed.queuedAt !== "string" ||
          typeof parsed.attempts !== "number" ||
          !parsed.request ||
          typeof parsed.request.conversationText !== "string"
        ) {
          this.logger.warn(`capture-queue: discarding malformed spool file ${name}`);
          await rm(fullPath, { force: true });
          continue;
        }
        if (parsed.attempts >= this.maxRecoveryAttempts) {
          this.logger.warn(
            `capture-queue: discarding spool job ${parsed.jobId} after ${parsed.attempts} attempt(s)`,
          );
          await rm(fullPath, { force: true });
          continue;
        }
        candidates.push(parsed as SpoolRecord);
      } catch (error) {
        this.logger.warn(
          `capture-queue: discarding unreadable spool file ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
        await rm(fullPath, { force: true }).catch(() => {});
      }
    }

    candidates.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));

    let recovered = 0;
    for (const item of candidates) {
      if (this.jobs.has(item.jobId)) continue;
      let validated: ValidatedMemoryCaptureRequest;
      try {
        validated = this.validateRequest(item.request);
      } catch (error) {
        this.logger.warn(
          `capture-queue: dropping recovered job ${item.jobId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        await this.removeSpool(item.jobId);
        continue;
      }

      const keys = computeDedupKeys(validated, item.idempotencyKey);
      const job = this.createAndRegisterJob(validated, keys.all, {
        jobId: item.jobId,
        queuedAt: item.queuedAt,
        attempts: item.attempts,
        idempotencyKey: item.idempotencyKey,
      });
      this.pending.push(job);
      recovered += 1;
    }

    if (recovered > 0) {
      this.pump();
    }
    return recovered;
  }

  async drain(timeoutMs = 30_000): Promise<{ drained: boolean; remaining: number }> {
    this.closing = true;
    const currentRemaining = () => this.pending.length + this.runningCount;
    if (currentRemaining() === 0) {
      return { drained: true, remaining: 0 };
    }

    const boundedTimeout = Math.max(0, Math.floor(timeoutMs));
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.drainWaiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, boundedTimeout);
      this.drainWaiters.add(finish);
      if (currentRemaining() === 0) finish();
    });

    const remaining = currentRemaining();
    return { drained: remaining === 0, remaining };
  }
}
