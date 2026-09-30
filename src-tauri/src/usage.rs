// Usage: what Claude Code spent, from two sources.
// - Plan limits: the endpoint Claude Code's /usage reads (api.anthropic.com/api/oauth/usage), with the
//   CLI's own OAuth login from the keychain. Read only: the token is never refreshed here (that would
//   rotate it under the CLI), an expired or missing login shows as "unavailable". Token over curl's
//   stdin, never as an argument. At most one call a minute, the endpoint is rate limited.
// - Tokens: every assistant message in ~/.claude/projects/**/*.jsonl, read incrementally (each file
//   from where the last read stopped), deduplicated by message and request id, priced at API list
//   prices as an estimate. Only files touched in the last 8 days are read.

use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;

const KEEP_MS: i64 = 8 * 24 * 3600 * 1000;

fn now_ms() -> i64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0) }

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
    fn cost(&self) -> Option<f64> {
        let (i, o, r) = price(&self.model)?;
        Some((self.input as f64 * i + self.output as f64 * o + self.cache_read as f64 * r
            + self.write_5m as f64 * i * 1.25 + self.write_1h as f64 * i * 2.0) / 1e6)
    }
}

/// "2026-09-30T19:00:00.123Z" (or with +hh:mm) as epoch ms.
pub fn parse_ts(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[10] != b'T' { return None; }
    let n = |a: usize, z: usize| s.get(a..z)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (n(0, 4)?, n(5, 7)?, n(8, 10)?, n(11, 13)?, n(14, 16)?, n(17, 19)?);
    let mut rest = &s[19..];
    let mut ms = 0;
    if let Some(r) = rest.strip_prefix('.') {
        let digits: String = r.chars().take_while(|c| c.is_ascii_digit()).collect();
        ms = format!("{:0<3}", &digits[..digits.len().min(3)]).parse().unwrap_or(0);
        rest = &r[digits.len()..];
    }
    let off = match rest.as_bytes().first() {
        None | Some(b'Z') => 0,
        Some(&c) if (c == b'+' || c == b'-') && rest.len() >= 6 => {
            let v = rest[1..3].parse::<i64>().ok()? * 60 + rest[4..6].parse::<i64>().ok()?;
            if c == b'+' { v } else { -v }
        }
        _ => return None,
    };
    // days from civil (Howard Hinnant)
    let (yy, mm) = if mo <= 2 { (y - 1, mo + 9) } else { (y, mo - 3) };
    let era = yy.div_euclid(400);
    let yoe = yy - era * 400;
    let doy = (153 * mm + 2) / 5 + d - 1;
    let days = era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
    Some(((days * 24 + h) * 60 + mi - off) * 60_000 + se * 1000 + ms)
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

#[derive(Default)]
struct Tally { input: u64, output: u64, cache_read: u64, cache_write: u64, cost: f64, unpriced: u64 }
impl Tally {
    fn add(&mut self, r: &Rec) {
        self.input += r.input; self.output += r.output; self.cache_read += r.cache_read; self.cache_write += r.write_5m + r.write_1h;
        match r.cost() { Some(c) => self.cost += c, None => self.unpriced += r.input + r.output + r.cache_read + r.write_5m + r.write_1h }
    }
    fn json(&self) -> Value {
        json!({ "input": self.input, "output": self.output, "cacheRead": self.cache_read, "cacheWrite": self.cache_write,
            "total": self.input + self.output + self.cache_read + self.cache_write, "cost": self.cost, "unpriced": self.unpriced })
    }
}

/// Today and this week (the starts come from the UI, in local time), per model, the vault's own folder,
/// and the vault's conversations by session id.
pub fn aggregate(recs: &[Rec], today: i64, week: i64, vault_dir: &str) -> Value {
    let (mut t, mut w, mut vt, mut vw) = (Tally::default(), Tally::default(), Tally::default(), Tally::default());
    let mut models: HashMap<&str, (Tally, Tally)> = HashMap::new();
    let mut sessions: HashMap<&str, (Tally, Tally, i64)> = HashMap::new();
    for r in recs.iter().filter(|r| r.at >= week.min(today)) {
        let (in_t, in_w) = (r.at >= today, r.at >= week);
        let vault = !vault_dir.is_empty() && r.dir == vault_dir;
        let m = models.entry(&r.model).or_default();
        if in_t { t.add(r); m.0.add(r); if vault { vt.add(r); } }
        if in_w { w.add(r); m.1.add(r); if vault { vw.add(r); } }
        if vault {
            let s = sessions.entry(&r.sid).or_default();
            if in_t { s.0.add(r); }
            if in_w { s.1.add(r); }
            s.2 = s.2.max(r.at);
        }
    }
    let tot = |x: &Tally| x.input + x.output + x.cache_read + x.cache_write;
    let mut ms: Vec<_> = models.into_iter().filter(|(_, (a, b))| tot(a) + tot(b) > 0).collect();
    ms.sort_by(|a, b| tot(&b.1 .1).cmp(&tot(&a.1 .1)).then(a.0.cmp(b.0)));
    let mut ss: Vec<_> = sessions.into_iter().collect();
    ss.sort_by(|a, b| tot(&b.1 .1).cmp(&tot(&a.1 .1)).then(a.0.cmp(b.0)));
    json!({
        "today": t.json(), "week": w.json(), "vaultToday": vt.json(), "vaultWeek": vw.json(),
        "models": ms.iter().map(|(m, (a, b))| json!({ "model": m, "today": a.json(), "week": b.json() })).collect::<Vec<_>>(),
        "sessions": ss.iter().map(|(s, (a, b, last))| json!({ "sid": s, "today": a.json(), "week": b.json(), "last": last })).collect::<Vec<_>>(),
    })
}

// ---------- the incremental reader: per file the offset read so far and its records
#[derive(Default)]
struct FileState { offset: u64, recs: Vec<Rec> }
#[derive(Default)]
pub struct Cache { files: HashMap<PathBuf, FileState>, seen: HashSet<String> }

fn jsonl_files(dir: &Path, cutoff: SystemTime, out: &mut Vec<(PathBuf, u64)>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let (p, Ok(md)) = (e.path(), e.metadata()) else { continue };
        if md.is_dir() { jsonl_files(&p, cutoff, out); }
        else if p.extension().is_some_and(|x| x == "jsonl") && md.modified().is_ok_and(|m| m >= cutoff) { out.push((p, md.len())); }
    }
}

