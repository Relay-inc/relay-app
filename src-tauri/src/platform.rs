//! The few file calls that are Unix only: modes and links. On macOS the std ones, on Windows a stand-in so the app
//! builds there, or the Windows way (a directory junction for a vault's `.claude`).

use std::io;
use std::path::Path;

/// `OpenOptions::mode`, ignored on Windows.
#[cfg(unix)]
pub use std::os::unix::fs::OpenOptionsExt;
// Windows has no modes. Every file opened with mode 0o600 (mirror, shared vault and remote keys, phone-share.json,
// the cookie jar) lives under the app data folder (%APPDATA%) or the temp folder (%LOCALAPPDATA%\Temp), both inside
// the user's profile, whose inherited ACL gives only the user, SYSTEM and Administrators access. That is what 0600
// gives on the Mac too (root reads it).
// ponytail: no own DACL, so a profile whose AppData is redirected to a share keeps the share's ACL, set one if that matters
#[cfg(not(unix))]
pub trait OpenOptionsExt { fn mode(&mut self, mode: u32) -> &mut Self; }
#[cfg(not(unix))]
impl OpenOptionsExt for std::fs::OpenOptions { fn mode(&mut self, _: u32) -> &mut Self { self } }

/// Set a file's mode. Windows has no modes: nothing happens there.
pub fn set_mode(p: &Path, mode: u32) -> io::Result<()> {
    #[cfg(unix)]
    { use std::os::unix::fs::PermissionsExt; std::fs::set_permissions(p, std::fs::Permissions::from_mode(mode)) }
    #[cfg(not(unix))]
    { let _ = (p, mode); Ok(()) }
}

/// Whether the file has an execute bit. Never on Windows, where the extension decides.
pub fn executable(m: &std::fs::Metadata) -> bool {
    #[cfg(unix)]
    { use std::os::unix::fs::PermissionsExt; m.permissions().mode() & 0o111 != 0 }
    #[cfg(not(unix))]
    { let _ = m; false }
}

/// A symlink at `at` to `to` (the mirror's staging folder of a work machine).
pub fn symlink(to: impl AsRef<Path>, at: impl AsRef<Path>) -> io::Result<()> {
    #[cfg(unix)]
    { std::os::unix::fs::symlink(to, at) }
    // ponytail: no symlinks on Windows without Developer Mode or admin rights. A vault's `.claude` is a junction
    // (dir_link), the work machine's staging links come with W8
    #[cfg(not(unix))]
    { let _ = (to, at); Err(io::Error::new(io::ErrorKind::Unsupported, "symlinks are not supported on Windows yet")) }
}

/// A vault's `.claude -> System` link, `to` relative to `at`'s folder: a symlink on macOS, a directory junction on
/// Windows (no admin rights or Developer Mode needed). A junction holds an absolute path, so one left behind by a vault
/// that moved leads nowhere: it is replaced here.
pub fn dir_link(to: impl AsRef<Path>, at: impl AsRef<Path>) -> io::Result<()> {
    #[cfg(unix)]
    { std::os::unix::fs::symlink(to, at) }
    #[cfg(windows)]
    {
        let at = at.as_ref();
        if std::fs::symlink_metadata(at).is_ok_and(|m| m.file_type().is_symlink()) && std::fs::metadata(at).is_err() { std::fs::remove_dir(at)?; }
        junction::create(at.parent().unwrap_or(Path::new("")).join(to), at)
    }
}

/// Whether the link `dir_link` makes is in place at `at`: anything there on macOS (as before), on Windows also leading
/// somewhere (a junction from before the vault moved does not).
pub fn dir_link_ok(at: &Path) -> bool {
    std::fs::symlink_metadata(at).is_ok() && (cfg!(unix) || std::fs::metadata(at).is_ok())
}

