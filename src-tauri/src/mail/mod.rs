// Native mail access (Gmail and any IMAP server) for the app and its Claude sessions, see /tmp/vaultmail-build/SPEC.md. One IMAP session
// per account, shared by the UI and Claude. Everything reads All Mail through EXAMINE and BODY.PEEK, so reading
// never changes a flag. Only set_seen (a UI click), save_draft (APPEND to Drafts) and, behind the experimental
// mail flag, archive/trash (UI clicks only, no Claude tool) write. There is no path to send. The app
// password comes from the macOS keychain and only lives in memory.
// Gmail reads All Mail through X-GM-RAW; any other server reads INBOX only.

mod render;
mod rpc;

pub use rpc::{rpc, rpc_result, Rpc};

use async_imap::types::{Fetch, Flag, Name, NameAttribute};
use futures::TryStreamExt;
use mail_parser::{Address, HeaderName, HeaderValue, Message, MessageParser, MimeHeaders};
use render::cap;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::net::TcpStream;
use tokio::time::timeout;

const HOST: &str = "imap.gmail.com";
const CONNECT: Duration = Duration::from_secs(15);
const CMD: Duration = Duration::from_secs(30);
const IDLE: Duration = Duration::from_secs(300);
const PAGE: usize = 50;
// ponytail: Gmail's own ceiling, a mail is read whole into memory
const MSG_MAX: u32 = 50 * 1024 * 1024;
const THREAD_BODY_MAX: u32 = 1024 * 1024;
const DRAFT_MAX: usize = 5 * 1024 * 1024;
const KEYCHAIN_WAIT: Duration = Duration::from_secs(60);
const STALE: &str = "The mailbox changed on the server, reload the list";
const SUBJECT_MAX: usize = 500;
// ponytail: "someone you wrote to" = the recipients of your newest 500 sent mails, a full scan when that misses people
const SENT_SCAN: usize = 500;
const MOVE_MAX: usize = 500;
// Finder runs these on a double-click, Mail refuses them too
const RUNS: &[&str] = &["terminal", "command", "tool", "fileloc", "inetloc", "webloc", "app", "pkg", "scpt", "applescript", "workflow", "jar"];

#[derive(Clone, Debug, PartialEq)]
pub struct Account { pub email: String, pub keychain_service: String, pub keychain_account: String, pub host: String, pub port: u16 }

/// A keychain name as it goes to `security` as its own argv entry: never an option, never a control char.
fn key_ok(s: &str) -> bool { (1..=128).contains(&s.chars().count()) && !s.starts_with('-') && !s.chars().any(char::is_control) }
fn email_ok(s: &str) -> bool {
    s.len() <= 254 && !s.starts_with('-') && s.chars().all(|c| c.is_ascii_graphic() && c != '"' && c != '\\')
        && s.split_once('@').is_some_and(|(u, d)| !u.is_empty() && d.contains('.') && !d.contains('@'))
}
/// "" is Gmail. A name that goes to TcpStream::connect, never an option or a path.
fn host_ok(s: &str) -> bool { s.is_empty() || ((1..=253).contains(&s.len()) && !s.starts_with(['-', '.']) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')) }
pub fn valid_account(a: &Value) -> bool {
    a["email"].as_str().is_some_and(email_ok) && ["keychain_service", "keychain_account"].iter().all(|k| a[*k].as_str().is_some_and(key_ok))
        && (a["host"].is_null() || a["host"].as_str().is_some_and(host_ok)) && (a["port"].is_null() || a["port"].as_u64().is_some_and(|p| (1..=65535).contains(&p)))
}
pub fn accounts(settings_mail: &Value) -> Vec<Account> {
    settings_mail["accounts"].as_array().into_iter().flatten().filter(|a| valid_account(a)).map(|a| Account {
        email: a["email"].as_str().unwrap().to_string(),
        keychain_service: a["keychain_service"].as_str().unwrap().to_string(),
        keychain_account: a["keychain_account"].as_str().unwrap().to_string(),
        host: a["host"].as_str().unwrap_or("").to_string(), port: a["port"].as_u64().unwrap_or(993) as u16,
    }).collect()
}

/// The account for `want` (case-insensitive), "" is the first one.
pub fn pick_account(accts: &[Account], want: &str) -> Option<Account> {
    if want.is_empty() { accts.first().cloned() } else { accts.iter().find(|a| a.email.eq_ignore_ascii_case(want)).cloned() }
}

// ---------- IMAP plumbing

type Imap = async_imap::Session<async_native_tls::TlsStream<TcpStream>>;
// `used` is wall-clock time: Instant stands still while the Mac sleeps, and a session that slept is dead
// `known`: who the account wrote to (lowercase), for the Inbox/Other split, read once per session
struct Conn { s: Imap, email: String, gmail: bool, all: String, drafts: Option<String>, archive: Option<String>, trash: Option<String>, validity: Option<u32>, used: SystemTime, known: Option<HashSet<String>> }
/// A session plus the UIDVALIDITY it was opened with: ids from before a change would point at other mails.
#[derive(Default)]
struct Slot { conn: Option<Conn>, validity: Option<u32> }

/// Net: drop the session, reconnect and retry once. Imap: the server refused, drop the session (its state is
/// unknown), no retry. User: our own check failed, the session stays. Auth: Gmail refused the login, the
/// cached password is forgotten.
#[derive(Debug)]
enum Fail { Net(String), Imap(String), User(String), Auth(String) }
impl Fail {
    fn msg(self) -> String { match self { Fail::Net(m) | Fail::Imap(m) | Fail::User(m) | Fail::Auth(m) => m } }
}
impl From<async_imap::error::Error> for Fail {
    fn from(e: async_imap::error::Error) -> Self {
        use async_imap::error::Error as E;
        match e {
            E::Io(e) => Fail::Net(format!("IMAP connection error: {e}")),
            E::ConnectionLost => Fail::Net("IMAP connection lost".into()),
            // the parse errors carry raw server bytes, keep them out of the message
            E::Parse(_) => Fail::Net("IMAP protocol error".into()),
            E::No(m) | E::Bad(m) => Fail::Imap(format!("IMAP server: {m}")),
            e => Fail::Imap(format!("IMAP: {e}")),
        }
    }
}
fn user(m: impl Into<String>) -> Fail { Fail::User(m.into()) }

/// One IMAP command under the 30 s ceiling.
async fn t<T>(f: impl Future<Output = async_imap::error::Result<T>>) -> Result<T, Fail> {
    timeout(CMD, f).await.map_err(|_| Fail::Net("IMAP timeout".into()))?.map_err(Fail::from)
}
async fn fetch(c: &mut Conn, set: &str, q: &str) -> Result<Vec<Fetch>, Fail> {
    t(async { c.s.uid_fetch(set, q).await?.try_collect().await }).await
}
fn set(uids: &[u32]) -> String { uids.iter().map(u32::to_string).collect::<Vec<_>>().join(",") }

/// A string as an IMAP quoted string. This is the injection boundary for everything that reaches a command
/// from outside (search queries, Message-IDs): no CR, LF, NUL or other control char, `\` and `"` escaped.
// ponytail: ASCII only, a UTF-8 query needs an IMAP literal (CHARSET UTF-8 {n}) that async-imap's uid_search cannot send
fn quoted(s: &str) -> Result<String, Fail> {
    if s.is_empty() || s.len() > 500 { return Err(user("query must be 1 to 500 characters")); }
    if s.chars().any(|c| c.is_control() || !c.is_ascii()) { return Err(user("query may only hold printable ASCII (drop accents)")); }
    Ok(format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"")))
}

