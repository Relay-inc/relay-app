import type { Worker } from "../orchestrator/types";
import { needOf } from "../orchestrator/rules.ts";
import { untrusted } from "../../shared/prompts.ts";
import { answerable, inReview, isPlan, prsOf, ticketOf } from "./rules.ts";

// What the runner tells a pipeline's conversation after a pass (application/pipeline/runner.ts digest): the pipeline as
// the panel shows it, built the same way every time from the board columns and the workers, so a pass that changed
// nothing gives the same facts and no message. The coordinator turns it into a few lines for the user (its prompt,
// prompts/orchestrator/pipeline.md). Ticket and agent text goes in untrusted blocks, Relay's own facts around them.

/** A panel row's place (rules.ts placeOf) with the column's name on the board. */
type Place = { col: "busy" | "review" | "input"; moved: boolean; name: string };
/** The pipeline as the panel has it (runner.ts pipelinePanel). */
export type DigestIn = {
  tickets: Worker[];
  places: Record<string, Place>;
  toPick: string[];
  bounced: {
    number: string;
    title: string;
    url: string;
    why: "bare" | "unclear" | "failed";
    questions: string[];
    reason: string;
  }[];
  holding: "" | "pl.usedUp" | "pl.stalled";
  paused: boolean;
};
/** waits: on the user (a question, a plan, a pre-flight's questions). stuck: on nothing the user was asked, but going
 *  nowhere. runs: building, in review, with a person, or waiting for its agent. */
export type DigestRow = {
  group: "waits" | "stuck" | "runs";
  /** how the conversation names it to its tools: the number, else the worker key */
  ref: string;
  key: string; // its worker, "" for a ticket sent back before it started
  title: string;
  url: string;
  column: string;
  /** Relay's own words for where it stands */
  state: string;
  /** the agent's (or the pre-flight's) question and the answers it offers, a plan for approval */
  question: string;
  options: string[];
  plan: boolean;
  /** what the agent said it did, for a run that went nowhere */
  summary: string;
  prs: string[];
  /** a running agent's step, left out of what counts as news */
  progress: string;
};

const COLUMN = { busy: "Busy", review: "Review", input: "Input" } as const;

function workerRow(w: Worker, place: Place, toPick: boolean): DigestRow {
  const ticket = ticketOf(w)!;
  const row: DigestRow = {
    group: "runs",
    ref: ticket.number || w.key,
    key: w.key,
    title: ticket.title || w.title,
    url: ticket.url,
    column: place.name || COLUMN[place.col],
    state: "",
    question: "",
    options: [],
    plan: false,
    summary: "",
    prs: prsOf(w),
    progress: w.step ? `step ${w.step.done} of ${w.step.total}${w.step.note ? `: ${w.step.note}` : ""}` : "",
  };
  const need = place.moved ? null : needOf(w);
  if (w.state === "running") {
    if (w.stalled) return { ...row, group: "stuck", state: `its agent ${w.stalled}` };
    return { ...row, state: w.phase ? "Relay checks the agent's done" : "its agent builds" };
  }
  if (toPick) return { ...row, state: "answered, waits in the pick column for its agent" };
  if (place.moved) return { ...row, state: "a person moved it on the board, it asks nothing anymore" };
  if (inReview(w)) return { ...row, state: "its PR waits for review" };
  if (!answerable(place)) return { ...row, state: "its run ended, Relay puts it on the board" };
  if (need?.kind === "ask") {
    const plan = isPlan(need.question);
    return {
      ...row,
      group: "waits",
      state: plan ? "a plan for approval" : "the agent asks",
      question: need.question,
      options: need.options,
      plan,
    };
  }
  const summary = w.report?.summary ?? "";
  if (w.state === "silent") return { ...row, group: "stuck", state: "its agent ended its turn without a report" };
  if (w.state === "done" && w.pr_error)
    return {
      ...row,
      group: "stuck",
      state: `done, but ${row.prs.length ? "not every repo got its PR" : "no PR"}: ${w.pr_error}`,
      summary,
    };
  if (w.state === "stopped") return { ...row, group: "stuck", state: "its agent was stopped, a person has it" };
  return {
    ...row,
    group: "stuck",
    state: w.state === "failed" ? "the run failed" : "the run ended without a question",
    summary,
  };
}

