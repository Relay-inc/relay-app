//! SSO at a join (docs/workspaces.md, SSO): when the organisation list carries an `sso` entry, a device that joins a
//! workspace here brings an OIDC ID token it got in the browser, and this server checks it: the signature against the
//! issuer's published keys (JWKS, found through its discovery document), `iss`, `aud` (the client id), `exp`, the
//! `nonce` (bound to both certificates, relay_remote::org::sso_nonce), `email_verified`, and the email's domain. The
//! token is never kept: only the verified email and name go on the joiner's record, for the admin who adds it.
//!
//! RS256 only, the algorithm Google signs ID tokens with. The issuer is the entry's, so another OIDC provider is the
//! same check (Entra's tenant check comes on top, U5).

use base64::Engine;
use relay_remote::members::Sso;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;

/// Google's issuer. Google's ID tokens carry it with or without the scheme.
pub const GOOGLE: &str = "https://accounts.google.com";
/// What a join answers when the server requires SSO and the device brought no token.
pub const REQUIRED: &str = "this server requires signing in with SSO to join a workspace";
/// An ID token at most, in bytes.
const MAX_TOKEN: usize = 16 << 10;
/// Clock skew allowed on `exp` and `iat`, in seconds.
const SKEW: u64 = 60;
/// How long the issuer's keys are used before they are fetched again, and the least time between two fetches when a
/// token names a key not among them (the issuer rotated).
// ponytail: a fixed hour instead of the response's Cache-Control, which Google's docs advise; parse it if keys rotate faster
const KEYS_SECS: u64 = 3600;
const REFETCH_SECS: u64 = 60;
const UNKNOWN_KEY: &str = "the ID token is signed with a key the issuer does not publish";

/// What a valid ID token says about who signed in.
#[derive(Debug, Clone, PartialEq)]
pub struct Signed { pub email: String, pub name: String }

/// The ID token `token` checked against `jwks` (the issuer's keys) and the organisation's `sso`, for `nonce`, at `now`.
pub fn verify(token: &str, jwks: &Value, sso: &Sso, nonce: &str, now: u64) -> Result<Signed, String> {
    let bad = |why: &str| Err(format!("SSO: {why}"));
    if token.len() > MAX_TOKEN { return bad("the ID token is too long"); }
    let b64 = |s: &str| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(s).ok();
    let mut parts = token.split('.');
    let (Some(h), Some(p), Some(s), None) = (parts.next(), parts.next(), parts.next(), parts.next()) else { return bad("not an ID token") };
    let (Some(header), Some(body), Some(sig)) = (b64(h).and_then(|b| serde_json::from_slice::<Value>(&b).ok()), b64(p).and_then(|b| serde_json::from_slice::<Value>(&b).ok()), b64(s)) else { return bad("not an ID token") };
    if header["alg"] != "RS256" { return bad("the ID token is not signed with RS256"); }
    let kid = header["kid"].as_str().unwrap_or_default();
    let Some(key) = jwks["keys"].as_array().into_iter().flatten().find(|k| k["kty"] == "RSA" && k["kid"].as_str() == Some(kid) && k["use"].as_str().is_none_or(|u| u == "sig")) else { return Err(UNKNOWN_KEY.into()) };
    let (Some(n), Some(e)) = (key["n"].as_str().and_then(b64), key["e"].as_str().and_then(b64)) else { return bad("the issuer's key is not an RSA key") };
    let rsa = ring::signature::RsaPublicKeyComponents { n: &n, e: &e };
    if rsa.verify(&ring::signature::RSA_PKCS1_2048_8192_SHA256, format!("{h}.{p}").as_bytes(), &sig).is_err() { return bad("the ID token's signature does not check"); }
    let str_ = |k: &str| body[k].as_str().unwrap_or_default();
    let iss = str_("iss");
    if iss != sso.issuer && !(sso.issuer == GOOGLE && iss == "accounts.google.com") { return bad("the ID token is from another issuer"); }
    // `aud` a string, or a list with the client id and then `azp` that client (OIDC Core 3.1.3.7)
    let aud_ok = match &body["aud"] {
        Value::String(a) => *a == sso.client,
        Value::Array(a) => a.iter().any(|x| x == sso.client.as_str()) && (a.len() == 1 || str_("azp") == sso.client),
        _ => false,
    };
    if !aud_ok { return bad("the ID token is for another client"); }
    if body["exp"].as_u64().is_none_or(|exp| exp + SKEW <= now) { return bad("the ID token expired: sign in again"); }
    if body["iat"].as_u64().is_some_and(|iat| iat > now + SKEW) { return bad("the ID token is from the future"); }
    if nonce.is_empty() || str_("nonce") != nonce { return bad("the ID token was not asked for this device"); }
    // a boolean, or the string some providers send
    if body["email_verified"] != true && body["email_verified"] != "true" { return bad("the email address is not verified"); }
    let email = str_("email").to_lowercase();
    let domain = email.rsplit_once('@').map(|(_, d)| d.to_string()).unwrap_or_default();
    if domain.is_empty() || !sso.domains.contains(&domain) { return bad("this email address is not in a domain the organisation allows"); }
    // Google: an account of the organisation's own Google Workspace carries `hd`, its domain. Without it the address is a
    // personal Google account under that domain's email, which Google's docs say not to trust for a domain.
    if (sso.issuer == GOOGLE || !body["hd"].is_null()) && str_("hd").to_lowercase() != domain { return bad("this account is not one of the organisation's Google Workspace"); }
    let name: String = str_("name").trim().chars().filter(|c| !c.is_control()).take(relay_remote::members::MAX_PERSON_NAME).collect();
    Ok(Signed { email, name })
}

