// Auto-retry after a provider limit (#81). A turn refused on a used-up account that has no other account to move to
// waits here until the limit resets: kept in retry.json in the app data dir, so it outlives a restart, and the Mac
// stays awake for it (awake.rs). At its time the webview gets a `retry` event and sends the turn itself, since it knows
// the conversation's model, effort and machine. One retry per limit hit: a second refusal stays an error.
// Only with settings.autoRetry on.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use super::{agents, data_dir, App};
use agent_core::AgentProvider;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Retry {
    pub key: String,
    provider: String,
    account: String,
    model: String,
    /// epoch ms: the reset plus a minute when the provider gave one (`known`), else the next look at its limits
    pub at: i64,
    pub known: bool,
    /// the refused turn did nothing yet: the webview sends its message again instead of asking to continue
    pub fresh: bool,
}

const RECHECK: i64 = 15 * 60_000;
const MARGIN: i64 = 60_000;
static QUEUE: Mutex<Vec<Retry>> = Mutex::new(Vec::new());
/// conversations whose retry was sent: refused again, they stay refused
static FIRED: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// the webview listens for `retry`: set when it first asks for the list, so nothing due at start fires into the void
static READY: AtomicBool = AtomicBool::new(false);

fn now() -> i64 { agent_core::usage::now_ms() }
fn file(app: &AppHandle) -> std::path::PathBuf { data_dir(app).join("retry.json") }
fn changed(app: &AppHandle, q: &[Retry]) {
    std::fs::write(file(app), serde_json::to_string(q).unwrap_or_default()).ok();
    app.emit("retry", json!({"type": "list", "retries": q})).ok();
}

/// A retry is waiting: the Mac stays awake for it.
pub fn pending() -> bool { !QUEUE.lock().unwrap().is_empty() }

#[tauri::command]
pub fn retries() -> Vec<Retry> {
    READY.store(true, Ordering::Relaxed);
    QUEUE.lock().unwrap().clone()
}
#[tauri::command]
pub fn retry_cancel(app: AppHandle, key: String) {
    let mut q = QUEUE.lock().unwrap();
    if q.iter().any(|r| r.key == key) { q.retain(|r| r.key != key); changed(&app, &q); }
}

/// The latest reset of the windows that are full for `model`, epoch ms.
fn reset_of(limits: &Value, model: &str) -> Option<i64> {
    agents::full(limits, model).filter_map(|w| chrono::DateTime::parse_from_rfc3339(w["resets"].as_str()?).ok()).map(|d| d.timestamp_millis()).max()
}
/// The account's limits read now (a network call), also into the cache the usage view and auto-switch read.
fn read(app: &AppHandle, p: &'static dyn AgentProvider, account: &str) -> Value {
    let st = app.state::<App>();
    let mut eb = super::env_of(app, &st, p);
    if p.caps().accounts { eb.opts["account"] = json!(account); }
    let v = p.limits(&eb.env()).json();
    st.limits.lock().unwrap().insert(super::limit_key(p, account), (now(), v.clone()));
    v
}

