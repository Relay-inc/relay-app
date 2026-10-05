// Project websites and their favicons: a project's site comes from the vault's icon settings when it is there,
// else it is guessed: a domain named in the project folder that holds the project's name or an alias (resolvus.be
// for Resolvus), else the domain named most often on the project note itself (at least twice). No AI.

use base64::Engine;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;
use unicode_normalization::UnicodeNormalization;

const SKIP_DIRS: [&str; 3] = ["/transcripts/", "/_archive/", "/Attachments/"];
/// Tools and platforms that show up in any note, never a project's own site.
const NOISE: [&str; 30] = ["notion.so", "notion.com", "claude.ai", "claude.com", "anthropic.com", "github.com", "google.com", "gmail.com",
    "googleapis.com", "gstatic.com", "weareantenna.be", "combell.com", "productive.io", "sentry.io", "linkedin.com",
    "slack.com", "w3.org", "youtube.com", "apple.com", "microsoft.com", "amazon.com", "openai.com", "figma.com",
    "run.app", "webhosting.be", "vercel.app", "lovable.app", "typekit.net", "licdn.com", "wordpress.org"];
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Safari/605.1.15";

fn re(cell: &'static OnceLock<Regex>, p: &str) -> &'static Regex { cell.get_or_init(|| Regex::new(p).unwrap()) }
fn is_noise(d: &str) -> bool { NOISE.contains(&d) }

/// Lowercase ascii letters and digits only, accents folded (Café -> cafe).
fn compact(s: &str) -> String {
    s.nfkd().filter(char::is_ascii).filter(char::is_ascii_alphanumeric).map(|c| c.to_ascii_lowercase()).collect()
}

fn registrable(d: &str) -> String {
    let d = d.to_lowercase();
    let parts: Vec<&str> = d.strip_prefix("www.").unwrap_or(&d).split('.').collect();
    let n = parts.len();
    parts[if n > 2 && ["co", "com"].contains(&parts[n - 2]) { n - 3 } else { n.saturating_sub(2) }..].join(".")
}

fn domains(texts: impl IntoIterator<Item = String>) -> HashMap<String, usize> {
    static R: OnceLock<Regex> = OnceLock::new();
    let r = re(&R, r"(?i)\b((?:[a-z0-9-]+\.)+(?:be|com|eu|nl|io|app|gent|shop|net|org|fr|de|co|ai|dev|tech))\b");
    let mut c = HashMap::new();
    for t in texts { for m in r.captures_iter(&t) { *c.entry(registrable(&m[1])).or_default() += 1; } }
    c
}

/// The markdown files under `dir`, sorted; hidden folders are passed over, symlinks not followed.
fn md_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut es: Vec<_> = rd.flatten().collect();
    es.sort_by_key(|e| e.file_name());
    for e in es {
        let (n, Ok(ft)) = (e.file_name().to_string_lossy().into_owned(), e.file_type()) else { continue };
        if n.starts_with('.') { continue; }
        if ft.is_dir() { md_files(&e.path(), out); } else if ft.is_file() && n.ends_with(".md") { out.push(e.path()); }
    }
}
fn read(f: &Path) -> String { fs::read(f).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default() }

/// The site of the domains: the one named most often, ties to the later name.
fn best(c: impl Iterator<Item = (usize, String)>) -> String { c.max().map(|(_, d)| d).unwrap_or_default() }

/// The domain a name picks out of the counted ones: it starts with the name (weemaesglas.be for Weemaes, not
/// filmfestival.be for Trefpunt Festival); a short name (o2o) only as the whole domain name.
fn named(counts: &HashMap<String, usize>, name: &str, aliases: &[String]) -> String {
    let all: Vec<&str> = std::iter::once(name).chain(aliases.iter().map(String::as_str)).collect();
    let split = |n: &str| n.split(|c: char| c.is_whitespace() || c == '/' || c == '-').map(compact).collect::<Vec<_>>();
    let keys: Vec<String> = all.iter().flat_map(|n| std::iter::once(compact(n)).chain(split(n))).filter(|k| k.len() >= 4).collect();
    let short: Vec<String> = all.iter().map(|n| compact(n)).filter(|k| (2..4).contains(&k.len())).collect();
    best(counts.iter().filter(|(d, _)| !is_noise(d) && {
        let label = compact(d.split('.').next().unwrap());
        short.contains(&label) || keys.iter().any(|k| label.starts_with(k.as_str()))
    }).map(|(d, n)| (*n, d.clone())))
}

