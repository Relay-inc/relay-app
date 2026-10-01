//! OpenCode's local storage, `$XDG_DATA_HOME/opencode/opencode.db` (default `~/.local/share/opencode`), read with
//! the system's sqlite3 in read-only mode: tables `session` (id, directory, title, parent_id, time_updated,
//! time_archived, …), `message` and `part` (id, session_id, time_created, `data` as JSON). An assistant message's
//! data has `modelID`, `providerID`, `tokens {input, output, reasoning, cache {read, write}}` and `cost` (USD).
//! And the model list of `opencode models --verbose`.

use agent_core::{usage::Record, Choice, Event};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const SQLITE: &str = "/usr/bin/sqlite3";

pub fn data_dir(home: &str) -> PathBuf {
    std::env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty()).map(|d| PathBuf::from(d).join("opencode"))
        .unwrap_or_else(|| PathBuf::from(format!("{home}/.local/share/opencode")))
}
pub fn db(home: &str) -> PathBuf { data_dir(home).join("opencode.db") }

/// `select …` as JSON rows, read-only; None when there is no database or no sqlite3.
pub fn query(db: &Path, sql: &str) -> Option<Vec<Value>> {
    if !db.is_file() { return None; }
    let out = Command::new(SQLITE).arg("-readonly").arg("-json").arg(db).arg(sql).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    if !out.status.success() { return None; }
    let s = String::from_utf8_lossy(&out.stdout);
    if s.trim().is_empty() { Some(vec![]) } else { serde_json::from_str(&s).ok() }
}
fn quote(s: &str) -> String { format!("'{}'", s.replace('\'', "''")) }

