//! GitHub on a work machine, per paired device. The token comes from GitHub's device flow: the server asks GitHub for a
//! code, the app shows it, the user types it on github.com, the server waits for the token. Only that code passes
//! through the app. The token is sealed with the device's mirror key (mirror.rs `put_secret`), so it is usable only
//! while the mirror is open, like the vault. While it is, a plaintext copy sits in the device's working copy
//! (`<work>/<ns>/.github`, beside the mirrored roots, in RAM) for git's credential helper, `relay-server git-credential`.
//! The token never goes into an environment variable or on a command line: agents and the server's own git get the
//! helper and a commit identity through GIT_CONFIG_* (`git_env`).
//!
//! The repos live in one folder, RELAY_SERVER_REPOS or else `~/repos`, a folder per repo named after it.

use crate::mirror::Mirror;
use crate::{percent, write_private};
use relay_remote::proto::{DeviceCode, Github, RepoStatus, Snapshot};
use serde_json::Value;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use std::{fs, thread};

/// The client id of Relay's OAuth app (device flow on). Empty in this build until one is registered:
/// RELAY_GITHUB_CLIENT_ID gives it.
const CLIENT_ID: &str = "";
/// The mirror secret that holds the token.
const SECRET: &str = "github";
/// What a device flow or a repo action says when the device's mirror has no key yet.
pub const LOCKED: &str = "locked: opens when Relay on the laptop connects";

fn var(k: &str) -> Option<String> { std::env::var(k).ok().filter(|s| !s.is_empty()) }
fn client_id() -> String { var("RELAY_GITHUB_CLIENT_ID").unwrap_or_else(|| CLIENT_ID.into()) }
/// GitHub's web and API addresses, another server's in the tests.
fn base() -> String { var("RELAY_GITHUB_URL").unwrap_or_else(|| "https://github.com".into()).trim_end_matches('/').into() }
fn api() -> String { var("RELAY_GITHUB_API").unwrap_or_else(|| "https://api.github.com".into()).trim_end_matches('/').into() }
/// Where the repos are cloned: RELAY_SERVER_REPOS, else `~/repos` (a LaunchAgent on a Mac may not read ~/Documents).
pub fn repos_dir() -> PathBuf {
    var("RELAY_SERVER_REPOS").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("repos"))
}

/// What is sealed, and the RAM copy the helper reads.
#[derive(serde::Serialize, serde::Deserialize)]
struct Token { token: String, login: String, since: String }

/// One request with curl (on a Mac and in the image, no HTTP client in this binary), its JSON answer. `stdin` carries
/// what must stay off the command line, read by curl with `-d @-` or `-H @-`.
fn curl(url: &str, args: &[&str], stdin: &str) -> Result<Value, String> {
    let mut c = Command::new("curl").args(["-fsS", "-m", "15", "-H", "Accept: application/json"]).args(args).arg(url)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("curl: {e}"))?;
    if let Some(mut i) = c.stdin.take() { i.write_all(stdin.as_bytes()).ok(); }
    let out = c.wait_with_output().map_err(|e| format!("curl: {e}"))?;
    if !out.status.success() { return Err(format!("GitHub: {}", String::from_utf8_lossy(&out.stderr).trim())); }
    serde_json::from_slice(&out.stdout).map_err(|e| format!("GitHub: {e}"))
}

/// GitHub's answer to `login/device/code`: the code for the user, and the device code to poll with.
fn parse_device(v: &Value) -> Result<(DeviceCode, String), String> {
    if let Some(e) = v["error"].as_str() { return Err(format!("GitHub: {}", v["error_description"].as_str().unwrap_or(e))); }
    let s = |k: &str| v[k].as_str().unwrap_or("").to_string();
    let (code, user_code, verification_uri) = (s("device_code"), s("user_code"), s("verification_uri"));
    if code.is_empty() || user_code.is_empty() || verification_uri.is_empty() { return Err("GitHub: no device code in its answer".into()); }
    Ok((DeviceCode { user_code, verification_uri, expires_in: v["expires_in"].as_u64().unwrap_or(900), interval: v["interval"].as_u64().unwrap_or(5).max(1) }, code))
}

