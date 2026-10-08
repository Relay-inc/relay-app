#!/usr/bin/env bash
# PostToolUse on Write/Edit: memory.md must carry today's date on its "Last updated" line,
# so a stale or guessed date never lands there.
set -uo pipefail
FILE_PATH=$(jq -r '.tool_input.file_path // empty')
[[ "$FILE_PATH" == */rules/core/memory.md && -f "$FILE_PATH" ]] || exit 0
TODAY=$(date +%Y-%m-%d)
WRITTEN=$(grep -oE 'Last updated: [0-9]{4}-[0-9]{2}-[0-9]{2}' "$FILE_PATH" | grep -oE '[0-9-]{10}' | head -1)
[[ -z "$WRITTEN" || "$WRITTEN" == "$TODAY" ]] && exit 0
jq -n --arg w "$WRITTEN" --arg t "$TODAY" '{decision: "block", reason: ("memory.md says Last updated: " + $w + ", but today is " + $t + ". Use the current date from the system context.")}'
