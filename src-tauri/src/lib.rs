// Relay: a shell around real coding-agent CLIs (Claude Code, and more behind the agent-provider contract in
// packages/agent-core). Every conversation is a process of its provider, in the vault, on the user's own
// login (no API key). Permission requests and questions come in as files in the pending folder. Mail tools
// (mail/) are answered by the app itself over Claude Code's stdin/stdout pipe, as the in-process MCP server
// `relay-mail`; the other providers do not get mail.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::os::unix::net::UnixStream;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use agent_core::{pending, usage, AgentProvider, Event, Image, Launch, Terminal, Turn, IMAGE_TYPES};

mod agents;
pub mod broker;
mod mail;
pub mod notify;
mod providers;
mod relay_config;
mod reminders;
mod tray;
mod vault;

// ponytail: REPO is fixed, fine as long as the app runs from its own checkout.
const REPO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/..");
fn home() -> String { std::env::var("HOME").unwrap_or_default() }
/// The vault folder from the settings, "" before one is chosen.
fn vault(st: &App) -> String {
    st.settings.lock().unwrap()["vault"].as_str().unwrap_or("").to_string()
}
/// The vault's mapping: the paths in its .relay/config.json; for a vault without one, the mapping an older
/// version stored in settings.json, or what detection finds. set_settings writes it to the config.
fn vault_map(s: &Value, v: &str) -> Value {
    if v.is_empty() { return vault::merge(&json!({}), &json!({})); }
    if let Some(p) = relay_config::load(v).map(|c| c["paths"].clone()).filter(Value::is_object) { return vault::merge(&json!({}), &p); }
    let stored = &s["vaults"][v];
    if stored.is_object() { vault::merge(&json!({}), stored) } else { vault::merge(&vault::detect(v).1, stored) }
}
/// The configured vault with its mapping and which mapped paths exist.
fn vault_of(s: &Value) -> Value {
    let v = s["vault"].as_str().unwrap_or("");
    vault::status(v, &vault_map(s, v))
}
/// The vault, or an error when none is set up yet: nothing runs or reads outside a chosen vault.
fn need_vault(st: &App) -> Result<String, String> {
    let s = st.settings.lock().unwrap();
    let vs = vault_of(&s);
    if vs["ok"] == true { Ok(vs["vault"].as_str().unwrap().to_string()) } else { Err(tr(ui_lang_of(&s), "err.no_vault_set")) }
}
/// The reminders file (it may not exist yet), the action log and the UI language. Needs a usable vault.
fn rem_ctx(app: &AppHandle) -> Result<(PathBuf, PathBuf, &'static str), String> {
    let (st, lang) = { let s = app.state::<App>().settings.lock().unwrap().clone(); (vault_of(&s), ui_lang_of(&s)) };
    if st["ok"] != true { return Err(tr(lang, "err.no_vault_set")); }
    let file = vault::resolve(st["vault"].as_str().unwrap(), st["map"]["reminders"].as_str().unwrap_or(vault::REMINDERS));
    Ok((file, data_dir(app).join("reminder-actions.log"), lang))
}
/// An engine error in the UI language: its err.* keys translated, anything else (I/O) as is.
fn rem_err(lang: &str, e: String) -> String { if e.starts_with("err.") { tr(lang, &e) } else { e } }
/// The brain folder of a vault (System/, or Resources/Meta/Claude/ in the old layout), for its index/repos.json.
fn brain(vault: &str) -> Option<String> {
    ["System", "Resources/Meta/Claude"].iter().map(|d| format!("{vault}/{d}"))
        .find(|m| PathBuf::from(m).join("rules/core/work-state.md").is_file())
}
/// Settings as stored on disk, with the defaults filled in for missing or malformed keys.
fn norm(mut v: Value) -> Value {
    if !v.is_object() { v = json!({}); }
    if !v["vault"].is_string() { v["vault"] = json!(""); }
    for k in ["projects", "overrides", "vaults", "github", "mail"] { if !v[k].is_object() { v[k] = json!({}); } }
    providers::migrate(&mut v); // integrations.<provider> and boards, from the old top-level "productive" too
    agents::migrate(&mut v);    // agents.default and agents.providers.<id>: on, bin
    if !v["github"]["on"].is_boolean() { v["github"]["on"] = json!(false); }
    if !v["github"]["owners"].is_string() { v["github"]["owners"] = json!(""); }
    if !v["mail"]["on"].is_boolean() { v["mail"]["on"] = json!(false); }
    if !v["mail"]["account"].is_string() { v["mail"]["account"] = json!(""); }
    if !v["mail"]["accounts"].is_array() { v["mail"]["accounts"] = json!([]); }
    // the old himalaya account names are no emails: those fall back to the first account
    let known = v["mail"]["accounts"].as_array().unwrap().iter().any(|a| a["email"] == v["mail"]["account"]);
    if !known { v["mail"]["account"] = json!(""); }
    // favicons: the daily check, on by default. tried holds the site each project was fetched for, so it goes once
    if !v["favicons"].is_object() { v["favicons"] = json!({}); }
    if !v["favicons"]["on"].is_boolean() { v["favicons"]["on"] = json!(true); }
    if !v["favicons"]["last"].as_str().is_some_and(|d| d.len() == 10 && d.chars().all(|c| c.is_ascii_digit() || c == '-')) { v["favicons"]["last"] = json!(""); }
    if !v["favicons"]["tried"].is_object() { v["favicons"]["tried"] = json!({}); }
    v["favicons"]["tried"].as_object_mut().unwrap().retain(|_, s| s.as_str().is_some_and(|s| s.len() <= 253));
    if !v["language"].as_str().is_some_and(|l| l == "system" || LANGS.contains(&l)) { v["language"] = json!("system"); }
    v
}

// ---------- UI language: the settings' "language", or "system" for the first macOS preferred language
// the app has, else English. The webview gets it from ui_lang rather than navigator.language, which
// WKWebView derives from the app bundle's localizations. Same list as src/i18n.ts.
const LANGS: [&str; 4] = ["en", "nl", "fr", "de"];
fn ui_lang_of(settings: &Value) -> &'static str {
    let pick = |l: &str| LANGS.iter().copied().find(|x| l.split(['-', '_']).next().is_some_and(|p| p.eq_ignore_ascii_case(x)));
    settings["language"].as_str().and_then(|l| LANGS.iter().copied().find(|x| *x == l))
        .or_else(|| sys_locale::get_locales().find_map(|l| pick(&l)))
        .unwrap_or("en")
}
#[tauri::command]
fn ui_lang(state: State<App>) -> &'static str { ui_lang_of(&state.settings.lock().unwrap()) }

