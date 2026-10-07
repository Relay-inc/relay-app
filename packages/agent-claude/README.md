# @relay/agent-claude / agent-claude

Claude Code as an agent provider.

- **Runs** `claude -p --input-format stream-json --output-format stream-json --verbose` in the vault, one process per
  conversation (`caps.persistent`), with `--permission-prompt-tool stdio`, `-n <name>`, `--model`, `--effort`, `--resume <sid>` or `--resume <sid> --fork-session`. `ANTHROPIC_API_KEY`
  is removed, so it runs on the claude.ai login.
- **Binary**: `~/.local/bin/claude`, or the program set under Settings › Agents.
- **Events** (`src/stream.rs`): `system/init` → session, assistant text and `tool_use` blocks → text and tool calls,
  `tool_result` → tool results (plus a patch from `tool_use_result.structuredPatch` when an edit reports one, also from
  `toolUseResult` in the transcript), `result` → turn end with the turn's tokens and cost.
- **Permissions** (`src/permission.rs`): the CLI sends `{"type":"control_request","request":{"subtype":"can_use_tool",
  "tool_name","input","permission_suggestions"?,"tool_use_id"}}` and waits, without a deadline, for a `control_response` with
  `behavior: "allow"` (`updatedInput`, and `updatedPermissions` for "always allow") or `"deny"` (`message`). The app writes the card
  (id from the request id, `relay: true`) and `respond` builds the response; AskUserQuestion is the same request, its answers in
  `updatedInput.answers`.
- **History, subagents** (`src/subagents.rs`): `~/.claude/projects/<vault-slug>/<sid>.jsonl` and `<sid>/subagents/`.
  Terminal and background sessions: `claude agents --json`, `claude attach`, `claude stop`.
- **Usage** (`src/usage_log.rs`): plan limits from `api.anthropic.com/api/oauth/usage` with the CLI's own keychain login
  (read only, never refreshed); tokens from every `~/.claude/projects/**/*.jsonl`, deduplicated by message and request id,
  priced at API list prices.
- **Titles**: one Haiku call without tools, settings or a transcript.

Tests: `cargo test -p agent-claude` (stream-json and transcript fixtures in `tests/fixtures/`), `pnpm test`.