/// GitHub's answer to one poll of `login/oauth/access_token`.
#[derive(Debug, PartialEq)]
enum Poll { Pending, SlowDown, Token(String), Expired, Denied, Error(String) }
fn parse_poll(v: &Value) -> Poll {
    if let Some(t) = v["access_token"].as_str().filter(|t| !t.is_empty()) { return Poll::Token(t.into()); }
    match v["error"].as_str().unwrap_or("") {
        "authorization_pending" => Poll::Pending,
        "slow_down" => Poll::SlowDown,
        "expired_token" => Poll::Expired,
        "access_denied" => Poll::Denied,
        "" => Poll::Error("no token in GitHub's answer".into()),
        e => Poll::Error(v["error_description"].as_str().unwrap_or(e).into()),
    }
}

fn state(s: &str) -> Github { Github { state: s.into(), ..Default::default() } }
fn email(login: &str) -> String { format!("{login}@users.noreply.github.com") }
/// `date` here, in local time (no date crate in this binary).
fn date(fmt: &str) -> String {
    Command::new("date").arg(fmt).output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default()
}

/// A word for git's shell (a helper that starts with `!` runs through sh).
fn sq(s: &str) -> String { format!("'{}'", s.replace('\'', r"'\''")) }
/// The credential helper as git runs it: this binary (`--relay-server` when it is the Relay app) with the RAM copy's
/// path, so it needs no running server. Git adds `get`, `store` or `erase`.
pub fn helper_cmd(exe: &Path, file: &Path) -> String {
    let flag = if exe.file_name().is_some_and(|n| n == "relay-server") { "" } else { " --relay-server" };
    format!("!{}{flag} git-credential {}", sq(&exe.to_string_lossy()), sq(&file.to_string_lossy()))
}
/// The environment for git: no credential helper but `helper` (no keychain, no prompt), the commit identity `who`
/// (name, email), and no terminal prompt. The token is not in it.
pub fn git_env(helper: Option<&str>, who: Option<(&str, &str)>) -> Vec<(String, String)> {
    let mut kv = vec![("credential.helper", "")];
    if let Some(h) = helper { kv.push(("credential.https://github.com.helper", h)); }
    if let Some((name, email)) = who { kv.extend([("user.name", name), ("user.email", email)]); }
    let mut env = vec![("GIT_CONFIG_COUNT".to_string(), kv.len().to_string()), ("GIT_TERMINAL_PROMPT".into(), "0".into())];
    for (i, (k, v)) in kv.into_iter().enumerate() { env.extend([(format!("GIT_CONFIG_KEY_{i}"), k.to_string()), (format!("GIT_CONFIG_VALUE_{i}"), v.to_string())]); }
    env
}

/// `git-credential <file> get`: git's request on stdin (key=value lines), the answer for github.com over https from
/// the RAM copy at `file`, nothing for any other host or when there is no token. `store` and `erase` do nothing.
pub fn credential(file: &Path, op: &str, input: &str) -> String {
    if op != "get" { return String::new(); }
    let kv: HashMap<&str, &str> = input.lines().take_while(|l| !l.is_empty()).filter_map(|l| l.split_once('=')).collect();
    if kv.get("protocol") != Some(&"https") || kv.get("host") != Some(&"github.com") { return String::new(); }
    match fs::read(file).ok().and_then(|b| serde_json::from_slice::<Token>(&b).ok()) {
        Some(t) => format!("username=x-access-token\npassword={}\n", t.token),
        None => String::new(),
    }
}

