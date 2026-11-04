import { tasksIn, type Task } from "./meeting-view.ts";

// The briefing's fixed shape (`## Briefing` of a meeting note): the prep writes these `###` sections, in the meeting's
// language, and the Meeting view draws them as blocks. A briefing that does not have them (an older, free-form one) is
// drawn as plain markdown.

export type Part = "goal" | "people" | "since" | "threads" | "points";
export const PARTS: readonly Part[] = ["goal", "people", "since", "threads", "points"];
export type Words = {
  heading: Record<Part, string>;
  from: string; // "from [[note]]" under Since last time
  lastMet: string; // "last met 2026-10-28" after a person
  done: string; // "done 2026-10-30" after a finished step
};
/** The words of the shape per language: the one place the heading names live. */
export const WORDS: Record<string, Words> = {
  en: {
    heading: { goal: "Goal", people: "People", since: "Since last time", threads: "Threads", points: "My points" },
    from: "from",
    lastMet: "last met",
    done: "done",
  },
  nl: {
    heading: {
      goal: "Doel",
      people: "Mensen",
      since: "Sinds de vorige keer",
      threads: "Threads",
      points: "Mijn punten",
    },
    from: "van",
    lastMet: "laatst ontmoet",
    done: "klaar",
  },
  fr: {
    heading: {
      goal: "Objectif",
      people: "Personnes",
      since: "Depuis la dernière fois",
      threads: "Fils",
      points: "Mes points",
    },
    from: "de",
    lastMet: "dernière rencontre",
    done: "fait",
  },
  de: {
    heading: {
      goal: "Ziel",
      people: "Personen",
      since: "Seit dem letzten Mal",
      threads: "Threads",
      points: "Meine Punkte",
    },
    from: "von",
    lastMet: "zuletzt getroffen",
    done: "erledigt",
  },
};
/** The words for a language code, Dutch's when it is none of ours (the vault's own language). */
export const wordsFor = (code: string | undefined | null) => WORDS[code ?? ""] ?? WORDS.nl;

const norm = (s: string) => s.trim().toLowerCase();
/** Which part a heading names, in any of the languages. */
export function partOf(heading: string): Part | null {
  for (const words of Object.values(WORDS))
    for (const part of PARTS) if (norm(words.heading[part]) === norm(heading)) return part;
  return null;
}
/** Whether a heading is "My points", in any language: the Live step's card reads the same one. */
export const isPointsHeading = (heading: string) => partOf(heading) === "points";

/** The shape as the prompt shows it to the model, in `code`'s language. */
export function shapeIn(code: string | undefined | null) {
  const w = wordsFor(code);
  return [
    `### ${w.heading.goal}`,
    "<one line>",
    "",
    `### ${w.heading.people}`,
    `- [[Name]]: role · ${w.lastMet} YYYY-MM-DD`,
    "",
    `### ${w.heading.since}`,
    `${w.from} [[previous note]]`,
    "- [ ] open next step",
    `- [x] finished next step · ${w.done} YYYY-MM-DD`,
    "",
    `### ${w.heading.threads}`,
    "- subject · YYYY-MM-DD · `mail:<account>:<id>`",
    "",
    `### ${w.heading.points}`,
    "- [ ] ",
  ].join("\n");
}

// ---------- reading it
export type Person = { name: string; link: boolean; role: string; lastMet: string };
export type Thread = { subject: string; date: string; key: string };
export type Step = { n: number; text: string; done: boolean; doneOn: string };
export type Shaped = {
  goal: string;
  people: Person[];
  since: { from: string; steps: Step[] };
  threads: Thread[];
  points: Step[];
};

const alternatives = (pick: (w: Words) => string) => Object.values(WORDS).map(w => pick(w).replace(/\s+/g, "\\s+"));
const LAST_MET = new RegExp(`^(?:${alternatives(w => w.lastMet).join("|")})\\s+(\\d{4}-\\d\\d-\\d\\d)$`, "i");
const DONE = new RegExp(`\\s*·\\s*(?:${alternatives(w => w.done).join("|")})\\s+(\\d{4}-\\d\\d-\\d\\d)\\s*$`, "i");
const FROM = new RegExp(`^(?:${alternatives(w => w.from).join("|")})\\s+\\[\\[(.+?)\\]\\]$`, "i");

function sections(briefing: string) {
  const out: { part: Part | null; lines: string[] }[] = [];
  for (const line of briefing.split("\n")) {
    const heading = /^###\s+(.*?)\s*#*$/.exec(line);
    if (heading) out.push({ part: partOf(heading[1]), lines: [] });
    else out[out.length - 1]?.lines.push(line);
  }
  return out;
}
const bullets = (lines: string[]) =>
  lines.flatMap(line => (/^\s*[-*] /.test(line) ? [line.replace(/^\s*[-*] /, "").trim()] : []));

