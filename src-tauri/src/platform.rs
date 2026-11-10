//! The few file calls that are Unix only: modes and symlinks. On macOS the std ones, on Windows a stand-in so the app
//! builds there.

use std::io;
use std::path::Path;

/// `OpenOptions::mode`, ignored on Windows.
#[cfg(unix)]
pub use std::os::unix::fs::OpenOptionsExt;
// ponytail: a private file on Windows only has the default ACL of the user's profile, W2 restricts key files
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
