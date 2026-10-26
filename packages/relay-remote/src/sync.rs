// Folder sync between the laptop and a relay-server, so an agent on the work machine reads and writes a mirror of the
// vault while the laptop is closed. The laptop coordinates every round: it keeps the base (the manifest both sides
// agreed on after the last round), scans its own side, fetches the remote manifest, plans and executes against a
// `Remote`. The server only scans (the same Walker) and answers get, put and delete.
//
// Plans compare hashes only, never mtimes: two machines' clocks and an mtime-preserving copy both lie. Every write that
// could lose data checks first that what it replaces is still what the plan saw, on both sides, so an edit made during
// a round is kept and picked up by the next one. What a round may destroy here is braked further (`Guard`).

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// One file: path relative to the root with '/' separators (as found, no leading '/'), size, mtime (unix seconds), lowercase hex sha256.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry { pub path: String, pub size: u64, pub mtime: i64, pub hash: String }
pub type Manifest = BTreeMap<String, Entry>;

// write_atomic's temp files: never scanned, never synced
const TMP: &str = ".relay-sync-";
const NS: i64 = 1_000_000_000;

/// What to skip: directory or file names matched anywhere (e.g. ".obsidian", ".git", ".trash", ".relay", "node_modules"),
/// path prefixes relative to the root (e.g. "Communication/transcripts"), and a size limit (bigger files are skipped and
/// listed, 0 = none).
#[derive(Clone, Debug, Default)]
pub struct Filter { pub names: Vec<String>, pub prefixes: Vec<String>, pub max_size: u64 }
impl Filter {
    pub fn vault_default() -> Filter {
        Filter { names: [".obsidian", ".git", ".trash", ".relay", "node_modules", ".DS_Store"].map(String::from).to_vec(), prefixes: vec![], max_size: 20 << 20 }
    }
    /// Every segment is checked, not only the last, so a server can judge a single incoming path the same way a walk does.
    pub fn skips(&self, rel: &str, is_dir: bool) -> bool {
        rel.split('/').any(|s| self.names.iter().any(|n| n == s))
            || self.prefixes.iter().map(|p| p.trim_end_matches('/')).any(|p| rel == p || rel.strip_prefix(p).is_some_and(|r| r.starts_with('/')))
            || (!is_dir && rel.rsplit('/').next().is_some_and(|n| n.starts_with(TMP)))
    }
}

/// Scans a root, rehashing only files whose (size, mtime) changed since the last scan.
#[derive(Default)]
pub struct Walker {
    // path -> (size, mtime in ns, hash): nanoseconds, so an edit within the same second that keeps the size is still seen
    cache: HashMap<String, (u64, i64, String)>,
    /// Files read and hashed so far: what the cache saves is observable.
    pub hashed: u64,
}
struct Out { m: Manifest, skipped: Vec<String>, cache: HashMap<String, (u64, i64, String)> }
impl Walker {
    /// The manifest of `root` (missing root = empty manifest), plus the paths skipped for size or for a name that cannot
    /// travel (not UTF-8, a backslash). A symlinked directory is followed (a vault may link .claude to System), except one
    /// that points back at a directory being walked; a symlinked file is read as a file. Any read error other than a
    /// vanished file fails the whole scan: a silently missing folder would look deleted and be deleted on the other side.
    pub fn scan(&mut self, root: &Path, filter: &Filter) -> io::Result<(Manifest, Vec<String>)> {
        let top = match fs::canonicalize(root) {
            Ok(p) => p,
            Err(e) if e.kind() == ErrorKind::NotFound => { self.cache.clear(); return Ok(Default::default()); }
            Err(e) => return Err(e),
        };
        let mut out = Out { m: Manifest::new(), skipped: vec![], cache: HashMap::new() };
        self.walk(root, "", filter, &mut vec![top], &mut out)?;
        self.cache = out.cache; // deleted files leave the cache
        Ok((out.m, out.skipped))
    }
    // stack: the canonical paths of the directories being walked, to catch a link back up
    fn walk(&mut self, dir: &Path, prefix: &str, f: &Filter, stack: &mut Vec<PathBuf>, out: &mut Out) -> io::Result<()> {
        for ent in fs::read_dir(dir)? {
            let ent = ent?;
            let path = ent.path();
            let Some(name) = ent.file_name().to_str().map(str::to_owned) else { out.skipped.push(format!("{prefix}{}", ent.file_name().to_string_lossy())); continue };
            let rel = format!("{prefix}{name}");
            let link = ent.file_type()?.is_symlink();
            let meta = match fs::metadata(&path) {
                Ok(m) => m,
                Err(_) if link => continue, // dangling or looping link: nothing to sync
                Err(e) if e.kind() == ErrorKind::NotFound => continue,
                Err(e) => return Err(e),
            };
            if meta.is_dir() {
                if f.skips(&rel, true) { continue; }
                let canon = if link { fs::canonicalize(&path)? } else { stack.last().unwrap().join(&name) };
                if stack.contains(&canon) { continue; } // following it would never end
                stack.push(canon);
                self.walk(&path, &format!("{rel}/"), f, stack, out)?;
                stack.pop();
            } else if meta.is_file() {
                if f.skips(&rel, false) { continue; }
                if !safe_rel(&rel) || (f.max_size > 0 && meta.len() > f.max_size) { out.skipped.push(rel); continue; }
                let (size, mt) = (meta.len(), nanos(meta.modified()?));
                let hash = match self.cache.get(&rel) {
                    Some((s, t, h)) if *s == size && *t == mt => h.clone(),
                    _ => match fs::read(&path) {
                        Ok(d) => { self.hashed += 1; sha256_hex(&d) }
                        Err(e) if e.kind() == ErrorKind::NotFound => continue,
                        Err(e) => return Err(e),
                    },
                };
                out.cache.insert(rel.clone(), (size, mt, hash.clone()));
                out.m.insert(rel.clone(), Entry { path: rel, size, mtime: mt.div_euclid(NS), hash });
            }
        }
        Ok(())
    }
    /// Tell the cache about a file just written with known content (avoids a rehash). Only exact when the file's mtime
    /// was set to `e.mtime` whole seconds, as write_atomic does when given one.
    pub fn note(&mut self, e: &Entry) { self.cache.insert(e.path.clone(), (e.size, e.mtime.saturating_mul(NS), e.hash.clone())); }
}

