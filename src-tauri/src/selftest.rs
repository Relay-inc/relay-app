// A self-test of the work machines inside the real app, only in a build with the `selftest` feature
// (packages/relay-server/docker/selftest.sh builds and runs it, isolated from the Relay in use). It drives the
// settings window's Machines page through its DOM, then the backend commands the main window calls, against a
// relay-server in Docker behind a proxy it can cut. RELAY_SELFTEST=1 pairs, talks, answers a card, reads the history,
// survives a dropped connection and quits mid-turn; RELAY_SELFTEST=2 checks the restart took the conversation back.
// Each step goes to stdout and $RELAY_SELFTEST_DIR/report.txt, the app exits 0 when all passed.

use super::*;
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};
use tauri::Listener;

const KEY: &str = "c:selftest";
const PROJECT: &str = "Testproject";
const PROXY: u16 = 47811;

struct Report { dir: PathBuf, failed: bool }
impl Report {
    fn step(&mut self, name: &str, r: Result<String, String>) {
        let line = match &r { Ok(d) => format!("PASS {name}: {d}"), Err(e) => { self.failed = true; format!("FAIL {name}: {e}") } };
        println!("selftest {line}");
        let mut f = fs::OpenOptions::new().create(true).append(true).open(self.dir.join("report.txt")).unwrap();
        writeln!(f, "{line}").ok();
    }
}

/// A TCP proxy to the container that can drop every connection and refuse new ones for a while: a laptop that sleeps.
struct Proxy { down: Arc<AtomicBool>, conns: Arc<Mutex<Vec<TcpStream>>> }
impl Proxy {
    fn start(upstream: u16) -> Proxy {
        let l = TcpListener::bind(("127.0.0.1", PROXY)).expect("proxy port");
        let (down, conns) = (Arc::new(AtomicBool::new(false)), Arc::new(Mutex::new(Vec::<TcpStream>::new())));
        let (d, c) = (down.clone(), conns.clone());
        std::thread::spawn(move || for s in l.incoming().flatten() {
            if d.load(Ordering::SeqCst) { drop(s); continue; }
            let Ok(up) = TcpStream::connect(("127.0.0.1", upstream)) else { continue };
            c.lock().unwrap().extend([s.try_clone().unwrap(), up.try_clone().unwrap()]);
            let (mut a, mut b, mut a2, mut b2) = (s.try_clone().unwrap(), up.try_clone().unwrap(), s, up);
            std::thread::spawn(move || { std::io::copy(&mut a, &mut b).ok(); b.shutdown(std::net::Shutdown::Both).ok(); });
            std::thread::spawn(move || { std::io::copy(&mut b2, &mut a2).ok(); a2.shutdown(std::net::Shutdown::Both).ok(); });
        });
        Proxy { down, conns }
    }
    fn cut(&self, for_: Duration) {
        self.down.store(true, Ordering::SeqCst);
        for s in self.conns.lock().unwrap().drain(..) { s.shutdown(std::net::Shutdown::Both).ok(); }
        let d = self.down.clone();
        std::thread::spawn(move || { std::thread::sleep(for_); d.store(false, Ordering::SeqCst); });
    }
}

