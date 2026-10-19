// Relay: a shell around real coding-agent CLIs (Claude Code, and more behind the agent-provider contract in
// packages/agent-core). Every conversation is a process of its provider, in the vault, on the user's own
// login (no API key). Permission requests and questions come in as files in the pending folder. Mail tools
// (mail/) are answered by the app itself over Claude Code's stdin/stdout pipe, as the in-process MCP server
// `relay-mail`; the other providers do not get mail.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;
use agent_core::{pending, usage, AgentProvider, Terminal};

mod actions;
mod agents;
mod anywhere;
mod brain;
mod awake;
pub use relay_remote::broker;
mod calendar;
mod commonwealth;
mod design;
mod changes;
mod commits;
mod dictation;
mod files;
mod host;
mod machine_git;
mod machines;
mod mirror;
mod favicon;
mod mail;
mod meeting;
pub mod notify;
mod permissions;
mod orch;
mod plugins;
mod providers;
mod pty;
mod related;
mod relay_config;
mod reminders;
mod retry;
mod scratch;
mod session;
#[cfg(feature = "selftest")]
mod selftest;
mod snapshot;
mod updater;
mod tray;
mod vault;
mod worktrees;

use session::{account_of, limit_key, pipe_reply, quit, reattach, reattach_remote, spawn_or_get, Proc};

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
    plugins::norm(&mut v);      // plugins: the MCP servers (plugins.rs), checked in set_settings
    calendar::norm(&mut v);     // calendar.on and calendar.feeds[].email, the addresses are in the keychain
    if !v["github"]["on"].is_boolean() { v["github"]["on"] = json!(false); }
    if !v["github"]["owners"].is_string() { v["github"]["owners"] = json!(""); }
    if !v["mail"]["on"].is_boolean() { v["mail"]["on"] = json!(false); }
    if !v["mail"]["account"].is_string() { v["mail"]["account"] = json!(""); }
    if !v["mail"]["accounts"].is_array() { v["mail"]["accounts"] = json!([]); }
    if !v["mail"]["experimental"].is_boolean() { v["mail"]["experimental"] = json!(false); }
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
    if !v["theme"].as_str().is_some_and(|t| ["system", "light", "dark"].contains(&t)) { v["theme"] = json!("system"); }
    if !v["accent"].as_str().is_some_and(|a| ["relay", "graphite"].contains(&a)) { v["accent"] = json!("relay"); }
    if !v["terminal"].as_str().is_some_and(|t| t == "auto" || TERMINALS.iter().any(|(id, _)| *id == t)) { v["terminal"] = json!("auto"); }
    // work machines (machines.rs): only complete ones, a broken entry is dropped rather than half used
    if !v["machines"].is_array() { v["machines"] = json!([]); }
    v["machines"].as_array_mut().unwrap().retain(machines::valid);
    // where new conversations run: "" this Mac, or a paired machine's id
    let known = v["machines"].as_array().unwrap().iter().any(|m| m["id"] == v["machines_default"]);
    if !known { v["machines_default"] = json!(""); }
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
    ("check_updates", ["Check for Updates…", "Zoek naar updates…", "Rechercher des mises à jour…", "Nach Updates suchen…"]),
    ("upd.nothing", ["No update to install, check again first.", "Geen update om te installeren, zoek eerst opnieuw.", "Aucune mise à jour à installer, vérifiez d'abord à nouveau.", "Kein Update zum Installieren, zuerst erneut suchen."]),
    ("upd.dev", ["A development build does not update itself.", "Een ontwikkelbuild werkt zichzelf niet bij.", "Une version de développement ne se met pas à jour.", "Ein Entwicklungsbuild aktualisiert sich nicht selbst."]),
    ("upd.agentManual", ["Relay cannot tell how this program was installed: update it the way you installed it.", "Relay kan niet zien hoe dit programma geïnstalleerd is: werk het bij zoals je het installeerde.", "Relay ne sait pas comment ce programme a été installé : mettez-le à jour comme vous l'avez installé.", "Relay erkennt nicht, wie dieses Programm installiert wurde: aktualisiere es so, wie du es installiert hast."]),
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
    ("run_setup", ["Set Up Vault…", "Vault instellen…", "Configurer la vault…", "Vault einrichten…"]),
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
    ("tray.more", ["More", "Meer", "Plus", "Mehr"]),
    ("tray.none", ["No reminders", "Geen reminders", "Aucun rappel", "Keine Erinnerungen"]),
    ("tray.done", ["✓ Done", "✓ Klaar", "✓ Fait", "✓ Erledigt"]),
    ("tray.to_tomorrow", ["→ Tomorrow", "→ Morgen", "→ Demain", "→ Morgen"]),
    ("tray.to_monday", ["→ Monday", "→ Maandag", "→ Lundi", "→ Montag"]),
    ("tray.plus_week", ["→ +1 week", "→ +1 week", "→ +1 semaine", "→ +1 Woche"]),
    ("tray.plus_month", ["→ +1 month", "→ +1 maand", "→ +1 mois", "→ +1 Monat"]),
    ("tray.drop", ["✕ Drop", "✕ Schrappen", "✕ Supprimer", "✕ Verwerfen"]),
    ("err.note", ["No note '{v}' in the vault", "Geen note '{v}' in de vault", "Aucune note '{v}' dans le coffre", "Keine Notiz '{v}' im Vault"]),
    ("err.vault_dest_used", ["{v} already has other files in it, choose your own vault instead", "{v} bevat al andere bestanden, kies je eigen vault", "{v} contient déjà d'autres fichiers, choisissez votre propre coffre", "{v} enthält schon andere Dateien, wähle deinen eigenen Vault"]),
    ("err.no_vault_set", ["No vault chosen yet", "Nog geen vault gekozen", "Aucun coffre choisi", "Noch kein Vault gewählt"]),
    ("err.project", ["Invalid project '{v}': icon (max 4 characters), label (max 60) and img (png data url) must be text",
        "Ongeldig project '{v}': icon (max 4 tekens), label (max 60) en img (png data url) moeten tekst zijn",
        "Projet '{v}' invalide : l'icône (4 caractères max.), le nom (60 max.) et img (data url png) doivent être du texte",
        "Ungültiges Projekt '{v}': Symbol (max. 4 Zeichen), Name (max. 60) und img (PNG-Data-URL) müssen Text sein"]),
    ("err.override", ["Invalid override '{v}'", "Ongeldige override '{v}'", "Remplacement '{v}' invalide", "Ungültige Zuordnung '{v}'"]),
    ("err.empty", ["empty message", "leeg bericht", "message vide", "leere Nachricht"]),
    ("err.gh_owners", ["GitHub: at most 10 owners, only letters, digits and -", "GitHub: hoogstens 10 owners, enkel letters, cijfers en -", "GitHub : 10 propriétaires au plus, uniquement lettres, chiffres et -", "GitHub: höchstens 10 Owner, nur Buchstaben, Ziffern und -"]),
    ("err.secret_chars", ["A secret may only contain printable ASCII characters", "Een geheim mag enkel afdrukbare ASCII-tekens bevatten", "Un secret ne peut contenir que des caractères ASCII imprimables", "Ein Geheimnis darf nur druckbare ASCII-Zeichen enthalten"]),
    ("err.plugin_start", ["Could not start the plugin: {v}", "Kon de plug-in niet starten: {v}", "Impossible de démarrer le plugin : {v}", "Das Plugin konnte nicht gestartet werden: {v}"]),
    ("err.plugin_exit", ["The plugin stopped", "De plug-in is gestopt", "Le plugin s'est arrêté", "Das Plugin wurde beendet"]),
    ("err.plugin_timeout", ["The plugin did not answer in time", "De plug-in antwoordde niet op tijd", "Le plugin n'a pas répondu à temps", "Das Plugin hat nicht rechtzeitig geantwortet"]),
    ("err.plugin_not_mcp", ["This program does not answer as an MCP server", "Dit programma antwoordt niet als MCP-server", "Ce programme ne répond pas comme un serveur MCP", "Dieses Programm antwortet nicht als MCP-Server"]),
    ("err.plugin_unknown", ["Unknown plugin '{v}'", "Onbekende plug-in '{v}'", "Plugin inconnu '{v}'", "Unbekanntes Plugin '{v}'"]),
    ("err.plugin_off", ["{v} is switched off", "{v} staat uit", "{v} est désactivé", "{v} ist ausgeschaltet"]),
    ("err.plugin_bad", ["The plugin '{v}' is not set up correctly", "De plug-in '{v}' is niet juist ingesteld", "Le plugin « {v} » n'est pas configuré correctement", "Das Plugin „{v}“ ist nicht richtig eingerichtet"]),
    ("err.plugin_tool", ["The tool '{v}' is not allowed for this plugin", "De tool '{v}' is niet toegelaten voor deze plug-in", "L'outil « {v} » n'est pas autorisé pour ce plugin", "Das Tool „{v}“ ist für dieses Plugin nicht erlaubt"]),
    ("err.plugin_view", ["'{v}' is not a view this plugin can show", "'{v}' is geen weergave die deze plug-in kan tonen", "« {v} » n'est pas une vue que ce plugin peut afficher", "„{v}“ ist keine Ansicht, die dieses Plugin zeigen kann"]),
    ("err.token_chars", ["The token may only contain letters, digits, - and _", "Het token mag enkel letters, cijfers, - en _ bevatten", "Le jeton ne peut contenir que des lettres, des chiffres, - et _", "Das Token darf nur Buchstaben, Ziffern, - und _ enthalten"]),
    ("err.keychain", ["Could not save the token in the keychain", "Kon het token niet in de sleutelhanger bewaren", "Impossible d'enregistrer le jeton dans le trousseau", "Das Token konnte nicht im Schlüsselbund gespeichert werden"]),
    ("err.claude_json", ["~/.claude.json not found or unreadable", "~/.claude.json niet gevonden of onleesbaar", "~/.claude.json introuvable ou illisible", "~/.claude.json nicht gefunden oder nicht lesbar"]),
    ("err.call", ["This {v} call is not allowed", "Deze {v}-oproep is niet toegelaten", "Cet appel {v} n'est pas autorisé", "Dieser {v}-Aufruf ist nicht erlaubt"]),
    ("err.no_provider", ["Unknown integration '{v}'", "Onbekende integratie '{v}'", "Intégration inconnue '{v}'", "Unbekannte Integration '{v}'"]),
    ("err.board_map", ["Invalid board for project '{v}'", "Ongeldig bord voor project '{v}'", "Tableau invalide pour le projet '{v}'", "Ungültiges Board für Projekt '{v}'"]),
    ("err.no_token", ["No {v} token. Fill it in under Relay › Settings… › Integrations.", "Geen {v}-token. Vul het in bij Relay › Instellingen… › Integraties.", "Aucun jeton {v}. Renseignez-le dans Relay › Réglages… › Intégrations.", "Kein {v}-Token. Trag es unter Relay › Einstellungen… › Integrationen ein."]),
    ("err.down", ["{p} unreachable: {v}", "{p} niet bereikbaar: {v}", "{p} injoignable : {v}", "{p} nicht erreichbar: {v}"]),
    ("err.no_gh", ["gh not found. Install it with `brew install gh`.", "gh niet gevonden. Installeer het met `brew install gh`.", "gh introuvable. Installez-le avec `brew install gh`.", "gh nicht gefunden. Installiere es mit `brew install gh`."]),
    ("err.update_dev", ["A development build has no release to update a machine from: use the commands below.", "Een ontwikkelbuild heeft geen release om een machine mee bij te werken: gebruik de commando's hieronder.", "Une version de développement n'a pas de release pour mettre une machine à jour : utilisez les commandes ci-dessous.", "Ein Entwicklungsbuild hat kein Release, um eine Maschine zu aktualisieren: nutze die Befehle unten."]),
    ("err.update_old", ["This relay-server cannot update from Relay yet: update it once with the commands below, after that it can.", "Deze relay-server kan nog niet bijgewerkt worden vanuit Relay: werk hem één keer bij met de commando's hieronder, daarna wel.", "Ce relay-server ne se met pas encore à jour depuis Relay : mettez-le à jour une fois avec les commandes ci-dessous, ensuite oui.", "Dieser relay-server lässt sich noch nicht aus Relay aktualisieren: aktualisiere ihn einmal mit den Befehlen unten, danach schon."]),
    ("err.update_download", ["The binary for {v} could not be downloaded from the release", "De binary voor {v} kon niet gedownload worden uit de release", "Le binaire pour {v} n'a pas pu être téléchargé depuis la release", "Die Binärdatei für {v} konnte nicht aus dem Release geladen werden"]),
    ("err.update_back", ["Updated, but the machine does not answer with the new version yet. Try Refresh in a moment.", "Bijgewerkt, maar de machine antwoordt nog niet met de nieuwe versie. Probeer zo dadelijk Vernieuwen.", "Mis à jour, mais la machine ne répond pas encore avec la nouvelle version. Réessayez Actualiser dans un instant.", "Aktualisiert, aber die Maschine antwortet noch nicht mit der neuen Version. Versuch gleich Aktualisieren."]),
    ("err.gh_login", ["Not signed in to gh. Run `gh auth login` in the terminal.", "Niet ingelogd bij gh. Voer `gh auth login` uit in de terminal.", "Pas connecté à gh. Lancez `gh auth login` dans le terminal.", "Nicht bei gh angemeldet. Führe `gh auth login` im Terminal aus."]),
    ("err.bad_repo", ["Invalid repo", "Ongeldige repo", "Dépôt invalide", "Ungültiges Repo"]),
    ("err.mail_pw", ["The app password is the 16-letter code Google showed (spaces are fine)", "Het app-wachtwoord is de code van 16 letters die Google toonde (spaties mogen)",
        "Le mot de passe d'application est le code de 16 lettres affiché par Google (les espaces sont acceptés)", "Das App-Passwort ist der 16-stellige Code, den Google angezeigt hat (Leerzeichen sind ok)"]),
    ("err.mail_pw_any", ["The password must be 1 to 256 characters, without control characters", "Het wachtwoord moet 1 tot 256 tekens zijn, zonder stuurtekens", "Le mot de passe doit faire de 1 à 256 caractères, sans caractères de contrôle", "Das Passwort muss 1 bis 256 Zeichen lang sein, ohne Steuerzeichen"]),
    ("err.no_mail_account", ["Mail: no account set up. Add one under Relay › Settings… › Integrations › Mail.", "Mail: nog geen account. Voeg er een toe bij Relay › Instellingen… › Integraties › Mail.", "Mail : aucun compte. Ajoutez-en un dans Relay › Réglages… › Intégrations › Mail.", "Mail: noch kein Konto. Füge eins unter Relay › Einstellungen… › Integrationen › Mail hinzu."]),
    ("err.bad_mail", ["Invalid mail id", "Ongeldige mail-id", "Identifiant de mail invalide", "Ungültige Mail-ID"]),
    ("err.mail_account", ["Mail: invalid account (email, server, port, keychain service and account, at most 5 accounts)", "Mail: ongeldig account (e-mail, server, poort, sleutelhangerdienst en -account, hoogstens 5 accounts)", "Mail : compte invalide (e-mail, serveur, port, service et compte du trousseau, 5 comptes au plus)", "Mail: ungültiges Konto (E-Mail, Server, Port, Schlüsselbunddienst und -konto, höchstens 5 Konten)"]),
    ("err.no_pr", ["PR not found", "PR niet gevonden", "PR introuvable", "PR nicht gefunden"]),
    ("err.no_agent", ["Unknown agent '{v}'", "Onbekende agent '{v}'", "Agent inconnu '{v}'", "Unbekannter Agent '{v}'"]),
    ("err.no_import", ["Claude Code has no {v} MCP server with credentials", "Claude Code heeft geen {v}-MCP-server met inloggegevens", "Claude Code n'a pas de serveur MCP {v} avec des identifiants", "Claude Code hat keinen {v}-MCP-Server mit Zugangsdaten"]),
    ("err.icons_no_claude", ["Finding websites needs Claude Code switched on under Agents", "Websites zoeken heeft Claude Code nodig, aangezet onder Agents", "La recherche de sites nécessite Claude Code activé dans Agents", "Websites suchen braucht Claude Code, eingeschaltet unter Agents"]),
    ("err.agent_none", ["Switch on at least one agent", "Zet minstens één agent aan", "Activez au moins un agent", "Schalte mindestens einen Agenten ein"]),
    ("err.agent_account", ["{v}: an account needs a name of 1 to 40 characters and an absolute folder", "{v}: een account heeft een naam van 1 tot 40 tekens en een absolute map nodig", "{v} : un compte a besoin d'un nom de 1 à 40 caractères et d'un dossier absolu", "{v}: ein Konto braucht einen Namen mit 1 bis 40 Zeichen und einen absoluten Ordner"]),
    ("err.agent_account_dir", ["{v}: each account needs its own folder, other than ~/.claude", "{v}: elk account heeft een eigen map nodig, niet ~/.claude", "{v} : chaque compte a besoin de son propre dossier, autre que ~/.claude", "{v}: jedes Konto braucht einen eigenen Ordner, nicht ~/.claude"]),
    ("err.agent_bin", ["{v}: the program path must be absolute", "{v}: het pad naar het programma moet absoluut zijn", "{v} : le chemin du programme doit être absolu", "{v}: der Programmpfad muss absolut sein"]),
    ("err.agent_busy", ["Still answering the previous message", "Nog bezig met het vorige bericht", "Encore occupé avec le message précédent", "Noch mit der vorigen Nachricht beschäftigt"]),
    ("err.no_terminal", ["{v} is not installed: pick another terminal in Settings › General", "{v} is niet geïnstalleerd: kies een andere terminal in Instellingen › Algemeen", "{v} n'est pas installé : choisissez un autre terminal dans Réglages › Général", "{v} ist nicht installiert: wähle ein anderes Terminal unter Einstellungen › Allgemein"]),
    ("err.agent_terminal", ["{v} cannot be opened in the terminal", "{v} kan niet in de terminal geopend worden", "{v} ne peut pas s'ouvrir dans le terminal", "{v} lässt sich nicht im Terminal öffnen"]),
    ("err.move_no_session", ["This conversation has not started yet: pick where it runs next to the model", "Dit gesprek is nog niet gestart: kies naast het model waar het loopt", "Cette conversation n'a pas encore commencé : choisissez où elle s'exécute à côté du modèle", "Dieses Gespräch hat noch nicht begonnen: Wähle neben dem Modell, wo es läuft"]),
    ("err.move_only_claude", ["Only a Claude Code conversation can move to another machine", "Enkel een gesprek met Claude Code kan naar een andere machine", "Seule une conversation Claude Code peut changer de machine", "Nur ein Claude-Code-Gespräch kann auf eine andere Maschine wechseln"]),
    ("err.move_busy", ["Wait until the turn ends and no card is open, then move it", "Wacht tot de beurt klaar is en er geen kaart openstaat, verhuis het dan", "Attendez la fin du tour et qu'aucune carte ne soit ouverte, puis déplacez-la", "Warte, bis die Runde endet und keine Karte offen ist, dann verschiebe es"]),
    ("err.machine_mail", ["A conversation about a mail runs on this Mac, not on a work machine", "Een gesprek over een mail loopt op deze Mac, niet op een werkmachine",
        "Une conversation sur un mail tourne sur ce Mac, pas sur une machine de travail", "Ein Gespräch über eine Mail läuft auf diesem Mac, nicht auf einer Arbeitsmaschine"]),
    ("err.machine_down", ["Work machine unreachable: {v}", "Werkmachine niet bereikbaar: {v}", "Machine de travail injoignable : {v}", "Arbeitsmaschine nicht erreichbar: {v}"]),
    ("err.machine_terminal", ["This conversation runs on {v}: open it in the terminal there", "Dit gesprek loopt op {v}: open het daar in de terminal",
        "Cette conversation tourne sur {v} : ouvrez-la là-bas dans le terminal", "Dieses Gespräch läuft auf {v}: öffne es dort im Terminal"]),
    ("err.machine", ["Invalid work machine in the settings", "Ongeldige werkmachine in de instellingen", "Machine de travail invalide dans les réglages", "Ungültige Arbeitsmaschine in den Einstellungen"]),
    ("err.machine_folder", ["{v}: a folder needs a vault project and an absolute path on the machine", "{v}: een map heeft een vaultproject en een absoluut pad op de machine nodig",
        "{v} : un dossier a besoin d'un projet du coffre et d'un chemin absolu sur la machine", "{v}: ein Ordner braucht ein Vault-Projekt und einen absoluten Pfad auf der Maschine"]),
    ("err.machine_no_github", ["Update the machine to use GitHub", "Werk de machine bij om GitHub te gebruiken", "Mettez la machine à jour pour utiliser GitHub", "Aktualisiere die Maschine, um GitHub zu nutzen"]),
    ("err.repo_unknown", ["No repo {v} on the machine", "Geen repo {v} op de machine", "Aucun dépôt {v} sur la machine", "Kein Repo {v} auf der Maschine"]),
    ("err.repo_no_checkout", ["No local checkout of {v} found on this Mac", "Geen lokale checkout van {v} gevonden op deze Mac", "Aucune copie locale de {v} trouvée sur ce Mac", "Kein lokaler Checkout von {v} auf diesem Mac gefunden"]),
    ("err.repo_branch_out", ["{v} is checked out on this Mac: switch to another branch there first", "{v} is uitgecheckt op deze Mac: wissel daar eerst naar een andere branch", "{v} est extraite sur ce Mac : passez d'abord à une autre branche", "{v} ist auf diesem Mac ausgecheckt: wechsle dort zuerst auf einen anderen Branch"]),
    ("err.no_machine", ["No such work machine", "Onbekende werkmachine", "Machine de travail inconnue", "Unbekannte Arbeitsmaschine"]),
    ("err.cal_email", ["Calendar: enter the calendar's email address", "Agenda: vul het e-mailadres van de agenda in", "Agenda : saisissez l'adresse e-mail de l'agenda", "Kalender: Gib die E-Mail-Adresse des Kalenders ein"]),
    ("err.cal_url", ["That is no secret iCal address. In Google Calendar: Settings › your calendar › Integrate calendar › Secret address in iCal format.", "Dat is geen geheim iCal-adres. In Google Agenda: Instellingen › je agenda › Agenda integreren › Geheim adres in iCal-indeling.", "Ce n'est pas une adresse iCal secrète. Dans Google Agenda : Paramètres › votre agenda › Intégrer l'agenda › Adresse secrète au format iCal.", "Das ist keine geheime iCal-Adresse. In Google Kalender: Einstellungen › dein Kalender › Kalender integrieren › Geheime Adresse im iCal-Format."]),
    ("err.cal_keychain", ["Could not save the calendar address in the keychain", "Kon het agenda-adres niet in de sleutelhanger bewaren", "Impossible d'enregistrer l'adresse de l'agenda dans le trousseau", "Die Kalenderadresse konnte nicht im Schlüsselbund gespeichert werden"]),
    ("err.cal_down", ["Calendar unreachable: {v}", "Agenda niet bereikbaar: {v}", "Agenda injoignable : {v}", "Kalender nicht erreichbar: {v}"]),
    ("err.cal_no_url", ["no address in the keychain, add {v} again under Settings › Integrations › Calendar", "geen adres in de sleutelhanger, voeg {v} opnieuw toe bij Instellingen › Integraties › Agenda", "pas d'adresse dans le trousseau, ajoutez {v} à nouveau dans Réglages › Intégrations › Agenda", "keine Adresse im Schlüsselbund, füge {v} unter Einstellungen › Integrationen › Kalender neu hinzu"]),
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
        &P::about(h, Some(&t("about")), None)?, &MenuItem::with_id(h, "check-updates", t("check_updates"), true, None::<&str>)?,
        &P::separator(h)?, &settings, &P::separator(h)?,
        &P::hide(h, Some(&t("hide")))?, &P::hide_others(h, Some(&t("hide_others")))?, &P::show_all(h, Some(&t("show_all")))?,
        &P::separator(h)?, &P::quit(h, Some(&t("quit")))?])?;
    let edit = Submenu::with_items(h, t("edit"), true, &[
        &P::undo(h, Some(&t("undo")))?, &P::redo(h, Some(&t("redo")))?, &P::separator(h)?,
        &P::cut(h, Some(&t("cut")))?, &P::copy(h, Some(&t("copy")))?, &P::paste(h, Some(&t("paste")))?, &P::select_all(h, Some(&t("select_all")))?])?;
    // Cmd-W closes the conversation like a browser tab, the main window stays open
    let chat = Submenu::with_items(h, t("chat"), true, &[
        &MenuItem::with_id(h, "new-general", t("new_general"), true, Some("CmdOrCtrl+T"))?,
        &MenuItem::with_id(h, "new-project", t("new_project"), true, Some("CmdOrCtrl+N"))?,
        &MenuItem::with_id(h, "run-setup", t("run_setup"), true, None::<&str>)?,
        &P::separator(h)?,
        &MenuItem::with_id(h, "close-chat", t("close_chat"), true, Some("CmdOrCtrl+W"))?])?;
    let window = Submenu::with_items(h, t("window"), true, &[
        &P::minimize(h, Some(&t("minimize")))?, &P::maximize(h, Some(&t("zoom")))?, &P::fullscreen(h, Some(&t("fullscreen")))?])?;
    Menu::with_items(h, &[&app, &chat, &edit, &window])
}

