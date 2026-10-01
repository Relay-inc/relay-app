// Agent actions: what the extensions can do, as `relay <extension>.<action>` for the agent in a conversation, so it
// can create a ticket, book time, add a reminder or save a mail draft with the app's own credentials, whatever
// provider runs it. `relay` is a small script in the app's data folder (bin/relay, first on the agent's PATH) that
// runs this binary as `relay --cli …`; the CLI asks the app over a Unix socket and prints the answer.
//
// Socket, one JSON line each way: `{conversation, cmd: "list"}` or `{conversation, cmd: "call", action, args}`, then
// `{ok: true, result}` or `{ok: false, error}`. The conversation is the agent's RELAY_CONVERSATION; a call from
// anything that is not a running conversation of the app is refused.
//
// Each action has a policy: auto (runs), ask (a card in the conversation, like a permission) or deny. The user sets
// it in settings.json `actions`: `{"productive": "auto"}` for a whole extension, or `{"productive": {"*": "ask",
// "time_entries": "auto"}}` per action; without one, reads run and writes ask. A session that holds mail text asks
// before every write, and mail only reaches Claude Code, the one provider whose session can be restricted.

use crate::{providers, reminders};
use board_core::{check_args, Action, Policy, Provider};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub const CONVERSATION: &str = "RELAY_CONVERSATION";
/// Next to the brokers' sockets: short, a socket path has a 104-byte limit on macOS.
pub fn sock() -> PathBuf { crate::broker::dir().join("relay.sock") }

/// One command: where it runs and what the user decides about it.
struct Item { ext: &'static str, id: &'static str, about: &'static str, args: &'static [(&'static str, &'static str)], write: bool, default: Policy, run: Run }
enum Run { Board(&'static Provider, &'static Action), Mail, Reminders }

const MAIL: &[(&str, &str, &[(&str, &str)], bool)] = &[
    ("search", "Search Gmail (All Mail) with Gmail search syntax, newest first: ids, senders, subjects, dates.", &[("query", "Gmail search"), ("account?", "account email"), ("limit?", "1 to 50, default 20")], false),
    ("read", "Read one mail: headers, attachment list, text body. Does not mark it read.", &[("id", "mail id from search"), ("account?", "account email")], false),
    ("thread", "The whole conversation of a mail, oldest first.", &[("id", "mail id from search"), ("account?", "account email")], false),
    ("attachment", "Save one attachment into ~/Downloads/Relay-mail, returns its path.", &[("id", "mail id"), ("index", "attachment index from read"), ("account?", "account email")], false),
    ("save_draft", "Save a full RFC 5322 message (a reply: In-Reply-To and References from read) as a Gmail draft. Never sent.", &[("raw", "the message"), ("account?", "account email")], true),
];
const REMINDERS: &[(&str, &str, &[(&str, &str)])] = &[
    ("list", "The vault's open reminders, with their ids.", &[]),
    ("add", "Add a reminder to the vault.", &[("text", "what to remember"), ("date", "YYYY-MM-DD, or morgen / +1w / maandag"), ("project?", "vault project name"), ("repeat?", "e.g. weekly")]),
    ("done", "Mark a reminder done (a repeating one moves on).", &[("id", "reminder id from list")]),
    ("push", "Move a reminder to another date.", &[("id", "reminder id from list"), ("date", "YYYY-MM-DD, or morgen / +1w")]),
];

fn items() -> Vec<Item> {
    let mut out: Vec<Item> = providers::PROVIDERS.iter().flat_map(|p| p.actions.iter().map(move |a|
        Item { ext: p.id, id: a.id, about: a.about, args: a.args, write: a.write, default: a.default, run: Run::Board(p, a) })).collect();
    // a draft only lands in Drafts: it runs without a card, as relay-mail's save_draft does
    out.extend(MAIL.iter().map(|(id, about, args, write)| Item { ext: "mail", id, about, args, write: *write, default: Policy::Auto, run: Run::Mail }));
    out.extend(REMINDERS.iter().map(|(id, about, args)| Item { ext: "reminders", id, about, args, write: *id != "list",
        default: if *id == "list" { Policy::Auto } else { Policy::Ask }, run: Run::Reminders }));
    out
}

