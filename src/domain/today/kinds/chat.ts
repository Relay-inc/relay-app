import { actionSet } from "./common.ts";
import type { SubjectDef } from "./types.ts";

export type ChatAct = "read" | "markRead";

/** A conversation finished while the user was elsewhere (its question, when it has one, is in the queue already). */
export const chat: SubjectDef<"chat", ChatAct> = {
  kinds: { finished: { est: 5, rank: 8, icon: "chat" } },
  entries: (snap, w, now) => {
    const asking = new Set(snap.pending.map(request => request.project));
    return snap.unseen
      .filter(key => !asking.has(key))
      .map(key => {
        const info = snap.chats[key];
        return {
          kind: "finished",
          id: `chat:${key}`,
          at: now,
          title: info?.label ?? key,
          where: info?.projectLabel ?? "",
          why: w.t("today.finished"),
          tone: "",
          project: info?.project ?? null,
          subject: { type: "chat", key },
        };
      });
  },
  actions: (_entry, _flags, w) =>
    actionSet(
      [
        { id: "read", label: w.t("today.read"), key: "↵" },
        { id: "markRead", label: w.t("today.markRead"), key: "⌫" },
      ],
      0,
      1,
    ),
};