type Events = Arc<Mutex<mpsc::Receiver<Value>>>;
/// The `agent` events of KEY until its turn ends: the texts said, and whether it ended well.
fn turn(ev: &Events, timeout: Duration) -> Result<(Vec<String>, bool), String> {
    let (rx, end, mut texts) = (ev.lock().unwrap(), Instant::now() + timeout, vec![]);
    loop {
        let left = end.saturating_duration_since(Instant::now());
        let e = rx.recv_timeout(left).map_err(|_| format!("no turn end within {timeout:?}, texts {texts:?}"))?;
        if e["project"] != KEY { continue; }
        match e["event"]["type"].as_str().unwrap_or("") {
            "text" => texts.push(e["event"]["text"].as_str().unwrap_or("").to_string()),
            "turn_end" => return Ok((texts, e["event"]["ok"] == true)),
            "exit" => return Err(format!("the agent exited, texts {texts:?}")),
            "stderr" => texts.push(format!("stderr: {}", e["event"]["text"])),
            _ => {}
        }
    }
}
/// The texts of `key`'s next turn, like turn() for KEY.
fn turn_of(ev: &Events, key: &str, timeout: Duration) -> Result<Vec<String>, String> {
    let (rx, end, mut texts) = (ev.lock().unwrap(), Instant::now() + timeout, vec![]);
    loop {
        let e = rx.recv_timeout(end.saturating_duration_since(Instant::now())).map_err(|_| format!("no turn end, texts {texts:?}"))?;
        if e["project"] != key { continue; }
        match e["event"]["type"].as_str().unwrap_or("") {
            "text" => texts.push(e["event"]["text"].as_str().unwrap_or("").to_string()),
            "turn_end" => return Ok(texts),
            "exit" => return Err(format!("exited, texts {texts:?}")),
            "stderr" => texts.push(format!("stderr: {}", e["event"]["text"])),
            _ => {}
        }
    }
}
/// One message in a general conversation on the machine `id`.
fn ask(app: &AppHandle, ev: &Events, key: &str, id: &str, text: &str) -> Result<String, String> {
    send(app.clone(), app.state::<App>(), key.into(), text.into(), None, Some("General: mirror".into()), None, None, None, None, None, None, None, Some(id.into()))?;
    Ok(turn_of(ev, key, Duration::from_secs(30))?.join("\n"))
}
/// The mirror's next round that has run without errors.
fn mirror_round(app: &AppHandle, id: &str, after: i64) -> Result<Value, String> {
    wait(Duration::from_secs(40), || {
        let s = mirror_status(app.state::<App>(), id.into());
        (s["at"].as_i64().unwrap_or(0) > after && s["errors"].as_array().is_some_and(|e| e.is_empty()) && s["locked"] == false).then_some(s)
    }).ok_or_else(|| format!("no clean round: {}", mirror_status(app.state::<App>(), id.into())))
}
fn now_s() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0) }
const MIRROR_KEY: &str = "c:mirror";

fn say(app: &AppHandle, text: &str) -> Result<(), String> {
    send(app.clone(), app.state::<App>(), KEY.into(), text.into(), None, Some("Testproject: selftest".into()), None, None, None, None, None, None, None, None)
}
fn expect(app: &AppHandle, ev: &Events, text: &str, want: &str) -> Result<String, String> {
    say(app, text)?;
    let (texts, ok) = turn(ev, Duration::from_secs(30))?;
    if ok && texts.iter().any(|t| t.contains(want)) { Ok(format!("{texts:?}")) } else { Err(format!("ok {ok}, texts {texts:?}, wanted {want:?}")) }
}
fn wait<T>(timeout: Duration, mut f: impl FnMut() -> Option<T>) -> Option<T> {
    let end = Instant::now() + timeout;
    while Instant::now() < end { if let Some(x) = f() { return Some(x); } std::thread::sleep(Duration::from_millis(250)); }
    None
}

/// Before the app's own threads start: listen to the agent events, then run the phase on a thread of its own.
pub fn start(app: &AppHandle) {
    let Ok(phase) = std::env::var("RELAY_SELFTEST") else { return };
    let (tx, rx) = mpsc::channel::<Value>();
    app.listen("agent", move |e| { if let Ok(v) = serde_json::from_str(e.payload()) { tx.send(v).ok(); } });
    let (ui_tx, ui_rx) = mpsc::channel::<String>();
    app.listen("selftest-ui", move |e| { ui_tx.send(e.payload().to_string()).ok(); });
    let (app, ev): (AppHandle, Events) = (app.clone(), Arc::new(Mutex::new(rx)));
    std::thread::spawn(move || {
        let dir = PathBuf::from(std::env::var("RELAY_SELFTEST_DIR").unwrap_or_else(|_| "/tmp/relay-selftest".into()));
        let mut r = Report { dir, failed: false };
        let upstream: u16 = std::env::var("RELAY_SELFTEST_UPSTREAM").ok().and_then(|p| p.parse().ok()).unwrap_or(47800);
        if phase == "orch" { orch_run(&app, &ui_rx, &mut r); app.exit(if r.failed { 1 } else { 0 }); return; }
        let proxy = Proxy::start(upstream);
        if phase == "forget" { forget_ui(&app, &ui_rx, &mut r) } else if phase == "1" { one(&app, &ev, &ui_rx, &proxy, &mut r) } else { two(&app, &ev, &proxy, &mut r) }
        app.exit(if r.failed { 1 } else { 0 });
    });
}

