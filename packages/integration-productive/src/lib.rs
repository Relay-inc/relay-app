//! Productive on the backend: org and user id in the config, the API token in the keychain
//! (vault-app.productive/token). GET on any path, PATCH on a single task, comment or attachment, POST a task, a
//! comment or an attachment record. The file itself goes to Productive's S3 bucket as a form, without the token.

use board_core::{arg, arg_ok, digits, query_text, iso_date, path_ok, read, t, t_v, write, Action, Provider, Req, Text};
use serde_json::{json, Value};

const TEXT: Text = &[
    ("digits", ["Productive: {v} may only contain digits", "Productive: {v} bestaat enkel uit cijfers", "Productive : {v} ne peut contenir que des chiffres", "Productive: {v} darf nur Ziffern enthalten"]),
    ("org_id", ["organisation ID", "organisatie-id", "l'ID d'organisation", "die Organisations-ID"]),
    ("user_id", ["user ID", "gebruikers-id", "l'ID utilisateur", "die Benutzer-ID"]),
    ("no_org", ["No organisation ID. Fill it in under Vault › Settings… › Integrations.", "Geen organisatie-id. Vul het in bij Vault › Instellingen… › Integraties.", "Aucun ID d'organisation. Renseignez-le dans Vault › Réglages… › Intégrations.", "Keine Organisations-ID. Trag sie unter Vault › Einstellungen… › Integrationen ein."]),
    ("no_import_token", ["No Productive token in ~/.claude.json", "Geen Productive-token in ~/.claude.json", "Aucun jeton Productive dans ~/.claude.json", "Kein Productive-Token in ~/.claude.json"]),
];

pub const PROVIDER: Provider = Provider {
    id: "productive",
    name: "Productive",
    text: TEXT,
    defaults: |c| {
        if !c["on"].is_boolean() { c["on"] = json!(true); }
        for k in ["org", "user"] { if !c[k].is_string() { c[k] = json!(""); } }
    },
    check: |c| {
        for k in ["org", "user"] {
            if !c[k].as_str().unwrap().chars().all(|x| x.is_ascii_digit()) {
                return Err(t_v(TEXT, "digits", &t(TEXT, if k == "org" { "org_id" } else { "user_id" })));
            }
        }
        Ok(())
    },
    ready: |c| !c["org"].as_str().unwrap_or("").is_empty(),
    not_ready: "no_org",
    secrets: &["token"],
    url: |_, method, path, body| {
        let one = |kind: &str| path.strip_prefix(kind).is_some_and(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()));
        let write = body.is_some() && match method {
            "PATCH" => one("/tasks/") || one("/comments/") || one("/attachments/"),
            "POST" => path == "/comments" || path == "/attachments" || path == "/tasks",
            _ => false,
        };
        (path_ok(path) && (method == "GET" || write)).then(|| format!("https://api.productive.io/api/v2{path}"))
    },
    upload: |url| url.strip_prefix("https://").map(|r| r.split('/').next().unwrap_or(""))
        .is_some_and(|h| h.starts_with("productive-") && h.ends_with(".amazonaws.com") && h.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')),
    // an attachment's thumb (100×100) is public; the original wants a browser login, the API token gets the login page
    upload_kind: board_core::UploadKind::Form,
    thumb: |url| url.strip_prefix("https://files.productive.io/attachments/").is_some_and(|r| r.contains("/thumb/")) && url.len() < 2000 && !url.chars().any(char::is_control),
    // the original redirects to Productive's login: the viewer window shows that once, then the picture
    original: |url| url.strip_prefix("https://files.productive.io/attachments/").is_some_and(|r| r.contains("/original/")) && url.len() < 2000 && !url.chars().any(char::is_control),
    headers: |c, s| vec![format!("X-Auth-Token: {}", s[0]), format!("X-Organization-Id: {}", c["org"].as_str().unwrap_or("")),
        "Content-Type: application/vnd.api+json".into()],
    ok: |_| true,
    error: |code, v| {
        let e = &v["errors"][0];
        format!("Productive {code}: {}", board_core::message(e["detail"].as_str().or(e["title"].as_str())))
    },
    mcp: Some(board_core::Mcp { server: "productive", secrets: &[("token", &["PRODUCTIVE_API_TOKEN"])],
        fields: &[("PRODUCTIVE_ORG_ID", "org"), ("PRODUCTIVE_USER_ID", "user")] }),
    actions: ACTIONS,
};

