//! Which process is at the other end of a local socket, and a process's parent: an app tells which of its agents a
//! request on its socket comes from by walking up from the caller. A variable the caller sets proves nothing, any
//! process of the user can read another one's environment.

/// The process that connected to this Unix socket.
#[cfg(target_os = "macos")]
pub fn peer_pid(fd: i32) -> Option<u32> {
    let (mut pid, mut len): (libc::pid_t, libc::socklen_t) = (0, std::mem::size_of::<libc::pid_t>() as libc::socklen_t);
    let r = unsafe { libc::getsockopt(fd, libc::SOL_LOCAL, libc::LOCAL_PEERPID, &mut pid as *mut _ as *mut libc::c_void, &mut len) };
    (r == 0 && pid > 0).then_some(pid as u32)
}
/// A process's parent, None for one that is gone.
#[cfg(target_os = "macos")]
pub fn parent(pid: u32) -> Option<u32> {
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
    let r = unsafe { libc::proc_pidinfo(pid as libc::c_int, libc::PROC_PIDTBSDINFO, 0, &mut info as *mut _ as *mut libc::c_void, size) };
    (r == size && info.pbi_ppid > 0).then_some(info.pbi_ppid)
}

#[cfg(target_os = "linux")]
pub fn peer_pid(fd: i32) -> Option<u32> {
    let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let r = unsafe { libc::getsockopt(fd, libc::SOL_SOCKET, libc::SO_PEERCRED, &mut cred as *mut _ as *mut libc::c_void, &mut len) };
    (r == 0 && cred.pid > 0).then_some(cred.pid as u32)
}
#[cfg(target_os = "linux")]
pub fn parent(pid: u32) -> Option<u32> {
    // the fourth field of /proc/<pid>/stat, after the command in parentheses (which may hold spaces)
    let s = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    s[s.rfind(')')? + 1..].split_whitespace().nth(1)?.parse().ok().filter(|p| *p > 0)
}

/// The process that opened this named pipe (the server's end), as the system recorded it at connect time.
#[cfg(windows)]
pub fn peer_pid(pipe: std::os::windows::io::RawHandle) -> Option<u32> {
    let mut pid = 0u32;
    let r = unsafe { windows_sys::Win32::System::Pipes::GetNamedPipeClientProcessId(pipe, &mut pid) };
    (r != 0 && pid > 0).then_some(pid)
}
/// A process's parent, None for one that is gone or that this user may not inspect. Windows keeps the parent's pid
/// but not the parent: once it exits its pid can go to another process, so a parent started after its child is
/// not taken for it.
#[cfg(windows)]
pub fn parent(pid: u32) -> Option<u32> {
    use windows_sys::Win32::Foundation::{CloseHandle, FALSE, FILETIME, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snap == INVALID_HANDLE_VALUE { return None; }
    let mut e: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut ppid = None;
    let mut more = unsafe { Process32FirstW(snap, &mut e) } != FALSE;
    while more {
        if e.th32ProcessID == pid { ppid = Some(e.th32ParentProcessID); break; }
        more = unsafe { Process32NextW(snap, &mut e) } != FALSE;
    }
    unsafe { CloseHandle(snap) };
    let started = |pid: u32| -> Option<u64> {
        let h = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid) };
        if h.is_null() { return None; }
        let (mut c, mut x, mut k, mut u): (FILETIME, FILETIME, FILETIME, FILETIME) = unsafe { std::mem::zeroed() };
        let ok = unsafe { GetProcessTimes(h, &mut c, &mut x, &mut k, &mut u) } != FALSE;
        unsafe { CloseHandle(h) };
        ok.then_some((c.dwHighDateTime as u64) << 32 | c.dwLowDateTime as u64)
    };
    let ppid = ppid?;
    real_parent(ppid, started(ppid), started(pid))
}
/// `ppid` when it can be the parent: both start times known, the parent's not after the child's.
#[cfg(any(windows, test))]
fn real_parent(ppid: u32, parent_started: Option<u64>, child_started: Option<u64>) -> Option<u32> {
    (ppid > 0 && parent_started? <= child_started?).then_some(ppid)
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
pub fn peer_pid(_fd: i32) -> Option<u32> { None }
#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
pub fn parent(_pid: u32) -> Option<u32> { None }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_parent_started_after_its_child_is_another_process() {
        assert_eq!(real_parent(7, Some(10), Some(20)), Some(7));
        assert_eq!(real_parent(7, Some(20), Some(20)), Some(7));
        assert_eq!(real_parent(7, Some(30), Some(20)), None, "the pid went to a newer process");
        assert_eq!(real_parent(7, None, Some(20)), None, "a parent we may not inspect");
        assert_eq!(real_parent(7, Some(10), None), None);
        assert_eq!(real_parent(0, Some(10), Some(20)), None);
    }
    #[cfg(unix)]
    #[test]
    fn the_peer_of_a_socket_and_its_parents() {
        use std::os::fd::AsRawFd;
        let (a, _b) = std::os::unix::net::UnixStream::pair().unwrap();
        // both ends are this process: the peer is us, and our parent is the test runner's
        assert_eq!(peer_pid(a.as_raw_fd()), Some(std::process::id()));
        let p = parent(std::process::id()).unwrap();
        assert!(p > 0 && p != std::process::id());
        assert!(parent(u32::MAX).is_none(), "a pid that is not there");
    }
}
