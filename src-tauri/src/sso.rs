// SSO before a join (docs/workspaces.md, SSO): when an invite's server has an SSO entry on its organisation list,
// this Mac signs in in the system browser (OpenID Connect, authorisation code with PKCE, a loopback redirect on
// 127.0.0.1, no client secret) and hands the ID token to the join, where the server checks it. The token never goes
// anywhere else and is not kept: the join uses it once.

use base64::Engine;
use relay_remote::members::Sso;
use relay_remote::tls::random_secret;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

type St<'a> = tauri::State<'a, crate::App>;
/// How long the browser has for the sign-in.
const WAIT: Duration = Duration::from_secs(300);
/// Bumped by `sso_cancel`: a login that started before it stops waiting.
static LOGIN: AtomicU64 = AtomicU64::new(0);

fn b64(b: &[u8]) -> String { base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b) }
fn sha256(b: &[u8]) -> Vec<u8> { relay_remote::tls::unhex(&relay_remote::sync::sha256_hex(b)).unwrap_or_default() }

/// What the invite link's server asks to sign in with before a join: {sso: {issuer, client, domains, required} | null}.
#[tauri::command]
pub async fn sso_check(link: String) -> Result<Value, String> {
    let sso = tauri::async_runtime::spawn_blocking(move || relay_remote::client::sso_info(&link)).await.map_err(|e| e.to_string())??;
    Ok(json!({"sso": sso}))
}

/// Sign in for a join with the invite link `link`: the browser opens on the issuer's sign-in, the redirect comes back
/// to this Mac. {id_token, salt, email, name}: the join sends the first two, the rest is for the confirmation (read
/// from the token without checking it: the server checks it).
#[tauri::command]
pub async fn sso_login(state: St<'_>, link: String) -> Result<Value, String> {
    let me = state.machines.id.clone();
    let line = relay_remote::proto::PairLine::parse(&link).filter(relay_remote::proto::PairLine::is_invite).ok_or("not an invite link")?;
    let gen = LOGIN.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn_blocking(move || {
        let sso = relay_remote::client::sso_info(&link)?.ok_or("this server has no SSO")?;
        // what a server not trusted yet says: only what an organisation list would take, before a browser opens on it
        if !sso.valid() { return Err("SSO: the server's sign-in settings are not valid".into()); }
        let conf = get(&relay_remote::members::discovery(&sso.issuer))?;
        let https = |k: &str| conf[k].as_str().filter(|u| u.starts_with("https://")).map(String::from).ok_or(format!("SSO: the issuer has no {k}"));
        let (auth, token_url) = (https("authorization_endpoint")?, https("token_endpoint")?);
        let salt = relay_remote::sync::sha256_hex(random_secret().as_bytes());
        let nonce = relay_remote::org::sso_nonce(&line.fp, &me.fingerprint(), &salt);
        let (verifier, state) = (format!("{}{}", random_secret(), random_secret()), random_secret());
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let redirect = format!("http://{}:{}", loopback(&sso), listener.local_addr().map_err(|e| e.to_string())?.port());
        let url = auth_url(&auth, &sso, &redirect, &b64(&sha256(verifier.as_bytes())), &state, &nonce)?;
        tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| e.to_string())?;
        let code = catch(&listener, &state, || LOGIN.load(Ordering::SeqCst) != gen)?;
        let form = [("grant_type", "authorization_code"), ("code", &code), ("redirect_uri", &redirect), ("client_id", &sso.client), ("code_verifier", &verifier)];
        let body = url::form_urlencoded::Serializer::new(String::new()).extend_pairs(form).finish();
        let t = post(&token_url, &body)?;
        let id_token = t["id_token"].as_str().ok_or_else(|| format!("SSO: no ID token: {}", t["error_description"].as_str().or(t["error"].as_str()).unwrap_or("the issuer sent none")))?.to_string();
        let claims = id_token.split('.').nth(1).and_then(|p| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(p).ok()).and_then(|b| serde_json::from_slice::<Value>(&b).ok()).unwrap_or_default();
        // Entra: the sign-in name, as the server keeps it (oidc.rs): its `email` is optional and not checked
        let email = if relay_remote::members::entra_tenant(&sso.issuer).is_some() { &claims["preferred_username"] } else { &claims["email"] };
        Ok(json!({"id_token": id_token, "salt": salt, "email": email, "name": claims["name"]}))
    }).await.map_err(|e| e.to_string())?
}
/// Stop waiting for the browser.
#[tauri::command]
pub fn sso_cancel() { LOGIN.fetch_add(1, Ordering::SeqCst); }