/// The user's policy for an action, from settings.json `actions`: the action's own, the extension's `*`, the
/// extension as a whole, else the action's default.
fn chosen(settings: &Value, it: &Item) -> Policy {
    let s = &settings["actions"][it.ext];
    let pick = |v: &Value| v.as_str().and_then(Policy::parse);
    pick(&s[it.id]).or_else(|| pick(&s["*"])).or_else(|| pick(s)).unwrap_or(it.default)
}
/// What applies in this conversation: mail only for Claude Code, and a session holding mail text asks before a write.
fn effective(settings: &Value, it: &Item, provider: &str, tainted: bool) -> Policy {
    if it.ext == "mail" && provider != "claude" { return Policy::Deny; }
    match chosen(settings, it) {
        Policy::Auto if tainted && it.write && it.ext != "mail" => Policy::Ask,
        p => p,
    }
}

/// Whether an extension is set up: a board provider with its config and secrets, mail with an account, a vault.
fn ready(app: &AppHandle, ext: &str) -> bool {
    let st = app.state::<crate::App>();
    let s = st.settings.lock().unwrap().clone();
    match ext {
        "mail" => crate::mail_on(&s),
        "reminders" => crate::vault_of(&s)["ok"] == true,
        id => providers::get(id).is_ok_and(|p| (p.ready)(&s["integrations"][p.id]) && providers::token(p).is_some()),
    }
}

// ---------- the app's side: the socket

/// The `relay` script on the agent's PATH, and the socket it talks to.
pub fn start(app: &AppHandle) {
    if let Some(bin) = bin_dir(app) {
        let exe = std::env::current_exe().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default();
        let script = format!("#!/bin/sh\nexec '{}' --cli \"$@\"\n", exe.replace('\'', "'\\''"));
        let f = bin.join("relay");
        if std::fs::write(&f, script).is_ok() { set_mode(&f, 0o755); }
    }
    let path = sock();
    std::fs::create_dir_all(path.parent().unwrap()).ok();
    std::fs::remove_file(&path).ok();
    let Ok(l) = UnixListener::bind(&path) else { return };
    set_mode(&path, 0o600); // only this user's processes
    let app = app.clone();
    std::thread::spawn(move || for c in l.incoming().flatten() { let app = app.clone(); std::thread::spawn(move || serve(&app, c)); });
}
pub fn bin_dir(app: &AppHandle) -> Option<PathBuf> {
    let d = app.path().app_data_dir().ok()?.join("bin");
    std::fs::create_dir_all(&d).ok().map(|_| d)
}
fn set_mode(p: &std::path::Path, mode: u32) { use std::os::unix::fs::PermissionsExt; std::fs::set_permissions(p, std::fs::Permissions::from_mode(mode)).ok(); }

fn serve(app: &AppHandle, c: UnixStream) {
    let mut line = String::new();
    if BufReader::new(&c).read_line(&mut line).is_err() { return; }
    let req: Value = serde_json::from_str(&line).unwrap_or_default();
    let res = match req["cmd"].as_str() {
        Some("list") => list(app, req["conversation"].as_str().unwrap_or("")),
        Some("call") => call(app, &c, req["conversation"].as_str().unwrap_or(""), req["action"].as_str().unwrap_or(""), &req["args"]),
        _ => Err("unknown command".into()),
    };
    let out = match res { Ok(v) => json!({ "ok": true, "result": v }), Err(e) => json!({ "ok": false, "error": e }) };
    (&c).write_all(format!("{out}\n").as_bytes()).ok();
}

