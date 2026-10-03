import { useEffect, useState } from "react";
import type { BoardProvider } from "../../../domain/board/types";
import { openComposer, showBoard } from "../../../application/board/board";
import { useBoardStore } from "../../../application/board/store";
import { relativeFormat } from "../../../shared/format";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";

/** The board's buttons in the title bar: when it last synced (quiet text, kept up to date by the minute), New task
 *  when the provider can make one, and refresh, which spins while the board loads. */
export function BoardActions({ provider }: { provider: BoardProvider }) {
  const { t, locale } = useT();
  const loadedAt = useBoardStore(s => s.states[provider.id].loadedAt);
  const busy = useBoardStore(s => s.states[provider.id].busy);
  const hasColumns = useBoardStore(s => !!s.states[provider.id].columns.length);
  // a display clock: the minutes since the last load
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const minutes = Math.floor((now - loadedAt) / 60_000);
  const synced = !loadedAt
    ? ""
    : minutes < 1
      ? t("kb.syncedNow")
      : t("kb.synced", {
          when:
            minutes < 60
              ? relativeFormat(locale, { numeric: "auto" }).format(-minutes, "minute")
              : relativeFormat(locale, { numeric: "auto" }).format(-Math.floor(minutes / 60), "hour"),
        });
  return (
    <>
      {synced && <span className="text-xs text-tertiary whitespace-nowrap mr-1">{synced}</span>}
      {provider.create && hasColumns && (
        <button
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[7px] border border-separator-strong bg-transparent text-label text-xs font-medium whitespace-nowrap hover:bg-fill cursor-default"
          onClick={() => openComposer(provider)}
        >
          <Icon name="add" className="glyph size-3.5" />
          {t("kb.newTask")}
        </button>
      )}
      <button
        className="btn-icon"
        title={t("pr.reload")}
        aria-label={t("pr.reload")}
        onClick={() => showBoard(provider, true)}
      >
        <Icon name="refresh" className={`glyph size-4 ${busy ? "animate-spin" : ""}`} />
      </button>
    </>
  );
}
