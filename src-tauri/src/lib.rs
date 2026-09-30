// Vault: a shell around the real Claude Code CLI. Every conversation is a `claude -p` process in
// stream-json mode, in the vault, on the user's subscription (no API key). Permission requests and
// Claude's questions come in through perm_server.py as files in the pending folder.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

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
    for k in ["projects", "overrides", "vaults", "productive", "github"] { if !v[k].is_object() { v[k] = json!({}); } }
    for k in ["org", "user"] { if !v["productive"][k].is_string() { v["productive"][k] = json!(""); } }
    if !v["github"]["on"].is_boolean() { v["github"]["on"] = json!(false); }
    if !v["github"]["owners"].is_string() { v["github"]["owners"] = json!(""); }
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
    ("err.no_script", ["No reminder script set for this vault (Settings > Vault)", "Geen herinneringsscript ingesteld voor deze vault (Instellingen > Vault)",
        "Aucun script de rappels défini pour ce coffre (Réglages > Vault)", "Kein Erinnerungsskript für diesen Vault festgelegt (Einstellungen > Vault)"]),
    ("err.no_vault_set", ["No vault chosen yet", "Nog geen vault gekozen", "Aucun coffre choisi", "Noch kein Vault gewählt"]),
    ("err.project", ["Invalid project '{v}': icon (max 4 characters), label (max 60) and img (png data url) must be text",
        "Ongeldig project '{v}': icon (max 4 tekens), label (max 60) en img (png data url) moeten tekst zijn",
        "Projet '{v}' invalide : l'icône (4 caractères max.), le nom (60 max.) et img (data url png) doivent être du texte",
        "Ungültiges Projekt '{v}': Symbol (max. 4 Zeichen), Name (max. 60) und img (PNG-Data-URL) müssen Text sein"]),
    ("err.override", ["Invalid override '{v}'", "Ongeldige override '{v}'", "Remplacement '{v}' invalide", "Ungültige Zuordnung '{v}'"]),
    ("err.empty", ["empty message", "leeg bericht", "message vide", "leere Nachricht"]),
    ("err.pv_digits", ["Productive: {v} may only contain digits", "Productive: {v} bestaat enkel uit cijfers", "Productive : {v} ne peut contenir que des chiffres", "Productive: {v} darf nur Ziffern enthalten"]),
    ("pv.org_id", ["organisation ID", "organisatie-id", "l'ID d'organisation", "die Organisations-ID"]),
    ("pv.user_id", ["user ID", "gebruikers-id", "l'ID utilisateur", "die Benutzer-ID"]),
    ("err.gh_owners", ["GitHub: at most 10 owners, only letters, digits and -", "GitHub: hoogstens 10 owners, enkel letters, cijfers en -", "GitHub : 10 propriétaires au plus, uniquement lettres, chiffres et -", "GitHub: höchstens 10 Owner, nur Buchstaben, Ziffern und -"]),
    ("err.token_chars", ["The token may only contain letters, digits, - and _", "Het token mag enkel letters, cijfers, - en _ bevatten", "Le jeton ne peut contenir que des lettres, des chiffres, - et _", "Das Token darf nur Buchstaben, Ziffern, - und _ enthalten"]),
    ("err.keychain", ["Could not save the token in the keychain", "Kon het token niet in de sleutelhanger bewaren", "Impossible d'enregistrer le jeton dans le trousseau", "Das Token konnte nicht im Schlüsselbund gespeichert werden"]),
    ("err.claude_json", ["~/.claude.json not found or unreadable", "~/.claude.json niet gevonden of onleesbaar", "~/.claude.json introuvable ou illisible", "~/.claude.json nicht gefunden oder nicht lesbar"]),
    ("err.no_pv_token_json", ["No Productive token in ~/.claude.json", "Geen Productive-token in ~/.claude.json", "Aucun jeton Productive dans ~/.claude.json", "Kein Productive-Token in ~/.claude.json"]),
    ("err.pv_call", ["This Productive call is not allowed", "Deze Productive-oproep is niet toegelaten", "Cet appel Productive n'est pas autorisé", "Dieser Productive-Aufruf ist nicht erlaubt"]),
    ("err.no_org", ["No organisation ID. Fill it in under Vault › Settings… › Integrations.", "Geen organisatie-id. Vul het in bij Vault › Instellingen… › Integraties.", "Aucun ID d'organisation. Renseignez-le dans Vault › Réglages… › Intégrations.", "Keine Organisations-ID. Trag sie unter Vault › Einstellungen… › Integrationen ein."]),
    ("err.no_pv_token", ["No Productive token. Fill it in under Vault › Settings… › Integrations.", "Geen Productive-token. Vul het in bij Vault › Instellingen… › Integraties.", "Aucun jeton Productive. Renseignez-le dans Vault › Réglages… › Intégrations.", "Kein Productive-Token. Trag es unter Vault › Einstellungen… › Integrationen ein."]),
    ("err.pv_down", ["Productive unreachable: {v}", "Productive niet bereikbaar: {v}", "Productive injoignable : {v}", "Productive nicht erreichbar: {v}"]),
    ("err.unknown", ["unknown error", "onbekende fout", "erreur inconnue", "unbekannter Fehler"]),
    ("err.no_gh", ["gh not found. Install it with `brew install gh`.", "gh niet gevonden. Installeer het met `brew install gh`.", "gh introuvable. Installez-le avec `brew install gh`.", "gh nicht gefunden. Installiere es mit `brew install gh`."]),
    ("err.gh_login", ["Not signed in to gh. Run `gh auth login` in the terminal.", "Niet ingelogd bij gh. Voer `gh auth login` uit in de terminal.", "Pas connecté à gh. Lancez `gh auth login` dans le terminal.", "Nicht bei gh angemeldet. Führe `gh auth login` im Terminal aus."]),
    ("err.bad_repo", ["Invalid repo", "Ongeldige repo", "Dépôt invalide", "Ungültiges Repo"]),
    ("err.no_pr", ["PR not found", "PR niet gevonden", "PR introuvable", "PR nicht gefunden"]),
];
fn tr(lang: &str, key: &str) -> String {
    let i = LANGS.iter().position(|l| *l == lang).unwrap_or(0);
    TEXT.iter().find(|(k, _)| *k == key).map_or(key, |(_, row)| row[i]).to_string()
}
fn tr_v(lang: &str, key: &str, v: &str) -> String { tr(lang, key).replace("{v}", v) }
// the UI language for code without the settings at hand (Productive and gh errors), kept in step by setup and set_settings
static CUR_LANG: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
fn set_cur_lang(lang: &str) { CUR_LANG.store(LANGS.iter().position(|l| *l == lang).unwrap_or(0), std::sync::atomic::Ordering::Relaxed); }
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

