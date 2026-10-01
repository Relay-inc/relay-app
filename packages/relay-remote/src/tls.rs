// Relay's link to a work machine: mutual TLS 1.3 with self-signed certificates on both sides, each side pinning the
// other's by its SHA-256 fingerprint, like Syncthing. No CA and no hostnames: a device whose certificate is not known
// fails inside the handshake, before a single application byte is read. Pairing happens once: the client proves a
// one-time secret with an HMAC bound to both fingerprints, so a proof is worthless for any other pair of devices.
//
// Session resumption is off on both sides: a resumed session skips the certificate checks, so a device the server no
// longer allows could come back on an old ticket.

use ring::{digest, hmac, rand::SecureRandom};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{ring as provider, verify_tls12_signature, verify_tls13_signature, WebPkiSupportedAlgorithms};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime};
use rustls::server::danger::{ClientCertVerified, ClientCertVerifier};
use rustls::{CertificateError, ClientConfig, Connection, DigitallySignedStruct, DistinguishedName, OtherError, ServerConfig, SignatureScheme};
use std::fs;
use std::io::{self, Read, Write};
use std::net::{Shutdown, TcpStream, ToSocketAddrs};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

type Allow = Arc<dyn Fn(&str) -> bool + Send + Sync>;

/// A device's certificate and private key (DER, the key PKCS#8).
#[derive(Clone)]
pub struct Identity { pub cert_der: Vec<u8>, pub key_der: Vec<u8> }
impl Identity {
    /// Load `<dir>/<name>.crt.der` and `<dir>/<name>.key.der`, or create them: ECDSA P-256, self-signed, CN "relay",
    /// valid for a century (the pin is what is checked, never the dates).
    pub fn load_or_create(dir: &Path, name: &str) -> io::Result<Identity> {
        let (crt, key) = (dir.join(format!("{name}.crt.der")), dir.join(format!("{name}.key.der")));
        if crt.exists() && key.exists() { return Ok(Identity { cert_der: fs::read(&crt)?, key_der: fs::read(&key)? }); }
        let pair = rcgen::KeyPair::generate_for(&rcgen::PKCS_ECDSA_P256_SHA256).map_err(io::Error::other)?;
        let mut params = rcgen::CertificateParams::new(Vec::<String>::new()).map_err(io::Error::other)?;
        params.distinguished_name = rcgen::DistinguishedName::new();
        params.distinguished_name.push(rcgen::DnType::CommonName, "relay");
        (params.not_before, params.not_after) = (rcgen::date_time_ymd(2025, 1, 1), rcgen::date_time_ymd(2125, 1, 1));
        let cert = params.self_signed(&pair).map_err(io::Error::other)?;
        let id = Identity { cert_der: cert.der().to_vec(), key_der: pair.serialize_der() };
        fs::create_dir_all(dir)?;
        // the key first, private before its first byte (an older file keeps its mode through open, hence the chmod);
        // the certificate last, so a pair cut off halfway is made again
        let mut f = fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&key)?;
        f.set_permissions(fs::Permissions::from_mode(0o600))?;
        f.write_all(&id.key_der)?;
        fs::write(&crt, &id.cert_der)?;
        Ok(id)
    }
    pub fn fingerprint(&self) -> String { fingerprint(&self.cert_der) }
    fn chain(&self) -> (Vec<CertificateDer<'static>>, PrivateKeyDer<'static>) {
        (vec![CertificateDer::from(self.cert_der.clone())], PrivatePkcs8KeyDer::from(self.key_der.clone()).into())
    }
}

/// Lowercase hex SHA-256 of a DER certificate, 64 chars.
pub fn fingerprint(cert_der: &[u8]) -> String { hex(digest::digest(&digest::SHA256, cert_der).as_ref()) }
fn hex(b: &[u8]) -> String { b.iter().map(|x| format!("{x:02x}")).collect() }

// a bad_certificate alert to the peer, with our reason in the local error
fn refused(why: &str) -> rustls::Error { rustls::Error::InvalidCertificate(CertificateError::Other(OtherError(Arc::new(io::Error::other(why.to_string()))))) }
fn tls_err(e: rustls::Error) -> io::Error { io::Error::new(io::ErrorKind::InvalidData, e) }

