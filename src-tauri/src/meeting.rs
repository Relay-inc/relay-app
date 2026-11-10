// Recording a meeting (Waiting for you › Record, src/ui/features/conversations/WaitingView.tsx): two tracks streamed to
// disk, the microphone ("me") and what the Mac plays ("others", through a Core Audio process tap, macOS 14.2+, which
// asks for the System Audio Recording permission once). On Windows "others" is WASAPI loopback on the default output
// device, which asks for nothing. Two tracks name the speakers without a diarization model.
// Stopping converts them (afconvert on the Mac, in-process on Windows), transcribes each on its silences with the meeting
// model (dictation.rs), and writes the mixed audio (.m4a, .wav on Windows) and the transcript (.md) into Obsidian's
// attachment folder. An agent then makes the meeting note around them (src/application/calendar/recording.ts). Until
// that worked the recording stays in the app data dir, so a failure loses nothing.
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering::Relaxed};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

const RATE: usize = 16_000;

/// The meeting's transcription language, locked once known: given at start (the note's, or Settings'), else guessed
/// from the words of the first windows that say enough, until then the model hears it itself (auto). From then on every
/// window and the pass at Stop get it. Whisper honours it; Parakeet ignores it.
#[derive(Default)]
struct Language(Option<String>);
impl Language {
    fn see(&mut self, text: &str) {
        if self.0.is_none() { self.0 = guess_language(text).map(str::to_string); }
    }
}
/// The language `text` is in, by the stopwords of the vault's languages (related.rs): at least 12 words, 3 stopwords and
/// twice the runner-up's; None when it is not clear.
fn guess_language(text: &str) -> Option<&'static str> {
    let words: Vec<String> = text.split(|c: char| !c.is_alphabetic()).filter(|w| !w.is_empty()).map(str::to_lowercase).collect();
    if words.len() < 12 { return None; }
    let n = |list: &[&str]| words.iter().filter(|w| list.contains(&w.as_str())).count();
    let (en, nl) = (n(super::related::STOP_EN), n(super::related::STOP_NL));
    let (best, top, other) = if en >= nl { ("en", en, nl) } else { ("nl", nl, en) };
    (top >= 3 && top >= 2 * other).then_some(best)
}

