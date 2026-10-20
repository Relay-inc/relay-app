//! The phone's secrets at rest: this phone's certificate and private key (it also signs what goes to the laptop's
//! shared conversations), the key to the laptop's mirror on the machine and the link from the laptop's QR, in one file (`secrets.bin`) sealed with a key in the Android Keystore (SealedPlugin.kt in gen/android).
//! Elsewhere (a desktop run of this crate; iOS until its Keychain side exists) the file holds the same JSON unsealed.

use relay_remote::tls::Identity;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Runtime};
#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
struct Handle<R: Runtime>(tauri::plugin::PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("sealed")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _app.manage(Handle(_api.register_android_plugin("be.laurentmeersman.relay.mobile", "SealedPlugin")?));
            Ok(())
        })
        .build()
}

use base64::{engine::general_purpose::STANDARD as B64, Engine};

#[cfg(target_os = "android")]
fn run<R: Runtime>(app: &AppHandle<R>, cmd: &str, data: &[u8]) -> Result<Vec<u8>, String> {
    #[derive(serde::Deserialize)]
    struct Out { data: String }
    let out: Out = app.state::<Handle<R>>().0.run_mobile_plugin(cmd, json!({"data": B64.encode(data)})).map_err(|e| e.to_string())?;
    B64.decode(out.data).map_err(|e| e.to_string())
}
#[cfg(not(target_os = "android"))]
fn run<R: Runtime>(_app: &AppHandle<R>, _cmd: &str, data: &[u8]) -> Result<Vec<u8>, String> { Ok(data.to_vec()) }

/// What is sealed: the identity (DER, base64), and the mirror's key and the link to the laptop when pairing gave them.
pub struct Secrets { pub id: Identity, pub mirror: Option<String>, pub link: Option<String> }

fn file(dir: &Path) -> PathBuf { dir.join("secrets.bin") }

/// The secrets, made the first time: a new identity, or the plain files of a build before sealing (sealed, then
/// removed).
pub fn load<R: Runtime>(app: &AppHandle<R>, dir: &Path) -> Result<Secrets, String> {
    if let Ok(sealed) = fs::read(file(dir)) {
        let v: Value = serde_json::from_slice(&run(app, "open", &sealed)?).map_err(|e| e.to_string())?;
        let der = |k: &str| B64.decode(v[k].as_str().unwrap_or("")).map_err(|e| e.to_string());
        return Ok(Secrets { id: Identity { cert_der: der("cert")?, key_der: der("key")? }, mirror: v["mirror"].as_str().map(String::from), link: v["link"].as_str().map(String::from) });
    }
    let (crt, key) = (dir.join("phone.crt.der"), dir.join("phone.key.der"));
    let id = match (fs::read(&crt), fs::read(&key)) {
        (Ok(cert_der), Ok(key_der)) => Identity { cert_der, key_der },
        _ => Identity::generate().map_err(|e| e.to_string())?,
    };
    let mirror = fs::read_to_string(dir.join("server.json")).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).and_then(|v| v["key"].as_str().map(String::from));
    let s = Secrets { id, mirror, link: None };
    save(app, dir, &s)?;
    for f in [&key, &crt] { fs::remove_file(f).ok(); }
    Ok(s)
}

/// Seal and write the secrets (a temp file, then a rename).
pub fn save<R: Runtime>(app: &AppHandle<R>, dir: &Path, s: &Secrets) -> Result<(), String> {
    let plain = json!({"cert": B64.encode(&s.id.cert_der), "key": B64.encode(&s.id.key_der), "mirror": s.mirror, "link": s.link}).to_string();
    let sealed = run(app, "seal", plain.as_bytes())?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("secrets.bin.tmp");
    fs::write(&tmp, sealed).and_then(|_| fs::rename(&tmp, file(dir))).map_err(|e| e.to_string())
}