function person(bullet: string): Person {
  const [head, ...rest] = bullet.split(" · ");
  const m = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\](?::\s*(.*))?$/.exec(head);
  const named = m ? { name: (m[2] ?? m[1]).trim(), link: true, role: m[3] ?? "" } : null;
  const [name, ...role] = head.split(": ");
  const base = named ?? { name: name.trim(), link: false, role: role.join(": ") };
  let lastMet = "";
  const roles = [base.role];
  for (const part of rest) {
    const met = LAST_MET.exec(part.trim());
    if (met) lastMet = met[1];
    else roles.push(part.trim());
  }
  return { ...base, role: roles.filter(Boolean).join(" · "), lastMet };
}
function threadOf(bullet: string): Thread | null {
  const m = /^(.*?) · (\d{4}-\d\d-\d\d)(?: · `?(mail:[^`\s]+)`?)?$/.exec(bullet);
  return m ? { subject: m[1].trim(), date: m[2], key: m[3] ?? "" } : null;
}
function step(task: Task): Step {
  const m = DONE.exec(task.text);
  return {
    n: task.n,
    text: m ? task.text.slice(0, m.index).trim() : task.text.trim(),
    done: task.done,
    doneOn: m?.[1] ?? "",
  };
}

/** The briefing as blocks when it has the fixed shape (at least three of its sections, in any language); null for a
 *  free-form one. `n` of a step is its place among all tasks of the briefing, what a tick writes to. */
export function parseBriefing(briefing: string): Shaped | null {
  const found = sections(briefing);
  if (new Set(found.map(s => s.part).filter(Boolean)).size < 3) return null;
  const of = (part: Part) => found.find(s => s.part === part)?.lines ?? [];
  const tasks = tasksIn(briefing);
  const inPart = (part: Part) => tasks.filter(task => partOf(task.section) === part).map(step);
  const sinceLines = of("since");
  const from = FROM.exec(sinceLines.map(l => l.trim()).find(Boolean) ?? "")?.[1] ?? "";
  return {
    goal: of("goal").join("\n").trim(),
    people: bullets(of("people")).map(person),
    since: { from, steps: inPart("since") },
    threads: bullets(of("threads")).flatMap(b => threadOf(b) ?? []),
    points: inPart("points"),
  };
}

// ---------- My points, and a re-run of the prep
/** Index of each task line and the section it is under, for the edits below. */
function taskLines(lines: string[]) {
  let section = "";
  let n = -1;
  return lines
    .map((line, i) => {
      const heading = /^#{1,6}\s+(.*?)\s*#*$/.exec(line) ?? /^\*\*(.+?)\*\*:?$/.exec(line);
      if (heading) section = heading[1];
      return /^\s*[-*+] \[[ xX]\] /.test(line) ? { i, n: ++n, section } : null;
    })
    .flatMap(x => x ?? []);
}
/** The briefing with a new point `- [ ] text` in My points: after point `after` (its `n`), else at the end of the
 *  section; a briefing without the section gets it (in `code`'s language) at the end. */
export function addPoint(briefing: string, text: string, after: number | null, code?: string | null) {
  const lines = briefing.split("\n");
  const mine = taskLines(lines).filter(t => isPointsHeading(t.section));
  const item = `- [ ] ${text}`;
  const at = after === null ? mine[mine.length - 1] : mine.find(t => t.n === after);
  if (at) {
    lines.splice(at.i + 1, 0, item);
    return lines.join("\n");
  }
  const heading = lines.findIndex(line => /^###\s+/.test(line) && isPointsHeading(line.replace(/^###\s+/, "")));
  if (heading >= 0) {
    let end = heading + 1;
    while (end < lines.length && !/^#{1,6}\s/.test(lines[end])) end++;
    while (end > heading + 1 && !lines[end - 1].trim()) end--;
    lines.splice(end, 0, item);
    return lines.join("\n");
  }
  return `${briefing.replace(/\n*$/, "\n\n")}### ${wordsFor(code).heading.points}\n${item}`;
}
/** The text of point `n` replaced. */
export function editPoint(briefing: string, n: number, text: string) {
  const lines = briefing.split("\n");
  const at = taskLines(lines).find(t => t.n === n);
  if (at) lines[at.i] = lines[at.i].replace(/^(\s*[-*+] \[[ xX]\] ).*$/, `$1${text}`);
  return lines.join("\n");
}
/** Point `n` taken out. */
export function removePoint(briefing: string, n: number) {
  const lines = briefing.split("\n");
  const at = taskLines(lines).find(t => t.n === n);
  if (at) lines.splice(at.i, 1);
  return lines.join("\n");
}

