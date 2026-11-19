import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface LoadHookEnvOptions {
  envFile?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
}

export interface LoadedHookEnv {
  env: NodeJS.ProcessEnv;
  envFilePath: string;
  envFileLoaded: boolean;
  warnings: string[];
}

export function defaultHookEnvPath(
  processEnv: NodeJS.ProcessEnv = process.env,
  homeDir: string = homedir(),
): string {
  const xdgConfigHome = processEnv.XDG_CONFIG_HOME?.trim();
  const baseDir = xdgConfigHome || path.join(homeDir, ".config");
  return path.join(baseDir, "agent-memory", "hook.env");
}

function unquoteValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  const commentIndex = trimmed.search(/\s+#/);
  return (commentIndex >= 0 ? trimmed.slice(0, commentIndex) : trimmed).trim();
}

export function parseDotEnv(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eqIndex = withoutExport.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = withoutExport.slice(0, eqIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    parsed[key] = unquoteValue(withoutExport.slice(eqIndex + 1));
  }
  return parsed;
}

/**
 * Merge process environment with an optional local hook.env file.
 * Process environment values always take precedence over file entries so
 * interactive shells override file defaults while GUI hosts (such as desktop
 * WorkBuddy) can still load MEMORY_SERVER_URL and MEMORY_SERVER_TOKEN.
 */
export function loadHookEnv(
  processEnv: NodeJS.ProcessEnv = process.env,
  options: LoadHookEnvOptions = {},
): LoadedHookEnv {
  const homeDir = options.homeDir ?? homedir();
  const platform = options.platform ?? process.platform;
  const explicitPath = options.envFile?.trim() || processEnv.MEMORY_HOOK_ENV_FILE?.trim();
  const envFilePath = explicitPath
    ? path.resolve(explicitPath)
    : defaultHookEnvPath(processEnv, homeDir);
  const warnings: string[] = [];

  if (!existsSync(envFilePath)) {
    if (explicitPath) {
      throw new Error(`hook env file not found: ${envFilePath}`);
    }
    return {
      env: { ...processEnv },
      envFilePath,
      envFileLoaded: false,
      warnings,
    };
  }

  if (platform !== "win32") {
    try {
      const mode = statSync(envFilePath).mode & 0o777;
      if ((mode & 0o077) !== 0) {
        warnings.push(
          `hook env file ${envFilePath} has permissions ${mode.toString(8)}; restrict it with chmod 600`,
        );
      }
    } catch {
      // Ignore stat errors; readFileSync below will report unreadable files.
    }
  }

  const fromFile = parseDotEnv(readFileSync(envFilePath, "utf8"));
  const merged: NodeJS.ProcessEnv = { ...fromFile };
  for (const [key, value] of Object.entries(processEnv)) {
    if (value !== undefined && value !== "") {
      merged[key] = value;
    } else if (!(key in merged)) {
      merged[key] = value;
    }
  }

  return {
    env: merged,
    envFilePath,
    envFileLoaded: true,
    warnings,
  };
}
