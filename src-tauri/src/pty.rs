// The shells of the embedded terminals (src/features/terminals): one pty per terminal tab, a login shell in the
// project's first checkout. A reader thread per pty forwards the raw bytes to the tab's channel, xterm decodes them.
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};

struct Pty { master: Box<dyn MasterPty + Send>, writer: Box<dyn Write + Send>, child: Box<dyn Child + Send + Sync> }
#[derive(Default)]
pub struct Ptys { map: Mutex<HashMap<u32, Pty>>, next: AtomicU32 }

/// Where a project's shell starts: its first checkout in the brain's index/repos.json (dir -> note), else the vault.
fn start_dir(vault: &str, project: &str) -> String {
    let named = |note: &Value| note.as_str().and_then(|n| n.rsplit('/').next()).is_some_and(|n| n.trim_end_matches(".md") == project);
    super::brain(vault)
        .and_then(|b| std::fs::read_to_string(format!("{b}/index/repos.json")).ok())
        .and_then(|s| serde_json::from_str::<serde_json::Map<String, Value>>(&s).ok())
        .and_then(|idx| idx.iter().find(|(d, n)| named(n) && std::path::Path::new(d).is_dir()).map(|(d, _)| d.clone()))
        .unwrap_or_else(|| vault.to_string())
}

fn size(cols: u16, rows: u16) -> PtySize { PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 } }

/// Start a login shell for a project; its output arrives as raw bytes on `on_data`, the end as a JSON exit code.
/// With `chat` (a conversation's key) the shell first continues that conversation, as the external terminal does.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn pty_spawn(app: AppHandle, state: State<super::App>, ptys: State<Ptys>, project: String, chat: Option<String>, name: Option<String>, cols: u16, rows: u16, on_data: Channel<InvokeResponseBody>) -> Result<u32, String> {
    let vault = super::need_vault(&state)?;
    if project.trim().is_empty() { return Err("bad project".into()); }
    let run = chat.map(|key| super::terminal_cmd(&app, &state, &key, None, name)).transpose()?;
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/zsh".into());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    // the shell stays after the agent quits, as in the external terminal
    if let Some(run) = run { cmd.args(["-c", &format!("{run}; exec {shell} -l")]); }
    cmd.cwd(start_dir(&vault, &project));
    cmd.env("TERM", "xterm-256color");
    cmd.env("PATH", &state.path);
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let id = ptys.next.fetch_add(1, Ordering::Relaxed) + 1;
    ptys.map.lock().unwrap().insert(id, Pty { master: pair.master, writer, child });
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 || on_data.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() { break; }
        }
        // the shell ended (or was killed): report its code and drop the pty
        // out of the map first: waiting while holding the lock would block every other pty (and kill_all on quit)
        let pty = app.state::<Ptys>().map.lock().unwrap().remove(&id);
        // the loop also ends when the webview dropped the channel while the shell still runs: end it rather than wait forever
        let code = pty.and_then(|mut p| { p.child.kill().ok(); p.child.wait().ok() }).map_or(-1, |s| s.exit_code() as i64);
        on_data.send(InvokeResponseBody::Json(code.to_string())).ok();
    });
    Ok(id)
}

#[tauri::command]
pub fn pty_write(ptys: State<Ptys>, id: u32, data: String) {
    if let Some(p) = ptys.map.lock().unwrap().get_mut(&id) { p.writer.write_all(data.as_bytes()).and_then(|_| p.writer.flush()).ok(); }
}

#[tauri::command]
pub fn pty_resize(ptys: State<Ptys>, id: u32, cols: u16, rows: u16) {
    if let Some(p) = ptys.map.lock().unwrap().get(&id) { p.master.resize(size(cols, rows)).ok(); }
}

/// Close one terminal; its reader thread then sees the end and reports the exit.
#[tauri::command]
pub fn pty_kill(ptys: State<Ptys>, id: u32) {
    if let Some(p) = ptys.map.lock().unwrap().get_mut(&id) { p.child.kill().ok(); }
}

/// The app is quitting: no shell outlives it.
pub fn kill_all(app: &AppHandle) {
    for (_, mut p) in app.state::<Ptys>().map.lock().unwrap().drain() { p.child.kill().ok(); }
}
