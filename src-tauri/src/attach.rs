// Files inside notes: a file pasted or dropped on a page is copied to the workspace's attachments folder (homes.rs) and
// embedded by name; an embed in a page is resolved to its file and described (kind, size, a PDF's pages and first page);
// and the `relay-file://` scheme serves the workspace's files to the webview. Never `file://`: WKWebView does not load
// local files from the app's page, and the scheme only answers for paths inside a workspace (pagefiles::locate).

use crate::pagefiles::{all_files, base, join, locate, lower, make_free, new_file};
use serde_json::{json, Value};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::Path;

/// The most one file may weigh, in bytes (Finder's MB): the tracking issue's call, also for a shared workspace.
pub const MAX: u64 = 25_000_000;

/// What happened to one file: its place in the workspace and the name to embed it by, or too big (nothing was copied).
#[derive(Debug, PartialEq)]
pub enum Copied {
    Done { rel: String, link: String },
    TooLarge { name: String, size: u64 },
}
impl Copied {
    pub fn json(&self) -> Value {
        match self {
            Copied::Done { rel, link } => json!({"path": rel, "link": link}),
            Copied::TooLarge { name, size } => json!({"tooLarge": true, "name": name, "size": size}),
        }
    }
}

/// A file name that is one plain name: the last part, not hidden.
fn plain(name: &str) -> Result<String, String> {
    let n = name.rsplit('/').next().unwrap_or("").trim();
    if n.is_empty() || n.starts_with('.') { return Err(format!("not a file name: {name:?}")); }
    Ok(n.to_string())
}
fn split_ext(name: &str) -> (&str, String) {
    match name.rfind('.').filter(|&i| i > 0) {
        Some(i) => (&name[..i], name[i..].to_string()),
        None => (name, String::new()),
    }
}

/// The folder attachments of `year` go into, relative to `root`.
pub fn dest(root: &Path, year: &str) -> String {
    let d = crate::homes::home(root, "attachments", year);
    d.strip_prefix(root).unwrap_or(&d).to_string_lossy().into_owned()
}

/// A new file `name` (a free name: `name 1.ext` when taken) in the attachments folder, written by `fill`; nothing is made
/// when `size` is over the limit, and a failed write leaves nothing behind.
fn put(root: &Path, year: &str, name: &str, size: u64, fill: impl Fn(&mut std::fs::File) -> io::Result<()>) -> Result<Copied, String> {
    let name = plain(name)?;
    if size > MAX { return Ok(Copied::TooLarge { name, size }); }
    let dir = crate::homes::home(root, "attachments", year);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let (stem, ext) = split_ext(&name);
    let at = make_free(&dir, stem, &ext, |p| {
        let mut f = new_file(p)?;
        fill(&mut f).inspect_err(|_| { std::fs::remove_file(p).ok(); })
    }).map_err(|e| e.to_string())?;
    let rel = at.strip_prefix(root).map_err(|e| e.to_string())?.to_string_lossy().into_owned();
    Ok(Copied::Done { link: link_for(root, &rel), rel })
}
/// The bytes of a pasted file as `name`.
pub fn save(root: &Path, year: &str, name: &str, bytes: &[u8]) -> Result<Copied, String> {
    put(root, year, name, bytes.len() as u64, |f| f.write_all(bytes))
}
/// A file that is somewhere on the disk (dropped, copied in Finder, picked with /) copied in. Not a folder.
pub fn copy_in(root: &Path, year: &str, from: &Path) -> Result<Copied, String> {
    let meta = std::fs::metadata(from).map_err(|e| e.to_string())?;
    if !meta.is_file() { return Err(format!("not a file: {}", from.display())); }
    let name = from.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    put(root, year, &name, meta.len(), |f| io::copy(&mut std::fs::File::open(from)?, f).map(|_| ()))
}
/// How a note links the file at `rel`: by its name, or by its path from the workspace when another file has that name.
fn link_for(root: &Path, rel: &str) -> String {
    let name = base(rel);
    let same = all_files(root).iter().filter(|p| lower(base(p)) == lower(name)).count();
    if same > 1 { rel.to_string() } else { name.to_string() }
}

