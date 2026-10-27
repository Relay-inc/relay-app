//! Usage in the contract: each provider reports (a) its plan or rate limits, as windows with % used and a
//! reset time, and (b) token records read incrementally from its local logs. The app aggregates the
//! records per provider (today, this week, per model, the vault's conversations) and over all providers.
//! (c) The files its tool calls read, wrote and searched ([`Touch`]), for the vault's own numbers.

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

/// What a tool call did with a file: read it, wrote it whole (new or overwritten), changed part of it, or searched
/// a folder (`path` is the folder).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Act { Read, Write, Edit, Search }

/// One file a provider's tool call touched, `path` absolute.
#[derive(Clone, Debug, PartialEq)]
pub struct Touch { pub at: i64, pub act: Act, pub path: String }

fn under(path: &str, dir: &str) -> bool { !dir.is_empty() && (path == dir || path.starts_with(&format!("{dir}/"))) }
/// `path` as an absolute path, a relative one taken from `cwd`.
pub fn resolve(path: &str, cwd: &str) -> String { if path.starts_with('/') { path.into() } else { format!("{cwd}/{path}") } }

/// The notes a shell command reads (cat, sed, head, …), writes (`>`) or edits (`sed -i`, `>>`), and the folders it searches (rg, grep,
/// find, fd): what a provider without its own Read and Grep tools does instead. Relative paths are taken from `cwd`,
/// moved by a `cd` in the command; paths and `cd`s it cannot tell (`~`, `$VAR`, `-`) are left out. A
/// grep behind a pipe filters the pipe and searches no folder.
// ponytail: words only, no shell semantics (subshells, xargs, redirects, quoted operators). Upgrade: a real shell parser.
pub fn shell_touches(cmd: &str, cwd: &str) -> Vec<(Act, String)> {
    let Some(words) = shlex::split(cmd) else { return vec![] };
    // `a; b` splits into "a;" and "b"
    let words: Vec<String> = words.into_iter().flat_map(|w| match w.strip_suffix(';') {
        Some(head) if !head.is_empty() => vec![head.to_string(), ";".into()],
        _ => vec![w],
    }).collect();
    let mut cwd = Some(cwd.to_string());
    let (mut out, mut piped, mut seg) = (vec![], false, vec![]);
    for w in words.iter().map(String::as_str).chain([";"]) {
        if !["&&", "||", ";", "|"].contains(&w) { seg.push(w); continue; }
        let at = |p: &str| match p {
            p if p.starts_with('/') => Some(p.to_string()),
            p if p.starts_with(['~', '$']) => None,
            p => cwd.as_ref().map(|c| resolve(p, c)),
        };
        // `> note.md` writes it whole, `>> note.md` adds to it, whichever command runs; the rest are the arguments
        let mut args_only = vec![];
        let mut words = seg.iter();
        while let Some(&w) = words.next() {
            let act = match w { ">" => Act::Write, ">>" => Act::Edit, _ => { args_only.push(w); continue } };
            if let Some(f) = words.next().filter(|f| f.ends_with(".md")).and_then(|f| at(f)) { out.push((act, f)); }
        }
        if let Some((prog, args)) = args_only.split_first() {
            match prog.rsplit('/').next().unwrap_or(prog) {
                "cd" => cwd = args.first().filter(|d| !d.starts_with(['~', '$', '-'])).and_then(|d| at(d)),
                p @ ("cat" | "head" | "tail" | "sed" | "nl" | "less" | "more" | "bat") => {
                    let act = if p == "sed" && args.iter().any(|a| a.starts_with("-i")) { Act::Edit } else { Act::Read };
                    out.extend(args.iter().filter(|a| a.ends_with(".md")).filter_map(|a| Some((act, at(a)?))));
                }
                "rg" | "grep" | "find" | "fd" if !piped => {
                    if let Some(dir) = args.iter().find(|a| a.starts_with('/')).map(|a| a.to_string()).or_else(|| cwd.clone()) { out.push((Act::Search, dir)); }
                }
                _ => {}
            }
        }
        piped = w == "|";
        seg.clear();
    }
    out
}

