import { useEffect, useState, type ReactNode } from "react";
import { agent } from "../../../shared/plugins";
import { useConversationsStore } from "../../../application/conversations/store";
import { blockedAgents, label, projectOf } from "../../../application/conversations/selectors";
import { backgroundAction } from "../../../application/conversations/actions";
import { chatAgent } from "../../../application/agents/agents";
import { select } from "../../../application/navigation/navigation";
import { useCalendarStore } from "../../../application/calendar/store";
import { joinMeeting, meetingChat, soonMeetings, timeOf } from "../../../application/calendar/calendar";
import { joinable, minutesLeft } from "../../../domain/calendar/rules";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Glyph } from "../../components/Glyph";
import { Icon } from "../../components/Icon";
import { PendingRequest } from "../conversations/PendingRequest";

const ACTIONS = ["hide", "stop", "attach"] as const;
type Action = (typeof ACTIONS)[number];
const LABELS = { hide: "wait.hide", stop: "wait.stop", attach: "bar.openTerminal" } as const;

/** Today's Now: meetings about to start, what agents ask (grouped per conversation), and background sessions that are
 *  blocked. Nothing when none of those is there. */
export function NowSection() {
  const { t, tn, locale } = useT();
  const pendingList = useConversationsStore(s => s.pendingList);
  const pendingAt = useConversationsStore(s => s.pendingAt);
  // a clock for "2 min ago"
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const blocked = useDerived(blockedAgents);
  const meetings = useDerived(soonMeetings);
  const now = useCalendarStore(s => s.now);
  // the conversations the cards wait in, by key: their title, project and agent glyph for the header
  const chats = useDerived(() =>
    Object.fromEntries(
      pendingList.map(request => [
        request.project,
        {
          label: label(request.project),
          project: projectOf(request.project),
          glyph: agent(chatAgent(request.project))?.glyph ?? "",
        },
      ]),
    ),
  );
  // a failed hide, stop or attach shows its error on the button
  const [errors, setErrors] = useState<Record<string, string>>({});

  const act = async (action: Action, id: string) => {
    const key = action + ":" + id;
    try {
      await backgroundAction(action, id);
    } catch (e) {
      const text = String(e).slice(0, 60);
      setErrors(before => ({ ...before, [key]: text }));
    }
  };
  // glyph, project / title, and (for a conversation) the link into it
  const header = (glyph: ReactNode, project: string | null, title: string, chatKey?: string, since?: number) => (
    <div className="flex items-center gap-2 text-[13px]">
      <span className="text-secondary flex-none">{glyph}</span>
      {project ? (
        <>
          <span className="text-secondary">{project}</span>
          <span className="text-tertiary">/</span>
        </>
      ) : null}
      <span className="font-semibold truncate">{title}</span>
      {since ? <span className="text-xs text-tertiary flex-none">· {ago(since)}</span> : null}
      <span className="flex-1"></span>
      {chatKey ? (
        <button
          className="inline-flex items-center gap-1 text-xs text-secondary px-1.5 py-[3px] rounded-md cursor-pointer hover:bg-fill-2 hover:text-label"
          onClick={() => select(chatKey)}
        >
          {t("wait.open")}
          <Icon name="right" className="glyph size-3" />
        </button>
      ) : null}
    </div>
  );

  // how long ago, from the minute up
  const ago = (since: number) => {
    const minutes = Math.floor((clock - since) / 60_000);
    if (minutes < 1) return t("wait.agoNow");
    return minutes < 60 ? t("wait.agoMin", { n: minutes }) : t("wait.agoHour", { n: Math.floor(minutes / 60) });
  };

  const requestsByChat: Record<string, typeof pendingList> = {};
  for (const request of pendingList) {
    if (!requestsByChat[request.project]) requestsByChat[request.project] = [];
    requestsByChat[request.project].push(request);
  }
  if (!meetings.length && !pendingList.length && !blocked.length) return null;
  return (
    <>
      {meetings.map(meeting => {
        // a meeting from 30 minutes before its start: when, what, who, and a note or a briefing in a new conversation
        const left = minutesLeft(meeting, now);
        return (
          <section key={meeting.id} className="flex flex-col gap-2.5">
            {header(<Icon name="cal" className="glyph size-3.5" />, null, meeting.title || t("wait.meetingUntitled"))}
            <div className="grid grid-cols-1 gap-2.5 rounded-xl border border-separator-strong bg-raised p-3.5">
              <div className="flex items-center gap-2 text-[13px] text-secondary">
                <span
                  className={`grid place-items-center size-5.5 flex-none rounded-md bg-fill-2 ${left <= 5 ? "text-late" : "text-soon"}`}
                >
                  <Icon name="cal" className="glyph size-3.5" />
                </span>
                <span className="font-medium text-label">
                  {left ? tn("wait.meetingIn", left) : t("wait.meetingNow")}
                </span>
                <span>
                  {timeOf(meeting.start)}–{timeOf(meeting.end)}
                </span>
                {meeting.location ? <span className="truncate">· {meeting.location}</span> : null}
                {meeting.people.length ? (
                  <span className="flex-none">· {tn("wait.meetingPeople", meeting.people.length)}</span>
                ) : null}
              </div>
              <div className="flex justify-end gap-2">
                <button className="btn cursor-pointer" onClick={() => meetingChat(meeting.id, "prep")}>
                  {t("wait.meetingPrep")}
                </button>
                <button className="btn cursor-pointer" onClick={() => meetingChat(meeting.id, "note")}>
                  {t("wait.meetingNote")}
                </button>
                {joinable(meeting.join) ? (
                  <button className="btn btn-primary cursor-pointer" onClick={() => joinMeeting(meeting.join)}>
                    {t("wait.meetingJoin")}
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        );
      })}
      {Object.entries(requestsByChat).map(([chatKey, requests]) => {
        const { glyph, project, label: title } = chats[chatKey];
        return (
          <section key={chatKey} className="flex flex-col gap-2.5">
            {header(
              glyph ? (
                <Glyph svg={glyph} className="glyph size-3.5" />
              ) : (
                <Icon name="chat" className="glyph size-3.5" />
              ),
              project,
              title,
              chatKey,
              Math.min(...requests.map(request => pendingAt[request.id] ?? clock)),
            )}
            {requests.map(request => (
              <PendingRequest key={request.id} request={request} where={request.project ? title : ""} />
            ))}
          </section>
        );
      })}
      {blocked.map(session => (
        <section key={session.id} className="flex flex-col gap-2.5">
          {header(<Icon name="term" className="glyph size-3.5" />, null, session.name ?? "")}
          <div className="grid grid-cols-1 gap-2.5 rounded-xl border border-separator-strong bg-raised p-3.5">
            <div className="flex items-center gap-2 text-[13px] text-secondary">
              <span className="grid place-items-center size-5.5 flex-none rounded-md bg-fill-2 text-soon">
                <Icon name="term" className="glyph size-3.5" />
              </span>
              {t("wait.bg", {
                date: session.startedAt ? new Date(session.startedAt).toLocaleDateString(locale) : "",
              })}
            </div>
            <div className="flex justify-end gap-2">
              {ACTIONS.map(action => (
                <button
                  key={action}
                  className={`${action === "attach" ? "btn btn-primary inline-flex items-center" : "btn"} cursor-pointer ${action === "stop" ? "text-late" : ""}`}
                  onClick={() => act(action, session.id)}
                >
                  {action === "attach" ? <Icon name="term" className="glyph size-3.5 mr-1.5" /> : null}
                  {errors[action + ":" + session.id] ?? t(LABELS[action])}
                </button>
              ))}
            </div>
          </div>
        </section>
      ))}
    </>
  );
}
