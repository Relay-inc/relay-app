// Recording a meeting (Waiting for you › Record, src/ui/features/conversations/WaitingView.tsx): two tracks streamed to
// disk, the microphone ("me") and what the Mac plays ("others", through a Core Audio process tap, macOS 14.2+, which
// asks for the System Audio Recording permission once). Two tracks name the speakers without a diarization model.
// Stopping converts them (afconvert, on every Mac), transcribes each on its silences with the meeting model
// (dictation.rs), and writes the mixed audio (.m4a) and the transcript (.md) into Obsidian's attachment folder; an agent
// then makes the meeting note around them (src/application/calendar/recording.ts). Until that worked the recording stays
// in the app data dir, so a failure loses nothing.
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering::Relaxed};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

const RATE: usize = 16_000;

struct Track { stop: Arc<AtomicBool>, level: Arc<AtomicU32>, done: JoinHandle<Result<(), String>> }
struct Session { dir: PathBuf, tracks: Vec<(&'static str, Track)>, ticking: Arc<AtomicBool>, _tap: Option<tap::Tap> }

#[derive(Default)]
pub struct MeetingRec { session: Mutex<Option<Session>> }

/// Records `device` into a mono float WAV at its own rate, on a thread that owns the stream (it may not move threads).
/// The callback only hands the samples over; the thread writes them and keeps the loudest one for the meter.
fn track(device: cpal::Device, path: PathBuf) -> Result<Track, String> {
    let (stop, level) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicU32::new(0)));
    let (stopped, loudest) = (stop.clone(), level.clone());
    let (ready, started) = mpsc::channel();
    let done = std::thread::spawn(move || {
        let opened = (|| {
            let config = device.default_input_config().map_err(|e| e.to_string())?;
            if config.sample_format() != cpal::SampleFormat::F32 { return Err(format!("unsupported audio format {}", config.sample_format())); }
            let channels = config.channels() as usize;
            let spec = hound::WavSpec { channels: 1, sample_rate: config.sample_rate(), bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
            let writer = hound::WavWriter::create(&path, spec).map_err(|e| e.to_string())?;
            let (tx, rx) = mpsc::channel::<Vec<f32>>();
            let stream = device.build_input_stream(
                config.config(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    tx.send(data.chunks(channels).map(|f| f.iter().sum::<f32>() / channels as f32).collect()).ok();
                },
                |e| eprintln!("meeting: {e}"),
                None,
            ).map_err(|e| e.to_string())?;
            stream.play().map_err(|e| e.to_string())?;
            Ok((stream, writer, rx))
        })();
        let (stream, mut writer, rx) = match opened {
            Ok(v) => { ready.send(Ok(())).ok(); v }
            Err(e) => { ready.send(Err(e.clone())).ok(); return Err(e); }
        };
        let mut write = |chunk: Vec<f32>| -> Result<(), String> {
            // a positive float orders like its bits
            loudest.fetch_max(chunk.iter().fold(0f32, |a, x| a.max(x.abs())).to_bits(), Relaxed);
            chunk.into_iter().try_for_each(|s| writer.write_sample(s)).map_err(|e| e.to_string())
        };
        while !stopped.load(Relaxed) {
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(100)) { write(chunk)?; }
        }
        drop(stream);
        for chunk in rx.try_iter() { write(chunk)?; }
        writer.finalize().map_err(|e| e.to_string())
    });
    started.recv().map_err(|e| e.to_string())??;
    Ok(Track { stop, level, done })
}