/// The vault's own numbers from every provider's touches: reads, writes, edits, searches and distinct notes today and
/// this week, the notes read and changed most this week, and the activity per folder (two levels down, "" for the
/// vault's root). Only notes (`.md`) count as reads and changes.
/// `{today, week: {read, write, edit, search, notes}, topRead, topChanged: [{path, n}], folders: [{folder, read, changed}]}`
pub fn vault_activity(touches: &[Touch], vault: &str, today: i64, week: i64) -> Value {
    #[derive(Default)]
    struct Count { read: u64, write: u64, edit: u64, search: u64, notes: HashSet<String> }
    impl Count {
        fn add(&mut self, act: Act, rel: &str) {
            match act { Act::Read => self.read += 1, Act::Write => self.write += 1, Act::Edit => self.edit += 1, Act::Search => self.search += 1 }
            if act != Act::Search { self.notes.insert(rel.into()); }
        }
        fn json(&self) -> Value { json!({ "read": self.read, "write": self.write, "edit": self.edit, "search": self.search, "notes": self.notes.len() }) }
    }
    let (mut t, mut w) = (Count::default(), Count::default());
    let (mut read, mut changed): (HashMap<String, u64>, HashMap<String, u64>) = Default::default();
    let mut folders: HashMap<String, (u64, u64)> = HashMap::new();
    // a tool call names the vault as given or by its real path (a symlinked folder, /tmp is /private/tmp)
    let real = fs::canonicalize(vault).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    for x in touches.iter().filter(|x| x.at >= week.min(today)) {
        let Some(root) = [vault, real.as_str()].into_iter().find(|r| under(&x.path, r)) else { continue };
        let rel = x.path[root.len()..].trim_start_matches('/');
        if x.act != Act::Search && !rel.ends_with(".md") { continue; }
        if x.at >= today { t.add(x.act, rel); }
        if x.at < week { continue; }
        w.add(x.act, rel);
        if x.act == Act::Search { continue; }
        let dirs: Vec<&str> = rel.split('/').collect();
        let f = folders.entry(dirs[..(dirs.len() - 1).min(2)].join("/")).or_default();
        if x.act == Act::Read { *read.entry(rel.into()).or_default() += 1; f.0 += 1; } else { *changed.entry(rel.into()).or_default() += 1; f.1 += 1; }
    }
    let top = |m: HashMap<String, u64>| {
        let mut v: Vec<_> = m.into_iter().collect();
        v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        v.into_iter().take(10).map(|(path, n)| json!({ "path": path, "n": n })).collect::<Vec<_>>()
    };
    let mut fs: Vec<_> = folders.into_iter().collect();
    fs.sort_by(|a, b| (b.1 .0 + b.1 .1).cmp(&(a.1 .0 + a.1 .1)).then(a.0.cmp(&b.0)));
    json!({
        "today": t.json(), "week": w.json(), "topRead": top(read), "topChanged": top(changed),
        "folders": fs.iter().map(|(f, (r, c))| json!({ "folder": f, "read": r, "changed": c })).collect::<Vec<_>>(),
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
    fn shell_commands_read_edit_and_search() {
        let t = |cmd: &str| shell_touches(cmd, "/v");
        assert_eq!(t("cat 'Plan - A.md' && sed -n 1,9p /v/B.md | head"), vec![(Act::Read, "/v/Plan - A.md".into()), (Act::Read, "/v/B.md".into())]);
        assert_eq!(t("sed -i '' s/a/b/ Notes/C.md"), vec![(Act::Edit, "/v/Notes/C.md".into())]);
        assert_eq!(t("rg -n foo; grep -r x /w/src"), vec![(Act::Search, "/v".into()), (Act::Search, "/w/src".into())]);
        assert_eq!(t("ls Notes && git status"), vec![]);
        assert_eq!(t("cat 'unbalanced.md"), vec![]);
        // a cd moves the rest of the line; a grep behind a pipe reads the pipe, not a folder
        assert_eq!(t("cd ~/repo && cat CLAUDE.md; cd /w && rg x"), vec![(Act::Search, "/w".into())]);
        assert_eq!(t("cd Notes && head -3 D.md | grep -c x"), vec![(Act::Read, "/v/Notes/D.md".into())]);
        assert_eq!(t("cat ~/.claude/A.md $d/B.md"), vec![]);
        assert_eq!(t("cat > New.md <<'EOF'"), vec![(Act::Write, "/v/New.md".into())]);
        assert_eq!(t("cat A.md >> B.md"), vec![(Act::Edit, "/v/B.md".into()), (Act::Read, "/v/A.md".into())]);
    }

    #[test]
    fn vault_activity_counts_notes_folders_and_searches() {
        let x = |at: i64, act: Act, path: &str| Touch { at, act, path: path.into() };
        let touches = [
            x(TODAY + 1, Act::Read, "/v/Contexts/Acme/Portfolio/A.md"),
            x(TODAY + 2, Act::Read, "/v/Contexts/Acme/Portfolio/A.md"),
            x(TODAY + 3, Act::Edit, "/v/Calendar/2026-09-30.md"),
            x(TODAY + 4, Act::Search, "/v/Contexts"),
            x(TODAY - 1, Act::Write, "/v/Inbox.md"),
            x(TODAY - 2, Act::Read, "/v/Inbox.md"),
            x(TODAY + 5, Act::Read, "/elsewhere/B.md"),
            x(TODAY + 6, Act::Read, "/v/image.png"),
            x(TODAY + 7, Act::Read, "/vault2/C.md"),
            x(WEEK - 1, Act::Read, "/v/Old.md"),
        ];
        let v = vault_activity(&touches, "/v", TODAY, WEEK);
        assert_eq!(v["today"], json!({"read": 2, "write": 0, "edit": 1, "search": 1, "notes": 2}));
        assert_eq!(v["week"], json!({"read": 3, "write": 1, "edit": 1, "search": 1, "notes": 3}));
        assert_eq!(v["topRead"], json!([{"path": "Contexts/Acme/Portfolio/A.md", "n": 2}, {"path": "Inbox.md", "n": 1}]));
        assert_eq!(v["topChanged"], json!([{"path": "Calendar/2026-09-30.md", "n": 1}, {"path": "Inbox.md", "n": 1}]));
        assert_eq!(v["folders"], json!([
            {"folder": "", "read": 1, "changed": 1}, {"folder": "Contexts/Acme", "read": 2, "changed": 0}, {"folder": "Calendar", "read": 0, "changed": 1},
        ]));
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
