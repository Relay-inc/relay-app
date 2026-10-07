import { actionSet } from "./common.ts";
import type { SubjectDef } from "./types.ts";

export type CaptureAct = "apply" | "skip";

/** What a closed conversation proposes for the vault, until applied or skipped (application/today/capture). */
export const capture: SubjectDef<"capture", CaptureAct> = {
  kinds: { capture: { est: 3, rank: 5, icon: "notes" } },
  entries: (snap, w) =>
    snap.captures.map(capture => ({
      kind: "capture",
      id: `capture:${capture.key}`,
      at: capture.at,
      title: capture.title,
      where: "", // the project chip says it already
      why: w.tn("capture.why", capture.proposals.length),
      tone: "",
      project: capture.project,
      subject: { type: "capture", capture },
    })),
  actions: (_entry, _flags, w) =>
    actionSet(
      [
        { id: "apply", label: w.t("capture.apply"), icon: "check", key: "↵" },
        { id: "skip", label: w.t("capture.skip"), key: "⌫" },
      ],
      0,
      1,
    ),
};
