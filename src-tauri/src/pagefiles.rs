// The Pages tab's file operations on a workspace: a new page or folder, rename and move (with the links to it rewritten),
// duplicate, and delete into the workspace's .trash/ (Obsidian's) with a restore for Undo. Every path is absolute, must
// sit in one of the workspace roots once its folder's links are resolved, and may not be or pass through a hidden name
// (.git, .obsidian, .claude, .trash…) nor be a link itself; paths given back are relative to their root. Nothing is
// made or moved over something that is there: a new file is made with create_new, a rename refuses an existing target.

use crate::vault::canon;
use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::LazyLock;

/// `asked` as (its root, its real path, its path relative to the root). The folder it sits in is resolved (a link out
/// of the workspace is refused); the last part is not, so a link itself is never moved or written through.
pub fn locate(roots: &[String], asked: &str) -> Result<(PathBuf, PathBuf, String), String> {
    let refuse = || format!("not in this workspace: {asked}");
    let p = Path::new(asked);
    if !p.is_absolute() || p.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) { return Err(refuse()); }
    let (Some(parent), Some(name)) = (p.parent(), p.file_name()) else { return Err(refuse()) };
    // a move may go into folders not made yet: the nearest one that is there is resolved, the rest joined on
    let mut known = parent;
    while fs::symlink_metadata(known).is_err() { known = known.parent().ok_or_else(refuse)?; }
    let real = fs::canonicalize(known).map_err(|_| refuse())?.join(parent.strip_prefix(known).unwrap()).join(name);
    let root = roots.iter().map(|r| PathBuf::from(canon(r))).find(|r| real.starts_with(r) && &real != r).ok_or_else(refuse)?;
    let rel = real.strip_prefix(&root).unwrap().to_string_lossy().into_owned();
    if rel.split('/').any(|part| part.starts_with('.')) { return Err(refuse()); }
    if fs::symlink_metadata(&real).is_ok_and(|m| m.file_type().is_symlink()) { return Err(format!("a link, not a page: {asked}")); }
    Ok((root, real, rel))
}
/// The root itself, for a new page at the top of a workspace.
fn root_of(roots: &[String], asked: &str) -> Result<PathBuf, String> {
    let c = PathBuf::from(canon(asked));
    roots.iter().map(|r| PathBuf::from(canon(r))).find(|r| *r == c).ok_or_else(|| format!("not in this workspace: {asked}"))
}
/// A folder of a workspace (its root or one in it) as (root, real path).
fn folder(roots: &[String], asked: &str) -> Result<(PathBuf, PathBuf), String> {
    if let Ok(root) = root_of(roots, asked) { return Ok((root.clone(), root)); }
    let (root, real, _) = locate(roots, asked)?;
    if !real.is_dir() { return Err(format!("not a folder: {asked}")); }
    Ok((root, real))
}
/// A name for one new thing in a folder: plain, no slash, not hidden.
fn plain(name: &str) -> Result<&str, String> {
    let n = name.trim();
    if n.is_empty() || n.contains('/') || n.starts_with('.') { return Err(format!("not a name: {name:?}")); }
    Ok(n)
}
fn rel_of(root: &Path, p: &Path) -> String { p.strip_prefix(root).unwrap().to_string_lossy().into_owned() }
/// Make `stem.ext` in `dir`, or `stem 1.ext`, `stem 2.ext`… when taken, with `make` (which must fail with
/// AlreadyExists rather than write over one): taken between a look and the write is not possible this way.
fn make_free(dir: &Path, stem: &str, ext: &str, make: impl Fn(&Path) -> io::Result<()>) -> io::Result<PathBuf> {
    for i in 0..1000 {
        let p = dir.join(if i == 0 { format!("{stem}{ext}") } else { format!("{stem} {i}{ext}") });
        match make(&p) {
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            r => return r.map(|_| p),
        }
    }
    Err(io::Error::other("no free name"))
}
fn new_file(p: &Path) -> io::Result<fs::File> { fs::OpenOptions::new().write(true).create_new(true).open(p) }
/// `from` renamed to `to`, refused when `to` is there (renamex_np RENAME_EXCL on macOS: no window between a look and
/// the rename).
#[cfg(target_os = "macos")]
fn rename_new(from: &Path, to: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let (a, b) = (CString::new(from.as_os_str().as_bytes())?, CString::new(to.as_os_str().as_bytes())?);
    // SAFETY: two valid NUL-terminated paths for the duration of the call
    if unsafe { libc::renamex_np(a.as_ptr(), b.as_ptr(), libc::RENAME_EXCL) } == 0 { Ok(()) } else { Err(io::Error::last_os_error()) }
}
#[cfg(not(target_os = "macos"))]
fn rename_new(from: &Path, to: &Path) -> io::Result<()> {
    // ponytail: look then rename elsewhere; Linux has renameat2 RENAME_NOREPLACE if Relay ever runs there
    if fs::symlink_metadata(to).is_ok() { return Err(io::ErrorKind::AlreadyExists.into()); }
    fs::rename(from, to)
}
/// A temporary name next to `p` that the shared sync and the Pages walk skip (".relay-sync-…").
fn tmp_of(p: &Path) -> PathBuf {
    p.with_file_name(format!(".relay-sync-{}-{}", std::process::id(), p.file_name().unwrap().to_string_lossy()))
}

