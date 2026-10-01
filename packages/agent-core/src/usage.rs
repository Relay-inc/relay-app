//! Usage in the contract: each provider reports (a) its plan or rate limits, as windows with % used and a
//! reset time, and (b) token records read incrementally from its local logs. The app aggregates the
//! records per provider (today, this week, per model, the vault's conversations) and over all providers.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub fn now_ms() -> i64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0) }
/// How far back the Usage view looks: the week plus a day for the time zones.
pub const KEEP_MS: i64 = 8 * 24 * 3600 * 1000;

/// One limit window. `label` is a key in the provider's own strings (packages/agent-<id>/src/locales.ts),
/// `name` fills its `{name}` (a model, for a limit on one model).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Window { pub id: String, pub label: String, pub name: Option<String>, pub pct: f64, pub resets: Option<String> }

#[derive(Clone, Debug, PartialEq)]
pub enum Limits {
    /// The windows in the order to show, the plan's name if known.
    On { plan: Option<String>, windows: Vec<Window> },
    /// Why there are none: a key `off.<reason>` in the provider's strings ("no-login", "expired", "unavailable", …).
    Off(String),
}
impl Limits {
    /// `{ok: true, plan, windows}` or `{ok: false, reason}`, what the webview reads.
    pub fn json(&self) -> Value {
        match self {
            Limits::On { plan, windows } => json!({ "ok": true, "plan": plan, "windows": windows }),
            Limits::Off(r) => json!({ "ok": false, "reason": r }),
        }
    }
}

/// One model call (or turn) in a provider's logs.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Record {
    /// Epoch ms.
    pub at: i64,
    pub model: String,
    /// The provider's session id: the app maps it to its conversation.
    pub session: String,
    /// Whether it ran in the current vault.
    pub vault: bool,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    /// USD, an estimate or what the provider reports. None: no known price, counted as unpriced tokens.
    pub cost: Option<f64>,
}
impl Record { pub fn total(&self) -> u64 { self.input + self.output + self.cache_read + self.cache_write } }

#[derive(Default)]
struct Tally { input: u64, output: u64, cache_read: u64, cache_write: u64, cost: f64, unpriced: u64 }
impl Tally {
    fn add(&mut self, r: &Record) {
        self.input += r.input; self.output += r.output; self.cache_read += r.cache_read; self.cache_write += r.cache_write;
        match r.cost { Some(c) => self.cost += c, None => self.unpriced += r.total() }
    }
    fn tot(&self) -> u64 { self.input + self.output + self.cache_read + self.cache_write }
    fn json(&self) -> Value {
        json!({ "input": self.input, "output": self.output, "cacheRead": self.cache_read, "cacheWrite": self.cache_write,
            "total": self.tot(), "cost": self.cost, "unpriced": self.unpriced })
    }
}

/// Today and this week (the starts come from the webview, in local time), per model, the vault, and the
/// vault's sessions: `{today, week, vaultToday, vaultWeek, models: [{model, today, week}], sessions: [{sid, today, week, last}]}`.
pub fn aggregate(recs: &[Record], today: i64, week: i64) -> Value {
    let (mut t, mut w, mut vt, mut vw) = (Tally::default(), Tally::default(), Tally::default(), Tally::default());
    let mut models: HashMap<&str, (Tally, Tally)> = HashMap::new();
    let mut sessions: HashMap<&str, (Tally, Tally, i64)> = HashMap::new();
    for r in recs.iter().filter(|r| r.at >= week.min(today)) {
        let (in_t, in_w) = (r.at >= today, r.at >= week);
        let m = models.entry(&r.model).or_default();
        if in_t { t.add(r); m.0.add(r); if r.vault { vt.add(r); } }
        if in_w { w.add(r); m.1.add(r); if r.vault { vw.add(r); } }
        if r.vault {
            let s = sessions.entry(&r.session).or_default();
            if in_t { s.0.add(r); }
            if in_w { s.1.add(r); }
            s.2 = s.2.max(r.at);
        }
    }
    let mut ms: Vec<_> = models.into_iter().filter(|(_, (a, b))| a.tot() + b.tot() > 0).collect();
    ms.sort_by(|a, b| b.1 .1.tot().cmp(&a.1 .1.tot()).then(a.0.cmp(b.0)));
    let mut ss: Vec<_> = sessions.into_iter().collect();
    ss.sort_by(|a, b| b.1 .1.tot().cmp(&a.1 .1.tot()).then(a.0.cmp(b.0)));
    json!({
        "today": t.json(), "week": w.json(), "vaultToday": vt.json(), "vaultWeek": vw.json(),
        "models": ms.iter().map(|(m, (a, b))| json!({ "model": m, "today": a.json(), "week": b.json() })).collect::<Vec<_>>(),
        "sessions": ss.iter().map(|(s, (a, b, last))| json!({ "sid": s, "today": a.json(), "week": b.json(), "last": last })).collect::<Vec<_>>(),
    })
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

/// The incremental reader of a folder of append-only logs: per file the offset read so far and its records,
/// only whole lines, only files touched since the cutoff. `seen` is for the provider's deduplication (ids
/// already counted); it is cleared with everything else when a file shrank (was rewritten).
pub struct Tail<R> { files: HashMap<PathBuf, (u64, Vec<R>)>, pub seen: HashSet<String> }
impl<R> Default for Tail<R> { fn default() -> Self { Tail { files: HashMap::new(), seen: HashSet::new() } } }

fn files_with(dir: &Path, ext: &str, cutoff: SystemTime, out: &mut Vec<(PathBuf, u64)>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let (p, Ok(md)) = (e.path(), e.metadata()) else { continue };
        if md.is_dir() { files_with(&p, ext, cutoff, out); }
        else if p.extension().is_some_and(|x| x == ext) && md.modified().is_ok_and(|m| m >= cutoff) { out.push((p, md.len())); }
    }
}