// ---------- RELAY_SELFTEST=orch: the orchestrator against the real claude CLI (scripts/orch-selftest.sh makes the vault
// with projects Alpha and Beta and Beta's repo in RELAY_SELFTEST_REPO). One message to the coordinator, then what
// Relay records: workers, reports, the repo's branches, the card a push raises.

const ORCH_ASK: &str = "Selftest. 1) Start a worker in project Alpha: read its project note and report in one sentence which apple trees still have to be planted, change nothing. \
2) Start a worker in project Beta with repo {repo}: add a.txt with the text a and commit it on its branch. Right after, try to start a second worker in the same repo that adds b.txt, and once the first has reported start it again if it was refused. \
3) Start a worker in project Alpha with the task: answer in one sentence how many apple trees are already there, and do NOT call report, this tests what Relay does without a report. \
4) After the a.txt worker reported, send it a message to run exactly `git -C <its worktree> push origin HEAD` (there is no remote, this tests the permission card) and report again. \
Do not update any shared vault files, this is a test. End with a two-line summary.";

fn orch_run(app: &AppHandle, ui: &mpsc::Receiver<String>, r: &mut Report) {
    let st = app.state::<App>();
    let repo = std::env::var("RELAY_SELFTEST_REPO").unwrap_or_default();
    let git = |args: &[&str]| Command::new("git").arg("-C").arg(&repo).args(args).output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
    let main_before = git(&["rev-parse", "main"]);
    std::thread::sleep(Duration::from_secs(3));
    r.step("message to the coordinator", orch::inject(app, orch::COORD, "Orchestrator", &ORCH_ASK.replace("{repo}", &repo), "", false).map(|_| "sent".into()));
    // until every worker is done and the coordinator is idle; on the way: answer the push card, watch one writer per repo
    let (mut card, mut most_in_repo, end) = (None::<String>, 0usize, Instant::now() + Duration::from_secs(900));
    let mut quiet_since = None::<Instant>;
    while Instant::now() < end {
        let ws = orch::load(app);
        let running_in_repo = ws.iter().filter(|w| w.state == "running" && w.repo.is_some()).count();
        most_in_repo = most_in_repo.max(running_in_repo);
        for p in pending::list(&pending_dir(app)) {
            let cmd = p["input"]["command"].as_str().unwrap_or("");
            // any form of push: `git push`, `git -C <dir> push`
            let push = cmd.split_whitespace().skip_while(|w| *w != "git").skip(1).any(|w| w == "push");
            if orch::is_worker(p["project"].as_str().unwrap_or("")) && push {
                card = Some(cmd.to_string());
                crate::answer_card(app, &st, p["id"].as_str().unwrap_or(""), &json!({"behavior": "deny", "message": "Denied by the selftest."})).ok();
            } else {
                // anything else a worker asks in this test is allowed, like a click on Allow
                crate::answer_card(app, &st, p["id"].as_str().unwrap_or(""), &json!({"behavior": "allow", "updatedInput": p["input"]})).ok();
            }
        }
        let busy = st.procs.lock().unwrap().values().any(|x| orch::is_orch(&x.key) && x.turns > 0);
        let idle = ws.len() >= 3 && !ws.iter().any(|w| w.state == "running") && !busy;
        if !idle { quiet_since = None } else if quiet_since.get_or_insert_with(Instant::now).elapsed() > Duration::from_secs(20) { break; }
        std::thread::sleep(Duration::from_secs(2));
    }
    let ws = orch::load(app);
    let list = || ws.iter().map(|w| format!("{} {} {}", w.project.as_deref().unwrap_or("-"), w.title, w.state)).collect::<Vec<_>>().join(" | ");
    r.step("workers started", if ws.len() >= 3 { Ok(list()) } else { Err(list()) });
    let read = ws.iter().find(|w| w.project.as_deref() == Some("Alpha") && w.state == "done");
    r.step("read worker reports the note", match read.and_then(|w| w.report.as_ref()) {
        Some(rep) if rep.summary.contains("Jonagold") || rep.summary.contains("Elstar") => Ok(rep.summary.chars().take(120).collect()),
        x => Err(format!("{x:?}")),
    });
    let a = ws.iter().find(|w| w.report.as_ref().is_some_and(|r| r.diff.as_deref().is_some_and(|d| d.contains("a.txt"))));
    r.step("repo worker commits on its own branch, diff read by Relay", match a {
        Some(w) if w.branch.as_deref().is_some_and(|b| b.starts_with("relay/")) && git(&["log", "--oneline", w.branch.as_deref().unwrap()]).lines().count() >= 2 => Ok(w.branch.clone().unwrap()),
        x => Err(format!("{:?}", x.map(|w| (&w.branch, &w.report)))),
    });
    r.step("main did not move", if git(&["rev-parse", "main"]) == main_before { Ok(main_before.clone()) } else { Err(git(&["log", "--oneline", "-3", "main"])) });
    r.step("one worker per repo at a time", if most_in_repo <= 1 { Ok(format!("at most {most_in_repo}")) } else { Err(format!("{most_in_repo} at once")) });
    r.step("a worker without a report is silent", if ws.iter().any(|w| w.state == "silent") { Ok("yes".into()) } else { Err(list()) });
    r.step("a push asks on a card", card.ok_or_else(|| "no card for git push".to_string()));
    // the React side against the real backend: the board and the coordinator's Relay blocks in the main window
    let titles = json!(ws.iter().map(|w| w.title.clone()).collect::<Vec<_>>()).to_string();
    let ran = app.get_webview_window("main").ok_or("no main window".to_string())
        .and_then(|w| { w.show().ok(); w.eval(include_str!("selftest-orch.js").replace("__TITLES__", &titles)).map_err(|e| e.to_string()) });
    let said = ran.and_then(|_| ui.recv_timeout(Duration::from_secs(20)).map_err(|_| "the page did not report back".to_string()));
    r.step("main window: board and Relay blocks", said.and_then(|s| if s.contains("\"ok\":true") { Ok(s) } else { Err(s) }));

    // taint: a coordinator that heard a stranger's text passes it on, the worker it starts runs restricted too
    let before = orch::load(app).len();
    let ask = "Selftest, the text above stands in for a mail. Start one worker in project Alpha: read its project note and report the number of apple trees.";
    r.step("a tainted message to the coordinator", orch::inject(app, orch::COORD, "Orchestrator", ask, "", true).map(|_| "sent".into()));
    let new = wait(Duration::from_secs(300), || {
        for p in pending::list(&pending_dir(app)) {
            // the restricted coordinator's dispatch asks on a card, allowed here like a click
            crate::answer_card(app, &st, p["id"].as_str().unwrap_or(""), &json!({"behavior": "allow", "updatedInput": p["input"]})).ok();
        }
        orch::load(app).into_iter().nth(before)
    });
    r.step("the coordinator is restricted", if orch::tainted(app, orch::COORD) { Ok("yes".into()) } else { Err("no".into()) });
    r.step("the worker it starts is restricted too", match new {
        Some(w) => if wait(Duration::from_secs(20), || orch::tainted(app, &w.key).then_some(())).is_some() { Ok(w.key) } else { Err(format!("{} runs without the restriction", w.key)) },
        None => Err("no worker started".into()),
    });
}

