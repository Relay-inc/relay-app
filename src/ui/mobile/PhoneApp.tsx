import { useRef, useState } from "react";
import type { Pending } from "../../domain/conversations/types";
import { isQuestion } from "../../domain/conversations/rules";
import { agent } from "../../shared/plugins";
import { useConversationsStore } from "../../application/conversations/store";
import { useDraftsStore } from "../../application/conversations/drafts";
import { answer, sendOrStop, setTyped } from "../../application/conversations/actions";
import { useNavigationStore } from "../../application/navigation/store";
import {
  closeConversation,
  openConversation,
  pair,
  scanToPair,
  startConversation,
  titleOf,
  usePhoneStore,
} from "../../application/mobile/phone";
import { ConversationView } from "../features/conversations/ConversationView";
import { PendingRequest } from "../features/conversations/PendingRequest";
import { describe } from "../components/PermissionCard";
import { Glyph } from "../components/Glyph";
import { Icon } from "../components/Icon";
import { useDerived } from "../hooks/useDerived";
import { useT } from "../hooks/useT";
import { useUiRequest } from "../hooks/useUiRequest";
import mark from "../assets/relay-mark.svg";

/** Relay on a phone (design: Relay Mobile, claude.ai/design): pairing, the laptop's conversations on the machine with
 *  what waits on you on top, one conversation in the desktop's own view with its card docked underneath, and a sheet
 *  to start a new one. Light and dark follow the phone. */
export function PhoneApp() {
  const paired = usePhoneStore(s => s.paired);
  const selected = useNavigationStore(s => s.selected);
  return (
    <div className="flex h-full flex-col bg-bg pt-[env(safe-area-inset-top)] text-base text-label">
      {paired === null ? <Starting /> : !paired ? <Pairing /> : selected ? <Conversation id={selected} /> : <List />}
    </div>
  );
}

// while it finds out whether it is paired (a cold start reaches the machine first)
function Starting() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6">
      <img src={mark} alt="Relay" className="h-12 w-10" />
      <span className="spinner size-5" />
    </div>
  );
}

const glyphOf = (provider: string | undefined) => agent(provider || "claude")?.glyph ?? "";
// how long ago a card was raised, in whole minutes
const minutesAgo = (at?: number) => (at ? Math.max(0, Math.round((Date.now() / 1000 - at) / 60)) : 0);
const firstLine = (text: string) => text.split("\n")[0];

