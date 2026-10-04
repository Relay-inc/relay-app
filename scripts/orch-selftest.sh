#!/bin/bash
# The orchestrator end to end against the real claude CLI (Claude Code on the subscription, a few minutes of work):
# a separate build of Relay with the selftest feature (src-tauri/src/selftest.rs, phase "orch"), its own bundle id,
# data folder and broker folder, a throwaway vault with projects Alpha and Beta and a git repo for Beta, so the
# Relay in use is not touched. Exits non-zero on a failed step. scripts/orch-check.py covers the CLI flags alone.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=/tmp/relay-orchtest
ID=be.laurentmeersman.relay-orchtest
DATA="$HOME/Library/Application Support/$ID"
REPO="$DIR/repos/beta"

rm -rf "$DIR" "$DATA" "$HOME/Library/WebKit/$ID" "$HOME/Library/Caches/$ID"
mkdir -p "$DIR/vault/System/rules/core" "$DIR/vault/System/index" "$DIR/vault/Contexts/Personal/Projects/Alpha" "$DIR/vault/Contexts/Personal/Projects/Beta" "$REPO" "$DATA"
DIR=$(cd "$DIR" && pwd -P) && REPO="$DIR/repos/beta" # /tmp is /private/tmp, git answers with the real path
cat > "$DIR/vault/System/rules/core/work-state.md" <<'MD'
# Work State

## Projects

### Personal

| Project | State | Last | Summary |
|---|---|---|---|
| [[Alpha]] | Active | 2026-10-04 | Apple trees in the garden. |
| [[Beta]] | Active | 2026-10-04 | A small repo with a README. |
MD
printf -- '---\ntype: Initiative\nstatus: Active\n---\n# Alpha\n\n## Stand van zaken\n\nAlpha plants three apple trees in the garden: a Jonagold, an Elstar and a Boskoop. The Boskoop is already there.\n' > "$DIR/vault/Contexts/Personal/Projects/Alpha/Alpha.md"
printf -- '---\ntype: Initiative\nstatus: Active\n---\n# Beta\n\n## Stand van zaken\n\nBeta is a repo with only a README.\n' > "$DIR/vault/Contexts/Personal/Projects/Beta/Beta.md"
printf '{"%s": "Contexts/Personal/Projects/Beta/Beta.md"}' "$REPO" > "$DIR/vault/System/index/repos.json"
git -C "$REPO" init -q -b main && echo "# Beta" > "$REPO/README.md" && git -C "$REPO" add README.md && git -C "$REPO" -c user.email=t@t -c user.name=t commit -q -m init
printf '{"vault": "%s", "language": "en"}' "$DIR/vault" > "$DATA/settings.json"

echo "== Relay selftest build"
pnpm -s build >/dev/null
TAURI_CONFIG="{\"identifier\":\"$ID\",\"productName\":\"Relay Orchtest\"}" CARGO_TARGET_DIR=target/selftest \
  cargo build -q -p relay --features "selftest tauri/custom-protocol"

echo "== orchestrator (a few minutes)"
RELAY_AGENTS_DIR="$DIR/agents" RELAY_SELFTEST=orch RELAY_SELFTEST_DIR="$DIR" RELAY_SELFTEST_REPO="$REPO" \
  target/selftest/debug/relay 2>"$DIR/app.log" | grep '^selftest' || true
pkill -f "$DIR/agents" 2>/dev/null || true # the brokers of the test's conversations

echo "== report ($DIR/report.txt)"
cat "$DIR/report.txt"
! grep -q '^FAIL' "$DIR/report.txt"