/// Starts recording: the microphone always, what the Mac plays when the tap works. `on_tick` gets the seconds and the
/// two levels (0..1) four times a second. Answers whether the Mac's audio is in it, and why not.
#[tauri::command]
pub fn meeting_record_start(app: AppHandle, state: State<MeetingRec>, on_tick: Channel<Value>) -> Result<Value, String> {
    let mut session = state.session.lock().unwrap();
    if session.is_some() { return Err("already recording".into()); }
    super::dictation::meeting_model_ready(&app)?;
    let dir = recordings(&app)?.join(chrono::Local::now().format("%Y%m%d-%H%M%S").to_string());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mic = cpal::default_host().default_input_device().ok_or("no microphone")?;
    let mut tracks = vec![("me", track(mic, dir.join("me.wav"))?)];
    let (system, why) = match tap::Tap::create() {
        Ok((tap, device)) => match track(device, dir.join("others.wav")) {
            Ok(t) => { tracks.push(("others", t)); (Some(tap), None) }
            Err(e) => (None, Some(e)),
        },
        Err(e) => (None, Some(e)),
    };
    let ticking = Arc::new(AtomicBool::new(true));
    let levels: Vec<_> = tracks.iter().map(|(name, t)| (*name, t.level.clone())).collect();
    let on = ticking.clone();
    let started = Instant::now();
    std::thread::spawn(move || while on.load(Relaxed) {
        let mut tick = json!({ "secs": started.elapsed().as_secs() });
        for (name, level) in &levels { tick[*name] = json!(f32::from_bits(level.swap(0, Relaxed)).min(1.0)); }
        if on_tick.send(tick).is_err() { break; }
        std::thread::sleep(Duration::from_millis(250));
    });
    let answer = json!({ "system": system.is_some(), "why": why });
    *session = Some(Session { dir, tracks, ticking, _tap: system });
    Ok(answer)
}

fn end(state: &MeetingRec) -> Result<PathBuf, String> {
    let session = state.session.lock().unwrap().take().ok_or("not recording")?;
    session.ticking.store(false, Relaxed);
    for (_, t) in &session.tracks { t.stop.store(true, Relaxed); }
    for (_, t) in session.tracks { t.done.join().map_err(|_| "a recording thread panicked".to_string())??; }
    Ok(session.dir) // the tap goes with the session
}

/// Stops and throws the recording away.
#[tauri::command]
pub fn meeting_record_cancel(state: State<MeetingRec>) -> Result<(), String> {
    let dir = end(&state)?;
    std::fs::remove_dir_all(dir).map_err(|e| e.to_string())
}

/// Stops recording, then writes the audio and the transcript into the vault: `title` names the files, `me` and `others`
/// the two speakers in the transcript, `on_progress` gets 0..1 while it transcribes. Answers the files' vault paths.
#[tauri::command]
pub async fn meeting_record_stop(app: AppHandle, state: State<'_, MeetingRec>, title: String, me: String, others: String, on_progress: Channel<f64>) -> Result<Value, String> {
    let dir = end(&state)?;
    save(app, dir, title, me, others, on_progress).await
}

/// The folders of recordings a failure kept (one that worked or was cancelled is gone), newest first: what a restart
/// finds again. Not the one being recorded.
#[tauri::command]
pub fn meeting_kept(app: AppHandle, state: State<MeetingRec>) -> Result<Vec<String>, String> {
    let busy = state.session.lock().unwrap().as_ref().map(|s| s.dir.clone());
    Ok(kept(&recordings(&app)?, busy.as_deref()))
}

fn recordings(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("recordings"))
}

fn kept(root: &Path, busy: Option<&Path>) -> Vec<String> {
    // the folders are named by their start time, so by name is by age
    let mut all: Vec<String> = std::fs::read_dir(root).into_iter().flatten().flatten()
        .filter(|e| e.path().join("me.wav").is_file() && Some(e.path().as_path()) != busy)
        .filter_map(|e| e.file_name().into_string().ok()).collect();
    all.sort_by(|a, b| b.cmp(a));
    all
}

/// Writes out the recording a failure kept, `folder` one of `meeting_kept`'s, as `meeting_record_stop`.
#[tauri::command]
pub async fn meeting_record_retry(app: AppHandle, state: State<'_, MeetingRec>, folder: String, title: String, me: String, others: String, on_progress: Channel<f64>) -> Result<Value, String> {
    if state.session.lock().unwrap().is_some() { return Err("already recording".into()); }
    let dir = recordings(&app)?.join(&folder);
    // only a folder this app made: its name is a start time, no path
    if started(&dir).is_none() || !dir.join("me.wav").is_file() { return Err("no kept recording".into()); }
    save(app, dir, title, me, others, on_progress).await
}

/// When a recording started: its folder's name.
fn started(dir: &Path) -> Option<chrono::NaiveDateTime> {
    chrono::NaiveDateTime::parse_from_str(&dir.file_name()?.to_string_lossy(), "%Y%m%d-%H%M%S").ok()
}

