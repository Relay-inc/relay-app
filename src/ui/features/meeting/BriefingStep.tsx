import { useEffect, useState } from "react";
import { briefingIn, prepChatOf, joinable } from "../../../domain/calendar/rules";
import type { Meeting } from "../../../domain/calendar/types";
import { joinMeeting, meetingChat } from "../../../application/calendar/calendar";
import { loadMeetingNote, saveBriefing } from "../../../application/calendar/meeting-view";
import { startRecording, useRecordingStore } from "../../../application/calendar/recording";
import { useConversationsStore } from "../../../application/conversations/store";
import { openDetail } from "../../../application/navigation/panel";
import { noteKey } from "../../../domain/navigation/keys";
import { Markdown } from "../../components/Markdown";
import { Glyph } from "../../components/Glyph";
import { Icon } from "../../components/Icon";
import { agent } from "../../../shared/plugins";
import { useT } from "../../hooks/useT";
import { Caps } from "../today/parts";

/** The Briefing step: the note's `## Briefing` as it stands (editable here, saved into that section only), the way into
 *  the meeting (Join, Record, Start notes), and with no briefing yet the button that has Claude write one. */
export function BriefingStep({
  meeting,
  note,
  onStart,
}: {
  meeting: Meeting;
  note: { path: string; text: string } | null;
  onStart: () => void;
}) {
  const { t } = useT();
  const claude = agent("claude")?.glyph ?? "";
  const busy = useRecordingStore(s => s.phase !== "idle");
  // the briefing lives in the meeting's note; the conversation that asked for it, while it writes, reads it again
  const prep = useConversationsStore(s => prepChatOf(s.chats, meeting.id));
  const progress = useConversationsStore(s => (prep ? s.messages[prep]?.length : 0));
  useEffect(() => {
    if (progress) void loadMeetingNote(meeting, true);
  }, [meeting, progress]);
  const text = note ? briefingIn(note.text) : null;
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const save = async () => {
    if (editing === null) return;
    setErr("");
    const saved = await saveBriefing(meeting, editing).catch(error => (setErr(String(error)), undefined));
    if (saved === undefined) return;
    if (saved === null) setErr(t("today.briefingGone"));
    setEditing(null);
  };
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-14 pt-5.5 pb-8 select-text cursor-auto">
      <div className="flex flex-col gap-5 max-w-180">
        <div className="flex items-center gap-2">
          {joinable(meeting.join) ? (
            <button
              className="inline-flex items-center gap-1.5 btn btn-primary cursor-pointer"
              onClick={() => joinMeeting(meeting.join)}
            >
              <Icon name="video" className="glyph size-3.5" />
              {t("wait.meetingJoin")}
            </button>
          ) : null}
          <button
            className="inline-flex items-center gap-2 btn cursor-pointer"
            disabled={busy}
            onClick={() => startRecording(meeting.id, meeting)}
          >
            <span className="size-2 rounded-full bg-late" />
            {t("rec.record")}
          </button>
          <button className="btn cursor-pointer" onClick={onStart}>
            {t("meet.startNotes")}
          </button>
        </div>
        {text ? (
          <section className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3">
              <Caps>{t("today.briefing")}</Caps>
              <span className="flex-1" />
              {editing !== null ? (
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
                  <button className="btn cursor-pointer" onClick={() => setEditing(text)}>
                    {t("today.editBriefing")}
                  </button>
                  {note ? (
                    <button className="btn cursor-pointer" onClick={() => openDetail(noteKey(note.path))}>
                      {t("today.openNote")}
                    </button>
                  ) : null}
                  {prep ? (
                    <button className="btn cursor-pointer" onClick={() => meetingChat(meeting.id, "prep")}>
                      {t("today.openBriefing")}
                    </button>
                  ) : null}
                </>
              )}
            </div>
            {editing !== null ? (
              <textarea
                autoFocus
                // the caret at the end, where an addition goes
                onFocus={e => e.currentTarget.setSelectionRange(editing.length, editing.length)}
                value={editing}
                onChange={e => setEditing(e.target.value)}
                onKeyDown={e => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void save();
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
            <span className="flex-1 text-[13px] text-secondary">{t("today.briefingHint")}</span>
            <button className="btn cursor-pointer" onClick={() => meetingChat(meeting.id, "prep")}>
              {t("meet.prep")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
