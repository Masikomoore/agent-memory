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
import type { MemoryServerConfig } from "./config.js";
import type { MemoryHttpRuntime, MemoryHttpLogger } from "./http-server.js";

export interface StandaloneMemoryRuntime extends MemoryHttpRuntime {
  core: MemoryCore;
  extractionRuntime: MemoryExtractionRuntime;
  service: MemoryService;
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

  return {
    core,
    extractionRuntime,
    service,
    defaultAgentId: config.defaultAgentId,
    defaultWriteScope: config.defaultWriteScope,
    async health() {
      return {
        status: "ok",
        memories: await core.store.count(),
        captureEnabled: extractionRuntime.smartExtractor !== null,
        vectorDim: core.vectorDim,
      };
    },
  };
}
