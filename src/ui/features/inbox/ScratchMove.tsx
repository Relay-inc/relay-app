import { useState } from "react";
import { migrateScratch, useInboxStore, type PendingMove } from "../../../application/inbox/inbox";
import { useT } from "../../hooks/useT";

const SAMPLE = 6;
const NO_MOVES: PendingMove[] = [];

/** The old scratch notes still outside the vault (`.relay/notes`): one line saying so, and Move into Inbox… opening the
 *  dry run: each note's project and its new name, nothing written until Move. The toast after it has the one Undo.
 *  `open` and `onOpen` are the parent's, so it can keep its own filled button out of the way while the dry run shows. */
export function ScratchMove({
  workspace,
  open,
  onOpen,
}: {
  workspace: string;
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  const { t, tn } = useT();
  const moves = useInboxStore(s => s.pending[workspace]) ?? NO_MOVES;
  const [busy, setBusy] = useState(false);
  if (!moves.length) return null;
  const sample = moves.slice(0, SAMPLE);
  const apply = async () => {
    setBusy(true);
    await migrateScratch(workspace);
    setBusy(false);
    onOpen(false);
  };
  return (
    <div data-scratch-move className="rounded-xl border border-separator text-sm">
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <span className="flex-1 min-w-0 text-secondary">{tn("inbox.outside", moves.length)}</span>
        {open ? null : (
          <button className="text-accent-text cursor-pointer hover:underline" onClick={() => onOpen(true)}>
            {t("inbox.moveIn")}
          </button>
        )}
      </div>
      {open ? (
        <div
          role="dialog"
          aria-label={t("inbox.moveTitle")}
          className="grid gap-3 px-3.5 pb-3 border-t border-separator pt-3"
        >
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{t("inbox.moveTitle")}</h3>
            <span className="h-5 inline-flex items-center px-2 rounded-md border border-dashed border-soon text-soon text-xs font-semibold uppercase tracking-wider">
              {t("tidy.dryRun")}
            </span>
          </div>
          <div className="border border-separator rounded-lg overflow-hidden font-mono text-xs">
            {sample.map(move => (
              <div
                key={`${move.project}/${move.id}`}
                className="flex items-center gap-2 h-7.5 px-3 border-t border-separator first:border-t-0"
              >
                <span className="flex-1 min-w-0 truncate text-secondary">{move.project}</span>
                <span className="text-tertiary">→</span>
                <span className="flex-1 min-w-0 truncate">{`Inbox/${move.to}.md`}</span>
              </div>
            ))}
            {moves.length > sample.length ? (
              <div className="px-3 py-1.5 border-t border-separator font-sans text-secondary">
                {t("tidy.more", { n: moves.length - sample.length })}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <p className="flex-1 text-xs text-secondary">{t("inbox.moveNote")}</p>
            <button className="btn cursor-pointer" onClick={() => onOpen(false)}>
              {t("pages.cancel")}
            </button>
            <button
              className="btn btn-primary cursor-pointer disabled:opacity-50"
              disabled={busy}
              onClick={() => void apply()}
            >
              {tn("inbox.moveApply", moves.length)}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