/// A new empty page `name`.md (or a folder with `dir`) in the folder `parent`, never over one that is there. Returns
/// its path relative to the workspace.
pub fn create(roots: &[String], parent: &str, name: &str, dir: bool) -> Result<String, String> {
    let (root, at) = folder(roots, parent)?;
    let name = plain(name)?;
    let name = name.strip_suffix(".md").unwrap_or(name);
    let p = if dir { at.join(name) } else { at.join(format!("{name}.md")) };
    let made = if dir { fs::create_dir(&p) } else { new_file(&p).map(|_| ()) };
    made.map_err(|e| if e.kind() == io::ErrorKind::AlreadyExists { format!("already there: {}", p.file_name().unwrap().to_string_lossy()) } else { e.to_string() })?;
    Ok(rel_of(&root, &p))
}
/// A free page name in `parent`: `name`, else `name 1`… (what New page offers; create still refuses a taken one).
pub fn free_name(roots: &[String], parent: &str, name: &str) -> Result<String, String> {
    let (_, at) = folder(roots, parent)?;
    let name = plain(name)?;
    (0..1000).map(|i| if i == 0 { name.to_string() } else { format!("{name} {i}") })
        .find(|n| fs::symlink_metadata(at.join(format!("{n}.md"))).is_err()).ok_or_else(|| "no free name".into())
}
/// A copy of a page next to it, "Name copy.md" (or "Name copy 1.md"…). Returns its path relative to the workspace.
pub fn duplicate(roots: &[String], target: &str) -> Result<String, String> {
    let (root, real, _) = locate(roots, target)?;
    if !real.is_file() || real.extension().is_none_or(|e| e != "md") { return Err(format!("not a page: {target}")); }
    let text = fs::read(&real).map_err(|e| e.to_string())?;
    let stem = format!("{} copy", real.file_stem().unwrap().to_string_lossy());
    let to = make_free(real.parent().unwrap(), &stem, ".md", |p| { use io::Write; new_file(p)?.write_all(&text) }).map_err(|e| e.to_string())?;
    Ok(rel_of(&root, &to))
}

/// The workspace's .trash/ folder, refused when it is a link (it would send the page out of the workspace).
fn bin(root: &Path) -> Result<PathBuf, String> {
    let b = root.join(".trash");
    match fs::symlink_metadata(&b) {
        Ok(m) if m.is_dir() => Ok(b),
        Ok(_) => Err(".trash in this workspace is a link or a file: delete refused".into()),
        Err(_) => fs::create_dir(&b).map(|_| b).map_err(|e| e.to_string()),
    }
}
/// A page or folder into the workspace's .trash/ (a free name there). Returns (where it went, where it was), both
/// relative to the workspace: what `restore` takes.
pub fn trash(roots: &[String], target: &str) -> Result<(String, String), String> {
    let (root, real, rel) = locate(roots, target)?;
    if fs::symlink_metadata(&real).is_err() { return Err(format!("not found: {target}")); }
    let bin = bin(&root)?;
    let (stem, ext) = match (real.is_file(), real.extension()) {
        (true, Some(e)) => (real.file_stem().unwrap().to_string_lossy().into_owned(), format!(".{}", e.to_string_lossy())),
        _ => (real.file_name().unwrap().to_string_lossy().into_owned(), String::new()),
    };
    let to = make_free(&bin, &stem, &ext, |p| rename_new(&real, p)).map_err(|e| e.to_string())?;
    Ok((rel_of(&root, &to), rel))
}
/// Undo of `trash`: `trashed` (in the root's .trash/) back at `rel` (checked like any target), unless something is
/// there by now.
pub fn restore(roots: &[String], root: &str, trashed: &str, rel: &str) -> Result<(), String> {
    let root = root_of(roots, root)?;
    let bin = bin(&root)?;
    let name = trashed.strip_prefix(".trash/").filter(|n| !n.is_empty() && !n.contains('/') && !n.starts_with('.'))
        .ok_or_else(|| format!("not in the trash: {trashed}"))?;
    let from = bin.join(name);
    if fs::symlink_metadata(&from).map_or(true, |m| m.file_type().is_symlink()) { return Err(format!("not in the trash: {trashed}")); }
    let (_, to, _) = locate(&[root.to_string_lossy().into_owned()], &root.join(rel).to_string_lossy())?;
    if let Some(p) = to.parent() { fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    rename_new(&from, &to).map_err(|e| if e.kind() == io::ErrorKind::AlreadyExists { format!("already there: {rel}") } else { e.to_string() })
}

/// Every file of a workspace, relative to it: hidden names (.git, .obsidian, .trash, .relay-sync-…) and links skipped,
/// no depth limit, archives included. What a move counts and rewrites links in.
fn all_files(root: &Path) -> Vec<String> {
    let mut out = vec![];
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for e in fs::read_dir(&dir).into_iter().flatten().flatten() {
            if e.file_name().to_string_lossy().starts_with('.') { continue; }
            match e.file_type() {
                Ok(t) if t.is_dir() => stack.push(e.path()),
                Ok(t) if t.is_file() => out.push(rel_of(root, &e.path())),
                _ => {}
            }
        }
    }
    out.sort();
    out
}
/// Every file at or under `p`, relative to `root`, links not followed: what a delete takes away from where it was.
pub fn files(root: &Path, p: &Path) -> Vec<String> {
    let mut out = vec![];
    let mut stack = vec![p.to_path_buf()];
    while let Some(at) = stack.pop() {
        match fs::symlink_metadata(&at) {
            Ok(m) if m.is_dir() => stack.extend(fs::read_dir(&at).into_iter().flatten().flatten().map(|e| e.path())),
            Ok(_) => out.extend(at.strip_prefix(root).ok().map(|r| r.to_string_lossy().into_owned())),
            Err(_) => {}
        }
    }
    out
}