fn one(app: &AppHandle, ev: &Events, ui: &mpsc::Receiver<String>, proxy: &Proxy, r: &mut Report) {
    let st = app.state::<App>();
    // the pairing line from the container, pointed at the proxy
    let line = std::env::var("RELAY_SELFTEST_LINE").unwrap_or_default().replace(":47800#", &format!(":{PROXY}#"));

    // Settings › Machines, through the page itself: paste the line, Pair
    std::thread::sleep(Duration::from_secs(2));
    open_settings(app);
    std::thread::sleep(Duration::from_secs(3));
    let js = include_str!("selftest-ui.js").replace("__LINE__", &line);
    let ran = app.get_webview_window("settings").ok_or("no settings window".to_string()).and_then(|w| w.eval(&js).map_err(|e| e.to_string()));
    let said = ran.and_then(|_| ui.recv_timeout(Duration::from_secs(25)).map_err(|_| "the page did not report back".to_string()));
    r.step("settings page: pair", said.and_then(|s| if s.contains("\"ok\":true") { Ok(s) } else { Err(s) }));
    let m = st.settings.lock().unwrap()["machines"][0].clone();
    r.step("machine saved", if m["fp"].is_string() { Ok(format!("{} {}:{}", m["name"], m["host"], m["port"])) } else { Err(format!("{m}")) });
    if m.is_null() { return; }
    // every machine mirrors this Mac: conversations there run in the vault's mirror, which the first round brings
    let mid = m["id"].as_str().unwrap_or("").to_string();
    r.step("first mirror round after pairing", mirror_round(app, &mid, 0).map(|s| s.to_string()));

    // Settings › Machines: new conversations run on the machine (a project's too); a new general conversation's pick
    // then shows it
    let ui_ok = |s: String| if s.contains("\"ok\":true") { Ok(s) } else { Err(s) };
    open_settings(app);
    std::thread::sleep(Duration::from_secs(3));
    let js = include_str!("selftest-default.js").replace("__MACHINE__", "docker");
    let ran = app.get_webview_window("settings").ok_or("no settings window".to_string()).and_then(|w| w.eval(js.replace("__STEP__", "settings")).map_err(|e| e.to_string()));
    let said = ran.and_then(|_| ui.recv_timeout(Duration::from_secs(20)).map_err(|_| "the page did not report back".to_string())).and_then(ui_ok);
    r.step("settings page: new conversations run on the machine", said.and_then(|s| {
        let d = st.settings.lock().unwrap()["machines_default"].clone();
        if d == m["id"] { Ok(format!("{s}, machines_default {d}")) } else { Err(format!("{s}, machines_default {d}")) }
    }));
    if let Some(w) = app.get_webview_window("settings") { w.close().ok(); }
    let ran = app.get_webview_window("main").ok_or("no main window".to_string()).and_then(|w| w.eval(js.replace("__STEP__", "main")).map_err(|e| e.to_string()));
    let said = ran.and_then(|_| ui.recv_timeout(Duration::from_secs(20)).map_err(|_| "the page did not report back".to_string()));
    r.step("main window: a new general conversation starts on the default machine", said.and_then(ui_ok));

    // the main window the way a user does it: the composer passes the project, the label says where it runs
    if let Some(w) = app.get_webview_window("settings") { w.close().ok(); }
    let js = include_str!("selftest-main.js").replace("__PROJECT__", PROJECT);
    let ran = app.get_webview_window("main").ok_or("no main window".to_string()).and_then(|w| { w.show().ok(); w.eval(&js).map_err(|e| e.to_string()) });
    let said = ran.and_then(|_| ui.recv_timeout(Duration::from_secs(40)).map_err(|_| "the page did not report back".to_string()));
    r.step("main window: a conversation in the project runs on the machine", said.and_then(|s| if s.contains("\"ok\":true") { Ok(s) } else { Err(s) }));

    // a general conversation sent to the machine through the composer's pick: it runs in the vault's mirror there
    let js = include_str!("selftest-general.js").replace("__MACHINE__", "docker");
    let ran = app.get_webview_window("main").ok_or("no main window".to_string()).and_then(|w| w.eval(&js).map_err(|e| e.to_string()));
    let said = ran.and_then(|_| ui.recv_timeout(Duration::from_secs(60)).map_err(|_| "the page did not report back".to_string()));
    r.step("main window: a general conversation picked onto the machine", said.and_then(|s| {
        if !s.contains("\"ok\":true") { return Err(s); }
        let c = chat_machines(app.state::<App>());
        let home = c.as_object().into_iter().flatten().find(|(_, b)| b["machine"] == "docker" && b["cwd"].as_str().is_some_and(|d| d.ends_with("/vault")));
        home.map(|(k, b)| format!("{s}, {k} bound {b}")).ok_or(format!("no general conversation bound: {c}"))
    }));


    r.step("first turn on the machine", expect(app, ev, "hallo", "echo from relay-docker: hallo"));
    r.step("bound to the machine", { let c = chat_machines(app.state::<App>()); if c[KEY]["machine"].is_string() { Ok(c[KEY].to_string()) } else { Err(c.to_string()) } });

    // a card raised there: the poller lists it, the answer goes back, the agent goes on
    let card = (|| {
        say(app, "perm please")?;
        let req = wait(Duration::from_secs(15), || pending(app.clone(), app.state::<App>()).into_iter().find(|p| p["project"] == KEY)).ok_or("no card")?;
        answer(app.clone(), app.state::<App>(), req["id"].as_str().unwrap_or("").into(), json!({"behavior": "allow", "updatedInput": req["input"]}))?;
        let (texts, ok) = turn(ev, Duration::from_secs(20))?;
        if ok && texts.iter().any(|t| t.contains("wrote note.txt")) { Ok(format!("{} card answered, {texts:?}", req["tool_name"])) } else { Err(format!("{texts:?}")) }
    })();
    r.step("permission card over the network", card);

    let h = tauri::async_runtime::block_on(history(app.clone(), app.state::<App>(), KEY.into()));
    r.step("history from the machine", h.and_then(|v| {
        let users: Vec<&str> = v.as_array().into_iter().flatten().filter(|e| e["type"] == "user").filter_map(|e| e["text"].as_str()).collect();
        if users.contains(&"hallo") { Ok(format!("{} events, users {users:?}", v.as_array().map_or(0, Vec::len))) } else { Err(v.to_string()) }
    }));

    // the connection drops mid-turn for 5 s: the turn still ends here once the machine answers again
    let dropped = (|| {
        say(app, "slow one")?;
        std::thread::sleep(Duration::from_secs(1));
        proxy.cut(Duration::from_secs(5));
        let t = Instant::now();
        let (_, ok) = turn(ev, Duration::from_secs(30))?;
        let alive = st.procs.lock().unwrap().contains_key(KEY);
        if ok && alive { Ok(format!("turn end after {:?}, conversation still attached", t.elapsed())) } else { Err(format!("ok {ok}, attached {alive}")) }
    })();
    r.step("dropped connection taken back", dropped);
    r.step("talk after the drop", expect(app, ev, "after the drop", "echo from relay-docker: after the drop"));

    // the mirror (on from pairing): the vault and the context reach the machine, a session there reads the vault, gets the
    // context flags, writes a note, and the note comes back here
    let id = st.settings.lock().unwrap()["machines"][0]["id"].as_str().unwrap_or("").to_string();
    let started = now_s();
    r.step("first mirror round", mirror_round(app, &id, started - 1).map(|s| s.to_string()));
    r.step("a session there reads the vault", ask(app, ev, MIRROR_KEY, &id, "read Notes/Uit de vault.md")
        .and_then(|t| if t.contains("content: geheim 42") { Ok(t) } else { Err(t) }));
    r.step("it gets the context, plugins, permissions and memory", ask(app, ev, MIRROR_KEY, &id, "flags").and_then(|t| {
        let ok = t.contains("--add-dir") && t.contains("/context") && t.contains("--settings") && t.contains("autoMemoryDirectory") && t.contains("\"claude_md_from_dirs\": \"1\"");
        if ok { Ok("flags present".into()) } else { Err(t) }
    }));
    let wrote = now_s();
    r.step("it writes a note there", ask(app, ev, MIRROR_KEY, &id, "write Notes/Van de server.md | hallo terug").and_then(|t| if t.contains("wrote") { Ok(t) } else { Err(t) }));
    let vault = PathBuf::from(st.settings.lock().unwrap()["vault"].as_str().unwrap_or("").to_string());
    r.step("the note comes back to this Mac", mirror_round(app, &id, wrote).and_then(|_| {
        wait(Duration::from_secs(20), || fs::read_to_string(vault.join("Notes/Van de server.md")).ok().filter(|t| t == "hallo terug")).ok_or_else(|| "not here".to_string())
    }));

    // moving a conversation: refused mid-turn, then to this Mac (its transcript comes along with this Mac's paths) and
    // back to the machine (the machine's paths again), where it goes on in the same session
    let msid = st.sids.lock().unwrap().get(MIRROR_KEY).map(|s| s.sid.clone()).unwrap_or_default();
    send(app.clone(), app.state::<App>(), MIRROR_KEY.into(), "slow move".into(), None, Some("General: mirror".into()), None, None, None, None, None, None, None, Some(id.clone())).ok();
    std::thread::sleep(Duration::from_millis(800));
    r.step("moving mid-turn is refused", match move_to(app, MIRROR_KEY, "", false) { Err(e) => Ok(e), Ok(()) => Err("moved mid-turn".into()) });
    turn_of(ev, MIRROR_KEY, Duration::from_secs(20)).ok();
    let v = vault.to_string_lossy().to_string();
    let local = PathBuf::from(home()).join(".claude/projects").join(agent_claude::slug(&v)).join(format!("{msid}.jsonl"));
    let m = machines::Machines::find(&st.settings.lock().unwrap(), &id).unwrap_or_default();
    let work = st.machines.info(&m).map(|i| i.work).unwrap_or_default();
    r.step("moved to this Mac", move_to(app, MIRROR_KEY, "", false).and_then(|_| {
        let t = fs::read_to_string(&local).map_err(|e| format!("{}: {e}", local.display()))?;
        // the vault's paths are this Mac's now; the machine's own (its plugins, its permission tool) stay as they were
        let ok = st.machines.bind_of(MIRROR_KEY).is_none() && t.contains("read Notes/Uit de vault.md") && t.contains(&format!("{v}\"")) && !t.contains(&format!("{work}/vault"));
        if ok { Ok(format!("{} bytes, this Mac's paths", t.len())) } else { Err(t) }
    }));
    r.step("moved back to the machine", move_to(app, MIRROR_KEY, &id, false).and_then(|_| {
        let m = machines::Machines::find(&st.settings.lock().unwrap(), &id).ok_or("no machine")?;
        let t = String::from_utf8(st.machines.client(&m).session_get(&msid)?).map_err(|e| e.to_string())?;
        if t.contains(&format!("{work}/vault\"")) && !t.contains(&format!("{v}\"")) { Ok(format!("{} bytes, the machine's paths", t.len())) } else { Err(t) }
    }));
    // the agent the move stopped said "exit": not a turn of what follows
    std::thread::sleep(Duration::from_millis(500));
    while ev.lock().unwrap().try_recv().is_ok() {}
    r.step("it goes on there in the same session", ask(app, ev, MIRROR_KEY, &id, "read Notes/Uit de vault.md").and_then(|t| {
        let same = st.sids.lock().unwrap().get(MIRROR_KEY).map(|s| s.sid.clone()) == Some(msid.clone());
        if t.contains("geheim 42") && same { Ok(t) } else { Err(format!("same session {same}: {t}")) }
    }));
    fs::remove_file(&local).ok();

    // quit with a turn running: phase 2 must find it again
    let sid = st.sids.lock().unwrap().get(KEY).map(|s| s.sid.clone()).unwrap_or_default();
    fs::write(r.dir.join("sid"), &sid).ok();
    r.step("quit mid-turn", say(app, "slow at quit").map(|_| format!("session {sid}")));
    std::thread::sleep(Duration::from_millis(500));
}

