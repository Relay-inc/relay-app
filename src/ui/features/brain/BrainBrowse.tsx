import { useEffect, useMemo, useState } from "react";
import type { BrainGraph, BrainRoot, Folder, Glow } from "../../../domain/brain/types";
import { adjacency, folderSize, folderTree, topKinds } from "../../../domain/brain/rules";
import { useBrainStore } from "../../../application/brain/store";
import { askAbout, followLink, openBrainNote, runSearch, setQuery, toggleGlow } from "../../../application/brain/brain";
import { useConversationsStore } from "../../../application/conversations/store";
import { select } from "../../../application/navigation/navigation";
import { markdownWith } from "../../../shared/markdown";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { agoOf } from "./ago";

/** Browse: the folder tree (or the search hits, or the notes conversations touched) on the left, the open note on the
 *  right with the notes it links to and from. */
export function BrainBrowse({
  root,
  graph,
  glow,
}: {
  root: BrainRoot;
  graph: BrainGraph;
  glow: Map<string, Glow> | null;
}) {
  const { t } = useT();
  const query = useBrainStore(s => s.query);
  const hits = useBrainStore(s => s.hits);
  const note = useBrainStore(s => s.note);
  const open = note?.root === root.id ? note.path : "";

  // search after a pause in typing
  useEffect(() => {
    if (!query.trim()) return;
    const timer = setTimeout(runSearch, 200);
    return () => clearTimeout(timer);
  }, [query, root.id]);

  let list;
  if (query.trim())
    list = !hits ? null : hits.length ? (
      hits.map(hit => (
        <button
          key={hit.path}
          type="button"
          className={`flex flex-col gap-0.5 px-2.5 py-2 rounded-lg text-left w-full ${hit.path === open ? "bg-accent-soft" : "hover:bg-fill"}`}
          onClick={() => openBrainNote(hit.path)}
        >
          <span className="text-[13px] font-medium leading-snug">{hit.title}</span>
          <span className="text-xs text-secondary line-clamp-2">{hit.snippet}</span>
        </button>
      ))
    ) : (
      <div className="text-secondary text-sm p-2.5">{t("brain.noHits")}</div>
    );
  else if (glow) list = <TouchedList graph={graph} glow={glow} open={open} />;
  else list = <Tree graph={graph} open={open} />;

  return (
    <div className="flex-1 grid grid-cols-[320px_minmax(0,1fr)] min-h-0">
      <div className="min-h-0 flex flex-col border-r border-separator">
        <div className="flex items-center gap-2 p-3 pb-2">
          <input
            className="field flex-1 min-w-0"
            type="search"
            placeholder={t("brain.search", { name: root.name })}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <button
            className={`btn px-2.5 text-xs ${glow ? "bg-accent-soft border-accent" : ""}`}
            title={t("brain.glowTitle")}
            aria-pressed={!!glow}
            onClick={toggleGlow}
          >
            {t("brain.touchedFilter")}
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-4">{list}</div>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {note && note.root === root.id ? (
          <NotePane root={root} graph={graph} path={note.path} text={note.text} glow={glow?.get(note.path)} />
        ) : (
          <div className="h-full grid place-items-center text-[13px] text-tertiary">{t("brain.pickNote")}</div>
        )}
      </div>
    </div>
  );
}

/** The folders, folded until opened; the folders above the open note are opened for it. */
function Tree({ graph, open }: { graph: BrainGraph; open: string }) {
  const tree = useMemo(() => folderTree(graph.nodes), [graph]);
  // a folder the user opened or closed stays that way; the others are open when they hold the open note
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());
  const parts = open.split("/").slice(0, -1);
  const above = new Set(parts.map((_, i) => parts.slice(0, i + 1).join("/")));
  const isOpen = (path: string) => toggled.get(path) ?? above.has(path);
  const toggle = (path: string) => setToggled(prev => new Map(prev).set(path, !isOpen(path)));
  if (!graph.nodes.length) return <EmptyList />;
  const rows: React.ReactNode[] = [];
  const walk = (folder: Folder, depth: number) => {
    for (const sub of folder.folders) {
      const on = isOpen(sub.path);
      rows.push(
        <button
          key={`d:${sub.path}`}
          type="button"
          className="flex items-center gap-1 w-full h-7 pr-2 rounded-md text-left text-[13px] hover:bg-fill"
          style={{ paddingLeft: 4 + depth * 14 }}
          onClick={() => toggle(sub.path)}
        >
          <Icon name="right" className={`glyph size-3 text-tertiary transition-transform ${on ? "rotate-90" : ""}`} />
          <span className="flex-1 truncate font-medium">{sub.name}</span>
          <span className="text-xs text-tertiary tabular-nums">{folderSize(sub)}</span>
        </button>,
      );
      if (on) walk(sub, depth + 1);
    }
    for (const i of folder.notes) {
      const node = graph.nodes[i];
      rows.push(
        <button
          key={node.p}
          type="button"
          title={node.p}
          className={`flex items-center w-full h-7 pr-2 rounded-md text-left text-[13px] ${node.p === open ? "bg-accent-soft" : "hover:bg-fill"}`}
          style={{ paddingLeft: 20 + depth * 14 }}
          onClick={() => openBrainNote(node.p)}
        >
          <span className="truncate">{node.t}</span>
        </button>,
      );
    }
  };
  walk(tree, 0);
  return <div className="flex flex-col">{rows}</div>;
}

