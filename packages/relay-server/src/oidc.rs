//! Logging in to a team server with the organisation's provider (team.rs, docs/workspaces.md, Teams): the device brings
//! an OIDC ID token it got in the browser, and this server checks it: the signature against the issuer's published
//! keys (JWKS, found through its discovery document), `iss`, `aud` (the client id), `exp`, the `nonce` (bound to both
//! certificates, relay_remote::team::sso_nonce), `email_verified`, and the email's domain. The token is never kept:
//! the verified email names the account the device logs in to.
//!
//! RS256 only, the algorithm Google and Microsoft Entra ID sign ID tokens with. The issuer is the entry's, so another
//! OIDC provider is the same check. Entra ID (an issuer of one tenant, relay_remote::team::entra_tenant) differs in what names the
//! person: `tid` must be that tenant, `oid` is who signed in, and there is no verified email to check a domain on.

use base64::Engine;
use relay_remote::team::{self, Sso};
use serde_json::Value;
use std::collections::BTreeMap;
use std::process::{Command, Stdio};
use std::sync::Mutex;

/// Google's issuer. Google's ID tokens carry it with or without the scheme.
pub const GOOGLE: &str = "https://accounts.google.com";
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

/// What a valid ID token says about who signed in: the address (Entra: its sign-in name), the name, and for Entra the
/// user's object id in the tenant (`oid`, empty for any other issuer).
#[derive(Debug, Clone, PartialEq)]
pub struct Signed { pub email: String, pub name: String, pub oid: String }

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
    let Some(key) = jwks["keys"].as_array().into_iter().flatten().find(|k| k["kty"] == "RSA" && k["kid"].as_str() == Some(kid) && k["use"].as_str().is_none_or(|u| u == "sig")
        // Entra's keys name the issuer they sign for: a key of another one is not this issuer's
        && k["issuer"].as_str().is_none_or(|i| i == sso.issuer)) else { return Err(UNKNOWN_KEY.into()) };
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
    let name: String = str_("name").trim().chars().filter(|c| !c.is_control()).take(100).collect();
    // Entra ID: the tenant. Its keys sign for every tenant, so a good signature says nothing of which one: `tid` must be
    // the entry's, as `iss` already is (Microsoft: "Always check that the tid in a token matches the tenant ID").
    if let Some(tenant) = team::entra_tenant(&sso.issuer) {
        if str_("tid") != tenant { return bad("the account is not one of the organisation's Microsoft Entra tenant"); }
        // who signed in is `oid`, immutable in the tenant. `email` is optional and "isn't guaranteed to be correct", so
        // no domain is checked on it: what shows is `preferred_username`, which Microsoft calls fit for display only.
        let oid = str_("oid").to_lowercase();
        if !team::guid(&oid) { return bad("the ID token names no user (oid)"); }
        let email = str_("preferred_username").trim().to_lowercase().chars().filter(|c| !c.is_control()).take(254).collect();
        return Ok(Signed { email, name, oid });
    }
    // a boolean, or the string some providers send
    if body["email_verified"] != true && body["email_verified"] != "true" { return bad("the email address is not verified"); }
    let email = str_("email").to_lowercase();
    let domain = email.rsplit_once('@').map(|(_, d)| d.to_string()).unwrap_or_default();
    if domain.is_empty() || !sso.domains.contains(&domain) { return bad("this email address is not in a domain the organisation allows"); }
    // Google: an account of the organisation's own Google Workspace carries `hd`, its domain. Without it the address is a
    // personal Google account under that domain's email, which Google's docs say not to trust for a domain.
    if (sso.issuer == GOOGLE || !body["hd"].is_null()) && str_("hd").to_lowercase() != domain { return bad("this account is not one of the organisation's Google Workspace"); }
    Ok(Signed { email, name, oid: String::new() })
}

