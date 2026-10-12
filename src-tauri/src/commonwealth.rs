// Commonwealth, the git-backed team brain: a Claude Code plugin (MCP tools and hooks) plus the `commonwealth` CLI.
// Not a board. The app only wires it up: which brain a project's sessions use (resolved from the user's own
// ~/.commonwealth/config.json, never configured here), the install, and the review queue of staged notes.
//
// Privacy: the vault holds personal notes. A session gets a brain only when one of its project's repos matches a
// registry rule; a project without repos, or whose repos match nothing (or a deny), gets none. Never the defaultBrain
// on its own: Commonwealth itself treats that as the target of a matched rule, not as a catch-all.

use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};

pub const PLUGIN: &str = "commonwealth@commonwealth";
pub const MARKETPLACE: &str = "kristoffeys/commonwealth";
/// From Commonwealth's README (Quick start), shown when the CLI is missing.
pub const CLI_HINT: &str = "npm i -g @cmnwlth/cli";

#[derive(Debug, Default)]
pub struct Registry { rules: Vec<Rule>, default: Option<String> }
#[derive(Debug)]
struct Rule { repo: Option<String>, org: Option<String>, brain: Option<String>, deny: bool }

pub fn load(home: &str) -> Registry {
    let Some(c) = fs::read_to_string(format!("{home}/.commonwealth/config.json")).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) else { return Registry::default() };
    let s = |v: &Value| v.as_str().filter(|s| !s.is_empty()).map(|s| expand(home, s));
    let rules = c["rules"].as_array().into_iter().flatten().map(|r| Rule {
        repo: r["repo"].as_str().map(str::to_lowercase), org: r["org"].as_str().map(|o| o.trim_end_matches("/*").to_lowercase()),
        brain: s(&r["brain"]), deny: r["deny"] == true,
    }).collect();
    // defaultBrain is a path or {brain, remote}
    let default = s(&c["defaultBrain"]).or_else(|| s(&c["defaultBrain"]["brain"]));
    Registry { rules, default }
}
fn expand(home: &str, p: &str) -> String { p.strip_prefix("~/").map_or(p.to_string(), |r| format!("{home}/{r}")) }

enum Hit { Brain(Option<String>), Deny }
/// What the registry says about one repo ("owner/repo"): the most specific matching rule (repo over org), deny wins a tie.
fn hit(reg: &Registry, repo: &str) -> Option<Hit> {
    let repo = repo.to_lowercase();
    let owner = repo.split('/').next().unwrap_or("");
    let best = reg.rules.iter().filter_map(|r| {
        let tier = if r.repo.as_deref() == Some(&repo) { 2 } else if r.org.as_deref().is_some_and(|o| o == owner) { 1 } else { return None };
        Some((tier, r))
    }).max_by_key(|(tier, r)| (*tier, r.deny))?.1;
    Some(if best.deny { Hit::Deny } else { Hit::Brain(best.brain.clone().or_else(|| reg.default.clone())) })
}
/// The brain a project's sessions use: its repos through the registry, the first that routes. None when no repo matches,
/// when any repo is denied (the whole project stays out), and when the matched rule names no brain and there is no default.
// ponytail: mirrors Commonwealth's ADR-0024 resolution partially (repo and org rules only, no path prefixes, markers or
// `*` catch-all, no shared-rule shadowing). Ceiling: a registry that routes in ways this does not see. Upgrade: ask
// Commonwealth itself, a `commonwealth registry resolve` CLI.
pub fn resolve(reg: &Registry, repos: &[String]) -> Option<String> { route(reg, repos).map(|(b, _)| b) }
/// The brain and the repo that routed to it. That repo is the session's COMMONWEALTH_SOURCE: a vault session runs in the
/// vault, and without it Commonwealth files every note under "vault".
// ponytail: a project with several routed repos (o2o) gets the first one, sorted, as its source. Since Commonwealth 0.7
// the session also passes the project name (COMMONWEALTH_PROJECT), which files the notes when the brain's registry
// knows that name; the repo only decides when it doesn't.
fn route(reg: &Registry, repos: &[String]) -> Option<(String, String)> {
    let hits: Vec<(&String, Hit)> = repos.iter().filter_map(|r| Some((r, hit(reg, r)?))).collect();
    if hits.iter().any(|(_, h)| matches!(h, Hit::Deny)) { return None; }
    hits.into_iter().find_map(|(r, h)| match h { Hit::Brain(b) => Some((b?, r.clone())), Hit::Deny => None })
}
/// A resolved brain that exists on this machine.
fn is_brain(p: &str) -> bool { Path::new(p).join(".commonwealth/schema-version").is_file() }