impl Cache {
    /// Read what the transcripts under `root` gained since the last call.
    pub fn refresh(&mut self, root: &Path, now: i64) {
        let since = now - KEEP_MS;
        let mut files = vec![];
        jsonl_files(root, UNIX_EPOCH + Duration::from_millis(since.max(0) as u64), &mut files);
        // a file that shrank was rewritten: start over, so nothing is counted twice or lost
        if files.iter().any(|(p, len)| self.files.get(p).is_some_and(|f| *len < f.offset)) { *self = Cache::default(); }
        for (p, len) in files {
            let st = self.files.entry(p.clone()).or_default();
            if len == st.offset { continue; }
            let Ok(mut f) = fs::File::open(&p) else { continue };
            if f.seek(SeekFrom::Start(st.offset)).is_err() { continue; }
            let mut buf = Vec::new();
            if f.take(len - st.offset).read_to_end(&mut buf).is_err() { continue; }
            // only whole lines: a line still being written is read next time
            let Some(end) = buf.iter().rposition(|&b| b == b'\n') else { continue };
            st.offset += end as u64 + 1;
            let dir = p.strip_prefix(root).ok().and_then(|r| r.components().next()).map(|c| c.as_os_str().to_string_lossy().to_string()).unwrap_or_default();
            // a subagent's transcript lives in <session>/subagents/, its usage counts for the session
            let sid = p.parent().and_then(|d| if d.ends_with("subagents") { d.parent() } else { None }).and_then(|d| d.file_name())
                .or_else(|| p.file_stem()).map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let text = String::from_utf8_lossy(&buf[..end]);
            st.recs.extend(parse_lines(&text, &dir, &sid, since, &mut self.seen));
        }
        for f in self.files.values_mut() { f.recs.retain(|r| r.at >= since); }
    }
    fn recs(&self) -> Vec<Rec> { self.files.values().flat_map(|f| f.recs.iter().cloned()).collect() }
}

static CACHE: Mutex<Option<Cache>> = Mutex::new(None);
static LIMITS: Mutex<Option<(i64, Value)>> = Mutex::new(None);

/// Token usage from the transcripts. `today` and `week` are the local starts of the day and the week, in ms.
#[tauri::command]
pub async fn usage_tokens(state: State<'_, super::App>, today: i64, week: i64) -> Result<Value, String> {
    let vault_dir = Path::new(&super::transcripts(&state)).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let keys: HashMap<String, String> = state.sids.lock().unwrap().iter().map(|(k, s)| (s.clone(), k.clone())).collect();
    let mut v = tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(format!("{}/.claude/projects", super::home()));
        let mut c = CACHE.lock().unwrap();
        let c = c.get_or_insert_with(Cache::default);
        c.refresh(&root, now_ms());
        aggregate(&c.recs(), today, week, &vault_dir)
    }).await.map_err(|e| e.to_string())?;
    // the app's own conversations by their key, so the UI can show their title
    if let Some(ss) = v["sessions"].as_array_mut() {
        for s in ss { if let Some(k) = s["sid"].as_str().and_then(|sid| keys.get(sid)) { s["key"] = json!(k); } }
    }
    Ok(v)
}

/// The 5-hour and weekly limits of the claude.ai plan, or why they are unavailable.
#[tauri::command]
pub async fn usage_limits() -> Value {
    if let Some((at, v)) = LIMITS.lock().unwrap().clone() { if now_ms() - at < 60_000 { return v; } }
    let v = tauri::async_runtime::spawn_blocking(fetch_limits).await.unwrap_or_else(|_| json!({ "ok": false, "reason": "unavailable" }));
    *LIMITS.lock().unwrap() = Some((now_ms(), v.clone()));
    v
}

