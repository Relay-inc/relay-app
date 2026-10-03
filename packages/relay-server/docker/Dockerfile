# relay-server in a container: `server` installs the real Claude Code on its first start (entrypoint.sh, log in once:
# docker exec -it relay-server claude), `test` has a stand-in claude (fake-claude) to try Relay's work machines without
# a Claude login. Released as ghcr.io/laurentme/relay-server for amd64 and arm64 (scripts/push-server-image.sh).
# Build from the repo root: docker compose -f packages/relay-server/docker/compose.yml up --build
FROM rust:1-slim AS build
WORKDIR /src
COPY . .
RUN cargo build --release -p relay-server

FROM debian:stable-slim AS base
LABEL org.opencontainers.image.source="https://github.com/LaurentMe/vault-app"
# git for the repos, curl for the Claude Code installer
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* && useradd -m relay
COPY --from=build /src/target/release/relay-server /usr/local/bin/relay-server
COPY packages/relay-server/docker/entrypoint.sh /usr/local/bin/relay-entrypoint
USER relay
WORKDIR /home/relay
ENV RELAY_SERVER_DATA=/home/relay/data
# mount a tmpfs here (compose.yml does): the mirror's plaintext working copy then lives in RAM
ENV RELAY_SERVER_WORKDIR=/home/relay/work
# where the Claude Code installer puts `claude`, so `docker exec … claude` finds it too
ENV PATH=/home/relay/.local/bin:$PATH
RUN mkdir -p /home/relay/data /home/relay/.claude /home/relay/repos /home/relay/work /home/relay/.local/bin
EXPOSE 47800
ENTRYPOINT ["relay-entrypoint"]
CMD ["relay-server", "serve"]

FROM base AS server
# all of Claude Code's state, the login included, in the volume: a new image keeps it
ENV CLAUDE_CONFIG_DIR=/home/relay/.claude

FROM base AS test
# python3 for the stand-in claude only
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
USER relay
# outside ~/.local, so the volume there never hides it or keeps an old copy
COPY --chmod=755 packages/relay-server/docker/fake-claude /usr/local/bin/claude
RUN mkdir -p /home/relay/repos/testproject