/// A repo folder's name: letters, digits, `.`, `_`, `-`, not starting with a dot.
fn name_ok(n: &str) -> bool { !n.is_empty() && !n.starts_with('.') && n.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) }
/// `owner/repo` as GitHub allows them.
fn repo_ok(r: &str) -> bool {
    r.split_once('/').is_some_and(|(o, n)| !o.is_empty() && o.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && name_ok(n))
}
/// The `owner/repo` of a GitHub remote URL (https, ssh or scp-like), lower case; empty for any other host.
fn github_repo(url: &str) -> String {
    let u = url.trim();
    let rest = match u.strip_prefix("git@github.com:") {
        Some(r) => r,
        None => {
            let r = u.split_once("://").map_or("", |x| x.1);
            let r = r.split_once('@').filter(|(user, _)| !user.contains('/')).map_or(r, |x| x.1);
            r.strip_prefix("github.com/").unwrap_or("")
        }
    };
    let r = rest.trim_end_matches('/');
    let r = r.strip_suffix(".git").unwrap_or(r).to_lowercase();
    if repo_ok(&r) { r } else { String::new() }
}

/// git in `dir` with `env`, never a prompt: its trimmed output, or its trimmed stderr as the error.
fn git(dir: &Path, env: &[(String, String)], args: &[&str]) -> Result<String, String> {
    let out = Command::new("git").args(args).current_dir(dir).envs(env.iter().map(|(k, v)| (k, v))).env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null()).output().map_err(|e| format!("git: {e}"))?;
    if out.status.success() { return Ok(String::from_utf8_lossy(&out.stdout).trim().to_string()); }
    let e = String::from_utf8_lossy(&out.stderr).trim().to_string();
    Err(if e.is_empty() { format!("git {} failed", args[0]) } else { e })
}

/// Where a repo folder stands. `unpushed` leaves out the snapshot branches (`relay/…`): a snapshot does not push the
/// branch itself.
fn repo_status(dir: &Path) -> Result<RepoStatus, String> {
    // no optional locks: an agent's git in the same repo never trips over this one's index.lock
    let st = git(dir, &[], &["--no-optional-locks", "status", "--porcelain=v2", "--branch"])?;
    let head = st.lines().find_map(|l| l.strip_prefix("# branch.head ")).unwrap_or("HEAD");
    let unpushed = git(dir, &[], &["rev-list", "--count", "HEAD", "--not", "--exclude=*/relay/*", "--remotes"]).ok().and_then(|n| n.parse().ok()).unwrap_or(0);
    Ok(RepoStatus {
        name: dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        path: dir.to_string_lossy().into(),
        repo: github_repo(&git(dir, &[], &["config", "--get", "remote.origin.url"]).unwrap_or_default()),
        branch: if head == "(detached)" { "HEAD".into() } else { head.into() },
        dirty: st.lines().any(|l| !l.starts_with('#')),
        unpushed,
    })
}
/// A repo folder by name, there and a git repo.
fn repo_dir(name: &str) -> Result<PathBuf, String> {
    if !name_ok(name) { return Err(format!("not a repo folder: {name:?}")); }
    let d = repos_dir().join(name);
    if !d.join(".git").exists() { return Err(format!("no repo {name} in {}", repos_dir().display())); }
    Ok(d)
}

/// GitHub for every device of this server: their device flows under way (`logins`, ns -> (flow, state)).
pub struct Hub { mirror: Arc<Mirror>, host: String, logins: Mutex<HashMap<String, (u64, Github)>>, seq: AtomicU64 }

impl Hub {
    pub fn new(mirror: Arc<Mirror>, host: &str) -> Arc<Hub> { Arc::new(Hub { mirror, host: host.into(), logins: Mutex::default(), seq: AtomicU64::new(1) }) }

