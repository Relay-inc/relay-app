// Vault: a shell around the real Claude Code CLI. Every conversation is a `claude -p` process in
// stream-json mode, in the vault, on the user's subscription (no API key). Permission requests and
// Claude's questions come in through perm_server.py as files in the pending folder. Mail tools (mail/) are answered
// by the app itself over the same stdin/stdout pipe, as the in-process MCP server `vaultmail`.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

mod mail;
mod providers;
mod reminders;
mod tray;
mod usage;
mod vault;

// ponytail: REPO and the claude binary are fixed, fine as long as the app runs from its own checkout.
const REPO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/..");
fn home() -> String { std::env::var("HOME").unwrap_or_default() }
fn claude_bin() -> String { format!("{}/.local/bin/claude", home()) }
/// The vault folder from the settings, "" before one is chosen.
fn vault(st: &App) -> String {
    st.settings.lock().unwrap()["vault"].as_str().unwrap_or("").to_string()
}
/// The vault's mapping: the one stored in settings.json, or what detection finds for a vault without one.
/// set_settings always stores the full mapping, so detection (a folder scan) only runs before that.
fn vault_map(s: &Value, v: &str) -> Value {
    if v.is_empty() { return vault::merge(&json!({}), &json!({})); }
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
/// Claude Code's transcript folder for the vault: the path with every non-alphanumeric char as `-`.
fn transcripts(st: &App) -> String {
    let v = vault(st);
    if v.is_empty() { return String::new(); } // no vault: never fall back to ~/.claude/projects itself
    let slug: String = v.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    format!("{}/.claude/projects/{slug}", home())
}
/// Settings as stored on disk, with the defaults filled in for missing or malformed keys.
fn norm(mut v: Value) -> Value {
    if !v.is_object() { v = json!({}); }
    if !v["vault"].is_string() { v["vault"] = json!(""); }
    for k in ["projects", "overrides", "vaults", "github", "mail"] { if !v[k].is_object() { v[k] = json!({}); } }
    providers::migrate(&mut v); // integrations.<provider> and boards, from the old top-level "productive" too
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
    ("about", ["About Vault", "Over Vault", "À propos de Vault", "Über Vault"]),
    ("hide", ["Hide Vault", "Verberg Vault", "Masquer Vault", "Vault ausblenden"]),
    ("hide_others", ["Hide Others", "Verberg andere", "Masquer les autres", "Andere ausblenden"]),
    ("show_all", ["Show All", "Toon alles", "Tout afficher", "Alle einblenden"]),
    ("quit", ["Quit Vault", "Stop Vault", "Quitter Vault", "Vault beenden"]),
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
    ("tray.open", ["Open Vault", "Open Vault", "Ouvrir Vault", "Vault öffnen"]),
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
    ("err.no_token", ["No {v} token. Fill it in under Vault › Settings… › Integrations.", "Geen {v}-token. Vul het in bij Vault › Instellingen… › Integraties.", "Aucun jeton {v}. Renseignez-le dans Vault › Réglages… › Intégrations.", "Kein {v}-Token. Trag es unter Vault › Einstellungen… › Integrationen ein."]),
    ("err.down", ["{p} unreachable: {v}", "{p} niet bereikbaar: {v}", "{p} injoignable : {v}", "{p} nicht erreichbar: {v}"]),
    ("err.no_gh", ["gh not found. Install it with `brew install gh`.", "gh niet gevonden. Installeer het met `brew install gh`.", "gh introuvable. Installez-le avec `brew install gh`.", "gh nicht gefunden. Installiere es mit `brew install gh`."]),
    ("err.gh_login", ["Not signed in to gh. Run `gh auth login` in the terminal.", "Niet ingelogd bij gh. Voer `gh auth login` uit in de terminal.", "Pas connecté à gh. Lancez `gh auth login` dans le terminal.", "Nicht bei gh angemeldet. Führe `gh auth login` im Terminal aus."]),
    ("err.bad_repo", ["Invalid repo", "Ongeldige repo", "Dépôt invalide", "Ungültiges Repo"]),
    ("err.mail_pw", ["The app password is the 16-letter code Google showed (spaces are fine)", "Het app-wachtwoord is de code van 16 letters die Google toonde (spaties mogen)",
        "Le mot de passe d'application est le code de 16 lettres affiché par Google (les espaces sont acceptés)", "Das App-Passwort ist der 16-stellige Code, den Google angezeigt hat (Leerzeichen sind ok)"]),
    ("err.no_mail_account", ["Mail: no account set up. Add one under Vault › Settings… › Integrations › Mail.", "Mail: nog geen account. Voeg er een toe bij Vault › Instellingen… › Integraties › Mail.", "Mail : aucun compte. Ajoutez-en un dans Vault › Réglages… › Intégrations › Mail.", "Mail: noch kein Konto. Füge eins unter Vault › Einstellungen… › Integrationen › Mail hinzu."]),
    ("err.bad_mail", ["Invalid mail id", "Ongeldige mail-id", "Identifiant de mail invalide", "Ungültige Mail-ID"]),
    ("err.mail_account", ["Mail: invalid account (email, keychain service and account, at most 5 accounts)", "Mail: ongeldig account (e-mail, sleutelhangerdienst en -account, hoogstens 5 accounts)", "Mail : compte invalide (e-mail, service et compte du trousseau, 5 comptes au plus)", "Mail: ungültiges Konto (E-Mail, Schlüsselbunddienst und -konto, höchstens 5 Konten)"]),
    ("err.no_pr", ["PR not found", "PR niet gevonden", "PR introuvable", "PR nicht gefunden"]),
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
    let app = Submenu::with_items(h, "Vault", true, &[
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

// opts: the --model and --effort it runs with. tainted: it holds mail text and runs restricted (see taint)
struct Proc { child: Child, stdin: ChildStdin, opts: (String, String), tainted: bool }

struct App {
    procs: Mutex<HashMap<String, Proc>>,
    sids: Mutex<HashMap<String, String>>, // project -> session id, persisted
    path: String,                          // login-shell PATH, so Claude's tools find gh and node
    settings: Mutex<Value>,                // settings.json: vault, projects, overrides
    subs: Mutex<SubCache>,
    mail: mail::Mail,                      // one IMAP session per account, shared by the UI and the vaultmail tools
}

/// Subagent rows per agent file (reparsed only when mtime or size changes), and per parent session
/// the byte offset read so far plus the last task-notification time per agent id.
#[derive(Default)]
struct SubCache {
    files: HashMap<PathBuf, (std::time::SystemTime, u64, Value)>,
    notes: HashMap<String, (u64, HashMap<String, String>)>,
}

fn data_dir(app: &AppHandle) -> PathBuf {
    let d = app.path().app_data_dir().expect("app data dir");
    fs::create_dir_all(d.join("pending")).ok();
    d
}
fn pending_dir(app: &AppHandle) -> PathBuf { data_dir(app).join("pending") }

fn save_sids(app: &AppHandle, sids: &HashMap<String, String>) {
    fs::write(data_dir(app).join("sessions.json"), serde_json::to_string_pretty(sids).unwrap()).ok();
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
    child.stdin.take().unwrap().write_all(json!({"projects": projects, "tried": tried}).to_string().as_bytes()).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    serde_json::from_slice(&out.stdout).map_err(|e| format!("favicon: {}", String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or(&e.to_string())))
}

/// The configured vault: path, mapping, found per path, ok.
#[tauri::command]
fn vault_status(state: State<App>) -> Value { vault_of(&state.settings.lock().unwrap()) }

/// The mapping for a folder being set up: detected, with what settings.json already had for it.
#[tauri::command]
async fn detect_vault(state: State<'_, App>, path: String) -> Result<Value, String> {
    let stored = state.settings.lock().unwrap()["vaults"].clone();
    let (v, m) = vault::detect(&path);
    Ok(vault::status(&v, &vault::merge(&m, &stored[&v])))
}

/// Found / missing for a mapping being edited, without detection.
#[tauri::command]
fn check_vault(path: String, map: Value) -> Value { vault::status(&path, &vault::merge(&json!({}), &map)) }

/// Tools no app session may call: mail only ever becomes a draft (hard wall) and the mailbox is never touched, so
/// the whole Gmail connector goes, and in the app mail goes through vaultmail, never himalaya.
/// Enforced by the CLI at call time, before the app hears of it (scripts/pipe-check.py).
const DENIED: [&str; 2] = ["mcp__claude_ai_Gmail__*", "Bash(himalaya*)"];

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
        .filter_map(|r| r.as_str()).filter(|r| !r.starts_with("mcp__vaultmail")).map(String::from));
    deny.sort(); deny.dedup();
    [json!({"type": "control_request", "request_id": "taint-rules", "request": {"subtype": "apply_flag_settings", "settings": {"permissions": {"deny": deny}}}}),
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
}
/// The request that opens the pipe: which in-process MCP servers the app answers for.
fn pipe_init(mail_on: bool) -> Value {
    json!({"type": "control_request", "request_id": "init", "request": {"subtype": "initialize", "sdkMcpServers": if mail_on { json!(["vaultmail"]) } else { json!([]) }}})
}

fn spawn(app: &AppHandle, state: &App, project: &str, name: &str, fork: Option<&str>, opts: (String, String), from_mail: bool) -> Result<Proc, String> {
    let mut mcp = json!({"mcpServers": {"vaultperm": {
        "command": "/usr/bin/python3", "args": [format!("{REPO}/perm_server.py")],
        "env": {"PENDING": pending_dir(app).to_string_lossy(), "PROJECT": project}}}});
    // the mail tools only when mail is on and an account is set up, answered by the app over this pipe
    let mail_on = { let s = state.settings.lock().unwrap(); s["mail"]["on"] == true && !mail::accounts(&s["mail"]).is_empty() };
    if mail_on { mcp["mcpServers"]["vaultmail"] = json!({"type": "sdk", "name": "vaultmail"}); }
    let dir = need_vault(state)?;
    let mut cmd = Command::new(claude_bin());
    cmd.args(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
              "--permission-prompt-tool", "mcp__vaultperm__approve", "--mcp-config"])
        .arg(mcp.to_string()).arg("--disallowedTools").args(DENIED).args(["-n", name]);
    if !opts.0.is_empty() { cmd.args(["--model", &opts.0]); }
    if !opts.1.is_empty() { cmd.args(["--effort", &opts.1]); }
    if let Some(sid) = state.sids.lock().unwrap().get(project) { cmd.args(["--resume", sid]); }
    // continue a terminal conversation as a copy: full history, new session id, the terminal one untouched
    else if let Some(f) = fork.filter(|f| f.chars().all(|c| c.is_ascii_hexdigit() || c == '-')) { cmd.args(["--resume", f, "--fork-session"]); }
    cmd.current_dir(&dir).env("PATH", &state.path).env_remove("ANTHROPIC_API_KEY")
        .env("MCP_TOOL_TIMEOUT", "86400000") // a permission may wait a day for the user
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("claude start: {e}"))?;
    let mut stdin = child.stdin.take().unwrap();
    writeln!(stdin, "{}", pipe_init(mail_on)).and_then(|_| stdin.flush()).map_err(|e| format!("claude start: {e}"))?;
    let (stdout, stderr) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());

    let (a, p, pid) = (app.clone(), project.to_string(), child.id());
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(ev) = serde_json::from_str::<Value>(&line) else { continue };
            // the pipe's own traffic stays between the CLI and the app
            if ev["type"] == "control_request" { control(&a, &p, pid, &ev); continue; }
            if ev["type"] == "control_response" {
                if ev["response"]["subtype"] == "error" {
                    let rid = ev["response"]["request_id"].as_str().unwrap_or("");
                    // a session that holds mail text and could not be restricted does not go on
                    if rid.starts_with("taint") {
                        if let Some(x) = a.state::<App>().procs.lock().unwrap().get_mut(&p).filter(|x| x.child.id() == pid) { x.child.kill().ok(); }
                    }
                    a.emit("claude", json!({"project": p, "event": {"type": "stderr", "text": format!("vaultmail ({rid}): {}", ev["response"]["error"])}})).ok();
                }
                continue;
            }
            if ev["type"] == "system" && ev["subtype"] == "init" {
                if let Some(sid) = ev["session_id"].as_str() {
                    let st = a.state::<App>();
                    let mut sids = st.sids.lock().unwrap();
                    sids.insert(p.clone(), sid.to_string());
                    save_sids(&a, &sids);
                }
            }
            a.emit("claude", json!({"project": p, "event": ev})).ok();
        }
        // a process replaced for a model or effort switch exits quietly, its successor keeps the slot
        {
            let st = a.state::<App>();
            let mut procs = st.procs.lock().unwrap();
            if procs.get(&p).is_some_and(|x| x.child.id() != pid) { return; }
            procs.remove(&p);
        }
        a.emit("claude", json!({"project": p, "event": {"type": "exit"}})).ok();
    });
    let (a, p) = (app.clone(), project.to_string());
    std::thread::spawn(move || {
        let err: Vec<String> = BufReader::new(stderr).lines().map_while(Result::ok).collect();
        if !err.is_empty() { a.emit("claude", json!({"project": p, "event": {"type": "stderr", "text": err.join("\n")}})).ok(); }
    });
    let mut proc = Proc { child, stdin, opts, tainted: false };
    // a chat about a mail, or one that read mail before a restart, starts restricted
    if from_mail { write_taint(&mut proc, &dir); }
    Ok(proc)
}

