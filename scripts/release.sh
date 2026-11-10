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
# Windows goes along as Relay_<version>_x64-setup.exe: publishing the release starts .github/workflows/windows.yml, this
# script waits for that run, signs its installer for the updater here (the key stays on this Mac) and adds it to the
# release and to latest.json. RELAY_SKIP_WINDOWS=1 releases without it.
# Usage: scripts/release.sh
set -eu
cd "$(dirname "$0")/.."
version=$(node -p 'require("./package.json").version')
cargo=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)
[ "$version" = "$cargo" ] || { echo "package.json is $version, Cargo.toml is $cargo" >&2; exit 1; }
# the install recipe (docs/relay-server.md) pins the image of this release
grep -q "ghcr.io/relay-inc/relay-server:$version}" deploy/relay-server/compose.yml || { echo "set the image tag in deploy/relay-server/compose.yml to $version" >&2; exit 1; }
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
windows=${RELAY_SKIP_WINDOWS:-}
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
  echo "Relay is not notarized by Apple yet: the first time you open it, macOS refuses. Open System Settings ›"
  echo "Privacy & Security and click Open Anyway (or run \`xattr -dr com.apple.quarantine /Applications/Relay.app\` once)."
  echo "From then on Relay updates itself (signed in to gh with access to this repo)."
  [ -n "$android" ] || echo "On an Android phone: install the .apk, then pair it from Relay on your Mac (Settings › Machines › Add phone)."
  # ponytail: true while WINDOWS_SIGN is off (docs/development.md › Releasing for Windows), drop it once it is on
  [ -n "$windows" ] || echo "On Windows: the installer is not signed yet, so SmartScreen says it protected your PC. Click More info, then Run anyway."
} > "$notes"

pnpm install --frozen-lockfile
pnpm tauri build
dmg="target/release/bundle/dmg/Relay_${version}_aarch64.dmg"
[ -f "$dmg" ] || { echo "no $dmg after the build" >&2; exit 1; }
# ad-hoc signed as a whole (signingIdentity "-"): with only the linker's signature on the binary macOS calls a
# downloaded Relay damaged, with no way to open it from System Settings
codesign --verify --deep --strict target/release/bundle/macos/Relay.app || { echo "Relay.app is not signed as a whole" >&2; exit 1; }
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

exe=""
if [ -z "$windows" ]; then
  sha=$(git rev-parse HEAD) run=""
  for _ in $(seq 30); do
    run=$(gh run list --workflow windows.yml --event release --commit "$sha" --json databaseId -q '.[0].databaseId')
    [ -n "$run" ] && break
    sleep 10
  done
  [ -n "$run" ] || { echo "no windows run for v$version after 5 minutes (Actions › windows)" >&2; exit 1; }
  echo "waiting for the Windows installer (gh run view $run)"
  gh run watch "$run" --exit-status >/dev/null || { echo "the Windows build failed: gh run view $run --log-failed" >&2; exit 1; }
  gh run download "$run" -n relay-windows-x64 -D "$(dirname "$tgz")"
  exe="$(dirname "$tgz")/Relay_${version}_x64-setup.exe"
  [ -f "$exe" ] || { echo "no $(basename "$exe") in the run's artifact" >&2; exit 1; }
  # `signer sign` takes the key itself, not its path
  key=$TAURI_SIGNING_PRIVATE_KEY
  [ -n "${key##/*}" ] || key=$(cat "$key")
  TAURI_SIGNING_PRIVATE_KEY=$key pnpm tauri signer sign "$exe" >/dev/null
  gh release upload "v$version" "$exe"
fi

# the update for the installed apps: latest.json on the `updates` branch, its url the API url of the .app.tar.gz
# (the app downloads it anonymously, or with the user's gh token when there is one)
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
asset() { gh release view "v$version" --json assets -q ".assets[] | select(.name == \"$1\") | .apiUrl"; }
url=$(asset "$(basename "$tgz")")
winurl=${exe:+$(asset "$(basename "$exe")")}
gh api "repos/$repo/git/ref/heads/updates" >/dev/null 2>&1 ||
  gh api "repos/$repo/git/refs" -f ref=refs/heads/updates -f sha="$(git rev-parse HEAD)" >/dev/null
# Windows: the setup.exe itself, the updater runs it with /UPDATE (no admin, the app closes, NSIS installs, Relay restarts)
latest=$(VERSION="$version" URL="$url" SIG="$(cat "$bundle.sig")" WINURL="$winurl" WINSIG="$([ -z "$exe" ] || cat "$exe.sig")" \
  NOTES="$(scripts/changelog-section.sh "$version")" node -p \
  'const e = process.env, platforms = { "darwin-aarch64": { signature: e.SIG, url: e.URL } };
  if (e.WINURL) platforms["windows-x86_64"] = { signature: e.WINSIG, url: e.WINURL };
  JSON.stringify({ version: e.VERSION, notes: e.NOTES, pub_date: new Date().toISOString(), platforms }, null, 2)')
old=$(gh api "repos/$repo/contents/latest.json?ref=updates" -q .sha 2>/dev/null || true)
gh api -X PUT "repos/$repo/contents/latest.json" -f branch=updates -f message="Relay $version" \
  -f content="$(printf %s "$latest" | base64)" ${old:+-f sha="$old"} >/dev/null
rm -rf "$(dirname "$tgz")"
git fetch -q --tags
echo "released v$version"

# the tag is HEAD now: the image and the Linux binaries of the same code
scripts/push-server-image.sh
