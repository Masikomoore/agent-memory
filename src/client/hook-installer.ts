import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectHermesAllowlist,
  inspectHermesYamlHooks,
  mergeHermesConfigYaml,
  type HermesHookEntrySpec,
} from "./hook-hermes-yaml.js";
import { SUPPORTED_HOOK_HOSTS, type SupportedHookHost } from "./hook-protocol.js";

export type InstallScope = "user" | "project";

export interface HookInstallOptions {
  host: SupportedHookHost;
  scope?: InstallScope;
  sharedProjectFile?: boolean;
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  commandBase?: string;
  nodeExecPath?: string;
  cliScriptPath?: string;
  envFile?: string;
  agentId?: string;
  memoryScope?: string;
  apply?: boolean;
  uninstall?: boolean;
}

export interface HookInstallResult {
  host: SupportedHookHost;
  scope: InstallScope;
  configPath: string;
  existed: boolean;
  applied: boolean;
  uninstalled: boolean;
  changed: boolean;
  events: string[];
  command: string;
  config: Record<string, unknown>;
  renderedConfig?: string;
}

export interface HostHookInspection {
  host: SupportedHookHost;
  userConfigPath: string;
  projectConfigPath: string;
  userInstalledEvents: string[];
  projectInstalledEvents: string[];
  parseErrors: string[];
  notes: string[];
}

const ANTIGRAVITY_MANAGED_HOOK_NAME = "agent-memory";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function shellQuoteArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

export function resolveCompiledHookCliPath(currentModuleUrl: string = import.meta.url): string {
  const currentFile = fileURLToPath(currentModuleUrl);
  const currentDir = path.dirname(currentFile);
  if (currentFile.endsWith(".js") && currentDir.includes(`${path.sep}dist${path.sep}`)) {
    return path.join(currentDir, "memory-hook-cli.js");
  }
  // Running from TypeScript source (e.g. via jiti): point installed host configs
  // at the compiled runtime entry for fast startup without jiti overhead.
  const repoRoot = path.resolve(currentDir, "..", "..");
  return path.join(repoRoot, "dist", "src", "client", "memory-hook-cli.js");
}

export function resolveHostConfigPath(
  host: SupportedHookHost,
  scope: InstallScope = "user",
  options: { cwd?: string; homeDir?: string; env?: NodeJS.ProcessEnv; sharedProjectFile?: boolean } = {},
): string {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const homeDir = options.homeDir ?? homedir();
  const env = options.env ?? process.env;

  if (host === "claude-code") {
    if (scope === "user") {
      return path.join(homeDir, ".claude", "settings.json");
    }
    return path.join(cwd, ".claude", options.sharedProjectFile ? "settings.json" : "settings.local.json");
  }

  if (host === "codex") {
    if (scope === "user") {
      const codexHome = env.CODEX_HOME?.trim() || path.join(homeDir, ".codex");
      return path.join(path.resolve(codexHome), "hooks.json");
    }
    return path.join(cwd, ".codex", "hooks.json");
  }

  if (host === "workbuddy") {
    if (scope === "user") {
      const workbuddyDir = env.WORKBUDDY_CONFIG_DIR?.trim() || path.join(homeDir, ".workbuddy");
      return path.join(path.resolve(workbuddyDir), "settings.json");
    }
    return path.join(cwd, ".workbuddy", options.sharedProjectFile ? "settings.json" : "settings.local.json");
  }

  if (host === "grok") {
    if (scope === "user") {
      const grokHome = env.GROK_HOME?.trim() || path.join(homeDir, ".grok");
      return path.join(path.resolve(grokHome), "hooks", "agent-memory.json");
    }
    return path.join(cwd, ".grok", "hooks", "agent-memory.json");
  }

  if (host === "antigravity-cli") {
    if (scope === "user") {
      const agyDir = env.ANTIGRAVITY_CONFIG_DIR?.trim() || path.join(homeDir, ".gemini", "config");
      return path.join(path.resolve(agyDir), "hooks.json");
    }
    return path.join(cwd, ".agents", "hooks.json");
  }

  if (host === "cursor") {
    if (scope === "user") {
      const cursorDir = env.CURSOR_CONFIG_DIR?.trim() || path.join(homeDir, ".cursor");
      return path.join(path.resolve(cursorDir), "hooks.json");
    }
    return path.join(cwd, ".cursor", "hooks.json");
  }

  // Hermes reads shell hooks from ~/.hermes/config.yaml ($HERMES_HOME/config.yaml).
  if (scope === "user") {
    const hermesHome = env.HERMES_HOME?.trim() || path.join(homeDir, ".hermes");
    return path.join(path.resolve(hermesHome), "config.yaml");
  }
  return path.join(cwd, ".hermes", "config.yaml");
}