// ---------- agent actions (`relay productive.<id>`)

const API: &str = "https://api.productive.io/api/v2";
fn get(path: String) -> Result<Req, String> { Ok(Req { method: "GET", url: format!("{API}{path}"), body: None }) }
fn post(path: &str, body: Value) -> Result<Req, String> { Ok(Req { method: "POST", url: format!("{API}{path}"), body: Some(body) }) }
fn rel(kind: &str, id: &str) -> Value { json!({ "data": { "type": kind, "id": id } }) }
/// The configured user, the person time is booked on.
fn me(cfg: &Value) -> Result<String, String> {
    cfg["user"].as_str().filter(|u| digits(u)).map(String::from).ok_or_else(|| "Productive: no user ID, fill it in under Settings › Integrations".into())
}
/// A JSON:API list as `{id, <attrs>…}` rows.
fn rows(v: &Value, attrs: &[&str]) -> Value {
    v["data"].as_array().map(|d| d.iter().map(|r| {
        let mut o = json!({ "id": r["id"] });
        for a in attrs { o[*a] = r["attributes"][*a].clone(); }
        o
    }).collect()).unwrap_or_default()
}
/// The `included` record a relationship of the main record points at.
fn inc<'a>(v: &'a Value, rel: &str) -> &'a Value {
    let d = &v["data"]["relationships"][rel]["data"];
    v["included"].as_array().and_then(|i| i.iter().find(|x| x["type"] == d["type"] && x["id"] == d["id"])).map_or(&Value::Null, |x| &x["attributes"])
}
fn person(a: &Value) -> Value { if a.is_null() { Value::Null } else { json!(format!("{} {}", a["first_name"].as_str().unwrap_or(""), a["last_name"].as_str().unwrap_or("")).trim()) } }
fn created(v: &Value) -> Value { json!({ "id": v["data"]["id"], "type": v["data"]["type"] }) }

