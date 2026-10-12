// The frame loop against recorded Claude stream-json lines, with a sink that keeps what the loop did instead of
// a webview. The invariants are the ones the bug fixes since the first release rest on: the turn count, which
// the spinner and quit read (46b06f5 a message joining a running turn, eb47d73 a restart reviving ended turns),
// the account marked spent and what retry hears (0aebdd0), and what a replay after a restart may and may not do.
use super::frames::{Reader, Sink, TurnEnd};
use super::{release, Proc, Turns};
use crate::{agents, broker};
use agent_core::{pending, Event};
use serde_json::{json, Value};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// what after_turn heard: model, limited, hint, fresh, replay, last
type Ended = (String, bool, Option<i64>, bool, bool, String);
type Hook = Box<dyn Fn(&Value) + Send>;

#[derive(Default)]
struct Fake {
    events: Mutex<Vec<Value>>,
    turns: Mutex<Turns>,
    /// what would go to the broker's file
    saved: Mutex<Vec<u32>>,
    spent: Mutex<u32>,
    sessions: Mutex<Vec<String>>,
    cards: Mutex<Vec<pending::Request>>,
    pipes: Mutex<Vec<Value>>,
    committed: Mutex<Vec<Vec<PathBuf>>>,
    worktrees: Mutex<Vec<Vec<String>>>,
    ends: Mutex<Vec<Ended>>,
    closed: Mutex<Vec<bool>>,
    /// what the "agent" does on the disk while the webview hears an event, to be seen by the next snapshot
    on_emit: Mutex<Option<Hook>>,
}

impl Fake {
    /// A conversation whose file says `running` turns are running.
    fn running(running: u32) -> Self { Fake { turns: Mutex::new(Turns::new(running)), ..Default::default() } }
    fn types(&self) -> Vec<String> { self.events.lock().unwrap().iter().map(|e| e["type"].as_str().unwrap_or("").to_string()).collect() }
    fn count(&self) -> u32 { self.turns.lock().unwrap().running }
    fn spent(&self) -> u32 { *self.spent.lock().unwrap() }
    fn save(&self, n: Option<u32>) { if let Some(n) = n { self.saved.lock().unwrap().push(n); } }
}

impl Sink for Fake {
    fn emit(&self, ev: Value) {
        if let Some(f) = &*self.on_emit.lock().unwrap() { f(&ev); }
        self.events.lock().unwrap().push(ev);
    }
    fn spend(&self) { *self.spent.lock().unwrap() += 1; }
    fn control(&self, id: &Value, server: Option<&str>, message: &Value) { self.pipes.lock().unwrap().push(json!({"id": id, "server": server, "message": message})); }
    fn working(&self) { let n = self.turns.lock().unwrap().working(); self.save(n); }
    fn picked(&self) { self.turns.lock().unwrap().picked(); }
    fn turn_ended(&self) -> String { let n = self.turns.lock().unwrap().ended(); self.save(n); "opus".into() }
    fn session(&self, sid: &str) { self.sessions.lock().unwrap().push(sid.into()); }
    fn permission(&self, req: &pending::Request) { self.cards.lock().unwrap().push(req.clone()); }
    fn committed(&self, repos: Vec<PathBuf>) { self.committed.lock().unwrap().push(repos); }
    fn worktrees(&self, made: Vec<String>) { self.worktrees.lock().unwrap().push(made); }
    fn after_turn(&self, e: &TurnEnd) { self.ends.lock().unwrap().push((e.model.clone(), e.limited, e.hint, e.fresh, e.replay, e.last.into())); }
    fn closed(&self, exited: bool) { self.closed.lock().unwrap().push(exited); }
}

