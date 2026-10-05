import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import type { Status } from "../../../domain/today/plan";
import {
  actionsOf,
  moveTo,
  putOff,
  selectEntry,
  setStatus,
  snooze,
  snoozeOptions,
  type Action,
  type Entry,
  type TodayModel,
} from "../../../application/today/today";
import { setPop, setTab, useDetailsStore } from "../../../application/today/details";
import { cardAct, loadCard, loadPr } from "../../../application/today/load";
import { ticketLinks, openLinked } from "../../../application/board/board";
import { provider } from "../../../shared/plugins";
import { isQuestion } from "../../../domain/conversations/rules";
import { timeOf } from "../../../application/calendar/calendar";
import { lastAi } from "../../../application/conversations/selectors";
import { openMail } from "../../../application/navigation/panel";
import { projectLabel } from "../../../application/workspace/vault";
import { useTodayStore } from "../../../application/today/store";
import { cardKey } from "../../../domain/navigation/keys";
import { useDismiss } from "../../hooks/useDismiss";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/Markdown";
import { PendingRequest } from "../conversations/PendingRequest";
import { MailSection } from "./sections/MailSection";
import { PrSection, prTabs } from "./sections/PrSection";
import { CardSection, cardTabs } from "./sections/CardSection";
import { MeetingSection } from "./sections/MeetingSection";
import { Caps, KIND_ICON, Kbd, StatusDot, TONE_TEXT, minutes } from "./parts";

const iso = (at: number) => new Date(at).toISOString();
const BUTTON =
  "inline-flex items-center gap-1.5 h-7.5 px-2.5 rounded-lg text-[13px] font-medium whitespace-nowrap cursor-pointer";
const ICON_BUTTON =
  "grid place-items-center size-7.5 rounded-lg text-secondary cursor-pointer hover:bg-fill-2 hover:text-label";
const MENU = "absolute top-9 z-20 w-60 p-1 rounded-[10px] bg-raised shadow-xl ring-[0.5px] ring-separator-strong";

/** What kind of item it is, as the chip in front of where it is from says it. */
const kindLabel = (entry: Entry) =>
  entry.subject.type === "ask"
    ? isQuestion(entry.subject.request)
      ? "today.kind.question"
      : "today.kind.ask"
    : (`today.kind.${entry.kind}` as const);

/** The item open next to the queue. On top where it is from and why it is here, its title and its actions (the
 *  main two as buttons, the rest under "…", snooze, later and done on the right). Below that the item itself, per
 *  kind and per tab, and at the bottom its status, when it is planned, what is known about it and what else in the
 *  queue it connects to. */
