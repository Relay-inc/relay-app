// The git worktrees a conversation made, so closing it cleans them up. The agent makes them however it likes (any
// `git worktree add` in Bash), so they are not read from the command: a tool call that mentions worktrees takes a
// snapshot of the worktrees the repos under ~/projects have, its result another, and the new ones are the conversation's.
// Kept in worktrees.json: {conversation key: [worktree path, ...]}.
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Whether a tool call could make a worktree: worth a snapshot around it.
pub fn may_add(input: &serde_json::Value) -> bool { input.to_string().contains("worktree") }

/// Every linked worktree of the repos in `root`, from git's own bookkeeping (`.git/worktrees/*/gitdir`).
pub fn snapshot(root: &Path) -> HashSet<PathBuf> {
    let Ok(repos) = std::fs::read_dir(root) else { return HashSet::new() };
    repos.flatten()
        .filter_map(|r| std::fs::read_dir(r.path().join(".git/worktrees")).ok())
        .flat_map(|d| d.flatten())
        .filter_map(|w| std::fs::read_to_string(w.path().join("gitdir")).ok())
        .filter_map(|g| Path::new(g.trim()).parent().map(Path::to_path_buf))
        .collect()
}

pub fn load(json: &str) -> HashMap<String, Vec<String>> { serde_json::from_str(json).unwrap_or_default() }

/// Remove what is safe to remove. Kept: changes git would lose (it refuses itself without --force), and a detached
/// HEAD with commits no branch or tag has. The branch of a removed worktree stays. Returns (removed, kept).
pub fn remove(paths: &[String], path_env: &str) -> (usize, Vec<String>) {
    let git = |dir: &str, args: &[&str]| Command::new("git").arg("-C").arg(dir).args(args).env("PATH", path_env).output().ok();
    let (mut removed, mut kept) = (0, vec![]);
    for p in paths {
        if !Path::new(p).exists() { continue; } // already gone, the agent removed it
        let detached = git(p, &["rev-parse", "--abbrev-ref", "HEAD"]).is_some_and(|o| o.stdout.starts_with(b"HEAD\n"));
        let orphaned = detached && git(p, &["for-each-ref", "--contains", "HEAD", "--count=1"]).is_some_and(|o| o.stdout.is_empty());
        if !orphaned && git(p, &["worktree", "remove", p]).is_some_and(|o| o.status.success()) { removed += 1; } else { kept.push(p.clone()); }
    }
    (removed, kept)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sh(dir: &Path, cmd: &str) { assert!(Command::new("/bin/sh").arg("-c").arg(cmd).current_dir(dir).status().unwrap().success(), "{cmd}"); }

    #[test]
    fn finds_new_worktrees_and_removes_only_the_safe_ones() {
        let root = std::env::temp_dir().join(format!("relay-wt-{}", std::process::id()));
        std::fs::remove_dir_all(&root).ok();
        std::fs::create_dir_all(root.join("repo")).unwrap();
        let root = root.canonicalize().unwrap();
        sh(&root.join("repo"), "git init -q && git -c user.email=a@b -c user.name=a commit -q --allow-empty -m a");
        let before = snapshot(&root);
        sh(&root.join("repo"), "git worktree add -q ../clean -b clean && git worktree add -q ../dirty -b dirty && touch ../dirty/x \
            && git worktree add -q --detach ../lost && git -C ../lost -c user.email=a@b -c user.name=a commit -q --allow-empty -m b");
        let new: Vec<String> = snapshot(&root).difference(&before).map(|p| p.to_string_lossy().into()).collect();
        assert_eq!(new.len(), 3);
        let (removed, mut kept) = remove(&new, &std::env::var("PATH").unwrap());
        kept.sort();
        assert_eq!(removed, 1);
        assert_eq!(kept, [root.join("dirty"), root.join("lost")].map(|p| p.to_string_lossy().to_string()));
        assert!(!root.join("clean").exists());
        std::fs::remove_dir_all(&root).ok();
    }
}
