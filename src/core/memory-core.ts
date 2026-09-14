import {
  createAdmissionController,
  type AdmissionControlConfig,
  type AdmissionController,
} from "../admission-control.js";
import {
  createDecayEngine,
  DEFAULT_DECAY_CONFIG,
  type DecayConfig,
} from "../decay-engine.js";
import {
  createEmbedder,
  getEffectiveVectorDimensions,
  type Embedder,
  type EmbeddingConfig,
} from "../embedder.js";
import type { LlmClient } from "../llm-client.js";
import { NoisePrototypeBank } from "../noise-prototypes.js";
import {
  createRetriever,
  type MemoryRetriever,
  type RetrievalConfigInput,
} from "../retriever.js";
import {
  createScopeManager,
  type MemoryScopeManager,
  type ScopeConfig,
} from "../scopes.js";
import {
  SmartExtractor,
  type SmartExtractorConfig,
} from "../smart-extractor.js";
import { MemoryStore, type StoreConfig } from "../store.js";
import {
  createTierManager,
  DEFAULT_TIER_CONFIG,
  type TierConfig,
  type TierManager,
} from "../tier-manager.js";

export interface MemoryCoreLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
}

const NOOP_LOGGER: MemoryCoreLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
};

export interface MemoryCoreConfig {
  dbPath: string;
  embedding: EmbeddingConfig;
  retrieval?: RetrievalConfigInput;
  decay?: Partial<DecayConfig>;
  tier?: Partial<TierConfig>;
  scopes?: Partial<ScopeConfig>;
  storage?: Omit<StoreConfig, "dbPath" | "vectorDim">;
  vectorDim?: number;
  logger?: Partial<MemoryCoreLogger>;
}

export interface MemoryCore {
  dbPath: string;
  vectorDim: number;
  store: MemoryStore;
  embedder: Embedder;
  decayEngine: ReturnType<typeof createDecayEngine>;
  tierManager: TierManager;
  retriever: MemoryRetriever;
  scopeManager: MemoryScopeManager;
}

function resolveLogger(logger?: Partial<MemoryCoreLogger>): MemoryCoreLogger {
  return {
    debug: logger?.debug ?? NOOP_LOGGER.debug,
    info: logger?.info ?? NOOP_LOGGER.info,
    warn: logger?.warn ?? NOOP_LOGGER.warn,
  };
}

/**
 * Build the host-independent memory engine foundation.
 *
 * Callers are responsible only for resolving secrets and paths before passing
 * configuration here. No OpenClaw lifecycle or plugin API is referenced by
 * this module, so the same engine can be reused by HTTP/MCP servers and other
 * adapters.
 */
export function createMemoryCore(config: MemoryCoreConfig): MemoryCore {
  const logger = resolveLogger(config.logger);
  const vectorDim = config.vectorDim ?? getEffectiveVectorDimensions(
    config.embedding.model,
    config.embedding.dimensions,
    config.embedding.requestDimensions,
  );

  const store = new MemoryStore({
    dbPath: config.dbPath,
    vectorDim,
    ...config.storage,
    onStoragePathWarning:
      config.storage?.onStoragePathWarning ?? ((message) => logger.warn(message)),
    onLockWarning:
      config.storage?.onLockWarning ?? ((message) => logger.warn(message)),
  });
  const embedder = createEmbedder(config.embedding);
  const decayEngine = createDecayEngine({
    ...DEFAULT_DECAY_CONFIG,
    ...(config.decay ?? {}),
  });
  const tierManager = createTierManager({
    ...DEFAULT_TIER_CONFIG,
    ...(config.tier ?? {}),
  });
  const retriever = createRetriever(
    store,
    embedder,
    config.retrieval,
    { decayEngine },
  );
  const scopeManager = createScopeManager(config.scopes);

  return {
    dbPath: config.dbPath,
    vectorDim,
    store,
    embedder,
    decayEngine,
    tierManager,
    retriever,
    scopeManager,
  };
}

export interface MemoryExtractionRuntimeConfig {
  enabled: boolean;
  llmClient?: LlmClient;
  extractor?: Omit<SmartExtractorConfig, "admissionController" | "noiseBank"> & {
    noiseBank?: NoisePrototypeBank;
    initializeNoiseBank?: boolean;
  };
  admission?: {
    config?: AdmissionControlConfig;
    extractionLlmClient?: LlmClient;
    reflectionLlmClient?: LlmClient;
    debugLog?: (message: string) => void;
  };
  logger?: Partial<MemoryCoreLogger>;
}

export interface MemoryExtractionRuntime {
  smartExtractor: SmartExtractor | null;
  admissionController: AdmissionController | null;
  reflectionAdmissionController: AdmissionController | null;
  noiseBank: NoisePrototypeBank | null;
}

/**
 * Attach extraction/admission intelligence to an existing MemoryCore.
 *
 * LLM clients are injected by the adapter. This keeps provider credentials,
 * host-managed transports and model routing outside the core while preserving
 * all extraction/admission algorithms inside the reusable engine layer.
 */
export function createMemoryExtractionRuntime(
  core: MemoryCore,
  config: MemoryExtractionRuntimeConfig,
): MemoryExtractionRuntime {
  const logger = resolveLogger(config.logger);
  const admissionConfig = config.admission?.config;
  const admissionEnabled = admissionConfig?.enabled === true;
  const extractionLlm = config.admission?.extractionLlmClient ?? config.llmClient;

  if (admissionEnabled && !extractionLlm) {
    throw new Error("Admission control requires an LLM client");
  }

  const admissionController = admissionEnabled
    ? createAdmissionController(
        core.store,
        extractionLlm!,
        admissionConfig,
        config.admission?.debugLog ?? ((message) => logger.debug(message)),
      )
    : null;

  const reflectionLlm = config.admission?.reflectionLlmClient ?? extractionLlm;
  const reflectionAdmissionController = admissionEnabled
    ? reflectionLlm === extractionLlm
      ? admissionController
      : createAdmissionController(
          core.store,
          reflectionLlm!,
          admissionConfig,
          config.admission?.debugLog ?? ((message) => logger.debug(message)),
        )
    : null;

  if (!config.enabled) {
    return {
      smartExtractor: null,
      admissionController,
      reflectionAdmissionController,
      noiseBank: null,
    };
  }

  if (!config.llmClient) {
    throw new Error("Smart extraction requires an LLM client");
  }

  const noiseBank = config.extractor?.noiseBank ?? new NoisePrototypeBank(
    (message) => logger.debug(message),
  );
  if (config.extractor?.initializeNoiseBank !== false) {
    noiseBank.init(core.embedder).catch((error) =>
      logger.debug(`memory-core: noise bank init: ${String(error)}`),
    );
  }

  const {
    initializeNoiseBank: _initializeNoiseBank,
    noiseBank: _configuredNoiseBank,
    ...extractorConfig
  } = config.extractor ?? {};
  const smartExtractor = new SmartExtractor(
    core.store,
    core.embedder,
    config.llmClient,
    {
      ...extractorConfig,
      admissionControl: admissionConfig,
      admissionController,
      noiseBank,
      log: extractorConfig.log ?? ((message) => logger.info(message)),
      debugLog: extractorConfig.debugLog ?? ((message) => logger.debug(message)),
    },
  );

  return {
    smartExtractor,
    admissionController,
    reflectionAdmissionController,
    noiseBank,
  };
}
