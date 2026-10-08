import { brainKey, brainName, glowOf } from "../../../domain/brain/rules";
import type { BrainNote } from "../../../domain/brain/types";
import { cwOn } from "../../../domain/settings/types";
import { useBrainStore, type BrainMode } from "../../../application/brain/store";
import { useSettingsStore } from "../../../application/settings/store";
import { brainAct, openNote, setMode, setTab } from "../../../application/brain/brain";
import { Segmented } from "../settings/Segmented";
import { BrainBrowse } from "./BrainBrowse";
import { BrainGraphView } from "./BrainGraphView";
import { useT } from "../../hooks/useT";
import { Html } from "../../components/Html";
import { Markdown } from "../../components/Markdown";

/** The Brain view: the vault, and next to it every Commonwealth brain while that is on, as tabs. Each folder can be
 *  browsed and searched, drawn as a graph, and a brain's staged notes reviewed. */
export function BrainView({ className = "" }: { className?: string }) {
  const { t } = useT();
  const roots = useBrainStore(s => s.roots);
  const status = useBrainStore(s => s.status);
  const tab = useBrainStore(s => s.tab);
  const mode = useBrainStore(s => s.mode);
  const graphs = useBrainStore(s => s.graphs);
  const graphErr = useBrainStore(s => s.graphErr);
  const notes = useBrainStore(s => s.notes);
  const glowOn = useBrainStore(s => s.glow);
  const glowKey = useBrainStore(s => s.glowKey);
  const touches = useBrainStore(s => s.touches);
  const since = useBrainStore(s => s.touchesSince);
  const settings = useSettingsStore(s => s.settings);
  // brains only while Commonwealth is on (its plugin, Settings): visibleRoots, as a selector
  const cw = !!status?.plugin && cwOn(settings);
  const shown = (roots ?? []).filter(r => r.kind === "vault" || cw);
  const root = shown.find(r => r.id === tab) ?? shown[0];
  const graph = root ? graphs[root.id] : undefined;
  const glow = glowOn && root ? glowOf(touches ?? [], root.id, since, glowKey) : null;
  const pending = root?.kind === "brain" ? (notes ?? []).filter(n => brainName(n.brain) === root.name) : [];
  const modes: [BrainMode, string][] = [
    ["browse", t("brain.browse")],
    ["graph", t("brain.graph")],
    ...(root?.kind === "brain"
      ? [
          ["review", pending.length ? `${t("brain.review")} ${pending.length}` : t("brain.review")] as [
            BrainMode,
            string,
          ],
        ]
      : []),
  ];
  const current = modes.some(([m]) => m === mode) ? mode : "browse";

  let body;
  if (!root) body = <Centered text={graphErr || t("brain.notLoaded")} />;
  else if (current === "review") body = <Review notes={pending} />;
  else if (!graph) body = <Centered text={graphErr || t("brain.loading")} />;
  else if (current === "graph") body = <BrainGraphView root={root} graph={graph} glow={glow} />;
  else body = <BrainBrowse root={root} graph={graph} glow={glow} />;

  return (
    <div className={`${className} flex flex-col min-h-0`}>
      <div className="flex items-center gap-3 px-4 h-11 border-b border-separator">
        {shown.length > 1 ? (
          <Segmented
            label={t("nav.brain")}
            options={shown.map(r => [r.id, r.name] as const)}
            value={root?.id ?? ""}
            onPick={setTab}
          />
        ) : null}
        <span className="flex-1"></span>
        <Segmented label={t("brain.mode")} options={modes} value={current} onPick={setMode} />
      </div>
      {graphErr && root && graph ? <div className="err-box m-3">{graphErr}</div> : null}
      {body}
    </div>
  );
}

const Centered = ({ text }: { text: string }) => (
  <div className="flex-1 grid place-items-center text-[13px] text-tertiary">{text}</div>
);

/** Review: a brain's staged notes on the left, the one you picked on the right with Promote and Reject. The CLI does
 *  the promoting. */
function Review({ notes }: { notes: BrainNote[] }) {
  const { t } = useT();
  const err = useBrainStore(s => s.err);
  const open = useBrainStore(s => s.open);
  const note = notes.find(row => brainKey(row) === open) ?? notes[0];
  return (
    <div className="flex-1 grid grid-cols-[380px_minmax(0,1fr)] min-h-0">
      <div className="min-h-0 overflow-y-auto border-r border-separator pb-4 pt-2">
        {err ? <div className="err-box m-4">{err}</div> : null}
        {notes.length ? (
          <div className="flex flex-col gap-0.5 px-2">
            {notes.map(row => (
              <BrainRow key={brainKey(row)} note={row} selected={row === note} />
            ))}
          </div>
        ) : (
          <div className="text-secondary text-sm px-4 py-4">{t("brain.none")}</div>
        )}
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
