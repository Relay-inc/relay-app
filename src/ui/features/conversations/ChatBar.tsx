import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Drawer } from "../../../domain/navigation/views";
import { useT } from "../../hooks/useT";
import { Glyph } from "../../components/Glyph";
import { Icon } from "../../components/Icon";
import { ProjectImg } from "../../components/ProjectImg";
import { tintText, type Tint } from "../../../shared/tints";

/** What the bar offers for a project: its tools, the one that is open lit. */
export type BarTools = {
  board: { name: string; mark: string } | null; // the board linked to the project
  github: boolean; // GitHub is on: the PRs button shows
  repos: boolean; // the project has repos; without them the button offers to link one
  active: "" | "board" | "prs"; // the project's board or PRs is what the centre shows
};

/** The title bar of the centre column: the project (or the view), the conversation's title and state, a view's own
 *  buttons (`actions`), the project's tools (board, pull requests, terminal and notes drawers) and the external
 *  terminal button. The shell keys it by the selection, so a title being edited never carries over. */
export function ChatBar({
  heading,
  img,
  tint,
  state,
  editable,
  sub,
  value,
  readonly,
  renamable,
  noTerm,
  locked,
  tools,
  drawer,
  back,
  actions,
  onEditProject,
  onRename,
  onOpenTerminal,
  onOpenBoard,
  onOpenPrs,
  onToggleDrawer,
}: {
  heading: string;
  img: string; // the project's icon, an image data url
  tint: Tint;
  state: "" | "busy" | "idle"; // the conversation's state pill; "" shows none
  editable: boolean; // a conversation, not a view: the heading opens the project panel, the title is shown
  sub: string;
  value: string; // the conversation's title
  readonly: boolean; // a terminal session takes its title from the transcript
  renamable: boolean;
  noTerm: boolean;
  locked: boolean; // the terminal would resume a conversation that touched mail without the app's restrictions
  tools: BarTools | null; // a vault project is open (or its board or PRs): its tool icons show on the right
  drawer: Drawer; // what the right drawer shows, the open tool lights up
  back: boolean; // the project's board or PRs is shown: the heading goes back to the conversation
  actions?: ReactNode;
  onEditProject: () => void;
  onRename: (title: string) => void;
  onOpenTerminal: () => void;
  onOpenBoard: () => void;
  onOpenPrs: () => void;
  onToggleDrawer: (tool: "terminal" | "notes") => void;
}) {
  const { t } = useT();
  // the title while it is edited: a redraw must not take the text away from under the caret
  const [draft, setDraft] = useState<string | null>(null);
  // Escape blurs without saving
  const cancelled = useRef(false);
  const shown = draft ?? value;

  const onTitleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelled.current = true;
      e.currentTarget.blur();
    }
  };
  // what the native change event did: only an edited title is saved, an empty one goes back
  const onTitleBlur = () => {
    const title = draft?.trim();
    const save = !cancelled.current && draft !== null && draft !== value && renamable && title;
    cancelled.current = false;
    setDraft(null);
    if (save) onRename(title);
  };

  return (
    <div
      className="flex-none h-12 flex items-center gap-2 pl-5 pr-3 border-b border-separator select-none"
      data-tauri-drag-region
    >
      <h1
        className={
          "flex items-center gap-1.5 text-sm font-normal flex-none max-w-2/5 whitespace-nowrap overflow-hidden text-ellipsis cursor-default rounded-md px-1.5 py-0.75 -ml-1.5 text-secondary" +
          (editable || back
            ? " hover:bg-fill hover:text-label focus-visible:outline-3 focus-visible:outline-accent/45 focus-visible:outline-offset-1"
            : "")
        }
        title={editable ? t("chat.editTitle") : undefined}
        // in a conversation the heading opens the project panel, from the keyboard too
        role={editable || back ? "button" : undefined}
        tabIndex={editable || back ? 0 : undefined}
        onClick={onEditProject}
        onKeyDown={e => {
          if (!(editable || back) || (e.key !== "Enter" && e.key !== " ")) return;
          e.preventDefault();
          onEditProject();
        }}
      >
        {img ? (
          <ProjectImg url={img} className="size-3.5 flex-none object-contain rounded-xs" />
        ) : editable ? (
          <Icon name="folder" className={`glyph size-3.5 flex-none ${tintText(tint)}`} />
        ) : null}
        {heading}
      </h1>
      {editable ? (
        <>
          <span className="text-tertiary">/</span>
          {/* the invisible mirror sizes the field to its text, the input fills it */}
          <span className="inline-grid min-w-0 max-w-2/5">
            <span
              className="col-start-1 row-start-1 invisible whitespace-pre overflow-hidden text-sm font-semibold px-1.5"
              aria-hidden="true"
            >
              {shown || " "}
            </span>
            <input
              className={
                "col-start-1 row-start-1 w-full text-sm font-semibold text-label bg-transparent border-0 rounded-md px-1.5 py-0.75 min-w-0 outline-0 text-ellipsis focus:bg-fill" +
                (readonly ? "" : " hover:bg-fill")
              }
              spellCheck={false}
              aria-label={t("bar.chatTitle")}
              readOnly={readonly}
              title={readonly ? t("chat.titleFromTerm") : t("chat.titleEdit")}
              value={shown}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={onTitleKey}
              onBlur={onTitleBlur}
            />
          </span>
          {/* resumes the conversation in iTerm or WezTerm: it belongs to the conversation, so it sits by its title */}
          <button
            className="btn-icon disabled:opacity-40"
            hidden={noTerm}
            disabled={locked}
            title={t(locked ? "bar.termMail" : "bar.openTerminal")}
            aria-label={t("bar.openTerminal")}
            onClick={onOpenTerminal}
          >
            <Icon name="term" className="glyph size-4" />
          </button>
        </>
      ) : null}
      <span className="text-secondary whitespace-nowrap overflow-hidden text-ellipsis">{sub}</span>
      {state ? (
        <span className="h-5 px-2 rounded-full bg-fill-2 text-secondary text-[11px] font-medium inline-flex items-center gap-1.25 whitespace-nowrap">
          <span className={`size-1.5 rounded-full ${state === "busy" ? "bg-soon" : "bg-ok"}`}></span>
          {t(state === "busy" ? "bar.working" : "bar.ready")}
        </span>
      ) : null}
      <span className="flex-1" data-tauri-drag-region></span>
      {actions}
      {tools ? (
        <>
          {tools.board ? (
            <ToolButton
              on={tools.active === "board"}
              label={tools.board.name}
              onClick={onOpenBoard}
              icon={<Glyph svg={tools.board.mark} className="glyph size-4" viewBox="0 0 24 24" />}
            />
          ) : null}
          {tools.github ? (
            <ToolButton
              on={tools.active === "prs"}
              dim={!tools.repos}
              label={tools.repos ? t("nav.prs") : t("bar.linkRepo")}
              onClick={onOpenPrs}
              icon={<Icon name="github" className="glyph size-4" />}
            />
          ) : null}
          {(["terminal", "notes"] as const).map(tool => (
            <ToolButton
              key={tool}
              on={drawer === tool}
              label={t(`drawer.${tool}`)}
              onClick={() => onToggleDrawer(tool)}
              icon={<Icon name={tool === "terminal" ? "drawerTerm" : "notes"} className="glyph size-4" />}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

// one button per tool, the one that is open lit: a second click goes back (a view) or closes the drawer
function ToolButton({
  on,
  dim = false,
  label,
  icon,
  onClick,
}: {
  on: boolean;
  dim?: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`btn-icon ${on ? "text-accent!" : dim ? "opacity-40 hover:opacity-100" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