fn guess(notes: &Path, skip: &[String], name: &str, aliases: &[String]) -> String {
    let mut files = vec![];
    md_files(notes, &mut files);
    let Some(note) = files.into_iter().find(|p| {
        p.file_name().is_some_and(|f| *f == *format!("{name}.md"))
            && !p.parent().unwrap().strip_prefix(notes).unwrap().components().any(|c| skip.iter().any(|s| c.as_os_str() == s.as_str()))
    }) else { return String::new() };
    let folder = note.parent().unwrap();
    let mut inside = vec![];
    md_files(folder, &mut inside);
    let everything = domains(inside.iter().filter(|f| {
        let rel = format!("/{}/", f.strip_prefix(folder).unwrap().to_string_lossy());
        !SKIP_DIRS.iter().any(|d| rel.contains(d))
    }).map(|f| read(f)));
    let n = named(&everything, name, aliases);
    if !n.is_empty() { return n; }
    best(domains([read(&note)]).into_iter().filter(|(d, n)| !is_noise(d) && *n >= 2).map(|(d, n)| (n, d)))
}

/// One GET by curl (always on a Mac): the body, at most 2 MB, and the URL it ended up at after redirects.
/// Timeouts: 10 s to connect, 10 s without data, 60 s in all.
fn get(url: &str) -> Option<(Vec<u8>, String)> {
    let o = Command::new("/usr/bin/curl").args(["-sSfL", "--proto", "=http,https", "--connect-timeout", "10", "-y", "10", "-Y", "1", "--max-time", "60",
        "-A", UA, "-H", "Accept: text/html,image/*,*/*", "-w", "\n%{url_effective}", "--", url]).output().ok()?;
    if !o.status.success() { return None; }
    let i = o.stdout.iter().rposition(|&b| b == b'\n')?;
    let mut body = o.stdout[..i].to_vec();
    body.truncate(2_000_000);
    Some((body, String::from_utf8_lossy(&o.stdout[i + 1..]).into_owned()))
}

fn mime(b: &[u8]) -> Option<&'static str> {
    let head = String::from_utf8_lossy(&b[..b.len().min(300)]).trim_start().to_lowercase();
    if b.starts_with(b"\x89PNG") { Some("image/png") }
    else if b.starts_with(&[0, 0, 1, 0]) { Some("image/x-icon") }
    else if b.starts_with(&[0xff, 0xd8]) { Some("image/jpeg") }
    else if b.starts_with(b"GIF8") { Some("image/gif") }
    else if b.len() >= 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" { Some("image/webp") }
    else if head.starts_with("<svg") || (head.starts_with("<?xml") && String::from_utf8_lossy(&b[..b.len().min(1000)]).to_lowercase().contains("<svg")) { Some("image/svg+xml") }
    else { None }
}

