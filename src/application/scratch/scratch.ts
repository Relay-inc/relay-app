import { t } from "../../shared/i18n";
import type { Scratch } from "../../domain/scratch/rules";
import * as backend from "../../infrastructure/backend";
import { toast } from "../navigation/navigation";
import { useScratchStore } from "./store";

// Scratch notes per project, plain text in the vault's .relay/notes. The open project's notes are loaded here; a note
// is only a file once it has text, and saves follow typing after a short pause.
const st = () => useScratchStore.getState();
const set = useScratchStore.setState;
const find = (key: string) => st().notes.find(note => note.key === key);

const timers = new Map<string, number>(); // notes with a save pending, by key
const writes = new Map<string, Promise<unknown>>(); // the last write of a note: the next one waits for it (and its id)
let counter = 0;
const fresh = (text = ""): Scratch => ({ key: `n${++counter}`, id: null, text, modified: Date.now() / 1000 });

export async function loadScratch(project: string) {
  await leave();
  set(draft => {
    draft.project = project;
    draft.notes = [];
    draft.open = "";
  });
  try {
    const list = await backend.scratchList(project);
    if (st().project !== project) return;
    const notes = list.map(file => ({ ...fresh(file.text), id: file.id, modified: file.modified }));
    set(draft => {
      draft.notes = notes;
      draft.open = notes[0]?.key ?? "";
    });
  } catch (err) {
    console.error(err);
  }
}

/** A new note; an empty one that exists is reused. */
export function newScratch() {
  const empty = st().notes.find(note => !note.text);
  if (empty) return void selectScratch(empty.key);
  const note = fresh();
  set(draft => {
    draft.notes.unshift(note);
  });
  selectScratch(note.key);
}

/** Leaves the open note: an empty one is dropped, a pending save goes out now. */
async function leave() {
  const note = find(st().open);
  if (!note) return;
  if (!note.text.trim()) await drop(note.key);
  else await flush(note.key);
}
export async function selectScratch(key: string) {
  if (st().open === key) return;
  await leave();
  set(draft => {
    draft.open = key;
  });
}

export function editScratch(key: string, text: string) {
  set(draft => {
    const note = draft.notes.find(x => x.key === key);
    if (!note) return;
    note.text = text;
    note.modified = Date.now() / 1000;
  });
  clearTimeout(timers.get(key));
  timers.set(
    key,
    window.setTimeout(() => flush(key), 400),
  );
}

function flush(key: string) {
  clearTimeout(timers.get(key));
  const note = find(key);
  if (!timers.delete(key) || !note) return writes.get(key);
  const { project } = st();
  const done = (writes.get(key) ?? Promise.resolve())
    // the id of the write before this one, if it was the first
    .then(() => backend.scratchSave(project, find(key)?.id ?? null, note.text))
    .then(id =>
      set(draft => {
        const saved = draft.notes.find(x => x.key === key);
        if (saved) saved.id = id;
      }),
    )
    .catch(err => console.error(err));
  writes.set(key, done);
  return done;
}

async function drop(key: string) {
  const { project } = st();
  const note = find(key);
  clearTimeout(timers.get(key));
  timers.delete(key);
  await writes.get(key);
  writes.delete(key);
  const id = find(key)?.id ?? note?.id;
  set(draft => {
    draft.notes = draft.notes.filter(x => x.key !== key);
    if (draft.open === key) draft.open = "";
  });
  if (id) await backend.scratchDelete(project, id).catch(err => console.error(err));
}

/** Delete the open note; the toast brings it back with its text. */
export async function deleteScratch(key: string) {
  const { project } = st();
  const note = find(key);
  if (!note) return;
  const index = st().notes.indexOf(note);
  await drop(key);
  if (!note.text.trim()) return;
  toast(t("notes.deleted"), async () => {
    if (st().project !== project) return;
    const back = fresh(note.text);
    set(draft => {
      draft.notes.splice(Math.min(index, draft.notes.length), 0, back);
    });
    timers.set(back.key, 0); // a save is pending: it was a file once, now it is written again as a new one
    await flush(back.key);
    await selectScratch(back.key);
  });
}