/// What a move does: the page or folder, and the notes whose links change, with their text before and after, at the
/// place they are in after the move. `gone`: (path, hash) of every file that leaves its place.
#[derive(Debug)]
pub struct Plan {
    pub root: PathBuf,
    pub from: PathBuf,
    pub to: PathBuf,
    pub rel_to: String,
    pub case_only: bool,
    pub edits: Vec<(String, String, String)>,
    pub links: usize,
    pub gone: Vec<(String, String)>,
}

// a [[link]], its target up to `#` or `|` (a `\|` in a table cell: the backslash goes with the rest)
static WIKI: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[\[([^\]\|#\n\\]+)((?:\\?#[^\]\|\n\\]*)?(?:\\?\|[^\]\n]*)?)\]\]").unwrap());
// a markdown link's destination: <…> or up to a space or `)`, then an optional title
static MDLINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"\]\((<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?)\)"#).unwrap());

fn lower(s: &str) -> String { s.to_lowercase() }
fn base(p: &str) -> &str { p.rsplit('/').next().unwrap_or(p) }
fn dir(p: &str) -> &str { p.rfind('/').map_or("", |i| &p[..i]) }
/// The note a [[link]] resolves to among `all`, as Obsidian does: a path from the root, else the one note ending in that
/// path (a bare name: the one note of that name). Two notes it could be: none, so an ambiguous link is left alone.
fn wiki_target<'a>(link: &str, all: &'a [String]) -> Option<&'a String> {
    let t = link.trim().trim_start_matches('/');
    let md = lower(&if lower(t).ends_with(".md") { t.to_string() } else { format!("{t}.md") });
    if let Some(p) = all.iter().find(|p| lower(p) == md) { return Some(p); }
    let tail = format!("/{md}");
    let mut hits = all.iter().filter(|p| lower(p).ends_with(&tail));
    let one = hits.next()?;
    hits.next().is_none().then_some(one)
}
/// `p` (relative to the root) as seen from the folder `from`: "../B/C.md".
fn relative(from: &str, p: &str) -> String {
    let (a, b): (Vec<&str>, Vec<&str>) = (from.split('/').filter(|s| !s.is_empty()).collect(), p.split('/').collect());
    let same = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    std::iter::repeat_n("..", a.len() - same).chain(b[same..].iter().copied()).collect::<Vec<_>>().join("/")
}
/// A path joined onto a folder, with "." and ".." taken out (None when it climbs out of the root).
fn join(folder: &str, rel: &str) -> Option<String> {
    let mut out: Vec<&str> = folder.split('/').filter(|s| !s.is_empty()).collect();
    for part in rel.split('/') {
        match part { "" | "." => {} ".." => { out.pop()?; } x => out.push(x) }
    }
    Some(out.join("/"))
}
/// How a markdown link names its target, kept when it is rewritten.
#[derive(Clone, Copy, PartialEq)]
enum Form { Relative, Root, Slash, Short }
/// The file a markdown link's destination (decoded) names, from the note in `folder`: relative to the note, else from
/// the root ("/…" or without the slash), else, for a page, the one note ending in it (Obsidian's shortest path).
fn md_target(dest: &str, folder: &str, files: &HashSet<&str>, notes: &[String]) -> Option<(String, Form)> {
    if let Some(abs) = dest.strip_prefix('/') { return files.contains(abs).then(|| (abs.to_string(), Form::Slash)); }
    if let Some(p) = join(folder, dest).filter(|p| files.contains(p.as_str())) { return Some((p, Form::Relative)); }
    if files.contains(dest) { return Some((dest.to_string(), Form::Root)); }
    if lower(dest).ends_with(".md") && !dest.contains("../") { return wiki_target(dest, notes).map(|p| (p.clone(), Form::Short)); }
    None
}
struct Ctx<'a> { notes: Vec<String>, after: Vec<String>, files: HashSet<&'a str>, map: HashMap<&'a str, &'a str> }
/// One name among the notes after the move: a bare name or a shortest path may stay short.
fn unique(ctx: &Ctx, p: &str) -> bool { ctx.after.iter().filter(|q| lower(base(q)) == lower(base(p))).count() == 1 }