/// How Relay runs a vault's Python script (build-index.py): `python3` on the given PATH on macOS, as before. On Windows
/// the first of `py -3`, `python`, `python3` that answers as Python 3 (python.org installs no `python3`, and Windows'
/// own `python3` alias only points to the Store), None without one. Looked up once: Python installed later counts
/// after a restart.
pub fn python(path: &str) -> Option<std::process::Command> {
    #[cfg(unix)]
    { let mut c = std::process::Command::new("python3"); c.env("PATH", path); Some(c) }
    // ponytail: the PATH Relay was started with, until W3 reads the user's PATH on Windows
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        type Cmd = (&'static str, &'static [&'static str]);
        static FOUND: std::sync::OnceLock<Option<Cmd>> = std::sync::OnceLock::new();
        let _ = path;
        // no console window flashing up for each run
        let cmd = |(bin, args): Cmd| { let mut c = std::process::Command::new(bin); c.args(args).creation_flags(0x0800_0000); c };
        let found = *FOUND.get_or_init(|| [("py", &["-3"][..]), ("python", &[]), ("python3", &[])].into_iter().find(|&b| {
            cmd(b).arg("--version").stdin(std::process::Stdio::null()).output()
                .is_ok_and(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).starts_with("Python 3"))
        }));
        found.map(cmd)
    }
}