/// The client's check of the server: its certificate must be the pinned one.
struct PinServer { fp: String, algs: WebPkiSupportedAlgorithms }
impl std::fmt::Debug for PinServer { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.debug_struct("PinServer").field("fp", &self.fp).finish() } }
impl ServerCertVerifier for PinServer {
    fn verify_server_cert(&self, end: &CertificateDer<'_>, _: &[CertificateDer<'_>], _: &ServerName<'_>, _: &[u8], _: UnixTime) -> Result<ServerCertVerified, rustls::Error> {
        if fingerprint(end).eq_ignore_ascii_case(&self.fp) { Ok(ServerCertVerified::assertion()) } else { Err(refused("server fingerprint does not match")) }
    }
    fn verify_tls12_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> { verify_tls12_signature(m, c, d, &self.algs) }
    fn verify_tls13_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> { verify_tls13_signature(m, c, d, &self.algs) }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> { self.algs.supported_schemes() }
}

/// The server's check of a client: a certificate is mandatory and `allow` decides on its fingerprint.
struct PinClient { allow: Allow, algs: WebPkiSupportedAlgorithms }
impl std::fmt::Debug for PinClient { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.debug_struct("PinClient").finish_non_exhaustive() } }
impl ClientCertVerifier for PinClient {
    fn offer_client_auth(&self) -> bool { true }
    fn client_auth_mandatory(&self) -> bool { true }
    fn root_hint_subjects(&self) -> &[DistinguishedName] { &[] }
    fn verify_client_cert(&self, end: &CertificateDer<'_>, _: &[CertificateDer<'_>], _: UnixTime) -> Result<ClientCertVerified, rustls::Error> {
        if (self.allow)(&fingerprint(end)) { Ok(ClientCertVerified::assertion()) } else { Err(refused("client not allowed")) }
    }
    fn verify_tls12_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> { verify_tls12_signature(m, c, d, &self.algs) }
    fn verify_tls13_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> { verify_tls13_signature(m, c, d, &self.algs) }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> { self.algs.supported_schemes() }
}

/// Client side: TCP connect to `addr` ("host:port") with `timeout` for the connect and for the handshake, mutual TLS
/// with `id` as client certificate, the server's certificate pinned to `server_fp` (any case).
pub fn connect(addr: &str, id: &Identity, server_fp: &str, timeout: Duration) -> io::Result<Duplex> {
    let p = Arc::new(provider::default_provider());
    let algs = p.signature_verification_algorithms;
    let (certs, key) = id.chain();
    let mut cfg = ClientConfig::builder_with_provider(p).with_protocol_versions(&[&rustls::version::TLS13]).map_err(tls_err)?
        .dangerous().with_custom_certificate_verifier(Arc::new(PinServer { fp: server_fp.to_string(), algs }))
        .with_client_auth_cert(certs, key).map_err(tls_err)?;
    cfg.resumption = rustls::client::Resumption::disabled();
    let mut last = io::Error::new(io::ErrorKind::InvalidInput, format!("{addr}: no address"));
    let tcp = addr.to_socket_addrs()?.find_map(|a| TcpStream::connect_timeout(&a, timeout).map_err(|e| last = e).ok()).ok_or(last)?;
    // the name is a placeholder rustls needs, the pin is what authenticates the server
    let conn = rustls::ClientConnection::new(Arc::new(cfg), ServerName::try_from("relay-server").expect("static name")).map_err(tls_err)?;
    establish(conn.into(), tcp, timeout)
}

/// Server side: one per listener.
pub struct Acceptor { id: Identity }
impl Acceptor {
    pub fn new(id: &Identity) -> Acceptor { Acceptor { id: id.clone() } }
    /// Handshake on an accepted connection within `timeout`. `allow(fp)` decides inside the handshake whether a client
    /// certificate with that fingerprint may connect; a refused or missing one fails the handshake. Returns the duplex
    /// and the client's fingerprint.
    pub fn accept(&self, tcp: TcpStream, timeout: Duration, allow: Allow) -> io::Result<(Duplex, String)> {
        // a config per connection, because `allow` is: building one is cheap next to the handshake
        let p = Arc::new(provider::default_provider());
        let algs = p.signature_verification_algorithms;
        let (certs, key) = self.id.chain();
        let mut cfg = ServerConfig::builder_with_provider(p).with_protocol_versions(&[&rustls::version::TLS13]).map_err(tls_err)?
            .with_client_cert_verifier(Arc::new(PinClient { allow, algs })).with_single_cert(certs, key).map_err(tls_err)?;
        cfg.send_tls13_tickets = 0;
        cfg.session_storage = Arc::new(rustls::server::NoServerSessionStorage {});
        let d = establish(rustls::ServerConnection::new(Arc::new(cfg)).map_err(tls_err)?.into(), tcp, timeout)?;
        let fp = d.peer_fp();
        Ok((d, fp))
    }
}