/// Native strings (menu bar, window title, errors) in LANGS order. The menu follows the macOS names.
const TEXT: &[(&str, [&str; 4])] = &[
    ("settings", ["Settings…", "Instellingen…", "Réglages…", "Einstellungen…"]),
    ("settings.title", ["Settings", "Instellingen", "Réglages", "Einstellungen"]),
    ("about", ["About Relay", "Over Relay", "À propos de Relay", "Über Relay"]),
    ("hide", ["Hide Relay", "Verberg Relay", "Masquer Relay", "Relay ausblenden"]),
    ("hide_others", ["Hide Others", "Verberg andere", "Masquer les autres", "Andere ausblenden"]),
    ("show_all", ["Show All", "Toon alles", "Tout afficher", "Alle einblenden"]),
    ("quit", ["Quit Relay", "Stop Relay", "Quitter Relay", "Relay beenden"]),
    ("edit", ["Edit", "Wijzig", "Édition", "Bearbeiten"]),
    ("undo", ["Undo", "Herstel", "Annuler", "Widerrufen"]),
    ("redo", ["Redo", "Opnieuw", "Rétablir", "Wiederholen"]),
    ("cut", ["Cut", "Knip", "Couper", "Ausschneiden"]),
    ("copy", ["Copy", "Kopieer", "Copier", "Kopieren"]),
    ("paste", ["Paste", "Plak", "Coller", "Einsetzen"]),
    ("select_all", ["Select All", "Selecteer alles", "Tout sélectionner", "Alles auswählen"]),
    ("window", ["Window", "Venster", "Fenêtre", "Fenster"]),
    ("minimize", ["Minimize", "Minimaliseer", "Placer dans le Dock", "Im Dock ablegen"]),
    ("zoom", ["Zoom", "Zoom", "Réduire/agrandir", "Zoomen"]),
    ("fullscreen", ["Enter Full Screen", "Volledig scherm", "Passer en mode plein écran", "Vollbildmodus"]),
    ("chat", ["Conversation", "Gesprek", "Conversation", "Gespräch"]),
    ("new_general", ["New General Conversation", "Nieuw algemeen gesprek", "Nouvelle conversation générale", "Neues allgemeines Gespräch"]),
    ("new_project", ["New Conversation in This Project", "Nieuw gesprek in dit project", "Nouvelle conversation dans ce projet", "Neues Gespräch in diesem Projekt"]),
    ("close_chat", ["Close Conversation", "Sluit gesprek", "Fermer la conversation", "Gespräch schließen"]),
    ("err.no_vault", ["No vault: work-state.md not found in {v}", "Geen vault: work-state.md niet gevonden in {v}",
        "Pas de coffre : work-state.md introuvable dans {v}", "Kein Vault: work-state.md nicht gefunden in {v}"]),
    ("err.rem_gone", ["This reminder no longer exists, the list is refreshed", "Deze reminder bestaat niet meer, de lijst is ververst",
        "Ce rappel n'existe plus, la liste est actualisée", "Diese Erinnerung gibt es nicht mehr, die Liste wurde aktualisiert"]),
    ("err.rem_date", ["Date not understood", "Datum niet begrepen", "Date non comprise", "Datum nicht verstanden"]),
    ("err.rem_repeat", ["Repeat not understood, use for example 14d, 2w or 1m", "Herhaling niet begrepen, gebruik bijvoorbeeld 14d, 2w of 1m",
        "Répétition non comprise, utilisez par exemple 14d, 2w ou 1m", "Wiederholung nicht verstanden, zum Beispiel 14d, 2w oder 1m"]),
    ("err.rem_text", ["The reminder needs a text (max 2000 characters) and a project name without [ ] or |",
        "De reminder heeft een tekst nodig (max 2000 tekens) en een projectnaam zonder [ ] of |",
        "Le rappel a besoin d'un texte (2000 caractères max.) et d'un nom de projet sans [ ] ni |",
        "Die Erinnerung braucht einen Text (max. 2000 Zeichen) und einen Projektnamen ohne [ ] oder |"]),
    ("tray.open", ["Open Relay", "Open Relay", "Ouvrir Relay", "Relay öffnen"]),
    ("tray.late", ["Overdue", "Vervallen", "En retard", "Überfällig"]),
    ("tray.today", ["Today", "Vandaag", "Aujourd'hui", "Heute"]),
    ("tray.tomorrow", ["Tomorrow", "Morgen", "Demain", "Morgen"]),
    ("tray.week", ["This week", "Deze week", "Cette semaine", "Diese Woche"]),
    ("tray.later", ["Later", "Later", "Plus tard", "Später"]),
    ("tray.none", ["No reminders", "Geen reminders", "Aucun rappel", "Keine Erinnerungen"]),
    ("tray.done", ["✓ Done", "✓ Klaar", "✓ Fait", "✓ Erledigt"]),
    ("tray.to_tomorrow", ["→ Tomorrow", "→ Morgen", "→ Demain", "→ Morgen"]),
    ("tray.to_monday", ["→ Monday", "→ Maandag", "→ Lundi", "→ Montag"]),
    ("tray.plus_week", ["→ +1 week", "→ +1 week", "→ +1 semaine", "→ +1 Woche"]),
    ("tray.plus_month", ["→ +1 month", "→ +1 maand", "→ +1 mois", "→ +1 Monat"]),
    ("tray.drop", ["✕ Drop", "✕ Schrappen", "✕ Supprimer", "✕ Verwerfen"]),
    ("err.note", ["No note '{v}' in the vault", "Geen note '{v}' in de vault", "Aucune note '{v}' dans le coffre", "Keine Notiz '{v}' im Vault"]),
    ("err.no_vault_set", ["No vault chosen yet", "Nog geen vault gekozen", "Aucun coffre choisi", "Noch kein Vault gewählt"]),
    ("err.project", ["Invalid project '{v}': icon (max 4 characters), label (max 60) and img (png data url) must be text",
        "Ongeldig project '{v}': icon (max 4 tekens), label (max 60) en img (png data url) moeten tekst zijn",
        "Projet '{v}' invalide : l'icône (4 caractères max.), le nom (60 max.) et img (data url png) doivent être du texte",
        "Ungültiges Projekt '{v}': Symbol (max. 4 Zeichen), Name (max. 60) und img (PNG-Data-URL) müssen Text sein"]),
    ("err.override", ["Invalid override '{v}'", "Ongeldige override '{v}'", "Remplacement '{v}' invalide", "Ungültige Zuordnung '{v}'"]),
    ("err.empty", ["empty message", "leeg bericht", "message vide", "leere Nachricht"]),
    ("err.gh_owners", ["GitHub: at most 10 owners, only letters, digits and -", "GitHub: hoogstens 10 owners, enkel letters, cijfers en -", "GitHub : 10 propriétaires au plus, uniquement lettres, chiffres et -", "GitHub: höchstens 10 Owner, nur Buchstaben, Ziffern und -"]),
    ("err.token_chars", ["The token may only contain letters, digits, - and _", "Het token mag enkel letters, cijfers, - en _ bevatten", "Le jeton ne peut contenir que des lettres, des chiffres, - et _", "Das Token darf nur Buchstaben, Ziffern, - und _ enthalten"]),
    ("err.keychain", ["Could not save the token in the keychain", "Kon het token niet in de sleutelhanger bewaren", "Impossible d'enregistrer le jeton dans le trousseau", "Das Token konnte nicht im Schlüsselbund gespeichert werden"]),
    ("err.claude_json", ["~/.claude.json not found or unreadable", "~/.claude.json niet gevonden of onleesbaar", "~/.claude.json introuvable ou illisible", "~/.claude.json nicht gefunden oder nicht lesbar"]),
    ("err.call", ["This {v} call is not allowed", "Deze {v}-oproep is niet toegelaten", "Cet appel {v} n'est pas autorisé", "Dieser {v}-Aufruf ist nicht erlaubt"]),
    ("err.no_provider", ["Unknown integration '{v}'", "Onbekende integratie '{v}'", "Intégration inconnue '{v}'", "Unbekannte Integration '{v}'"]),
    ("err.board_map", ["Invalid board for project '{v}'", "Ongeldig bord voor project '{v}'", "Tableau invalide pour le projet '{v}'", "Ungültiges Board für Projekt '{v}'"]),
    ("err.no_token", ["No {v} token. Fill it in under Relay › Settings… › Integrations.", "Geen {v}-token. Vul het in bij Relay › Instellingen… › Integraties.", "Aucun jeton {v}. Renseignez-le dans Relay › Réglages… › Intégrations.", "Kein {v}-Token. Trag es unter Relay › Einstellungen… › Integrationen ein."]),
    ("err.down", ["{p} unreachable: {v}", "{p} niet bereikbaar: {v}", "{p} injoignable : {v}", "{p} nicht erreichbar: {v}"]),
    ("err.no_gh", ["gh not found. Install it with `brew install gh`.", "gh niet gevonden. Installeer het met `brew install gh`.", "gh introuvable. Installez-le avec `brew install gh`.", "gh nicht gefunden. Installiere es mit `brew install gh`."]),
    ("err.gh_login", ["Not signed in to gh. Run `gh auth login` in the terminal.", "Niet ingelogd bij gh. Voer `gh auth login` uit in de terminal.", "Pas connecté à gh. Lancez `gh auth login` dans le terminal.", "Nicht bei gh angemeldet. Führe `gh auth login` im Terminal aus."]),
    ("err.bad_repo", ["Invalid repo", "Ongeldige repo", "Dépôt invalide", "Ungültiges Repo"]),
    ("err.mail_pw", ["The app password is the 16-letter code Google showed (spaces are fine)", "Het app-wachtwoord is de code van 16 letters die Google toonde (spaties mogen)",
        "Le mot de passe d'application est le code de 16 lettres affiché par Google (les espaces sont acceptés)", "Das App-Passwort ist der 16-stellige Code, den Google angezeigt hat (Leerzeichen sind ok)"]),
    ("err.no_mail_account", ["Mail: no account set up. Add one under Relay › Settings… › Integrations › Mail.", "Mail: nog geen account. Voeg er een toe bij Relay › Instellingen… › Integraties › Mail.", "Mail : aucun compte. Ajoutez-en un dans Relay › Réglages… › Intégrations › Mail.", "Mail: noch kein Konto. Füge eins unter Relay › Einstellungen… › Integrationen › Mail hinzu."]),
    ("err.bad_mail", ["Invalid mail id", "Ongeldige mail-id", "Identifiant de mail invalide", "Ungültige Mail-ID"]),
    ("err.mail_account", ["Mail: invalid account (email, keychain service and account, at most 5 accounts)", "Mail: ongeldig account (e-mail, sleutelhangerdienst en -account, hoogstens 5 accounts)", "Mail : compte invalide (e-mail, service et compte du trousseau, 5 comptes au plus)", "Mail: ungültiges Konto (E-Mail, Schlüsselbunddienst und -konto, höchstens 5 Konten)"]),
    ("err.no_pr", ["PR not found", "PR niet gevonden", "PR introuvable", "PR nicht gefunden"]),
    ("err.no_agent", ["Unknown agent '{v}'", "Onbekende agent '{v}'", "Agent inconnu '{v}'", "Unbekannter Agent '{v}'"]),
    ("err.icons_no_claude", ["Finding websites needs Claude Code switched on under Agents", "Websites zoeken heeft Claude Code nodig, aangezet onder Agents", "La recherche de sites nécessite Claude Code activé dans Agents", "Websites suchen braucht Claude Code, eingeschaltet unter Agents"]),
    ("err.agent_none", ["Switch on at least one agent", "Zet minstens één agent aan", "Activez au moins un agent", "Schalte mindestens einen Agenten ein"]),
    ("err.agent_bin", ["{v}: the program path must be absolute", "{v}: het pad naar het programma moet absoluut zijn", "{v} : le chemin du programme doit être absolu", "{v}: der Programmpfad muss absolut sein"]),
    ("err.agent_busy", ["Still answering the previous message", "Nog bezig met het vorige bericht", "Encore occupé avec le message précédent", "Noch mit der vorigen Nachricht beschäftigt"]),
    ("err.agent_terminal", ["{v} cannot be opened in the terminal", "{v} kan niet in de terminal geopend worden", "{v} ne peut pas s'ouvrir dans le terminal", "{v} lässt sich nicht im Terminal öffnen"]),
];
fn tr(lang: &str, key: &str) -> String {
    let i = LANGS.iter().position(|l| *l == lang).unwrap_or(0);
    TEXT.iter().find(|(k, _)| *k == key).map_or(key, |(_, row)| row[i]).to_string()
}
fn tr_v(lang: &str, key: &str, v: &str) -> String { tr(lang, key).replace("{v}", v) }
// the UI language for code without the settings at hand (Productive and gh errors), kept in step by setup and set_settings
static CUR_LANG: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
fn set_cur_lang(lang: &str) {
    let i = LANGS.iter().position(|l| *l == lang).unwrap_or(0);
    CUR_LANG.store(i, std::sync::atomic::Ordering::Relaxed);
    board_core::set_lang(i); // the integrations' own strings
}
fn trc(key: &str) -> String { tr(LANGS[CUR_LANG.load(std::sync::atomic::Ordering::Relaxed)], key) }
fn trc_v(key: &str, v: &str) -> String { trc(key).replace("{v}", v) }
/// The locale for dates in the webview: the first macOS preferred locale in the UI language (nl-BE for nl),
/// else the language itself.
fn ui_locale_of(settings: &Value) -> String {
    let lang = ui_lang_of(settings);
    sys_locale::get_locales().find(|l| l.split(['-', '_']).next().is_some_and(|p| p.eq_ignore_ascii_case(lang)))
        .map(|l| l.replace('_', "-")).unwrap_or_else(|| lang.to_string())
}
#[tauri::command]
fn ui_locale(state: State<App>) -> String { ui_locale_of(&state.settings.lock().unwrap()) }

/// Native menu bar: Vault > Settings… (Cmd-comma), Conversation, plus Edit and Window so copy, paste and
/// window shortcuts keep working once the default menu is replaced. Rebuilt when the language changes.
fn build_menu(h: &AppHandle, lang: &str) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem as P, Submenu};
    let t = |k: &str| tr(lang, k);
    let settings = MenuItem::with_id(h, "settings", t("settings"), true, Some("CmdOrCtrl+,"))?;
    let app = Submenu::with_items(h, "Relay", true, &[
        &P::about(h, Some(&t("about")), None)?, &P::separator(h)?, &settings, &P::separator(h)?,
        &P::hide(h, Some(&t("hide")))?, &P::hide_others(h, Some(&t("hide_others")))?, &P::show_all(h, Some(&t("show_all")))?,
        &P::separator(h)?, &P::quit(h, Some(&t("quit")))?])?;
    let edit = Submenu::with_items(h, t("edit"), true, &[
        &P::undo(h, Some(&t("undo")))?, &P::redo(h, Some(&t("redo")))?, &P::separator(h)?,
        &P::cut(h, Some(&t("cut")))?, &P::copy(h, Some(&t("copy")))?, &P::paste(h, Some(&t("paste")))?, &P::select_all(h, Some(&t("select_all")))?])?;
    // Cmd-W closes the conversation like a browser tab, the main window stays open
    let chat = Submenu::with_items(h, t("chat"), true, &[
        &MenuItem::with_id(h, "new-general", t("new_general"), true, Some("CmdOrCtrl+T"))?,
        &MenuItem::with_id(h, "new-project", t("new_project"), true, Some("CmdOrCtrl+N"))?,
        &P::separator(h)?,
        &MenuItem::with_id(h, "close-chat", t("close_chat"), true, Some("CmdOrCtrl+W"))?])?;
    let window = Submenu::with_items(h, t("window"), true, &[
        &P::minimize(h, Some(&t("minimize")))?, &P::maximize(h, Some(&t("zoom")))?, &P::fullscreen(h, Some(&t("fullscreen")))?])?;
    Menu::with_items(h, &[&app, &chat, &edit, &window])
}