/// The redirect's host. Entra matches `http://localhost` whatever the port and does not say so of `127.0.0.1`, which its
/// portal only takes through the manifest: `localhost` there. The listener stays on 127.0.0.1, which the system resolves
/// localhost to (a browser that tries ::1 first goes on to it).
fn loopback(sso: &Sso) -> &'static str { if relay_remote::members::entra_tenant(&sso.issuer).is_some() { "localhost" } else { "127.0.0.1" } }

/// The sign-in URL: authorisation code with PKCE (S256), the nonce, and the domain as a hint when there is one.
fn auth_url(auth: &str, sso: &Sso, redirect: &str, challenge: &str, state: &str, nonce: &str) -> Result<String, String> {
    let mut u = url::Url::parse(auth).ok().filter(|u| u.scheme() == "https").ok_or("SSO: the issuer's sign-in address is not https")?;
    u.query_pairs_mut().extend_pairs([("client_id", sso.client.as_str()), ("redirect_uri", redirect), ("response_type", "code"), ("scope", "openid email profile"),
        ("code_challenge", challenge), ("code_challenge_method", "S256"), ("state", state), ("nonce", nonce), ("prompt", "select_account")]);
    // Google's `hd`: the account chooser shows that domain's accounts (a hint only, the server checks the token's)
    if let [d] = sso.domains.as_slice() { u.query_pairs_mut().append_pair("hd", d); }
    Ok(u.into())
}