/// A request from the CLI over the pipe. Only vaultmail's MCP messages are answered, a tool call runs off this
/// reader thread so the conversation keeps streaming while IMAP works.
fn control(app: &AppHandle, key: &str, pid: u32, ev: &Value) {
    let (rid, req) = (ev["request_id"].clone(), &ev["request"]);
    if req["subtype"] != "mcp_message" || req["server_name"] != "vaultmail" {
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
                let dl = PathBuf::from(home()).join("Downloads/Vault-mail");
                let res = if on { st.mail.tool(&accts, &default, &name, &args, &dl).await }
                    else { json!({"content": [{"type": "text", "text": "Mail is switched off in the app."}], "isError": true}) };
                if name == "save_draft" && res["isError"] != true {
                    // the chat shows who the draft is really for, whatever Claude writes about it
                    let d: Value = serde_json::from_str(res["content"][0]["text"].as_str().unwrap_or("")).unwrap_or_default();
                    app.emit("claude", json!({"project": key, "event": {"type": "draft_saved", "folder": d["folder"], "to": d["to"], "cc": d["cc"], "bcc": d["bcc"]}})).ok();
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
fn send(app: AppHandle, state: State<App>, project: String, text: String, images: Option<Vec<Value>>, name: Option<String>, fork: Option<String>,
        model: Option<String>, effort: Option<String>, mail: Option<bool>) -> Result<(), String> {
    // pasted images go as base64 image blocks before the text, the shape stream-json accepts
    let mut content: Vec<Value> = images.unwrap_or_default().into_iter()
        .filter(|i| ["image/png", "image/jpeg", "image/gif", "image/webp"].contains(&i["media_type"].as_str().unwrap_or("")) && i["data"].is_string())
        .map(|i| json!({"type": "image", "source": {"type": "base64", "media_type": i["media_type"], "data": i["data"]}})).collect();
    if content.is_empty() && text.trim().is_empty() { return Err(tr(ui_lang_of(&state.settings.lock().unwrap()), "err.empty")); }
    if !text.is_empty() { content.push(json!({"type": "text", "text": text})); }
    // empty = the CLI default from settings. Only aliases and model ids, never a stray flag
    let model = model.filter(|m| m.chars().all(|c| c.is_ascii_alphanumeric() || "-.[]".contains(c))).unwrap_or_default();
    let effort = effort.filter(|e| ["low", "medium", "high", "xhigh", "max"].contains(&e.as_str())).unwrap_or_default();
    let opts = (model, effort);
    let mut procs = state.procs.lock().unwrap();
    // model and effort are start flags: a switch restarts the process on the same session
    let mut was_tainted = false;
    if procs.get(&project).is_some_and(|p| p.opts != opts) { if let Some(mut p) = procs.remove(&project) { p.child.kill().ok(); was_tainted = p.tainted; } }
    if !procs.contains_key(&project) {
        let p = spawn(&app, &state, &project, name.as_deref().unwrap_or(&project), fork.as_deref(), opts, mail.unwrap_or(false) || was_tainted)?;
        procs.insert(project.clone(), p);
    }
    let msg = json!({"type": "user", "message": {"role": "user", "content": content}});
    let p = procs.get_mut(&project).unwrap();
    writeln!(p.stdin, "{msg}").and_then(|_| p.stdin.flush()).map_err(|e| e.to_string())
}

#[tauri::command]
fn stop(state: State<App>, project: String) {
    if let Some(mut p) = state.procs.lock().unwrap().remove(&project) { p.child.kill().ok(); }
}

/// A short title for a new conversation, the way the terminal gets its ai-title: one Haiku call on the
/// subscription, outside the vault, without settings, tools, MCP or a transcript. Async, so the ~5 s wait
/// never blocks the window.
#[tauri::command]
async fn ai_title(state: State<'_, App>, text: String) -> Result<String, String> {
    let text: String = text.chars().take(2000).collect();
    let out = Command::new(claude_bin())
        .args(["-p", "--model", "haiku", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config", "--tools", "",
               "--system-prompt", "Geef een korte titel (2 tot 5 woorden, in de taal van het bericht, geen aanhalingstekens, geen punt) voor een gesprek dat met dit bericht begint. Antwoord enkel met de titel."])
        .arg(text).current_dir(std::env::temp_dir()).env("PATH", &state.path).env_remove("ANTHROPIC_API_KEY")
        .stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
    let t = String::from_utf8_lossy(&out.stdout);
    let t: String = t.lines().next().unwrap_or("").trim().trim_matches(|c| c == '"' || c == '\'' || c == '.').chars().take(60).collect();
    if out.status.success() && !t.is_empty() { Ok(t) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}

/// Past messages of a project's conversation, read from the same transcript the terminal uses.
#[tauri::command]
fn history(state: State<App>, project: String) -> Vec<Value> {
    let Some(sid) = state.sids.lock().unwrap().get(&project).cloned() else { return vec![] };
    let Ok(raw) = fs::read_to_string(format!("{}/{sid}.jsonl", transcripts(&state))) else { return vec![] };
    raw.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|e| (e["type"] == "user" || e["type"] == "assistant") && e["isSidechain"] != true)
        .map(|e| json!({"type": e["type"], "message": e["message"]})).collect()
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

/// Every conversation key the app has a session for (projects and general chats).
#[tauri::command]
fn chats(state: State<App>) -> Vec<String> { state.sids.lock().unwrap().keys().cloned().collect() }

/// Session ids of the app's own conversations, so the sidebar does not list them twice.
#[tauri::command]
fn app_sids(state: State<App>) -> Vec<String> { state.sids.lock().unwrap().values().cloned().collect() }
/// Which session each app conversation resumes, so the page can follow a turn it gets no events from.
#[tauri::command]
fn app_sessions(state: State<App>) -> HashMap<String, String> { state.sids.lock().unwrap().clone() }

/// Read-only history of any session in the vault, e.g. one that is open in the terminal.
#[tauri::command]
fn history_sid(state: State<App>, sid: String, from: Option<u64>) -> Value {
    use std::io::{Read, Seek, SeekFrom};
    if !sid.chars().all(|c| c.is_ascii_hexdigit() || c == '-') { return json!({"items": [], "next": 0}); }
    // transcripts only grow at the end: read from the byte offset of the previous call, up to the last full line
    let Ok(mut f) = fs::File::open(format!("{}/{sid}.jsonl", transcripts(&state))) else { return json!({"items": [], "next": 0}) };
    let start = from.unwrap_or(0);
    if f.seek(SeekFrom::Start(start)).is_err() { return json!({"items": [], "next": start}); }
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok();
    let end = buf.iter().rposition(|&b| b == b'\n').map(|i| i + 1).unwrap_or(0);
    let items: Vec<Value> = String::from_utf8_lossy(&buf[..end]).lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|e| (e["type"] == "user" || e["type"] == "assistant") && e["isSidechain"] != true)
        .map(|e| json!({"type": e["type"], "message": e["message"], "at": e["timestamp"]})).collect();
    json!({"items": items, "next": start + end as u64})
}

/// Complete JSON lines from the last `n` bytes of a file, the first cut line dropped.
fn tail_lines(path: &std::path::Path, n: u64) -> (Vec<Value>, bool) {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = fs::File::open(path) else { return (vec![], true) };
    let start = f.metadata().map(|m| m.len()).unwrap_or(0).saturating_sub(n);
    f.seek(SeekFrom::Start(start)).ok();
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok();
    let s = String::from_utf8_lossy(&buf);
    let rows = s.lines().skip(if start > 0 { 1 } else { 0 }).filter_map(|l| serde_json::from_str(l).ok()).collect();
    (rows, start == 0)
}

/// One subagent from its transcript tail and meta file. `ended`: the last message is Claude's and
/// its turn stopped for a reason other than a tool call, so the agent handed back.
fn agent_row(path: &std::path::Path) -> Value {
    let id = path.file_stem().unwrap_or_default().to_string_lossy().trim_start_matches("agent-").to_string();
    let meta: Value = fs::read_to_string(path.with_extension("meta.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(json!({}));
    let mut first = String::new();
    fs::File::open(path).map(|f| BufReader::new(f).read_line(&mut first)).ok();
    let started = serde_json::from_str::<Value>(&first).ok().map(|e| e["timestamp"].clone()).unwrap_or(Value::Null);
    let mut row = json!({"id": id, "description": meta["description"], "agentType": meta["agentType"], "model": meta["model"],
        "started_at": started, "last_at": started, "ended": false});
    // widen the window until the last user or assistant line and the last visible step are in it
    for n in [64u64 << 10, 1 << 20, 8 << 20] {
        let (ev, whole) = tail_lines(path, n);
        let msgs: Vec<&Value> = ev.iter().filter(|e| e["type"] == "user" || e["type"] == "assistant").collect();
        if let Some(last) = msgs.last() {
            row["last_at"] = last["timestamp"].clone();
            let stop = last["message"]["stop_reason"].as_str();
            row["ended"] = json!(last["type"] == "assistant" && stop.is_some_and(|s| s != "tool_use"));
        }
        let step = msgs.iter().rev().filter(|e| e["type"] == "assistant")
            .flat_map(|e| e["message"]["content"].as_array().into_iter().flatten().rev())
            .find(|c| c["type"] == "tool_use" || (c["type"] == "text" && c["text"].as_str().is_some_and(|t| !t.trim().is_empty())));
        if let Some(c) = step {
            if c["type"] == "tool_use" {
                // only the small fields the tool line needs, never a file's content
                let input: serde_json::Map<String, Value> = ["file_path", "command", "pattern", "query", "url", "description", "skill", "subagent_type"].iter()
                    .filter_map(|k| c["input"][*k].as_str().map(|v| (k.to_string(), json!(v.chars().take(120).collect::<String>())))).collect();
                row["tool"] = c["name"].clone();
                row["input"] = Value::Object(input);
            } else { row["text"] = json!(c["text"].as_str().unwrap_or("").trim().chars().take(80).collect::<String>()); }
        }
        if (step.is_some() && !msgs.is_empty()) || whole { break; }
    }
    row
}

/// Last task-notification per agent id in a parent transcript, read incrementally from the saved offset.
fn notifications<'a>(dir: &str, sid: &str, notes: &'a mut HashMap<String, (u64, HashMap<String, String>)>) -> &'a HashMap<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    let e = notes.entry(sid.to_string()).or_default();
    if let Ok(mut f) = fs::File::open(format!("{dir}/{sid}.jsonl")) {
        if f.metadata().map(|m| m.len()).unwrap_or(0) < e.0 { *e = Default::default(); }
        let mut buf = Vec::new();
        if f.seek(SeekFrom::Start(e.0)).is_ok() && f.read_to_end(&mut buf).is_ok() {
            let end = buf.iter().rposition(|&b| b == b'\n').map(|i| i + 1).unwrap_or(0);
            for l in String::from_utf8_lossy(&buf[..end]).lines().filter(|l| l.contains("\"queue-operation\"") && l.contains("<task-id>")) {
                let Ok(v) = serde_json::from_str::<Value>(l) else { continue };
                let c = v["content"].as_str().unwrap_or("");
                if v["operation"] != "enqueue" || c.contains("<status>running</status>") { continue; }
                let Some(id) = c.split("<task-id>").nth(1).and_then(|x| x.split('<').next()) else { continue };
                let ts = v["timestamp"].as_str().unwrap_or("").to_string();
                let cur = e.1.entry(id.to_string()).or_default();
                if ts > *cur { *cur = ts; }
            }
            e.0 += end as u64;
        }
    }
    &e.1
}

/// The subagents of one session. Running unless the agent handed back, the parent got a notification
/// (completed, failed, killed) after its last line, or its file has been silent for 15 minutes.
fn subagents_of(dir: &str, sid: &str, cache: &mut SubCache) -> Vec<Value> {
    let Ok(rd) = fs::read_dir(format!("{dir}/{sid}/subagents")) else { return vec![] };
    let notes = notifications(dir, sid, &mut cache.notes).clone();
    let now = std::time::SystemTime::now();
    let mut rows: Vec<Value> = rd.flatten().map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "jsonl") && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("agent-")))
        .filter_map(|p| {
            let m = p.metadata().ok()?;
            let (mt, len) = (m.modified().ok()?, m.len());
            let mut row = match cache.files.get(&p) {
                Some((a, b, r)) if *a == mt && *b == len => r.clone(),
                _ => { let r = agent_row(&p); cache.files.insert(p.clone(), (mt, len, r.clone())); r }
            };
            let last = row["last_at"].as_str().unwrap_or("").to_string();
            let noted = row["id"].as_str().and_then(|id| notes.get(id)).is_some_and(|t| *t >= last);
            let stale = now.duration_since(mt).map_or(false, |d| d.as_secs() > 900);
            row["running"] = json!(!(row["ended"] == true || noted || stale));
            Some(row)
        }).collect();
    rows.sort_by(|a, b| a["started_at"].as_str().cmp(&b["started_at"].as_str()));
    rows
}