struct App {
    procs: Mutex<HashMap<String, Proc>>,
    sids: Mutex<HashMap<String, agents::Sess>>, // conversation key -> provider and session id, persisted
    path: String,                          // login-shell PATH, so the agent's tools find gh, himalaya, node
    settings: Mutex<Value>,                // settings.json: vault, projects, overrides, agents, mail
    limits: Mutex<HashMap<String, (i64, Value)>>, // per provider and account (limit_key): its last limits answer and when
    spent: Mutex<std::collections::HashSet<String>>, // limit_keys a turn was refused on, until their limits read below 100% again
    mail: mail::Mail,                      // one IMAP session per account, shared by the UI and the relay-mail tools
    worktrees: Mutex<HashMap<String, Vec<String>>>, // conversation key -> the git worktrees it made, persisted (worktrees.rs)
    asked: Mutex<std::collections::HashSet<String>>, // "conversation\nrepo" already offered for linking this run (commits.rs)
    machines: machines::Machines,          // work machines, this Mac's certificate and which conversation runs where
    mirrors: mirror::Mirrors,              // what this Mac keeps in sync on each work machine (mirror.rs)
    orch: Mutex<()>,                       // one writer of orch.json at a time (orch.rs)
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

fn save_worktrees(app: &AppHandle, w: &HashMap<String, Vec<String>>) {
    fs::write(data_dir(app).join("worktrees.json"), json!(w).to_string()).ok();
}

/// The user's own login shell, not zsh: a fish or bash user's PATH (npm, Homebrew) lives in that shell's config.
/// The last line, in case the rc files print something first.
fn login_path() -> String {
    let sh = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/zsh".into());
    Command::new(sh).args(["-lic", "printf '\\n%s' \"$PATH\""]).stdin(Stdio::null()).output()
        .ok().map(|o| String::from_utf8_lossy(&o.stdout).lines().last().unwrap_or("").trim().to_string())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin".into())
}

/// Everything the sidebar shows, read from the mapped paths (snapshot.rs). Also returns the vault
/// status, so the UI can switch off what the vault lacks (e.g. reminder actions without a script).
#[tauri::command]
fn snapshot(app: AppHandle, state: State<App>) -> Result<Value, String> {
    let (st, lang) = { let s = state.settings.lock().unwrap(); (vault_of(&s), ui_lang_of(&s)) };
    let v = st["vault"].as_str().unwrap();
    if v.is_empty() { return Err(tr(lang, "err.no_vault_set")); }
    if st["ok"] != true { return Err(tr_v(lang, "err.no_vault", v)); }
    // the first time a vault is used, its .relay/config.json is written from what is detected
    relay_config::ensure(v, &st["map"]);
    let path = |k: &str| if st["found"][k] == true { vault::resolve(v, st["map"][k].as_str().unwrap()).to_string_lossy().into_owned() } else { String::new() };
    let mut snap = snapshot::snapshot(v, &path("workState"), &path("notes"), chrono::Local::now().date_naive(), &state.path,
        &data_dir(&app).join("topics.json"), &home())?;
    snap["vault"] = st;
    let (file, _, _) = rem_ctx(&app)?;
    snap["reminders"] = reminders::list(&file, chrono::Local::now().date_naive()).into();
    tray::refresh(&app); // the file may have changed outside the app
    Ok(snap)
}

/// The UI's own state, what the webview used to keep in localStorage (the conversations' metadata, the sidebar's order
/// and folds, the board's last pick): one JSON object of strings in ui-state.json, so every window and every build of
/// Relay on this Mac (a development build and the installed app) see the same.
#[tauri::command]
async fn ui_state_get(app: AppHandle) -> Value {
    let path = data_dir(&app).join("ui-state.json");
    tauri::async_runtime::spawn_blocking(move || fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()))
        .await.ok().flatten().unwrap_or_else(|| json!({}))
}
/// One change to ui-state.json at a time, so two windows never undo each other's keys.
static UI_STATE: Mutex<()> = Mutex::new(());
/// The first start with the file: `state` (what the window's localStorage held) becomes the file in one write, so a
/// reload halfway can never leave half of it. When another window was first, its file stays. The file's content.
#[tauri::command]
async fn ui_state_init(app: AppHandle, state: serde_json::Map<String, Value>) -> Result<Value, String> {
    let path = data_dir(&app).join("ui-state.json");
    tauri::async_runtime::spawn_blocking(move || {
        let _one = UI_STATE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(v) = fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) { return Ok(v); }
        relay_remote::sync::write_atomic(&path, serde_json::to_string(&state).unwrap().as_bytes(), None).map_err(|e| e.to_string())?;
        Ok(Value::Object(state))
    }).await.map_err(|e| e.to_string())?
}
/// One key of it: read, change, write whole.
#[tauri::command]
async fn ui_state_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let path = data_dir(&app).join("ui-state.json");
    tauri::async_runtime::spawn_blocking(move || {
        let _one = UI_STATE.lock().unwrap_or_else(|e| e.into_inner());
        let mut state: serde_json::Map<String, Value> = fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        state.insert(key, Value::String(value));
        relay_remote::sync::write_atomic(&path, serde_json::to_string(&state).unwrap().as_bytes(), None).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

/// The favicon of each project's website, guessed from its notes (favicon.rs), for the projects
/// ([{name, aliases}]) whose guess is not in favicons.tried yet: {name: {site, data}}, data the raw icon or null.
#[tauri::command]
async fn favicons(state: State<'_, App>, projects: Value) -> Result<Value, String> {
    let (st, tried) = { let s = state.settings.lock().unwrap(); (vault_of(&s), s["favicons"]["tried"].clone()) };
    if st["ok"] != true { return Ok(json!({})); }
    let v = st["vault"].as_str().unwrap();
    let notes = if st["found"]["notes"] == true { vault::resolve(v, st["map"]["notes"].as_str().unwrap()).to_string_lossy().into_owned() } else { String::new() };
    // a website set as a project's icon in the vault's .relay/config.json wins over a guess
    let sites: serde_json::Map<String, Value> = relay_config::icons(v).into_iter()
        .filter_map(|(n, i)| match relay_config::icon_kind(i["value"].as_str()?) { relay_config::Icon::Site(s) => Some((n, json!(s))), _ => None }).collect();
    let v = v.to_string();
    tauri::async_runtime::spawn_blocking(move || favicon::run(&v, &notes, &projects, &tried, &sites)).await.map_err(|e| e.to_string())
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
    // on the account a new conversation gets now, never one inherited from the app's environment
    let account = account_of(&state, p, "", "sonnet");
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
        let mut c = Command::new(&eb.bin);
        c.args(["-p", "--model", "sonnet", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config",
                "--tools", "WebSearch", "--allowedTools", "WebSearch"])
            .current_dir(std::env::temp_dir()).env("PATH", &eb.path).env_remove("ANTHROPIC_API_KEY")
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        if account.is_empty() { c.env_remove("CLAUDE_CONFIG_DIR"); } else { c.env("CLAUDE_CONFIG_DIR", &account); }
        let mut c = c.spawn()?;
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
const CAPTURE_PROMPT: &str = agent_core::prompt::text(include_str!("../../prompts/conversation/vault-capture.md"));
/// What a closed conversation leaves for the vault, written straight in: one Sonnet call that resumes a fork of its
/// session (not kept), in the vault with its CLAUDE.md, rules and hooks but no MCP, allowed to read, edit and write.
/// Nothing is shown or asked; the vault's git history is the review. Only a Claude session of this Mac: a work
/// machine's transcript is not here.
/// ponytail: no timeout on the run; a hung one holds the queue (application/capture) until Relay quits
#[tauri::command]
async fn capture_vault(app: AppHandle, state: State<'_, App>, key: String) -> Result<(), String> {
    let sid = state.sids.lock().unwrap().get(&key).filter(|s| s.provider == "claude").map(|s| s.sid.clone());
    let p = agents::enabled(&state.settings.lock().unwrap()).into_iter().find(|p| p.id() == "claude");
    let (Some(sid), Some(p)) = (sid, p) else { return Ok(()) };
    if !p.valid_session(&sid) || state.machines.bind_of(&key).is_some() { return Ok(()); }
    let eb = env_of(&app, &state, p);
    if eb.vault.is_empty() { return Ok(()); }
    // on the account the session was recorded on, its transcript is there
    let account = account_of(&state, p, &key, "sonnet");
    let prompt = CAPTURE_PROMPT;
    let out = tauri::async_runtime::spawn_blocking(move || -> std::io::Result<std::process::Output> {
        let mut c = Command::new(&eb.bin);
        c.args(["-p", "--resume", &sid, "--fork-session", "--no-session-persistence", "--model", "sonnet", "--strict-mcp-config",
                "--tools", "Read,Glob,Grep,Edit,Write", "--allowedTools", "Read,Glob,Grep,Edit,Write"])
            .current_dir(&eb.vault).env("PATH", &eb.path).env_remove("ANTHROPIC_API_KEY")
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        if account.is_empty() { c.env_remove("CLAUDE_CONFIG_DIR"); } else { c.env("CLAUDE_CONFIG_DIR", &account); }
        let mut c = c.spawn()?;
        c.stdin.take().unwrap().write_all(prompt.as_bytes())?;
        c.wait_with_output()
    }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).trim().chars().take(300).collect()); }
    Ok(())
}
/// The project index of a vault with a System/scripts/build-index.py, rebuilt at start. Errors are logged.
fn refresh_index(app: &AppHandle) {
    let vault = app.state::<App>().settings.lock().unwrap()["vault"].as_str().unwrap_or("").to_string();
    if vault.is_empty() { return; }
    let bundled = app.path().resolve("default-vault/System/scripts/build-index.py", tauri::path::BaseDirectory::Resource).ok();
    let Some(script) = index_script(PathBuf::from(&vault).join("System/scripts/build-index.py"), bundled) else { return };
    let path = app.state::<App>().path.clone();
    std::thread::spawn(move || match Command::new("python3").arg(&script).env("VAULT", &vault).env("PATH", &path).output() {
        Ok(o) if o.status.success() => {}
        Ok(o) => eprintln!("build-index: {}", String::from_utf8_lossy(&o.stderr).trim()),
        Err(e) => eprintln!("build-index: {e}"),
    });
}
/// Which build-index.py rebuilds a vault's index. A copy of the starter script gets the app's own copy, so a vault an
/// older Relay made follows today's rules too (an Active project untouched for 30 days shows as Quiet). Every starter
/// version reads the card field `last`. A vault with a script of its own (other card fields) runs that one: ours would
/// find none of its cards and write an empty index.
fn index_script(own: PathBuf, bundled: Option<PathBuf>) -> Option<PathBuf> {
    let src = std::fs::read_to_string(&own).ok()?;
    if src.contains("scalar(fm, \"last\"") { bundled } else { Some(own) }
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
fn set_project_repos(app: AppHandle, state: State<App>, project: String, repos: Vec<String>) -> Result<(), String> {
    relay_config::set_repos(&need_vault(&state)?, &project, &repos)?;
    // the main window's title bar shows the PRs button by them
    app.emit("repos-changed", ()).ok();
    Ok(())
}
/// "Not now" on a repo a conversation committed to: unlinked on purpose, it is not offered again.
#[tauri::command]
fn ignore_repo(state: State<App>, repo: String) -> Result<(), String> { relay_config::ignore_repo(&need_vault(&state)?, &repo) }
/// The repos a conversation committed to that no project has, and that the vault did not unlink on purpose, each
/// only once per conversation and run (a general conversation, which never asks, must not use up a project's ask).
/// `dirs`: checkouts or their main repos, found by commits.rs.
fn unlinked_repos(app: &AppHandle, key: &str, dirs: Vec<PathBuf>) -> Vec<String> {
    let st = app.state::<App>();
    let vault = st.settings.lock().unwrap()["vault"].as_str().unwrap_or("").to_string();
    let Some(cfg) = relay_config::load(&vault) else { return vec![] };
    let known = repo_projects(&vault);
    let mut asked = st.asked.lock().unwrap();
    dirs.iter().filter_map(|d| gh_repo(&d.to_string_lossy())).filter(|r| {
        !known.contains_key(r) && !cfg["repos"].as_object().is_some_and(|m| m.keys().any(|k| k.to_lowercase() == *r)) && asked.insert(format!("{key}\n{r}"))
    }).collect()
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

/// A project's scratch notes, newest first: [{id, text, modified}].
#[tauri::command]
fn scratch_list(state: State<App>, project: String) -> Result<Value, String> { scratch::list(&need_vault(&state)?, &project) }
/// Create (no id) or overwrite a scratch note; returns its id.
#[tauri::command]
fn scratch_save(state: State<App>, project: String, id: Option<String>, text: String) -> Result<String, String> {
    scratch::save(&need_vault(&state)?, &project, id, &text)
}
#[tauri::command]
fn scratch_delete(state: State<App>, project: String, id: String) -> Result<(), String> { scratch::delete(&need_vault(&state)?, &project, &id) }

/// A vault note a conversation links to, for the right panel: {path (relative to the vault), text}.
#[tauri::command]
fn read_note(state: State<App>, target: String) -> Result<Value, String> {
    let v = need_vault(&state)?;
    vault::note(&v, &target).map(|(path, text)| json!({"path": path, "text": text}))
        .ok_or_else(|| tr_v(ui_lang_of(&state.settings.lock().unwrap()), "err.note", &target))
}

/// The vault's notes, {root (canonical), notes (relative paths)}: what a conversation may link to.
#[tauri::command]
fn vault_notes(state: State<App>) -> Result<Value, String> {
    let (root, notes) = vault::notes(&need_vault(&state)?);
    Ok(json!({"root": root, "notes": notes}))
}

/// The vault notes closest to what a conversation is about, [{path, title, snippet}], from the full-text index.
#[tauri::command]
async fn related_notes(app: AppHandle, state: State<'_, App>, text: String) -> Result<Value, String> {
    let v = need_vault(&state)?;
    let db = index_dir(&app);
    tauri::async_runtime::spawn_blocking(move || related::related(&db, &v, &text, 12)).await.map_err(|e| e.to_string())?.map(Value::from)
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

/// A first start without a vault of one's own: the starter vault from the app's resources, copied to ~/Relay
/// (an existing vault there is kept). Returns its status, for the welcome screen to save like a picked one.
#[tauri::command]
fn create_default_vault(app: AppHandle, state: State<App>) -> Result<Value, String> {
    let lang = ui_lang_of(&state.settings.lock().unwrap());
    let src = app.path().resolve("default-vault", tauri::path::BaseDirectory::Resource).map_err(|e| e.to_string())?;
    let dest = PathBuf::from(home()).join(vault::DEFAULT_DIR);
    vault::create_default(&src, &dest).map_err(|e| if e.starts_with("err.") { tr_v(lang, &e, &dest.to_string_lossy()) } else { e })?;
    let (v, m) = vault::detect(&dest.to_string_lossy());
    Ok(vault::status(&v, &m))
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
    // the accounts conversations were recorded on, also one removed from the list since: its transcripts are still there
    let recorded: Vec<String> = st.sids.lock().unwrap().values().filter(|x| x.provider == p.id() && !x.account.is_empty()).map(|x| x.account.clone()).collect();
    let s = st.settings.lock().unwrap();
    let mut opts = s["agents"]["providers"][p.id()].clone();
    // a provider with a control pipe gets the relay-mail tools only when mail is on and an account is set up; set by the app, never the user
    if p.caps().control && opts.is_object() { opts["mail"] = json!(mail_on(&s)); }
    // the account calls run on unless they say otherwise (spawn, limits): the active one
    if p.caps().accounts && opts.is_object() {
        opts["account"] = opts["active"].clone();
        let mut list = opts["accounts"].as_array().cloned().unwrap_or_default();
        for d in recorded { if !list.iter().any(|a| a["dir"] == d.as_str()) { list.push(json!({"name": "", "dir": d})); } }
        opts["accounts"] = json!(list);
    }
    EnvBuf { home: home(), vault: s["vault"].as_str().unwrap_or("").into(), path: st.path.clone(), bin: agents::bin(&s, p, &home(), &st.path), pending: pending_dir(app), opts }
}
fn mail_on(s: &Value) -> bool { s["mail"]["on"] == true && !mail::accounts(&s["mail"]).is_empty() }
/// A conversation's provider: its session's, else the one asked for when switched on, else the default.
fn provider_of(st: &App, key: &str, asked: Option<&str>) -> &'static dyn AgentProvider {
    if let Some(s) = st.sids.lock().unwrap().get(key) { return agents::get_or_first(Some(&s.provider)); }
    let s = st.settings.lock().unwrap();
    asked.and_then(|a| agents::enabled(&s).into_iter().find(|p| p.id() == a)).unwrap_or_else(|| agents::get_or_first(Some(&agents::default_id(&s))))
}
/// The terminals a session opens in, by settings.terminal; "auto" takes the first one installed (Terminal always is).
const TERMINALS: [(&str, &str); 3] = [("iterm", "iTerm"), ("wezterm", "WezTerm"), ("terminal", "Terminal")];
fn app_path(app: &str) -> Option<PathBuf> {
    [format!("/Applications/{app}.app"), format!("{}/Applications/{app}.app", home()), format!("/System/Applications/Utilities/{app}.app")]
        .into_iter().map(PathBuf::from).find(|p| p.exists())
}
fn terminal_of(choice: &str, installed: impl Fn(&str) -> bool) -> &'static str {
    TERMINALS.iter().find(|(id, app)| if choice == "auto" { installed(app) } else { *id == choice }).map_or("terminal", |(id, _)| id)
}
/// Run a shell command in a new window of the terminal from the settings.
fn in_terminal(st: &App, cmd: &str) -> Result<(), String> {
    let choice = st.settings.lock().unwrap()["terminal"].as_str().unwrap_or("auto").to_string();
    let osa = |script: String| {
        let o = Command::new("/usr/bin/osascript").args(["-e", &script]).output().map_err(|e| e.to_string())?;
        if o.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&o.stderr).trim().to_string()) }
    };
    let q = serde_json::to_string(cmd).unwrap();
    match terminal_of(&choice, |app| app_path(app).is_some()) {
        "iterm" => osa(format!("tell application \"iTerm\"\n activate\n set w to (create window with default profile)\n tell current session of w to write text {q}\nend tell")),
        "wezterm" => {
            let bin = app_path("WezTerm").ok_or_else(|| trc_v("err.no_terminal", "WezTerm"))?.join("Contents/MacOS/wezterm");
            // a login shell: a GUI app's PATH has no `claude`. The shell stays after the command, as in iTerm
            let sh = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
            Command::new(bin).args(["start", "--", &sh, "-lc", &format!("{cmd}; exec {sh} -l")]).spawn().map(|_| ()).map_err(|e| e.to_string())
        }
        _ => osa(format!("tell application \"Terminal\"\n activate\n do script {q}\nend tell")),
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn send(app: AppHandle, state: State<App>, project: String, text: String, images: Option<Vec<Value>>, name: Option<String>, fork: Option<String>,
        model: Option<String>, effort: Option<String>, provider: Option<String>, mail: Option<bool>, told: Option<String>, context: Option<String>, machine: Option<String>, about: Option<String>) -> Result<(), String> {
    session::send(&app, &state, session::Msg { project, text, images, name, fork, model, effort, provider, mail, told, context, machine, about })
}

#[tauri::command]
fn stop(app: AppHandle, state: State<App>, project: String) { session::stop(&app, &state, &project) }

/// The orchestrator's workers, oldest first (orch.rs).
#[tauri::command]
fn orch_workers(app: AppHandle) -> Vec<orch::Worker> { orch::load(&app) }
#[tauri::command]
fn orch_stop(app: AppHandle, key: String) -> bool { orch::stop(&app, &key) }
/// The board pipeline (webview: application/pipeline): start a worker on a ticket, write to one, read its PR, and
/// note what it did on the board. Off the main thread: git fetch, push and gh go over the network.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn orch_dispatch_ticket(app: AppHandle, title: String, task: String, project: String, repo: String, base: Option<String>, model: Option<String>, ticket: Value, validate: Option<orch::Validate>, plan: Option<bool>, skill: Option<String>) -> Result<orch::Worker, String> {
    let base = base.map(|b| b.trim().to_string()).filter(|b| !b.is_empty());
    tauri::async_runtime::spawn_blocking(move || orch::dispatch_ticket(&app, title, task, project, repo, model, orch::Pipe { base, ticket, validate: validate.unwrap_or_default(), plan: plan.unwrap_or(false), skill: skill.unwrap_or_default() })).await.map_err(|e| e.to_string())?
}
#[tauri::command]
fn orch_message(app: AppHandle, key: String, text: String) -> Result<(), String> { orch::pipe_message(&app, &key, &text) }
#[tauri::command]
fn orch_answer(app: AppHandle, key: String, answer: String) -> Option<orch::Worker> { orch::set_answer(&app, &key, answer) }
#[tauri::command]
async fn orch_ask_report(app: AppHandle, key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || orch::ask_report(&app, &key)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn orch_restart(app: AppHandle, key: String) -> Result<orch::Worker, String> {
    tauri::async_runtime::spawn_blocking(move || orch::restart(&app, &key)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn orch_pr(app: AppHandle, key: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || orch::pr_status(&app, &key)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
fn orch_board(app: AppHandle, key: String, mark: String) -> Option<orch::Worker> { orch::set_board(&app, &key, mark) }

/// A conversation closes: remove the worktrees it made that are safe to remove (see worktrees::remove). The ones
/// kept stay linked, a next close tries again. Returns {removed, kept}.
#[tauri::command]
async fn drop_worktrees(app: AppHandle, state: State<'_, App>, project: String) -> Result<Value, String> {
    let Some(paths) = state.worktrees.lock().unwrap().get(&project).cloned() else { return Ok(json!({"removed": 0, "kept": 0})) };
    let path = state.path.clone();
    let (removed, kept) = tauri::async_runtime::spawn_blocking(move || worktrees::remove(&paths, &path)).await.map_err(|e| e.to_string())?;
    let mut w = state.worktrees.lock().unwrap();
    if kept.is_empty() { w.remove(&project); } else { w.insert(project, kept.clone()); }
    save_worktrees(&app, &w);
    Ok(json!({"removed": removed, "kept": kept.len()}))
}

/// What a conversation changed, per repo (changes.rs): the repos of the files its tool calls wrote (`paths`) and the
/// worktrees it made. In a checkout it did not make (the vault, a shared repo) only the files it wrote show, else the
/// drawer holds every other session's uncommitted work too. Files outside a git checkout do not show.
#[tauri::command]
async fn conversation_changes(state: State<'_, App>, key: String, paths: Vec<String>) -> Result<Value, String> {
    let made = state.worktrees.lock().unwrap().get(&key).cloned().unwrap_or_default();
    let path = state.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut tops: Vec<String> = made.iter().chain(paths.iter()).filter_map(|p| changes::top_of(p, &path)).collect();
        tops.sort();
        tops.dedup();
        let own: Vec<String> = made.iter().filter_map(|p| changes::top_of(p, &path)).collect();
        Value::Array(tops.iter().map(|t| changes::of_repo(t, (!own.contains(t)).then_some(&paths[..]), &path)).collect())
    }).await.map_err(|e| e.to_string())
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
    // on the account a new conversation gets now (Haiku: no model window of its own)
    let mut eb = env_of(&app, &state, p);
    if p.caps().accounts { eb.opts["account"] = json!(account_of(&state, p, "", "haiku")); }
    tauri::async_runtime::spawn_blocking(move || p.title(&eb.env(), &text)).await.map_err(|e| e.to_string())?
}

/// A text written by the agent from `text` and an instruction (`system`): one call on the subscription, without tools,
/// settings, MCP or a transcript, so third-party text in it (a mail) can make it do nothing but write. Today's mail
/// composer drafts and rewrites replies with it; the user edits the result before it is saved anywhere.
#[tauri::command]
async fn ai_write(app: AppHandle, system: String, text: String, provider: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || write_blocking(&app, provider.as_deref(), &system, &text)).await.map_err(|e| e.to_string())?
}
/// A read-only review in the checkout `dir` (AgentProvider::review), the same provider pick as write_blocking.
/// Err("unsupported") when that provider has no review: the caller falls back to write.
pub(crate) fn review_blocking(app: &AppHandle, provider: Option<&str>, dir: &str, system: &str, text: &str) -> Result<String, String> {
    let state = app.state::<App>();
    let p = {
        let on = agents::enabled(&state.settings.lock().unwrap());
        provider.and_then(|a| on.iter().copied().find(|p| p.id() == a && p.caps().write)).or_else(|| on.iter().copied().find(|p| p.caps().write))
    };
    let p = p.ok_or_else(|| trc("err.no_agent"))?;
    let mut eb = env_of(app, &state, p);
    if p.caps().accounts { eb.opts["account"] = json!(account_of(&state, p, "", "")); }
    p.review(&eb.env(), dir, system, text)
}
/// ai_write for Rust callers, blocking: the asked provider when it is on and can write,
/// else the first switched-on one that can.
pub(crate) fn write_blocking(app: &AppHandle, provider: Option<&str>, system: &str, text: &str) -> Result<String, String> {
    let state = app.state::<App>();
    let p = {
        let on = agents::enabled(&state.settings.lock().unwrap());
        provider.and_then(|a| on.iter().copied().find(|p| p.id() == a && p.caps().write)).or_else(|| on.iter().copied().find(|p| p.caps().write))
    };
    let p = p.ok_or_else(|| trc("err.no_agent"))?;
    let mut eb = env_of(app, &state, p);
    if p.caps().accounts { eb.opts["account"] = json!(account_of(&state, p, "", "sonnet")); }
    p.write(&eb.env(), system, text)
}

/// Past messages of a conversation, as agent events, read from the same transcript the terminal uses.
#[tauri::command]
async fn history(app: AppHandle, state: State<'_, App>, project: String) -> Result<Value, String> {
    let Some(s) = state.sids.lock().unwrap().get(&project).cloned() else { return Ok(json!([])) };
    let p = agents::get_or_first(Some(&s.provider));
    // a work machine's conversation: its transcript is there
    if let Some((m, b)) = state.machines.bind_of(&project).and_then(|b| Some((machines::Machines::find(&state.settings.lock().unwrap(), &b.machine)?, b))) {
        let c = state.machines.client(&m);
        return tauri::async_runtime::spawn_blocking(move || c.history(&s.sid, 0, &b.cwd).map(|(items, _)| items)).await.map_err(|e| e.to_string())?;
    }
    Ok(json!(p.history(&env_of(&app, &state, p).env(), &s.sid, 0).0))
}

/// "Nieuw gesprek": stop the process and forget the session, the next message starts fresh.
#[tauri::command]
fn reset(app: AppHandle, state: State<App>, project: String) {
    if let Some(mut p) = state.procs.lock().unwrap().remove(&project) { p.child.kill().ok(); }
    state.machines.unbind(&project); // a fresh start goes where the composer or the default says now
    orch::unmark(&app, &project); // a fresh session holds no stranger's text
    let mut sids = state.sids.lock().unwrap();
    sids.remove(&project);
    save_sids(&app, &sids);
}

/// Hang a conversation under another key, e.g. a general chat that turned out to be about a
/// project. Only while idle: the process stops and the next message resumes it under the new key.
#[tauri::command]
fn move_chat(app: AppHandle, state: State<App>, from: String, to: String) -> Result<(), String> {
    if let Some(mut p) = state.procs.lock().unwrap().remove(&from) { p.child.kill().ok(); }
    state.machines.rebind(&from, &to);
    let mut sids = state.sids.lock().unwrap();
    if let Some(sid) = sids.remove(&from) { sids.insert(to.clone(), sid); }
    save_sids(&app, &sids);
    let mut w = state.worktrees.lock().unwrap();
    if let Some(paths) = w.remove(&from) { w.insert(to, paths); save_worktrees(&app, &w); }
    Ok(())
}

/// Moves a conversation between this Mac and a work machine (`to`: "" this Mac, else a machine id), between two turns:
/// its agent stops, its transcript goes along with the vault's paths rewritten (machines::rewrite), and the next
/// message resumes the session there. A conversation that read mail stays on this Mac. What is only on one side (work
/// not committed in a repo there) does not move: back to this Mac, a repo there of the project it is `about` with work
/// not pushed is refused first (machine_git::before_move), until `choice` says to push it or to move anyway.
#[tauri::command]
async fn move_conversation(app: AppHandle, key: String, to: String, mail: bool, about: Option<String>, choice: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || move_to(&app, &key, &to, mail, about.as_deref(), choice.as_deref())).await.map_err(|e| e.to_string())?
}
fn move_to(app: &AppHandle, key: &str, to: &str, mail: bool, about: Option<&str>, choice: Option<&str>) -> Result<(), String> {
    let state = app.state::<App>();
    let sess = state.sids.lock().unwrap().get(key).cloned().ok_or_else(|| trc("err.move_no_session"))?;
    if !agents::get(&sess.provider).is_ok_and(|p| p.caps().remote) { return Err(trc("err.move_only_claude")); }
    let from = state.machines.bind_of(key);
    if from.as_ref().map_or("", |b| b.machine.as_str()) == to { return Ok(()); }
    {
        let procs = state.procs.lock().unwrap();
        let x = procs.get(key);
        if !to.is_empty() && (mail || x.is_some_and(|x| x.tainted)) { return Err(trc("err.machine_mail")); }
        let card = pending::list(&pending_dir(app)).into_iter().chain(state.machines.pending()).any(|c| c["project"] == key);
        if x.is_some_and(|x| x.turns.busy()) || card { return Err(trc("err.move_busy")); }
    }
    let settings = state.settings.lock().unwrap().clone();
    let vault = need_vault(&state)?;
    let find = |id: &str| machines::Machines::find(&settings, id).ok_or_else(|| trc("err.no_machine"));
    let up = |m: &Value| state.machines.info(m).map_err(|e| trc_v("err.machine_down", &format!("{}: {e}", m["name"].as_str().unwrap_or(""))));
    let p: &'static dyn AgentProvider = &agent_claude::PROVIDER;
    // this Mac's transcript folder for the session, on the account it was recorded on
    let here = || { let mut eb = env_of(app, &state, p); eb.opts["account"] = json!(sess.account); eb };
    let mac = [vault.clone(), format!("{}/.claude/projects/{}/memory", home(), agent_claude::slug(&vault))];
    // work in a repo there stays there: asked about (or pushed) while the agent still runs, so nothing changed yet
    if let (Some(b), true, Some(a)) = (&from, to.is_empty(), about) {
        let m = find(&b.machine)?;
        machine_git::before_move(&state.machines.client(&m), &m, &up(&m)?, &machine_git::project_repos(&vault, a), choice)?;
    }
    // the agent stops first, so the transcript is complete; a failed move leaves the conversation where it was
    if let Some(mut x) = state.procs.lock().unwrap().remove(key) { x.child.kill().ok(); }
    let (data, roots) = match &from {
        None => (fs::read(PathBuf::from(agent_claude::transcripts_of(&here().env(), &sess.sid)).join(format!("{}.jsonl", sess.sid))).map_err(|e| format!("transcript: {e}"))?, mac.clone()),
        Some(b) => { let m = find(&b.machine)?; let info = up(&m)?; (state.machines.client(&m).session_get(&sess.sid)?, machines::roots_on(&info)) }
    };
    let text = String::from_utf8(data).map_err(|_| "transcript: not UTF-8".to_string())?;
    if to.is_empty() {
        let text = machines::rewrite(&text, &roots, &mac);
        let to = PathBuf::from(agent_claude::transcripts(&here().env())).join(format!("{}.jsonl", sess.sid));
        relay_remote::sync::write_atomic(&to, text.as_bytes(), None).map_err(|e| format!("transcript: {e}"))?;
        state.machines.unbind(key);
    } else {
        let m = find(to)?;
        let info = up(&m)?;
        let cwd = machines::cwd_or_vault(String::new(), &info);
        let text = machines::rewrite(&text, &roots, &machines::roots_on(&info));
        state.machines.client(&m).session_put(&sess.sid, &cwd, text.as_bytes())?;
        state.machines.set_bind(key, machines::Bind { machine: to.into(), cwd });
    }
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

/// When the user wrote in each of these Claude Code sessions on `date` (YYYY-MM-DD, local day), in ms: the base of "Time
/// from sessions". Other providers and a work machine's sessions are not read; a session without that day is left out.
#[tauri::command]
async fn activity(app: AppHandle, state: State<'_, App>, date: String, sessions: Vec<String>) -> Result<HashMap<String, Vec<i64>>, String> {
    use chrono::{Local, NaiveDate, TimeZone};
    let day = NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|e| e.to_string())?;
    let midnight = |d: NaiveDate| Local.from_local_datetime(&d.and_hms_opt(0, 0, 0).unwrap()).earliest().map(|t| t.timestamp_millis());
    let from = midnight(day).ok_or("bad date")?;
    let to = day.succ_opt().and_then(midnight).ok_or("bad date")?; // the next local midnight, so a DST day is 23 or 25 hours
    let p: &'static dyn AgentProvider = &agent_claude::PROVIDER;
    let env = env_of(&app, &state, p);
    let files: Vec<(String, PathBuf)> = sessions.into_iter().filter(|s| agent_core::safe_id(s))
        .map(|s| { let f = PathBuf::from(agent_claude::transcripts_of(&env.env(), &s)).join(format!("{s}.jsonl")); (s, f) }).collect();
    tauri::async_runtime::spawn_blocking(move || files.into_iter().filter_map(|(sid, f)| {
        // a transcript last written before the day has nothing in it
        if fs::metadata(&f).and_then(|m| m.modified()).ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() < from as u128 { return None; }
        let at: Vec<i64> = agent_claude::stream::user_times(&fs::read_to_string(&f).ok()?).iter()
            .filter_map(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).map(|t| t.timestamp_millis()).filter(|t| (from..to).contains(t)).collect();
        (!at.is_empty()).then_some((sid, at))
    }).collect()).await.map_err(|e| e.to_string())
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

/// A subagent's transcript from byte offset `from`, read-only: `{items, next}` like `history_sid`.
#[tauri::command]
fn agent_history(app: AppHandle, state: State<App>, key: String, id: String, from: Option<u64>) -> Value {
    let Some((p, sid)) = sid_of(&state, &key) else { return json!({"items": [], "next": 0}) };
    let (items, next) = p.agent_history(&env_of(&app, &state, p).env(), &sid, &id, from.unwrap_or(0));
    json!({"items": items, "next": next})
}

#[tauri::command]
fn running(state: State<App>) -> HashMap<String, u32> {
    state.procs.lock().unwrap().iter().map(|(key, proc)| (key.clone(), proc.turns.count())).collect()
}

/// The open permission requests and questions of every provider.
#[tauri::command]
fn pending(app: AppHandle, state: State<App>) -> Vec<Value> {
    // the work machines' cards as their poller last saw them (machines.rs), after this Mac's own
    let mut list = pending::list(&pending_dir(&app));
    list.extend(state.machines.pending());
    list
}

/// The user's decision. A provider that raised the request in its own protocol gets it over stdin.
#[tauri::command]
fn answer(app: AppHandle, state: State<App>, id: String, decision: Value) -> Result<(), String> {
    if !pending::valid_id(&id) { return Err("bad id".into()); }
    let dir = pending_dir(&app);
    let req = pending::read(&dir, &id);
    // a card of a work machine: its permission tool waits for the answer file there
    if req.is_none() {
        if let Some(m) = state.machines.pending_owner(&id).and_then(|m| machines::Machines::find(&state.settings.lock().unwrap(), &m)) {
            state.machines.client(&m).answer(&id, &decision)?;
            state.machines.seen.lock().unwrap().values_mut().for_each(|s| s.pending.retain(|x| x["id"] != id.as_str()));
            return Ok(());
        }
    }
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
/// Not the ones this Mac's relay-server runs for other devices (This Mac as a machine): they are those devices'
/// conversations, their transcripts sealed in the mirror, so here they could only show as a terminal nobody can follow.
#[tauri::command]
fn agents(app: AppHandle, state: State<App>) -> Value {
    let on = agents::enabled(&state.settings.lock().unwrap());
    let server_work = relay_server::data_dir().join("work");
    let ps = Command::new("/bin/ps").args(["-axo", "pid=,ppid=,command="]).output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
    let ours = under_broker(&ps);
    let mut out = vec![];
    for p in on.into_iter().filter(|p| p.caps().background) {
        for mut a in p.sessions(&env_of(&app, &state, p).env()) {
            if runs_for_server(&a, &server_work) { continue; }
            a["provider"] = json!(p.id());
            // the app's own process is listed before its session id reaches app_sids: marked, so the sidebar does not
            // show it as a terminal session meanwhile. It stays in the list, syncBusy reads its busy state after a restart.
            if a["pid"].as_i64().is_some_and(|pid| ours.contains(&pid)) { a["app"] = json!(true); }
            out.push(a);
        }
    }
    json!(out)
}
/// The pids whose parent is a `relay --broker` (the agents the app runs), from `ps -axo pid=,ppid=,command=`.
fn under_broker(ps: &str) -> std::collections::HashSet<i64> {
    let rows: Vec<(i64, i64, bool)> = ps.lines().filter_map(|l| {
        let mut w = l.split_whitespace();
        Some((w.next()?.parse().ok()?, w.next()?.parse().ok()?, w.any(|x| x == "--broker")))
    }).collect();
    let brokers: std::collections::HashSet<i64> = rows.iter().filter(|r| r.2).map(|r| r.0).collect();
    rows.iter().filter(|r| brokers.contains(&r.1)).map(|r| r.0).collect()
}
// ponytail: by cwd, so a server conversation started in a repo outside the mirror still shows; its parent process
// (`relay --broker`) would catch that too
fn runs_for_server(agent: &Value, server_work: &std::path::Path) -> bool {
    agent["cwd"].as_str().is_some_and(|cwd| std::path::Path::new(cwd).starts_with(server_work))
}

/// The shell command that continues a conversation in a terminal, external or embedded (pty.rs). The app's own
/// process for it stops first, so two processes never write the same session.
fn terminal_cmd(app: &AppHandle, state: &App, project: &str, session: Option<String>, name: Option<String>) -> Result<String, String> {
    if let Some(b) = state.machines.bind_of(project) {
        let m = machines::Machines::find(&state.settings.lock().unwrap(), &b.machine).map(|m| m["name"].as_str().unwrap_or("").to_string()).unwrap_or_default();
        return Err(trc_v("err.machine_terminal", &m));
    }
    if let Some(mut p) = state.procs.lock().unwrap().remove(project) { p.child.kill().ok(); }
    need_vault(state)?;
    let p = provider_of(state, project, None);
    let eb = env_of(app, state, p);
    let sid = session.or_else(|| state.sids.lock().unwrap().get(project).map(|s| s.sid.clone()));
    sid.as_deref().and_then(|s| p.terminal(&eb.env(), Terminal::Resume(s)))
        .or_else(|| p.terminal(&eb.env(), Terminal::New(name.as_deref().unwrap_or(project))))
        .ok_or_else(|| trc_v("err.agent_terminal", p.name()))
}

/// Continue a conversation in iTerm.
#[tauri::command]
fn open_terminal(app: AppHandle, state: State<App>, project: String, session: Option<String>, name: Option<String>) -> Result<(), String> {
    let cmd = terminal_cmd(&app, &state, &project, session, name)?;
    in_terminal(&state, &cmd)
}

/// Background sessions of a provider (not started by the app): step into one in iTerm, or stop it.
#[tauri::command]
fn bg(app: AppHandle, state: State<App>, action: String, id: String, provider: Option<String>) -> Result<(), String> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { return Err("bad id".into()); }
    let p = agents::get_or_first(provider.as_deref());
    let eb = env_of(&app, &state, p);
    match action.as_str() {
        "stop" => p.stop_background(&eb.env(), &id),
        "attach" => in_terminal(&state, &p.terminal(&eb.env(), Terminal::Attach(&id)).ok_or_else(|| trc_v("err.agent_terminal", p.name()))?),
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
            "caps": p.caps(), "textOnly": p.text_only_commands(), "detect": p.detect(&eb.env()), "models": p.models(), "efforts": p.efforts(), "bin": eb.bin, "defaultBin": p.default_bin(&eb.home)})).collect();
        json!({"default": agents::default_id(&s), "providers": list})
    }).await.map_err(|e| e.to_string())
}