struct Proc { child: Child, stdin: ChildStdin, opts: (String, String) } // opts: the --model and --effort it runs with

struct App {
    procs: Mutex<HashMap<String, Proc>>,
    sids: Mutex<HashMap<String, String>>, // project -> session id, persisted
    path: String,                          // login-shell PATH, so Claude's tools find gh, himalaya, node
    settings: Mutex<Value>,                // settings.json: vault, projects, overrides
    subs: Mutex<SubCache>,
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
fn snapshot(state: State<App>) -> Result<Value, String> {
    let (st, lang) = { let s = state.settings.lock().unwrap(); (vault_of(&s), ui_lang_of(&s)) };
    let v = st["vault"].as_str().unwrap();
    if v.is_empty() { return Err(tr(lang, "err.no_vault_set")); }
    if st["ok"] != true { return Err(tr_v(lang, "err.no_vault", v)); }
    let path = |k: &str| if st["found"][k] == true { vault::resolve(v, st["map"][k].as_str().unwrap()).to_string_lossy().into_owned() } else { String::new() };
    let out = Command::new("/usr/bin/python3").arg(format!("{REPO}/snapshot.py"))
        .env("PATH", &state.path).env("VAULT", v).env("VAULT_WORK_STATE", path("workState"))
        .env("VAULT_REMINDERS", path("reminders")).env("VAULT_NOTES", path("notes"))
        .output().map_err(|e| e.to_string())?;
    let mut snap: Value = serde_json::from_slice(&out.stdout).map_err(|e| {
        // a crash leaves stdout empty: its last stderr line says more than "EOF while parsing"
        let err = String::from_utf8_lossy(&out.stderr);
        format!("snapshot: {}", err.lines().rev().find(|l| !l.trim().is_empty()).map_or(e.to_string(), str::to_string))
    })?;
    snap["vault"] = st;
    Ok(snap)
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

fn spawn(app: &AppHandle, state: &App, project: &str, name: &str, fork: Option<&str>, opts: (String, String)) -> Result<Proc, String> {
    let mcp = json!({"mcpServers": {"vaultperm": {
        "command": "/usr/bin/python3", "args": [format!("{REPO}/perm_server.py")],
        "env": {"PENDING": pending_dir(app).to_string_lossy(), "PROJECT": project}}}});
    let dir = need_vault(state)?;
    let mut cmd = Command::new(claude_bin());
    cmd.args(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
              "--permission-prompt-tool", "mcp__vaultperm__approve", "--mcp-config"])
        .arg(mcp.to_string()).args(["-n", name]);
    if !opts.0.is_empty() { cmd.args(["--model", &opts.0]); }
    if !opts.1.is_empty() { cmd.args(["--effort", &opts.1]); }
    if let Some(sid) = state.sids.lock().unwrap().get(project) { cmd.args(["--resume", sid]); }
    // continue a terminal conversation as a copy: full history, new session id, the terminal one untouched
    else if let Some(f) = fork.filter(|f| f.chars().all(|c| c.is_ascii_hexdigit() || c == '-')) { cmd.args(["--resume", f, "--fork-session"]); }
    cmd.current_dir(dir).env("PATH", &state.path).env_remove("ANTHROPIC_API_KEY")
        .env("MCP_TOOL_TIMEOUT", "86400000") // a permission may wait a day for the user
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("claude start: {e}"))?;
    let stdin = child.stdin.take().unwrap();
    let (stdout, stderr) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());

    let (a, p, pid) = (app.clone(), project.to_string(), child.id());
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(ev) = serde_json::from_str::<Value>(&line) else { continue };
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
    Ok(Proc { child, stdin, opts })
}

