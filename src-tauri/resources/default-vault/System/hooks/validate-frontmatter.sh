#!/usr/bin/env bash
# PostToolUse on Write/Edit: every note needs a valid `type:`, and notes inside a context
# need `context:` as a wikilink. Blocks with the fix in the reason.
set -uo pipefail
FILE_PATH=$(jq -r '.tool_input.file_path // empty')
[[ "$FILE_PATH" == *.md && -f "$FILE_PATH" ]] || exit 0
case "$FILE_PATH" in
  */.claude/*|*/System/*|*/Resources/Templates/*|*/Attachments/*) exit 0 ;;
esac
[[ "$(head -1 "$FILE_PATH")" == "---" ]] || exit 0
FM=$(awk 'NR==1{next} /^---$/{exit} {print}' "$FILE_PATH")
[[ -n "$FM" ]] || exit 0

TYPES="Context|Project|Document|Meeting|Thread|Person|Reference|Framework"
block() { jq -n --arg r "$1" '{decision: "block", reason: $r}'; exit 0; }

TYPE=$(printf '%s\n' "$FM" | sed -n 's/^type:[[:space:]]*//p' | head -1 | tr -d '"'"'" | xargs)
[[ -n "$TYPE" ]] || block "Missing \`type:\` in the frontmatter. Valid types: ${TYPES//|/, }. Templates are in Resources/Templates/."
printf '%s' "$TYPE" | grep -qxE "$TYPES" || block "Invalid type \"$TYPE\". Valid types: ${TYPES//|/, }. Templates are in Resources/Templates/."

if printf '%s' "$TYPE" | grep -qxE "Project|Document|Meeting|Thread"; then
  CTX=$(printf '%s\n' "$FM" | sed -n 's/^context:[[:space:]]*//p' | head -1)
  [[ -n "$CTX" ]] || block "Type \"$TYPE\" needs \`context:\` as a wikilink, for example \`context: \"[[Work]]\"\`."
  [[ "$CTX" == *"[["* ]] || block "\`context:\` must be a wikilink, for example \`context: \"[[Work]]\"\`."
fi
exit 0