// A conversation's agent, run by its broker (broker.rs) so it outlives the app. opts: the model and effort it runs
// with. tainted: it holds mail text and runs restricted (see taint), kept in its broker file for after a restart.
// turns: messages sent and not answered yet; at quit only an agent with a turn running stays (see quit)
struct Proc { child: broker::Agent, stdin: UnixStream, opts: (String, String), provider: &'static str, tainted: bool, key: String, turns: u32 }

struct App {
    procs: Mutex<HashMap<String, Proc>>,
    sids: Mutex<HashMap<String, agents::Sess>>, // conversation key -> provider and session id, persisted
    path: String,                          // login-shell PATH, so the agent's tools find gh, himalaya, node
    settings: Mutex<Value>,                // settings.json: vault, projects, overrides, agents, mail
    limits: Mutex<HashMap<String, (i64, Value)>>, // per provider: its last limits answer and when
    mail: mail::Mail,                      // one IMAP session per account, shared by the UI and the relay-mail tools
}

fn data_dir(app: &AppHandle) -> PathBuf {
    let d = app.path().app_data_dir().expect("app data dir");
    fs::create_dir_all(d.join("pending")).ok();
    d
}
fn pending_dir(app: &AppHandle) -> PathBuf { data_dir(app).join("pending") }

fn save_sids(app: &AppHandle, sids: &HashMap<String, agents::Sess>) {
    fs::write(data_dir(app).join("sessions.json"), agents::save_sessions(sids)).ok();
}

fn login_path() -> String {
    Command::new("/bin/zsh").args(["-lic", "printf %s \"$PATH\""]).stdin(Stdio::null()).output()
        .ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin".into())
}

/// Everything the sidebar shows, read by snapshot.py from the mapped paths. Also returns the vault
/// status, so the UI can switch off what the vault lacks (e.g. reminder actions without a script).
#[tauri::command]
fn snapshot(app: AppHandle, state: State<App>) -> Result<Value, String> {
    let (st, lang) = { let s = state.settings.lock().unwrap(); (vault_of(&s), ui_lang_of(&s)) };
    let v = st["vault"].as_str().unwrap();
    if v.is_empty() { return Err(tr(lang, "err.no_vault_set")); }
    if st["ok"] != true { return Err(tr_v(lang, "err.no_vault", v)); }
    // the first time a vault is used, its .relay/config.json is written from what is detected (snapshot.py reads it)
    relay_config::ensure(v, &st["map"]);
    let path = |k: &str| if st["found"][k] == true { vault::resolve(v, st["map"][k].as_str().unwrap()).to_string_lossy().into_owned() } else { String::new() };
    let out = Command::new("/usr/bin/python3").arg(format!("{REPO}/snapshot.py"))
        .env("PATH", &state.path).env("VAULT", v).env("VAULT_WORK_STATE", path("workState"))
        .env("VAULT_NOTES", path("notes"))
        .output().map_err(|e| e.to_string())?;
    let mut snap: Value = serde_json::from_slice(&out.stdout).map_err(|e| {
        // a crash leaves stdout empty: its last stderr line says more than "EOF while parsing"
        let err = String::from_utf8_lossy(&out.stderr);
        format!("snapshot: {}", err.lines().rev().find(|l| !l.trim().is_empty()).map_or(e.to_string(), str::to_string))
    })?;
    snap["vault"] = st;
    let (file, _, _) = rem_ctx(&app)?;
    snap["reminders"] = reminders::list(&file, chrono::Local::now().date_naive()).into();
    tray::refresh(&app); // the file may have changed outside the app
    Ok(snap)
}

/// The favicon of each project's website, guessed from its notes by favicon.py, for the projects
/// ([{name, aliases}]) whose guess is not in favicons.tried yet: {name: {site, data}}, data the raw icon or null.
#[tauri::command]
async fn favicons(state: State<'_, App>, projects: Value) -> Result<Value, String> {
    let (st, tried) = { let s = state.settings.lock().unwrap(); (vault_of(&s), s["favicons"]["tried"].clone()) };
    if st["ok"] != true { return Ok(json!({})); }
    let v = st["vault"].as_str().unwrap();
    let notes = if st["found"]["notes"] == true { vault::resolve(v, st["map"]["notes"].as_str().unwrap()).to_string_lossy().into_owned() } else { String::new() };
    let mut child = Command::new("/usr/bin/python3").arg(format!("{REPO}/favicon.py"))
        .env("PATH", &state.path).env("VAULT", v).env("VAULT_NOTES", notes)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    // a website set as a project's icon in the vault's .relay/config.json wins over a guess
    let sites: serde_json::Map<String, Value> = relay_config::icons(v).into_iter()
        .filter_map(|(n, i)| match relay_config::icon_kind(i["value"].as_str()?) { relay_config::Icon::Site(s) => Some((n, json!(s))), _ => None }).collect();
    child.stdin.take().unwrap().write_all(json!({"projects": projects, "tried": tried, "sites": sites}).to_string().as_bytes()).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    serde_json::from_slice(&out.stdout).map_err(|e| format!("favicon: {}", String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or(&e.to_string())))
}

/// The project icons from the vault's .relay/config.json: {project: {value, img | icon}}. The first call for a vault
/// moves the icons settings.json held before into the vault (files in .relay/icons/) and drops them from settings.
#[tauri::command]
fn project_icons(app: AppHandle, state: State<App>) -> Value {
    let (v, map) = { let s = state.settings.lock().unwrap(); let st = vault_of(&s); (st["vault"].as_str().unwrap_or("").to_string(), st["map"].clone()) };
    if v.is_empty() { return json!({}); }
    relay_config::ensure(&v, &map);
    let projects = state.settings.lock().unwrap()["projects"].as_object().cloned().unwrap_or_default();
    if let Some(moved) = relay_config::migrate_icons(&v, &projects).filter(|m| !m.is_empty()) {
        let mut s = state.settings.lock().unwrap();
        for n in &moved { if let Some(p) = s["projects"][n].as_object_mut() { p.remove("img"); p.remove("icon"); if p.is_empty() { s["projects"].as_object_mut().unwrap().remove(n); } } }
        fs::write(data_dir(&app).join("settings.json"), serde_json::to_string_pretty(&*s).unwrap()).ok();
        app.emit("settings-changed", &*s).ok();
    }
    Value::Object(relay_config::icons(&v))
}
/// Websites for projects, found by Claude: one Sonnet call for all of them, outside the vault, without settings, MCP
/// or a transcript, and with web search as its only tool. (Haiku searched too rarely: the same input gave a site
/// one run and null the next; Sonnet answered the same twice, in about 11 s.) `projects`: [{name, context, summary}]. Returns
/// {name: domain} for the ones it is sure about; the favicon run turns those into icons.
#[tauri::command]
async fn find_icon_sites(app: AppHandle, state: State<'_, App>, projects: Vec<Value>) -> Result<Value, String> {
    let p = agents::enabled(&state.settings.lock().unwrap()).into_iter().find(|p| p.id() == "claude").ok_or_else(|| trc("err.icons_no_claude"))?;
    let eb = env_of(&app, &state, p);
    // the repos linked to a project say a lot about what it is (lemahieu-shopware: a shop)
    let mut repos: HashMap<String, Vec<String>> = HashMap::new();
    for (r, p) in repo_projects(&eb.vault) { repos.entry(p).or_default().push(r); }
    // ponytail: 80 projects per call, the summaries cut to 300 characters; more projects only happen in big vaults
    let list: Vec<Value> = projects.iter().take(80).map(|x| { let n = x["name"].as_str().unwrap_or("");
        json!({"name": n, "context": x["context"], "about": x["summary"].as_str().unwrap_or("").chars().take(300).collect::<String>(),
            "repos": repos.get(n).cloned().unwrap_or_default()}) }).collect();
    // the context (Antenna, Freelance, Personal) is the user's own area, not a client: without saying so, every internal
    // project of an employer got the employer's site
    let prompt = format!("Pick a website for each project below, so that site's favicon can be the project's icon. The context is the \
        area of work the project sits under (the user's own employer, their freelance work, personal): it is not the client, so never \
        pick the context's own website. In this order: 1) the client, another company the work is for; 2) otherwise the project's own product or brand (a repo name like facturio can be \
        that product's name); 3) otherwise the main tool, platform or service the project is about (a server panel, an automation \
        tool, a mail server, a SaaS it integrates). Use the name, the context, what it is about and its GitHub repos as clues, and \
        search the web for every project you do not know for sure. Give the most likely official site; use null only for a purely \
        personal topic, a meeting or a plan with no company, product or tool behind it. Answer with only a JSON object \
        {{\"<project name>\": \"domain.tld\" or null}}, no other text.\n\n{}", serde_json::to_string(&list).unwrap());
    // the prompt on stdin: --allowedTools takes a list and would swallow it as an argument
    let out = tauri::async_runtime::spawn_blocking(move || -> std::io::Result<std::process::Output> {
        let mut c = Command::new(&eb.bin).args(["-p", "--model", "sonnet", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config",
                "--tools", "WebSearch", "--allowedTools", "WebSearch"])
            .current_dir(std::env::temp_dir()).env("PATH", &eb.path).env_remove("ANTHROPIC_API_KEY")
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
        c.stdin.take().unwrap().write_all(prompt.as_bytes())?;
        c.wait_with_output()
    }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).trim().chars().take(300).collect()); }
    let text = String::from_utf8_lossy(&out.stdout);
    let json = text.find('{').zip(text.rfind('}')).and_then(|(a, b)| serde_json::from_str::<serde_json::Map<String, Value>>(&text[a..=b]).ok()).unwrap_or_default();
    let names: Vec<&str> = projects.iter().filter_map(|x| x["name"].as_str()).collect();
    Ok(Value::Object(json.into_iter().filter(|(n, _)| names.contains(&n.as_str()))
        .filter_map(|(n, d)| Some((n, json!(relay_config::site_of(d.as_str()?)?)))).collect()))
}
/// GitHub repos per project, as the PRs use them: {project: ["owner/repo", ...]}.
#[tauri::command]
fn project_repos(state: State<App>) -> Value {
    let v = state.settings.lock().unwrap()["vault"].as_str().unwrap_or("").to_string();
    let mut out: std::collections::BTreeMap<String, Vec<String>> = Default::default();
    for (r, p) in repo_projects(&v) { out.entry(p).or_default().push(r); }
    for list in out.values_mut() { list.sort(); }
    json!(out)
}
/// A project's repos in the vault's .relay/config.json.
#[tauri::command]
fn set_project_repos(state: State<App>, project: String, repos: Vec<String>) -> Result<(), String> {
    relay_config::set_repos(&need_vault(&state)?, &project, &repos)
}
/// Set a project's icon in the vault (see relay_config::set_icon); both windows hear "icons-changed".
#[tauri::command]
fn set_project_icon(app: AppHandle, state: State<App>, project: String, kind: String, value: String) -> Result<(), String> {
    let v = need_vault(&state)?;
    if project.is_empty() || project.len() > 120 { return Err("bad project".into()); }
    relay_config::set_icon(&v, &project, &kind, &value)?;
    app.emit("icons-changed", ()).ok();
    Ok(())
}

/// A vault note a conversation links to, for the right panel: {path (relative to the vault), text}.
#[tauri::command]
fn read_note(state: State<App>, target: String) -> Result<Value, String> {
    let v = need_vault(&state)?;
    vault::note(&v, &target).map(|(path, text)| json!({"path": path, "text": text}))
        .ok_or_else(|| tr_v(ui_lang_of(&state.settings.lock().unwrap()), "err.note", &target))
}

/// The configured vault: path, mapping, found per path, ok.
#[tauri::command]
fn vault_status(state: State<App>) -> Value { vault_of(&state.settings.lock().unwrap()) }

/// The mapping for a folder being set up: detected, with what settings.json already had for it.
#[tauri::command]
async fn detect_vault(state: State<'_, App>, path: String) -> Result<Value, String> {
    let stored = state.settings.lock().unwrap()["vaults"].clone();
    let (v, m) = vault::detect(&path);
    let known = relay_config::load(&v).map(|c| c["paths"].clone()).filter(Value::is_object).unwrap_or_else(|| stored[&v].clone());
    Ok(vault::status(&v, &vault::merge(&m, &known)))
}

/// Found / missing for a mapping being edited, without detection.
#[tauri::command]
fn check_vault(path: String, map: Value) -> Value { vault::status(&path, &vault::merge(&json!({}), &map)) }

// ---------- Agent providers (agents.rs, packages/agent-*): the app owns the processes, sessions.json and the
// pending folder; a provider builds the command, turns its output into agent_core::Event, reads its own logs.

