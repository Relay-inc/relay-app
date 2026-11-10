#!/bin/sh
# Smoke test of the compose recipe on this machine: start compose.yml, wait for its healthcheck, pair a throwaway
# certificate with the printed line and ask `info` over mutual TLS, then back up the volume, delete it, restore it and
# check the server came back with the same certificate and still knows the device. Stops and removes everything after.
# Needs Docker with compose and OpenSSL 3 or newer (OPENSSL=/path picks another one). By default it builds the image's `test`
# target from this checkout (a stand-in claude, so nothing is installed). RELAY_SERVER_IMAGE=<image> tests that image.
# KEEP=1 leaves the container running.
# Usage: deploy/relay-server/smoke.sh
set -eu
dir=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$dir/../.." && pwd)
export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-relay-smoke} RELAY_PORT=${RELAY_PORT:-47899} RELAY_HOST=relay-smoke
OPENSSL=${OPENSSL:-openssl}
# LibreSSL (macOS's /usr/bin/openssl) does not send an EC client certificate over TLS 1.3
"$OPENSSL" version | grep -q '^OpenSSL [3-9]' || { echo "needs OpenSSL 3 or newer, not $("$OPENSSL" version): OPENSSL=/opt/homebrew/bin/openssl $0" >&2; exit 1; }
compose() { docker compose -f "$dir/compose.yml" "$@"; }
tmp=$(mktemp -d)
cleanup() { [ "${KEEP:-}" = 1 ] || compose down -v >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
step() { echo "== $*"; }
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*" >&2; compose logs --no-color --tail 30 >&2 || true; exit 1; }
sha256() { "$OPENSSL" dgst -sha256 "$@" | sed 's/.*= *//'; }
# one JSON line to the server over TLS 1.3 with the throwaway certificate, prints its answer
call() {
  printf '%s\n' "$1" | "$OPENSSL" s_client -connect "127.0.0.1:$RELAY_PORT" -tls1_3 -cert "$tmp/crt.pem" -key "$tmp/key.pem" \
    -quiet -ign_eof 2>"$tmp/tls.log" || true
}

if [ -z "${RELAY_SERVER_IMAGE:-}" ]; then
  step "build the image from this checkout (test target)"
  docker build -q -f "$root/packages/relay-server/docker/Dockerfile" --target test -t relay-server:smoke "$root" >/dev/null
  export RELAY_SERVER_IMAGE=relay-server:smoke
fi
compose config -q && pass "compose.yml is valid"

step "start $RELAY_SERVER_IMAGE on port $RELAY_PORT and wait for the healthcheck"
compose down -v >/dev/null 2>&1 || true
compose up -d --wait --wait-timeout 240 >"$tmp/up.log" 2>&1 || fail "not healthy: $(tail -3 "$tmp/up.log")"
pass "healthy: $(compose exec -T relay-server relay-server health)"
fp=$(compose exec -T relay-server relay-server info | sed -n 's/^fingerprint //p')
[ -n "$fp" ] || fail "no fingerprint from relay-server info"

step "a throwaway certificate, ECDSA P-256 like Relay's own"
"$OPENSSL" req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj /CN=relay -days 1 \
  -keyout "$tmp/key.pem" -out "$tmp/crt.pem" 2>/dev/null
mine=$("$OPENSSL" x509 -in "$tmp/crt.pem" -outform der | sha256)
case $(call '{"op":"info"}') in *'"ok":true'*) fail "an unpaired certificate got an answer" ;; esac
grep -q 'alert number 46' "$tmp/tls.log" || fail "no certificate-unknown alert from the server: $(tail -1 "$tmp/tls.log")"
pass "refused in the handshake while no pairing is open"

step "pair it with the line relay-server pair prints"
line=$(compose exec -T relay-server relay-server pair --host 127.0.0.1 | grep '^relay://') || fail "no pairing line"
code=$(echo "$line" | sed 's/.*[#&]code=\([^&]*\).*/\1/')
[ "$(echo "$line" | sed 's/.*[#&]fp=\([^&]*\).*/\1/')" = "$fp" ] || fail "the line's fingerprint is not relay-server info's"
seen=$("$OPENSSL" s_client -connect "127.0.0.1:$RELAY_PORT" -tls1_3 -cert "$tmp/crt.pem" -key "$tmp/key.pem" </dev/null 2>/dev/null \
  | "$OPENSSL" x509 -outform der | sha256)
[ "$seen" = "$fp" ] || fail "the certificate on the wire ($seen) is not the line's ($fp)"
pass "the server's certificate on the wire is the one in the line: ${fp%"${fp#????????????????}"}…"
# the proof Relay sends: HMAC-SHA256 keyed with the code over "<device fp>\n<server fp>" (relay_remote::tls::proof)
proof=$(printf '%s\n%s' "$mine" "$fp" | sha256 -hmac "$code")
answer=$(call "{\"op\":\"pair\",\"name\":\"smoke\",\"proof\":\"$proof\"}")
case $answer in *'"ok":true'*) pass "paired: $answer" ;; *) fail "pair: $answer $(cat "$tmp/tls.log")" ;; esac
info=$(call '{"op":"info"}')
case $info in *'"ok":true'*) ;; *) fail "info: $info" ;; esac
case $info in *'"proto":'*) ;; *) fail "info without proto: $info" ;; esac
pass "info as the paired device: $(echo "$info" | grep -o '"host":"[^"]*"\|"version":"[^"]*"\|"proto":[0-9]*' | tr '\n' ' ')"

step "backup, delete the volume, restore, start again"
"$dir/backup.sh" backup "$tmp/backup.tar.gz"
compose down -v >/dev/null 2>&1
"$dir/backup.sh" restore "$tmp/backup.tar.gz"
"$dir/backup.sh" restore "$tmp/backup.tar.gz" 2>/dev/null && fail "a restore over an identity went through without --force"
pass "a second restore over that identity is refused without --force"
compose up -d --wait --wait-timeout 240 >"$tmp/up.log" 2>&1 || fail "not healthy after the restore: $(tail -3 "$tmp/up.log")"
[ "$(compose exec -T relay-server relay-server info | sed -n 's/^fingerprint //p')" = "$fp" ] || fail "another certificate after the restore"
pass "same certificate after the restore"
case $(call '{"op":"info"}') in *'"ok":true'*) pass "the device paired before the backup still gets info" ;; *) fail "the paired device is refused after the restore" ;; esac

step "stop"
[ "${KEEP:-}" = 1 ] && echo "KEEP=1: still running as project $COMPOSE_PROJECT_NAME" || echo "removed the container and its volume"