async fn keychain(a: &Account) -> Result<String, Fail> {
    let (svc, acc) = (a.keychain_service.clone(), a.keychain_account.clone());
    if !key_ok(&svc) || !key_ok(&acc) { return Err(user("invalid keychain entry name")); }
    // `security` can show an approval dialog, never hold the account's lock on it forever
    let read = tokio::task::spawn_blocking(move || std::process::Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", &svc, "-a", &acc, "-w"]).stderr(std::process::Stdio::null()).output());
    let out = timeout(KEYCHAIN_WAIT, read).await.map_err(|_| user("Keychain access was not approved in time"))?
        .map_err(|e| user(e.to_string()))?.map_err(|e| user(e.to_string()))?;
    // ponytail: the password is a plain String, not zeroized on drop
    let pw = String::from_utf8(out.stdout).unwrap_or_default().trim_end_matches(['\r', '\n']).to_string();
    if !out.status.success() || pw.is_empty() {
        return Err(user(format!("No password in the keychain for service \"{}\", account \"{}\"", a.keychain_service, a.keychain_account)));
    }
    Ok(pw)
}

async fn connect(a: &Account, pw: &str) -> Result<Conn, Fail> {
    let host = if a.host.is_empty() { HOST } else { a.host.as_str() };
    let slow = |_| Fail::Net(format!("{host} did not answer in time"));
    // ponytail: implicit TLS only (usually 993), STARTTLS on 143 is not supported
    let tcp = timeout(CONNECT, TcpStream::connect((host, a.port))).await.map_err(slow)?.map_err(|e| Fail::Net(format!("{host}: {e}")))?;
    let tls = timeout(CONNECT, async_native_tls::connect(host, tcp)).await.map_err(slow)?.map_err(|e| Fail::Net(format!("TLS: {e}")))?;
    let mut cl = async_imap::Client::new(tls);
    // Client::new does not read the greeting (login would skip it), read it here so a mute server fails fast
    timeout(CONNECT, cl.read_response()).await.map_err(slow)?.map_err(|e| Fail::Net(e.to_string()))?.ok_or_else(|| Fail::Net("no IMAP greeting".into()))?;
    let mut s = timeout(CMD, cl.login(&a.email, pw)).await.map_err(slow)?.map_err(|(e, _)| match Fail::from(e) {
        Fail::Imap(m) => Fail::Auth(format!("Login failed for {}: {m}", a.email)),
        f => f,
    })?;
    let gmail = t(s.capabilities()).await?.has_str("X-GM-EXT-1");
    if a.host.is_empty() && !gmail { return Err(user("Only Gmail accounts are supported without a server")); }
    let names: Vec<Name> = t(async { s.list(Some(""), Some("*")).await?.try_collect().await }).await?;
    // the special-use attributes, the names are localized ([Gmail]/Alle berichten)
    let find = |attr: NameAttribute| names.iter().find(|n| n.attributes().contains(&attr)).map(|n| n.name().to_string())
        .filter(|n| n.len() <= 256 && !n.chars().any(char::is_control));
    let (all, drafts) = if gmail {
        (find(NameAttribute::All).ok_or_else(|| user("No \\All mailbox (Gmail All Mail) found"))?, find(NameAttribute::Drafts))
    } else {
        ("INBOX".to_string(), find(NameAttribute::Drafts).or_else(|| named(&names, DRAFTS)))
    };
    // Gmail archives by label, other servers move to a folder
    let archive = if gmail { None } else { find(NameAttribute::Archive).or_else(|| named(&names, ARCHIVE)) };
    let trash = find(NameAttribute::Trash).or_else(|| named(&names, TRASH));
    let validity = t(s.examine(&all)).await?.uid_validity;
    Ok(Conn { s, email: a.email.clone(), gmail, all, drafts, archive, trash, validity, used: SystemTime::now(), known: None })
}

// folder names for servers without special-use flags, matched on the last segment of the name
const DRAFTS: &[&str] = &["drafts", "concepten", "brouillons", "entwürfe"];
const ARCHIVE: &[&str] = &["archive", "archives", "archief", "archiv"];
const TRASH: &[&str] = &["trash", "deleted items", "deleted messages", "prullenbak", "corbeille", "papierkorb"];
/// A folder of a server without special-use flags: a name whose last segment is one of `want`.
fn folder_named<'a>(mut names: impl Iterator<Item = &'a str>, want: &[&str]) -> Option<&'a str> {
    names.find(|n| n.len() <= 256 && !n.chars().any(char::is_control) && n.rsplit(['/', '.']).next()
        .is_some_and(|l| want.iter().any(|d| l.eq_ignore_ascii_case(d))))
}
fn named(names: &[Name], want: &[&str]) -> Option<String> { folder_named(names.iter().map(|n| n.name()), want).map(str::to_string) }

/// Run `$body` (an expression using `$c: &mut Conn`) on the account's cached session (the UI's or, `$tool`
/// true, Claude's own, so the UI never waits behind a long tool call): connect when there is none or it sat
/// idle too long, drop it on an IMAP error, reconnect and retry once on a network error.
macro_rules! run {
    ($self:ident, $acct:expr, $tool:expr, $c:ident => $body:expr) => {{
        let slot = $self.slot($acct, $tool);
        let mut g = slot.lock().await;
        let mut retried = false;
        loop {
            if g.conn.as_ref().is_some_and(|c| c.used.elapsed().map_or(true, |d| d > IDLE)) { g.conn = None; }
            if g.conn.is_none() {
                let c = $self.connect($acct).await.map_err(Fail::msg)?;
                // ponytail: Gmail's All Mail UIDVALIDITY practically never changes, this reports a change once and
                // does not track which ids were handed out before it
                let changed = g.validity.is_some() && g.validity != c.validity;
                (g.validity, g.conn) = (c.validity, Some(c));
                if changed { break Err(STALE.to_string()); }
            }
            let $c = g.conn.as_mut().unwrap();
            // async-imap parks unsolicited responses in a bounded channel (try_send, drops when full), empty it
            while $c.s.unsolicited_responses.try_recv().is_ok() {}
            match $body.await {
                Ok(v) => { g.conn.as_mut().unwrap().used = SystemTime::now(); break Ok::<_, String>(v); }
                Err(Fail::User(m)) => break Err(m),
                Err(Fail::Imap(m) | Fail::Auth(m)) => { g.conn = None; break Err(m); }
                Err(Fail::Net(m)) => { g.conn = None; if retried { break Err(m); } retried = true; }
            }
        }
    }};
}

