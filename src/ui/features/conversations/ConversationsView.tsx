import { useEffect, useRef } from "react";
import { isView, pluginIdOf, BRAIN, MAIL, PRS, REM, USAGE, WAIT, reviewOf } from "../../../domain/navigation/views";
import { boardOf } from "../../../application/navigation/navigation";
import { useConversationsStore } from "../../../application/conversations/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { chatBar } from "../../../application/conversations/selectors";
import { openTerminal, rename } from "../../../application/conversations/actions";
import {
  closeTool,
  openProjectPanel,
  openSettings,
  openTool,
  select,
  toggleDrawer,
} from "../../../application/navigation/navigation";
import { showInBrain } from "../../../application/brain/brain";
import { boardKey } from "../../../domain/navigation/keys";
import { useDerived } from "../../hooks/useDerived";
import { useUiRequest } from "../../hooks/useUiRequest";
import { SelectedView } from "../../app/SelectedView";
import { PullRequestsView } from "../pull-requests/PullRequestsView";
import { BrainView } from "../brain/BrainView";
import { MailView } from "../mail/MailView";
import { TodayView } from "../today/TodayView";
import { ReviewView } from "../today/ReviewView";
import { PluginView } from "../plugins/PluginView";
import { ChatBar } from "./ChatBar";
import { ProjectPanel } from "./ProjectPanel";
import { Subagents } from "./Subagents";
import { Todos } from "./Todos";
import { MoveBar } from "./MoveBar";
import { RetryBar } from "./RetryBar";
import { RepoBar } from "./RepoBar";
import { RepoWorkBar } from "./RepoWorkBar";
import { Composer } from "./Composer";
import { NewReminder } from "./NewReminder";
import { UsageReload } from "../usage/UsageReload";
import { TodayReload } from "../today/TodayReload";
import { PrsReload } from "./PrsReload";
import { Toast } from "./Toast";
import { MailReload } from "../mail/MailReload";
import { ORCH } from "../../../domain/orchestrator/rules";
import { useOrchestratorStore } from "../../../application/orchestrator/store";
import { WorkerDetail } from "../orchestrator/WorkerDetail";
import { OrchestratorEmpty } from "../orchestrator/OrchestratorEmpty";
import { OrchestratorBack } from "../orchestrator/OrchestratorBack";
import { chatWidth, column } from "./layout";
import { useT } from "../../hooks/useT";
import { ToLatest, ToStart } from "./ScrollArrows";