/// Per issuer: when a fetch was last tried, when its keys last came, and those keys (null while none came).
static KEYS: Mutex<BTreeMap<String, (u64, u64, Value)>> = Mutex::new(BTreeMap::new());
/// The longest keys are used while the issuer cannot be reached: after that a join fails closed.
const STALE_SECS: u64 = 2 * KEYS_SECS;
/// The issuer's keys: from its discovery document's `jwks_uri`, kept `KEYS_SECS`. `fresh`: fetched again (a token named
/// a key not among them). Whatever the outcome, at most one try a `REFETCH_SECS` per issuer: a joiner can never make
/// this server fetch more often than that.
fn jwks(issuer: &str, fresh: bool) -> Result<Value, String> {
    let now = crate::now();
    // the keys from before, while they are not too old to use
    let usable = |got: u64, k: &Value| (!k.is_null() && now.saturating_sub(got) < STALE_SECS).then(|| k.clone());
    let had = {
        let mut keys = KEYS.lock().unwrap_or_else(|e| e.into_inner());
        let had = keys.get(issuer).cloned();
        if let Some((tried, got, k)) = &had {
            if now.saturating_sub(*tried) < REFETCH_SECS || (!fresh && !k.is_null() && now.saturating_sub(*got) < KEYS_SECS) {
                return usable(*got, k).ok_or_else(|| UNREACHABLE.into());
            }
        }
        let (got, k) = had.as_ref().map_or((0, Value::Null), |h| (h.1, h.2.clone()));
        keys.insert(issuer.into(), (now, got, k));
        had
    };
    let fetched = (|| {
        let conf = get(&team::discovery(issuer))?;
        // the discovery document must name the issuer it was fetched for (OIDC Discovery 4.3)
        if conf["issuer"] != issuer { return Err("its discovery document names another issuer".to_string()); }
        get(conf["jwks_uri"].as_str().filter(|u| u.starts_with("https://")).ok_or("it publishes no keys over https")?)
    })();
    match fetched {
        Ok(k) => { KEYS.lock().unwrap_or_else(|e| e.into_inner()).insert(issuer.into(), (now, now, k.clone())); Ok(k) }
        // logged here, never told to the joiner
        Err(e) => { eprintln!("relay-server: SSO: the keys of {issuer}: {e}"); had.and_then(|h| usable(h.1, &h.2)).ok_or_else(|| UNREACHABLE.into()) }
    }
}
const UNREACHABLE: &str = "SSO: this server cannot reach the sign-in provider's keys now: try again later";
/// One GET with curl (no HTTP client in this binary, as github.rs), https only, its JSON answer.
fn get(url: &str) -> Result<Value, String> {
    let out = Command::new("curl").args(["-fsS", "-m", "10", "--proto", "=https", "-H", "Accept: application/json", "--url", url]).stdin(Stdio::null()).output().map_err(|e| format!("curl: {e}"))?;
    if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).trim().to_string()); }
    serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())
}