/// The file an embed names among the workspace's `files`, as Obsidian does: a path from the workspace, one from the
/// note's folder, else the file of that name (the shallowest when several); a name without an extension is a note.
pub fn resolve(files: &[String], note_dir: &str, target: &str) -> Option<String> {
    let t = target.trim().trim_start_matches('/').replace("%20", " ");
    [t.clone(), format!("{t}.md")].iter().find_map(|c| {
        let c = lower(c);
        let from_root = files.iter().find(|p| lower(p) == c);
        let from_note = join(note_dir, &c).and_then(|j| files.iter().find(|p| lower(p) == j));
        let tail = format!("/{c}");
        let by_name = files.iter().filter(|p| lower(p).ends_with(&tail)).min_by_key(|p| p.len());
        from_root.or(from_note).or(by_name).cloned()
    })
}

/// What an embed shows: "image", "pdf", "audio", "note" or "file".
pub fn kind_of(path: &str) -> &'static str {
    match path.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).as_deref() {
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "avif" | "heic" | "bmp") => "image",
        Some("pdf") => "pdf",
        Some("m4a" | "mp3" | "wav" | "aac" | "ogg" | "flac" | "opus") => "audio",
        Some("md") => "note",
        _ => "file",
    }
}
fn mime_of(path: &str) -> &'static str {
    match path.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("avif") => "image/avif",
        Some("heic") => "image/heic",
        Some("bmp") => "image/bmp",
        Some("pdf") => "application/pdf",
        Some("m4a") => "audio/mp4",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("aac") => "audio/aac",
        Some("ogg" | "opus") => "audio/ogg",
        Some("flac") => "audio/flac",
        Some("md") => "text/markdown; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// The pages of a PDF: the largest /Count of its page tree, else its /Type /Page objects. A PDF that keeps its page
/// tree in a compressed object stream gives None here (the caller asks Spotlight).
// ponytail: a scan of the bytes, not a PDF parser; PDFKit's pageCount through objc2 if this ever misses often
pub fn pdf_pages(bytes: &[u8]) -> Option<u32> {
    use regex::bytes::Regex;
    let count = Regex::new(r"/Count\s+(\d+)").unwrap();
    let leaf = Regex::new(r"/Type\s*/Page[^s]").unwrap();
    let biggest = count.captures_iter(bytes).filter_map(|c| std::str::from_utf8(&c[1]).ok()?.parse::<u32>().ok()).max();
    let leaves = leaf.find_iter(bytes).count() as u32;
    Some(biggest.unwrap_or(0).max(leaves)).filter(|n| *n > 0)
}
#[cfg(target_os = "macos")]
fn spotlight_pages(path: &Path) -> Option<u32> {
    let out = std::process::Command::new("mdls").args(["-name", "kMDItemNumberOfPages", "-raw"]).arg(path).output().ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}
#[cfg(not(target_os = "macos"))]
fn spotlight_pages(_: &Path) -> Option<u32> { None }

/// The first page of a PDF as a small PNG data URL, made by macOS (sips) and kept in the temp folder by file and
/// modification time.
#[cfg(target_os = "macos")]
fn pdf_thumb(path: &Path, size: u64, modified: u64) -> Option<String> {
    use base64::Engine;
    let key = relay_remote::sync::sha256_hex(format!("{}|{size}|{modified}", path.display()).as_bytes());
    let dir = std::env::temp_dir().join("relay-pdf-thumbs");
    std::fs::create_dir_all(&dir).ok()?;
    let png = dir.join(format!("{key}.png"));
    if !png.is_file() {
        let ok = std::process::Command::new("sips").args(["-s", "format", "png", "-Z", "360"]).arg(path).arg("--out").arg(&png)
            .output().ok()?.status.success();
        if !ok { return None; }
    }
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(std::fs::read(png).ok()?)))
}
#[cfg(not(target_os = "macos"))]
fn pdf_thumb(_: &Path, _: u64, _: u64) -> Option<String> { None }

