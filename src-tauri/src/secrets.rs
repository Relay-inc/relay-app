//! Secrets in the store of the OS, as generic passwords under a service and an account. Tests use a map in memory
//! instead, so they never touch the real keychain.
//!
//! macOS: the login keychain through `/usr/bin/security`, as before. Every entry the app saved was made by that tool,
//! so the keychain trusts it, and reading those entries from the app itself (the keyring crate, Security.framework)
//! shows an approval dialog per entry that asks for the login password. Keeping the tool keeps that from happening.
//! Windows: Credential Manager through the keyring crate, the entry under the target name `<account>.<service>`.
//! The service and account names are the same on both. A value never goes to a process argument.

#[cfg(all(target_os = "macos", not(test)))]
use std::process::{Command, Stdio};

/// The secret, or None when there is none (or the store refused it).
pub fn get(service: &str, account: &str) -> Option<String> {
    #[cfg(test)]
    return mem::MEM.lock().unwrap().get(&(service.into(), account.into())).cloned();
    #[cfg(all(target_os = "macos", not(test)))]
    {
        let o = Command::new("/usr/bin/security").args(["find-generic-password", "-s", service, "-a", account, "-w"]).stderr(Stdio::null()).output().ok()?;
        let v = String::from_utf8_lossy(&o.stdout).trim_end_matches(['\r', '\n']).to_string();
        (o.status.success() && !v.is_empty()).then_some(v)
    }
    #[cfg(all(not(target_os = "macos"), not(test)))]
    keyring::Entry::new(service, account).and_then(|e| e.get_password()).ok().filter(|v| !v.is_empty())
}

/// Save the secret, replacing what was there.
pub fn set(service: &str, account: &str, value: &str) -> Result<(), String> {
    if [service, account].iter().any(|s| s.is_empty() || s.chars().any(char::is_control)) { return Err("invalid keychain entry name".into()); }
    #[cfg(test)]
    { mem::MEM.lock().unwrap().insert((service.into(), account.into()), value.into()); Ok(()) }
    #[cfg(all(target_os = "macos", not(test)))]
    {
        use std::io::Write;
        // `security -i` reads one command line from stdin: the names quoted, the value as hex (-X), so nothing in
        // them can end the line or reach a process argument
        let line = add_line(service, account, value);
        let mut ch = Command::new("/usr/bin/security").arg("-i").stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
        writeln!(ch.stdin.take().unwrap(), "{line}").map_err(|e| e.to_string())?;
        ch.wait().map_err(|e| e.to_string())?;
        // `security -i` exits 0 even when the command inside failed, so read it back
        if get(service, account).as_deref() == Some(value) { Ok(()) } else { Err("the keychain did not keep the secret".into()) }
    }
    #[cfg(all(not(target_os = "macos"), not(test)))]
    keyring::Entry::new(service, account).and_then(|e| e.set_password(value)).map_err(|e| e.to_string())
}

/// Remove the secret. One that is not there is no error.
pub fn delete(service: &str, account: &str) -> Result<(), String> {
    #[cfg(test)]
    { mem::MEM.lock().unwrap().remove(&(service.into(), account.into())); Ok(()) }
    #[cfg(all(target_os = "macos", not(test)))]
    { Command::new("/usr/bin/security").args(["delete-generic-password", "-s", service, "-a", account]).output().map(drop).map_err(|e| e.to_string()) }
    #[cfg(all(not(target_os = "macos"), not(test)))]
    match keyring::Entry::new(service, account).and_then(|e| e.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// The `security -i` command that saves a secret.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn add_line(service: &str, account: &str, value: &str) -> String {
    let q = |s: &str| format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""));
    let hex: String = value.bytes().map(|b| format!("{b:02x}")).collect();
    format!("add-generic-password -U -s {} -a {} -X {hex}", q(service), q(account))
}

#[cfg(test)]
mod mem {
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex};
    pub static MEM: LazyLock<Mutex<HashMap<(String, String), String>>> = LazyLock::new(Default::default);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_get_delete() {
        assert_eq!(get("relay-test", "a"), None);
        set("relay-test", "a", "one").unwrap();
        set("relay-test", "a", "two").unwrap();
        assert_eq!(get("relay-test", "a").as_deref(), Some("two"));
        assert_eq!(get("relay-test", "b"), None);
        delete("relay-test", "a").unwrap();
        delete("relay-test", "a").unwrap();
        assert_eq!(get("relay-test", "a"), None);
        assert!(set("relay-test", "a\nb", "x").is_err());
    }

    #[test]
    fn the_security_line_quotes_names_and_hexes_the_value() {
        assert_eq!(add_line("vault-app.x", "my \"acct\"", "a b\n"), "add-generic-password -U -s \"vault-app.x\" -a \"my \\\"acct\\\"\" -X 6120620a");
    }

    #[test]
    fn provider_secret_round_trip() {
        // keychain_set validates, saves, and removes on an empty value
        crate::providers::keychain_set("relay-test-p", "token", "abc 123").unwrap();
        assert_eq!(crate::providers::keychain_get("relay-test-p", "token").as_deref(), Some("abc 123"));
        assert!(crate::providers::keychain_set("relay-test-p", "token", "tab\there").is_err());
        crate::providers::keychain_set("relay-test-p", "token", "").unwrap();
        assert_eq!(crate::providers::keychain_get("relay-test-p", "token"), None);
    }
}