fn nanos(t: SystemTime) -> i64 {
    match t.duration_since(UNIX_EPOCH) { Ok(d) => d.as_nanos() as i64, Err(e) => -(e.duration().as_nanos() as i64) }
}
fn time(secs: i64) -> SystemTime {
    if secs >= 0 { UNIX_EPOCH + Duration::from_secs(secs as u64) } else { UNIX_EPOCH - Duration::from_secs(secs.unsigned_abs()) }
}
fn now() -> i64 { nanos(SystemTime::now()).div_euclid(NS) }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// the remote becomes an exact copy of the local side; remote changes are overwritten
    Replica,
    /// both sides may change; a file changed on both with different content keeps both
    TwoWay,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Action {
    Push(String), Pull(String), DeleteRemote(String), DeleteLocal(String),
    /// both changed differently: keep local at `path`, save the remote version locally as `copy`, push both
    Conflict { path: String, copy: String },
    /// both changed a line-mergeable file (an index like MEMORY.md): union of the lines, written to both sides
    Merge(String),
}
fn target(a: &Action) -> &str {
    match a { Action::Push(p) | Action::Pull(p) | Action::DeleteRemote(p) | Action::DeleteLocal(p) | Action::Merge(p) | Action::Conflict { path: p, .. } => p }
}

/// Pure planning, by hash only. TwoWay: a change on one side goes to the other (a delete included), a delete against a
/// modification keeps the modification, a change on both is a Merge when `mergeable(path)` and a Conflict otherwise.
/// Replica: push what differs, delete on the remote what the local side lacks. In both modes paths that differ only in
/// case (either side) are skipped and returned: on a case-insensitive disk they are one file, either would clobber the other.
pub fn plan(mode: Mode, base: &Manifest, local: &Manifest, remote: &Manifest, copy_name: &dyn Fn(&str) -> String, mergeable: &dyn Fn(&str) -> bool) -> (Vec<Action>, Vec<String>) {
    let mut folded: BTreeMap<String, BTreeSet<&str>> = BTreeMap::new();
    for p in local.keys().chain(remote.keys()) { folded.entry(p.to_lowercase()).or_default().insert(p); }
    let clash: BTreeSet<&str> = folded.into_values().filter(|s| s.len() > 1).flatten().collect();
    let paths: BTreeSet<&String> = base.keys().chain(local.keys()).chain(remote.keys()).collect();
    let mut acts = vec![];
    for p in paths {
        if clash.contains(p.as_str()) { continue; }
        let [b, l, r] = [base, local, remote].map(|m| m.get(p).map(|e| e.hash.as_str()));
        if l == r { continue; }
        let p = p.clone();
        acts.push(match mode {
            Mode::Replica => if l.is_some() { Action::Push(p) } else { Action::DeleteRemote(p) },
            Mode::TwoWay => match (l != b, r != b) {
                (true, false) => if l.is_some() { Action::Push(p) } else { Action::DeleteRemote(p) },
                (false, true) => if r.is_some() { Action::Pull(p) } else { Action::DeleteLocal(p) },
                // both changed (both unchanged would mean l == r)
                _ => match (l, r) {
                    (None, _) => Action::Pull(p),
                    (_, None) => Action::Push(p),
                    _ if mergeable(&p) => Action::Merge(p),
                    _ => Action::Conflict { copy: copy_name(&p), path: p },
                },
            },
        });
    }
    (acts, clash.into_iter().map(String::from).collect())
}

/// "Notes/A.md","LServer","2026-10-02 1530" -> "Notes/A (conflict LServer 2026-10-02 1530).md". A dotfile or a name
/// without a dot gets the tag at the end, so the copy keeps its kind.
pub fn conflict_copy(path: &str, machine: &str, stamp: &str) -> String {
    let (dir, name) = match path.rfind('/') { Some(i) => path.split_at(i + 1), None => ("", path) };
    let (stem, ext) = match name.rfind('.') { Some(i) if i > 0 => name.split_at(i), _ => (name, "") };
    format!("{dir}{stem} (conflict {machine} {stamp}){ext}")
}

/// Line union for an index: the local lines in their order, then the remote lines the local side lacks, in their order,
/// each once; a trailing newline when either side had one. A line removed on one side comes back from the other: an
/// index grows, its owner prunes it.
pub fn merge_lines(local: &str, remote: &str) -> String {
    let mut seen: HashSet<&str> = local.lines().collect();
    let mut out: Vec<&str> = local.lines().collect();
    out.extend(remote.lines().filter(|l| seen.insert(l)));
    let mut s = out.join("\n");
    if !out.is_empty() && (local.ends_with('\n') || remote.ends_with('\n')) { s.push('\n'); }
    s
}

pub trait Remote {
    fn manifest(&self) -> Result<Manifest, String>;
    fn get(&self, path: &str) -> Result<Vec<u8>, String>;
    /// write only if the remote file still has `expect` ("" = it must not exist), else Err: an agent there wrote it
    /// after the manifest was taken, and the next round sees both changes
    fn put(&self, path: &str, data: &[u8], mtime: i64, expect: &str) -> Result<(), String>;
    /// delete only if the remote file still has `hash` (else Err: it changed meanwhile, the next round sees it)
    fn delete(&self, path: &str, hash: &str) -> Result<(), String>;
    /// Several files at once (path, content, mtime, expect), for a server one request instead of one per file. Per
    /// file: None when it was written, else why not. Err: none of them was.
    fn put_many(&self, files: &[(String, Vec<u8>, i64, String)]) -> Result<Vec<Option<String>>, String> {
        Ok(files.iter().map(|(p, d, m, x)| self.put(p, d, *m, x).err()).collect())
    }
}
/// A batch of pushes: at most this many files, and it closes once it holds this many bytes.
const BATCH_FILES: usize = 500;
const BATCH_BYTES: usize = 8 << 20;

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Report {
    pub pushed: Vec<String>, pub pulled: Vec<String>, pub deleted_remote: Vec<String>, pub deleted_local: Vec<String>, pub merged: Vec<String>,
    /// the copy paths
    pub conflicts: Vec<String>,
    pub skipped: Vec<String>, pub errors: Vec<String>,
    /// deletes that wait for the user (`Guard`): these paths keep their base, so every round plans them again
    pub held: Vec<String>,
}

