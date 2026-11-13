//! A team server (docs/workspaces.md, Teams): what the server and the app share. The link that names a team server
//! (with an invite for one device in it, or without for a sign-in with the organisation's provider), the provider
//! setting, and the nonce that binds an ID token to one device and one server.

use crate::proto;
use crate::sync::sha256_hex;

/// The sign-in provider a team server takes: an https OIDC issuer and the app registration's client id. Google needs
/// the email domains it allows (its tokens carry any verified address). Microsoft Entra ID is one tenant, by its issuer
/// `ENTRA/<tenant id>/v2.0`, and takes no domains: the tenant is the organisation.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Sso { pub issuer: String, pub client: String, #[serde(default)] pub domains: Vec<String> }
impl Sso {
    /// Whether a server would take these fields, and what a device checks a server's word against before it opens a
    /// browser on it.
    pub fn valid(&self) -> bool {
        let plain = |s: &str, n: usize| !s.is_empty() && s.len() <= n && s.bytes().all(|b| b.is_ascii_graphic());
        let domain = |d: &str| d.len() <= 253 && d.contains('.') && d.split('.').all(|p| !p.is_empty() && !p.starts_with('-') && !p.ends_with('-') && p.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'));
        let domains = if self.issuer.starts_with(ENTRA) { entra_tenant(&self.issuer).is_some() && self.domains.is_empty() } else { (1..=MAX_DOMAINS).contains(&self.domains.len()) };
        plain(&self.issuer, 200) && self.issuer.starts_with("https://") && !self.issuer.ends_with('/') && !self.issuer.contains(['?', '#'])
            && plain(&self.client, 200) && domains && self.domains.iter().all(|d| domain(d))
            && self.domains.iter().enumerate().all(|(n, d)| !self.domains[..n].contains(d))
    }
}
/// Google's issuer.
pub const GOOGLE: &str = "https://accounts.google.com";
/// Microsoft Entra ID's sign-in host. A tenant's issuer is `ENTRA/<tenant id>/v2.0`.
pub const ENTRA: &str = "https://login.microsoftonline.com/";
/// The tenant of personal Microsoft accounts (Microsoft's ID token claims reference, `tid`).
const ENTRA_PERSONAL: &str = "9188040d-6c67-4c5b-b112-36a304b66dad";
/// The most email domains a Google setting allows.
pub const MAX_DOMAINS: usize = 20;
/// The tenant id of an Entra issuer: a lower-case GUID, as `tid` carries it. None for any other issuer, for Entra's
/// tenant-wide ones and for the tenant of personal accounts.
pub fn entra_tenant(issuer: &str) -> Option<&str> {
    let t = issuer.strip_prefix(ENTRA)?.strip_suffix("/v2.0")?;
    (guid(t) && t != ENTRA_PERSONAL).then_some(t)
}
/// An issuer's OIDC discovery document (OIDC Discovery 4).
pub fn discovery(issuer: &str) -> String { format!("{issuer}/.well-known/openid-configuration") }
/// A lower-case GUID, as Entra's `tid` and `oid` carry one.
pub fn guid(t: &str) -> bool { t.len() == 36 && t.char_indices().all(|(i, c)| if [8, 13, 18, 23].contains(&i) { c == '-' } else { c.is_ascii_digit() || ('a'..='f').contains(&c) }) }
/// The nonce a sign-in asks the provider to put in the ID token: bound to this server, this device and a salt the
/// device sends along, so a token is good for one login of one device only.
pub fn sso_nonce(server: &str, device: &str, salt: &str) -> String { sha256_hex(format!("relay-sso:{server}:{device}:{salt}").as_bytes()) }

/// A team server's link: `relay://host:port#team&fp=<server>`, and for one device's login `&invite=<id>&code=<secret>`.
#[derive(Clone, Debug, PartialEq)]
pub struct Link { pub host: String, pub port: u16, pub fp: String, pub invite: Option<(String, String)> }
impl Link {
    pub fn parse(s: &str) -> Option<Link> {
        let (addr, frag) = s.trim().strip_prefix("relay://")?.split_once('#')?;
        let (host, port) = addr.rsplit_once(':')?;
        let host = host.trim_start_matches('[').trim_end_matches(']');
        let hex = |v: &str, n: usize| v.len() == n && v.bytes().all(|c| c.is_ascii_hexdigit());
        let (mut team, mut fp, mut invite, mut code) = (false, None, None, None);
        for kv in frag.split('&') {
            match kv.split_once('=') {
                None if kv == "team" => team = true,
                Some(("fp", v)) if hex(v, 64) => fp = Some(v.to_lowercase()),
                Some(("invite", v)) if hex(v, 16) => invite = Some(v.to_lowercase()),
                Some(("code", v)) if hex(v, 64) => code = Some(v.to_lowercase()),
                _ => {}
            }
        }
        let ok_host = !host.is_empty() && host.len() <= 253 && host.chars().all(|c| c.is_ascii_alphanumeric() || ".-:".contains(c));
        (team && ok_host).then_some(())?;
        Some(Link { host: host.into(), port: port.parse().ok()?, fp: fp?, invite: invite.zip(code) })
    }
    pub fn format(&self) -> String {
        let host = if self.host.contains(':') { format!("[{}]", self.host) } else { self.host.clone() };
        let inv = self.invite.as_ref().map(|(i, c)| format!("&invite={i}&code={c}")).unwrap_or_default();
        format!("relay://{host}:{}#team&fp={}{inv}", self.port, self.fp)
    }
    /// "host:port" for a TCP connect.
    pub fn addr(&self) -> String { proto::addr(&self.host, self.port) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_link_reads_back_and_a_pairing_line_is_none() {
        let l = Link { host: "192.168.1.2".into(), port: 47800, fp: "a".repeat(64), invite: Some(("b".repeat(16), "c".repeat(64))) };
        assert_eq!(Link::parse(&l.format()), Some(l.clone()));
        let bare = Link { invite: None, ..l.clone() };
        assert_eq!(Link::parse(&bare.format()), Some(bare));
        assert!(Link::parse(&format!("relay://192.168.1.2:47800#fp={}&code={}", "a".repeat(64), "c".repeat(32))).is_none(), "a pairing line");
        assert!(Link::parse("relay://bad host:1#team&fp=00").is_none());
    }
    #[test]
    fn a_provider_setting_is_google_with_domains_or_one_entra_tenant() {
        let g = Sso { issuer: GOOGLE.into(), client: "c1".into(), domains: vec!["example.com".into()] };
        assert!(g.valid());
        assert!(!Sso { domains: vec![], ..g.clone() }.valid() && !Sso { issuer: "http://x.example".into(), ..g.clone() }.valid());
        let t = "11111111-2222-3333-4444-555555555555";
        let e = Sso { issuer: format!("{ENTRA}{t}/v2.0"), client: "c1".into(), domains: vec![] };
        assert!(e.valid() && entra_tenant(&e.issuer) == Some(t));
        assert!(!Sso { issuer: format!("{ENTRA}common/v2.0"), ..e.clone() }.valid() && !Sso { issuer: format!("{ENTRA}{ENTRA_PERSONAL}/v2.0"), ..e }.valid());
    }
}
