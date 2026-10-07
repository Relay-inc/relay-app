import { mailKey } from "../../navigation/keys.ts";
import type { Mail } from "../../mail/types";
import { MIN, actionSet, ago } from "./common.ts";
import type { SubjectDef } from "./types.ts";

export type MailAct = "reply" | "replyAll" | "forward" | "chat" | "ticket" | "read" | "trash" | "archive";

/** Mail that waits on the user, however old: unread, or (when the Inbox/Other split knows a person from a machine)
 *  read but not answered yet, until it is archived. The first page per account bounds how many.
 *  ponytail: "answered" is IMAP's \Answered, which Gmail's web app doesn't set; archive (Done) clears those */
export const waitsOnYou = (mail: Mail) => {
  const waits = mail.unread || (mail.other === false && !mail.answered);
  return waits && !mail.other && !mail.answered;
};

export const mail: SubjectDef<"mail", MailAct> = {
  kinds: { mail: { est: 5, rank: 2, icon: "mail", bundle: "mail" } },
  entries: (snap, w, now) =>
    snap.mails.filter(waitsOnYou).map(mail => {
      const at = Date.parse(mail.date);
      const key = mailKey(mail);
      return {
        kind: "mail",
        id: `mail:${key}`,
        at,
        title: mail.subject || w.t("mail.noSubject"),
        where: "", // who and when are on the mail itself, right under it
        why: w.t("today.waiting", { ago: ago(at, now, w) }),
        tone: now - at > 4 * 60 * MIN ? "soon" : "",
        project: snap.mailProject[key] ?? null,
        subject: { type: "mail", key, mail },
      };
    }),
  actions: (_entry, flags, w) =>
    actionSet(
      [
        { id: "reply", label: w.t("today.reply"), icon: "reply", key: "↵" },
        { id: "replyAll", label: w.t("today.replyAll"), icon: "replyAll", key: "A" },
        { id: "forward", label: w.t("today.forward"), icon: "forward", key: "F" },
        { id: "chat", label: w.t("today.askClaude"), icon: "chat" },
        ...(flags.boardsReady ? [{ id: "ticket" as const, label: w.t("mail.ticket"), icon: "notes", key: "T" }] : []),
        { id: "read", label: w.t("today.markRead"), icon: "read", key: "U" },
        ...(flags.mailExperimental
          ? [{ id: "trash" as const, label: w.t("mail.trash"), icon: "trash", key: "#" }]
          : []),
      ],
      0,
      null,
      flags.mailExperimental
        ? { id: "archive", label: w.t("mail.archive"), icon: "archive", key: "E" }
        : { id: "read", label: w.t("today.markRead"), icon: "read", key: "E" },
    ),
};
