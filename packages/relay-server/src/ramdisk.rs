//! A RAM disk for the mirror's working copy on a Mac (`serve --ram-disk`), what a tmpfs is on Linux: macOS has none,
//! so the plaintext would land on the SSD and in Time Machine. hdiutil makes a disk out of memory, newfs_hfs formats
//! it and diskutil mounts it `nobrowse` on the working copy's folder, so Finder and the desktop never show it. No root
//! needed. A stop (SIGTERM from launchctl, Ctrl-C) ejects it, and the plaintext with it.

use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};

/// 1 GiB in 512-byte sectors, a cap: the working copy of a vault is a few dozen MB.
const SECTORS: u64 = 2 * 1024 * 1024;

fn run(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// The device of the RAM disk mounted on `dir`, if one is: `mount` names the device on that folder, `hdiutil info`
/// says whether that device is a `ram://` image.
pub fn device_at(dir: &Path) -> Option<String> {
    let dir = dir.canonicalize().ok()?;
    let mounts = run("mount", &[])?;
    let dev = mounts.lines().find_map(|l| {
        let (dev, rest) = l.split_once(" on ")?;
        let (path, _) = rest.rsplit_once(" (")?;
        (Path::new(path) == dir).then(|| dev.to_string())
    })?;
    // `hdiutil info`: per image an `image-path : …` line, then its devices, one per line
    let mut ram = false;
    for l in run("hdiutil", &["info"])?.lines() {
        if l.starts_with("image-path") { ram = l.contains("ram://"); }
        if ram && l.split_whitespace().next() == Some(dev.as_str()) { return Some(dev); }
    }
    None
}

/// A RAM disk on `dir`: the one a previous run left there (it crashed, its agents may still work in it), else a new
/// one. A plain folder there is a working copy from a run without a RAM disk: deleted first, its files are sealed in
/// the store. Returns the device.
pub fn mount(dir: &Path) -> Result<String, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    if let Some(dev) = device_at(dir) { return Ok(dev); }
    fs::remove_dir_all(dir).and_then(|_| fs::create_dir_all(dir)).map_err(|e| e.to_string())?;
    let dev = run("hdiutil", &["attach", "-nomount", &format!("ram://{SECTORS}")]).map(|s| s.trim().to_string())
        .filter(|d| d.starts_with("/dev/")).ok_or("hdiutil could not make a RAM disk")?;
    let path = dir.to_string_lossy();
    let ok = run("newfs_hfs", &["-v", "Relay work", &dev]).is_some()
        && run("diskutil", &["mount", "-mountOptions", "nobrowse", "-mountPoint", &path, &dev]).is_some();
    if !ok { eject(&dev); return Err(format!("could not mount a RAM disk on {path}")); }
    Ok(dev)
}

pub fn eject(dev: &str) { run("hdiutil", &["detach", "-force", dev]); }

/// Eject `dev` when the process is told to stop (SIGTERM, SIGINT, SIGHUP), then exit. Call before any thread starts:
/// the signals are blocked here and every thread inherits that, so only the waiting thread takes them. Children get
/// a clean mask from std's spawn.
pub fn eject_on_stop(dev: String) {
    // SAFETY: plain libc calls on a sigset_t that lives on this stack and is copied into the thread
    unsafe {
        let mut set: libc::sigset_t = std::mem::zeroed();
        libc::sigemptyset(&mut set);
        for s in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP] { libc::sigaddset(&mut set, s); }
        libc::pthread_sigmask(libc::SIG_BLOCK, &set, std::ptr::null_mut());
        std::thread::spawn(move || {
            let mut sig = 0;
            libc::sigwait(&set, &mut sig);
            eprintln!("relay-server: stopping, ejecting the RAM disk");
            eject(&dev);
            std::process::exit(0);
        });
    }
}
