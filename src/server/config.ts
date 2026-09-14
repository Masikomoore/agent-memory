import path from "node:path";
import type { EmbeddingConfig } from "../embedder.js";
import type { LlmClientConfig } from "../llm-client.js";

export interface MemoryServerHttpConfig {
  host: string;
  port: number;
  token?: string;
  allowedHosts: string[];
  allowedOrigins: string[];
  maxBodyBytes: number;
}

export interface MemoryServerConfig {
  http: MemoryServerHttpConfig;
  dbPath: string;
  embedding: EmbeddingConfig;
  llm?: LlmClientConfig;
  captureEnabled: boolean;
  defaultAgentId: string;
  defaultWriteScope: string;
}

function readString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function readBoolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const value = readString(env, key)?.toLowerCase();
  if (value === undefined) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`${key} must be one of true/false, 1/0, yes/no, on/off`);
}

function readInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = readString(env, key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function readOptionalInt(
  env: NodeJS.ProcessEnv,
  key: string,
  min: number,
  max: number,
): number | undefined {
  const raw = readString(env, key);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function readCsv(env: NodeJS.ProcessEnv, key: string): string[] {
  const value = readString(env, key);
  if (!value) return [];
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1" || normalized === "[::1]";
}

function isWildcardHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "0.0.0.0" || normalized === "::" || normalized === "[::]";
}

function defaultAllowedHosts(host: string): string[] {
  if (isLoopbackHost(host)) return ["localhost", "127.0.0.1", "[::1]"];
  if (isWildcardHost(host)) return [];
  return [...new Set([host, "localhost", "127.0.0.1", "[::1]"])];
}

/**
 * Resolve the standalone service configuration from environment variables.
 * The server deliberately does not read OpenClaw config files or host APIs.
 */
export function loadMemoryServerConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): MemoryServerConfig {
  const host = readString(env, "MEMORY_SERVER_HOST") ?? "127.0.0.1";
  const token = readString(env, "MEMORY_SERVER_TOKEN");
  let allowedHosts = readCsv(env, "MEMORY_SERVER_ALLOWED_HOSTS");
  if (allowedHosts.length === 0) allowedHosts = defaultAllowedHosts(host);

  if (!isLoopbackHost(host) && !token) {
    throw new Error(
      "MEMORY_SERVER_TOKEN is required when MEMORY_SERVER_HOST is not loopback",
    );
  }
  if (allowedHosts.length === 0) {
    throw new Error(
      "MEMORY_SERVER_ALLOWED_HOSTS is required when listening on a wildcard address such as 0.0.0.0",
    );
  }

  const allowedOrigins = readCsv(env, "MEMORY_SERVER_ALLOWED_ORIGINS");
  const embeddingBaseURL = readString(env, "MEMORY_EMBEDDING_BASE_URL");
  const configuredEmbeddingKey = readString(env, "MEMORY_EMBEDDING_API_KEY");
  if (!configuredEmbeddingKey && !embeddingBaseURL) {
    throw new Error(
      "Configure MEMORY_EMBEDDING_API_KEY or MEMORY_EMBEDDING_BASE_URL before starting memory-server",
    );
  }
  // OpenAI-compatible local servers still require a non-empty SDK key even
  // when they ignore authentication. Never use this placeholder for the
  // default public OpenAI endpoint: the branch above requires a real key when
  // no explicit base URL is configured.
  const embeddingApiKey = configuredEmbeddingKey ?? "local-memory-server";

  const embedding: EmbeddingConfig = {
    provider: "openai-compatible",
    apiKey: embeddingApiKey,
    model: readString(env, "MEMORY_EMBEDDING_MODEL") ?? "text-embedding-3-small",
    baseURL: embeddingBaseURL,
    dimensions: readOptionalInt(env, "MEMORY_EMBEDDING_DIMENSIONS", 1, 65536),
    requestDimensions: readOptionalInt(env, "MEMORY_EMBEDDING_REQUEST_DIMENSIONS", 1, 65536),
    maxInputChars: readOptionalInt(env, "MEMORY_EMBEDDING_MAX_INPUT_CHARS", 1, 10_000_000),
    clientTimeoutMs: readOptionalInt(env, "MEMORY_EMBEDDING_TIMEOUT_MS", 100, 600_000),
  };

  const captureEnabled = readBoolean(env, "MEMORY_CAPTURE_ENABLED", true);
  let llm: LlmClientConfig | undefined;
  if (captureEnabled) {
    llm = {
      auth: "api-key",
      transport: "direct",
      apiKey: readString(env, "MEMORY_LLM_API_KEY") ?? embeddingApiKey,
      baseURL: readString(env, "MEMORY_LLM_BASE_URL") ?? embeddingBaseURL,
      model: readString(env, "MEMORY_LLM_MODEL") ?? "openai/gpt-oss-120b",
      timeoutMs: readOptionalInt(env, "MEMORY_LLM_TIMEOUT_MS", 100, 600_000),
      thinkLevel: readString(env, "MEMORY_LLM_THINK_LEVEL"),
    };
  }

  return {
    http: {
      host,
      port: readInt(env, "MEMORY_SERVER_PORT", 7337, 1, 65535),
      token,
      allowedHosts,
      allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : allowedHosts,
      maxBodyBytes: readInt(env, "MEMORY_SERVER_MAX_BODY_BYTES", 1_048_576, 1024, 100 * 1024 * 1024),
    },
    dbPath: path.resolve(cwd, readString(env, "MEMORY_SERVER_DB_PATH") ?? "data/memory-server"),
    embedding,
    llm,
    captureEnabled,
    defaultAgentId: readString(env, "MEMORY_SERVER_DEFAULT_AGENT") ?? "main",
    defaultWriteScope: readString(env, "MEMORY_SERVER_DEFAULT_WRITE_SCOPE") ?? "global",
  };
}
