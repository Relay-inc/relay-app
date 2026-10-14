//! What the app and a relay-server say to each other once TLS is up. Every connection starts with one JSON line from
//! the app, the request. Most get one JSON line back, `{"ok":true,…}` or `{"ok":false,"error":"…"}`, and close.
//! `launch` and `attach` then carry the broker's own frames (broker.rs) both ways, untouched, until either side goes.
//!
//! Requests: `info`, `list` (the brokers that run), `kill {key,pid}`, `pending` (open permission cards), `answer
//! {id,decision}`, `history {sid,from,cwd}`, `exists {path}`, `launch {meta,spec}`, `attach {key}`, the mirror's
//! `unlock {key}`, `sync_manifest {root}`, `sync_get {root,path}` (the reply line has `len`, the bytes follow),
//! `sync_put {root,path,len,mtime}` (the bytes follow the request line), `sync_put_many {root,files:[{path,len,mtime}]}`
//! (the files' bytes follow one after the other, the reply has `errors` per path), `sync_delete {root,path,hash}`, `wipe`, moving
//! a conversation's `session_get {sid}` (len and bytes like sync_get) and `session_put {sid,cwd,len}` (bytes follow),
//! `update {version,sha256,len}` (relay-server's binary follows, the server goes on in it after the reply),
//! GitHub there (github.rs on the server): `github_status`, `github_login_start` (a device flow: the code to type),
//! `github_login_poll`, `github_logout`, and its repos: `repos`, `repo_ensure {repo}` (an `owner/repo` on GitHub,
//! cloned when it is not there yet), `repo_push {name}`, `repo_snapshot {name,branch}` (the work there as one commit on
//! `relay/…`, pushed), and from a device that is not paired yet only `pair {name,proof}`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, BufRead, Read, Write};

/// The port a relay-server listens on unless told otherwise.
pub const PORT: u16 = 47800;
/// Bumped when a request changes shape; the app refuses a server that speaks another one.
pub const PROTO: u32 = 3;
/// A request line is small; a line this long is refused before it fills memory. A launch carries the whole command
/// (Claude's MCP config included), which stays well under this.
pub const MAX_LINE: u64 = 1 << 20;

/// What a server tells the app about itself, so the app can build commands for that machine: its paths, its login
/// PATH, where its `claude` is and its pending folder.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Info {
    pub host: String,
    pub os: String,
    pub version: String,
    pub proto: u32,
    pub home: String,
    pub path: String,
    pub claude: String,
    pub pending: String,
    /// The device's mirror working copy (`<work>/<root>`), whether its key is there, and whether it is on a RAM disk.
    #[serde(default)]
    pub work: String,
    #[serde(default)]
    pub mirror_open: bool,
    #[serde(default)]
    pub in_ram: bool,
    /// The CPU (`x86_64`, `aarch64`), and whether the server takes an `update` (not Relay on a Mac).
    #[serde(default)]
    pub arch: String,
    #[serde(default)]
    pub update: bool,
    /// Where its repos are cloned; empty for a server from before GitHub there.
    #[serde(default)]
    pub repos: String,
}

/// GitHub on a server for one device. `state`: `off` (no token), `pending` (a device flow waits for the user),
/// `on`, `locked` (a token, but the mirror's key is not there yet), `expired`, `denied` or `error` (with `error`).
/// `since` is the day the token came (YYYY-MM-DD); `name` and `email` what the server's commits say.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Github { pub state: String, pub login: String, pub since: String, pub name: String, pub email: String, pub error: String }

/// A device flow under way: type `user_code` at `verification_uri`; it expires after `expires_in` s, ask every `interval` s.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct DeviceCode { pub user_code: String, pub verification_uri: String, pub expires_in: u64, pub interval: u64 }

/// One repo there: its folder `name` under the repos folder, `repo` the `owner/repo` of its origin, the branch checked
/// out, whether there is work not committed, and how many commits its upstream lacks.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct RepoStatus { pub name: String, pub path: String, pub repo: String, pub branch: String, pub dirty: bool, pub unpushed: u32 }

/// A snapshot pushed: the branch on GitHub and its commit.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Snapshot { pub branch: String, pub commit: String }

/// One JSON line, at most `max` bytes. EOF before any byte is an error too: a request or an answer always comes.
pub fn read_json<R: BufRead>(r: &mut R, max: u64) -> io::Result<Value> {
    let mut s = String::new();
    let n = r.by_ref().take(max).read_line(&mut s)?;
    if n == 0 { return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "connection closed")); }
    if !s.ends_with('\n') { return Err(io::Error::new(io::ErrorKind::InvalidData, "line too long")); }
    serde_json::from_str(&s).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}
pub fn write_json<W: Write>(w: &mut W, v: &Value) -> io::Result<()> {
    writeln!(w, "{v}")?;
    w.flush()
}