fn fetch_limits() -> Value {
    let fail = |r: &str| json!({ "ok": false, "reason": r });
    // the login the claude CLI stored: the keychain on macOS, a file elsewhere
    let raw = Command::new("/usr/bin/security").args(["find-generic-password", "-s", "Claude Code-credentials", "-w"]).stderr(Stdio::null()).output().ok()
        .filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .or_else(|| fs::read_to_string(format!("{}/.claude/.credentials.json", super::home())).ok());
    let Some(cred) = raw.and_then(|s| serde_json::from_str::<Value>(&s).ok()) else { return fail("no-login") };
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

/// The endpoint's answer, reduced to what the view shows.
pub fn limits_of(v: &Value, plan: Option<&str>) -> Value {
    let win = |w: &Value| w["utilization"].as_f64().map(|p| json!({ "pct": p, "resets": w["resets_at"] }));
    let session = win(&v["five_hour"]);
    let weekly = win(&v["seven_day"]);
    if session.is_none() && weekly.is_none() { return json!({ "ok": false, "reason": "unavailable" }); }
    // weekly limits for one model (Opus, Sonnet, ...): the newer "limits" list names them
    let mut scoped: Vec<Value> = v["limits"].as_array().into_iter().flatten()
        .filter(|l| l["kind"] == "weekly_scoped")
        .filter_map(|l| Some(json!({ "name": l["scope"]["model"]["display_name"].as_str()?, "pct": l["percent"].as_f64()?, "resets": l["resets_at"] })))
        .collect();
    if scoped.is_empty() {
        for (k, name) in [("seven_day_opus", "Opus"), ("seven_day_sonnet", "Sonnet")] {
            if let Some(mut w) = win(&v[k]) { w["name"] = json!(name); scoped.push(w); }
        }
    }
    json!({ "ok": true, "plan": plan, "session": session, "weekly": weekly, "scoped": scoped })
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
    fn timestamps() {
        assert_eq!(parse_ts("2026-09-30T00:00:00Z"), Some(TODAY));
        assert_eq!(parse_ts("2026-09-30T00:00:00.5Z"), Some(TODAY + 500));
        assert_eq!(parse_ts("2026-09-30T02:00:00+02:00"), Some(TODAY));
        assert_eq!(parse_ts("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_ts("yesterday"), None);
    }

    #[test]
    fn prices_by_prefix() {
        assert_eq!(price("claude-opus-5-5"), Some((4.0, 20.0, 0.2)));
        assert_eq!(price("claude-haiku-4-5-20251001"), Some((1.0, 5.0, 0.1)));
        assert_eq!(price("claude-opus-4-1-20250805"), Some((15.0, 75.0, 1.5)));
        assert_eq!(price("claude-future-9"), None);
    }

    fn fixture() -> (tempdir::Dir, Cache) {
        let d = tempdir::Dir::new();
        d.write("-Users-me-vault/s1.jsonl", MAIN);
        d.write("-Users-me-vault/s1/subagents/agent-a.jsonl", SUB);
        d.write("-Users-me-code/s9.jsonl", OTHER);
        let mut c = Cache::default();
        c.refresh(&d.0, NOW);
        (d, c)
    }

    #[test]
    fn aggregates_windows_models_and_the_vault() {
        let (_d, c) = fixture();
        let v = aggregate(&c.recs(), TODAY, WEEK, "-Users-me-vault");
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
        let before = c.recs().len();
        // half a line: not read until it is complete
        let line = r#"{"type":"assistant","timestamp":"2026-09-30T10:00:00.000Z","sessionId":"s1","requestId":"r5","message":{"id":"m5","model":"claude-opus-5-5","usage":{"input_tokens":7,"output_tokens":7}}}"#;
        d.append("-Users-me-vault/s1.jsonl", &line[..40]);
        c.refresh(&d.0, NOW);
        assert_eq!(c.recs().len(), before);
        d.append("-Users-me-vault/s1.jsonl", &format!("{}\n", &line[40..]));
        c.refresh(&d.0, NOW);
        assert_eq!(c.recs().len(), before + 1);
        c.refresh(&d.0, NOW);
        assert_eq!(c.recs().len(), before + 1);
    }

    #[test]
    fn limits_from_the_endpoint() {
        let v: Value = serde_json::from_str(r#"{"five_hour":{"utilization":3.0,"resets_at":"2026-09-30T21:10:00+00:00"},
            "seven_day":{"utilization":38.0,"resets_at":"2026-10-03T19:00:00+00:00"},"seven_day_opus":null,
            "limits":[{"kind":"session","percent":3},{"kind":"weekly_scoped","percent":12,"resets_at":"2026-10-03T19:00:00+00:00","scope":{"model":{"display_name":"Fable"}}}]}"#).unwrap();
        let l = limits_of(&v, Some("max"));
        assert_eq!(l["ok"], true);
        assert_eq!(l["session"]["pct"], 3.0);
        assert_eq!(l["weekly"]["resets"], "2026-10-03T19:00:00+00:00");
        assert_eq!(l["scoped"][0]["name"], "Fable");
        assert_eq!(limits_of(&json!({}), None)["ok"], false);
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
