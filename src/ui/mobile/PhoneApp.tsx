import { useRef, useState } from "react";
import { useConversationsStore } from "../../application/conversations/store";
import { useDraftsStore } from "../../application/conversations/drafts";
import { sendOrStop, setTyped } from "../../application/conversations/actions";
import { useNavigationStore } from "../../application/navigation/store";
import { closeConversation, openConversation, pair, refresh, usePhoneStore } from "../../application/mobile/phone";
import { ConversationView } from "../features/conversations/ConversationView";
import { useT } from "../hooks/useT";
import { useUiRequest } from "../hooks/useUiRequest";

/** Relay on a phone: pairing, the laptop's conversations on the machine, and one conversation with the desktop's
 *  own view (ConversationView) and a composer for a small screen. */
export function PhoneApp() {
  const paired = usePhoneStore(s => s.paired);
  const selected = useNavigationStore(s => s.selected);
  return (
    <div className="flex h-full flex-col bg-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-base text-label">
      {paired === null ? null : !paired ? <Pairing /> : selected ? <Conversation id={selected} /> : <List />}
    </div>
  );
}

function Pairing() {
  const { t } = useT();
  const error = usePhoneStore(s => s.error);
  const [line, setLine] = useState("");
  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="text-xl font-semibold">{t("phone.pairTitle")}</h1>
      <p className="text-secondary">{t("phone.pairHelp")}</p>
      <textarea
        className="field h-28 py-2 font-mono text-sm"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="relay://…"
        value={line}
        onChange={e => setLine(e.target.value)}
      />
      {error ? <p className="err-box">{error}</p> : null}
      <button className="btn btn-primary h-11" disabled={!line.trim()} onClick={() => pair(line)}>
        {t("phone.pair")}
      </button>
    </div>
  );
}

function List() {
  const { t } = useT();
  const list = usePhoneStore(s => s.list);
  const server = usePhoneStore(s => s.server);
  const error = usePhoneStore(s => s.error);
  const busy = usePhoneStore(s => s.busy);
  const [name, setName] = useState("");
  const start = () => {
    if (name.trim()) openConversation(name.trim(), false);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-separator px-4 py-3">
        <h1 className="flex-1 text-xl font-semibold">{t("phone.conversations")}</h1>
        <button className="btn h-9" disabled={busy} onClick={refresh}>
          {t("phone.refresh")}
        </button>
      </header>
      {server ? (
        <p className="px-4 pt-2 text-sm text-tertiary">
          {t(server.mirror_open ? "phone.onMachine" : "phone.locked", { host: server.host })}
        </p>
      ) : null}
      {error ? <p className="err-box mx-4 mt-2">{error}</p> : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.length ? (
          list.map(c => (
            <button
              key={c.key}
              className="flex w-full flex-col items-start gap-0.5 border-b border-separator px-4 py-3 text-left active:bg-fill"
              onClick={() => openConversation(c.key, true)}
            >
              <span className="line-clamp-2 font-medium">{c.title || c.key}</span>
              <span className="text-sm text-tertiary">{[c.provider, c.model].filter(Boolean).join(" · ")}</span>
            </button>
          ))
        ) : (
          <p className="px-4 py-6 text-secondary">{t("phone.empty")}</p>
        )}
      </div>
      <div className="flex gap-2 border-t border-separator p-3">
        <input
          className="field h-11 flex-1"
          placeholder={t("phone.newPh")}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && start()}
        />
        <button className="btn btn-primary h-11" disabled={!name.trim()} onClick={start}>
          {t("phone.new")}
        </button>
      </div>
    </div>
  );
}

function Conversation({ id }: { id: string }) {
  const { t } = useT();
  const busy = useConversationsStore(s => s.status[id] === "busy");
  const typed = useDraftsStore(s => s.typed[id] ?? "");
  const scroller = useRef<HTMLDivElement>(null);
  useUiRequest("scroll-bottom", () =>
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight })),
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-separator px-2 py-2">
        <button className="btn h-9 border-0" onClick={closeConversation}>
          ‹ {t("phone.back")}
        </button>
        <h1 className="min-w-0 flex-1 truncate font-semibold">{id}</h1>
      </header>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <ConversationView />
      </div>
      <div className="flex items-end gap-2 border-t border-separator p-3">
        <textarea
          className="field max-h-40 min-h-11 flex-1 resize-none py-2.5"
          rows={1}
          placeholder={t("phone.message")}
          value={typed}
          onChange={e => setTyped(e.target.value)}
        />
        <button className="btn btn-primary h-11" disabled={!busy && !typed.trim()} onClick={sendOrStop}>
          {busy ? t("phone.stop") : t("phone.send")}
        </button>
      </div>
    </div>
  );
}