/// The conversation's provider and whether it holds mail text; None when it is not one of the app's running ones.
fn conversation(app: &AppHandle, key: &str) -> Option<(String, bool)> {
    app.state::<crate::App>().procs.lock().unwrap().get(key).map(|p| (p.provider.to_string(), p.tainted))
}

fn list(app: &AppHandle, key: &str) -> Result<Value, String> {
    let (provider, tainted) = conversation(app, key).ok_or(NOT_IN_APP)?;
    let s = app.state::<crate::App>().settings.lock().unwrap().clone();
    let mut ready_of = std::collections::HashMap::new();
    Ok(items().iter().filter(|it| *ready_of.entry(it.ext).or_insert_with(|| ready(app, it.ext))).map(|it| json!({
        "action": format!("{}.{}", it.ext, it.id), "about": it.about, "args": it.args.iter().map(|(n, a)| json!([n, a])).collect::<Vec<_>>(),
        "policy": effective(&s, it, &provider, tainted).as_str(),
    })).collect())
}
const NOT_IN_APP: &str = "relay only works inside a conversation of the Relay app";

fn call(app: &AppHandle, c: &UnixStream, key: &str, action: &str, args: &Value) -> Result<Value, String> {
    let (provider, tainted) = conversation(app, key).ok_or(NOT_IN_APP)?;
    let all = items();
    let it = all.iter().find(|it| format!("{}.{}", it.ext, it.id) == action).ok_or_else(|| format!("no action '{action}', `relay help` lists them"))?;
    check_args(it.args, args)?;
    if !ready(app, it.ext) { return Err(format!("{} is not set up in Relay (Settings)", it.ext)); }
    let s = app.state::<crate::App>().settings.lock().unwrap().clone();
    match effective(&s, it, &provider, tainted) {
        Policy::Deny if it.ext == "mail" && provider != "claude" => return Err("mail is only available to Claude Code conversations".into()),
        Policy::Deny => return Err(format!("the user does not allow {action} (settings.json, actions.{})", it.ext)),
        Policy::Ask => ask(app, c, key, &provider, action, args)?,
        Policy::Auto => {}
    }
    match it.run {
        Run::Board(p, a) => {
            let cfg = s["integrations"][p.id].clone();
            let r = (a.build)(&cfg, args)?;
            providers::send(p, &cfg, r.method, &r.url, r.body).map(|v| (a.out)(&v))
        }
        Run::Mail => mail(app, key, it.id, args),
        Run::Reminders => reminder(app, it.id, args),
    }
}