// ---- frames as the broker sends them: "o <stdout line>", "e <stderr line>", anything else is the exit
fn o(v: Value) -> String { format!("o {v}") }
const EXIT: &str = "x";
fn init() -> String { o(json!({"type": "system", "subtype": "init", "session_id": "36099ce4-d17c-482a-8907-23790cc0e8db", "model": "claude-opus-5-5", "cwd": "/v", "tools": ["Bash", "Read"]})) }
fn text(id: &str, t: &str) -> String { o(json!({"type": "assistant", "message": {"id": id, "role": "assistant", "model": "claude-opus-5-5", "content": [{"type": "text", "text": t}]}})) }
fn tool_use(id: &str, name: &str, input: Value) -> String { o(json!({"type": "assistant", "message": {"id": "m9", "role": "assistant", "model": "claude-opus-5-5", "content": [{"type": "tool_use", "id": id, "name": name, "input": input}]}})) }
fn tool_result(id: &str) -> String { o(json!({"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": id, "content": "ok"}]}})) }
/// Claude's echo of a message it took up (--replay-user-messages)
fn echo(t: &str) -> String { o(json!({"type": "user", "isReplay": true, "parent_tool_use_id": null, "message": {"role": "user", "content": t}})) }
fn done() -> String { o(json!({"type": "result", "subtype": "success", "is_error": false, "duration_ms": 4200, "usage": {"input_tokens": 12, "output_tokens": 30}})) }
fn failed(msg: &str) -> String { o(json!({"type": "result", "subtype": "success", "is_error": true, "result": msg})) }
fn limit_event() -> String { o(json!({"type": "rate_limit_event", "rate_limit_info": {"status": "rejected", "resetsAt": 1_760_000_000}})) }
/// The refusal itself, an assistant message of the model "<synthetic>"
fn refusal(t: &str) -> String { o(json!({"type": "assistant", "message": {"id": "m0", "role": "assistant", "model": "<synthetic>", "content": [{"type": "text", "text": t}]}})) }

fn run_with(sink: &Fake, frames: &[String], backlog: usize, root: &Path) {
    let p = agents::get("claude").unwrap();
    let text = frames.join("\n") + "\n";
    Reader::new(p, backlog, (true, false), root.to_path_buf()).run(sink, Cursor::new(text));
}
fn run(sink: &Fake, frames: &[String], backlog: usize) { run_with(sink, frames, backlog, Path::new("/nonexistent")); }

#[test]
fn a_turn_streams_to_the_webview_and_the_count_returns_to_zero() {
    let f = Fake::default();
    // sent by send(): one turn running
    *f.turns.lock().unwrap() = Turns::new(1);
    run(&f, &[init(), text("m1", "Ik kijk even."), tool_use("toolu_1", "Read", json!({"file_path": "/v/a.md"})), tool_result("toolu_1"), text("m2", "Klaar."), done(), EXIT.into()], 0);
    assert_eq!(f.types(), ["session", "resolved", "text", "tool_call", "tool_result", "text", "turn_end"]);
    assert_eq!(f.events.lock().unwrap()[1], json!({"type": "resolved", "model": "claude-opus-5-5", "effort": null, "default_model": true, "default_effort": false}));
    assert_eq!(*f.sessions.lock().unwrap(), ["36099ce4-d17c-482a-8907-23790cc0e8db"]);
    assert_eq!(f.count(), 0);
    assert_eq!(*f.saved.lock().unwrap(), [0], "the file only hears the change");
    // what the turn end says for retry and a worker's report
    assert_eq!(*f.ends.lock().unwrap(), [("opus".to_string(), false, None, false, false, "Klaar.".to_string())]);
    assert_eq!(*f.closed.lock().unwrap(), [true]);
}

// 46b06f5: two messages sent while Claude works join one turn; its single turn end answers both
#[test]
fn one_turn_end_answers_every_message_the_turn_took_up() {
    let f = Fake::running(2);
    run(&f, &[text("m1", "bezig"), echo("and also this"), echo("and this"), text("m2", "ok"), done()], 0);
    assert_eq!(f.count(), 0, "the spinner stops");
    assert_eq!(f.turns.lock().unwrap().picked, 0);
    assert_eq!(f.types().iter().filter(|t| *t == "picked").count(), 2, "the webview moves each message into the conversation");
}

