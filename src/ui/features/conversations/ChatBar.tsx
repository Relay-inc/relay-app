import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Drawer } from "../../../domain/navigation/views";
import { useT } from "../../hooks/useT";
import { Glyph } from "../../components/Glyph";
import { Icon } from "../../components/Icon";
import { ProjectImg } from "../../components/ProjectImg";
import { tintText, type Tint } from "../../../shared/tints";
import { boardOf } from "../../../application/navigation/navigation";
import { useNavigationStore } from "../../../application/navigation/store";
import { BoardCrumb } from "../board/BoardCrumb";
import { BoardActions } from "../board/BoardActions";

/** What the bar offers for a project: its tools, the one that is open lit. */
export type BarTools = {
  board: { name: string; mark: string } | null; // the board linked to the project
  github: boolean; // GitHub is on: the PRs button shows
  repos: boolean; // the project has repos; without them the button offers to link one
  active: "" | "board" | "prs"; // the project's board or PRs is what the centre shows
};

/** The title bar of the centre column: the project (or the view), the conversation's title, a view's own
 *  buttons (`actions`), the project's tools (board, pull requests, terminal and notes drawers) and the external
 *  terminal button. The shell keys it by the selection, so a title being edited never carries over. */
export function ChatBar({
  heading,
  img,
  tint,
  icon,
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
  onShowInBrain,
}: {
  heading: string;
  img: string; // the project's icon, an image data url
  tint: Tint;
  icon: string; // a view's icon, shown before its name; "" for none
  editable: boolean; // a conversation, not a view: the heading opens the project panel, the title is shown
  sub: string; // a view's second crumb ("3 waiting"), shown bold after "/"; "" for none. Not shown on a conversation
  value: string; // the conversation's title
  readonly: boolean; // a terminal session takes its title from the transcript
  renamable: boolean;
  noTerm: boolean;
  locked: boolean; // the terminal would resume a conversation that touched mail without the app's restrictions
  tools: BarTools | null; // a vault project is open (or its board or PRs): its tool icons show on the right
  drawer: Drawer; // what the right drawer shows, the open tool lights up
  back: boolean; // the project's board or PRs is shown: the heading goes back to the conversation
  actions?: ReactNode; // a view's own buttons and quiet text, on the right before the project's tools
  onEditProject: () => void;
  onRename: (title: string) => void;
  onOpenTerminal: (external: boolean) => void;
  onOpenBoard: () => void;
  onOpenPrs: () => void;
  onToggleDrawer: (tool: "terminal" | "notes" | "changes") => void;
  onShowInBrain?: () => void;
}) {
  const { t } = useT();
  // a board: its crumb (switch board or project) and its buttons (BoardCrumb, BoardActions)
  const board = boardOf(useNavigationStore(s => s.selected));
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
          "flex items-center gap-1.5 text-[13px] font-normal flex-none max-w-2/5 whitespace-nowrap overflow-hidden text-ellipsis cursor-default rounded-md px-1.5 py-0.75 -ml-1.5 text-secondary" +
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
        ) : icon ? (
          <Icon name={icon} className="glyph size-3.5 flex-none" />
        ) : null}
        {heading}
      </h1>
      {editable ? (
        <>
          <span className="text-tertiary">/</span>
          {/* the invisible mirror sizes the field to its text, the input fills it */}
          <span className="inline-grid min-w-0 max-w-2/5">
            <span
              className="col-start-1 row-start-1 invisible whitespace-pre overflow-hidden text-[13px] font-semibold px-1.5"
              aria-hidden="true"
            >
              {shown || " "}
            </span>
            <input
              className={
                "col-start-1 row-start-1 w-full text-[13px] font-semibold text-label bg-transparent border-0 rounded-md px-1.5 py-0.75 min-w-0 outline-0 text-ellipsis focus:bg-fill" +
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
          {/* resumes the conversation in the terminal drawer, Option-click in iTerm or WezTerm: it belongs to the conversation, so it sits by its title */}
          <button
            className="btn-icon disabled:opacity-40"
            hidden={noTerm}
            disabled={locked}
            title={t(locked ? "bar.termMail" : "bar.openTerminalHere")}
            aria-label={t("bar.openTerminalHere")}
            onClick={e => onOpenTerminal(e.altKey)}
          >
            <Icon name="term" className="glyph size-4" />
          </button>
          {/* the notes this conversation read and wrote, lit in the Brain graph */}
          {onShowInBrain ? (
            <button
              className="btn-icon"
              title={t("brain.showInTitle")}
              aria-label={t("brain.showIn")}
              onClick={onShowInBrain}
            >
              <Icon name="brain" className="glyph size-4" />
            </button>
          ) : null}
        </>
      ) : null}
      {!editable && sub ? (
        <>
          <span className="text-tertiary text-[13px]">/</span>
          <span className="text-[13px] font-semibold text-label whitespace-nowrap overflow-hidden text-ellipsis">
            {sub}
          </span>
        </>
      ) : null}
      {board ? <BoardCrumb provider={board} /> : null}
      <span className="flex-1" data-tauri-drag-region></span>
      {actions}
      {board ? <BoardActions provider={board} /> : null}
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
          {/* a conversation's changes, from git: only a conversation has them */}
          {(renamable ? (["changes", "terminal", "notes"] as const) : (["terminal", "notes"] as const)).map(tool => (
            <ToolButton
              key={tool}
              on={drawer === tool}
              label={t(`drawer.${tool}`)}
              onClick={() => onToggleDrawer(tool)}
              icon={<Icon name={DRAWER_ICONS[tool]} className="glyph size-4" />}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

const DRAWER_ICONS = { changes: "changes", terminal: "drawerTerm", notes: "notes" } as const;

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
      className={`btn-icon ${on ? "bg-accent-soft text-accent-text!" : dim ? "opacity-40 hover:opacity-100" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