/// Per issuer: when its keys were fetched, and the keys.
static KEYS: Mutex<BTreeMap<String, (u64, Value)>> = Mutex::new(BTreeMap::new());
/// The issuer's keys: from its discovery document's `jwks_uri`, kept `KEYS_SECS`. `fresh`: fetched again (a token named
/// a key not among them), at most once a `REFETCH_SECS`.
fn jwks(issuer: &str, fresh: bool) -> Result<Value, String> {
    let now = crate::now();
    if let Some((at, k)) = KEYS.lock().unwrap_or_else(|e| e.into_inner()).get(issuer) {
        if now.saturating_sub(*at) < if fresh { REFETCH_SECS } else { KEYS_SECS } { return Ok(k.clone()); }
    }
    let conf = get(&format!("{issuer}/.well-known/openid-configuration"))?;
    // the discovery document must name the issuer it was fetched for (OIDC Discovery 4.3)
    if conf["issuer"] != issuer { return Err("SSO: the issuer's discovery document names another issuer".into()); }
    let uri = conf["jwks_uri"].as_str().filter(|u| u.starts_with("https://")).ok_or("SSO: the issuer publishes no keys over https")?;
    let k = get(uri)?;
    KEYS.lock().unwrap_or_else(|e| e.into_inner()).insert(issuer.into(), (now, k.clone()));
    Ok(k)
}
/// One GET with curl (no HTTP client in this binary, as github.rs), https only, its JSON answer.
fn get(url: &str) -> Result<Value, String> {
    let out = Command::new("curl").args(["-fsS", "-m", "10", "--proto", "=https", "-H", "Accept: application/json", url]).stdin(Stdio::null()).output().map_err(|e| format!("curl: {e}"))?;
    if !out.status.success() { return Err(format!("SSO: the issuer did not answer: {}", String::from_utf8_lossy(&out.stderr).trim())); }
    serde_json::from_slice(&out.stdout).map_err(|e| format!("SSO: {e}"))
}

/// The server's SSO for a device that wants to join (`sso_info`): what to sign in with, none when there is none.
pub fn info(data: &Path, server: &str) -> Value {
    json!({"sso": crate::org::list(data, server).and_then(|l| l.sso)})
}