#[tauri::command]
fn send(app: AppHandle, state: State<App>, project: String, text: String, images: Option<Vec<Value>>, name: Option<String>, fork: Option<String>,
        model: Option<String>, effort: Option<String>) -> Result<(), String> {
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
    if procs.get(&project).is_some_and(|p| p.opts != opts) { if let Some(mut p) = procs.remove(&project) { p.child.kill().ok(); } }
    if !procs.contains_key(&project) {
        let p = spawn(&app, &state, &project, name.as_deref().unwrap_or(&project), fork.as_deref(), opts)?;
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
        .map(|e| json!({"type": e["type"], "message": e["message"]})).collect();
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
    for k in ["org", "user"] {
        if !s["productive"][k].as_str().unwrap().chars().all(|c| c.is_ascii_digit()) {
            return Err(tr_v(lang, "err.pv_digits", &tr(lang, if k == "org" { "pv.org_id" } else { "pv.user_id" })));
        }
    }
    let owners: Vec<&str> = s["github"]["owners"].as_str().unwrap().split([' ', ',']).filter(|o| !o.is_empty()).collect();
    if owners.len() > 10 || !owners.iter().all(|o| o.len() <= 39 && o.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')) {
        return Err(tr(lang, "err.gh_owners"));
    }
    fs::write(data_dir(&app).join("settings.json"), serde_json::to_string_pretty(&s).unwrap()).map_err(|e| e.to_string())?;
    app.emit("settings-changed", &s).ok(); // the main window follows a change made in the settings window
    let relang = ui_lang_of(&state.settings.lock().unwrap()) != lang;
    *state.settings.lock().unwrap() = s.clone();
    set_cur_lang(lang);
    if relang { // the menu bar and the settings window title follow a new language right away
        if let Ok(m) = build_menu(&app, lang) { app.set_menu(m).ok(); }
        if let Some(w) = app.get_webview_window("settings") { w.set_title(&tr(lang, "settings.title")).ok(); }
    }
    Ok(s)
}

// ---------- Productive: the token lives in the macOS keychain, org and user id in settings.json.
// The token goes to `security` and curl over stdin, never as an argument (visible in the process list),
// and it never goes back to a webview.
const KC: &str = "-s vault-app.productive -a token";
fn pv_token() -> Option<String> {
    let o = Command::new("/usr/bin/security").arg("find-generic-password").args(KC.split(' ')).arg("-w").output().ok()?;
    let t = String::from_utf8_lossy(&o.stdout).trim().to_string();
    (o.status.success() && !t.is_empty()).then_some(t)
}
/// Save the token, or remove it when empty.
fn pv_set_token(t: &str) -> Result<(), String> {
    if t.is_empty() {
        Command::new("/usr/bin/security").arg("delete-generic-password").args(KC.split(' ')).output().map_err(|e| e.to_string())?;
        return Ok(());
    }
    if t.len() > 200 || !t.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(trc("err.token_chars"));
    }
    let mut ch = Command::new("/usr/bin/security").arg("-i").stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
    writeln!(ch.stdin.take().unwrap(), "add-generic-password -U {KC} -w {t}").map_err(|e| e.to_string())?;
    ch.wait().map_err(|e| e.to_string())?;
    // `security -i` exits 0 even when the command inside failed, so read it back
    if pv_token().as_deref() == Some(t) { Ok(()) } else { Err(trc("err.keychain")) }
}
/// A value inside double quotes in a curl config file.
fn curl_quote(s: &str) -> String { format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"")) }