/// What the page needs to draw `targets` (the names its embeds carry): per target {target, path (absolute), rel, kind,
/// size, and a PDF's pages and first page, a note's text} or {target, missing}.
pub fn info(root: &Path, note_rel: &str, targets: &[String]) -> Vec<Value> {
    let files = all_files(root);
    let dir = note_rel.rfind('/').map_or("", |i| &note_rel[..i]);
    targets.iter().map(|t| {
        let Some(rel) = resolve(&files, dir, t) else { return json!({"target": t, "missing": true}) };
        let abs = root.join(&rel);
        let meta = std::fs::metadata(&abs).ok();
        let size = meta.as_ref().map_or(0, |m| m.len());
        let modified = meta.and_then(|m| m.modified().ok()).and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
        let kind = kind_of(&rel);
        let mut out = json!({"target": t, "path": abs.to_string_lossy(), "rel": rel, "kind": kind, "size": size});
        match kind {
            "pdf" => {
                let pages = std::fs::read(&abs).ok().and_then(|b| pdf_pages(&b)).or_else(|| spotlight_pages(&abs));
                out["pages"] = json!(pages);
                out["thumb"] = json!(pdf_thumb(&abs, size, modified));
            }
            // an embedded note is read whole: its heading is found in the page (domain/workspace/embeds.ts)
            "note" if size <= 1_000_000 => out["text"] = json!(std::fs::read_to_string(&abs).unwrap_or_default()),
            _ => {}
        }
        out
    }).collect()
}

fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match (b[i], b.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(std::str::from_utf8(h).ok()?, 16).ok())) {
            (b'%', Some(v)) => { out.push(v); i += 3; }
            (c, _) => { out.push(c); i += 1; }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}