/// A [[link]] rewritten when it resolves to a moved note.
fn wiki(c: &regex::Captures, ctx: &Ctx, n: &mut usize) -> String {
    let (link, rest) = (&c[1], &c[2]);
    let Some(new) = wiki_target(link, &ctx.notes).and_then(|p| ctx.map.get(p.as_str())) else { return c[0].to_string() };
    let stem = new.strip_suffix(".md").unwrap_or(new);
    let mut form = if link.contains('/') || !unique(ctx, new) { stem.to_string() } else { base(stem).to_string() };
    if lower(link).ends_with(".md") { form.push_str(".md"); }
    if form == link { return c[0].to_string(); }
    *n += 1;
    format!("[[{form}{rest}]]")
}
/// A markdown link rewritten when it names a moved file, or, in a note that moved, when it is relative.
fn markdown(c: &regex::Captures, note: &str, at: &str, ctx: &Ctx, n: &mut usize) -> String {
    let raw = &c[1];
    let (angled, inner) = match raw.strip_prefix('<').and_then(|r| r.strip_suffix('>')) { Some(i) => (true, i), None => (false, raw) };
    let (path, hash) = inner.split_once('#').unwrap_or((inner, ""));
    if path.is_empty() || path.contains("://") || path.starts_with("mailto:") { return c[0].to_string(); }
    let spaced = path.contains("%20");
    let plain = path.replace("%20", " ");
    let Some((old, form)) = md_target(&plain, dir(note), &ctx.files, &ctx.notes) else { return c[0].to_string() };
    let target = ctx.map.get(old.as_str()).copied().unwrap_or(old.as_str());
    if target == old && (at == note || form != Form::Relative) { return c[0].to_string(); }
    let new = match form {
        Form::Relative => relative(dir(at), target),
        Form::Root => target.to_string(),
        Form::Slash => format!("/{target}"),
        Form::Short if unique(ctx, target) => base(target).to_string(),
        Form::Short => target.to_string(),
    };
    let new = if spaced { new.replace(' ', "%20") } else { new };
    if new == path { return c[0].to_string(); }
    *n += 1;
    let hash = if hash.is_empty() { String::new() } else { format!("#{hash}") };
    if angled { format!("](<{new}{hash}>{})", &c[2]) } else { format!("]({new}{hash}{})", &c[2]) }
}
/// The text of `note` (now at `at`) with its links to moved files rewritten, and how many. A [[link]] keeps its form:
/// a bare name stays a bare name unless the new one is no longer the only note of that name, a path stays a path; a
/// markdown link keeps its form (relative, from the root, shortest) and, when the note itself moved, its relative links
/// to any file are made from where it is now. Fenced code (``` and ~~~ each closing only their own) and inline code
/// are left as they are.
fn rewrite(text: &str, note: &str, at: &str, ctx: &Ctx) -> (String, usize) {
    let mut n = 0;
    let mut fence: Option<(char, usize)> = None;
    let mut out = String::with_capacity(text.len());
    for line in text.split_inclusive('\n') {
        let t = line.trim_start();
        let opener = ['`', '~'].into_iter().map(|c| (c, t.chars().take_while(|&x| x == c).count())).find(|&(_, k)| k >= 3);
        match (fence, opener) {
            (None, Some(f)) => { fence = Some(f); out.push_str(line); continue; }
            (Some((c, k)), Some((c2, k2))) if c == c2 && k2 >= k && t.trim_end().chars().all(|x| x == c) => { fence = None; out.push_str(line); continue; }
            (Some(_), _) => { out.push_str(line); continue; }
            _ => {}
        }
        // ponytail: inline code by single backticks; ``a ` b`` splits at its inner backtick
        let parts: Vec<String> = line.split('`').enumerate().map(|(i, part)| {
            if i % 2 == 1 { return part.to_string(); }
            let part = WIKI.replace_all(part, |c: &regex::Captures| wiki(c, ctx, &mut n));
            MDLINK.replace_all(&part, |c: &regex::Captures| markdown(c, note, at, ctx, &mut n)).into_owned()
        }).collect();
        out.push_str(&parts.join("`"));
    }
    (out, n)
}

