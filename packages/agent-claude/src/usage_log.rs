//! Claude Code's usage, from two sources.
//! - Plan limits: the endpoint Claude Code's /usage reads (api.anthropic.com/api/oauth/usage), with the
//!   CLI's own OAuth login from the keychain. Read only: the token is never refreshed here (that would
//!   rotate it under the CLI), an expired or missing login shows as "unavailable". Token over curl's
//!   stdin, never as an argument. The app calls it at most once a minute, the endpoint is rate limited.
//! - Tokens: every assistant message in ~/.claude/projects/**/*.jsonl, read incrementally (each file
//!   from where the last read stopped), deduplicated by message and request id, priced at API list
//!   prices as an estimate. Only files touched in the last 8 days are read.

use agent_core::usage::{now_ms, parse_ts, Limits, Record, Tail, Window};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;

// ---------- prices, USD per million tokens: input, output, cache read (cache writes are 1.25x input
// for 5 minutes, 2x for an hour). Model ids by prefix, the most specific first.
const PRICES: &[(&str, f64, f64, Option<f64>)] = &[
    ("claude-fable-5-1", 10.0, 50.0, Some(0.25)), ("claude-mythos-5-1", 10.0, 50.0, Some(0.25)),
    ("claude-fable-5", 10.0, 50.0, None), ("claude-mythos-5", 10.0, 50.0, None),
    ("claude-opus-5-5", 4.0, 20.0, Some(0.2)), ("claude-opus-5", 5.0, 25.0, None),
    ("claude-opus-4-8", 5.0, 25.0, None), ("claude-opus-4-7", 5.0, 25.0, None), ("claude-opus-4-6", 5.0, 25.0, None), ("claude-opus-4-5", 5.0, 25.0, None),
    ("claude-opus-4", 15.0, 75.0, None),
    ("claude-sonnet-5", 2.0, 10.0, None), ("claude-sonnet-4", 3.0, 15.0, None),
    ("claude-haiku-4-5", 1.0, 5.0, None), ("claude-3-5-haiku", 0.8, 4.0, None),
];
fn price(model: &str) -> Option<(f64, f64, f64)> {
    PRICES.iter().find(|p| model.starts_with(p.0)).map(|&(_, i, o, r)| (i, o, r.unwrap_or(i * 0.1)))
}

/// One assistant message: when, which model, where, and its tokens.
#[derive(Clone, Debug, PartialEq)]
pub struct Rec { pub at: i64, pub model: String, pub dir: String, pub sid: String,
    pub input: u64, pub output: u64, pub cache_read: u64, pub write_5m: u64, pub write_1h: u64 }

impl Rec {
    pub fn cost(&self) -> Option<f64> {
        let (i, o, r) = price(&self.model)?;
        Some((self.input as f64 * i + self.output as f64 * o + self.cache_read as f64 * r
            + self.write_5m as f64 * i * 1.25 + self.write_1h as f64 * i * 2.0) / 1e6)
    }
}

/// The usage records in transcript lines. `seen` holds message ids already counted: Claude Code writes
/// one line per content block, each with the whole message's usage, and forks copy earlier messages.
pub fn parse_lines(text: &str, dir: &str, file_sid: &str, since: i64, seen: &mut HashSet<String>) -> Vec<Rec> {
    let mut out = vec![];
    for line in text.lines() {
        if !line.contains("\"usage\"") || !line.contains("\"assistant\"") { continue; } // cheap skip before parsing
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if v["type"] != "assistant" { continue; }
        let (m, u) = (&v["message"], &v["message"]["usage"]);
        let Some(at) = v["timestamp"].as_str().and_then(parse_ts) else { continue };
        if !u.is_object() || at < since { continue; }
        let model = m["model"].as_str().unwrap_or("unknown");
        let n = |k: &str| u[k].as_u64().unwrap_or(0);
        let (input, output, cache_read, write) = (n("input_tokens"), n("output_tokens"), n("cache_read_input_tokens"), n("cache_creation_input_tokens"));
        if model == "<synthetic>" || input + output + cache_read + write == 0 { continue; }
        let id = format!("{}:{}", m["id"].as_str().unwrap_or(""), v["requestId"].as_str().unwrap_or(""));
        if id != ":" && !seen.insert(id) { continue; }
        let write_1h = u["cache_creation"]["ephemeral_1h_input_tokens"].as_u64().unwrap_or(0).min(write);
        out.push(Rec { at, model: model.to_string(), dir: dir.to_string(), sid: v["sessionId"].as_str().unwrap_or(file_sid).to_string(),
            input, output, cache_read, write_5m: write - write_1h, write_1h });
    }
    out
}