async fn save(app: AppHandle, dir: PathBuf, title: String, me: String, others: String, on_progress: Channel<f64>) -> Result<Value, String> {
    let vault = super::need_vault(&app.state::<super::App>())?;
    let keep_audio = app.state::<super::App>().settings.lock().unwrap()["voice"]["keepAudio"] != false;
    let work = dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let done = write_out(&app, &work, Path::new(&vault), &title, [&me, &others], keep_audio, &on_progress);
        // kept when it failed, so nothing is lost: the error says where it is
        match done {
            Ok(v) => { std::fs::remove_dir_all(&work).ok(); Ok(v) }
            Err(e) => Err(format!("{e} (the recording is kept in {})", work.display())),
        }
    }).await.map_err(|e| e.to_string())?
}

fn afconvert(args: &[&str], from: &Path, to: &Path) -> Result<(), String> {
    let ok = Command::new("afconvert").args(args).arg(from).arg(to).status().map_err(|e| e.to_string())?.success();
    if ok { Ok(()) } else { Err(format!("afconvert could not convert {}", from.display())) }
}

/// What the transcript says where a stretch could not be transcribed.
const SKIPPED: &str = "[this stretch could not be transcribed]";
/// A stretch is at most 25 s of audio: a few seconds on Metal, so this is a call that will not return.
const STALL: Duration = Duration::from_secs(120);

/// `f` on a thread of its own; None when it did not answer within `limit`. The thread is left behind: whisper.cpp
/// waits on a Metal command buffer that never completes after a sleep, and nothing aborts that (transcribe-rs does
/// not expose whisper's abort callback, which only the CPU backend polls anyway). It keeps the model it holds, a few
/// hundred MB, until Relay quits; a wake does not free it.
fn within<T: Send + 'static>(limit: Duration, f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || { tx.send(f()).ok(); });
    rx.recv_timeout(limit).ok()
}

/// The text of one stretch. When the call stalls the model is dropped from its slot (see `with_meeting_model`), so
/// the second try loads a fresh one; None when that stalls too.
fn region_text(app: &AppHandle, samples: &[f32]) -> Result<Option<String>, String> {
    for _ in 0..2 {
        let (app, samples) = (app.clone(), samples.to_vec());
        let done = within(STALL, move || super::dictation::with_meeting_model(&app, |model, options|
            model.transcribe(&samples, options).map(|r| r.text).map_err(|e| e.to_string())));
        if let Some(done) = done { return done.map(Some); }
        eprintln!("meeting: a stretch did not transcribe within {STALL:?}");
    }
    Ok(None)
}

fn write_out(app: &AppHandle, dir: &Path, vault: &Path, title: &str, speakers: [&str; 2], keep_audio: bool, progress: &Channel<f64>) -> Result<Value, String> {
    // each track as Parakeet takes it: 16 kHz mono 16-bit
    let mut tracks = vec![];
    for (i, name) in ["me", "others"].iter().enumerate() {
        let raw = dir.join(format!("{name}.wav"));
        if !raw.is_file() { continue; }
        let wav = dir.join(format!("{name}-16k.wav"));
        afconvert(&["-f", "WAVE", "-d", "LEI16@16000", "-c", "1"], &raw, &wav)?;
        tracks.push((speakers[i], transcribe_rs::audio::read_wav_samples(&wav).map_err(|e| e.to_string())?));
    }
    let folder = attachments(vault);
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    // named by when the recording started (its folder's name), so a retry later in the day keeps the meeting's time
    let started = started(dir).unwrap_or_else(|| chrono::Local::now().naive_local());
    let stem = free_stem(&folder, &format!("{} {}", started.format("%Y-%m-%d %H%M"), safe_name(title)));
    // every stretch of speech of both tracks, transcribed in turn
    let regions: Vec<(usize, (usize, usize))> = tracks.iter().enumerate().flat_map(|(t, (_, s))| speech_regions(s).into_iter().map(move |r| (t, r))).collect();
    let mut lines = vec![];
    let mut stalled = 0;
    for (n, (t, (a, b))) in regions.iter().enumerate() {
        let secs = |i: usize| i as f32 / RATE as f32;
        let text = match region_text(app, &tracks[*t].1[*a..*b])? {
            Some(text) => { stalled = 0; text }
            // two stretches in a row means the model is gone, not one unlucky call: keep the recording, try later
            None if stalled >= 1 => return Err("the speech model stopped answering, try again later".into()),
            None => { stalled += 1; SKIPPED.into() }
        };
        if !text.trim().is_empty() { lines.push(Line { at: secs(*a), end: secs(*b), mic: *t == 0, who: tracks[*t].0, text: text.trim().to_string() }); }
        progress.send((n + 1) as f64 / regions.len() as f64).ok();
    }
    // the audio only once the transcript worked, so a failure leaves nothing in the vault and a retry no second copy
    let audio = if keep_audio {
        let mixed = dir.join("mixed.wav");
        write_mix(&mixed, &tracks.iter().map(|(_, s)| s.as_slice()).collect::<Vec<_>>())?;
        let m4a = folder.join(format!("{stem}.m4a"));
        afconvert(&["-f", "m4af", "-d", "aac", "-b", "48000"], &mixed, &m4a)?;
        Some(m4a)
    } else { None };
    let md = folder.join(format!("{stem}.md"));
    std::fs::write(&md, format!("# {title}\n\n{}", transcript(drop_echo(lines)))).map_err(|e| e.to_string())?;
    let rel = |p: &Path| p.strip_prefix(vault).unwrap_or(p).to_string_lossy().to_string();
    let seconds = tracks.iter().map(|(_, s)| s.len()).max().unwrap_or(0) / RATE;
    Ok(json!({ "audio": audio.as_deref().map(rel), "transcript": rel(&md), "seconds": seconds }))
}