/// Provider-specific discovery in the active vault; only commands executable by Relay are returned.
#[tauri::command]
async fn agent_commands(app: AppHandle, state: State<'_, App>, provider: String) -> Result<Value, String> {
    need_vault(&state)?;
    let p = agents::PROVIDERS.iter().copied().find(|p| p.id() == provider).ok_or("unknown provider")?;
    let eb = env_of(&app, &state, p);
    tauri::async_runtime::spawn_blocking(move || {
        let commands = p.commands(&eb.env());
        if commands.is_array() { commands } else { json!([]) }
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
        // every account's, so auto-switch knows which are used up; the view shows the one a new conversation gets
        let (list, names) = {
            let s = state.settings.lock().unwrap();
            let c = &s["agents"]["providers"][p.id()];
            let names: HashMap<String, String> = c["accounts"].as_array().into_iter().flatten()
                .filter_map(|a| Some((a["dir"].as_str()?.to_string(), a["name"].as_str()?.to_string()))).collect();
            (agents::accounts(&s, p), names)
        };
        let mut accounts = vec![];
        for acct in &list {
            let k = limit_key(p, acct);
            let cached = state.limits.lock().unwrap().get(&k).filter(|(at, _)| usage::now_ms() - at < 60_000).map(|(_, v)| v.clone());
            let v = match cached {
                Some(v) => v,
                None => {
                    let mut eb = env_of(&app, &state, p);
                    if p.caps().accounts { eb.opts["account"] = json!(acct); }
                    let v = tauri::async_runtime::spawn_blocking(move || p.limits(&eb.env()).json()).await.unwrap_or_else(|_| json!({"ok": false, "reason": "unavailable"}));
                    state.limits.lock().unwrap().insert(k.clone(), (usage::now_ms(), v.clone()));
                    // limits that read again: a refused turn no longer counts, unless a window is still full
                    if v["ok"] == true { state.spent.lock().unwrap().remove(&k); }
                    v
                }
            };
            accounts.push(json!({"dir": acct, "name": names.get(acct), "limits": v}));
        }
        let now = account_of(&state, p, "", "");
        let shown = accounts.iter().find(|a| a["dir"] == now.as_str()).unwrap_or(&accounts[0])["limits"].clone();
        out.push(json!({"provider": p.id(), "limits": shown, "accounts": if list.len() > 1 { json!(accounts) } else { json!(null) }}));
    }
    Ok(json!(out))
}

/// The page's own colour scheme, set on the web view alone (the theme switch, src/infrastructure/window.ts): WebKit
/// repaints the page while the window, and the sidebar material with it, keeps the old one until setTheme.
/// None hands the web view back to the window's appearance. Resolves once it is set.
#[tauri::command]
async fn webview_theme(webview: tauri::Webview, theme: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let (done, set) = tokio::sync::oneshot::channel();
        webview
            .with_webview(move |w| {
                use objc2_app_kit::{NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSView};
                // SAFETY: inner() is the WKWebView, an NSView, and this runs on the main thread
                let view = unsafe { &*w.inner().cast::<NSView>() };
                let name = theme.map(|t| unsafe { if t == "dark" { NSAppearanceNameDarkAqua } else { NSAppearanceNameAqua } });
                view.setAppearance(name.and_then(NSAppearance::appearanceNamed).as_deref());
                let _ = done.send(());
            })
            .map_err(|e| e.to_string())?;
        set.await.map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (webview, theme);
    Ok(())
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
    if let Err(e) = providers::check(&s).and_then(|_| agents::check(&s)).and_then(|_| plugins::check(&s)) { set_cur_lang(was); return Err(e); }
    let owners: Vec<&str> = s["github"]["owners"].as_str().unwrap().split([' ', ',']).filter(|o| !o.is_empty()).collect();
    if owners.len() > 10 || !owners.iter().all(|o| o.len() <= 39 && o.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')) {
        return Err(tr(lang, "err.gh_owners"));
    }
    if !mail_settings_ok(&s["mail"]) { return Err(tr(lang, "err.mail_account")); }
    fs::write(data_dir(&app).join("settings.json"), serde_json::to_string_pretty(&s).unwrap()).map_err(|e| e.to_string())?;
    app.emit("settings-changed", &s).ok(); // the main window follows a change made in the settings window
    let relang = ui_lang_of(&state.settings.lock().unwrap()) != lang;
    *state.settings.lock().unwrap() = s.clone();
    plugins::sync(&app); // a plugin switched off or removed stops
    anywhere::apply(&app); // the shortcut follows Settings › Voice
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

/// A file for a provider's storage (providers::upload), from the webview as base64. 50 MB at most.
#[tauri::command]
async fn integration_upload(provider: String, url: String, fields: serde_json::Map<String, Value>, name: String, mime: String, data: String) -> Result<String, String> {
    use base64::Engine;
    let p = providers::get(&provider)?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    if bytes.len() > 50_000_000 { return Err(format!("{name}: > 50 MB")); }
    tauri::async_runtime::spawn_blocking(move || providers::upload(p, &url, &fields, &name, &mime, &bytes)).await.map_err(|e| e.to_string())?
}

/// A picture's preview for a card panel (providers::thumb), as a data URL.
#[tauri::command]
async fn integration_thumb(provider: String, url: String) -> Result<String, String> {
    let p = providers::get(&provider)?;
    tauri::async_runtime::spawn_blocking(move || providers::thumb(p, &url)).await.map_err(|e| e.to_string())?
}

/// A picture at full size in Relay's viewer window, one window that each picture reuses. Only a URL the provider's
/// `original` allows. The window loads the tracker's page as a browser would: its login once, then the picture. A
/// remote page gets no IPC, and no capability names this window.
#[tauri::command]
fn open_viewer(app: AppHandle, provider: String, url: String, name: String) -> Result<(), String> {
    let p = providers::get(&provider)?;
    let url = providers::original(p, &url)?;
    if let Some(w) = app.get_webview_window("viewer") {
        w.navigate(url).map_err(|e| e.to_string())?;
        w.set_title(&name).ok();
        w.set_focus().ok();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(&app, "viewer", tauri::WebviewUrl::External(url))
        .title(name).inner_size(1000.0, 760.0).min_inner_size(320.0, 240.0).build().map_err(|e| e.to_string())?;
    Ok(())
}

/// A board provider's credentials from Claude Code's MCP config (board_core::from_claude): ~/.claude.json for the user
/// and for the vault as a project, and the vault's .mcp.json.
fn claude_creds(state: &App, p: &providers::Provider) -> Option<(Vec<(String, String)>, serde_json::Map<String, Value>)> {
    let cfg: Value = fs::read_to_string(format!("{}/.claude.json", home())).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
    let v = vault(state);
    let mcp: Value = fs::read_to_string(format!("{v}/.mcp.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
    board_core::from_claude(p, &cfg, &v, &mcp)
}
/// Whether the provider can take its credentials from Claude Code, and whether Claude Code has them; the settings
/// window offers the import when it finds them for an integration that is not set up.
#[tauri::command]
fn integration_mcp(state: State<App>, provider: String) -> Result<Value, String> {
    let p = providers::get(&provider)?;
    Ok(json!({"supported": p.mcp.is_some(), "found": p.mcp.is_some() && claude_creds(&state, p).is_some()}))
}
/// Take the credentials over: the secrets into the keychain, the config fields back for the settings window to save.
#[tauri::command]
fn integration_import(state: State<App>, provider: String) -> Result<Value, String> {
    let p = providers::get(&provider)?;
    let (secrets, fields) = claude_creds(&state, p).ok_or_else(|| trc_v("err.no_import", p.name))?;
    for (account, value) in &secrets { providers::set_token(p, account, value)?; }
    Ok(Value::Object(fields))
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
/// repo -> note name, from the brain's index/repos.json.
fn repo_index(vault: &str) -> HashMap<String, String> { repo_checkouts(vault).into_iter().map(|(r, (_, n))| (r, n)).collect() }
/// repo -> its checkout on this Mac and the note it belongs to, from the brain's index/repos.json.
fn repo_checkouts(vault: &str) -> HashMap<String, (String, String)> {
    let Some(idx) = brain(vault).and_then(|b| fs::read_to_string(format!("{b}/index/repos.json")).ok())
        .and_then(|s| serde_json::from_str::<serde_json::Map<String, Value>>(&s).ok()) else { return HashMap::new() };
    let named: Vec<(String, String)> = idx.iter().filter_map(|(d, n)| Some((d.clone(), n.as_str()?.rsplit('/').next()?.trim_end_matches(".md").to_string()))).collect();
    checkouts_in(&named)
}
/// An entry is a checkout or a folder of checkouts, a checkout listed by itself wins over the same one found inside a
/// listed folder.
fn checkouts_in(named: &[(String, String)]) -> HashMap<String, (String, String)> {
    let mut out = HashMap::new();
    for (d, n) in named { if let Some(r) = gh_repo(d) { out.insert(r, (d.clone(), n.clone())); } }
    // two levels down, not into a checkout: web-projecten keeps its sites in repos/<site>
    fn scan(d: &str, depth: u8, n: &str, out: &mut HashMap<String, (String, String)>) {
        if let Some(r) = gh_repo(d) { out.entry(r).or_insert_with(|| (d.to_string(), n.to_string())); return; }
        if depth == 0 { return; }
        for e in fs::read_dir(d).into_iter().flatten().flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())) {
            scan(&e.path().to_string_lossy(), depth - 1, n, out);
        }
    }
    for (d, n) in named { if gh_repo(d).is_none() { scan(d, 2, n, &mut out); } }
    out
}

// ---------- the Brain view: the vault and the Commonwealth brains, browsed, searched and drawn (related.rs, brain.rs)

/// Where the note indexes live, one file per folder. The single related.db of older versions goes.
fn index_dir(app: &AppHandle) -> PathBuf {
    let d = data_dir(app);
    fs::remove_file(d.join("related.db")).ok();
    d.join("index")
}
/// The folders the Brain view may read: the vault, then every brain the vault's projects resolve to (none when
/// Commonwealth is off). [(canonical path, name, "vault" | "brain")]; the frontend names a root by its path.
fn brain_roots_of(state: &App) -> Result<Vec<(String, String, &'static str)>, String> {
    let v = vault::canon(&need_vault(state)?);
    let name = commonwealth::brain_name(&v).to_string();
    let mut brains: Vec<String> = cw_brains(state).into_values().flatten().map(|b| vault::canon(&b)).collect();
    brains.sort();
    brains.dedup();
    Ok(std::iter::once((v, name, "vault")).chain(brains.into_iter().map(|b| { let n = commonwealth::brain_name(&b).to_string(); (b, n, "brain") })).collect())
}
/// A root the frontend sent, if it is one of brain_roots_of: nothing else is read.
fn brain_root(state: &App, root: &str) -> Result<String, String> {
    brain_roots_of(state)?.into_iter().map(|r| r.0).find(|r| r == root).ok_or_else(|| "not a brain of this vault".into())
}
#[tauri::command]
fn brain_roots(state: State<App>) -> Result<Value, String> {
    Ok(json!(brain_roots_of(&state)?.into_iter().map(|(id, name, kind)| json!({"id": id, "name": name, "kind": kind})).collect::<Vec<_>>()))
}
/// Every note of a root and the links between them (related::graph).
#[tauri::command]
async fn brain_graph(app: AppHandle, state: State<'_, App>, root: String) -> Result<Value, String> {
    let root = brain_root(&state, &root)?;
    let dir = index_dir(&app);
    tauri::async_runtime::spawn_blocking(move || related::graph(&dir, &root)).await.map_err(|e| e.to_string())?
}
/// The notes of a root that match what was typed, [{path, title, snippet}].
#[tauri::command]
async fn brain_search(app: AppHandle, state: State<'_, App>, root: String, query: String) -> Result<Value, String> {
    let root = brain_root(&state, &root)?;
    let dir = index_dir(&app);
    tauri::async_runtime::spawn_blocking(move || related::find(&dir, &root, &query, 60)).await.map_err(|e| e.to_string())?.map(Value::from)
}
/// One note of a root, {path, text}; vault::note keeps the read inside the root.
#[tauri::command]
fn brain_note(state: State<App>, root: String, path: String) -> Result<Value, String> {
    let root = brain_root(&state, &root)?;
    vault::note(&root, &path).map(|(path, text)| json!({"path": path, "text": text})).ok_or_else(|| tr_v(ui_lang_of(&state.settings.lock().unwrap()), "err.note", &path))
}
/// The notes Relay's Claude Code conversations read and wrote in the last `days`, in every root:
/// [{key, root, path, at, kind}]. Only transcripts written in that window are opened.
#[tauri::command]
async fn brain_touches(app: AppHandle, state: State<'_, App>, days: u32) -> Result<Value, String> {
    let roots: Vec<String> = brain_roots_of(&state)?.into_iter().map(|r| r.0).collect();
    let since = chrono::Utc::now().timestamp_millis() - days.min(60) as i64 * 86_400_000;
    let p: &'static dyn AgentProvider = &agent_claude::PROVIDER;
    let env = env_of(&app, &state, p);
    let files: Vec<(String, PathBuf)> = state.sids.lock().unwrap().iter().filter(|(_, s)| s.provider == p.id() && agent_core::safe_id(&s.sid))
        .map(|(k, s)| (k.clone(), PathBuf::from(agent_claude::transcripts_of(&env.env(), &s.sid)).join(format!("{}.jsonl", s.sid)))).collect();
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = vec![];
        for (key, f) in files {
            let fresh = fs::metadata(&f).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).is_some_and(|d| d.as_millis() as i64 >= since);
            if !fresh { continue; }
            let Ok(text) = fs::read_to_string(&f) else { continue };
            out.extend(brain::touches(&text, &roots, since).iter().map(|t| brain::touch_json(&key, t)));
        }
        Value::from(out)
    }).await.map_err(|e| e.to_string())
}

// ---------- Commonwealth (commonwealth.rs): detected, never configured; on when the Claude Code plugin is installed

fn claude_bin(app: &AppHandle, state: &App) -> String { env_of(app, state, &agent_claude::PROVIDER).bin }
/// Switched off in Settings › Integrations: no brain for a session, no review queue. On unless set to false.
fn cw_on(state: &App) -> bool { state.settings.lock().unwrap()["integrations"]["commonwealth"]["on"] != false }
/// The brains the vault's projects resolve to, by project; the only ones the review queue touches. None when off.
fn cw_brains(state: &App) -> std::collections::BTreeMap<String, Option<String>> {
    if !cw_on(state) { return Default::default(); }
    commonwealth::brains(&home(), &repo_projects(&vault(state)))
}
/// Plugin installed and on, the CLI if found, the install hint, and the brain per project.
#[tauri::command]
async fn commonwealth_status(app: AppHandle, state: State<'_, App>) -> Result<Value, String> {
    let (bin, path) = (claude_bin(&app, &state), state.path.clone());
    let plugin = tauri::async_runtime::spawn_blocking(move || commonwealth::plugin_on(&bin, &path)).await.map_err(|e| e.to_string())?;
    let projects: Vec<Value> = cw_brains(&state).into_iter().map(|(p, b)| json!({"project": p, "brain": b, "name": b.as_deref().map(commonwealth::brain_name)})).collect();
    Ok(json!({"plugin": plugin, "cli": in_path(&state, "commonwealth"), "hint": commonwealth::CLI_HINT, "projects": projects}))
}
/// Add the marketplace and install the plugin; the CLI's own error text on a failure.
#[tauri::command]
async fn commonwealth_install(app: AppHandle, state: State<'_, App>) -> Result<(), String> {
    let (bin, path) = (claude_bin(&app, &state), state.path.clone());
    tauri::async_runtime::spawn_blocking(move || commonwealth::install(&bin, &path)).await.map_err(|e| e.to_string())?
}
/// The staged notes of every brain a project resolves to, each with its brain.
#[tauri::command]
fn commonwealth_notes(state: State<App>) -> Value {
    let mut brains: Vec<String> = cw_brains(&state).into_values().flatten().collect();
    brains.sort();
    brains.dedup();
    json!(brains.iter().flat_map(|b| commonwealth::staged(b)).collect::<Vec<_>>())
}
/// Promote or reject staged notes of a brain, through the CLI. Only for a brain the vault's projects resolve to.
#[tauri::command]
async fn commonwealth_act(state: State<'_, App>, brain: String, verb: String, ids: Vec<String>) -> Result<(), String> {
    if !["promote", "reject"].contains(&verb.as_str()) || ids.is_empty() || !ids.iter().all(|i| !i.starts_with('-') && i.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')) { return Err("bad request".into()); }
    if !cw_brains(&state).values().flatten().any(|b| *b == brain) { return Err("not a brain of this vault".into()); }
    let cli = in_path(&state, "commonwealth").ok_or_else(|| format!("commonwealth not found: {}", commonwealth::CLI_HINT))?;
    let path = state.path.clone();
    tauri::async_runtime::spawn_blocking(move || commonwealth::act(&cli, &path, &brain, &verb, &ids)).await.map_err(|e| e.to_string())?
}

/// Join a team brain: `commonwealth join <remote>`, its report or its error.
#[tauri::command]
async fn commonwealth_join(state: State<'_, App>, remote: String) -> Result<String, String> {
    let cli = in_path(&state, "commonwealth").ok_or_else(|| format!("commonwealth not found: {}", commonwealth::CLI_HINT))?;
    let path = state.path.clone();
    tauri::async_runtime::spawn_blocking(move || commonwealth::join(&cli, &path, &remote)).await.map_err(|e| e.to_string())?
}

/// The GitHub login gh is signed in with, the settings window shows it.
#[tauri::command]
async fn github_status(state: State<'_, App>) -> Result<String, String> {
    Ok(gh(&state, &["api", "user", "--jq", ".login"])?.trim().to_string())
}

const PR_FIELDS: &str = "... on PullRequest{number title url isDraft createdAt updatedAt headRefName repository{nameWithOwner} author{login} reviewDecision commits(last:1){nodes{commit{statusCheckRollup{state}}}}}";

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
                "updated": n["updatedAt"], "branch": n["headRefName"], "author": n["author"]["login"], "review": n["reviewDecision"],
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

/// `owner/repo` split and checked: letters, digits, - _ . only.
fn repo_parts(repo: &str) -> Result<(String, String), String> {
    let ok = |s: &str| !s.is_empty() && s.len() <= 100 && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    repo.split_once('/').filter(|(o, n)| ok(o) && ok(n)).map(|(o, n)| (o.to_string(), n.to_string())).ok_or_else(|| trc("err.bad_repo"))
}

/// The files a PR changes with their patch (unified diff hunks), for the review screen.
// ponytail: one page of 100 files, a PR bigger than that shows its first 100
#[tauri::command]
async fn github_pr_files(state: State<'_, App>, repo: String, number: u32) -> Result<Value, String> {
    let (owner, name) = repo_parts(&repo)?;
    let out = gh(&state, &["api", &format!("repos/{owner}/{name}/pulls/{number}/files?per_page=100")])?;
    let v: Value = serde_json::from_str(&out).map_err(|e| format!("gh: {e}"))?;
    Ok(json!(v.as_array().into_iter().flatten().map(|f| json!({
        "path": f["filename"], "status": f["status"], "additions": f["additions"], "deletions": f["deletions"], "patch": f["patch"],
    })).collect::<Vec<_>>()))
}

/// Post a review on a PR: the verdict, the summary and the line comments. The one write to GitHub Relay makes, and
/// only after the user confirmed it in the app (the review screen's dialog says who will see it).
#[tauri::command]
async fn github_pr_review(state: State<'_, App>, repo: String, number: u32, event: String, body: String, comments: Vec<Value>) -> Result<(), String> {
    let (owner, name) = repo_parts(&repo)?;
    if !["APPROVE", "REQUEST_CHANGES", "COMMENT"].contains(&event.as_str()) { return Err(format!("unknown review event {event}")); }
    if body.len() > 65_000 || comments.len() > 100 { return Err("review too large".into()); }
    let comments = comments.iter().map(|c| {
        let path = c["path"].as_str().filter(|p| !p.is_empty() && p.len() <= 1000).ok_or("comment path")?;
        let line = c["line"].as_u64().filter(|l| *l > 0).ok_or("comment line")?;
        let side = c["side"].as_str().filter(|s| ["LEFT", "RIGHT"].contains(s)).unwrap_or("RIGHT");
        let text = c["body"].as_str().filter(|b| !b.trim().is_empty() && b.len() <= 65_000).ok_or("comment text")?;
        Ok(json!({ "path": path, "line": line, "side": side, "body": text }))
    }).collect::<Result<Vec<_>, &str>>()?;
    let input = json!({ "event": event, "body": body, "comments": comments }).to_string();
    let bin = in_path(&state, "gh").ok_or_else(|| trc("err.no_gh"))?;
    let mut child = Command::new(bin).args(["api", "-X", "POST", &format!("repos/{owner}/{name}/pulls/{number}/reviews"), "--input", "-"])
        .env("PATH", &state.path).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    child.stdin.take().ok_or("gh stdin")?.write_all(input.as_bytes()).map_err(|e| e.to_string())?;
    let o = child.wait_with_output().map_err(|e| e.to_string())?;
    if o.status.success() { Ok(()) } else { Err(format!("gh: {}", String::from_utf8_lossy(&o.stderr).trim())) }
}

// ---------- Mail: IMAP (Gmail or any server) in mail/, the app password stays in the macOS keychain.
// Listing and reading never change a flag (EXAMINE and BODY.PEEK). The writes are read/unread and, with the
// experimental flag on, archive/trash, all on the user's click. Nothing here sends: a reply only becomes a draft.

/// A configured account by email, "" for the one the sidebar shows (chosen in the settings, else the first).
fn mail_acct(state: &App, want: &str) -> Result<mail::Account, String> {
    let s = state.settings.lock().unwrap();
    let want = if want.is_empty() { s["mail"]["account"].as_str().unwrap_or("") } else { want };
    mail::pick_account(&mail::accounts(&s["mail"]), want).ok_or_else(|| trc("err.no_mail_account"))
}

/// One page of 50 mails from one account's inbox, page 1 is the newest. The window merges the accounts.
#[tauri::command]
async fn mail_list(state: State<'_, App>, account: String, page: u32) -> Result<Value, String> {
    let a = mail_acct(&state, &account)?;
    state.mail.list(&a, page.clamp(1, 1000), mail_experimental(&state)).await
}

/// One mail for the panel: its text, the sanitized HTML as a srcdoc document (or null), the attachments.
#[tauri::command]
async fn mail_read(state: State<'_, App>, account: String, id: String) -> Result<Value, String> {
    let a = mail_acct(&state, &account)?;
    state.mail.open(&a, &id).await
}

/// Today's mail detail: a mail's whole thread, its reply headers (`read` with `headers`), or a draft saved in Drafts.
/// Nothing is ever sent. The same checks as the agent's relay-mail tools.
#[tauri::command]
async fn mail_tool(state: State<'_, App>, name: String, args: Value) -> Result<Value, String> {
    if !["thread", "read", "save_draft", "attachment"].contains(&name.as_str()) { return Err(format!("Unknown mail tool {name}")); }
    let (on, accts, default) = { let s = state.settings.lock().unwrap(); (s["mail"]["on"] == true, mail::accounts(&s["mail"]), s["mail"]["account"].as_str().unwrap_or("").to_string()) };
    if !on { return Err("Mail is switched off in the app.".into()); }
    let dl = PathBuf::from(home()).join("Downloads/Relay-mail");
    state.mail.run(&accts, &default, &name, &args, &dl).await
}

/// Mark one mail read or unread, on the user's click.
#[tauri::command]
async fn mail_seen(state: State<'_, App>, account: String, id: String, seen: bool) -> Result<(), String> {
    let a = mail_acct(&state, &account)?;
    state.mail.set_seen(&a, &id, seen).await
}

fn mail_experimental(state: &App) -> bool { state.settings.lock().unwrap()["mail"]["experimental"] == true }

/// Archive (`trash` false) or move to Trash, the mails the user picked. Only with the experimental mail flag on.
#[tauri::command]
async fn mail_move(state: State<'_, App>, account: String, ids: Vec<String>, trash: bool) -> Result<(), String> {
    if !mail_experimental(&state) { return Err("Archive and delete are experimental, switch them on in Settings › Mail".into()); }
    let a = mail_acct(&state, &account)?;
    state.mail.move_to(&a, &ids, trash).await
}

/// Settings › Mail the guided way: the app password goes straight into the keychain (service relay-mail, account
/// the email, over stdin so it never shows in the process list), then a login test. A password the server refuses
/// is removed again. No host is Gmail (app password), else any IMAP server. Returns the account for the settings,
/// the window adds and saves it.
#[tauri::command]
async fn mail_connect(state: State<'_, App>, email: String, password: String, host: Option<String>, port: Option<u16>) -> Result<Value, String> {
    let email = email.trim().to_string();
    let host = host.map(|h| h.trim().to_string()).unwrap_or_default();
    let mut account = json!({"email": email, "keychain_service": "relay-mail", "keychain_account": email});
    if !host.is_empty() { account["host"] = json!(host); account["port"] = json!(port.unwrap_or(993)); }
    let a = mail::accounts(&json!({"accounts": [account.clone()]})).pop().ok_or_else(|| trc("err.mail_account"))?;
    let pw = if host.is_empty() {
        let pw: String = password.chars().filter(|c| !c.is_whitespace()).collect(); // Google shows it in groups of four
        if !(8..=64).contains(&pw.len()) || !pw.chars().all(|c| c.is_ascii_alphanumeric()) { return Err(trc("err.mail_pw")); }
        pw
    } else {
        if !(1..=256).contains(&password.chars().count()) || password.chars().any(char::is_control) { return Err(trc("err.mail_pw_any")); }
        password
    };
    // hex (-X) so no password character can end the command line `security -i` reads
    let hex: String = pw.bytes().map(|b| format!("{b:02x}")).collect();
    let mut ch = Command::new("/usr/bin/security").arg("-i").stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
    writeln!(ch.stdin.take().unwrap(), "add-generic-password -U -s relay-mail -a {email} -X {hex}").map_err(|e| e.to_string())?;
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

/// Settings › Calendar: save a calendar's secret iCal address in the keychain and try it (calendar::connect).
#[tauri::command]
async fn calendar_connect(email: String, url: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || calendar::connect(&email, &url)).await.map_err(|e| e.to_string())?
}

/// The meetings of the next hours, for Waiting: { meetings, errors }.
#[tauri::command]
async fn calendar_meetings(state: State<'_, App>) -> Result<Value, String> {
    let s = state.settings.lock().unwrap().clone();
    tauri::async_runtime::spawn_blocking(move || calendar::upcoming(&s)).await.map_err(|e| e.to_string())
}

// ---------- Work machines (machines.rs, packages/relay-server): pairing, status, the mirror.

/// Save settings changed here (not by the settings window), and tell both windows.
fn save_settings(app: &AppHandle, s: &Value) -> Result<(), String> {
    fs::write(data_dir(app).join("settings.json"), serde_json::to_string_pretty(s).unwrap()).map_err(|e| e.to_string())?;
    app.emit("settings-changed", s).ok();
    Ok(())
}
/// Pair with the line `relay-server pair` printed. The machine is saved under the name given, else its host name.
#[tauri::command]
async fn machine_pair(app: AppHandle, state: State<'_, App>, line: String, name: String) -> Result<Value, String> {
    let (id, me) = (state.machines.id.clone(), sys_name());
    let (l, info) = tauri::async_runtime::spawn_blocking(move || relay_remote::client::pair(&line, &id, &me)).await.map_err(|e| e.to_string())??;
    let name: String = if name.trim().is_empty() { info.host.clone() } else { name.trim().chars().take(60).collect() };
    let m = json!({"id": &l.fp[..12], "name": name, "host": l.host, "port": l.port, "fp": l.fp});
    let mut s = state.settings.lock().unwrap();
    let list = s["machines"].as_array_mut().unwrap();
    list.retain(|x| x["fp"] != m["fp"]);
    list.push(m.clone());
    save_settings(&app, &s)?;
    Ok(m)
}
/// A one-time pairing for a phone of this Mac on a machine: the line (with the machine's address as this Mac knows it,
/// and the key to this Mac's mirror there, so the phone can open it while this Mac is closed) and the same as a QR code
/// (SVG). The phone then sees this Mac's conversations there; it works once, for 10 minutes.
#[tauri::command]
async fn machine_pair_phone(app: AppHandle, state: State<'_, App>, id: String) -> Result<Value, String> {
    let m = machines::Machines::find(&state.settings.lock().unwrap(), &id).ok_or_else(|| trc("err.no_machine"))?;
    let c = state.machines.client(&m);
    let key = mirror::key(&data_dir(&app), &id)?;
    let code = tauri::async_runtime::spawn_blocking(move || c.pair_device()).await.map_err(|e| e.to_string())??;
    let s = |k: &str| m[k].as_str().unwrap_or("").to_string();
    let line = relay_remote::proto::PairLine { host: s("host"), port: m["port"].as_u64().unwrap_or(0) as u16, fp: s("fp"), code, key: Some(key.clone()) }.format();
    let qr = qrcode::QrCode::new(&line).map_err(|e| e.to_string())?.render::<qrcode::render::svg::Color>().min_dimensions(240, 240).build();
    Ok(json!({"line": line, "qr": qr, "ntfy": ntfy_url(&key)}))
}
/// How this Mac starts Claude on a machine, for a conversation its phone starts there: Claude's settings here without
/// the mail tools (answered by this app) or this Mac's accounts (the machine has its own login), and the mirror's flags
/// for the vault there, as `spawn` (session/mod.rs) adds them.
fn machine_profile(mut opts: Value, info: &relay_remote::proto::Info, notify: &str) -> Value {
    if let Some(o) = opts.as_object_mut() {
        o.insert("mail".into(), json!(false));
        for k in ["account", "accounts", "active"] { o.remove(k); }
    }
    let (args, env) = mirror::session_args(info, &format!("{}/vault", info.work));
    json!({"opts": opts, "args": args, "env": env, "notify": notify})
}
/// The ntfy topic a machine sends this Mac's phone notifications to: made from the mirror's key, so nobody guesses it
/// and the phone (which has the key from pairing) knows it without being told.
fn ntfy_url(mirror_key: &str) -> String { format!("https://ntfy.sh/relay-{}", &relay_remote::sync::sha256_hex(format!("ntfy:{mirror_key}").as_bytes())[..32]) }
/// This Mac's name, for the server's list of paired devices.
fn sys_name() -> String {
    Command::new("/usr/sbin/scutil").args(["--get", "ComputerName"]).output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|n| !n.is_empty()).unwrap_or_else(|| "Relay".into())
}
/// Whether a machine answers, with what it says about itself.
#[tauri::command]
async fn machine_status(state: State<'_, App>, id: String) -> Result<Value, String> {
    let m = machines::Machines::find(&state.settings.lock().unwrap(), &id).ok_or_else(|| trc("err.no_machine"))?;
    let c = state.machines.client(&m);
    let r = tauri::async_runtime::spawn_blocking(move || c.info_any()).await.map_err(|e| e.to_string())?;
    let proto = relay_remote::proto::PROTO;
    Ok(match r {
        Ok(i) if i.proto == proto => json!({"ok": true, "host": i.host, "version": i.version, "os": i.os, "update": i.update, "repos": !i.repos.is_empty()}),
        // it answers but speaks another protocol: the page says which side to update, with the commands
        Ok(i) => json!({"ok": false, "outdated": if i.proto < proto { "server" } else { "app" }, "version": i.version, "update": i.update,
            "error": format!("relay-server {} speaks protocol {}, this Relay {proto}", i.version, i.proto)}),
        Err(e) => json!({"ok": false, "error": e}),
    })
}
/// Update a machine's relay-server to this Relay's version from here: the Linux binary for its CPU from this version's
/// GitHub release (with gh, the repo is private), sent over the connection. The server checks it and goes on in it;
/// this waits until it answers with the new version.
#[tauri::command]
async fn machine_update(state: State<'_, App>, id: String) -> Result<Value, String> {
    if cfg!(debug_assertions) { return Err(trc("err.update_dev")); }
    let m = machines::Machines::find(&state.settings.lock().unwrap(), &id).ok_or_else(|| trc("err.no_machine"))?;
    let c = state.machines.client(&m);
    let gh = in_path(&state, "gh").ok_or_else(|| trc("err.no_gh"))?;
    let path = state.path.clone();
    let version = env!("CARGO_PKG_VERSION");
    tauri::async_runtime::spawn_blocking(move || {
        let info = c.info_any()?;
        if !info.update || info.os != "linux" { return Err(trc("err.update_old")); }
        let dir = std::env::temp_dir().join(format!("relay-update-{}", std::process::id()));
        let asset = format!("relay-server-linux-{}", info.arch);
        let out = std::process::Command::new(&gh).env("PATH", &path)
            .args(["release", "download", &format!("v{version}"), "-R", "Relay-inc/relay-app", "-p", &asset, "-D"]).arg(&dir).arg("--clobber")
            .output().map_err(|e| e.to_string())?;
        let bin = fs::read(dir.join(&asset));
        fs::remove_dir_all(&dir).ok();
        let bin = match bin {
            Ok(b) if out.status.success() => b,
            _ => return Err(format!("{}: {}", trc_v("err.update_download", version), String::from_utf8_lossy(&out.stderr).trim())),
        };
        c.update(version, &bin)?;
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_secs(1));
            if c.info_any().is_ok_and(|i| i.version == version) { return Ok(json!({"version": version})); }
        }
        Err(trc("err.update_back"))
    }).await.map_err(|e| e.to_string())?
}
/// For setting up a machine: this Relay's version, the relay-server image of the same version speaks its protocol.
#[tauri::command]
fn server_setup() -> Value {
    // a development build sits between two releases: no image has its version, the newest one is the closest
    let dev = cfg!(debug_assertions);
    json!({"version": if dev { "latest" } else { env!("CARGO_PKG_VERSION") }, "image": "ghcr.io/relay-inc/relay-server", "dev": dev})
}
/// This Mac as a work machine (host.rs): whether it runs, its RAM disk, the devices paired with it.
#[tauri::command]
async fn host_status() -> Value { tauri::async_runtime::spawn_blocking(host::status).await.unwrap_or_default() }
/// Turn this Mac as a work machine on or off; its status after.
#[tauri::command]
async fn host_set(on: bool) -> Result<Value, String> { tauri::async_runtime::spawn_blocking(move || host::set(on)).await.map_err(|e| e.to_string())? }
/// A one-time line to pair another Mac's Relay with this one's server.
#[tauri::command]
async fn host_pair() -> Result<String, String> { tauri::async_runtime::spawn_blocking(host::pair).await.map_err(|e| e.to_string())? }
/// Forget a machine here. Its conversations there stop (nothing would ever reach them again) and lose their bind; on
/// the machine `relay-server revoke` unpairs this Mac.
#[tauri::command]
fn machine_forget(app: AppHandle, state: State<App>, id: String) -> Result<(), String> {
    for k in state.machines.keys_on(&id) { if let Some(mut p) = state.procs.lock().unwrap().remove(&k) { p.child.kill().ok(); } }
    let mut s = state.settings.lock().unwrap();
    // its mirror there goes too, when it still answers
    if let Some(m) = machines::Machines::find(&s, &id) { state.machines.client(&m).wipe().ok(); }
    s["machines"].as_array_mut().unwrap().retain(|m| m["id"] != id.as_str());
    if s["machines_default"] == id.as_str() { s["machines_default"] = json!(""); }
    state.mirrors.forget(&data_dir(&app), &id);
    state.machines.forget(&id);
    save_settings(&app, &s)
}
/// The vault folders that stay on this Mac, out of a machine's mirror.
#[tauri::command]
fn set_machine_mirror(app: AppHandle, state: State<App>, id: String, exclude: Vec<String>) -> Result<(), String> {
    let exclude: Vec<String> = exclude.into_iter().map(|e| e.trim().trim_matches('/').to_string()).filter(|e| !e.is_empty()).collect();
    if let Some(e) = exclude.iter().find(|e| !relay_remote::sync::safe_rel(e)) { return Err(trc_v("err.machine_folder", e)); }
    let mut s = state.settings.lock().unwrap();
    let m = s["machines"].as_array_mut().unwrap().iter_mut().find(|m| m["id"] == id.as_str()).ok_or_else(|| trc("err.no_machine"))?;
    m["mirror"] = json!({"exclude": exclude});
    save_settings(&app, &s)
}
/// What the mirror of a machine did lately: {at, pushed, pulled, conflicts, skipped, errors, locked, in_ram}, or null.
#[tauri::command]
fn mirror_status(state: State<App>, id: String) -> Value { json!(state.mirrors.status.lock().unwrap().get(&id)) }
/// Where the running round of a machine's mirror is, null between rounds.
#[tauri::command]
fn mirror_progress(state: State<App>, id: String) -> Value { json!(state.mirrors.progress.lock().unwrap().get(&id)) }
/// The machines for the composer's pick, from the poller (no network): [{id, name, online, default}], `default` the one
/// a conversation runs on without a pick.
#[tauri::command]
fn machines_list(state: State<App>) -> Value { state.machines.status_list(&state.settings.lock().unwrap()) }
/// Where new conversations run when nothing is picked: "" this Mac, or a machine's id (Settings › Machines).
#[tauri::command]
fn set_machines_default(app: AppHandle, state: State<App>, id: String) -> Result<(), String> {
    let mut s = state.settings.lock().unwrap();
    if !id.is_empty() && machines::Machines::find(&s, &id).is_none() { return Err(trc("err.no_machine")); }
    s["machines_default"] = json!(id);
    save_settings(&app, &s)
}
/// Conversation key -> machine name and folder, for the conversations that run on one.
#[tauri::command]
fn chat_machines(state: State<App>) -> Value { state.machines.chat_machines(&state.settings.lock().unwrap()) }

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

