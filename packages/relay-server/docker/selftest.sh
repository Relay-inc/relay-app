#!/bin/bash
# The work machines end to end on one Mac: relay-server in Docker (Linux, a stand-in claude) and a separate build of
# Relay with the selftest feature (src-tauri/src/selftest.rs). The test build has its own bundle id, data folder,
# broker folder and a throwaway vault, so the Relay in use is not touched. Phase 1 pairs through the settings page and
# talks to the machine, phase 2 restarts the app and takes the conversation back. Exits non-zero on a failed step.
set -euo pipefail
cd "$(dirname "$0")/../../.."
DIR=/tmp/relay-selftest
ID=be.laurentmeersman.relay-selftest
DATA="$HOME/Library/Application Support/$ID"
COMPOSE=(docker compose -p relay-selftest -f packages/relay-server/docker/compose.yml)

rm -rf "$DIR" "$DATA" "$HOME/Library/WebKit/$ID" "$HOME/Library/Caches/$ID" && mkdir -p "$DIR/vault/System/rules/core" "$DIR/vault/Contexts" "$DATA"
cat > "$DIR/vault/System/rules/core/work-state.md" <<'MD'
# Work State

## Projects

### Personal

| Project | State | Last | Summary |
|---|---|---|---|
| [[Testproject]] | Active | 2026-10-01 | The selftest's project. |
MD
printf '{"vault": "%s", "language": "en"}' "$DIR/vault" > "$DATA/settings.json"

echo "== relay-server in Docker (test target)"
"${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
TARGET=test "${COMPOSE[@]}" up -d --build --quiet-pull 2>&1 | tail -1
LINE=$("${COMPOSE[@]}" exec -T relay-server relay-server pair --host 127.0.0.1 | grep '^relay://')

echo "== Relay selftest build"
pnpm -s build >/dev/null
TAURI_CONFIG="{\"identifier\":\"$ID\",\"productName\":\"Relay Selftest\"}" CARGO_TARGET_DIR=target/selftest \
  cargo build -q -p relay --features "selftest tauri/custom-protocol"
APP=target/selftest/debug/relay
run() { RELAY_AGENTS_DIR="$DIR/agents" RELAY_SELFTEST=$1 RELAY_SELFTEST_LINE="$LINE" RELAY_SELFTEST_DIR="$DIR" "$APP" 2>"$DIR/app-$1.log" | grep '^selftest' || true; }

echo "== phase 1"; run 1
echo "== phase 2 (restart)"; run 2
NOTE=$("${COMPOSE[@]}" exec -T relay-server cat /home/relay/repos/testproject/note.txt 2>/dev/null || true)
if [ "$NOTE" = relay ]; then echo "PASS the allowed Write landed on the machine" >> "$DIR/report.txt"; else echo "FAIL note.txt on the machine: '$NOTE'" >> "$DIR/report.txt"; fi
"${COMPOSE[@]}" logs --no-color > "$DIR/server.log" 2>&1
[ "${KEEP:-}" = 1 ] || "${COMPOSE[@]}" down -v >/dev/null 2>&1

echo "== report ($DIR/report.txt)"
cat "$DIR/report.txt"
! grep -q '^FAIL' "$DIR/report.txt"
