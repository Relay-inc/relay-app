import { useEffect } from "react";
import { brainKey, brainName, byBrain } from "../../../domain/brain/rules";
import type { BrainNote } from "../../../domain/brain/types";
import { useBrainStore } from "../../../application/brain/store";
import { brainAct, openNote } from "../../../application/brain/brain";
import { useT } from "../../hooks/useT";
import { Html } from "../../components/Html";
import { Markdown } from "../../components/Markdown";

/** The Brain view, as Pull requests does it: the notes staged for review on the left, grouped by the brain they belong
 *  to, the one you picked on the right with Promote and Reject. The CLI does the promoting. */
export function BrainView({ className = "" }: { className?: string }) {
  const { t } = useT();
  const notes = useBrainStore(s => s.notes);
  const status = useBrainStore(s => s.status);
  const err = useBrainStore(s => s.err);
  const busy = useBrainStore(s => s.busy);
  const open = useBrainStore(s => s.open);
  const note = notes?.find(row => brainKey(row) === open);

  // with nothing picked yet, the first note of the list
  const firstKey = notes?.[0] ? brainKey(notes[0]) : "";
  useEffect(() => {
    if (!open && firstKey) openNote(firstKey);
  }, [open, firstKey]);

  let list = null;
  if (status && !status.plugin) list = <div className="text-secondary text-sm p-4">{t("brain.off")}</div>;
  else if (!notes) {
    if (!busy) list = <div className="text-secondary text-sm text-center p-4">{t("brain.notLoaded")}</div>;
  } else if (!notes.length) list = <div className="text-secondary text-sm px-4 py-4">{t("brain.none")}</div>;
  else
    list = byBrain(notes).map(([path, rows]) => (
      <section key={path}>
        <h2
          className="flex items-baseline gap-1.5 px-4 pt-4.5 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-tertiary"
          title={path}
        >
          {brainName(path)} <span className="tabular-nums">{rows.length}</span>
        </h2>
        <div className="flex flex-col gap-0.5 px-2">
          {rows.map(row => (
            <BrainRow key={brainKey(row)} note={row} selected={brainKey(row) === open} />
          ))}
        </div>
      </section>
    ));
  return (
    <div className={`${className} grid grid-cols-[380px_minmax(0,1fr)] min-h-0`}>
      <div className="min-h-0 overflow-y-auto border-r border-separator pb-4">
        {err ? <div className="err-box m-4">{err}</div> : null}
        {list}
      </div>
      <div className="min-h-0 overflow-y-auto">
        {note ? (
          <BrainPane note={note} />
        ) : (
          <div className="h-full grid place-items-center text-[13px] text-tertiary">{t("brain.pick")}</div>
        )}
      </div>
    </div>
  );
}

function BrainRow({ note, selected }: { note: BrainNote; selected: boolean }) {
  const { t } = useT();
  return (
    <button
      type="button"
      className={`flex flex-col gap-1.25 p-2.5 rounded-[9px] cursor-pointer w-full text-left ${selected ? "bg-accent-soft" : "hover:bg-fill"}`}
      onClick={() => openNote(brainKey(note))}
    >
      <span className="text-[13px] font-medium leading-snug">{note.title || note.id}</span>
      <span className="flex flex-wrap items-center gap-2 text-xs text-secondary tabular-nums">
        <span className="font-mono text-[11px]">{note.kind}</span>
        {t("brain.by", { author: note.author, date: note.created })}
      </span>
    </button>
  );
}

function BrainPane({ note }: { note: BrainNote }) {
  const { t, th } = useT();
  const acting = useBrainStore(s => s.acting);
  const status = useBrainStore(s => s.status);
  const cli = !!status?.cli;
  return (
    <div className="max-w-180 px-8 pt-5.5 pb-10 flex flex-col gap-4 select-text cursor-auto">
      <div className="flex items-center gap-2 text-xs text-secondary">
        <span className="font-mono">{note.kind}</span>
        <span>·</span>
        <span title={note.brain}>{brainName(note.brain)}</span>
        {note.source ? (
          <>
            <span>·</span>
            <span className="font-mono">{note.source}</span>
          </>
        ) : null}
        <span className="flex-1"></span>
        <button
          className="btn"
          title={t("brain.rejectTitle")}
          disabled={acting || !cli}
          onClick={() => brainAct(note, "reject")}
        >
          {t("brain.reject")}
        </button>
        <button
          className="btn btn-primary"
          title={t("brain.promoteTitle")}
          disabled={acting || !cli}
          onClick={() => brainAct(note, "promote")}
        >
          {t("brain.promote")}
        </button>
      </div>
      <h1 className="m-0 text-xl font-semibold leading-snug">{note.title || note.id}</h1>
      <div className="text-xs text-secondary tabular-nums">
        {t("brain.by", { author: note.author, date: note.created })}
      </div>
      {cli ? null : <Html className="err-box" html={th("brain.noCli", { hint: status?.hint ?? "" })} />}
      <Markdown className="md-panel text-sm leading-[1.55]" text={note.body} />
    </div>
  );
}