// ---------- mail operations, each on a session that sits in EXAMINE on All Mail

async fn uids(c: &mut Conn, q: String) -> Result<Vec<u32>, Fail> {
    let mut v: Vec<u32> = t(c.s.uid_search(q)).await?.into_iter().collect();
    v.sort_unstable_by(|a, b| b.cmp(a));
    Ok(v)
}
// ponytail: other servers search INBOX only (no Sent or archive), also for threads; TEXT is the portable search
async fn search(c: &mut Conn, q: &str) -> Result<Vec<u32>, Fail> {
    let q = quoted(q)?;
    uids(c, if c.gmail { format!("X-GM-RAW {q}") } else { format!("TEXT {q}") }).await
}
async fn inbox(c: &mut Conn) -> Result<Vec<u32>, Fail> {
    uids(c, if c.gmail { "X-GM-RAW \"in:inbox\"" } else { "ALL" }.into()).await
}

/// UI rows, newest first. The fetch stream also carries unsolicited FETCHes (flag updates for these or other
/// mails), so only the ones with our headers count, once per uid.
/// `split`: each row also says whether it belongs under Other (see `other`).
async fn rows(c: &mut Conn, uids: &[u32], split: bool) -> Result<Vec<Value>, Fail> {
    if uids.is_empty() { return Ok(vec![]); }
    if split && c.known.is_none() { c.known = Some(known(c).await?); }
    let mut f = fetch(c, &set(uids), "(UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE CONTENT-TYPE LIST-ID LIST-UNSUBSCRIBE PRECEDENCE AUTO-SUBMITTED)])").await?;
    f.retain(|f| f.header().is_some() && f.uid.is_some_and(|u| uids.contains(&u)));
    f.sort_by_key(|f| std::cmp::Reverse(f.uid));
    f.dedup_by_key(|f| f.uid);
    let known = if split { c.known.as_ref() } else { None };
    Ok(f.iter().map(|f| row(f, &c.email, known)).collect())
}
/// The addresses in To and Cc of the newest sent mails.
// ponytail: other servers have no `in:sent` here (INBOX only), so nobody counts as known and all bulk mail goes to Other
async fn known(c: &mut Conn) -> Result<HashSet<String>, Fail> {
    if !c.gmail { return Ok(HashSet::new()); }
    let u = search(c, "in:sent").await?;
    let u = &u[..u.len().min(SENT_SCAN)];
    if u.is_empty() { return Ok(HashSet::new()); }
    Ok(fetch(c, &set(u), "(UID BODY.PEEK[HEADER.FIELDS (TO CC)])").await?.iter()
        .filter_map(|f| MessageParser::default().parse(f.header()?))
        .flat_map(|m| [m.to(), m.cc()].into_iter().flatten().flat_map(|a| a.iter().filter_map(|x| x.address.as_deref().map(str::to_lowercase))).collect::<Vec<_>>())
        .collect())
}
/// Newsletters, notifications and other machine-sent mail (Keel's rule).
fn is_bulk(m: &Message) -> bool {
    let h = |n: &str| m.header_raw(n).map(|v| v.trim().to_lowercase());
    if h("List-Id").is_some() || h("List-Unsubscribe").is_some() { return true; }
    if matches!(h("Precedence").as_deref(), Some("bulk" | "list" | "junk")) { return true; }
    if h("Auto-Submitted").is_some_and(|v| v != "no") { return true; }
    let local = from_addr(m);
    let local = local.split('@').next().unwrap_or("");
    ["noreply", "no-reply", "donotreply", "do-not-reply", "notification", "newsletter", "mailer-daemon", "bounce"].iter().any(|p| local.contains(p))
}
fn from_addr(m: &Message) -> String { m.from().and_then(|a| a.first()).and_then(|a| a.address.as_deref()).unwrap_or("").to_lowercase() }
/// Other: machine-sent mail from someone you never wrote to. Person-to-person mail, or anything from a
/// correspondent, stays in the Inbox.
fn other(m: &Message, known: &HashSet<String>) -> bool {
    let from = from_addr(m);
    is_bulk(m) && !from.is_empty() && !known.contains(&from)
}
/// A row, id-only (empty subject and addresses) when the headers do not parse, so a page never shrinks.
fn row(f: &Fetch, email: &str, known: Option<&HashSet<String>>) -> Value {
    let m = f.header().and_then(|h| MessageParser::default().parse(h));
    let date = f.internal_date().map(|d| d.to_rfc3339()).or_else(|| m.as_ref()?.date().map(|d| d.to_rfc3339()));
    // ponytail: a top-level multipart/mixed stands for "has attachments", BODYSTRUCTURE when that misleads
    let att = m.as_ref().and_then(|m| m.content_type()).is_some_and(|c| c.ctype().eq_ignore_ascii_case("multipart") && c.subtype().is_some_and(|s| s.eq_ignore_ascii_case("mixed")));
    json!({ "account": email, "id": f.uid.unwrap_or(0).to_string(), "subject": m.as_ref().and_then(|m| m.subject()).unwrap_or(""), "date": date,
        "unread": !f.flags().any(|x| x == Flag::Seen), "from": addrs(m.as_ref().and_then(|m| m.from())), "to": addrs(m.as_ref().and_then(|m| m.to())), "attachments": att,
        "other": known.zip(m.as_ref()).is_some_and(|(k, m)| other(m, k)) })
}

async fn page(c: &mut Conn, page: u32, split: bool) -> Result<Vec<Value>, Fail> {
    let u = inbox(c).await?;
    let from = (page as usize - 1) * PAGE;
    rows(c, u.get(from..u.len().min(from + PAGE)).unwrap_or(&[]), split).await
}
async fn search_rows(c: &mut Conn, q: &str, limit: usize) -> Result<Vec<Value>, Fail> {
    let u = search(c, q).await?;
    rows(c, &u[..u.len().min(limit)], false).await
}

/// The whole raw mail, size-checked first.
async fn full(c: &mut Conn, uid: u32) -> Result<Vec<u8>, Fail> {
    // a flags-only FETCH for the same uid can come first, so look for the one that carries the attribute
    let size = fetch(c, &uid.to_string(), "(UID RFC822.SIZE)").await?.iter().find_map(|f| f.size.filter(|_| f.uid == Some(uid)))
        .ok_or_else(|| user(format!("No mail with id {uid}")))?;
    if size > MSG_MAX { return Err(user(format!("Mail {uid} is larger than 50 MB"))); }
    fetch(c, &uid.to_string(), "(UID BODY.PEEK[])").await?.iter().find_map(|f| f.body().filter(|_| f.uid == Some(uid)).map(<[u8]>::to_vec))
        .ok_or_else(|| user(format!("No mail with id {uid}")))
}