/// The session id behind a conversation key: `t:<sid>` for a terminal session, else the app's own.
fn sid_of(state: &App, key: &str) -> Option<String> {
    key.strip_prefix("t:").map(String::from).or_else(|| state.sids.lock().unwrap().get(key).cloned())
        .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-'))
}

/// Subagents per conversation key, only for keys that ever spawned one.
#[tauri::command]
fn subagents(state: State<App>, keys: Vec<String>) -> Value {
    let dir = transcripts(&state);
    let mut out = serde_json::Map::new();
    for k in keys {
        let Some(sid) = sid_of(&state, &k) else { continue };
        let list = subagents_of(&dir, &sid, &mut state.subs.lock().unwrap());
        if !list.is_empty() { out.insert(k, json!(list)); }
    }
    Value::Object(out)
}

/// The last few things a subagent wrote, read-only, from the tail of its transcript.
#[tauri::command]
fn agent_log(state: State<App>, key: String, id: String) -> Vec<String> {
    let Some(sid) = sid_of(&state, &key) else { return vec![] };
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { return vec![]; }
    let (ev, _) = tail_lines(&PathBuf::from(format!("{}/{sid}/subagents/agent-{id}.jsonl", transcripts(&state))), 512 << 10);
    let texts: Vec<String> = ev.iter().filter(|e| e["type"] == "assistant")
        .flat_map(|e| e["message"]["content"].as_array().cloned().unwrap_or_default())
        .filter_map(|c| c["text"].as_str().map(|t| t.trim().chars().take(2000).collect::<String>())).filter(|t| !t.is_empty()).collect();
    texts[texts.len().saturating_sub(3)..].to_vec()
}

