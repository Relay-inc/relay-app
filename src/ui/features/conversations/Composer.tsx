import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { isTerminal } from "../../../domain/navigation/keys";
import type { PickKind } from "../../../domain/agents/types";
import { useConversationsStore } from "../../../application/conversations/store";
import { typedOf, useDraftsStore } from "../../../application/conversations/drafts";
import {
  cancelDictation,
  dismissDictationError,
  downloadModel,
  startDictation,
  stopDictation,
  useDictationStore,
} from "../../../application/conversations/dictation";
import { insertDictated } from "../../../domain/conversations/dictation";
import { isShortcut, shortcutCode, shortcutLabel, voiceOf } from "../../../domain/settings/voice";
import { useSettingsStore } from "../../../application/settings/store";
import { isKey } from "../../../application/settings/settings";
import { useNavigationStore } from "../../../application/navigation/store";
import { ORCH } from "../../../domain/orchestrator/rules";
import { projectName as plainProject } from "../../../application/workspace/vault";
import { matchCommands, type SlashCommand } from "../../../domain/conversations/commands";
import { chatBar, commandsOf, machineChoice, machineRepo } from "../../../application/conversations/selectors";
import {
  attach,
  attachPaths,
  pickAndAttach,
  sendMsg,
  sendOrStop,
  setAgent,
  moveConversation,
  setMachine,
  setTyped,
  typeInto,
  unattach,
  unattachFile,
} from "../../../application/conversations/actions";
import { dropTarget } from "../../../application/conversations/attachments";
import { pollMachines } from "../../../application/conversations/polls";
import { isPhoneShared } from "../../../application/conversations/phoneShare";
import { agentOf, chatAgent, inherited, onAgents, picks, setPick } from "../../../application/agents/agents";
import { project } from "../../../application/workspace/vault";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Glyph } from "../../components/Glyph";
import { agent as plugin } from "../../../shared/plugins";
import { ImageThumbs } from "../../components/ImageThumbs";
import { allowOnlyCard } from "../../components/PermissionCard";
import { PickMenu } from "./PickMenu";
import { FileChips } from "../../components/FileChips";
import { onPasteFiles } from "../../components/image-files";
import { uiRequests } from "../../../application/navigation/requests";
import "../../styles/conversations.css";

const glyphOf = (id: string) => {
  const svg = plugin(id)?.glyph;
  return svg ? <Glyph svg={svg} className="glyph size-3.5 flex-none" /> : null;
};

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

// dictation (src-tauri/src/dictation.rs): what was said lands at the cursor, or at the end when the field has no focus
async function dictateIntoField() {
  const { key } = useDictationStore.getState();
  const text = await stopDictation();
  if (!text) return;
  // switched to another conversation meanwhile: the text goes at the end of the one it started in
  if (key && key !== useNavigationStore.getState().selected) {
    const draft = typedOf(key);
    return typeInto(key, insertDictated(draft, draft.length, draft.length, text).value);
  }
  const el = mounted;
  if (!el) return;
  const value = typedOf(key);
  const focused = document.activeElement === el;
  const next = insertDictated(
    value,
    focused ? el.selectionStart : value.length,
    focused ? el.selectionEnd : value.length,
    text,
  );
  setTyped(next.value);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(next.cursor, next.cursor);
  });
}
const toggleDictation = () =>
  useDictationStore.getState().phase === "recording" ? dictateIntoField() : startDictation();
// the shortcut of Settings › Voice while a composer shows, recording as its mode says: held, until the key comes up;
// tapped, until the next press. Escape throws the recording away, before the window's Escape stops a running turn
const voice = () => voiceOf(useSettingsStore.getState().settings.voice);
let pressedAt = 0;
window.addEventListener(
  "keydown",
  e => {
    const phase = useDictationStore.getState().phase;
    if (e.key === "Escape" && (phase === "recording" || phase === "offer")) {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelDictation();
      return;
    }
    const { on, shortcut, mode } = voice();
    if (!on || !mounted || !isShortcut(e, shortcut)) return;
    e.preventDefault();
    if (e.repeat) return;
    if (phase === "recording") {
      if (mode !== "hold") dictateIntoField();
    } else {
      pressedAt = Date.now();
      startDictation();
    }
  },
  true,
);
window.addEventListener(
  "keyup",
  e => {
    const { shortcut, mode } = voice();
    if (e.code !== shortcutCode(shortcut) || !pressedAt) return;
    const held = Date.now() - pressedAt > 400;
    if (mode === "hold" || (mode === "both" && held)) dictateIntoField();
    pressedAt = 0;
  },
  true,
);

