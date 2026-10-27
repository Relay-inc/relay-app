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

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn peer_pid(_fd: i32) -> Option<u32> { None }
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn parent(_pid: u32) -> Option<u32> { None }

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::fd::AsRawFd;
    #[test]
    fn the_peer_of_a_socket_and_its_parents() {
        let (a, _b) = std::os::unix::net::UnixStream::pair().unwrap();
        // both ends are this process: the peer is us, and our parent is the test runner's
        assert_eq!(peer_pid(a.as_raw_fd()), Some(std::process::id()));
        let p = parent(std::process::id()).unwrap();
        assert!(p > 0 && p != std::process::id());
        assert!(parent(u32::MAX).is_none(), "a pid that is not there");
    }
}