/// Where Obsidian puts attachments: its attachmentFolderPath, the vault root when unset or relative to the note.
fn attachments(vault: &Path) -> PathBuf {
    let set = std::fs::read_to_string(vault.join(".obsidian/app.json")).ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v["attachmentFolderPath"].as_str().map(str::to_string))
        .filter(|p| !p.is_empty() && !p.starts_with('.') && !p.starts_with('/') && !p.contains(".."));
    set.map_or(vault.to_path_buf(), |p| vault.join(p))
}
/// A title as a file name: no characters Obsidian or the Mac refuse in one.
fn safe_name(title: &str) -> String {
    let name: String = title.chars().map(|c| if "/\\:*?\"<>|#^[]".contains(c) || c.is_control() { ' ' } else { c }).collect();
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() { "Meeting".into() } else { name.chars().take(80).collect() }
}
fn free_stem(folder: &Path, stem: &str) -> String {
    let taken = |s: &str| folder.join(format!("{s}.md")).exists() || folder.join(format!("{s}.m4a")).exists();
    (1..).map(|n| if n == 1 { stem.to_string() } else { format!("{stem} ({n})") }).find(|s| !taken(s)).unwrap()
}

fn write_mix(path: &Path, tracks: &[&[f32]]) -> Result<(), String> {
    let spec = hound::WavSpec { channels: 1, sample_rate: RATE as u32, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut w = hound::WavWriter::create(path, spec).map_err(|e| e.to_string())?;
    let len = tracks.iter().map(|t| t.len()).max().unwrap_or(0);
    for i in 0..len {
        let s: f32 = tracks.iter().filter_map(|t| t.get(i)).sum();
        w.write_sample((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16).map_err(|e| e.to_string())?;
    }
    w.finalize().map_err(|e| e.to_string())
}

/// The stretches of speech in 16 kHz audio, as sample ranges: 30 ms frames above the track's own noise floor, gaps under 0.8 s bridged, at most 25 s each (what the models take in one go), 150 ms of margin.
/// ponytail: cut at the frame count, not at the quietest moment; Silero VAD if words get split mid-way.
pub(crate) fn speech_regions(s: &[f32]) -> Vec<(usize, usize)> {
    const FRAME: usize = 480;
    const GAP: usize = 26; // 0.8 s
    const MAX: usize = 833; // 25 s
    let rms: Vec<f32> = s.chunks(FRAME).map(|f| (f.iter().map(|x| x * x).sum::<f32>() / f.len() as f32).sqrt()).collect();
    if rms.is_empty() { return vec![]; }
    let mut sorted = rms.clone();
    sorted.sort_by(|a, b| a.total_cmp(b));
    // three times the noise floor, but never above half the loud parts: a track that is speech throughout has no floor
    let (floor, loud) = (sorted[sorted.len() / 10], sorted[sorted.len() * 9 / 10]);
    let threshold = (floor * 3.0).min(loud * 0.5).max(0.005);
    let mut out = vec![];
    let (mut start, mut last) = (None::<usize>, 0);
    for (i, &r) in rms.iter().enumerate() {
        if r < threshold { continue; }
        match start {
            Some(st) if i - last > GAP || i - st >= MAX => { out.push((st, last + 1)); start = Some(i); }
            None => start = Some(i),
            _ => {}
        }
        last = i;
    }
    if let Some(st) = start { out.push((st, last + 1)); }
    out.into_iter()
        .filter(|(a, b)| b - a >= 10) // under 300 ms is a click, not a word
        .map(|(a, b)| (a.saturating_sub(5) * FRAME, ((b + 5) * FRAME).min(s.len())))
        .collect()
}

/// A transcribed stretch: when (seconds), from which track, and what was said.
struct Line<'a> { at: f32, end: f32, mic: bool, who: &'a str, text: String }

fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric()).filter(|w| w.chars().count() > 1).map(str::to_lowercase).collect()
}
/// Drops what the microphone heard from the speakers: a microphone stretch whose words are mostly in what the others
/// said at the same time (1.5 s either side, for the room's delay). With headphones nothing matches; your own words
/// said over someone else's differ from theirs, so they stay. Works for any speaker, no output device detection.
fn drop_echo(lines: Vec<Line>) -> Vec<Line> {
    let others: Vec<(f32, f32, Vec<String>)> = lines.iter().filter(|l| !l.mic).map(|l| (l.at, l.end, words(&l.text))).collect();
    lines.into_iter().filter(|line| {
        if !line.mic { return true; }
        let mine = words(&line.text);
        let heard: std::collections::HashSet<&String> = others.iter()
            .filter(|(at, end, _)| *at <= line.end + 1.5 && *end >= line.at - 1.5)
            .flat_map(|(_, _, w)| w).collect();
        let echoed = mine.iter().filter(|w| heard.contains(w)).count();
        mine.is_empty() || (echoed as f32) < 0.6 * mine.len() as f32
    }).collect()
}

