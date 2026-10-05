import { usePillStore } from "../../application/conversations/pill";
import { useT } from "../hooks/useT";

/** The pill: bars moving with the voice while it records, then transcribing, or what happened to the text. */
export function DictationPill() {
  const { t } = useT();
  const state = usePillStore(s => s.state);
  const levels = usePillStore(s => s.levels);
  const text =
    state.phase === "transcribing"
      ? t("pill.transcribing")
      : state.phase === "copied"
        ? t("pill.copied")
        : state.phase === "error"
          ? t(state.error === "model" ? "pill.noModel" : state.error === "silent" ? "pill.silent" : "pill.failed")
          : "";
  return (
    <div className="flex h-screen items-center justify-center select-none">
      <div className="flex h-9 items-center gap-2.5 rounded-full bg-[#1c1c1e]/90 px-4 text-[12px] text-white shadow-lg">
        {state.phase === "recording" ? (
          <>
            <span className="size-2 flex-none rounded-full bg-[#ff453a]"></span>
            <span className="flex h-4 items-center gap-0.75">
              {levels.map((level, i) => (
                <span
                  key={i}
                  className="w-0.75 rounded-full bg-white"
                  style={{ height: `${Math.max(3, Math.min(16, Math.sqrt(level) * 22))}px` }}
                ></span>
              ))}
            </span>
          </>
        ) : (
          <span className={state.phase === "transcribing" ? "animate-pulse" : ""}>{text}</span>
        )}
      </div>
    </div>
  );
}