/// A login's ID token `token` from device `device`, with the `salt` its nonce was made with, checked against `sso`:
/// who signed in.
pub fn check(sso: &Sso, server: &str, device: &str, token: &str, salt: &str) -> Result<Signed, String> {
    if token.is_empty() { return Err("SSO: no ID token".into()); }
    if !crate::vaults::hex(salt, 64) { return Err("SSO: bad salt".into()); }
    let nonce = team::sso_nonce(server, device, salt);
    match verify(token, &jwks(&sso.issuer, false)?, sso, &nonce, crate::now()) {
        Err(e) if e == UNKNOWN_KEY => verify(token, &jwks(&sso.issuer, true)?, sso, &nonce, crate::now()),
        r => r,
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use ring::signature::RsaKeyPair;
    use serde_json::json;

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
        pub(crate) fn publish(&self) { KEYS.lock().unwrap().insert(self.issuer.clone(), (crate::now(), crate::now(), self.jwks())); }
    }
    pub(crate) const CLIENT: &str = "123-abc.apps.googleusercontent.com";
    pub(crate) fn sso(issuer: &str) -> Sso { Sso { issuer: issuer.into(), client: CLIENT.into(), domains: vec!["example.com".into()] } }

    #[test]
    fn an_id_token_checks_only_when_every_claim_does() {
        let (idp, now, n) = (Idp::new(GOOGLE), 1_800_000_000, "n".repeat(64));
        let (jwks, s) = (idp.jwks(), sso(GOOGLE));
        let check = |t: String| verify(&t, &jwks, &s, &n, now);
        let ok = check(idp.token("Ann@Example.com", &n, now, |_| {})).unwrap();
        assert_eq!(ok, Signed { email: "ann@example.com".into(), name: "Ann Example".into(), oid: String::new() });
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
        let s2 = sso("https://idp.example");
        let t2 = idp2.token("ann@example.com", &n, now, |c| { c.as_object_mut().unwrap().remove("hd"); });
        assert!(verify(&t2, &idp2.jwks(), &s2, &n, now).is_ok());
    }

    /// An Entra ID tenant's issuer, and a token as Entra's v2.0 endpoint gives one for `tenant`: `tid`, `oid` and
    /// `preferred_username`, no `email_verified` and no `hd`.
    const TENANT: &str = "11111111-2222-3333-4444-555555555555";
    fn entra(tenant: &str) -> String { format!("https://login.microsoftonline.com/{tenant}/v2.0") }
    fn entra_claims(c: &mut Value, tenant: &str) {
        let o = c.as_object_mut().unwrap();
        for k in ["email", "email_verified", "hd"] { o.remove(k); }
        o.insert("iss".into(), json!(entra(tenant)));
        o.insert("tid".into(), json!(tenant));
        o.insert("oid".into(), json!("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
        o.insert("preferred_username".into(), json!("Ann@Example.com"));
        o.insert("ver".into(), json!("2.0"));
    }

    #[test]
    fn an_entra_token_checks_only_for_the_organisations_tenant() {
        let (idp, now, n) = (Idp::new(&entra(TENANT)), 1_800_000_000, "n".repeat(64));
        let s = Sso { issuer: idp.issuer.clone(), client: CLIENT.into(), domains: vec![] };
        let (jwks, check) = (idp.jwks(), |t: String| verify(&t, &idp.jwks(), &s, &n, now));
        // the tenant's discovery document, under the tenant's issuer
        assert_eq!(team::discovery(&s.issuer), format!("https://login.microsoftonline.com/{TENANT}/v2.0/.well-known/openid-configuration"));
        // no email at all: `oid` names who signed in, `preferred_username` shows
        let ok = check(idp.token("", &n, now, |c| entra_claims(c, TENANT))).unwrap();
        assert_eq!(ok, Signed { email: "ann@example.com".into(), name: "Ann Example".into(), oid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".into() });
        // an `email` that is not verified or not in any domain changes nothing: it is not read
        assert!(check(idp.token("", &n, now, |c| { entra_claims(c, TENANT); c["email"] = json!("ann@evil.example"); })).is_ok());
        let refused = |edit: &dyn Fn(&mut Value), why: &str| {
            let e = check(idp.token("", &n, now, |c| { entra_claims(c, TENANT); edit(c) })).expect_err(why);
            assert!(e.contains(why), "{why}: {e}");
        };
        // another tenant, with a good signature: Entra's keys sign for every tenant
        const OTHER: &str = "99999999-8888-7777-6666-555555555555";
        refused(&|c| c["tid"] = json!(OTHER), "Entra tenant");
        refused(&|c| { c.as_object_mut().unwrap().remove("tid"); }, "Entra tenant");
        refused(&|c| { c["tid"] = json!(OTHER); c["iss"] = json!(entra(OTHER)); }, "another issuer");
        // personal Microsoft accounts are a tenant too
        refused(&|c| c["tid"] = json!("9188040d-6c67-4c5b-b112-36a304b66dad"), "Entra tenant");
        refused(&|c| { c.as_object_mut().unwrap().remove("oid"); }, "names no user");
        refused(&|c| c["oid"] = json!("ann"), "names no user");
        refused(&|c| { c.as_object_mut().unwrap().remove("nonce"); }, "not asked for this device");
        refused(&|c| c["aud"] = json!("another-client"), "another client");
        // a key Entra publishes for another issuer is not this one's
        let mut other = jwks.clone();
        other["keys"][0]["issuer"] = json!(entra(OTHER));
        assert_eq!(verify(&idp.token("", &n, now, |c| entra_claims(c, TENANT)), &other, &s, &n, now).unwrap_err(), UNKNOWN_KEY);
        let mut same = jwks.clone();
        same["keys"][0]["issuer"] = json!(entra(TENANT));
        assert!(verify(&idp.token("", &n, now, |c| entra_claims(c, TENANT)), &same, &s, &n, now).is_ok());
    }

    #[test]
    fn a_login_takes_a_token_asked_for_this_device_and_this_server() {
        const SERVER: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
        let (me, salt) = ("b".repeat(64), "5".repeat(64));
        let idp = Idp::new("https://idp.test");
        idp.publish();
        let s = sso(&idp.issuer);
        let token = idp.token("Ann@Example.com", &team::sso_nonce(SERVER, &me, &salt), crate::now(), |_| {});
        assert_eq!(check(&s, SERVER, &me, &token, &salt).unwrap().email, "ann@example.com");
        assert!(check(&s, SERVER, &"e".repeat(64), &token, &salt).unwrap_err().contains("not asked for this device"));
        assert!(check(&s, &"d".repeat(64), &me, &token, &salt).unwrap_err().contains("not asked for this device"));
        assert!(check(&s, SERVER, &me, &token, "x").unwrap_err().contains("bad salt"));
        assert!(check(&s, SERVER, &me, "", &salt).is_err());
    }

    #[test]
    fn keys_too_old_to_use_fail_closed_and_a_fetch_is_tried_once_a_minute() {
        let (issuer, now) = ("https://stale.invalid", crate::now());
        let k = json!({"keys": []});
        // fetched long ago and tried just now (the issuer down): not used any more
        KEYS.lock().unwrap().insert(issuer.into(), (now, now - STALE_SECS - 1, k.clone()));
        assert_eq!(jwks(issuer, false).unwrap_err(), UNREACHABLE);
        // fetched a while ago, tried just now: still used, without a fetch
        KEYS.lock().unwrap().insert(issuer.into(), (now, now - KEYS_SECS - 1, k.clone()));
        assert_eq!(jwks(issuer, true).unwrap(), k);
    }
}
