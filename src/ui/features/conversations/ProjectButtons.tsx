import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Key } from "../../../shared/i18n";
import { ATTENTION, isTab, worstOf } from "../../../domain/navigation/views";
import { buddyOf } from "../../../application/buddy/buddy";
import { watchBuilds } from "../../../application/builds/builds";
import { aikidoOn, loadAikido } from "../../../application/aikido/aikido";
import { cloudOf } from "../../../application/cloudbuild/cloudbuild";
import { copyText } from "../../components/copy";
import { Icon } from "../../components/Icon";
import { openDrawer, openExternal, toggleProjectPanel } from "../../../application/navigation/navigation";
import { useNavigationStore } from "../../../application/navigation/store";
import { useDerived } from "../../hooks/useDerived";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../hooks/useT";
import { PopHeading } from "../board/PopHeading";
import { POPOVER, POP_ROW } from "../board/toolbar";
import { ATTENTION_ICON, ATTENTION_TEXT, tabOf, useProjectTabs } from "../drawer/tabs";

/** At most this many tabs call for the user in the bar; the rest only count in the panel button's dot. */
const MAX_ICONS = 3;

/** The right of a project's title bar: the tabs of its panel that need you (their icon, a click opens the panel on
 *  them), a thin line, then the two buttons that never move: the menu of the rarely used actions and the panel. */
export function ProjectButtons({
  project,
  terminal,
  remote,
  pipeline,
  onShowInGraph,
  onOpenTerminal,
  onStopRemote,
  onOpenPipeline,
}: {
  project: string;
  terminal: { title: string; disabled: boolean } | null; // resume the conversation in the terminal; null when it cannot
  remote: { url: string; state: string } | null; // Remote Control is on: the session to open on claude.ai
  pipeline: boolean; // the board pipeline's conversation can be opened from here
  onShowInGraph?: () => void; // the notes this conversation read and wrote, lit in the Pages graph
  onOpenTerminal: (external: boolean) => void;
  onStopRemote: () => void;
  onOpenPipeline: () => void;
}) {
  const { t } = useT();
  const tabs = useProjectTabs(project);
  const drawer = useNavigationStore(s => s.drawer);
  const lastTab = useNavigationStore(s => s.lastTab);
  const linked = useDerived(() => !!buddyOf(project) || !!cloudOf(project));
  // a running build is read again while the bar shows; the failed one shows without anyone opening a tab
  useEffect(() => (linked ? watchBuilds(project) : undefined), [project, linked]);
  // Aikido's issues once when the bar shows (at most every 5 minutes, never polled): its Security icon and the home card
  const aikido = useDerived(() => aikidoOn());
  useEffect(() => {
    if (aikido) void loadAikido(project);
  }, [project, aikido]);

  const calling = ATTENTION.flatMap(state => tabs.filter(tab => tab.attention === state)).slice(0, MAX_ICONS);
  const dot = worstOf(tabs.map(tab => tab.attention));
  const panelOn = isTab(drawer);
  const panelLabel = t("bar.panel");

  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useDismiss(root, open, () => setOpen(false));
  const row = (
    icon: string,
    label: string,
    onClick: (altKey: boolean) => void,
    disabled = false,
    title?: string,
  ): ReactNode => (
    <button
      type="button"
      role="menuitem"
      className={`w-full text-left disabled:opacity-40 ${POP_ROW}`}
      disabled={disabled}
      title={title}
      onClick={e => {
        setOpen(false);
        onClick(e.altKey);
      }}
    >
      <Icon name={icon} className="glyph size-3.75 flex-none text-secondary" />
      {label}
    </button>
  );
  const hasMenu = !!terminal || !!remote || !!onShowInGraph || pipeline;
  return (
    <>
      {calling.map(({ id, attention }) => {
        const tab = tabOf(id);
        const label = `${t(tab.label)}, ${t(`drawer.attn.${attention!}`)}`;
        return (
          <button
            key={id}
            type="button"
            className={`btn-icon relative ${attention === "busy" ? "w-auto! grid-flow-col gap-1.5 px-2!" : ""} ${ATTENTION_ICON[attention!]}`}
            title={label}
            aria-label={label}
            onClick={() => openDrawer(id)}
          >
            {attention === "busy" ? (
              <span className="size-2.5 rounded-full border-2 border-current border-r-transparent animate-spin"></span>
            ) : null}
            {tab.icon}
            {tab.brand ? (
              <span
                className={`absolute right-1 bottom-1 size-1.5 rounded-full bg-current ${ATTENTION_TEXT[attention!]}`}
              ></span>
            ) : null}
          </button>
        );
      })}
      {calling.length ? (
        <span className="w-px h-4.5 mx-1.5 flex-none bg-separator-strong" aria-hidden="true"></span>
      ) : null}
      {hasMenu ? (
        <span ref={root} className="relative flex">
          <button
            className={`btn-icon ${open ? "bg-fill-2 text-label" : ""}`}
            title={t("bar.more")}
            aria-label={t("bar.more")}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Icon name="more" className="glyph size-4" />
          </button>
          {open && (
            <div className={`absolute top-full right-0 mt-2 z-30 w-80 p-1 rounded-[10px] ${POPOVER}`} role="menu">
              {terminal ? row("term", terminal.title, onOpenTerminal, terminal.disabled) : null}
              {remote ? (
                <>
                  <PopHeading>
                    {`${t("remote.title")} · ${t(`remote.state.${remote.state === "failed" || remote.state === "connected" ? remote.state : "ready"}` as Key)}`}
                  </PopHeading>
                  {row("globe", t("remote.open"), () => openExternal(remote.url))}
                  {row("copy", t("remote.copy"), () => copyText(remote.url))}
                  {row("close", t("remote.stop"), onStopRemote)}
                </>
              ) : null}
              {onShowInGraph ? row("graph", t("graph.showIn"), onShowInGraph, false, t("graph.showInTitle")) : null}
              {pipeline ? row("workflow", t("po.open"), onOpenPipeline) : null}
            </div>
          )}
        </span>
      ) : null}
      <button
        className={`btn-icon relative ${panelOn ? "bg-accent-soft text-accent-text!" : ""}`}
        title={panelLabel}
        aria-label={panelLabel}
        aria-pressed={panelOn}
        onClick={() => toggleProjectPanel(tabs.find(tab => tab.id === lastTab)?.id ?? tabs[0].id)}
      >
        <Icon name="panelRight" className="glyph size-4" />
        {dot ? (
          <span className={`absolute right-1 bottom-1 size-1.5 rounded-full bg-current ${ATTENTION_TEXT[dot]}`}></span>
        ) : null}
      </button>
    </>
  );
}
