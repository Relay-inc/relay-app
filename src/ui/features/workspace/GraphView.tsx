import { useEffect, useMemo, useState } from "react";
import { glowOf, topKinds, touchedKeys } from "../../../domain/graph/rules";
import {
  GLOW_DAYS,
  loadGraph,
  setGlowKey,
  toggleGlow,
  toggleHubs,
  useGraphStore,
} from "../../../application/navigation/graph";
import { openPage, openPagePath } from "../../../application/navigation/pages";
import { activeFolder } from "../../../application/navigation/workspaces";
import { useConversationsStore } from "../../../application/conversations/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { GraphCanvas } from "./GraphCanvas";
import { agoOf } from "./ago";

const SLOT = ["bg-viz-1", "bg-viz-2", "bg-viz-3", "bg-viz-4", "bg-viz-5", "bg-viz-6"];

/** The Pages graph: every note of the workspace shown as a dot, its links as lines; a click opens the note as a page.
 *  One row of controls above it: the legend, the counts, hide index notes, the conversation glow and which
 *  conversation it shows. */
export function GraphView({ className = "" }: { className?: string }) {
  const { t, locale } = useT();
  const folder = useDerived(() => activeFolder());
  const graph = useGraphStore(s => s.graphs[folder]);
  const err = useGraphStore(s => s.err);
  const hideHubs = useGraphStore(s => s.hideHubs);
  const glowOn = useGraphStore(s => s.glow);
  const glowKey = useGraphStore(s => s.glowKey);
  const touches = useNavigationStore(s => s.sidebar.touches);
  const chats = useConversationsStore(s => s.chats);
  const open = useDerived(() => openPagePath());
  const [fitTick, setFitTick] = useState(0);
  // another workspace picked while the graph is open: its notes
  useEffect(() => void loadGraph(), [folder]);
  const root = graph?.root ?? "";
  const glow = useMemo(
    () => (glowOn && graph ? glowOf(touches, root, 0, glowKey) : null),
    [glowOn, graph, touches, root, glowKey],
  );
  const kinds = useMemo(() => (graph ? topKinds(graph.nodes) : []), [graph]);
  const hubs = useMemo(() => graph?.nodes.filter(n => n.h).length ?? 0, [graph]);
  const keys = useMemo(() => touchedKeys(touches, root), [touches, root]);
  const fmt = (n: number) => n.toLocaleString(locale);
  const chatTitle = (key: string) => chats[key]?.title || t("graph.untitled");

  if (!graph)
    return (
      <div className={`${className} grid place-items-center text-[13px] text-tertiary`}>
        {err || t("graph.loading")}
      </div>
    );
  const shown = hideHubs ? graph.nodes.length - hubs : graph.nodes.length;
  return (
    <div className={`${className} flex flex-col min-h-0`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 border-b border-separator text-xs text-secondary">
        {glow ? (
          <>
            <Legend dot="bg-viz-1" label={t("graph.read")} />
            <Legend dot="bg-viz-2" label={t("graph.wrote")} />
          </>
        ) : (
          <>
            {kinds.map((kind, slot) => (
              <Legend key={kind} dot={SLOT[slot]} label={kind} />
            ))}
            <Legend dot="bg-tertiary" label={t("graph.other")} />
          </>
        )}
        <span className="tabular-nums text-tertiary">
          {t("graph.count", { notes: fmt(shown), links: fmt(graph.edges.length / 2) })}
        </span>
        <span className="flex-1"></span>
        {hubs ? (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={hideHubs} onChange={toggleHubs} />
            {t("graph.hideHubs", { n: hubs })}
          </label>
        ) : null}
        {glow ? (
          <select className="field h-7 text-xs max-w-60" value={glowKey} onChange={e => setGlowKey(e.target.value)}>
            <option value="">{t("graph.allChats")}</option>
            {keys.map(key => (
              <option key={key} value={key}>
                {chatTitle(key)}
              </option>
            ))}
          </select>
        ) : null}
        <button
          className={`btn h-7 text-xs ${glow ? "bg-accent-soft border-accent" : ""}`}
          title={t("graph.glowTitle")}
          aria-pressed={!!glow}
          onClick={toggleGlow}
        >
          {t("graph.glow")}
        </button>
        <button className="btn h-7 text-xs" onClick={() => setFitTick(n => n + 1)}>
          {t("graph.fit")}
        </button>
      </div>
      {err ? <div className="err-box m-3">{err}</div> : null}
      {glow && !glow.size ? (
        <div className="px-4 py-2 text-xs text-secondary border-b border-separator">{t("graph.noGlow")}</div>
      ) : null}
      <GraphCanvas
        root={root}
        graph={graph}
        hideHubs={hideHubs}
        kinds={kinds}
        glow={glow}
        glowDays={GLOW_DAYS}
        focus={open}
        fitTick={fitTick}
        onOpen={openPage}
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
                  {t(g.write ? "graph.wroteAgo" : "graph.readAgo", { ago: agoOf(g.at, t) })}
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
    <span className={`size-2 rounded-full flex-none ${dot}`} />
    {label}
  </span>
);