/// What moving `from` to `to` (both absolute, in the same workspace) would do, read now; nothing is written. Only a
/// change of case is allowed onto a name that is there (the same file on macOS).
pub fn plan(roots: &[String], from: &str, to: &str) -> Result<Plan, String> {
    let (root, src, rel) = locate(roots, from)?;
    let (root2, dst, rel_to) = locate(roots, to)?;
    if root != root2 { return Err("a move stays in its workspace: use Move to workspace… for another one".into()); }
    let Ok(meta) = fs::symlink_metadata(&src) else { return Err(format!("not found: {from}")) };
    let case_only = rel != rel_to && lower(&rel) == lower(&rel_to);
    if !case_only && fs::symlink_metadata(&dst).is_ok() { return Err(format!("already there: {rel_to}")); }
    if !case_only && dst.starts_with(&src) { return Err("a folder cannot go into itself".into()); }
    let dir_move = meta.is_dir();
    if !dir_move && src.extension().is_none_or(|e| e != "md") { return Err(format!("not a page: {from}")); }
    if !dir_move && !lower(&rel_to).ends_with(".md") { return Err(format!("a page keeps .md: {rel_to}")); }
    let all = all_files(&root);
    let moved: Vec<(String, String)> = if dir_move {
        let prefix = format!("{rel}/");
        all.iter().filter_map(|p| p.strip_prefix(&prefix).map(|r| (p.clone(), format!("{rel_to}/{r}")))).collect()
    } else { vec![(rel.clone(), rel_to.clone())] };
    let gone = moved.iter().filter_map(|(p, _)| fs::read(root.join(p)).ok().map(|d| (p.clone(), relay_remote::sync::sha256_hex(&d)))).collect();
    let notes: Vec<String> = all.iter().filter(|p| lower(p).ends_with(".md")).cloned().collect();
    let map: HashMap<&str, &str> = moved.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
    let after = notes.iter().map(|p| map.get(p.as_str()).map_or(p.clone(), |n| n.to_string())).collect();
    let ctx = Ctx { notes, after, files: all.iter().map(String::as_str).collect(), map };
    let mut edits = vec![];
    let mut links = 0;
    for note in &ctx.notes {
        let Ok(text) = fs::read_to_string(root.join(note)) else { continue };
        let at = ctx.map.get(note.as_str()).copied().unwrap_or(note);
        let (new, n) = rewrite(&text, note, at, &ctx);
        if n > 0 { links += n; edits.push((at.to_string(), text, new)); }
    }
    Ok(Plan { root, from: src, to: dst, rel_to, case_only, edits, links, gone })
}

