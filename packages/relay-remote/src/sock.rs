//! Local sockets: the broker's, a relay-server's and the `relay` CLI's. Unix sockets on macOS and Linux. On Windows a
//! stand-in with the same calls that all fail, so the rest builds there.
// ponytail: Windows has no local sockets in Relay yet, every conversation and `relay` call fails there. W3 puts named
// pipes behind these types, with the caller's pid for agent_core::peer

#[cfg(unix)]
pub use std::os::unix::net::{UnixListener, UnixStream};
#[cfg(not(unix))]
pub use stub::{UnixListener, UnixStream};

#[cfg(not(unix))]
mod stub {
    use std::io::{self, Read, Write};
    use std::net::Shutdown;
    use std::path::Path;
    use std::time::Duration;

    fn no<T>() -> io::Result<T> { Err(io::Error::new(io::ErrorKind::Unsupported, "local sockets are not supported on Windows yet")) }

    #[derive(Debug)]
    pub struct UnixStream(());
    impl UnixStream {
        pub fn connect<P: AsRef<Path>>(_: P) -> io::Result<UnixStream> { no() }
        pub fn pair() -> io::Result<(UnixStream, UnixStream)> { no() }
        pub fn try_clone(&self) -> io::Result<UnixStream> { no() }
        pub fn set_read_timeout(&self, _: Option<Duration>) -> io::Result<()> { no() }
        pub fn set_write_timeout(&self, _: Option<Duration>) -> io::Result<()> { no() }
        pub fn set_nonblocking(&self, _: bool) -> io::Result<()> { no() }
        pub fn shutdown(&self, _: Shutdown) -> io::Result<()> { no() }
    }
    impl Read for UnixStream { fn read(&mut self, _: &mut [u8]) -> io::Result<usize> { no() } }
    impl Write for UnixStream { fn write(&mut self, _: &[u8]) -> io::Result<usize> { no() } fn flush(&mut self) -> io::Result<()> { no() } }
    impl Read for &UnixStream { fn read(&mut self, _: &mut [u8]) -> io::Result<usize> { no() } }
    impl Write for &UnixStream { fn write(&mut self, _: &[u8]) -> io::Result<usize> { no() } fn flush(&mut self) -> io::Result<()> { no() } }

    #[derive(Debug)]
    pub struct UnixListener(());
    impl UnixListener {
        pub fn bind<P: AsRef<Path>>(_: P) -> io::Result<UnixListener> { no() }
        pub fn accept(&self) -> io::Result<(UnixStream, ())> { no() }
        pub fn incoming(&self) -> std::iter::Empty<io::Result<UnixStream>> { std::iter::empty() }
    }
}
