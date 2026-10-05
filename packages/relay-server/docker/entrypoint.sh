#!/bin/sh
# Claude Code is not in the image: the first start installs it with Anthropic's own installer into ~/.local, a volume,
# so its updates survive a new image. The test target has a stand-in claude, so nothing is installed there.
if ! command -v claude >/dev/null 2>&1; then
  if [ ! -w "$HOME/.local" ]; then
    echo "relay-server: $HOME/.local is not writable for uid $(id -u): chown -R 1000:1000 the folder mounted there" >&2
  else
    echo "relay-server: installing Claude Code (first start)"
    curl -fsSL https://claude.ai/install.sh | bash \
      || echo "relay-server: Claude Code did not install, retry with: docker restart relay-server" >&2
  fi
fi
exec "$@"