/** The notes conversations touched, the most recent first. */
function TouchedList({ graph, glow, open }: { graph: BrainGraph; glow: Map<string, Glow>; open: string }) {
  const { t } = useT();
  const titles = new Map(graph.nodes.map(n => [n.p, n.t]));
  const rows = [...glow].sort((a, b) => b[1].at - a[1].at);
  if (!rows.length) return <div className="text-secondary text-sm p-2.5">{t("brain.noGlow")}</div>;
  return (
    <div className="flex flex-col gap-0.5">
      {rows.map(([path, g]) => (
        <button
          key={path}
          type="button"
          title={path}
          className={`flex items-center gap-2 px-2.5 h-8 rounded-md text-left text-[13px] w-full ${path === open ? "bg-accent-soft" : "hover:bg-fill"}`}
          onClick={() => openBrainNote(path)}
        >
          <span className={`size-2 rounded-full flex-none ${g.write ? "bg-viz-2" : "bg-viz-1"}`} />
          <span className="flex-1 truncate">{titles.get(path) ?? path}</span>
          <span className="text-xs text-tertiary tabular-nums whitespace-nowrap">{agoOf(g.at, t)}</span>
        </button>
      ))}
    </div>
  );
}

const EmptyList = () => {
  const { t } = useT();
  return <div className="text-secondary text-sm p-2.5">{t("brain.empty")}</div>;
};