const ACTIONS: &[Action] = &[
    read("projects", "Active projects you can see.", &[],
        |_, _| get("/projects?filter[status]=1&page[size]=200".into()), |v| rows(v, &["name", "project_number"])),
    read("task_lists", "Open task lists of a project, where a new task goes.", &[("project", "project id")],
        |_, a| get(format!("/task_lists?filter[project_id]={}&filter[status]=1&page[size]=200", arg_ok(a, "project", digits)?)), |v| rows(v, &["name"])),
    read("search", "Search tasks by text (title or number), up to 20.", &[("query", "search text"), ("project?", "project id")],
        |_, a| {
            let p = match arg(a, "project") { Some(_) => format!("&filter[project_id]={}", arg_ok(a, "project", digits)?), None => String::new() };
            get(format!("/tasks?filter[query]={}{p}&page[size]=20", query_text(&arg(a, "query").unwrap_or_default())))
        }, |v| v["data"].as_array().map(|d| d.iter().map(|r| json!({ "id": r["id"], "number": r["attributes"]["task_number"], "title": r["attributes"]["title"],
            "closed": r["attributes"]["closed"], "project": r["relationships"]["project"]["data"]["id"] })).collect()).unwrap_or_default()),
    read("task", "Read one task: title, description (HTML), status, assignee, project, due date.", &[("task", "task id")],
        |_, a| get(format!("/tasks/{}?include=project,workflow_status,assignee", arg_ok(a, "task", digits)?)),
        |v| { let t = &v["data"]["attributes"]; json!({ "id": v["data"]["id"], "number": t["task_number"], "title": t["title"], "description": t["description"],
            "due_date": t["due_date"], "closed": t["closed"], "status": inc(v, "workflow_status")["name"], "assignee": person(inc(v, "assignee")), "project": inc(v, "project")["name"] }) }),
    read("comments", "The comments on a task; bodies are HTML.", &[("task", "task id")],
        |_, a| get(format!("/comments?filter[task_id]={}&include=creator&page[size]=200", arg_ok(a, "task", digits)?)),
        |v| v["data"].as_array().map(|d| d.iter().map(|r| {
            let by = r["relationships"]["creator"]["data"].clone();
            let who = v["included"].as_array().and_then(|i| i.iter().find(|x| x["type"] == by["type"] && x["id"] == by["id"])).map_or(&Value::Null, |x| &x["attributes"]);
            json!({ "id": r["id"], "by": person(who), "date": r["attributes"]["created_at"], "body": r["attributes"]["body"] })
        }).collect()).unwrap_or_default()),
    write("create_task", "Create a task in a project's task list.",
        &[("project", "project id"), ("task_list", "task list id"), ("title", "task title"), ("description?", "body, HTML"), ("assignee?", "person id, or 'me'")],
        |cfg, a| {
            let mut r = json!({ "project": rel("projects", &arg_ok(a, "project", digits)?), "task_list": rel("task_lists", &arg_ok(a, "task_list", digits)?) });
            if let Some(who) = arg(a, "assignee") { r["assignee"] = rel("people", &if who == "me" { me(cfg)? } else { arg_ok(a, "assignee", digits)? }); }
            post("/tasks", json!({ "data": { "type": "tasks", "attributes": { "title": arg(a, "title"), "description": arg(a, "description").unwrap_or_default() }, "relationships": r } }))
        }, created),
    write("comment", "Comment on a task.", &[("task", "task id"), ("body", "the comment, HTML")],
        |_, a| post("/comments", json!({ "data": { "type": "comments", "attributes": { "body": arg(a, "body") }, "relationships": { "task": rel("tasks", &arg_ok(a, "task", digits)?) } } })),
        created),
    read("services", "The services (budget lines) of a project that time can be booked on.", &[("project", "project id")],
        |_, a| get(format!("/services?filter[project_id]={}&page[size]=200", arg_ok(a, "project", digits)?)), |v| rows(v, &["name"])),
    read("time_entries", "Your time entries between two dates (inclusive). time is in minutes.", &[("after", "YYYY-MM-DD"), ("before", "YYYY-MM-DD")],
        |cfg, a| get(format!("/time_entries?filter[person_id]={}&filter[after]={}&filter[before]={}&page[size]=200", me(cfg)?, arg_ok(a, "after", iso_date)?, arg_ok(a, "before", iso_date)?)),
        |v| v["data"].as_array().map(|d| d.iter().map(|r| json!({ "id": r["id"], "date": r["attributes"]["date"], "time": r["attributes"]["time"],
            "note": r["attributes"]["note"], "service": r["relationships"]["service"]["data"]["id"] })).collect()).unwrap_or_default()),
    write("add_time", "Book time on a service for you.", &[("service", "service id"), ("date", "YYYY-MM-DD"), ("minutes", "duration in minutes"), ("note?", "what was done"), ("task?", "task id")],
        |cfg, a| {
            let minutes: u32 = arg_ok(a, "minutes", digits)?.parse().ok().filter(|m| (1..=1440).contains(m)).ok_or("'minutes' must be 1 to 1440")?;
            let mut r = json!({ "person": rel("people", &me(cfg)?), "service": rel("services", &arg_ok(a, "service", digits)?) });
            if arg(a, "task").is_some() { r["task"] = rel("tasks", &arg_ok(a, "task", digits)?); }
            post("/time_entries", json!({ "data": { "type": "time_entries", "attributes": { "date": arg_ok(a, "date", iso_date)?, "time": minutes, "note": arg(a, "note").unwrap_or_default() }, "relationships": r } }))
        }, created),
];

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    #[test]
    fn imports_from_wherever_claude_code_keeps_the_server() {
        let env = json!({"env": {"PRODUCTIVE_API_TOKEN": "t", "PRODUCTIVE_ORG_ID": "9093", "PRODUCTIVE_USER_ID": "7"}});
        let fields = json!({"org": "9093", "user": "7"});
        let import = |c: Value, v: &str, m: Value| board_core::from_claude(&PROVIDER, &c, v, &m).map(|(s, f)| (s, Value::Object(f)));
        let want = Some((vec![("token".to_string(), "t".to_string())], fields));
        assert_eq!(import(json!({"mcpServers": {"productive": env}}), "/v", Value::Null), want);
        assert_eq!(import(json!({"projects": {"/v": {"mcpServers": {"productive": env}}}}), "/v", Value::Null), want);
        assert_eq!(import(json!({}), "/v", json!({"mcpServers": {"productive": env}})), want);
        assert_eq!(import(json!({"projects": {"/other": {"mcpServers": {"productive": env}}}}), "/v", Value::Null), None);
        // the exact name wins over one that contains it (productive-dev next to productive)
        let dev = json!({"env": {"PRODUCTIVE_API_TOKEN": "dev"}});
        assert_eq!(import(json!({"mcpServers": {"productive-dev": dev, "productive": env}}), "/v", Value::Null).unwrap().0[0].1, "t");
    }
    #[test]
    fn allows_reads_new_and_moved_tasks_comments_and_attachments() {
        let p = &PROVIDER;
        let c = json!({ "org": "1" });
        assert!((p.url)(&c, "GET", "/tasks?filter[folder_id]=3&page[size]=200", &None).is_some());
        assert!((p.url)(&c, "PATCH", "/tasks/42", &Some(json!({}))).is_some());
        assert!((p.url)(&c, "PATCH", "/tasks", &Some(json!({}))).is_none());
        assert!((p.url)(&c, "PATCH", "/comments/7", &Some(json!({}))).is_some() && (p.url)(&c, "PATCH", "/attachments/7", &Some(json!({}))).is_some());
        assert!((p.url)(&c, "POST", "/comments", &Some(json!({}))).is_some() && (p.url)(&c, "POST", "/attachments", &Some(json!({}))).is_some());
        assert!((p.url)(&c, "POST", "/comments", &None).is_none() && (p.url)(&c, "POST", "/tasks", &None).is_none());
        // a new task from the board
        assert!((p.url)(&c, "POST", "/tasks", &Some(json!({}))).is_some() && (p.url)(&c, "POST", "/tasks/42", &Some(json!({}))).is_none());
        assert!((p.url)(&c, "PATCH", "/people/7", &Some(json!({}))).is_none() && (p.url)(&c, "DELETE", "/comments/7", &None).is_none());
        assert!((p.upload)("https://productive-files-production.s3.eu-west-1.amazonaws.com") && (p.upload)("https://productive-files.s3.amazonaws.com/k"));
        for bad in ["https://attacker.s3.amazonaws.com", "http://productive-files.s3.amazonaws.com", "https://evil.com/.amazonaws.com", "https://a@b.amazonaws.com", "https://amazonaws.com.evil.com"] { assert!(!(p.upload)(bad), "{bad}"); }
        assert!((p.thumb)("https://files.productive.io/attachments/files/009/675/225/thumb/Scherm%C2%ADafbeelding.png?1790771917"));
        for bad in ["https://files.productive.io/attachments/files/009/675/225/original/a.png", "http://files.productive.io/attachments/x/thumb/a.png",
            "https://files.productive.io.evil.com/attachments/x/thumb/a.png", "https://files.productive.io/attachments/x/thumb/a\n.png"] { assert!(!(p.thumb)(bad), "{bad}"); }
        assert!((p.original)("https://files.productive.io/attachments/files/009/675/225/original/a.png?1790771917"));
        for bad in ["https://files.productive.io/attachments/files/009/675/225/thumb/a.png", "http://files.productive.io/attachments/x/original/a.png",
            "https://files.productive.io.evil.com/attachments/x/original/a.png", "https://app.productive.io/attachments/x/original/a.png", "javascript:alert(1)//https://files.productive.io/attachments/x/original/a.png"] { assert!(!(p.original)(bad), "{bad}"); }
        assert!((p.url)(&c, "DELETE", "/tasks/42", &None).is_none());
        assert!((p.url)(&c, "GET", "/../x", &None).is_none());
        assert!((p.ready)(&c) && !(p.ready)(&json!({ "org": "" })));
        assert_eq!((p.headers)(&c, &["t-1".into()])[..2], ["X-Auth-Token: t-1".to_string(), "X-Organization-Id: 1".into()]);
    }
    #[test]
    fn actions_build_their_own_requests_from_checked_ids() {
        let act = |id: &str| PROVIDER.actions.iter().find(|a| a.id == id).unwrap();
        let cfg = json!({ "org": "1", "user": "7" });
        let r = (act("create_task").build)(&cfg, &json!({ "project": "3", "task_list": 4, "title": "T", "assignee": "me" })).unwrap();
        assert_eq!((r.method, r.url.as_str()), ("POST", "https://api.productive.io/api/v2/tasks"));
        let b = r.body.unwrap();
        assert_eq!(b["data"]["relationships"]["task_list"]["data"]["id"], "4");
        assert_eq!(b["data"]["relationships"]["assignee"]["data"]["id"], "7");
        assert!((act("create_task").build)(&cfg, &json!({ "project": "3&x=1", "task_list": "4", "title": "T" })).is_err());
        let t = (act("add_time").build)(&cfg, &json!({ "service": "9", "date": "2026-10-01", "minutes": "90" })).unwrap().body.unwrap();
        assert_eq!((t["data"]["attributes"]["time"].clone(), t["data"]["relationships"]["person"]["data"]["id"].clone()), (json!(90), json!("7")));
        assert!((act("add_time").build)(&cfg, &json!({ "service": "9", "date": "1 okt", "minutes": "90" })).is_err());
        assert!((act("add_time").build)(&json!({ "org": "1", "user": "" }), &json!({ "service": "9", "date": "2026-10-01", "minutes": "90" })).unwrap_err().contains("user ID"));
        assert!((act("task_lists").build)(&cfg, &json!({ "project": "3" })).unwrap().url.ends_with("filter[project_id]=3&filter[status]=1&page[size]=200"));
        assert_eq!((act("projects").out)(&json!({ "data": [{ "id": "3", "attributes": { "name": "P", "project_number": "12", "x": 1 } }] })), json!([{ "id": "3", "name": "P", "project_number": "12" }]));
        let s = (act("search").build)(&cfg, &json!({ "query": "fix & ship", "project": "3" })).unwrap();
        assert!(s.url.ends_with("/tasks?filter[query]=fix%20%26%20ship&filter[project_id]=3&page[size]=20"), "{}", s.url);
        assert!((act("search").build)(&cfg, &json!({ "query": "x", "project": "3&a" })).is_err() && (act("task").build)(&cfg, &json!({ "task": "1/x" })).is_err());
        let task = json!({ "data": { "id": "5", "attributes": { "title": "T", "task_number": 12 }, "relationships": { "assignee": { "data": { "type": "people", "id": "7" } }, "workflow_status": { "data": null } } },
            "included": [{ "type": "people", "id": "7", "attributes": { "first_name": "Ann", "last_name": "Lee" } }, { "type": "projects", "id": "7", "attributes": { "name": "wrong" } }] });
        let out = (act("task").out)(&task);
        assert_eq!((out["assignee"].clone(), out["status"].clone(), out["number"].clone()), (json!("Ann Lee"), Value::Null, json!(12)));
        // writes ask unless the user says otherwise
        for a in PROVIDER.actions { assert!(a.write == (a.default == board_core::Policy::Ask), "{}", a.id); }
    }
    #[test]
    fn config_ids_are_digits_and_errors_read_as_one_line() {
        let p = &PROVIDER;
        assert!((p.check)(&json!({ "org": "12", "user": "" })).is_ok());
        assert!((p.check)(&json!({ "org": "x1", "user": "" })).unwrap_err().contains("organisation ID"));
        assert_eq!((p.error)("422", &json!({ "errors": [{ "detail": "bad list" }] })), "Productive 422: bad list");
        assert_eq!((p.error)("500", &Value::Null), "Productive 500: unknown error");
    }
    #[test]
    fn import_reads_the_mcp_config() {
        let (tok, cfg) = board_core::from_claude(&PROVIDER, &json!({ "mcpServers": { "productive": { "env": { "PRODUCTIVE_API_TOKEN": "abc", "PRODUCTIVE_ORG_ID": "7" } } } }), "", &Value::Null).unwrap();
        assert_eq!((tok, Value::Object(cfg)), (vec![("token".to_string(), "abc".to_string())], json!({ "org": "7", "user": "" })));
        assert!(board_core::from_claude(&PROVIDER, &json!({}), "", &Value::Null).is_none());
    }
}