export function buildHookCommand(options: {
  host: SupportedHookHost;
  commandBase?: string;
  nodeExecPath?: string;
  cliScriptPath?: string;
  envFile?: string;
  agentId?: string;
  memoryScope?: string;
}): string {
  const parts: string[] = [];
  if (options.commandBase?.trim()) {
    parts.push(options.commandBase.trim());
  } else {
    const nodeBin = options.nodeExecPath ?? process.execPath;
    const cliPath = options.cliScriptPath ?? resolveCompiledHookCliPath();
    parts.push(shellQuoteArg(nodeBin), shellQuoteArg(cliPath));
  }
  parts.push("handle", "--host", options.host);
  if (options.envFile?.trim()) {
    parts.push("--env-file", shellQuoteArg(path.resolve(options.envFile.trim())));
  }
  if (options.agentId?.trim()) {
    parts.push("--agent-id", shellQuoteArg(options.agentId.trim()));
  }
  if (options.memoryScope?.trim()) {
    parts.push("--scope", shellQuoteArg(options.memoryScope.trim()));
  }
  return parts.join(" ");
}

export function isManagedHookCommand(command: unknown, host?: SupportedHookHost): boolean {
  if (typeof command !== "string") return false;
  const isOurs =
    /\bagent-memory-hook\b/.test(command) ||
    /memory-hook-cli\.js\b/.test(command);
  if (!isOurs || !/\bhandle\b/.test(command)) return false;
  if (!host) return true;
  return new RegExp(`--host\\s+["']?${host}["']?(?:\\s|$)`).test(command);
}

interface HostEventSpec {
  event: string;
  includeMatcher: boolean;
  timeout: number;
  async?: boolean;
}

function eventSpecsForHost(host: SupportedHookHost): HostEventSpec[] {
  if (host === "codex") {
    // Strictly adhere to Codex's hooks.json schema (additionalProperties: false;
    // no Claude-specific "async" property). Async capture is handled inside
    // agent-memory-hook via its detached worker.
    return [
      { event: "UserPromptSubmit", includeMatcher: false, timeout: 5 },
      { event: "Stop", includeMatcher: false, timeout: 5 },
    ];
  }
  if (host === "claude-code") {
    return [
      { event: "UserPromptSubmit", includeMatcher: true, timeout: 5 },
      { event: "Stop", includeMatcher: true, timeout: 10, async: true },
      { event: "PreCompact", includeMatcher: true, timeout: 10 },
      { event: "SessionEnd", includeMatcher: true, timeout: 10 },
    ];
  }
  if (host === "grok") {
    // Grok warns when a matcher is attached to UserPromptSubmit/Stop and logs a
    // load warning on Claude's `async` flag; keep handlers matcherless and sync.
    return [
      { event: "UserPromptSubmit", includeMatcher: false, timeout: 5 },
      { event: "Stop", includeMatcher: false, timeout: 5 },
      { event: "PreCompact", includeMatcher: false, timeout: 10 },
      { event: "SessionEnd", includeMatcher: false, timeout: 10 },
    ];
  }
  if (host === "antigravity-cli") {
    return [
      { event: "SessionStart", includeMatcher: false, timeout: 5 },
      { event: "PreInvocation", includeMatcher: false, timeout: 5 },
      { event: "Stop", includeMatcher: false, timeout: 5 },
    ];
  }
  if (host === "cursor") {
    return [
      { event: "sessionStart", includeMatcher: false, timeout: 5 },
      { event: "beforeSubmitPrompt", includeMatcher: false, timeout: 5 },
      { event: "stop", includeMatcher: false, timeout: 5 },
      { event: "preCompact", includeMatcher: false, timeout: 10 },
      { event: "sessionEnd", includeMatcher: false, timeout: 10 },
    ];
  }
  if (host === "hermes") {
    return [
      { event: "pre_llm_call", includeMatcher: false, timeout: 5 },
      { event: "post_llm_call", includeMatcher: false, timeout: 5 },
      { event: "on_session_finalize", includeMatcher: false, timeout: 10 },
    ];
  }
  // WorkBuddy follows Claude-compatible settings.json hooks structure.
  return [
    { event: "UserPromptSubmit", includeMatcher: true, timeout: 5 },
    { event: "Stop", includeMatcher: true, timeout: 5 },
    { event: "PreCompact", includeMatcher: true, timeout: 10 },
    { event: "SessionEnd", includeMatcher: true, timeout: 10 },
  ];
}

