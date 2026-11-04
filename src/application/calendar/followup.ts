import { t } from "../../shared/i18n";
import { meetingLanguage } from "../../domain/calendar/rules";
import { summaryIn } from "../../domain/calendar/wrapup";
import {
  addrOf,
  defaultSubject,
  followupAsk,
  parseMail,
  recipients,
  withFollowedUp,
  withFollowupLine,
  type Addr,
} from "../../domain/calendar/followup";
import { draftMessage } from "../../domain/mail/reply";
import { voiceOf } from "../../domain/settings/voice";
import type { Meeting } from "../../domain/calendar/types";
import * as backend from "../../infrastructure/backend";
import { makeStore } from "../make-store";
import { settings } from "../settings/settings";
import { toast } from "../navigation/navigation";
import { meetingNote } from "./calendar";
import { noteFor, remember } from "./meeting-view";

// The follow-up mail of a meeting: written by one run of the agent (backend.aiWrite) from the accepted summary, shown
// as a composer the user edits, and saved as a draft in the mail account's Drafts (the same save_draft Today's replies
// use). Relay never sends. The note remembers it (`followed-up: true`, a line under Next Steps).

export type Followup = {
  phase: "generating" | "ready" | "error" | "saving";
  to: Addr[];
  cc: Addr[];
  ccOn: boolean;
  subject: string;
  body: string;
  error: string;
};
export const useFollowupStore = makeStore<{ mails: Record<string, Followup> }>(() => ({ mails: {} }));
const set = useFollowupStore.setState;
const get = (id: string) => useFollowupStore.getState().mails[id];
const change = (id: string, recipe: (m: Followup) => void) =>
  set(draft => {
    if (draft.mails[id]) recipe(draft.mails[id]);
  });

const accounts = () => settings().mail.accounts ?? [];
const mine = () => accounts().map(account => account.email);
/** Whether a mail account is set up to keep the draft in. */
export const canDraftMail = () => settings().mail.on && accounts().length > 0;
/** The account the draft is saved in: the meeting's calendar when it is a mail account too, else the default one. */
export function accountFor(meeting: Meeting) {
  const same = accounts().find(account => account.email.toLowerCase() === meeting.feed.toLowerCase());
  return same?.email ?? (settings().mail.account || accounts()[0]?.email || "");
}

/** Writes the draft from the note's accepted summary; asked again, it starts again. */
export async function startFollowup(meeting: Meeting) {
  const id = meeting.id;
  set(draft => {
    draft.mails[id] = { phase: "generating", to: [], cc: [], ccOn: false, subject: "", body: "", error: "" };
  });
  try {
    const note = await meetingNote(meeting);
    const summary = note ? summaryIn(note.text) : null;
    if (!summary) throw new Error(t("meet.mail.noSummary"));
    const code = meetingLanguage(note?.text ?? null, voiceOf(settings().voice).language) ?? "";
    const language = code ? (new Intl.DisplayNames(["nl"], { type: "language" }).of(code) ?? code) : "";
    const subject = defaultSubject(meeting, code);
    const { system, text } = followupAsk(
      meeting,
      summary,
      subject,
      language,
      "",
      new Date(meeting.start).toLocaleDateString("sv-SE"),
    );
    const mail = parseMail(await backend.aiWrite(system, text, "claude"), subject);
    if (!mail) throw new Error(t("meet.wrap.unreadable"));
    change(id, m => {
      m.phase = "ready";
      m.to = recipients(meeting, mine());
      m.subject = mail.subject;
      m.body = mail.body;
    });
  } catch (error) {
    change(id, m => {
      m.phase = "error";
      m.error = error instanceof Error ? error.message : String(error);
    });
  }
}

export const editFollowup = (id: string, patch: Partial<Pick<Followup, "subject" | "body" | "ccOn">>) =>
  change(id, m => void Object.assign(m, patch));
export const removeAddr = (id: string, field: "to" | "cc", i: number) => change(id, m => void m[field].splice(i, 1));
/** An address typed into Cc; false when it is none. */
export function addCc(id: string, text: string) {
  const addr = addrOf(text);
  if (addr)
    change(id, m => void (m.cc.some(a => a.email.toLowerCase() === addr.email.toLowerCase()) || m.cc.push(addr)));
  return !!addr;
}
/** Back to the steps without writing anything. */
export const discardFollowup = (id: string) =>
  set(draft => {
    delete draft.mails[id];
  });

/** Save as a draft in the mail account's Drafts, then the note: `followed-up: true` and the line under Next Steps. The
 *  mail goes out of the composer either way: the draft is saved once the mail tool says so. */
export async function saveFollowup(meeting: Meeting) {
  const mail = get(meeting.id);
  if (!mail || mail.phase === "saving") return;
  if (!mail.to.length && !mail.cc.length) return change(meeting.id, m => void (m.error = t("meet.mail.needTo")));
  change(meeting.id, m => {
    m.phase = "saving";
    m.error = "";
  });
  try {
    const account = accountFor(meeting);
    const raw = draftMessage({
      from: account,
      to: mail.to,
      cc: mail.cc,
      subject: mail.subject.trim(),
      inReplyTo: null,
      references: "",
      body: mail.body.trim(),
    });
    await backend.mailTool("save_draft", { account, raw });
  } catch (error) {
    return change(meeting.id, m => {
      m.phase = "ready";
      m.error = String(error);
    });
  }
  try {
    const note = await noteFor(meeting);
    const marked = withFollowedUp(note.text);
    const text = withFollowupLine(marked, mail.subject.trim()) ?? marked;
    if (text !== note.text) {
      const { hash } = await backend.writeNote(note.path, text, note.hash, false);
      remember(meeting, { path: note.path, text, hash });
    }
  } catch (error) {
    toast(String(error)); // the draft is saved, the note will not say so
  }
  discardFollowup(meeting.id);
  toast(t("today.draftSaved"));
}
