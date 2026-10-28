// The Pages tab's file operations on a workspace: a new page or folder, rename and move (with the links to it rewritten),
// duplicate, and delete into the workspace's .trash/ (Obsidian's) with a restore for Undo. Every path is absolute, must
// sit in one of the workspace roots once its folder's links are resolved, and may not be or pass through a hidden name
// (.git, .obsidian, .claude, .trash…) nor be a link itself; paths given back are relative to their root.

use crate::vault::{canon, notes};
use regex::Regex;
use std::fs;
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
/// `stem.ext` in `dir`, or `stem 1.ext`, `stem 2.ext`… when taken.
fn free(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    (0..).map(|i| dir.join(if i == 0 { format!("{stem}{ext}") } else { format!("{stem} {i}{ext}") }))
        .find(|p| fs::symlink_metadata(p).is_err()).unwrap()
}

/// A new empty page `name`.md (or a folder with `dir`) in the folder `parent`, never over one that is there. Returns
/// its path relative to the workspace.
pub fn create(roots: &[String], parent: &str, name: &str, dir: bool) -> Result<String, String> {
    let (root, at) = folder(roots, parent)?;
    let name = plain(name)?;
    let name = name.strip_suffix(".md").unwrap_or(name);
    let p = if dir { at.join(name) } else { at.join(format!("{name}.md")) };
    if fs::symlink_metadata(&p).is_ok() { return Err(format!("already there: {}", p.file_name().unwrap().to_string_lossy())); }
    if dir { fs::create_dir(&p) } else { fs::write(&p, "") }.map_err(|e| e.to_string())?;
    Ok(p.strip_prefix(&root).unwrap().to_string_lossy().into_owned())
}
/// A copy of a page next to it, "Name 1.md". Returns the copy's path relative to the workspace.
pub fn duplicate(roots: &[String], target: &str) -> Result<String, String> {
    let (root, real, _) = locate(roots, target)?;
    if !real.is_file() || real.extension().is_none_or(|e| e != "md") { return Err(format!("not a page: {target}")); }
    let stem = real.file_stem().unwrap().to_string_lossy();
    let to = free(real.parent().unwrap(), &stem, ".md");
    fs::copy(&real, &to).map_err(|e| e.to_string())?;
    Ok(to.strip_prefix(&root).unwrap().to_string_lossy().into_owned())
}