/// Do a planned move: the page or folder goes to its new place, then each note with a changed link is written (a
/// temporary file renamed over it), but only while it still holds the text the plan read: one changed since (an
/// editor, Claude) stops the move. A stop or a failed write puts back the notes already written and the move itself;
/// what could not be put back (changed meanwhile, or a write that failed again) is named in the error.
pub fn apply(plan: &Plan) -> Result<(), String> {
    if let Some(p) = plan.to.parent() { fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    move_it(plan, &plan.from, &plan.to).map_err(|e| e.to_string())?;
    for (i, (at, old, new)) in plan.edits.iter().enumerate() {
        let p = plan.root.join(at);
        let failed = match fs::read_to_string(&p) {
            Ok(now) if now == *old => write(&p, new).err().map(|e| e.to_string()),
            Ok(_) => Some("changed since the links were counted".into()),
            Err(e) => Some(e.to_string()),
        };
        let Some(why) = failed else { continue };
        let stuck = put_back(plan, i);
        return Err(if stuck.is_empty() {
            format!("{at}: {why}; nothing was changed")
        } else {
            format!("{at}: {why}; these could not be put back: {}", stuck.join(", "))
        });
    }
    Ok(())
}
/// The page or folder to its place, through a temporary name for a change of case only (macOS sees "a.md" and "A.md"
/// as one name).
fn move_it(plan: &Plan, a: &Path, b: &Path) -> io::Result<()> {
    if !plan.case_only { return rename_new(a, b); }
    let tmp = tmp_of(a);
    rename_new(a, &tmp)?;
    rename_new(&tmp, b).inspect_err(|_| { fs::rename(&tmp, a).ok(); })
}
/// Text over a note through a temporary file next to it, removed when it fails.
fn write(p: &Path, text: &str) -> io::Result<()> {
    let tmp = tmp_of(p);
    fs::write(&tmp, text).and_then(|_| fs::rename(&tmp, p)).inspect_err(|_| { fs::remove_file(&tmp).ok(); })
}
/// The first `done` edits undone, each only while the note still holds what was written there, then the move: the
/// paths that could not be put back.
fn put_back(plan: &Plan, done: usize) -> Vec<String> {
    let mut stuck = vec![];
    for (at, old, new) in &plan.edits[..done] {
        let p = plan.root.join(at);
        let back = matches!(fs::read_to_string(&p), Ok(now) if now == *new) && write(&p, old).is_ok();
        if !back { stuck.push(at.clone()); }
    }
    if move_it(plan, &plan.to, &plan.from).is_err() { stuck.push(plan.rel_to.clone()); }
    stuck
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("pagefiles-{name}-{}", std::process::id()));
        fs::remove_dir_all(&d).ok();
        fs::create_dir_all(&d).unwrap();
        PathBuf::from(canon(&d.to_string_lossy()))
    }
    fn put(root: &Path, rel: &str, text: &str) {
        fs::create_dir_all(root.join(rel).parent().unwrap()).unwrap();
        fs::write(root.join(rel), text).unwrap();
    }
    fn read(root: &Path, rel: &str) -> String { fs::read_to_string(root.join(rel)).unwrap() }
    fn s(p: &Path) -> String { p.to_string_lossy().into_owned() }
    fn mv(v: &Path, a: &str, b: &str) -> Result<(), String> { apply(&plan(&[s(v)], &s(&v.join(a)), &s(&v.join(b)))?) }

    #[test]
    fn rename_rewrites_every_form_of_link_to_it() {
        let v = vault("rename");
        put(&v, "Notes/A.md", "# A\n");
        put(&v, "One.md", "see [[A]] and [[A|the a]]\n");
        put(&v, "Two.md", "path [[Notes/A]] and heading [[A#Intro]] and embed ![[A]]\n");
        put(&v, "Deep/Three.md", "md [a](../Notes/A.md) and [x](https://x.test/A.md)\n```\n[[A]]\n```\n");
        let p = plan(&[s(&v)], &s(&v.join("Notes/A.md")), &s(&v.join("Notes/B.md"))).unwrap();
        assert_eq!((p.links, p.edits.len()), (6, 3));
        apply(&p).unwrap();
        assert!(v.join("Notes/B.md").is_file() && !v.join("Notes/A.md").exists());
        assert_eq!(read(&v, "One.md"), "see [[B]] and [[B|the a]]\n");
        assert_eq!(read(&v, "Two.md"), "path [[Notes/B]] and heading [[B#Intro]] and embed ![[B]]\n");
        assert_eq!(read(&v, "Deep/Three.md"), "md [a](../Notes/B.md) and [x](https://x.test/A.md)\n```\n[[A]]\n```\n");
    }

    #[test]
    fn tables_inline_code_and_fences() {
        let v = vault("parse");
        put(&v, "A.md", "");
        put(&v, "N.md", "| [[A\\|alias]] | `[[A]]` [[A]] |\n~~~\n```\n[[A]]\n~~~\n[[A]]\n");
        mv(&v, "A.md", "B.md").unwrap();
        // the table's \| stays, inline code stays, a ``` inside a ~~~ fence neither closes nor opens one
        assert_eq!(read(&v, "N.md"), "| [[B\\|alias]] | `[[A]]` [[B]] |\n~~~\n```\n[[A]]\n~~~\n[[B]]\n");
    }

    #[test]
    fn markdown_link_forms() {
        let v = vault("mdforms");
        put(&v, "Notes/A.md", "");
        put(&v, "Deep/N.md", "[s](A.md) [r](Notes/A.md) [l](/Notes/A.md) [b](<../Notes/A.md>) [e](../Notes/A.md#Part \"t\")\n");
        mv(&v, "Notes/A.md", "Notes/My B.md").unwrap();
        assert_eq!(
            read(&v, "Deep/N.md"),
            "[s](My B.md) [r](Notes/My B.md) [l](/Notes/My B.md) [b](<../Notes/My B.md>) [e](../Notes/My B.md#Part \"t\")\n"
        );
        put(&v, "Deep/P.md", "[x](../Notes/My%20B.md)\n");
        mv(&v, "Notes/My B.md", "Notes/C D.md").unwrap();
        assert_eq!(read(&v, "Deep/P.md"), "[x](../Notes/C%20D.md)\n");
    }

    #[test]
    fn a_moved_note_keeps_its_relative_links_to_any_file() {
        let v = vault("relative");
        put(&v, "img/pic.png", "png");
        put(&v, "P/Plan.md", "![p](../img/pic.png) [r](../Root.md), [[Spec]]\n");
        put(&v, "P/Spec.md", "x\n");
        put(&v, "Root.md", "[[P/Plan]] and [s](P/Spec.md)\n");
        mv(&v, "P", "Archive/P").unwrap();
        assert_eq!(read(&v, "Archive/P/Plan.md"), "![p](../../img/pic.png) [r](../../Root.md), [[Spec]]\n");
        assert_eq!(read(&v, "Root.md"), "[[Archive/P/Plan]] and [s](Archive/P/Spec.md)\n");
    }

    #[test]
    fn the_whole_vault_counts_archives_and_deep_folders_included() {
        let v = vault("walk");
        put(&v, "Notes/A.md", "");
        put(&v, "_archive/old.md", "[[A]]\n");
        put(&v, "1/2/3/4/5/6/7/8/deep.md", "[[A]]\n");
        put(&v, ".obsidian/x.md", "[[A]]\n");
        // a second A only in the archive makes the bare name ambiguous: left alone everywhere
        put(&v, "_archive/x/A.md", "");
        assert_eq!(plan(&[s(&v)], &s(&v.join("Notes/A.md")), &s(&v.join("Notes/B.md"))).unwrap().links, 0);
        fs::remove_file(v.join("_archive/x/A.md")).unwrap();
        mv(&v, "Notes/A.md", "Notes/B.md").unwrap();
        assert_eq!(read(&v, "_archive/old.md"), "[[B]]\n");
        assert_eq!(read(&v, "1/2/3/4/5/6/7/8/deep.md"), "[[B]]\n");
        assert_eq!(read(&v, ".obsidian/x.md"), "[[A]]\n");
    }

    #[test]
    fn an_ambiguous_name_is_left_alone_and_one_that_becomes_ambiguous_gets_its_path() {
        let v = vault("ambiguous");
        put(&v, "X/A.md", "");
        put(&v, "Y/A.md", "");
        put(&v, "Y/C.md", "");
        put(&v, "Note.md", "[[A]] and [[X/A]]\n");
        mv(&v, "X/A.md", "X/B.md").unwrap();
        assert_eq!(read(&v, "Note.md"), "[[A]] and [[X/B]]\n");
        put(&v, "Other.md", "[[B]]\n");
        mv(&v, "X/B.md", "X/C.md").unwrap();
        assert_eq!(read(&v, "Other.md"), "[[X/C]]\n");
    }

    #[test]
    fn a_change_of_case_renames() {
        let v = vault("case");
        put(&v, "note.md", "");
        put(&v, "N.md", "[[note]]\n");
        mv(&v, "note.md", "Note.md").unwrap();
        let names: Vec<String> = fs::read_dir(&v).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert!(names.contains(&"Note.md".to_string()) && !names.contains(&"note.md".to_string()), "{names:?}");
        assert_eq!(read(&v, "N.md"), "[[Note]]\n");
    }

    #[test]
    fn nothing_is_made_or_moved_over_what_is_there() {
        let v = vault("excl");
        let roots = vec![s(&v)];
        assert_eq!(create(&roots, &s(&v), "Untitled", true).unwrap(), "Untitled");
        assert_eq!(create(&roots, &s(&v.join("Untitled")), "Page", false).unwrap(), "Untitled/Page.md");
        assert!(create(&roots, &s(&v.join("Untitled")), "Page", false).is_err());
        assert!(create(&roots, &s(&v), ".hidden", false).is_err());
        assert_eq!(free_name(&roots, &s(&v.join("Untitled")), "Page").unwrap(), "Page 1");
        put(&v, "Untitled/Page copy.md", "taken");
        assert_eq!(duplicate(&roots, &s(&v.join("Untitled/Page.md"))).unwrap(), "Untitled/Page copy 1.md");
        assert_eq!(read(&v, "Untitled/Page copy.md"), "taken");
        put(&v, "B.md", "b");
        assert!(rename_new(&v.join("Untitled/Page.md"), &v.join("B.md")).is_err());
        assert_eq!(read(&v, "B.md"), "b");
        assert!(v.join("Untitled/Page.md").is_file());
    }

    #[test]
    fn trash_and_restore() {
        let v = vault("trash");
        put(&v, "F/A.md", "a");
        let roots = vec![s(&v)];
        let (t, rel) = trash(&roots, &s(&v.join("F/A.md"))).unwrap();
        assert_eq!((t.as_str(), rel.as_str()), (".trash/A.md", "F/A.md"));
        put(&v, "G/A.md", "other");
        assert_eq!(trash(&roots, &s(&v.join("G/A.md"))).unwrap().0, ".trash/A 1.md");
        restore(&roots, &s(&v), &t, &rel).unwrap();
        assert_eq!(read(&v, "F/A.md"), "a");
        // back over a page made there meanwhile: refused, the trash keeps it
        put(&v, "G/A.md", "new");
        assert!(restore(&roots, &s(&v), ".trash/A 1.md", "G/A.md").is_err());
        assert_eq!((read(&v, "G/A.md"), read(&v, ".trash/A 1.md")), ("new".into(), "other".into()));
        assert!(restore(&roots, &s(&v), "../x", "F/A.md").is_err());
        assert!(restore(&roots, &s(&v), ".trash/A 1.md", "../out.md").is_err());
        assert!(restore(&roots, &s(&v), ".trash/A 1.md", ".git/x.md").is_err());
    }

    #[test]
    fn a_trash_that_is_a_link_is_refused() {
        let v = vault("binlink");
        let out = vault("binlink-out");
        put(&v, "A.md", "a");
        std::os::unix::fs::symlink(&out, v.join(".trash")).unwrap();
        assert!(trash(&[s(&v)], &s(&v.join("A.md"))).is_err());
        assert!(v.join("A.md").is_file());
        assert_eq!(fs::read_dir(&out).unwrap().count(), 0);
    }

    #[test]
    fn refuses_outside_hidden_and_links() {
        let v = vault("refuse");
        let out = vault("refuse-out");
        put(&v, "A.md", "");
        put(&out, "Secret.md", "");
        put(&v, ".obsidian/x.md", "");
        std::os::unix::fs::symlink(out.join("Secret.md"), v.join("Link.md")).unwrap();
        std::os::unix::fs::symlink(&out, v.join("Out")).unwrap();
        let roots = vec![s(&v)];
        assert!(trash(&roots, &s(&out.join("Secret.md"))).is_err());
        assert!(trash(&roots, &s(&v.join("Out/Secret.md"))).is_err());
        assert!(trash(&roots, &s(&v.join("Link.md"))).is_err());
        assert!(trash(&roots, &s(&v.join(".obsidian/x.md"))).is_err());
        assert!(trash(&roots, &format!("{}/../{}/Secret.md", s(&v), out.file_name().unwrap().to_string_lossy())).is_err());
        assert!(plan(&roots, &s(&v.join("A.md")), &s(&out.join("A.md"))).is_err());
        assert!(create(&roots, &s(&out), "X", false).is_err());
        assert!(out.join("Secret.md").is_file());
    }

    #[test]
    fn a_note_changed_after_the_count_stops_the_move() {
        let v = vault("lost");
        put(&v, "A.md", "");
        put(&v, "One.md", "[[A]]\n");
        put(&v, "Two.md", "[[A]]\n");
        let p = plan(&[s(&v)], &s(&v.join("A.md")), &s(&v.join("B.md"))).unwrap();
        // Claude edits Two.md between the count and the move: its edit is not written over
        put(&v, "Two.md", "[[A]]\nClaude's line\n");
        let e = apply(&p).unwrap_err();
        assert!(e.contains("Two.md") && e.contains("nothing was changed"), "{e}");
        assert_eq!(read(&v, "Two.md"), "[[A]]\nClaude's line\n");
        assert_eq!(read(&v, "One.md"), "[[A]]\n");
        assert!(v.join("A.md").is_file() && !v.join("B.md").exists());
    }

    #[test]
    fn a_failed_write_puts_everything_back_and_leaves_no_temporary_file() {
        use std::os::unix::fs::PermissionsExt;
        let v = vault("rollback");
        put(&v, "A.md", "");
        put(&v, "One.md", "[[A]]\n");
        put(&v, "Zlocked/Two.md", "[[A]]\n");
        let p = plan(&[s(&v)], &s(&v.join("A.md")), &s(&v.join("B.md"))).unwrap();
        assert_eq!(p.edits[1].0, "Zlocked/Two.md");
        fs::set_permissions(v.join("Zlocked"), fs::Permissions::from_mode(0o555)).unwrap();
        let e = apply(&p).unwrap_err();
        fs::set_permissions(v.join("Zlocked"), fs::Permissions::from_mode(0o755)).unwrap();
        assert!(e.contains("nothing was changed"), "{e}");
        assert!(v.join("A.md").is_file() && !v.join("B.md").exists());
        assert_eq!(read(&v, "One.md"), "[[A]]\n");
        let left = |d: &Path| fs::read_dir(d).unwrap().flatten().any(|e| e.file_name().to_string_lossy().starts_with(".relay-sync-"));
        assert!(!left(&v) && !left(&v.join("Zlocked")));
    }

    #[test]
    fn putting_back_keeps_an_edit_made_meanwhile_and_names_it() {
        let v = vault("putback");
        put(&v, "A.md", "");
        put(&v, "One.md", "[[A]]\n");
        put(&v, "Two.md", "[[A]]\n");
        let p = plan(&[s(&v)], &s(&v.join("A.md")), &s(&v.join("B.md"))).unwrap();
        // as apply leaves it after both writes: then One.md is edited, and the move is undone
        fs::rename(v.join("A.md"), v.join("B.md")).unwrap();
        put(&v, "One.md", "[[B]]\nmine\n");
        put(&v, "Two.md", "[[B]]\n");
        assert_eq!(put_back(&p, 2), vec!["One.md".to_string()]);
        assert_eq!((read(&v, "One.md"), read(&v, "Two.md")), ("[[B]]\nmine\n".into(), "[[A]]\n".into()));
        assert!(v.join("A.md").is_file());
    }

    #[test]
    fn a_move_lists_what_leaves_with_its_hash() {
        let v = vault("gone");
        put(&v, "P/a.md", "x");
        put(&v, "P/img.png", "y");
        let p = plan(&[s(&v)], &s(&v.join("P")), &s(&v.join("Q"))).unwrap();
        let mut gone = p.gone.clone();
        gone.sort();
        let h = |d: &str| relay_remote::sync::sha256_hex(d.as_bytes());
        assert_eq!(gone, vec![("P/a.md".into(), h("x")), ("P/img.png".into(), h("y"))]);
    }
}
