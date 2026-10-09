#!/bin/sh
# A release, built on this Mac instead of in GitHub Actions (macOS minutes there cost ten times Linux ones): Relay for
# Apple silicon as GitHub release v<version> with the version's section of CHANGELOG.md as its notes, then
# relay-server's image and Linux binaries (scripts/push-server-image.sh). Run it on main once the version bump is
# merged. Needs Docker, pnpm, Rust and a gh login that may write packages (gh auth refresh -h github.com -s write:packages),
# and the updater's signing key (~/.tauri/relay.key, or TAURI_SIGNING_PRIVATE_KEY): lose it and every install has to be
# reinstalled by hand. The installed apps update from latest.json on the `updates` branch (src-tauri/src/updater.rs).
# The phone app (mobile/) goes along as Relay_<version>_android.apk, signed with ~/.tauri/relay-android.properties
# (or the file RELAY_ANDROID_KEYSTORE names): lose that key and every phone has to uninstall before it can update.
# It needs the Android SDK and NDK (ANDROID_HOME, NDK_HOME; ~/Library/Android/sdk and its newest NDK by default).
# RELAY_SKIP_ANDROID=1 releases without it.
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
: "${TAURI_SIGNING_PRIVATE_KEY:=$HOME/.tauri/relay.key}" "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:=}"
export TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
[ -n "${TAURI_SIGNING_PRIVATE_KEY##/*}" ] || [ -f "$TAURI_SIGNING_PRIVATE_KEY" ] || { echo "no updater key at $TAURI_SIGNING_PRIVATE_KEY" >&2; exit 1; }
android=${RELAY_SKIP_ANDROID:-}
if [ -z "$android" ]; then
  : "${RELAY_ANDROID_KEYSTORE:=$HOME/.tauri/relay-android.properties}" "${ANDROID_HOME:=$HOME/Library/Android/sdk}"
  [ -f "$RELAY_ANDROID_KEYSTORE" ] || { echo "no Android release key at $RELAY_ANDROID_KEYSTORE (or RELAY_SKIP_ANDROID=1)" >&2; exit 1; }
  [ -d "$ANDROID_HOME" ] || { echo "no Android SDK at $ANDROID_HOME" >&2; exit 1; }
  : "${NDK_HOME:=$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | sort -V | tail -1)}"
  [ -d "$NDK_HOME" ] || { echo "no Android NDK (NDK_HOME)" >&2; exit 1; }
  export RELAY_ANDROID_KEYSTORE ANDROID_HOME NDK_HOME
fi
notes=$(mktemp)
{
  scripts/changelog-section.sh "$version"
  echo
  echo "---"
  echo "Relay is not signed by Apple yet: after moving it to Applications, run"
  echo '`xattr -dr com.apple.quarantine /Applications/Relay.app` once, or macOS says it is damaged.'
  echo "From then on Relay updates itself (signed in to gh with access to this repo)."
  [ -n "$android" ] || echo "On an Android phone: install the .apk, then pair it from Relay on your Mac (Settings › Machines › Add phone)."
} > "$notes"

pnpm install --frozen-lockfile
pnpm tauri build
dmg="target/release/bundle/dmg/Relay_${version}_aarch64.dmg"
[ -f "$dmg" ] || { echo "no $dmg after the build" >&2; exit 1; }
bundle=target/release/bundle/macos/Relay.app.tar.gz
[ -f "$bundle.sig" ] || { echo "no $bundle.sig after the build" >&2; exit 1; }
tgz="$(mktemp -d)/Relay_${version}_aarch64.app.tar.gz"
cp "$bundle" "$tgz"
apk=""
if [ -z "$android" ]; then
  (cd mobile && node ../node_modules/@tauri-apps/cli/tauri.js android build --apk --target aarch64 --ci)
  built=mobile/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
  [ -f "$built" ] || { echo "no $built after the build" >&2; exit 1; }
  # signed with Relay's key, or a phone refuses it (and could not update an install made with it)
  signer=$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)
  "$signer" verify "$built" || { echo "$built is not signed" >&2; exit 1; }
  apk="$(dirname "$tgz")/Relay_${version}_android.apk"
  cp "$built" "$apk"
fi
gh release create "v$version" "$dmg" "$tgz" ${apk:+"$apk"} --target "$(git rev-parse HEAD)" --title "Relay $version" --notes-file "$notes"
rm -f "$notes"

# the update for the installed apps: latest.json on the `updates` branch, its url the API url of the .app.tar.gz
# (the app downloads it with the user's gh token, the repo is private)
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
url=$(gh release view "v$version" --json assets -q ".assets[] | select(.name == \"$(basename "$tgz")\") | .apiUrl")
gh api "repos/$repo/git/ref/heads/updates" >/dev/null 2>&1 ||
  gh api "repos/$repo/git/refs" -f ref=refs/heads/updates -f sha="$(git rev-parse HEAD)" >/dev/null
latest=$(VERSION="$version" URL="$url" SIG="$(cat "$bundle.sig")" NOTES="$(scripts/changelog-section.sh "$version")" node -p \
  'JSON.stringify({ version: process.env.VERSION, notes: process.env.NOTES, pub_date: new Date().toISOString(),
    platforms: { "darwin-aarch64": { signature: process.env.SIG, url: process.env.URL } } }, null, 2)')
old=$(gh api "repos/$repo/contents/latest.json?ref=updates" -q .sha 2>/dev/null || true)
gh api -X PUT "repos/$repo/contents/latest.json" -f branch=updates -f message="Relay $version" \
  -f content="$(printf %s "$latest" | base64)" ${old:+-f sha="$old"} >/dev/null
rm -rf "$(dirname "$tgz")"
git fetch -q --tags
echo "released v$version"

# the tag is HEAD now: the image and the Linux binaries of the same code
scripts/push-server-image.sh