static TAIL: Mutex<Option<Tail<Rec>>> = Mutex::new(None);

/// What the transcripts under each root (one per account) gained since the last call, and every record since
/// `since`; the vault's own are the ones in its folder `vault_dir` (its slug). A conversation moved to another
/// account has its transcript in both: `seen` counts each message once.
pub fn records(roots: &[std::path::PathBuf], vault_dir: &str, since: i64) -> Vec<Record> {
    let mut t = TAIL.lock().unwrap();
    let t = t.get_or_insert_with(Tail::default);
    for root in roots { refresh(t, root, since); }
    t.records().into_iter().map(|r| to_record(r, vault_dir)).collect()
}
fn refresh(t: &mut Tail<Rec>, root: &Path, since: i64) {
    t.refresh(root, "jsonl", since, |r| r.at, |p, text, seen| {
        let dir = p.strip_prefix(root).ok().and_then(|r| r.components().next()).map(|c| c.as_os_str().to_string_lossy().to_string()).unwrap_or_default();
        // a subagent's transcript lives in <session>/subagents/, its usage counts for the session
        let sid = p.parent().and_then(|d| if d.ends_with("subagents") { d.parent() } else { None }).and_then(|d| d.file_name())
            .or_else(|| p.file_stem()).map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        parse_lines(text, &dir, &sid, since, seen)
    });
}
fn to_record(r: Rec, vault_dir: &str) -> Record {
    Record { at: r.at, cost: r.cost(), vault: !vault_dir.is_empty() && r.dir == vault_dir, session: r.sid, model: r.model,
        input: r.input, output: r.output, cache_read: r.cache_read, cache_write: r.write_5m + r.write_1h }
}

/// The keychain item the claude CLI keeps its login in: one per config folder, the folder's sha256 in the name
/// when CLAUDE_CONFIG_DIR is set (`account`), none for its own.
pub fn keychain_service(account: &str) -> String {
    use sha2::{Digest, Sha256};
    if account.is_empty() { return "Claude Code-credentials".into(); }
    let hex: String = Sha256::digest(account.as_bytes()).iter().map(|b| format!("{b:02x}")).collect();
    format!("Claude Code-credentials-{}", &hex[..8])
}
/// The login the claude CLI stored for an account ("" its own folder): the keychain on macOS, a file elsewhere.
pub fn credentials(home: &str, account: &str) -> Option<Value> {
    let dir = if account.is_empty() { format!("{home}/.claude") } else { account.to_string() };
    Command::new("/usr/bin/security").args(["find-generic-password", "-s", &keychain_service(account), "-w"]).stderr(Stdio::null()).output().ok()
        .filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .or_else(|| fs::read_to_string(format!("{dir}/.credentials.json")).ok())
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
}

