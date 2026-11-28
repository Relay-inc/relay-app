// Aikido's access token: the API client in the keychain (vault-app.aikido, client_id and client_secret) exchanged at
// Aikido's token endpoint (OAuth2 client credentials), kept in this process until shortly before it expires. The client
// and the token go only to curl over stdin (never an argument, visible in the process list) and only to Aikido's hosts;
// neither ever goes back to a webview or into a log. integration_call uses it like Cloud Build uses gcloud's token.

use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use integration_aikido as aikido;
use serde_json::{json, Value};

use crate::providers::{self, curl_quote};
use crate::trc_v;

/// (region and client id the token is for, the token, when it stops being used)
static CACHE: Mutex<Option<(String, String, Instant)>> = Mutex::new(None);

/// Drop the cached token: the client was saved again or removed.
pub fn forget() { *CACHE.lock().unwrap() = None; }

/// An access token for the saved client and region, from the cache while it is fresh.
pub fn token(cfg: &Value) -> Result<String, String> {
    let p = &aikido::PROVIDER;
    let secrets = providers::token(p).ok_or_else(|| trc_v("err.no_token", p.name))?;
    let [id, secret] = &secrets[..] else { return Err(trc_v("err.no_token", p.name)) };
    let key = format!("{}|{id}", cfg["region"].as_str().unwrap_or(""));
    if let Some((k, t, until)) = CACHE.lock().unwrap().as_ref() {
        if *k == key && Instant::now() < *until { return Ok(t.clone()); }
    }
    let mut last = String::new();
    for url in aikido::token_urls(cfg) {
        match exchange(&url, id, secret) {
            Ok((t, secs)) => {
                // a minute early, so a call never goes out with a token that expires on the way
                let keep = Duration::from_secs(secs.saturating_sub(60).clamp(60, 24 * 3600));
                *CACHE.lock().unwrap() = Some((key, t.clone(), Instant::now() + keep));
                return Ok(t);
            }
            Err(e) => last = e,
        }
    }
    Err(last)
}

