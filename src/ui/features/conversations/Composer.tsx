import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { isTerminal } from "../../../domain/navigation/keys";
import type { PickKind } from "../../../domain/agents/types";
import { useConversationsStore } from "../../../application/conversations/store";
import { useDraftsStore } from "../../../application/conversations/drafts";
import { useNavigationStore } from "../../../application/navigation/store";
import { matchCommands, type SlashCommand } from "../../../domain/conversations/commands";
import { chatBar, commandsOf } from "../../../application/conversations/selectors";
import {
  attach,
  attachPaths,
  pickAndAttach,
  sendMsg,
  sendOrStop,
  setAgent,
  setTyped,
  unattach,
  unattachFile,
} from "../../../application/conversations/actions";
import { dropTarget } from "../../../application/conversations/attachments";
import { agentOf, chatAgent, inherited, onAgents, picks, setPick } from "../../../application/agents/agents";
import { project } from "../../../application/workspace/vault";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { ImageThumbs } from "../../components/ImageThumbs";
import { FileChips } from "../../components/FileChips";
import { onPasteFiles } from "../../components/image-files";
import { uiRequests } from "../../../application/navigation/requests";
import "../../styles/conversations.css";

// called from a keydown: focus at once so the key lands in the field. A focus asked for while no composer is drawn (at
// the start, or coming from a view) waits here for the field to mount
let mounted: HTMLTextAreaElement | null = null;
let focusPending = false;
uiRequests.addEventListener("focus-composer", () => {
  if (mounted) mounted.focus();
  else focusPending = true;
});
const fieldMounted = (el: HTMLTextAreaElement | null) => {
  mounted = el;
  if (el && focusPending) {
    focusPending = false;
    el.focus();
  }
};

