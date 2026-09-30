//! Codex's thread index, `$CODEX_HOME/state_5.sqlite` (table `threads`: id, rollout_path, cwd, title, updated_at, …),
//! read with the system's sqlite3 in read-only mode. Where it is missing (another version) the rollouts stand in.

use serde_json::{json, Value};
use std::path::Path;
use std::process::{Command, Stdio};

const SQLITE: &str = "/usr/bin/sqlite3";

/// `select …` as JSON rows, read-only; None when there is no database or no sqlite3.
pub fn query(db: &Path, sql: &str) -> Option<Vec<Value>> {
    if !db.is_file() { return None; }
    let out = Command::new(SQLITE).arg("-readonly").arg("-json").arg(db).arg(sql).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    if !out.status.success() { return None; }
    let s = String::from_utf8_lossy(&out.stdout);
    // no rows is no output at all
    if s.trim().is_empty() { Some(vec![]) } else { serde_json::from_str(&s).ok() }
}
fn quote(s: &str) -> String { format!("'{}'", s.replace('\'', "''")) }

pub fn threads_sql(vault: &str) -> String {
    format!("select id, rollout_path, title, preview, first_user_message, updated_at from threads where archived = 0 and (cwd = {} or cwd like {} escape '\\') order by updated_at desc limit 100",
        quote(vault), quote(&format!("{}/%", vault.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"))))
}
pub fn rollout_sql(sid: &str) -> String { format!("select rollout_path from threads where id = {}", quote(sid)) }

/// A thread row as a session of the contract: idle, interactive (a terminal session).
pub fn session(sid: &str, name: &str, updated_s: i64) -> Value {
    json!({"id": sid, "sessionId": sid, "name": name, "kind": "interactive", "status": "idle", "updatedAt": updated_s * 1000})
}
pub fn sessions_of(rows: &[Value]) -> Vec<Value> {
    rows.iter().filter_map(|r| {
        let sid = r["id"].as_str().filter(|s| agent_core::safe_id(s))?;
        let name = ["title", "preview", "first_user_message"].iter().filter_map(|k| r[*k].as_str()).map(|s| s.trim()).find(|s| !s.is_empty()).unwrap_or("");
        Some(session(sid, &name.lines().next().unwrap_or("").chars().take(80).collect::<String>(), r["updated_at"].as_i64().unwrap_or(0)))
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn threads_from_a_state_database() {
        let rows: Vec<Value> = serde_json::from_str(include_str!("../tests/fixtures/threads.json")).unwrap();
        let s = sessions_of(&rows);
        assert_eq!(s.len(), 2); // not the row with an id that may not go on a command line
        assert_eq!(s[0], json!({"id": "019a0000-aaaa-7000-8000-000000000001", "sessionId": "019a0000-aaaa-7000-8000-000000000001",
            "name": "Inbox opruimen", "kind": "interactive", "status": "idle", "updatedAt": 1790755300000i64}));
        assert_eq!(s[1]["name"], "Wat staat er open?"); // no title: the first message
        assert!(threads_sql("/Users/me/it's_v").contains("cwd = '/Users/me/it''s_v' or cwd like '/Users/me/it''s\\_v/%'"));

        // the real thing when sqlite3 is there: a database with the columns this version has
        let d = std::env::temp_dir().join(format!("vault-codex-state-{}.sqlite", std::process::id()));
        std::fs::remove_file(&d).ok();
        let made = Command::new(SQLITE).arg(&d).arg("create table threads (id text primary key, rollout_path text not null, created_at integer, updated_at integer, cwd text, title text, archived integer default 0, preview text default '', first_user_message text default '');
            insert into threads values ('019a0000-bbbb-7000-8000-000000000002', '/r/b.jsonl', 1, 20, '/v', 'Twee', 0, '', '');
            insert into threads values ('019a0000-cccc-7000-8000-000000000003', '/r/c.jsonl', 1, 30, '/v/sub', '', 0, 'Drie', '');
            insert into threads values ('019a0000-dddd-7000-8000-000000000004', '/r/d.jsonl', 1, 40, '/vx', 'Elders', 0, '', '');
            insert into threads values ('019a0000-eeee-7000-8000-000000000005', '/r/e.jsonl', 1, 50, '/v', 'Weg', 1, '', '');").status();
        if made.is_ok_and(|s| s.success()) {
            let s = sessions_of(&query(&d, &threads_sql("/v")).unwrap());
            assert_eq!(s.iter().map(|x| x["name"].as_str().unwrap()).collect::<Vec<_>>(), ["Drie", "Twee"]);
            assert_eq!(query(&d, &rollout_sql("019a0000-bbbb-7000-8000-000000000002")).unwrap()[0]["rollout_path"], "/r/b.jsonl");
            assert_eq!(query(&d, &rollout_sql("nope")).unwrap().len(), 0);
        }
        std::fs::remove_file(&d).ok();
        assert!(query(Path::new("/nonexistent/state_5.sqlite"), "select 1").is_none());
    }
}
