import { ticketByRef, ticketOf, type AnswerKind } from "../../domain/pipeline/rules";
import type { PipeToolCall } from "../../domain/pipeline/types";
import type { Worker } from "../../domain/orchestrator/types";
import * as backend from "../../infrastructure/backend";
import {
  answerTicket,
  createTicket,
  ignoreTicket,
  pausePipeline,
  pipelineFacts,
  pipelinePanel,
  postedWords,
  takeOver,
  unignoreTicket,
} from "./runner";

// The tools of a pipeline's conversation (src-tauri orch.rs pipe_call): run here with the runner's own functions, so
// the board has one set of rules. The backend already refused an action in a turn Relay started or on a ticket
// the user's message does not name, and had the user click a card where one is needed. What comes
// back is for the model, in English like the backend's own tool answers, and says exactly what was done, so the reply
// to the user shows it.

const KINDS: AnswerKind[] = ["answer", "approve", "changes", "retry"];
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
// a ticket as the tool answers name it: its number and title
const nameOf = (to: { worker: Worker } | { card: { number: string; title: string } }) =>
  "worker" in to
    ? `#${ticketOf(to.worker)?.number ?? to.worker.key} "${ticketOf(to.worker)?.title ?? to.worker.title}"`
    : `#${to.card.number} "${to.card.title}"`;

async function run({ project, tool, args }: PipeToolCall): Promise<string> {
  const panel = pipelinePanel(project);
  const ticket = () => {
    const found = ticketByRef(panel.tickets, panel.bounced, str(args.ticket));
    if (!found)
      throw new Error(
        `no single ticket ${str(args.ticket)} in this pipeline: use the number or worker key from Relay's facts`,
      );
    return found;
  };
  if (tool === "tickets") return pipelineFacts(project);
  if (tool === "answer") {
    const kind = args.kind as AnswerKind;
    if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(", ")}`);
    const to = ticket();
    const said: string[] = [];
    const ok = await answerTicket(project, to, kind, str(args.text), text => said.push(text));
    if (!ok)
      throw new Error(said.join("\n") || "the answer did not go through: answer and changes need the user's words");
    const posted = postedWords(kind, str(args.text));
    return [`Done (${kind}) on ${nameOf(to)}: posted on the ticket as a comment: "${posted}".`, ...said].join("\n");
  }
  if (tool === "take_over") {
    const found = ticket();
    if (!("worker" in found) || found.worker.state !== "running")
      throw new Error(`the agent of ${nameOf(found)} does not run`);
    if (!(await takeOver(found.worker))) throw new Error(`the agent of ${nameOf(found)} could not be stopped`);
    return `Stopped the agent ${found.worker.key} of ${nameOf(found)}: the ticket goes to a person. Nothing was posted on it by this tool.`;
  }
  if (tool === "ignore") {
    // also one still waiting in the pick column: the user may take it on themselves before an agent does
    const found = ticketByRef(panel.tickets, [...panel.bounced, ...(panel.waiting?.tickets ?? [])], str(args.ticket));
    if (!found)
      throw new Error(
        `no single ticket ${str(args.ticket)} in this pipeline: use the number or worker key from Relay's facts`,
      );
    await ignoreTicket(project, found);
    return `Ignored ${nameOf(found)}: its agent stopped if it ran, and the pipeline leaves the ticket alone (no pick-up, no moves, no PR follow-up) until the user unignores it. Nothing was posted on it.`;
  }
  if (tool === "unignore") {
    const ref = str(args.ticket).replace(/^#/, "");
    const hits = panel.ignored.filter(x => x.number === ref || x.id === ref);
    if (hits.length !== 1)
      throw new Error(`no single ignored ticket ${str(args.ticket)}: the \`tickets\` tool lists them`);
    await unignoreTicket(project, hits[0].id);
    return `Unignored ${nameOf({ card: hits[0] })}: the pipeline works on it again from where it was.`;
  }
  if (tool === "pause") {
    const paused = args.paused === true;
    const stop = paused && args.stop === true;
    const running = panel.tickets.filter(w => w.state === "running");
    const failed = await pausePipeline(project, paused, stop);
    if (failed) throw new Error(failed);
    if (!paused) return "The pipeline goes on: it takes new tickets again.";
    return stop
      ? `The pipeline is paused and ${running.length} running agent(s) stopped: ${running.map(w => `#${ticketOf(w)?.number ?? w.key}`).join(", ") || "none"}.`
      : "The pipeline is paused: no new tickets, running agents finish their step.";
  }
  if (tool === "create_ticket") {
    const title = str(args.title);
    if (!title) throw new Error("a ticket needs a title");
    const made = await createTicket(project, title, str(args.description), args.start === true);
    return `Made ticket ${made.number ? `#${made.number} ` : ""}"${title}" on the board in ${made.column}${str(args.description) ? ", with the description as given" : ", without a description"}${made.url ? `: ${made.url}` : ""}.`;
  }
  throw new Error(`unknown tool ${tool}`);
}

/** A pipeline conversation's tool call, answered to the backend whatever happens (it waits for it). */
export async function onPipeTool(call: PipeToolCall) {
  const answer = await run(call).then(
    text => ({ ok: true, text }),
    e => ({ ok: false, text: String((e as Error)?.message ?? e) }),
  );
  await backend.orchPipeDone(call.id, answer.ok, answer.text).catch(() => {});
}