    /// The plaintext copy for the credential helper, in the device's working copy beside its roots.
    fn ram(&self, ns: &str) -> PathBuf { let p = self.mirror.work_of(ns).join(".github"); std::path::absolute(&p).unwrap_or(p) }
    /// The token while it is usable: the mirror open and its RAM copy there.
    fn token(&self, ns: &str) -> Option<Token> {
        if !self.mirror.is_open(ns) { return None; }
        serde_json::from_slice(&fs::read(self.ram(ns)).ok()?).ok()
    }
    fn name(&self) -> String { format!("Relay ({})", self.host) }
    fn on(&self, t: &Token) -> Github { Github { state: "on".into(), login: t.login.clone(), since: t.since.clone(), name: self.name(), email: email(&t.login), error: String::new() } }
    fn helper(&self, ns: &str) -> String {
        let exe = std::env::current_exe().unwrap_or_else(|_| "relay-server".into());
        helper_cmd(&exe, &self.ram(ns))
    }

    /// `off` (no token), `locked` (a token, the mirror not open yet) or `on`.
    pub fn status(&self, ns: &str) -> Github {
        if !self.mirror.has_secret(ns, SECRET) { return state("off"); }
        if !self.mirror.is_open(ns) { return state("locked"); }
        match self.mirror.get_secret(ns, SECRET).and_then(|b| serde_json::from_slice::<Token>(&b.unwrap_or_default()).map_err(|e| e.to_string())) {
            Ok(t) => self.on(&t),
            Err(e) => Github { error: e, ..state("error") },
        }
    }

    /// Start a device flow for this device: GitHub's code for the user. A thread polls GitHub until it is typed,
    /// refused or expired; a new start replaces one under way.
    pub fn login_start(self: &Arc<Self>, ns: &str) -> Result<DeviceCode, String> {
        if !self.mirror.is_open(ns) { return Err(LOCKED.into()); }
        let id = client_id();
        if id.is_empty() { return Err("no GitHub client id in this relay-server: set RELAY_GITHUB_CLIENT_ID".into()); }
        let body = format!("client_id={}&scope={}", percent(&id), percent("repo read:user"));
        let (dc, code) = parse_device(&curl(&format!("{}/login/device/code", base()), &["-d", "@-"], &body)?)?;
        let flow = self.seq.fetch_add(1, Ordering::Relaxed);
        self.logins.lock().unwrap().insert(ns.into(), (flow, state("pending")));
        let (me, ns, every, ttl) = (self.clone(), ns.to_string(), dc.interval, dc.expires_in);
        thread::spawn(move || {
            let end = me.wait(&ns, flow, &id, &code, every, ttl);
            let mut l = me.logins.lock().unwrap();
            if let Some(end) = end.filter(|_| l.get(&ns).is_some_and(|x| x.0 == flow)) { l.insert(ns, (flow, end)); }
        });
        Ok(dc)
    }
    /// Poll GitHub every `every` s for `ttl` s. None once another flow (or a logout) took this one's place.
    fn wait(&self, ns: &str, flow: u64, id: &str, code: &str, mut every: u64, ttl: u64) -> Option<Github> {
        let end = Instant::now() + Duration::from_secs(ttl);
        let body = format!("client_id={}&device_code={}&grant_type={}", percent(id), percent(code), percent("urn:ietf:params:oauth:grant-type:device_code"));
        loop {
            thread::sleep(Duration::from_secs(every));
            if self.logins.lock().unwrap().get(ns).is_none_or(|x| x.0 != flow) { return None; }
            if Instant::now() >= end { return Some(state("expired")); }
            // a network hiccup is asked again at the next round, until the code expires
            let Ok(v) = curl(&format!("{}/login/oauth/access_token", base()), &["-d", "@-"], &body) else { continue };
            match parse_poll(&v) {
                Poll::Pending => {}
                Poll::SlowDown => every += 5,
                Poll::Token(t) => return Some(self.connect(ns, t).unwrap_or_else(|e| Github { error: e, ..state("error") })),
                Poll::Expired => return Some(state("expired")),
                Poll::Denied => return Some(state("denied")),
                Poll::Error(e) => return Some(Github { error: e, ..state("error") }),
            }
        }
    }
    /// The token came: whose it is, then sealed, and the RAM copy for the helper.
    fn connect(&self, ns: &str, token: String) -> Result<Github, String> {
        let user = curl(&format!("{}/user", api()), &["-H", "@-"], &format!("Authorization: Bearer {token}\n"))?;
        let login = user["login"].as_str().filter(|l| !l.is_empty()).ok_or("GitHub: no login for this token")?.to_string();
        let t = Token { token, login, since: date("+%Y-%m-%d") };
        let json = serde_json::to_string(&t).map_err(|e| e.to_string())?;
        self.mirror.put_secret(ns, SECRET, json.as_bytes())?;
        write_private(&self.ram(ns), &json).map_err(|e| e.to_string())?;
        Ok(self.on(&t))
    }
    /// Where this device's flow stands: `pending`, `expired`, `denied`, `error`, or else the status.
    pub fn login_poll(&self, ns: &str) -> Github {
        match self.logins.lock().unwrap().get(ns) { Some((_, g)) if g.state != "on" => g.clone(), _ => self.status(ns) }
    }
    /// The token gone here: sealed, its RAM copy and any flow under way. (It stays valid on GitHub until revoked there.)
    pub fn logout(&self, ns: &str) {
        self.logins.lock().unwrap().remove(ns);
        self.mirror.remove_secret(ns, SECRET);
        fs::remove_file(self.ram(ns)).ok();
    }
    /// After an unlock: the RAM copy from the sealed token, when it is not there yet (a restart emptied the RAM disk).
    pub fn materialise(&self, ns: &str) {
        if self.ram(ns).exists() || !self.mirror.has_secret(ns, SECRET) { return; }
        if let Ok(Some(b)) = self.mirror.get_secret(ns, SECRET) { write_private(&self.ram(ns), &String::from_utf8_lossy(&b)).ok(); }
    }

