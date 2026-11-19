import { existsSync, readFileSync } from "node:fs";

export interface HermesHookEntrySpec {
  event: string;
  timeout: number;
}

interface ParsedSubSection {
  key: string;
  headerLine: string;
  bodyLines: string[];
}

interface ParsedListItem {
  rawLines: string[];
  command?: string;
}

function stripInlineYamlComment(value: string): string {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (inDouble) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "'" && value[i + 1] === "'") {
        i += 1;
      } else if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (ch === '"') {
      inDouble = true;
    } else if (ch === "'") {
      inSingle = true;
    } else if (ch === "#" && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i).trim();
    }
  }
  return value.trim();
}

export function unquoteYamlScalar(raw: string): string {
  const cleaned = stripInlineYamlComment(raw).trim();
  if (!cleaned) return "";
  if (cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length >= 2) {
    try {
      const parsed = JSON.parse(cleaned) as unknown;
      if (typeof parsed === "string") return parsed;
    } catch {
      return cleaned.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }
  if (cleaned.startsWith("'") && cleaned.endsWith("'") && cleaned.length >= 2) {
    return cleaned.slice(1, -1).replace(/''/g, "'");
  }
  return cleaned;
}

function leadingIndent(line: string): number {
  let count = 0;
  while (count < line.length && line[count] === " ") count += 1;
  return count;
}

function findTopLevelHooksRange(lines: string[]): {
  startLine: number;
  endLine: number;
  trailingBlankCount: number;
} | undefined {
  let startLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^hooks\s*:(?:\s|$|#)/.test(lines[i])) {
      startLine = i;
      break;
    }
  }
  if (startLine === -1) return undefined;

  let endLine = startLine + 1;
  while (endLine < lines.length) {
    const line = lines[endLine];
    if (line.trim() === "" || /^\s+#/.test(line) || /^\s+/.test(line)) {
      endLine += 1;
      continue;
    }
    break;
  }

  // Keep any blank lines immediately preceding the next top-level key outside
  // the replaced range so surrounding spacing stays untouched.
  let trailingBlankCount = 0;
  while (endLine > startLine + 1 && lines[endLine - 1].trim() === "") {
    endLine -= 1;
    trailingBlankCount += 1;
  }

  return { startLine, endLine, trailingBlankCount };
}

function parseHooksSubSections(blockLines: string[]): {
  leadingComments: string[];
  sections: ParsedSubSection[];
} {
  const leadingComments: string[] = [];
  const sections: ParsedSubSection[] = [];

  if (blockLines.length <= 1) {
    return { leadingComments, sections };
  }

  // Detect the child key indentation (normally 2 spaces).
  let childIndent: number | undefined;
  for (let i = 1; i < blockLines.length; i += 1) {
    const line = blockLines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    childIndent = leadingIndent(line);
    break;
  }
  if (childIndent === undefined || childIndent === 0) {
    return { leadingComments, sections };
  }

  let current: ParsedSubSection | undefined;
  for (let i = 1; i < blockLines.length; i += 1) {
    const line = blockLines[i];
    const trimmed = line.trim();
    if (!current && (!trimmed || trimmed.startsWith("#"))) {
      leadingComments.push(line);
      continue;
    }
    const indent = leadingIndent(line);
    const keyMatch = indent === childIndent ? line.slice(indent).match(/^([A-Za-z0-9_.-]+)\s*:(.*)$/) : null;
    if (keyMatch) {
      current = {
        key: keyMatch[1],
        headerLine: line,
        bodyLines: [],
      };
      sections.push(current);
      continue;
    }
    if (current) {
      current.bodyLines.push(line);
    }
  }

  return { leadingComments, sections };
}

function parseYamlListItems(section: ParsedSubSection): ParsedListItem[] | undefined {
  const headerAfterColon = stripInlineYamlComment(
    section.headerLine.slice(section.headerLine.indexOf(":") + 1),
  );
  if (headerAfterColon === "[]" || headerAfterColon === "null" || headerAfterColon === "~") {
    return [];
  }
  if (headerAfterColon && headerAfterColon !== "") {
    // Non-list inline scalar or map (e.g. `output_spill: { ... }`); leave untouched.
    return undefined;
  }

  const nonEmptyBody = section.bodyLines.filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (nonEmptyBody.length === 0) {
    return [];
  }

  // Check if this section is actually a YAML sequence (`- ...`) rather than a nested mapping (like `output_spill:`).
  const firstNonEmpty = nonEmptyBody[0];
  const itemIndent = leadingIndent(firstNonEmpty);
  if (!firstNonEmpty.slice(itemIndent).startsWith("-")) {
    return undefined;
  }

  const items: ParsedListItem[] = [];
  let current: string[] | undefined;
  for (const line of section.bodyLines) {
    const trimmed = line.trim();
    const indent = leadingIndent(line);
    if (trimmed && !trimmed.startsWith("#") && indent === itemIndent && line.slice(indent).startsWith("-")) {
      if (current) items.push(buildParsedItem(current));
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) items.push(buildParsedItem(current));
  return items;
}

function buildParsedItem(rawLines: string[]): ParsedListItem {
  let command: string | undefined;
  for (const line of rawLines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(?:-\s*)?command\s*:\s*(.+)$/);
    if (match) {
      command = unquoteYamlScalar(match[1]);
      break;
    }
  }
  return { rawLines, command };
}

function formatManagedItemLines(command: string, timeout: number): string[] {
  return [
    `    - command: ${JSON.stringify(command)}`,
    `      timeout: ${timeout}`,
  ];
}

