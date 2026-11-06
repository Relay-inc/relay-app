//! Small helpers every provider needs: the home folder, a memo with a time to live, how a command is named in the
//! terminal, stopping a child, finding a session's file.

use crate::Env;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// $HOME, "" when unset.
pub fn home() -> String { std::env::var("HOME").unwrap_or_default() }

/// A value kept for `ttl` per key (the program it was made by): `opencode models` takes a second or two.
pub struct Memo<T>(Mutex<Option<(String, Instant, T)>>);
impl<T: Clone> Memo<T> {
    pub const fn new() -> Self { Memo(Mutex::new(None)) }
    pub fn get(&self, key: &str, ttl: Duration, make: impl FnOnce() -> T) -> T {
        let mut m = self.0.lock().unwrap();
        if let Some((k, at, v)) = m.as_ref() { if k == key && at.elapsed() < ttl { return v.clone(); } }
        let v = make();
        *m = Some((key.into(), Instant::now(), v.clone()));
        v
    }
}
impl<T: Clone> Default for Memo<T> { fn default() -> Self { Self::new() } }

/// The program the last `detect` saw (the settings' override), for calls that have no env, like the model list.
pub struct LastBin(Mutex<String>);
impl LastBin {
    pub const fn new() -> Self { LastBin(Mutex::new(String::new())) }
    pub fn set(&self, bin: &str) { *self.0.lock().unwrap() = bin.into(); }
    /// What `detect` saw, else `default`.
    pub fn get_or(&self, default: impl FnOnce() -> String) -> String {
        let b = self.0.lock().unwrap().clone();
        if b.is_empty() { default() } else { b }
    }
}
impl Default for LastBin { fn default() -> Self { Self::new() } }

/// `s` as one word of a POSIX shell command line.
pub fn quote_sh(s: &str) -> String { format!("'{}'", s.replace('\'', "'\\''")) }

/// How the terminal runs the CLI: by `name` (the user's own on their PATH) when the app uses the default program,
/// else the settings' path, quoted.
pub fn command_for(env: &Env, default_bin: &str, name: &str) -> String {
    if env.bin == default_bin { name.to_string() } else { quote_sh(env.bin) }
}

/// SIGTERM to `pid`.
pub fn terminate(pid: u32) { unsafe { libc::kill(pid as i32, libc::SIGTERM); } }
/// SIGTERM to `child`, SIGKILL when it is still there after `grace`; reaped either way.
pub fn stop(child: &mut Child, grace: Duration) {
    terminate(child.id());
    let end = Instant::now() + grace;
    while Instant::now() < end {
        if child.try_wait().ok().flatten().is_some() { return; }
        std::thread::sleep(Duration::from_millis(20));
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// A session's file under `dir` (any depth), named `<anything><sep><sid>.jsonl`.
pub fn find_session_file(dir: &Path, sid: &str, sep: char) -> Option<PathBuf> {
    let want = format!("{sep}{sid}.jsonl");
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let p = e.path();
        if p.is_dir() { if let Some(f) = find_session_file(&p, sid, sep) { return Some(f); } }
        else if p.to_string_lossy().ends_with(&want) { return Some(p); }
    }
    None
}

/// The system's sqlite3 in read-only mode, for the rows of a provider's own database.
pub mod sqlite {
    use serde_json::Value;
    use std::path::Path;
    use std::process::{Command, Stdio};

    pub const SQLITE: &str = "/usr/bin/sqlite3";

    /// `select …` as JSON rows, read-only; None when there is no database or no sqlite3.
    pub fn query(db: &Path, sql: &str) -> Option<Vec<Value>> {
        if !db.is_file() { return None; }
        let out = Command::new(SQLITE).arg("-readonly").arg("-json").arg(db).arg(sql).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
        if !out.status.success() { return None; }
        let s = String::from_utf8_lossy(&out.stdout);
        // no rows is no output at all
        if s.trim().is_empty() { Some(vec![]) } else { serde_json::from_str(&s).ok() }
    }
    /// `s` as an SQL string literal.
    pub fn quote(s: &str) -> String { format!("'{}'", s.replace('\'', "''")) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn util_helpers() {
        assert_eq!(quote_sh("it's"), "'it'\\''s'");
        let m = Memo::new();
        assert_eq!(m.get("a", Duration::from_secs(60), || 1), 1);
        assert_eq!(m.get("a", Duration::from_secs(60), || 2), 1, "kept");
        assert_eq!(m.get("b", Duration::from_secs(60), || 3), 3, "another key");
        assert_eq!(m.get("b", Duration::ZERO, || 4), 4, "expired");
    }
}
