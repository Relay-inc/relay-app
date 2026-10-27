import type { ComponentProps, MouseEvent, ReactNode } from "react";
import type { Meta, Section, Trail } from "../../../domain/navigation/sidebar";
import { isImg } from "../../../shared/icons";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Glyph } from "../../components/Glyph";
import { ProjectImg } from "../../components/ProjectImg";
import type { Drop } from "./useReorder";
import { tintText } from "../../../shared/tints";
import { DROP_LINE_BEFORE, DROP_LINE_AFTER, clickOnKey } from "./rows";

type Tint = Section["tint"];

type Props = Omit<ComponentProps<"div">, "className"> & {
  kind?: "view" | "tile" | "proj" | "folder" | "conv" | "fold";
  name: string;
  icon?: string; // a named icon, or `svg`: a provider's own glyph
  svg?: string;
  box?: string; // the grid `svg` is drawn on
  img?: string | null; // a project's icon: an image, else an emoji, else the folder
  emoji?: string;
  tint?: Tint;
  selected?: boolean;
  unseen?: boolean;
  indent?: boolean; // under its project
  nested?: boolean; // in a folder under its project: one step further in
  closable?: boolean;
  closing?: boolean; // being closed: greyed out and pulsing until it is gone
  trail?: Trail;
  subs?: number; // subagents working
  subsTitle?: string;
  mark?: string; // a worker of the orchestrator: its small marker carries this tooltip
  hint?: string; // a short word after the name: the vault a general conversation runs in
  hintTitle?: string;
  meta?: Meta;
  addTitle?: string; // the "+" of a project or folder row
  dragging?: boolean;
  drop?: Drop;
  onClose?: () => void;
  onAdd?: () => void;
};

function metaClass(meta: Meta) {
  if (meta.kind === "badge")
    return "min-w-4.5 h-4.5 px-1.25 rounded-full bg-accent text-on-accent text-[11px] font-semibold grid place-items-center tabular-nums";
  if (meta.kind === "late") return "tabular-nums text-xs font-medium text-late";
  if (meta.kind === "soon") return "tabular-nums text-xs font-medium text-soon";
  return "tabular-nums text-xs font-medium text-secondary";
}
function dropLineClass(drop: Drop, tile: boolean) {
  // a conversation held over a project or folder goes into it: the whole row is outlined
  if (drop === "in") return "ring-1 ring-inset ring-accent";
  // tiles stand side by side: the line goes left or right of them
  if (tile && drop)
    return `relative before:absolute before:inset-y-1 before:w-0.5 before:bg-accent ${drop === "before" ? "before:-left-0.5" : "before:-right-0.5"}`;
  if (drop === "before") return DROP_LINE_BEFORE;
  if (drop === "after") return DROP_LINE_AFTER;
  return "";
}
// the count on a tile: the badge in its corner, small enough not to cover the icon
// a view icon carries no number, only a dot: something new (blue), or something late (red); a plain count none.
// The number is in the tooltip
const TILE_DOT: Record<Meta["kind"], string> = { badge: "bg-accent", late: "bg-late", soon: "bg-accent", count: "" };

/** One row of the sidebar: a view, a project, a folder, a conversation or terminal session, or the "n more" fold; or a view as a
 *  square icon (`tile`) when the views are shown as a row of icons. The click, press and context menu are the
 *  container's (passed through to the row); the close and "+" buttons are their own. */
