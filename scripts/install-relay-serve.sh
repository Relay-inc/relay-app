#!/bin/sh
# Install relay-serve as a LaunchAgent on the server (a Mac where the Relay app does NOT run, see
# packages/relay-core/src/serve.rs). Run from a checkout on that machine:
#
#   scripts/install-relay-serve.sh 100.x.y.z:7311     # the address to listen on: the Tailscale IP, or a LAN IP to test
#
# Builds the release binary, writes ~/.config/relay/serve.json with a fresh token the first time (keeps it after),
# and (re)loads ~/Library/LaunchAgents/be.relay.serve.plist. Logs: ~/Library/Logs/relay-serve.log.
set -eu
listen=${1:?usage: $0 <ip:port>}
cd "$(dirname "$0")/.."
cargo build --release -p relay-core --bin relay-serve
mkdir -p "$HOME/.local/bin" "$HOME/.config/relay" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp target/release/relay-serve "$HOME/.local/bin/relay-serve"
cfg="$HOME/.config/relay/serve.json"
if [ -f "$cfg" ]; then
  token=$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["token"])' "$cfg")
else
  token=$(openssl rand -hex 24)
fi
(umask 077; /usr/bin/python3 - "$cfg" "$listen" "$token" "$HOME/vault" <<'PY'
import json, os, sys
f, listen, token, vault = sys.argv[1:]
c = json.load(open(f)) if os.path.exists(f) else {}
c.update(listen=listen, token=token)
c.setdefault("vault", vault)
json.dump(c, open(f, "w"), indent=2)
PY
)
plist="$HOME/Library/LaunchAgents/be.relay.serve.plist"
cat > "$plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>be.relay.serve</string>
  <key>ProgramArguments</key><array><string>$HOME/.local/bin/relay-serve</string><string>$cfg</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/relay-serve.log</string>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/relay-serve.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/be.relay.serve" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "relay-serve on $listen. Token for the app (Settings › Servers): $token"