/// A card in the conversation, as for a permission; blocks until the user answers or the agent stops waiting.
fn ask(app: &AppHandle, c: &UnixStream, key: &str, provider: &str, action: &str, args: &Value) -> Result<(), String> {
    use agent_core::pending;
    let dir = crate::pending_dir(app);
    let mut r = pending::Request::new("tool", &format!("relay {action}"), args.clone());
    (r.project, r.provider, r.relay) = (key.into(), provider.into(), false);
    pending::write(&dir, &r).map_err(|e| e.to_string())?;
    let until = Instant::now() + Duration::from_secs(86_400);
    loop {
        if let Some(d) = pending::take(&dir, &r.id) {
            if d["behavior"] != "allow" { return Err(format!("the user declined {action}{}", d["message"].as_str().map(|m| format!(": {m}")).unwrap_or_default())); }
            // the agent may have given up while the card waited: nothing runs for nobody
            return if gone(c) { Err("gone".into()) } else { Ok(()) };
        }
        if gone(c) || Instant::now() > until {
            pending::answer(&dir, &r.id, &json!({ "behavior": "deny", "message": "the agent stopped waiting" })).ok();
            pending::take(&dir, &r.id);
            return Err("stopped waiting".into());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}
/// The CLI closed its end (the agent's command was stopped).
fn gone(c: &UnixStream) -> bool {
    if c.set_nonblocking(true).is_err() { return true; }
    let closed = matches!((&*c).read(&mut [0u8; 1]), Ok(0));
    c.set_nonblocking(false).ok();
    closed
}

fn mail(app: &AppHandle, key: &str, name: &str, args: &Value) -> Result<Value, String> {
    let st = app.state::<crate::App>();
    // mail text is about to enter this session: restricted before the tool runs, as for relay-mail
    if name != "save_draft" {
        let v = crate::vault(&st);
        if let Some(p) = st.procs.lock().unwrap().get_mut(key).filter(|p| !p.tainted) { crate::write_taint(p, &v); }
    }
    let mut args = args.clone();
    for k in ["limit", "index"] { if let Some(n) = args[k].as_str().and_then(|s| s.parse::<u64>().ok()) { args[k] = json!(n); } }
    let (accts, default) = { let s = st.settings.lock().unwrap(); (crate::mail::accounts(&s["mail"]), s["mail"]["account"].as_str().unwrap_or("").to_string()) };
    let dl = PathBuf::from(crate::home()).join("Downloads/Relay-mail");
    let res = tauri::async_runtime::block_on(st.mail.tool(&accts, &default, name, &args, &dl));
    let text = res["content"][0]["text"].as_str().unwrap_or("").to_string();
    if res["isError"] == true { return Err(text); }
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::String(text));
    if name == "save_draft" {
        // the chat shows who the draft is really for, whatever the agent writes about it
        app.emit("agent", json!({"project": key, "provider": "claude", "event": {"type": "draft_saved", "folder": v["folder"], "to": v["to"], "cc": v["cc"], "bcc": v["bcc"]}})).ok();
    }
    Ok(v)
}

fn reminder(app: &AppHandle, name: &str, args: &Value) -> Result<Value, String> {
    let (file, log, lang) = crate::rem_ctx(app)?;
    let a = |k: &str| board_core::arg(args, k);
    let today = chrono::Local::now().date_naive();
    let r = match name {
        "list" => return Ok(json!(reminders::list(&file, today))),
        "add" => reminders::add(&file, &log, &a("text").unwrap_or_default(), &a("date").unwrap_or_default(), a("project").as_deref(), a("repeat").as_deref(), today).map(|id| json!({ "id": id })),
        act => reminders::act(&file, &log, act, &a("id").unwrap_or_default(), a("date").as_deref(), today).map(|d| json!({ "date": d })),
    };
    crate::tray::refresh(app);
    r.map_err(|e| crate::rem_err(lang, e))
}

// ---------- the CLI's side: `relay --cli …`, run by the agent

pub fn cli(args: &[String]) -> i32 {
    let key = std::env::var(CONVERSATION).unwrap_or_default();
    let res = match args.first().map(String::as_str) {
        None | Some("help" | "--help" | "-h") => ask_app(&json!({ "conversation": key, "cmd": "list" })).map(|v| { print!("{}", help(&v)); Value::Null }),
        Some(action) => parse(&args[1..]).and_then(|a| ask_app(&json!({ "conversation": key, "cmd": "call", "action": action, "args": a }))),
    };
    match res {
        Ok(Value::Null) => 0,
        Ok(v) => { println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default()); 0 }
        Err(e) => { eprintln!("relay: {e}"); 1 }
    }
}

/// `key=value …`, one JSON object, or `-` for a JSON object on stdin.
fn parse(rest: &[String]) -> Result<Value, String> {
    match rest {
        [one] if one == "-" => { let mut s = String::new(); std::io::stdin().read_to_string(&mut s).map_err(|e| e.to_string())?; serde_json::from_str(&s).map_err(|e| format!("stdin: {e}")) }
        [one] if one.trim_start().starts_with('{') => serde_json::from_str(one).map_err(|e| format!("arguments: {e}")),
        _ => rest.iter().map(|kv| kv.split_once('=').map(|(k, v)| (k.to_string(), json!(v))).ok_or_else(|| format!("'{kv}': arguments are key=value")))
            .collect::<Result<serde_json::Map<_, _>, _>>().map(Value::Object),
    }
}

