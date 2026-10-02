# @relay/agent-claude / agent-claude

Claude Code as an agent provider.

- **Runs** `claude -p --input-format stream-json --output-format stream-json --verbose` in the vault, one process per
  conversation (`caps.persistent`), with `--permission-prompt-tool mcp__vaultperm__approve` and `relay --perm-server` (the app's own
  binary, `src/perm_server.rs`) as that MCP server, `-n <name>`, `--model`, `--effort`, `--resume <sid>` or `--resume <sid> --fork-session`. `ANTHROPIC_API_KEY`
  is removed, so it runs on the claude.ai login; `MCP_TOOL_TIMEOUT` is a day, so a permission can wait.
- **Binary**: `~/.local/bin/claude`, or the program set under Settings › Agents.
- **Events** (`src/stream.rs`): `system/init` → session, assistant text and `tool_use` blocks → text and tool calls,
  `tool_result` → tool results, `result` → turn end with the turn's tokens and cost.
- **Permissions**: `relay --perm-server` writes `pending/<id>.json` itself (`provider: "claude"`, `kind`, `relay: false`) and
  waits for `<id>.answer.json`, whose decision it hands to Claude unchanged.
- **History, subagents** (`src/subagents.rs`): `~/.claude/projects/<vault-slug>/<sid>.jsonl` and `<sid>/subagents/`.
  Terminal and background sessions: `claude agents --json`, `claude attach`, `claude stop`.
- **Usage** (`src/usage_log.rs`): plan limits from `api.anthropic.com/api/oauth/usage` with the CLI's own keychain login
  (read only, never refreshed); tokens from every `~/.claude/projects/**/*.jsonl`, deduplicated by message and request id,
  priced at API list prices.
- **Titles**: one Haiku call without tools, settings or a transcript.

Tests: `cargo test -p agent-claude` (stream-json and transcript fixtures in `tests/fixtures/`), `pnpm test`.