impl<R: Clone> Tail<R> {
    /// Read what the `*.ext` files under `root` gained. `parse(path, whole lines, seen)` makes the records;
    /// `at` gives a record's time, older than `since` is dropped. True when it started over.
    pub fn refresh(&mut self, root: &Path, ext: &str, since: i64, at: impl Fn(&R) -> i64,
                   mut parse: impl FnMut(&Path, &str, &mut HashSet<String>) -> Vec<R>) -> bool {
        let mut files = vec![];
        files_with(root, ext, UNIX_EPOCH + Duration::from_millis(since.max(0) as u64), &mut files);
        let reset = files.iter().any(|(p, len)| self.files.get(p).is_some_and(|f| *len < f.0));
        if reset { *self = Tail::default(); }
        for (p, len) in files {
            let st = self.files.entry(p.clone()).or_insert((0, vec![]));
            if len == st.0 { continue; }
            let Ok(mut f) = fs::File::open(&p) else { continue };
            if f.seek(SeekFrom::Start(st.0)).is_err() { continue; }
            let mut buf = Vec::new();
            if f.take(len - st.0).read_to_end(&mut buf).is_err() { continue; }
            // only whole lines: a line still being written is read next time
            let Some(end) = buf.iter().rposition(|&b| b == b'\n') else { continue };
            st.0 += end as u64 + 1;
            let text = String::from_utf8_lossy(&buf[..end]);
            st.1.extend(parse(&p, &text, &mut self.seen));
        }
        for f in self.files.values_mut() { f.1.retain(|r| at(r) >= since); }
        reset
    }
    pub fn records(&self) -> Vec<R> { self.files.values().flat_map(|f| f.1.iter().cloned()).collect() }
}

#[cfg(test)]
mod tests {
    use super::*;
    const TODAY: i64 = 1790726400000; // 2026-09-30T00:00:00Z
    const WEEK: i64 = 1790640000000;  // 2026-09-29T00:00:00Z

    #[test]
    fn timestamps() {
        assert_eq!(parse_ts("2026-09-30T00:00:00Z"), Some(TODAY));
        assert_eq!(parse_ts("2026-09-30T00:00:00.5Z"), Some(TODAY + 500));
        assert_eq!(parse_ts("2026-09-30T02:00:00+02:00"), Some(TODAY));
        assert_eq!(parse_ts("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_ts("yesterday"), None);
    }

    #[test]
    fn aggregates_windows_models_and_the_vault() {
        let r = |at: i64, model: &str, session: &str, vault: bool, input: u64, cost: Option<f64>| Record { at, model: model.into(), session: session.into(), vault, input, output: 1, cost, ..Default::default() };
        let recs = [r(TODAY + 1, "a", "s1", true, 10, Some(1.0)), r(TODAY - 1, "a", "s1", true, 10, Some(1.0)), r(TODAY + 2, "b", "s2", false, 5, None), r(WEEK - 1, "a", "s1", true, 99, Some(9.0))];
        let v = aggregate(&recs, TODAY, WEEK);
        assert_eq!(v["today"]["input"], 15);
        assert_eq!(v["week"]["input"], 25);
        assert_eq!(v["week"]["cost"], 2.0);
        assert_eq!(v["today"]["unpriced"], 6);
        assert_eq!(v["vaultToday"]["total"], 11);
        assert_eq!(v["models"][0]["model"], "a");
        assert_eq!(v["sessions"].as_array().unwrap().len(), 1);
        assert_eq!(v["sessions"][0]["last"], TODAY + 1);
    }

    #[test]
    fn limits_json() {
        let l = Limits::On { plan: Some("max".into()), windows: vec![Window { id: "session".into(), label: "limit.session".into(), name: None, pct: 3.0, resets: None }] };
        assert_eq!(l.json()["windows"][0]["label"], "limit.session");
        assert_eq!(Limits::Off("expired".into()).json(), json!({"ok": false, "reason": "expired"}));
    }

    #[test]
    fn tail_reads_only_whole_new_lines() {
        let d = std::env::temp_dir().join(format!("vault-tail-{}", std::process::id()));
        fs::create_dir_all(d.join("x")).unwrap();
        let f = d.join("x/a.jsonl");
        fs::write(&f, "1\n2\n3").unwrap();
        let mut t: Tail<i64> = Tail::default();
        let parse = |_: &Path, s: &str, seen: &mut HashSet<String>| s.lines().filter(|l| seen.insert(l.to_string())).filter_map(|l| l.parse().ok()).collect::<Vec<i64>>();
        let now = now_ms();
        assert!(!t.refresh(&d, "jsonl", 0, |_| now, parse));
        assert_eq!(t.records().len(), 2);
        fs::write(&f, "1\n2\n3\n4\n").unwrap();
        t.refresh(&d, "jsonl", 0, |_| now, parse);
        assert_eq!(t.records().len(), 4);
        fs::write(&f, "9\n").unwrap();
        assert!(t.refresh(&d, "jsonl", 0, |_| now, parse));
        assert_eq!(t.records(), vec![9]);
        fs::remove_dir_all(d).ok();
    }
}