export function SidebarRow({
  kind = "view",
  name,
  icon = "",
  svg = "",
  box = "0 0 16 16",
  img = null,
  emoji = "",
  tint = "",
  selected = false,
  unseen = false,
  indent = false,
  nested = false,
  closable = false,
  closing = false,
  trail = "",
  subs = 0,
  subsTitle = "",
  mark = "",
  hint = "",
  hintTitle,
  meta,
  addTitle = "",
  dragging = false,
  drop = "",
  onClose,
  onAdd,
  ...rest
}: Props) {
  const { t } = useT();
  const fromButton = (action?: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    action?.();
  };

  const glyphColor = closing
    ? "text-tertiary"
    : selected
      ? "text-accent-text"
      : kind === "proj"
        ? tintText(tint, "text-secondary")
        : kind === "conv" && !unseen
          ? "text-tertiary opacity-60" // a conversation's glyph stays faint, its title carries it
          : "text-secondary";
  const glyph = (className: string) =>
    svg ? <Glyph svg={svg} viewBox={box} className={className} /> : <Icon name={icon} className={className} />;

  if (kind === "tile") {
    const tip = meta?.title ? `${name}: ${meta.title}` : name;
    return (
      <div
        role="button"
        tabIndex={0}
        onKeyDown={clickOnKey}
        title={tip}
        aria-label={tip}
        aria-pressed={selected}
        {...rest}
        className={`relative w-8.5 h-7.5 grid place-items-center rounded-lg cursor-default transition-colors duration-150 ease-out ${selected ? "bg-accent-soft" : "hover:bg-fill"} ${dropLineClass(drop, true)} ${dragging ? "opacity-40" : ""}`}
      >
        {glyph(`glyph size-4 ${selected ? "text-accent-text" : "text-tertiary"}`)}
        {meta && TILE_DOT[meta.kind] ? (
          <span
            className={`absolute top-1.5 right-1.75 size-1.5 rounded-full shadow-[0_0_0_1.5px_var(--color-sidebar)] ${TILE_DOT[meta.kind]}`}
          />
        ) : null}
      </div>
    );
  }

  const glyphClass = `glyph ${kind === "conv" ? (indent ? "size-3.25" : "size-3.75") : indent ? "size-3.5" : "size-4"} flex-none ${glyphColor}`;
  let lead: ReactNode = glyph(glyphClass);
  if (kind === "fold") lead = null;
  else if (kind === "proj") {
    if (isImg(img)) lead = <ProjectImg url={img} className="size-4 flex-none object-contain rounded-xs" />;
    else if (emoji) lead = <span className="w-4 flex-none text-center text-sm leading-none">{emoji}</span>;
    // no icon of its own: its initial (or a short all-caps first word, "BE") on a small tile in its context's colour
    else
      lead = (
        <span
          className={`grid place-items-center size-4 flex-none rounded-[4px] bg-fill-2 text-[9px] font-bold leading-none ${tintText(tint, "text-secondary")}`}
        >
          {/^[A-Z0-9]{2,3}\b/.exec(name)?.[0] ?? name.trim().charAt(0)}
        </span>
      );
  }

  const rowClass = closing
    ? "text-tertiary"
    : selected
      ? "bg-accent-soft"
      : `hover:bg-fill ${indent ? (unseen ? "text-label" : "text-secondary hover:text-label") : ""}`;
  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={clickOnKey}
      aria-busy={closing}
      {...rest}
      className={`group flex ${indent ? "h-7.5 gap-2" : "h-8 gap-2.5"} items-center px-2 rounded-md cursor-default transition-colors duration-150 ease-out ${rowClass} ${nested ? "ml-9" : indent ? "ml-4.5" : ""} ${dropLineClass(drop, false)} ${dragging ? "opacity-40" : ""} ${closing ? "pointer-events-none animate-skel" : ""}`}
    >
      {lead}
      <span
        className={`flex-1 overflow-hidden whitespace-nowrap text-ellipsis ${unseen ? "font-semibold" : selected ? "font-medium" : ""}`}
      >
        {name}
      </span>
      {hint ? (
        <span className="flex-none max-w-24 truncate text-xs text-tertiary" title={hintTitle}>
          {hint}
        </span>
      ) : null}
      {mark ? (
        <span className="flex-none text-tertiary" title={mark}>
          <Icon name="agent" className="glyph size-3" />
        </span>
      ) : null}
      {meta ? (
        <span title={meta.title ?? ""} className={metaClass(meta)}>
          {meta.n}
        </span>
      ) : null}
      {subs ? (
        <span
          className="min-w-4 h-4 px-1 flex-none rounded-lg text-xs font-semibold grid place-items-center tabular-nums bg-fill-2 text-secondary"
          title={subsTitle}
        >
          {subs}
        </span>
      ) : null}
      {trail === "dot" ? <span className="size-2 flex-none rounded-full bg-accent group-hover:hidden" /> : null}
      {trail === "spin" ? <span className="spinner group-hover:hidden" /> : null}
      {closable && !closing ? (
        <button
          className="hidden group-hover:grid place-items-center size-4 ml-1 flex-none rounded-sm text-sm leading-none cursor-default text-secondary hover:bg-fill-2 hover:text-label"
          title={t("nav.close")}
          aria-label={t("nav.close")}
          onClick={fromButton(onClose)}
        >
          ×
        </button>
      ) : null}
      {addTitle ? (
        <button
          className="hidden group-hover:block ml-1 w-5 h-4 rounded-md text-base leading-none cursor-default text-secondary hover:bg-fill-2 hover:text-label"
          title={addTitle}
          aria-label={addTitle}
          onClick={fromButton(onAdd)}
        >
          +
        </button>
      ) : null}
    </div>
  );
}
