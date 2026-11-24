import path from "node:path";
import { normalizeAdmissionControlConfig } from "../admission-control.js";
import {
  createMemoryCore,
  createMemoryExtractionRuntime,
  createMemoryService,
  type MemoryCore,
  type MemoryExtractionRuntime,
  type MemoryService,
} from "../core/index.js";
import { createLlmClient } from "../llm-client.js";
import { drainManualRecallMetadata } from "../manual-recall-metadata-queue.js";
import { CaptureJobQueue } from "./capture-queue.js";
import type { MemoryServerConfig } from "./config.js";
import type { MemoryHttpRuntime, MemoryHttpLogger } from "./http-server.js";

export interface StandaloneMemoryRuntime extends MemoryHttpRuntime {
  core: MemoryCore;
  extractionRuntime: MemoryExtractionRuntime;
  service: MemoryService;
  captureQueue: CaptureJobQueue;
  recoverPendingCaptures(): Promise<number>;
  close(): Promise<void>;
}

const DEFAULT_LOGGER: MemoryHttpLogger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
  debug: (message) => console.debug(message),
};

export function createStandaloneMemoryRuntime(
  config: MemoryServerConfig,
  logger: MemoryHttpLogger = DEFAULT_LOGGER,
): StandaloneMemoryRuntime {
  const core = createMemoryCore({
    dbPath: config.dbPath,
    embedding: config.embedding,
    logger,
  });

  const llmClient = config.captureEnabled && config.llm
    ? createLlmClient({
        ...config.llm,
        log: (message) => logger.debug(message),
        warnLog: (message) => logger.warn(message),
      })
    : undefined;
  const extractionRuntime = createMemoryExtractionRuntime(core, {
    enabled: config.captureEnabled,
    llmClient,
    admission: {
      // Keep phase-1 behavior conservative: the upstream extraction/dedup
      // algorithms are reused unchanged; admission remains opt-out unless we
      // expose its standalone configuration deliberately in a later slice.
      config: normalizeAdmissionControlConfig({ enabled: false }),
    },
    extractor: {
      defaultScope: config.defaultWriteScope,
    },
    logger,
  });
  const service = createMemoryService(core, extractionRuntime, {
    defaultAgentId: config.defaultAgentId,
    defaultWriteScope: config.defaultWriteScope,
  });
  const captureQueue = new CaptureJobQueue(service, {
    defaultAsync: config.captureQueue.asyncDefault,
    concurrency: config.captureQueue.concurrency,
    maxQueueSize: config.captureQueue.maxQueueSize,
    dedupWindowMs: config.captureQueue.dedupWindowMs,
    spoolDir:
      config.captureQueue.spoolEnabled && config.captureEnabled
        ? path.join(config.dbPath, ".capture-queue")
        : undefined,
    logger,
  });

  return {
    core,
    extractionRuntime,
    service,
    captureQueue,
    defaultAgentId: config.defaultAgentId,
    defaultWriteScope: config.defaultWriteScope,
    async health() {
      return {
        status: "ok",
        memories: await core.store.count(),
        captureEnabled: extractionRuntime.smartExtractor !== null,
        vectorDim: core.vectorDim,
        captureQueue: captureQueue.stats(),
      };
    },
    recoverPendingCaptures: () => captureQueue.recoverPendingJobs(),
    async close() {
      const pendingBeforeDrain = captureQueue.stats();
      if (pendingBeforeDrain.queued > 0 || pendingBeforeDrain.running > 0) {
        logger.info(
          `memory-server: draining capture queue (queued=${pendingBeforeDrain.queued}, running=${pendingBeforeDrain.running})`,
        );
      }
      try {
        const drained = await captureQueue.drain(config.captureQueue.shutdownTimeoutMs);
        if (!drained.drained) {
          logger.warn(
            `memory-server: capture queue drain timed out with ${drained.remaining} remaining job(s)`,
          );
        }
      } catch (error) {
        logger.warn(
          `memory-server: capture queue drain failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      try {
        await drainManualRecallMetadata(core.store);
      } catch (error) {
        logger.warn(
          `memory-server: recall metadata drain failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}
