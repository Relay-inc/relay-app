// The menu bar icon: overdue·today in the title, every reminder a submenu to tick off, push or drop,
// like the SwiftBar plugin it replaces. Rebuilt only when what it shows changes: after every reminder
// action, on each snapshot, when the settings change and every 5 minutes (a new day, edits by Claude).

use super::{relay_config, reminders, rem_ctx, tr, ui_lang_of, vault_of, App};
// muda directly instead of tauri::menu: only muda hands out the native menus, which the macOS look below needs.
// Its events still reach on_menu, tauri forwards every muda event to the menu listeners.
use muda::{Menu, MenuItem, PredefinedMenuItem as P, Submenu};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

const ID: &str = "reminders";
static SHOWN: Mutex<String> = Mutex::new(String::new());

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    TrayIconBuilder::with_id(ID).icon(tauri::include_image!("icons/tray-template.png")).icon_as_template(true)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, e| { on_menu(app, e.id().as_ref()); }).build(app)?;
    refresh(app);
    let h = app.clone();
    std::thread::spawn(move || loop { std::thread::sleep(std::time::Duration::from_secs(300)); refresh(&h); });
    Ok(())
}

/// Menu ids of the tray, which the app-wide menu handler leaves alone.
pub fn owns(id: &str) -> bool { id == "tray-open" || id.starts_with("rem|") }

fn on_menu(app: &AppHandle, id: &str) {
    if id == "tray-open" { super::windows::show_active(app); return; }
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
    let icons = { let v = vault_of(&app.state::<App>().settings.lock().unwrap()); relay_config::icon_files(v["vault"].as_str().unwrap_or("")) };
    let key = format!("{today} {lang} {} {icons:?}", Value::from(rows.clone()));
    { let mut shown = SHOWN.lock().unwrap(); if *shown == key { return; } *shown = key; }
    let n = |f: fn(i64) -> bool| rows.iter().filter(|r| f(days(r))).count();
    let (late, now) = (n(|d| d < 0), n(|d| d == 0));
    let title = if late + now > 0 { (late + now).to_string() } else { String::new() };
    tray.set_title(Some(&title)).ok();
    #[cfg(target_os = "macos")]
    if late > 0 { tray.with_inner_tray_icon(move |t| red_title(t.ns_status_item(), &title)).ok(); }
    // muda builds on the main thread, which with_inner_tray_icon runs on
    tray.with_inner_tray_icon(move |t| match build(&rows, lang, &icons) {
        Ok(m) => t.set_menu(Some(Box::new(m))),
        Err(e) => eprintln!("tray menu: {e}"),
    }).ok();
}

/// Red title while something is overdue, like the SwiftBar plugin. A plain set_title clears it again.
#[cfg(target_os = "macos")]
fn red_title(item: Option<objc2::rc::Retained<objc2_app_kit::NSStatusItem>>, title: &str) {
    use objc2_app_kit::{NSColor, NSForegroundColorAttributeName};
    use objc2_foundation::{NSAttributedString, NSDictionary, NSString};
    let (Some(item), Some(mtm)) = (item, objc2::MainThreadMarker::new()) else { return };
    let Some(button) = item.button(mtm) else { return };
    let red = NSColor::systemRedColor();
    let attrs = NSDictionary::from_slices(&[unsafe { NSForegroundColorAttributeName }], &[&**red as &objc2::runtime::AnyObject]);
    let s = unsafe { NSAttributedString::new_with_attributes(&NSString::from_str(title), &attrs) };
    button.setAttributedTitle(&s);
}

fn days(r: &Value) -> i64 { r["days"].as_i64().unwrap_or(0) }

const GROUPS: [(&str, fn(i64) -> bool); 5] = [("tray.late", |d| d < 0), ("tray.today", |d| d == 0),
    ("tray.tomorrow", |d| d == 1), ("tray.week", |d| (2..=7).contains(&d)), ("tray.later", |d| d > 7)];

/// What a reminder row shows on macOS besides its title: icon, project as subtitle, date as badge.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
struct Look { at: (usize, Option<usize>), icon: Option<PathBuf>, folder: bool, subtitle: String, badge: String }

fn build(rows: &[Value], lang: &str, icons: &BTreeMap<String, PathBuf>) -> muda::Result<Menu> {
    let t = |k: &str| tr(lang, k);
    let menu = Menu::new();
    let mut looks = vec![];
    menu.append(&MenuItem::with_id("tray-open", t("tray.open"), true, None))?;
    menu.append(&P::separator())?;
    for (key, f) in GROUPS {
        let items: Vec<&Value> = rows.iter().filter(|r| f(days(r))).collect();
        if items.is_empty() { continue; }
        menu.append(&MenuItem::new(t(key), false, None))?;
        // Later keeps the next three in sight, the rest goes under More
        let (shown, rest) = items.split_at(if key == "tray.later" { items.len().min(3) } else { items.len() });
        // every muda item is one native item, so its index in muda is its index in the NSMenu
        for r in shown { let (sub, mut l) = item(r, &t, icons)?; l.at = (menu.items().len(), None); menu.append(&sub)?; looks.push(l); }
        if !rest.is_empty() {
            let n = rest.len().to_string();
            let label = if cfg!(target_os = "macos") { t("tray.more") } else { format!("{} ({n})", t("tray.more")) };
            let (more, at) = (Submenu::new(label, true), menu.items().len());
            for r in rest { let (sub, mut l) = item(r, &t, icons)?; l.at = (at, Some(more.items().len())); more.append(&sub)?; looks.push(l); }
            menu.append(&more)?;
            looks.push(Look { at: (at, None), icon: None, folder: false, subtitle: String::new(), badge: n });
        }
        menu.append(&P::separator())?;
    }
    if rows.is_empty() {
        menu.append(&MenuItem::new(t("tray.none"), false, None))?;
        menu.append(&P::separator())?;
    }
    menu.append(&P::quit(Some(&t("quit"))))?;
    #[cfg(target_os = "macos")]
    for l in &looks {
        match mac::item_at(&menu, l.at) {
            Some(ns) => mac::dress(&ns, l.icon.as_deref(), l.folder, &l.subtitle, &l.badge),
            None => eprintln!("tray menu: no native item at {:?}", l.at),
        }
    }
    #[cfg(not(target_os = "macos"))]
    drop(looks);
    Ok(menu)
}

