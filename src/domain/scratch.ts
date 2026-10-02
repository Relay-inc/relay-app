import { invoke } from "@tauri-apps/api/core";
import { t } from "../core/i18n";
import { changed } from "../core/store";
import { toast } from "./navigation";

// Scratch notes per project, plain text in the vault's .relay/notes. The open project's notes are loaded here; a note
// is only a file once it has text, and saves follow typing after a short pause.
export type Scratch = { id: string | null; text: string; modified: number };
export const scratch = { project: "", notes: [] as Scratch[], open: null as Scratch | null };

const timers = new Map<Scratch, number>();
const writes = new Map<Scratch, Promise<unknown>>();

export const title = (note: Scratch) => note.text.trim().split("\n")[0].slice(0, 80) || t("notes.untitled");

export async function loadScratch(project: string) {
  await leave();
  scratch.project = project;
  scratch.notes = [];
  scratch.open = null;
  changed();
  try {
    const list = await invoke<{ id: string; text: string; modified: number }[]>("scratch_list", { project });
    if (scratch.project !== project) return;
    scratch.notes = list;
    scratch.open = list[0] ?? null;
  } catch (err) {
    console.error(err);
  }
  changed();
}

export function newScratch() {
  const empty = scratch.notes.find(n => !n.text);
  if (empty) {
    select(empty);
    return;
  }
  const note: Scratch = { id: null, text: "", modified: Date.now() / 1000 };
  scratch.notes.unshift(note);
  select(note);
}

/** Leaves the open note: an empty one is dropped, a pending save goes out now. */
async function leave() {
  const note = scratch.open;
  if (!note) return;
  if (!note.text.trim()) await drop(note);
  else await flush(note);
}
export async function select(note: Scratch) {
  if (scratch.open === note) return;
  await leave();
  scratch.open = note;
  changed();
}

export function edit(note: Scratch, text: string) {
  note.text = text;
  note.modified = Date.now() / 1000;
  clearTimeout(timers.get(note));
  timers.set(
    note,
    window.setTimeout(() => flush(note), 400),
  );
  changed();
}

function flush(note: Scratch) {
  clearTimeout(timers.get(note));
  if (!timers.delete(note)) return writes.get(note);
  const { project } = scratch;
  const text = note.text;
  const done = (writes.get(note) ?? Promise.resolve())
    .then(() => invoke<string>("scratch_save", { project, id: note.id, text }))
    .then(id => void (note.id = id))
    .catch(err => console.error(err));
  writes.set(note, done);
  return done;
}

async function drop(note: Scratch) {
  clearTimeout(timers.get(note));
  timers.delete(note);
  await writes.get(note);
  writes.delete(note);
  scratch.notes = scratch.notes.filter(n => n !== note);
  if (scratch.open === note) scratch.open = null;
  changed();
  if (note.id)
    await invoke("scratch_delete", { project: scratch.project, id: note.id }).catch(err => console.error(err));
}

export async function deleteScratch(note: Scratch) {
  const { project } = scratch;
  const text = note.text;
  const index = scratch.notes.indexOf(note);
  await drop(note);
  if (!text.trim()) return;
  toast(t("notes.deleted"), async () => {
    if (scratch.project !== project) return;
    const back: Scratch = { id: null, text, modified: Date.now() / 1000 };
    scratch.notes.splice(Math.min(index, scratch.notes.length), 0, back);
    timers.set(back, 0);
    await flush(back);
    await select(back);
  });
}