fn two(app: &AppHandle, ev: &Events, proxy: &Proxy, r: &mut Report) {
    let st = app.state::<App>();
    let back = wait(Duration::from_secs(20), || st.procs.lock().unwrap().get(KEY).map(|p| p.remote));
    r.step("reattached after the restart", if back == Some(true) { Ok("the running conversation is the app's again".into()) } else { Err(format!("{back:?}")) });
    // the turn that ran while the app was closed ends here (its result was in the broker's backlog)
    r.step("the turn from before the quit ends", turn(ev, Duration::from_secs(20)).and_then(|(_, ok)| if ok { Ok("turn end".into()) } else { Err("not ok".into()) }));
    let before = fs::read_to_string(r.dir.join("sid")).unwrap_or_default();
    r.step("same session after the restart", expect(app, ev, "after restart", "echo from relay-docker: after restart").and_then(|t| {
        let now = st.sids.lock().unwrap().get(KEY).map(|s| s.sid.clone()).unwrap_or_default();
        if now == before && !now.is_empty() { Ok(t) } else { Err(format!("session {before} became {now}")) }
    }));
    // the machine away: a new conversation there says so at once, not after a connect timeout
    proxy.cut(Duration::from_secs(8));
    std::thread::sleep(Duration::from_secs(3)); // a poller round or two
    let t = Instant::now();
    let res = send(app.clone(), app.state::<App>(), "c:selftest2".into(), "anyone there".into(), None, None, None, None, None, None, None, None, None, None);
    let took = t.elapsed();
    r.step("machine away: refused fast", match res { Err(e) if took < Duration::from_millis(1000) => Ok(format!("{took:?}: {e}")), other => Err(format!("{took:?}: {other:?}")) });
    std::thread::sleep(Duration::from_secs(7)); // back, and the poller sees it again
    // the server restarts (its RAM disk empties, the key is gone): locked until this Mac unlocks it again, then the
    // vault is readable there as before
    let id = st.settings.lock().unwrap()["machines"][0]["id"].as_str().unwrap_or("").to_string();
    let restart = std::env::var("RELAY_SELFTEST_RESTART").unwrap_or_default();
    let before = now_s();
    let restarted = Command::new("/bin/sh").args(["-c", &restart]).status().map_err(|e| e.to_string()).and_then(|s| if s.success() { Ok(()) } else { Err(format!("{s}")) });
    r.step("server restarted", restarted.map(|_| "restarted".into()));
    r.step("unlocked again by this Mac", mirror_round(app, &id, before + 2).map(|s| format!("in_ram {}", s["in_ram"])));
    r.step("the vault is readable there after the restart", ask(app, ev, "c:mirror2", &id, "read Notes/Van de server.md")
        .and_then(|t| if t.contains("content: hallo terug") { Ok(t) } else { Err(t) }));
    // the conversations on it ended with the restart: the next ones start fresh
    // stop it: through the server, and the server lists nothing for this Mac any more
    let m = st.settings.lock().unwrap()["machines"][0].clone();
    stop(app.clone(), app.state::<App>(), KEY.into());
    let gone = wait(Duration::from_secs(10), || st.machines.client(&m).list().ok().filter(|l| !l.iter().any(|x| x.key == KEY)));
    r.step("stopped on the machine", match gone { Some(l) => Ok(format!("gone there, {} other conversation(s) still run", l.len())), None => Err("still listed".into()) });
    let id = m["id"].as_str().unwrap_or("").to_string();
    r.step("forget the machine", machine_forget(app.clone(), app.state::<App>(), id).and_then(|_| {
        let (binds, d) = (st.machines.binds.lock().unwrap().len(), st.settings.lock().unwrap()["machines_default"].clone());
        if d == "" { Ok(format!("binds left: {binds}, new conversations back on this Mac")) } else { Err(format!("machines_default still {d}")) }
    }));
    let none = wait(Duration::from_secs(10), || st.machines.client(&m).list().ok().filter(|l| l.is_empty()));
    r.step("forgetting stopped its conversations there", if none.is_some() { Ok("nothing of this Mac runs there".into()) } else { Err("still running there".into()) });
}