/// A provider's Env, owned, so it can go to a blocking thread.
struct EnvBuf { home: String, vault: String, path: String, bin: String, pending: PathBuf, opts: Value }
impl EnvBuf {
    fn env(&self) -> agent_core::Env<'_> { agent_core::Env { home: &self.home, vault: &self.vault, path: &self.path, bin: &self.bin, pending: &self.pending, opts: &self.opts } }
}
fn env_of(app: &AppHandle, st: &App, p: &dyn AgentProvider) -> EnvBuf {
    let s = st.settings.lock().unwrap();
    let mut opts = s["agents"]["providers"][p.id()].clone();
    // Claude Code gets the relay-mail tools only when mail is on and an account is set up; set by the app, never the user
    if p.id() == "claude" && opts.is_object() { opts["mail"] = json!(mail_on(&s)); }
    EnvBuf { home: home(), vault: s["vault"].as_str().unwrap_or("").into(), path: st.path.clone(), bin: agents::bin(&s, p, &home(), &st.path), pending: pending_dir(app), opts }
}
fn mail_on(s: &Value) -> bool { s["mail"]["on"] == true && !mail::accounts(&s["mail"]).is_empty() }
/// A conversation's provider: its session's, else the one asked for when switched on, else the default.
fn provider_of(st: &App, key: &str, asked: Option<&str>) -> &'static dyn AgentProvider {
    if let Some(s) = st.sids.lock().unwrap().get(key) { return agents::get_or_first(Some(&s.provider)); }
    let s = st.settings.lock().unwrap();
    asked.and_then(|a| agents::enabled(&s).into_iter().find(|p| p.id() == a)).unwrap_or_else(|| agents::get_or_first(Some(&agents::default_id(&s))))
}
/// Run a shell command in a new iTerm window.
fn iterm(cmd: &str) -> Result<(), String> {
    let script = format!(
        "tell application \"iTerm\"\n activate\n set w to (create window with default profile)\n tell current session of w to write text {}\nend tell",
        serde_json::to_string(cmd).unwrap());
    Command::new("/usr/bin/osascript").args(["-e", &script]).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// DENIED and MAIL_TOOLS are agent_claude's: the flags it starts every Claude session with.
use agent_claude::{DENIED, MAIL_TOOLS};

/// What a session loses once it holds mail text, a stranger's words that may try to steer it: pushing, PRs, gh
/// api and comments, Slack posts, calendar invites, agents, work handed to the cloud or to later, messages to other
/// sessions, the skills whose own allowed-tools would skip the cards, and every rule the user's settings allow
/// without asking (deny beats allow). It also goes to default mode, so everything else asks first on a card. Sent
/// over the pipe: at spawn for a chat about a mail, else right before the first mail tool answers
/// (scripts/pipe-check.py proves both). A settings file that does not parse costs Bash as a whole.
/// ponytail: skills with a broad allowed-tools are named here, a new one needs adding.
fn taint(settings: &[Value], all_read: bool) -> [Value; 2] {
    let mut deny: Vec<String> = ["Bash(git push*)", "Bash(gh pr create*)", "Bash(gh pr comment*)", "Bash(gh api*)", "Bash(gh gist*)", "Bash(launchctl*)",
        "mcp__claude_ai_Slack__slack_send_message", "mcp__claude_ai_Slack__slack_schedule_message",
        "mcp__claude_ai_Google_Calendar__create_event", "mcp__claude_ai_Google_Calendar__update_event",
        "RemoteTrigger", "CronCreate", "ScheduleWakeup", "SendMessage", "ShareOnboardingGuide", "DesignSync", "Workflow",
        "Skill(skill:initcraftcms)", "Skill(skill:code-review:code-review)"].map(String::from).to_vec();
    deny.extend(DENIED.map(String::from)); // the flag layer may not keep the CLI's own denies, so they go along
    if !all_read { deny.push("Bash".into()); }
    deny.extend(settings.iter().flat_map(|s| s["permissions"]["allow"].as_array().into_iter().flatten())
        .filter_map(|r| r.as_str()).filter(|r| !r.starts_with("mcp__relay-mail")).map(String::from));
    deny.sort(); deny.dedup();
    [json!({"type": "control_request", "request_id": "taint-rules", "request": {"subtype": "apply_flag_settings", "settings": {"permissions": {"allow": MAIL_TOOLS, "deny": deny}}}}),
     json!({"type": "control_request", "request_id": "taint-mode", "request": {"subtype": "set_permission_mode", "mode": "default"}})]
}
/// The settings a session in the vault loads that can allow tools, the user's and the vault's, shared and local,
/// and whether every one that exists parsed (Claude Code rewrites them, a half-written file gets one more try).
fn allow_sources(vault: &str) -> (Vec<Value>, bool) {
    let files = [format!("{}/.claude/settings.json", home()), format!("{}/.claude/settings.local.json", home()),
                 format!("{vault}/.claude/settings.json"), format!("{vault}/.claude/settings.local.json")];
    let (mut out, mut all) = (vec![], true);
    for f in files.iter().filter(|f| PathBuf::from(f).is_file()) {
        let read = || fs::read_to_string(f).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
        match read().or_else(|| { std::thread::sleep(std::time::Duration::from_millis(100)); read() }) { Some(v) => out.push(v), None => all = false }
    }
    (out, all)
}
fn write_taint(p: &mut Proc, vault: &str) {
    let (settings, all_read) = allow_sources(vault);
    for m in taint(&settings, all_read) { writeln!(p.stdin, "{m}").ok(); }
    p.stdin.flush().ok();
    p.tainted = true;
    if let Some(m) = broker::load_meta(&broker::meta_path(&p.key)) { broker::save_meta(&broker::Meta { tainted: true, ..m }); }
}
/// The request that opens the pipe: which in-process MCP servers the app answers for.
fn pipe_init(mail_on: bool) -> Value {
    json!({"type": "control_request", "request_id": "init", "request": {"subtype": "initialize", "sdkMcpServers": if mail_on { json!(["relay-mail"]) } else { json!([]) }}})
}

#[allow(clippy::too_many_arguments)]
fn spawn(app: &AppHandle, state: &App, p: &'static dyn AgentProvider, project: &str, name: &str, fork: Option<&str>, opts: (String, String), turn: Option<&Turn>, from_mail: bool) -> Result<Proc, String> {
    let dir = need_vault(state)?;
    let eb = env_of(app, state, p);
    let resume = state.sids.lock().unwrap().get(project).filter(|s| s.provider == p.id() && p.valid_session(&s.sid)).map(|s| s.sid.clone());
    let fork = fork.filter(|f| resume.is_none() && p.caps().fork && p.valid_session(f));
    let l = Launch { key: project, name, model: &opts.0, effort: &opts.1, resume: resume.as_deref(), fork, turn };
    let mut cmd = p.command(&eb.env(), &l)?;
    cmd.current_dir(&dir).env("PATH", &state.path);
    let meta = broker::Meta { key: project.into(), provider: p.id().into(), model: opts.0.clone(), effort: opts.1.clone(), tainted: false, pid: 0 };
    let c = broker::launch(&meta, &cmd).map_err(|e| format!("{} start: {e}", p.id()))?;
    let mut stdin = c.stdin.try_clone().map_err(|e| e.to_string())?;
    let claude = p.id() == "claude";
    if claude { writeln!(stdin, "{}", pipe_init(eb.opts["mail"] == true)).and_then(|_| stdin.flush()).map_err(|e| format!("claude start: {e}"))?; }
    let mut proc = Proc { child: broker::Agent::from(c.agent.id()), stdin, opts, provider: p.id(), tainted: false, key: project.into(), turns: u32::from(turn.is_some()) };
    read_agent(app, project, p, c);
    // a chat about a mail, or one that read mail before a restart, starts restricted
    if claude && from_mail { write_taint(&mut proc, &dir); }
    Ok(proc)
}

/// The agent's output, from its broker: each stdout line through the provider's parser to the webview as `agent`
/// events, stderr collected for when it ends. The first `backlog` lines came in while the app was closed: their
/// effects (session id, permission cards, Claude's pipe requests) still happen, but the webview only hears the turn
/// end, it reads the rest from the transcript.
fn read_agent(app: &AppHandle, key: &str, p: &'static dyn AgentProvider, c: broker::Conn) {
    let (a, k, pid, id, claude, pend, mut parse) = (app.clone(), key.to_string(), c.agent.id(), p.id(), p.id() == "claude", pending_dir(app), p.parser());
    let (frames, backlog) = (c.frames, c.backlog);
    std::thread::spawn(move || {
        let emit = |ev: Value| { a.emit("agent", json!({"project": k, "provider": id, "event": ev})).ok(); };
        let mut err: Vec<String> = vec![];
        for (n, f) in frames.lines().map_while(Result::ok).enumerate() {
            let line = match broker::frame(&f) { broker::Frame::Out(l) => l, broker::Frame::Err(l) => { err.push(l); continue; } broker::Frame::Exit => break };
            let replay = n < backlog;
            // Claude's pipe traffic stays between the CLI and the app: the relay-mail MCP server and its restrictions
            if claude {
                if let Ok(ev) = serde_json::from_str::<Value>(&line) {
                    if ev["type"] == "control_request" { control(&a, &k, pid, &ev); continue; }
                    if ev["type"] == "control_response" {
                        if ev["response"]["subtype"] == "error" {
                            let rid = ev["response"]["request_id"].as_str().unwrap_or("");
                            // a session that holds mail text and could not be restricted does not go on
                            if rid.starts_with("taint") {
                                if let Some(x) = a.state::<App>().procs.lock().unwrap().get_mut(&k).filter(|x| x.child.id() == pid) { x.child.kill().ok(); }
                            }
                            emit(json!({"type": "stderr", "text": format!("relay-mail ({rid}): {}", ev["response"]["error"])}));
                        }
                        continue;
                    }
                }
            }
            for ev in parse(&line) {
                match &ev {
                    Event::Session { id: sid } => {
                        let st = a.state::<App>();
                        let mut sids = st.sids.lock().unwrap();
                        sids.insert(k.clone(), agents::Sess { provider: id.into(), sid: sid.clone() });
                        save_sids(&a, &sids);
                    }
                    // raised in the provider's own protocol: a card like any other, answered through respond()
                    Event::Permission { request } => {
                        let mut r = request.clone();
                        (r.project, r.provider, r.relay) = (k.clone(), id.into(), true);
                        pending::write(&pend, &r).ok();
                    }
                    Event::TurnEnd { .. } => {
                        if let Some(x) = a.state::<App>().procs.lock().unwrap().get_mut(&k).filter(|x| x.child.id() == pid) { x.turns = x.turns.saturating_sub(1); }
                    }
                    _ => {}
                }
                if !replay || matches!(ev, Event::TurnEnd { .. }) { emit(serde_json::to_value(&ev).unwrap_or_default()); }
            }
        }
        if !err.is_empty() { emit(json!({"type": "stderr", "text": err.join("\n")})); }
        broker::forget(&k, pid);
        // a process replaced for a model or effort switch exits quietly, its successor keeps the slot
        {
            let st = a.state::<App>();
            let mut procs = st.procs.lock().unwrap();
            if procs.get(&k).is_some_and(|x| x.child.id() != pid) { return; }
            procs.remove(&k);
        }
        emit(json!({"type": "exit"}));
    });
}

/// The app quits: an agent with no turn running stops (the next message resumes its session, nothing is lost), so
/// only a running turn keeps an agent and its broker alive while the app is closed.
fn quit(app: &AppHandle) {
    for (_, mut x) in app.state::<App>().procs.lock().unwrap().drain().filter(|(_, x)| x.turns == 0) { x.child.kill().ok(); broker::forget(&x.key, x.child.id()); }
}

/// After a restart: the conversations whose broker is still there are the app's again, the files of the others go.
fn reattach(app: &AppHandle) {
    let Ok(dir) = fs::read_dir(broker::dir()) else { return };
    for f in dir.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")) {
        let Some(m) = broker::load_meta(&f) else { fs::remove_file(&f).ok(); continue };
        let (Ok(p), Some(c)) = (agents::get(&m.provider), broker::reattach(&m.key)) else { fs::remove_file(&f).ok(); continue };
        let Ok(stdin) = c.stdin.try_clone() else { continue };
        let x = Proc { child: broker::Agent::from(c.agent.id()), stdin, opts: (m.model, m.effort), provider: p.id(), tainted: m.tainted, key: m.key.clone(), turns: 1 };
        app.state::<App>().procs.lock().unwrap().insert(m.key.clone(), x);
        read_agent(app, &m.key, p, c);
    }
}