/** How full the context window is, quietly: only a conversation whose agent reports it (Claude Code) has one. */
function ContextUse() {
  const { t } = useT();
  const selected = useNavigationStore(s => s.selected);
  const context = useConversationsStore(s => s.context[selected]);
  if (!context?.used) return null;
  const pct = Math.min(100, Math.round((context.used / context.window) * 100));
  const tokens = (n: number) => n.toLocaleString();
  return (
    <span
      className={`px-1.5 text-xs whitespace-nowrap ${pct >= 90 ? "text-late" : "text-tertiary"}`}
      title={t("composer.contextHelp", { used: tokens(context.used), window: tokens(context.window) })}
    >
      {t("composer.context", { pct })}
    </span>
  );
}

/** The message field with the images and files waiting, the agent, model and effort picks and the send button. */
export function Composer({ className }: { className: string }) {
  const { t } = useT();
  const selected = useNavigationStore(s => s.selected);
  // in the orchestrator the composer talks to the coordinator or the open worker: their model is set, nothing to pick
  const workerPage = useNavigationStore(s => s.orchDetail);
  const inOrchestrator = selected === ORCH || workerPage;
  const typed = useDraftsStore(s => s.typed[selected] ?? "");
  const attached = useDraftsStore(s => s.attached);
  const files = useDraftsStore(s => s.files);
  const busy = useConversationsStore(s => s.status[selected] === "busy");
  const dictation = useDictationStore(s => s.phase);
  const level = useDictationStore(s => s.level);
  const progress = useDictationStore(s => s.progress);
  const dictationError = useDictationStore(s => s.error);
  const voiceCfg = useSettingsStore(s => s.settings.voice);
  const { on: voiceOn, shortcut } = voiceOf(voiceCfg);
  // a conversation of a project bound to a machine runs there
  const machine = useConversationsStore(s => s.machines[selected]?.machine);
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
  // where the conversation runs or is to start: the machines are asked every few seconds while it shows
  const hasChat = useConversationsStore(s => !!s.chats[selected]);
  const where = useDerived(() => machineChoice(selected));
  // the repo the agent gets on that machine, next to the pick
  const repoThere = useDerived(() => machineRepo(selected));
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (!hasChat) return;
    pollMachines();
    const timer = window.setInterval(pollMachines, 3000);
    return () => window.clearInterval(timer);
  }, [hasChat]);
  // the open conversation's agent's slash commands and skills
  const commands = useDerived(() => commandsOf(selected));
  const phoneShared = useDerived(() => isPhoneShared(selected));
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
    // Settings › Shortcuts may move sending to ⌘↵, the textarea then makes the new line on Enter itself
    if (isKey(e.nativeEvent, "chat.send") && !e.nativeEvent.isComposing) {
      e.preventDefault();
      // nothing to send: Enter allows the permission card that waits, as its button shows
      if (!e.repeat && !typed.trim() && !attached.length && allowOnlyCard()) return;
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
  // a switch restarts the process, so not while a turn runs
  const pick = (kind: PickKind, show: boolean) => {
    const { list, value } = view[kind];
    return show ? (
      <PickMenu
        options={[{ id: "", name: defaultLabel(kind) }, ...list.map(option => ({ id: option.id, name: option.label }))]}
        value={value}
        label={t(`composer.${kind}`)}
        disabled={busy}
        onPick={id => setPick(kind, id)}
      />
    ) : null;
  };

  // "<repo> · on <machine>": no click, the agent works in that repo there
  const repoChip = repoThere ? (
    <span
      className="ml-1 px-1.5 py-0.5 rounded-md bg-fill-2 text-xs text-secondary whitespace-nowrap"
      title={t("composer.repoChipHelp", { repo: repoThere.slug })}
    >
      {t("composer.repoChip", { repo: repoThere.repo, name: repoThere.machine })}
    </span>
  ) : null;
  const agent = view.agent;
  const showEffort = !agent || (agent.caps.effort && agent.efforts.length > 0);
  const placeholder = view.terminal
    ? t("ph.term")
    : selected === ORCH
      ? t("orch.ph.coord")
      : workerPage
        ? t("orch.ph.worker", { name: plainProject(view.projectName) })
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
        {dictation === "offer" || dictation === "downloading" || dictationError ? (
          <div className="flex items-center gap-2 mb-2 text-xs text-secondary">
            <span className="flex-1">
              {dictationError
                ? t(dictationError === "silent" ? "composer.dictationSilent" : "composer.dictationFailed", {
                    error: dictationError,
                  })
                : dictation === "downloading"
                  ? t("composer.dictationDownloading", { pct: Math.round(progress * 100) })
                  : t("composer.dictationModel")}
            </span>
            {dictation === "offer" ? (
              <button className="text-accent bg-transparent border-0 p-0" onClick={downloadModel}>
                {t("composer.dictationDownload")}
              </button>
            ) : null}
            {dictation !== "downloading" ? (
              <button
                className="grid place-items-center size-5 rounded border-0 bg-transparent text-secondary hover:bg-fill-2"
                aria-label={t("nav.close")}
                onClick={() => {
                  dismissDictationError();
                  cancelDictation();
                }}
              >
                <Icon name="close" className="glyph size-3" />
              </button>
            ) : null}
          </div>
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
          {view.agents.length > 1 && !isTerminal(selected) && !agentFixed && !inOrchestrator ? (
            <>
              <PickMenu
                pill
                options={view.agents.map(option => ({ ...option, icon: glyphOf(option.id) }))}
                value={view.agentId}
                label={t("composer.agent")}
                onPick={setAgent}
              />
              <span className="w-px h-3.5 bg-separator-strong mx-1"></span>
            </>
          ) : null}
          {hasChat && where.value !== null ? (
            <>
              {/* before the first message: where it starts. After it: where it runs, and another pick moves it */}
              <PickMenu
                options={[
                  { id: "", name: t("composer.thisMac") },
                  ...where.list.map(option => ({
                    id: option.id,
                    name: option.name,
                    icon: (
                      <span
                        className={`size-1.5 rounded-full flex-none ${option.online ? "bg-ok" : "bg-late"}`}
                        title={t(option.online ? "composer.available" : "composer.unavailable")}
                      ></span>
                    ),
                    disabled: !!where.why || !option.online,
                  })),
                ]}
                value={where.value}
                label={t("composer.runOn")}
                title={where.why ? t(where.why) : t(where.started ? "composer.moveHelp" : "composer.runOn")}
                disabled={where.started && (busy || moving)}
                onPick={async id => {
                  if (!where.started) return setMachine(id);
                  setMoving(true);
                  await moveConversation(id);
                  setMoving(false);
                }}
              />
              {repoChip}
              <span className="w-px h-3.5 bg-separator-strong mx-1"></span>
            </>
          ) : machine ? (
            <>
              <span className="px-1.5 text-xs text-secondary whitespace-nowrap" title={t("composer.onMachineHelp")}>
                {t("composer.onMachine", { name: machine })}
              </span>
              {repoChip}
              <span className="w-px h-3.5 bg-separator-strong mx-1"></span>
            </>
          ) : null}
          {phoneShared ? (
            <>
              <span
                className="flex items-center gap-1 px-1.5 text-xs text-secondary whitespace-nowrap"
                title={t("composer.phoneSharedHelp")}
              >
                <Icon name="link" className="glyph size-3" />
                {t("composer.phoneShared")}
              </span>
              <span className="w-px h-3.5 bg-separator-strong mx-1"></span>
            </>
          ) : null}
          {inOrchestrator ? null : pick("model", true)}
          {inOrchestrator ? null : pick("effort", showEffort)}
          <ContextUse />
          <span className="flex-1"></span>
          {/* dictates, or stops dictating; the ring grows with the voice */}
          {voiceOn ? (
            <button
              className={`grid place-items-center size-7 mr-1 rounded-full border-0 ${dictation === "recording" ? "bg-late text-on-accent" : "bg-transparent text-secondary hover:bg-fill-2 hover:text-label"}`}
              style={
                dictation === "recording"
                  ? { boxShadow: `0 0 0 ${Math.round(level * 6)}px var(--color-fill-2)` }
                  : undefined
              }
              title={t(
                dictation === "recording"
                  ? "composer.dictateStop"
                  : dictation === "transcribing"
                    ? "composer.transcribing"
                    : "composer.dictate",
                { key: shortcutLabel(shortcut) },
              )}
              aria-label={t(dictation === "recording" ? "composer.dictateStop" : "composer.dictate", {
                key: shortcutLabel(shortcut),
              })}
              disabled={dictation === "transcribing" || dictation === "downloading"}
              onClick={toggleDictation}
            >
              <Icon name="mic" className={`glyph size-4 ${dictation === "transcribing" ? "animate-pulse" : ""}`} />
            </button>
          ) : null}
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