// The handshake, bounded by `timeout`; afterwards the socket has no timeouts, so a connection may idle for days.
fn establish(mut conn: Connection, tcp: TcpStream, timeout: Duration) -> io::Result<Duplex> {
    tcp.set_nodelay(true)?;
    tcp.set_read_timeout(Some(timeout))?;
    tcp.set_write_timeout(Some(timeout))?;
    let mut t = &tcp;
    while conn.is_handshaking() {
        conn.complete_io(&mut t).map_err(|e| match e.kind() {
            io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut => io::Error::new(io::ErrorKind::TimedOut, "TLS handshake timed out"),
            // our own refusal comes out as PermissionDenied with its plain reason
            _ => match e.get_ref().and_then(|i| i.downcast_ref::<rustls::Error>()) {
                Some(rustls::Error::InvalidCertificate(CertificateError::Other(OtherError(why)))) => io::Error::new(io::ErrorKind::PermissionDenied, why.to_string()),
                _ => e,
            },
        })?;
    }
    while conn.wants_write() { conn.write_tls(&mut t)?; }
    tcp.set_read_timeout(None)?;
    tcp.set_write_timeout(None)?;
    // a write is sealed whole; backpressure comes from the socket, not from rustls' buffer
    conn.set_buffer_limit(None);
    let peer_fp = conn.peer_certificates().and_then(|c| c.first()).map(|c| fingerprint(c)).ok_or_else(|| io::Error::other("peer sent no certificate"))?;
    let out = tcp.try_clone()?;
    Ok(Duplex { shared: Arc::new(Shared { conn: Mutex::new(conn), out: Mutex::new(out), closed: Default::default() }), tcp, peer_fp })
}

// The rustls state and the socket's write half. `conn` is only held for in-memory work, never across a blocking
// socket call. `out` is taken before `conn` and held while the sealed records go out, so records reach the socket in
// the order they were sealed.
// closed: shut down from this side, for a watcher that should stop with the stream
struct Shared { conn: Mutex<Connection>, out: Mutex<TcpStream>, closed: std::sync::atomic::AtomicBool }
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> { m.lock().unwrap_or_else(|e| e.into_inner()) }
impl Shared {
    fn send(&self, f: impl FnOnce(&mut Connection) -> io::Result<()>) -> io::Result<()> {
        let mut out = lock(&self.out);
        let mut tls = Vec::new();
        {
            let mut c = lock(&self.conn);
            f(&mut c)?;
            while c.wants_write() { c.write_tls(&mut tls)?; }
        }
        out.write_all(&tls)
    }
}

/// An established TLS connection, to `split` into a reader and a writer for two threads.
pub struct Duplex { shared: Arc<Shared>, tcp: TcpStream, peer_fp: String }
impl Duplex {
    pub fn split(self) -> (Reader, Writer) { (Reader { shared: self.shared.clone(), tcp: self.tcp, raw: Vec::new() }, Writer(self.shared)) }
    /// The peer's certificate fingerprint.
    pub fn peer_fp(&self) -> String { self.peer_fp.clone() }
}

/// The plaintext the peer sends. Blocks on the socket without holding any lock, so a writer on another thread goes on.
/// Ok(0) at the peer's close_notify or at TCP end of stream.
pub struct Reader { shared: Arc<Shared>, tcp: TcpStream, raw: Vec<u8> }
impl Read for Reader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() { return Ok(0); }
        loop {
            let (got, wants, stuck) = {
                let mut c = lock(&self.shared.conn);
                // feed what the socket gave as far as rustls takes it; it refuses while its plaintext buffer is full
                let mut stuck = None;
                while !self.raw.is_empty() {
                    let mut rest = &self.raw[..];
                    if let Err(e) = c.read_tls(&mut rest) { stuck = Some(e); break; }
                    let used = self.raw.len() - rest.len();
                    self.raw.drain(..used);
                    c.process_new_packets().map_err(tls_err)?;
                }
                (c.reader().read(buf), c.wants_write(), stuck)
            };
            // a key update or an alert to answer
            if wants { self.shared.send(|_| Ok(()))?; }
            match got {
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => {}
                r => return r,
            }
            if let Some(e) = stuck { return Err(e); }
            let mut chunk = [0u8; 16 << 10];
            let n = match self.tcp.read(&mut chunk) {
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                r => r?,
            };
            if n == 0 { return Ok(0); }
            self.raw.extend_from_slice(&chunk[..n]);
        }
    }
}

