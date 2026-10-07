import { useEffect, useState } from "react";
import type { Meeting } from "../../../../domain/calendar/types";
import { briefingIn, prepChatOf } from "../../../../domain/calendar/rules";
import { meetingChat, meetingNote, saveBriefing, timeOf } from "../../../../application/calendar/calendar";
import { useConversationsStore } from "../../../../application/conversations/store";
import { openDetail } from "../../../../application/navigation/panel";
import { noteKey } from "../../../../domain/navigation/keys";
import { Markdown } from "../../../components/Markdown";
import { useT } from "../../../hooks/useT";
import { Glyph } from "../../../components/Glyph";
import { agent } from "../../../../shared/plugins";
import { Caps } from "../parts";

const initials = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map(part => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
// the invite's text as agenda lines: what is left after links and dial-in noise, at most ten lines
const agendaOf = (text = "") =>
  text
    .replace(/<[^>]+>/g, " ")
    .split(/\r?\n|\\n/)
    .map(line => line.replace(/^[\s\-*•–]+/, "").trim())
    .filter(
      line => line && !/https?:\/\/|meet\.google|zoom\.us|teams\.microsoft|^-{3,}|join|dial|pin:|^\W+$/i.test(line),
    )
    .slice(0, 10);

/** A meeting under Today: who is in it, the agenda from the invite, and (before it) the briefing Claude writes in a
 *  conversation from the vault, or (after it) the note. The invite is the sender's text: shown, never followed. */
export function MeetingSection({ meeting, after }: { meeting: Meeting; after: boolean }) {
  const { t } = useT();
  const agenda = agendaOf(meeting.description);
  const claude = agent("claude")?.glyph ?? "";
  // the briefing lives in the meeting's note; the conversation that asked for it, while it writes, reads it again
  const prep = useConversationsStore(s => (after ? null : prepChatOf(s.chats, meeting.id)));
  const progress = useConversationsStore(s => (prep ? s.messages[prep]?.length : 0));
  const [note, setNote] = useState<{ id: string; path: string; text: string } | null>(null);
  useEffect(() => {
    if (after) return;
    let live = true;
    meetingNote(meeting).then(found => live && setNote(found ? { id: meeting.id, ...found } : null));
    return () => {
      live = false;
    };
  }, [after, meeting, progress]);
  const text = note && note.id === meeting.id ? briefingIn(note.text) : null;
  // the text being edited, for the meeting it belongs to (another meeting opened meanwhile shows its own)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const draft = editing && editing.id === meeting.id ? editing.text : null;
  const [err, setErr] = useState("");
  const save = async () => {
    if (draft === null) return;
    setErr("");
    const saved = await saveBriefing(meeting, draft).catch(error => (setErr(String(error)), undefined));
    if (saved === undefined) return;
    if (saved) setNote({ id: meeting.id, ...saved });
    else setErr(t("today.briefingGone"));
    setEditing(null);
  };
  return (
    <div className="flex flex-col gap-4 max-w-170">
      <div className="text-[13px] text-secondary">
        {timeOf(meeting.start)}–{timeOf(meeting.end)}
        {meeting.location ? ` · ${meeting.location}` : ""}
        {meeting.organizer ? ` · ${t("today.organizer", { name: meeting.organizer })}` : ""}
      </div>
      {meeting.people.length ? (
        <div className="flex flex-wrap gap-1.5">
          {meeting.people.map(person => (
            <span
              key={person.email}
              className="inline-flex items-center gap-1.5 h-6.5 pl-0.75 pr-2.25 rounded-full bg-raised shadow-[0_0_0_.5px_var(--color-separator-strong)] text-xs"
              title={person.email}
            >
              <span className="grid place-items-center size-5 rounded-full bg-fill-2 text-secondary text-[9px] font-semibold">
                {initials(person.name || person.email)}
              </span>
              {person.name || person.email}
            </span>
          ))}
        </div>
      ) : null}
      {agenda.length ? (
        <section className="flex flex-col gap-1.5">
          <Caps>{t("today.agenda")}</Caps>
          {agenda.map((line, i) => (
            <div key={i} className="flex gap-2 text-sm select-text">
              <span className="text-tertiary">–</span>
              {line}
            </div>
          ))}
        </section>
      ) : null}
      {text !== null && note ? (
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <Caps>{t("today.briefing")}</Caps>
            <span className="flex-1" />
            {draft !== null ? (
              <>
                <button className="btn cursor-pointer" onClick={() => setEditing(null)}>
                  {t("today.cancelEdit")}
                </button>
                <button
                  className="inline-flex items-center gap-2 h-7.5 px-3 rounded-lg bg-accent text-on-accent text-[13px] font-medium cursor-pointer hover:bg-accent-hover"
                  onClick={save}
                >
                  {t("today.saveBriefing")}
                  <span className="font-mono text-[11px] opacity-75">⌘↵</span>
                </button>
              </>
            ) : (
              <>
                <button className="btn cursor-pointer" onClick={() => setEditing({ id: meeting.id, text })}>
                  {t("today.editBriefing")}
                </button>
                <button className="btn cursor-pointer" onClick={() => openDetail(noteKey(note.path))}>
                  {t("today.openNote")}
                </button>
                {prep ? (
                  <button className="btn cursor-pointer" onClick={() => meetingChat(meeting.id, "prep")}>
                    {t("today.openBriefing")}
                  </button>
                ) : null}
              </>
            )}
          </div>
          {draft !== null ? (
            <textarea
              autoFocus
              // the caret at the end, where an addition goes
              onFocus={e => e.currentTarget.setSelectionRange(draft.length, draft.length)}
              value={draft}
              onChange={e => setEditing({ id: meeting.id, text: e.target.value })}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
                if (e.key === "Escape") setEditing(null);
              }}
              rows={14}
              className="block w-full px-4 py-3 rounded-[10px] border border-separator-strong bg-raised outline-0 resize-y text-sm leading-[1.55] font-mono select-text"
            />
          ) : (
            <Markdown text={text} className="md-panel text-sm leading-relaxed select-text" />
          )}
          {err ? <div className="err-box">{err}</div> : null}
        </section>
      ) : prep ? (
        <section className="flex items-center gap-3">
          <span className="flex-1 text-sm text-tertiary">{t("today.briefingBusy")}</span>
          <button className="btn cursor-pointer" onClick={() => meetingChat(meeting.id, "prep")}>
            {t("today.openBriefing")}
          </button>
        </section>
      ) : (
        <div className="flex items-center gap-3 p-3.5 rounded-[10px] border border-dashed border-separator-strong">
          {claude ? <Glyph svg={claude} className="glyph size-4 flex-none" /> : null}
          <span className="flex-1 text-[13px] text-secondary">
            {after ? t("today.noteHint") : t("today.briefingHint")}
          </span>
          <button className="btn cursor-pointer" onClick={() => meetingChat(meeting.id, after ? "note" : "prep")}>
            {after ? t("today.makeNote") : t("today.writeBriefing")}
          </button>
        </div>
      )}
    </div>
  );
}
