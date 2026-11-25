import { ticketByRef, type AnswerKind } from "../../domain/pipeline/rules";
import type { PipeToolCall } from "../../domain/pipeline/types";
import * as backend from "../../infrastructure/backend";
import { answerTicket, createTicket, pausePipeline, pipelineFacts, pipelinePanel, takeOver } from "./runner";

// The tools of a pipeline's conversation (src-tauri orch.rs pipe_call): run here with the functions the pipeline panel
// uses, so the board has one set of rules. The backend already refused an action in a turn Relay started. What comes
// back is for the model, in English like the backend's own tool answers.

const KINDS: AnswerKind[] = ["answer", "approve", "changes", "retry"];
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

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
    const said: string[] = [];
    const ok = await answerTicket(project, ticket(), kind, str(args.text), text => said.push(text));
    if (!ok)
      throw new Error(said.join("\n") || "the answer did not go through: answer and changes need the user's words");
    return ["The user's words are on the ticket.", ...said].join("\n");
  }
  if (tool === "take_over") {
    const found = ticket();
    if (!("worker" in found) || found.worker.state !== "running") throw new Error("its agent does not run");
    if (!(await takeOver(found.worker))) throw new Error("the agent could not be stopped");
    return "Its agent stopped: the ticket goes to a person.";
  }
  if (tool === "pause") {
    const paused = args.paused === true;
    const failed = await pausePipeline(project, paused, paused && args.stop === true);
    if (failed) throw new Error(failed);
    return paused ? "The pipeline is paused." : "The pipeline goes on.";
  }
  if (tool === "create_ticket") {
    const title = str(args.title);
    if (!title) throw new Error("a ticket needs a title");
    const made = await createTicket(project, title, str(args.description), args.start === true);
    return `Ticket ${made.number ? `#${made.number} ` : ""}"${title}" is on the board in ${made.column}${made.url ? `: ${made.url}` : ""}.`;
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
