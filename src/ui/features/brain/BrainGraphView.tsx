import { useMemo, useState } from "react";
import type { BrainGraph, BrainRoot, Glow } from "../../../domain/brain/types";
import { topKinds, touchedKeys } from "../../../domain/brain/rules";
import { useBrainStore } from "../../../application/brain/store";
import { GLOW_DAYS, openBrainNote, setGlowKey, toggleGlow, toggleHubs } from "../../../application/brain/brain";
import { useConversationsStore } from "../../../application/conversations/store";
import { useT } from "../../hooks/useT";
import { GraphCanvas } from "./GraphCanvas";
import { KindDot } from "./BrainBrowse";
import { agoOf } from "./ago";

/** Graph: every note of the folder as a dot, its links as lines. One row of controls above it: the legend, the
 *  counts, hide index notes, the conversation glow and which conversation it shows. */
export function BrainGraphView({
  root,
  graph,
  glow,
}: {
  root: BrainRoot;
  graph: BrainGraph;
  glow: Map<string, Glow> | null;
}) {
  const { t, locale } = useT();
  const hideHubs = useBrainStore(s => s.hideHubs);
  const glowKey = useBrainStore(s => s.glowKey);
  const touches = useBrainStore(s => s.touches);
  const note = useBrainStore(s => s.note);
  const chats = useConversationsStore(s => s.chats);
  const [fitTick, setFitTick] = useState(0);
  const kinds = useMemo(() => topKinds(graph.nodes), [graph]);
  const hubs = useMemo(() => graph.nodes.filter(n => n.h).length, [graph]);
  const keys = useMemo(() => (touches ? touchedKeys(touches, root.id) : []), [touches, root.id]);
  const shown = hideHubs ? graph.nodes.length - hubs : graph.nodes.length;
  const fmt = (n: number) => n.toLocaleString(locale);
  const chatTitle = (key: string) => chats[key]?.title || t("brain.untitled");

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 border-b border-separator text-xs text-secondary">
        {glow ? (
          <>
            <Legend dot="bg-viz-1" label={t("brain.read")} />
            <Legend dot="bg-viz-2" label={t("brain.wrote")} />
          </>
        ) : (
          <>
            {kinds.map(kind => (
              <span key={kind} className="flex items-center gap-1.5">
                <KindDot kind={kind} kinds={kinds} />
                {kind}
              </span>
            ))}
            <Legend dot="bg-tertiary" label={t("brain.other")} />
          </>
        )}
        <span className="tabular-nums text-tertiary">
          {t("brain.count", { notes: fmt(shown), links: fmt(graph.edges.length / 2) })}
        </span>
        <span className="flex-1"></span>
        {hubs ? (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={hideHubs} onChange={toggleHubs} />
            {t("brain.hideHubs", { n: hubs })}
          </label>
        ) : null}
        {glow ? (
          <select className="field h-7 text-xs max-w-60" value={glowKey} onChange={e => setGlowKey(e.target.value)}>
            <option value="">{t("brain.allChats")}</option>
            {keys.map(key => (
              <option key={key} value={key}>
                {chatTitle(key)}
              </option>
            ))}
          </select>
        ) : null}
        <button
          className={`btn h-7 text-xs ${glow ? "bg-accent-soft border-accent" : ""}`}
          title={t("brain.glowTitle")}
          aria-pressed={!!glow}
          onClick={toggleGlow}
        >
          {t("brain.glow")}
        </button>
        <button className="btn h-7 text-xs" onClick={() => setFitTick(n => n + 1)}>
          {t("brain.fit")}
        </button>
      </div>
      {glow && !glow.size ? (
        <div className="px-4 py-2 text-xs text-secondary border-b border-separator">{t("brain.noGlow")}</div>
      ) : null}
      <GraphCanvas
        root={root.id}
        graph={graph}
        hideHubs={hideHubs}
        kinds={kinds}
        glow={glow}
        glowDays={GLOW_DAYS}
        focus={note?.root === root.id ? note.path : ""}
        fitTick={fitTick}
        onOpen={openBrainNote}
        tooltip={i => {
          const node = graph.nodes[i];
          const g = glow?.get(node.p);
          return (
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-label text-[13px] leading-snug">{node.t}</span>
              <span className="font-mono text-tertiary truncate">{node.p}</span>
              {node.k ? <span className="text-secondary">{node.k}</span> : null}
              {g ? (
                <span className="text-secondary">
                  {t(g.write ? "brain.wroteAgo" : "brain.readAgo", { ago: agoOf(g.at, t) })}
                  {" · "}
                  {g.keys.slice(0, 3).map(chatTitle).join(", ")}
                </span>
              ) : null}
            </div>
          );
        }}
      />
    </div>
  );
}

const Legend = ({ dot, label }: { dot: string; label: string }) => (
  <span className="flex items-center gap-1.5">
    <span className={`size-2 rounded-full ${dot}`} />
    {label}
  </span>
);
