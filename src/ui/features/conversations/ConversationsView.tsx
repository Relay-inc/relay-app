import { useEffect, useRef } from "react";
import { isView, MAIL, PRS, REM, USAGE } from "../../../domain/navigation/views";
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
  toggleDrawer,
} from "../../../application/navigation/navigation";
import { boardKey } from "../../../domain/navigation/keys";
import { useDerived } from "../../hooks/useDerived";
import { useUiRequest } from "../../hooks/useUiRequest";
import { SelectedView } from "../../app/SelectedView";
import { PullRequestsView } from "../pull-requests/PullRequestsView";
import { MailView } from "../mail/MailView";
import { ChatBar } from "./ChatBar";
import { ProjectPanel } from "./ProjectPanel";
import { Subagents } from "./Subagents";
import { MoveBar } from "./MoveBar";
import { RetryBar } from "./RetryBar";
import { RepoBar } from "./RepoBar";
import { Composer } from "./Composer";
import { NewReminder } from "./NewReminder";
import { UsageReload } from "../usage/UsageReload";
import { PrsReload } from "./PrsReload";
import { Toast } from "./Toast";
import { MailReload } from "../mail/MailReload";
import { WorkersToggle } from "../orchestrator/WorkersToggle";
import { column } from "./layout";

/** The centre column: the title bar, the open conversation or view, the agents it spawned, the composer. */
export function ConversationsView({ className }: { className: string }) {
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

  // stay at the bottom while it grows: true when the log was within 80 px of the bottom. Followed on every resize of
  // the content and of the log itself (a toast, the agents or a taller composer take its height), in conversations only
  const log = useRef<HTMLDivElement>(null);
  const msgs = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // the Pull requests and Mail views scroll their list and the open item apart, so they fill the pane instead of the log
  const ownScroll = selected === PRS || selected === MAIL;
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
        ) : selected === MAIL ? (
          <MailReload />
        ) : bar.coordinator ? (
          <WorkersToggle />
        ) : null
      }
      onEditProject={bar.tools?.back ? closeTool : openProjectPanel}
      onRename={rename}
      onOpenTerminal={openTerminal}
      onOpenBoard={() => bar.tools?.board && openTool(bar.tools.project, boardKey(bar.tools.board.id))}
      // a project without repos sends you to the settings to link one
      onOpenPrs={() => (bar.tools?.repos ? openTool(bar.tools.project, PRS) : openSettings())}
      onToggleDrawer={toggleDrawer}
    />
  );
  if (ownScroll)
    return (
      <div className={`${className} flex flex-col relative bg-bg`}>
        {chatBarEl}
        {selected === PRS ? <PullRequestsView className="flex-1" /> : <MailView className="flex-1" />}
      </div>
    );
  return (
    <div className={`${className} flex flex-col relative bg-bg`}>
      {chatBarEl}
      {projectPanel ? <ProjectPanel /> : null}
      <div
        id="log"
        ref={log}
        className={`flex-1 overflow-y-auto pb-3 ${selected === REM ? "pt-6" : "pt-7"}`}
        onScroll={onScroll}
      >
        <div
          ref={msgs}
          id="msgs"
          className={`mx-auto flex flex-col gap-5 ${board ? "px-5" : selected === REM ? "max-w-180 px-8" : selected === USAGE ? "w-full max-w-245 px-7" : "max-w-170 px-8"}`}
        >
          <SelectedView />
          {/* on Reminders the chip sticks to the bottom of the scroller */}
          {toast && selected === REM ? (
            <div className="sticky bottom-3 pt-2 pb-1">
              <Toast toast={toast} />
            </div>
          ) : null}
        </div>
      </div>
      {hasSubagents ? <Subagents className={`${column} mb-1.5`} /> : null}
      {toast && selected !== REM ? (
        <div className={`${column} mb-2`}>
          <Toast toast={toast} />
        </div>
      ) : null}
      <RepoBar className={column} />
      <RetryBar className={column} />
      <MoveBar className={column} session={bar.session} asked={asked} />
      {onView ? null : <Composer className={`${column} mt-2 mb-4.5`} />}
    </div>
  );
}