export function mergeHermesConfigYaml(
  existingContent: string,
  specs: readonly HermesHookEntrySpec[],
  command: string,
  isManagedCommand: (cmd: unknown) => boolean,
  uninstall: boolean = false,
): { content: string; events: string[]; changed: boolean } {
  const normalizedExisting = existingContent.replace(/\r\n/g, "\n");
  const lines = normalizedExisting ? normalizedExisting.split("\n") : [];
  // Remove trailing synthetic empty element from trailing newline for clean line math.
  const hadTrailingNewline = normalizedExisting.endsWith("\n");
  if (hadTrailingNewline && lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const range = findTopLevelHooksRange(lines);
  const existingBlockLines = range ? lines.slice(range.startLine, range.endLine) : [];
  const { leadingComments, sections } = parseHooksSubSections(existingBlockLines);

  const specByEvent = new Map<string, HermesHookEntrySpec>(specs.map((s) => [s.event, s]));
  const renderedSections: string[] = [];
  const handledEvents = new Set<string>();
  const installedEvents: string[] = [];

  for (const section of sections) {
    const spec = specByEvent.get(section.key);
    const parsedItems = parseYamlListItems(section);

    if (parsedItems === undefined) {
      // Non-list sub-section (such as `output_spill:`); preserve verbatim.
      renderedSections.push(section.headerLine, ...section.bodyLines);
      continue;
    }

    const keptItems = parsedItems.filter((item) => !isManagedCommand(item.command));

    if (spec) {
      handledEvents.add(spec.event);
      if (uninstall) {
        if (keptItems.length > 0) {
          renderedSections.push(`  ${section.key}:`);
          for (const item of keptItems) renderedSections.push(...item.rawLines);
        }
      } else {
        renderedSections.push(`  ${section.key}:`);
        for (const item of keptItems) renderedSections.push(...item.rawLines);
        renderedSections.push(...formatManagedItemLines(command, spec.timeout));
        installedEvents.push(spec.event);
      }
      continue;
    }

    // Other hook event (e.g. pre_tool_call): on uninstall also strip stray managed entries;
    // on install preserve verbatim.
    if (uninstall && keptItems.length !== parsedItems.length) {
      if (keptItems.length > 0) {
        renderedSections.push(`  ${section.key}:`);
        for (const item of keptItems) renderedSections.push(...item.rawLines);
      }
    } else {
      renderedSections.push(section.headerLine, ...section.bodyLines);
    }
  }

  if (!uninstall) {
    for (const spec of specs) {
      if (handledEvents.has(spec.event)) continue;
      renderedSections.push(`  ${spec.event}:`);
      renderedSections.push(...formatManagedItemLines(command, spec.timeout));
      installedEvents.push(spec.event);
    }
  }

  let nextHooksBlock: string[];
  if (renderedSections.length === 0) {
    nextHooksBlock = range ? ["hooks: {}"] : [];
  } else {
    nextHooksBlock = ["hooks:", ...leadingComments, ...renderedSections];
  }

  let nextLines: string[];
  if (range) {
    nextLines = [
      ...lines.slice(0, range.startLine),
      ...nextHooksBlock,
      ...lines.slice(range.endLine),
    ];
  } else if (nextHooksBlock.length > 0) {
    nextLines = lines.length > 0 ? [...lines, "", ...nextHooksBlock] : [...nextHooksBlock];
  } else {
    nextLines = [...lines];
  }

  const nextContent = nextLines.length > 0 ? `${nextLines.join("\n")}\n` : "";
  return {
    content: nextContent,
    events: installedEvents,
    changed: nextContent !== normalizedExisting,
  };
}

export function inspectHermesYamlHooks(
  content: string,
  isManagedCommand: (cmd: unknown) => boolean,
): { events: string[]; commandsByEvent: Record<string, string[]> } {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const range = findTopLevelHooksRange(lines);
  if (!range) return { events: [], commandsByEvent: {} };

  const { sections } = parseHooksSubSections(lines.slice(range.startLine, range.endLine));
  const events: string[] = [];
  const commandsByEvent: Record<string, string[]> = {};

  for (const section of sections) {
    const items = parseYamlListItems(section);
    if (!items) continue;
    const matched = items
      .map((item) => item.command)
      .filter((cmd): cmd is string => typeof cmd === "string" && isManagedCommand(cmd));
    if (matched.length > 0) {
      events.push(section.key);
      commandsByEvent[section.key] = matched;
    }
  }

  return { events, commandsByEvent };
}

export function inspectHermesAllowlist(
  allowlistPath: string,
  commandsByEvent: Record<string, string[]>,
): { pendingEvents: string[]; approvedEvents: string[] } {
  const approvedPairs = new Set<string>();
  if (existsSync(allowlistPath)) {
    try {
      const parsed = JSON.parse(readFileSync(allowlistPath, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const approvals = (parsed as Record<string, unknown>).approvals;
        if (Array.isArray(approvals)) {
          for (const entry of approvals) {
            if (
              entry &&
              typeof entry === "object" &&
              typeof (entry as Record<string, unknown>).event === "string" &&
              typeof (entry as Record<string, unknown>).command === "string"
            ) {
              approvedPairs.add(
                `${(entry as Record<string, unknown>).event}\0${(entry as Record<string, unknown>).command}`,
              );
            }
          }
        }
      }
    } catch {
      // Ignore malformed allowlist; doctor reports pending status safely.
    }
  }

  const pendingEvents: string[] = [];
  const approvedEvents: string[] = [];
  for (const [event, commands] of Object.entries(commandsByEvent)) {
    const allApproved = commands.every((cmd) => approvedPairs.has(`${event}\0${cmd}`));
    if (allApproved) approvedEvents.push(event);
    else pendingEvents.push(event);
  }
  return { pendingEvents, approvedEvents };
}
