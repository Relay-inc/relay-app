#!/bin/sh
# relay-server's image for amd64 and arm64, built on this Mac and pushed to GHCR as ghcr.io/laurentme/relay-server
# with the release's version and `latest`. CI no longer builds it: arm64 under QEMU took most of a release's minutes,
# here arm64 is native and amd64 runs under Rosetta. Run it from a checkout of the release tag, after the release.
# Needs Docker and a gh login that may write packages (gh auth refresh -h github.com -s write:packages).
# Usage: scripts/push-server-image.sh
set -eu
cd "$(dirname "$0")/.."
version=$(node -p 'require("./package.json").version')
image=ghcr.io/laurentme/relay-server
# the image must be the release's code, or app and server could speak different protocols under one version
[ "$(git describe --exact-match --tags HEAD 2>/dev/null)" = "v$version" ] || { echo "check out v$version first (git checkout v$version)" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "the checkout has changes, the image would not be v$version" >&2; exit 1; }
gh auth token | docker login ghcr.io -u "$(gh api user --jq .login)" --password-stdin >/dev/null
# a multi-platform push needs a builder of its own (the docker-container driver)
docker buildx inspect relay-multi >/dev/null 2>&1 || docker buildx create --name relay-multi --driver docker-container >/dev/null
docker buildx build --builder relay-multi --platform linux/amd64,linux/arm64 \
  -f packages/relay-server/docker/Dockerfile --target server \
  -t "$image:$version" -t "$image:latest" --push .
echo "pushed $image:$version and $image:latest"
