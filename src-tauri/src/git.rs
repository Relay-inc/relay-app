// The Git drawer: per checkout of a project (lib.rs git_tops picks which), what git status says changed, the working
// tree against HEAD (staged and unstaged together), and the few things to do about it: stage, unstage, discard, commit,
// push. New files git does not track yet come from `git diff --no-index`. Every path the webview names must be one git
// reports as changed in that checkout, so nothing outside it is staged or deleted.
use serde_json::{json, Value};
use std::path::Path;
use std::process::{Command, Stdio};

fn git(dir: &str, args: &[&str], path_env: &str) -> Option<(bool, String)> {
    let o = Command::new("git").arg("-C").arg(dir).args(args).env("PATH", path_env).output().ok()?;
    Some((o.status.success(), String::from_utf8_lossy(&o.stdout).into_owned()))
}
fn ok(dir: &str, args: &[&str], path_env: &str) -> Option<String> {
    git(dir, args, path_env).filter(|(s, _)| *s).map(|(_, o)| o.trim_end().to_string())
}
/// git that changes something: its stdout, or everything git said as the error (a hook prints its failure on either).
/// Never a prompt: a push that needs a password fails instead of hanging.
fn run(dir: &str, args: &[&str], path_env: &str) -> Result<String, String> {
    let o = Command::new("git").arg("-C").arg(dir).args(args).env("PATH", path_env).env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null()).output().map_err(|e| format!("git: {e}"))?;
    if o.status.success() { return Ok(String::from_utf8_lossy(&o.stdout).into_owned()); }
    let said: Vec<String> = [&o.stderr, &o.stdout].iter().map(|b| String::from_utf8_lossy(b).trim().to_string()).filter(|s| !s.is_empty()).collect();
    Err(if said.is_empty() { format!("git {} failed", args[0]) } else { said.join("\n") })
}

