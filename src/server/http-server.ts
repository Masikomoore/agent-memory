import { timingSafeEqual } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { validateHostHeader, validateOriginHeader } from "@modelcontextprotocol/server";
import { MemoryServiceError, type MemoryService } from "../core/memory-service.js";
import { CaptureJobQueue } from "./capture-queue.js";
import type { MemoryServerHttpConfig } from "./config.js";
import {
  createMemoryMcpNodeHandler,
  serializeRecallResult,
  type MemoryMcpRuntime,
  type MemoryServerHealthSnapshot,
} from "./mcp.js";

export interface MemoryHttpRuntime extends MemoryMcpRuntime {
  service: MemoryService;
  captureQueue?: CaptureJobQueue;
}

export interface MemoryHttpLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

const CONSOLE_LOGGER: MemoryHttpLogger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
  debug: (message) => console.debug(message),
};

function writeJson(
  res: ServerResponse,
  statusCode: number,
  value: unknown,
  headers: Record<string, string> = {},
): void {
  const body = JSON.stringify(value);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body).toString(),
    "cache-control": "no-store",
    ...headers,
  });
  res.end(body);
}

function requestPath(req: IncomingMessage): string {
  const raw = req.url || "/";
  const queryIndex = raw.indexOf("?");
  return queryIndex === -1 ? raw : raw.slice(0, queryIndex);
}

function tokenMatches(expected: string, authorization: string | undefined): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  if (!match) return false;
  const provided = Buffer.from(match[1], "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

function authorize(req: IncomingMessage, res: ServerResponse, token: string | undefined): boolean {
  if (!token) return true;
  if (tokenMatches(token, req.headers.authorization)) return true;
  writeJson(
    res,
    401,
    { error: "unauthorized", message: "A valid Bearer token is required" },
    { "www-authenticate": 'Bearer realm="memory-server"' },
  );
  return false;
}

function validateRequestBoundary(
  req: IncomingMessage,
  res: ServerResponse,
  config: MemoryServerHttpConfig,
): boolean {
  const hostResult = validateHostHeader(req.headers.host, config.allowedHosts);
  if (!hostResult.ok) {
    writeJson(res, 403, {
      error: "invalid_host",
      message: "message" in hostResult ? hostResult.message : "Host header is not allowed",
    });
    return false;
  }

  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  const originResult = validateOriginHeader(origin, config.allowedOrigins);
  if (!originResult.ok) {
    writeJson(res, 403, {
      error: "invalid_origin",
      message: "message" in originResult ? originResult.message : "Origin is not allowed",
    });
    return false;
  }
  return true;
}

async function readJsonBody(req: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBodyBytes) {
      throw new MemoryServiceError(
        `Request body exceeds ${maxBodyBytes} bytes`,
        "body_too_large",
        413,
      );
    }
    chunks.push(buffer);
  }
  if (total === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new MemoryServiceError("Request body must be valid JSON", "invalid_json", 400);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MemoryServiceError("Request body must be a JSON object", "invalid_body", 400);
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new MemoryServiceError(`${field} must be a non-empty string`, "invalid_body", 400);
  }
  return value.trim();
}

function requiredString(value: unknown, field: string): string {
  const result = optionalString(value, field);
  if (!result) {
    throw new MemoryServiceError(`${field} is required`, "invalid_body", 400);
  }
  return result;
}

function optionalLimit(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 20) {
    throw new MemoryServiceError("limit must be an integer between 1 and 20", "invalid_body", 400);
  }
  return value;
}

function optionalRecallSource(value: unknown): "manual" | "auto-recall" | "cli" | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === "manual" || value === "auto-recall" || value === "cli") return value;
  throw new MemoryServiceError(
    "source must be one of manual, auto-recall, or cli",
    "invalid_body",
    400,
  );
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  throw new MemoryServiceError(`${field} must be a boolean`, "invalid_body", 400);
}

function optionalCaptureMode(value: unknown): "async" | "sync" | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === "async" || value === "sync") return value;
  throw new MemoryServiceError('mode must be "async" or "sync"', "invalid_body", 400);
}

function optionalIdempotencyKey(
  bodyValue: unknown,
  headerValue: string | string[] | undefined,
): string | undefined {
  let fromBody: string | undefined;
  if (bodyValue !== undefined && bodyValue !== null) {
    if (typeof bodyValue !== "string" || !bodyValue.trim()) {
      throw new MemoryServiceError("idempotencyKey must be a non-empty string", "invalid_body", 400);
    }
    fromBody = bodyValue.trim();
    if (fromBody.length > 256) {
      throw new MemoryServiceError("idempotencyKey must be at most 256 characters", "invalid_body", 400);
    }
  }

  let fromHeader: string | undefined;
  if (headerValue !== undefined) {
    if (Array.isArray(headerValue)) {
      throw new MemoryServiceError("idempotency-key header must appear at most once", "invalid_body", 400);
    }
    const trimmed = headerValue.trim();
    if (!trimmed) {
      throw new MemoryServiceError("idempotency-key header must be a non-empty string", "invalid_body", 400);
    }
    if (trimmed.length > 256) {
      throw new MemoryServiceError("idempotency-key header must be at most 256 characters", "invalid_body", 400);
    }
    fromHeader = trimmed;
  }

  if (fromBody && fromHeader && fromBody !== fromHeader) {
    throw new MemoryServiceError(
      "idempotencyKey body field and idempotency-key header do not match",
      "invalid_body",
      400,
    );
  }
  return fromBody ?? fromHeader;
}