/// Plaintext to the peer, sealed and on the socket when `write` returns. Clones share the connection.
#[derive(Clone)]
pub struct Writer(Arc<Shared>);
impl Write for Writer {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> { self.0.send(|c| c.writer().write_all(buf))?; Ok(buf.len()) }
    fn flush(&mut self) -> io::Result<()> { Ok(()) }
}
impl Writer {
    /// Send close_notify and shut the TCP socket down both ways, so a reader blocked on the other half returns.
    pub fn shutdown(&self) {
        self.0.closed.store(true, std::sync::atomic::Ordering::SeqCst);
        self.0.send(|c| { c.send_close_notify(); Ok(()) }).ok();
        lock(&self.0.out).shutdown(Shutdown::Both).ok();
    }
    /// Whether `shutdown` ran on this connection.
    pub fn is_closed(&self) -> bool { self.0.closed.load(std::sync::atomic::Ordering::SeqCst) }
}

/// Pairing: hex HMAC-SHA256 over `client_fp` and `server_fp` (lowercased, joined by '\n') keyed with `secret`.
pub fn proof(secret: &str, client_fp: &str, server_fp: &str) -> String { hex(hmac::sign(&pair_key(secret), pair_msg(client_fp, server_fp).as_bytes()).as_ref()) }
/// Constant-time check of a proof.
pub fn verify_proof(secret: &str, client_fp: &str, server_fp: &str, proof_hex: &str) -> bool {
    let tag: Option<Vec<u8>> = (0..proof_hex.len()).step_by(2).map(|i| proof_hex.get(i..i + 2).and_then(|h| u8::from_str_radix(h, 16).ok())).collect();
    tag.is_some_and(|t| hmac::verify(&pair_key(secret), pair_msg(client_fp, server_fp).as_bytes(), &t).is_ok())
}
fn pair_key(secret: &str) -> hmac::Key { hmac::Key::new(hmac::HMAC_SHA256, secret.as_bytes()) }
fn pair_msg(client_fp: &str, server_fp: &str) -> String { format!("{}\n{}", client_fp.to_ascii_lowercase(), server_fp.to_ascii_lowercase()) }
/// A fresh pairing secret: 16 random bytes as 32 lowercase hex chars.
pub fn random_secret() -> String {
    let mut b = [0u8; 16];
    ring::rand::SystemRandom::new().fill(&mut b).expect("system randomness");
    hex(&b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::mpsc;
    use std::thread;

    const T: Duration = Duration::from_secs(5);

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> TempDir {
            let d = std::env::temp_dir().join(format!("relay-tls-{tag}-{}", std::process::id()));
            fs::remove_dir_all(&d).ok();
            TempDir(d)
        }
    }
    impl Drop for TempDir { fn drop(&mut self) { fs::remove_dir_all(&self.0).ok(); } }

    fn ids(tag: &str) -> (TempDir, Identity, Identity) {
        let d = TempDir::new(tag);
        let (s, c) = (Identity::load_or_create(&d.0, "server").unwrap(), Identity::load_or_create(&d.0, "client").unwrap());
        (d, s, c)
    }

    // a listener on a free port and a thread accepting one connection with `allow`
    fn serve(s: &Identity, allow: Allow) -> (String, thread::JoinHandle<io::Result<(Duplex, String)>>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap().to_string();
        let acc = Acceptor::new(s);
        (addr, thread::spawn(move || acc.accept(l.accept()?.0, T, allow)))
    }
    fn pair(tag: &str) -> (TempDir, Duplex, Duplex) {
        let (d, s, c) = ids(tag);
        let (addr, h) = serve(&s, Arc::new(|_| true));
        let cd = connect(&addr, &c, &s.fingerprint(), T).unwrap();
        let (sd, _) = h.join().unwrap().unwrap();
        (d, cd, sd)
    }

    #[test]
    fn tls_identity_persists() {
        let d = TempDir::new("id");
        let a = Identity::load_or_create(&d.0, "dev").unwrap();
        assert!(d.0.join("dev.crt.der").exists());
        assert_eq!(fs::metadata(d.0.join("dev.key.der")).unwrap().permissions().mode() & 0o777, 0o600);
        let b = Identity::load_or_create(&d.0, "dev").unwrap();
        assert_eq!(a.fingerprint(), b.fingerprint());
        assert_eq!(a.fingerprint().len(), 64);
        assert!(a.fingerprint().chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn tls_handshake_pins() {
        let (_d, s, c) = ids("ok");
        let (addr, h) = serve(&s, Arc::new(|_| true));
        // the pin compares in any case
        let cd = connect(&addr, &c, &s.fingerprint().to_uppercase(), T).unwrap();
        let (sd, fp) = h.join().unwrap().unwrap();
        assert_eq!(cd.peer_fp(), s.fingerprint());
        assert_eq!(sd.peer_fp(), c.fingerprint());
        assert_eq!(fp, c.fingerprint());
    }

    #[test]
    fn tls_wrong_server_pin() {
        let (_d, s, c) = ids("pin");
        let (addr, h) = serve(&s, Arc::new(|_| true));
        let e = connect(&addr, &c, &c.fingerprint(), T).err().expect("must fail");
        assert_eq!((e.kind(), e.to_string().as_str()), (io::ErrorKind::PermissionDenied, "server fingerprint does not match"));
        assert!(h.join().unwrap().is_err());
    }

    #[test]
    fn tls_client_not_allowed() {
        let (_d, s, c) = ids("deny");
        let cfp = c.fingerprint();
        let seen = Arc::new(Mutex::new(String::new()));
        let seen2 = seen.clone();
        let (addr, h) = serve(&s, Arc::new(move |fp| { *seen2.lock().unwrap() = fp.to_string(); false }));
        // TLS 1.3: the client may finish its side before the server checks it, then the first read fails
        let refused = match connect(&addr, &c, &s.fingerprint(), T) {
            Err(_) => true,
            Ok(d) => d.split().0.read(&mut [0u8; 16]).is_err(),
        };
        assert!(refused);
        let e = h.join().unwrap().err().expect("server must refuse");
        assert_eq!((e.kind(), e.to_string().as_str()), (io::ErrorKind::PermissionDenied, "client not allowed"));
        assert_eq!(*seen.lock().unwrap(), cfp);
    }

    #[test]
    fn tls_concurrent_both_ways() {
        let (_d, cd, sd) = pair("dup");
        const N: usize = 2000;
        fn line(side: &str, i: usize) -> String { format!("{side} {i:05} {}", "x".repeat(1000)) }
        fn run(d: Duplex, me: &'static str, peer: &'static str) -> usize {
            let (r, mut w) = d.split();
            let wt = thread::spawn(move || { for i in 0..N { writeln!(w, "{}", line(me, i)).unwrap(); } });
            let mut n = 0;
            for l in BufReader::new(r).lines().take(N) { assert_eq!(l.unwrap(), line(peer, n)); n += 1; }
            wt.join().unwrap();
            n
        }
        let a = thread::spawn(move || run(cd, "c", "s"));
        let b = thread::spawn(move || run(sd, "s", "c"));
        assert_eq!((a.join().unwrap(), b.join().unwrap()), (N, N));
    }

    #[test]
    fn tls_shutdown_wakes_readers() {
        let (_d, cd, sd) = pair("shut");
        let (mut cr, cw) = cd.split();
        let (mut sr, _sw) = sd.split();
        let (tx, rx) = mpsc::channel();
        let tx2 = tx.clone();
        thread::spawn(move || { tx.send(("local", cr.read(&mut [0u8; 64]).map_err(|e| e.to_string()))).ok(); });
        thread::spawn(move || { tx2.send(("peer", sr.read(&mut [0u8; 64]).map_err(|e| e.to_string()))).ok(); });
        thread::sleep(Duration::from_millis(100));
        cw.shutdown();
        let mut got = [rx.recv_timeout(T).unwrap(), rx.recv_timeout(T).unwrap()];
        got.sort_by_key(|g| g.0);
        assert_eq!(got[1], ("peer", Ok(0)));
        assert!(matches!(got[0], ("local", Ok(0) | Err(_))), "{:?}", got[0]);
    }

    #[test]
    fn tls_pairing_proof() {
        let (s, a, b) = (random_secret(), "AB".repeat(32), "cd".repeat(32));
        assert_eq!(s.len(), 32);
        assert!(s.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_ne!(s, random_secret());
        let p = proof(&s, &a, &b);
        assert!(verify_proof(&s, &a, &b, &p));
        assert!(verify_proof(&s, &a.to_lowercase(), &b, &p));
        assert!(!verify_proof(&random_secret(), &a, &b, &p));
        assert!(!verify_proof(&s, &b, &a, &p));
        assert!(!verify_proof(&s, &a, &b, &p[1..]));
        assert!(!verify_proof(&s, &a, &b, "zz"));
    }
}