fn ask_app(req: &Value) -> Result<Value, String> {
    let mut c = UnixStream::connect(sock()).map_err(|_| "the Relay app is not running".to_string())?;
    c.write_all(format!("{req}\n").as_bytes()).map_err(|e| e.to_string())?;
    let mut line = String::new();
    BufReader::new(&c).read_line(&mut line).map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&line).map_err(|_| "no answer from the Relay app".to_string())?;
    if v["ok"] == true { Ok(v["result"].clone()) } else { Err(v["error"].as_str().unwrap_or("failed").to_string()) }
}

fn help(list: &Value) -> String {
    let mut out = String::from("Relay actions in this conversation. Run `relay <action> key=value …` (or one JSON object, or - for JSON on stdin).\nPolicy: auto runs, ask shows the user a card first, deny is refused.\n");
    for a in list.as_array().into_iter().flatten() {
        out += &format!("\n{}  [{}]  {}\n", a["action"].as_str().unwrap_or(""), a["policy"].as_str().unwrap_or(""), a["about"].as_str().unwrap_or(""));
        for x in a["args"].as_array().into_iter().flatten() { out += &format!("    {:<14} {}\n", x[0].as_str().unwrap_or(""), x[1].as_str().unwrap_or("")); }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    fn item(ext: &str) -> &'static Item { Box::leak(Box::new(items().into_iter().find(|i| i.ext == ext && i.write).unwrap())) }

    #[test]
    fn policy_from_settings_then_default_and_mail_text_asks() {
        let w = item("productive");
        assert_eq!(chosen(&json!({}), w), Policy::Ask);
        assert_eq!(chosen(&json!({"actions": {"productive": "auto"}}), w), Policy::Auto);
        assert_eq!(chosen(&json!({"actions": {"productive": {"*": "deny", w.id: "auto"}}}), w), Policy::Auto);
        assert_eq!(chosen(&json!({"actions": {"productive": {"*": "deny"}}}), w), Policy::Deny);
        assert_eq!(chosen(&json!({"actions": {"productive": "maybe"}}), w), Policy::Ask);
        let auto = json!({"actions": {"productive": "auto"}});
        assert_eq!(effective(&auto, w, "codex", false), Policy::Auto);
        assert_eq!(effective(&auto, w, "claude", true), Policy::Ask);
        let draft = items().into_iter().find(|i| i.ext == "mail" && i.id == "save_draft").unwrap();
        assert_eq!(effective(&json!({}), &draft, "claude", true), Policy::Auto);
        assert_eq!(effective(&json!({"actions": {"mail": "auto"}}), &draft, "codex", false), Policy::Deny);
    }
    #[test]
    fn every_action_has_a_unique_name() {
        let names: Vec<String> = items().iter().map(|i| format!("{}.{}", i.ext, i.id)).collect();
        let mut d = names.clone(); d.sort(); d.dedup();
        assert_eq!(d.len(), names.len());
        assert!(names.contains(&"productive.add_time".into()) && names.contains(&"reminders.add".into()) && names.contains(&"trello.create_card".into()));
    }
    #[test]
    fn cli_arguments() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(parse(&s(&["title=Fix it", "project=3"])).unwrap(), json!({"title": "Fix it", "project": "3"}));
        assert_eq!(parse(&s(&["note=a=b"])).unwrap(), json!({"note": "a=b"}));
        assert_eq!(parse(&s(&[r#"{"minutes": 90}"#])).unwrap(), json!({"minutes": 90}));
        assert_eq!(parse(&[]).unwrap(), json!({}));
        assert!(parse(&s(&["oops"])).is_err());
        let h = help(&json!([{"action": "trello.create_card", "policy": "ask", "about": "Create", "args": [["list", "list id"]]}]));
        assert!(h.contains("trello.create_card  [ask]  Create") && h.contains("    list           list id"));
    }
}