/// Whether a Productive token is in the keychain.
#[tauri::command]
fn productive_status() -> bool { pv_token().is_some() }

/// Save the Productive token, or remove it with "". The main window follows, it shows the board only with a token.
#[tauri::command]
fn productive_token(app: AppHandle, state: State<App>, token: String) -> Result<(), String> {
    pv_set_token(token.trim())?;
    app.emit("settings-changed", state.settings.lock().unwrap().clone()).ok();
    Ok(())
}

/// Take the token, org and user from Claude Code's own Productive MCP config. The token goes to the
/// keychain, org and user come back for the settings window to save.
#[tauri::command]
fn productive_import() -> Result<Value, String> {
    let cfg: Value = fs::read_to_string(format!("{}/.claude.json", home())).ok()
        .and_then(|s| serde_json::from_str(&s).ok()).ok_or_else(|| trc("err.claude_json"))?;
    let env = &cfg["mcpServers"]["productive"]["env"];
    pv_set_token(env["PRODUCTIVE_API_TOKEN"].as_str().ok_or_else(|| trc("err.no_pv_token_json"))?)?;
    Ok(json!({ "org": env["PRODUCTIVE_ORG_ID"].as_str().unwrap_or(""), "user": env["PRODUCTIVE_USER_ID"].as_str().unwrap_or("") }))
}

