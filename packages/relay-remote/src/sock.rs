//! Local sockets: the broker's, a relay-server's and the `relay` CLI's. Unix sockets on macOS and Linux, named pipes
//! with the same calls on Windows.
//!
//! On Windows the socket's path stays the address: `bind` creates a pipe `\\.\pipe\relay-<pid>-<n>` and writes its
//! name into the file at the path, `connect` reads it there. Removing the file closes the address for new
//! connections as unlinking a Unix socket does, and a new listener on the same path gets a pipe of its own, so a
//! broker winding down never answers for the one that replaced it. The pipe is open to this user only (its DACL)
//! and to this computer only (remote clients are refused).

#[cfg(unix)]
pub use std::os::unix::net::{UnixListener, UnixStream};
#[cfg(windows)]
pub use pipe::{UnixListener, UnixStream};

/// Every pipe Relay makes starts with this.
#[cfg(any(windows, test))]
const PREFIX: &str = r"\\.\pipe\relay-";
/// The pipe of the `n`th listener of process `pid`.
#[cfg(any(windows, test))]
fn pipe_name(pid: u32, n: u64) -> String { format!("{PREFIX}{pid}-{n:x}") }
/// The pipe name in an address file, None when it is not one of Relay's pipes on this computer. A name the file could
/// otherwise hold, `\\server\pipe\x`, would send the user's credentials to another machine.
#[cfg(any(windows, test))]
fn addr(file: &str) -> Option<&str> {
    let name = file.trim();
    let rest = name.strip_prefix(PREFIX)?;
    (!rest.is_empty() && rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')).then_some(name)
}
/// A DACL that allows `sid` (the user's) everything and nobody else anything, not even the read access Everyone gets
/// on a pipe by default.
#[cfg(any(windows, test))]
fn sddl(sid: &str) -> String { format!("D:P(A;;GA;;;{sid})") }

#[cfg(windows)]
mod pipe {
    use std::ffi::OsStr;
    use std::io::{self, Read, Write};
    use std::net::Shutdown;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering::Relaxed};
    use std::sync::{Arc, Mutex, OnceLock};
    use std::time::Duration;
    use windows_sys::Win32::Foundation::{GetLastError, LocalFree, ERROR_BROKEN_PIPE, ERROR_IO_PENDING, ERROR_OPERATION_ABORTED,
        ERROR_PIPE_BUSY, ERROR_PIPE_CONNECTED, ERROR_PIPE_NOT_CONNECTED, FALSE, GENERIC_READ, GENERIC_WRITE, HANDLE,
        INVALID_HANDLE_VALUE, TRUE, WAIT_TIMEOUT};
    use windows_sys::Win32::Security::Authorization::{ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1};
    use windows_sys::Win32::Security::{GetTokenInformation, TokenUser, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER};
    use windows_sys::Win32::Storage::FileSystem::{CreateFileW, ReadFile, WriteFile, FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OVERLAPPED,
        OPEN_EXISTING, PIPE_ACCESS_DUPLEX, SECURITY_IDENTIFICATION, SECURITY_SQOS_PRESENT};
    use windows_sys::Win32::System::Pipes::{ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, WaitNamedPipeW, PIPE_READMODE_BYTE,
        PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT};
    use windows_sys::Win32::System::Threading::{CreateEventW, GetCurrentProcess, OpenProcessToken, WaitForSingleObject, INFINITE};
    use windows_sys::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};

    fn wide(s: &str) -> Vec<u16> { OsStr::new(s).encode_wide().chain(Some(0)).collect() }
    fn err(code: u32) -> io::Error { io::Error::from_raw_os_error(code as i32) }
    fn last() -> io::Error { io::Error::last_os_error() }

    /// One overlapped operation on `h`, waited for at most `ms` (INFINITE for no limit). After a timeout the operation
    /// is cancelled and waited for, so `ov` never goes while the system may still write to it.
    fn wait_io(h: HANDLE, ms: u32, start: impl FnOnce(*mut OVERLAPPED) -> i32) -> io::Result<usize> {
        let ev = unsafe { CreateEventW(std::ptr::null(), TRUE, FALSE, std::ptr::null()) };
        if ev.is_null() { return Err(last()); }
        let ev = unsafe { OwnedHandle::from_raw_handle(ev) };
        let mut ov: OVERLAPPED = unsafe { std::mem::zeroed() };
        ov.hEvent = ev.as_raw_handle();
        if start(&mut ov) == FALSE {
            let e = unsafe { GetLastError() };
            if e != ERROR_IO_PENDING { return Err(err(e)); }
            if unsafe { WaitForSingleObject(ov.hEvent, ms) } == WAIT_TIMEOUT { unsafe { CancelIoEx(h, &ov) }; }
        }
        let mut n = 0u32;
        if unsafe { GetOverlappedResult(h, &ov, &mut n, TRUE) } == FALSE { return Err(last()); }
        Ok(n as usize)
    }

    // timeouts in milliseconds, 0 for none, shared by the clones of one stream, as a socket's options are
    #[derive(Default)]
    struct Opts { read: AtomicU32, write: AtomicU32, nonblocking: AtomicBool }
    impl std::fmt::Debug for Opts { fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result { f.write_str("Opts") } }
    fn ms(d: Option<Duration>) -> io::Result<u32> {
        match d {
            None => Ok(0),
            Some(d) if d.is_zero() => Err(io::Error::new(io::ErrorKind::InvalidInput, "cannot set a 0 duration timeout")),
            Some(d) => Ok(d.as_millis().clamp(1, (INFINITE - 1) as u128) as u32),
        }
    }

    /// One end of a pipe: the listener's (`server`) or the one that connected.
    #[derive(Debug)]
    pub struct UnixStream { h: OwnedHandle, server: bool, opts: Arc<Opts> }

    impl UnixStream {
        pub fn connect<P: AsRef<Path>>(path: P) -> io::Result<UnixStream> {
            let file = std::fs::read_to_string(path)?;
            let name = wide(super::addr(&file).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "not a Relay pipe"))?);
            // every instance busy: only in the instant between a connection and the listener's next instance
            for _ in 0..50 {
                // identification only: the listener may learn who connects, never act as them
                let h = unsafe { CreateFileW(name.as_ptr(), GENERIC_READ | GENERIC_WRITE, 0, std::ptr::null(), OPEN_EXISTING,
                    FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, std::ptr::null_mut()) };
                if h != INVALID_HANDLE_VALUE { return Ok(UnixStream::of(h, false)); }
                let e = unsafe { GetLastError() };
                if e != ERROR_PIPE_BUSY { return Err(err(e)); }
                unsafe { WaitNamedPipeW(name.as_ptr(), 100) };
            }
            Err(io::Error::new(io::ErrorKind::TimedOut, "every instance of the pipe is busy"))
        }
        fn of(h: HANDLE, server: bool) -> UnixStream { UnixStream { h: unsafe { OwnedHandle::from_raw_handle(h) }, server, opts: Default::default() } }
        pub fn try_clone(&self) -> io::Result<UnixStream> { Ok(UnixStream { h: self.h.try_clone()?, server: self.server, opts: self.opts.clone() }) }
        pub fn set_read_timeout(&self, d: Option<Duration>) -> io::Result<()> { self.opts.read.store(ms(d)?, Relaxed); Ok(()) }
        pub fn set_write_timeout(&self, d: Option<Duration>) -> io::Result<()> { self.opts.write.store(ms(d)?, Relaxed); Ok(()) }
        pub fn set_nonblocking(&self, on: bool) -> io::Result<()> { self.opts.nonblocking.store(on, Relaxed); Ok(()) }
        /// The listener's end drops the connection: reads and writes on both ends fail from here on. The other end
        /// has no such call (Relay never makes it), it closes its handle instead.
        pub fn shutdown(&self, _: Shutdown) -> io::Result<()> {
            if self.server && unsafe { DisconnectNamedPipe(self.h.as_raw_handle()) } == FALSE { return Err(last()); }
            Ok(())
        }
        fn limit(&self, t: &AtomicU32) -> u32 {
            if self.opts.nonblocking.load(Relaxed) { return 0; }
            match t.load(Relaxed) { 0 => INFINITE, ms => ms }
        }
        fn timed_out(&self, e: io::Error) -> io::Error {
            if e.raw_os_error() != Some(ERROR_OPERATION_ABORTED as i32) { return e; }
            if self.opts.nonblocking.load(Relaxed) { io::ErrorKind::WouldBlock.into() } else { io::ErrorKind::TimedOut.into() }
        }
        fn read_pipe(&self, buf: &mut [u8]) -> io::Result<usize> {
            let h = self.h.as_raw_handle();
            let len = buf.len().min(u32::MAX as usize) as u32;
            match wait_io(h, self.limit(&self.opts.read), |ov| unsafe { ReadFile(h, buf.as_mut_ptr(), len, std::ptr::null_mut(), ov) }) {
                // the other end closed or was dropped: end of file, as on a socket
                Err(e) if [ERROR_BROKEN_PIPE, ERROR_PIPE_NOT_CONNECTED].map(|c| Some(c as i32)).contains(&e.raw_os_error()) => Ok(0),
                r => r.map_err(|e| self.timed_out(e)),
            }
        }
        fn write_pipe(&self, buf: &[u8]) -> io::Result<usize> {
            let h = self.h.as_raw_handle();
            let len = buf.len().min(u32::MAX as usize) as u32;
            wait_io(h, self.limit(&self.opts.write), |ov| unsafe { WriteFile(h, buf.as_ptr(), len, std::ptr::null_mut(), ov) })
                .map_err(|e| self.timed_out(e))
        }
    }
    impl AsRawHandle for UnixStream { fn as_raw_handle(&self) -> RawHandle { self.h.as_raw_handle() } }
    impl Read for UnixStream { fn read(&mut self, b: &mut [u8]) -> io::Result<usize> { self.read_pipe(b) } }
    impl Write for UnixStream { fn write(&mut self, b: &[u8]) -> io::Result<usize> { self.write_pipe(b) } fn flush(&mut self) -> io::Result<()> { Ok(()) } }
    impl Read for &UnixStream { fn read(&mut self, b: &mut [u8]) -> io::Result<usize> { self.read_pipe(b) } }
    impl Write for &UnixStream { fn write(&mut self, b: &[u8]) -> io::Result<usize> { self.write_pipe(b) } fn flush(&mut self) -> io::Result<()> { Ok(()) } }

    /// The user this process runs as, as a SID string.
    fn user_sid() -> io::Result<String> {
        let mut tok = std::ptr::null_mut();
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut tok) } == FALSE { return Err(last()); }
        let tok = unsafe { OwnedHandle::from_raw_handle(tok) };
        let mut buf = vec![0u64; 64]; // u64: aligned for TOKEN_USER
        let mut len = 0u32;
        if unsafe { GetTokenInformation(tok.as_raw_handle(), TokenUser, buf.as_mut_ptr().cast(), (buf.len() * 8) as u32, &mut len) } == FALSE { return Err(last()); }
        let user = unsafe { &*(buf.as_ptr() as *const TOKEN_USER) };
        let mut s = std::ptr::null_mut();
        if unsafe { ConvertSidToStringSidW(user.User.Sid, &mut s) } == FALSE { return Err(last()); }
        let n = (0..).take_while(|&i| unsafe { *s.add(i) } != 0).count();
        let sid = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(s, n) });
        unsafe { LocalFree(s.cast()) };
        Ok(sid)
    }

    /// A new instance of the pipe `name`: the first one (refused when the name is taken) or another.
    fn instance(name: &[u16], first: bool) -> io::Result<OwnedHandle> {
        static SDDL: OnceLock<Result<Vec<u16>, i32>> = OnceLock::new();
        let sddl = SDDL.get_or_init(|| user_sid().map(|s| wide(&super::sddl(&s))).map_err(|e| e.raw_os_error().unwrap_or(0)))
            .as_ref().map_err(|&e| io::Error::from_raw_os_error(e))?;
        let mut sd: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
        if unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), SDDL_REVISION_1, &mut sd, std::ptr::null_mut()) } == FALSE { return Err(last()); }
        let sa = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: sd, bInheritHandle: FALSE };
        let open = PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | if first { FILE_FLAG_FIRST_PIPE_INSTANCE } else { 0 };
        let h = unsafe { CreateNamedPipeW(name.as_ptr(), open, PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            PIPE_UNLIMITED_INSTANCES, 64 << 10, 64 << 10, 0, &sa) };
        let e = last();
        unsafe { LocalFree(sd) };
        if h == INVALID_HANDLE_VALUE { return Err(e); }
        Ok(unsafe { OwnedHandle::from_raw_handle(h) })
    }

    /// A named pipe behind a path. One free instance waits while it lives, so a client never finds the name gone
    /// between two connections.
    #[derive(Debug)]
    pub struct UnixListener { name: Vec<u16>, next: Mutex<Option<OwnedHandle>> }
    impl UnixListener {
        pub fn bind<P: AsRef<Path>>(path: P) -> io::Result<UnixListener> {
            static N: AtomicU64 = AtomicU64::new(0);
            let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos() as u64) ^ N.fetch_add(1, Relaxed);
            let name = super::pipe_name(std::process::id(), n);
            let w = wide(&name);
            let first = instance(&w, true)?;
            // a path in use is refused, as bind refuses an existing socket file
            std::fs::OpenOptions::new().write(true).create_new(true).open(path)?.write_all(name.as_bytes())?;
            Ok(UnixListener { name: w, next: Mutex::new(Some(first)) })
        }
        pub fn accept(&self) -> io::Result<(UnixStream, ())> {
            let h = match self.next.lock().unwrap().take() { Some(h) => h, None => instance(&self.name, false)? };
            let raw = h.as_raw_handle();
            let r = match wait_io(raw, INFINITE, |ov| unsafe { ConnectNamedPipe(raw, ov) }) {
                Err(e) if e.raw_os_error() == Some(ERROR_PIPE_CONNECTED as i32) => Ok(0), // connected before we asked
                r => r,
            };
            // the next instance before this one is handed out
            *self.next.lock().unwrap() = instance(&self.name, false).ok();
            r?;
            Ok((UnixStream { h, server: true, opts: Default::default() }, ()))
        }
        pub fn incoming(&self) -> impl Iterator<Item = io::Result<UnixStream>> + '_ { std::iter::from_fn(move || Some(self.accept().map(|(s, _)| s))) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_pipe_name_is_relays_and_local() {
        let n = pipe_name(4242, 0xdead_beef);
        assert_eq!(n, r"\\.\pipe\relay-4242-deadbeef");
        assert_eq!(addr(&format!("{n}\n")), Some(n.as_str()), "read back from its file");
        assert_ne!(pipe_name(4242, 1), pipe_name(4242, 2));
        for bad in ["", r"\\.\pipe\relay-", r"\\server\pipe\relay-1-2", r"\\.\pipe\other-1", r"\\.\pipe\relay-1\..\x", r"\\.\pipe\relay-1 2", "C:\\x"] {
            assert_eq!(addr(bad), None, "{bad}");
        }
    }
    #[test]
    fn only_the_user_gets_in() {
        assert_eq!(sddl("S-1-5-21-1-2-3-1001"), "D:P(A;;GA;;;S-1-5-21-1-2-3-1001)");
    }
}
