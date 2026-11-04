import { useEffect, useState } from "react";
import { briefingIn, prepChatOf, joinable } from "../../../domain/calendar/rules";
import type { Meeting } from "../../../domain/calendar/types";
import { chatAbout, joinMeeting, meetingChat, timeOf } from "../../../application/calendar/calendar";
import { loadMeetingNote, saveBriefing, toggleBriefingTask } from "../../../application/calendar/meeting-view";
import { startRecording, useRecordingStore } from "../../../application/calendar/recording";
import { useConversationsStore } from "../../../application/conversations/store";
import { useWorkspaceStore } from "../../../application/workspace/store";
import { markdownHtml } from "../../../shared/markdown";
import { Glyph } from "../../components/Glyph";
import { Icon } from "../../components/Icon";
import { agent } from "../../../shared/plugins";
import { useT } from "../../hooks/useT";

// one size system in content: h-8, rounded-lg, medium; one primary, the others outline
const ACT = "inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-[13px] font-medium cursor-pointer";
const PRIMARY = `${ACT} bg-accent text-on-accent hover:bg-accent-hover`;
const OUTLINE = `${ACT} border border-separator-strong text-label hover:bg-fill disabled:opacity-50 disabled:cursor-default`;

/** The briefing as the design draws it: its markdown, whose `- [ ]` lists are real checkboxes that write back. */
function BriefingBody({ text, onTick }: { text: string; onTick: (n: number) => void }) {
  const { lang } = useT();
  const version = useWorkspaceStore(s => s.notesVersion);
  const box = /<input (checked="" )?disabled="" type="checkbox">/g;
  const raw = markdownHtml(text, version, lang);
  const checked = [...raw.matchAll(box)].map(m => !!m[1]);
  const html = raw
    .split(/<input (?:checked="" )?disabled="" type="checkbox">/)
    .flatMap((part, i) =>
      i < checked.length ? [part, `<input type="checkbox" data-task="${i}"${checked[i] ? " checked" : ""}>`] : [part],
    )
    .join("");
  return (
    <div
      className="md-brief select-text"
      onClick={e => {
        const box = e.target instanceof HTMLInputElement ? e.target.dataset.task : undefined;
        if (box !== undefined) onTick(Number(box));
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** The Briefing step: the way into the meeting (Join, Record, Start notes: one of them primary), then the note's
 *  `## Briefing`, editable in place and saved into that section only; with none yet, the card that has Claude write it. */
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
  const preppedAt = useConversationsStore(s => (prep ? s.chats[prep]?.at : 0));
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
  const canJoin = joinable(meeting.join);
  // Join is the way in once there is a briefing to read; before it, preparing is (the card)
  const joinFirst = !!text && canJoin;
  const recordFirst = !!text && !canJoin;
  const record = (
    <button
      className={recordFirst ? PRIMARY : OUTLINE}
      disabled={busy}
      onClick={() => startRecording(meeting.id, meeting)}
    >
      <span className={`size-2 rounded-full ${recordFirst ? "bg-white" : "bg-late"}`} />
      {t("rec.record")}
    </button>
  );
  return (
    <div className="relative flex-1 min-h-0 overflow-y-auto select-text cursor-auto">
      <div className="w-180 max-w-full px-14 pt-5.5 pb-8">
        <div className="flex items-center gap-2">
          {canJoin ? (
            <button className={joinFirst ? PRIMARY : OUTLINE} onClick={() => joinMeeting(meeting.join)}>
              <Icon name="video" className="glyph size-3.5" />
              {t("wait.meetingJoin")}
            </button>
          ) : null}
          {record}
          <button className={OUTLINE} onClick={onStart}>
            {t("meet.startNotes")}
          </button>
          <span className="flex-1" />
          {text && prep && preppedAt ? (
            <span className="text-xs text-secondary whitespace-nowrap">
              <button className="cursor-pointer hover:text-label" onClick={() => meetingChat(meeting.id, "prep")}>
                {t("meet.preparedBy", { time: timeOf(new Date(preppedAt).toISOString()) })}
              </button>
              {" · "}
              <button
                className="cursor-pointer text-accent-text hover:underline"
                onClick={() => void chatAbout(meeting, "prep")}
              >
                {t("meet.rerun")}
              </button>
            </span>
          ) : null}
        </div>
        {text ? (
          <div className="group relative mt-4">
            {editing !== null ? (
              <>
                <div className="flex items-center justify-end gap-2 mb-2">
                  <button className={OUTLINE} onClick={() => setEditing(null)}>
                    {t("today.cancelEdit")}
                  </button>
                  <button className={PRIMARY} onClick={save}>
                    {t("today.saveBriefing")}
                    <span className="font-mono text-[11px] opacity-75">⌘↵</span>
                  </button>
                </div>
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
              </>
            ) : (
              <>
                <button
                  title={t("today.editBriefing")}
                  aria-label={t("today.editBriefing")}
                  className="absolute -top-1 right-0 grid place-items-center size-7 rounded-lg text-secondary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer hover:bg-fill-2 hover:text-label"
                  onClick={() => setEditing(text)}
                >
                  <Icon name="edit" className="glyph size-3.5" />
                </button>
                <BriefingBody text={text} onTick={n => void toggleBriefingTask(meeting, n)} />
              </>
            )}
            {err ? <div className="err-box mt-2">{err}</div> : null}
          </div>
        ) : prep ? (
          <section className="flex items-center gap-3 mt-5">
            <span className="flex-1 text-sm text-tertiary">{t("today.briefingBusy")}</span>
            <button className={OUTLINE} onClick={() => meetingChat(meeting.id, "prep")}>
              {t("today.openBriefing")}
            </button>
          </section>
        ) : null}
        {!text && !prep ? (
          <aside className="mt-4 p-4 rounded-xl border border-dashed border-separator-strong bg-sidebar">
            <div className="flex flex-col gap-1.5 text-xs text-secondary">
              {(["goal", "since", "threads", "points"] as const).map(key => (
                <span key={key}>
                  <span className="font-semibold text-label">{t(`meet.skel.${key}`)}</span> · —
                </span>
              ))}
            </div>
            <button className={`${PRIMARY} mt-3.5`} onClick={() => meetingChat(meeting.id, "prep")}>
              {claude ? <Glyph svg={claude} className="glyph size-3.5 flex-none" /> : null}
              {t("meet.prep")}
            </button>
            <p className="m-0 mt-2 max-w-[60ch] text-xs leading-snug text-secondary">{t("today.briefingHint")}</p>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
