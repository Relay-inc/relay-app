import { useEffect, useState } from "react";
import type { Addr } from "../../../../domain/mail/reply";
import { useDetailsStore } from "../../../../application/today/details";
import {
  addRecipient,
  closeCompose,
  loadQuickReplies,
  loadThread,
  openCompose,
  removeRecipient,
  saveCompose,
  setComposeHow,
  setComposeText,
  toggleArchiveAfter,
  tweakCompose,
} from "../../../../application/today/mail";
import { mailExperimental } from "../../../../application/settings/settings";
import { useT } from "../../../hooks/useT";
import { Icon } from "../../../components/Icon";
import { MailDetail } from "../../mail/MailDetail";

const initials = (a?: Addr) =>
  (a?.name || a?.email || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map(part => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const AVATAR =
  "grid place-items-center size-6 flex-none rounded-full bg-fill-2 text-secondary text-[9px] font-semibold";

/** A mail under Today: the earlier mails of its thread folded (a click opens one), the mail itself, Claude's quick
 *  replies, and the composer once Reply, Reply all or Forward is chosen. */
export function MailSection({ mailKey, id }: { mailKey: string; id: string }) {
  const { t } = useT();
  const thread = useDetailsStore(s => s.thread[mailKey]);
  const quick = useDetailsStore(s => s.quick[mailKey]);
  const compose = useDetailsStore(s => (s.compose?.key === mailKey ? s.compose : null));
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    loadThread(mailKey);
    loadQuickReplies(mailKey);
  }, [mailKey]);
  const earlier = (thread ?? []).filter(mail => mail.id !== id);

  return (
    <div className="flex flex-col gap-3 max-w-170">
      {earlier.map(mail => {
        const on = !!open[mail.id];
        return (
          <button
            key={mail.id}
            onClick={() => setOpen({ ...open, [mail.id]: !on })}
            className="flex flex-col gap-1.5 px-3.5 py-2.5 rounded-[10px] border border-separator text-left cursor-pointer hover:bg-fill"
          >
            <span className="flex items-center gap-2 min-w-0 text-[13px]">
              <span className={AVATAR}>{initials(mail.from[0])}</span>
              <b className="font-semibold whitespace-nowrap">{mail.from[0]?.name || mail.from[0]?.email}</b>
              <span className="flex-1 min-w-0 truncate text-secondary">
                {on ? "" : mail.untrusted_mail.slice(0, 140)}
              </span>
              <span className="text-xs text-tertiary whitespace-nowrap">{mail.date}</span>
            </span>
            {on ? <span className="text-sm whitespace-pre-wrap select-text">{mail.untrusted_mail}</span> : null}
          </button>
        );
      })}
      <MailDetail mailKey={mailKey} bare className="select-text cursor-auto" />
      {!compose && quick?.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-secondary mr-1">{t("today.quickReplies")}</span>
          {quick.map(intent => (
            <button
              key={intent}
              onClick={() => openCompose(mailKey, "reply", intent)}
              className="h-7 px-2.5 rounded-lg border border-separator-strong text-xs cursor-pointer hover:bg-fill"
            >
              {intent}
            </button>
          ))}
        </div>
      ) : null}
      {compose ? <Composer /> : null}
    </div>
  );
}

function Recipients({ field }: { field: "to" | "cc" }) {
  const { t } = useT();
  const list = useDetailsStore(s => s.compose?.[field] ?? []);
  const [typed, setTyped] = useState("");
  return (
    <span className="flex flex-wrap items-center gap-1 min-w-0">
      <span className="text-xs text-tertiary w-6">{field === "to" ? t("today.to") : t("today.cc")}</span>
      {list.map(a => (
        <span
          key={a.email}
          className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-md bg-fill-2 text-xs"
          title={a.email}
        >
          {a.name || a.email}
          <button
            className="cursor-pointer text-tertiary hover:text-label"
            aria-label={t("today.remove")}
            onClick={() => removeRecipient(field, a.email)}
          >
            <Icon name="close" className="glyph size-3" />
          </button>
        </span>
      ))}
      <input
        value={typed}
        onChange={e => setTyped(e.target.value)}
        onKeyDown={e => {
          if ((e.key === "Enter" || e.key === "," || e.key === "Tab") && typed && addRecipient(field, typed)) {
            e.preventDefault();
            setTyped("");
          }
        }}
        onBlur={() => typed && addRecipient(field, typed) && setTyped("")}
        placeholder={list.length ? "" : t("today.addRecipient")}
        className="min-w-24 flex-1 h-6 bg-transparent outline-0 text-xs"
      />
    </span>
  );
}

