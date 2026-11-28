// Aikido's access token: the API client in the keychain (vault-app.aikido, client_id and client_secret) exchanged at
// Aikido's token endpoint (OAuth2 client credentials), kept in this process until shortly before it expires. The client
// and the token go only to curl over stdin (never an argument, visible in the process list) and only to Aikido's hosts;
// neither ever goes back to a webview or into a log. integration_call uses it like Cloud Build uses gcloud's token.

use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use integration_aikido as aikido;
use serde_json::Value;

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
