import { useEffect, useState } from "react";
import type { Addr } from "../../../../domain/mail/reply";
import type { MailBody } from "../../../../domain/mail/types";
import { mailKey as keyOf } from "../../../../domain/navigation/keys";
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
import { useMailStore } from "../../../../application/mail/store";
import { Linked, MailLinkBar } from "../../mail/MailText";
import { openAttachment } from "../../../../application/mail/mail";
import { useNavigationStore } from "../../../../application/navigation/store";
import { mailExperimental } from "../../../../application/settings/settings";
import { agent } from "../../../../shared/plugins";
import { useT } from "../../../hooks/useT";
import { Glyph } from "../../../components/Glyph";
import { Icon } from "../../../components/Icon";

const initials = (a?: Addr | { name: string | null; email: string }) =>
  (a?.name || a?.email || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map(part => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
/** A mail's own text and the history it quotes, split where the quote starts (as Keel's quotes.ts does): an
 *  "On … wrote:" line, an original/forwarded-message rule, or the trailing run of "> " lines. */
export function splitQuoted(text: string) {
  const lines = text.split("\n");
  const at = lines.findIndex(
    (line, i) =>
      /^(On|Op|Le|Am) .{4,160}(wrote|schreef|a écrit|schrieb)\s*:\s*$/.test(line.trim()) ||
      /^-{2,}\s*(Original Message|Oorspronkelijk bericht|Forwarded message)/i.test(line.trim()) ||
      (line.startsWith(">") && lines.slice(i).every(rest => !rest.trim() || rest.startsWith(">"))),
  );
  return at < 0
    ? { own: text, quote: "" }
    : { own: lines.slice(0, at).join("\n").trimEnd(), quote: lines.slice(at).join("\n").trim() };
}
const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${Math.round(bytes / 1024)} kB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
const ClaudeGlyph = ({ className }: { className: string }) => {
  const svg = agent("claude")?.glyph;
  return svg ? <Glyph svg={svg} className={className} /> : null;
};

/** A mail under Today, as the design draws it: the earlier mails of its thread folded (a click opens one), the mail
 *  itself as a card (who, to whom, when, the text, the attachments; the original HTML one click away), and Claude's
 *  quick replies while no reply is being written. */
export function MailSection({ mailKey, id }: { mailKey: string; id: string }) {
  const { t, locale } = useT();
  const thread = useDetailsStore(s => s.thread[mailKey]);
  const quick = useDetailsStore(s => s.quick[mailKey]);
  const composing = useDetailsStore(s => s.compose?.key === mailKey);
  const mail = useMailStore(s => s.list?.find(x => keyOf(x) === mailKey));
  const body = useNavigationStore(s => s.panel.detail[mailKey]) as MailBody | undefined;
  const err = useNavigationStore(s => s.panel.err);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [html, setHtml] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  useEffect(() => {
    loadThread(mailKey);
    loadQuickReplies(mailKey);
  }, [mailKey]);
  const earlier = (thread ?? []).filter(m => m.id !== id);
  const from = mail?.from[0];
  const at = mail
    ? new Date(mail.date).toLocaleString(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" })
    : "";
  // what was written, and the quoted history below it folded (Keel's splitQuoted)
  const { own, quote } = splitQuoted(body?.text ?? "");
  const paragraphs = own
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);

  return (
    <div className="flex flex-col gap-3 max-w-170">
      {earlier.map(m => {
        const on = !!open[m.id];
        return (
          <div
            key={m.id}
            onClick={() => setOpen({ ...open, [m.id]: !on })}
            className="flex flex-col gap-1.5 px-3.5 py-2.5 rounded-[10px] border border-separator cursor-pointer hover:bg-fill"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="grid place-items-center size-6 flex-none rounded-full bg-fill-2 text-secondary text-[9px] font-semibold">
                {initials(m.from[0])}
              </span>
              <b className="text-[13px] font-semibold whitespace-nowrap">{m.from[0]?.name || m.from[0]?.email}</b>
              <span className="flex-1 min-w-0 truncate text-[13px] text-secondary">
                {on ? "" : m.untrusted_mail.replace(/\s+/g, " ").slice(0, 160)}
              </span>
              <span className="text-xs text-tertiary whitespace-nowrap">
                {new Date(m.date).toLocaleString(locale, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            {on ? (
              <div className="pl-8.5 text-sm leading-[1.55] whitespace-pre-wrap wrap-anywhere select-text">
                <Linked text={m.untrusted_mail} />
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="flex flex-col gap-3.5 px-4.5 py-4 rounded-xl border border-separator-strong bg-raised">
        <div className="flex items-center gap-3">
          <span className="grid place-items-center size-8.5 flex-none rounded-full bg-accent-soft text-accent-text text-xs font-semibold">
            {initials(from)}
          </span>
          <div className="flex-1 min-w-0 flex flex-col leading-[1.35]">
            <span className="text-sm truncate">
              <b className="font-semibold">{from?.name || from?.email}</b>{" "}
              {from?.name ? <span className="text-xs text-secondary">{from.email}</span> : null}
            </span>
            <span className="text-xs text-secondary truncate">
              {t("today.toLine", { who: (mail?.to ?? []).map(a => a.name || a.email).join(", ") })}
            </span>
          </div>
          <span className="text-xs text-tertiary whitespace-nowrap">{at}</span>
        </div>
        <MailLinkBar />
        {err && !body ? <div className="err-box">{err}</div> : null}
        {!body && !err ? <div className="text-sm text-secondary">{t("mail.loadingBody")}</div> : null}
        {body ? (
          html && body.html ? (
            // the backend sanitized it and set a CSP; the frame allows nothing (MailDetail does the same)
            <iframe
              sandbox=""
              referrerPolicy="no-referrer"
              title={mail?.subject || t("mail.noSubject")}
              srcDoc={body.html}
              className="block w-full h-120 border border-separator rounded-lg bg-white"
            />
          ) : (
            <div className="flex flex-col gap-2.5 text-sm leading-relaxed select-text">
              {paragraphs.map((p, i) => (
                <p key={i} className="m-0 whitespace-pre-wrap wrap-anywhere">
                  <Linked text={p} />
                </p>
              ))}
              {quote ? (
                showQuote ? (
                  <div className="pl-3 border-l-2 border-separator-strong text-[13px] text-secondary whitespace-pre-wrap wrap-anywhere">
                    <Linked text={quote} />
                  </div>
                ) : (
                  <button
                    className="self-start h-5 px-1.5 rounded bg-fill-2 text-secondary text-xs cursor-pointer hover:text-label"
                    title={t("today.showQuoted")}
                    aria-label={t("today.showQuoted")}
                    onClick={() => setShowQuote(true)}
                  >
                    •••
                  </button>
                )
              ) : null}
            </div>
          )
        ) : null}
        {body?.attachments.length || body?.html ? (
          <div className="flex flex-wrap items-center gap-2">
            {body.attachments.map(a => (
              <button
                key={a.index}
                title={t("mail.openAttachment")}
                onClick={() => openAttachment(mailKey, a.index)}
                className="inline-flex items-center gap-2 h-9 pl-2.5 pr-3 rounded-[9px] border border-separator-strong text-xs cursor-pointer hover:bg-fill"
              >
                <Icon name="file" className="glyph size-3.75 text-late" />
                <span className="font-medium">{a.name}</span>
                <span className="text-tertiary">{size(a.size)}</span>
              </button>
            ))}
            {body.html ? (
              <button
                className="ml-auto text-xs text-secondary cursor-pointer hover:text-label"
                onClick={() => setHtml(!html)}
              >
                {html ? t("mail.showText") : t("mail.showMail")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {!composing && quick?.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-secondary">
            <ClaudeGlyph className="glyph size-3 text-accent-text" />
            {t("today.quickReplies")}
          </span>
          {quick.map(intent => (
            <button
              key={intent}
              onClick={() => openCompose(mailKey, "reply", intent)}
              className="h-7.5 px-3 rounded-full border border-separator-strong bg-raised text-xs font-medium cursor-pointer hover:border-accent hover:text-accent-text"
            >
              {intent}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Recipients({ field }: { field: "to" | "cc" }) {
  const { t } = useT();
  const list = useDetailsStore(s => s.compose?.[field] ?? []);
  const [typed, setTyped] = useState("");
  const [adding, setAdding] = useState(false);
  return (
    <>
      <span className="text-xs text-secondary">{field === "to" ? t("today.to") : t("today.cc")}</span>
      {list.map(a => (
        <span
          key={a.email}
          title={a.email}
          className="group inline-flex items-center gap-1 h-6 px-2.25 rounded-full bg-fill-2 text-xs"
        >
          {a.name || a.email}
          <button
            className="hidden group-hover:inline cursor-pointer text-tertiary hover:text-label"
            aria-label={t("today.remove")}
            onClick={() => removeRecipient(field, a.email)}
          >
            <Icon name="close" className="glyph size-3" />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={typed}
          onChange={e => setTyped(e.target.value)}
          onKeyDown={e => {
            if ((e.key === "Enter" || e.key === "," || e.key === "Tab") && typed && addRecipient(field, typed)) {
              e.preventDefault();
              setTyped("");
            }
            if (e.key === "Escape") setAdding(false);
          }}
          onBlur={() => {
            if (typed) addRecipient(field, typed);
            setTyped("");
            setAdding(false);
          }}
          className="w-36 h-6 px-2 rounded-full bg-fill outline-0 text-xs"
        />
      ) : (
        <button
          className="grid place-items-center size-6 rounded-full text-tertiary cursor-pointer hover:bg-fill-2 hover:text-label"
          aria-label={t("today.addRecipient")}
          title={t("today.addRecipient")}
          onClick={() => setAdding(true)}
        >
          <Icon name="plus" className="glyph size-3" />
        </button>
      )}
    </>
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
/** The reply under a mail, docked at the bottom of the detail as in the design: Reply, Reply all or Forward, who it
 *  goes to, Claude's draft to edit, rewrites, Archive after, and Save to Drafts (⌘↵). Relay never sends it. */
export function MailComposer() {
  const { t } = useT();
  const compose = useDetailsStore(s => s.compose);
  if (!compose) return null;
  const experimental = mailExperimental();
  return (
    <div className="flex-none px-7 pb-4.5">
      <div className="flex flex-col rounded-[14px] border border-separator-strong bg-raised shadow-lg overflow-hidden">
        <div className="flex flex-wrap items-center gap-2.5 px-3 py-2.5 border-b border-separator">
          <div className="flex bg-fill-2 rounded-[7px] p-0.5">
            {MODES.map(([how, label]) => (
              <button
                key={how}
                onClick={() => setComposeHow(how)}
                className={`h-6 px-2.5 rounded-[5px] text-xs font-medium cursor-pointer ${compose.how === how ? "bg-raised shadow-sm text-label" : "text-secondary"}`}
              >
                {t(label)}
              </button>
            ))}
          </div>
          <Recipients field="to" />
          {compose.how === "all" || compose.cc.length ? <Recipients field="cc" /> : null}
          <span className="flex-1" />
          <button
            className="grid place-items-center size-6.5 rounded-md text-secondary cursor-pointer hover:bg-fill-2"
            title={t("today.discard")}
            aria-label={t("today.discard")}
            onClick={closeCompose}
          >
            <Icon name="close" className="glyph size-3.5" />
          </button>
        </div>
        <textarea
          autoFocus
          value={compose.text}
          onChange={e => setComposeText(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              saveCompose();
            }
            if (e.key === "Escape") e.currentTarget.blur();
          }}
          rows={5}
          placeholder={compose.busy === "draft" ? t("today.drafting") : t("today.writeReply")}
          disabled={compose.busy === "draft" || compose.busy === "save"}
          className="block w-full px-4 py-3 bg-transparent outline-0 resize-none text-sm leading-[1.55] whitespace-pre-wrap select-text"
        />
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-t border-separator">
          <span className="inline-flex items-center gap-1.25 mr-0.5 text-xs text-secondary">
            <ClaudeGlyph className="glyph size-3 text-accent-text" />
            {t("today.draftedByClaude")}
          </span>
          {TWEAKS.map(([id, label]) => {
            const on = compose.busy === "tweak" && compose.tweak === id;
            return (
              <button
                key={id}
                disabled={!!compose.busy || !compose.text.trim()}
                onClick={() => tweakCompose(id)}
                className={`h-6 px-2.25 rounded-full border text-[11px] font-medium cursor-pointer disabled:opacity-45 ${on ? "border-accent bg-accent-soft text-accent-text" : "border-separator-strong"}`}
              >
                {t(label)}
              </button>
            );
          })}
          <span className="flex-1" />
          <button
            onClick={toggleArchiveAfter}
            className="inline-flex items-center gap-1.5 h-7 px-2 rounded-[7px] text-xs text-secondary cursor-pointer"
          >
            <span
              className={`grid place-items-center size-3.5 rounded-sm border-[1.5px] text-white ${compose.archive ? "border-accent bg-accent" : "border-separator-strong"}`}
            >
              {compose.archive ? <Icon name="check" className="glyph size-2.5 stroke-[3]" /> : null}
            </span>
            {experimental ? t("today.archiveAfter") : t("today.readAfter")}
          </button>
          <button
            disabled={!!compose.busy || !compose.text.trim()}
            onClick={saveCompose}
            className="inline-flex items-center gap-2 h-7.5 px-3 rounded-lg bg-accent text-on-accent text-[13px] font-medium cursor-pointer hover:bg-accent-hover disabled:opacity-50"
          >
            {compose.busy === "save" ? t("today.saving") : t("today.saveDraft")}
            <span className="font-mono text-[11px] opacity-75">⌘↵</span>
          </button>
        </div>
      </div>
      {compose.err ? <div className="err-box mt-1.5">{compose.err}</div> : null}
      <div className="px-1 pt-1.5 text-[11px] text-tertiary">{t("today.noSend")}</div>
    </div>
  );
}
