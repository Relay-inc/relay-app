//! Secrets in the store of the OS: the login keychain on macOS, the Credential Manager on Windows, through the
//! keyring crate. A secret is a generic password under a service and an account, the same names `/usr/bin/security`
//! used before, without a prefix, so what an earlier version saved reads as it is. On Windows the entry shows in
//! Credential Manager › Windows Credentials as `<account>.<service>`. The value never goes to a process argument.
//! Tests use a map in memory instead, so they never touch the real keychain.

/// The secret, or None when there is none (or the store refused it).
pub fn get(service: &str, account: &str) -> Option<String> {
    #[cfg(test)]
    return mem::MEM.lock().unwrap().get(&(service.into(), account.into())).cloned();
    #[cfg(not(test))]
    keyring::Entry::new(service, account).and_then(|e| e.get_password()).ok().filter(|v| !v.is_empty())
}

/// Save the secret, replacing what was there.
pub fn set(service: &str, account: &str, value: &str) -> Result<(), String> {
    #[cfg(test)]
    { mem::MEM.lock().unwrap().insert((service.into(), account.into()), value.into()); Ok(()) }
    #[cfg(not(test))]
    keyring::Entry::new(service, account).and_then(|e| e.set_password(value)).map_err(|e| e.to_string())
}

/// Remove the secret. One that is not there is no error.
pub fn delete(service: &str, account: &str) -> Result<(), String> {
    #[cfg(test)]
    { mem::MEM.lock().unwrap().remove(&(service.into(), account.into())); Ok(()) }
    #[cfg(not(test))]
    match keyring::Entry::new(service, account).and_then(|e| e.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
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
