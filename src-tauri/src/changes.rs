// What a conversation changed, read from git: per repo it touched, the working tree against where its branch left
// the default branch (`git merge-base`), so committed and uncommitted work both show, like a PR would. New files git
// does not track yet come from `git diff --no-index`. Git cannot tell who made a change, so a shared checkout shows only
// the files the conversation's tools wrote; a worktree the conversation made shows all of it, that is exactly the agent's.
use serde_json::{json, Value};
use std::path::Path;
use std::process::Command;

fn git(dir: &str, args: &[&str], path_env: &str) -> Option<(bool, String)> {
    let o = Command::new("git").arg("-C").arg(dir).args(args).env("PATH", path_env).output().ok()?;
    Some((o.status.success(), String::from_utf8_lossy(&o.stdout).into_owned()))
}
fn ok(dir: &str, args: &[&str], path_env: &str) -> Option<String> {
    git(dir, args, path_env).filter(|(s, _)| *s).map(|(_, o)| o.trim_end().to_string())
}

/// The top of the checkout a path is in: the path itself or its nearest existing parent.
pub fn top_of(path: &str, path_env: &str) -> Option<String> {
    let dir = Path::new(path).ancestors().find(|p| p.is_dir())?;
    ok(&dir.to_string_lossy(), &["rev-parse", "--show-toplevel"], path_env).filter(|s| !s.is_empty())
}

/// `path` relative to `top`, which git gives resolved (/var is /private/var): resolve the part of `path` that still
/// exists the same way, a deleted file has none of its own.
fn relative(path: &str, top: &str) -> Option<String> {
    let p = Path::new(path);
    let (dir, rest) = p.ancestors().find_map(|a| a.canonicalize().ok().map(|c| (c, p.strip_prefix(a).unwrap().to_path_buf())))?;
    dir.join(rest).strip_prefix(top).ok().map(|r| r.to_string_lossy().into_owned())
}

/// One file of a `git diff`: its path, A/M/D/R, the counts, and its hunks from the first `@@` (no header lines).
fn split(diff: &str) -> Vec<Value> {
    let mut out = vec![];
    for part in diff.split("\ndiff --git ").map(|p| p.trim_start_matches("diff --git ")) {
        let Some(first) = part.lines().next().filter(|l| l.starts_with("a/")) else { continue };
        let head: Vec<&str> = part.lines().take_while(|l| !l.starts_with("@@")).collect();
        let path = head.iter().find_map(|l| l.strip_prefix("+++ b/"))
            .or_else(|| head.iter().find_map(|l| l.strip_prefix("rename to ")))
            .or_else(|| head.iter().find_map(|l| l.strip_prefix("--- a/")))
            .unwrap_or_else(|| first.rsplit(" b/").next().unwrap_or(first));
        let status = if head.iter().any(|l| l.starts_with("new file")) { "A" }
            else if head.iter().any(|l| l.starts_with("deleted file")) { "D" }
            else if head.iter().any(|l| l.starts_with("rename from")) { "R" } else { "M" };
        let patch: String = part.find("\n@@").map(|i| part[i + 1..].to_string()).unwrap_or_default();
        let lines = patch.lines().filter(|l| !l.starts_with("@@"));
        let (add, del) = lines.fold((0, 0), |(a, d), l| (a + l.starts_with('+') as u32, d + l.starts_with('-') as u32));
        out.push(json!({"path": path, "status": status, "add": add, "del": del, "patch": patch, "binary": head.iter().any(|l| l.starts_with("Binary files"))}));
    }
    out
}

