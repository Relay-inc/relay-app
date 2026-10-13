//! The prompts Relay sends to a model are markdown files in `prompts/` at the repo root, read with `include_str!`
//! (the frontend imports the same files, `src/shared/prompts.ts`). A file ends with the newline an editor adds,
//! [`text`] takes it off. A prompt with `{{name}}` placeholders goes through [`fill`] before it is sent.

/// A prompt file without its trailing newline.
pub const fn text(raw: &str) -> &str {
    match raw.as_bytes() {
        [rest @ .., b'\n'] => match core::str::from_utf8(rest) { Ok(s) => s, Err(_) => raw },
        _ => raw,
    }
}

/// `template` with every `{{name}}` replaced by its value in `vars`. A placeholder without a value, or a value no
/// placeholder takes, panics: a prompt that went out with `{{shared}}` in it, or lost what it was to say, is a bug
/// to see at once (the tests of each prompt render it). One pass over the template, so a value that holds `{{x}}`
/// stays as it is.
pub fn fill(template: &str, vars: &[(&str, &str)]) -> String {
    let mut out = String::with_capacity(template.len());
    let mut used = vec![false; vars.len()];
    let mut rest = template;
    while let Some(at) = rest.find("{{") {
        let Some(len) = rest[at + 2..].find("}}") else { break };
        let name = &rest[at + 2..at + 2 + len];
        if name.is_empty() || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') { out.push_str(&rest[..at + 2]); rest = &rest[at + 2..]; continue; }
        let i = vars.iter().position(|(k, _)| *k == name).unwrap_or_else(|| panic!("prompt placeholder {{{{{name}}}}} has no value"));
        used[i] = true;
        out.push_str(&rest[..at]);
        out.push_str(vars[i].1);
        rest = &rest[at + 2 + len + 2..];
    }
    out.push_str(rest);
    if let Some(i) = used.iter().position(|u| !u) { panic!("prompt has no placeholder for {}", vars[i].0); }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn text_takes_one_newline() {
        assert_eq!(text("a\n"), "a");
        assert_eq!(text("a\n\n"), "a\n");
        assert_eq!(text("a"), "a");
        assert_eq!(text(""), "");
    }
    #[test]
    fn fill_replaces_once_and_is_strict() {
        assert_eq!(fill("a {{b}} {{b}} {{c}}", &[("b", "{{c}}"), ("c", "z")]), "a {{c}} {{c}} z");
        assert_eq!(fill("no slots", &[]), "no slots");
        assert!(std::panic::catch_unwind(|| fill("a {{b}}", &[])).is_err());
        assert!(std::panic::catch_unwind(|| fill("a", &[("b", "1")])).is_err());
    }
}
