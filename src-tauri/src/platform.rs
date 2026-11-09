//! The few file calls that are Unix only: modes and symlinks. On macOS the std ones, on Windows a stand-in so the app
//! builds there.

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

/// A symlink at `at` to `to` (a folder in a vault: `.claude -> System`).
pub fn symlink(to: impl AsRef<Path>, at: impl AsRef<Path>) -> io::Result<()> {
    #[cfg(unix)]
    { std::os::unix::fs::symlink(to, at) }
    // ponytail: no symlinks on Windows without Developer Mode or admin rights. W4 makes `.claude` a directory junction
    #[cfg(not(unix))]
    { let _ = (to, at); Err(io::Error::new(io::ErrorKind::Unsupported, "symlinks are not supported on Windows yet")) }
}