/// The browser's redirect to the loopback listener: its code when `state` matches. Another request (a favicon) is
/// answered and waited past; `stop` ends the wait.
fn catch(l: &TcpListener, state: &str, stop: impl Fn() -> bool) -> Result<String, String> {
    l.set_nonblocking(true).map_err(|e| e.to_string())?;
    let until = Instant::now() + WAIT;
    while Instant::now() < until {
        if stop() { return Err("SSO: sign-in cancelled".into()); }
        let Ok((mut s, _)) = l.accept() else { std::thread::sleep(Duration::from_millis(150)); continue };
        s.set_nonblocking(false).ok();
        s.set_read_timeout(Some(Duration::from_secs(5))).ok();
        let mut first = String::new();
        BufReader::new(&s).read_line(&mut first).ok();
        let path = first.split_whitespace().nth(1).unwrap_or("/");
        let q: std::collections::HashMap<String, String> = url::Url::parse(&format!("http://127.0.0.1{path}")).map(|u| u.query_pairs().into_owned().collect()).unwrap_or_default();
        if q.is_empty() { s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").ok(); continue; }
        let res = match (q.get("state"), q.get("code"), q.get("error")) {
            (Some(st), Some(code), None) if st == state => Ok(code.clone()),
            (Some(st), _, Some(e)) if st == state => Err(format!("SSO: {}", q.get("error_description").unwrap_or(e))),
            _ => Err("SSO: a sign-in answer that is not this one's".to_string()),
        };
        let page = if res.is_ok() { "Signed in. You can close this tab and go back to Relay." } else { "The sign-in did not work. Go back to Relay and try again." };
        write!(s, "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}", page.len()).ok();
        return res;
    }
    Err("SSO: the sign-in took too long".into())
}

/// One request with curl (as calendar.rs), https only: the body on stdin, off the command line.
fn curl(url: &str, args: &[&str], body: &str) -> Result<Value, String> {
    let mut ch = Command::new("curl").args(["-sS", "--proto", "=https", "--max-time", "20", "-H", "Accept: application/json"]).args(args).arg("--url").arg(url)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("curl: {e}"))?;
    if let Some(mut i) = ch.stdin.take() { i.write_all(body.as_bytes()).ok(); }
    let out = ch.wait_with_output().map_err(|e| format!("curl: {e}"))?;
    if !out.status.success() { return Err(format!("SSO: the issuer did not answer: {}", String::from_utf8_lossy(&out.stderr).trim())); }
    serde_json::from_slice(&out.stdout).map_err(|e| format!("SSO: {e}"))
}
fn get(url: &str) -> Result<Value, String> { curl(url, &["--fail"], "") }
// the token endpoint answers an error with JSON and a 400: read it rather than failing on the status
fn post(url: &str, form: &str) -> Result<Value, String> { curl(url, &["-H", "Content-Type: application/x-www-form-urlencoded", "--data-binary", "@-"], form) }

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    fn sso() -> Sso { Sso { issuer: "https://accounts.google.com".into(), client: "c1".into(), domains: vec!["example.com".into()], required: true } }

    #[test]
    fn the_sign_in_url_asks_a_code_with_pkce_and_the_nonce() {
        let u = url::Url::parse(&auth_url("https://accounts.google.com/o/oauth2/v2/auth", &sso(), "http://127.0.0.1:5000", "ch", "st", "no").unwrap()).unwrap();
        assert!(auth_url("http://accounts.google.com/auth", &sso(), "x", "c", "s", "n").is_err());
        let q: std::collections::HashMap<String, String> = u.query_pairs().into_owned().collect();
        for (k, v) in [("client_id", "c1"), ("redirect_uri", "http://127.0.0.1:5000"), ("response_type", "code"), ("code_challenge", "ch"), ("code_challenge_method", "S256"), ("state", "st"), ("nonce", "no"), ("hd", "example.com")] {
            assert_eq!(q.get(k).map(String::as_str), Some(v), "{k}");
        }
        assert!(!q.contains_key("client_secret"));
        // Entra: no domain hint, and the redirect on localhost
        let entra = Sso { issuer: "https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0".into(), domains: vec![], ..sso() };
        let u = url::Url::parse(&auth_url("https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/oauth2/v2.0/authorize", &entra, "http://localhost:5000", "ch", "st", "no").unwrap()).unwrap();
        assert!(!u.query_pairs().any(|(k, _)| k == "hd") && u.query_pairs().any(|(k, v)| k == "prompt" && v == "select_account"));
        assert_eq!((loopback(&entra), loopback(&sso())), ("localhost", "127.0.0.1"));
        // PKCE S256 as RFC 7636's appendix B example
        assert_eq!(b64(&sha256(b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn the_redirect_gives_the_code_only_for_this_sign_in() {
        let hit = |paths: &'static [&'static str], state: &'static str| {
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = l.local_addr().unwrap().port();
            let t = std::thread::spawn(move || for p in paths {
                let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
                write!(s, "GET {p} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
                let mut out = String::new();
                s.read_to_string(&mut out).ok();
            });
            let r = catch(&l, state, || false);
            t.join().unwrap();
            r
        };
        assert_eq!(hit(&["/favicon.ico", "/?state=s1&code=abc"], "s1").unwrap(), "abc");
        assert!(hit(&["/?state=other&code=abc"], "s1").unwrap_err().contains("not this one"));
        assert!(hit(&["/?state=s1&error=access_denied"], "s1").unwrap_err().contains("access_denied"));
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        assert!(catch(&l, "s", || true).unwrap_err().contains("cancelled"));
    }
}