    /// What an agent of this device gets for git: the helper and the identity, while its token is usable.
    pub fn agent_env(&self, ns: &str) -> Vec<(String, String)> {
        match self.token(ns) { Some(t) => git_env(Some(&self.helper(ns)), Some((&self.name(), &email(&t.login)))), None => vec![] }
    }
    /// The same for the server's own git; without a token no helper at all and git's own identity.
    fn env(&self, ns: &str) -> Vec<(String, String)> {
        let t = self.token(ns);
        let who = t.as_ref().map(|t| (self.name(), email(&t.login)));
        git_env(t.as_ref().map(|_| self.helper(ns)).as_deref(), who.as_ref().map(|(n, e)| (n.as_str(), e.as_str())))
    }

    /// Every git repo in the repos folder.
    pub fn repos(&self) -> Vec<RepoStatus> {
        let mut v: Vec<RepoStatus> = fs::read_dir(repos_dir()).into_iter().flatten().flatten().map(|e| e.path())
            .filter(|p| p.join(".git").exists()).filter_map(|p| repo_status(&p).ok()).collect();
        v.sort_by(|a, b| a.name.cmp(&b.name));
        v
    }
    /// `owner/repo` from GitHub in `<repos>/<repo>`: cloned when missing, fetched when there (offline it is used as it
    /// is), refused when that folder holds something else.
    pub fn ensure(&self, ns: &str, repo: &str) -> Result<RepoStatus, String> {
        if !repo_ok(repo) { return Err(format!("not a GitHub repo: {repo:?} (owner/repo)")); }
        let name = repo.split_once('/').map_or(repo, |x| x.1);
        let (root, dir) = (repos_dir(), repos_dir().join(name));
        let env = self.env(ns);
        if dir.exists() {
            let have = if dir.join(".git").exists() { github_repo(&git(&dir, &[], &["config", "--get", "remote.origin.url"]).unwrap_or_default()) } else { String::new() };
            if have != repo.to_lowercase() { return Err(format!("{} is there already with another origin ({})", dir.display(), if have.is_empty() { "none" } else { &have })); }
            git(&dir, &env, &["fetch", "--quiet", "origin"]).ok();
            return repo_status(&dir);
        }
        fs::create_dir_all(&root).map_err(|e| format!("{}: {e}", root.display()))?;
        let url = format!("https://github.com/{repo}.git");
        git(&root, &env, &["clone", "--quiet", &url, name]).map_err(|e| if self.token(ns).is_none() { format!("connect this machine to GitHub first: {e}") } else { e })?;
        repo_status(&dir)
    }
    /// Push the branch checked out in `name`, setting its upstream on origin when it has none.
    pub fn push(&self, ns: &str, name: &str) -> Result<RepoStatus, String> {
        let dir = repo_dir(name)?;
        let env = self.env(ns);
        if git(&dir, &[], &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).is_ok() { git(&dir, &env, &["push", "--quiet"])?; }
        else { git(&dir, &env, &["push", "--quiet", "-u", "origin", "HEAD"])?; }
        repo_status(&dir)
    }
    /// The work in `name` (commits, changes, new files, not what .gitignore leaves out) as one commit on top of HEAD,
    /// force-pushed to `branch`. Built in an index of its own, so the working tree and the index stay as they are.
    pub fn snapshot(&self, ns: &str, name: &str, branch: &str) -> Result<Snapshot, String> {
        let dir = repo_dir(name)?;
        if !branch.starts_with("relay/") || git(&dir, &[], &["check-ref-format", "--branch", branch]).is_err() {
            return Err(format!("not a snapshot branch: {branch:?} (relay/…)"));
        }
        let index = std::env::temp_dir().join(format!("relay-snapshot-{}-{}.index", std::process::id(), self.seq.fetch_add(1, Ordering::Relaxed)));
        let mut env = self.env(ns);
        env.push(("GIT_INDEX_FILE".into(), index.to_string_lossy().into()));
        let res = (|| {
            let head = git(&dir, &[], &["rev-parse", "--verify", "-q", "HEAD^{commit}"]).ok();
            if head.is_some() { git(&dir, &env, &["read-tree", "HEAD"])?; }
            git(&dir, &env, &["add", "-A"])?;
            let tree = git(&dir, &env, &["write-tree"])?;
            let msg = format!("Relay snapshot {} {}", self.host, date("+%Y-%m-%d %H:%M"));
            let mut args = vec!["commit-tree", tree.as_str(), "-m", msg.as_str()];
            if let Some(h) = &head { args.extend(["-p", h.as_str()]); }
            let commit = git(&dir, &env, &args)?;
            git(&dir, &env, &["push", "--quiet", "--force", "origin", &format!("{commit}:refs/heads/{branch}")])?;
            Ok(Snapshot { branch: branch.into(), commit })
        })();
        fs::remove_file(&index).ok();
        res
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn device_flow_answers() {
        let (dc, code) = parse_device(&json!({"device_code": "d1", "user_code": "ABCD-1234", "verification_uri": "https://github.com/login/device", "expires_in": 899, "interval": 5})).unwrap();
        assert_eq!((dc.user_code.as_str(), dc.expires_in, dc.interval, code.as_str()), ("ABCD-1234", 899, 5, "d1"));
        assert!(parse_device(&json!({"error": "unauthorized_client", "error_description": "Device flow is not enabled"})).unwrap_err().contains("not enabled"));
        assert!(parse_device(&json!({})).is_err());
        assert_eq!(parse_poll(&json!({"error": "authorization_pending"})), Poll::Pending);
        assert_eq!(parse_poll(&json!({"error": "slow_down", "interval": 10})), Poll::SlowDown);
        assert_eq!(parse_poll(&json!({"access_token": "gho_x", "token_type": "bearer"})), Poll::Token("gho_x".into()));
        assert_eq!(parse_poll(&json!({"error": "expired_token"})), Poll::Expired);
        assert_eq!(parse_poll(&json!({"error": "access_denied"})), Poll::Denied);
        assert_eq!(parse_poll(&json!({"error": "incorrect_device_code", "error_description": "bad code"})), Poll::Error("bad code".into()));
    }

    #[test]
    fn names_repos_and_remotes() {
        for ok in ["acme/shop", "acme-co/shop.web", "a1/x_y-z"] { assert!(repo_ok(ok), "{ok}"); }
        for bad in ["acme", "acme/", "/shop", "acme/.hidden", "acme/..", "ac.me/shop", "acme/shop/x", "acme/sh op", "../shop"] { assert!(!repo_ok(bad), "{bad}"); }
        assert!(name_ok("shop") && !name_ok("..") && !name_ok("a/b") && !name_ok(".git") && !name_ok(""));
        for url in ["https://github.com/Acme/Shop.git", "https://github.com/acme/shop", "git@github.com:acme/shop.git", "ssh://git@github.com/acme/shop.git", "https://user@github.com/acme/shop/"] {
            assert_eq!(github_repo(url), "acme/shop", "{url}");
        }
        for url in ["https://gitlab.com/acme/shop.git", "https://github.com.evil.example/acme/shop", "/srv/git/shop.git", ""] { assert_eq!(github_repo(url), "", "{url}"); }
    }

    #[test]
    fn the_helper_answers_for_github_only() {
        let f = std::env::temp_dir().join(format!("relay-cred-{}", std::process::id()));
        fs::write(&f, r#"{"token":"gho_abc","login":"octo","since":"2026-10-13"}"#).unwrap();
        assert_eq!(credential(&f, "get", "protocol=https\nhost=github.com\npath=acme/shop.git\n\n"), "username=x-access-token\npassword=gho_abc\n");
        assert_eq!(credential(&f, "get", "protocol=https\nhost=gitlab.com\n\n"), "");
        assert_eq!(credential(&f, "get", "protocol=http\nhost=github.com\n\n"), "");
        assert_eq!(credential(&f, "store", "protocol=https\nhost=github.com\npassword=x\n"), "");
        fs::remove_file(&f).unwrap();
        assert_eq!(credential(&f, "get", "protocol=https\nhost=github.com\n"), "", "no token, no answer");
    }

    #[test]
    fn git_env_carries_the_helper_not_the_token() {
        let h = helper_cmd(Path::new("/opt/it's/relay-server"), Path::new("/w/abc/.github"));
        assert_eq!(h, r"!'/opt/it'\''s/relay-server' git-credential '/w/abc/.github'");
        assert!(helper_cmd(Path::new("/Applications/Relay.app/Contents/MacOS/relay"), Path::new("/w")).contains("relay' --relay-server git-credential"));
        let env = git_env(Some(&h), Some(("Relay (box)", "octo@users.noreply.github.com")));
        let get = |k: &str| env.iter().find(|(x, _)| x == k).map(|(_, v)| v.as_str());
        assert_eq!(get("GIT_CONFIG_COUNT"), Some("4"));
        assert_eq!((get("GIT_CONFIG_KEY_0"), get("GIT_CONFIG_VALUE_0")), (Some("credential.helper"), Some("")));
        assert_eq!((get("GIT_CONFIG_KEY_1"), get("GIT_CONFIG_VALUE_1")), (Some("credential.https://github.com.helper"), Some(h.as_str())));
        assert_eq!(get("GIT_CONFIG_VALUE_2"), Some("Relay (box)"));
        assert_eq!(get("GIT_TERMINAL_PROMPT"), Some("0"));
        assert!(env.iter().all(|(k, v)| !k.contains("TOKEN") && !v.contains("gho_")));
        assert_eq!(git_env(None, None).len(), 4, "only the reset and no prompt");
    }
}
