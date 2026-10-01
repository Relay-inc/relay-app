//! What the app and a relay-server say to each other once TLS is up. Every connection starts with one JSON line from
//! the app, the request. Most get one JSON line back, `{"ok":true,…}` or `{"ok":false,"error":"…"}`, and close.
//! `launch` and `attach` then carry the broker's own frames (broker.rs) both ways, untouched, until either side goes.
//!
//! Requests: `info`, `list` (the brokers that run), `kill {key,pid}`, `pending` (open permission cards), `answer
//! {id,decision}`, `history {sid,from,cwd}`, `exists {path}`, `launch {meta,spec}`, `attach {key}`, and from a device
//! that is not paired yet only `pair {name,proof}`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, BufRead, Read, Write};

/// The port a relay-server listens on unless told otherwise.
pub const PORT: u16 = 47800;
/// Bumped when a request changes shape; the app refuses a server that speaks another one.
pub const PROTO: u32 = 1;
/// A request line is small; a line this long is refused before it fills memory. A launch carries the whole command
/// (Claude's MCP config included), which stays well under this.
pub const MAX_LINE: u64 = 1 << 20;

/// What a server tells the app about itself, so the app can build commands for that machine: its paths, its login
/// PATH, where its `claude` is, its pending folder and its copy of perm_server.py.
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
    pub perm: String,
}

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

/// The line `relay-server pair` prints: where the server is, the fingerprint of its certificate and the one-time code.
/// `relay://192.168.1.2:47800#fp=<64 hex>&code=<32 hex>`
#[derive(Clone, Debug, PartialEq)]
pub struct PairLine { pub host: String, pub port: u16, pub fp: String, pub code: String }
impl PairLine {
    pub fn parse(s: &str) -> Option<PairLine> {
        let (addr, frag) = s.trim().strip_prefix("relay://")?.split_once('#')?;
        let (host, port) = addr.rsplit_once(':')?;
        let host = host.trim_start_matches('[').trim_end_matches(']');
        let hex = |v: &str, n: usize| v.len() == n && v.chars().all(|c| c.is_ascii_hexdigit());
        let (mut fp, mut code) = (None, None);
        for kv in frag.split('&') {
            match kv.split_once('=') { Some(("fp", v)) if hex(v, 64) => fp = Some(v.to_lowercase()), Some(("code", v)) if hex(v, 32) => code = Some(v.to_lowercase()), _ => {} }
        }
        let ok_host = !host.is_empty() && host.len() <= 253 && host.chars().all(|c| c.is_ascii_alphanumeric() || ".-:".contains(c));
        ok_host.then_some(())?;
        Some(PairLine { host: host.into(), port: port.parse().ok()?, fp: fp?, code: code? })
    }
    pub fn format(&self) -> String {
        let host = if self.host.contains(':') { format!("[{}]", self.host) } else { self.host.clone() };
        format!("relay://{host}:{}#fp={}&code={}", self.port, self.fp, self.code)
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
