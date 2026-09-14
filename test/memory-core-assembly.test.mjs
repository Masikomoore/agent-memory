import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const {
  createMemoryCore,
  createMemoryExtractionRuntime,
  createMemoryService,
} = jiti("../src/core/index.ts");
const { normalizeAdmissionControlConfig } = jiti("../src/admission-control.ts");

function makeLlm() {
  return {
    async completeJson() {
      return null;
    },
    getLastError() {
      return null;
    },
  };
}

describe("host-independent MemoryCore assembly", () => {
  it("constructs storage, retrieval, lifecycle and scopes without an OpenClaw API", () => {
    const root = mkdtempSync(path.join(tmpdir(), "memory-core-"));
    try {
      const core = createMemoryCore({
        dbPath: path.join(root, "db"),
        embedding: {
          provider: "openai-compatible",
          apiKey: "test-api-key",
          model: "all-MiniLM-L6-v2",
        },
        retrieval: {
          mode: "hybrid",
          rerank: "none",
        },
        scopes: {
          default: "global",
          definitions: {
            global: { description: "shared" },
            "project:agentmemory": { description: "project" },
          },
          agentAccess: {
            codex: ["global", "project:agentmemory"],
          },
        },
      });

      assert.equal(core.vectorDim, 384);
      assert.ok(core.store);
      assert.ok(core.embedder);
      assert.ok(core.retriever);
      assert.ok(core.decayEngine);
      assert.ok(core.tierManager);
      assert.deepEqual(
        core.scopeManager.getAccessibleScopes("codex").slice(0, 2),
        ["global", "project:agentmemory"],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("attaches SmartExtractor and admission governance from injected LLM clients", () => {
    const root = mkdtempSync(path.join(tmpdir(), "memory-core-extraction-"));
    try {
      const core = createMemoryCore({
        dbPath: path.join(root, "db"),
        embedding: {
          provider: "openai-compatible",
          apiKey: "test-api-key",
          model: "all-MiniLM-L6-v2",
        },
      });
      const llm = makeLlm();
      const admissionConfig = normalizeAdmissionControlConfig({ enabled: true });

      const runtime = createMemoryExtractionRuntime(core, {
        enabled: true,
        llmClient: llm,
        admission: {
          config: admissionConfig,
          extractionLlmClient: llm,
          reflectionLlmClient: llm,
        },
        extractor: {
          initializeNoiseBank: false,
          defaultScope: "global",
        },
      });

      assert.ok(runtime.smartExtractor);
      assert.ok(runtime.admissionController);
      assert.equal(
        runtime.reflectionAdmissionController,
        runtime.admissionController,
        "matching lanes should share the same admission controller",
      );
      assert.ok(runtime.noiseBank);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exposes recall and capture through a transport-neutral service facade", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "memory-service-"));
    try {
      const core = createMemoryCore({
        dbPath: path.join(root, "db"),
        embedding: {
          provider: "openai-compatible",
          apiKey: "test-api-key",
          model: "all-MiniLM-L6-v2",
        },
        scopes: {
          default: "global",
          definitions: {
            global: { description: "shared" },
            "project:agentmemory": { description: "project" },
          },
          agentAccess: {
            main: ["global", "project:agentmemory"],
          },
        },
      });
      const fakeExtractor = {
        async extractAndPersist(conversationText, sessionKey, options) {
          assert.equal(conversationText, "User prefers dark mode");
          assert.equal(sessionKey, "session:test");
          assert.equal(options.scope, "project:agentmemory");
          return { created: 1, merged: 0, skipped: 0, boundarySkipped: 0 };
        },
      };
      const service = createMemoryService(core, {
        smartExtractor: fakeExtractor,
        admissionController: null,
        reflectionAdmissionController: null,
        noiseBank: null,
      });

      const capture = await service.capture({
        conversationText: "User prefers dark mode",
        sessionKey: "session:test",
        scope: "project:agentmemory",
      });
      assert.equal(capture.created, 1);

      core.retriever.retrieve = async (request) => {
        assert.equal(request.query, "dark mode");
        assert.deepEqual(request.scopeFilter, ["project:agentmemory", "global"]);
        return [];
      };
      core.store.count = async () => 0;
      const recalled = await service.recall({
        query: "dark mode",
        scopeFilter: ["project:agentmemory", "global"],
        reinforce: false,
      });
      assert.deepEqual(recalled, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