#[tauri::command]
fn running(state: State<App>) -> Vec<String> { state.procs.lock().unwrap().keys().cloned().collect() }

#[tauri::command]
fn pending(app: AppHandle) -> Vec<Value> {
    let mut out: Vec<Value> = fs::read_dir(pending_dir(&app)).into_iter().flatten().flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json") && !p.to_string_lossy().ends_with(".answer.json"))
        .filter(|p| !PathBuf::from(p.to_string_lossy().replace(".json", ".answer.json")).exists())
        .filter_map(|p| fs::read_to_string(p).ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect();
    out.sort_by(|a: &Value, b: &Value| a["at"].as_f64().partial_cmp(&b["at"].as_f64()).unwrap());
    out
}

#[tauri::command]
fn answer(app: AppHandle, id: String, decision: Value) -> Result<(), String> {
    if !id.chars().all(|c| c.is_ascii_hexdigit()) { return Err("bad id".into()); }
    fs::write(pending_dir(&app).join(format!("{id}.answer.json")), decision.to_string()).map_err(|e| e.to_string())
}

/// Sessions Claude Code knows about, including the ones in the terminal and in the background.
#[tauri::command]
fn agents(state: State<App>) -> Value {
    let mut list: Value = Command::new(claude_bin()).args(["agents", "--json"]).env("PATH", &state.path).stdin(Stdio::null())
        .output().ok().and_then(|o| serde_json::from_slice(&o.stdout).ok()).unwrap_or(json!([]));
    let dir = transcripts(&state);
    for a in list.as_array_mut().into_iter().flatten() {
        let sid = a["sessionId"].as_str().unwrap_or("").to_string();
        if a["status"] == "busy" && !sid.is_empty() && turn_ended(&PathBuf::from(format!("{dir}/{sid}.jsonl"))) { a["status"] = json!("idle"); }
    }
    list
}

/// `claude agents` keeps a session busy while a background shell of it still runs, also after the turn
/// ended. The transcript closes every turn with a `turn_duration` line: when that comes after the last
/// prompt (typed, or a notification that starts a new turn), Claude is done.
fn turn_ended(path: &std::path::Path) -> bool {
    let (rows, _) = tail_lines(path, 256 << 10);
    for v in rows.iter().rev() {
        if v["type"] == "system" && v["subtype"] == "turn_duration" { return true; }
        if v["type"] != "user" || v["isSidechain"] == true || v["isMeta"] == true { continue; }
        let c = &v["message"]["content"];
        let prompt = c.is_string() || c.as_array().is_some_and(|b| b.iter().all(|x| x["type"] != "tool_result"));
        if prompt { return false; }
    }
    false
}

/// Continue a project's conversation in iTerm. The app's own process for it stops first, so two
/// processes never write the same session.
#[tauri::command]
fn open_terminal(state: State<App>, project: String, session: Option<String>, name: Option<String>) -> Result<(), String> {
    if let Some(mut p) = state.procs.lock().unwrap().remove(&project) { p.child.kill().ok(); }
    let v = need_vault(&state)?;
    let sid = session.or_else(|| state.sids.lock().unwrap().get(&project).cloned());
    let q = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
    let cmd = match sid {
        Some(s) if s.chars().all(|c| c.is_ascii_hexdigit() || c == '-') => format!("cd {} && claude --resume {s}", q(&v)),
        _ => format!("cd {} && claude -n {}", q(&v), q(name.as_deref().unwrap_or(&project))),
    };
    let script = format!(
        "tell application \"iTerm\"\n activate\n set w to (create window with default profile)\n tell current session of w to write text {}\nend tell",
        serde_json::to_string(&cmd).unwrap());
    Command::new("/usr/bin/osascript").args(["-e", &script]).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Background sessions of Claude Code itself (not started by the app): step into one in iTerm, or
/// stop it. `stop` keeps the conversation, `claude attach <id>` resumes it later. No `rm`, that deletes.
#[tauri::command]
fn bg(state: State<App>, action: String, id: String) -> Result<(), String> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { return Err("bad id".into()); }
    match action.as_str() {
        "stop" => {
            let out = Command::new(claude_bin()).args(["stop", &id]).env("PATH", &state.path).stdin(Stdio::null())
                .output().map_err(|e| e.to_string())?;
            if out.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
        }
        "attach" => {
            let script = format!(
                "tell application \"iTerm\"\n activate\n set w to (create window with default profile)\n tell current session of w to write text {}\nend tell",
                serde_json::to_string(&format!("claude attach {id}")).unwrap());
            Command::new("/usr/bin/osascript").args(["-e", &script]).spawn().map(|_| ()).map_err(|e| e.to_string())
        }
        _ => Err("unknown action".into()),
    }
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
    let map = vault_map(&s, &v);
    if vault::status(&v, &map)["ok"] != true { return Err(tr_v(lang, "err.no_vault", &v)); }
    s["vaults"][&v] = map;
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
    if let Err(e) = providers::check(&s) { set_cur_lang(was); return Err(e); }
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
/// repo -> vault project, from the vault's repos.json. An entry is a checkout or a folder of checkouts,
/// a checkout listed by itself wins over the same one found inside a listed folder.
fn repo_projects(vault: &str) -> HashMap<String, String> {
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

/// Settings › Mail the guided way: the app password goes straight into the keychain (service vault-mail, account
/// the email, over stdin so it never shows in the process list), then a login test. A code Gmail refuses is
/// removed again. Returns the account for the settings, the window adds and saves it.
#[tauri::command]
async fn mail_connect(state: State<'_, App>, email: String, password: String) -> Result<Value, String> {
    let email = email.trim().to_string();
    let account = json!({"email": email, "keychain_service": "vault-mail", "keychain_account": email});
    let a = mail::accounts(&json!({"accounts": [account.clone()]})).pop().ok_or_else(|| trc("err.mail_account"))?;
    let pw: String = password.chars().filter(|c| !c.is_whitespace()).collect(); // Google shows it in groups of four
    if !(8..=64).contains(&pw.len()) || !pw.chars().all(|c| c.is_ascii_alphanumeric()) { return Err(trc("err.mail_pw")); }
    let mut ch = Command::new("/usr/bin/security").arg("-i").stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
    writeln!(ch.stdin.take().unwrap(), "add-generic-password -U -s vault-mail -a {email} -w {pw}").map_err(|e| e.to_string())?;
    ch.wait().map_err(|e| e.to_string())?;
    match state.mail.test(&a).await {
        Ok(n) => Ok(json!({"account": account, "result": n})),
        Err(e) => {
            if e.starts_with("Login failed") { Command::new("/usr/bin/security").args(["delete-generic-password", "-s", "vault-mail", "-a", &email]).output().ok(); }
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
        .title(title).inner_size(680.0, 520.0).min_inner_size(600.0, 420.0)
        .minimizable(false).maximizable(false).build().ok();
}
/// The settings row at the bottom of the sidebar: the same window as Vault › Settings….
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
            let sids = fs::read_to_string(data_dir(app.handle()).join("sessions.json")).ok()
                .and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
            let settings = norm(fs::read_to_string(data_dir(app.handle()).join("settings.json")).ok()
                .and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default());
            set_cur_lang(ui_lang_of(&settings));
            app.set_menu(build_menu(app.handle(), ui_lang_of(&settings))?)?;
            app.manage(App { procs: Mutex::new(HashMap::new()), sids: Mutex::new(sids), path: login_path(), settings: Mutex::new(settings), subs: Default::default(), mail: mail::Mail::new() });
            tray::init(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![snapshot, favicons, open_settings_window, usage::usage_tokens, usage::usage_limits, send, ai_title, stop, reset, move_chat, chats, bg, app_sids, history_sid, history, running, subagents, agent_log, pending, answer, agents, app_sessions, open_terminal, get_settings, set_settings, pick_folder, pick_path, vault_status, detect_vault, check_vault, reminder, reminder_add, ui_lang, ui_locale, integration_status, integration_has_token, integration_token, integration_call, productive_import, github_status, github_prs, github_pr, mail_list, mail_read, mail_seen, mail_test, mail_connect])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        // a click on the Dock icon brings the hidden main window back
        .run(|app, e| if let tauri::RunEvent::Reopen { .. } = e { tray::show_main(app); });
}

#[cfg(test)]
mod tests {
    // runs against the transcripts of the vault in $VAULT, skipped without it
    #[test]
    fn subagents_of_example_session() {
        let Ok(v) = std::env::var("VAULT") else { return };
        let slug: String = v.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
        let dir = format!("{}/.claude/projects/{slug}", super::home());
        let sid = "36099ce4-d17c-482a-8907-23790cc0e8db";
        if !std::path::Path::new(&format!("{dir}/{sid}/subagents")).is_dir() { return; }
        let mut c = super::SubCache::default();
        let t = std::time::Instant::now();
        let rows = super::subagents_of(&dir, sid, &mut c);
        let first = t.elapsed();
        let t = std::time::Instant::now();
        super::subagents_of(&dir, sid, &mut c);
        for r in &rows { println!("{} {:5} {} {} | {}", r["id"], r["running"], r["started_at"], r["last_at"], r["description"]); }
        println!("{} agents, first {:?}, cached {:?}", rows.len(), first, t.elapsed());
        let get = |id: &str| rows.iter().find(|r| r["id"] == id).unwrap();
        assert_eq!(get("a13a6342c4ed7b3e7")["running"], false); // ended with end_turn
        assert_eq!(get("a896673643d285b30")["running"], false); // no end_turn, finished per the parent's notification
        assert!(rows.iter().all(|r| r["description"].is_string() && r["started_at"].is_string()));
    }
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
mod turn_tests {
    #[test]
    fn turn_ended_follows_the_last_marker() {
        let d = std::env::temp_dir().join("vault-turn-test.jsonl");
        let prompt = r#"{"type":"user","message":{"content":"doe iets"}}"#;
        let tool = r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}"#;
        let done = r#"{"type":"system","subtype":"turn_duration"}"#;
        std::fs::write(&d, format!("{prompt}\n{tool}\n{done}\n")).unwrap();
        assert!(super::turn_ended(&d));
        std::fs::write(&d, format!("{done}\n{prompt}\n{tool}\n")).unwrap();
        assert!(!super::turn_ended(&d));
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
        let user = serde_json::json!({"permissions": {"allow": ["Bash(git push *)", "Bash(pandoc *)", "mcp__vaultmail__read", "mcp__pencil"]}});
        let [rules, mode] = super::taint(&[user.clone(), serde_json::json!({"hooks": {}})], true);
        let deny: Vec<&str> = rules["request"]["settings"]["permissions"]["deny"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        for t in ["Bash(git push *)", "Bash(pandoc *)", "mcp__pencil", "Bash(git push*)", "Bash(gh api*)", "mcp__claude_ai_Google_Calendar__create_event",
                  "mcp__claude_ai_Gmail__*", "Bash(himalaya*)", "RemoteTrigger", "SendMessage", "Skill(skill:initcraftcms)"] { assert!(deny.contains(&t), "{t}"); }
        assert!(!deny.contains(&"Bash"), "Bash stays when every settings file parsed");
        let [unread, _] = super::taint(&[user], false);
        assert!(unread["request"]["settings"]["permissions"]["deny"].as_array().unwrap().contains(&serde_json::json!("Bash")), "an unreadable settings file costs Bash");
        assert!(!deny.iter().any(|d| d.starts_with("mcp__vaultmail")), "the mail tools themselves stay");
        assert_eq!((rules["request"]["subtype"].as_str(), mode["request"]["subtype"].as_str(), mode["request"]["mode"].as_str()),
                   (Some("apply_flag_settings"), Some("set_permission_mode"), Some("default")));
        assert_eq!(super::pipe_init(true)["request"]["sdkMcpServers"], serde_json::json!(["vaultmail"]));
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