function parseWaitQueryParam(rawUrl: string | undefined): boolean | undefined {
  const raw = rawUrl || "/";
  const queryIndex = raw.indexOf("?");
  if (queryIndex === -1) return undefined;
  const params = new URLSearchParams(raw.slice(queryIndex + 1));
  if (!params.has("wait")) return undefined;
  const value = (params.get("wait") ?? "").trim().toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new MemoryServiceError("wait query parameter must be true or false", "invalid_query", 400);
}

function writeError(res: ServerResponse, error: unknown, logger: MemoryHttpLogger): void {
  if (error instanceof MemoryServiceError) {
    const headers: Record<string, string> = error.statusCode === 429 ? { "retry-after": "5" } : {};
    writeJson(res, error.statusCode, { error: error.code, message: error.message }, headers);
    return;
  }
  logger.error(`memory-server: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  writeJson(res, 500, { error: "internal_error", message: "Internal memory-server error" });
}

export function createMemoryHttpServer(
  runtime: MemoryHttpRuntime,
  config: MemoryServerHttpConfig,
  logger: MemoryHttpLogger = CONSOLE_LOGGER,
): http.Server {
  const captureQueue = runtime.captureQueue ?? new CaptureJobQueue(runtime.service, {
    defaultAsync: true,
    logger,
  });
  const mcpRuntime: MemoryMcpRuntime = runtime.captureQueue
    ? runtime
    : { ...runtime, captureQueue };
  const { nodeHandler: mcpNodeHandler } = createMemoryMcpNodeHandler(mcpRuntime);

  return http.createServer(async (req, res) => {
    try {
      if (!validateRequestBoundary(req, res, config)) return;
      const path = requestPath(req);

      if (path === "/health" && req.method === "GET") {
        const health: MemoryServerHealthSnapshot = await runtime.health();
        writeJson(res, 200, health);
        return;
      }

      if (!authorize(req, res, config.token)) return;

      if (path === "/mcp") {
        await mcpNodeHandler(req, res);
        return;
      }

      if (path === "/v1/recall" && req.method === "POST") {
        const body = asRecord(await readJsonBody(req, config.maxBodyBytes));
        const results = await runtime.service.recall({
          query: requiredString(body.query, "query"),
          limit: optionalLimit(body.limit),
          agentId: optionalString(body.agentId, "agentId") ?? runtime.defaultAgentId,
          scope: optionalString(body.scope, "scope"),
          category: optionalString(body.category, "category"),
          source: optionalRecallSource(body.source) ?? "manual",
        });
        writeJson(res, 200, {
          count: results.length,
          memories: results.map(serializeRecallResult),
        });
        return;
      }

      if (path === "/v1/capture" && req.method === "POST") {
        const body = asRecord(await readJsonBody(req, config.maxBodyBytes));
        const waitQuery = parseWaitQueryParam(req.url);
        const waitBody = optionalBoolean(body.wait, "wait");
        const modeBody = optionalCaptureMode(body.mode);
        if (waitQuery !== undefined && waitBody !== undefined && waitQuery !== waitBody) {
          throw new MemoryServiceError(
            "wait query parameter and wait body field do not match",
            "invalid_body",
            400,
          );
        }
        const explicitWait = waitBody ?? waitQuery;
        if (
          (explicitWait === true && modeBody === "async") ||
          (explicitWait === false && modeBody === "sync")
        ) {
          throw new MemoryServiceError("wait and mode options conflict", "invalid_body", 400);
        }
        const shouldWait =
          explicitWait !== undefined
            ? explicitWait
            : modeBody !== undefined
              ? modeBody === "sync"
              : !captureQueue.defaultAsync;

        const idempotencyKey = optionalIdempotencyKey(
          body.idempotencyKey,
          req.headers["idempotency-key"],
        );
        const captureRequest = {
          conversationText: requiredString(body.conversationText, "conversationText"),
          sessionKey: optionalString(body.sessionKey, "sessionKey"),
          agentId: optionalString(body.agentId, "agentId") ?? runtime.defaultAgentId,
          scope: optionalString(body.scope, "scope") ?? runtime.defaultWriteScope,
        };

        if (shouldWait) {
          const result = await captureQueue.enqueueAndWait({
            request: captureRequest,
            idempotencyKey,
          });
          writeJson(res, 200, result);
          return;
        }

        const { snapshot } = await captureQueue.enqueue({
          request: captureRequest,
          idempotencyKey,
        });
        writeJson(res, 202, snapshot, { location: `/v1/capture/${snapshot.jobId}` });
        return;
      }

      const captureJobMatch = /^\/v1\/capture\/([A-Za-z0-9_-]+)$/.exec(path);
      if (captureJobMatch) {
        if (req.method !== "GET") {
          writeJson(res, 405, { error: "method_not_allowed", message: "Use GET for this endpoint" });
          return;
        }
        const job = captureQueue.getJob(captureJobMatch[1]);
        if (!job) {
          writeJson(res, 404, { error: "not_found", message: "Capture job not found" });
          return;
        }
        writeJson(res, 200, job);
        return;
      }

      if (path === "/v1/recall" || path === "/v1/capture") {
        writeJson(res, 405, { error: "method_not_allowed", message: "Use POST for this endpoint" });
        return;
      }

      writeJson(res, 404, { error: "not_found", message: "Route not found" });
    } catch (error) {
      if (!res.headersSent) writeError(res, error, logger);
      else logger.error(`memory-server: response failed after headers: ${String(error)}`);
    }
  });
}
