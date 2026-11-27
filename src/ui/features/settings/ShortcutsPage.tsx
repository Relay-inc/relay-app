import { Fragment, useState, type ReactNode } from "react";
import { useSettingsStore } from "../../../application/settings/store";
import {
  resetAll,
  resetKey,
  saveKey,
  savePick,
  useShortcutsPageStore,
} from "../../../application/settings/shortcuts-page";
import { pauseShortcuts, saveShortcut, useVoicePageStore } from "../../../application/settings/voice-page";
import {
  bindingLabel,
  bindingOf,
  bindingsOf,
  filterRows,
  foldRows,
  PICK_ID,
  pickMods as pickModChoices,
  pickLabel,
  pickModOf,
  WORKSPACE_KEYS,
  type CommandId,
} from "../../../domain/settings/shortcuts";
import { filesOn, mailExperimental } from "../../../domain/settings/types";
import { voiceOf, type ShortcutKey } from "../../../domain/settings/voice";
import type { Key } from "../../../shared/i18n";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { BUTTON_GLYPH, buttonClass, ERROR_MESSAGE, FIELD, HINT_IN_ROW, KBD } from "./blocks";
import { Section } from "./Section";
import { Segmented } from "./Segmented";
import { ShortcutField } from "./ShortcutField";

const APP: CommandId[] = [
  "app.quickAsk",
  "app.newProject",
  "app.newGeneral",
  "app.reopenChat",
  "app.newWindow",
  "app.closeChat",
  "app.settings",
  "app.escape",
  "app.stop",
  "app.sidebarTab",
  "app.back",
  "app.showMarkdown",
  "app.capture",
];
const TODAY: CommandId[] = [
  "today.next",
  "today.prev",
  "today.primary",
  "today.secondary",
  "today.done",
  "today.snooze",
  "today.later",
  "today.meeting",
  "today.doing",
  "today.reply",
  "today.replyAll",
  "today.forward",
  "today.ticket",
  "today.read",
  "today.trash",
];
const MAIL: CommandId[] = ["mail.archive", "mail.trash", "mail.selectAll", "mail.unselect"];
const DICTATION: [ShortcutKey, "on" | "chatOn" | "pasteOn", Key][] = [
  ["shortcut", "on", "voice.on"],
  ["chatShortcut", "chatOn", "voice.chat"],
  ["pasteShortcut", "pasteOn", "voice.paste"],
];

const TODAY_SHOWN = 5;
type Row = { id: string; label: string; node: ReactNode };