/// What a round may destroy on this side. More deletes than `max(5, a fifth of the base)` in one TwoWay round wait for
/// the user, both directions, unless `allow_deletes`: an agent's `rm -rf` or a checkout there would otherwise empty a
/// folder here (a Replica's remote is only a copy, nothing to brake). Before a file here is deleted, or a pull leaves at
/// most a fifth of it (of 200 bytes or more), `keep` gets the old content; when that fails the file stays.
pub struct Guard<'a> { pub allow_deletes: bool, pub keep: &'a dyn Fn(&str, &[u8]) -> io::Result<()> }
fn delete_cap(base: &Manifest) -> usize { base.len().div_ceil(5).max(5) }
fn shrinks(old: &[u8], new: &[u8]) -> bool { old.len() >= 200 && new.len() * 5 <= old.len() }

/// One sync round: scan local, fetch the remote manifest, plan, execute, return the new base (every path both sides now
/// hold with the same hash; a path whose action failed or was skipped keeps its old base entry and is retried next
/// round). Per-action errors land in `report.errors` and the round goes on. Remote paths are filtered like local ones
/// and unsafe ones dropped. A round refuses to start when a side is empty while the base is not (a missing disk or a
/// wiped server, which would otherwise be mirrored as "delete everything"); a Replica only checks the local side.
/// `progress(done, total)` follows the actions; (0, 0) while it scans and compares.
#[allow(clippy::too_many_arguments)] // the round's inputs, each one needed
pub fn run(mode: Mode, root: &Path, base: &Manifest, walker: &mut Walker, filter: &Filter, remote: &dyn Remote, copy_name: &dyn Fn(&str) -> String, mergeable: &dyn Fn(&str) -> bool, guard: &Guard, progress: &dyn Fn(usize, usize)) -> (Manifest, Report) {
    progress(0, 0);
    let mut rep = Report::default();
    let (mut local, mut skipped) = match walker.scan(root, filter) { Ok(x) => x, Err(e) => { rep.errors.push(format!("scan: {e}")); return (base.clone(), rep); } };
    let all = match remote.manifest() { Ok(m) => m, Err(e) => { rep.errors.push(format!("remote manifest: {e}")); return (base.clone(), rep); } };
    let mut rm = Manifest::new();
    for (p, e) in all {
        if !safe_rel(&p) || (filter.max_size > 0 && e.size > filter.max_size) { skipped.push(p); }
        else if !filter.skips(&p, false) { rm.insert(p.clone(), Entry { path: p, ..e }); }
    }
    if !base.is_empty() && (local.is_empty() || (mode == Mode::TwoWay && rm.is_empty())) {
        rep.errors.push(format!("{} side is empty while the last sync had {} files: refusing to mirror that", if local.is_empty() { "local" } else { "remote" }, base.len()));
        return (base.clone(), rep);
    }
    // too big or unsyncable on either side: out of this round on both, or a file grown past the limit would read as deleted
    let hold: BTreeSet<String> = skipped.iter().cloned().collect();
    local.retain(|p, _| !hold.contains(p));
    rm.retain(|p, _| !hold.contains(p));
    let (mut acts, clashes) = plan(mode, base, &local, &rm, copy_name, mergeable);
    let deletes = acts.iter().filter(|a| matches!(a, Action::DeleteLocal(_) | Action::DeleteRemote(_))).count();
    if mode == Mode::TwoWay && !guard.allow_deletes && deletes > delete_cap(base) {
        acts.retain(|a| match a { Action::DeleteLocal(p) | Action::DeleteRemote(p) => { rep.held.push(p.clone()); false } _ => true });
    }
    let mut next = Manifest::new();
    for p in base.keys().chain(local.keys()).chain(rm.keys()) {
        let keep = match (local.get(p), rm.get(p)) {
            (Some(l), Some(r)) if l.hash == r.hash => Some(l),
            (None, None) if !hold.contains(p) => None,
            _ => base.get(p),
        };
        if let Some(e) = keep { next.insert(p.clone(), e.clone()); }
    }
    // the pushes in batches: a first round sends thousands of files, one request each would take minutes
    let pushes: Vec<&String> = acts.iter().filter_map(|a| match a { Action::Push(p) => Some(p), _ => None }).collect();
    let mut done = 0;
    while done < pushes.len() {
        progress(done, acts.len());
        let (mut batch, mut bytes) = (vec![], 0);
        while done < pushes.len() && batch.len() < BATCH_FILES && bytes < BATCH_BYTES {
            let p = pushes[done];
            done += 1;
            match fs::read(root.join(p)) {
                // what the plan saw there, so an agent's write since is not pushed over
                Ok(d) => { bytes += d.len(); batch.push((p.clone(), d, local[p].mtime, rm.get(p).map(|e| e.hash.clone()).unwrap_or_default())); }
                Err(e) => rep.errors.push(format!("{p}: {e}")),
            }
        }
        match remote.put_many(&batch) {
            Ok(res) => for ((p, d, ..), err) in batch.iter().zip(res) {
                match err {
                    None => { next.insert(p.clone(), Entry { size: d.len() as u64, hash: sha256_hex(d), ..local[p].clone() }); rep.pushed.push(p.clone()); }
                    Some(e) => rep.errors.push(format!("{p}: {e}")),
                }
            },
            Err(e) => rep.errors.extend(batch.iter().map(|(p, ..)| format!("{p}: {e}"))),
        }
    }
    for (i, a) in acts.iter().filter(|a| !matches!(a, Action::Push(_))).enumerate() {
        progress(done + i, acts.len());
        match exec(root, &local, &rm, remote, walker, guard.keep, a) {
            Ok(ups) => {
                for (p, e) in ups { match e { Some(e) => { next.insert(p, e); } None => { next.remove(&p); } } }
                let (list, p) = match a {
                    Action::Push(p) => (&mut rep.pushed, p), Action::Pull(p) => (&mut rep.pulled, p),
                    Action::DeleteRemote(p) => (&mut rep.deleted_remote, p), Action::DeleteLocal(p) => (&mut rep.deleted_local, p),
                    Action::Merge(p) => (&mut rep.merged, p), Action::Conflict { copy, .. } => (&mut rep.conflicts, copy),
                };
                list.push(p.clone());
            }
            Err(e) => rep.errors.push(format!("{}: {e}", target(a))),
        }
    }
    progress(acts.len(), acts.len());
    skipped.extend(clashes);
    rep.skipped = skipped;
    (next, rep)
}