/// A request from the CLI over the pipe. Only relay-mail's MCP messages are answered, a tool call runs off this
/// reader thread so the conversation keeps streaming while IMAP works.
fn control(app: &AppHandle, key: &str, pid: u32, ev: &Value) {
    let (rid, req) = (ev["request_id"].clone(), &ev["request"]);
    if req["subtype"] != "mcp_message" || req["server_name"] != "relay-mail" {
        return pipe_reply(app, key, pid, json!({"subtype": "error", "request_id": rid, "error": "unsupported"}));
    }
    match mail::rpc(&req["message"]) {
        mail::Rpc::Reply(r) => pipe_reply(app, key, pid, pipe_ok(rid, r)),
        mail::Rpc::Call { id, name, args } => {
            // mail text is about to enter this session: restrict it before the answer goes out, and before the
            // tool runs, so a stranger's text never reaches a session that still has its allow rules
            if ["search", "read", "thread", "attachment"].contains(&name.as_str()) {
                let st = app.state::<App>();
                let v = vault(&st);
                let mut procs = st.procs.lock().unwrap();
                if let Some(p) = procs.get_mut(key).filter(|p| p.child.id() == pid && !p.tainted) { write_taint(p, &v); }
            }
            let (app, key) = (app.clone(), key.to_string());
            tauri::async_runtime::spawn(async move {
                let st = app.state::<App>();
                let (on, accts, default) = { let s = st.settings.lock().unwrap(); (s["mail"]["on"] == true, mail::accounts(&s["mail"]), s["mail"]["account"].as_str().unwrap_or("").to_string()) };
                let dl = PathBuf::from(home()).join("Downloads/Relay-mail");
                let res = if on { st.mail.tool(&accts, &default, &name, &args, &dl).await }
                    else { json!({"content": [{"type": "text", "text": "Mail is switched off in the app."}], "isError": true}) };
                if name == "save_draft" && res["isError"] != true {
                    // the chat shows who the draft is really for, whatever Claude writes about it
                    let d: Value = serde_json::from_str(res["content"][0]["text"].as_str().unwrap_or("")).unwrap_or_default();
                    app.emit("agent", json!({"project": key, "provider": "claude", "event": {"type": "draft_saved", "folder": d["folder"], "to": d["to"], "cc": d["cc"], "bcc": d["bcc"]}})).ok();
                }
                pipe_reply(&app, &key, pid, pipe_ok(rid, mail::rpc_result(id, res)));
            });
        }
    }
}
fn pipe_ok(rid: Value, r: Value) -> Value { json!({"subtype": "success", "request_id": rid, "response": {"mcp_response": r}}) }
/// Write a control_response to the process that asked, if it is still the one in that slot.
fn pipe_reply(app: &AppHandle, key: &str, pid: u32, response: Value) {
    let st = app.state::<App>();
    let mut procs = st.procs.lock().unwrap();
    if let Some(p) = procs.get_mut(key).filter(|p| p.child.id() == pid) {
        writeln!(p.stdin, "{}", json!({"type": "control_response", "response": response})).and_then(|_| p.stdin.flush()).ok();
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn send(app: AppHandle, state: State<App>, project: String, text: String, images: Option<Vec<Value>>, name: Option<String>, fork: Option<String>,
        model: Option<String>, effort: Option<String>, provider: Option<String>, mail: Option<bool>) -> Result<(), String> {
    let p = provider_of(&state, &project, provider.as_deref());
    // pasted images, only the types the webview allows, for a provider that takes them
    let images: Vec<Image> = if !p.caps().images { vec![] } else {
        images.unwrap_or_default().into_iter().filter_map(|i| Some(Image { media_type: i["media_type"].as_str()?.into(), data: i["data"].as_str()?.into() }))
            .filter(|i| IMAGE_TYPES.contains(&i.media_type.as_str())).collect()
    };
    if images.is_empty() && text.trim().is_empty() { return Err(tr(ui_lang_of(&state.settings.lock().unwrap()), "err.empty")); }
    let turn = Turn { text, images };
    // empty = the CLI default from its settings. Only aliases and model ids, never a stray flag
    let model = model.filter(|m| agent_core::safe_model(m)).unwrap_or_default();
    let effort = effort.filter(|e| p.efforts().iter().any(|c| c.id == *e)).unwrap_or_default();
    let opts = (model, effort);
    let name = name.unwrap_or_else(|| project.clone());
    let mut procs = state.procs.lock().unwrap();
    if !p.caps().persistent {
        // one process per turn: the next message waits for this one
        if procs.contains_key(&project) { return Err(trc("err.agent_busy")); }
        let x = spawn(&app, &state, p, &project, &name, fork.as_deref(), opts, Some(&turn), false)?;
        procs.insert(project, x);
        return Ok(());
    }
    // model and effort are start flags: a switch restarts the process on the same session
    let mut was_tainted = false;
    if procs.get(&project).is_some_and(|x| x.opts != opts || x.provider != p.id()) { if let Some(mut x) = procs.remove(&project) { x.child.kill().ok(); was_tainted = x.tainted; } }
    if !procs.contains_key(&project) {
        let x = spawn(&app, &state, p, &project, &name, fork.as_deref(), opts, None, mail.unwrap_or(false) || was_tainted)?;
        procs.insert(project.clone(), x);
    }
    let line = p.input(&turn).ok_or_else(|| format!("{}: no input", p.id()))?;
    let x = procs.get_mut(&project).unwrap();
    writeln!(x.stdin, "{line}").and_then(|_| x.stdin.flush()).map_err(|e| e.to_string())?;
    x.turns += 1;
    Ok(())
}

#[tauri::command]
fn stop(state: State<App>, project: String) {
    if let Some(mut p) = state.procs.lock().unwrap().remove(&project) { p.child.kill().ok(); }
}

/// A short title for a new conversation, from its provider or else the first switched-on one that can.
/// Async, so the wait (~5 s for Claude) never blocks the window.
#[tauri::command]
async fn ai_title(app: AppHandle, state: State<'_, App>, text: String, provider: Option<String>) -> Result<String, String> {
    let p = {
        let on = agents::enabled(&state.settings.lock().unwrap());
        provider.as_deref().and_then(|a| on.iter().copied().find(|p| p.id() == a && p.caps().title)).or_else(|| on.iter().copied().find(|p| p.caps().title))
    };
    let p = p.ok_or_else(|| trc("err.no_agent"))?;
    let eb = env_of(&app, &state, p);
    tauri::async_runtime::spawn_blocking(move || p.title(&eb.env(), &text)).await.map_err(|e| e.to_string())?
}

/// Past messages of a conversation, as agent events, read from the same transcript the terminal uses.
#[tauri::command]
fn history(app: AppHandle, state: State<App>, project: String) -> Value {
    let Some(s) = state.sids.lock().unwrap().get(&project).cloned() else { return json!([]) };
    let p = agents::get_or_first(Some(&s.provider));
    json!(p.history(&env_of(&app, &state, p).env(), &s.sid, 0).0)
}

/// "Nieuw gesprek": stop the process and forget the session, the next message starts fresh.
#[tauri::command]
fn reset(app: AppHandle, state: State<App>, project: String) {
    if let Some(mut p) = state.procs.lock().unwrap().remove(&project) { p.child.kill().ok(); }
    let mut sids = state.sids.lock().unwrap();
    sids.remove(&project);
    save_sids(&app, &sids);
}

/// Hang a conversation under another key, e.g. a general chat that turned out to be about a
/// project. Only while idle: the process stops and the next message resumes it under the new key.
#[tauri::command]
fn move_chat(app: AppHandle, state: State<App>, from: String, to: String) -> Result<(), String> {
    if let Some(mut p) = state.procs.lock().unwrap().remove(&from) { p.child.kill().ok(); }
    let mut sids = state.sids.lock().unwrap();
    if let Some(sid) = sids.remove(&from) { sids.insert(to, sid); }
    save_sids(&app, &sids);
    Ok(())
}

/// Every conversation key the app has a session for (projects and general chats), with its provider.
#[tauri::command]
fn chats(state: State<App>) -> Vec<String> { state.sids.lock().unwrap().keys().cloned().collect() }
/// The provider per conversation key, for the composer's pick.
#[tauri::command]
fn chat_providers(state: State<App>) -> HashMap<String, String> { state.sids.lock().unwrap().iter().map(|(k, s)| (k.clone(), s.provider.clone())).collect() }

/// Session ids of the app's own conversations, so the sidebar does not list them twice.
#[tauri::command]
fn app_sids(state: State<App>) -> Vec<String> { state.sids.lock().unwrap().values().map(|s| s.sid.clone()).collect() }
/// Which provider and session each app conversation resumes, so the page can follow a turn it gets no events from.
#[tauri::command]
fn app_sessions(state: State<App>) -> Value {
    state.sids.lock().unwrap().iter().map(|(k, s)| (k.clone(), json!({"provider": s.provider, "sid": s.sid}))).collect()
}

/// Read-only history of any session in the vault, e.g. one that is open in the terminal, from byte offset `from`.
#[tauri::command]
fn history_sid(app: AppHandle, state: State<App>, sid: String, from: Option<u64>, provider: Option<String>) -> Value {
    let p = agents::get_or_first(provider.as_deref());
    if !p.valid_session(&sid) { return json!({"items": [], "next": 0}); }
    let (items, next) = p.history(&env_of(&app, &state, p).env(), &sid, from.unwrap_or(0));
    json!({"items": items, "next": next})
}

/// The provider and session id behind a conversation key: `t:…` for a terminal session, else the app's own.
fn sid_of(state: &App, key: &str) -> Option<(&'static dyn AgentProvider, String)> {
    agents::term_key(key).or_else(|| state.sids.lock().unwrap().get(key).map(|s| (agents::get_or_first(Some(&s.provider)), s.sid.clone())))
        .filter(|(p, s)| p.valid_session(s))
}

/// Subagents per conversation key, only for keys that ever spawned one.
#[tauri::command]
fn subagents(app: AppHandle, state: State<App>, keys: Vec<String>) -> Value {
    let mut out = serde_json::Map::new();
    for k in keys {
        let Some((p, sid)) = sid_of(&state, &k).filter(|(p, _)| p.caps().subagents) else { continue };
        let list = p.subagents(&env_of(&app, &state, p).env(), &sid);
        if !list.is_empty() { out.insert(k, json!(list)); }
    }
    Value::Object(out)
}

/// The last few things a subagent wrote, read-only, from the tail of its transcript.
#[tauri::command]
fn agent_log(app: AppHandle, state: State<App>, key: String, id: String) -> Vec<String> {
    let Some((p, sid)) = sid_of(&state, &key) else { return vec![] };
    p.agent_log(&env_of(&app, &state, p).env(), &sid, &id)
}

#[tauri::command]
fn running(state: State<App>) -> Vec<String> { state.procs.lock().unwrap().keys().cloned().collect() }

/// The open permission requests and questions of every provider.
#[tauri::command]
fn pending(app: AppHandle) -> Vec<Value> { pending::list(&pending_dir(&app)) }

/// The user's decision. A provider that raised the request in its own protocol gets it over stdin.
#[tauri::command]
fn answer(app: AppHandle, state: State<App>, id: String, decision: Value) -> Result<(), String> {
    if !pending::valid_id(&id) { return Err("bad id".into()); }
    let dir = pending_dir(&app);
    let req = pending::read(&dir, &id);
    pending::answer(&dir, &id, &decision)?;
    if let Some(r) = req.filter(|r| r.relay) {
        pending::take(&dir, &id);
        if let Some(line) = agents::get(&r.provider)?.respond(&r, &decision) {
            if let Some(x) = state.procs.lock().unwrap().get_mut(&r.project) {
                writeln!(x.stdin, "{line}").and_then(|_| x.stdin.flush()).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// Sessions the switched-on providers know about outside the app (terminal, background), each with its provider.
#[tauri::command]
fn agents(app: AppHandle, state: State<App>) -> Value {
    let on = agents::enabled(&state.settings.lock().unwrap());
    let mut out = vec![];
    for p in on.into_iter().filter(|p| p.caps().background) {
        for mut a in p.sessions(&env_of(&app, &state, p).env()) { a["provider"] = json!(p.id()); out.push(a); }
    }
    json!(out)
}

/// Continue a conversation in iTerm. The app's own process for it stops first, so two processes never
/// write the same session.
#[tauri::command]
fn open_terminal(app: AppHandle, state: State<App>, project: String, session: Option<String>, name: Option<String>) -> Result<(), String> {
    if let Some(mut p) = state.procs.lock().unwrap().remove(&project) { p.child.kill().ok(); }
    need_vault(&state)?;
    let p = provider_of(&state, &project, None);
    let eb = env_of(&app, &state, p);
    let sid = session.or_else(|| state.sids.lock().unwrap().get(&project).map(|s| s.sid.clone()));
    let cmd = sid.as_deref().and_then(|s| p.terminal(&eb.env(), Terminal::Resume(s)))
        .or_else(|| p.terminal(&eb.env(), Terminal::New(name.as_deref().unwrap_or(&project))))
        .ok_or_else(|| trc_v("err.agent_terminal", p.name()))?;
    iterm(&cmd)
}

/// Background sessions of a provider (not started by the app): step into one in iTerm, or stop it.
#[tauri::command]
fn bg(app: AppHandle, state: State<App>, action: String, id: String, provider: Option<String>) -> Result<(), String> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { return Err("bad id".into()); }
    let p = agents::get_or_first(provider.as_deref());
    let eb = env_of(&app, &state, p);
    match action.as_str() {
        "stop" => p.stop_background(&eb.env(), &id),
        "attach" => iterm(&p.terminal(&eb.env(), Terminal::Attach(&id)).ok_or_else(|| trc_v("err.agent_terminal", p.name()))?),
        _ => Err("unknown action".into()),
    }
}

/// Every provider: switched on, detected (installed, version, logged in), capabilities, models and efforts.
#[tauri::command]
async fn agents_status(app: AppHandle, state: State<'_, App>) -> Result<Value, String> {
    let s = state.settings.lock().unwrap().clone();
    let bufs: Vec<_> = agents::PROVIDERS.iter().map(|p| (*p, env_of(&app, &state, *p))).collect();
    tauri::async_runtime::spawn_blocking(move || {
        let list: Vec<Value> = bufs.iter().map(|(p, eb)| json!({"id": p.id(), "name": p.name(), "on": s["agents"]["providers"][p.id()]["on"] == true,
            "caps": p.caps(), "detect": p.detect(&eb.env()), "models": p.models(), "efforts": p.efforts(), "bin": eb.bin, "defaultBin": p.default_bin(&eb.home)})).collect();
        json!({"default": agents::default_id(&s), "providers": list})
    }).await.map_err(|e| e.to_string())
}

/// Token usage per switched-on provider and over all of them. `today` and `week` are the local starts of the
/// day and the week, in ms. Each provider reads only what its logs gained since the last call.
#[tauri::command]
async fn usage_tokens(app: AppHandle, state: State<'_, App>, today: i64, week: i64) -> Result<Value, String> {
    let on = agents::enabled(&state.settings.lock().unwrap());
    let bufs: Vec<_> = on.into_iter().map(|p| (p, env_of(&app, &state, p))).collect();
    // the app's own conversations by their key, so the UI can show their title
    let keys: HashMap<(String, String), String> = state.sids.lock().unwrap().iter().map(|(k, s)| ((s.provider.clone(), s.sid.clone()), k.clone())).collect();
    tauri::async_runtime::spawn_blocking(move || {
        let since = usage::now_ms() - usage::KEEP_MS;
        let mut all = vec![];
        let providers: Vec<Value> = bufs.iter().map(|(p, eb)| {
            let recs = p.usage(&eb.env(), since);
            let mut v = usage::aggregate(&recs, today, week);
            for s in v["sessions"].as_array_mut().into_iter().flatten() {
                if let Some(k) = s["sid"].as_str().and_then(|sid| keys.get(&(p.id().to_string(), sid.to_string()))) { s["key"] = json!(k); }
            }
            v["provider"] = json!(p.id());
            all.extend(recs);
            v
        }).collect();
        let total = usage::aggregate(&all, today, week);
        json!({"providers": providers, "today": total["today"], "week": total["week"]})
    }).await.map_err(|e| e.to_string())
}

/// The plan or rate limits of every switched-on provider that has them, each at most once a minute.
#[tauri::command]
async fn usage_limits(app: AppHandle, state: State<'_, App>) -> Result<Value, String> {
    let on: Vec<_> = agents::enabled(&state.settings.lock().unwrap()).into_iter().filter(|p| p.caps().limits).collect();
    let mut out = vec![];
    for p in on {
        let cached = state.limits.lock().unwrap().get(p.id()).filter(|(at, _)| usage::now_ms() - at < 60_000).map(|(_, v)| v.clone());
        let v = match cached {
            Some(v) => v,
            None => {
                let eb = env_of(&app, &state, p);
                let v = tauri::async_runtime::spawn_blocking(move || p.limits(&eb.env()).json()).await.unwrap_or_else(|_| json!({"ok": false, "reason": "unavailable"}));
                state.limits.lock().unwrap().insert(p.id().to_string(), (usage::now_ms(), v.clone()));
                v
            }
        };
        out.push(json!({"provider": p.id(), "limits": v}));
    }
    Ok(json!(out))
}


/// The saved settings: vault, projects (icon, label) and session overrides.
#[tauri::command]
fn get_settings(state: State<App>) -> Value { state.settings.lock().unwrap().clone() }

/// Validate, save and activate new settings. Returns what was saved.
#[tauri::command]
fn set_settings(app: AppHandle, state: State<App>, settings: Value) -> Result<Value, String> {
    let mut s = norm(settings);
    let lang = ui_lang_of(&s);
    // the vault by its real path, with its full mapping stored, so the file shows what the app uses
    let v = vault::canon(s["vault"].as_str().unwrap());
    if v.is_empty() { return Err(tr(lang, "err.no_vault_set")); }
    s["vault"] = json!(v);
    // a mapping edited in Settings comes in as vaults[v]; it goes to the vault's .relay/config.json, not here
    let map = if s["vaults"][&v].is_object() { vault::merge(&json!({}), &s["vaults"][&v]) } else { vault_map(&s, &v) };
    if vault::status(&v, &map)["ok"] != true { return Err(tr_v(lang, "err.no_vault", &v)); }
    relay_config::set_paths(&v, &map).map_err(|e| format!(".relay/config.json: {e}"))?;
    s["vaults"].as_object_mut().unwrap().remove(&v);
    for (name, p) in s["projects"].as_object().unwrap() {
        let ok = p.as_object().is_some_and(|o| o.iter().all(|(k, x)| match (k.as_str(), x.as_str()) {
            ("icon", Some(t)) => t.chars().count() <= 4,
            ("label", Some(t)) => t.chars().count() <= 60,
            ("img", Some(t)) => t.len() <= 200_000 && t.strip_prefix("data:image/png;base64,").is_some_and(|b| b.chars().all(|c| c.is_ascii_alphanumeric() || "+/=".contains(c))),
            _ => false,
        }));
        if !ok { return Err(tr_v(lang, "err.project", name)); }
    }
    for (sid, t) in s["overrides"].as_object().unwrap() {
        if sid.is_empty() || !sid.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c) || c == '-') || !(t.is_string() || t.is_null()) {
            return Err(tr_v(lang, "err.override", sid));
        }
    }
    // the provider checks answer in the language being saved
    let was = ui_lang_of(&state.settings.lock().unwrap());
    set_cur_lang(lang);
    if let Err(e) = providers::check(&s).and_then(|_| agents::check(&s)) { set_cur_lang(was); return Err(e); }
    let owners: Vec<&str> = s["github"]["owners"].as_str().unwrap().split([' ', ',']).filter(|o| !o.is_empty()).collect();
    if owners.len() > 10 || !owners.iter().all(|o| o.len() <= 39 && o.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')) {
        return Err(tr(lang, "err.gh_owners"));
    }
    if !mail_settings_ok(&s["mail"]) { return Err(tr(lang, "err.mail_account")); }
    fs::write(data_dir(&app).join("settings.json"), serde_json::to_string_pretty(&s).unwrap()).map_err(|e| e.to_string())?;
    app.emit("settings-changed", &s).ok(); // the main window follows a change made in the settings window
    let relang = ui_lang_of(&state.settings.lock().unwrap()) != lang;
    *state.settings.lock().unwrap() = s.clone();
    set_cur_lang(lang);
    tray::refresh(&app); // another vault or language
    if relang { // the menu bar and the settings window title follow a new language right away
        if let Ok(m) = build_menu(&app, lang) { app.set_menu(m).ok(); }
        if let Some(w) = app.get_webview_window("settings") { w.set_title(&tr(lang, "settings.title")).ok(); }
    }
    Ok(s)
}

/// At most 5 valid accounts, no email twice, and the sidebar account "" or one of them. `mail` is normalized.
fn mail_settings_ok(mail: &Value) -> bool {
    let accts = mail["accounts"].as_array().unwrap();
    let emails: Vec<&str> = accts.iter().filter_map(|a| a["email"].as_str()).collect();
    let unique = emails.iter().enumerate().all(|(i, e)| !emails[..i].iter().any(|x| x.eq_ignore_ascii_case(e)));
    let cur = mail["account"].as_str().unwrap();
    accts.len() <= 5 && accts.iter().all(mail::valid_account) && unique && (cur.is_empty() || emails.contains(&cur))
}

// ---------- Board providers (providers.rs): token in the keychain, config in settings.integrations.<id>.

/// Whether the provider is switched on, its config complete and a token in the keychain.
#[tauri::command]
fn integration_status(state: State<App>, provider: String) -> Result<bool, String> {
    let p = providers::get(&provider)?;
    let cfg = state.settings.lock().unwrap()["integrations"][p.id].clone();
    Ok(cfg["on"] == true && (p.ready)(&cfg) && providers::token(p).is_some())
}
/// Whether a token for the provider is in the keychain, for the settings window.
#[tauri::command]
fn integration_has_token(provider: String) -> Result<bool, String> { Ok(providers::token(providers::get(&provider)?).is_some()) }

/// Save one of the provider's secrets (`account`, "token" when absent), or remove it with "": without an
/// account "" removes them all. The main window follows, it shows a board only with every secret there.
#[tauri::command]
fn integration_token(app: AppHandle, state: State<App>, provider: String, token: String, account: Option<String>) -> Result<(), String> {
    let p = providers::get(&provider)?;
    match account {
        None if token.trim().is_empty() => for a in p.secrets { providers::set_token(p, a, "")?; },
        a => providers::set_token(p, a.as_deref().unwrap_or("token"), token.trim())?,
    }
    app.emit("settings-changed", state.settings.lock().unwrap().clone()).ok();
    Ok(())
}

/// One API call for a provider, only the ones its `url` allows. Async, so the network wait stays off the main thread.
#[tauri::command]
async fn integration_call(state: State<'_, App>, provider: String, method: String, path: String, body: Option<Value>) -> Result<Value, String> {
    let p = providers::get(&provider)?;
    let cfg = state.settings.lock().unwrap()["integrations"][p.id].clone();
    tauri::async_runtime::spawn_blocking(move || providers::call(p, &cfg, &method, &path, body)).await.map_err(|e| e.to_string())?
}

/// Take the token, org and user from Claude Code's own Productive MCP config. The token goes to the
/// keychain, org and user come back for the settings window to save.
#[tauri::command]
fn productive_import() -> Result<Value, String> {
    let cfg: Value = fs::read_to_string(format!("{}/.claude.json", home())).ok()
        .and_then(|s| serde_json::from_str(&s).ok()).ok_or_else(|| trc("err.claude_json"))?;
    let (token, fields) = integration_productive::import(&cfg)?;
    providers::set_token(providers::get("productive")?, "token", &token)?;
    Ok(fields)
}

// ---------- GitHub: pull requests through the gh CLI and its own login, so no token in the app.
// Read-only. The search queries are built here from the settings, the webview only asks for the list.

/// A binary from the login-shell PATH: an app started from the Finder does not have /opt/homebrew/bin.
fn in_path(state: &App, name: &str) -> Option<String> {
    state.path.split(':').map(|d| format!("{d}/{name}")).find(|p| PathBuf::from(p).is_file())
}
/// gh from the login-shell PATH: an app started from the Finder does not have /opt/homebrew/bin.
fn gh(state: &App, args: &[&str]) -> Result<String, String> {
    let bin = in_path(state, "gh").ok_or_else(|| trc("err.no_gh"))?;
    let o = Command::new(bin).args(args).env("PATH", &state.path).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
    if o.status.success() { return Ok(String::from_utf8_lossy(&o.stdout).into_owned()); }
    let e = String::from_utf8_lossy(&o.stderr);
    Err(if e.contains("auth login") { trc("err.gh_login") } else { format!("gh: {}", e.trim()) })
}
/// `owner/repo` of a GitHub remote url (ssh, scp-style or https), lowercased.
fn gh_slug(url: &str) -> Option<String> {
    let s = url.split_once("github.com")?.1.trim_start_matches([':', '/']).trim_end_matches('/').trim_end_matches(".git");
    (s.matches('/').count() == 1 && !s.starts_with('/') && !s.ends_with('/')).then(|| s.to_lowercase())
}
/// The origin of a checkout, read from .git/config (no git process per folder).
fn gh_repo(dir: &str) -> Option<String> {
    let cfg = fs::read_to_string(format!("{dir}/.git/config")).ok()?;
    let mut origin = false;
    for l in cfg.lines().map(str::trim) {
        if l.starts_with('[') { origin = l == "[remote \"origin\"]"; continue; }
        if !origin { continue; }
        if let Some(u) = l.strip_prefix("url").and_then(|r| r.trim_start().strip_prefix('=')) { return gh_slug(u.trim()); }
    }
    None
}
/// repo -> vault project: the `repos` of the vault's .relay/config.json, then its brain's index/repos.json.
fn repo_projects(vault: &str) -> HashMap<String, String> {
    let mut out: HashMap<String, String> = repo_index(vault).into_iter().collect();
    if let Some(r) = relay_config::load(vault).and_then(|c| c["repos"].as_object().cloned()) {
        // GitHub names are case-insensitive and the PRs are looked up lowercased: "o2o-Bicycle-leasing/x" matches too
        out.extend(r.into_iter().filter_map(|(k, v)| Some((k.to_lowercase(), v.as_str()?.to_string()))));
    }
    out.retain(|_, p| !p.is_empty()); // "" in the config: unlinked on purpose
    out
}
/// repo -> note name, from the brain's index/repos.json. An entry is a checkout or a folder of checkouts,
/// a checkout listed by itself wins over the same one found inside a listed folder.
fn repo_index(vault: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Some(idx) = brain(vault).and_then(|b| fs::read_to_string(format!("{b}/index/repos.json")).ok())
        .and_then(|s| serde_json::from_str::<serde_json::Map<String, Value>>(&s).ok()) else { return out };
    let named: Vec<(String, String)> = idx.iter().filter_map(|(d, n)| Some((d.clone(), n.as_str()?.rsplit('/').next()?.trim_end_matches(".md").to_string()))).collect();
    for (d, n) in &named { if let Some(r) = gh_repo(d) { out.insert(r, n.clone()); } }
    // two levels down, not into a checkout: web-projecten keeps its sites in repos/<site>
    fn scan(d: &str, depth: u8, n: &str, out: &mut HashMap<String, String>) {
        if let Some(r) = gh_repo(d) { out.entry(r).or_insert_with(|| n.to_string()); return; }
        if depth == 0 { return; }
        for e in fs::read_dir(d).into_iter().flatten().flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())) {
            scan(&e.path().to_string_lossy(), depth - 1, n, out);
        }
    }
    for (d, n) in &named { if gh_repo(d).is_none() { scan(d, 2, n, &mut out); } }
    out
}

/// The GitHub login gh is signed in with, the settings window shows it.
#[tauri::command]
async fn github_status(state: State<'_, App>) -> Result<String, String> {
    Ok(gh(&state, &["api", "user", "--jq", ".login"])?.trim().to_string())
}

const PR_FIELDS: &str = "... on PullRequest{number title url isDraft createdAt updatedAt repository{nameWithOwner} author{login} reviewDecision commits(last:1){nodes{commit{statusCheckRollup{state}}}}}";

/// Open pull requests: the ones the user wrote and the ones waiting on their review, within the owners
/// from the settings (empty: everywhere), each with the vault project of its repo.
#[tauri::command]
async fn github_prs(state: State<'_, App>) -> Result<Value, String> {
    let (owners, v) = { let s = state.settings.lock().unwrap(); (s["github"]["owners"].as_str().unwrap_or("").to_string(), s["vault"].as_str().unwrap_or("").to_string()) };
    let scope: String = owners.split([' ', ',']).filter(|o| !o.is_empty()).map(|o| format!(" user:{o}")).collect();
    let q = |who: &str| format!("is:pr is:open archived:false sort:updated-desc {who}{scope}");
    // ponytail: one page of 50 per list, paging once there are more open PRs than that
    let query = format!("query($a:String!,$r:String!){{mine:search(query:$a,type:ISSUE,first:50){{nodes{{{PR_FIELDS}}}}} review:search(query:$r,type:ISSUE,first:50){{nodes{{{PR_FIELDS}}}}}}}");
    let out = gh(&state, &["api", "graphql", "-f", &format!("query={query}"), "-f", &format!("a={}", q("author:@me")), "-f", &format!("r={}", q("review-requested:@me"))])?;
    let data: Value = serde_json::from_str(&out).map_err(|e| format!("gh: {e}"))?;
    let map = repo_projects(&v);
    let rows = |k: &str| -> Vec<Value> {
        data["data"][k]["nodes"].as_array().into_iter().flatten().filter(|n| n["number"].is_number()).map(|n| {
            let repo = n["repository"]["nameWithOwner"].as_str().unwrap_or("");
            json!({"number": n["number"], "title": n["title"], "url": n["url"], "repo": repo, "draft": n["isDraft"], "created": n["createdAt"],
                "updated": n["updatedAt"], "author": n["author"]["login"], "review": n["reviewDecision"],
                "ci": n["commits"]["nodes"][0]["commit"]["statusCheckRollup"]["state"], "project": map.get(&repo.to_lowercase())})
        }).collect()
    };
    Ok(json!({"mine": rows("mine"), "review": rows("review")}))
}

const PR_DETAIL: &str = "query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){ number title url body state isDraft createdAt author{login} baseRefName headRefName additions deletions changedFiles mergeable reviewDecision reviewRequests(first:10){nodes{requestedReviewer{... on User{login} ... on Team{name}}}} commits(last:1){nodes{commit{statusCheckRollup{state contexts(first:50){nodes{... on CheckRun{name conclusion status detailsUrl} ... on StatusContext{context state targetUrl}}}}}}} comments(last:50){nodes{author{login} body createdAt url}} reviews(last:30){nodes{author{login} state body createdAt}} reviewThreads(last:30){nodes{path line isResolved isOutdated comments(first:10){nodes{author{login} body createdAt}}}} files(first:100){nodes{path additions deletions}} }}}";

/// One pull request in full for the side panel: description, checks, conversation, inline threads, files.
// ponytail: the last 50 comments, 30 reviews and 30 threads, one page each, enough for a PR you read in a side panel
#[tauri::command]
async fn github_pr(state: State<'_, App>, repo: String, number: u32) -> Result<Value, String> {
    let ok = |s: &str| !s.is_empty() && s.len() <= 100 && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    let (owner, name) = repo.split_once('/').filter(|(o, n)| ok(o) && ok(n)).ok_or_else(|| trc("err.bad_repo"))?;
    let out = gh(&state, &["api", "graphql", "-f", &format!("query={PR_DETAIL}"), "-f", &format!("o={owner}"), "-f", &format!("n={name}"), "-F", &format!("p={number}")])?;
    let v: Value = serde_json::from_str(&out).map_err(|e| format!("gh: {e}"))?;
    let pr = &v["data"]["repository"]["pullRequest"];
    if pr.is_null() { return Err(trc("err.no_pr")); }
    Ok(pr.clone())
}

// ---------- Mail: Gmail over IMAP in mail/, the app password stays in the macOS keychain.
// Listing and reading never change a flag (EXAMINE and BODY.PEEK). The one write is read/unread, on the user's
// click. Nothing here sends, moves or deletes: a reply only becomes a draft, from a conversation.

/// A configured account by email, "" for the one the sidebar shows (chosen in the settings, else the first).
fn mail_acct(state: &App, want: &str) -> Result<mail::Account, String> {
    let s = state.settings.lock().unwrap();
    let want = if want.is_empty() { s["mail"]["account"].as_str().unwrap_or("") } else { want };
    mail::pick_account(&mail::accounts(&s["mail"]), want).ok_or_else(|| trc("err.no_mail_account"))
}

/// One page of 50 mails from the inbox, page 1 is the newest.
#[tauri::command]
async fn mail_list(state: State<'_, App>, page: u32) -> Result<Value, String> {
    let a = mail_acct(&state, "")?;
    state.mail.list(&a, page.clamp(1, 1000)).await
}

/// One mail for the panel: its text, the sanitized HTML as a srcdoc document (or null), the attachments.
#[tauri::command]
async fn mail_read(state: State<'_, App>, account: String, id: String) -> Result<Value, String> {
    let a = mail_acct(&state, &account)?;
    state.mail.open(&a, &id).await
}

/// Mark one mail read or unread, on the user's click.
#[tauri::command]
async fn mail_seen(state: State<'_, App>, account: String, id: String, seen: bool) -> Result<(), String> {
    let a = mail_acct(&state, &account)?;
    state.mail.set_seen(&a, &id, seen).await
}

/// Settings › Mail the guided way: the app password goes straight into the keychain (service relay-mail, account
/// the email, over stdin so it never shows in the process list), then a login test. A code Gmail refuses is
/// removed again. Returns the account for the settings, the window adds and saves it.
#[tauri::command]
async fn mail_connect(state: State<'_, App>, email: String, password: String) -> Result<Value, String> {
    let email = email.trim().to_string();
    let account = json!({"email": email, "keychain_service": "relay-mail", "keychain_account": email});
    let a = mail::accounts(&json!({"accounts": [account.clone()]})).pop().ok_or_else(|| trc("err.mail_account"))?;
    let pw: String = password.chars().filter(|c| !c.is_whitespace()).collect(); // Google shows it in groups of four
    if !(8..=64).contains(&pw.len()) || !pw.chars().all(|c| c.is_ascii_alphanumeric()) { return Err(trc("err.mail_pw")); }
    let mut ch = Command::new("/usr/bin/security").arg("-i").stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
    writeln!(ch.stdin.take().unwrap(), "add-generic-password -U -s relay-mail -a {email} -w {pw}").map_err(|e| e.to_string())?;
    ch.wait().map_err(|e| e.to_string())?;
    match state.mail.test(&a).await {
        Ok(n) => Ok(json!({"account": account, "result": n})),
        Err(e) => {
            if e.starts_with("Login failed") { Command::new("/usr/bin/security").args(["delete-generic-password", "-s", "relay-mail", "-a", &email]).output().ok(); }
            Err(e)
        }
    }
}

/// Try an account from the settings window, saved or not yet: log in and count the inbox.
#[tauri::command]
async fn mail_test(state: State<'_, App>, account: Value) -> Result<String, String> {
    let a = mail::accounts(&json!({"accounts": [account]})).pop().ok_or_else(|| trc("err.mail_account"))?;
    state.mail.test(&a).await
}

/// Native folder picker (blocking, so async keeps it off the main thread). None when cancelled.
#[tauri::command]
async fn pick_folder(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog().file().blocking_pick_folder().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned())
}