// 46b06f5: a turn without an echo (a slash command) answers the oldest message only, and `picked` starts over
#[test]
fn a_turn_without_an_echo_answers_one_message() {
    let f = Fake::running(2);
    run(&f, &[text("m1", "a"), done()], 0);
    assert_eq!(f.count(), 1);
    run(&f, &[text("m2", "b"), echo("second"), done()], 0);
    assert_eq!(f.count(), 0);
    // and an extra turn end never goes below zero
    run(&f, &[done()], 0);
    assert_eq!(f.count(), 0);
}

// eb47d73: the count goes to the broker's file on every change, nothing else
#[test]
fn turns_are_written_to_the_file_when_they_change() {
    let f = Fake::running(0);
    run(&f, &[], 0);
    assert!(f.saved.lock().unwrap().is_empty() && f.count() == 0, "an idle agent that came back stays idle");
    // a turn running when the file was written, its work replayed: nothing changes
    let g = Fake::running(1);
    run(&g, &[text("m1", "a"), tool_use("t1", "Bash", json!({"command": "sleep 9"}))], 2);
    assert!(g.saved.lock().unwrap().is_empty() && g.count() == 1);
    // ... and it ends while the app is away: its replayed turn end ends it
    run(&g, &[tool_result("t1"), done()], 2);
    assert_eq!(*g.saved.lock().unwrap(), [0]);
    assert_eq!(g.types(), ["turn_end"]);
}

// eb47d73: a finished turn in the backlog counts up and back down, the conversation is idle after it
#[test]
fn a_replayed_finished_turn_leaves_the_conversation_idle() {
    let f = Fake::running(0);
    run(&f, &[init(), text("m1", "hi"), done()], 3);
    assert_eq!(f.count(), 0);
    assert_eq!(*f.saved.lock().unwrap(), [1, 0]);
}

// what a backlog may do: its effects happen (session id, cards), the webview only hears the turn end
#[test]
fn a_replay_only_shows_the_turn_end_but_keeps_its_effects() {
    let dir = tmp("replay");
    let frames = [init(), tool_use("toolu_1", "Bash", json!({"command": "git commit -m x"})), tool_result("toolu_1"), done(), text("m3", "live")];
    let f = Fake::running(1);
    run_with(&f, &frames, 4, &dir);
    assert_eq!(*f.sessions.lock().unwrap(), ["36099ce4-d17c-482a-8907-23790cc0e8db"]);
    assert_eq!(f.types(), ["turn_end", "text"], "the replayed init and tool calls stay out, what is live after the backlog does not");
    assert!(f.committed.lock().unwrap().is_empty(), "no snapshots around replayed tool calls");
    // the replayed turn end is told as one, so the orchestrator does not flush what it queued for a live one
    assert!(f.ends.lock().unwrap()[0].4);
    assert_eq!(f.count(), 1, "the live text after the backlog starts a turn again");

    // a permission card raised in the provider's own protocol while the app was away is still written
    let g = Fake::running(1);
    let card: agent_core::Parser = Box::new(|_| vec![Event::Permission { request: pending::Request::new("tool", "Bash", json!({"command": "ls"})) }]);
    Reader::with_parser(card, 1, (false, false), dir).run(&g, Cursor::new("o {}\no {}\n"));
    assert_eq!(g.cards.lock().unwrap().len(), 2);
    assert_eq!(g.types(), ["permission"], "the card is shown for the live one only");
}