/// The 5-hour and weekly limits of the claude.ai plan, or why they are unavailable.
pub fn fetch_limits(home: &str, account: &str) -> Limits {
    let fail = |r: &str| Limits::Off(r.into());
    let Some(cred) = credentials(home, account) else { return fail("no-login") };
    let o = &cred["claudeAiOauth"];
    let Some(tok) = o["accessToken"].as_str() else { return fail("no-login") };
    if o["expiresAt"].as_i64().is_some_and(|e| e < now_ms()) { return fail("expired"); }
    let Ok(mut ch) = Command::new("/usr/bin/curl").args(["-sS", "-m", "15", "-w", "\n%{http_code}", "-K", "-"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn() else { return fail("unavailable") };
    let cfg = format!("url = \"https://api.anthropic.com/api/oauth/usage\"\nheader = \"Authorization: Bearer {tok}\"\nheader = \"anthropic-beta: oauth-2025-04-20\"\nheader = \"Accept: application/json\"\n");
    if ch.stdin.take().map(|mut s| s.write_all(cfg.as_bytes())).is_none() { return fail("unavailable"); }
    let Ok(out) = ch.wait_with_output() else { return fail("unavailable") };
    let body = String::from_utf8_lossy(&out.stdout);
    let (body, code) = body.rsplit_once('\n').unwrap_or((&body, ""));
    if code == "401" || code == "403" { return fail("expired"); }
    match serde_json::from_str::<Value>(body) {
        Ok(v) if code == "200" => limits_of(&v, o["subscriptionType"].as_str()),
        _ => fail("unavailable"),
    }
}

/// The endpoint's answer, reduced to the windows the view shows: the session, the week, and weekly limits for one model.
pub fn limits_of(v: &Value, plan: Option<&str>) -> Limits {
    let win = |id: &str, label: &str, name: Option<&str>, w: &Value, pct: &str| w[pct].as_f64().map(|p| Window {
        id: id.into(), label: label.into(), name: name.map(String::from), pct: p, resets: w["resets_at"].as_str().map(String::from) });
    let mut windows: Vec<Window> = [win("session", "limit.session", None, &v["five_hour"], "utilization"), win("weekly", "limit.weekly", None, &v["seven_day"], "utilization")]
        .into_iter().flatten().collect();
    if windows.is_empty() { return Limits::Off("unavailable".into()); }
    // weekly limits for one model (Opus, Sonnet, ...): the newer "limits" list names them
    let scoped: Vec<Window> = v["limits"].as_array().into_iter().flatten().filter(|l| l["kind"] == "weekly_scoped")
        .filter_map(|l| { let n = l["scope"]["model"]["display_name"].as_str()?; win(&format!("weekly:{n}"), "limit.weeklyModel", Some(n), l, "percent") }).collect();
    if scoped.is_empty() {
        for (k, n) in [("seven_day_opus", "Opus"), ("seven_day_sonnet", "Sonnet")] { windows.extend(win(&format!("weekly:{n}"), "limit.weeklyModel", Some(n), &v[k], "utilization")); }
    } else { windows.extend(scoped); }
    Limits::On { plan: plan.map(String::from), windows }
}

#[cfg(test)]
mod tests {
    use super::*;

    // fixtures in Claude Code's transcript format: one line per content block, a subagent file, a fork
    const MAIN: &str = r#"{"type":"user","timestamp":"2026-09-30T08:00:00.000Z","sessionId":"s1","message":{"role":"user","content":"hi"}}
{"type":"assistant","timestamp":"2026-09-30T08:00:05.000Z","sessionId":"s1","requestId":"r1","message":{"id":"m1","model":"claude-opus-5-5","usage":{"input_tokens":10,"output_tokens":100,"cache_read_input_tokens":1000,"cache_creation_input_tokens":200,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":200}}}}
{"type":"assistant","timestamp":"2026-09-30T08:00:06.000Z","sessionId":"s1","requestId":"r1","message":{"id":"m1","model":"claude-opus-5-5","usage":{"input_tokens":10,"output_tokens":100,"cache_read_input_tokens":1000,"cache_creation_input_tokens":200,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":200}}}}
{"type":"assistant","timestamp":"2026-09-28T10:00:00.000Z","sessionId":"s1","requestId":"r0","message":{"id":"m0","model":"claude-sonnet-5-5","usage":{"input_tokens":1000000,"output_tokens":0}}}
{"type":"assistant","timestamp":"2026-09-30T08:01:00.000Z","sessionId":"s1","message":{"id":"m2","model":"<synthetic>","usage":{"input_tokens":0,"output_tokens":0}}}
{"type":"assistant","timestamp":"2026-09-30T09:00:00.000Z","sessionId":"s1","requestId":"r3","message":{"id":"m3","model":"claude-future-9","usage":{"input_tokens":5,"output_tokens":5}}}
not json
"#;
    const SUB: &str = r#"{"type":"assistant","timestamp":"2026-09-30T08:02:00.000Z","sessionId":"s1","requestId":"r4","message":{"id":"m4","model":"claude-haiku-4-5-20251001","usage":{"input_tokens":1000000,"output_tokens":0}}}
"#;
    const OTHER: &str = r#"{"type":"assistant","timestamp":"2026-09-30T07:00:00.000Z","sessionId":"s9","requestId":"r8","message":{"id":"m8","model":"claude-opus-5-5","usage":{"input_tokens":10,"output_tokens":100}}}
{"type":"assistant","timestamp":"2026-09-30T07:30:00+02:00","sessionId":"s9","requestId":"r9","message":{"id":"m9","model":"claude-opus-5-5","usage":{"input_tokens":0,"output_tokens":1000000}}}
"#;
    const TODAY: i64 = 1790726400000; // 2026-09-30T00:00:00Z
    const WEEK: i64 = 1790640000000;  // 2026-09-29T00:00:00Z
    const NOW: i64 = TODAY + 12 * 3600 * 1000;

    #[test]
    fn one_keychain_item_per_account() {
        assert_eq!(keychain_service(""), "Claude Code-credentials");
        let s = keychain_service("/Users/me/.claude-work");
        assert!(s.starts_with("Claude Code-credentials-") && s.len() == 32 && s != keychain_service("/Users/me/.claude-home"));
    }
    #[test]
    fn prices_by_prefix() {
        assert_eq!(price("claude-opus-5-5"), Some((4.0, 20.0, 0.2)));
        assert_eq!(price("claude-haiku-4-5-20251001"), Some((1.0, 5.0, 0.1)));
        assert_eq!(price("claude-opus-4-1-20250805"), Some((15.0, 75.0, 1.5)));
        assert_eq!(price("claude-future-9"), None);
    }

    use agent_core::usage::{aggregate, KEEP_MS};
    fn fixture() -> (tempdir::Dir, Tail<Rec>) {
        let d = tempdir::Dir::new();
        d.write("-Users-me-vault/s1.jsonl", MAIN);
        d.write("-Users-me-vault/s1/subagents/agent-a.jsonl", SUB);
        d.write("-Users-me-code/s9.jsonl", OTHER);
        let mut c = Tail::default();
        refresh(&mut c, &d.0, NOW - KEEP_MS);
        (d, c)
    }

    #[test]
    fn aggregates_windows_models_and_the_vault() {
        let (_d, c) = fixture();
        let recs: Vec<Record> = c.records().into_iter().map(|r| to_record(r, "-Users-me-vault")).collect();
        let v = aggregate(&recs, TODAY, WEEK);
        // m1 once (one line per content block), no synthetic line, m0 before the week
        assert_eq!(v["today"]["input"], 10 + 5 + 1_000_000 + 10);
        assert_eq!(v["today"]["output"], 100 + 5 + 100 + 1_000_000);
        assert_eq!(v["today"]["cacheRead"], 1000);
        assert_eq!(v["today"]["cacheWrite"], 200);
        assert_eq!(v["today"]["unpriced"], 10); // claude-future-9 has no price
        // opus: m1 10*4 + 100*20 + 1000*0.2 + 200*4*2 = 3840 and m8 2040, per million; m9 1M output at 20; haiku 1M input at 1
        let cost = v["today"]["cost"].as_f64().unwrap();
        assert!((cost - (5880.0 / 1e6 + 20.0 + 1.0)).abs() < 1e-9, "{cost}");
        assert_eq!(v["week"]["input"], v["today"]["input"]); // the week started a day earlier, m0 is older
        assert_eq!(v["vaultToday"]["input"], 10 + 5 + 1_000_000);
        assert_eq!(v["vaultToday"]["output"], 105);
        // models, most used first; subagent usage counts for its session
        assert_eq!(v["models"][0]["model"], "claude-opus-5-5");
        assert_eq!(v["models"].as_array().unwrap().len(), 3);
        assert_eq!(v["sessions"].as_array().unwrap().len(), 1);
        assert_eq!(v["sessions"][0]["sid"], "s1");
        assert_eq!(v["sessions"][0]["today"]["input"], 10 + 5 + 1_000_000);
    }

    #[test]
    fn reads_only_what_was_added() {
        let (d, mut c) = fixture();
        let before = c.records().len();
        // half a line: not read until it is complete
        let line = r#"{"type":"assistant","timestamp":"2026-09-30T10:00:00.000Z","sessionId":"s1","requestId":"r5","message":{"id":"m5","model":"claude-opus-5-5","usage":{"input_tokens":7,"output_tokens":7}}}"#;
        d.append("-Users-me-vault/s1.jsonl", &line[..40]);
        refresh(&mut c, &d.0, NOW - KEEP_MS);
        assert_eq!(c.records().len(), before);
        d.append("-Users-me-vault/s1.jsonl", &format!("{}\n", &line[40..]));
        refresh(&mut c, &d.0, NOW - KEEP_MS);
        assert_eq!(c.records().len(), before + 1);
        refresh(&mut c, &d.0, NOW - KEEP_MS);
        assert_eq!(c.records().len(), before + 1);
    }

    #[test]
    fn limits_from_the_endpoint() {
        let v: Value = serde_json::from_str(r#"{"five_hour":{"utilization":3.0,"resets_at":"2026-09-30T21:10:00+00:00"},
            "seven_day":{"utilization":38.0,"resets_at":"2026-10-03T19:00:00+00:00"},"seven_day_opus":null,
            "limits":[{"kind":"session","percent":3},{"kind":"weekly_scoped","percent":12,"resets_at":"2026-10-03T19:00:00+00:00","scope":{"model":{"display_name":"Fable"}}}]}"#).unwrap();
        let l = limits_of(&v, Some("max")).json();
        assert_eq!(l["ok"], true);
        assert_eq!(l["plan"], "max");
        assert_eq!(l["windows"][0]["pct"], 3.0);
        assert_eq!(l["windows"][0]["label"], "limit.session");
        assert_eq!(l["windows"][1]["resets"], "2026-10-03T19:00:00+00:00");
        assert_eq!(l["windows"][2]["name"], "Fable");
        assert_eq!(l["windows"][2]["label"], "limit.weeklyModel");
        assert_eq!(l["windows"].as_array().unwrap().len(), 3);
        let old: Value = serde_json::from_str(r#"{"five_hour":{"utilization":1.0},"seven_day_opus":{"utilization":5.0,"resets_at":"x"}}"#).unwrap();
        assert_eq!(limits_of(&old, None).json()["windows"][1]["name"], "Opus");
        assert_eq!(limits_of(&serde_json::json!({}), None), Limits::Off("unavailable".into()));
    }

    mod tempdir {
        use std::path::PathBuf;
        pub struct Dir(pub PathBuf);
        impl Dir {
            pub fn new() -> Self {
                static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
                let p = std::env::temp_dir().join(format!("vault-usage-{}-{}", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
                std::fs::create_dir_all(&p).unwrap();
                Dir(p)
            }
            pub fn write(&self, rel: &str, s: &str) {
                let p = self.0.join(rel);
                std::fs::create_dir_all(p.parent().unwrap()).unwrap();
                std::fs::write(p, s).unwrap();
            }
            pub fn append(&self, rel: &str, s: &str) {
                use std::io::Write;
                std::fs::OpenOptions::new().append(true).open(self.0.join(rel)).unwrap().write_all(s.as_bytes()).unwrap();
            }
        }
        impl Drop for Dir { fn drop(&mut self) { std::fs::remove_dir_all(&self.0).ok(); } }
    }
}
