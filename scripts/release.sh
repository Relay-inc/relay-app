#!/bin/sh
# A release, built on this Mac instead of in GitHub Actions (macOS minutes there cost ten times Linux ones): Relay for
# Apple silicon as GitHub release v<version> with the version's section of CHANGELOG.md as its notes, then
# relay-server's image and Linux binaries (scripts/push-server-image.sh). Run it on main once the version bump is
# merged. Needs Docker, pnpm, Rust and a gh login that may write packages (gh auth refresh -h github.com -s write:packages).
# Usage: scripts/release.sh
set -eu
cd "$(dirname "$0")/.."
version=$(node -p 'require("./package.json").version')
cargo=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)
[ "$version" = "$cargo" ] || { echo "package.json is $version, Cargo.toml is $cargo" >&2; exit 1; }
# the release must be main as it is on GitHub, nothing more and nothing less
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "release from main (git checkout main)" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "the checkout has changes" >&2; exit 1; }
git fetch -q origin main --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main is not origin/main (git pull)" >&2; exit 1; }
if gh release view "v$version" >/dev/null 2>&1; then echo "v$version is already released" >&2; exit 1; fi
notes=$(mktemp)
{
  scripts/changelog-section.sh "$version"
  echo
  echo "---"
  echo "Relay is not signed by Apple yet: after moving it to Applications, run"
  echo '`xattr -dr com.apple.quarantine /Applications/Relay.app` once, or macOS says it is damaged.'
} > "$notes"

pnpm install --frozen-lockfile
pnpm tauri build
dmg="target/release/bundle/dmg/Relay_${version}_aarch64.dmg"
[ -f "$dmg" ] || { echo "no $dmg after the build" >&2; exit 1; }
gh release create "v$version" "$dmg" --target "$(git rev-parse HEAD)" --title "Relay $version" --notes-file "$notes"
rm -f "$notes"
git fetch -q --tags
echo "released v$version"

# the tag is HEAD now: the image and the Linux binaries of the same code
scripts/push-server-image.sh
