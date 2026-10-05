// Dictation in the composer (src/ui/features/conversations/Composer.tsx): speech to text on this Mac, no audio leaves it.
// The microphone is recorded here (cpal) on a thread of its own, which also sends the input level to the composer's
// meter; a local model (transcribe-rs on ONNX Runtime) turns the recording into text. Settings › Voice picks the model
// from MODELS and the language; each is downloaded once into the app data dir, checked against its SHA-256, and the
// one in use stays loaded after its first use.
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use transcribe_rs::onnx::canary::CanaryModel;
use transcribe_rs::onnx::cohere::CohereModel;
use transcribe_rs::onnx::moonshine::{MoonshineModel, MoonshineVariant};
use transcribe_rs::onnx::parakeet::ParakeetModel;
use transcribe_rs::onnx::Quantization;
use transcribe_rs::{SpeechModel, TranscribeOptions};

const RATE: u32 = 16_000; // what every model takes
const HOST: &str = "https://blob.handy.computer"; // Handy's model mirror (MIT, cjpais/Handy), the archives transcribe-rs documents

/// A model Settings › Voice offers. `auto`: it hears the language itself; without it the language is passed.
struct Model { id: &'static str, file: &'static str, sha256: &'static str, mb: u32, langs: &'static [&'static str], auto: bool }
const EU: &[&str] = &["bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu", "it", "lv", "lt", "mt", "pl", "pt", "ro", "sk", "sl", "es", "sv", "ru", "uk"];
const MODELS: &[Model] = &[
    Model { id: "parakeet-v3", file: "parakeet-v3-int8.tar.gz", sha256: "43d37191602727524a7d8c6da0eef11c4ba24320f5b4730f1a2497befc2efa77", mb: 456, langs: EU, auto: true },
    Model { id: "parakeet-v2", file: "parakeet-v2-int8.tar.gz", sha256: "ac9b9429984dd565b25097337a887bb7f0f8ac393573661c651f0e7d31563991", mb: 451, langs: &["en"], auto: true },
    Model { id: "canary-1b-v2", file: "canary-1b-v2.tar.gz", sha256: "02305b2a25f9cf3e7deaffa7f94df00efa44f442cd55c101c2cb9c000f904666", mb: 691, langs: EU, auto: false },
    Model { id: "cohere", file: "cohere-int8.tar.gz", sha256: "ea2257d52434f3644574f187dcdcf666e302cd11b92866116ab8e14cd9c887f0", mb: 1708, langs: &["en", "fr", "de", "it", "es", "pt", "el", "nl", "pl", "zh", "ja", "ko", "vi", "ar"], auto: true },
    Model { id: "moonshine-base", file: "moonshine-base.tar.gz", sha256: "04bf6ab012cfceebd4ac7cf88c1b31d027bbdd3cd704649b692e2e935236b7e8", mb: 55, langs: &["en"], auto: true },
];
const DEFAULT: &str = "parakeet-v3";

fn model(id: &str) -> Result<&'static Model, String> { MODELS.iter().find(|m| m.id == id).ok_or_else(|| format!("unknown model {id}")) }

fn load(m: &Model, dir: &Path) -> Result<Box<dyn SpeechModel>, String> {
    let int8 = &Quantization::Int8;
    let e = |e: transcribe_rs::TranscribeError| e.to_string();
    Ok(match m.id {
        "parakeet-v3" | "parakeet-v2" => Box::new(ParakeetModel::load(dir, int8).map_err(e)?),
        "canary-1b-v2" => Box::new(CanaryModel::load(dir, int8).map_err(e)?),
        "cohere" => Box::new(CohereModel::load(dir, int8).map_err(e)?),
        _ => Box::new(MoonshineModel::load(dir, MoonshineVariant::Base, &Quantization::default()).map_err(e)?),
    })
}

struct Recording { stop: mpsc::Sender<()>, done: std::thread::JoinHandle<Result<Vec<f32>, String>> }

type Loaded = Arc<Mutex<Option<(&'static str, Box<dyn SpeechModel>)>>>;
#[derive(Default)]
pub struct Dictation {
    // ponytail: the model in use stays loaded until quit or a switch (~700 MB for Parakeet); unload after some idle
    // minutes if that shows in Activity Monitor
    loaded: Loaded,
    rec: Mutex<Option<Recording>>,
    downloading: Mutex<HashSet<&'static str>>,
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("models"))
}
// a model counts once its archive was checked and unpacked: the marker is written last
fn installed(dir: &Path) -> bool { dir.join(".relay-ok").is_file() }

/// The voice settings the backend uses: the model (for a meeting its own, when one is set), and the language to pass
/// ("" to let the model hear it).
fn picked(app: &AppHandle, meeting: bool) -> Result<(&'static Model, String), String> {
    let voice = app.state::<super::App>().settings.lock().unwrap().get("voice").cloned().unwrap_or(Value::Null);
    let own = voice["meetingModel"].as_str().filter(|id| meeting && !id.is_empty());
    let m = model(own.or(voice["model"].as_str()).unwrap_or(DEFAULT)).or_else(|_| model(DEFAULT))?;
    let set = voice["language"].as_str().filter(|l| !l.is_empty() && *l != "auto").map(str::to_string);
    // a model that cannot hear the language gets the Mac's, else English
    let lang = match set {
        Some(l) => l,
        None if m.auto => String::new(),
        None => sys_locale::get_locale().and_then(|l| l.split(['-', '_']).next().map(str::to_string))
            .filter(|l| m.langs.contains(&l.as_str())).unwrap_or_else(|| "en".into()),
    };
    Ok((m, lang))
}

/// The model, loaded on first use or after a switch. Whoever takes the lock first loads it, the other waits.
fn with_model<T>(loaded: &Loaded, m: &'static Model, dir: &Path, f: impl FnOnce(&mut dyn SpeechModel) -> Result<T, String>) -> Result<T, String> {
    let mut held = loaded.lock().unwrap();
    if held.as_ref().map(|(id, _)| *id) != Some(m.id) {
        *held = None; // the old one out before the new one comes in
        *held = Some((m.id, load(m, dir)?));
    }
    f(held.as_mut().unwrap().1.as_mut())
}

/// Runs `f` with the model a meeting uses, loaded, and the options to transcribe with (src/meeting.rs).
/// Err("model") when that model is not downloaded.
pub(crate) fn with_meeting_model<T>(app: &AppHandle, f: impl FnOnce(&mut dyn SpeechModel, &TranscribeOptions) -> Result<T, String>) -> Result<T, String> {
    let (m, language) = picked(app, true)?;
    let dir = models_dir(app)?.join(m.id);
    if !installed(&dir) { return Err("model".into()); }
    let options = TranscribeOptions { language: (!language.is_empty()).then_some(language), ..Default::default() };
    with_model(&app.state::<Dictation>().loaded, m, &dir, |model| f(model, &options))
}

#[derive(Serialize)]
pub struct ModelInfo { id: &'static str, mb: u32, langs: &'static [&'static str], auto: bool, installed: bool, downloading: bool }

/// Every model Settings › Voice offers, with whether it is on this Mac.
#[tauri::command]
pub fn dictation_models(app: AppHandle, state: State<Dictation>) -> Result<Vec<ModelInfo>, String> {
    let dir = models_dir(&app)?;
    let busy = state.downloading.lock().unwrap();
    Ok(MODELS.iter().map(|m| ModelInfo { id: m.id, mb: m.mb, langs: m.langs, auto: m.auto, installed: installed(&dir.join(m.id)), downloading: busy.contains(m.id) }).collect())
}

/// Whether the model picked in Settings › Voice is on this Mac.
#[tauri::command]
pub fn dictation_model(app: AppHandle) -> Result<bool, String> { Ok(installed(&models_dir(&app)?.join(picked(&app, false)?.0.id))) }

/// Downloads a model (`id`, or the picked one), checks and unpacks it, reporting 0..1 on `on_progress`. curl, shasum
/// and tar are on every Mac.
#[tauri::command]
pub async fn dictation_download(app: AppHandle, state: State<'_, Dictation>, id: Option<String>, on_progress: Channel<f64>) -> Result<(), String> {
    let m = match id { Some(id) => model(&id)?, None => picked(&app, false)?.0 };
    if !state.downloading.lock().unwrap().insert(m.id) { return Err("busy".into()); }
    let dir = models_dir(&app)?;
    let done = tauri::async_runtime::spawn_blocking(move || download(m, &dir, &on_progress)).await.map_err(|e| e.to_string());
    state.downloading.lock().unwrap().remove(m.id);
    done?
}

fn download(m: &Model, models: &Path, progress: &Channel<f64>) -> Result<(), String> {
    let run = |cmd: &mut Command| cmd.output().map_err(|e| e.to_string());
    std::fs::create_dir_all(models).map_err(|e| e.to_string())?;
    let url = format!("{HOST}/{}", m.file);
    let part = models.join(format!("{}.part", m.file));
    let unpack = models.join(format!("{}.unpack", m.id));
    let total = m.mb as f64 * 1_000_000.0;
    let mut curl = Command::new("curl").args(["-fsSL", "-o"]).arg(&part).arg(&url).spawn().map_err(|e| e.to_string())?;
    let ok = loop {
        if let Some(status) = curl.try_wait().map_err(|e| e.to_string())? { break status.success(); }
        let got = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
        progress.send((got as f64 / total).min(0.99)).ok();
        std::thread::sleep(Duration::from_millis(250));
    };
    let result = (|| {
        if !ok { return Err("download failed".to_string()); }
        let sum = run(Command::new("shasum").args(["-a", "256"]).arg(&part))?;
        if !String::from_utf8_lossy(&sum.stdout).starts_with(m.sha256) { return Err("the download is damaged (checksum differs)".into()); }
        // the archive holds one folder, named as Handy names it: unpacked aside, then moved under the model's id
        std::fs::remove_dir_all(&unpack).ok();
        std::fs::create_dir_all(&unpack).map_err(|e| e.to_string())?;
        if !run(Command::new("tar").arg("xzf").arg(&part).arg("-C").arg(&unpack))?.status.success() { return Err("the model could not be unpacked".into()); }
        let inner = std::fs::read_dir(&unpack).map_err(|e| e.to_string())?.flatten().map(|e| e.path()).find(|p| p.is_dir()).ok_or("the archive holds no model")?;
        let dir = models.join(m.id);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::rename(inner, &dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join(".relay-ok"), m.sha256).map_err(|e| e.to_string())
    })();
    std::fs::remove_file(&part).ok();
    std::fs::remove_dir_all(&unpack).ok();
    if result.is_ok() { progress.send(1.0).ok(); }
    result
}

/// Removes a downloaded model, unloading it when it is the one in use.
#[tauri::command]
pub fn dictation_delete(app: AppHandle, state: State<Dictation>, id: String) -> Result<(), String> {
    let m = model(&id)?;
    let mut held = state.loaded.lock().unwrap();
    if held.as_ref().is_some_and(|(loaded, _)| *loaded == m.id) { *held = None; }
    std::fs::remove_dir_all(models_dir(&app)?.join(m.id)).map_err(|e| e.to_string())
}

/// Starts recording the default microphone; the input level (0..1) arrives on `on_level` about 15 times a second.
/// Loads the model meanwhile, so it is ready when the recording stops. Err("model") when it is not downloaded yet.
#[tauri::command]
pub fn dictation_start(app: AppHandle, on_level: Channel<f32>) -> Result<(), String> {
    start(&app, Box::new(move |level| { on_level.send(level).ok(); }))
}

/// Starts recording, the level going to `level` (the composer's channel, or the pill of anywhere.rs). Nothing when it
/// already records.
pub(crate) fn start(app: &AppHandle, level: Box<dyn Fn(f32) + Send>) -> Result<(), String> {
    let state = app.state::<Dictation>();
    let (m, _) = picked(app, false)?;
    let dir = models_dir(app)?.join(m.id);
    if !installed(&dir) { return Err("model".into()); }
    let mut rec = state.rec.lock().unwrap();
    if rec.is_some() { return Ok(()); }
    let loaded = state.loaded.clone();
    std::thread::spawn(move || { with_model(&loaded, m, &dir, |_| Ok(())).ok(); });
    let (stop, stopped) = mpsc::channel();
    let (ready, started) = mpsc::channel();
    let done = std::thread::spawn(move || record(stopped, ready, level));
    // the stream opens on its own thread (it may not move between threads), its error comes back here
    started.recv().map_err(|e| e.to_string())??;
    *rec = Some(Recording { stop, done });
    Ok(())
}

fn record(stopped: mpsc::Receiver<()>, ready: mpsc::Sender<Result<(), String>>, level: Box<dyn Fn(f32) + Send>) -> Result<Vec<f32>, String> {
    let samples = Arc::new(Mutex::new(Vec::<f32>::new()));
    let peak = Arc::new(Mutex::new(0f32));
    let opened = (|| {
        let device = cpal::default_host().default_input_device().ok_or("no microphone")?;
        let config = device.default_input_config().map_err(|e| e.to_string())?;
        // ponytail: f32 only, which is what CoreAudio gives; convert other formats if a microphone ever asks for it
        if config.sample_format() != cpal::SampleFormat::F32 { return Err(format!("unsupported microphone format {}", config.sample_format())); }
        let (rate, channels) = (config.sample_rate(), config.channels() as usize);
        let (into, loudest) = (samples.clone(), peak.clone());
        let stream = device.build_input_stream(
            config.config(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let mono = data.chunks(channels).map(|frame| frame.iter().sum::<f32>() / channels as f32);
                let mut out = into.lock().unwrap();
                let mut top = 0f32;
                for s in mono { top = top.max(s.abs()); out.push(s); }
                let mut p = loudest.lock().unwrap();
                *p = p.max(top);
            },
            |e| eprintln!("dictation: {e}"),
            None,
        ).map_err(|e| e.to_string())?;
        stream.play().map_err(|e| e.to_string())?;
        Ok::<_, String>((stream, rate))
    })();
    let (stream, rate) = match opened {
        Ok(v) => { ready.send(Ok(())).ok(); v }
        Err(e) => { ready.send(Err(e.clone())).ok(); return Err(e); }
    };
    while let Err(RecvTimeoutError::Timeout) = stopped.recv_timeout(Duration::from_millis(66)) {
        level(std::mem::take(&mut *peak.lock().unwrap()).min(1.0));
    }
    drop(stream);
    let recorded = std::mem::take(&mut *samples.lock().unwrap());
    Ok(resample(&recorded, rate, RATE))
}

/// Linear interpolation between the microphone's rate and Parakeet's. Fine for speech that is downsampled; a
/// windowed-sinc resampler would only matter for music.
fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() { return input.to_vec(); }
    let step = from as f64 / to as f64;
    let n = (input.len() as f64 / step) as usize;
    (0..n).map(|i| {
        let pos = i as f64 * step;
        let (j, frac) = (pos as usize, (pos.fract()) as f32);
        let a = input[j];
        let b = *input.get(j + 1).unwrap_or(&a);
        a + (b - a) * frac
    }).collect()
}

/// Stops the recording and returns its text, "" when nothing was said.
#[tauri::command]
pub async fn dictation_stop(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || stop(&app)).await.map_err(|e| e.to_string())?
}

/// Whether a recording runs.
pub(crate) fn recording(app: &AppHandle) -> bool { app.state::<Dictation>().rec.lock().unwrap().is_some() }

/// Stops the recording and returns its text (blocking while it transcribes), "" when nothing was said.
pub(crate) fn stop(app: &AppHandle) -> Result<String, String> {
    let state = app.state::<Dictation>();
    let Some(rec) = state.rec.lock().unwrap().take() else { return Ok(String::new()) };
    rec.stop.send(()).ok();
    let (m, language) = picked(app, false)?;
    let dir = models_dir(app)?.join(m.id);
    let loaded = state.loaded.clone();
    {
        let samples = rec.done.join().map_err(|_| "the recording thread panicked".to_string())??;
        // under a third of a second is a click on the button, not speech
        if samples.len() < RATE as usize / 3 { return Ok(String::new()); }
        // macOS hands over silence, not an error, when Relay may not use the microphone
        if samples.iter().all(|s| *s == 0.0) { return Err("silent".into()); }
        let options = TranscribeOptions { language: (!language.is_empty()).then_some(language), ..Default::default() };
        with_model(&loaded, m, &dir, |model| {
            model.transcribe(&samples, &options).map(|r| r.text.trim().to_string()).map_err(|e| e.to_string())
        })
    }
}

/// Stops the recording and throws it away.
#[tauri::command]
pub fn dictation_cancel(state: State<Dictation>) {
    if let Some(rec) = state.rec.lock().unwrap().take() { rec.stop.send(()).ok(); }
}

#[cfg(test)]
mod tests {
    use super::resample;
    #[test]
    fn resample_keeps_duration_and_shape() {
        let second: Vec<f32> = (0..48_000).map(|i| (i as f32 / 48_000.0 * 440.0 * std::f32::consts::TAU).sin()).collect();
        let out = resample(&second, 48_000, 16_000);
        assert_eq!(out.len(), 16_000);
        assert!((out[3] - second[9]).abs() < 1e-6);
        assert_eq!(resample(&second[..10], 16_000, 16_000), second[..10].to_vec());
    }
}