/// The conversation of a mail: its root is the first References id, else its own Message-ID.
// ponytail: the 30 newest mails of the thread, header search only (no X-GM-THRID)
async fn thread(c: &mut Conn, uid: u32) -> Result<(Option<String>, Vec<(u32, Vec<u8>, bool)>), Fail> {
    let raw = full(c, uid).await?;
    let root = root(&parse(&raw)?);
    let mut uids: Vec<u32> = match root.as_deref().and_then(|r| quoted(r).ok()) {
        Some(q) => t(c.s.uid_search(format!("OR HEADER Message-ID {q} HEADER References {q}"))).await?.into_iter().collect(),
        None => vec![],
    };
    if !uids.contains(&uid) { uids.push(uid); }
    uids.sort_unstable();
    let uids = uids.split_off(uids.len().saturating_sub(30));
    let sizes: HashMap<u32, u32> = fetch(c, &set(&uids), "(UID RFC822.SIZE)").await?.iter()
        .filter_map(|f| Some((f.uid.filter(|u| uids.contains(u))?, f.size?))).collect();
    let (small, big): (Vec<u32>, Vec<u32>) = uids.iter().filter(|u| sizes.contains_key(u)).partition(|u| sizes[u] <= THREAD_BODY_MAX);
    let mut got: HashMap<u32, (Vec<u8>, bool)> = HashMap::new();
    for (list, q, whole) in [(&small, "(UID BODY.PEEK[])", true), (&big, "(UID BODY.PEEK[HEADER])", false)] {
        if list.is_empty() { continue; }
        for f in fetch(c, &set(list), q).await? {
            let data = if whole { f.body() } else { f.header() };
            if let (Some(u), Some(d)) = (f.uid, data) { if list.contains(&u) { got.insert(u, (d.to_vec(), whole)); } }
        }
    }
    Ok((root, uids.iter().filter_map(|u| got.remove(u).map(|(d, w)| (*u, d, w))).collect()))
}

/// The thread root: the first References id, else the own Message-ID. An id without a local part, a domain
/// or 8 characters would match half the mailbox as a substring, it counts as missing.
fn root(m: &Message) -> Option<String> {
    let ok = |s: &&str| s.len() >= 8 && s.split_once('@').is_some_and(|(l, d)| !l.is_empty() && !d.is_empty());
    ids(m.references()).first().copied().filter(ok).or(m.message_id().filter(ok)).map(str::to_string)
}
fn ids<'a>(v: &'a HeaderValue) -> Vec<&'a str> {
    v.as_text_list().map(|l| l.iter().map(|s| s.as_ref()).collect()).or(v.as_text().map(|s| vec![s])).unwrap_or_default()
}
/// HEADER search matches substrings, a mail only belongs to the thread when an id equals the root exactly.
fn in_thread(m: &Message, root: &str) -> bool {
    m.message_id() == Some(root) || ids(m.references()).contains(&root) || ids(m.in_reply_to()).contains(&root)
}

async fn store(c: &mut Conn, uid: u32, seen: bool) -> Result<(), Fail> {
    let all = c.all.clone();
    t(c.s.select(&all)).await?;
    let q = format!("{}FLAGS.SILENT (\\Seen)", if seen { '+' } else { '-' });
    let r = t(async { c.s.uid_store(uid.to_string(), q).await?.try_collect::<Vec<_>>().await }).await;
    t(c.s.examine(&all)).await?;
    r.map(|_| ())
}

/// Archive (Gmail: drop the Inbox label, the mail stays in All Mail; other servers: move to the Archive folder) or move
/// to Trash (Gmail empties it after 30 days). ponytail: needs the MOVE extension (RFC 6851) off Gmail, COPY+EXPUNGE when a server lacks it.
async fn move_to(c: &mut Conn, uids: &[u32], trash: bool) -> Result<(), Fail> {
    let all = c.all.clone();
    let dest = if trash { Some(c.trash.clone().ok_or_else(|| user("No Trash folder found on the server"))?) }
        else if c.gmail { None } else { Some(c.archive.clone().ok_or_else(|| user("No Archive folder found on the server"))?) };
    t(c.s.select(&all)).await?;
    let r = match &dest {
        Some(d) => t(c.s.uid_mv(set(uids), d)).await,
        None => t(async { c.s.uid_store(set(uids), "-X-GM-LABELS (\\Inbox)").await?.try_collect::<Vec<_>>().await }).await.map(|_| ()),
    };
    // moved but the session did not go back to EXAMINE: a network error, so it reconnects and retries (a no-op now)
    match (r, t(c.s.examine(&all)).await) {
        (Ok(()), Err(_)) => Err(Fail::Net("IMAP: back to read-only failed".into())),
        (r, _) => r,
    }
}

async fn append(c: &mut Conn, raw: &[u8]) -> Result<String, Fail> {
    let d = c.drafts.clone().ok_or_else(|| user("No \\Drafts mailbox found"))?;
    // APPEND is not idempotent: no retry after a lost connection, it could save the draft twice
    t(c.s.append(&d, Some("(\\Draft)"), None, raw)).await
        .map_err(|e| match e { Fail::Net(_) => Fail::Imap("The draft may have been saved, check the Drafts folder before saving again".into()), e => e })?;
    Ok(d)
}

// ---------- parsing and validation

fn parse(raw: &[u8]) -> Result<Message<'_>, Fail> { MessageParser::default().parse(raw).ok_or_else(|| user("Could not parse the mail")) }
fn addrs(a: Option<&Address>) -> Value {
    json!(a.map(|a| a.iter().filter_map(|x| Some(json!({ "name": x.name, "email": x.address.as_ref()? }))).collect::<Vec<_>>()).unwrap_or_default())
}
fn attachments(m: &Message) -> Vec<Value> {
    m.attachments().enumerate().map(|(i, p)| {
        let mime = p.content_type().map(|c| format!("{}/{}", c.ctype(), c.subtype().unwrap_or(""))).unwrap_or("application/octet-stream".into());
        json!({ "index": i, "name": p.attachment_name().unwrap_or(""), "size": p.len(), "mime": mime })
    }).collect()
}
fn date(m: &Message) -> Option<String> { m.date().map(|d| d.to_rfc3339()) }
fn subject(m: &Message) -> Option<String> { m.subject().map(|s| cap(s, SUBJECT_MAX)) }