/// A path as Relay compares paths: absolute, `.` and `..` worked out (never above the root) without asking the disk,
/// relative ones against `base` (an absolute path). On macOS the std way (`lexical`), as before. On Windows the
/// forms Windows takes (`C:\a`, `c:/a`, mixed separators, `\\server\share\a`, `\\?\C:\a`, `\\?\UNC\server\share\a`,
/// `\a` on `base`'s drive) all become one: `/` separators and lower case (Windows' file names are not case
/// sensitive), the drive as `c:` and a share as `//server/share`, no trailing `/`. A pure function so the Windows
/// side is tested on a Mac too, where std::path does not read `C:\`.
pub fn norm_path(p: &str, base: &str, windows: bool) -> String {
    if !windows {
        let p = Path::new(p);
        return lexical(&if p.is_absolute() { p.to_path_buf() } else { Path::new(base).join(p) });
    }
    let s = p.replace('\\', "/");
    let drive = |x: &str| x.len() >= 2 && x.as_bytes()[0].is_ascii_alphabetic() && x.as_bytes()[1] == b':';
    // `\\?\` and `\\.\` before a drive or `UNC\` are that drive or share. Any other device path stays one (`murky`)
    let s = ["//?/", "//./"].iter().find_map(|d| s.strip_prefix(d)).and_then(|r| r.strip_prefix("UNC/").map(|u| format!("//{u}")).or_else(|| drive(r).then(|| r.to_string()))).unwrap_or(s);
    let (root, rest) = if drive(&s) {
        (s[..2].to_lowercase(), s[2..].to_string())
    } else if let Some(r) = s.strip_prefix("//") {
        let mut it = r.splitn(3, '/');
        let (server, share) = (it.next().unwrap_or(""), it.next().unwrap_or(""));
        (format!("//{server}/{share}").to_lowercase(), it.next().unwrap_or("").to_string())
    } else {
        // `\a` on base's drive (or share), `a` inside base
        let b = if is_abs(base, true) { norm_path(base, "c:", true) } else { "c:".to_string() };
        let root = if b.starts_with("//") { b.splitn(5, '/').take(4).collect::<Vec<_>>().join("/") } else { b.chars().take(2).collect() };
        if s.starts_with('/') { (root, s) } else { return norm_path(&format!("{b}/{s}"), base, true) }
    };
    let mut segs: Vec<String> = vec![];
    for c in rest.split('/') {
        // Windows drops a name's trailing dots and spaces (`vault.` and `vault ` are `vault`)
        match c { "" | "." => {} ".." => { segs.pop(); } x => { let x = x.trim_end_matches(['.', ' ']); if !x.is_empty() { segs.push(x.to_lowercase()) } } }
    }
    if segs.is_empty() { root } else { format!("{root}/{}", segs.join("/")) }
}
/// A path with its `.` and `..` worked out, without asking the disk (macOS).
fn lexical(p: &Path) -> String {
    let mut out = std::path::PathBuf::from("/");
    for c in p.components() {
        match c { std::path::Component::ParentDir => { out.pop(); } std::path::Component::Normal(x) => out.push(x), _ => {} }
    }
    out.to_string_lossy().into_owned()
}
/// Whether a word is an absolute path. On Windows a drive (`C:\`, `c:/`, also `C:x`), a share or `\\?\` path, `\a`
/// on the current drive, and `/a/b` there too (PowerShell reads it so). Not a switch: `/` with up to three letters or
/// digits, or with `:` or `?` (`cmd /c`, `dir /b`, `/all`, `/o:n`, `/?`).
pub fn is_abs(p: &str, windows: bool) -> bool {
    if !windows { return p.starts_with('/'); }
    let b = p.as_bytes();
    if let Some(r) = p.strip_prefix('/').filter(|r| !r.starts_with('/')) {
        let switch = !r.is_empty() && !r.contains(['/', '\\', '.']) && (r.len() <= 3 && r.chars().all(|c| c.is_ascii_alphanumeric()) || r.contains([':', '?']));
        return !switch;
    }
    (b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':') || p.starts_with('\\') || p.starts_with("//")
}
/// Whether a normalized Windows path is one the guard cannot place, so it refuses it: a device path (`\\?\GLOBALROOT`,
/// `\\.\PhysicalDrive0`), a drive's admin share (`\\host\c$`, the same disk by another name), or an 8.3 short name
/// (`VAULT~1`, which Windows may open as `vault`).
pub fn murky(p: &str) -> bool {
    let share = p.strip_prefix("//").and_then(|r| r.split('/').nth(1)).unwrap_or("");
    p.starts_with("//?/") || p.starts_with("//./") || (share.len() == 2 && share.ends_with('$'))
        || p.split('/').any(|c| c.split_once('~').is_some_and(|(_, d)| d.starts_with(|x: char| x.is_ascii_digit())))
}
/// A word with the user's home folder written out: `~`, `$HOME`, `${HOME}`. On Windows also, in any case,
/// `$env:NAME`, `${env:NAME}` (PowerShell, which Codex runs commands in there) and `%NAME%` (cmd) at its start, with
/// `env` for the variable (USERPROFILE and HOME are `home`). An unknown variable stays as written.
pub fn expand_home(t: &str, home: &str, windows: bool, env: impl Fn(&str) -> Option<String>) -> String {
    if !windows {
        return t.strip_prefix("${HOME}").or_else(|| t.strip_prefix("$HOME")).map(|x| format!("{home}{x}"))
            .or_else(|| (t == "~" || t.starts_with("~/")).then(|| format!("{home}{}", &t[1..]))).unwrap_or_else(|| t.to_string());
    }
    if t == "~" || t.starts_with("~/") || t.starts_with("~\\") { return format!("{home}{}", &t[1..]); }
    let lower = t.to_ascii_lowercase();
    let (name, rest) = if let Some(r) = lower.strip_prefix("${env:").and_then(|r| r.split_once('}')) { r }
        else if let Some(r) = lower.strip_prefix("${").and_then(|r| r.split_once('}')).filter(|(n, _)| *n == "home") { r }
        else if let Some(r) = lower.strip_prefix('%').and_then(|r| r.split_once('%')) { r }
        else if let Some(r) = lower.strip_prefix("$env:").or_else(|| lower.strip_prefix('$').filter(|r| r.starts_with("home"))) {
            r.split_at(r.find(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).unwrap_or(r.len()))
        } else { return t.to_string() };
    let value = if name == "home" || name == "userprofile" { Some(home.to_string()) } else { env(&name.to_uppercase()) };
    match value { Some(v) if !v.is_empty() => format!("{v}{}", &t[t.len() - rest.len()..]), _ => t.to_string() }
}
/// The folders of the system's programs and devices, normalized as `norm_path` and with a trailing `/`: what a guarded
/// agent may name outside a workspace. macOS: what Codex asks for there (`/bin/zsh -lc '…'`) and Homebrew. Windows:
/// the program folders of Codex's own `:minimal` there (Windows, Program Files twice), where its shell (PowerShell, then
/// cmd) and Git for Windows live, by `env` (SystemRoot, ProgramFiles, ProgramFiles(x86)) with Codex's `C:\` defaults.
/// Not ProgramData, which holds other programs' data.
pub fn system_dirs(windows: bool, env: impl Fn(&str) -> Option<String>) -> Vec<String> {
    if !windows { return ["/bin/", "/sbin/", "/usr/", "/opt/homebrew/", "/dev/"].map(String::from).to_vec(); }
    [("SystemRoot", r"C:\Windows"), ("ProgramFiles", r"C:\Program Files"), ("ProgramFiles(x86)", r"C:\Program Files (x86)")]
        .iter().map(|(k, d)| format!("{}/", norm_path(&env(k).filter(|v| !v.is_empty()).unwrap_or(d.to_string()), d, true))).collect()
}
/// Whether two folder paths are the same folder: by their real paths when they exist (links, and on Windows
/// without the `\\?\` that std's canonicalize adds), then as `norm_path` has them (case and separators on Windows).
pub fn same_dir(a: &str, b: &str) -> bool {
    let real = |p: &str| {
        #[cfg(windows)]
        let r = dunce::canonicalize(p);
        #[cfg(not(windows))]
        let r = std::fs::canonicalize(p);
        let p = r.map(|r| r.to_string_lossy().into_owned()).unwrap_or_else(|_| p.to_string());
        norm_path(&p, &p, cfg!(windows))
    };
    real(a) == real(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    // the link Relay makes for `.claude` is found again as one, and reads through to System/ (on Windows as a junction)
    #[test]
    fn dir_link_is_made_and_recognised() {
        let v = std::env::temp_dir().join(format!("relay-dir-link-{}", std::process::id()));
        std::fs::create_dir_all(v.join("System")).unwrap();
        std::fs::write(v.join("System/CLAUDE.md"), "x").unwrap();
        let at = v.join(".claude");
        assert!(!dir_link_ok(&at));
        dir_link("System", &at).unwrap();
        assert!(dir_link_ok(&at));
        assert!(std::fs::symlink_metadata(&at).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read_to_string(at.join("CLAUDE.md")).unwrap(), "x");
        std::fs::remove_dir_all(&v).unwrap();
    }

    // every way Windows writes a path is one path, the Mac's stay as they were
    #[test]
    fn paths_are_normalized_per_platform() {
        let w = |p: &str| norm_path(p, r"C:\Users\me\Team", true);
        for p in [r"C:\Users\me\vault", "c:/users/ME/Vault/", r"C:\Users\me/vault\.", r"C:\Users\me\x\..\vault", r"\\?\C:\Users\me\vault", r"\Users\me\vault", r"..\vault", r"C:\..\..\Users\me\vault"] {
            assert_eq!(w(p), "c:/users/me/vault", "{p}");
        }
        assert_eq!(w(r"\\Server\Share\a\..\b"), "//server/share/b");
        assert_eq!(w(r"\\?\UNC\server\share\b"), "//server/share/b");
        assert_eq!(norm_path(r"\x", r"\\server\share\team", true), "//server/share/x");
        assert_eq!((w("C:"), w(r"D:\"), w("a.md")), ("c:".into(), "d:".into(), "c:/users/me/team/a.md".into()));
        assert_eq!(norm_path("x", "relative", true), "c:/x", "no endless loop on a relative base");
        assert_eq!(norm_path("/me/Vault/../a/", "/", false), "/me/a");
        assert_eq!(norm_path("b", "/me/Vault", false), "/me/Vault/b", "case kept on macOS");
        assert!(is_abs(r"C:\a", true) && is_abs("c:/a", true) && is_abs(r"\\s\x", true) && is_abs(r"\a", true));
        assert!(!is_abs("/c", true) && !is_abs("a", true) && !is_abs(r"C:\a", false) && is_abs("/a", false));
        assert!(is_abs("/users/me", true) && is_abs("/", true) && is_abs("/a.md", true) && !is_abs("/all", true) && !is_abs("/o:n", true) && !is_abs("/?", true));
        assert_eq!((w(r"\\.\C:\a"), w(r"\\.\UNC\s\x\a"), w(r"\\.\pipe\x"), w(r"C:\a.\b \c. .")), ("c:/a".into(), "//s/x/a".into(), "//./pipe/x".into(), "c:/a/b/c".into()));
        for m in ["//./pipe/x", "//?/globalroot/device/x", "//localhost/c$/users", "//pc1/d$", "c:/users/me/vault~1/x"] { assert!(murky(m), "{m}"); }
        for m in ["c:/users/me/vault", "//server/share/x", "//server/c$$/x", "c:/a~b/x"] { assert!(!murky(m), "{m}"); }
    }
    #[test]
    fn home_and_variables_are_written_out() {
        let env = |k: &str| (k == "APPDATA").then(|| r"C:\Users\me\AppData\Roaming".to_string());
        let w = |t: &str| expand_home(t, r"C:\Users\me", true, env);
        for (t, out) in [("~", r"C:\Users\me"), (r"~\a", r"C:\Users\me\a"), ("~/a", r"C:\Users\me/a"), (r"$HOME\a", r"C:\Users\me\a"), (r"$home\a", r"C:\Users\me\a"),
                         (r"${HOME}\a", r"C:\Users\me\a"), (r"$env:USERPROFILE\a", r"C:\Users\me\a"), (r"${env:UserProfile}\a", r"C:\Users\me\a"),
                         (r"%USERPROFILE%\a", r"C:\Users\me\a"), (r"$env:APPDATA\relay", r"C:\Users\me\AppData\Roaming\relay"), (r"%appdata%\relay", r"C:\Users\me\AppData\Roaming\relay"),
                         (r"$env:NOPE\a", r"$env:NOPE\a"), ("$homework", "$homework"), ("a~", "a~")] {
            assert_eq!(w(t), out, "{t}");
        }
        let m = |t: &str| expand_home(t, "/me", false, |_| Some("x".into()));
        assert_eq!((m("~/a"), m("$HOME/a"), m("${HOME}/a"), m("$home/a"), m("%USERPROFILE%")), ("/me/a".into(), "/me/a".into(), "/me/a".into(), "$home/a".into(), "%USERPROFILE%".into()));
        assert_eq!(system_dirs(true, |_| None), ["c:/windows/", "c:/program files/", "c:/program files (x86)/"]);
        assert_eq!(system_dirs(false, |_| None)[0], "/bin/");
    }
    // a workspace folder is found however the folder is written: a link to it, a trailing `/`, `..` (macOS: a
    // symlink, and a case that differs is another folder there)
    #[cfg(unix)]
    #[test]
    fn same_dir_by_real_path() {
        let v = std::env::temp_dir().join(format!("relay-same-dir-{}", std::process::id()));
        std::fs::create_dir_all(v.join("Team/sub")).unwrap();
        let (team, link) = (v.join("Team"), v.join("link"));
        symlink(&team, &link).unwrap();
        let t = team.to_string_lossy().into_owned();
        for other in [format!("{t}/"), format!("{t}/sub/.."), link.to_string_lossy().into_owned()] { assert!(same_dir(&t, &other), "{other}"); }
        assert!(!same_dir(&t, &v.join("Team/sub").to_string_lossy()));
        assert!(same_dir("/no/such/x/", "/no/such/x") && !same_dir("/no/such/x", "/no/such/X"));
        std::fs::remove_dir_all(&v).unwrap();
    }
}