/// Native picker for one mapped path, a file or a folder, opening in `start` (the vault).
#[tauri::command]
async fn pick_path(app: AppHandle, folder: bool, start: Option<String>) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let mut d = app.dialog().file();
    if let Some(s) = start.filter(|s| !s.is_empty()) { d = d.set_directory(s); }
    let p = if folder { d.blocking_pick_folder() } else { d.blocking_pick_file() };
    p.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned())
}

/// Mark a reminder done, push it to a new date (ISO, tomorrow, +1w, monday...), or drop it.
#[tauri::command]
fn reminder(app: AppHandle, action: String, id: String, date: Option<String>) -> Result<String, String> {
    if !["done", "push", "drop"].contains(&action.as_str()) { return Err("unknown action".into()); }
    if id.len() != 8 || !id.chars().all(|c| c.is_ascii_hexdigit()) { return Err("bad id".into()); }
    let (file, log, lang) = rem_ctx(&app)?;
    let r = reminders::act(&file, &log, &action, &id, date.as_deref(), chrono::Local::now().date_naive());
    tray::refresh(&app);
    r.map_err(|e| rem_err(lang, e))
}

/// A new reminder, the file created when the vault has none yet. Returns its id.
#[tauri::command]
fn reminder_add(app: AppHandle, text: String, date: String, project: Option<String>, repeat: Option<String>) -> Result<String, String> {
    let (file, log, lang) = rem_ctx(&app)?;
    let r = reminders::add(&file, &log, &text, &date, project.as_deref(), repeat.as_deref(), chrono::Local::now().date_naive());
    tray::refresh(&app);
    r.map_err(|e| rem_err(lang, e))
}