/// The folder or below it, as given or as its real path (opencode keeps the real one: /private/tmp for /tmp).
fn under(col: &str, dirs: &[&str]) -> String {
    let like = |d: &str| quote(&format!("{}/%", d.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")));
    let w: Vec<String> = dirs.iter().filter(|d| !d.is_empty()).flat_map(|d| [format!("{col} = {}", quote(d)), format!("{col} like {} escape '\\'", like(d))]).collect();
    if w.is_empty() { "0".into() } else { format!("({})", w.join(" or ")) }
}
pub fn in_vault(dir: &str, dirs: &[&str]) -> bool {
    dirs.iter().filter(|d| !d.is_empty()).any(|d| dir == *d || dir.strip_prefix(d).is_some_and(|r| r.starts_with('/')))
}

/// The vault's top-level sessions (not the subagents'), the newest first.
pub fn sessions_sql(dirs: &[&str]) -> String {
    format!("select id, title, directory, time_updated from session where parent_id is null and time_archived is null and {} order by time_updated desc limit 100", under("directory", dirs))
}
pub fn sessions_of(rows: &[Value]) -> Vec<Value> {
    rows.iter().filter_map(|r| {
        let sid = r["id"].as_str().filter(|s| valid(s))?;
        let name: String = r["title"].as_str().unwrap_or("").lines().next().unwrap_or("").chars().take(80).collect();
        Some(json!({"id": sid, "sessionId": sid, "name": name, "kind": "interactive", "status": "idle", "updatedAt": r["time_updated"].as_i64().unwrap_or(0)}))
    }).collect()
}
/// A session id: `ses_` and letters and digits.
pub fn valid(id: &str) -> bool { id.len() > 4 && id.starts_with("ses_") && id[4..].chars().all(|c| c.is_ascii_alphanumeric()) }

/// A session's messages with their parts, in order.
pub fn history_sql(sid: &str) -> String {
    format!("select m.id mid, m.data mdata, p.id pid, p.data pdata from message m left join part p on p.message_id = m.id where m.session_id = {} order by m.time_created, m.id, p.id", quote(sid))
}

/// Epoch ms as RFC 3339 (UTC).
pub fn rfc3339(ms: i64) -> String {
    let (days, rem) = (ms.div_euclid(86_400_000), ms.rem_euclid(86_400_000));
    // civil from days (Howard Hinnant)
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z", rem / 3_600_000, rem / 60_000 % 60, rem / 1000 % 60, rem % 1000)
}

/// The rows of [`history_sql`] from message `from` on, as events, and the message count to continue from: only
/// whole messages (an assistant message still running is read again next time).
pub fn history(rows: &[Value], from: u64) -> (Vec<Event>, u64) {
    let mut msgs: Vec<(Value, Vec<Value>)> = vec![];
    for r in rows {
        if msgs.last().is_none_or(|m| m.0["id"].as_str() != r["mid"].as_str()) {
            let mut d: Value = r["mdata"].as_str().and_then(|s| serde_json::from_str(s).ok()).unwrap_or_default();
            d["id"] = r["mid"].clone();
            msgs.push((d, vec![]));
        }
        if let Some(p) = r["pdata"].as_str().and_then(|s| serde_json::from_str::<Value>(s).ok()) {
            let mut p = p;
            p["id"] = r["pid"].clone();
            msgs.last_mut().unwrap().1.push(p);
        }
    }
    let mut out = vec![];
    let mut n = from;
    for (m, parts) in msgs.iter().skip(from as usize) {
        let user = m["role"] == "user";
        if !user && m["time"]["completed"].is_null() && m["error"].is_null() { break; }
        if let Some(at) = m["time"]["created"].as_i64() { out.push(Event::Time { at: rfc3339(at) }); }
        if user {
            let text: Vec<&str> = parts.iter().filter(|p| p["type"] == "text" && p["synthetic"] != true).filter_map(|p| p["text"].as_str()).collect();
            let images = parts.iter().filter(|p| p["type"] == "file" && p["mime"].as_str().is_some_and(|m| m.starts_with("image/"))).map(|p| {
                let url = p["url"].as_str().unwrap_or("");
                url.strip_prefix("data:").and_then(|r| r.split_once(";base64,")).map(|(t, d)| agent_core::Image { media_type: t.into(), data: d.into() })
            }).collect();
            out.push(Event::User { text: text.join("\n"), images });
        } else {
            for p in parts {
                let id = p["id"].as_str().unwrap_or("").to_string();
                match p["type"].as_str().unwrap_or("") {
                    "text" if p["synthetic"] != true => out.extend(p["text"].as_str().filter(|t| !t.is_empty()).map(|t| Event::Text { text: t.into(), delta: false })),
                    "reasoning" => out.extend(p["text"].as_str().filter(|t| !t.is_empty()).map(|t| Event::Thinking { text: t.into(), delta: false })),
                    "tool" => {
                        let (name, input) = crate::events::tool(p["tool"].as_str().unwrap_or(""), &p["state"]["input"]);
                        out.push(Event::ToolCall { id: id.clone(), name, input });
                        let st = p["state"]["status"].as_str().unwrap_or("");
                        if matches!(st, "completed" | "error") { out.push(Event::ToolResult { id, error: st == "error" }); }
                    }
                    _ => {}
                }
            }
            if let Some(e) = crate::events::error_text(&m["error"]) { out.push(Event::Error { text: e }); }
        }
        n += 1;
    }
    (out, n)
}

/// The assistant messages since `since` (epoch ms), their numbers only.
pub fn usage_sql(since: i64) -> String {
    let j = |p: &str| format!("json_extract(m.data,'$.{p}')");
    format!("select m.id, m.session_id, s.directory, {} at, {} provider, {} model, {} input, {} output, {} reasoning, {} cache_read, {} cache_write, {} cost \
        from message m join session s on s.id = m.session_id where m.time_created >= {since} and {} = 'assistant' order by m.time_created",
        j("time.created"), j("providerID"), j("modelID"), j("tokens.input"), j("tokens.output"), j("tokens.reasoning"), j("tokens.cache.read"), j("tokens.cache.write"), j("cost"), j("role"))
}
/// One record per assistant message with tokens: the model as `provider/model`, reasoning counted as output, the cost
/// opencode recorded (from its model prices; 0 for free models and for models it has no price for).
pub fn records(rows: &[Value], dirs: &[&str]) -> Vec<Record> {
    let n = |v: &Value| v.as_u64().or_else(|| v.as_f64().map(|f| f as u64)).unwrap_or(0);
    rows.iter().map(|r| Record {
        at: r["at"].as_i64().unwrap_or(0),
        model: format!("{}/{}", r["provider"].as_str().unwrap_or("?"), r["model"].as_str().unwrap_or("?")),
        session: r["session_id"].as_str().unwrap_or("").into(),
        vault: in_vault(r["directory"].as_str().unwrap_or(""), dirs),
        input: n(&r["input"]), output: n(&r["output"]) + n(&r["reasoning"]), cache_read: n(&r["cache_read"]), cache_write: n(&r["cache_write"]),
        cost: r["cost"].as_f64(),
    }).filter(|r| r.total() > 0).collect()
}

/// `opencode models --verbose`: per model a `provider/model` line and its JSON. The models of the configured
/// providers ("Name · provider"), and the variants (efforts) any of them has, in a known order.
pub fn parse_models(s: &str) -> (Vec<Choice>, Vec<Choice>) {
    let mut blocks: Vec<(String, String)> = vec![];
    for l in s.lines() {
        let id_line = !l.is_empty() && !l.starts_with([' ', '{', '}', '"', ']', '[']) && l.contains('/') && !l.contains(' ');
        if id_line { blocks.push((l.trim().into(), String::new())); } else if let Some(b) = blocks.last_mut() { b.1.push_str(l); b.1.push('\n'); }
    }
    let mut models = vec![];
    let mut variants: Vec<String> = vec![];
    for (id, body) in blocks {
        let v: Value = serde_json::from_str(&body).unwrap_or_default();
        let name = v["name"].as_str().unwrap_or(&id);
        let provider = id.split('/').next().unwrap_or("");
        models.push(Choice::new(&id, &format!("{name} · {provider}")));
        for k in v["variants"].as_object().into_iter().flat_map(|o| o.keys()) { if !variants.contains(k) { variants.push(k.clone()); } }
    }
    const ORDER: [&str; 7] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
    variants.sort_by_key(|v| ORDER.iter().position(|o| o == v).unwrap_or(ORDER.len()));
    let label = |v: &str| match v { "xhigh" => "Extra high".to_string(), _ => { let mut c = v.chars(); c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default() } };
    (models, variants.iter().map(|v| Choice::new(v, &label(v))).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rows(s: &str) -> Vec<Value> { serde_json::from_str(s).unwrap() }

    #[test]
    fn history_of_a_live_session() {
        let r = rows(include_str!("../tests/fixtures/history.json"));
        let (ev, n) = history(&r, 0);
        assert_eq!(n, 5); // user, assistant (the command), assistant (done), user, assistant
        assert_eq!(ev[0], Event::Time { at: "2026-09-30T18:47:03.062Z".into() });
        assert!(matches!(&ev[1], Event::User { text, .. } if text.starts_with("Use the bash tool")));
        assert!(ev.iter().any(|e| matches!(e, Event::ToolCall { name, input, .. } if name == "Bash" && input["command"] == "echo hi")));
        assert!(ev.iter().any(|e| matches!(e, Event::ToolResult { error: false, .. })));
        let texts: Vec<&str> = ev.iter().filter_map(|e| if let Event::Text { text, .. } = e { Some(text.as_str()) } else { None }).collect();
        assert_eq!(texts, ["I'll run the command first.", "done", "done"]);
        // from the offset on: only the rest
        let (ev, n2) = history(&r, 3);
        assert_eq!(n2, 5);
        assert!(matches!(&ev[1], Event::User { text, .. } if text.starts_with("What word")));
        // a message still running is not counted
        let mut open = r.clone();
        let last = open.len() - 1;
        let mut d: Value = serde_json::from_str(open[last]["mdata"].as_str().unwrap()).unwrap();
        d["time"]["completed"] = Value::Null;
        for x in open.iter_mut().filter(|x| x["mid"] == r[last]["mid"]) { x["mdata"] = json!(d.to_string()); }
        assert_eq!(history(&open, 0).1, 4);
    }

    #[test]
    fn usage_records_and_sessions() {
        let r = rows(include_str!("../tests/fixtures/usage.json"));
        let recs = records(&r, &["/tmp/oc-probe/work", "/private/tmp/oc-probe/work"]);
        assert_eq!(recs.len(), 3);
        assert_eq!((recs[0].model.as_str(), recs[0].input, recs[0].output, recs[0].cache_read, recs[0].cost), ("opencode/big-pickle", 6704, 29 + 481, 167, Some(0.0)));
        assert!(recs.iter().all(|x| x.vault && x.session == "ses_f0c5bbf85ffe6aFOOEAgKslvWD"));
        assert!(records(&r, &["/tmp/other"]).iter().all(|x| !x.vault));
        // a priced model, as opencode records it
        let priced = records(&rows(r#"[{"id":"msg_1","session_id":"ses_a1","directory":"/v/x","at":5,"provider":"anthropic","model":"claude-sonnet-5-5","input":10,"output":2,"reasoning":0,"cache_read":0,"cache_write":3,"cost":0.0123}]"#), &["/v"]);
        assert_eq!((priced[0].cost, priced[0].cache_write, priced[0].vault), (Some(0.0123), 3, true));
        assert!(!in_vault("/vault2", &["/vault"]) && in_vault("/vault/a", &["", "/vault"]));
        assert!(usage_sql(7).contains("m.time_created >= 7"));
        let s = sessions_sql(&["/my vault", "/private/my_vault"]);
        assert!(s.contains("directory = '/my vault'") && s.contains(r"'/private/my\_vault/%' escape '\'") && s.contains("parent_id is null"));
        let ss = sessions_of(&rows(r#"[{"id":"ses_f0c5bbf85ffe6aFOOEAgKslvWD","title":"Run echo hi","directory":"/v","time_updated":9},{"id":"x; rm","title":"","time_updated":1}]"#));
        assert_eq!(ss, [json!({"id": "ses_f0c5bbf85ffe6aFOOEAgKslvWD", "sessionId": "ses_f0c5bbf85ffe6aFOOEAgKslvWD", "name": "Run echo hi", "kind": "interactive", "status": "idle", "updatedAt": 9})]);
    }

    #[test]
    fn models_of_the_configured_providers() {
        let (m, e) = parse_models(include_str!("../tests/fixtures/models-verbose.txt"));
        assert_eq!(m[0], Choice::new("opencode/big-pickle", "Big Pickle · opencode"));
        assert_eq!(m.len(), 3);
        assert_eq!(e.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["low", "medium", "high"]);
        assert_eq!(parse_models(""), (vec![], vec![]));
        assert_eq!(rfc3339(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(rfc3339(1790726400000), "2026-09-30T00:00:00.000Z");
    }
}
