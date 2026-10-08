#!/usr/bin/env bash
# Stop hook: when a session wrote to project material (vault or a linked repo), that project's
# note must carry "*Status, last updated <today>.*". If not, block the stop once with the fix.
# Small sessions (one write) pass. On the second pass (stop_hook_active) it always lets through.
set -uo pipefail
INPUT=$(cat)
[[ "$(jq -r '.stop_hook_active // false' <<< "$INPUT")" == "true" ]] && exit 0
TRANSCRIPT=$(jq -r '.transcript_path // empty' <<< "$INPUT")
[[ -f "$TRANSCRIPT" ]] || exit 0
VAULT="${CLAUDE_PROJECT_DIR:-$PWD}"
TODAY=$(date +%Y-%m-%d)

PATHS=$(jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use" and (.name=="Write" or .name=="Edit" or .name=="MultiEdit")) | .input.file_path // empty' "$TRANSCRIPT" 2>/dev/null | sort -u)
[[ -n "$PATHS" ]] || exit 0

# Repo path to project note: longest matching prefix in System/index/repos.json (build-index.py)
REPOS="$VAULT/System/index/repos.json"
repo_note() {
  [[ -f "$REPOS" ]] && jq -r --arg p "$1" 'to_entries | map(select(.key as $k | $p == $k or ($p | startswith($k + "/")))) | (max_by(.key | length) | .value) // empty' "$REPOS" 2>/dev/null
}

NOTES="" COUNT=0
while IFS= read -r p; do
  case "$p" in */Calendar/*|*/System/*|*/.claude/*|*/Resources/*|"") continue ;; esac
  note=""
  if [[ "$p" == "$VAULT/Contexts/"* ]]; then
    [[ "${p#$VAULT/}" =~ ^(Contexts/[^/]+/Projects/([^/]+))/ ]] && note="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}.md"
  else
    note=$(repo_note "$p")
  fi
  [[ -n "$note" ]] || continue
  COUNT=$((COUNT+1)); NOTES="${NOTES}${note}"$'\n'
done <<< "$PATHS"
[[ $COUNT -ge 2 ]] || exit 0

MISSING=""
while IFS= read -r note; do
  [[ -n "$note" ]] || continue
  grep -qF "Status, last updated $TODAY" "$VAULT/$note" 2>/dev/null || MISSING="${MISSING}${note}, "
done <<< "$(sort -u <<< "$NOTES")"
[[ -n "$MISSING" ]] || exit 0

jq -n --arg l "${MISSING%, }" --arg t "$TODAY" '{decision: "block", reason: ("This session wrote to project material, but ## Status of these notes was not updated on " + $t + ": " + $l + ". Rewrite that section now (first line `*Status, last updated " + $t + ".*`, then where the project stands, what is open and the next step, under ~2,000 characters), set `last` to today and `index` to one sentence (max 160 characters) on the card, run `python3 System/scripts/build-index.py`, then stop.")}'
