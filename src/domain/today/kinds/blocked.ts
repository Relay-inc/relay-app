import { actionSet } from "./common.ts";
import type { SubjectDef } from "./types.ts";

export type BlockedAct = "attach" | "stop" | "hide";

/** A background session in the terminal waits. */
export const blocked: SubjectDef<"blocked", BlockedAct> = {
  kinds: { blocked: { est: 2, rank: 3, icon: "term", waits: true } },
  entries: (snap, w, now) =>
    snap.agents
      .filter(
        agent => agent.kind === "background" && agent.state === "blocked" && !snap.hiddenAgents.includes(agent.id),
      )
      .map(session => ({
        kind: "blocked",
        id: `blocked:${session.id}`,
        at: session.startedAt ? Date.parse(session.startedAt) : now,
        title: session.name || w.t("today.blockedSession"),
        where: w.t("today.terminal"),
        why: w.t("today.blocked"),
        tone: "soon",
        project: null,
        subject: { type: "blocked", session },
      })),
  actions: (_entry, _flags, w) =>
    actionSet(
      [
        { id: "attach", label: w.t("bar.openTerminal"), icon: "term", key: "↵" },
        { id: "stop", label: w.t("wait.stop"), key: "⌫" },
        { id: "hide", label: w.t("wait.hide") },
      ],
      0,
      1,
    ),
};