function makeMatcherGroup(spec: HostEventSpec, command: string): Record<string, unknown> {
  const action: Record<string, unknown> = {
    type: "command",
    command,
    timeout: spec.timeout,
  };
  if (spec.async === true) {
    action.async = true;
  }
  return spec.includeMatcher
    ? { matcher: "", hooks: [action] }
    : { hooks: [action] };
}

function makeFlatHandler(spec: HostEventSpec, command: string, includeType: boolean): Record<string, unknown> {
  return includeType
    ? { type: "command", command, timeout: spec.timeout }
    : { command, timeout: spec.timeout };
}

function stripManagedHooksFromGroups(groups: unknown, host: SupportedHookHost): unknown[] {
  if (!Array.isArray(groups)) return [];
  const kept: unknown[] = [];
  for (const group of groups) {
    if (!isPlainRecord(group)) {
      kept.push(group);
      continue;
    }
    if (Array.isArray(group.hooks)) {
      const remainingActions = group.hooks.filter((action) => {
        if (!isPlainRecord(action)) return true;
        return !isManagedHookCommand(action.command, host);
      });
      if (remainingActions.length > 0) {
        kept.push({ ...group, hooks: remainingActions });
      }
      continue;
    }
    if (isManagedHookCommand(group.command, host)) {
      continue;
    }
    kept.push(group);
  }
  return kept;
}

function mergeAntigravityHooksConfig(
  existing: Record<string, unknown>,
  command: string,
  uninstall: boolean,
): { config: Record<string, unknown>; events: string[] } {
  const nextRoot: Record<string, unknown> = { ...existing };
  const specs = eventSpecsForHost("antigravity-cli");
  const events: string[] = [];

  // Strip managed commands from any top-level named hook entry so re-installs
  // and uninstalls stay idempotent without touching sibling named hooks (e.g. orca-status).
  for (const [hookName, hookBlock] of Object.entries(nextRoot)) {
    if (!isPlainRecord(hookBlock)) continue;
    const nextBlock: Record<string, unknown> = { ...hookBlock };
    let mutated = false;
    for (const [eventName, entries] of Object.entries(nextBlock)) {
      if (!Array.isArray(entries)) continue;
      const cleaned = stripManagedHooksFromGroups(entries, "antigravity-cli");
      if (cleaned.length !== entries.length) {
        mutated = true;
        if (cleaned.length > 0) nextBlock[eventName] = cleaned;
        else delete nextBlock[eventName];
      }
    }
    if (mutated) {
      const remainingEventKeys = Object.keys(nextBlock).filter((k) => k !== "enabled");
      if (remainingEventKeys.length === 0 && hookName === ANTIGRAVITY_MANAGED_HOOK_NAME) {
        delete nextRoot[hookName];
      } else {
        nextRoot[hookName] = nextBlock;
      }
    }
  }

  if (!uninstall) {
    const existingManaged = isPlainRecord(nextRoot[ANTIGRAVITY_MANAGED_HOOK_NAME])
      ? { ...(nextRoot[ANTIGRAVITY_MANAGED_HOOK_NAME] as Record<string, unknown>) }
      : {};
    for (const spec of specs) {
      const cleaned = stripManagedHooksFromGroups(existingManaged[spec.event], "antigravity-cli");
      existingManaged[spec.event] = [...cleaned, makeFlatHandler(spec, command, true)];
      events.push(spec.event);
    }
    nextRoot[ANTIGRAVITY_MANAGED_HOOK_NAME] = existingManaged;
  }

  return { config: nextRoot, events };
}

function mergeCursorHooksConfig(
  existing: Record<string, unknown>,
  command: string,
  uninstall: boolean,
): { config: Record<string, unknown>; events: string[] } {
  const nextRoot: Record<string, unknown> = {
    version: typeof existing.version === "number" ? existing.version : 1,
    ...existing,
  };
  if (typeof nextRoot.version !== "number") {
    nextRoot.version = 1;
  }
  const existingHooks = isPlainRecord(existing.hooks) ? { ...existing.hooks } : {};
  const specs = eventSpecsForHost("cursor");
  const events: string[] = [];

  for (const spec of specs) {
    const cleaned = stripManagedHooksFromGroups(existingHooks[spec.event], "cursor");
    if (uninstall) {
      if (cleaned.length > 0) existingHooks[spec.event] = cleaned;
      else delete existingHooks[spec.event];
    } else {
      existingHooks[spec.event] = [...cleaned, makeFlatHandler(spec, command, false)];
      events.push(spec.event);
    }
  }

  if (uninstall) {
    for (const [eventName, groups] of Object.entries(existingHooks)) {
      const cleaned = stripManagedHooksFromGroups(groups, "cursor");
      if (cleaned.length > 0) existingHooks[eventName] = cleaned;
      else delete existingHooks[eventName];
    }
  }

  nextRoot.hooks = existingHooks;
  return { config: nextRoot, events };
}

