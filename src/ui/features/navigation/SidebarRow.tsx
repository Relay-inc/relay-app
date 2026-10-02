import type { ComponentProps, MouseEvent, ReactNode } from "react";
import type { Meta, Section, Trail } from "../../../domain/navigation/sidebar";
import { isImg } from "../../../shared/icons";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Glyph } from "../../components/Glyph";
import { ProjectImg } from "../../components/ProjectImg";
import type { Drop } from "./useReorder";
import { TINT, DROP_LINE_BEFORE, DROP_LINE_AFTER, clickOnKey } from "./rows";

type Tint = Section["tint"];

type Props = Omit<ComponentProps<"div">, "className"> & {
  kind?: "view" | "proj" | "conv" | "fold";
  name: string;
  icon?: string; // a named icon, or `svg`: a provider's own glyph
  svg?: string;
  img?: string | null; // a project's icon: an image, else an emoji, else the folder
  emoji?: string;
  tint?: Tint;
  selected?: boolean;
  unseen?: boolean;
  indent?: boolean; // under its project
  closable?: boolean;
  trail?: Trail;
  subs?: number; // subagents working
  subsTitle?: string;
  meta?: Meta;
  addTitle?: string; // the "+" of a project row
  dragging?: boolean;
  drop?: Drop;
  onClose?: () => void;
  onAdd?: () => void;
};

function metaClass(meta: Meta, selected: boolean) {
  if (meta.kind === "badge")
    return "min-w-4 h-4 px-1 rounded-lg bg-accent text-on-accent text-xs font-semibold grid place-items-center";
  const due = meta.kind === "late" || meta.kind === "soon";
  if (!due) return "tabular-nums text-secondary";
  if (selected) return "tabular-nums text-on-accent font-semibold";
  return `tabular-nums ${meta.kind === "late" ? "due-late" : "due-soon"}`;
}
// the drop line wins over the subrow's guide line, which a selected row drops
function dropLineClass(drop: Drop, indent: boolean, selected: boolean) {
  if (drop === "before") return DROP_LINE_BEFORE;
  if (drop === "after") return DROP_LINE_AFTER;
  if (indent && !selected) return "border-l border-separator";
  return "";
}

/** One row of the sidebar: a view, a project, a conversation or terminal session, or the "n more" fold. The click, press
 *  and context menu are the container's (passed through to the row); the close and "+" buttons are their own. */
export function SidebarRow({
  kind = "view",
  name,
  icon = "",
  svg = "",
  img = null,
  emoji = "",
  tint = "",
  selected = false,
  unseen = false,
  indent = false,
  closable = false,
  trail = "",
  subs = 0,
  subsTitle = "",
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

  const glyphColor = selected ? "text-on-accent" : kind === "proj" ? TINT[tint] || "text-secondary" : "text-secondary";
  const glyphClass = `glyph ${indent ? "size-3" : "size-4"} flex-none ${glyphColor}`;
  let lead: ReactNode = svg ? <Glyph svg={svg} className={glyphClass} /> : <Icon name={icon} className={glyphClass} />;
  if (kind === "fold") lead = null;
  else if (kind === "proj") {
    if (isImg(img)) lead = <ProjectImg url={img} className="size-4 flex-none object-contain rounded-xs" />;
    else if (emoji) lead = <span className="w-4 flex-none text-center text-sm leading-none">{emoji}</span>;
    else lead = <Icon name="folder" className={glyphClass} />;
  }

  const rowClass = selected
    ? "bg-accent text-on-accent"
    : `hover:bg-fill ${indent ? (unseen ? "text-label" : "text-secondary") : ""}`;
  const projectClass = kind === "proj" ? "mt-0.5 font-medium" : "";
  const subClass = indent ? `ml-4 pl-2.5 ${selected ? "" : "rounded-l-none"}` : "";
  const buttonColor = selected ? "text-on-accent" : "text-secondary hover:text-label";
  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={clickOnKey}
      {...rest}
      className={`group flex ${indent ? "h-6" : "h-7"} items-center gap-2 px-2 rounded-md cursor-default transition-colors duration-150 ease-out ${rowClass} ${projectClass} ${subClass} ${dropLineClass(drop, indent, selected)} ${dragging ? "opacity-40" : ""}`}
    >
      {lead}
      <span className={`flex-1 overflow-hidden whitespace-nowrap text-ellipsis ${unseen ? "font-semibold" : ""}`}>
        {name}
      </span>
      {meta ? (
        <span title={meta.title ?? ""} className={metaClass(meta, selected)}>
          {meta.n}
        </span>
      ) : null}
      {subs ? (
        <span
          className={`min-w-4 h-4 px-1 flex-none rounded-lg text-xs font-semibold grid place-items-center tabular-nums ${selected ? "bg-on-accent/25 text-on-accent" : "bg-fill text-secondary"}`}
          title={subsTitle}
        >
          {subs}
        </span>
      ) : null}
      {trail === "dot" ? (
        <span className={`size-2 rounded-full group-hover:hidden ${selected ? "bg-on-accent" : "bg-accent"}`} />
      ) : null}
      {trail === "spin" ? <span className="spinner group-hover:hidden" /> : null}
      {closable ? (
        <button
          className={`hidden group-hover:grid place-items-center size-4 ml-1 flex-none rounded-sm text-sm leading-none cursor-default hover:bg-fill ${buttonColor}`}
          title={t("nav.close")}
          aria-label={t("nav.close")}
          onClick={fromButton(onClose)}
        >
          ×
        </button>
      ) : null}
      {addTitle ? (
        <button
          className={`hidden group-hover:block ml-1 w-5 h-4 rounded-md text-base leading-none cursor-default hover:bg-fill ${buttonColor}`}
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
