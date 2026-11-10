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
}