/** The message field with the images and files waiting, the agent, model and effort picks and the send button. */
export function Composer({ className }: { className: string }) {
  const { t } = useT();
  const selected = useNavigationStore(s => s.selected);
  const typed = useDraftsStore(s => s.typed[selected] ?? "");
  const attached = useDraftsStore(s => s.attached);
  const files = useDraftsStore(s => s.files);
  const busy = useConversationsStore(s => s.status[selected] === "busy");
  // the agent is fixed once a conversation has a message, and the sidebar shows it then
  const agentFixed = useConversationsStore(
    s => !s.chats[selected] || !!s.messages[selected]?.length || !!s.chats[selected]?.fork,
  );
  const view = useDerived(() => {
    const { session, projectName } = chatBar(selected);
    const agentId = chatAgent(selected);
    return {
      terminal: !!session,
      projectName: project(projectName) ? projectName : null,
      agentId,
      agent: agentOf(agentId),
      agents: onAgents(),
      model: picks("model"),
      effort: picks("effort"),
      inherited: { model: inherited("model"), effort: inherited("effort") },
    };
  });
  // the open conversation's agent's slash commands and skills
  const commands = useDerived(() => commandsOf(selected));
  const [dropping, setDropping] = useState(false);
  const [picked, setPicked] = useState(0);
  // the text Escape closed the list on: it stays closed until the text changes
  const [dismissed, setDismissed] = useState("");
  const field = useRef<HTMLTextAreaElement | null>(null);

  // files dropped anywhere on the window land here, unless Cmd-K is open over it
  useEffect(
    () =>
      dropTarget({
        over: setDropping,
        drop: paths => attachPaths(paths).then(() => field.current?.focus()),
      }),
    [],
  );

  // the field grows with its text, also when switching puts another conversation's text in it
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [typed]);

  // the agent's slash commands and skills while the field is a `/` and a name
  const completions: SlashCommand[] = typed === dismissed ? [] : matchCommands(commands, typed);
  const current = Math.min(picked, completions.length - 1);
  const complete = (command: SlashCommand) => {
    setTyped(`/${command.name} `);
    setPicked(0);
    field.current?.focus();
  };
  // arrows move through the list, Tab or Enter takes one, Escape closes it
  const onCompletionKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!completions.length || e.nativeEvent.isComposing) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const step = e.key === "ArrowDown" ? 1 : -1;
      setPicked((picked + step + completions.length) % completions.length);
    } else if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
      complete(completions[current]);
    } else if (e.key === "Escape") {
      // the list's own Escape: not the window's, which would start stopping a running turn
      e.stopPropagation();
      setDismissed(typed);
    } else return false;
    e.preventDefault();
    return true;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (onCompletionKey(e)) return;
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMsg();
    }
  };

  // the default names what the agent ran on, once a conversation has shown it
  const defaultLabel = (kind: PickKind) => {
    const value = view.inherited[kind];
    return value
      ? t("composer.resolvedDefault", { value })
      : t(kind === "model" ? "composer.defaultModel" : "composer.defaultEffort");
  };
  const pick = (kind: PickKind, show: boolean) => {
    const { list, value } = view[kind];
    return (
      <span className={`relative items-center ${show ? "inline-flex" : "hidden"}`}>
        {/* a switch restarts the process, so not while a turn runs */}
        <select
          disabled={busy}
          title={t(`composer.${kind}`)}
          aria-label={t(`composer.${kind}`)}
          value={value}
          onChange={e => setPick(kind, e.target.value)}
        >
          <option value="">{defaultLabel(kind)}</option>
          {list.map(option => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        {chevron}
      </span>
    );
  };

  const chevron = (
    <span className="absolute inset-y-0 right-1.5 flex items-center pointer-events-none text-secondary">
      <Icon name="down" className="glyph size-2.75 stroke-2" />
    </span>
  );
  const agent = view.agent;
  const showEffort = !agent || (agent.caps.effort && agent.efforts.length > 0);
  const placeholder = view.terminal
    ? t("ph.term")
    : view.projectName
      ? t("ph.project", { name: view.projectName })
      : t("ph.general");
  return (
    <div className={`relay-composer flex-none ${className}`}>
      <div
        className={`relative rounded-[14px] bg-raised border pt-3 pr-3 pb-2 pl-3.5 shadow-md focus-within:border-accent ${dropping ? "border-accent" : "border-separator-strong"}`}
      >
        {completions.length ? (
          <ul
            className="absolute bottom-full inset-x-0 mb-1.5 py-1 rounded-lg bg-bg border border-separator shadow-md overflow-hidden"
            role="listbox"
            aria-label={t("composer.commands")}
          >
            {completions.map((command, i) => (
              <li
                key={command.name}
                className={`flex items-baseline gap-2 px-3 py-1.5 text-sm cursor-default ${i === current ? "bg-fill" : ""}`}
                role="option"
                aria-selected={i === current}
                onMouseDown={e => e.preventDefault()}
                onClick={() => complete(command)}
                onMouseEnter={() => setPicked(i)}
              >
                <span className="font-medium whitespace-nowrap">/{command.name}</span>
                {command.argumentHint ? (
                  <span className="text-secondary whitespace-nowrap">{command.argumentHint}</span>
                ) : null}
                <span className="text-secondary truncate">{command.description}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {attached.length ? (
          <ImageThumbs
            className="mb-2"
            urls={attached.map(image => image.url)}
            onRemove={i => {
              unattach(i);
              field.current?.focus();
            }}
          />
        ) : null}
        {files.length ? (
          <FileChips
            className="mb-2"
            paths={files}
            onRemove={i => {
              unattachFile(i);
              field.current?.focus();
            }}
          />
        ) : null}
        <textarea
          ref={el => {
            field.current = el;
            fieldMounted(el);
          }}
          rows={1}
          value={typed}
          placeholder={placeholder}
          onKeyDown={onKeyDown}
          onChange={e => {
            setDismissed("");
            setTyped(e.target.value);
            setPicked(0);
          }}
          onPaste={e => onPasteFiles(e, attach, attachPaths)}
        ></textarea>
        <div className="flex items-center gap-0.5 mt-2 -ml-1.5 text-secondary">
          {/* the + opens the file dialog; what it picks joins what is pasted or dropped, by its path */}
          <button
            className="grid place-items-center size-7 rounded-[7px] border-0 bg-transparent text-secondary hover:bg-fill-2 hover:text-label"
            title={t("composer.attach")}
            aria-label={t("composer.attach")}
            onClick={() => pickAndAttach().then(() => field.current?.focus())}
          >
            <Icon name="add" className="glyph size-4" />
          </button>
          {/* with one agent there is nothing to pick */}
          {view.agents.length > 1 && !isTerminal(selected) && !agentFixed ? (
            <>
              <span className="relative inline-flex items-center rounded-[7px] bg-fill-2 text-label">
                <select
                  className="text-label!"
                  title={t("composer.agent")}
                  aria-label={t("composer.agent")}
                  value={view.agentId}
                  onChange={e => setAgent(e.target.value)}
                >
                  {view.agents.map(option => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                {chevron}
              </span>
              <span className="w-px h-3.5 bg-separator-strong mx-1"></span>
            </>
          ) : null}
          {pick("model", true)}
          {pick("effort", showEffort)}
          <span className="flex-1"></span>
          {/* sends, or stops the running turn */}
          <button
            className={`grid place-items-center size-7 rounded-full border-0 ${busy ? "bg-label" : "bg-accent hover:bg-accent-hover"} text-on-accent`}
            aria-label={busy ? t("wait.stop") : t("composer.send")}
            onClick={sendOrStop}
          >
            <Icon name={busy ? "stop" : "send"} className="glyph size-3.75 stroke-2" />
          </button>
        </div>
      </div>
    </div>
  );
}
