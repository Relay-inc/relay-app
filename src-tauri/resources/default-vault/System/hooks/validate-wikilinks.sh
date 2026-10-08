#!/usr/bin/env bash
# PostToolUse on Write/Edit: warns (never blocks) when a wikilink points to a note or file
# that does not exist. Embeds of attachments and path links count, aliases do not.
set -uo pipefail
FILE_PATH=$(jq -r '.tool_input.file_path // empty')
[[ "$FILE_PATH" == *.md && -f "$FILE_PATH" ]] || exit 0
case "$FILE_PATH" in
  */.claude/*|*/System/*|*/Resources/Templates/*) exit 0 ;;
esac
ROOT="${CLAUDE_PROJECT_DIR:-}"
if [[ -z "$ROOT" || ! -d "$ROOT/System" ]]; then
  ROOT=$(cd "$(dirname "$FILE_PATH")" && while [[ ! -d System/rules && "$PWD" != / ]]; do cd ..; done; pwd)
  [[ "$ROOT" == / ]] && exit 0
fi

# Link targets, without code blocks, aliases (|) and headings (#), reduced to their basename
LINKS=$(awk '/^```/{c=!c; next} !c' "$FILE_PATH" | grep -oE '\[\[[^]]+\]\]' \
  | sed 's/^\[\[//; s/\]\]$//; s/|.*//; s/#.*//; s|.*/||' | sort -u)
[[ -n "$LINKS" ]] || exit 0

# Every file name in the vault, lowercased: notes without .md, other files with their extension
NAMES=$(find "$ROOT" -type f -not -path '*/.*' -not -path '*/node_modules/*' \
  | sed 's|.*/||; s/\.md$//' | tr '[:upper:]' '[:lower:]' | sort -u)

ORPHANS=""
while IFS= read -r l; do
  [[ -z "$l" ]] && continue
  low=$(printf '%s' "${l%.md}" | tr '[:upper:]' '[:lower:]')
  grep -qxF "$low" <<< "$NAMES" || ORPHANS="${ORPHANS}[[${l}]], "
done <<< "$LINKS"
[[ -z "$ORPHANS" ]] && exit 0
jq -n --arg o "${ORPHANS%, }" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: ("Orphan wikilinks: " + $o + ". No note or file with that name exists. Check the name, link an existing note, or use plain text.")}}'
