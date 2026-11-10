#!/bin/sh
# Backup and restore of relay-server's volume (docs/relay-server.md › Backup and restore).
#   backup.sh backup [file]     stops the server, writes the volume to a .tar.gz, starts it again
#   backup.sh restore <file>    into the volume of a server that is not running, on this box or a new one
# The certificate (data/identity.*.der) is in the backup: without it every paired Mac refuses the server.
# Left out: the RAM working copy (work) and Claude Code itself (.local, .cache), which the next start installs again.
# Runs against compose.yml next to this script, COMPOSE_PROJECT_NAME picks another project (the smoke test does).
set -eu
dir=$(cd "$(dirname "$0")" && pwd)
compose() { docker compose -f "$dir/compose.yml" "$@"; }
# a container of the service itself, with its volume, no ports, as the image's user
volume() { compose run --rm --no-deps -T --entrypoint "$@"; }

case ${1:-} in
backup)
  out=${2:-relay-server-$(date +%Y%m%d-%H%M%S).tar.gz}
  running=$(compose ps -q --status running relay-server)
  # stopped, so no record, mirror blob or org.json is half written while tar reads it
  [ -z "$running" ] || compose stop relay-server
  status=0
  volume tar relay-server czf - --exclude=./work --exclude=./.local --exclude=./.cache -C /home/relay . > "$out" || status=$?
  [ -z "$running" ] || compose start relay-server
  [ "$status" = 0 ] || { rm -f "$out"; echo "backup failed" >&2; exit "$status"; }
  echo "wrote $out ($(du -h "$out" | cut -f1)), keep it as safe as the server: it holds its private key"
  ;;
restore)
  file=${2:?usage: backup.sh restore <file>}
  [ -f "$file" ] || { echo "no file $file" >&2; exit 1; }
  [ -z "$(compose ps -q --status running relay-server)" ] || { echo "stop the server first: docker compose -f $dir/compose.yml stop" >&2; exit 1; }
  # never over another server's identity by accident: that one's Macs would all refuse it afterwards
  if [ "${3:-}" != --force ] && volume test relay-server -e /home/relay/data/identity.key.der; then
    echo "this volume already has a server identity, add --force to replace it" >&2; exit 1
  fi
  volume tar relay-server xzf - -C /home/relay < "$file"
  echo "restored $file, start it with: docker compose -f $dir/compose.yml up -d"
  ;;
*) echo "usage: backup.sh backup [file] | restore <file> [--force]" >&2; exit 2 ;;
esac