/** The centre column: the title bar, the open conversation or view, the agents it spawned, the composer. */
export function ConversationsView({ className }: { className: string }) {
  const { t } = useT();
  const selected = useNavigationStore(s => s.selected);
  const drawer = useNavigationStore(s => s.drawer);
  const projectPanel = useNavigationStore(s => s.projectPanel);
  const toast = useNavigationStore(s => s.toast);
  const busy = useConversationsStore(s => s.status[selected] === "busy");
  // answered no, or a Cmd-K offer still waiting in the conversation
  const dismissed = useConversationsStore(s => s.dismissed.has(selected) || !!s.chats[selected]?.ask);
  const onView = isView(selected);
  const board = boardOf(selected);
  const hasSubagents = useConversationsStore(s => !onView && !!s.subs[selected]?.length);
  const bar = useDerived(() => chatBar(selected));
  // a worker shown as its page next to the orchestrator's column, and the orchestrator before its first task
  const workerPage = useNavigationStore(s => s.orchDetail);
  const noWorkers = useOrchestratorStore(s => !Object.keys(s.workers).length);
  const orchEmpty = useConversationsStore(s => selected === ORCH && !s.messages[ORCH]?.length) && noWorkers;
  const orchHint = selected === ORCH ? "orch.hint.coord" : workerPage ? "orch.hint.worker" : null;

  // stay at the bottom while it grows: true when the log was within 80 px of the bottom. Followed on every resize of
  // the content and of the log itself (a toast, the agents or a taller composer take its height), in conversations only
  const log = useRef<HTMLDivElement>(null);
  const msgs = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // the Pull requests and Mail views scroll their list and the open item apart, so they fill the pane instead of the log
  const review = reviewOf(selected);
  // a plugin's view is a page of its own in a frame, which scrolls itself
  const plugin = pluginIdOf(selected);
  const ownScroll =
    selected === PRS ||
    selected === MAIL ||
    selected === BRAIN ||
    selected === WAIT ||
    !!review ||
    plugin !== undefined;
  useEffect(() => {
    if (ownScroll) return;
    const logEl = log.current!;
    const observer = new ResizeObserver(() => {
      if (stick.current && !isView(useNavigationStore.getState().selected)) logEl.scrollTop = logEl.scrollHeight;
    });
    observer.observe(msgs.current!);
    observer.observe(logEl);
    return () => observer.disconnect();
  }, [ownScroll]);
  // a scroll event is dispatched a frame late, after more text may have come in: only a move up unsticks, so a
  // stream into a log at the bottom keeps following
  const lastTop = useRef(0);
  const onScroll = () => {
    const el = log.current!;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) stick.current = true;
    else if (el.scrollTop < lastTop.current) stick.current = false;
    lastTop.current = el.scrollTop;
  };
  useUiRequest("scroll-bottom", () => {
    stick.current = true;
    requestAnimationFrame(() => log.current && (log.current.scrollTop = log.current.scrollHeight));
  });
  useUiRequest("scroll-top", () => {
    stick.current = false;
    requestAnimationFrame(() => log.current && (log.current.scrollTop = 0));
  });

  const asked = onView || !!bar.session || !!bar.projectName || bar.coordinator || dismissed || busy;
  const chatBarEl = (
    <ChatBar
      key={selected}
      heading={bar.heading}
      img={bar.img}
      tint={bar.tint}
      icon={bar.icon}
      editable={!onView && !bar.coordinator}
      sub={bar.sub}
      value={bar.title}
      readonly={!!bar.session}
      renamable={bar.renamable}
      noTerm={bar.noTerm}
      locked={bar.locked}
      tools={bar.tools}
      drawer={drawer}
      back={!!bar.tools?.back}
      actions={
        selected === REM ? (
          <NewReminder />
        ) : selected === PRS ? (
          <PrsReload />
        ) : selected === USAGE ? (
          <UsageReload />
        ) : selected === WAIT ? (
          <TodayReload />
        ) : selected === MAIL ? (
          <MailReload />
        ) : null
      }
      onEditProject={bar.tools?.back ? closeTool : openProjectPanel}
      onRename={rename}
      onOpenTerminal={openTerminal}
      onOpenBoard={() => bar.tools?.board && openTool(bar.tools.project, boardKey(bar.tools.board.id))}
      // a project without repos sends you to the settings to link one
      onOpenPrs={() => (bar.tools?.repos ? openTool(bar.tools.project, PRS) : openSettings())}
      onToggleDrawer={toggleDrawer}
      onShowInBrain={bar.renamable && !bar.session ? () => showInBrain(selected).then(() => select(BRAIN)) : undefined}
    />
  );
  if (ownScroll)
    return (
      <div className={`${className} flex flex-col relative bg-bg`}>
        {chatBarEl}
        {selected === PRS ? (
          <PullRequestsView className="flex-1" />
        ) : selected === BRAIN ? (
          <BrainView className="flex-1" />
        ) : selected === WAIT ? (
          <TodayView className="flex-1" />
        ) : review ? (
          <ReviewView className="flex-1" />
        ) : plugin !== undefined ? (
          <PluginView key={plugin} id={plugin} className="flex-1" />
        ) : (
          <MailView className="flex-1" />
        )}
      </div>
    );
  return (
    <div className={`${className} flex flex-col relative bg-bg`}>
      {workerPage ? <OrchestratorBack /> : chatBarEl}
      {projectPanel ? <ProjectPanel /> : null}
      <div
        id="log"
        ref={log}
        className={`flex-1 overflow-y-auto pb-3 ${selected === REM ? "pt-6" : "pt-7"}`}
        onScroll={onScroll}
      >
        {onView ? null : (
          <ToStart
            log={log}
            selected={selected}
            go={() => {
              stick.current = false;
              log.current?.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        )}
        <div
          ref={msgs}
          id="msgs"
          className={`mx-auto flex flex-col gap-5 ${board ? "px-5" : selected === REM ? "max-w-180 px-8" : selected === USAGE ? "w-full max-w-245 px-7" : `w-full ${chatWidth} px-8`}`}
        >
          {workerPage ? <WorkerDetail workerKey={selected} /> : orchEmpty ? <OrchestratorEmpty /> : <SelectedView />}
          {/* on Reminders the chip sticks to the bottom of the scroller */}
          {toast && selected === REM ? (
            <div className="sticky bottom-3 pt-2 pb-1">
              <Toast toast={toast} />
            </div>
          ) : null}
        </div>
        {onView ? null : (
          <ToLatest
            log={log}
            selected={selected}
            following={() => stick.current}
            go={() => {
              stick.current = true;
              log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
            }}
          />
        )}
      </div>
      {hasSubagents && !workerPage ? <Subagents className={`${column} mb-1.5`} /> : null}
      {onView || workerPage ? null : <Todos className={`${column} mb-1.5`} />}
      {toast && selected !== REM ? (
        <div className={`${column} mb-2`}>
          <Toast toast={toast} />
        </div>
      ) : null}
      <RepoBar className={column} />
      <RepoWorkBar className={column} />
      <RetryBar className={column} />
      <MoveBar className={column} session={bar.session} asked={asked} />
      {onView ? null : <Composer className={`${column} mt-2 ${orchHint ? "mb-1.5" : "mb-4.5"}`} />}
      {/* who the composer talks to in the orchestrator: the coordinator, or the open worker */}
      {orchHint ? <span className={`${column} mb-4 pl-9 text-[11px] text-tertiary`}>{t(orchHint)}</span> : null}
    </div>
  );
}
