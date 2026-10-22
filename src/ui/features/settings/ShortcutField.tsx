import { useEffect, useRef, useState } from "react";
import { shortcutLabel, shortcutOf } from "../../../domain/settings/voice";
import { useT } from "../../hooks/useT";
import { buttonClass } from "./blocks";

/** A shortcut, set by pressing it: a click starts listening (the app's own global shortcuts step aside meanwhile, see
 *  `onListening`), the next combination with a modifier is taken, Escape cancels. With `record` (Settings ›
 *  Shortcuts) that decides what a press makes, plain keys and Escape too: clicking elsewhere cancels. */
export function ShortcutField({
  id,
  value,
  onPick,
  onListening,
  record,
  show = shortcutLabel,
}: {
  id?: string;
  value: string;
  onPick: (shortcut: string) => void;
  onListening: (listening: boolean) => void;
  record?: (e: KeyboardEvent) => string | null;
  show?: (value: string) => string;
}) {
  const { t } = useT();
  const [listening, setListening] = useState(false);
  // the latest callbacks, so a redraw of the page does not restart the listening (and flip the global shortcuts)
  const calls = useRef({ onPick, onListening, record });
  useEffect(() => {
    calls.current = { onPick, onListening, record };
  });
  useEffect(() => {
    if (!listening) return;
    calls.current.onListening(true);
    const onKey = (e: KeyboardEvent) => {
      // the window's own keys (Escape and ⌘W close it) do not run while a shortcut is being set
      e.preventDefault();
      e.stopImmediatePropagation();
      const { record } = calls.current;
      if (!record && e.key === "Escape") return setListening(false);
      const picked = (record ?? shortcutOf)(e);
      if (!picked) return;
      setListening(false);
      calls.current.onPick(picked);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      calls.current.onListening(false);
    };
  }, [listening]);
  return (
    <button
      id={id}
      className={`${buttonClass()} min-w-28 font-mono ${listening ? "ring-1 ring-s-primary" : ""}`}
      title={t(record ? "keys.recordHelp" : "voice.shortcutRecordHelp")}
      onClick={() => setListening(!listening)}
      onBlur={() => setListening(false)}
    >
      {listening ? t("voice.shortcutPress") : show(value)}
    </button>
  );
}