/** Every ticket of the pipeline, as the panel has them. */
export function digestRows(d: DigestIn): DigestRow[] {
  const rows = d.tickets.map(w =>
    workerRow(w, d.places[w.key] ?? { col: "busy", moved: false, name: "" }, d.toPick.includes(w.key)),
  );
  for (const b of d.bounced) {
    const base = {
      ref: b.number,
      key: "",
      title: b.title,
      url: b.url,
      column: COLUMN.input,
      options: [],
      plan: false,
      summary: "",
      prs: [],
      progress: "",
    };
    if (b.why === "failed")
      rows.push({ ...base, group: "stuck", state: `it could not start: ${b.reason}`, question: "" });
    else
      rows.push({
        ...base,
        group: "waits",
        state:
          b.why === "bare"
            ? "sent back before it started: the ticket has nothing to build from"
            : "sent back before it started, with questions",
        question: b.questions.join("\n"),
      });
  }
  return rows;
}

const HOLDING = {
  "pl.usedUp": "the plan's limit is used up",
  "pl.stalled": "the last runs all ended without a PR",
} as const;
/** What counts as news: each ticket's group, column, state and question, the PRs, the pause and why it holds. Not a
 *  running agent's step. */
export const digestSig = (rows: DigestRow[], d: Pick<DigestIn, "holding" | "paused">) =>
  JSON.stringify([d.paused, d.holding, rows.map(r => [r.ref, r.group, r.column, r.state, r.question, r.prs])]);

/** What waits on the user, for the sidebar's count and the banner. */
export const waiting = (rows: DigestRow[]) => rows.filter(r => r.group === "waits");

/** The in-app link that opens a worker's conversation (shared/markdown.ts draws it, ui/app opens it). */
export const workerLink = (key: string) => `relay://worker?key=${key}`;

function rowText(r: DigestRow) {
  const name = r.ref === r.key ? r.key : `#${r.ref}`;
  const links = [
    r.url && `[ticket](${r.url})`,
    r.key && `[agent](${workerLink(r.key)})`,
    ...r.prs.map(pr => `[PR](${pr})`),
  ];
  const head = `- ${name}, in ${r.column}: ${r.state}${r.progress ? ` (${r.progress})` : ""}. ${links.filter(Boolean).join(" · ")}`;
  const said = [
    r.title,
    r.question && `${r.plan ? "Plan" : "Question"}: ${r.question}`,
    r.options.length ? `Options: ${r.options.join(" | ")}` : "",
    r.summary && `The agent's summary: ${r.summary}`,
  ];
  return `${head}\n${untrusted("ticket", said.filter(Boolean).join("\n"))}`;
}

/** The facts for the pipeline's conversation: a first line that says it all folded, then what waits on the user, what
 *  is stuck, what Relay did by itself this pass (`did`, Relay's own lines) and what runs. A part without lines is left
 *  out. */
export function digestText(project: string, rows: DigestRow[], did: string[], d: Pick<DigestIn, "holding" | "paused">) {
  const of = (g: DigestRow["group"]) => rows.filter(r => r.group === g);
  const counts = [
    of("waits").length && `${of("waits").length} waiting on you`,
    of("stuck").length && `${of("stuck").length} stuck`,
    did.length && `${did.length} done by Relay`,
    of("runs").length && `${of("runs").length} running`,
  ].filter(Boolean);
  const head = [`Pipeline ${project}: ${counts.length ? counts.join(", ") : "no tickets"}.`];
  if (d.paused) head.push("The pipeline is paused: it takes no new tickets, ended runs still land on the board.");
  else if (d.holding) head.push(`The pipeline takes no new tickets: ${HOLDING[d.holding]}.`);
  const part = (title: string, lines: string[]) => (lines.length ? [`${title}\n${lines.join("\n")}`] : []);
  return [
    head.join("\n"),
    ...part("Waiting on you:", of("waits").map(rowText)),
    ...part("Stuck:", of("stuck").map(rowText)),
    ...part(
      "Done by Relay:",
      did.map(line => `- ${line}`),
    ),
    ...part("Running:", of("runs").map(rowText)),
  ].join("\n\n");
}