const MODES = [
  ["reply", "today.reply"],
  ["all", "today.replyAll"],
  ["fwd", "today.forward"],
] as const;
const TWEAKS = [
  ["shorter", "today.shorter"],
  ["formal", "today.formal"],
  ["dutch", "today.inDutch"],
  ["english", "today.inEnglish"],
] as const;
/** The reply as Claude drafted it, to edit: who it goes to, the text, rewrites, and Save to Drafts (⌘↵). Relay
 *  never sends it. */
function Composer() {
  const { t } = useT();
  const compose = useDetailsStore(s => s.compose)!;
  const experimental = mailExperimental();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col rounded-xl border border-accent ring-3 ring-accent-soft bg-raised">
        <div className="flex flex-col gap-1.5 px-3 pt-2.5 pb-2 border-b border-separator">
          <div className="flex items-center gap-2">
            <div className="inline-flex bg-fill-2 rounded-lg p-0.5">
              {MODES.map(([how, label]) => (
                <button
                  key={how}
                  onClick={() => setComposeHow(how)}
                  className={`h-6 px-2.5 rounded-md text-xs font-medium cursor-pointer ${compose.how === how ? "bg-raised shadow-sm text-label" : "text-secondary hover:text-label"}`}
                >
                  {t(label)}
                </button>
              ))}
            </div>
            <span className="flex-1" />
            <button
              className="btn-icon cursor-pointer"
              title={t("today.discard")}
              aria-label={t("today.discard")}
              onClick={closeCompose}
            >
              <Icon name="close" className="glyph size-3.5" />
            </button>
          </div>
          <Recipients field="to" />
          {compose.how === "all" || compose.cc.length ? <Recipients field="cc" /> : null}
        </div>
        <textarea
          value={compose.text}
          onChange={e => setComposeText(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              saveCompose();
            }
            if (e.key === "Escape") e.currentTarget.blur();
          }}
          rows={7}
          placeholder={compose.busy === "draft" ? t("today.drafting") : t("today.writeReply")}
          disabled={compose.busy === "draft" || compose.busy === "save"}
          className="w-full px-3.5 py-3 bg-transparent outline-0 resize-y text-sm leading-relaxed select-text"
        />
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-t border-separator">
          <span className="text-[11px] font-semibold text-accent-text mr-1">{t("today.draftedByClaude")}</span>
          {TWEAKS.map(([id, label]) => (
            <button
              key={id}
              disabled={!!compose.busy || !compose.text.trim()}
              onClick={() => tweakCompose(id)}
              className={`h-6.5 px-2 rounded-md border text-xs cursor-pointer disabled:opacity-45 ${compose.busy === "tweak" && compose.tweak === id ? "border-accent bg-accent-soft text-accent-text" : "border-separator-strong hover:bg-fill"}`}
            >
              {t(label)}
            </button>
          ))}
          <span className="flex-1" />
          <label className="inline-flex items-center gap-1.5 text-xs text-secondary cursor-pointer">
            <input type="checkbox" checked={compose.archive} onChange={toggleArchiveAfter} />
            {experimental ? t("today.archiveAfter") : t("today.readAfter")}
          </label>
          <button
            disabled={!!compose.busy || !compose.text.trim()}
            onClick={saveCompose}
            className="btn btn-primary inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {compose.busy === "save" ? t("today.saving") : t("today.saveDraft")}
            <span className="font-mono text-[11px] opacity-75">⌘↵</span>
          </button>
        </div>
      </div>
      {compose.err ? <div className="err-box">{compose.err}</div> : null}
      <div className="text-[11px] text-tertiary">{t("today.noSend")}</div>
    </div>
  );
}