/// A turn of `key` ended on `account`. `limited`: the provider refused it for its limit, `hint` the reset it named
/// (epoch ms); `fresh`: nothing happened in it yet. Called after the account is marked spent.
#[allow(clippy::too_many_arguments)]
pub fn turn_end(app: &AppHandle, key: &str, p: &'static dyn AgentProvider, account: &str, model: &str, limited: bool, hint: Option<i64>, fresh: bool) {
    {
        let mut fired = FIRED.lock().unwrap();
        let again = fired.iter().any(|k| k == key);
        fired.retain(|k| k != key);
        if again { return; }
    }
    if !limited {
        // a turn that went through (also one replayed after a restart) leaves nothing to retry
        let mut q = QUEUE.lock().unwrap();
        if q.iter().any(|r| r.key == key) { q.retain(|r| r.key != key); changed(app, &q); }
        return;
    }
    let st = app.state::<App>();
    if st.settings.lock().unwrap()["autoRetry"] != true || super::orch::is_orch(key) { return; }
    // a work machine's limits are its own login's, not this Mac's
    if st.procs.lock().unwrap().get(key).is_some_and(|x| x.remote) { return; }
    // with auto-switch on and another account free, the next message moves there: nothing to wait for
    if super::account_of(&st, p, key, model) != account { return; }
    let (app, key, account, model) = (app.clone(), key.to_string(), account.to_string(), model.to_string());
    std::thread::spawn(move || {
        let reset = hint.or_else(|| if p.caps().limits { reset_of(&read(&app, p, &account), &model) } else { None });
        let r = Retry { key, provider: p.id().into(), account, model, at: reset.map_or(now() + RECHECK, |x| x.max(now()) + MARGIN), known: reset.is_some(), fresh };
        let mut q = QUEUE.lock().unwrap();
        q.retain(|x| x.key != r.key);
        q.push(r);
        changed(&app, &q);
    });
}

/// The retries that are due: without a known reset, the limits are read first and a full one looks again later.
fn tick(app: &AppHandle) {
    if !READY.load(Ordering::Relaxed) { return; }
    // switched off: what waits is dropped, and the Mac may sleep again
    if app.state::<App>().settings.lock().unwrap()["autoRetry"] != true {
        let mut q = QUEUE.lock().unwrap();
        if !q.is_empty() { q.clear(); changed(app, &q); }
        return;
    }
    let due: Vec<Retry> = QUEUE.lock().unwrap().iter().filter(|r| r.at <= now()).cloned().collect();
    for r in due {
        let p = agents::get_or_first(Some(&r.provider));
        if !r.known && p.caps().limits {
            let v = read(app, p, &r.account);
            if v["ok"] != true || agents::used_up(&v, &r.model) {
                let reset = reset_of(&v, &r.model);
                let mut q = QUEUE.lock().unwrap();
                if let Some(x) = q.iter_mut().find(|x| x.key == r.key) {
                    (x.at, x.known) = (reset.map_or(now() + RECHECK, |x| x + MARGIN), reset.is_some());
                    changed(app, &q);
                }
                continue;
            }
        }
        {
            let mut q = QUEUE.lock().unwrap();
            if !q.contains(&r) { continue; } // cancelled meanwhile
            q.retain(|x| x.key != r.key);
            changed(app, &q);
        }
        FIRED.lock().unwrap().push(r.key.clone());
        app.state::<App>().spent.lock().unwrap().remove(&super::limit_key(p, &r.account));
        app.emit("retry", json!({"type": "fire", "key": r.key, "fresh": r.fresh})).ok();
    }
}

/// What waited while the app was closed, then a look every 30 s.
pub fn start(app: &AppHandle) {
    *QUEUE.lock().unwrap() = std::fs::read_to_string(file(app)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let app = app.clone();
    std::thread::spawn(move || loop {
        tick(&app);
        std::thread::sleep(std::time::Duration::from_secs(30));
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_reset_of_the_full_windows_for_the_model() {
        let w = |name: Value, pct: f64, resets: &str| json!({"name": name, "pct": pct, "resets": resets});
        let v = json!({"ok": true, "windows": [w(Value::Null, 100.0, "2026-10-04T13:00:00Z"), w(json!("Opus"), 100.0, "2026-10-06T09:00:00+00:00"), w(Value::Null, 40.0, "2026-10-09T00:00:00Z")]});
        assert_eq!(reset_of(&v, "sonnet"), Some(chrono::DateTime::parse_from_rfc3339("2026-10-04T13:00:00Z").unwrap().timestamp_millis()));
        assert_eq!(reset_of(&v, "claude-opus-5-5"), Some(chrono::DateTime::parse_from_rfc3339("2026-10-06T09:00:00Z").unwrap().timestamp_millis()));
        assert_eq!(reset_of(&json!({"ok": true, "windows": [{"name": null, "pct": 100.0, "resets": null}]}), ""), None);
    }
}