fn exchange(url: &str, id: &str, secret: &str) -> Result<(String, u64), String> {
    let p = &aikido::PROVIDER;
    let mut conf = format!("url = {}\nrequest = POST\n", curl_quote(url));
    for h in aikido::token_headers(id, secret) { conf += &format!("header = {}\n", curl_quote(&h)); }
    conf += &format!("data-binary = {}\n", curl_quote(aikido::TOKEN_BODY));
    let mut ch = Command::new("/usr/bin/curl").args(["-sS", "--proto", "=https", "--max-time", "20", "-K", "-", "-w", "\n%{http_code}"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    ch.stdin.take().unwrap().write_all(conf.as_bytes()).map_err(|e| e.to_string())?;
    let o = ch.wait_with_output().map_err(|e| e.to_string())?;
    if !o.status.success() { return Err(trc_v("err.down", String::from_utf8_lossy(&o.stderr).trim()).replace("{p}", p.name)); }
    let out = String::from_utf8_lossy(&o.stdout);
    let (text, code) = out.rsplit_once('\n').unwrap_or(("", &out));
    let v: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    match aikido::parse_token(&v) {
        Some(t) if code.starts_with('2') => Ok(t),
        _ => Err(aikido::token_error(code, &v)),
    }
}

// ---------- `relay aikido.status` and `relay aikido.match`: what the other actions (packages/integration-aikido) cannot
// do alone, as they need the token exchange above and the vault's project links. Reads only, the same path as the app
// (providers::call_with, so the allowlist), and nothing here prints the client or the token: only yes/no for the client,
// and an error is Aikido's one line, which never carries what was sent.

const REPOS: &str = "/repositories/code?per_page=200";
fn read_repos(cfg: &Value, token: String) -> Result<Value, String> { providers::call_with(&aikido::PROVIDER, cfg, "GET", REPOS, None, &[token]) }

/// Is Aikido on, which region, is a client stored, does the exchange work now, how many repos does the workspace have.
pub fn status(cfg: &Value) -> Value {
    let stored = providers::token(&aikido::PROVIDER).is_some();
    let token = if stored { token(cfg) } else { Err("no client stored".to_string()) };
    let repos = token.as_ref().ok().map(|t| read_repos(cfg, t.clone()));
    status_of(cfg, stored, token.map(drop), repos)
}
fn status_of(cfg: &Value, stored: bool, token: Result<(), String>, repos: Option<Result<Value, String>>) -> Value {
    let n = repos.as_ref().and_then(|r| r.as_ref().ok()).map(|v| aikido::records(v).len());
    json!({
        "on": cfg["on"] == true,
        "region": cfg["region"],
        "client_stored": stored,
        "token": match &token { Ok(()) => "ok".to_string(), Err(e) => format!("error: {e}") },
        // one page of 200 is what is read
        "repos": n.map(|n| if n >= 200 { json!("200+") } else { json!(n) }),
        "repos_error": repos.and_then(Result::err),
    })
}

/// The linked GitHub repos of a project (or of every project) beside Aikido's GitHub repos with their raw URL.
// ponytail: no matching here. The rule (src/domain/aikido/rules.ts matchRepos, still changing) stays in the app, so
// there is one copy; this shows both sides to compare by eye. A shared fixture and a port if it settles.
pub fn matched(s: &Value, args: &Value) -> Result<Value, String> {
    let cfg = &s["integrations"]["aikido"];
    let all = crate::project_repo_map(s);
    let linked: Vec<(String, Vec<String>)> = match board_core::arg(args, "project") {
        Some(p) => vec![(p.clone(), all.get(&p).cloned().ok_or_else(|| format!("no GitHub repos linked to '{p}' (Settings › Projects), or no such vault project"))?)],
        None => all.into_iter().collect(),
    };
    let answer = read_repos(cfg, token(cfg)?)?;
    Ok(match_view(&linked, &answer))
}
fn match_view(linked: &[(String, Vec<String>)], answer: &Value) -> Value {
    let repos = aikido::records(answer);
    json!({
        "matching": "runs in the app (src/domain/aikido/rules.ts matchRepos): compare each linked repo with the urls below",
        "projects": linked.iter().map(|(p, r)| json!({ "project": p, "linked": r })).collect::<Vec<_>>(),
        "aikido_repos_read": repos.len(),
        "aikido_github": repos.iter().filter(|r| r["provider"] == "github").map(|r| json!({ "id": r["id"], "name": r["name"], "url": r["url"] })).collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn status_says_yes_or_no_and_never_the_client() {
        let cfg = json!({ "on": true, "region": "eu", "client_id": "AIK_CLIENT_x", "client_secret": "s3cret" });
        let ok = status_of(&cfg, true, Ok(()), Some(Ok(json!([{ "id": 1 }, { "id": 2 }]))));
        assert_eq!(ok, json!({ "on": true, "region": "eu", "client_stored": true, "token": "ok", "repos": 2, "repos_error": null }));
        assert_eq!(status_of(&cfg, true, Ok(()), Some(Ok(json!(vec![json!({}); 200]))))["repos"], "200+");
        let none = status_of(&json!({ "on": false, "region": "eu" }), false, Err("no client stored".into()), None);
        assert_eq!(none, json!({ "on": false, "region": "eu", "client_stored": false, "token": "error: no client stored", "repos": null, "repos_error": null }));
        let refused = status_of(&cfg, true, Err(aikido::token_error("400", &json!({ "error_description": "bad s3cret" }))), None);
        let text = [ok.to_string(), none.to_string(), refused.to_string()].concat();
        assert!(!text.contains("s3cret") && !text.contains("AIK_CLIENT"));
    }
    #[test]
    fn match_shows_both_sides_raw() {
        let answer = json!([
            { "id": 101, "name": "orchard-web", "provider": "github", "url": "https://github.com/Acme/orchard-web.git", "token": "s3cret" },
            { "id": 102, "name": "orchard-api", "provider": "gitlab", "url": "https://gitlab.com/acme/orchard-api" },
        ]);
        let out = match_view(&[("Orchard".into(), vec!["acme/orchard-web".into()])], &answer);
        assert_eq!(out["projects"], json!([{ "project": "Orchard", "linked": ["acme/orchard-web"] }]));
        assert_eq!(out["aikido_github"], json!([{ "id": 101, "name": "orchard-web", "url": "https://github.com/Acme/orchard-web.git" }]));
        assert_eq!(out["aikido_repos_read"], 2);
        assert!(!out.to_string().contains("s3cret"));
    }
    #[test]
    fn every_aikido_read_stays_on_the_allowlist() {
        let c = json!({ "region": "eu" });
        assert!((aikido::PROVIDER.url)(&c, "GET", REPOS, &None).is_some());
        assert!((aikido::PROVIDER.url)(&c, "GET", "/repositories/code/101/scan", &None).is_none());
        assert!((aikido::PROVIDER.url)(&c, "POST", REPOS, &None).is_none());
    }
}
