# board-core

The contract a board integration implements, and nothing specific to one tracker. See the app's README,
"Integrations".

- **TypeScript** (`@relay/board-core`, `src/`): `BoardProvider<K>` and its shapes (`Opt`, `Column`, `Card`,
  `BoardRef`, `Ctx`, `Field`, `BoardOpt`, `CardDetail`), and the strings bridge: `Locales<K>` types an
  integration's strings, `translator(id)` is its `t`, `currentLocale()` the locale for dates and sorting. The
  app merges the strings as `<id>.<key>` and binds the lookup with `bindHost`. `CardDetail` describes a card as
  data (`CardView`), which the app draws as its ticket window: the packages carry no UI framework.
- **`@relay/board-core/detail`**: what the ticket providers share: `markdown()` (tracker Markdown as safe HTML, raw
  HTML escaped, only http(s) links), `safeUrl`, `escapeHtml`, and `ticketDetail()` (the cache around a provider's own
  fetch and act).
- **Rust** (`board-core` crate, `src/lib.rs`): the `Provider` struct (allowlist `url`, `headers`, `ok`,
  `error`, `secrets`, config `defaults`/`check`/`ready`), the `Text` type for native strings with `t`/`t_v`
  (the app sets the language with `set_lang`), and the allowlist helpers `path_ok` and `only_keys`.

The keychain, curl and the Tauri commands are the app's (`src-tauri/src/providers.rs`), so an integration
never handles a secret beyond putting it in a header.