/// One Productive API call: GET on any path, PATCH only on a single task (a card moved to another
/// column). Async, so the network wait stays off the main thread.
#[tauri::command]
async fn productive(state: State<'_, App>, method: String, path: String, body: Option<Value>) -> Result<Value, String> {
    let path_ok = path.starts_with('/') && path.len() < 600 && !path.contains("..") && path.chars().all(|c| c.is_ascii_alphanumeric() || "/?&=[]_-.,%".contains(c));
    let one_task = path.strip_prefix("/tasks/").is_some_and(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()));
    if !path_ok || !(method == "GET" || (method == "PATCH" && one_task && body.is_some())) { return Err(trc("err.pv_call")); }
    let org = state.settings.lock().unwrap()["productive"]["org"].as_str().unwrap_or("").to_string();
    if org.is_empty() { return Err(trc("err.no_org")); }
    let token = pv_token().ok_or_else(|| trc("err.no_pv_token"))?;
    // globoff: the [ ] in filter[...] are not curl ranges
    let mut cfg = format!("globoff\nurl = {}\nrequest = {method}\nheader = {}\nheader = {}\nheader = \"Content-Type: application/vnd.api+json\"\n",
        curl_quote(&format!("https://api.productive.io/api/v2{path}")), curl_quote(&format!("X-Auth-Token: {token}")), curl_quote(&format!("X-Organization-Id: {org}")));
    if let Some(b) = body { cfg += &format!("data-binary = {}\n", curl_quote(&b.to_string())); }
    let mut ch = Command::new("/usr/bin/curl").args(["-sS", "--max-time", "20", "-K", "-", "-w", "\n%{http_code}"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    ch.stdin.take().unwrap().write_all(cfg.as_bytes()).map_err(|e| e.to_string())?;
    let o = ch.wait_with_output().map_err(|e| e.to_string())?;
    if !o.status.success() { return Err(trc_v("err.pv_down", String::from_utf8_lossy(&o.stderr).trim())); }
    let out = String::from_utf8_lossy(&o.stdout);
    let (text, code) = out.rsplit_once('\n').unwrap_or(("", &out));
    let v: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    if code.starts_with('2') { return Ok(v); }
    let e = &v["errors"][0];
    Err(format!("Productive {code}: {}", e["detail"].as_str().or(e["title"].as_str()).map_or_else(|| trc("err.unknown"), str::to_string)))
}

// ---------- GitHub: pull requests through the gh CLI and its own login, so no token in the app.
// Read-only. The search queries are built here from the settings, the webview only asks for the list.

/// gh from the login-shell PATH: an app started from the Finder does not have /opt/homebrew/bin.
fn gh(state: &App, args: &[&str]) -> Result<String, String> {
    let bin = state.path.split(':').map(|d| format!("{d}/gh")).find(|p| PathBuf::from(p).is_file())
        .ok_or_else(|| trc("err.no_gh"))?;
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

/// Mark a reminder done, push it to a new date, or drop it, via the vault's own reminder script.
#[tauri::command]
fn reminder(state: State<App>, action: String, id: String, date: Option<String>) -> Result<String, String> {
    if !["done", "push", "drop"].contains(&action.as_str()) { return Err("unknown action".into()); }
    if id.len() != 8 || !id.chars().all(|c| c.is_ascii_hexdigit()) { return Err("bad id".into()); }
    let (st, lang) = { let s = state.settings.lock().unwrap(); (vault_of(&s), ui_lang_of(&s)) };
    if st["found"]["reminderScript"] != true { return Err(tr(lang, "err.no_script")); }
    let v = st["vault"].as_str().unwrap().to_string();
    let mut cmd = Command::new("/usr/bin/python3");
    cmd.arg(vault::resolve(&v, st["map"]["reminderScript"].as_str().unwrap())).args([&action, &id]);
    if action == "push" {
        let d = date.filter(|d| !d.is_empty() && d.len() <= 12 && d.chars().all(|c| c.is_ascii_alphanumeric() || "+/-".contains(c)))
            .ok_or("date required (max 12 chars of [0-9A-Za-z+/-])")?;
        cmd.arg(d);
    }
    let out = cmd.current_dir(&v).env("PATH", &state.path).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
    if out.status.success() { Ok(String::from_utf8_lossy(&out.stdout).trim().to_string()) }
    else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}

fn open_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") { w.set_focus().ok(); return; }
    let title = tr(ui_lang_of(&app.state::<App>().settings.lock().unwrap()), "settings.title");
    tauri::WebviewWindowBuilder::new(app, "settings", tauri::WebviewUrl::App("settings.html".into()))
        .title(title).inner_size(680.0, 520.0).min_inner_size(600.0, 420.0)
        .minimizable(false).maximizable(false).build().ok();
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
            if event.id() != "settings" { app.emit("menu", event.id().as_ref()).ok(); return; }
            open_settings(app);
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let sids = fs::read_to_string(data_dir(app.handle()).join("sessions.json")).ok()
                .and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
            let settings = norm(fs::read_to_string(data_dir(app.handle()).join("settings.json")).ok()
                .and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default());
            set_cur_lang(ui_lang_of(&settings));
            app.set_menu(build_menu(app.handle(), ui_lang_of(&settings))?)?;
            app.manage(App { procs: Mutex::new(HashMap::new()), sids: Mutex::new(sids), path: login_path(), settings: Mutex::new(settings), subs: Default::default() });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![snapshot, send, ai_title, stop, reset, move_chat, chats, bg, app_sids, history_sid, history, running, subagents, agent_log, pending, answer, agents, open_terminal, get_settings, set_settings, pick_folder, pick_path, vault_status, detect_vault, check_vault, reminder, ui_lang, ui_locale, productive_status, productive_token, productive_import, productive, github_status, github_prs, github_pr])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
            super::curl_quote(&format!("http://{}/tasks/1?filter[x]=1", l.local_addr().unwrap())), super::curl_quote("X-Auth-Token: t-1"), super::curl_quote(body));
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