/// A reply can be big (a manifest of a few thousand files); still bounded.
pub const MAX_REPLY: u64 = 64 << 20;
/// A Claude session's transcript, moved with its conversation: long sessions run to tens of MB.
pub const MAX_SESSION: u64 = 512 << 20;
/// relay-server's binary in an `update`.
pub const MAX_BINARY: u64 = 128 << 20;
/// Exactly `len` raw bytes after a JSON line: a file in `sync_get` and `sync_put`.
pub fn read_body<R: BufRead>(r: &mut R, len: u64, max: u64) -> io::Result<Vec<u8>> {
    if len > max { return Err(io::Error::new(io::ErrorKind::InvalidData, "file too big")); }
    let mut v = vec![0; len as usize];
    r.read_exact(&mut v)?;
    Ok(v)
}

/// The line `relay-server pair` prints: where the server is, the fingerprint of its certificate and the one-time code.
/// `relay://192.168.1.2:47800#fp=<64 hex>&code=<32 hex>`. A line Relay makes for a phone (pair_device) also carries the
/// key to the laptop's mirror there, `&key=<64 hex>`, so the phone can open it while the laptop is closed.
#[derive(Clone, Debug, PartialEq)]
pub struct PairLine { pub host: String, pub port: u16, pub fp: String, pub code: String, pub key: Option<String> }
impl PairLine {
    pub fn parse(s: &str) -> Option<PairLine> {
        let (addr, frag) = s.trim().strip_prefix("relay://")?.split_once('#')?;
        let (host, port) = addr.rsplit_once(':')?;
        let host = host.trim_start_matches('[').trim_end_matches(']');
        let hex = |v: &str, n: usize| v.len() == n && v.chars().all(|c| c.is_ascii_hexdigit());
        let (mut fp, mut code, mut key) = (None, None, None);
        for kv in frag.split('&') {
            match kv.split_once('=') {
                Some(("fp", v)) if hex(v, 64) => fp = Some(v.to_lowercase()),
                Some(("code", v)) if hex(v, 32) => code = Some(v.to_lowercase()),
                Some(("key", v)) if hex(v, 64) => key = Some(v.to_lowercase()),
                _ => {}
            }
        }
        let ok_host = !host.is_empty() && host.len() <= 253 && host.chars().all(|c| c.is_ascii_alphanumeric() || ".-:".contains(c));
        ok_host.then_some(())?;
        Some(PairLine { host: host.into(), port: port.parse().ok()?, fp: fp?, code: code?, key })
    }
    pub fn format(&self) -> String {
        let host = if self.host.contains(':') { format!("[{}]", self.host) } else { self.host.clone() };
        let key = self.key.as_ref().map(|k| format!("&key={k}")).unwrap_or_default();
        format!("relay://{host}:{}#fp={}&code={}{key}", self.port, self.fp, self.code)
    }
    /// "host:port" for a TCP connect, IPv6 in brackets.
    pub fn addr(&self) -> String { addr(&self.host, self.port) }
}
pub fn addr(host: &str, port: u16) -> String { if host.contains(':') { format!("[{host}]:{port}") } else { format!("{host}:{port}") } }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pair_line_round_trip() {
        let fp = "a".repeat(64);
        let code = "0123456789abcdef0123456789ABCDEF";
        let l = PairLine::parse(&format!("  relay://192.168.1.2:47800#fp={fp}&code={code}\n")).unwrap();
        assert_eq!((l.host.as_str(), l.port, l.code.as_str()), ("192.168.1.2", 47800, "0123456789abcdef0123456789abcdef"));
        assert_eq!(PairLine::parse(&l.format()), Some(l.clone()));
        let v6 = PairLine { host: "fe80::1".into(), ..l.clone() };
        assert_eq!(PairLine::parse(&v6.format()), Some(v6.clone()));
        assert_eq!(v6.addr(), "[fe80::1]:47800");
        let phone = PairLine { key: Some("b".repeat(64)), ..l.clone() };
        assert_eq!(PairLine::parse(&phone.format()), Some(phone.clone()));
        assert_eq!(PairLine::parse(&format!("{}&key=short", l.format())).unwrap().key, None);
        for bad in ["relay://h:1#fp=abc&code=0123456789abcdef0123456789abcdef", "http://h:1#fp=&code=", &format!("relay://h x:1#fp={fp}&code={code}"),
                    &format!("relay://h:99999#fp={fp}&code={code}"), &format!("relay://h:1#fp={fp}")] {
            assert!(PairLine::parse(bad).is_none(), "{bad}");
        }
    }
    #[test]
    fn json_lines_are_bounded() {
        let mut ok = io::Cursor::new(b"{\"op\":\"info\"}\n".to_vec());
        assert_eq!(read_json(&mut ok, 100).unwrap()["op"], "info");
        let mut long = io::Cursor::new(format!("{{\"x\":\"{}\"}}\n", "y".repeat(200)).into_bytes());
        assert!(read_json(&mut long, 100).is_err());
        assert!(read_json(&mut io::Cursor::new(vec![]), 100).is_err());
    }
}