/// The settings window, on `tab` when given (Relay › Check for Updates opens "updates"): an open window is told
/// with "settings-go", a new one starts on it (window.__relayTab, read by src/application/settings/window.ts).
fn open_settings(app: &AppHandle, tab: Option<&str>) {
    let tab = tab.filter(|t| t.chars().all(|c| c.is_ascii_lowercase()));
    if let Some(w) = app.get_webview_window("settings") {
        if let Some(t) = tab { app.emit_to("settings", "settings-go", t).ok(); }
        w.set_focus().ok(); return;
    }
    let title = tr(ui_lang_of(&app.state::<App>().settings.lock().unwrap()), "settings.title");
    tauri::WebviewWindowBuilder::new(app, "settings", tauri::WebviewUrl::App("settings.html".into()))
        .initialization_script(format!("window.__relayTab = {};", json!(tab)))
        .title(title).inner_size(900.0, 660.0).min_inner_size(720.0, 480.0)
        .minimizable(false).maximizable(false).build().ok();
}
/// The settings button at the bottom of the sidebar: the same window as Relay › Settings…, on Updates when the
/// button shows an update.
#[tauri::command]
fn open_settings_window(app: AppHandle, tab: Option<String>) { open_settings(&app, tab.as_deref()); }

/// The app's own pages: the bundle, IPC, the about: documents a srcdoc frame starts as, and in a dev build the
/// vite server. Any other localhost port is a local service a mail link must not reach without asking.
fn nav_internal(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "tauri" | "ipc" | "about")
        // a plugin's view loads in its sandboxed frame from the scheme plugins.rs serves (without this the navigation is
        // dropped and the frame stays an empty page)
        || (url.scheme() == "relay-plugin" && url.host_str() == Some("localhost"))
        || (cfg!(debug_assertions) && url.scheme() == "http" && url.host_str() == Some("localhost") && url.port() == Some(1420))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// `relay --cli …`, see actions.rs.
