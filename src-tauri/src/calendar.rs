// Google Calendar, read-only, through each calendar's secret iCal address: no OAuth. The address is the secret
// (whoever has it reads the calendar), so it lives in the macOS keychain (service relay-calendar, account the
// calendar's email), goes to curl over stdin and never reaches the webview. settings.json only keeps
// `calendar.feeds[].email`. The webview asks for the meetings of the next hours and shows the ones about to start
// under Waiting, with a banner 5 minutes before (src/domain/calendar.ts).
// A meeting here: a timed event with at least one other person invited, not declined, not cancelled, not "free".

use chrono::{DateTime, Duration, Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::Write;
use std::process::{Command, Stdio};

const SERVICE: &str = "relay-calendar";
/// ponytail: Google only, as asked. Another provider's feed is one more prefix here.
const PREFIX: &str = "https://calendar.google.com/calendar/ical/";

/// settings.json `calendar`: { on, feeds: [{ email }] }, a feed without a valid email dropped.
pub fn norm(v: &mut Value) {
    if !v["calendar"].is_object() { v["calendar"] = json!({}); }
    let c = &mut v["calendar"];
    if !c["on"].is_boolean() { c["on"] = json!(false); }
    if !c["feeds"].is_array() { c["feeds"] = json!([]); }
    c["feeds"].as_array_mut().unwrap().retain(|f| f["email"].as_str().is_some_and(email_ok));
}
pub fn feeds(s: &Value) -> Vec<String> {
    if s["calendar"]["on"] != true { return vec![]; }
    s["calendar"]["feeds"].as_array().into_iter().flatten().filter_map(|f| f["email"].as_str()).map(String::from).collect()
}

fn email_ok(e: &str) -> bool {
    e.len() < 100 && e.contains('@') && e.chars().all(|c| c.is_ascii_alphanumeric() || "@._+-".contains(c))
}
/// A Google secret iCal address: under PREFIX, ends in .ics, nothing curl or `security -i` reads as syntax.
fn url_ok(u: &str) -> bool {
    u.starts_with(PREFIX) && u.ends_with(".ics") && u.len() < 400 && u.chars().all(|c| c.is_ascii_alphanumeric() || "%@._/:-".contains(c))
}

// ---------- keychain

fn secret(email: &str) -> Option<String> {
    let o = Command::new("/usr/bin/security").args(["find-generic-password", "-s", SERVICE, "-a", email, "-w"]).output().ok()?;
    let t = String::from_utf8_lossy(&o.stdout).trim().to_string();
    (o.status.success() && !t.is_empty()).then_some(t)
}
fn forget(email: &str) { Command::new("/usr/bin/security").args(["delete-generic-password", "-s", SERVICE, "-a", email]).output().ok(); }

/// Settings › Calendar: save a calendar's secret address and try it, the number of meetings in the next 7 days back.
/// An address that does not load is not saved. An empty address removes the calendar's entry.
pub fn connect(email: &str, url: &str) -> Result<usize, String> {
    let (email, url) = (email.trim(), url.trim());
    if !email_ok(email) { return Err(super::trc("err.cal_email")); }
    if url.is_empty() { forget(email); return Ok(0); }
    if !url_ok(url) { return Err(super::trc("err.cal_url")); }
    // tried before it is saved: a mistyped address for a calendar already set up leaves the working one in place
    let now = Utc::now();
    let count = meetings(&fetch(url)?, email, now, now + Duration::days(7)).len();
    let mut ch = Command::new("/usr/bin/security").arg("-i").stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
    writeln!(ch.stdin.take().unwrap(), "add-generic-password -U -s {SERVICE} -a {email} -w {url}").map_err(|e| e.to_string())?;
    ch.wait().map_err(|e| e.to_string())?;
    if secret(email).as_deref() != Some(url) { return Err(super::trc("err.cal_keychain")); }
    Ok(count)
}

fn fetch(url: &str) -> Result<String, String> {
    let mut ch = Command::new("/usr/bin/curl").args(["-sS", "--fail", "--proto", "=https", "--max-time", "20", "--max-filesize", "50000000", "-K", "-"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    ch.stdin.take().unwrap().write_all(format!("url = {}\n", super::providers::curl_quote(url)).as_bytes()).map_err(|e| e.to_string())?;
    let o = ch.wait_with_output().map_err(|e| e.to_string())?;
    if !o.status.success() { return Err(super::trc_v("err.cal_down", String::from_utf8_lossy(&o.stderr).trim())); }
    let t = String::from_utf8_lossy(&o.stdout).into_owned();
    if !t.trim_start().starts_with("BEGIN:VCALENDAR") { return Err(super::trc_v("err.cal_down", "no iCal")); }
    Ok(t)
}

/// The meetings of every switched-on calendar from an hour ago to 12 hours ahead, sorted, one copy of a meeting that
/// is on two calendars. A calendar that fails is in `errors`, the others still come.
pub fn upcoming(s: &Value) -> Value {
    let now = Utc::now();
    let (mut all, mut errors, mut seen) = (vec![], vec![], HashSet::new());
    for email in feeds(s) {
        let got = secret(&email).ok_or_else(|| super::trc_v("err.cal_no_url", &email)).and_then(|u| fetch(&u));
        match got {
            Ok(ics) => all.extend(meetings(&ics, &email, now - Duration::hours(1), now + Duration::hours(12)).into_iter().filter(|m| seen.insert((m["title"].to_string(), m["start"].to_string())))),
            Err(e) => errors.push(format!("{email}: {e}")),
        }
    }
    all.sort_by(|a, b| a["start"].as_str().cmp(&b["start"].as_str()));
    json!({ "meetings": all, "errors": errors })
}

// ---------- iCal

/// A property line: name, its parameters (upper-cased names), the value.
struct Prop { name: String, params: Vec<(String, String)>, value: String, raw: String }
impl Prop {
    fn param(&self, k: &str) -> Option<&str> { self.params.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str()) }
}
fn parse_line(raw: &str) -> Option<Prop> {
    // the first ':' outside quotes ends the name and parameters (CN="Doe, John: PM" has one inside)
    let (mut q, mut at) = (false, None);
    for (i, c) in raw.char_indices() { match c { '"' => q = !q, ':' if !q => { at = Some(i); break; } _ => {} } }
    let (head, value) = raw.split_at(at?);
    let mut parts = vec![];
    let (mut cur, mut q) = (String::new(), false);
    for c in head.chars() { match c { '"' => q = !q, ';' if !q => parts.push(std::mem::take(&mut cur)), _ => cur.push(c) } }
    parts.push(cur);
    let name = parts.remove(0).to_ascii_uppercase();
    let params = parts.into_iter().filter_map(|p| p.split_once('=').map(|(k, v)| (k.to_ascii_uppercase(), v.to_string()))).collect();
    Some(Prop { name, params, value: value[1..].to_string(), raw: raw.to_string() })
}
fn unescape(s: &str) -> String { s.replace("\\n", "\n").replace("\\N", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\") }

/// A DTSTART/DTEND/RECURRENCE-ID as a moment: UTC (…Z), in its TZID, or floating (local). None for a date (all day).
fn when(p: &Prop) -> Option<DateTime<Utc>> {
    if p.param("VALUE") == Some("DATE") || p.value.len() == 8 { return None; }
    let v = p.value.trim_end_matches('Z');
    let n = NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%S").ok()?;
    if p.value.ends_with('Z') { return Some(Utc.from_utc_datetime(&n)); }
    match p.param("TZID").and_then(|z| z.parse::<chrono_tz::Tz>().ok()) {
        Some(tz) => tz.from_local_datetime(&n).earliest().map(|d| d.with_timezone(&Utc)),
        None => Local.from_local_datetime(&n).earliest().map(|d| d.with_timezone(&Utc)),
    }
}

struct Ev { props: Vec<Prop> }
impl Ev {
    fn get(&self, k: &str) -> Option<&Prop> { self.props.iter().find(|p| p.name == k) }
    fn all<'a>(&'a self, k: &'a str) -> impl Iterator<Item = &'a Prop> + 'a { self.props.iter().filter(move |p| p.name == k) }
    fn text(&self, k: &str) -> String { self.get(k).map(|p| unescape(&p.value)).unwrap_or_default() }
}
fn events(ics: &str) -> Vec<Ev> {
    // unfold: a line starting with a space or tab continues the one before
    let mut lines: Vec<String> = vec![];
    for l in ics.split('\n').map(|l| l.trim_end_matches('\r')) {
        match (l.strip_prefix(' ').or_else(|| l.strip_prefix('\t')), lines.last_mut()) { (Some(rest), Some(last)) => last.push_str(rest), _ => lines.push(l.to_string()) }
    }
    let (mut out, mut cur, mut depth) = (vec![], None::<Vec<Prop>>, 0);
    for l in &lines {
        match l.as_str() {
            "BEGIN:VEVENT" => cur = Some(vec![]),
            "END:VEVENT" => { if let Some(p) = cur.take() { out.push(Ev { props: p }); } }
            // a VALARM inside the event has its own properties (DESCRIPTION, TRIGGER), not the event's
            x if x.starts_with("BEGIN:") && cur.is_some() => depth += 1,
            x if x.starts_with("END:") && cur.is_some() => depth -= 1,
            _ => if let (Some(c), 0) = (cur.as_mut(), depth) { if let Some(p) = parse_line(l) { c.push(p); } },
        }
    }
    out
}

/// Where to join: the first Meet/Zoom/Teams link in Google's conference field, the location or the description.
fn join(e: &Ev) -> String {
    // the invite's author fills these in, Google's field too: only a link to a known meeting host goes behind Join
    let text = format!("{} {} {}", e.get("X-GOOGLE-CONFERENCE").map_or("", |p| p.value.as_str()), e.text("LOCATION"), e.text("DESCRIPTION"));
    text.split(|c: char| c.is_whitespace() || "<>\"()".contains(c))
        .find(|w| w.starts_with("https://") && ["meet.google.com/", "zoom.us/", "teams.microsoft.com/"].iter().any(|h| w.contains(h)))
        .unwrap_or("").to_string()
}
fn mailto(p: &Prop) -> String { p.value.trim_start_matches("mailto:").trim_start_matches("MAILTO:").to_ascii_lowercase() }

/// One meeting as the webview gets it, or None when it is no meeting for `me`.
fn meeting(e: &Ev, me: &str, start: DateTime<Utc>, len: Duration) -> Option<Value> {
    if e.get("STATUS").is_some_and(|s| s.value == "CANCELLED") || e.get("TRANSP").is_some_and(|t| t.value == "TRANSPARENT") { return None; }
    let me = me.to_ascii_lowercase();
    let mut people = vec![];
    for a in e.all("ATTENDEE") {
        let email = mailto(a);
        if email == me { if a.param("PARTSTAT") == Some("DECLINED") { return None; } continue; }
        if matches!(a.param("CUTYPE"), Some("RESOURCE" | "ROOM")) { continue; }
        people.push(json!({ "name": a.param("CN").filter(|n| *n != email).unwrap_or(""), "email": email }));
    }
    if people.is_empty() { return None; } // a block in your own calendar, nobody else in it
    let uid = e.text("UID");
    let organizer = e.get("ORGANIZER").map(|o| o.param("CN").map(String::from).unwrap_or_else(|| mailto(o))).unwrap_or_default();
    Some(json!({
        "id": format!("{uid}@{}", start.timestamp()), "feed": me,
        "title": e.text("SUMMARY"), "start": start.to_rfc3339(), "end": (start + len).to_rfc3339(),
        "location": e.text("LOCATION"), "join": join(e), "organizer": organizer, "people": people,
    }))
}

/// An RRULE whose UNTIL is a bare date, which rrule refuses next to a DTSTART with a time: the end of that day in
/// DTSTART's time zone, as UTC.
fn until_utc(line: &str, dtstart: &Prop) -> String {
    let Some(i) = line.find("UNTIL=") else { return line.to_string() };
    let v: String = line[i + 6..].chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
    let Ok(d) = NaiveDate::parse_from_str(&v, "%Y%m%d") else { return line.to_string() };
    if v.len() != 8 { return line.to_string(); }
    let end = Prop { name: String::new(), params: dtstart.params.clone(), value: format!("{}T235959", d.format("%Y%m%d")), raw: String::new() };
    let Some(utc) = when(&end) else { return line.to_string() };
    line.replacen(&format!("UNTIL={v}"), &format!("UNTIL={}", utc.format("%Y%m%dT%H%M%SZ")), 1)
}

/// The meetings in `me`'s feed that start between `from` and `to`, sorted, recurring ones expanded, moved or cancelled
/// occurrences (an event with RECURRENCE-ID) in place of the rule's.
pub fn meetings(ics: &str, me: &str, from: DateTime<Utc>, to: DateTime<Utc>) -> Vec<Value> {
    let evs = events(ics);
    let moved: HashSet<(String, i64)> = evs.iter()
        .filter_map(|e| Some((e.text("UID"), when(e.get("RECURRENCE-ID")?)?.timestamp()))).collect();
    let mut out = vec![];
    for e in &evs {
        let Some(start) = e.get("DTSTART").and_then(when) else { continue }; // all day, or unreadable
        let end = e.get("DTEND").and_then(when);
        let len = end.map_or(Duration::hours(1), |x| x - start);
        let rule: Vec<&str> = e.props.iter().filter(|p| ["RRULE", "EXDATE", "RDATE"].contains(&p.name.as_str())).map(|p| p.raw.as_str()).collect();
        if rule.is_empty() || e.get("RECURRENCE-ID").is_some() {
            if start >= from && start < to { out.extend(meeting(e, me, start, len)); }
            continue;
        }
        let dtstart = e.get("DTSTART").unwrap();
        // rrule computes every occurrence from DTSTART on: one every second since 2015 takes minutes. No meeting
        // repeats more often than daily, so those rules are left out
        if e.all("RRULE").any(|r| ["SECONDLY", "MINUTELY", "HOURLY"].iter().any(|f| r.value.contains(&format!("FREQ={f}")))) { continue; }
        // an EXDATE that is only a date takes out that day's occurrence; rrule only knows them with a time
        let days: HashSet<NaiveDate> = e.all("EXDATE").filter(|x| x.param("VALUE") == Some("DATE"))
            .flat_map(|x| x.value.split(',').filter_map(|d| NaiveDate::parse_from_str(d, "%Y%m%d").ok()).collect::<Vec<_>>()).collect();
        let rule: Vec<String> = rule.iter().filter(|r| !r.contains("VALUE=DATE")).map(|r| until_utc(r, dtstart)).collect();
        let set = format!("{}\n{}", dtstart.raw, rule.join("\n"));
        let Ok(set) = set.parse::<rrule::RRuleSet>() else { continue }; // ponytail: a rule rrule refuses (an Outlook TZID) is skipped
        let tz = |d: DateTime<Utc>| d.with_timezone(&rrule::Tz::UTC);
        let uid = e.text("UID");
        for s in set.after(tz(from - Duration::seconds(1))).before(tz(to)).all(100).dates {
            if days.contains(&s.date_naive()) { continue; } // in DTSTART's own time zone, like the rule
            let s = s.with_timezone(&Utc);
            if s >= to || moved.contains(&(uid.clone(), s.timestamp())) { continue; }
            out.extend(meeting(e, me, s, len));
        }
    }
    out.sort_by(|a, b| a["start"].as_str().cmp(&b["start"].as_str())); // UTC RFC 3339: text order is time order
    out
}

/// For a test: a moment from a local Brussels date and time.
#[cfg(test)]
fn bxl(d: &str, t: &str) -> DateTime<Utc> {
    let n = NaiveDate::parse_from_str(d, "%Y-%m-%d").unwrap().and_time(chrono::NaiveTime::parse_from_str(t, "%H:%M").unwrap());
    chrono_tz::Europe::Brussels.from_local_datetime(&n).unwrap().with_timezone(&Utc)
}

#[cfg(test)]
mod tests {
    use super::*;
    const ME: &str = "kristof@example.be";
    const ICS: &str = include_str!("../tests/calendar.ics");

    fn titles(from: DateTime<Utc>, to: DateTime<Utc>) -> Vec<(String, String)> {
        meetings(ICS, ME, from, to).iter().map(|m| (m["title"].as_str().unwrap().to_string(), DateTime::parse_from_rfc3339(m["start"].as_str().unwrap()).unwrap().with_timezone(&chrono_tz::Europe::Brussels).format("%m-%d %H:%M").to_string())).collect()
    }

    #[test]
    fn a_day_shows_its_meetings_only() {
        let got = titles(bxl("2026-10-01", "00:00"), bxl("2026-10-02", "00:00"));
        // the weekly at 10:00 (summer time), the one-off with a folded, escaped title; not the all-day, the solo
        // block, the declined one, the cancelled one or the one marked free
        assert_eq!(got, vec![("Team software, weekly".into(), "10-01 10:00".into()), ("Habo x Antenna: Statusoverleg".into(), "10-01 13:00".into())]);
    }
    #[test]
    fn recurring_meetings_follow_their_exceptions() {
        // 8/10 is excluded, 15/10 moved to 14:00, 22/10 cancelled, 29/10 after the clocks change still at 10:00
        let got = titles(bxl("2026-10-02", "00:00"), bxl("2026-11-01", "00:00"));
        assert_eq!(got, vec![("Team software, moved".into(), "10-15 14:00".into()), ("Team software, weekly".into(), "10-29 10:00".into())]);
    }
    #[test]
    fn a_meeting_carries_what_the_card_shows() {
        let m = &meetings(ICS, ME, bxl("2026-10-01", "12:00"), bxl("2026-10-01", "14:00"))[0];
        assert_eq!(m["join"], "https://meet.google.com/vwm-jxnw-cju");
        assert_eq!(m["end"], bxl("2026-10-01", "14:00").to_rfc3339());
        assert_eq!(m["people"], json!([{ "name": "Doe, John", "email": "john@habo.be" }]), "self and the room are left out");
        assert_eq!(m["organizer"], "Mina");
    }
    #[test]
    fn date_only_exceptions_ends_and_too_frequent_rules() {
        let ics = |rule: &str| format!("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;TZID=Europe/Brussels:20261001T100000\nDTEND;TZID=Europe/Brussels:20261001T110000\n{rule}\nUID:r\nSUMMARY:R\nATTENDEE:mailto:x@y.be\nEND:VEVENT\nEND:VCALENDAR\n");
        let days = |rule: &str| meetings(&ics(rule), ME, bxl("2026-10-01", "00:00"), bxl("2026-10-30", "00:00")).iter()
            .map(|m| m["start"].as_str().unwrap()[5..10].to_string()).collect::<Vec<_>>();
        assert_eq!(days("RRULE:FREQ=WEEKLY\nEXDATE;VALUE=DATE:20261008"), ["10-01", "10-15", "10-22", "10-29"]);
        assert_eq!(days("RRULE:FREQ=WEEKLY;UNTIL=20261015"), ["10-01", "10-08", "10-15"]);
        let t = std::time::Instant::now();
        assert!(days("RRULE:FREQ=SECONDLY").is_empty() && t.elapsed().as_secs() < 1);
    }
    #[test]
    fn join_only_goes_to_a_meeting_host() {
        let ics = |conf: &str| format!("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261001T100000Z\nUID:j\nATTENDEE:mailto:x@y.be\nX-GOOGLE-CONFERENCE:{conf}\nEND:VEVENT\nEND:VCALENDAR\n");
        let join = |conf: &str| meetings(&ics(conf), ME, bxl("2026-10-01", "00:00"), bxl("2026-10-02", "00:00"))[0]["join"].clone();
        assert_eq!(join("https://meet.google.com/abc-defg-hij"), "https://meet.google.com/abc-defg-hij");
        assert_eq!(join("https://evil.example/login"), "");
    }
    #[test]
    fn only_a_google_address_is_kept() {
        assert!(url_ok("https://calendar.google.com/calendar/ical/kristof%40example.be/private-0123abcd/basic.ics"));
        assert!(!url_ok("https://evil.example/calendar/ical/x/basic.ics") && !url_ok("https://calendar.google.com/calendar/ical/x y/basic.ics"));
        assert!(!url_ok("https://calendar.google.com/calendar/ical/x/basic.ics\nurl = file:///etc/passwd"));
        let mut s = json!({ "calendar": { "feeds": [{ "email": "a@b.be" }, { "email": "no email" }, 3] } });
        norm(&mut s);
        assert_eq!(s["calendar"], json!({ "on": false, "feeds": [{ "email": "a@b.be" }] }));
        assert!(feeds(&s).is_empty(), "off: no feeds");
    }
}
