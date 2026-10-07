import { isQuestion } from "../../conversations/rules.ts";
import { actionSet, ago } from "./common.ts";
import type { SubjectDef } from "./types.ts";

export type AskAct = "open";

/** An agent asks a permission or a question. It answers in its own card, so it has no Enter or Backspace. */
export const ask: SubjectDef<"ask", AskAct> = {
  kinds: { ask: { est: 2, rank: 0, icon: "agent", waits: true } },
  labelKey: entry => (isQuestion(entry.subject.request) ? "today.kind.question" : "today.kind.ask"),
  entries: (snap, w, now) =>
    snap.pending.map(request => {
      const question = isQuestion(request) ? request.input.questions?.[0]?.question : "";
      const since = snap.pendingAt[request.id] ?? now;
      const chat = snap.chats[request.project];
      return {
        kind: "ask",
        id: `ask:${request.id}`,
        at: since,
        title: question || w.t("today.allow", { tool: request.tool_name }),
        where: chat?.label ?? request.project,
        why: w.t("today.waiting", { ago: ago(since, now, w) }),
        tone: "late",
        project: chat?.project ?? null,
        subject: { type: "ask", request, chat: request.project },
      };
    }),
  actions: (_entry, _flags, w) => actionSet([{ id: "open", label: w.t("wait.open"), icon: "chat" }], null, null),
};
