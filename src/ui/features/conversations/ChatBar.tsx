import { useRef, useState, type KeyboardEvent } from "react";
import { useT } from "../../hooks/useT";
import { Glyph } from "../../components/Glyph";
import { Icon } from "../../components/Icon";
import { ProjectImg } from "../../components/ProjectImg";

const barButton =
  "h-6 rounded-lg border-0 bg-transparent cursor-default whitespace-nowrap transition-colors duration-(--d) ease-(--ease) hover:bg-fill focus-visible:outline-3 focus-visible:outline-accent/45 focus-visible:outline-offset-1";

/** The title bar of the centre column: the project (or the view) and the conversation's title, the terminal and the
 *  right panel buttons. The shell keys it by the selection, so a title being edited never carries over. */
export function ChatBar({
  heading,
  img,
  editable,
  sub,
  value,
  readonly,
  renamable,
  noTerm,
  locked,
  panelOff,
  onEditProject,
  onRename,
  onOpenTerminal,
  onTogglePanel,
}: {
  heading: string;
  img: string; // the project's icon, an image data url
  editable: boolean; // a conversation, not a view: the heading opens the project panel, the title is shown
  sub: string;
  value: string; // the conversation's title
  readonly: boolean; // a terminal session takes its title from the transcript
  renamable: boolean;
  noTerm: boolean;
  locked: boolean; // the terminal would resume a conversation that touched mail without the app's restrictions
  panelOff: boolean;
  onEditProject: () => void;
  onRename: (title: string) => void;
  onOpenTerminal: () => void;
  onTogglePanel: () => void;
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
      className="flex-none h-13 flex items-center gap-2.5 px-5 border-b border-separator select-none"
      data-tauri-drag-region
    >
      <h1
        className={
          "text-base font-semibold flex-none max-w-2/5 whitespace-nowrap overflow-hidden text-ellipsis cursor-default rounded-md px-1.5 py-0.5 -ml-1.5" +
          (editable
            ? " hover:bg-fill focus-visible:outline-3 focus-visible:outline-accent/45 focus-visible:outline-offset-1 after:inline-block after:ml-1.5 after:w-0 after:h-0 after:border-t-4 after:border-t-secondary after:border-x-4 after:border-x-transparent after:align-middle"
            : "")
        }
        title={editable ? t("chat.editTitle") : undefined}
        // in a conversation the heading opens the project panel, from the keyboard too
        role={editable ? "button" : undefined}
        tabIndex={editable ? 0 : undefined}
        onClick={onEditProject}
        onKeyDown={e => {
          if (!editable || (e.key !== "Enter" && e.key !== " ")) return;
          e.preventDefault();
          onEditProject();
        }}
      >
        <ProjectImg url={img} className="inline w-4 h-4 flex-none object-contain rounded-xs mr-1.5" />
        {heading}
        {/* a space between the name and the caret */}{" "}
      </h1>
      {editable ? (
        <>
          <span className="text-secondary -mx-1">›</span>
          <input
            className={
              "text-base text-label bg-transparent border-0 rounded-md px-1.5 py-0.5 min-w-0 max-w-2/5 outline-0 text-ellipsis focus:bg-fill" +
              (readonly ? "" : " hover:bg-fill")
            }
            spellCheck={false}
            aria-label={t("bar.chatTitle")}
            readOnly={readonly}
            title={readonly ? t("chat.titleFromTerm") : t("chat.titleEdit")}
            size={Math.max(4, shown.length)}
            value={shown}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onTitleKey}
            onBlur={onTitleBlur}
          />
        </>
      ) : null}
      <span className="text-secondary whitespace-nowrap overflow-hidden text-ellipsis">{sub}</span>
      <span className="flex-1" data-tauri-drag-region></span>
      <button
        className={`${barButton} w-7 p-0 grid place-items-center text-secondary hover:text-label`}
        hidden={noTerm}
        disabled={locked}
        title={t(locked ? "bar.termMail" : "bar.openTerminal")}
        aria-label={t("bar.openTerminal")}
        onClick={onOpenTerminal}
      >
        <Icon name="term" className="glyph size-4" />
      </button>
      <button
        className={`${barButton} w-7 p-0 grid place-items-center ${panelOff ? "text-accent" : "text-secondary hover:text-label"}`}
        title={t("bar.togglePanelTitle")}
        aria-label={t("bar.togglePanel")}
        onClick={onTogglePanel}
      >
        <Glyph
          svg='<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M10 3v10"/>'
          className="glyph size-4"
        />
      </button>
    </div>
  );
}
