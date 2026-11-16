import { useState } from "react";
import { cancelRecording, stopRecording, useRecordingStore } from "../../../application/calendar/recording";
import { backToToday } from "../../../application/calendar/meeting-view";
import { openNoteLink } from "../../../application/navigation/pages";
import { othersLabel } from "../../../domain/calendar/meeting-view";
import type { Meeting } from "../../../domain/calendar/types";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { isMac } from "../../../shared/platform";
import { clock } from "../conversations/RecordingBar";
import { Menu } from "./Menu";

// a level as six thin bars, tall in the middle like the design's
const PROFILE = [0.3, 0.5, 0.8, 1, 0.65, 0.35];
function Level({ label, level, tone }: { label: string; level: number; tone: string }) {
  const loud = Math.min(1, Math.sqrt(level));
  return (
    <span role="img" aria-label={label} className="inline-flex items-center gap-1.5 text-xs text-secondary">
      {label}
      <span className="inline-flex items-end gap-0.5 h-3.5">
        {PROFILE.map((p, i) => (
          <span key={i} className={`w-0.75 rounded-xs ${tone}`} style={{ height: `${2 + p * loud * 12}px` }} />
        ))}
      </span>
    </span>
  );
}

/** The title bar of the Meeting view: back to Today, and on the right the link to the meeting note, or while it is
 *  recorded the controls: the red dot (its tooltip is the consent reminder), the time, both levels, Stop and a "…" with
 *  Cancel; while it is written out the progress. */
export function MeetingBar({ meeting, note }: { meeting: Meeting; note: { path: string } | null }) {
  const { t } = useT();
  const { phase, secs, me, others, system, heard, why, progress } = useRecordingStore();
  const mine = useRecordingStore(s => s.meeting?.id === meeting.id);
  const [confirm, setConfirm] = useState(false);
  const file = note?.path.split("/").pop();
  const tip = !system
    ? t(isMac() ? "rec.noSystem" : "rec.noSystemWin", { why: why || "?" })
    : !heard && secs >= 15
      ? t(isMac() ? "rec.silentMac" : "rec.silentWin")
      : t("rec.consent");
  return (
    <div
      className="flex-none h-12 flex items-center gap-2 pl-5 pr-4 border-b border-separator select-none"
      data-tauri-drag-region
    >
      <button
        className="inline-flex items-center gap-1 h-7 pl-1 pr-2 -ml-1 rounded-lg text-[13px] text-secondary cursor-pointer hover:bg-fill hover:text-label"
        onClick={backToToday}
      >
        <Icon name="left" className="glyph size-3.5" />
        {t("nav.today")}
      </button>
      <span className="text-tertiary">/</span>
      <span className="text-[13px] font-semibold">{t("meet.name")}</span>
      <span className="flex-1" />
      {mine && phase === "recording" ? (
        <div className="flex items-center gap-3.5">
          <span title={tip} className="inline-flex items-center gap-2 font-semibold text-late">
            <span className="size-2.25 rounded-full bg-late animate-pulse ring-3 ring-late/20" />
            <span className="font-mono text-[13px] tabular-nums">{clock(secs)}</span>
          </span>
          <Level label={t("rec.me")} level={me} tone="bg-ok" />
          {system ? (
            <Level label={othersLabel(meeting.people, t("rec.others"))} level={others} tone="bg-secondary" />
          ) : null}
          <button
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-lg bg-late text-white text-[13px] font-semibold cursor-pointer"
            onClick={stopRecording}
          >
            <span className="size-2 rounded-xs bg-white" />
            {t("rec.stop")}
          </button>
          <Menu
            label={t("meet.moreRecording")}
            right
            className="grid place-items-center size-7 rounded-lg text-secondary cursor-pointer hover:bg-fill-2 hover:text-label"
            trigger={<Icon name="more" className="glyph size-4" />}
          >
            {close =>
              confirm ? (
                <div className="flex flex-col gap-2 p-2 w-56 text-[13px]">
                  <span>{t("meet.discardAsk")}</span>
                  <div className="flex gap-2">
                    <button
                      className="h-7 px-2.5 rounded-lg bg-late text-white font-medium cursor-pointer"
                      onClick={() => {
                        setConfirm(false);
                        close();
                        void cancelRecording();
                      }}
                    >
                      {t("meet.discard")}
                    </button>
                    <button
                      className="h-7 px-2.5 rounded-lg border border-separator-strong cursor-pointer hover:bg-fill"
                      onClick={() => setConfirm(false)}
                    >
                      {t("meet.keep")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="w-full h-7 px-2.5 rounded-md text-left text-[13px] cursor-pointer hover:bg-fill"
                  onClick={() => setConfirm(true)}
                >
                  {t("rec.cancel")}
                </button>
              )
            }
          </Menu>
        </div>
      ) : mine && phase === "saving" ? (
        <span className="text-[13px] text-secondary">
          {t("rec.transcribingRest")} <span className="tabular-nums">{Math.round(progress * 100)}%</span>
        </span>
      ) : note && file ? (
        <button
          className="max-w-1/2 truncate text-xs text-secondary cursor-pointer hover:text-label"
          onClick={() => void openNoteLink(note.path)}
        >
          {t("meet.noteFile", { file })}
        </button>
      ) : null}
    </div>
  );
}