/// Pair through the page, then Forget through it: the machine must leave the list.
fn forget_ui(app: &AppHandle, ui: &mpsc::Receiver<String>, r: &mut Report) {
    let line = std::env::var("RELAY_SELFTEST_LINE").unwrap_or_default().replace(":47800#", &format!(":{PROXY}#"));
    std::thread::sleep(Duration::from_secs(2));
    open_settings(app);
    std::thread::sleep(Duration::from_secs(3));
    let w = app.get_webview_window("settings").unwrap();
    let js = include_str!("selftest-ui.js").replace("__LINE__", &line);
    w.eval(&js).ok();
    r.step("paired through the page", ui.recv_timeout(Duration::from_secs(25)).map_err(|_| "no report".to_string()));
    w.eval(include_str!("selftest-forget.js")).ok();
    let said = ui.recv_timeout(Duration::from_secs(15)).map_err(|_| "no report".to_string());
    r.step("forgot through the page", said.and_then(|s| if s.contains("\"ok\":true") { Ok(s) } else { Err(s) }));
    let left = app.state::<App>().settings.lock().unwrap()["machines"].as_array().map_or(0, Vec::len);
    r.step("settings after forget", if left == 0 { Ok("no machines".into()) } else { Err(format!("{left} machine(s) left")) });
}