fn open_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") { w.set_focus().ok(); return; }
    let title = tr(ui_lang_of(&app.state::<App>().settings.lock().unwrap()), "settings.title");
    tauri::WebviewWindowBuilder::new(app, "settings", tauri::WebviewUrl::App("settings.html".into()))
        .title(title).inner_size(860.0, 620.0).min_inner_size(720.0, 480.0)
        .minimizable(false).maximizable(false).build().ok();
}
/// The settings row at the bottom of the sidebar: the same window as Relay › Settings….
#[tauri::command]
fn open_settings_window(app: AppHandle) { open_settings(&app); }

/// The app's own pages: the bundle, IPC, the about: documents a srcdoc frame starts as, and in a dev build the
/// vite server. Any other localhost port is a local service a mail link must not reach without asking.
fn nav_internal(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "tauri" | "ipc" | "about")
        || (cfg!(debug_assertions) && url.scheme() == "http" && url.host_str() == Some("localhost") && url.port() == Some(1420))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // settings live in their own small window, the Mac way: open it, or bring it forward when it is open
        .on_menu_event(|app, event| {
            let settings = app.get_webview_window("settings");
            if event.id() == "close-chat" && settings.as_ref().is_some_and(|w| w.is_focused().unwrap_or(false)) {
                settings.unwrap().close().ok(); return;
            }
            if tray::owns(event.id().as_ref()) { return; } // handled by the tray's own listener
            if event.id() != "settings" { app.emit("menu", event.id().as_ref()).ok(); return; }
            open_settings(app);
        })
        // a link clicked inside a mail navigates its sandboxed frame (no scripts run there). Every navigation passes
        // here: the app's own pages load, a web or mailto link goes to the UI to ask first, anything else is dropped
        .plugin(tauri::plugin::Builder::<tauri::Wry>::new("links").on_navigation(|w, url| {
            if nav_internal(url) { return true; }
            if matches!(url.scheme(), "http" | "https" | "mailto") { w.emit("mail-link", url.as_str()).ok(); }
            false
        }).build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default()
            .with_state_flags(tauri_plugin_window_state::StateFlags::SIZE | tauri_plugin_window_state::StateFlags::POSITION | tauri_plugin_window_state::StateFlags::MAXIMIZED)
            .build())
        // closing the main window hides it: the app keeps running for the menu bar icon, Cmd-Q quits
        .on_window_event(|w, e| if let tauri::WindowEvent::CloseRequested { api, .. } = e {
            if w.label() == "main" { api.prevent_close(); w.hide().ok(); }
        })
        .setup(|app| {
            let sids = agents::load_sessions(&fs::read_to_string(data_dir(app.handle()).join("sessions.json")).unwrap_or_default());
            let settings = norm(fs::read_to_string(data_dir(app.handle()).join("settings.json")).ok()
                .and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default());
            set_cur_lang(ui_lang_of(&settings));
            app.set_menu(build_menu(app.handle(), ui_lang_of(&settings))?)?;
            app.manage(App { procs: Mutex::new(HashMap::new()), sids: Mutex::new(sids), path: login_path(), settings: Mutex::new(settings), limits: Default::default(), mail: mail::Mail::new() });
            reattach(app.handle());
            tray::init(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![snapshot, favicons, project_icons, set_project_icon, find_icon_sites, project_repos, set_project_repos, open_settings_window, usage_tokens, usage_limits, agents_status, chat_providers, send, ai_title, stop, reset, move_chat, chats, bg, app_sids, history_sid, history, running, subagents, agent_log, pending, answer, agents, app_sessions, open_terminal, get_settings, set_settings, pick_folder, pick_path, vault_status, read_note, detect_vault, check_vault, reminder, reminder_add, ui_lang, ui_locale, integration_status, integration_has_token, integration_token, integration_call, productive_import, github_status, github_prs, github_pr, mail_list, mail_read, mail_seen, mail_test, mail_connect, notify::notify])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        // a click on the Dock icon brings the hidden main window back
        .run(|app, e| match e {
            tauri::RunEvent::Reopen { .. } => tray::show_main(app),
            tauri::RunEvent::Exit => quit(app),
            _ => {}
        });
}


#[cfg(test)]
mod lang_tests {
    use super::*;
    #[test]
    fn every_native_string_has_all_languages() {
        for (k, row) in TEXT { assert!(row.iter().all(|s| !s.is_empty()), "{k}"); }
        assert_eq!(tr("fr", "settings"), "Réglages…");
        assert_eq!(tr_v("de", "err.override", "x"), "Ungültige Zuordnung 'x'");
    }
    #[test]
    fn language_from_settings_or_system() {
        assert_eq!(ui_lang_of(&norm(json!({"language": "de"}))), "de");
        assert_eq!(norm(json!({"language": "xx"}))["language"], "system");
        assert!(LANGS.contains(&ui_lang_of(&norm(json!({})))));
        assert!(ui_locale_of(&norm(json!({"language": "nl"}))).starts_with("nl"));
        set_cur_lang("fr"); assert_eq!(trc("err.no_pr"), "PR introuvable"); set_cur_lang("en");
        println!("system locales: {:?}, ui language: {}", sys_locale::get_locales().collect::<Vec<_>>(), ui_lang_of(&norm(json!({}))));
    }
}


#[cfg(test)]
mod curl_tests {
    // the curl config round trip: a JSON body with quotes, backslashes and a newline escape arrives byte for byte
    #[test]
    fn curl_config_keeps_the_body_intact() {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let body = r#"{"t":"a \"b\" c\\d\n","n":1}"#;
        let cfg = format!("globoff\nurl = {}\nrequest = PATCH\nheader = {}\ndata-binary = {}\n",
            super::providers::curl_quote(&format!("http://{}/tasks/1?filter[x]=1", l.local_addr().unwrap())), super::providers::curl_quote("X-Auth-Token: t-1"), super::providers::curl_quote(body));
        let mut ch = std::process::Command::new("/usr/bin/curl").args(["-sS", "-K", "-"]).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::null()).spawn().unwrap();
        ch.stdin.take().unwrap().write_all(cfg.as_bytes()).unwrap();
        let (mut s, _) = l.accept().unwrap();
        let mut buf = vec![0; 4096];
        let mut got = String::new();
        while !got.ends_with(body) { let n = s.read(&mut buf).unwrap(); if n == 0 { break; } got += &String::from_utf8_lossy(&buf[..n]); }
        s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n").unwrap();
        ch.wait().unwrap();
        assert!(got.starts_with("PATCH /tasks/1?filter[x]=1 HTTP/1.1"), "{got}");
        assert!(got.contains("X-Auth-Token: t-1\r\n"), "{got}");
        assert!(got.ends_with(body), "{got}");
    }
}