/// The top of the checkout a path is in: the path itself or its nearest existing parent.
pub fn top_of(path: &str, path_env: &str) -> Option<String> {
    let dir = Path::new(path).ancestors().find(|p| p.is_dir())?;
    ok(&dir.to_string_lossy(), &["rev-parse", "--show-toplevel"], path_env).filter(|s| !s.is_empty())
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

/// A changed file as `git status --porcelain=v2` gives it: X is the index, Y the working tree ('.' unchanged, '?'
/// both for a file git does not track, 'U' both for a conflict). `orig`: where a rename came from.
struct Entry { path: String, orig: Option<String>, x: char, y: char }
struct Status { branch: String, upstream: String, ahead: u32, behind: u32, files: Vec<Entry> }

fn status_of(top: &str, path_env: &str) -> Result<Status, String> {
    let out = run(top, &["-c", "core.quotepath=off", "status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"], path_env)?;
    let mut st = Status { branch: String::new(), upstream: String::new(), ahead: 0, behind: 0, files: vec![] };
    let mut recs = out.split('\0').filter(|r| !r.is_empty());
    let xy = |r: &str| { let mut c = r[2..].chars(); (c.next().unwrap_or('.'), c.next().unwrap_or('.')) };
    let last = |r: &str, n: usize| r.splitn(n, ' ').nth(n - 1).unwrap_or("").to_string();
    while let Some(r) = recs.next() {
        if let Some(h) = r.strip_prefix("# branch.head ") { st.branch = h.into(); }
        else if let Some(u) = r.strip_prefix("# branch.upstream ") { st.upstream = u.into(); }
        else if let Some(ab) = r.strip_prefix("# branch.ab ") {
            let n = |p: char| ab.split(' ').find_map(|w| w.strip_prefix(p)).and_then(|w| w.parse().ok()).unwrap_or(0);
            (st.ahead, st.behind) = (n('+'), n('-'));
        }
        else if r.starts_with("1 ") { let (x, y) = xy(r); st.files.push(Entry { path: last(r, 9), orig: None, x, y }); }
        // a rename or copy: the path it came from is the next record
        else if r.starts_with("2 ") { let (x, y) = xy(r); st.files.push(Entry { path: last(r, 10), orig: recs.next().map(str::to_string), x, y }); }
        else if r.starts_with("u ") { st.files.push(Entry { path: last(r, 11), orig: None, x: 'U', y: 'U' }); }
        else if let Some(p) = r.strip_prefix("? ") { st.files.push(Entry { path: p.into(), orig: None, x: '?', y: '?' }); }
    }
    Ok(st)
}

/// A checkout as the drawer shows it: its branch and upstream, how far it is ahead and behind, and per changed file
/// whether it is staged, its letter, its counts and its diff against HEAD.
pub fn status(top: &str, path_env: &str) -> Result<Value, String> {
    let st = status_of(top, path_env)?;
    let name = Path::new(top).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    // a repo without a commit yet is compared to the empty tree
    let base = if ok(top, &["rev-parse", "--verify", "-q", "HEAD"], path_env).is_some() { "HEAD" } else { "4b825dc642cb6eb9a060e54bf8d69288fbee4904" };
    let tracked = git(top, &["-c", "core.quotepath=off", "diff", "--no-color", "--no-ext-diff", "-M", base], path_env).map(|(_, o)| o).unwrap_or_default();
    let diffs = split(&tracked);
    // ponytail: every changed file's whole patch, no cap. Cap it if a generated file or a big untracked folder makes the drawer slow
    let files: Vec<Value> = st.files.iter().map(|e| {
        let untracked = e.x == '?';
        let d = if untracked {
            // --no-index exits 1 when the files differ, which they always do here
            let d = git(top, &["diff", "--no-color", "--no-ext-diff", "--no-index", "--", "/dev/null", &e.path], path_env).map(|(_, o)| o).unwrap_or_default();
            split(&d).into_iter().next()
        } else { diffs.iter().find(|f| f["path"] == e.path.as_str()).cloned() };
        let d = d.unwrap_or_else(|| json!({"add": 0, "del": 0, "patch": "", "binary": false}));
        let letter = if e.x != '.' { e.x } else { e.y };
        json!({"path": e.path, "orig": e.orig, "status": letter.to_string(), "staged": !untracked && e.x != '.', "untracked": untracked,
               "add": d["add"], "del": d["del"], "patch": d["patch"], "binary": d["binary"]})
    }).collect();
    Ok(json!({"repo": top, "name": name, "branch": st.branch, "upstream": st.upstream, "ahead": st.ahead, "behind": st.behind, "files": files}))
}

/// The changed file at `path`, refused when git reports no change there: a path outside the checkout never is one.
fn entry(top: &str, path: &str, path_env: &str) -> Result<Entry, String> {
    status_of(top, path_env)?.files.into_iter().find(|e| e.path == path).ok_or_else(|| format!("{path}: no change git knows of in {top}"))
}

/// Stage (`git add`) or unstage (`git restore --staged`) changed files, a rename takes the path it came from along.
pub fn stage(top: &str, paths: &[String], on: bool, path_env: &str) -> Result<(), String> {
    let mut args: Vec<String> = vec![];
    for p in paths { let e = entry(top, p, path_env)?; args.push(e.path); args.extend(e.orig); }
    let head = ok(top, &["rev-parse", "--verify", "-q", "HEAD"], path_env).is_some();
    let cmd: &[&str] = if on { &["add", "--"] } else if head { &["restore", "--staged", "--"] } else { &["rm", "--cached", "-q", "--"] };
    run(top, &[cmd, &args.iter().map(String::as_str).collect::<Vec<_>>()[..]].concat(), path_env).map(|_| ())
}

/// Throw a file's changes away: a tracked file back to HEAD in the index and the working tree, a file git does not
/// track deleted. The drawer asks first, this loses work.
pub fn discard(top: &str, path: &str, path_env: &str) -> Result<(), String> {
    let e = entry(top, path, path_env)?;
    if e.x == '?' { return std::fs::remove_file(Path::new(top).join(&e.path)).map_err(|err| format!("{path}: {err}")); }
    let mut args = vec!["restore", "--staged", "--worktree", "--source=HEAD", "--", &e.path];
    if let Some(o) = &e.orig { args.push(o); }
    run(top, &args, path_env).map(|_| ())
}

/// Commit what is staged, then push the branch when asked: to its upstream, or to origin under the same name as its
/// new upstream when it has none.
pub fn commit(top: &str, message: &str, push: bool, path_env: &str) -> Result<(), String> {
    run(top, &["commit", "-q", "-m", message], path_env)?;
    if !push { return Ok(()); }
    let upstream = ok(top, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], path_env).is_some();
    run(top, if upstream { &["push"] } else { &["push", "--set-upstream", "origin", "HEAD"] }, path_env).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sh(dir: &Path, cmd: &str) { assert!(Command::new("/bin/sh").arg("-c").arg(cmd).current_dir(dir).status().unwrap().success(), "{cmd}"); }

    #[test]
    fn status_stage_discard_commit_and_push() {
        let path = std::env::var("PATH").unwrap();
        let tmp = std::env::temp_dir().join(format!("relay-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        sh(&tmp, "git init -q --bare origin.git && git init -q -b main repo && cd repo && git config user.email t@t && git config user.name t \
                  && printf 'a\\nb\\n' > keep.txt && printf 'x\\n' > gone.txt && printf 's\\n' > staged.txt && git add . && git commit -qm base \
                  && git remote add origin ../origin.git");
        let repo = tmp.join("repo");
        sh(&repo, "printf 'a\\nB\\n' > keep.txt && rm gone.txt && printf 'S\\n' > staged.txt && git add staged.txt && mkdir -p new && printf 'n\\n' > new/fresh.txt");
        let top = top_of(&repo.join("keep.txt").to_string_lossy(), &path).unwrap();
        let files = |top: &str| status(top, &path).unwrap()["files"].as_array().unwrap().clone();
        let by = |fs: &[Value], p: &str| fs.iter().find(|f| f["path"] == p).cloned().unwrap_or(Value::Null);
        let v = status(&top, &path).unwrap();
        assert_eq!((v["branch"].clone(), v["upstream"].clone()), (json!("main"), json!("")));
        let fs = files(&top);
        assert_eq!((by(&fs, "staged.txt")["staged"].clone(), by(&fs, "staged.txt")["status"].clone()), (json!(true), json!("M")));
        assert_eq!((by(&fs, "keep.txt")["staged"].clone(), by(&fs, "keep.txt")["add"].clone(), by(&fs, "keep.txt")["del"].clone()), (json!(false), json!(1), json!(1)));
        assert_eq!(by(&fs, "gone.txt")["status"], "D");
        let fresh = by(&fs, "new/fresh.txt");
        assert_eq!((fresh["untracked"].clone(), fresh["status"].clone(), fresh["add"].clone()), (json!(true), json!("?"), json!(1)));
        assert!(fresh["patch"].as_str().unwrap().starts_with("@@"));

        // stage and unstage
        stage(&top, &["keep.txt".into(), "new/fresh.txt".into()], true, &path).unwrap();
        let fs = files(&top);
        assert_eq!((by(&fs, "keep.txt")["staged"].clone(), by(&fs, "new/fresh.txt")["status"].clone()), (json!(true), json!("A")));
        stage(&top, &["keep.txt".into()], false, &path).unwrap();
        assert_eq!(by(&files(&top), "keep.txt")["staged"], false);

        // a path outside the checkout, or one git sees no change in, is refused
        let outside = tmp.join("outside.txt");
        std::fs::write(&outside, "x").unwrap();
        assert!(discard(&top, "../outside.txt", &path).is_err());
        assert!(discard(&top, &outside.to_string_lossy(), &path).is_err());
        assert!(stage(&top, &["/etc/hosts".into()], true, &path).is_err());
        assert!(discard(&top, "README.md", &path).is_err());
        assert!(outside.exists());

        // discard: a tracked file back to HEAD, an untracked one deleted
        sh(&repo, "printf 'u\\n' > loose.txt");
        discard(&top, "keep.txt", &path).unwrap();
        discard(&top, "loose.txt", &path).unwrap();
        assert_eq!(std::fs::read_to_string(repo.join("keep.txt")).unwrap(), "a\nb\n");
        assert!(!repo.join("loose.txt").exists());

        // commit what is staged only, then push with no upstream: it gets one
        commit(&top, "Plant the apple trees", true, &path).unwrap();
        let v = status(&top, &path).unwrap();
        assert_eq!((v["upstream"].clone(), v["ahead"].clone()), (json!("origin/main"), json!(0)));
        assert_eq!(v["files"].as_array().unwrap().iter().map(|f| f["path"].clone()).collect::<Vec<_>>(), [json!("gone.txt")]);
        assert_eq!(ok(&top, &["log", "-1", "--format=%s"], &path).unwrap(), "Plant the apple trees");
        // nothing staged: git's own words come back
        assert!(commit(&top, "Empty", false, &path).unwrap_err().contains("no changes added to commit"));
        std::fs::remove_dir_all(&tmp).ok();
    }
}
