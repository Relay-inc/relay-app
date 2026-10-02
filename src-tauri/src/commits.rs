// The repos a conversation committed to, so it can offer to link them to its project. The agent commits however it
// likes (any `git commit` in Bash), so nothing is read from the command: a tool call that mentions one takes a
// snapshot of the reflogs (`logs/HEAD`) of the repos under ~/projects and of their linked worktrees, its result
// another, and the repos whose reflog changed were committed to.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

type Stamp = (SystemTime, u64);
/// Reflog of each git dir (a repo's, a linked worktree's) -> its repo.
pub type Snapshot = HashMap<PathBuf, (PathBuf, Stamp)>;

/// Whether a tool call could commit: worth a snapshot around it.
pub fn may_commit(input: &serde_json::Value) -> bool {
    let s = input.to_string();
    ["git commit", "git push", "gh pr create"].iter().any(|c| s.contains(c))
}

fn stamp(gitdir: &Path) -> Option<Stamp> {
    let m = std::fs::metadata(gitdir.join("logs/HEAD")).ok()?;
    Some((m.modified().ok()?, m.len()))
}

/// The reflogs of every repo directly in `root` and of the linked worktrees git lists in `.git/worktrees/*`.
pub fn snapshot(root: &Path) -> Snapshot {
    let mut out = Snapshot::new();
    for repo in std::fs::read_dir(root).into_iter().flatten().flatten().map(|r| r.path()) {
        let git = repo.join(".git");
        let linked = std::fs::read_dir(git.join("worktrees")).into_iter().flatten().flatten().map(|w| w.path());
        for g in std::iter::once(git.clone()).chain(linked) {
            if let Some(s) = stamp(&g) { out.insert(g, (repo.clone(), s)); }
        }
    }
    out
}

/// The repos whose reflog (or a worktree's) is new or changed since `before`.
pub fn changed(before: &Snapshot, after: &Snapshot) -> Vec<PathBuf> {
    let mut repos: Vec<PathBuf> = after.iter().filter(|(g, (_, s))| before.get(*g).map(|b| &b.1) != Some(s)).map(|(_, (r, _))| r.clone()).collect();
    repos.sort();
    repos.dedup();
    repos
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn sh(dir: &Path, cmd: &str) { assert!(Command::new("/bin/sh").arg("-c").arg(cmd).current_dir(dir).status().unwrap().success(), "{cmd}"); }

    #[test]
    fn sees_the_repos_a_commit_went_to_in_a_checkout_or_a_worktree() {
        let root = std::env::temp_dir().join(format!("relay-commits-{}", std::process::id()));
        std::fs::remove_dir_all(&root).ok();
        for r in ["a", "b"] { std::fs::create_dir_all(root.join(r)).unwrap(); }
        let root = root.canonicalize().unwrap();
        let commit = "git -c user.email=a@b -c user.name=a commit -q --allow-empty -m x";
        for r in ["a", "b"] { sh(&root.join(r), &format!("git init -q && {commit}")); }
        sh(&root.join("a"), "git worktree add -q ../wt -b wt");
        let before = snapshot(&root);
        assert!(changed(&before, &snapshot(&root)).is_empty());
        sh(&root.join("b"), commit);
        assert_eq!(changed(&before, &snapshot(&root)), [root.join("b")]);
        let before = snapshot(&root);
        sh(&root.join("wt"), commit);
        assert_eq!(changed(&before, &snapshot(&root)), [root.join("a")], "a commit in a worktree is its repo's");
        assert!(may_commit(&serde_json::json!({"command": "git add . && git commit -m x"})));
        assert!(!may_commit(&serde_json::json!({"command": "git status"})));
        std::fs::remove_dir_all(&root).ok();
    }
}