/// project -> brain for every project that has repos (repo -> project as repo_projects gives it), sorted by project.
pub fn brains(home: &str, repo_projects: &std::collections::HashMap<String, String>) -> BTreeMap<String, Option<String>> {
    let reg = load(home);
    let mut by: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (repo, project) in repo_projects { by.entry(project.clone()).or_default().push(repo.clone()); }
    by.into_iter().map(|(p, mut repos)| { repos.sort(); (p, resolve(&reg, &repos).filter(|b| is_brain(b))) }).collect()
}

/// The brain a project's sessions use and the repo to file their notes under, like `brains` for one project.
pub fn session(home: &str, repo_projects: &std::collections::HashMap<String, String>, project: &str) -> Option<(String, String)> {
    let mut repos: Vec<String> = repo_projects.iter().filter(|(_, p)| *p == project).map(|(r, _)| r.clone()).collect();
    repos.sort(); // a checkout's own casing ("o2o-Bicycle-leasing/x") sorts before the config's lowercased key
    route(&load(home), &repos).filter(|(b, _)| is_brain(b))
}

pub fn brain_name(brain: &str) -> &str { brain.trim_end_matches('/').rsplit('/').next().unwrap_or(brain) }

// ---------- the install

/// Whether the plugin is installed and enabled, from `claude plugin list --json`.
pub fn plugin_on(claude: &str, path: &str) -> bool {
    agent_core::run(claude, path, &["plugin", "list", "--json"]).and_then(|o| serde_json::from_str::<Vec<Value>>(&o).ok())
        .is_some_and(|l| l.iter().any(|p| p["id"] == PLUGIN && p["enabled"] == true))
}
/// Marketplace add, then plugin install, as the README says; whatever either prints on failure comes back verbatim.
pub fn install(claude: &str, path: &str) -> Result<(), String> {
    let run = |args: &[&str]| {
        let o = Command::new(claude).args(args).env("PATH", path).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
        if o.status.success() { return Ok(()); }
        let (out, err) = (String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
        Err(format!("claude {}: {}", args.join(" "), format!("{}\n{}", err.trim(), out.trim()).trim()))
    };
    // a marketplace that is already there fails the add, the install tells whether that matters
    let added = run(&["plugin", "marketplace", "add", MARKETPLACE]);
    run(&["plugin", "install", PLUGIN]).map_err(|e| match added { Err(a) => format!("{a}\n{e}"), Ok(()) => e })
}

// ---------- the review queue

/// A staged note (<brain>/staging/**/<id>.md): frontmatter `key: value` lines, then the body.
// ponytail: reads the files instead of `commonwealth pending` (which prints id, kind and title only, no body); a
// plain line parser, not YAML. Ceiling: a title in a block scalar. Upgrade: a `pending --json`.
fn read_note(brain: &str, p: &Path) -> Option<Value> {
    let text = fs::read_to_string(p).ok()?;
    let rest = text.strip_prefix("---\n")?;
    let (head, body) = rest.split_once("\n---")?;
    let get = |k: &str| head.lines().find_map(|l| l.strip_prefix(k)?.strip_prefix(':')).map(|v| unquote(v.trim())).unwrap_or_default();
    let id = get("id");
    if id.is_empty() { return None; }
    Some(json!({"brain": brain, "id": id, "kind": get("kind"), "title": get("title"), "created": get("created"), "author": get("author"),
        "source": get("source"), "body": body.trim()}))
}
pub(crate) fn unquote(v: &str) -> String {
    if v.len() >= 2 && v.starts_with('\'') && v.ends_with('\'') { v[1..v.len() - 1].replace("''", "'") }
    else if v.len() >= 2 && v.starts_with('"') && v.ends_with('"') { v[1..v.len() - 1].replace("\\\"", "\"") }
    else { v.to_string() }
}
fn md_files(d: &Path, out: &mut Vec<std::path::PathBuf>) {
    for e in fs::read_dir(d).into_iter().flatten().flatten() {
        let p = e.path();
        if p.is_dir() { md_files(&p, out); } else if p.extension().is_some_and(|x| x == "md") { out.push(p); }
    }
}
/// Every staged note of a brain, newest first.
pub fn staged(brain: &str) -> Vec<Value> {
    let mut files = vec![];
    md_files(&Path::new(brain).join("staging"), &mut files);
    let mut notes: Vec<Value> = files.iter().filter_map(|f| read_note(brain, f)).collect();
    notes.sort_by(|a, b| b["created"].as_str().cmp(&a["created"].as_str()));
    notes
}

/// `commonwealth promote|reject <ids>` for a brain; its failure text comes back verbatim.
pub fn act(cli: &str, path: &str, brain: &str, verb: &str, ids: &[String]) -> Result<(), String> {
    let o = Command::new(cli).arg(verb).args(ids).current_dir(brain).env("PATH", path).env("COMMONWEALTH_BRAIN_DIR", brain)
        .stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
    if o.status.success() { return Ok(()); }
    Err(format!("commonwealth {verb}: {}", format!("{}\n{}", String::from_utf8_lossy(&o.stderr).trim(), String::from_utf8_lossy(&o.stdout).trim()).trim()))
}

/// `commonwealth join <remote>`: clone a team brain and route the orgs its project list names to it (Commonwealth 0.8).
/// Its report on success, its failure text otherwise. A remote that could pass as a flag is refused.
pub fn join(cli: &str, path: &str, remote: &str) -> Result<String, String> {
    let remote = remote.trim();
    if remote.is_empty() || remote.starts_with('-') || remote.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("not a git remote".into());
    }
    let o = Command::new(cli).args(["join", remote]).env("PATH", path).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
    let out = String::from_utf8_lossy(&o.stdout).trim().to_string();
    if o.status.success() { return Ok(out); }
    Err(format!("commonwealth join: {}", format!("{}\n{out}", String::from_utf8_lossy(&o.stderr).trim()).trim()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn join_refuses_what_is_not_a_remote() {
        for bad in ["", "  ", "--brain=/x", "git@host:a/b.git extra", "a\nb"] {
            assert_eq!(join("/nonexistent/commonwealth", "", bad), Err("not a git remote".into()), "{bad:?}");
        }
        // a real-looking remote gets past the check (and fails on the missing binary instead)
        assert_ne!(join("/nonexistent/commonwealth", "", "git@github.com:acme/brain.git"), Err("not a git remote".into()));
    }
    fn reg(v: Value) -> Registry {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!("cw-test-{}-{}", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
        fs::create_dir_all(dir.join(".commonwealth")).unwrap();
        fs::write(dir.join(".commonwealth/config.json"), v.to_string()).unwrap();
        load(dir.to_str().unwrap())
    }
    fn repos(r: &[&str]) -> Vec<String> { r.iter().map(|s| s.to_string()).collect() }
    #[test]
    fn repo_beats_org_and_a_bare_rule_goes_to_the_default() {
        let r = reg(json!({"defaultBrain": {"brain": "/b/team"}, "rules": [{"org": "acme/*"}, {"repo": "Acme/Special", "brain": "/b/special"}]}));
        assert_eq!(resolve(&r, &repos(&["acme/web"])), Some("/b/team".into()));
        assert_eq!(resolve(&r, &repos(&["acme/special"])), Some("/b/special".into()));
        assert_eq!(resolve(&r, &repos(&["ACME/Web", "x/y"])), Some("/b/team".into()));
        assert_eq!(route(&r, &repos(&["x/y", "acme/web"])), Some(("/b/team".into(), "acme/web".into()))); // the repo that routed
    }
    #[test]
    fn unmatched_and_repoless_projects_get_no_brain_even_with_a_default() {
        let r = reg(json!({"defaultBrain": "/b/team", "rules": [{"org": "acme/*"}]}));
        assert_eq!(resolve(&r, &repos(&["kristoffeys/facturio"])), None);
        assert_eq!(resolve(&r, &[]), None);
        assert_eq!(resolve(&reg(json!({"rules": [{"org": "acme/*"}]})), &repos(&["acme/web"])), None); // matched, but no brain and no default
    }
    #[test]
    fn deny_keeps_the_whole_project_out() {
        let r = reg(json!({"defaultBrain": "/b/team", "rules": [{"org": "acme/*"}, {"repo": "acme/secret", "deny": true}]}));
        assert_eq!(resolve(&r, &repos(&["acme/secret"])), None);
        assert_eq!(resolve(&r, &repos(&["acme/web", "acme/secret"])), None);
        let tie = reg(json!({"rules": [{"repo": "a/b", "brain": "/b/x"}, {"repo": "a/b", "deny": true}]}));
        assert_eq!(resolve(&tie, &repos(&["a/b"])), None);
    }
    #[test]
    fn a_staged_note_reads_with_its_body() {
        let dir = std::env::temp_dir().join(format!("cw-staged-{}", std::process::id()));
        fs::create_dir_all(dir.join("staging/p/decisions")).unwrap();
        fs::write(dir.join("staging/p/decisions/x.md"), "---\nid: x-1\nkind: decision\ntitle: 'It''s done'\ncreated: '2026-09-03'\n---\nBody line\n").unwrap();
        let n = staged(dir.to_str().unwrap());
        assert_eq!((n[0]["id"].as_str(), n[0]["title"].as_str(), n[0]["body"].as_str(), n[0]["created"].as_str()), (Some("x-1"), Some("It's done"), Some("Body line"), Some("2026-09-03")));
    }
    /// cargo test real_mapping -- --ignored --nocapture: the user's own registry against the user's own vault
    #[test]
    #[ignore]
    fn real_mapping() {
        let (home, vault) = (std::env::var("HOME").unwrap(), format!("{}/vault", std::env::var("HOME").unwrap()));
        for (p, b) in brains(&home, &crate::repo_projects(&vault)) { println!("{p:42} -> {}", b.as_deref().map_or("(none)".into(), |b| brain_name(b).to_string())); }
    }
}
