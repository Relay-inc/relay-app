// The rules of the user's `timesheet` Claude plugin (~/.claude/timesheet.config.json), so Relay books Productive time
// by the same rules instead of its own. Only what the booking prompt uses is passed on. Missing or invalid: None.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Deserialize, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub id: String,
    pub label: String,
    #[serde(default = "yes")]
    pub billable: bool,
    #[serde(default)]
    pub keywords: Vec<String>,
}
fn yes() -> bool { true }

#[derive(Deserialize, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub services: Vec<Service>,
    #[serde(default)]
    pub placeholder_service_id: Option<String>,
    #[serde(default)]
    pub target_hours_per_day: Option<f64>,
    #[serde(default)]
    pub granularity_minutes: Option<u32>,
    #[serde(default)]
    pub note_language: Option<String>,
    #[serde(default)]
    pub git_repo_parents: Vec<String>,
}

/// The plugin's file at `path`: needs a version and at least one service, and a granularity of 1 to 240 minutes when set.
fn read(path: &Path) -> Option<Config> {
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    v["version"].as_u64()?;
    let c: Config = serde_json::from_value(v).ok()?;
    (!c.services.is_empty() && c.granularity_minutes.is_none_or(|g| (1..=240).contains(&g))).then_some(c)
}

#[tauri::command]
pub fn timesheet_config() -> Option<Config> {
    read(&Path::new(&agent_core::home()).join(".claude/timesheet.config.json"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parse(json: &str) -> Option<Config> {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let f = std::env::temp_dir().join(format!("relay-timesheet-{}-{}.json", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
        std::fs::write(&f, json).unwrap();
        read(&f)
    }
    #[test]
    fn reads_the_plugins_file_and_ignores_the_rest() {
        let c = parse(r##"{"version":1,"granularityMinutes":30,"targetHoursPerDay":7.5,"noteLanguage":"nl","placeholderServiceId":"11",
            "gitRepoParents":["~/code"],"sources":{"git":true},"services":[{"id":"11","label":"Northwind support","keywords":["nw"],"slackChannels":["#x"]},
            {"id":"12","label":"Internal","billable":false}]}"##).unwrap();
        assert_eq!((c.granularity_minutes, c.target_hours_per_day, c.services.len()), (Some(30), Some(7.5), 2));
        assert!(c.services[0].billable && !c.services[1].billable);
        assert_eq!(c.services[0].keywords, ["nw"]);
    }
    #[test]
    fn missing_or_invalid_is_none() {
        assert!(read(Path::new("/nonexistent/timesheet.json")).is_none());
        for bad in ["not json", "{}", r#"{"version":1}"#, r#"{"version":1,"services":[]}"#,
            r#"{"version":1,"services":[{"id":"1","label":"A"}],"granularityMinutes":0}"#, r#"{"services":[{"id":"1","label":"A"}]}"#] {
            assert!(parse(bad).is_none(), "{bad}");
        }
    }
}