/// A page or folder into the workspace's .trash/ (a free name there). Returns (where it went, where it was), both
/// relative to the workspace: what `restore` takes.
pub fn trash(roots: &[String], target: &str) -> Result<(String, String), String> {
    let (root, real, rel) = locate(roots, target)?;
    let bin = root.join(".trash");
    fs::create_dir_all(&bin).map_err(|e| e.to_string())?;
    let (stem, ext) = match (real.is_file(), real.extension()) {
        (true, Some(e)) => (real.file_stem().unwrap().to_string_lossy().into_owned(), format!(".{}", e.to_string_lossy())),
        _ => (real.file_name().unwrap().to_string_lossy().into_owned(), String::new()),
    };
    let to = free(&bin, &stem, &ext);
    fs::rename(&real, &to).map_err(|e| e.to_string())?;
    Ok((to.strip_prefix(&root).unwrap().to_string_lossy().into_owned(), rel))
}
/// Undo of `trash`: `trashed` (in the root's .trash/) back at `rel`, unless something is there by now.
pub fn restore(roots: &[String], root: &str, trashed: &str, rel: &str) -> Result<(), String> {
    let root = root_of(roots, root)?;
    let from = root.join(trashed);
    if !trashed.starts_with(".trash/") || trashed.contains("..") || rel.contains("..") || rel.starts_with('/') {
        return Err(format!("not in the trash: {trashed}"));
    }
    let to = root.join(rel);
    if fs::symlink_metadata(&to).is_ok() { return Err(format!("already there: {rel}")); }
    if let Some(p) = to.parent() { fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    fs::rename(&from, &to).map_err(|e| e.to_string())
}

/// What a move does: the notes it moves (old → new, relative to the root), and the notes whose links change, with
/// their text before and after, at the place they are in after the move.
#[derive(Debug)]
pub struct Plan { pub root: PathBuf, pub from: PathBuf, pub to: PathBuf, pub rel_to: String, pub edits: Vec<(String, String, String)>, pub links: usize }

/// Every file at or under `p`, relative to `root`, links not followed: what a move or delete takes away from where it
/// was (a shared workspace's round sees each as a delete).
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

static WIKI: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[\[([^\]\|#\n]+)((?:#[^\]\|\n]*)?(?:\|[^\]\n]*)?)\]\]").unwrap());
static MDLINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\]\(([^)\s]+?\.md)(#[^)\s]*)?\)").unwrap());

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
    let ups = std::iter::repeat_n("..", a.len() - same);
    ups.chain(b[same..].iter().copied()).collect::<Vec<_>>().join("/")
}
/// A path joined onto a folder, with "." and ".." taken out ("" when it climbs out of the root).
fn join(folder: &str, rel: &str) -> Option<String> {
    let mut out: Vec<&str> = folder.split('/').filter(|s| !s.is_empty()).collect();
    for part in rel.split('/') {
        match part { "" | "." => {} ".." => { out.pop()?; } x => out.push(x) }
    }
    Some(out.join("/"))
}

/// The text of `note` (now at `at`) with its links to moved notes rewritten, and how many. A [[link]] keeps its form:
/// a bare name stays a bare name unless the new one is no longer the only note of that name, a path stays a path; a
/// markdown link is made relative from where the note is now. Code blocks are left as they are.
fn rewrite(text: &str, note: &str, at: &str, all: &[String], after: &[String], map: &std::collections::HashMap<&str, &str>) -> (String, usize) {
    let mut n = 0;
    let mut fenced = false;
    let mut out = String::with_capacity(text.len());
    for line in text.split_inclusive('\n') {
        let t = line.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") { fenced = !fenced; out.push_str(line); continue; }
        if fenced { out.push_str(line); continue; }
        let line = WIKI.replace_all(line, |c: &regex::Captures| {
            let (link, rest) = (&c[1], &c[2]);
            let Some(new) = wiki_target(link, all).and_then(|p| map.get(p.as_str())) else { return c[0].to_string() };
            let keep_md = lower(link).ends_with(".md");
            let stem = new.strip_suffix(".md").unwrap_or(new);
            let name = base(new);
            let unique = after.iter().filter(|p| lower(base(p)) == lower(name)).count() == 1;
            let mut form = if link.contains('/') || !unique { stem.to_string() } else { base(stem).to_string() };
            if keep_md { form.push_str(".md"); }
            if form == link { return c[0].to_string(); }
            n += 1;
            format!("[[{form}{rest}]]")
        });
        let line = MDLINK.replace_all(&line, |c: &regex::Captures| {
            let raw = &c[1];
            if raw.contains("://") { return c[0].to_string(); }
            let spaced = raw.contains("%20");
            let plain = raw.replace("%20", " ");
            let old = if let Some(abs) = plain.strip_prefix('/') { Some(abs.to_string()) } else { join(dir(note), &plain) };
            let Some(old) = old.filter(|o| all.contains(o)) else { return c[0].to_string() };
            let target = map.get(old.as_str()).copied().unwrap_or(old.as_str());
            if target == old && at == note { return c[0].to_string(); }
            let new = if plain.starts_with('/') { format!("/{target}") } else { relative(dir(at), target) };
            let new = if spaced { new.replace(' ', "%20") } else { new };
            if new == raw { return c[0].to_string(); }
            n += 1;
            format!("]({new}{})", c.get(2).map_or("", |m| m.as_str()))
        });
        out.push_str(&line);
    }
    (out, n)
}

/// What moving `from` to `to` (both absolute, in the same workspace) would do, read now; nothing is written.
pub fn plan(roots: &[String], from: &str, to: &str) -> Result<Plan, String> {
    let (root, src, rel) = locate(roots, from)?;
    let (root2, dst, rel_to) = locate(roots, to)?;
    if root != root2 { return Err("a move stays in its workspace: use Move to workspace… for another one".into()); }
    if fs::symlink_metadata(&src).is_err() { return Err(format!("not found: {from}")); }
    if fs::symlink_metadata(&dst).is_ok() { return Err(format!("already there: {rel_to}")); }
    if dst.starts_with(&src) { return Err("a folder cannot go into itself".into()); }
    let dir_move = src.is_dir();
    if !dir_move && src.extension().is_none_or(|e| e != "md") { return Err(format!("not a page: {from}")); }
    if !dir_move && !lower(&rel_to).ends_with(".md") { return Err(format!("a page keeps .md: {rel_to}")); }
    let (_, all) = notes(&root.to_string_lossy());
    let moved: Vec<(String, String)> = if dir_move {
        let prefix = format!("{rel}/");
        all.iter().filter_map(|p| p.strip_prefix(&prefix).map(|r| (p.clone(), format!("{rel_to}/{r}")))).collect()
    } else { vec![(rel.clone(), rel_to.clone())] };
    let map: std::collections::HashMap<&str, &str> = moved.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
    let after: Vec<String> = all.iter().map(|p| map.get(p.as_str()).map_or(p.clone(), |n| n.to_string())).collect();
    let mut edits = vec![];
    let mut links = 0;
    for note in &all {
        let Ok(text) = fs::read_to_string(root.join(note)) else { continue };
        let at = map.get(note.as_str()).copied().unwrap_or(note);
        let (new, n) = rewrite(&text, note, at, &all, &after, &map);
        if n > 0 { links += n; edits.push((at.to_string(), text, new)); }
    }
    Ok(Plan { root, from: src, to: dst, rel_to, edits, links })
}

/// Do a planned move: the page or folder goes to its new place, then each note with a changed link is written (a
/// temporary file renamed over it). One write that fails puts back the notes already written and the move itself, so
/// a failed move leaves the workspace as it was.
pub fn apply(plan: &Plan) -> Result<(), String> {
    if let Some(p) = plan.to.parent() { fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    fs::rename(&plan.from, &plan.to).map_err(|e| e.to_string())?;
    let write = |p: &Path, text: &str| -> std::io::Result<()> {
        let tmp = p.with_extension("md.relay-tmp");
        fs::write(&tmp, text)?;
        fs::rename(&tmp, p).inspect_err(|_| { fs::remove_file(&tmp).ok(); })
    };
    for (i, (at, _, new)) in plan.edits.iter().enumerate() {
        if let Err(e) = write(&plan.root.join(at), new) {
            for (at, old, _) in &plan.edits[..i] { write(&plan.root.join(at), old).ok(); }
            fs::rename(&plan.to, &plan.from).ok();
            return Err(format!("{at}: {e}; nothing was changed"));
        }
    }
    Ok(())
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

    #[test]
    fn rename_rewrites_every_form_of_link_to_it() {
        let v = vault("rename");
        put(&v, "Notes/A.md", "# A\n");
        put(&v, "One.md", "see [[A]] and [[A|the a]]\n");
        put(&v, "Two.md", "path [[Notes/A]] and heading [[A#Intro]] and embed ![[A]]\n");
        put(&v, "Deep/Three.md", "md [a](../Notes/A.md) and [x](https://x.test/A.md)\n```\n[[A]]\n```\n");
        let roots = vec![s(&v)];
        let p = plan(&roots, &s(&v.join("Notes/A.md")), &s(&v.join("Notes/B.md"))).unwrap();
        assert_eq!((p.links, p.edits.len()), (6, 3));
        apply(&p).unwrap();
        assert!(v.join("Notes/B.md").is_file() && !v.join("Notes/A.md").exists());
        assert_eq!(read(&v, "One.md"), "see [[B]] and [[B|the a]]\n");
        assert_eq!(read(&v, "Two.md"), "path [[Notes/B]] and heading [[B#Intro]] and embed ![[B]]\n");
        // the code block and the web link stay
        assert_eq!(read(&v, "Deep/Three.md"), "md [a](../Notes/B.md) and [x](https://x.test/A.md)\n```\n[[A]]\n```\n");
    }

    #[test]
    fn folder_move_rewrites_links_into_it_and_out_of_it() {
        let v = vault("folder");
        put(&v, "P/Plan.md", "up [r](../Root.md), [[Spec]]\n");
        put(&v, "P/Spec.md", "x\n");
        put(&v, "Root.md", "[[P/Plan]] and [s](P/Spec.md)\n");
        let roots = vec![s(&v)];
        let p = plan(&roots, &s(&v.join("P")), &s(&v.join("Archive/P"))).unwrap();
        apply(&p).unwrap();
        assert_eq!(read(&v, "Archive/P/Plan.md"), "up [r](../../Root.md), [[Spec]]\n");
        assert_eq!(read(&v, "Root.md"), "[[Archive/P/Plan]] and [s](Archive/P/Spec.md)\n");
    }

    #[test]
    fn an_ambiguous_name_is_left_alone() {
        let v = vault("ambiguous");
        put(&v, "X/A.md", "");
        put(&v, "Y/A.md", "");
        put(&v, "Note.md", "[[A]] and [[X/A]]\n");
        let roots = vec![s(&v)];
        let p = plan(&roots, &s(&v.join("X/A.md")), &s(&v.join("X/B.md"))).unwrap();
        apply(&p).unwrap();
        assert_eq!(read(&v, "Note.md"), "[[A]] and [[X/B]]\n");
    }

    #[test]
    fn a_bare_name_that_becomes_ambiguous_gets_its_path() {
        let v = vault("becomes");
        put(&v, "X/A.md", "");
        put(&v, "Y/B.md", "");
        put(&v, "Note.md", "[[A]]\n");
        let roots = vec![s(&v)];
        apply(&plan(&roots, &s(&v.join("X/A.md")), &s(&v.join("X/B.md"))).unwrap()).unwrap();
        assert_eq!(read(&v, "Note.md"), "[[X/B]]\n");
    }

    #[test]
    fn trash_and_restore() {
        let v = vault("trash");
        put(&v, "F/A.md", "a");
        let roots = vec![s(&v)];
        let (t, rel) = trash(&roots, &s(&v.join("F/A.md"))).unwrap();
        assert_eq!((t.as_str(), rel.as_str()), (".trash/A.md", "F/A.md"));
        assert!(!v.join("F/A.md").exists());
        put(&v, "G/A.md", "other");
        assert_eq!(trash(&roots, &s(&v.join("G/A.md"))).unwrap().0, ".trash/A 1.md");
        restore(&roots, &s(&v), &t, &rel).unwrap();
        assert_eq!(read(&v, "F/A.md"), "a");
        assert!(restore(&roots, &s(&v), "../x", "F/A.md").is_err());
    }

    #[test]
    fn create_and_duplicate() {
        let v = vault("create");
        let roots = vec![s(&v)];
        assert_eq!(create(&roots, &s(&v), "Untitled", true).unwrap(), "Untitled");
        assert_eq!(create(&roots, &s(&v.join("Untitled")), "Page", false).unwrap(), "Untitled/Page.md");
        assert!(create(&roots, &s(&v.join("Untitled")), "Page", false).is_err());
        assert!(create(&roots, &s(&v), ".hidden", false).is_err());
        assert_eq!(duplicate(&roots, &s(&v.join("Untitled/Page.md"))).unwrap(), "Untitled/Page 1.md");
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
        assert!(trash(&roots, &s(&out.join("Secret.md"))).is_err()); // outside
        assert!(trash(&roots, &s(&v.join("Out/Secret.md"))).is_err()); // through a link out
        assert!(trash(&roots, &s(&v.join("Link.md"))).is_err()); // a link itself
        assert!(trash(&roots, &s(&v.join(".obsidian/x.md"))).is_err()); // hidden
        assert!(trash(&roots, &format!("{}/../{}/Secret.md", s(&v), out.file_name().unwrap().to_string_lossy())).is_err());
        assert!(plan(&roots, &s(&v.join("A.md")), &s(&out.join("A.md"))).is_err());
        assert!(create(&roots, &s(&out), "X", false).is_err());
        assert!(out.join("Secret.md").is_file());
    }

    #[test]
    fn a_failed_write_puts_everything_back() {
        use std::os::unix::fs::PermissionsExt;
        let v = vault("rollback");
        put(&v, "A.md", "");
        put(&v, "One.md", "[[A]]\n");
        put(&v, "Locked/Two.md", "[[A]]\n");
        let roots = vec![s(&v)];
        let p = plan(&roots, &s(&v.join("A.md")), &s(&v.join("B.md"))).unwrap();
        assert_eq!(p.edits.len(), 2);
        // the second note's folder takes no new file: its write fails after the first one went through
        assert_eq!(p.edits[0].0, "One.md");
        fs::set_permissions(v.join("Locked"), fs::Permissions::from_mode(0o555)).unwrap();
        assert!(apply(&p).is_err());
        fs::set_permissions(v.join("Locked"), fs::Permissions::from_mode(0o755)).unwrap();
        assert!(v.join("A.md").is_file() && !v.join("B.md").exists());
        assert_eq!(read(&v, "One.md"), "[[A]]\n");
        assert_eq!(read(&v, "Locked/Two.md"), "[[A]]\n");
    }
}
