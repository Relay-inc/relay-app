// Small helpers the modules used to carry copies of: an atomic file write and the JSON file load.
use serde::de::DeserializeOwned;
use std::path::Path;

/// `data` over `path` through a temp file next to it (see `relay_remote::sync::write_atomic`), the error as text.
pub fn write_file(path: &Path, data: impl AsRef<[u8]>) -> Result<(), String> {
    relay_remote::sync::write_atomic(path, data.as_ref(), None).map_err(|e| e.to_string())
}

/// The JSON file at `path` as `T`; `T::default()` when it is missing or does not parse.
pub fn read_json<T: DeserializeOwned + Default>(path: impl AsRef<Path>) -> T {
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}
