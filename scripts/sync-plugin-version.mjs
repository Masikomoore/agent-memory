import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseJsonStringToken(text, startIndex) {
  let index = startIndex + 1;

  while (index < text.length) {
    const ch = text[index];
    if (ch === "\\") {
      index += 2;
      continue;
    }
    if (ch === "\"") {
      return {
        raw: text.slice(startIndex + 1, index),
        end: index,
      };
    }
    index += 1;
  }

  throw new Error("Unterminated JSON string");
}

function skipWhitespace(text, startIndex) {
  let index = startIndex;
  while (index < text.length && /\s/.test(text[index])) {
    index += 1;
  }
  return index;
}

export function replaceTopLevelVersion(text, nextVersion) {
  let depth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];

    if (ch === "\"") {
      const token = parseJsonStringToken(text, index);

      if (depth === 1 && token.raw === "version") {
        const colonIndex = skipWhitespace(text, token.end + 1);
        if (text[colonIndex] !== ":") {
          throw new Error("Malformed JSON: expected ':' after version key");
        }

        const valueIndex = skipWhitespace(text, colonIndex + 1);
        if (text[valueIndex] !== "\"") {
          throw new Error("Malformed JSON: expected string version value");
        }

        const currentValue = parseJsonStringToken(text, valueIndex);
        const escapedVersion = JSON.stringify(nextVersion);
        return `${text.slice(0, valueIndex)}${escapedVersion}${text.slice(currentValue.end + 1)}`;
      }

      index = token.end;
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
    }
  }

  throw new Error("Top-level version field not found in manifest");
}

export function syncManifestVersion({
  manifestPath,
  packagePath,
}) {
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  const manifestText = readFileSync(manifestPath, "utf8");
  const updatedManifestText = replaceTopLevelVersion(manifestText, pkg.version);

  if (updatedManifestText !== manifestText) {
    writeFileSync(manifestPath, updatedManifestText);
    return true;
  }

  return false;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const manifestPath = process.argv[2] ?? path.resolve(scriptDir, "../openclaw.plugin.json");
  const packagePath = process.argv[3] ?? path.resolve(scriptDir, "../package.json");

  syncManifestVersion({ manifestPath, packagePath });
}