/// The transcript in time order, one paragraph per turn: a speaker's stretches that follow each other are joined.
fn transcript(mut lines: Vec<Line>) -> String {
    lines.sort_by(|a, b| a.at.total_cmp(&b.at));
    let mut turns: Vec<(f32, &str, String)> = vec![];
    for Line { at, who, text, .. } in lines {
        match turns.last_mut() {
            Some(turn) if turn.1 == who => { turn.2.push(' '); turn.2.push_str(&text); }
            _ => turns.push((at, who, text)),
        }
    }
    turns.iter().map(|(at, who, text)| {
        let s = *at as u32;
        format!("**[{:02}:{:02}] {who}:** {text}\n\n", s / 60, s % 60)
    }).collect()
}

#[cfg(target_os = "macos")]
mod tap {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::AllocAnyThread;
    use objc2_core_audio::*;
    use objc2_core_foundation::{CFDictionary, CFString};
    use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString, NSUUID};
    use cpal::traits::{DeviceTrait, HostTrait};
    use std::ffi::{c_void, CStr};
    use std::ptr::NonNull;

    /// A process tap on everything the Mac plays, inside a private aggregate device that cpal records like a
    /// microphone. Both go when it drops.
    pub struct Tap { tap: AudioObjectID, device: AudioObjectID }
    impl Drop for Tap {
        fn drop(&mut self) {
            unsafe {
                AudioHardwareDestroyAggregateDevice(self.device);
                AudioHardwareDestroyProcessTap(self.tap);
            }
        }
    }

    fn key(c: &CStr) -> Retained<NSString> { NSString::from_str(c.to_str().unwrap()) }
    fn dict(pairs: &[(&CStr, &AnyObject)]) -> Retained<NSDictionary<NSString, AnyObject>> {
        let keys: Vec<_> = pairs.iter().map(|(k, _)| key(k)).collect();
        NSDictionary::from_slices(&keys.iter().map(|k| &**k).collect::<Vec<_>>(), &pairs.iter().map(|(_, v)| *v).collect::<Vec<_>>())
    }

    /// The default output device's UID: the aggregate's clock.
    unsafe fn output_uid() -> Result<Retained<NSString>, String> {
        let mut addr = AudioObjectPropertyAddress { mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain };
        let mut device: AudioObjectID = 0;
        let mut size = size_of::<AudioObjectID>() as u32;
        let st = AudioObjectGetPropertyData(kAudioObjectSystemObject as u32, NonNull::from(&addr), 0, std::ptr::null(), NonNull::from(&mut size), NonNull::from(&mut device).cast::<c_void>());
        if st != 0 { return Err(format!("no output device ({st})")); }
        addr.mSelector = kAudioDevicePropertyDeviceUID;
        let mut uid: *const CFString = std::ptr::null();
        let mut size = size_of::<*const CFString>() as u32;
        let st = AudioObjectGetPropertyData(device, NonNull::from(&addr), 0, std::ptr::null(), NonNull::from(&mut size), NonNull::from(&mut uid).cast::<c_void>());
        if st != 0 || uid.is_null() { return Err(format!("no output device UID ({st})")); }
        // the property hands over a +1 CFString, toll-free an NSString
        Retained::from_raw(uid as *mut NSString).ok_or_else(|| "no output device UID".into())
    }

    impl Tap {
        pub fn create() -> Result<(Tap, cpal::Device), String> {
            unsafe {
                let desc = CATapDescription::initMonoGlobalTapButExcludeProcesses(CATapDescription::alloc(), &NSArray::new());
                desc.setPrivate(true);
                desc.setMuteBehavior(CATapMuteBehavior::Unmuted);
                let mut tap = 0;
                let st = AudioHardwareCreateProcessTap(Some(&desc), &mut tap);
                if st != 0 { return Err(format!("the Mac's audio cannot be tapped ({st}); it needs macOS 14.2")); }
                let output = output_uid().inspect_err(|_| { AudioHardwareDestroyProcessTap(tap); })?;
                let name = NSString::from_str(&format!("Relay meeting {}", std::process::id()));
                let (yes, no) = (NSNumber::new_bool(true), NSNumber::new_bool(false));
                let sub = dict(&[(kAudioSubDeviceUIDKey, &output)]);
                let tapped = dict(&[(kAudioSubTapUIDKey, &desc.UUID().UUIDString()), (kAudioSubTapDriftCompensationKey, &yes)]);
                let subs = NSArray::from_retained_slice(&[sub]);
                let taps = NSArray::from_retained_slice(&[tapped]);
                let aggregate = dict(&[
                    (kAudioAggregateDeviceNameKey, &name),
                    (kAudioAggregateDeviceUIDKey, &NSUUID::new().UUIDString()),
                    (kAudioAggregateDeviceMainSubDeviceKey, &output),
                    (kAudioAggregateDeviceIsPrivateKey, &yes),
                    (kAudioAggregateDeviceIsStackedKey, &no),
                    (kAudioAggregateDeviceTapAutoStartKey, &yes),
                    (kAudioAggregateDeviceSubDeviceListKey, &subs),
                    (kAudioAggregateDeviceTapListKey, &taps),
                ]);
                let mut device = 0;
                let st = AudioHardwareCreateAggregateDevice(&*(Retained::as_ptr(&aggregate) as *const CFDictionary), NonNull::from(&mut device));
                if st != 0 {
                    AudioHardwareDestroyProcessTap(tap);
                    return Err(format!("no device for the Mac's audio ({st})"));
                }
                let made = Tap { tap, device };
                // the new device shows in the list a moment later
                let want = name.to_string();
                for _ in 0..40 {
                    let found = cpal::default_host().input_devices().ok()
                        .and_then(|mut all| all.find(|d| d.description().is_ok_and(|x| x.name() == want)));
                    if let Some(d) = found { return Ok((made, d)); }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                Err("the device for the Mac's audio did not show up".into())
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod tap {
    pub struct Tap;
    impl Tap {
        pub fn create() -> Result<(Tap, cpal::Device), String> { Err("only on macOS".into()) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn regions_follow_speech_and_bridge_short_gaps() {
        let tone = |secs: f32| (0..(secs * 16_000.0) as usize).map(|i| (i as f32 * 0.05).sin() * 0.3).collect::<Vec<f32>>();
        let quiet = |secs: f32| vec![0.0005f32; (secs * 16_000.0) as usize];
        // speech 1 s, a 0.5 s pause (bridged), speech 1 s, 3 s silence, speech 2 s
        let audio = [tone(1.0), quiet(0.5), tone(1.0), quiet(3.0), tone(2.0)].concat();
        let regions = speech_regions(&audio);
        assert_eq!(regions.len(), 2, "{regions:?}");
        assert!(regions[0].0 == 0 && (regions[0].1 as f32 / 16_000.0 - 2.65).abs() < 0.1, "{regions:?}");
        assert!(((regions[1].0 as f32 / 16_000.0) - 5.35).abs() < 0.1, "{regions:?}");
        // one long stretch is cut at 25 s
        assert_eq!(speech_regions(&tone(60.0)).len(), 3);
        assert!(speech_regions(&quiet(5.0)).is_empty());
    }

    #[test]
    fn a_stalled_call_gives_up_and_a_quick_one_answers() {
        assert_eq!(within(Duration::from_secs(5), || 7), Some(7));
        assert_eq!(within(Duration::from_millis(50), || std::thread::sleep(Duration::from_secs(2))), None);
    }

    #[test]
    fn kept_recordings_come_newest_first_without_the_one_in_progress() {
        let root = std::env::temp_dir().join(format!("relay-kept-{}", std::process::id()));
        for d in ["20261005-101200", "20261029-152600", "20261030-090000", "empty"] { std::fs::create_dir_all(root.join(d)).unwrap(); }
        for d in ["20261005-101200", "20261029-152600", "20261030-090000"] { std::fs::write(root.join(d).join("me.wav"), "").unwrap(); }
        assert_eq!(kept(&root, Some(&root.join("20261030-090000"))), ["20261029-152600", "20261005-101200"]);
        assert!(started(&root.join("..")).is_none());
        assert!(started(&root.join("20261029-152600")).is_some());
        std::fs::remove_dir_all(&root).ok();
    }

    fn line(at: f32, mic: bool, text: &str) -> Line<'static> {
        Line { at, end: at + 3.0, mic, who: if mic { "Me" } else { "Others" }, text: text.into() }
    }

    #[test]
    fn transcript_joins_turns_in_time_order() {
        let text = transcript(vec![line(61.0, false, "Hoi."), line(2.0, true, "Goedemorgen."), line(5.0, true, "Alles goed?")]);
        assert_eq!(text, "**[00:02] Me:** Goedemorgen. Alles goed?\n\n**[01:01] Others:** Hoi.\n\n");
    }

    #[test]
    fn the_microphone_hearing_the_speakers_is_dropped() {
        let kept = |lines: Vec<Line<'static>>| drop_echo(lines).into_iter().map(|l| (l.who, l.text)).collect::<Vec<_>>();
        // on speakers: the mic hears the others' sentence a moment later, slightly misheard
        let echo = kept(vec![line(10.0, false, "De release staat op donderdag gepland."), line(10.4, true, "release staat op donderdag gepland")]);
        assert_eq!(echo, vec![("Others", "De release staat op donderdag gepland.".to_string())]);
        // talking over someone: other words, so both stay
        assert_eq!(kept(vec![line(10.0, false, "De release staat op donderdag."), line(11.0, true, "Wacht, welke week bedoel je?")]).len(), 2);
        // the same words long after are not an echo
        assert_eq!(kept(vec![line(10.0, false, "Donderdag gepland."), line(60.0, true, "Donderdag gepland.")]).len(), 2);
    }

    #[test]
    fn names_and_folders_stay_inside_the_vault() {
        assert_eq!(safe_name("Spardex / status: Q4?"), "Spardex status Q4");
        assert_eq!(safe_name("  "), "Meeting");
        let vault = std::env::temp_dir().join(format!("relay-att-{}", std::process::id()));
        std::fs::create_dir_all(vault.join(".obsidian")).unwrap();
        std::fs::write(vault.join(".obsidian/app.json"), r#"{"attachmentFolderPath":"Resources/Attachments"}"#).unwrap();
        assert_eq!(attachments(&vault), vault.join("Resources/Attachments"));
        std::fs::write(vault.join(".obsidian/app.json"), r#"{"attachmentFolderPath":"../outside"}"#).unwrap();
        assert_eq!(attachments(&vault), vault);
        std::fs::remove_dir_all(&vault).ok();
    }
}