pub fn cli(args: &[String]) -> i32 { actions::cli(args) }

pub fn run() {
    tauri::Builder::default()
        // settings live in their own small window, the Mac way: open it, or bring it forward when it is open
        .on_menu_event(|app, event| {
            let settings = app.get_webview_window("settings");
            if event.id() == "close-chat" && settings.as_ref().is_some_and(|w| w.is_focused().unwrap_or(false)) {
                settings.unwrap().close().ok(); return;
            }
            if tray::owns(event.id().as_ref()) { return; } // handled by the tray's own listener
            if event.id() == "check-updates" { open_settings(app, Some("updates")); return; }
            if event.id() != "settings" { app.emit("menu", event.id().as_ref()).ok(); return; }
            open_settings(app, None);
        })
        // a link clicked inside a mail navigates its sandboxed frame (no scripts run there). Every navigation passes
        // here: the app's own pages load, a web or mailto link goes to the UI to ask first, anything else is dropped
        .plugin(tauri::plugin::Builder::<tauri::Wry>::new("links").on_navigation(|w, url| {
            if nav_internal(url) { return true; }
            // the Design webview (and its sign-in popup) is claude.ai itself
            if design::is_design(w.label()) && design::host_ok(url) { return true; }
            if matches!(url.scheme(), "http" | "https" | "mailto") { w.emit("mail-link", url.as_str()).ok(); }
            false
        }).build())
        // the HTML of a plugin's view, with the policy it declares (plugins.rs)
        .register_uri_scheme_protocol("relay-plugin", |ctx, req| plugins::serve(ctx.app_handle(), req.uri().path()))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        // relay:// links from Raycast or a browser: the UI handles them (src/app/deep-links.ts), the window comes forward here
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
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
            let worktrees = worktrees::load(&fs::read_to_string(data_dir(app.handle()).join("worktrees.json")).unwrap_or_default());
            let machines = machines::Machines::load(&data_dir(app.handle()))?;
            app.manage(App { procs: Mutex::new(HashMap::new()), sids: Mutex::new(sids), worktrees: Mutex::new(worktrees), path: login_path(), settings: Mutex::new(settings), limits: Default::default(), asked: Default::default(), spent: Default::default(), mail: mail::Mail::new(), machines, mirrors: Default::default(), orch: Mutex::new(()) });
            app.manage(pty::Ptys::default());
            app.manage(plugins::Plugins::default());
            app.manage(dictation::Dictation::default());
            app.manage(meeting::MeetingRec::default());
            anywhere::apply(app.handle());
            reattach(app.handle());
            std::thread::spawn(host::refresh); // a new Relay restarts this Mac's relay-server on its own binary
            orch::flush_all(app.handle()); // briefs and reports that waited while the app was closed
            orch::watch(app.handle()); // workers stuck on a card or without output
            actions::start(app.handle());
            awake::start(app.handle());
            retry::start(app.handle());
            updater::start(app.handle());
            refresh_index(app.handle());
            #[cfg(feature = "selftest")]
            selftest::start(app.handle());
            // the work machines: their conversations back, then their cards every second (only when there are machines),
            // and every 5 s the conversations its phone started there
            let h = app.handle().clone();
            std::thread::spawn(move || {
                reattach_remote(&h);
                for tick in 1u64.. {
                    let s = h.state::<App>().settings.lock().unwrap().clone();
                    if s["machines"].as_array().is_some_and(|m| !m.is_empty()) {
                        h.state::<App>().machines.poll(&s);
                        if tick % 5 == 0 { reattach_remote(&h); }
                    }
                    std::thread::sleep(std::time::Duration::from_secs(1));
                }
            });
            // the mirrors: a round every 5 s for each machine that has one and answers, on a thread of their own so a
            // first big copy never holds up the cards
            // With each round, how this Mac starts Claude there (when it changed), so its phone can start conversations
            // there while this Mac is closed (relay-server's `start`)
            let h = app.handle().clone();
            let mut profiles: HashMap<String, String> = HashMap::new();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(5));
                let st = h.state::<App>();
                let s = st.settings.lock().unwrap().clone();
                let vault = s["vault"].as_str().unwrap_or("").to_string();
                for m in s["machines"].as_array().into_iter().flatten() {
                    let id = m["id"].as_str().unwrap_or("");
                    let Some(info) = st.machines.seen.lock().unwrap().get(id).filter(|x| x.error.is_none()).and_then(|x| x.info.clone()) else { continue };
                    let client = st.machines.client(m);
                    st.mirrors.round(&data_dir(&h), m, &client, &info, &vault);
                    let Ok(p) = agents::get("claude") else { continue };
                    let notify = mirror::key(&data_dir(&h), id).map(|k| ntfy_url(&k)).unwrap_or_default();
                    let profile = machine_profile(env_of(&h, &st, p).opts, &info, &notify);
                    let text = profile.to_string();
                    if profiles.get(id) != Some(&text) && client.profile_put(&profile).is_ok() { profiles.insert(id.into(), text); }
                }
            });
            tray::init(app.handle())?;
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |_| tray::show_main(&handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![snapshot, webview_theme, ui_state_get, ui_state_init, ui_state_set, favicons, project_icons, set_project_icon, find_icon_sites, capture_vault, project_repos, set_project_repos, ignore_repo, open_settings_window, updater::updates_status, updater::updates_check, updater::updates_install, updater::agent_updates, updater::agent_update, usage_tokens, usage_limits, agents_status, agent_commands, chat_providers, send, ai_title, stop, orch_workers, orch_stop, orch_dispatch_ticket, orch_message, orch_answer, orch_ask_report, orch_restart, orch_pr, orch_board, drop_worktrees, conversation_changes, reset, move_chat, chats, bg, app_sids, activity, history_sid, history, running, subagents, agent_history, pending, answer, agents, app_sessions, open_terminal, get_settings, set_settings, pick_folder, pick_path, files::pick_files, files::read_image, files::open_file, files::pasted_files, files::copy_text, vault_status, detect_vault, check_vault, create_default_vault, reminder, reminder_add, ui_lang, ui_locale, integration_status, integration_has_token, integration_token, integration_call, integration_upload, integration_thumb, open_viewer, integration_mcp, integration_import, read_note, vault_notes, related_notes, github_status, github_prs, github_pr, mail_list, mail_read, mail_seen, mail_move, mail_tool, ai_write, github_pr_files, github_pr_review, mail_test, mail_connect, calendar_connect, calendar_meetings, notify::notify, actions::action_config, actions::set_action_config, pty::pty_spawn, pty::pty_write, pty::pty_resize, pty::pty_kill, scratch_list, scratch_save, scratch_delete, machine_pair, machine_pair_phone, machine_status, machine_forget, chat_machines, set_machine_mirror, mirror_status, mirror_progress, move_conversation, server_setup, machine_update, machine_git::machine_github, machine_git::machine_github_connect, machine_git::machine_github_poll, machine_git::machine_github_disconnect, machine_git::machine_repos, machine_git::machine_repo_push, machine_git::machine_repo_to_mac, machine_git::machine_repo_ensure, host_status, host_set, host_pair, machines_list, set_machines_default, retry::retries, retry::retry_cancel, commonwealth_status, commonwealth_install, commonwealth_join, commonwealth_notes, commonwealth_act, brain_roots, brain_graph, brain_search, brain_note, brain_touches, dictation::dictation_models, dictation::dictation_model, dictation::dictation_download, dictation::dictation_delete, dictation::dictation_start, dictation::dictation_stop, dictation::dictation_cancel, meeting::meeting_record_start, meeting::meeting_record_stop, meeting::meeting_record_retry, meeting::meeting_record_cancel, anywhere::dictation_access, anywhere::dictation_ask_access, anywhere::dictation_pause_shortcuts, permissions::permissions, permissions::permissions_open, plugins::plugins_list, plugins::plugin_secret, plugins::plugin_forget, plugins::plugin_test, plugins::plugin_view, plugins::plugin_call, plugins::plugin_import_list, plugins::plugin_import, design::design_show, design::design_bounds, design::design_hide, design::design_link, design::set_design_link])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        // a click on the Dock icon brings the hidden main window back
        .run(|app, e| match e {
            tauri::RunEvent::Reopen { .. } => tray::show_main(app),
            tauri::RunEvent::Exit => { quit(app); pty::kill_all(app); plugins::kill_all(app); }
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
mod index_tests {
    use super::*;
    #[test]
    fn a_vault_with_its_own_index_script_runs_that_one() {
        let dir = std::env::temp_dir().join(format!("relay-index-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (own, bundled) = (dir.join("build-index.py"), PathBuf::from("/app/build-index.py"));
        assert_eq!(index_script(own.clone(), Some(bundled.clone())), None, "no script, nothing runs");
        std::fs::write(&own, include_str!("../resources/default-vault/System/scripts/build-index.py")).unwrap();
        assert_eq!(index_script(own.clone(), Some(bundled.clone())), Some(bundled.clone()), "a starter copy gets the app's");
        std::fs::write(&own, "laatst = scalar(fm, \"laatst\", rel, warnings)\n").unwrap();
        assert_eq!(index_script(own.clone(), Some(bundled)), Some(own), "an own script runs as is");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

#[cfg(test)]
mod machine_tests {
    use super::*;
    #[test]
    fn a_machine_profile_keeps_mail_and_accounts_here() {
        let info = relay_remote::proto::Info { work: "/w/abc".into(), ..Default::default() };
        let p = machine_profile(json!({"mail": true, "account": "/a", "accounts": [{"dir": "/a"}], "active": "/a", "permission": "plan"}), &info, "https://ntfy.sh/t");
        assert_eq!(p["notify"], "https://ntfy.sh/t");
        let url = ntfy_url(&"a".repeat(64));
        assert!(url.starts_with("https://ntfy.sh/relay-") && url.len() == "https://ntfy.sh/relay-".len() + 32 && url != ntfy_url(&"b".repeat(64)));
        assert_eq!(p["opts"], json!({"mail": false, "permission": "plan"}));
        let args: Vec<&str> = p["args"].as_array().unwrap().iter().filter_map(|a| a.as_str()).collect();
        assert_eq!(args[..2], ["--add-dir", "/w/abc/context"]);
        assert!(args.iter().any(|a| a.contains("/w/abc/memory"))); // the vault's memory: it runs in the vault there
        assert_eq!(p["env"], json!([["CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD", "1"]]));
    }
    #[test]
    fn an_agent_under_a_broker_is_the_apps_own() {
        let ps = "  500     1 /Applications/Relay.app/Contents/MacOS/relay\n  501   500 /Applications/Relay.app/Contents/MacOS/relay --broker /tmp/a.sock {\"program\":\"claude\"}\n  502   501 /usr/bin/claude -p --input-format stream-json\n  600   400 /usr/bin/claude\n  601   500 /usr/bin/claude -p\n";
        assert_eq!(under_broker(ps), [502].into_iter().collect());
        assert!(under_broker("").is_empty());
    }
    #[test]
    fn a_conversation_this_macs_server_runs_is_no_terminal_session() {
        let work = std::path::Path::new("/Users/k/Library/Application Support/relay-server/work");
        assert!(runs_for_server(&json!({"cwd": "/Users/k/Library/Application Support/relay-server/work/ab12/vault"}), work));
        assert!(!runs_for_server(&json!({"cwd": "/Users/k/vault"}), work));
        assert!(!runs_for_server(&json!({"cwd": "/Users/k/Library/Application Support/relay-server/workshop"}), work));
        assert!(!runs_for_server(&json!({}), work));
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
    fn checkouts_are_found_by_their_origin() {
        let d = std::env::temp_dir().join(format!("relay-checkouts-{}", std::process::id()));
        let repo = |p: &str, url: &str| {
            std::fs::create_dir_all(d.join(p).join(".git")).unwrap();
            std::fs::write(d.join(p).join(".git/config"), format!("[core]\n\tbare = false\n[remote \"origin\"]\n\turl = {url}\n")).unwrap();
        };
        repo("shop", "git@github.com:Acme/Shop.git");
        repo("sites/repos/blog", "https://github.com/acme/blog");
        repo("sites/repos/shop-copy", "https://github.com/acme/shop");
        let s = |p: &str| d.join(p).to_string_lossy().into_owned();
        let found = super::checkouts_in(&[(s("sites"), "Sites".into()), (s("shop"), "Shop".into())]);
        assert_eq!(found["acme/shop"], (s("shop"), "Shop".to_string()), "a checkout listed by itself wins");
        assert_eq!(found["acme/blog"], (s("sites/repos/blog"), "Sites".to_string()), "two levels into a folder");
        assert_eq!(found.len(), 2);
        std::fs::remove_dir_all(d).ok();
    }
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
    fn only_the_apps_own_pages_navigate() {
        let ok = |u: &str| super::nav_internal(&u.parse().unwrap());
        for u in ["tauri://localhost/index.html", "http://localhost:1420/", "about:srcdoc", "about:blank", "ipc://localhost/x", "relay-plugin://localhost/garmin/3"] { assert!(ok(u), "{u}"); }
        for u in ["https://example.com/", "http://localhost.evil.com/", "http://localhost:1420@evil.com/", "http://localhost:4600/", "http://127.0.0.1:1420/",
                  "asset://localhost/x", "data:text/html,<b>x</b>", "file:///etc/passwd", "javascript:alert(1)", "mailto:a@b.c", "relay-plugin://evil.com/x"] { assert!(!ok(u), "{u}"); }
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

#[cfg(test)]
mod terminal_tests {
    // "auto" takes the first installed terminal in TERMINALS order, an explicit choice stays even when not installed
    #[test]
    fn terminal_choice() {
        use super::terminal_of;
        assert_eq!(terminal_of("auto", |a| a == "WezTerm" || a == "Terminal"), "wezterm");
        assert_eq!(terminal_of("auto", |a| a == "iTerm" || a == "WezTerm"), "iterm");
        assert_eq!(terminal_of("auto", |_| false), "terminal");
        assert_eq!(terminal_of("iterm", |_| false), "iterm");
        assert_eq!(terminal_of("bogus", |_| true), "terminal");
    }
}
