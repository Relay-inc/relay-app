# relay-server in a container: `server` with the real Claude Code (log in once: docker exec -it relay-server claude),
# `test` with a stand-in claude (fake-claude) to try Relay's work machines without a Claude login.
# Build from the repo root: docker compose -f packages/relay-server/docker/compose.yml up --build
FROM rust:1-slim AS build
WORKDIR /src
COPY . .
RUN cargo build --release -p relay-server

FROM debian:stable-slim AS base
# python3 for perm_server.py, git for the repos, curl for the Claude Code installer
RUN apt-get update && apt-get install -y --no-install-recommends python3 git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* && useradd -m relay
COPY --from=build /src/target/release/relay-server /usr/local/bin/relay-server
USER relay
WORKDIR /home/relay
ENV RELAY_SERVER_DATA=/home/relay/data
# mount a tmpfs here (compose.yml does): the mirror's plaintext working copy then lives in RAM
ENV RELAY_SERVER_WORKDIR=/home/relay/work
# where the Claude Code installer puts `claude`, so `docker exec … claude` finds it too
ENV PATH=/home/relay/.local/bin:$PATH
RUN mkdir -p /home/relay/data /home/relay/.claude /home/relay/repos /home/relay/work /home/relay/.local/bin
EXPOSE 47800
CMD ["relay-server", "serve"]

FROM base AS server
RUN curl -fsSL https://claude.ai/install.sh | bash
# all of Claude Code's state, the login included, in the volume: a rebuild keeps it
ENV CLAUDE_CONFIG_DIR=/home/relay/.claude

FROM base AS test
COPY --chown=relay packages/relay-server/docker/fake-claude /home/relay/.local/bin/claude
RUN chmod +x /home/relay/.local/bin/claude && mkdir -p /home/relay/repos/testproject
