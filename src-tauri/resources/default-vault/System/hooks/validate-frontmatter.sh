#!/usr/bin/env bash
# PostToolUse on Write/Edit: every note needs a `type:` from the vault's type registry (.relay/types.json), and every
# key that type requires; a required link takes a wikilink. Blocks with the fix in the reason.
set -uo pipefail
FILE_PATH=$(jq -r '.tool_input.file_path // empty')
[[ "$FILE_PATH" == *.md && -f "$FILE_PATH" ]] || exit 0
case "$FILE_PATH" in
  */.claude/*|*/System/*|*/Resources/Templates/*|*/Attachments/*) exit 0 ;;
esac
REG="${CLAUDE_PROJECT_DIR:-.}/.relay/types.json"
[[ -f "$REG" ]] || exit 0
[[ "$(head -1 "$FILE_PATH")" == "---" ]] || exit 0
FM=$(awk 'NR==1{next} /^---$/{exit} {print}' "$FILE_PATH")
[[ -n "$FM" ]] || exit 0

block() { jq -n --arg r "$1" '{decision: "block", reason: $r}'; exit 0; }
TYPES=$(jq -r '[.types[].name] | join(", ")' "$REG")
HELP="Valid types: $TYPES (System/rules/vault/types.md). Templates are in Resources/Templates/."

TYPE=$(printf '%s\n' "$FM" | sed -n 's/^type:[[:space:]]*//p' | head -1 | tr -d '"'"'" | xargs)
[[ -n "$TYPE" ]] || block "Missing \`type:\` in the frontmatter. $HELP"
DEF=$(jq -c --arg t "$TYPE" 'first(.types[] | select(.name | ascii_downcase == ($t | ascii_downcase))) // empty' "$REG")
[[ -n "$DEF" ]] || block "Invalid type \"$TYPE\". $HELP"
NAME=$(jq -r '.name' <<<"$DEF")

# each required key with its field's kind: its value is the rest of its line and the indented or `- ` lines under it
while IFS=$'\t' read -r KEY KIND; do
  [[ -n "$KEY" ]] || continue
  VAL=$(printf '%s\n' "$FM" | awk -v k="$KEY:" 'on && /^([ \t]|- )/ {print; next} on {exit} index($0, k) == 1 {on = 1; print substr($0, length(k) + 1)}')
  [[ -n "$(printf '%s' "$VAL" | tr -d " \t\n\"'[]-")" ]] || block "Type \"$NAME\" needs \`$KEY:\` filled in. See System/rules/vault/types.md."
  if [[ "$KIND" == link || "$KIND" == people ]]; then
    [[ "$VAL" == *"[["* ]] || block "\`$KEY:\` must be a wikilink, for example \`$KEY: \"[[Name]]\"\`."
  fi
done < <(jq -r '.required[]? as $k | [$k, (first((.fields // [])[] | select(.key == $k) | .kind) // "text")] | @tsv' <<<"$DEF")
exit 0