/** One shortcut: its label (and a hint or why a pick was refused) on the left, its keys on the right. */
function KeyRow({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-8.5 items-center gap-2.5 px-3 py-1 text-[13px] text-s-fg [&+&]:border-t [&+&]:border-s-border">
      <div className="min-w-0 flex-1">
        {label}
        {hint ? <p className={HINT_IN_ROW}>{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** Shortcuts: every key, dictation's included, each changed by clicking it and pressing a new one, with a reset when
 *  it differs from the default. A filter narrows the rows by label across the sections; Workspaces 1 to 9 and the
 *  rest of Today are folded until asked for (a filter shows every match). */
export function ShortcutsPage() {
  const { t } = useT();
  const settings = useSettingsStore(s => s.settings);
  const error = useShortcutsPageStore(s => s.error);
  const voiceError = useVoicePageStore(s => s.shortcutError);
  const voice = voiceOf(settings.voice);
  const [query, setQuery] = useState("");
  const [workspacesOpen, setWorkspacesOpen] = useState(false);
  const [todayOpen, setTodayOpen] = useState(false);
  const filtering = query.trim() !== "";
  const changed = (id: string) => !!settings.shortcuts?.[id];
  const resetButton = (onClick: () => void) => (
    <button className={buttonClass("ghost", true)} title={t("keys.reset")} onClick={onClick}>
      <Icon name="refresh" className={BUTTON_GLYPH} />
    </button>
  );
  const commands = (list: CommandId[]): Row[] =>
    list.map(id => {
      const label = t(`keys.${id}`);
      return {
        id,
        label,
        node: (
          <KeyRow
            key={id}
            label={label}
            hint={error[id] ? <span className={ERROR_MESSAGE}>{error[id]}</span> : undefined}
          >
            {changed(id) ? resetButton(() => resetKey(id)) : null}
            {bindingsOf(settings, id).map((binding, index) => (
              <ShortcutField
                key={index}
                compact
                changed={changed(id)}
                value={binding}
                record={bindingOf}
                show={bindingLabel}
                onPick={next => saveKey(id, index, next)}
                onListening={pauseShortcuts}
              />
            ))}
          </KeyRow>
        ),
      };
    });
  const send = bindingsOf(settings, "chat.send")[0];
  const pickMods = pickModChoices().map(mod => [mod || "none", pickLabel(mod)] as const);
  const row = (id: string, label: string, node: ReactNode, hint?: ReactNode): Row => ({
    id,
    label,
    node: (
      <KeyRow key={id} label={label} hint={hint}>
        {node}
      </KeyRow>
    ),
  });
  const chat: Row[] = [
    ...commands(["chat.send"]),
    // the textarea makes the new line itself, on whichever Enter does not send
    row(
      "chat.newline",
      t("keys.chat.newline"),
      <kbd className={KBD}>{bindingLabel(send === "Enter" ? "shift+Enter" : "Enter")}</kbd>,
    ),
    ...commands(["chat.find", "card.confirm"]),
    row(
      PICK_ID,
      t("keys.card.pick"),
      <>
        {changed(PICK_ID) ? resetButton(() => savePick("")) : null}
        <Segmented
          label={t("keys.card.pick")}
          options={pickMods}
          value={pickModOf(settings) || "none"}
          onPick={mod => savePick(mod === "none" ? "" : mod)}
        />
      </>,
    ),
  ];
  const dictation: Row[] = DICTATION.filter(([, on]) => voice[on]).map(([key, , label]) =>
    row(
      key,
      t(label),
      <ShortcutField
        compact
        value={voice[key]}
        onPick={shortcut => saveShortcut(key, shortcut)}
        onListening={pauseShortcuts}
      />,
      voiceError[key] ? <span className={ERROR_MESSAGE}>{voiceError[key]}</span> : undefined,
    ),
  );
  const apps = commands(filesOn(settings) ? APP : APP.filter(id => id !== "app.sidebarTab"));
  const workspaces = commands(WORKSPACE_KEYS);
  const today = commands(TODAY);
  const mailOn = mailExperimental(settings);
  const mail = commands(MAIL);
  const total =
    apps.length + workspaces.length + chat.length + dictation.length + today.length + (mailOn ? mail.length : 0);

  const heading = (title: string, count: number) => (
    <>
      {title}
      <span className="ml-2 text-xs font-normal text-s-muted">{count}</span>
    </>
  );
  // a section with its matching rows; none matching (while filtering) hides it
  const section = (title: string, rows: Row[], desc?: string) => {
    const found = filterRows(rows, query);
    if (filtering && !found.length) return null;
    return (
      <Section key={title} title={heading(title, found.length)} desc={desc} list>
        {found.map(r => r.node)}
      </Section>
    );
  };
  const folded = (title: string, rows: Row[], open: boolean, toggle: () => void, desc?: string) => {
    const found = filterRows(rows, query);
    if (filtering && !found.length) return null;
    const { shown, more } = foldRows(found, TODAY_SHOWN, open || filtering);
    return (
      <Section title={heading(title, found.length)} desc={desc} list>
        {shown.map(r => r.node)}
        {more.length ? (
          <button
            className="flex min-h-8.5 w-full items-center gap-2.5 border-t border-s-border px-3 py-1 text-left text-s-muted hover:bg-s-hover"
            onClick={toggle}
          >
            <Icon name="right" className="glyph size-3 flex-none stroke-2" />
            <span className="min-w-0 flex-1 truncate text-xs">
              {t("keys.more", { n: more.length, names: more.map(r => r.label).join(", ") })}
            </span>
          </button>
        ) : null}
      </Section>
    );
  };
  const workspacesSection = () => {
    if (filtering) return section(t("keys.sec.workspaces"), workspaces);
    const [first, last] = [WORKSPACE_KEYS[0], WORKSPACE_KEYS[8]].map(id => bindingLabel(bindingsOf(settings, id)[0]));
    return (
      <Section title={heading(t("keys.sec.workspaces"), workspaces.length)} list>
        <KeyRow label={t("keys.workspaces")}>
          <kbd className={KBD}>{first}</kbd>
          <span className="text-xs text-s-muted">…</span>
          <kbd className={KBD}>{last}</kbd>
          <button className={buttonClass()} onClick={() => setWorkspacesOpen(!workspacesOpen)}>
            {t(workspacesOpen ? "keys.hideEach" : "keys.editEach")}
          </button>
        </KeyRow>
        {workspacesOpen ? workspaces.map(r => r.node) : null}
      </Section>
    );
  };
  const mailSection = () => {
    if (mailOn) return section(t("keys.sec.mail"), mail);
    if (filtering) return null;
    return (
      <Section title={heading(t("keys.sec.mail"), mail.length)} list>
        <KeyRow label={<span className="text-xs text-s-muted">{t("keys.mailOff")}</span>} />
      </Section>
    );
  };
  const left = [section(t("keys.sec.app"), apps), workspacesSection()];
  const right = [
    section(t("keys.sec.chat"), chat),
    section(t("keys.sec.dictation"), dictation, t("keys.dictationHelp")),
    folded(t("keys.sec.today"), today, todayOpen, () => setTodayOpen(true), t("keys.todayHelp")),
    mailSection(),
  ];
  const keyed = (node: ReactNode, i: number) => <Fragment key={i}>{node}</Fragment>;
  const none = filtering && ![...left, ...right].some(Boolean);
  return (
    <div className="grid w-full gap-4.5 justify-self-center lg:w-[min(50rem,calc(100vw-17rem))]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <input
          type="search"
          className={FIELD}
          value={query}
          placeholder={t("keys.filter", { n: total })}
          aria-label={t("keys.filterLabel")}
          onChange={e => setQuery(e.target.value)}
        />
        <span className="min-w-0 flex-1 text-xs text-s-muted">{t("keys.help")}</span>
        <button className={buttonClass()} disabled={!Object.keys(settings.shortcuts ?? {}).length} onClick={resetAll}>
          {t("keys.resetAll")}
        </button>
      </div>
      {none ? <p className="text-xs text-s-faint">{t("keys.noMatch", { query: query.trim() })}</p> : null}
      <div className="grid items-start gap-4.5 lg:grid-cols-2">
        <div className="grid content-start gap-4.5">{left.map(keyed)}</div>
        <div className="grid content-start gap-4.5">{right.map(keyed)}</div>
      </div>
    </div>
  );
}