// 0aebdd0: a refused turn marks the account spent and tells retry the reset and that nothing was done
#[test]
fn a_rate_limit_marks_the_account_and_reaches_retry() {
    let f = Fake::running(1);
    run(&f, &[limit_event(), refusal("You've hit your limit \u{b7} resets 9pm"), failed("You've hit your limit \u{b7} resets 9pm")], 0);
    assert!(f.spent() >= 1);
    // the reset Claude named, seconds turned into epoch ms; the refusal is no work, so the retry sends the message again
    assert_eq!(*f.ends.lock().unwrap(), [("opus".to_string(), true, Some(1_760_000_000_000), true, false, "You've hit your limit \u{b7} resets 9pm".to_string())]);
    assert_eq!(f.count(), 0);
    // the next turn starts clean: nothing carried over
    run(&f, &[text("m1", "weer bezig"), done()], 0);
    assert_eq!(f.ends.lock().unwrap()[1], ("opus".to_string(), false, None, false, false, "weer bezig".to_string()));
}

// 0aebdd0: a limit that only shows in the turn's own text ("You've hit your weekly limit") counts too, a plain failure does not
#[test]
fn the_limit_text_of_a_turn_end_is_read() {
    let f = Fake::running(1);
    run(&f, &[text("m1", "begonnen"), failed("You've hit your weekly limit \u{b7} resets 9pm")], 0);
    assert_eq!(f.spent(), 1);
    assert_eq!(*f.ends.lock().unwrap(), [("opus".to_string(), true, None, false, false, "begonnen".to_string())], "work was done: retry asks it to continue");
    let g = Fake::running(1);
    run(&g, &[failed("error_max_turns")], 0);
    assert_eq!(g.spent(), 0);
    assert!(!g.ends.lock().unwrap()[0].1);
}

// the pipe: the CLI's control traffic is the app's business, the webview only hears the slash commands
#[test]
fn pipe_traffic_stays_off_the_webview() {
    let f = Fake::running(0);
    let request = json!({"type": "control_request", "request_id": "r1", "request": {"subtype": "mcp_message", "server_name": "relay-mail", "message": {"method": "tools/list"}}});
    let init_ok = json!({"type": "control_response", "response": {"subtype": "success", "request_id": "init", "response": {"commands": [{"name": "/compact"}]}}});
    let model_err = json!({"type": "control_response", "response": {"subtype": "error", "request_id": "model", "error": "nope"}});
    // a tool call that needs the user: a card, never answered over the pipe as unsupported
    let ask = json!({"type": "control_request", "request_id": "r2", "request": {"subtype": "can_use_tool", "tool_name": "Write", "input": {"file_path": "/v/a.md", "content": "x"}, "tool_use_id": "toolu_w"}});
    run(&f, &[o(request.clone()), o(init_ok), o(model_err), o(ask)], 0);
    assert_eq!(*f.pipes.lock().unwrap(), [json!({"id": "r1", "server": "relay-mail", "message": {"method": "tools/list"}})]);
    let cards = f.cards.lock().unwrap();
    assert_eq!((cards.len(), cards[0].tool_name.as_str(), cards[0].request_id.as_deref()), (1, "Write", Some("r2")));
    assert_eq!(f.types(), ["commands", "stderr", "permission"], "the card reaches the webview, the rest of the pipe does not");
    assert_eq!(f.count(), 0, "pipe traffic is no work");
}

// the loop knows no provider: a limit, a synthetic message and a control request are events of the contract
#[test]
fn the_loop_handles_provider_neutral_events() {
    let script = vec![
        vec![Event::Limited { resets_at: Some(1_760_000_000_000) }],
        vec![Event::Synthetic, Event::Text { text: "refused".into(), delta: false }],
        vec![Event::Control { id: json!("r1"), server: Some("relay-mail".into()), message: json!({"method": "ping"}) }, Event::Stderr { text: "x failed".into() }],
        vec![Event::TurnEnd { ok: false, error: Some("refused".into()), usage: None, duration_ms: None }],
    ];
    let mut it = script.into_iter();
    let parse: agent_core::Parser = Box::new(move |_| it.next().unwrap_or_default());
    let f = Fake::running(1);
    Reader::with_parser(parse, 0, (false, false), PathBuf::from("/nonexistent")).run(&f, Cursor::new("o 1\no 2\no 3\no 4\n"));
    assert_eq!(f.spent(), 1);
    assert_eq!(*f.ends.lock().unwrap(), [("opus".to_string(), true, Some(1_760_000_000_000), true, false, "refused".to_string())], "the refusal is no work: retry sends the message again");
    assert_eq!(f.types(), ["text", "stderr", "turn_end"], "limits and control requests stay off the webview");
    assert_eq!(*f.pipes.lock().unwrap(), [json!({"id": "r1", "server": "relay-mail", "message": {"method": "ping"}})]);
}

