import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { z } from "zod";
import type { MemoryService } from "../core/memory-service.js";
import type { MemoryEntry } from "../store.js";
import type { RetrievalResult } from "../retriever.js";

export const MEMORY_SERVER_NAME = "agent-memory-service";
export const MEMORY_SERVER_VERSION = "0.1.0";
export const MEMORY_SERVER_INSTRUCTIONS = [
  "Use memory_recall when prior decisions, preferences, project state, recurring entities, or other durable context may materially improve the answer.",
  "Use memory_capture after durable information is established and should survive future sessions.",
  "Provide a stable logical agentId on recall and capture calls when the client has one (for example claude-code, codex, cursor, gemini-cli, or vscode).",
  "Do not capture secrets, passwords, API keys, authentication tokens, or ephemeral command output.",
  "Current explicit user instructions override recalled memory.",
].join(" ");

export interface MemoryServerHealthSnapshot {
  status: "ok";
  memories: number;
  captureEnabled: boolean;
  vectorDim?: number;
}

export interface MemoryMcpRuntime {
  service: MemoryService;
  health(): Promise<MemoryServerHealthSnapshot>;
  defaultAgentId: string;
  defaultWriteScope: string;
}

function safeMetadata(entry: MemoryEntry): unknown {
  try {
    return entry.metadata ? JSON.parse(entry.metadata) : {};
  } catch {
    return entry.metadata ?? {};
  }
}

export function serializeRecallResult(result: RetrievalResult) {
  const entry = result.entry;
  return {
    id: entry.id,
    text: entry.text,
    score: result.score,
    category: entry.category,
    scope: entry.scope,
    importance: entry.importance,
    timestamp: entry.timestamp,
    metadata: safeMetadata(entry),
    ...(result.neighbors?.length
      ? {
          neighbors: result.neighbors.map((neighbor) => ({
            id: neighbor.entry.id,
            text: neighbor.entry.text,
            score: neighbor.score,
            category: neighbor.entry.category,
            scope: neighbor.entry.scope,
          })),
        }
      : {}),
  };
}

export function createMemoryMcpServer(runtime: MemoryMcpRuntime): McpServer {
  const server = new McpServer(
    {
      name: MEMORY_SERVER_NAME,
      version: MEMORY_SERVER_VERSION,
    },
    {
      instructions: MEMORY_SERVER_INSTRUCTIONS,
    },
  );

  server.registerTool(
    "memory_recall",
    {
      title: "Memory Recall",
      description: "Search shared long-term memory with hybrid semantic and keyword retrieval.",
      inputSchema: z.object({
        query: z.string().min(1).describe("What to search for"),
        limit: z.number().int().min(1).max(20).optional(),
        agentId: z.string().min(1).optional().describe("Logical agent identity for scope access"),
        scope: z.string().min(1).optional().describe("Optional single accessible scope"),
        category: z.string().min(1).optional(),
      }),
    },
    async ({ query, limit, agentId, scope, category }) => {
      const results = await runtime.service.recall({
        query,
        limit,
        agentId: agentId ?? runtime.defaultAgentId,
        scope,
        category,
        source: "manual",
      });
      const output = {
        count: results.length,
        memories: results.map(serializeRecallResult),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "memory_capture",
    {
      title: "Memory Capture",
      description: "Extract durable memories from conversation text and persist them into shared long-term memory.",
      inputSchema: z.object({
        conversationText: z.string().min(1),
        sessionKey: z.string().min(1).optional(),
        agentId: z.string().min(1).optional().describe("Logical agent identity"),
        scope: z.string().min(1).optional().describe("Target scope; defaults to the server shared scope"),
      }),
    },
    async ({ conversationText, sessionKey, agentId, scope }) => {
      const output = await runtime.service.capture({
        conversationText,
        sessionKey,
        agentId: agentId ?? runtime.defaultAgentId,
        scope: scope ?? runtime.defaultWriteScope,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "memory_health",
    {
      title: "Memory Health",
      description: "Return memory-server health and capability status.",
      inputSchema: z.object({}),
    },
    async () => {
      const output = await runtime.health();
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  return server;
}

export function createMemoryMcpNodeHandler(runtime: MemoryMcpRuntime) {
  const handler = createMcpHandler(
    () => createMemoryMcpServer(runtime),
    {
      legacy: "stateless",
    },
  );
  return {
    handler,
    nodeHandler: toNodeHandler(handler),
  };
}
