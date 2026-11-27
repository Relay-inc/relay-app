#!/bin/sh
# The version bump of a release PR, everything scripts/release.sh checks before it builds: <version> in package.json,
# the root Cargo.toml (and the workspace's entries in Cargo.lock) and the image tag in deploy/relay-server/compose.yml,
# and CHANGELOG.md's Unreleased lines under "## [<version>] - <today>". Commit it as "Release <version>", merge, then run
# scripts/release.sh on main.
# Usage: scripts/bump.sh 0.0.71
set -eu
cd "$(dirname "$0")/.."
new=${1:-}
echo "$new" | grep -Eqx '[0-9]+\.[0-9]+\.[0-9]+' || { echo "usage: scripts/bump.sh <version>, like 0.0.71" >&2; exit 1; }
old=$(node -p 'require("./package.json").version')
[ "$new" != "$old" ] || { echo "the version is $new already" >&2; exit 1; }
! grep -q "^## \[$new\]" CHANGELOG.md || { echo "CHANGELOG.md has a $new section already" >&2; exit 1; }
# a release with nothing under Unreleased would have empty notes
awk '/^## \[Unreleased\]/ { on = 1; next } /^## \[/ { on = 0 } on && /^- / { found = 1 } END { exit !found }' CHANGELOG.md ||
  { echo "nothing under Unreleased in CHANGELOG.md" >&2; exit 1; }
export NEW="$new" TODAY="$(date +%Y-%m-%d)"
# the first "version" in each file: package.json's own, Cargo.toml's [workspace.package] (scripts/release.sh reads the same)
perl -pi -e '$done ||= s/^(  "version": )"[^"]*"/$1"$ENV{NEW}"/' package.json
perl -pi -e '$done ||= s/^version = "[^"]*"/version = "$ENV{NEW}"/' Cargo.toml
perl -pi -e 's/(ghcr\.io\/relay-inc\/relay-server:)[^}]*\}/$1$ENV{NEW}}/' deploy/relay-server/compose.yml
perl -0pi -e 's/^## \[Unreleased\]\n\n/## [Unreleased]\n\n## [$ENV{NEW}] - $ENV{TODAY}\n\n/m' CHANGELOG.md
# only the workspace's own crates take the new version, no dependency moves
cargo update --workspace --offline -q
echo "$old -> $new: package.json, Cargo.toml, Cargo.lock, deploy/relay-server/compose.yml, CHANGELOG.md"
