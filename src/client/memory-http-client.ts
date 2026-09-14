export interface MemoryHttpClientConfig {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface RemoteMemoryNeighbor {
  id: string;
  text: string;
  score: number;
  category?: string;
  scope?: string;
}

export interface RemoteMemory {
  id: string;
  text: string;
  score: number;
  category?: string;
  scope?: string;
  importance?: number;
  timestamp?: number;
  metadata?: unknown;
  neighbors?: RemoteMemoryNeighbor[];
}

export interface RemoteRecallRequest {
  query: string;
  limit?: number;
  agentId?: string;
  scope?: string;
  category?: string;
  source?: "manual" | "auto-recall" | "cli";
}

export interface RemoteRecallResponse {
  count: number;
  memories: RemoteMemory[];
}

export interface RemoteCaptureRequest {
  conversationText: string;
  sessionKey?: string;
  agentId?: string;
  scope?: string;
}

export interface RemoteHealthResponse {
  status: "ok";
  memories: number;
  captureEnabled: boolean;
  vectorDim?: number;
}

export class MemoryHttpClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "MemoryHttpClientError";
  }
}

export interface MemoryHttpClient {
  readonly baseUrl: string;
  health(): Promise<RemoteHealthResponse>;
  recall(request: RemoteRecallRequest): Promise<RemoteRecallResponse>;
  capture(request: RemoteCaptureRequest): Promise<Record<string, unknown>>;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("memory server URL cannot be empty");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`invalid memory server URL: ${trimmed}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`memory server URL must use http or https: ${trimmed}`);
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function errorMessageFromResponse(value: unknown, fallback: string): { code: string; message: string } {
  const record = asRecord(value);
  const code = typeof record?.error === "string" && record.error.trim() ? record.error.trim() : "http_error";
  const message = typeof record?.message === "string" && record.message.trim()
    ? record.message.trim()
    : fallback;
  return { code, message };
}

export function createMemoryHttpClient(config: MemoryHttpClientConfig): MemoryHttpClient {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const token = config.token?.trim() || undefined;
  const timeoutMs = Math.max(250, Math.floor(config.timeoutMs ?? 5_000));
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("memory HTTP client requires a Fetch-compatible runtime");
  }

  const requestJson = async <T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> => {
    const url = `${baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error(`memory server request timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    try {
      const response = await fetchImpl(url, {
        method,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      const raw = await response.text();
      let parsed: unknown = {};
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          if (!response.ok) {
            throw new MemoryHttpClientError(
              `memory server returned HTTP ${response.status} with a non-JSON error response`,
              "invalid_error_response",
              response.status,
            );
          }
          throw new MemoryHttpClientError(
            "memory server returned a non-JSON response",
            "invalid_response",
            response.status,
          );
        }
      }

      if (!response.ok) {
        const details = errorMessageFromResponse(parsed, `memory server returned HTTP ${response.status}`);
        throw new MemoryHttpClientError(
          `memory server rejected ${method} ${path}: ${details.message}`,
          details.code,
          response.status,
        );
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof MemoryHttpClientError) throw error;
      const reason = controller.signal.aborted
        ? controller.signal.reason instanceof Error
          ? controller.signal.reason.message
          : `request timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error);
      throw new MemoryHttpClientError(
        `memory server request failed (${method} ${url}): ${reason}`,
        controller.signal.aborted ? "request_timeout" : "network_error",
        undefined,
        error,
      );
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    baseUrl,
    health: () => requestJson<RemoteHealthResponse>("GET", "/health"),
    recall: (request) => requestJson<RemoteRecallResponse>("POST", "/v1/recall", request),
    capture: (request) => requestJson<Record<string, unknown>>("POST", "/v1/capture", request),
  };
}