export function mergeHostHooksConfig(
  existing: Record<string, unknown>,
  host: SupportedHookHost,
  command: string,
  uninstall: boolean = false,
): { config: Record<string, unknown>; events: string[] } {
  if (host === "antigravity-cli") {
    return mergeAntigravityHooksConfig(existing, command, uninstall);
  }
  if (host === "cursor") {
    return mergeCursorHooksConfig(existing, command, uninstall);
  }

  const nextRoot: Record<string, unknown> = { ...existing };
  const existingHooks = isPlainRecord(existing.hooks) ? { ...existing.hooks } : {};
  const specs = eventSpecsForHost(host);
  const events: string[] = [];

  for (const spec of specs) {
    const cleaned = stripManagedHooksFromGroups(existingHooks[spec.event], host);
    if (uninstall) {
      if (cleaned.length > 0) existingHooks[spec.event] = cleaned;
      else delete existingHooks[spec.event];
    } else {
      existingHooks[spec.event] = [...cleaned, makeMatcherGroup(spec, command)];
      events.push(spec.event);
    }
  }

  // Also remove any stray managed hooks on other events during uninstall.
  if (uninstall) {
    for (const [eventName, groups] of Object.entries(existingHooks)) {
      const cleaned = stripManagedHooksFromGroups(groups, host);
      if (cleaned.length > 0) existingHooks[eventName] = cleaned;
      else delete existingHooks[eventName];
    }
  }

  if (Object.keys(existingHooks).length > 0) {
    nextRoot.hooks = existingHooks;
  } else {
    delete nextRoot.hooks;
  }

  return { config: nextRoot, events };
}

function writeTextAtomic(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(tmpPath, content, "utf8");
    renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // ignore temp cleanup failure
    }
    throw error;
  }
}