/// The icon links of a page, as (size, url): the largest wins, an svg scales, an apple-touch-icon is 180 px.
fn icon_links(html: &str, base: &str) -> Vec<(u32, String)> {
    static TAG: OnceLock<Regex> = OnceLock::new();
    static REL: OnceLock<Regex> = OnceLock::new();
    static HREF: OnceLock<Regex> = OnceLock::new();
    static SIZE: OnceLock<Regex> = OnceLock::new();
    let base = url::Url::parse(base).ok();
    let mut links = vec![];
    for tag in re(&TAG, r"(?i)<link[^>]+>").find_iter(html) {
        let tag = tag.as_str();
        let (Some(rel), Some(href)) = (re(&REL, r#"(?i)rel=["']?([^"'>]+)"#).captures(tag), re(&HREF, r#"(?i)href=["']?([^"' >]+)"#).captures(tag)) else { continue };
        let rel = rel[1].to_lowercase();
        if !rel.contains("icon") || rel.contains("mask") { continue; }
        let href = &href[1];
        let n = match re(&SIZE, r#"sizes=["']?(\d+)"#).captures(tag) {
            Some(s) => s[1].parse().unwrap_or(0),
            None if href.contains(".svg") => 512,
            None if rel.contains("apple") => 180,
            None => 16,
        };
        if let Some(u) = base.as_ref().and_then(|b| b.join(&href.replace("&amp;", "&")).ok()) { links.push((n, u.to_string())); }
    }
    links.sort_by(|a, b| b.cmp(a));
    links
}

/// The data url of the site's icon: the page's own icons first (a site that blocks scripts or has a bad
/// certificate still gets the fallbacks), then the usual paths, then DuckDuckGo's favicon service (404 when it
/// has none, so no generic globe).
fn favicon(site: &str) -> Option<String> {
    let (html, base) = get(&format!("https://{site}")).unwrap_or((vec![], format!("https://{site}/")));
    let b = url::Url::parse(&base).ok();
    let rest = ["/favicon.ico", "/apple-touch-icon.png", "/favicon.png"].iter().filter_map(|p| Some(b.as_ref()?.join(p).ok()?.to_string()))
        .chain([format!("https://icons.duckduckgo.com/ip3/{site}.ico")]);
    let urls = icon_links(&String::from_utf8_lossy(&html), &base).into_iter().map(|(_, u)| u).chain(rest);
    urls.filter_map(|u| get(&u)).find_map(|(b, _)| mime(&b).map(|m| format!("data:{m};base64,{}", base64::engine::general_purpose::STANDARD.encode(&b))))
}

/// {name: {site, data}} for the projects ([{name, aliases}]) whose site is not in `tried` yet. `sites` (from the
/// vault's icon settings) win over a guess; `notes` is the folder with the project notes.
pub fn run(vault: &str, notes: &str, projects: &Value, tried: &Value, sites: &Map<String, Value>) -> Value {
    let notes = if notes.is_empty() { Path::new(vault).join("Contexts") } else { PathBuf::from(notes) };
    let notes = if notes.is_dir() { notes } else { PathBuf::from(vault) };
    let skip: Vec<String> = crate::relay_config::load(vault).and_then(|c| c["skip"].as_array().cloned())
        .map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect()).filter(|a: &Vec<String>| !a.is_empty())
        .unwrap_or_else(|| ["Documents", "Gesprekken", "_archive"].map(String::from).to_vec());
    let projects = projects.as_array().cloned().unwrap_or_default();
    let (next, out) = (AtomicUsize::new(0), std::sync::Mutex::new(Map::new()));
    std::thread::scope(|s| for _ in 0..8 {
        s.spawn(|| while let Some(p) = projects.get(next.fetch_add(1, Ordering::Relaxed)) {
            let Some(name) = p["name"].as_str() else { continue };
            let site = match sites.get(name).and_then(Value::as_str) {
                Some(s) => s.to_string(),
                None => guess(&notes, &skip, name, &p["aliases"].as_array().into_iter().flatten().filter_map(|a| a.as_str().map(String::from)).collect::<Vec<_>>()),
            };
            if tried.get(name).and_then(Value::as_str) == Some(site.as_str()) { continue; }
            let data = if site.is_empty() { None } else { favicon(&site) };
            out.lock().unwrap().insert(name.to_string(), json!({"site": site, "data": data}));
        });
    });
    Value::Object(out.into_inner().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_folds_accents_and_punctuation() {
        assert_eq!(compact("Café Zoë-2"), "cafezoe2");
        assert_eq!(compact("o2o"), "o2o");
    }

    #[test]
    fn registrable_keeps_co_and_com_second_levels() {
        assert_eq!(registrable("WWW.Shop.Resolvus.be"), "resolvus.be");
        assert_eq!(registrable("foo.co.uk"), "foo.co.uk");
    }

    #[test]
    fn guesses_the_domain_the_name_starts() {
        let c = domains(["see resolvus.be and www.resolvus.be, notion.so, filmfestival.be, o2o.be, o2oshop.be, shop.weemaesglas.be".to_string()]);
        assert_eq!(c["resolvus.be"], 2);
        assert_eq!(named(&c, "Resolvus", &[]), "resolvus.be");
        assert_eq!(named(&c, "Trefpunt Festival", &[]), "");
        assert_eq!(named(&c, "o2o", &[]), "o2o.be");
        assert_eq!(named(&c, "Weemaes", &[]), "weemaesglas.be");
        assert_eq!(named(&c, "Other", &["Resolvus group".to_string()]), "resolvus.be");
    }

    #[test]
    fn icon_links_largest_first() {
        let html = r#"<link rel="icon" href="/a.png" sizes="32x32"><link rel="apple-touch-icon" href="b.png"><link rel="mask-icon" href="m.svg"><link rel="icon" href="/i.svg?a=1&amp;b=2">"#;
        let l = icon_links(html, "https://x.be/p/");
        assert_eq!(l.iter().map(|(n, u)| format!("{n} {u}")).collect::<Vec<_>>(),
            ["512 https://x.be/i.svg?a=1&b=2", "180 https://x.be/p/b.png", "32 https://x.be/a.png"]);
    }

    /// Manual parity check against a real vault: `VAULT=... cargo test --lib parity -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn parity() {
        let v = std::env::var("VAULT").unwrap();
        let notes = Path::new(&v).join("Contexts");
        for (n, a) in [("Spardex", vec![]), ("o2o", vec![]), ("Scoutsmap", vec![]), ("Elision", vec![]), ("Lemahieu", vec![]), ("Brutsaert", vec![]), ("Smappee", vec![]), ("Aernoudt", vec![]), ("BE Plastics", vec!["TradeHub".to_string()]), ("Archiefpunt", vec![])] {
            println!("{n} {}", guess(&notes, &["Documents".into(), "Gesprekken".into(), "_archive".into()], n, &a));
        }
        println!("{:?}", favicon("o2o.be").map(|d| d.len()));
    }
}
