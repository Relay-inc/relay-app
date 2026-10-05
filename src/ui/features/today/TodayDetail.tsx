import { useEffect, useState, type ReactNode } from "react";
import type { Status } from "../../../domain/today/plan";
import {
  actionsOf,
  moveTo,
  putOff,
  selectEntry,
  setStatus,
  snooze,
  type Entry,
  type TodayModel,
} from "../../../application/today/today";
import { timeOf } from "../../../application/calendar/calendar";
import { startRecording, useRecordingStore } from "../../../application/calendar/recording";
import { lastAi } from "../../../application/conversations/selectors";
import { projectLabel } from "../../../application/workspace/vault";
import { useTodayStore } from "../../../application/today/store";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/Markdown";
import { PendingRequest } from "../conversations/PendingRequest";
import { MailDetail } from "../mail/MailDetail";
import { openMail } from "../../../application/navigation/panel";
import { CI } from "../pull-requests/prState";
import { Caps, KIND_ICON, Kbd, StatusDot, TONE_TEXT, minutes } from "./parts";

const iso = (at: number) => new Date(at).toISOString();
const CHIP = {
  "": "bg-fill-2 text-secondary",
  run: "bg-fill-2 text-soon",
  bad: "bg-del-bg text-del-fg",
  ok: "bg-add-bg text-add-fg",
};
const chip = (label: string, tone: keyof typeof CHIP = "") => (
  <span key={label} className={`h-6 px-2 rounded-md text-xs font-medium inline-flex items-center ${CHIP[tone]}`}>
    {label}
  </span>
);
const initials = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map(part => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** The item open next to the queue: where it is from and why it is here, what it is about, its actions (Enter,
 *  Backspace, L for later), when it is planned (a click moves it to another slot or to tomorrow), and what else the
 *  same project has today. */
export function TodayDetail({ model }: { model: TodayModel }) {
  const { t, locale } = useT();
  const entry = model.selected;
  const pinned = useTodayStore(s => (entry ? s.pins[entry.id] : undefined));
  const recording = useRecordingStore(s => s.phase !== "idle");
  const chatText = useDerived(() => (entry?.subject.type === "chat" ? lastAi(entry.subject.key) : ""));
  // a mail is read in place: its body loads when it is opened, as in Mail
  const mail = entry?.subject.type === "mail" ? entry.subject.key : "";
  useEffect(() => {
    if (mail) openMail(mail);
  }, [mail]);

  if (!entry) {
    const next = model.meetings.find(meeting => Date.parse(meeting.start) > model.now);
    return (
      <div className="flex flex-col items-center gap-2 py-18">
        <span className="grid place-items-center size-11 rounded-full bg-add-bg text-add-fg">
          <Icon name="check" className="glyph size-5.5" />
        </span>
        <span className="text-[17px] font-semibold">{t("today.cleared")}</span>
        <span className="text-secondary">
          {next ? t("today.nextMeeting", { title: next.title, time: timeOf(next.start) }) : t("wait.noneSub")}
        </span>
      </div>
    );
  }

  const { primary, secondary, extra } = actionsOf(entry);
  // When: every slot of today with how much room it has left for this item, and tomorrow
  const at = model.placed[entry.id];
  const when = model.slots.map(slot => {
    const on = at?.slot === slot.key;
    const room = Math.round((slot.end - slot.start - model.used[slot.key]) / 60_000);
    const late = entry.by !== undefined && slot.start + model.used[slot.key] + entry.est * 60_000 > entry.by;
    const fits = on || (room >= entry.est && !late);
    const after = model.meetings.find(meeting => meeting.id === slot.after);
    return {
      key: slot.key,
      label: after ? t("today.slotAfter", { title: after.title }) : t("today.slotNow"),
      sub: on
        ? `${timeOf(iso(at.start))}–${timeOf(iso(at.start + entry.est * 60_000))}`
        : fits
          ? t("today.minFree", { n: room })
          : late
            ? t("today.tooLate")
            : t("today.full"),
      on,
      fits,
    };
  });
  const isTomorrow = !at;
  const related = model.queue
    .filter(other => other.id !== entry.id && entry.project && other.project === entry.project)
    .slice(0, 4);
  const button = "inline-flex items-center gap-2 h-8.5 rounded-[9px] text-[13px] font-medium cursor-pointer";

  return (
    <div className="min-h-0 overflow-y-auto px-8 py-6">
      <div className="flex flex-col gap-4.5 max-w-160">
        <div className="flex items-center gap-2 text-xs text-secondary">
          <span className={`grid place-items-center size-6.5 rounded-lg bg-fill-2 ${TONE_TEXT[entry.tone]}`}>
            <Icon name={KIND_ICON[entry.kind]} className="glyph size-3.75" />
          </span>
          <span className="flex-1 min-w-0 truncate">{entry.where}</span>
          <span className={`font-semibold whitespace-nowrap ${TONE_TEXT[entry.tone]}`}>{entry.why}</span>
        </div>
        {mail ? null : (
          <div className="text-[22px] leading-tight font-semibold tracking-tight text-pretty select-text">
            {entry.title}
          </div>
        )}
        {entry.kind === "ask" ? null : <StatusPicker key={entry.id} entry={entry} />}
        {mail ? null : <ItemBody entry={entry} chatText={chatText} recording={recording} />}
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={`${button} px-2.5 text-secondary hover:bg-fill-2 hover:text-label`}
            onClick={() => putOff(entry.id)}
          >
            {t("today.later")}
            <Kbd>L</Kbd>
          </button>
          {extra.map(action => (
            <button
              key={action.label}
              className={`${button} px-2.5 text-secondary hover:bg-fill-2 hover:text-label`}
              onClick={() => action.run()}
            >
              {action.label}
            </button>
          ))}
          <span className="flex-1" />
          {secondary ? (
            <button
              className={`${button} px-3 border border-separator-strong hover:bg-fill`}
              onClick={() => secondary.run()}
            >
              {secondary.label}
              <Kbd>⌫</Kbd>
            </button>
          ) : null}
          {primary ? (
            <button
              className={`${button} px-4 bg-accent text-on-accent hover:bg-accent-hover`}
              onClick={() => primary.run()}
            >
              {primary.label}
              <Kbd onAccent>↵</Kbd>
            </button>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 pt-4 border-t border-separator">
          <div className="flex items-baseline gap-2">
            <Caps>{t("today.when")}</Caps>
            <span className="text-xs text-secondary">
              {at
                ? t(pinned ? "today.plannedPinned" : "today.planned", {
                    time: timeOf(iso(at.start)),
                    est: minutes(entry.est),
                  })
                : t("today.movedTomorrow")}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {when.map(slot => (
              <button
                key={slot.key}
                disabled={!slot.fits}
                onClick={() => moveTo(entry, slot.key)}
                className={`flex flex-col items-start px-2.5 py-1.5 rounded-lg border text-xs font-medium leading-tight cursor-pointer disabled:opacity-45 disabled:cursor-default max-w-56 ${slot.on ? "border-accent bg-accent-soft text-accent-text" : "border-separator-strong"}`}
              >
                <span className="truncate max-w-full">{slot.label}</span>
                <span className="text-[11px] font-normal text-secondary">{slot.sub}</span>
              </button>
            ))}
            <button
              onClick={() => moveTo(entry, "tomorrow")}
              className={`flex flex-col items-start px-2.5 py-1.5 rounded-lg border text-xs font-medium leading-tight cursor-pointer ${isTomorrow ? "border-accent bg-accent-soft text-accent-text" : "border-separator-strong"}`}
            >
              <span>{t("rem.tomorrow")}</span>
              <span className="text-[11px] font-normal text-secondary">
                {entry.kind === "reminder" ? t("today.pushes") : t("today.notToday")}
              </span>
            </button>
            <button
              onClick={() => snooze(entry)}
              title={t("today.statusKey", { key: "W" })}
              className="flex flex-col items-start px-2.5 py-1.5 rounded-lg border border-separator-strong text-xs font-medium leading-tight cursor-pointer"
            >
              <span>{t("today.inAWeek")}</span>
              <span className="text-[11px] font-normal text-secondary">
                {new Date(model.now + 7 * 864e5).toLocaleDateString(locale, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </span>
            </button>
          </div>
        </div>
        {related.length ? (
          <div className="flex flex-col gap-0.5 pt-4 border-t border-separator">
            <span className="mb-1.5">
              <Caps>{t("today.alsoIn", { project: projectLabel(entry.project) })}</Caps>
            </span>
            {related.map((other: Entry) => (
              <button
                key={other.id}
                onClick={() => selectEntry(other.id)}
                className="flex items-center gap-2.5 h-8.5 px-2 -mx-2 rounded-lg text-left cursor-pointer hover:bg-fill"
              >
                <Icon name={KIND_ICON[other.kind]} className="glyph size-3.5 text-secondary" />
                <span className="flex-1 min-w-0 truncate">{other.title}</span>
                <span className={`text-xs font-semibold ${TONE_TEXT[other.tone]}`}>{other.why}</span>
              </button>
            ))}
          </div>
        ) : null}
        {mail ? (
          <MailDetail mailKey={mail} readOnReply className="pt-4 border-t border-separator select-text cursor-auto" />
        ) : null}
      </div>
    </div>
  );
}

/** What the item is about, per kind: the agent's card, the meeting's people, the PR's state, the mail's sender. */
function ItemBody({ entry, chatText, recording }: { entry: Entry; chatText: string; recording: boolean }): ReactNode {
  const { t } = useT();
  const s = entry.subject;

  switch (s.type) {
    case "ask":
      return <PendingRequest request={s.request} />;
    case "blocked":
      return (
        <p className="m-0 text-sm text-secondary">
          {t("wait.bg", { date: s.session.startedAt ? new Date(s.session.startedAt).toLocaleDateString() : "" })}
        </p>
      );
    case "meeting":
      return (
        <div className="flex flex-col gap-3 p-3.5 rounded-[10px] bg-fill">
          <div className="text-[13px] text-secondary">
            {timeOf(s.meeting.start)}–{timeOf(s.meeting.end)}
            {s.meeting.location ? ` · ${s.meeting.location}` : ""}
          </div>
          {s.meeting.people.length ? (
            <div className="flex flex-wrap gap-1.5">
              {s.meeting.people.map(person => (
                <span
                  key={person.email}
                  className="inline-flex items-center gap-1.5 h-6.5 pl-0.75 pr-2.25 rounded-full bg-raised shadow-[0_0_0_.5px_var(--color-separator-strong)] text-xs"
                >
                  <span className="grid place-items-center size-5 rounded-full bg-fill-2 text-secondary text-[9px] font-semibold">
                    {initials(person.name || person.email)}
                  </span>
                  {person.name || person.email}
                </span>
              ))}
            </div>
          ) : null}
          {entry.kind === "prep" ? (
            <button
              className="btn self-start inline-flex items-center gap-1.5 cursor-pointer"
              disabled={recording}
              title={t("rec.recordHelp")}
              onClick={() => startRecording(s.meeting.id)}
            >
              <span className="size-2 rounded-full bg-late" />
              {t("rec.record")}
            </button>
          ) : null}
        </div>
      );
    case "reminder":
      return s.reminder.text !== s.reminder.title ? (
        <Markdown text={s.reminder.text} className="text-sm leading-relaxed text-secondary" />
      ) : null;
    case "card":
      return (
        <div className="flex flex-wrap gap-1.5">
          {s.card.card.status ? chip(s.card.card.status, s.card.card.state === "doing" ? "run" : "") : null}
          {s.card.card.due ? chip(t("today.due", { date: s.card.card.due }), entry.tone === "late" ? "bad" : "") : null}
          {s.card.card.labels?.map(label => chip(label))}
        </div>
      );
    case "pr": {
      const ci = s.pr.ci ? CI[s.pr.ci] : undefined;
      return (
        <div className="flex flex-wrap gap-1.5">
          {ci ? chip(t(ci[1]), ci[0]) : null}
          {s.pr.review === "CHANGES_REQUESTED" ? chip(t("rv.changes"), "bad") : null}
          {s.pr.review === "APPROVED" ? chip(t("rv.approved"), "ok") : null}
          {s.pr.draft ? chip(t("today.draft")) : null}
        </div>
      );
    }
    case "mail":
      return (
        <div className="flex flex-col gap-2">
          <div className="px-3.5 py-2.5 border-l-2 border-separator-strong text-sm">
            {s.mail.from.map(person => person.name || person.email).join(", ")}
          </div>
          <span className="text-xs text-secondary">{t("today.mailHint")}</span>
        </div>
      );
    case "chat":
      return <Markdown text={chatText} className="text-sm leading-relaxed text-secondary line-clamp-6" />;
  }
}

const STATUSES: [Status, string][] = [
  ["todo", ""],
  ["doing", "P"],
  ["done", "D"],
];
/** To do, in progress, done: set where the item lives when it can be (see setStatus); a failure shows under it. */
function StatusPicker({ entry }: { entry: Entry }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pick = async (status: Status) => {
    if (status === entry.status || busy) return;
    setBusy(true);
    setErr("");
    try {
      await setStatus(entry, status);
    } catch (error) {
      setErr(String(error));
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className={`inline-flex bg-fill-2 rounded-lg p-0.5 ${busy ? "opacity-60" : ""}`}>
          {STATUSES.map(([status, key]) => (
            <button
              key={status}
              disabled={busy}
              onClick={() => pick(status)}
              title={key ? t("today.statusKey", { key }) : undefined}
              className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium cursor-pointer ${entry.status === status ? "bg-raised shadow-sm text-label" : "text-secondary hover:text-label"}`}
            >
              <StatusDot status={status} />
              {t(`today.status.${status}`)}
            </button>
          ))}
        </div>
        <span className="text-xs text-tertiary">{t(`today.doneIn.${entry.kind}`)}</span>
      </div>
      {err ? <div className="err-box">{err}</div> : null}
    </div>
  );
}