function Pairing() {
  const { t } = useT();
  const error = usePhoneStore(s => s.error);
  const busy = usePhoneStore(s => s.busy);
  const [line, setLine] = useState("");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pt-14 pb-[max(env(safe-area-inset-bottom),2rem)]">
      <img src={mark} alt="Relay" className="h-9 w-7.5" />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl leading-tight font-bold tracking-tight">{t("phone.pairTitle")}</h1>
        <p className="text-secondary">{t("phone.pairHelp")}</p>
      </div>
      <ol className="flex flex-col gap-3.5">
        {[t("phone.step1"), t("phone.step2"), t("phone.step3")].map((step, i) => (
          <li key={i} className="flex items-start gap-3.5">
            <span className="grid size-6 flex-none place-items-center rounded-full bg-fill-2 text-sm font-semibold text-secondary">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <span className="flex-1" />
      {error ? <p className="err-box">{error}</p> : null}
      <button
        className="inline-flex h-13 items-center justify-center gap-2.5 rounded-2xl bg-accent text-lg font-semibold text-on-accent disabled:opacity-50"
        disabled={busy}
        onClick={scanToPair}
      >
        {busy ? <span className="spinner" /> : <Icon name="qr" className="glyph size-5" />}
        {t(busy ? "phone.pairing" : "phone.scan")}
      </button>
      <details className="group flex flex-col">
        <summary className="flex h-11 cursor-pointer list-none items-center justify-center font-medium text-accent-text group-open:hidden">
          {t("phone.paste")}
        </summary>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-2">
            <span className="pl-1 text-sm text-tertiary">{t("phone.line")}</span>
            <textarea
              className="min-h-24 resize-none rounded-2xl bg-well px-4 py-3.5 font-mono text-sm break-all outline-none placeholder:text-tertiary focus:ring-3 focus:ring-accent-soft"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="relay://…"
              value={line}
              onChange={e => setLine(e.target.value)}
            />
          </label>
          <button
            className="h-11 rounded-2xl bg-fill-2 font-semibold disabled:opacity-50"
            disabled={busy || !line.trim()}
            onClick={() => pair(line)}
          >
            {t("phone.pair")}
          </button>
        </div>
      </details>
    </div>
  );
}

function List() {
  const { t } = useT();
  const list = usePhoneStore(s => s.list);
  const server = usePhoneStore(s => s.server);
  const error = usePhoneStore(s => s.error);
  const pending = useConversationsStore(s => s.pendingList);
  const status = useConversationsStore(s => s.status);
  const [starting, setStarting] = useState(false);
  const first = pending[0];
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-1 px-5 pt-2 pb-3">
        <h1 className="text-3xl font-bold tracking-tight">{t("phone.conversations")}</h1>
        {server ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-secondary">
            <span className={`size-2 rounded-full ${server.mirror_open ? "bg-ok" : "bg-soon"}`} />
            {t(server.mirror_open ? "phone.vaultOpen" : "phone.vaultLocked", { host: server.host })}
          </span>
        ) : null}
      </header>
      {error ? <p className="err-box mx-4">{error}</p> : null}
      <div className="min-h-0 flex-1 overflow-y-auto pb-32">
        {first ? (
          <div className="px-4 pt-1 pb-2">
            <button
              className="flex w-full items-center gap-3 rounded-2xl bg-raised px-4 py-3.5 text-left shadow-lg ring-1 ring-accent"
              onClick={() => openConversation(first.project, true)}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-text">
                  <Glyph svg={glyphOf("claude")} className="glyph size-3.5" />
                  {minutesAgo(first.at) ? t("phone.waitsOnYou", { min: minutesAgo(first.at) }) : t("phone.waitsNow")}
                </span>
                <span className="truncate font-semibold">{cardTitle(first, t)}</span>
                <span className="truncate text-sm text-tertiary">{titleOf(first.project)}</span>
              </div>
              <Icon name="right" className="glyph size-4 text-tertiary" />
            </button>
          </div>
        ) : null}
        {list.length ? (
          list.map(c => {
            const waits = pending.some(p => p.project === c.key);
            const busy = status[c.key] === "busy";
            return (
              <button
                key={c.key}
                className="flex min-h-16 w-full items-center gap-3 px-5 text-left active:bg-fill"
                onClick={() => openConversation(c.key, true)}
              >
                <span className="grid size-8.5 flex-none place-items-center rounded-full bg-fill-2">
                  <Glyph svg={glyphOf(c.provider)} className="glyph size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-px border-b border-separator py-2.5">
                  <span className={`truncate ${waits ? "font-semibold" : ""}`}>{c.title || c.key}</span>
                  <span
                    className={`flex items-center gap-1.5 text-sm ${waits ? "text-accent-text" : busy ? "text-secondary" : "text-tertiary"}`}
                  >
                    {busy && !waits ? <span className="spinner size-2.5" /> : null}
                    {waits ? t("phone.needsYou") : busy ? t("phone.working") : [c.model].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            );
          })
        ) : (
          <p className="px-5 py-6 text-secondary">{t("phone.empty")}</p>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-linear-to-b from-transparent to-bg to-55%" />
      <button
        className="absolute bottom-[max(env(safe-area-inset-bottom),1.5rem)] left-1/2 inline-flex h-12.5 -translate-x-1/2 items-center gap-2 rounded-full bg-accent px-5.5 font-semibold whitespace-nowrap text-on-accent shadow-lg"
        onClick={() => setStarting(true)}
      >
        <Icon name="add" className="glyph size-4.5" />
        {t("phone.new")}
      </button>
      {starting ? <NewSheet onClose={() => setStarting(false)} /> : null}
    </div>
  );
}

// what a card asks, in a line: the command, the file, else the tool; a question its first question
function cardTitle(request: Pending, t: ReturnType<typeof useT>["t"]) {
  if (isQuestion(request)) return String(request.input.questions?.[0]?.question ?? request.tool_name);
  const input = request.input || {};
  const what = request.tool_name === "Bash" ? firstLine(String(input.command ?? "")) : String(input.file_path ?? "");
  return t("phone.allow", { what: what || request.tool_name });
}

function NewSheet({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [text, setText] = useState("");
  const start = () => {
    if (!text.trim()) return;
    onClose();
    startConversation(text.trim());
  };
  return (
    <div className="fixed inset-0 z-10 flex flex-col bg-black/30 pt-[calc(env(safe-area-inset-top)+3rem)]">
      <div className="flex min-h-0 flex-1 flex-col gap-4.5 rounded-t-3xl bg-bg px-5 pt-2 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <span className="h-1.25 w-9 self-center rounded-full bg-separator-strong" />
        <div className="flex items-center">
          <button className="flex-1 text-left text-accent-text" onClick={onClose}>
            {t("phone.cancel")}
          </button>
          <span className="text-lg font-semibold">{t("phone.new")}</span>
          <button
            className="flex-1 text-right font-semibold text-accent-text disabled:opacity-40"
            disabled={!text.trim()}
            onClick={start}
          >
            {t("phone.start")}
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-tertiary">{t("phone.agent")}</span>
          <span className="inline-flex items-center gap-2 font-semibold">
            <Glyph svg={glyphOf("claude")} className="glyph size-4" />
            {agent("claude")?.name}
          </span>
        </div>
        <textarea
          autoFocus
          className="min-h-32 flex-1 resize-none rounded-2xl bg-well px-4 py-3.5 outline-none placeholder:text-tertiary"
          placeholder={t("phone.firstMessage")}
          value={text}
          onChange={e => setText(e.target.value)}
        />
      </div>
    </div>
  );
}

function Conversation({ id }: { id: string }) {
  const { t } = useT();
  const busy = useConversationsStore(s => s.status[id] === "busy");
  const card = useConversationsStore(s => s.pendingList.find(p => p.project === id));
  const typed = useDraftsStore(s => s.typed[id] ?? "");
  const entry = usePhoneStore(s => s.list.find(c => c.key === id));
  const title = useDerived(() => titleOf(id));
  const scroller = useRef<HTMLDivElement>(null);
  useUiRequest("scroll-bottom", () =>
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight })),
  );
  const name = agent(entry?.provider || "claude")?.name ?? "";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-13 flex-none items-center gap-1.5 border-b border-separator px-2.5">
        <button
          className="grid size-10 place-items-center text-accent-text"
          aria-label={t("phone.back")}
          onClick={closeConversation}
        >
          <Icon name="left" className="glyph size-5.5 stroke-2" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col items-center leading-tight">
          <span className="max-w-full truncate font-semibold">{title}</span>
          <span className="inline-flex items-center gap-1 text-xs text-tertiary">
            <Glyph svg={glyphOf(entry?.provider)} className="glyph size-2.75" />
            {[name, entry?.model].filter(Boolean).join(" · ")}
          </span>
        </div>
        <span className="size-10" />
      </header>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 py-4.5">
        <ConversationView cards={false} empty={t("phone.emptyChat", { agent: name })} />
      </div>
      {card ? (
        <DockedCard request={card} />
      ) : (
        <div className="flex flex-none items-end gap-2.5 border-t border-separator px-3 pt-2.5 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          <textarea
            className="max-h-40 min-h-11 flex-1 resize-none rounded-3xl bg-well px-4 py-2.5 outline-none placeholder:text-tertiary"
            rows={1}
            placeholder={t("phone.message", { agent: name })}
            value={typed}
            onChange={e => setTyped(e.target.value)}
          />
          {busy ? (
            <button
              className="grid size-11 flex-none place-items-center rounded-full bg-label"
              aria-label={t("phone.stop")}
              onClick={sendOrStop}
            >
              <span className="size-3.5 rounded-sm bg-bg" />
            </button>
          ) : (
            <button
              className="grid size-11 flex-none place-items-center rounded-full bg-accent text-on-accent disabled:opacity-40"
              aria-label={t("phone.send")}
              disabled={!typed.trim()}
              onClick={sendOrStop}
            >
              <Icon name="send" className="glyph size-5 stroke-2" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A card of this conversation under it: what the agent wants to run, Deny / Allow, and Always allow when the agent
 *  offers one. A question keeps the desktop's card, it needs its options. */
function DockedCard({ request }: { request: Pending }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  if (isQuestion(request))
    return (
      <div className="flex-none px-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <PendingRequest request={request} />
      </div>
    );
  const pick = async (choice: "allow" | "always" | "deny") => {
    setBusy(true);
    await answer(request, choice).catch(() => false);
    setBusy(false);
  };
  const bash = request.tool_name === "Bash";
  return (
    <div className="mx-3 mb-[max(env(safe-area-inset-bottom),1.25rem)] flex flex-none flex-col gap-3 rounded-3xl bg-raised p-4.5 shadow-lg ring-1 ring-separator-strong">
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-secondary">
        <Glyph svg={glyphOf(request.provider)} className="glyph size-3.5 text-accent-text" />
        {bash ? t("phone.wantsToRun") : t("phone.wantsToUse", { tool: request.tool_name })}
      </span>
      <div className="max-h-48 overflow-y-auto rounded-xl bg-well px-3.5 py-3 font-mono text-sm whitespace-pre-wrap wrap-anywhere">
        {describe(request)}
      </div>
      <div className="mt-0.5 flex gap-2.5">
        <button
          className="h-12 flex-1 rounded-2xl border border-separator-strong font-semibold disabled:opacity-50"
          disabled={busy}
          onClick={() => pick("deny")}
        >
          {t("phone.deny")}
        </button>
        <button
          className="h-12 flex-1 rounded-2xl bg-accent font-semibold text-on-accent disabled:opacity-50"
          disabled={busy}
          onClick={() => pick("allow")}
        >
          {t("phone.allowButton")}
        </button>
      </div>
      {request.suggestions?.length ? (
        <button className="h-8 text-sm font-medium text-accent-text" disabled={busy} onClick={() => pick("always")}>
          {t("phone.alwaysAllow")}
        </button>
      ) : null}
    </div>
  );
}
