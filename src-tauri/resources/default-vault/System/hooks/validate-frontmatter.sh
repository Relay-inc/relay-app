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

# the types and their required keys come from the registry: Relay writes them as `Name: keys` lines in the
# `<!-- required ... -->` block of rules/vault/types.md. No file yet: nothing to check against.
RULE="$(dirname "$0")/../rules/vault/types.md"
[[ -f "$RULE" ]] || exit 0
REQ=$(awk '/^<!-- required$/{on=1;next} /^-->$/{on=0} on' "$RULE")
block() { jq -n --arg r "$1" '{decision: "block", reason: $r}'; exit 0; }

TYPE=$(printf '%s\n' "$FM" | sed -n 's/^type:[[:space:]]*//p' | head -1 | tr -d '"'"'" | xargs)
NAMES=$(printf '%s\n' "$REQ" | sed 's/:.*//' | paste -sd, - | sed 's/,/, /g')
[[ -n "$TYPE" ]] || block "Missing \`type:\` in the frontmatter. Valid types: $NAMES. Templates are in Resources/Templates/."
printf '%s\n' "$REQ" | awk -F: -v t="$TYPE" '$1==t{f=1} END{exit !f}' || block "Invalid type \"$TYPE\". Valid types: $NAMES. Templates are in Resources/Templates/."

for KEY in $(printf '%s\n' "$REQ" | awk -F': *' -v t="$TYPE" '$1==t{gsub(/,/," ",$2); print $2}'); do
  VAL=$(printf '%s\n' "$FM" | sed -n "s/^$KEY:[[:space:]]*//p" | head -1)
  [[ -n "$VAL" ]] || block "Type \"$TYPE\" needs \`$KEY:\` in the frontmatter (a wikilink for \`context:\`, for example \`context: \"[[Work]]\"\`)."
  [[ $KEY != context || "$VAL" == *"[["* ]] || block "\`context:\` must be a wikilink, for example \`context: \"[[Work]]\"\`."
done
exit 0
