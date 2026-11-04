import { useEffect, useRef } from "react";
import { captureName } from "../../domain/inbox/rules";
import { close, dictate, initCapture, save, type, useCaptureStore } from "../../application/capture/capture";
import { useDictationStore } from "../../application/conversations/dictation";
import { useT } from "../hooks/useT";
import { Icon } from "../components/Icon";

/** Quick capture (K7): a text field, a mic for the existing dictation, and Save to Inbox (⌘↵). Esc puts the window away
 *  and keeps what was typed. The note's name is the minute it is saved in. */
export function CaptureWindow() {
  const { t } = useT();
  const text = useCaptureStore(s => s.text);
  const error = useCaptureStore(s => s.error);
  const saving = useCaptureStore(s => s.saving);
  const focus = useCaptureStore(s => s.focus);
  const phase = useDictationStore(s => s.phase);
  const dictationError = useDictationStore(s => s.error);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => void initCapture(), []);
  // brought forward again: the field takes the focus, whatever app had it
  useEffect(() => field.current?.focus(), [focus]);
  const recording = phase === "recording";
  const note = phase === "offer" ? t("capture.noModel") : phase === "transcribing" ? t("capture.transcribing") : "";
  return (
    <div
      className="h-screen flex flex-col gap-2.5 p-3.5 bg-bg text-label"
      onKeyDown={e => {
        if (e.key === "Escape") void close();
        if (e.key === "Enter" && e.metaKey) void save();
      }}
    >
      <textarea
        ref={field}
        autoFocus
        aria-label={t("capture.title")}
        className="flex-1 min-h-0 w-full resize-none bg-transparent outline-none text-[15px] leading-normal placeholder:text-tertiary"
        placeholder={t("capture.placeholder")}
        value={text}
        onChange={e => type(e.target.value)}
      />
      {error || dictationError || note ? (
        <p className="text-xs text-secondary">{error || dictationError || note}</p>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          className={`size-7.5 grid place-items-center rounded-full border cursor-pointer disabled:opacity-50 ${
            recording ? "border-late text-late" : "border-separator-strong text-secondary hover:bg-fill"
          }`}
          aria-label={recording ? t("capture.stop") : t("capture.dictate")}
          aria-pressed={recording}
          disabled={phase === "transcribing"}
          onClick={() => void dictate()}
        >
          <Icon name={recording ? "stop" : "mic"} className="glyph size-3.5" />
        </button>
        <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-tertiary">{captureName(new Date())}</span>
        <button
          className="btn btn-primary px-3 inline-flex items-center gap-2 cursor-pointer disabled:opacity-50"
          disabled={!text.trim() || saving}
          onClick={() => void save()}
        >
          {t("capture.save")}
          <span className="text-[11px] opacity-80">⌘↵</span>
        </button>
      </div>
    </div>
  );
}