/// A mail id: the UID in All Mail, decimal, non-zero, fits u32. JSON numbers are accepted too.
fn uid(v: &Value) -> Result<u32, String> {
    let s = v.as_str().map(str::to_string).or_else(|| v.as_u64().map(|n| n.to_string())).unwrap_or_default();
    s.parse::<u32>().ok().filter(|n| *n > 0 && s.len() <= 10 && s.bytes().all(|b| b.is_ascii_digit())).ok_or_else(|| "id must be a mail id from search".into())
}
fn header_names(v: &Value) -> Result<Vec<String>, String> {
    if v.is_null() { return Ok(vec![]); }
    let ok = |s: &str| (1..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
    let a = v.as_array().filter(|a| a.len() <= 10).ok_or("headers must be a list of at most 10 names")?;
    a.iter().map(|h| h.as_str().filter(|s| ok(s)).map(str::to_string).ok_or_else(|| "header names are [A-Za-z0-9-]{1,64}".to_string())).collect()
}
/// The tool's `account` argument, absent or "" is the default account.
fn pick(accts: &[Account], default: &str, v: &Value) -> Result<Account, String> {
    let want = match v { Value::Null => default, Value::String(s) if s.is_empty() => default, Value::String(s) => s, _ => return Err("account must be a string".into()) };
    if accts.is_empty() { return Err("No mail account configured".into()); }
    pick_account(accts, want).ok_or_else(|| format!("Account {want} is not configured"))
}
/// An attachment name that stays one plain file in the downloads folder.
fn safe_name(n: &str) -> String {
    let bidi = |c: char| matches!(c, '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}' | '\u{feff}');
    let s: String = n.chars().map(|c| if "/\\:".contains(c) || c.is_control() || bidi(c) { '_' } else { c }).collect();
    let s = cap(s.trim().trim_start_matches(['.', ' ']), 120).trim_end().to_string();
    if s.is_empty() { "attachment".into() } else { s }
}
/// Write without ever overwriting: `name`, then `name (1).ext`, `name (2).ext`. create_new is atomic.
fn save(dir: &Path, name: &str, data: &[u8]) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let name = safe_name(name);
    let (stem, ext) = match name.rfind('.') { Some(i) if i > 0 => name.split_at(i), _ => (name.as_str(), "") };
    if RUNS.iter().any(|r| ext[ext.len().min(1)..].eq_ignore_ascii_case(r)) {
        return Err(format!("{ext} files run on a double-click and are not saved here, save it from Gmail if you need it"));
    }
    for n in 0..1000 {
        let p = dir.join(if n == 0 { name.clone() } else { format!("{stem} ({n}){ext}") });
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&p) {
            Ok(mut f) => {
                let r = f.write_all(data).map_err(|e| e.to_string()).and_then(|_| quarantine(&p));
                if r.is_err() { let _ = std::fs::remove_file(&p); }
                return r.map(|_| p);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("too many files with that name".into())
}
/// The quarantine flag Mail sets on a download, so Gatekeeper checks the file before it opens.
fn quarantine(p: &Path) -> Result<(), String> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let ok = std::process::Command::new("/usr/bin/xattr").arg("-w").arg("com.apple.quarantine").arg(format!("0081;{now:x};Relay;")).arg(p)
        .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().is_ok_and(|s| s.success());
    if ok { Ok(()) } else { Err("Could not set the quarantine flag, the attachment was not saved".into()) }
}
/// A draft as it may be appended: at most 5 MB, parseable, CRLF line ends, exactly one From that is the account.
/// Also returns the To and Cc addresses, so the app shows the real recipients whatever the model says.
type Draft = (Vec<u8>, Vec<String>, Vec<String>, Vec<String>); // raw, to, cc, bcc
fn draft(raw: &str, email: &str) -> Result<Draft, String> {
    if raw.len() > DRAFT_MAX { return Err("draft is larger than 5 MB".into()); }
    if raw.contains('\0') { return Err("draft contains a NUL byte".into()); }
    let crlf = raw.replace("\r\n", "\n").replace('\n', "\r\n");
    let m = MessageParser::default().parse(crlf.as_bytes()).ok_or("draft is not a parseable RFC 5322 message")?;
    let froms = m.headers().iter().filter(|h| h.name == HeaderName::From).count();
    let from: Vec<_> = m.from().map(|a| a.iter().filter_map(|x| x.address.as_deref()).collect()).unwrap_or_default();
    if froms != 1 || from.len() != 1 || !from[0].eq_ignore_ascii_case(email) { return Err(format!("From must be {email}, or pass the account the mail belongs to")); }
    let emails = |a: Option<&Address>| a.map(|a| a.iter().filter_map(|x| x.address.as_deref().map(str::to_string)).collect()).unwrap_or_default();
    let (to, cc, bcc) = (emails(m.to()), emails(m.cc()), emails(m.bcc()));
    Ok((crlf.into_bytes(), to, cc, bcc))
}

// ---------- public API

type Shared<T> = std::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<T>>>>;
/// Sessions per slot, and the app password per account email, read from the keychain once: every slot and
/// every reconnect asking `security` again stacked up approval dialogs.
// ponytail: the cached password is a plain String in memory for the app's lifetime
pub struct Mail { slots: Shared<Slot>, pws: Shared<Option<String>> }

fn entry<T: Default>(m: &Shared<T>, key: String) -> Arc<tokio::sync::Mutex<T>> { m.lock().unwrap().entry(key).or_default().clone() }

impl Mail {
    pub fn new() -> Self { Mail { slots: Default::default(), pws: Default::default() } }

    /// A logged-in session. The account's password lock is held while the keychain is read, so two slots never
    /// ask at once, and a refused login forgets the password so a changed one is read again.
    async fn connect(&self, a: &Account) -> Result<Conn, Fail> {
        let pw = {
            let lock = entry(&self.pws, a.email.to_ascii_lowercase());
            let mut g = lock.lock().await;
            if g.is_none() { *g = Some(keychain(a).await?); }
            g.clone().unwrap()
        };
        let r = connect(a, &pw).await;
        if let Err(Fail::Auth(_)) = r { *entry(&self.pws, a.email.to_ascii_lowercase()).lock().await = None; }
        r
    }
    fn slot(&self, a: &Account, tool: bool) -> Arc<tokio::sync::Mutex<Slot>> {
        entry(&self.slots, format!("{}{}", a.email.to_ascii_lowercase(), if tool { "/tool" } else { "" }))
    }

    /// One page of 50 inbox rows, page 1 is the newest. `split` marks the rows that go under Other.
    pub async fn list(&self, acct: &Account, page: u32, split: bool) -> Result<Value, String> {
        let p = page.clamp(1, 10_000);
        // a changed mailbox is exactly what a reload repairs, so the list retries once instead of failing
        match run!(self, acct, false, c => self::page(c, p, split)) {
            Err(e) if e == STALE => run!(self, acct, false, c => self::page(c, p, split)),
            r => r,
        }.map(Value::from)
    }

    /// One mail for the UI: text, sanitized HTML (or null) and the attachment list.
    pub async fn open(&self, acct: &Account, id: &str) -> Result<Value, String> {
        let u = uid(&json!(id))?;
        let raw = run!(self, acct, false, c => full(c, u))?;
        let m = parse(&raw).map_err(Fail::msg)?;
        Ok(json!({ "text": render::text(&m), "html": render::html(&m), "attachments": attachments(&m) }))
    }

    /// Mark read or unread, the one flag change and only from a click in the UI.
    pub async fn set_seen(&self, acct: &Account, id: &str, seen: bool) -> Result<(), String> {
        let u = uid(&json!(id))?;
        run!(self, acct, false, c => store(c, u, seen))
    }

    /// Archive or trash mails, only from a click in the UI (experimental). Safe to retry after a lost connection:
    /// archiving twice is a no-op, a uid already moved is simply gone from All Mail.
    pub async fn move_to(&self, acct: &Account, ids: &[String], trash: bool) -> Result<(), String> {
        if ids.is_empty() || ids.len() > MOVE_MAX { return Err(format!("1 to {MOVE_MAX} mails at a time")); }
        let u = ids.iter().map(|i| uid(&json!(i))).collect::<Result<Vec<_>, _>>()?;
        run!(self, acct, false, c => move_to(c, &u, trash))
    }

    /// A fresh login outside the cache, so the settings pane tests exactly what it shows.
    pub async fn test(&self, acct: &Account) -> Result<String, String> {
        *entry(&self.pws, acct.email.to_ascii_lowercase()).lock().await = None; // a code just stored is the one tried
        let mut c = self.connect(acct).await.map_err(Fail::msg)?;
        let n = inbox(&mut c).await.map_err(Fail::msg)?.len();
        let _ = timeout(CONNECT, c.s.logout()).await;
        Ok(format!("ok, {n} in inbox"))
    }

    /// One MCP tools/call, as its `result`.
    pub async fn tool(&self, accts: &[Account], default: &str, name: &str, args: &Value, downloads: &Path) -> Value {
        match self.call(accts, default, name, args, downloads).await {
            Ok(v) => json!({ "content": [{ "type": "text", "text": v.to_string() }] }),
            Err(e) => json!({ "content": [{ "type": "text", "text": e }], "isError": true }),
        }
    }

    // every argument is checked before anything goes over the network
    async fn call(&self, accts: &[Account], default: &str, name: &str, args: &Value, downloads: &Path) -> Result<Value, String> {
        if !["search", "read", "thread", "attachment", "save_draft"].contains(&name) { return Err(format!("Unknown tool {name}")); }
        let acct = pick(accts, default, &args["account"])?;
        let email = &acct.email;
        match name {
            "search" => {
                let q = args["query"].as_str().ok_or("query is required")?;
                quoted(q).map_err(Fail::msg)?;
                let limit = match &args["limit"] { Value::Null => 20, v => v.as_u64().filter(|n| (1..=50).contains(n)).ok_or("limit must be 1 to 50")? as usize };
                let results = run!(self, &acct, true, c => search_rows(c, q, limit))?;
                Ok(json!({ "account": email, "results": results }))
            }
            "read" => {
                let (u, hs) = (uid(&args["id"])?, header_names(&args["headers"])?);
                let raw = run!(self, &acct, true, c => full(c, u))?;
                let m = parse(&raw).map_err(Fail::msg)?;
                let headers: serde_json::Map<String, Value> = hs.into_iter().map(|h| {
                    let v = m.header_raw(h.clone()).map(|v| cap(v.trim(), 2000));
                    (h, json!(v))
                }).collect();
                Ok(json!({ "account": email, "id": u.to_string(), "from": addrs(m.from()), "to": addrs(m.to()), "cc": addrs(m.cc()),
                    "date": date(&m), "subject": subject(&m), "message_id": m.message_id(), "attachments": attachments(&m),
                    "untrusted_headers": headers, "untrusted_mail": render::text(&m) }))
            }
            "thread" => {
                let u = uid(&args["id"])?;
                let (root, mails) = run!(self, &acct, true, c => thread(c, u))?;
                let mut budget = 60_000;
                let messages: Vec<Value> = mails.iter().filter_map(|(id, raw, whole)| {
                    let m = MessageParser::default().parse(raw)?;
                    if *id != u && !root.as_deref().is_some_and(|r| in_thread(&m, r)) { return None; }
                    let text = if *whole { cap(&render::text(&m), budget.min(8000)) } else { "(larger than 1 MB, read it with the read tool)".into() };
                    budget -= text.chars().count().min(budget);
                    Some(json!({ "id": id.to_string(), "from": addrs(m.from()), "date": date(&m), "subject": subject(&m), "untrusted_mail": text }))
                }).collect();
                Ok(json!({ "account": email, "messages": messages }))
            }
            "attachment" => {
                let u = uid(&args["id"])?;
                let i = args["index"].as_u64().filter(|i| *i < 1000).ok_or("index must be an attachment index from read")? as usize;
                let raw = run!(self, &acct, true, c => full(c, u))?;
                let m = parse(&raw).map_err(Fail::msg)?;
                let p = m.attachments().nth(i).ok_or_else(|| format!("Mail {u} has no attachment {i}"))?;
                let path = save(downloads, p.attachment_name().unwrap_or("attachment"), p.contents())?;
                Ok(json!({ "path": path }))
            }
            _ => {
                let (raw, to, cc, bcc) = draft(args["raw"].as_str().ok_or("raw is required")?, email)?;
                let folder = run!(self, &acct, true, c => append(c, &raw))?;
                Ok(json!({ "account": email, "folder": folder, "saved": true, "to": to, "cc": cc, "bcc": bcc }))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn acct(e: &str) -> Account { Account { email: e.into(), keychain_service: "svc".into(), keychain_account: "acc".into(), host: "".into(), port: 993 } }
    fn err(v: &Value) -> String { assert_eq!(v["isError"], true, "{v}"); v["content"][0]["text"].as_str().unwrap().to_string() }

    #[test]
    fn accounts_are_validated() {
        let m = json!({ "accounts": [
            { "email": "a@b.be", "keychain_service": "himalaya-x", "keychain_account": "x" },
            { "email": "a@b.be", "keychain_service": "-s", "keychain_account": "x" },
            { "email": "a@b.be", "keychain_service": "x\ny", "keychain_account": "x" },
            { "email": "a\"@b.be", "keychain_service": "x", "keychain_account": "x" },
            { "email": "nope", "keychain_service": "x", "keychain_account": "x" },
            { "email": "a@b.be", "keychain_service": "x".repeat(129), "keychain_account": "x" },
            { "email": "a@b.be", "keychain_service": "", "keychain_account": "x" },
        ] });
        assert_eq!(accounts(&m), vec![Account { email: "a@b.be".into(), keychain_service: "himalaya-x".into(), keychain_account: "x".into(), host: "".into(), port: 993 }]);
        assert!(accounts(&json!({})).is_empty());
        let h = |h: Value, p: Value| accounts(&json!({ "accounts": [{ "email": "a@b.be", "keychain_service": "x", "keychain_account": "x", "host": h, "port": p }] }));
        let n = Value::Null;
        assert_eq!((h(json!("mail.ex-ample.com"), json!(143))[0].host.as_str(), h(json!("mail.ex-ample.com"), json!(143))[0].port), ("mail.ex-ample.com", 143));
        assert_eq!((h(n.clone(), n.clone())[0].host.as_str(), h(n.clone(), n.clone())[0].port), ("", 993));
        for bad in [(json!("a b"), n.clone()), (json!("-host"), n.clone()), (json!(".host"), n.clone()), (json!("a/b"), n.clone()), (json!("x".repeat(254)), n.clone()), (json!(5), n.clone()),
                    (n.clone(), json!(0)), (n.clone(), json!(70000)), (n.clone(), json!("993"))] { assert!(h(bad.0, bad.1).is_empty()); }
    }

    #[test]
    fn drafts_folder_by_name() {
        assert_eq!(folder_named(["INBOX", "INBOX.Sent", "INBOX.Concepten"].into_iter(), DRAFTS), Some("INBOX.Concepten"));
        assert_eq!(folder_named(["INBOX", "Mail/DRAFTS"].into_iter(), DRAFTS), Some("Mail/DRAFTS"));
        assert_eq!(folder_named(["INBOX", "Drafts-old", "Sent"].into_iter(), DRAFTS), None);
        assert_eq!(folder_named(["INBOX", "INBOX.Archief", "INBOX.Deleted Items"].into_iter(), ARCHIVE), Some("INBOX.Archief"));
        assert_eq!(folder_named(["INBOX", "INBOX.Archief", "INBOX.Deleted Items"].into_iter(), TRASH), Some("INBOX.Deleted Items"));
    }

    #[test]
    fn quoting_is_the_injection_boundary() {
        assert_eq!(quoted(r#"from:"a b" \x"#).unwrap(), r#""from:\"a b\" \\x""#);
        assert_eq!(quoted("in:inbox").unwrap(), "\"in:inbox\"");
        for bad in ["a\r\nA1 LOGOUT", "a\nb", "a\rb", "a\0b", "a\x1bb", "a\tb", "café", "", &"x".repeat(501)] {
            assert!(quoted(bad).is_err(), "{bad:?}");
        }
        // a hostile Message-ID from a References header goes through the same function
        assert_eq!(quoted(r#"x"@y) HEADER To "z"#).unwrap(), r#""x\"@y) HEADER To \"z""#);
    }

    #[test]
    fn ids_and_headers() {
        assert_eq!(uid(&json!("48213")), Ok(48213));
        assert_eq!(uid(&json!(7)), Ok(7));
        for bad in [json!("0"), json!("-1"), json!("+5"), json!("1 2"), json!("4294967296"), json!("12\r\n"), json!(""), json!(null), json!(1.5), json!("00000000001")] {
            assert!(uid(&bad).is_err(), "{bad}");
        }
        assert_eq!(header_names(&json!(["List-Id", "X-Mailer"])).unwrap(), ["List-Id", "X-Mailer"]);
        assert!(header_names(&json!(null)).unwrap().is_empty());
        for bad in [json!(["a b"]), json!(["a:b"]), json!(["x\r\n"]), json!([""]), json!(["x".repeat(65)]), json!("List-Id"), json!(vec!["a"; 11]), json!([1])] {
            assert!(header_names(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn inbox_or_other() {
        let known: HashSet<String> = ["friend@shop.be".to_string()].into();
        let is_other = |raw: &str| other(&MessageParser::default().parse(raw.as_bytes()).unwrap(), &known);
        assert!(!is_other("From: Jan <jan@client.be>\r\nSubject: hi\r\n\r\n"));
        assert!(is_other("From: news@shop.be\r\nList-Unsubscribe: <mailto:x@y.be>\r\n\r\n"));
        assert!(is_other("From: x@y.be\r\nPrecedence: Bulk\r\n\r\n"));
        assert!(is_other("From: x@y.be\r\nAuto-Submitted: auto-generated\r\n\r\n"));
        assert!(!is_other("From: x@y.be\r\nAuto-Submitted: no\r\n\r\n"));
        assert!(is_other("From: GitHub <notifications@github.com>\r\n\r\n"));
        assert!(is_other("From: no-reply@bank.be\r\n\r\n"));
        // someone you wrote to stays in the Inbox, newsletter or not
        assert!(!is_other("From: Friend@Shop.be\r\nList-Id: <l.shop.be>\r\n\r\n"));
    }

    #[test]
    fn filenames() {
        assert_eq!(safe_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(safe_name(".bashrc"), "bashrc");
        assert_eq!(safe_name("..."), "attachment");
        assert_eq!(safe_name("a\nb\u{202e}fdp.exe"), "a_b_fdp.exe");
        assert_eq!(safe_name("C:\\x.pdf"), "C__x.pdf");
        assert_eq!(safe_name(&"é".repeat(300)).chars().count(), 120);
        let dir = std::env::temp_dir().join(format!("relay-mail-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let names: Vec<_> = (0..3).map(|_| save(&dir, "report.pdf", b"x").unwrap().file_name().unwrap().to_string_lossy().to_string()).collect();
        assert_eq!(names, ["report.pdf", "report (1).pdf", "report (2).pdf"]);
        let p = save(&dir, "../x", b"y").unwrap();
        assert_eq!(p.parent().unwrap(), dir);
        let q = std::process::Command::new("/usr/bin/xattr").args(["-p", "com.apple.quarantine"]).arg(&p).output().unwrap();
        assert!(String::from_utf8_lossy(&q.stdout).starts_with("0081;") && String::from_utf8_lossy(&q.stdout).contains(";Relay;"));
        for bad in ["run.command", "x.APP", "a.terminal", "b.webloc", "c.jar", "x.tar.pkg"] {
            assert!(save(&dir, bad, b"z").unwrap_err().contains("double-click"), "{bad}");
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn draft_from_check() {
        let ok = "From: Laurent <Laurent@WeAreAntenna.be>\nTo: x@y.be\nSubject: Re: hi\n\nBody\n";
        let (raw, to, cc, _bcc) = draft(ok, "laurent@weareantenna.be").unwrap();
        assert_eq!(raw, ok.replace('\n', "\r\n").into_bytes());
        assert_eq!((to, cc), (vec!["x@y.be".to_string()], vec![]));
        let (_, to, cc, bcc) = draft("From: laurent@weareantenna.be\nTo: A <a@x.be>, b@x.be\nCc: c@x.be\nBcc: d@x.be\n\nb", "laurent@weareantenna.be").unwrap();
        assert_eq!(bcc, vec!["d@x.be".to_string()], "a hidden recipient shows in the app note too");
        assert_eq!((to, cc), (vec!["a@x.be".to_string(), "b@x.be".to_string()], vec!["c@x.be".to_string()]));
        for bad in [
            "From: someone@else.be\nSubject: x\n\nb",
            "Subject: no from\n\nb",
            "From: a@x.be, laurent@weareantenna.be\n\nb",
            "From: evil@x.be\nFrom: laurent@weareantenna.be\n\nb",
            "From: laurent@weareantenna.be\n\nb\0",
        ] {
            assert!(draft(bad, "laurent@weareantenna.be").is_err(), "{bad:?}");
        }
        assert!(draft(&format!("From: laurent@weareantenna.be\n\n{}", "x".repeat(DRAFT_MAX)), "laurent@weareantenna.be").is_err());
    }

    #[tokio::test]
    async fn tool_args_fail_before_the_network() {
        let (m, a, d) = (Mail::new(), [acct("laurent@weareantenna.be")], std::env::temp_dir());
        let call = async |name: &str, args: Value| m.tool(&a, "", name, &args, &d).await;
        assert!(err(&call("search", json!({ "query": "a\r\nA1 LOGOUT" })).await).contains("ASCII"));
        assert!(err(&call("search", json!({ "query": "x\"", "limit": 51 })).await).contains("limit"));
        assert!(err(&call("search", json!({})).await).contains("query"));
        assert!(err(&call("read", json!({ "id": "1 FLAGS" })).await).contains("id"));
        assert!(err(&call("read", json!({ "id": "1", "headers": ["Bad Name"] })).await).contains("header"));
        assert!(err(&call("attachment", json!({ "id": "1", "index": -1 })).await).contains("index"));
        assert!(err(&call("thread", json!({ "id": "1", "account": "other@x.be" })).await).contains("not configured"));
        assert!(err(&call("save_draft", json!({ "raw": "From: other@x.be\n\nb" })).await).contains("From"));
        assert!(err(&call("send", json!({})).await).contains("Unknown tool"));
        assert!(err(&m.tool(&[], "", "search", &json!({ "query": "x" }), &d).await).contains("No mail account"));
        // "" is the default account, not the first: the default here is not configured
        assert!(err(&m.tool(&a, "other@x.be", "read", &json!({ "id": "1", "account": "" }), &d).await).contains("not configured"));
    }

    #[test]
    fn accounts_by_email() {
        let a = [acct("a@b.be"), acct("c@d.be")];
        assert_eq!(pick_account(&a, "").unwrap().email, "a@b.be");
        assert_eq!(pick_account(&a, "C@D.be").unwrap().email, "c@d.be");
        assert!(pick_account(&a, "x@y.be").is_none() && pick_account(&[], "").is_none());
        assert_eq!(pick(&a, "c@d.be", &json!("")).unwrap().email, "c@d.be");
        assert_eq!(pick(&a, "", &Value::Null).unwrap().email, "a@b.be");
    }

    #[test]
    fn thread_root() {
        let r = |raw: &str| root(&MessageParser::default().parse(raw.as_bytes()).unwrap());
        assert_eq!(r("References: <first@example.com> <second@example.com>\r\nMessage-ID: <own@example.com>\r\n\r\nb").as_deref(), Some("first@example.com"));
        assert_eq!(r("Message-ID: <own@example.com>\r\n\r\nb").as_deref(), Some("own@example.com"));
        assert_eq!(r("References: <.>\r\nMessage-ID: <own@example.com>\r\n\r\nb").as_deref(), Some("own@example.com"));
        assert_eq!(r("References: <.>\r\nMessage-ID: <a@b>\r\n\r\nb"), None);
        // an id an attacker controls as a substring: no local part
        assert_eq!(r("References: <@mail.gmail.com>\r\nMessage-ID: <own@example.com>\r\n\r\nb").as_deref(), Some("own@example.com"));
        assert_eq!(r("References: <abcdefgh@>\r\n\r\nb"), None);
        let m = |raw: &str| MessageParser::default().parse(raw.as_bytes()).unwrap().into_owned();
        let root = "first@example.com";
        assert!(in_thread(&m("Message-ID: <first@example.com>\r\n\r\nb"), root));
        assert!(in_thread(&m("References: <x@y.z> <first@example.com>\r\n\r\nb"), root));
        assert!(in_thread(&m("In-Reply-To: <first@example.com>\r\n\r\nb"), root));
        // HEADER search would return these, the exact check drops them
        assert!(!in_thread(&m("Message-ID: <evil.first@example.com>\r\nReferences: <first@example.com.evil>\r\n\r\nb"), root));
        assert!(!in_thread(&m("Subject: first@example.com\r\n\r\nb"), root));
    }

    /// VAULTMAIL_EMAIL=... VAULTMAIL_SERVICE=... VAULTMAIL_ACCOUNT=... cargo test --lib live_gmail -- --ignored
    #[tokio::test]
    #[ignore]
    async fn live_gmail_readonly() {
        let env = |k: &str| std::env::var(k).unwrap_or_else(|_| panic!("{k} not set"));
        let a = Account { email: env("VAULTMAIL_EMAIL"), keychain_service: env("VAULTMAIL_SERVICE"), keychain_account: env("VAULTMAIL_ACCOUNT"), host: "".into(), port: 993 };
        let (m, accts, d) = (Mail::new(), [a.clone()], std::env::temp_dir());
        let ok = |v: Value| -> Value { assert!(v["isError"].is_null(), "{v}"); serde_json::from_str(v["content"][0]["text"].as_str().unwrap()).unwrap() };
        // a fresh session in a fresh EXAMINE, so nothing cached answers
        let seen = async |id: u32| {
            let mut c = m.connect(&a).await.unwrap();
            let f = fetch(&mut c, &id.to_string(), "(UID FLAGS)").await.unwrap();
            let seen = f.iter().find(|f| f.uid == Some(id)).unwrap().flags().any(|x| x == Flag::Seen);
            seen
        };

        assert!(m.list(&a, 1, true).await.unwrap().as_array().unwrap().len() <= PAGE);
        let found = ok(m.tool(&accts, "", "search", &json!({ "query": "in:inbox", "limit": 3 }), &d).await);
        let id = found["results"][0]["id"].as_str().expect("an empty inbox").to_string();
        let before = seen(id.parse().unwrap()).await;
        let read = ok(m.tool(&accts, "", "read", &json!({ "id": id, "headers": ["Message-ID"] }), &d).await);
        assert_eq!(read["id"], id.as_str());
        let th = ok(m.tool(&accts, "", "thread", &json!({ "id": id }), &d).await);
        assert!(th["messages"].as_array().unwrap().iter().any(|x| x["id"] == id.as_str()));
        assert_eq!(seen(id.parse().unwrap()).await, before, "reading changed \\Seen");
        if let Ok(t) = std::env::var("VAULTMAIL_THREAD_ID") {
            let th = ok(m.tool(&accts, "", "thread", &json!({ "id": t }), &d).await);
            assert!(th["messages"].as_array().unwrap().len() > 1, "{th}");
        }
    }
}