/** The note: where it sits, its text with links that stay in this folder, who touched it, and its links. */
function NotePane({
  root,
  graph,
  path,
  text,
  glow,
}: {
  root: BrainRoot;
  graph: BrainGraph;
  path: string;
  text: string;
  glow: Glow | undefined;
}) {
  const { t } = useT();
  const chats = useConversationsStore(s => s.chats);
  const index = graph.nodes.findIndex(n => n.p === path);
  const node = graph.nodes[index];
  // what a [[link]] can name in this folder: paths and file names, without .md, any case
  const known = useMemo(() => {
    const names = new Set<string>();
    for (const n of graph.nodes) {
      const stem = n.p.replace(/\.md$/i, "").toLowerCase();
      names.add(stem);
      names.add(stem.split("/").pop()!);
    }
    return (target: string) => {
      const want = target.replace(/\.md$/i, "").toLowerCase();
      return names.has(want) || names.has(want.split("/").pop()!);
    };
  }, [graph]);
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const html = useMemo(() => markdownWith(body, known), [body, known]);
  const linked = useMemo(() => (index >= 0 ? adjacency(graph)[index] : []), [graph, index]);
  const kinds = useMemo(() => topKinds(graph.nodes), [graph]);
  return (
    <div className="max-w-180 px-8 pt-5.5 pb-10 flex flex-col gap-4 select-text cursor-auto">
      <div className="flex items-center gap-2 text-xs text-secondary min-w-0">
        {node?.k ? <span className="font-mono">{node.k}</span> : null}
        {node?.k ? <span>·</span> : null}
        <span className="font-mono truncate" title={path}>
          {path}
        </span>
        <span className="flex-1"></span>
        <button
          className="btn whitespace-nowrap"
          title={t("brain.askTitle")}
          onClick={() => askAbout(root.id, path, root.kind)}
        >
          {t("brain.ask")}
        </button>
      </div>
      <h1 className="m-0 text-xl font-semibold leading-snug">{node?.t ?? path}</h1>
      {node?.g.length ? (
        <div className="flex flex-wrap gap-1.5">
          {node.g.map(tag => (
            <span key={tag} className="px-1.5 py-0.5 rounded-md bg-fill-2 text-xs text-secondary">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      {glow ? (
        <div className="flex flex-col gap-1 rounded-lg border border-separator px-3 py-2 text-xs">
          <span className="text-secondary">
            <span className={`inline-block size-2 rounded-full mr-1.5 ${glow.write ? "bg-viz-2" : "bg-viz-1"}`} />
            {t(glow.write ? "brain.wroteAgo" : "brain.readAgo", { ago: agoOf(glow.at, t) })}
          </span>
          {glow.keys.map(key => (
            <button
              key={key}
              type="button"
              className="text-left text-accent-text hover:underline w-fit"
              onClick={() => select(key)}
            >
              {chats[key]?.title || t("brain.untitled")}
            </button>
          ))}
        </div>
      ) : null}
      <div
        className="relay-brain-note md-panel text-sm leading-[1.55]"
        onClick={e => {
          const link = (e.target as HTMLElement).closest<HTMLElement>("[data-note]");
          if (!link) return;
          e.preventDefault(); // App.tsx would open it as a vault note in the drawer
          followLink(link.dataset.note!);
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {linked.length ? (
        <section className="flex flex-col gap-2 pt-2 border-t border-separator">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-tertiary">
            {t("brain.links")} <span className="tabular-nums">{linked.length}</span>
          </h2>
          <LocalGraph graph={graph} center={index} linked={linked} kinds={kinds} />
          <div className="flex flex-col">
            {linked.map(j => (
              <button
                key={graph.nodes[j].p}
                type="button"
                title={graph.nodes[j].p}
                className="flex items-center gap-2 h-7 px-1.5 rounded-md text-left text-[13px] hover:bg-fill"
                onClick={() => openBrainNote(graph.nodes[j].p)}
              >
                <KindDot kind={graph.nodes[j].k} kinds={kinds} />
                <span className="truncate">{graph.nodes[j].t}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

const SLOT = ["bg-viz-1", "bg-viz-2", "bg-viz-3", "bg-viz-4", "bg-viz-5", "bg-viz-6"];
const SLOT_FILL = ["fill-viz-1", "fill-viz-2", "fill-viz-3", "fill-viz-4", "fill-viz-5", "fill-viz-6"];
export function KindDot({ kind, kinds }: { kind: string; kinds: string[] }) {
  const slot = kinds.indexOf(kind);
  return <span className={`size-2 rounded-full flex-none ${slot >= 0 ? SLOT[slot] : "bg-tertiary"}`} />;
}

/** The open note in the middle, the notes it links to and from around it (24 at most), each one click away. */
function LocalGraph({
  graph,
  center,
  linked,
  kinds,
}: {
  graph: BrainGraph;
  center: number;
  linked: number[];
  kinds: string[];
}) {
  const shown = linked.slice(0, 24);
  const [w, h, r] = [560, 200, 78];
  const at = (n: number) => {
    const a = (n / shown.length) * 2 * Math.PI + Math.PI; // from the left, so two or three spread across
    return [w / 2 + Math.cos(a) * r * 2.6, h / 2 + Math.sin(a) * r];
  };
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label={graph.nodes[center].t}>
      {shown.map((j, n) => {
        const [x, y] = at(n);
        return (
          <line key={`l${j}`} x1={w / 2} y1={h / 2} x2={x} y2={y} className="stroke-separator-strong" strokeWidth={1} />
        );
      })}
      {shown.map((j, n) => {
        const [x, y] = at(n);
        const slot = kinds.indexOf(graph.nodes[j].k);
        const title = graph.nodes[j].t;
        return (
          <g key={j} className="cursor-pointer" onClick={() => openBrainNote(graph.nodes[j].p)}>
            <title>{title}</title>
            <circle cx={x} cy={y} r={12} className="fill-transparent" />
            <circle cx={x} cy={y} r={5} className={slot >= 0 ? SLOT_FILL[slot] : "fill-tertiary"} />
            {shown.length <= 12 ? (
              <text x={x} y={y + 17} textAnchor="middle" className="fill-secondary text-[10px]">
                {title.length > 22 ? `${title.slice(0, 20)}…` : title}
              </text>
            ) : null}
          </g>
        );
      })}
      <circle cx={w / 2} cy={h / 2} r={7} className="fill-label" />
    </svg>
  );
}