/// A track's audio at 16 kHz that live transcription has not taken yet: (index of its first sample, the samples).
type Heard = Arc<Mutex<(usize, Vec<f32>)>>;
struct Track { stop: Arc<AtomicBool>, level: Arc<AtomicU32>, heard: Heard, done: JoinHandle<Result<(), String>> }
/// What live transcription made of the recording so far. `closed` once Stop took it: a call that returns later is
/// thrown away, the final pass already covers that audio.
#[derive(Default)]
struct Live {
    lines: Vec<(usize, f32, f32, String)>, // track, start and end in seconds, text
    upto: Vec<usize>,                     // per track: the samples before this index are transcribed
    fresh: Vec<Value>,                    // lines the bar has not been sent yet
    gave_up: bool,                        // the model stalled: the rest waits for Stop
    language: Language,
    closed: bool,
}
struct Session {
    dir: PathBuf,
    tracks: Vec<(&'static str, Track)>,
    ticking: Arc<AtomicBool>,
    live: Arc<Mutex<Live>>,
    listened: mpsc::Receiver<()>, // closes when the live worker ended
    _tap: Option<tap::Tap>,
}

#[derive(Default)]
pub struct MeetingRec { session: Mutex<Option<Session>> }

/// Records `device` into a mono float WAV at its own rate, on a thread that owns the stream (it may not move threads).
/// The callback only hands the samples over, the thread writes them and keeps the loudest one for the meter. An output
/// device records what it plays: cpal opens WASAPI loopback for it on Windows.
fn track(device: cpal::Device, path: PathBuf) -> Result<Track, String> {
    let (stop, level, heard) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicU32::new(0)), Heard::default());
    let (stopped, loudest, hearing) = (stop.clone(), level.clone(), heard.clone());
    let (ready, started) = mpsc::channel();
    let done = std::thread::spawn(move || {
        let opened = (|| {
            let config = device.default_input_config().or_else(|e| device.default_output_config().map_err(|_| e)).map_err(|e| denied(e.to_string()))?;
            if config.sample_format() != cpal::SampleFormat::F32 { return Err(format!("unsupported audio format {}", config.sample_format())); }
            let channels = config.channels() as usize;
            let spec = hound::WavSpec { channels: 1, sample_rate: config.sample_rate(), bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
            let writer = hound::WavWriter::create(&path, spec).map_err(|e| e.to_string())?;
            let (tx, rx) = mpsc::channel::<Vec<f32>>();
            let stream = device.build_input_stream(
                config.config(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    tx.send(mono(data, channels)).ok();
                },
                |e| eprintln!("meeting: {e}"),
                None,
            ).map_err(|e| denied(e.to_string()))?;
            stream.play().map_err(|e| denied(e.to_string()))?;
            Ok((stream, writer, rx, Down::new(config.sample_rate())))
        })();
        let (stream, mut writer, rx, mut down) = match opened {
            Ok(v) => { ready.send(Ok(())).ok(); v }
            Err(e) => { ready.send(Err(e.clone())).ok(); return Err(e); }
        };
        let mut write = |chunk: Vec<f32>| -> Result<(), String> {
            // a positive float orders like its bits
            loudest.fetch_max(chunk.iter().fold(0f32, |a, x| a.max(x.abs())).to_bits(), Relaxed);
            down.push(&chunk, &mut hearing.lock().unwrap().1);
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
    Ok(Track { stop, level, heard, done })
}

/// Interleaved frames as one channel, their average.
fn mono(data: &[f32], channels: usize) -> Vec<f32> {
    data.chunks(channels).map(|f| f.iter().sum::<f32>() / channels as f32).collect()
}

/// What the webview shows as the microphone being switched off for Relay (recording.ts): Windows answers an audio
/// client it refuses with E_ACCESSDENIED, which cpal passes on as "Access is denied. (os error 5)".
const MIC_OFF: &str = "microphone";
fn denied(e: String) -> String {
    if cfg!(windows) && e.contains("(os error 5)") { MIC_OFF.into() } else { e }
}

/// Linear interpolation down to 16 kHz as the samples arrive; the position carries over between chunks, so an hour
/// does not drift against the file afconvert makes at Stop.
struct Down { step: f64, pos: f64, carry: Vec<f32> }
impl Down {
    fn new(rate: u32) -> Self { Down { step: rate as f64 / RATE as f64, pos: 0.0, carry: vec![] } }
    fn push(&mut self, chunk: &[f32], out: &mut Vec<f32>) {
        self.carry.extend_from_slice(chunk);
        while self.pos + 1.0 < self.carry.len() as f64 {
            let (j, f) = (self.pos as usize, self.pos.fract() as f32);
            out.push(self.carry[j] + (self.carry[j + 1] - self.carry[j]) * f);
            self.pos += self.step;
        }
        let used = (self.pos as usize).min(self.carry.len());
        self.carry.drain(..used);
        self.pos -= used as f64;
    }
}

/// What live transcription does next with a track's untranscribed tail.
#[derive(Debug, PartialEq)]
enum Next { Speech(usize, usize), Skip(usize), Wait }
/// The first window of `heard` that can no longer grow: one with a later window after it, or with more silence behind
/// it than a window bridges. A long silence is skipped, keeping its last seconds for speech that starts in them.
fn next(heard: &[f32]) -> Next {
    let wins = windows(speech_regions(heard));
    match wins.first() {
        Some(&(a, b)) if wins.len() > 1 || heard.len() - b.min(heard.len()) > WINDOW_PAUSE + RATE => Next::Speech(a, b.min(heard.len())),
        None if heard.len() > 30 * RATE => Next::Skip(heard.len() - 5 * RATE),
        _ => Next::Wait,
    }
}

/// Transcribes the tracks while they record, window by window, until `on` goes off or the model stalls. Lines go into
/// `live` (and its `fresh`, for the bar); the audio they cover leaves `heard`.
fn listen(app: AppHandle, heard: Vec<Heard>, live: Arc<Mutex<Live>>, on: Arc<AtomicBool>) {
    while on.load(Relaxed) {
        let mut took = false;
        for (t, track) in heard.iter().enumerate() {
            if !on.load(Relaxed) { return; }
            let (from, tail) = { let h = track.lock().unwrap(); (h.0, h.1.clone()) };
            let (text, used) = match next(&tail) {
                Next::Wait => continue,
                Next::Skip(n) => (None, n),
                Next::Speech(a, b) => match region_text(&app, &tail[a..b], live.lock().unwrap().language.0.clone()) {
                    Ok(Some(segments)) => (Some((from + a, segments)), b),
                    _ => { live.lock().unwrap().gave_up = true; return; }
                },
            };
            let mut l = live.lock().unwrap();
            if l.closed { return; }
            if let Some((at, segments)) = text {
                l.language.see(&segments.iter().map(|g| g.2.as_str()).collect::<Vec<_>>().join(" "));
                let at = at as f32 / RATE as f32;
                for (s, e, text) in segments {
                    let text = text.trim().to_string();
                    if text.is_empty() { continue; }
                    l.fresh.push(json!({ "at": at + s, "track": t, "text": text }));
                    l.lines.push((t, at + s, at + e, text));
                }
            }
            l.upto[t] = from + used;
            drop(l);
            let mut h = track.lock().unwrap();
            h.1.drain(..used);
            h.0 += used;
            took = true;
        }
        if !took { std::thread::sleep(Duration::from_secs(1)); }
    }
}

/// Starts recording: the microphone always, what the Mac plays when the tap works. `on_tick` gets the seconds and the
/// two levels (0..1) four times a second. `language` is the meeting's (see `Language`); `meeting` is kept in the folder
/// (`meeting.json`), so a retry after a failure still knows which meeting it is. Answers whether the Mac's audio is in it, and why not.
#[tauri::command]
pub fn meeting_record_start(app: AppHandle, state: State<MeetingRec>, language: Option<String>, meeting: Option<Value>, on_tick: Channel<Value>) -> Result<Value, String> {
    let mut session = state.session.lock().unwrap();
    if session.is_some() { return Err("already recording".into()); }
    super::dictation::meeting_model_ready(&app)?;
    let dir = recordings(&app)?.join(chrono::Local::now().format("%Y%m%d-%H%M%S").to_string());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if let Some(m) = &meeting { write_meta(&dir, m, language.as_deref())?; }
    if super::permissions::microphone_off() { return Err(MIC_OFF.into()); }
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
    let live = Arc::new(Mutex::new(Live { upto: vec![0; tracks.len()], language: Language(language), ..Default::default() }));
    let heard: Vec<Heard> = tracks.iter().map(|(_, t)| t.heard.clone()).collect();
    let (on, listening) = (ticking.clone(), live.clone());
    let (listener, listened) = mpsc::channel::<()>();
    std::thread::spawn(move || { listen(app, heard, listening, on); drop(listener); });
    let on = ticking.clone();
    let shown = live.clone();
    let started = Instant::now();
    std::thread::spawn(move || while on.load(Relaxed) {
        let mut tick = json!({ "secs": started.elapsed().as_secs() });
        for (name, level) in &levels { tick[*name] = json!(f32::from_bits(level.swap(0, Relaxed)).min(1.0)); }
        {
            let mut l = shown.lock().unwrap();
            if !l.fresh.is_empty() { tick["lines"] = Value::Array(std::mem::take(&mut l.fresh)); }
            tick["upto"] = json!(l.upto.iter().min().copied().unwrap_or(0) / RATE);
            if l.gave_up { tick["live"] = json!(false); }
        }
        if on_tick.send(tick).is_err() { break; }
        std::thread::sleep(Duration::from_millis(250));
    });
    let answer = json!({ "system": system.is_some(), "why": why });
    *session = Some(Session { dir, tracks, ticking, live, listened, _tap: system });
    Ok(answer)
}

/// What live transcription had when the recording stopped: its lines, per track how far they reach, and the language.
type Done = (Vec<(usize, f32, f32, String)>, Vec<usize>, Language);
fn end(state: &MeetingRec) -> Result<(PathBuf, Done), String> {
    let session = state.session.lock().unwrap().take().ok_or("not recording")?;
    session.ticking.store(false, Relaxed);
    for (_, t) in &session.tracks { t.stop.store(true, Relaxed); }
    for (_, t) in session.tracks { t.done.join().map_err(|_| "a recording thread panicked".to_string())??; }
    // the window it is on is worth a few seconds' wait; a stalled call is not, the final pass redoes that audio
    session.listened.recv_timeout(Duration::from_secs(15)).ok();
    let mut l = session.live.lock().unwrap();
    l.closed = true;
    let heard = (std::mem::take(&mut l.lines), std::mem::take(&mut l.upto), std::mem::take(&mut l.language));
    Ok((session.dir, heard)) // the tap goes with the session
}

/// Stops and throws the recording away.
#[tauri::command]
pub fn meeting_record_cancel(state: State<MeetingRec>) -> Result<(), String> {
    let (dir, _) = end(&state)?;
    std::fs::remove_dir_all(dir).map_err(|e| e.to_string())
}

/// Stops recording, then writes the audio and the transcript into the vault: `title` names the files, `me` and `others`
/// the two speakers in the transcript, `on_progress` gets 0..1 while it transcribes. Answers the files' vault paths.
#[tauri::command]
pub async fn meeting_record_stop(app: AppHandle, state: State<'_, MeetingRec>, title: String, note: Option<String>, me: String, others: String, on_progress: Channel<f64>) -> Result<Value, String> {
    let (dir, heard) = end(&state)?;
    save(app, dir, title, note, me, others, heard, on_progress).await
}

/// The recordings a failure kept (one that worked or was cancelled is gone), newest first: what a restart finds
/// again, as {folder, meeting} (the meeting from `meeting.json`, null for an older recording). Not the one being recorded.
#[tauri::command]
pub fn meeting_kept(app: AppHandle, state: State<MeetingRec>) -> Result<Vec<Value>, String> {
    let busy = state.session.lock().unwrap().as_ref().map(|s| s.dir.clone());
    let root = recordings(&app)?;
    Ok(kept(&root, busy.as_deref()).into_iter().map(|f| json!({ "meeting": read_meta(&root.join(&f)), "folder": f })).collect())
}

const META: &str = "meeting.json";
/// The meeting a recording is of, with its language, next to the audio.
fn write_meta(dir: &Path, meeting: &Value, language: Option<&str>) -> Result<(), String> {
    let mut m = meeting.clone();
    m["language"] = json!(language);
    std::fs::write(dir.join(META), m.to_string()).map_err(|e| e.to_string())
}
fn read_meta(dir: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(dir.join(META)).ok()?).ok()
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
pub async fn meeting_record_retry(app: AppHandle, state: State<'_, MeetingRec>, folder: String, title: String, note: Option<String>, me: String, others: String, on_progress: Channel<f64>) -> Result<Value, String> {
    if state.session.lock().unwrap().is_some() { return Err("already recording".into()); }
    let dir = recordings(&app)?.join(&folder);
    // only a folder this app made: its name is a start time, no path
    if started(&dir).is_none() || !dir.join("me.wav").is_file() { return Err("no kept recording".into()); }
    let language = Language(read_meta(&dir).and_then(|m| m["language"].as_str().map(str::to_string)));
    save(app, dir, title, note, me, others, (vec![], vec![], language), on_progress).await
}

/// When a recording started: its folder's name.
fn started(dir: &Path) -> Option<chrono::NaiveDateTime> {
    chrono::NaiveDateTime::parse_from_str(&dir.file_name()?.to_string_lossy(), "%Y%m%d-%H%M%S").ok()
}

async fn save(app: AppHandle, dir: PathBuf, title: String, note: Option<String>, me: String, others: String, heard: Done, on_progress: Channel<f64>) -> Result<Value, String> {
    let vault = super::need_vault(&app.state::<super::App>())?;
    let keep_audio = app.state::<super::App>().settings.lock().unwrap()["voice"]["keepAudio"] != false;
    let work = dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let done = write_out(&app, &work, Path::new(&vault), &title, note.as_deref(), [&me, &others], keep_audio, heard, &on_progress);
        // kept when it failed, so nothing is lost: the error says where it is
        match done {
            Ok(v) => { std::fs::remove_dir_all(&work).ok(); Ok(v) }
            Err(e) => Err(format!("{e} (the recording is kept in {})", work.display())),
        }
    }).await.map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
fn afconvert(args: &[&str], from: &Path, to: &Path) -> Result<(), String> {
    let ok = std::process::Command::new("afconvert").args(args).arg(from).arg(to).status().map_err(|e| e.to_string())?.success();
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

/// What a window says, as (start, end, text) in seconds from the window's start: the model's segments, or the whole
/// window as one when it gives none. When the call stalls the model is dropped from its slot (see
/// `with_meeting_model`), so the second try loads a fresh one; None when that stalls too.
fn region_text(app: &AppHandle, samples: &[f32], language: Option<String>) -> Result<Option<Vec<(f32, f32, String)>>, String> {
    let len = samples.len() as f32 / RATE as f32;
    for _ in 0..2 {
        let (app, samples, language) = (app.clone(), samples.to_vec(), language.clone());
        let done = within(STALL, move || super::dictation::with_meeting_model(&app, language, |model, options|
            model.transcribe(&samples, options).map(|r| match r.segments {
                Some(segs) if !segs.is_empty() => segs.into_iter().map(|g| (g.start, g.end.max(g.start), g.text)).collect(),
                _ => vec![(0.0, len, r.text)],
            }).map_err(|e| e.to_string())));
        if let Some(done) = done { return done.map(Some); }
        eprintln!("meeting: a stretch did not transcribe within {STALL:?}");
    }
    Ok(None)
}

/// `heard`: what live transcription already did (lines, and per track where they end); only the rest is transcribed.
/// The transcript goes next to the meeting notes (a note of its own, `note` the meeting note's name it belongs to), the
/// audio into the attachments, both in the folders `homes` gives for the recording's year.
fn write_out(app: &AppHandle, dir: &Path, vault: &Path, title: &str, note: Option<&str>, speakers: [&str; 2], keep_audio: bool, heard: Done, progress: &Channel<f64>) -> Result<Value, String> {
    // each track as Parakeet takes it: 16 kHz mono 16-bit
    let mut tracks = vec![];
    for (i, name) in ["me", "others"].iter().enumerate() {
        let raw = dir.join(format!("{name}.wav"));
        if !raw.is_file() { continue; }
        tracks.push((speakers[i], at_16k(dir, name, &raw)?));
    }
    // named by when the recording started (its folder's name), so a retry later in the day keeps the meeting's time
    let started = started(dir).unwrap_or_else(|| chrono::Local::now().naive_local());
    let year = started.format("%Y").to_string();
    let (notes, files) = (crate::homes::home(vault, "meeting", &year), crate::homes::home(vault, "attachments", &year));
    for f in [&notes, &files] { std::fs::create_dir_all(f).map_err(|e| e.to_string())?; }
    let stem = free_stem(&notes, &files, &format!("{} {}", started.format("%Y-%m-%d %H%M"), safe_name(title)));
    // the speech of both tracks in windows of up to 25 s, transcribed in turn: one model call per window, not per
    // stretch (whisper pays for a full 30 s window on every call, and most stretches are a second or two)
    let (done, upto, mut language) = heard;
    // a track that hardly said anything is left out of the transcript and the audio: the Mac's in a meeting in the
    // room (a notification or two), the microphone's when you only listened
    let used: Vec<bool> = tracks.iter().map(|(_, s)| said_something(s)).collect();
    let regions: Vec<(usize, (usize, usize))> = tracks.iter().enumerate().filter(|(t, _)| used[*t]).flat_map(|(t, (_, s))| {
        let from = upto.get(t).copied().unwrap_or(0).min(s.len());
        windows(speech_regions(&s[from..])).into_iter().map(move |(a, b)| (t, (from + a, from + b)))
    }).collect();
    let mut lines: Vec<Line> = done.into_iter().filter(|(t, ..)| *t < tracks.len() && used[*t])
        .map(|(t, at, end, text)| Line { at, end, mic: t == 0, who: tracks[t].0, text }).collect();
    let mut stalled = 0;
    for (n, (t, (a, b))) in regions.iter().enumerate() {
        let secs = |i: usize| i as f32 / RATE as f32;
        let segments = match region_text(app, &tracks[*t].1[*a..*b], language.0.clone())? {
            Some(segments) => { stalled = 0; segments }
            // two windows in a row means the model is gone, not one unlucky call: keep the recording, try later
            None if stalled >= 1 => return Err("the speech model stopped answering, try again later".into()),
            None => { stalled += 1; vec![(0.0, secs(b - a), SKIPPED.into())] }
        };
        language.see(&segments.iter().map(|g| g.2.as_str()).collect::<Vec<_>>().join(" "));
        // a line per segment at its own time, so turns between the tracks and the echo check stay as fine as before
        for (from, to, text) in segments {
            let text = text.trim();
            if !text.is_empty() { lines.push(Line { at: secs(*a) + from, end: secs(*a) + to, mic: *t == 0, who: tracks[*t].0, text: text.to_string() }); }
        }
        progress.send((n + 1) as f64 / regions.len() as f64).ok();
    }
    // the audio only once the transcript worked, so a failure leaves nothing in the vault and a retry no second copy
    let audio = if keep_audio {
        let mixed = dir.join("mixed.wav");
        // all of them when none said anything, so the audio is still there to listen to
        let heard: Vec<&[f32]> = tracks.iter().zip(&used).filter(|(_, u)| **u || !used.contains(&true)).map(|((_, s), _)| s.as_slice()).collect();
        write_mix(&mixed, &heard)?;
        let kept = files.join(format!("{stem}.{AUDIO}"));
        #[cfg(target_os = "macos")]
        afconvert(&["-f", "m4af", "-d", "aac", "-b", "48000"], &mixed, &kept)?;
        // ponytail: no AAC encoder without Media Foundation's COM sink writer, so the 16 kHz mix as it is, ~115 MB an hour
        #[cfg(not(target_os = "macos"))]
        std::fs::copy(&mixed, &kept).map_err(|e| e.to_string())?;
        Some(kept)
    } else { None };
    let md = notes.join(format!("{stem}.transcript.md"));
    std::fs::write(&md, format!("{}# {title}\n\n{}", transcript_front(note), transcript(drop_echo(lines)))).map_err(|e| e.to_string())?;
    let rel = |p: &Path| p.strip_prefix(vault).unwrap_or(p).to_string_lossy().to_string();
    let seconds = tracks.iter().map(|(_, s)| s.len()).max().unwrap_or(0) / RATE;
    Ok(json!({ "audio": audio.as_deref().map(rel), "transcript": rel(&md), "seconds": seconds, "language": language.0 }))
}

/// A transcript note's frontmatter: its type, and the meeting note it belongs to when there is one.
fn transcript_front(note: Option<&str>) -> String {
    let meeting = note.filter(|n| !n.trim().is_empty()).map(|n| format!("meeting: {}\n", serde_json::to_string(&format!("[[{}]]", n.trim())).unwrap()));
    format!("---\ntype: Transcript\n{}---\n", meeting.unwrap_or_default())
}
/// A title as a file name: no characters Obsidian or the Mac refuse in one.
fn safe_name(title: &str) -> String {
    let name: String = title.chars().map(|c| if "/\\:*?\"<>|#^[]".contains(c) || c.is_control() { ' ' } else { c }).collect();
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() { "Meeting".into() } else { name.chars().take(80).collect() }
}
fn free_stem(notes: &Path, files: &Path, stem: &str) -> String {
    let taken = |s: &str| notes.join(format!("{s}.transcript.md")).exists() || files.join(format!("{s}.{AUDIO}")).exists();
    (1..).map(|n| if n == 1 { stem.to_string() } else { format!("{stem} ({n})") }).find(|s| !taken(s)).unwrap()
}

/// The kept audio's extension: AAC on the Mac (afconvert), the WAV itself elsewhere.
const AUDIO: &str = if cfg!(target_os = "macos") { "m4a" } else { "wav" };

/// A track as the models take it, 16 kHz mono: afconvert on the Mac, which every Mac has.
#[cfg(target_os = "macos")]
fn at_16k(dir: &Path, name: &str, raw: &Path) -> Result<Vec<f32>, String> {
    let wav = dir.join(format!("{name}-16k.wav"));
    afconvert(&["-f", "WAVE", "-d", "LEI16@16000", "-c", "1"], raw, &wav)?;
    transcribe_rs::audio::read_wav_samples(&wav).map_err(|e| e.to_string())
}
/// A track as the models take it, 16 kHz mono: read and resampled here, Windows has no afconvert.
#[cfg(not(target_os = "macos"))]
fn at_16k(_: &Path, _: &str, raw: &Path) -> Result<Vec<f32>, String> { read_16k(raw) }

/// A WAV that `track` wrote (mono float at the device's rate, any channels taken as their average) at 16 kHz.
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn read_16k(path: &Path) -> Result<Vec<f32>, String> {
    let mut r = hound::WavReader::open(path).map_err(|e| e.to_string())?;
    let spec = r.spec();
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => r.samples::<f32>().collect::<Result<_, _>>(),
        hound::SampleFormat::Int => {
            let full = (1i64 << (spec.bits_per_sample - 1)) as f32;
            r.samples::<i32>().map(|s| s.map(|s| s as f32 / full)).collect::<Result<_, _>>()
        }
    }.map_err(|e| e.to_string())?;
    Ok(super::dictation::resample(&mono(&samples, spec.channels.max(1) as usize), spec.sample_rate, RATE as u32))
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

/// Whether a track holds at least 5 s of speech in all: less is a few sounds, not someone talking.
fn said_something(s: &[f32]) -> bool {
    speech_regions(s).iter().map(|(a, b)| b - a).sum::<usize>() >= 5 * RATE
}

/// The stretches of one track joined into windows for the model: the next one joins while the pause before it is at
/// most 5 s and the window stays within 25 s (what whisper takes in one go, its window is 30 s).
const WINDOW_PAUSE: usize = 5 * RATE;
const WINDOW_MAX: usize = 25 * RATE;
fn windows(regions: Vec<(usize, usize)>) -> Vec<(usize, usize)> {
    let mut out: Vec<(usize, usize)> = vec![];
    for (a, b) in regions {
        match out.last_mut() {
            Some(w) if a <= w.1 + WINDOW_PAUSE && b - w.0 <= WINDOW_MAX => w.1 = b,
            _ => out.push((a, b)),
        }
    }
    out
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

/// What Windows plays: its default output device, which cpal records through WASAPI loopback. A device opened as the
/// default follows Windows to another output during the recording. Nothing to undo, and no permission to ask.
#[cfg(windows)]
mod tap {
    use cpal::traits::HostTrait;
    pub struct Tap;
    impl Tap {
        pub fn create() -> Result<(Tap, cpal::Device), String> {
            cpal::default_host().default_output_device().map(|d| (Tap, d)).ok_or_else(|| "no output device".into())
        }
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod tap {
    pub struct Tap;
    impl Tap {
        pub fn create() -> Result<(Tap, cpal::Device), String> { Err("only on macOS and Windows".into()) }
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
    fn windows_join_stretches_up_to_25_s_and_keep_long_pauses_apart() {
        let s = |secs: f32| (secs * RATE as f32) as usize;
        // 2 s, 3 s pause, 2 s: one window; then a 10 s pause: a new one
        assert_eq!(windows(vec![(0, s(2.0)), (s(5.0), s(7.0)), (s(17.0), s(18.0))]), vec![(0, s(7.0)), (s(17.0), s(18.0))]);
        // ten stretches of 4 s with 1 s pauses: 25 s holds five
        let many: Vec<_> = (0..10).map(|i| (s(i as f32 * 5.0), s(i as f32 * 5.0 + 4.0))).collect();
        let w = windows(many);
        assert_eq!(w.len(), 2, "{w:?}");
        assert!(w.iter().all(|(a, b)| b - a <= 25 * RATE));
        assert!(windows(vec![]).is_empty());
    }

    #[test]
    fn down_to_16k_in_chunks_keeps_length_and_matches_one_go() {
        let second: Vec<f32> = (0..48_000).map(|i| (i as f32 * 0.01).sin()).collect();
        let (mut down, mut out) = (Down::new(48_000), vec![]);
        for chunk in second.chunks(512) { down.push(chunk, &mut out); }
        assert!((out.len() as i64 - 16_000).abs() <= 1, "{}", out.len());
        // ten minutes at 44.1 kHz in 512-sample chunks do not drift: the count follows the rate
        let (mut down, mut buf, mut total) = (Down::new(44_100), vec![], 0usize);
        for _ in 0..(600 * 44_100 / 512) { down.push(&[0.0; 512], &mut buf); total += buf.len(); buf.clear(); }
        assert!((total as i64 - (600 * 44_100 / 512 * 512) as i64 * 16_000 / 44_100).abs() <= 1, "{total}");
        let whole = super::super::dictation::resample(&second, 48_000, 16_000);
        assert!(out.iter().zip(&whole).all(|(a, b)| (a - b).abs() < 1e-4));
    }

    #[test]
    fn interleaved_frames_average_to_one_channel() {
        let got = mono(&[0.2, 0.4, -1.0, 1.0, 0.5, 0.25], 2);
        assert!(got.iter().zip([0.3, 0.0, 0.375]).all(|(a, b)| (a - b).abs() < 1e-6), "{got:?}");
        assert_eq!(mono(&[0.1, -0.2], 1), vec![0.1, -0.2]);
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("relay-audio-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
    fn sine(rate: u32, secs: f32, at: f32) -> Vec<f32> {
        (0..(rate as f32 * secs) as usize).map(|i| (std::f32::consts::TAU * 440.0 * i as f32 / rate as f32).sin() * at).collect()
    }
    fn wav(path: &Path, rate: u32, channels: u16, float: bool, frames: &[f32]) {
        let spec = if float { hound::WavSpec { channels, sample_rate: rate, bits_per_sample: 32, sample_format: hound::SampleFormat::Float } }
            else { hound::WavSpec { channels, sample_rate: rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int } };
        let mut w = hound::WavWriter::create(path, spec).unwrap();
        for s in frames {
            for _ in 0..channels { if float { w.write_sample(*s).unwrap() } else { w.write_sample((s * i16::MAX as f32) as i16).unwrap() } }
        }
        w.finalize().unwrap();
    }
    /// Within `tol` of a 440 Hz sine of amplitude `at` at 16 kHz, but for the last samples, which have no next one to
    /// interpolate towards.
    fn is_sine(got: &[f32], at: f32, tol: f32) -> bool {
        got.iter().enumerate().take(got.len().saturating_sub(16))
            .all(|(i, s)| (s - (std::f32::consts::TAU * 440.0 * i as f32 / 16_000.0).sin() * at).abs() < tol)
    }

    #[test]
    fn a_track_at_any_rate_reads_back_at_16k_with_its_pitch() {
        let dir = scratch("rates");
        // what track() writes: mono float, at rates that do not divide 16 kHz, at 48 kHz, and below 16 kHz
        for rate in [44_100, 22_050, 11_025, 48_000, 8_000] {
            let path = dir.join(format!("{rate}.wav"));
            wav(&path, rate, 1, true, &sine(rate, 1.0, 0.5));
            let got = read_16k(&path).unwrap();
            assert!((got.len() as i64 - 16_000).abs() <= 1, "{rate}: {}", got.len());
            assert!(is_sine(&got, 0.5, 0.02), "{rate}");
        }
        // a stereo 16-bit file averages its channels
        let path = dir.join("stereo.wav");
        wav(&path, 44_100, 2, false, &sine(44_100, 0.5, 0.5));
        let got = read_16k(&path).unwrap();
        assert!((got.len() as i64 - 8_000).abs() <= 1, "{}", got.len());
        assert!(is_sine(&got, 0.5, 0.02));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn two_tracks_at_their_own_rates_mix_into_one_16k_wav() {
        let dir = scratch("mix");
        // the microphone at 44.1 kHz for a second, the loopback at 48 kHz for half of one
        let (mic, out) = (dir.join("me.wav"), dir.join("others.wav"));
        wav(&mic, 44_100, 1, true, &sine(44_100, 1.0, 0.25));
        wav(&out, 48_000, 2, true, &sine(48_000, 0.5, 0.25));
        let (me, others) = (read_16k(&mic).unwrap(), read_16k(&out).unwrap());
        let mixed = dir.join("mixed.wav");
        write_mix(&mixed, &[&me, &others]).unwrap();
        let mut r = hound::WavReader::open(&mixed).unwrap();
        assert_eq!(r.spec(), hound::WavSpec { channels: 1, sample_rate: 16_000, bits_per_sample: 16, sample_format: hound::SampleFormat::Int });
        let got: Vec<f32> = r.samples::<i16>().map(|s| s.unwrap() as f32 / i16::MAX as f32).collect();
        assert_eq!(got.len(), me.len().max(others.len()));
        // the sum while both play, the microphone alone after: in tune, so twice as loud
        let want = |i: usize| me[i] + others.get(i).copied().unwrap_or(0.0);
        assert!(got.iter().enumerate().all(|(i, s)| (s - want(i)).abs() < 1e-3));
        assert!(is_sine(&got[..7_900], 0.5, 0.02));
        // louder than full scale is clipped, not wrapped
        write_mix(&mixed, &[&[0.8, -0.8], &[0.8, -0.8]]).unwrap();
        let loud: Vec<i16> = hound::WavReader::open(&mixed).unwrap().samples::<i16>().map(|s| s.unwrap()).collect();
        assert_eq!(loud, vec![i16::MAX, -i16::MAX]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn live_takes_a_window_once_nothing_can_join_it() {
        let tone = |secs: f32| (0..(secs * 16_000.0) as usize).map(|i| (i as f32 * 0.05).sin() * 0.3).collect::<Vec<f32>>();
        let quiet = |secs: f32| vec![0.0005f32; (secs * 16_000.0) as usize];
        // speech, then 3 s: the next words could still join it
        assert_eq!(next(&[tone(2.0), quiet(3.0)].concat()), Next::Wait);
        // 7 s of quiet after it: done
        assert!(matches!(next(&[tone(2.0), quiet(7.0)].concat()), Next::Speech(0, b) if b > 2 * RATE && b < 3 * RATE));
        // a full window and the talk goes on: the first is done
        assert!(matches!(next(&tone(40.0)), Next::Speech(0, b) if b <= WINDOW_MAX + RATE));
        // a long silence is skipped but for its last 5 s
        assert_eq!(next(&quiet(40.0)), Next::Skip(35 * RATE));
        assert_eq!(next(&quiet(10.0)), Next::Wait);
    }

    #[test]
    fn a_track_with_a_few_sounds_said_nothing() {
        let tone = |secs: f32| (0..(secs * 16_000.0) as usize).map(|i| (i as f32 * 0.05).sin() * 0.3).collect::<Vec<f32>>();
        let quiet = |secs: f32| vec![0.0005f32; (secs * 16_000.0) as usize];
        // two notification dings in ten minutes
        assert!(!said_something(&[quiet(300.0), tone(0.5), quiet(300.0), tone(0.5)].concat()));
        assert!(!said_something(&vec![0.0; 16_000 * 60]));
        assert!(said_something(&[quiet(60.0), tone(4.0), quiet(2.0), tone(3.0), quiet(60.0)].concat()));
    }

    #[test]
    fn language_is_guessed_from_stopwords_or_not_at_all() {
        let nl = "ik denk dat we het niet met een nieuwe planning kunnen doen omdat het veel te laat is voor de klant";
        let en = "I think that we should have this done before they want more from the team and that will be very good";
        assert_eq!(guess_language(nl), Some("nl"));
        assert_eq!(guess_language(en), Some("en"));
        // too few words, no stopwords, French and German (no list) and a tie say nothing
        assert_eq!(guess_language("dat het niet met een"), None);
        assert_eq!(guess_language("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu"), None);
        assert_eq!(guess_language("nous avons dit que les clients veulent une autre version pour la semaine prochaine dans le projet"), None);
        assert_eq!(guess_language("wir haben gesagt dass die Kunden eine andere Version für die nächste Woche im Projekt wollen"), None);
        assert_eq!(guess_language("dat het niet that with this alpha beta gamma delta epsilon zeta eta"), None);
    }

    #[test]
    fn language_locks_on_the_first_clear_window_and_stays() {
        let mut l = Language::default();
        l.see("dat het niet");
        assert_eq!(l.0, None);
        l.see("ik denk dat we het niet met een nieuwe planning kunnen doen omdat het veel te laat is voor de klant");
        assert_eq!(l.0.as_deref(), Some("nl"));
        l.see("I think that we should have this done before they want more from the team and that will be very good");
        assert_eq!(l.0.as_deref(), Some("nl"));
        // one given at the start is never replaced
        let mut given = Language(Some("fr".into()));
        given.see("ik denk dat we het niet met een nieuwe planning kunnen doen omdat het veel te laat is voor de klant");
        assert_eq!(given.0.as_deref(), Some("fr"));
    }

    #[test]
    fn the_meeting_of_a_recording_is_kept_beside_it() {
        let dir = std::env::temp_dir().join(format!("relay-meta-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(read_meta(&dir).is_none());
        write_meta(&dir, &json!({ "id": "u@1", "title": "Sync", "people": [] }), Some("nl")).unwrap();
        let m = read_meta(&dir).unwrap();
        assert_eq!((m["id"].as_str(), m["title"].as_str(), m["language"].as_str()), (Some("u@1"), Some("Sync"), Some("nl")));
        std::fs::remove_dir_all(&dir).ok();
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
        assert_eq!(safe_name("Northwind / status: Q4?"), "Northwind status Q4");
        assert_eq!(safe_name("  "), "Meeting");
    }

    #[test]
    fn a_transcript_names_its_meeting_note() {
        assert_eq!(transcript_front(Some("2026-11-04 Beacon \"sync\"")), "---\ntype: Transcript\nmeeting: \"[[2026-11-04 Beacon \\\"sync\\\"]]\"\n---\n");
        assert_eq!(transcript_front(None), "---\ntype: Transcript\n---\n");
    }
}
