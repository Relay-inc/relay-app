import { useEffect, useRef } from "react";
import { isView } from "../../../domain/navigation/views";
import { boardOf } from "../../../application/navigation/navigation";
import { useConversationsStore } from "../../../application/conversations/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { chatBar } from "../../../application/conversations/selectors";
import { openTerminal, rename } from "../../../application/conversations/actions";
import { openProjectPanel, setPanelHidden } from "../../../application/navigation/navigation";
import { useDerived } from "../../hooks/useDerived";
import { useUiRequest } from "../../hooks/useUiRequest";
import { SelectedView } from "../../app/SelectedView";
import { ChatBar } from "./ChatBar";
import { ProjectPanel } from "./ProjectPanel";
import { Subagents } from "./Subagents";
import { MoveBar } from "./MoveBar";
import { Composer } from "./Composer";
import { column, strip } from "./layout";

/** The centre column: the title bar, the open conversation or view, the agents it spawned, the composer. */
export function ConversationsView({ className }: { className: string }) {
  const selected = useNavigationStore(s => s.selected);
  const panelHidden = useNavigationStore(s => s.panelHidden);
  const projectPanel = useNavigationStore(s => s.projectPanel);
  const toast = useNavigationStore(s => s.toast);
  const busy = useConversationsStore(s => s.status[selected] === "busy");
  const dismissed = useConversationsStore(s => s.dismissed.has(selected));
  const onView = isView(selected);
  const board = boardOf(selected);
  const hasSubagents = useConversationsStore(s => !onView && !!s.subs[selected]?.length);
  const bar = useDerived(() => chatBar(selected));

  // stay at the bottom while it grows: true when the log was within 80 px of the bottom. Followed on every resize of
  // the content and of the log itself (a toast, the agents or a taller composer take its height), in conversations only
  const log = useRef<HTMLDivElement>(null);
  const msgs = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const logEl = log.current!;
    const observer = new ResizeObserver(() => {
      if (stick.current && !isView(useNavigationStore.getState().selected)) logEl.scrollTop = logEl.scrollHeight;
    });
    observer.observe(msgs.current!);
    observer.observe(logEl);
    return () => observer.disconnect();
  }, []);
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

  const asked = onView || !!bar.session || !!bar.projectName || dismissed || busy;
  return (
    <div className={`${className} flex flex-col relative bg-bg`}>
      <ChatBar
        key={selected}
        heading={bar.heading}
        img={bar.img}
        editable={!onView}
        sub={bar.waiting}
        value={bar.title}
        readonly={!!bar.session}
        renamable={bar.renamable}
        noTerm={bar.noTerm}
        locked={bar.locked}
        panelOff={panelHidden}
        onEditProject={openProjectPanel}
        onRename={rename}
        onOpenTerminal={openTerminal}
        onTogglePanel={() => setPanelHidden(!panelHidden)}
      />
      {projectPanel ? <ProjectPanel /> : null}
      <div id="log" ref={log} className="flex-1 overflow-y-auto pt-6 pb-2" onScroll={onScroll}>
        <div ref={msgs} id="msgs" className={`mx-auto flex flex-col gap-4 ${board ? "px-5" : "max-w-2xl px-7"}`}>
          <SelectedView />
        </div>
      </div>
      {hasSubagents ? <Subagents className={`${column} mb-1.5`} /> : null}
      {toast ? (
        <div className={column}>
          <div className={`${strip} mb-2 bg-label text-bg select-none`}>
            <span>{toast.text}</span>
            <span className="flex-1"></span>
            {toast.undo ? (
              <button className="btn bg-transparent! text-bg border-bg/40!" onClick={toast.undo}>
                {toast.btn}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <MoveBar className={column} session={bar.session} asked={asked} />
      {onView ? null : <Composer className={`${column} mt-2 mb-5`} />}
    </div>
  );
}