#[cfg(test)]
mod github_tests {
    #[test]
    fn gh_slug_reads_every_remote_form() {
        assert_eq!(super::gh_slug("git@github.com:weareantenna/Weemaes-Backend.git").as_deref(), Some("weareantenna/weemaes-backend"));
        assert_eq!(super::gh_slug("https://github.com/Acme/vault-app").as_deref(), Some("acme/vault-app"));
        assert_eq!(super::gh_slug("ssh://git@github.com/Acme/check-in.git/").as_deref(), Some("acme/check-in"));
        assert_eq!(super::gh_slug("git@bitbucket.org:x/y.git"), None);
        assert_eq!(super::gh_slug("https://github.com/Acme"), None);
    }
    // against the vault in $VAULT, skipped without it
    #[test]
    fn repo_projects_maps_folders_of_checkouts() {
        let Ok(v) = std::env::var("VAULT") else { return };
        if super::brain(&v).is_none() { return; }
        let m = super::repo_projects(&v);
        assert_eq!(m.get("weareantenna/craft-veride").map(String::as_str), Some("Website Onderhoud"));
        println!("{} repos mapped", m.len());
    }
}

#[cfg(test)]
mod mail_tests {
    #[test]
    fn sessions_can_never_send_mail() {
        // a session with mail text loses the user's allow rules (deny beats allow) and goes to default mode
        let user = serde_json::json!({"permissions": {"allow": ["Bash(git push *)", "Bash(pandoc *)", "mcp__relay-mail__read", "mcp__pencil"]}});
        let [rules, mode] = super::taint(&[user.clone(), serde_json::json!({"hooks": {}})], true);
        let deny: Vec<&str> = rules["request"]["settings"]["permissions"]["deny"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        for t in ["Bash(git push *)", "Bash(pandoc *)", "mcp__pencil", "Bash(git push*)", "Bash(gh api*)", "mcp__claude_ai_Google_Calendar__create_event",
                  "mcp__claude_ai_Gmail__*", "Bash(himalaya*)", "RemoteTrigger", "SendMessage", "Skill(skill:initcraftcms)"] { assert!(deny.contains(&t), "{t}"); }
        assert!(!deny.contains(&"Bash"), "Bash stays when every settings file parsed");
        let [unread, _] = super::taint(&[user], false);
        assert!(unread["request"]["settings"]["permissions"]["deny"].as_array().unwrap().contains(&serde_json::json!("Bash")), "an unreadable settings file costs Bash");
        assert!(!deny.iter().any(|d| d.starts_with("mcp__relay-mail")), "the mail tools themselves stay");
        assert_eq!(rules["request"]["settings"]["permissions"]["allow"], serde_json::json!(super::MAIL_TOOLS), "the mail tools need no card");
        assert_eq!((rules["request"]["subtype"].as_str(), mode["request"]["subtype"].as_str(), mode["request"]["mode"].as_str()),
                   (Some("apply_flag_settings"), Some("set_permission_mode"), Some("default")));
        assert_eq!(super::pipe_init(true)["request"]["sdkMcpServers"], serde_json::json!(["relay-mail"]));
        assert_eq!(super::pipe_init(false)["request"]["sdkMcpServers"], serde_json::json!([]));
    }
    #[test]
    fn only_the_apps_own_pages_navigate() {
        let ok = |u: &str| super::nav_internal(&u.parse().unwrap());
        for u in ["tauri://localhost/index.html", "http://localhost:1420/", "about:srcdoc", "about:blank", "ipc://localhost/x"] { assert!(ok(u), "{u}"); }
        for u in ["https://example.com/", "http://localhost.evil.com/", "http://localhost:1420@evil.com/", "http://localhost:4600/", "http://127.0.0.1:1420/",
                  "asset://localhost/x", "data:text/html,<b>x</b>", "file:///etc/passwd", "javascript:alert(1)", "mailto:a@b.c"] { assert!(!ok(u), "{u}"); }
    }
    #[test]
    fn old_mail_settings_heal_and_bad_ones_fail() {
        use serde_json::json;
        // a himalaya account name from before is no email: it falls back to the first account
        let s = super::norm(json!({"mail": {"on": true, "account": "weareantenna"}}));
        assert_eq!((s["mail"]["accounts"].clone(), s["mail"]["account"].clone()), (json!([]), json!("")));
        let a = |e: &str| json!({"email": e, "keychain_service": "svc", "keychain_account": "acc"});
        let kept = super::norm(json!({"mail": {"account": "x@y.be", "accounts": [a("x@y.be")]}}));
        assert_eq!(kept["mail"]["account"], "x@y.be");
        let ok = |accts: Vec<serde_json::Value>, cur: &str| super::mail_settings_ok(&json!({"account": cur, "accounts": accts}));
        assert!(ok(vec![a("x@y.be"), a("z@y.be")], "z@y.be") && ok(vec![], ""));
        assert!(!ok((0..6).map(|i| a(&format!("u{i}@y.be"))).collect(), ""));
        assert!(!ok(vec![a("x@y.be"), a("X@Y.be")], ""), "the same email twice");
        assert!(!ok(vec![a("x@y.be")], "other@y.be"), "a sidebar account that is not configured");
    }
}