// a limit event without a reset clears the one an earlier event named
#[test]
fn a_limited_event_without_a_reset_clears_the_hint() {
    let script = vec![vec![Event::Limited { resets_at: Some(5) }], vec![Event::Limited { resets_at: None }], vec![Event::TurnEnd { ok: false, error: None, usage: None, duration_ms: None }]];
    let mut it = script.into_iter();
    let parse: agent_core::Parser = Box::new(move |_| it.next().unwrap_or_default());
    let f = Fake::running(1);
    Reader::with_parser(parse, 0, (false, false), PathBuf::from("/nonexistent")).run(&f, Cursor::new("o 1\no 2\no 3\n"));
    assert_eq!(f.ends.lock().unwrap()[0].2, None);
}

#[test]
fn stderr_comes_out_when_the_agent_ends() {
    let f = Fake::running(1);
    run(&f, &["e boom".into(), "e second line".into(), text("m1", "x"), EXIT.into(), text("m2", "after the exit")], 0);
    assert_eq!(f.types(), ["text", "stderr"]);
    assert_eq!(f.events.lock().unwrap()[1]["text"], "boom\nsecond line");
    assert_eq!(*f.closed.lock().unwrap(), [true]);
    // a connection that just ends is not an exit
    let g = Fake::running(1);
    run(&g, &[text("m1", "x")], 0);
    assert_eq!(*g.closed.lock().unwrap(), [false]);
}

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("relay-frames-{}-{name}", std::process::id()));
    std::fs::remove_dir_all(&d).ok();
    std::fs::create_dir_all(&d).unwrap();
    d
}