/// A reminder with its actions underneath. macOS: the title alone, the project, its icon and the date go on the
/// native item. Elsewhere it all goes in the label: "-3d Weemaes: Voorstel afwerken ↻" or "5/10 Weemaes: ...".
fn item(r: &Value, t: &dyn Fn(&str) -> String, icons: &BTreeMap<String, PathBuf>) -> muda::Result<(Submenu, Look)> {
    let (id, d) = (r["id"].as_str().unwrap_or(""), days(r));
    let date = r["date"].as_str().unwrap_or("");
    let when = if d < 0 { format!("-{}d", -d) } else {
        let (m, day) = (date.get(5..7).unwrap_or(""), date.get(8..10).unwrap_or(""));
        format!("{}/{}", day.trim_start_matches('0'), m.trim_start_matches('0'))
    };
    let proj = r["project"].as_str();
    let rep = if r["repeat"].is_string() { " ↻" } else { "" };
    // "Skill `craft-upgrade-audit` afwerken op Xeos, in deze volgorde:" reads as a title without the markdown
    let title = r["title"].as_str().unwrap_or("").replace('`', "");
    let title = title.trim_end_matches(':');
    let mut label = if cfg!(target_os = "macos") { title.to_string() }
        else { format!("{when}  {}{title}{rep}", proj.map_or(String::new(), |p| format!("{p}: "))) };
    let max = if cfg!(target_os = "macos") { 60 } else { 80 };
    if label.chars().count() > max { label = format!("{}…", label.chars().take(max - 1).collect::<String>().trim_end()); }
    let act = |key: &str, action: &str, date: Option<&str>| {
        let mid = date.map_or(format!("rem|{action}|{id}"), |d| format!("rem|{action}|{id}|{d}"));
        MenuItem::with_id(mid, t(key), true, None)
    };
    let sub = Submenu::with_items(label, true, &[
        &act("tray.done", "done", None), &act("tray.to_tomorrow", "push", Some("tomorrow")),
        &act("tray.to_monday", "push", Some("monday")), &act("tray.plus_week", "push", Some("+1w")),
        &act("tray.plus_month", "push", Some("+1m")), &P::separator(), &act("tray.drop", "drop", None)])?;
    // today and tomorrow are in the group heading already
    let badge = if !(0..=1).contains(&d) { when } else { String::new() };
    // ponytail: an emoji icon shows the folder too, draw the emoji into an NSImage if one turns up on a reminder
    Ok((sub, Look { at: (0, None), icon: proj.and_then(|p| icons.get(p)).cloned(), folder: true, subtitle: proj.map_or(String::new(), |p| format!("{p}{rep}")), badge }))
}

#[cfg(target_os = "macos")]
mod mac {
    use muda::{ContextMenu, Menu};
    use objc2::{rc::Retained, sel, AnyThread};
    use objc2_app_kit::{NSImage, NSMenu, NSMenuItem, NSMenuItemBadge};
    use objc2_foundation::{NSObjectProtocol, NSSize, NSString};
    use std::path::Path;

    /// The native item at `(i, j)`: item i of the menu the tray shows, or item j of its submenu. muda keeps the
    /// items to itself, and a Submenu's own ns_menu() is a separate copy that is never shown.
    pub fn item_at(menu: &Menu, (i, j): (usize, Option<usize>)) -> Option<Retained<NSMenuItem>> {
        let root = unsafe { (menu.ns_menu() as *const NSMenu).as_ref()? };
        let item = root.itemAtIndex(i as isize)?;
        match j { None => Some(item), Some(j) => item.submenu()?.itemAtIndex(j as isize) }
    }

    /// Project icon (the folder symbol without one, like the sidebar), subtitle and badge. Subtitle needs
    /// macOS 14.4 and badge 14, older versions just show the title.
    pub fn dress(item: &NSMenuItem, icon: Option<&Path>, folder: bool, subtitle: &str, badge: &str) {
        let img = match icon {
            Some(p) => NSImage::initWithContentsOfFile(NSImage::alloc(), &NSString::from_str(&p.to_string_lossy())),
            None if folder => NSImage::imageWithSystemSymbolName_accessibilityDescription(&NSString::from_str("folder"), None),
            None => None,
        };
        if let Some(img) = img { img.setSize(NSSize::new(16.0, 16.0)); item.setImage(Some(&img)); }
        if !subtitle.is_empty() && item.respondsToSelector(sel!(setSubtitle:)) { item.setSubtitle(Some(&NSString::from_str(subtitle))); }
        if !badge.is_empty() && item.respondsToSelector(sel!(setBadge:)) {
            item.setBadge(Some(&NSMenuItemBadge::initWithString(NSMenuItemBadge::alloc(), &NSString::from_str(badge))));
        }
    }
}