function writeJsonAtomic(filePath: string, value: Record<string, unknown>): void {
  writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function installHostHooks(options: HookInstallOptions): HookInstallResult {
  const scope: InstallScope = options.scope ?? "user";
  const configPath = resolveHostConfigPath(options.host, scope, {
    cwd: options.cwd,
    homeDir: options.homeDir,
    env: options.env,
    sharedProjectFile: options.sharedProjectFile,
  });
  const existed = existsSync(configPath);
  const command = buildHookCommand({
    host: options.host,
    commandBase: options.commandBase,
    nodeExecPath: options.nodeExecPath,
    cliScriptPath: options.cliScriptPath,
    envFile: options.envFile,
    agentId: options.agentId,
    memoryScope: options.memoryScope,
  });
  const uninstall = options.uninstall === true;
  const applied = options.apply === true;

  if (options.host === "hermes") {
    const existingRaw = existed ? readFileSync(configPath, "utf8") : "";
    const specs: HermesHookEntrySpec[] = eventSpecsForHost("hermes").map((s) => ({
      event: s.event,
      timeout: s.timeout,
    }));
    const merged = mergeHermesConfigYaml(
      existingRaw,
      specs,
      command,
      (cmd) => isManagedHookCommand(cmd, "hermes"),
      uninstall,
    );

    if (applied && (merged.changed || (!existed && !uninstall))) {
      writeTextAtomic(configPath, merged.content);
    }

    const hooksSummary: Record<string, unknown> = {};
    for (const spec of specs) {
      if (merged.events.includes(spec.event)) {
        hooksSummary[spec.event] = [{ command, timeout: spec.timeout }];
      }
    }

    return {
      host: options.host,
      scope,
      configPath,
      existed,
      applied,
      uninstalled: uninstall,
      changed: merged.changed,
      events: merged.events,
      command,
      config: { hooks: hooksSummary },
      renderedConfig: merged.content,
    };
  }

  let existing: Record<string, unknown> = {};
  if (existed) {
    const raw = readFileSync(configPath, "utf8").trim();
    if (raw) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        throw new Error(
          `existing config ${configPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!isPlainRecord(parsed)) {
        throw new Error(`existing config ${configPath} must be a JSON object`);
      }
      existing = parsed;
    }
  }

  const { config, events } = mergeHostHooksConfig(existing, options.host, command, uninstall);
  const changed = JSON.stringify(existing) !== JSON.stringify(config);

  if (applied && (changed || (!existed && !uninstall))) {
    writeJsonAtomic(configPath, config);
  }

  return {
    host: options.host,
    scope,
    configPath,
    existed,
    applied,
    uninstalled: uninstall,
    changed,
    events,
    command,
    config,
  };
}

function inspectInstalledEventsInFile(
  filePath: string,
  host: SupportedHookHost,
): { events: string[]; commandsByEvent?: Record<string, string[]>; error?: string } {
  if (!existsSync(filePath)) return { events: [] };
  try {
    const raw = readFileSync(filePath, "utf8");
    if (!raw.trim()) return { events: [] };

    if (host === "hermes") {
      const inspected = inspectHermesYamlHooks(raw, (cmd) => isManagedHookCommand(cmd, "hermes"));
      return { events: inspected.events, commandsByEvent: inspected.commandsByEvent };
    }

    const parsed = JSON.parse(raw.trim()) as unknown;
    if (!isPlainRecord(parsed)) return { events: [] };

    if (host === "antigravity-cli") {
      const found = new Set<string>();
      for (const hookBlock of Object.values(parsed)) {
        if (!isPlainRecord(hookBlock)) continue;
        if (hookBlock.enabled === false) continue;
        for (const [eventName, groups] of Object.entries(hookBlock)) {
          if (!Array.isArray(groups)) continue;
          const hasManaged = groups.some((group) => {
            if (!isPlainRecord(group)) return false;
            if (Array.isArray(group.hooks)) {
              return group.hooks.some(
                (action) => isPlainRecord(action) && isManagedHookCommand(action.command, host),
              );
            }
            return isManagedHookCommand(group.command, host);
          });
          if (hasManaged) found.add(eventName);
        }
      }
      return { events: [...found] };
    }

    if (!isPlainRecord(parsed.hooks)) return { events: [] };
    const found: string[] = [];
    for (const [eventName, groups] of Object.entries(parsed.hooks)) {
      if (!Array.isArray(groups)) continue;
      const hasManaged = groups.some((group) => {
        if (!isPlainRecord(group)) return false;
        if (Array.isArray(group.hooks)) {
          return group.hooks.some((action) => isPlainRecord(action) && isManagedHookCommand(action.command, host));
        }
        return isManagedHookCommand(group.command, host);
      });
      if (hasManaged) found.push(eventName);
    }
    return { events: found };
  } catch (error) {
    return {
      events: [],
      error: `${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function inspectInstalledHostHooks(options: {
  hosts?: SupportedHookHost[];
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
} = {}): HostHookInspection[] {
  const hosts = options.hosts ?? [...SUPPORTED_HOOK_HOSTS];
  const homeDir = options.homeDir ?? homedir();
  const env = options.env ?? process.env;

  return hosts.map((host) => {
    const userConfigPath = resolveHostConfigPath(host, "user", options);
    const projectLocalPath = resolveHostConfigPath(host, "project", { ...options, sharedProjectFile: false });
    const projectSharedPath = resolveHostConfigPath(host, "project", { ...options, sharedProjectFile: true });

    const userRes = inspectInstalledEventsInFile(userConfigPath, host);
    const projLocalRes = inspectInstalledEventsInFile(projectLocalPath, host);
    const projSharedRes = projectSharedPath !== projectLocalPath
      ? inspectInstalledEventsInFile(projectSharedPath, host)
      : { events: [] as string[] };

    const parseErrors = [userRes.error, projLocalRes.error, projSharedRes.error].filter(
      (item): item is string => Boolean(item),
    );
    const projectEvents = [...new Set([...projLocalRes.events, ...projSharedRes.events])];
    const notes: string[] = [];

    if (host === "hermes" && userRes.commandsByEvent && Object.keys(userRes.commandsByEvent).length > 0) {
      const hermesHome = env.HERMES_HOME?.trim() || path.join(homeDir, ".hermes");
      const allowlistPath = path.join(path.resolve(hermesHome), "shell-hooks-allowlist.json");
      const { pendingEvents, approvedEvents } = inspectHermesAllowlist(allowlistPath, userRes.commandsByEvent);
      if (pendingEvents.length > 0) {
        notes.push(
          `Hermes allowlist pending for ${pendingEvents.join(", ")} (approve at next TTY prompt or run with --accept-hooks / HERMES_ACCEPT_HOOKS=1)`,
        );
      } else if (approvedEvents.length > 0) {
        notes.push(`Hermes allowlist approved for ${approvedEvents.join(", ")}`);
      }
    }

    return {
      host,
      userConfigPath,
      projectConfigPath: projectLocalPath,
      userInstalledEvents: userRes.events,
      projectInstalledEvents: projectEvents,
      parseErrors,
      notes,
    };
  });
}
