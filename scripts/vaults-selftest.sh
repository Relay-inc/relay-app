#!/bin/bash
# Shared vaults end to end in the real app (src-tauri/src/selftest.rs, phase "vaults"): a relay-server on localhost,
# a separate build of Relay with the selftest feature, its own bundle id, data folder and broker folder, and a
# throwaway main vault with project Alpha and a secret note, so the Relay in use is not touched. One conversation runs
# on the real claude CLI (haiku, Claude Code on the subscription). Exits non-zero on a failed step.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=/tmp/relay-vaultstest
ID=be.laurentmeersman.relay-vaultstest
DATA="$HOME/Library/Application Support/$ID"
PORT=47812

rm -rf "$DIR" "$DATA" "$HOME/Library/WebKit/$ID" "$HOME/Library/Caches/$ID"
mkdir -p "$DIR/vault/System/rules/core" "$DIR/vault/Contexts/Personal/Projects/Alpha" "$DIR/server" "$DATA"
DIR=$(cd "$DIR" && pwd -P) # /tmp is /private/tmp
cat > "$DIR/vault/System/rules/core/work-state.md" <<'MD'
# Work State

## Projects

### Personal

| Project | State | Last | Summary |
|---|---|---|---|
| [[Alpha]] | Active | 2026-10-26 | Apple trees in the garden. |
MD
printf -- '---\ntype: Initiative\nstatus: Active\n---\n# Alpha\n\n## Stand van zaken\n\nAlpha plants three apple trees.\n' > "$DIR/vault/Contexts/Personal/Projects/Alpha/Alpha.md"
printf 'SECRET-ALPHA-7731\n' > "$DIR/vault/Contexts/Personal/Projects/Alpha/secret.md"
printf '{"vault": "%s", "language": "en"}' "$DIR/vault" > "$DATA/settings.json"

echo "== builds"
pnpm -s build >/dev/null
CARGO_TARGET_DIR=target/selftest cargo build -q -p relay-server
TAURI_CONFIG="{\"identifier\":\"$ID\",\"productName\":\"Relay Vaultstest\"}" CARGO_TARGET_DIR=target/selftest \
  cargo build -q -p relay --features "selftest tauri/custom-protocol"

echo "== relay-server on 127.0.0.1:$PORT"
RELAY_SERVER_DATA="$DIR/server" RELAY_AGENTS_DIR="$DIR/server-agents" target/selftest/debug/relay-server serve --port $PORT --bind 127.0.0.1 2>"$DIR/server.log" &
SERVER=$!
APP=""; WATCH=""
trap 'kill $SERVER $APP $WATCH 2>/dev/null || true; pkill -f "$DIR/agents" 2>/dev/null || true' EXIT
sleep 1
LINE=$(RELAY_SERVER_DATA="$DIR/server" target/selftest/debug/relay-server pair --host 127.0.0.1 --port $PORT | grep '^relay://')

echo "== shared vaults (a minute or two)"
# the app's own exit code counts (1 on a FAIL), and a hung app is stopped after 15 minutes: a panic in this debug build
# does not abort, it hangs until then
RELAY_AGENTS_DIR="$DIR/agents" RELAY_SELFTEST=vaults RELAY_SELFTEST_DIR="$DIR" RELAY_SELFTEST_LINE="$LINE" \
  target/selftest/debug/relay 2>"$DIR/app.log" >"$DIR/app.out" &
APP=$!
( sleep 900 && kill $APP 2>/dev/null && echo "the app hung: stopped after 15 minutes" >>"$DIR/report.txt" ) &
WATCH=$!
set +e
wait $APP
CODE=$?
set -e
kill $WATCH 2>/dev/null || true
grep '^selftest' "$DIR/app.out" || true

echo "== report ($DIR/report.txt), app exit $CODE"
cat "$DIR/report.txt"
[ "$CODE" -eq 0 ] && ! grep -q '^FAIL' "$DIR/report.txt"
