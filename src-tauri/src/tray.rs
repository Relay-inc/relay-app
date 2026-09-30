// The menu bar icon: overdue·today in the title, every reminder a submenu to tick off, push or drop,
// like the SwiftBar plugin it replaces. Rebuilt only when what it shows changes: after every reminder
// action, on each snapshot, when the settings change and every 5 minutes (a new day, edits by Claude).

use super::{reminders, rem_ctx, tr, ui_lang_of, App};
use serde_json::Value;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem as P, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

const ID: &str = "reminders";
static SHOWN: Mutex<String> = Mutex::new(String::new());

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    TrayIconBuilder::with_id(ID).title("⏰").show_menu_on_left_click(true)
        .on_menu_event(|app, e| { on_menu(app, e.id().as_ref()); }).build(app)?;
    refresh(app);
    let h = app.clone();
    std::thread::spawn(move || loop { std::thread::sleep(std::time::Duration::from_secs(300)); refresh(&h); });
    Ok(())
}

/// Menu ids of the tray, which the app-wide menu handler leaves alone.
pub fn owns(id: &str) -> bool { id == "tray-open" || id.starts_with("rem|") }

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") { w.show().ok(); w.unminimize().ok(); w.set_focus().ok(); }
}

fn on_menu(app: &AppHandle, id: &str) {
    if id == "tray-open" { show_main(app); return; }
    let parts: Vec<&str> = id.split('|').collect();
    let ["rem", action, rid, rest @ ..] = parts.as_slice() else { return };
    if let Ok((file, log, _)) = rem_ctx(app) {
        if let Err(e) = reminders::act(&file, &log, action, rid, rest.first().copied(), chrono::Local::now().date_naive()) {
            eprintln!("tray reminder {action} {rid}: {e}");
        }
    }
    refresh(app);
    app.emit("reminders-changed", ()).ok();
}

pub fn refresh(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(ID) else { return };
    let today = chrono::Local::now().date_naive();
    let (rows, lang) = match rem_ctx(app) {
        Ok((file, _, lang)) => (reminders::list(&file, today), lang),
        Err(_) => (vec![], ui_lang_of(&app.state::<App>().settings.lock().unwrap())),
    };
    let key = format!("{today} {lang} {}", Value::from(rows.clone()));
    { let mut shown = SHOWN.lock().unwrap(); if *shown == key { return; } *shown = key; }
    let n = |f: fn(i64) -> bool| rows.iter().filter(|r| f(days(r))).count();
    let (late, now) = (n(|d| d < 0), n(|d| d == 0));
    tray.set_title(Some(if late + now > 0 { format!("⏰ {late}·{now}") } else { "⏰".into() })).ok();
    match build(app, &rows, lang) {
        Ok(m) => { tray.set_menu(Some(m)).ok(); }
        Err(e) => eprintln!("tray menu: {e}"),
    }
}

fn days(r: &Value) -> i64 { r["days"].as_i64().unwrap_or(0) }

const GROUPS: [(&str, fn(i64) -> bool); 5] = [("tray.late", |d| d < 0), ("tray.today", |d| d == 0),
    ("tray.tomorrow", |d| d == 1), ("tray.week", |d| (2..=7).contains(&d)), ("tray.later", |d| d > 7)];

fn build(app: &AppHandle, rows: &[Value], lang: &str) -> tauri::Result<Menu<Wry>> {
    let t = |k: &str| tr(lang, k);
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(app, "tray-open", t("tray.open"), true, None::<&str>)?)?;
    menu.append(&P::separator(app)?)?;
    for (key, f) in GROUPS {
        let items: Vec<&Value> = rows.iter().filter(|r| f(days(r))).collect();
        if items.is_empty() { continue; }
        menu.append(&MenuItem::new(app, format!("{} ({})", t(key), items.len()), false, None::<&str>)?)?;
        for r in items { menu.append(&item(app, r, &t)?)?; }
        menu.append(&P::separator(app)?)?;
    }
    if rows.is_empty() {
        menu.append(&MenuItem::new(app, t("tray.none"), false, None::<&str>)?)?;
        menu.append(&P::separator(app)?)?;
    }
    menu.append(&P::quit(app, Some(&t("quit")))?)?;
    Ok(menu)
}

/// "-3d Weemaes: Voorstel afwerken ↻" (overdue) or "5/10 Weemaes: ...", with its actions underneath.
fn item(app: &AppHandle, r: &Value, t: &dyn Fn(&str) -> String) -> tauri::Result<Submenu<Wry>> {
    let (id, d) = (r["id"].as_str().unwrap_or(""), days(r));
    let date = r["date"].as_str().unwrap_or("");
    let when = if d < 0 { format!("-{}d", -d) } else {
        let (m, day) = (date.get(5..7).unwrap_or(""), date.get(8..10).unwrap_or(""));
        format!("{}/{}", day.trim_start_matches('0'), m.trim_start_matches('0'))
    };
    let proj = r["project"].as_str().map_or(String::new(), |p| format!("{p}: "));
    let rep = if r["repeat"].is_string() { " ↻" } else { "" };
    let mut label = format!("{when}  {proj}{}", r["title"].as_str().unwrap_or(""));
    if label.chars().count() > 80 { label = format!("{}…", label.chars().take(79).collect::<String>()); }
    let act = |key: &str, action: &str, date: Option<&str>| {
        let mid = date.map_or(format!("rem|{action}|{id}"), |d| format!("rem|{action}|{id}|{d}"));
        MenuItem::with_id(app, mid, t(key), true, None::<&str>)
    };
    Submenu::with_items(app, label + rep, true, &[
        &act("tray.done", "done", None)?, &act("tray.to_tomorrow", "push", Some("tomorrow"))?,
        &act("tray.to_monday", "push", Some("monday"))?, &act("tray.plus_week", "push", Some("+1w"))?,
        &act("tray.plus_month", "push", Some("+1m"))?, &P::separator(app)?, &act("tray.drop", "drop", None)?])
}