// One action; Ok holds its base updates (None = the path is gone on both sides).
type Ups = Vec<(String, Option<Entry>)>;
fn exec(root: &Path, local: &Manifest, rm: &Manifest, remote: &dyn Remote, walker: &mut Walker, keep: &dyn Fn(&str, &[u8]) -> io::Result<()>, a: &Action) -> Result<Ups, String> {
    let abs = |p: &str| root.join(p);
    let io = |e: io::Error| e.to_string();
    let keep = |p: &str, d: &[u8]| keep(p, d).map_err(|e| format!("keeping the old copy: {e}"));
    // the remote file, checked against the manifest the plan was made from
    let fetch = |p: &str| -> Result<(Vec<u8>, Entry), String> {
        let e = rm.get(p).ok_or("not on the remote")?;
        let d = remote.get(p)?;
        if sha256_hex(&d) != e.hash { return Err("remote content does not match its manifest".into()); }
        Ok((d, e.clone()))
    };
    // the local file still as scanned (None: still absent), so a write never clobbers an edit made during the round
    let same = |p: &str| -> Result<Option<Vec<u8>>, String> {
        let d = match fs::read(abs(p)) { Ok(d) => Some(d), Err(e) if e.kind() == ErrorKind::NotFound => None, Err(e) => return Err(e.to_string()) };
        if d.as_deref().map(sha256_hex).as_deref() != local.get(p).map(|e| e.hash.as_str()) { return Err("changed locally during the sync".into()); }
        Ok(d)
    };
    let mut put_local = |e: &Entry, d: &[u8]| -> Result<(), String> { write_atomic(&abs(&e.path), d, Some(e.mtime)).map_err(io)?; walker.note(e); Ok(()) };
    match a {
        Action::Push(_) => unreachable!("pushes go in batches, in run()"),
        Action::Pull(p) => {
            let (d, e) = fetch(p)?;
            if let Some(old) = same(p)? { if shrinks(&old, &d) { keep(p, &old)?; } }
            put_local(&e, &d)?;
            Ok(vec![(p.clone(), Some(e))])
        }
        Action::DeleteRemote(p) => { remote.delete(p, &rm[p].hash)?; Ok(vec![(p.clone(), None)]) }
        Action::DeleteLocal(p) => {
            if let Some(old) = same(p)? { keep(p, &old)?; }
            let f = abs(p);
            fs::remove_file(&f).map_err(io)?;
            // empty parents go too, up to the root; remove_dir fails on a non-empty dir or a symlink, which ends it
            let mut dir = f.parent();
            while let Some(d) = dir.filter(|d| *d != root && d.starts_with(root)) { if fs::remove_dir(d).is_err() { break; } dir = d.parent(); }
            Ok(vec![(p.clone(), None)])
        }
        Action::Conflict { path, copy } => {
            if fs::symlink_metadata(abs(copy)).is_ok() || local.contains_key(copy) || rm.contains_key(copy) { return Err(format!("conflict copy {copy} already exists")); }
            let (d, r) = fetch(path)?;
            let c = Entry { path: copy.clone(), ..r };
            put_local(&c, &d)?; // the remote version is safe on this disk before the remote one is overwritten
            remote.put(copy, &d, c.mtime, "")?;
            let l = same(path)?.ok_or("gone locally")?;
            let le = local[path].clone();
            remote.put(path, &l, le.mtime, &rm[path].hash)?;
            Ok(vec![(copy.clone(), Some(c)), (path.clone(), Some(le))])
        }
        Action::Merge(p) => {
            let (rd, _) = fetch(p)?;
            let ld = same(p)?.ok_or("gone locally")?;
            let (Ok(l), Ok(r)) = (std::str::from_utf8(&ld), std::str::from_utf8(&rd)) else { return Err("not text, cannot merge lines".into()) };
            let m = merge_lines(l, r).into_bytes();
            let e = Entry { path: p.clone(), size: m.len() as u64, mtime: now(), hash: sha256_hex(&m) };
            put_local(&e, &m)?;
            remote.put(p, &m, e.mtime, &rm[p].hash)?;
            Ok(vec![(p.clone(), Some(e))])
        }
    }
}