// the git snapshots: a tool call that may commit, a repo whose reflog changed by its result
#[test]
fn a_commit_during_a_tool_call_is_reported_by_its_result() {
    let root = tmp("commit");
    let log = root.join("repo/.git/logs/HEAD");
    std::fs::create_dir_all(log.parent().unwrap()).unwrap();
    std::fs::write(&log, "0 1 first\n").unwrap();
    let f = Fake::running(1);
    let l = log.clone();
    *f.on_emit.lock().unwrap() = Some(Box::new(move |ev| { if ev["type"] == "tool_call" { std::fs::write(&l, "0 1 first\n1 2 second commit\n").unwrap(); } }));
    run_with(&f, &[tool_use("t1", "Bash", json!({"command": "git commit -m x"})), tool_result("t1"), tool_use("t2", "Bash", json!({"command": "ls"})), tool_result("t2")], 0, &root);
    assert_eq!(*f.committed.lock().unwrap(), [vec![root.join("repo")]], "only the call that may commit is snapshotted");
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn a_worktree_made_by_a_tool_call_is_the_conversations() {
    let root = tmp("worktree");
    std::fs::create_dir_all(root.join("repo/.git")).unwrap();
    let f = Fake::running(1);
    let r = root.clone();
    *f.on_emit.lock().unwrap() = Some(Box::new(move |ev| {
        if ev["type"] == "tool_call" {
            let w = r.join("repo/.git/worktrees/w1");
            std::fs::create_dir_all(&w).unwrap();
            std::fs::write(w.join("gitdir"), "/work/w1/.git\n").unwrap();
        }
    }));
    run_with(&f, &[tool_use("t1", "Bash", json!({"command": "git worktree add ../w1"})), tool_result("t1")], 0, &root);
    assert_eq!(*f.worktrees.lock().unwrap(), [vec!["/work/w1".to_string()]]);
    std::fs::remove_dir_all(&root).ok();
}

// a process replaced for an account or effort switch exits quietly: its successor keeps the slot
#[test]
fn an_old_process_does_not_take_the_slot_of_its_successor() {
    let proc = |pid: u32| Proc { child: broker::Agent::from(pid), stdin: Box::new(std::io::sink()), opts: (String::new(), String::new()), provider: "claude", tainted: false, key: "k".into(), turns: Turns::new(0), account: String::new(), remote: false };
    let mut procs = std::collections::HashMap::from([("k".to_string(), proc(2))]);
    assert!(!release(&mut procs, "k", 1));
    assert!(procs.contains_key("k"));
    assert!(release(&mut procs, "k", 2));
    assert!(procs.is_empty());
    assert!(release(&mut procs, "k", 2), "a slot that was emptied by a stop still reports the exit");
}

#[test]
fn turns_count_up_and_down_and_report_changes() {
    let mut t = Turns::default();
    assert_eq!(t.sent(), Some(1));
    assert_eq!(t.sent(), Some(2));
    assert_eq!(t.working(), None, "work in a running turn is no new message");
    t.picked();
    assert_eq!(t.ended(), Some(1));
    assert_eq!(t.ended(), Some(0));
    assert_eq!(t.ended(), None);
    assert_eq!(t.working(), Some(1), "work with nothing counted starts a turn (a replay)");
    assert!(t.busy());
}

fn meta(key: &str, pid: u32, turns: u32) -> broker::Meta {
    broker::Meta { key: key.into(), provider: "claude".into(), model: "opus".into(), effort: "".into(), tainted: false, pid, account: "/a".into(), turns }
}

// eb47d73: after a restart a conversation runs the turns its broker file says, not one; every change goes to that file
#[test]
fn a_reattached_process_takes_its_turns_from_the_file_and_writes_changes_back() {
    let dir = tmp("meta");
    std::env::set_var("RELAY_AGENTS_DIR", &dir);
    let mut idle = Proc::of_meta(broker::Agent::from(7), Box::new(std::io::sink()), meta("k-idle", 7, 0), "claude");
    assert!(!idle.turns.busy(), "an agent left idle by an app that did not quit stays idle");
    let mut busy = Proc::of_meta(broker::Agent::from(8), Box::new(std::io::sink()), meta("k-busy", 8, 2), "claude");
    assert_eq!(busy.turns.count(), 2);

    // the file the broker keeps; the process writes its turns into it
    let read = |k: &str| broker::load_meta(&broker::meta_path(k)).unwrap().turns;
    broker::save_meta(&meta("k-busy", 8, 2));
    busy.turn_ended();
    assert_eq!(read("k-busy"), 1);
    busy.sent();
    assert_eq!(read("k-busy"), 2);
    // a file of another pid (a successor process) is left alone
    broker::save_meta(&meta("k-idle", 99, 0));
    idle.sent();
    assert_eq!(read("k-idle"), 0);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_process_starts_with_its_first_turn_only_when_it_has_one() {
    assert_eq!(super::start_turns(Some(&agent_core::Turn { text: "hi".into(), images: vec![] })), 1);
    assert_eq!(super::start_turns(None), 0);
}

#[test]
fn only_an_idle_local_agent_stops_at_quit() {
    let mk = |turns: u32, remote: bool| { let mut p = Proc::of_meta(broker::Agent::from(1), Box::new(std::io::sink()), meta("q", 1, turns), "claude"); p.remote = remote; p };
    assert!(super::dies_at_quit(&mk(0, false)));
    assert!(!super::dies_at_quit(&mk(1, false)), "a running turn keeps its agent");
    assert!(!super::dies_at_quit(&mk(0, true)), "a work machine's agents stay");
}