/// A join's SSO, as the request `req` of `device` brings it: checked when the organisation list has SSO. None when it
/// has none, or when the device brought no token and SSO is not required.
pub fn gate(data: &Path, server: &str, device: &str, req: &Value) -> Result<Option<Signed>, String> {
    let Some(sso) = crate::org::list(data, server).and_then(|l| l.sso) else { return Ok(None) };
    let token = req["sso"]["id_token"].as_str().unwrap_or_default();
    if token.is_empty() { return if sso.required { Err(REQUIRED.into()) } else { Ok(None) }; }
    let salt = req["sso"]["salt"].as_str().unwrap_or_default();
    if !crate::vaults::hex(salt, 64) { return Err("SSO: bad salt".into()); }
    let nonce = relay_remote::org::sso_nonce(server, device, salt);
    match verify(token, &jwks(&sso.issuer, false)?, &sso, &nonce, crate::now()) {
        Err(e) if e == UNKNOWN_KEY => verify(token, &jwks(&sso.issuer, true)?, &sso, &nonce, crate::now()),
        r => r,
    }.map(Some)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use ring::signature::RsaKeyPair;

    /// A fake OIDC provider: an RSA key made for these tests only (`testdata/`), its JWKS, and tokens it signs.
    pub(crate) struct Idp { key: RsaKeyPair, pub issuer: String }
    pub(crate) fn b64(b: &[u8]) -> String { base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b) }
    impl Idp {
        pub(crate) fn new(issuer: &str) -> Idp { Idp { key: RsaKeyPair::from_pkcs8(include_bytes!("testdata/fake-oidc-provider.pk8")).unwrap(), issuer: issuer.into() } }
        pub(crate) fn jwks(&self) -> Value {
            let p = ring::signature::RsaPublicKeyComponents::<Vec<u8>>::from(self.key.public());
            json!({"keys": [{"kty": "RSA", "kid": "k1", "use": "sig", "alg": "RS256", "n": b64(&p.n), "e": b64(&p.e)}]})
        }
        pub(crate) fn sign(&self, header: Value, claims: Value) -> String {
            let msg = format!("{}.{}", b64(header.to_string().as_bytes()), b64(claims.to_string().as_bytes()));
            let mut sig = vec![0; self.key.public().modulus_len()];
            self.key.sign(&ring::signature::RSA_PKCS1_SHA256, &ring::rand::SystemRandom::new(), msg.as_bytes(), &mut sig).unwrap();
            format!("{msg}.{}", b64(&sig))
        }
        /// A valid token for `email` at `now`, with `nonce`; `edit` changes its claims first.
        pub(crate) fn token(&self, email: &str, nonce: &str, now: u64, edit: impl FnOnce(&mut Value)) -> String {
            let mut c = json!({"iss": self.issuer, "aud": CLIENT, "azp": CLIENT, "sub": "1234567890", "email": email, "email_verified": true,
                "hd": email.rsplit_once('@').map(|(_, d)| d).unwrap_or(""), "name": "Ann Example", "iat": now - 10, "exp": now + 3590, "nonce": nonce});
            edit(&mut c);
            self.sign(json!({"alg": "RS256", "kid": "k1", "typ": "JWT"}), c)
        }
        /// Its keys, as this server would have fetched them.
        pub(crate) fn publish(&self) { KEYS.lock().unwrap().insert(self.issuer.clone(), (crate::now(), self.jwks())); }
    }
    pub(crate) const CLIENT: &str = "123-abc.apps.googleusercontent.com";
    pub(crate) fn sso(issuer: &str, required: bool) -> Sso { Sso { issuer: issuer.into(), client: CLIENT.into(), domains: vec!["example.com".into()], required } }

    #[test]
    fn an_id_token_checks_only_when_every_claim_does() {
        let (idp, now, n) = (Idp::new(GOOGLE), 1_800_000_000, "n".repeat(64));
        let (jwks, s) = (idp.jwks(), sso(GOOGLE, true));
        let check = |t: String| verify(&t, &jwks, &s, &n, now);
        let ok = check(idp.token("Ann@Example.com", &n, now, |_| {})).unwrap();
        assert_eq!(ok, Signed { email: "ann@example.com".into(), name: "Ann Example".into() });
        // Google's issuer without the scheme too, and `aud` as a list
        assert!(check(idp.token("ann@example.com", &n, now, |c| c["iss"] = json!("accounts.google.com"))).is_ok());
        assert!(check(idp.token("ann@example.com", &n, now, |c| c["aud"] = json!([CLIENT]))).is_ok());
        let refused = |edit: &dyn Fn(&mut Value), why: &str| {
            let e = check(idp.token("ann@example.com", &n, now, edit)).expect_err(why);
            assert!(e.contains(why), "{why}: {e}");
        };
        refused(&|c| c["aud"] = json!("someone-else.apps.googleusercontent.com"), "another client");
        // several audiences: `azp` must be this client
        refused(&|c| { c["aud"] = json!([CLIENT, "other"]); c["azp"] = json!("other"); }, "another client");
        refused(&|c| c["iss"] = json!("https://evil.example"), "another issuer");
        refused(&|c| c["exp"] = json!(now - SKEW - 1), "expired");
        refused(&|c| { c.as_object_mut().unwrap().remove("exp"); }, "expired");
        refused(&|c| c["iat"] = json!(now + 3600), "future");
        refused(&|c| c["email"] = json!("ann@evil.example"), "domain");
        refused(&|c| c["email"] = json!("ann@sub.example.com"), "domain");
        refused(&|c| c["email_verified"] = json!(false), "not verified");
        refused(&|c| { c.as_object_mut().unwrap().remove("email_verified"); }, "not verified");
        refused(&|c| { c.as_object_mut().unwrap().remove("nonce"); }, "not asked for this device");
        refused(&|c| c["nonce"] = json!("m".repeat(64)), "not asked for this device");
        // a personal Google account with an address in the domain: no `hd`
        refused(&|c| { c.as_object_mut().unwrap().remove("hd"); }, "Google Workspace");
        refused(&|c| c["hd"] = json!("evil.example"), "Google Workspace");
        // the signature: another key, a changed claim, alg none, a key the issuer does not publish
        let other = json!({"keys": [{"kty": "RSA", "kid": "k1", "n": b64(&[0xc5; 256]), "e": b64(&[1, 0, 1])}]});
        assert!(verify(&idp.token("ann@example.com", &n, now, |_| {}), &other, &s, &n, now).unwrap_err().contains("signature"));
        let t = idp.token("ann@example.com", &n, now, |_| {});
        let mut parts: Vec<String> = t.split('.').map(String::from).collect();
        parts[1] = b64(json!({"iss": GOOGLE, "aud": CLIENT, "email": "eve@example.com", "email_verified": true, "hd": "example.com", "exp": now + 100, "nonce": n}).to_string().as_bytes());
        assert!(check(parts.join(".")).unwrap_err().contains("signature"));
        assert!(check(format!("{}.{}.", b64(br#"{"alg":"none"}"#), parts[1])).unwrap_err().contains("RS256"));
        assert_eq!(check(idp.sign(json!({"alg": "RS256", "kid": "k2"}), json!({}))).unwrap_err(), UNKNOWN_KEY);
        assert!(check("not.a.jwt.at-all".into()).unwrap_err().contains("not an ID token"));
        // another issuer than Google: `hd` only when the token carries one
        let idp2 = Idp::new("https://idp.example");
        let s2 = sso("https://idp.example", true);
        let t2 = idp2.token("ann@example.com", &n, now, |c| { c.as_object_mut().unwrap().remove("hd"); });
        assert!(verify(&t2, &idp2.jwks(), &s2, &n, now).is_ok());
    }

    #[test]
    fn a_join_needs_a_valid_token_where_the_organisation_requires_one() {
        use relay_remote::members::{org_name, sign, Entry};
        use relay_remote::tls::{hex, proof};
        use ring::signature::KeyPair;
        const SERVER: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
        let (admin, joiner) = ("a".repeat(64), "b".repeat(64));
        let d = std::env::temp_dir().join(format!("relay-oidc-gate-{}", std::process::id()));
        std::fs::remove_dir_all(&d).ok();
        std::fs::create_dir_all(&d).unwrap();
        crate::save_clients(&d, &[crate::Client { name: "laptop".into(), fp: admin.clone(), added: 1, parent: None, vaults_only: false }]).unwrap();
        // the organisation: its owner signs it, then SSO on (a fake issuer, whose keys this server has)
        let seed = [b'a'; 32];
        let id = hex(ring::signature::Ed25519KeyPair::from_seed_unchecked(&seed).unwrap().public_key().as_ref());
        let entry = |e: Entry| {
            let l = crate::org::list(&d, SERVER).unwrap_or_default();
            serde_json::to_value(sign(&org_name(SERVER), &l, &admin, &seed, e)).unwrap()
        };
        let no = json!({"op": "vault_join"});
        assert_eq!(gate(&d, SERVER, &joiner, &no).unwrap(), None, "no organisation, no SSO");
        crate::org::append(&d, SERVER, &admin, &entry(Entry { kind: "create".into(), fp: admin.clone(), id, pk: "1".repeat(64), role: "admin".into(), mac: relay_remote::sync::sha256_hex(org_name(SERVER).as_bytes()), ..Default::default() })).unwrap();
        let idp = Idp::new("https://idp.test");
        idp.publish();
        let on = |required: bool| { let s = sso(&idp.issuer, required); entry(Entry { kind: "sso".into(), issuer: s.issuer, client: s.client, domains: s.domains, required, ..Default::default() }) };
        crate::org::append(&d, SERVER, &admin, &on(true)).unwrap();
        assert_eq!(info(&d, SERVER)["sso"]["required"], true);
        // required: without a token, with one for another device (its nonce), or a bad salt
        assert_eq!(gate(&d, SERVER, &joiner, &no).unwrap_err(), REQUIRED);
        let salt = "5".repeat(64);
        let token = idp.token("ann@example.com", &relay_remote::org::sso_nonce(SERVER, &joiner, &salt), crate::now(), |_| {});
        let req = |t: &str, salt: &str| json!({"op": "vault_join", "sso": {"id_token": t, "salt": salt}});
        assert!(gate(&d, SERVER, &"e".repeat(64), &req(&token, &salt)).unwrap_err().contains("not asked for this device"));
        assert!(gate(&d, SERVER, &joiner, &req(&token, "x")).unwrap_err().contains("bad salt"));
        let signed = gate(&d, SERVER, &joiner, &req(&token, &salt)).unwrap().unwrap();
        assert_eq!(signed.email, "ann@example.com");
        // the join keeps what was verified on the joiner's record, never the token
        let v = crate::vaults::Vaults::new(&d, SERVER);
        let ws = v.create(&admin, "laptop", "Team").unwrap()["vault"]["id"].as_str().unwrap().to_string();
        let inv = v.invite(&admin, &ws, "member", &"ab".repeat(32), 0).unwrap();
        let (inv, code) = (inv["invite"]["id"].as_str().unwrap().to_string(), inv["invite"]["code"].as_str().unwrap().to_string());
        v.join(&joiner, &ws, &inv, "ann-mac", &proof(&code, &joiner, SERVER), Some(&signed)).unwrap();
        let m = v.info(&admin, &ws).unwrap()["vault"]["members"].as_array().unwrap().iter().find(|m| m["fp"] == joiner.as_str()).unwrap().clone();
        assert_eq!((m["sso"]["email"].as_str(), m["sso"]["name"].as_str()), (Some("ann@example.com"), Some("Ann Example")));
        assert!(!std::fs::read_to_string(d.join("vaults").join(&ws).join("vault.json")).unwrap().contains(&token[..40]), "no token on disk");
        // not required: a join without a token passes, one with a bad token does not
        crate::org::append(&d, SERVER, &admin, &on(false)).unwrap();
        assert_eq!(gate(&d, SERVER, &joiner, &no).unwrap(), None);
        assert!(gate(&d, SERVER, &joiner, &req(&idp.token("ann@evil.example", "x", crate::now(), |_| {}), &salt)).is_err());
        std::fs::remove_dir_all(&d).ok();
    }
}
