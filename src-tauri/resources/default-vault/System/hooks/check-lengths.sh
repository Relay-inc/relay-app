#!/usr/bin/env bash
# PostToolUse on Write/Edit: warns, never blocks. A project note's "## Status" over 2,000
# characters asks for a re-evaluation. If everything in it is still current, it may stay.
set -uo pipefail
FILE_PATH=$(jq -r '.tool_input.file_path // empty')
[[ "$FILE_PATH" == *.md && -f "$FILE_PATH" ]] || exit 0
N=$(awk '/^## /{on=($0=="## Status"); next} on' "$FILE_PATH" | wc -c | tr -d ' ')
[[ "$N" -gt 2000 ]] || exit 0
R="## Status in $(basename "$FILE_PATH") is $N characters (limit 2,000). Re-evaluate, do not rewrite blindly: is every line still current state? What only says what happened goes to Log.md, open loops to ## Open. If it is all still current, leave it and say so."
jq -n --arg r "$R" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $r}}'
