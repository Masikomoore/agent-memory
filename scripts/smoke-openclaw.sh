#!/usr/bin/env bash
set -euo pipefail

# Non-destructive smoke test for a real OpenClaw environment where the plugin is installed.
# Intended for release preflight and on-host validation.

openclaw memory-pro version
openclaw memory-pro stats
openclaw memory-pro list --limit 3
openclaw memory-pro search "plugin" --limit 3

# export/import (dry-run)
TMP_JSON="/tmp/memory-pro-export.json"
openclaw memory-pro export --scope global --category decision --output "$TMP_JSON"
openclaw memory-pro import --dry-run "$TMP_JSON"

# delete commands (dry-run/help only)
openclaw memory-pro delete --help >/dev/null
openclaw memory-pro delete-bulk --scope global --before 1900-01-01 --dry-run

# migrate (read-only)
openclaw memory-pro migrate check

# reembed (dry-run). Adjust source-db path if needed.
if [[ -d "$HOME/.openclaw/memory/lancedb-pro" ]]; then
  openclaw memory-pro reembed --source-db "$HOME/.openclaw/memory/lancedb-pro" --limit 1 --dry-run
else
  echo "NOTE: $HOME/.openclaw/memory/lancedb-pro not found; skipping reembed smoke."
fi

echo "OK: openclaw smoke suite passed"
