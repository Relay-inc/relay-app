//! What Relay itself adds to a conversation, the same for every provider: the system prompt hint on its actions,
//! and the project line in front of a message (the first one, and again after a move). A provider passes [`HINT`]
//! the way its CLI takes a system prompt, and runs every user text of its history through [`strip`], before its own
//! filtering of what its CLI put in the user's turn.

/// The `relay` command (src-tauri/src/actions.rs) on the agent's PATH, whatever provider runs it.
pub const HINT: &str = crate::prompt::text(include_str!("../../../prompts/conversation/relay-actions-hint.md"));
const PROJECT_LINE: &str = include_str!("../../../prompts/conversation/project-line.md");

const OPEN: &str = "<relay-project>";
const CLOSE: &str = "</relay-project>";

/// `text` with the project line in front: the agent only hears the project through the message.
pub fn wrap(project: &str, context: &str, text: &str) -> String {
    let context = if context.is_empty() { String::new() } else { format!(" (context {context})") };
    format!("{OPEN}{}{CLOSE}\n\n{text}", crate::prompt::fill(crate::prompt::text(PROJECT_LINE), &[("project", project), ("context", &context)]))
}

/// A user text from a transcript without the project line [`wrap`] put in front of it: what the user typed.
pub fn strip(text: &str) -> &str {
    let Some(rest) = text.strip_prefix(OPEN) else { return text };
    rest.split_once(CLOSE).map_or(text, |(_, typed)| typed.trim_start())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wrap_and_strip() {
        let sent = wrap("Relay", "Personal", "waarom?");
        assert!(sent.starts_with("<relay-project>This conversation is about the vault project \"Relay\" (context Personal)."));
        assert_eq!(strip(&sent), "waarom?");
        assert!(!wrap("Relay", "", "x").contains("(context"));
        assert_eq!(strip("<command-name>/clear</command-name>"), "<command-name>/clear</command-name>"); // not ours: the provider decides
        assert_eq!(strip("<relay-project>no end"), "<relay-project>no end");
        assert_eq!(strip("gewoon"), "gewoon");
    }
}