export function TodayDetail({ model }: { model: TodayModel }) {
  const { t } = useT();
  const entry = model.selected;
  const tabOf = useDetailsStore(s => (entry ? s.tab[entry.id] : ""));
  const pop = useDetailsStore(s => s.pop);
  const prDetail = useDetailsStore(s => (entry?.subject.type === "pr" ? s.pr[entry.id] : undefined));
  const cardView = useDetailsStore(s => (entry?.subject.type === "card" ? s.card[entry.id] : undefined));

  // what the item needs from its source, fetched when it opens
  const subject = entry?.subject;
  const entryId = entry?.id ?? "";
  // once per item it opens on: the clock rebuilds the items every 30 seconds, that is no reason to read them again
  const load = useEffectEvent(() => {
    if (!subject) return;
    if (subject.type === "mail") openMail(subject.key);
    if (subject.type === "pr") loadPr(entryId, subject.pr);
    if (subject.type === "card") loadCard(entryId, subject.card);
  });
  useEffect(() => load(), [entryId]);

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

  const { acts, done } = actionsOf(entry);
  const s = entry.subject;
  const connected = connectedOf(model, entry);
  const tabs = s.type === "pr" ? prTabs(prDetail) : s.type === "card" ? cardTabs(cardView, connected.length) : [];
  const tab = tabOf || tabs[0]?.id || "";

  const body = (): ReactNode => {
    switch (s.type) {
      case "ask":
        return <AskBody entry={entry} />;
      case "blocked":
        return (
          <p className="m-0 text-sm text-secondary">
            {t("wait.bg", { date: s.session.startedAt ? new Date(s.session.startedAt).toLocaleDateString() : "" })}
          </p>
        );
      case "meeting":
        return <MeetingSection meeting={s.meeting} after={entry.kind === "note"} />;
      case "reminder":
        return s.reminder.text !== s.reminder.title ? (
          <Markdown text={s.reminder.text} className="text-sm leading-relaxed text-secondary max-w-170" />
        ) : null;
      case "card":
        return tab === "linked" ? (
          <ConnectedList items={connected} />
        ) : (
          <CardSection id={entry.id} item={s.card} tab={tab} />
        );
      case "pr":
        return <PrSection id={entry.id} tab={tab} />;
      case "mail":
        return <MailSection mailKey={s.key} id={s.mail.id} />;
      case "chat":
        return <ChatBody chat={s.key} />;
    }
  };

  return (
    <div className="min-w-0 min-h-0 grid grid-rows-[minmax(0,1fr)_auto]">
      <div className="min-w-0 min-h-0 flex flex-col">
        <div className="flex-none flex flex-col gap-2 px-7 pt-4.5">
          <div className="flex items-center gap-2 text-xs text-secondary">
            <span className="inline-flex items-center gap-1.5 h-6 pl-1 pr-2 rounded-[7px] bg-fill-2 text-label font-medium whitespace-nowrap">
              <span
                className={`grid place-items-center size-4.5 rounded-[5px] bg-raised ${entry.tone ? TONE_TEXT[entry.tone] : "text-accent-text"}`}
              >
                <Icon name={KIND_ICON[entry.kind]} className="glyph size-3" />
              </span>
              {t(kindLabel(entry))}
            </span>
            <span className="flex-1 min-w-0 truncate">{entry.where}</span>
            <span className={`font-semibold whitespace-nowrap ${TONE_TEXT[entry.tone]}`}>{entry.why}</span>
          </div>
          <h1 className="m-0 mt-0.5 text-xl leading-snug font-semibold tracking-tight text-pretty select-text">
            {entry.title}
          </h1>
          <ActionBar entry={entry} acts={acts} done={done} pop={pop} now={model.now} />
          {tabs.length ? (
            <div className="flex gap-4.5 mt-2 border-b border-separator">
              {tabs.map(item => (
                <button
                  key={item.id}
                  onClick={() => setTab(entry.id, item.id)}
                  className={`inline-flex items-center gap-1.5 h-8.5 text-[13px] font-medium cursor-pointer ${tab === item.id ? "text-label shadow-[inset_0_-2px_0_var(--color-accent)]" : "text-secondary hover:text-label"}`}
                >
                  {t(item.label)}
                  {item.n ? (
                    <span className="min-w-4.5 h-4.5 px-1.25 rounded-full bg-fill-2 text-secondary text-[11px] grid place-items-center">
                      {item.n}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-7 pt-4.5 pb-7 select-text cursor-auto">{body()}</div>
      </div>
      <Aside model={model} entry={entry} connected={connected} />
    </div>
  );
}

/** The main two actions, the rest under "…", and on the right snooze, later and done. */
function ActionBar({
  entry,
  acts,
  done,
  pop,
  now,
}: {
  entry: Entry;
  acts: Action[];
  done?: Action;
  pop: string;
  now: number;
}) {
  const { t, locale } = useT();
  const more = useRef<HTMLDivElement>(null);
  const snoozeRef = useRef<HTMLDivElement>(null);
  useDismiss(more, pop === "more", () => setPop(""));
  useDismiss(snoozeRef, pop === "snooze", () => setPop(""));
  const main = acts.slice(0, 2);
  const rest = acts.slice(2);
  const run = (action: Action) => {
    setPop("");
    action.run();
  };
  return (
    <div className="flex items-center gap-1.5 mt-1.5 min-w-0">
      {main.map((action, i) => (
        <button
          key={action.label}
          title={action.tip}
          onClick={() => run(action)}
          className={`${BUTTON} ${i === 0 ? "bg-accent text-on-accent hover:bg-accent-hover" : action.key === "⌫" ? "border border-separator-strong hover:bg-fill" : "text-secondary hover:bg-fill-2 hover:text-label"}`}
        >
          {action.icon ? <Icon name={action.icon} className="glyph size-3.5" /> : null}
          {action.label}
          {action.key ? <Kbd onAccent={i === 0}>{action.key}</Kbd> : null}
        </button>
      ))}
      {rest.length ? (
        <div ref={more} className="relative">
          <button
            className={`${ICON_BUTTON} ${pop === "more" ? "bg-fill-2" : ""}`}
            title={t("today.moreActions")}
            aria-label={t("today.moreActions")}
            onClick={() => setPop("more")}
          >
            <Icon name="more" className="glyph size-4" />
          </button>
          {pop === "more" ? (
            <div className={`${MENU} left-0`}>
              {rest.map(action => (
                <button
                  key={action.label}
                  title={action.tip}
                  onClick={() => run(action)}
                  className="w-full flex items-center gap-2 h-8 px-2 rounded-md text-left text-[13px] cursor-pointer hover:bg-fill-2"
                >
                  {action.icon ? (
                    <Icon name={action.icon} className="glyph size-3.5 text-secondary" />
                  ) : (
                    <span className="w-3.5" />
                  )}
                  <span className="flex-1">{action.label}</span>
                  {action.key ? <span className="font-mono text-[11px] text-tertiary">{action.key}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <span className="flex-1" />
      <div ref={snoozeRef} className="relative">
        <button
          className={`${ICON_BUTTON} ${pop === "snooze" ? "bg-fill-2" : ""}`}
          title={t("today.snoozeKey")}
          aria-label={t("today.snoozeKey")}
          onClick={() => setPop("snooze")}
        >
          <Icon name="clock" className="glyph size-4" />
        </button>
        {pop === "snooze" ? (
          <div className={`${MENU} right-0`}>
            <div className="px-2 pt-1.5 pb-1">
              <Caps>{t("today.offUntil")}</Caps>
            </div>
            {snoozeOptions(now).map(option => (
              <button
                key={option.id}
                onClick={() => {
                  setPop("");
                  snooze(entry, option.days);
                }}
                className="w-full flex items-center gap-2 h-8 px-2 rounded-md text-left text-[13px] cursor-pointer hover:bg-fill-2"
              >
                <span className="flex-1">{t(`today.snooze.${option.id}`)}</span>
                <span className="text-xs text-tertiary">
                  {new Date(now + option.days * 864e5).toLocaleDateString(locale, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button
        className={ICON_BUTTON}
        title={t("today.laterKey")}
        aria-label={t("today.laterKey")}
        onClick={() => putOff(entry.id)}
      >
        <Icon name="down" className="glyph size-4" />
      </button>
      {done ? (
        <button className={`${BUTTON} border border-separator-strong hover:bg-fill`} onClick={() => run(done)}>
          <Icon name={done.icon ?? "check"} className="glyph size-3.5" />
          {done.label}
          <Kbd>E</Kbd>
        </button>
      ) : null}
    </div>
  );
}

/** An agent's permission or question: what it last said, then its card (Enter allows). */
function AskBody({ entry }: { entry: Entry }) {
  const s = entry.subject;
  const said = useDerived(() => (s.type === "ask" ? lastAi(s.chat) : ""));
  if (s.type !== "ask") return null;
  return (
    <div className="flex flex-col gap-3 max-w-170">
      {said ? <Markdown text={said} className="text-sm leading-relaxed text-secondary line-clamp-6" /> : null}
      <PendingRequest request={s.request} />
    </div>
  );
}
function ChatBody({ chat }: { chat: string }) {
  const text = useDerived(() => lastAi(chat));
  return <Markdown text={text} className="text-sm leading-relaxed text-secondary max-w-170" />;
}

// ---------- the bottom: status, when, facts, connected
type Connected = { id: string; icon: string; title: string; meta: string; go: () => unknown };
/** Other items of the same project in the queue, and for a card the conversations and PRs it links to. */
function connectedOf(model: TodayModel, entry: Entry): Connected[] {
  const same = model.queue
    .filter(other => other.id !== entry.id && entry.project && other.project === entry.project)
    .slice(0, 5)
    .map(other => ({
      id: other.id,
      icon: KIND_ICON[other.kind],
      title: other.title,
      meta: other.why,
      go: () => selectEntry(other.id),
    }));
  const s = entry.subject;
  if (s.type !== "card") return same;
  const tracker = provider(s.card.provider);
  if (!tracker) return same;
  const links = ticketLinks(tracker, cardKey(tracker.id, s.card.card.id), s.card.card.number);
  return [
    ...links.conversations.map(c => ({
      id: c.key,
      icon: "chat",
      title: c.title,
      meta: projectLabel(c.project),
      go: () => openLinked({ conversation: c.key }),
    })),
    ...links.prs.map(pr => ({
      id: pr.url,
      icon: "pr",
      title: pr.title,
      meta: `${pr.repo} #${pr.number}`,
      go: () => openLinked({ repo: pr.repo, number: pr.number }),
    })),
    ...same,
  ];
}
function ConnectedList({ items }: { items: Connected[] }) {
  const { t } = useT();
  if (!items.length) return <div className="text-sm text-secondary">{t("today.nothingConnected")}</div>;
  return (
    <div className="flex flex-col">
      {items.map((item, i) => (
        <button
          key={item.id}
          onClick={item.go}
          className={`flex items-center gap-2.5 h-9 px-2 -mx-2 rounded-lg text-left cursor-pointer hover:bg-fill ${i ? "" : ""}`}
        >
          <Icon name={item.icon} className="glyph size-3.5 text-secondary flex-none" />
          <span className="flex-1 min-w-0 truncate text-[13px]">{item.title}</span>
          <span className="text-xs text-tertiary truncate max-w-40">{item.meta}</span>
        </button>
      ))}
    </div>
  );
}

function Aside({ model, entry, connected }: { model: TodayModel; entry: Entry; connected: Connected[] }) {
  const { t, locale } = useT();
  const pinned = useTodayStore(s => s.pins[entry.id]);
  const cardView = useDetailsStore(s => (entry.subject.type === "card" ? s.card[entry.id] : undefined));
  const facts = factsOf(entry, locale, t);
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
  return (
    <aside className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] gap-7 px-7 pt-3.5 pb-4 border-t border-separator max-h-55 overflow-y-auto">
      <div className="flex flex-col gap-3 min-w-0">
        {entry.kind === "ask" ? null : cardView?.statuses?.length && entry.subject.type === "card" ? (
          <TrackerStatus entry={entry} />
        ) : (
          <StatusPicker key={entry.id} entry={entry} />
        )}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <Caps>{t("today.when")}</Caps>
            <span className="text-xs text-secondary truncate">
              {at
                ? t(pinned ? "today.plannedPinned" : "today.planned", {
                    time: timeOf(iso(at.start)),
                    est: minutes(entry.est),
                  })
                : t("today.movedTomorrow")}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {when.map(slot => (
              <button
                key={slot.key}
                disabled={!slot.fits}
                onClick={() => moveTo(entry, slot.key)}
                title={slot.sub}
                className={`h-6.5 px-2 rounded-md border text-xs truncate max-w-40 cursor-pointer disabled:opacity-45 disabled:cursor-default ${slot.on ? "border-accent bg-accent-soft text-accent-text" : "border-separator-strong hover:bg-fill"}`}
              >
                {slot.label}
              </button>
            ))}
            <button
              onClick={() => moveTo(entry, "tomorrow")}
              className={`h-6.5 px-2 rounded-md border text-xs cursor-pointer ${!at ? "border-accent bg-accent-soft text-accent-text" : "border-separator-strong hover:bg-fill"}`}
            >
              {t("rem.tomorrow")}
            </button>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 min-w-0">
        {facts.map(([label, value]) => (
          <div key={label} className="flex gap-2 text-xs min-w-0">
            <span className="w-18 flex-none text-tertiary">{label}</span>
            <span className="flex-1 min-w-0 truncate select-text" title={value}>
              {value}
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1 min-w-0">
        <Caps>{t("today.connected")}</Caps>
        <ConnectedList items={connected.slice(0, 4)} />
      </div>
    </aside>
  );
}

type T = ReturnType<typeof useT>["t"];
// what is known about the item, as label and value
function factsOf(entry: Entry, locale: string, t: T): [string, string][] {
  const s = entry.subject;
  const date = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  const who = (list: { name: string | null; email: string }[]) => list.map(a => a.name || a.email).join(", ");
  switch (s.type) {
    case "mail":
      return [
        [t("today.fact.from"), who(s.mail.from)],
        [t("today.fact.to"), who(s.mail.to)],
        [t("today.fact.date"), date(s.mail.date)],
        [t("today.fact.account"), s.mail.account],
      ];
    case "pr":
      return [
        [t("today.fact.repo"), s.pr.repo],
        [t("today.fact.author"), s.pr.author ?? ""],
        [t("today.fact.updated"), date(s.pr.updated)],
        [t("today.fact.project"), projectLabel(s.pr.project)],
      ];
    case "card":
      return [
        [t("today.fact.tracker"), provider(s.card.provider)?.name ?? ""],
        [t("today.fact.project"), projectLabel(s.card.project)],
        [t("today.fact.status"), s.card.card.status ?? ""],
        [t("today.fact.due"), s.card.card.due ?? "–"],
        [t("today.fact.assignee"), s.card.card.whoName || s.card.card.who],
      ];
    case "meeting":
      return [
        [t("today.fact.time"), `${timeOf(s.meeting.start)}–${timeOf(s.meeting.end)}`],
        [t("today.fact.where"), s.meeting.location || "–"],
        [t("today.fact.organizer"), s.meeting.organizer || "–"],
        [t("today.fact.people"), String(s.meeting.people.length)],
      ];
    case "reminder":
      return [
        [t("today.fact.date"), s.reminder.date],
        [t("today.fact.repeat"), s.reminder.repeat ?? "–"],
        [t("today.fact.project"), projectLabel(s.reminder.project)],
      ];
    case "ask":
      return [
        [t("today.fact.tool"), s.request.tool_name],
        [t("today.fact.project"), projectLabel(entry.project)],
      ];
    default:
      return [[t("today.fact.project"), projectLabel(entry.project)]];
  }
}

/** A card's status as its tracker has them, every status of its workflow; a click moves it there. */
function TrackerStatus({ entry }: { entry: Entry }) {
  const { t } = useT();
  const s = entry.subject;
  const view = useDetailsStore(st => (s.type === "card" ? st.card[entry.id] : undefined));
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  if (s.type !== "card" || !view?.statuses) return null;
  const tracker = provider(s.card.provider);
  return (
    <div className="flex flex-col gap-1.5">
      <Caps>{t("today.statusIn", { name: tracker?.name ?? "" })}</Caps>
      <div className="flex flex-wrap gap-1">
        {view.statuses.map(status => {
          const on = view.status?.id === status.id;
          return (
            <button
              key={status.id}
              disabled={!!busy}
              onClick={async () => {
                if (on) return;
                setBusy(status.id);
                setErr("");
                await cardAct(entry.id, s.card, "status", status.id).catch(error => setErr(String(error)));
                setBusy("");
              }}
              className={`inline-flex items-center gap-1.5 h-6.5 px-2 rounded-md border text-xs cursor-pointer ${on ? "border-accent font-semibold" : "border-separator-strong text-secondary hover:bg-fill"} ${busy === status.id ? "opacity-60" : ""}`}
            >
              <StatusDot status={status.state ?? "todo"} />
              {status.name}
            </button>
          );
        })}
      </div>
      {err ? <div className="err-box">{err}</div> : null}
    </div>
  );
}

const STATUSES: Status[] = ["todo", "doing", "done"];
/** To do, in progress, done for an item without a tracker of its own (see setStatus); a failure shows under it. */
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
      <div className="flex items-baseline gap-2">
        <Caps>{t("today.status")}</Caps>
        <span className="text-xs text-tertiary truncate">{t(`today.doneIn.${entry.kind}`)}</span>
      </div>
      <div className={`inline-flex self-start bg-fill-2 rounded-lg p-0.5 ${busy ? "opacity-60" : ""}`}>
        {STATUSES.map(status => (
          <button
            key={status}
            disabled={busy}
            onClick={() => pick(status)}
            className={`inline-flex items-center gap-1.5 h-6.5 px-2 rounded-md text-xs font-medium cursor-pointer ${entry.status === status ? "bg-raised shadow-sm text-label" : "text-secondary hover:text-label"}`}
          >
            <StatusDot status={status} />
            {t(`today.status.${status}`)}
          </button>
        ))}
      </div>
      {err ? <div className="err-box">{err}</div> : null}
    </div>
  );
}
