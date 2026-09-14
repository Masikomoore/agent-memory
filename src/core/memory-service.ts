import { enqueueManualRecallMetadata } from "../manual-recall-metadata-queue.js";
import type { ExtractionStats } from "../memory-categories.js";
import type { RetrievalResult } from "../retriever.js";
import { parseSmartMetadata } from "../smart-metadata.js";
import type { ExtractPersistOptions } from "../smart-extractor.js";
import type { MemoryCore, MemoryExtractionRuntime } from "./memory-core.js";

export interface MemoryRecallRequest {
  query: string;
  limit?: number;
  /** Logical caller identity used for scope ACL resolution. */
  agentId?: string;
  /** Optional single scope requested by the caller. */
  scope?: string;
  /**
   * Trusted adapter override for store-layer scope filtering. Public transports
   * should prefer agentId/scope so the scope manager remains authoritative.
   */
  scopeFilter?: string[];
  category?: string;
  source?: "manual" | "auto-recall" | "cli";
  /** Manual recall is a positive reinforcement signal by default. */
  reinforce?: boolean;
}

export interface MemoryCaptureRequest extends ExtractPersistOptions {
  conversationText: string;
  sessionKey?: string;
}

export interface MemoryService {
  recall(request: MemoryRecallRequest): Promise<RetrievalResult[]>;
  capture(request: MemoryCaptureRequest): Promise<ExtractionStats>;
}

export interface MemoryServiceConfig {
  /** Used when a transport does not provide an explicit caller identity. */
  defaultAgentId?: string;
  /** Optional shared-by-default write scope for server-style deployments. */
  defaultWriteScope?: string;
}

export class MemoryServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "MemoryServiceError";
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Host-neutral service facade over the memory engine.
 *
 * Transport adapters should translate MCP/REST/OpenClaw requests into these
 * operations instead of reaching into LanceDB or SmartExtractor directly.
 */
export function createMemoryService(
  core: MemoryCore,
  extractionRuntime?: MemoryExtractionRuntime,
  config: MemoryServiceConfig = {},
): MemoryService {
  const defaultAgentId = config.defaultAgentId?.trim() || "main";

  const resolveAgentId = (agentId: string | undefined): string =>
    agentId?.trim() || defaultAgentId;

  const requireAccessibleScope = (scope: string, agentId: string): string => {
    const normalized = scope.trim();
    if (!normalized || !core.scopeManager.validateScope(normalized)) {
      throw new MemoryServiceError(`Invalid memory scope: ${scope}`, "invalid_scope", 400);
    }
    if (!core.scopeManager.isAccessible(normalized, agentId)) {
      throw new MemoryServiceError(
        `Access denied to memory scope: ${normalized}`,
        "scope_access_denied",
        403,
      );
    }
    return normalized;
  };

  return {
    async recall(request) {
      const query = request.query?.trim();
      if (!query) {
        throw new MemoryServiceError("Memory recall query cannot be empty", "invalid_query", 400);
      }
      const agentId = resolveAgentId(request.agentId);
      let scopeFilter = request.scopeFilter;
      if (!scopeFilter) {
        if (request.scope) {
          scopeFilter = [requireAccessibleScope(request.scope, agentId)];
        } else {
          scopeFilter = core.scopeManager.getScopeFilter(agentId);
        }
      }
      const limit = Math.max(1, Math.min(20, Math.floor(request.limit ?? 5)));
      const retrieve = () => core.retriever.retrieve({
        query,
        limit,
        scopeFilter,
        category: request.category,
        source: request.source ?? "manual",
      });

      let results = await retrieve();
      if (results.length === 0 && await core.store.count() > 0) {
        // Preserve the existing short write-ahead catch-up retry used by the
        // OpenClaw recall tool. The service owns it so other transports get the
        // same consistency behavior.
        await sleep(75);
        results = await retrieve();
      }

      if (
        results.length > 0 &&
        request.reinforce !== false &&
        (request.source ?? "manual") === "manual"
      ) {
        const now = Date.now();
        enqueueManualRecallMetadata(
          core.store,
          results.map((result) => {
            const metadata = parseSmartMetadata(result.entry.metadata, result.entry);
            return {
              id: result.entry.id,
              expectedScope: result.entry.scope,
              accessCountDelta: 1,
              accessedAt: now,
              governanceSnapshot: {
                badRecallCount: metadata.bad_recall_count,
                suppressedUntilTurn: metadata.suppressed_until_turn,
                suppressedUntilMs: metadata.suppressed_until_ms,
              },
            };
          }),
        );
      }

      return results;
    },

    async capture(request) {
      const smartExtractor = extractionRuntime?.smartExtractor;
      if (!smartExtractor) {
        throw new MemoryServiceError(
          "Memory capture requires an enabled extraction runtime",
          "capture_unavailable",
          503,
        );
      }
      const {
        conversationText,
        sessionKey = "unknown",
        ...options
      } = request;
      if (!conversationText?.trim()) {
        throw new MemoryServiceError(
          "Memory capture conversationText cannot be empty",
          "invalid_conversation",
          400,
        );
      }

      const agentId = resolveAgentId(options.agentId);
      const requestedScope = options.scope ?? config.defaultWriteScope ?? core.scopeManager.getDefaultScope(agentId);
      const targetScope = requireAccessibleScope(requestedScope, agentId);
      const trustedScopeOverride = Object.prototype.hasOwnProperty.call(options, "scopeFilter")
        ? options.scopeFilter
        : [targetScope];

      return smartExtractor.extractAndPersist(conversationText, sessionKey, {
        ...options,
        agentId,
        scope: targetScope,
        scopeFilter: trustedScopeOverride,
      });
    },
  };
}
