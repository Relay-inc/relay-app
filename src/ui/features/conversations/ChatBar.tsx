import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { ProjectImg } from "../../components/ProjectImg";
import { tintText, type Tint } from "../../../shared/tints";
import { boardOf } from "../../../application/navigation/navigation";
import { useNavigationStore } from "../../../application/navigation/store";
import { BoardCrumb } from "../board/BoardCrumb";
import { BoardActions } from "../board/BoardActions";
import { ProjectButtons } from "./ProjectButtons";

/** What the bar offers for a project: its panel and the actions in its menu. */
export type BarTools = {
  project: string; // the vault project the tools are of
  pipeline: boolean; // the project has a board pipeline: its button shows
  pipeOpen: boolean; // the pipeline's conversation is the one open: its button does not show
};

/** The title bar of the centre column: the project (or the view), the conversation's title, a view's own
 *  buttons (`actions`) and the project's two buttons: its menu and its panel (the drawer's tabs), with the icons of the
 *  tabs that need you before them. The shell keys it by the selection, so a title being edited never carries over. */
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
  remote,
  tools,
  back,
  actions,
  onEditProject,
  onRename,
  onOpenTerminal,
  onStopRemote,
  onOpenPipeline,
  onShowInGraph,
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
  remote: { url: string; state: string } | null; // Remote Control is on: the session to open on claude.ai
  tools: BarTools | null; // a vault project is open (or its board or PRs): its tool icons show on the right
  back: boolean; // the project's board or PRs is shown: the heading goes back to the conversation
  actions?: ReactNode; // a view's own buttons and quiet text, on the right before the project's tools
  onEditProject: () => void;
  onRename: (title: string) => void;
  onOpenTerminal: (external: boolean) => void;
  onStopRemote: () => void;
  onOpenPipeline: () => void;
  onShowInGraph?: () => void;
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
        <ProjectButtons
          project={tools.project}
          // resumes the conversation in the terminal drawer, Option-click in iTerm or WezTerm
          terminal={
            editable && !noTerm
              ? { title: t(locked ? "bar.termMail" : "bar.openTerminalHere"), disabled: locked }
              : null
          }
          remote={remote}
          pipeline={tools.pipeline && !tools.pipeOpen}
          onShowInGraph={onShowInGraph}
          onOpenTerminal={onOpenTerminal}
          onStopRemote={onStopRemote}
          onOpenPipeline={onOpenPipeline}
        />
      ) : null}
    </div>
  );
}
