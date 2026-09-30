# @vault/agent-core / agent-core

The agent-provider contract, nothing specific to one CLI. See [Agent providers](../../README.md#agent-providers)
in the app's README for the whole picture.

- `src/lib.rs`: `AgentProvider` (the trait), `Caps`, `Env`, `Launch`, `Turn`, `Event`, `Detect`, `Choice`, `Terminal`, helpers.
- `src/pending.rs`: the pending folder (`<id>.json` / `<id>.answer.json`), `Request`, the decision shape.
- `src/usage.rs`: `Limits` / `Window`, `Record`, `aggregate`, `parse_ts`, `Tail` (incremental log reader).
- `src/types.ts`, `src/i18n.ts`: the same shapes for the webview, `AgentProvider` (name, glyph, strings), the strings bridge.

`cargo test -p agent-core`.