// ponytail: no size cap per patch; a huge generated file is sent whole, cap it if a lockfile ever makes the drawer slow
/// The changes of one checkout: its branch, the base it is compared to, and its files. `only` limits them to those
/// paths (absolute), for a shared checkout where the rest of the diff is other people's work.
pub fn of_repo(top: &str, only: Option<&[String]>, path_env: &str) -> Value {
    let spec: Vec<String> = only.map(|ps| ps.iter().filter_map(|p| relative(p, top)).collect()).unwrap_or_default();
    let mut tail = vec!["--"];
    tail.extend(spec.iter().map(String::as_str));
    let base_ref = ok(top, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], path_env).unwrap_or_else(|| "HEAD".into());
    let base = ok(top, &["merge-base", &base_ref, "HEAD"], path_env).unwrap_or_else(|| "HEAD".into());
    let branch = ok(top, &["rev-parse", "--abbrev-ref", "HEAD"], path_env).unwrap_or_default();
    let name = Path::new(top).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if only.is_some() && spec.is_empty() { return json!({"repo": top, "name": name, "branch": branch, "base": base_ref, "files": []}); }
    let tracked = git(top, &[&["-c", "core.quotepath=off", "diff", "--no-color", "--no-ext-diff", "-M", &base][..], &tail].concat(), path_env).map(|(_, o)| o).unwrap_or_default();
    let mut files = split(&tracked);
    let untracked = ok(top, &[&["-c", "core.quotepath=off", "ls-files", "--others", "--exclude-standard"][..], &tail].concat(), path_env).unwrap_or_default();
    for f in untracked.lines().filter(|f| !f.is_empty()) {
        // --no-index exits 1 when the files differ, which they always do here
        let d = git(top, &["diff", "--no-color", "--no-ext-diff", "--no-index", "--", "/dev/null", f], path_env).map(|(_, o)| o).unwrap_or_default();
        files.extend(split(&d).into_iter().map(|mut v| { v["path"] = json!(f); v["status"] = json!("A"); v }));
    }
    json!({"repo": top, "name": name, "branch": branch, "base": base_ref, "files": files})
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sh(dir: &Path, cmd: &str) { assert!(Command::new("/bin/sh").arg("-c").arg(cmd).current_dir(dir).status().unwrap().success(), "{cmd}"); }

    #[test]
    fn shows_committed_uncommitted_and_new_files_against_the_base() {
        let path = std::env::var("PATH").unwrap();
        let tmp = std::env::temp_dir().join(format!("relay-changes-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        sh(&tmp, "git init -q -b main && git config user.email t@t && git config user.name t && printf 'a\\nb\\n' > keep.txt && printf 'x\\n' > gone.txt && git add . && git commit -qm base");
        sh(&tmp, "git checkout -qb work && printf 'a\\nB\\n' > keep.txt && git commit -qam edit && rm gone.txt && printf 'new\\n' > fresh.txt");
        let top = top_of(&tmp.join("keep.txt").to_string_lossy(), &path).unwrap();
        // no origin: compared to HEAD, so only what is not committed shows
        let v = of_repo(&top, None, &path);
        let files = v["files"].as_array().unwrap();
        let by = |p: &str| files.iter().find(|f| f["path"] == p).cloned().unwrap_or(Value::Null);
        assert_eq!(v["branch"], "work");
        assert_eq!(by("gone.txt")["status"], "D");
        assert_eq!(by("fresh.txt")["status"], "A");
        assert_eq!(by("fresh.txt")["add"], 1);
        assert!(by("fresh.txt")["patch"].as_str().unwrap().starts_with("@@"));
        assert!(by("keep.txt").is_null());
        // with an origin at main, the committed edit shows too
        sh(&tmp, "git update-ref refs/remotes/origin/main main && git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main");
        let v = of_repo(&top, None, &path);
        let keep = v["files"].as_array().unwrap().iter().find(|f| f["path"] == "keep.txt").cloned().unwrap();
        assert_eq!((keep["status"].clone(), keep["add"].clone(), keep["del"].clone()), (json!("M"), json!(1), json!(1)));
        // limited to what the conversation wrote, a shared checkout shows only those files
        let only = [tmp.join("fresh.txt").to_string_lossy().into_owned()];
        let v = of_repo(&top, Some(&only), &path);
        assert_eq!(v["files"].as_array().unwrap().iter().map(|f| f["path"].clone()).collect::<Vec<_>>(), [json!("fresh.txt")]);
        std::fs::remove_dir_all(&tmp).ok();
    }
}