/// The bytes `range` ("bytes=a-b", "bytes=a-", "bytes=-n") asks for of a file of `len`: (from, to inclusive), None when
/// the header is not one range this can answer.
fn byte_range(range: &str, len: u64) -> Option<(u64, u64)> {
    let (a, b) = range.strip_prefix("bytes=")?.split_once('-')?;
    let (from, to) = match (a.trim(), b.trim()) {
        ("", n) => (len.saturating_sub(n.parse().ok()?), len.checked_sub(1)?),
        (a, "") => (a.parse().ok()?, len.checked_sub(1)?),
        (a, b) => (a.parse().ok()?, b.parse::<u64>().ok()?.min(len.checked_sub(1)?)),
    };
    (from <= to && to < len).then_some((from, to))
}
/// The `relay-file://localhost/<percent-encoded absolute path>` scheme: a file inside one of the workspaces (no
/// hidden part, no link), with byte ranges, which a browser's audio element asks for.
pub fn serve(roots: &[String], uri_path: &str, range: Option<&str>) -> tauri::http::Response<Vec<u8>> {
    let answer = |status: u16| tauri::http::Response::builder().status(status).header("X-Content-Type-Options", "nosniff");
    let asked = pct_decode(uri_path.trim_start_matches('/'));
    let Some(path) = locate(roots, &asked).ok().map(|(_, real, _)| real).filter(|p| p.is_file()) else {
        return answer(404).body(vec![]).unwrap();
    };
    let read = || -> io::Result<tauri::http::Response<Vec<u8>>> {
        let mut f = std::fs::File::open(&path)?;
        let len = f.metadata()?.len();
        let mime = mime_of(&path.to_string_lossy());
        let ranged = range.and_then(|r| byte_range(r, len));
        if range.is_some() && ranged.is_none() { return Ok(answer(416).header("Content-Range", format!("bytes */{len}")).body(vec![]).unwrap()); }
        let (from, to) = ranged.unwrap_or((0, len.saturating_sub(1)));
        let mut body = vec![0u8; if len == 0 { 0 } else { (to - from + 1) as usize }];
        f.seek(SeekFrom::Start(from))?;
        f.read_exact(&mut body)?;
        let r = answer(if ranged.is_some() { 206 } else { 200 }).header("Content-Type", mime).header("Accept-Ranges", "bytes").header("Cache-Control", "no-cache");
        Ok(match ranged {
            Some(_) => r.header("Content-Range", format!("bytes {from}-{to}/{len}")),
            None => r,
        }.body(body).unwrap())
    };
    read().unwrap_or_else(|_| answer(500).body(vec![]).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn vault(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("attach-{name}-{}", std::process::id()));
        std::fs::remove_dir_all(&d).ok();
        std::fs::create_dir_all(&d).unwrap();
        PathBuf::from(crate::vault::canon(&d.to_string_lossy()))
    }
    fn s(p: &Path) -> String { p.to_string_lossy().into_owned() }

    #[test]
    fn a_pasted_file_lands_in_the_years_attachments_and_is_linked_by_name() {
        let v = vault("paste");
        let done = save(&v, "2026", "Pasted image 20261104101500.png", b"png").unwrap();
        assert_eq!(done, Copied::Done { rel: "Attachments/2026/Pasted image 20261104101500.png".into(), link: "Pasted image 20261104101500.png".into() });
        assert_eq!(std::fs::read(v.join("Attachments/2026/Pasted image 20261104101500.png")).unwrap(), b"png");
        // the same name again never writes over it
        let again = save(&v, "2026", "Pasted image 20261104101500.png", b"two").unwrap();
        assert_eq!(again, Copied::Done { rel: "Attachments/2026/Pasted image 20261104101500 1.png".into(), link: "Pasted image 20261104101500 1.png".into() });
        assert_eq!(std::fs::read(v.join("Attachments/2026/Pasted image 20261104101500.png")).unwrap(), b"png");
        // hidden or path-like names are refused
        assert!(save(&v, "2026", ".env", b"x").is_err());
        assert_eq!(save(&v, "2026", "../../escape.png", b"x").unwrap(), Copied::Done { rel: "Attachments/2026/escape.png".into(), link: "escape.png".into() });
    }

    #[test]
    fn the_vaults_attachment_folder_is_followed() {
        let v = vault("home");
        std::fs::create_dir_all(v.join(".obsidian")).unwrap();
        std::fs::write(v.join(".obsidian/app.json"), r#"{"attachmentFolderPath":"Resources/Files"}"#).unwrap();
        assert_eq!(dest(&v, "2026"), "Resources/Files");
        let Copied::Done { rel, .. } = save(&v, "2026", "a.pdf", b"x").unwrap() else { panic!() };
        assert_eq!(rel, "Resources/Files/a.pdf");
        assert_eq!(dest(&vault("home2"), "2026"), "Attachments/2026");
    }

    #[test]
    fn a_file_over_25_mb_is_refused_and_nothing_is_copied() {
        let v = vault("big");
        let outside = vault("big-src");
        let big = outside.join("dump.sql.gz");
        std::fs::File::create(&big).unwrap().set_len(30_000_000).unwrap();
        let small = outside.join("ok.txt");
        std::fs::write(&small, "fine").unwrap();
        assert_eq!(copy_in(&v, "2026", &big).unwrap(), Copied::TooLarge { name: "dump.sql.gz".into(), size: 30_000_000 });
        assert!(!v.join("Attachments").exists(), "not even the folder is made");
        // exactly at the limit goes in, one byte over does not
        let edge = outside.join("edge.bin");
        std::fs::File::create(&edge).unwrap().set_len(MAX).unwrap();
        assert!(matches!(copy_in(&v, "2026", &edge).unwrap(), Copied::Done { .. }));
        assert_eq!(std::fs::metadata(v.join("Attachments/2026/edge.bin")).unwrap().len(), MAX);
        assert!(matches!(save(&v, "2026", "x.bin", &vec![0u8; MAX as usize + 1]).unwrap(), Copied::TooLarge { .. }));
        assert!(!v.join("Attachments/2026/x.bin").exists());
        assert!(matches!(copy_in(&v, "2026", &small).unwrap(), Copied::Done { .. }));
        assert!(copy_in(&v, "2026", &outside).is_err(), "a folder is not a file");
    }

    #[test]
    fn a_name_another_file_has_is_linked_by_its_path() {
        let v = vault("twin");
        std::fs::create_dir_all(v.join("Old")).unwrap();
        std::fs::write(v.join("Old/shot.png"), "old").unwrap();
        let Copied::Done { link, .. } = save(&v, "2026", "shot.png", b"new").unwrap() else { panic!() };
        assert_eq!(link, "Attachments/2026/shot.png");
    }

    #[test]
    fn embeds_resolve_like_obsidian() {
        let files: Vec<String> = ["Attachments/2026/a.png", "Deep/Notes/b.png", "Notes/Plan.md", "Other/Plan.md", "Deep/Notes/b.pdf", "Docs/Report v1.2.md"].map(String::from).to_vec();
        assert_eq!(resolve(&files, "", "a.png").as_deref(), Some("Attachments/2026/a.png"));
        assert_eq!(resolve(&files, "", "Attachments/2026/a.png").as_deref(), Some("Attachments/2026/a.png"));
        assert_eq!(resolve(&files, "Deep/Notes", "b.png").as_deref(), Some("Deep/Notes/b.png"));
        assert_eq!(resolve(&files, "", "A.PNG").as_deref(), Some("Attachments/2026/a.png"));
        assert_eq!(resolve(&files, "", "Plan").as_deref(), Some("Notes/Plan.md"), "the shallowest");
        assert_eq!(resolve(&files, "", "Report v1.2").as_deref(), Some("Docs/Report v1.2.md"));
        assert_eq!(resolve(&files, "", "gone.png"), None);
        assert_eq!(resolve(&files, "", "Attachments/2026/a%20b.png"), None);
    }

    #[test]
    fn what_an_embed_shows_follows_its_extension() {
        for (p, k) in [("a.PNG", "image"), ("a.pdf", "pdf"), ("a.m4a", "audio"), ("a.md", "note"), ("a.zip", "file"), ("a", "file")] {
            assert_eq!(kind_of(p), k, "{p}");
        }
    }

    #[test]
    fn a_pdfs_pages_are_counted() {
        let tree = b"1 0 obj << /Type /Pages /Kids [2 0 R 3 0 R] /Count 2 >> endobj 2 0 obj << /Type /Page >> endobj 3 0 obj <</Type/Page>> endobj";
        assert_eq!(pdf_pages(tree), Some(2));
        assert_eq!(pdf_pages(b"1 0 obj << /Type /Page /Parent 9 0 R >> endobj"), Some(1));
        assert_eq!(pdf_pages(b"not a pdf"), None);
    }

    #[test]
    fn info_describes_each_embed_and_names_the_missing() {
        let v = vault("info");
        std::fs::create_dir_all(v.join("Attachments/2026")).unwrap();
        std::fs::write(v.join("Attachments/2026/q.pdf"), b"%PDF-1.4 1 0 obj << /Type /Pages /Count 6 >> endobj").unwrap();
        std::fs::write(v.join("Attachments/2026/s.png"), b"png").unwrap();
        std::fs::write(v.join("Findings.md"), "# Findings\n\n## Rate limits\n60 a minute\n").unwrap();
        let out = info(&v, "Docs/Plan.md", &["q.pdf".into(), "s.png".into(), "Findings".into(), "nope.png".into()]);
        assert_eq!((out[0]["kind"].as_str(), out[0]["pages"].as_u64(), out[0]["size"].as_u64()), (Some("pdf"), Some(6), Some(51)));
        assert_eq!((out[1]["kind"].as_str(), out[1]["rel"].as_str()), (Some("image"), Some("Attachments/2026/s.png")));
        assert!(out[2]["text"].as_str().unwrap().contains("## Rate limits"));
        assert_eq!(out[3]["missing"], true);
    }

    #[test]
    fn the_scheme_serves_workspace_files_with_ranges_and_nothing_else() {
        let v = vault("serve");
        std::fs::create_dir_all(v.join("Attachments")).unwrap();
        std::fs::write(v.join("Attachments/s a.m4a"), b"0123456789").unwrap();
        std::fs::write(v.join(".hidden.txt"), b"secret").unwrap();
        let roots = [s(&v)];
        let path = |p: &str| format!("/{}", p.replace('/', "%2F").replace(' ', "%20"));
        let ok = serve(&roots, &path(&s(&v.join("Attachments/s a.m4a"))), None);
        assert_eq!((ok.status().as_u16(), ok.body().as_slice()), (200, &b"0123456789"[..]));
        assert_eq!(ok.headers()["Content-Type"], "audio/mp4");
        let part = serve(&roots, &path(&s(&v.join("Attachments/s a.m4a"))), Some("bytes=2-4"));
        assert_eq!((part.status().as_u16(), part.body().as_slice()), (206, &b"234"[..]));
        assert_eq!(part.headers()["Content-Range"], "bytes 2-4/10");
        let tail = serve(&roots, &path(&s(&v.join("Attachments/s a.m4a"))), Some("bytes=-3"));
        assert_eq!(tail.body().as_slice(), b"789");
        assert_eq!(serve(&roots, &path(&s(&v.join("Attachments/s a.m4a"))), Some("bytes=40-")).status().as_u16(), 416);
        // outside the workspace, hidden, missing: not served
        assert_eq!(serve(&roots, &path("/etc/hosts"), None).status().as_u16(), 404);
        assert_eq!(serve(&roots, &path(&s(&v.join(".hidden.txt"))), None).status().as_u16(), 404);
        assert_eq!(serve(&roots, &path(&s(&v.join("Attachments/none.png"))), None).status().as_u16(), 404);
        assert_eq!(serve(&roots, &path(&format!("{}/../etc/hosts", s(&v))), None).status().as_u16(), 404);
    }
}