/// Write via a temp file in the same directory (".relay-sync-…"), fsync, rename: a reader or a crash sees the old file or
/// the new one, never half. Creates parent dirs, keeps an existing file's permissions, writes through a symlinked file
/// to its target (the link stays), and sets the mtime when given.
pub fn write_atomic(path: &Path, data: &[u8], mtime: Option<i64>) -> io::Result<()> {
    static N: AtomicU64 = AtomicU64::new(0);
    let path = match fs::symlink_metadata(path) { Ok(m) if m.file_type().is_symlink() => fs::canonicalize(path).unwrap_or(path.into()), _ => path.into() };
    let dir = path.parent().ok_or_else(|| io::Error::other("no parent directory"))?;
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{TMP}{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
    let r = (|| {
        let mut f = File::create(&tmp)?;
        f.write_all(data)?;
        if let Ok(m) = fs::metadata(&path) { f.set_permissions(m.permissions())?; }
        if let Some(t) = mtime { f.set_modified(time(t))?; }
        f.sync_all()?;
        fs::rename(&tmp, &path)
    })();
    if r.is_err() { fs::remove_file(&tmp).ok(); }
    r
}

/// Reject paths that would escape the root: absolute, "..", "." segments, empty segments, NUL, backslashes. Used by both
/// sides before touching disk.
pub fn safe_rel(rel: &str) -> bool {
    !rel.is_empty() && !rel.contains(['\0', '\\']) && rel.split('/').all(|s| !s.is_empty() && s != "." && s != "..")
}

pub fn sha256_hex(data: &[u8]) -> String {
    ring::digest::digest(&ring::digest::SHA256, data).as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::os::unix::fs::symlink;

    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Tmp {
            let p = std::env::temp_dir().join(format!("relay-sync-test-{}-{tag}", std::process::id()));
            fs::remove_dir_all(&p).ok();
            fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
        fn put(&self, p: &str, s: &str) { let f = self.0.join(p); fs::create_dir_all(f.parent().unwrap()).unwrap(); fs::write(f, s).unwrap(); }
        fn read(&self, p: &str) -> Option<String> { fs::read_to_string(self.0.join(p)).ok() }
    }
    impl Drop for Tmp { fn drop(&mut self) { fs::remove_dir_all(&self.0).ok(); } }

    // ---------- plan

    fn man(xs: &[(&str, &str)]) -> Manifest {
        xs.iter().map(|(p, h)| (p.to_string(), Entry { path: p.to_string(), size: 0, mtime: 0, hash: h.to_string() })).collect()
    }
    fn two(b: &[(&str, &str)], l: &[(&str, &str)], r: &[(&str, &str)]) -> Vec<Action> {
        plan(Mode::TwoWay, &man(b), &man(l), &man(r), &|p| format!("{p}.copy"), &|p| p.ends_with("MEMORY.md")).0
    }
    use Action::*;
    fn s(p: &str) -> String { p.into() }

    #[test] fn same_hash_or_both_absent_is_nothing() {
        assert_eq!(two(&[("a", "1")], &[("a", "2")], &[("a", "2")]), vec![]);
        assert_eq!(two(&[("a", "1")], &[], &[]), vec![]);
    }
    #[test] fn local_change_pushes() { assert_eq!(two(&[("a", "1")], &[("a", "2"), ("n", "1")], &[("a", "1")]), vec![Push(s("a")), Push(s("n"))]); }
    #[test] fn remote_change_pulls() { assert_eq!(two(&[("a", "1")], &[("a", "1")], &[("a", "2"), ("n", "1")]), vec![Pull(s("a")), Pull(s("n"))]); }
    #[test] fn delete_on_one_side_unchanged_other() {
        assert_eq!(two(&[("a", "1")], &[], &[("a", "1")]), vec![DeleteRemote(s("a"))]);
        assert_eq!(two(&[("a", "1")], &[("a", "1")], &[]), vec![DeleteLocal(s("a"))]);
    }
    #[test] fn delete_against_modify_keeps_the_modified() {
        assert_eq!(two(&[("a", "1")], &[], &[("a", "2")]), vec![Pull(s("a"))]);
        assert_eq!(two(&[("a", "1")], &[("a", "2")], &[]), vec![Push(s("a"))]);
    }
    #[test] fn both_changed_conflict_or_merge() {
        assert_eq!(two(&[("a", "1")], &[("a", "2")], &[("a", "3")]), vec![Conflict { path: s("a"), copy: s("a.copy") }]);
        assert_eq!(two(&[], &[("a", "2")], &[("a", "3")]), vec![Conflict { path: s("a"), copy: s("a.copy") }]); // new on both
        assert_eq!(two(&[("x/MEMORY.md", "1")], &[("x/MEMORY.md", "2")], &[("x/MEMORY.md", "3")]), vec![Merge(s("x/MEMORY.md"))]);
    }
    #[test] fn replica_overwrites_the_remote() {
        let acts = plan(Mode::Replica, &man(&[("a", "1")]), &man(&[("a", "1"), ("b", "2")]), &man(&[("a", "9"), ("b", "3"), ("c", "4")]), &|p| p.into(), &|_| true).0;
        assert_eq!(acts, vec![Push(s("a")), Push(s("b")), DeleteRemote(s("c"))]);
    }
    #[test] fn case_clash_skipped() {
        let (acts, skipped) = plan(Mode::TwoWay, &man(&[]), &man(&[("Notes/a.md", "1"), ("b", "1")]), &man(&[("Notes/A.md", "2")]), &|p| p.into(), &|_| false);
        assert_eq!(acts, vec![Push(s("b"))]);
        assert_eq!(skipped, vec![s("Notes/A.md"), s("Notes/a.md")]);
    }

    // ---------- walker

    fn keys(m: &Manifest) -> Vec<&str> { m.keys().map(String::as_str).collect() }

    #[test] fn walker_rehashes_only_on_size_or_mtime_change() {
        let t = Tmp::new("rehash");
        t.put("a.md", "one"); t.put("b/c.md", "two");
        let (mut w, f) = (Walker::default(), Filter::vault_default());
        assert_eq!(w.scan(&t.0, &f).unwrap().0.len(), 2);
        assert_eq!(w.hashed, 2);
        w.scan(&t.0, &f).unwrap();
        assert_eq!(w.hashed, 2);
        // same size, other content: the mtime gives it away
        fs::write(t.0.join("a.md"), "uno").unwrap();
        File::options().write(true).open(t.0.join("a.md")).unwrap().set_modified(time(1000)).unwrap();
        let m = w.scan(&t.0, &f).unwrap().0;
        assert_eq!((w.hashed, m["a.md"].hash.as_str(), m["a.md"].mtime), (3, sha256_hex(b"uno").as_str(), 1000));
        assert_eq!(Walker::default().scan(&t.0.join("missing"), &f).unwrap(), Default::default());
    }
    #[test] fn walker_filters() {
        let t = Tmp::new("filter");
        for p in [".git/config", "x/.obsidian/w.json", "Communication/transcripts/t.md", "Communication/n.md", "ok.md", ".relay-sync-1-0"] { t.put(p, "x"); }
        t.put("big.bin", &"x".repeat(100));
        let f = Filter { names: vec![s(".git"), s(".obsidian")], prefixes: vec![s("Communication/transcripts/")], max_size: 50 };
        let (m, skipped) = Walker::default().scan(&t.0, &f).unwrap();
        assert_eq!(keys(&m), vec!["Communication/n.md", "ok.md"]);
        assert_eq!(skipped, vec![s("big.bin")]);
    }
    #[test] fn walker_follows_dir_links_but_not_cycles() {
        let t = Tmp::new("links");
        t.put("real/f.md", "x");
        symlink(t.0.join("real"), t.0.join("link")).unwrap();
        symlink(&t.0, t.0.join("real/loop")).unwrap(); // back to the root
        symlink(t.0.join("real/f.md"), t.0.join("lf.md")).unwrap();
        symlink(t.0.join("nowhere"), t.0.join("dangling")).unwrap();
        let (m, _) = Walker::default().scan(&t.0, &Filter::vault_default()).unwrap();
        assert_eq!(keys(&m), vec!["lf.md", "link/f.md", "real/f.md"]);
    }

    // ---------- run

    #[derive(Default)]
    struct Mem { files: RefCell<BTreeMap<String, (Vec<u8>, i64)>>, corrupt: Cell<bool>, after_manifest: RefCell<Option<(String, String)>> }
    impl Remote for Mem {
        fn manifest(&self) -> Result<Manifest, String> {
            let m = self.files.borrow().iter().map(|(p, (d, t))| (p.clone(), Entry { path: p.clone(), size: d.len() as u64, mtime: *t, hash: sha256_hex(d) })).collect();
            if let Some((p, d)) = self.after_manifest.take() { self.set(&p, &d); }
            Ok(m)
        }
        fn get(&self, p: &str) -> Result<Vec<u8>, String> {
            let mut d = self.files.borrow().get(p).ok_or("missing")?.0.clone();
            if self.corrupt.replace(false) { d.push(b'!'); }
            Ok(d)
        }
        fn put(&self, p: &str, d: &[u8], t: i64, x: &str) -> Result<(), String> {
            let mut f = self.files.borrow_mut();
            if f.get(p).map(|(d, _)| sha256_hex(d)).unwrap_or_default() != x { return Err("changed meanwhile".into()); }
            f.insert(p.into(), (d.into(), t));
            Ok(())
        }
        fn delete(&self, p: &str, h: &str) -> Result<(), String> {
            let mut f = self.files.borrow_mut();
            if f.get(p).is_some_and(|(d, _)| sha256_hex(d) == h) { f.remove(p); Ok(()) } else { Err("changed meanwhile".into()) }
        }
    }
    impl Mem {
        fn set(&self, p: &str, c: &str) { self.files.borrow_mut().insert(p.into(), (c.as_bytes().into(), 1_700_000_000)); }
        fn read(&self, p: &str) -> Option<String> { self.files.borrow().get(p).map(|(d, _)| String::from_utf8(d.clone()).unwrap()) }
    }

    // a server's batches: counts the requests, refuses one file
    struct Batches<'a> { mem: &'a Mem, calls: Cell<usize>, refuse: &'a str }
    impl Remote for Batches<'_> {
        fn manifest(&self) -> Result<Manifest, String> { self.mem.manifest() }
        fn get(&self, p: &str) -> Result<Vec<u8>, String> { self.mem.get(p) }
        fn put(&self, _: &str, _: &[u8], _: i64, _: &str) -> Result<(), String> { Err("one by one".into()) }
        fn delete(&self, p: &str, h: &str) -> Result<(), String> { self.mem.delete(p, h) }
        fn put_many(&self, files: &[(String, Vec<u8>, i64, String)]) -> Result<Vec<Option<String>>, String> {
            self.calls.set(self.calls.get() + 1);
            Ok(files.iter().map(|(p, d, m, x)| if p == self.refuse { Some("refused".into()) } else { self.mem.put(p, d, *m, x).err() }).collect())
        }
    }
    #[test]
    fn pushes_go_in_batches() {
        let (t, mut w, mem) = (Tmp::new("batches"), Walker::default(), Mem::default());
        for i in 0..1100 { t.put(&format!("n/{i:04}.md"), "x"); }
        let remote = Batches { mem: &mem, calls: Cell::new(0), refuse: "n/0007.md" };
        let last = Cell::new((0, 0));
        let (base, r) = run(Mode::TwoWay, &t.0, &Manifest::new(), &mut w, &Filter::vault_default(), &remote, &|p| p.into(), &|_| false, OPEN, &|d, n| last.set((d, n)));
        assert_eq!(remote.calls.get(), 3, "500 files a request");
        assert_eq!((r.pushed.len(), r.errors.clone()), (1099, vec!["n/0007.md: refused".to_string()]));
        assert!(!base.contains_key("n/0007.md") && base.contains_key("n/0008.md"), "the refused file is retried next round");
        assert_eq!(last.get(), (1100, 1100));
    }

    const COPY: &str = "a (conflict srv 2026-10-02 1530).md";
    const OPEN: &Guard = &Guard { allow_deletes: true, keep: &|_, _| Ok(()) };
    fn round_with(t: &Tmp, base: &Manifest, w: &mut Walker, mem: &Mem, g: &Guard) -> (Manifest, Report) {
        run(Mode::TwoWay, &t.0, base, w, &Filter::vault_default(), mem, &|p| conflict_copy(p, "srv", "2026-10-02 1530"), &|p| p.ends_with("MEMORY.md"), g, &|_, _| {})
    }
    fn round(t: &Tmp, base: &Manifest, w: &mut Walker, mem: &Mem) -> (Manifest, Report) { round_with(t, base, w, mem, OPEN) }
    // a second round plans nothing, keeps the base and reads no file again
    fn noop(t: &Tmp, base: &Manifest, w: &mut Walker, mem: &Mem) {
        let h = w.hashed;
        let (b, r) = round(t, base, w, mem);
        assert_eq!((r, &b, w.hashed), (Report::default(), base, h));
    }
    // four files, synced once
    fn synced(tag: &str) -> (Tmp, Walker, Mem, Manifest) {
        let (t, mut w, mem) = (Tmp::new(tag), Walker::default(), Mem::default());
        for (p, c) in [("a.md", "a"), ("Notes/b.md", "b"), ("c.md", "c"), ("MEMORY.md", "- a\n- b\n")] { t.put(p, c); }
        t.put(".obsidian/app.json", "{}");
        let (base, r) = round(&t, &Manifest::new(), &mut w, &mem);
        assert_eq!(r.pushed, vec!["MEMORY.md", "Notes/b.md", "a.md", "c.md"]);
        assert_eq!(mem.read("Notes/b.md").as_deref(), Some("b"));
        noop(&t, &base, &mut w, &mem);
        (t, w, mem, base)
    }

    #[test] fn first_sync_pushes_all() { synced("first"); }
    #[test] fn remote_edit_pulled() {
        let (t, mut w, mem, base) = synced("pull");
        mem.set("Notes/b.md", "remote b");
        let (base, r) = round(&t, &base, &mut w, &mem);
        assert_eq!((r.pulled, t.read("Notes/b.md").as_deref()), (vec![s("Notes/b.md")], Some("remote b")));
        noop(&t, &base, &mut w, &mem);
    }
    #[test] fn deletes_propagate_both_ways() {
        let (t, mut w, mem, base) = synced("delete");
        fs::remove_file(t.0.join("a.md")).unwrap();
        let (base, r) = round(&t, &base, &mut w, &mem);
        assert_eq!((r.deleted_remote, mem.read("a.md")), (vec![s("a.md")], None));
        noop(&t, &base, &mut w, &mem);
        mem.files.borrow_mut().remove("Notes/b.md");
        let (base, r) = round(&t, &base, &mut w, &mem);
        assert_eq!(r.deleted_local, vec![s("Notes/b.md")]);
        assert!(!t.0.join("Notes").exists()); // empty parent pruned
        noop(&t, &base, &mut w, &mem);
    }
    #[test] fn conflict_keeps_both_on_both_sides() {
        let (t, mut w, mem, base) = synced("conflict");
        t.put("a.md", "local a2");
        mem.set("a.md", "remote a2");
        let (base, r) = round(&t, &base, &mut w, &mem);
        assert_eq!(r.conflicts, vec![s(COPY)]);
        assert_eq!((t.read("a.md").as_deref(), t.read(COPY).as_deref()), (Some("local a2"), Some("remote a2")));
        assert_eq!((mem.read("a.md").as_deref(), mem.read(COPY).as_deref()), (Some("local a2"), Some("remote a2")));
        noop(&t, &base, &mut w, &mem);
    }
    #[test] fn index_merged_on_both_sides() {
        let (t, mut w, mem, base) = synced("merge");
        t.put("MEMORY.md", "- a\n- b\n- local\n");
        mem.set("MEMORY.md", "- a\n- remote\n- b\n");
        let (base, r) = round(&t, &base, &mut w, &mem);
        assert_eq!(r.merged, vec![s("MEMORY.md")]);
        let want = "- a\n- b\n- local\n- remote\n";
        assert_eq!((t.read("MEMORY.md").as_deref(), mem.read("MEMORY.md").as_deref()), (Some(want), Some(want)));
        noop(&t, &base, &mut w, &mem);
    }
    #[test] fn corrupt_get_is_an_error_and_retried() {
        let (t, mut w, mem, base) = synced("corrupt");
        mem.set("c.md", "remote c");
        mem.corrupt.set(true);
        let (b2, r) = round(&t, &base, &mut w, &mem);
        assert_eq!((r.errors.len(), r.pulled.len(), t.read("c.md").as_deref()), (1, 0, Some("c")));
        assert_eq!(b2["c.md"], base["c.md"]);
        let (base, r) = round(&t, &b2, &mut w, &mem);
        assert_eq!((r.pulled, t.read("c.md").as_deref()), (vec![s("c.md")], Some("remote c")));
        noop(&t, &base, &mut w, &mem);
    }
    #[test] fn stale_delete_fails_without_loss() {
        let (t, mut w, mem, base) = synced("stale");
        fs::remove_file(t.0.join("a.md")).unwrap();
        *mem.after_manifest.borrow_mut() = Some((s("a.md"), s("edited on the server meanwhile")));
        let (base, r) = round(&t, &base, &mut w, &mem);
        assert_eq!(r.errors.len(), 1);
        assert_eq!(mem.read("a.md").as_deref(), Some("edited on the server meanwhile"));
        let (base, r) = round(&t, &base, &mut w, &mem); // deleted here, modified there: the modification wins
        assert_eq!((r.pulled, t.read("a.md").as_deref()), (vec![s("a.md")], Some("edited on the server meanwhile")));
        noop(&t, &base, &mut w, &mem);
    }
    #[test] fn push_never_overwrites_an_edit_made_there_meanwhile() {
        let (t, mut w, mem, base) = synced("race");
        t.put("a.md", "edited here");
        *mem.after_manifest.borrow_mut() = Some((s("a.md"), s("the agent's edit"))); // between manifest and push
        let (base, r) = round(&t, &base, &mut w, &mem);
        assert_eq!((r.pushed.len(), r.errors.clone()), (0, vec![s("a.md: changed meanwhile")]));
        assert_eq!(mem.read("a.md").as_deref(), Some("the agent's edit"));
        let (base, r) = round(&t, &base, &mut w, &mem); // changed on both: both kept
        assert_eq!(r.conflicts, vec![s(COPY)]);
        assert_eq!((t.read("a.md").as_deref(), t.read(COPY).as_deref()), (Some("edited here"), Some("the agent's edit")));
        noop(&t, &base, &mut w, &mem);
        // a new file there with the same name, made meanwhile: not pushed over either
        t.put("new.md", "here");
        *mem.after_manifest.borrow_mut() = Some((s("new.md"), s("there")));
        let (_, r) = round(&t, &base, &mut w, &mem);
        assert_eq!((r.errors, mem.read("new.md").as_deref()), (vec![s("new.md: changed meanwhile")], Some("there")));
    }
    #[test] fn many_deletes_wait_for_the_user() {
        let (t, mut w, mem) = (Tmp::new("held"), Walker::default(), Mem::default());
        for i in 0..30 { t.put(&format!("n/{i:02}.md"), "x"); }
        let (base, _) = round(&t, &Manifest::new(), &mut w, &mem);
        let kept = RefCell::new(vec![]);
        let keep = |p: &str, d: &[u8]| { kept.borrow_mut().push((p.to_string(), d.to_vec())); Ok(()) };
        let shut = Guard { allow_deletes: false, keep: &keep };
        // 6 of 30 gone there: a fifth, under the cap of 6, goes through, each kept first
        for i in 0..6 { mem.files.borrow_mut().remove(&format!("n/{i:02}.md")); }
        let (base, r) = round_with(&t, &base, &mut w, &mem, &shut);
        assert_eq!((r.deleted_local.len(), r.held.len(), kept.borrow().len()), (6, 0, 6));
        assert_eq!(kept.borrow()[0], (s("n/00.md"), b"x".to_vec()));
        // 7 of the 24 left: held, every round again, nothing deleted here
        for i in 6..13 { mem.files.borrow_mut().remove(&format!("n/{i:02}.md")); }
        let (base, r) = round_with(&t, &base, &mut w, &mem, &shut);
        assert_eq!((r.deleted_local.len(), r.held.len(), r.pulled.len()), (0, 7, 0));
        assert!(t.read("n/06.md").is_some());
        let (base, r) = round_with(&t, &base, &mut w, &mem, &shut);
        assert_eq!(r.held.len(), 7);
        // the user lets them through
        let (base, r) = round_with(&t, &base, &mut w, &mem, &Guard { allow_deletes: true, keep: &keep });
        assert_eq!((r.deleted_local.len(), r.held.len(), t.read("n/06.md")), (7, 0, None));
        noop(&t, &base, &mut w, &mem);
        // a Replica is not braked: its remote is only a copy
        for i in 13..30 { fs::remove_file(t.0.join(format!("n/{i:02}.md"))).unwrap(); }
        t.put("left.md", "x");
        let (_, r) = run(Mode::Replica, &t.0, &base, &mut w, &Filter::vault_default(), &mem, &|p| p.into(), &|_| false, &shut, &|_, _| {});
        assert_eq!((r.deleted_remote.len(), r.held.len()), (17, 0));
    }
    #[test] fn restoring_held_deletes_is_dropping_them_from_the_base() {
        let (t, mut w, mem) = (Tmp::new("restore"), Walker::default(), Mem::default());
        for i in 0..10 { t.put(&format!("{i}.md"), "x"); }
        let (mut base, _) = round(&t, &Manifest::new(), &mut w, &mem);
        for i in 0..8 { mem.files.borrow_mut().remove(&format!("{i}.md")); }
        let shut = Guard { allow_deletes: false, keep: &|_, _| Ok(()) };
        let (b2, r) = round_with(&t, &base, &mut w, &mem, &shut);
        assert_eq!(r.held.len(), 8);
        base = b2;
        for p in &r.held { base.remove(p); }
        let (base, r) = round_with(&t, &base, &mut w, &mem, &shut);
        assert_eq!((r.pushed.len(), r.held.len(), mem.files.borrow().len()), (8, 0, 10));
        noop(&t, &base, &mut w, &mem);
    }
    #[test] fn a_pull_that_empties_a_file_keeps_the_old_one_first() {
        let (t, mut w, mem, base) = synced("shrink");
        let long = "a line of a note that matters\n".repeat(10);
        t.put("c.md", &long);
        let (base, _) = round(&t, &base, &mut w, &mem);
        let kept = RefCell::new(vec![]);
        let keep = |p: &str, d: &[u8]| { kept.borrow_mut().push((p.to_string(), d.to_vec())); Ok(()) };
        mem.set("c.md", "short");
        let (base, r) = round_with(&t, &base, &mut w, &mem, &Guard { allow_deletes: false, keep: &keep });
        assert_eq!((r.pulled, t.read("c.md").as_deref()), (vec![s("c.md")], Some("short")));
        assert_eq!(kept.borrow().as_slice(), [(s("c.md"), long.as_bytes().to_vec())]);
        // an ordinary edit there is no reason to keep anything
        mem.set("c.md", "short, and a bit longer");
        round_with(&t, &base, &mut w, &mem, &Guard { allow_deletes: false, keep: &keep });
        assert_eq!(kept.borrow().len(), 1);
    }
    #[test] fn a_copy_that_cannot_be_kept_keeps_the_file() {
        let (t, mut w, mem, base) = synced("nokeep");
        mem.files.borrow_mut().remove("c.md");
        let (b2, r) = round_with(&t, &base, &mut w, &mem, &Guard { allow_deletes: false, keep: &|_, _| Err(io::Error::other("disk full")) });
        assert_eq!((r.errors, t.read("c.md").as_deref()), (vec![s("c.md: keeping the old copy: disk full")], Some("c")));
        assert_eq!(b2["c.md"], base["c.md"], "retried next round");
    }
    #[test] fn empty_side_refused() {
        let (t, mut w, mem, base) = synced("empty");
        fs::remove_dir_all(&t.0).unwrap();
        let (b2, r) = round(&t, &base, &mut w, &mem);
        assert_eq!((r.errors.len(), &b2, mem.files.borrow().len()), (1, &base, 4));
    }

    // ---------- helpers

    #[test] fn safe_rel_cases() {
        for bad in ["../x", "/x", "a//b", "a\\b", "a/../b", "./a", "", "a/", "a\0b"] { assert!(!safe_rel(bad), "{bad}"); }
        assert!(safe_rel("Notes/A b.md"));
    }
    #[test] fn conflict_copy_cases() {
        assert_eq!(conflict_copy("Notes/A.md", "LServer", "2026-10-02 1530"), "Notes/A (conflict LServer 2026-10-02 1530).md");
        assert_eq!(conflict_copy("Makefile", "m", "s"), "Makefile (conflict m s)");
        assert_eq!(conflict_copy("x/.env", "m", "s"), "x/.env (conflict m s)");
        assert_eq!(conflict_copy("v1.2/notes", "m", "s"), "v1.2/notes (conflict m s)");
        assert_eq!(conflict_copy("a.tar.gz", "m", "s"), "a.tar (conflict m s).gz");
    }
    #[test] fn merge_lines_cases() {
        assert_eq!(merge_lines("a\nb\n", "a\nc\n"), "a\nb\nc\n");
        assert_eq!(merge_lines("a\nb", "b\nc"), "a\nb\nc");
        assert_eq!(merge_lines("a\n", "a\n"), "a\n");
        assert_eq!(merge_lines("", "x\n"), "x\n");
        assert_eq!(merge_lines("", ""), "");
        assert_eq!(merge_lines("a\n\nb\n", "c\nc\n"), "a\n\nb\nc\n"); // local blank lines kept, a new line once
    }
}