/** What a prep is asked to keep: the meeting it is for (enough to find its note again) and what is the user's in the
 *  briefing it replaces, their points and the steps they ticked. Kept with the prep's conversation until it has been
 *  merged back. */
export type PrepRun = {
  meeting: { id: string; title: string; start: string };
  points: { text: string; done: boolean }[];
  ticked: string[];
  hash: string; // of the briefing it replaces: while the section still has it, the prep has not written yet
  /** The meeting note when the prep started (null: there was none), for the Changes feed's before. A run kept from before
   *  this existed has none and records nothing. */
  before?: string | null;
};
/** A short hash of a briefing's text (djb2), to tell whether a prep has rewritten it. */
export function sectionHash(briefing: string) {
  let h = 5381;
  for (let i = 0; i < briefing.length; i++) h = ((h << 5) + h + briefing.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
/** What a prep's turn end means for its snapshot: `wait` while the briefing is still the one it was asked about (it
 *  has not written yet, it may be asking something), `clear` when the note has no briefing, `merge` once it differs. */
export function prepState(run: Pick<PrepRun, "hash">, now: string | null): "wait" | "clear" | "merge" {
  if (now === null) return "clear";
  return sectionHash(now) === run.hash ? "wait" : "merge";
}
/** What of a briefing is the user's, for a prep to keep; null when the briefing has none of it (or no shape). */
export function keepFrom(briefing: string, meeting: PrepRun["meeting"]): PrepRun | null {
  const shaped = parseBriefing(briefing);
  if (!shaped) return null;
  const points = shaped.points.filter(p => p.text.trim()).map(p => ({ text: p.text, done: p.done }));
  const ticked = shaped.since.steps.filter(s => s.done).map(s => s.text);
  return points.length || ticked.length ? { meeting, points, ticked, hash: sectionHash(briefing) } : null;
}

/** The run a prep starts with: what is the user's in the briefing it replaces (nothing, for a briefing without any or a
 *  first one) and the note as it was, which the Changes feed shows the prep's write against. */
export function prepRunFor(briefing: string, meeting: PrepRun["meeting"], note: string | null): PrepRun {
  const run = keepFrom(briefing, meeting) ?? { meeting, points: [], ticked: [], hash: sectionHash(briefing) };
  return { ...run, before: note };
}

/** The briefing a prep wrote, with what the user owned put back: their points as they were (the new empty list is
 *  replaced) and the steps of Since last time they ticked still ticked, found by their text. A text that is not a shaped
 *  briefing is left alone. Running it again on its own result changes nothing. */
export function mergePrep(keep: Pick<PrepRun, "points" | "ticked">, fresh: string) {
  if (!parseBriefing(fresh)) return fresh;
  const ticked = new Set(keep.ticked.map(text => text.toLowerCase()));
  const own = keep.points.map(p => `- [${p.done ? "x" : " "}] ${p.text}`);
  let section = "";
  let hasPoints = false;
  let skipping = false;
  const merged: string[] = [];
  for (const line of fresh.split("\n")) {
    const heading = /^###\s+(.*?)\s*#*$/.exec(line);
    if (heading) {
      section = heading[1];
      skipping = false;
      if (isPointsHeading(section)) {
        hasPoints = true;
        skipping = own.length > 0; // the new, empty list is replaced by the user's
        merged.push(line, ...own);
        continue;
      }
    }
    if (skipping) {
      if (/^\s*[-*] /.test(line)) continue;
      if (!line.trim()) {
        merged.push(line);
        continue;
      }
      skipping = false;
    }
    const task = /^(\s*[-*+] \[)([ xX])(\] )(.*)$/.exec(line);
    if (
      task &&
      partOf(section) === "since" &&
      task[2] === " " &&
      ticked.has(task[4].replace(DONE, "").trim().toLowerCase())
    )
      merged.push(`${task[1]}x${task[3]}${task[4]}`);
    else merged.push(line);
  }
  const out = merged.join("\n");
  if (hasPoints || !own.length) return out;
  const code = Object.entries(WORDS).find(([, w]) => fresh.includes(`### ${w.heading.goal}`))?.[0];
  return `${out.replace(/\n*$/, "\n\n")}### ${wordsFor(code).heading.points}\n${own.join("\n")}`;
}
