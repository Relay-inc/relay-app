import type { ReactNode } from "react";
import type { Mail, MailBody } from "../../../domain/mail/types";
import { useMailStore } from "../../../application/mail/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { closeDetail } from "../../../application/navigation/panel";
import { mailKey } from "../../../domain/navigation/keys";
import { unread } from "../../../domain/mail/rules";
import { mailChat, mailLinkGo, mailSeen, toggleMailText } from "../../../application/mail/mail";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Note } from "../../components/Note";
import { MailText } from "./MailText";

const KILOBYTE = 1024;
const MEGABYTE = 1024 * 1024;
const formatSize = (bytes: number) => {
  if (bytes < KILOBYTE) return `${bytes} B`;
  if (bytes < MEGABYTE) return `${Math.round(bytes / KILOBYTE)} kB`;
  return `${(bytes / MEGABYTE).toFixed(1)} MB`;
};
// widths in percent of the grey lines shown while the body loads, 0 is a gap between paragraphs
const SKELETON_WIDTHS = [92, 100, 84, 96, 60, 0, 88, 72];
// 16px line icons in the app's glyph style, every icon button carries its label as tooltip and for VoiceOver
const iconButton = (name: string, label: string, onClick: () => void, classes = "btn btn-icon", tooltip = label) => (
  <button className={`${classes} whitespace-nowrap flex-none`} title={tooltip} aria-label={label} onClick={onClick}>
    <Icon name={name} />
  </button>
);
const secondary = (content: ReactNode) => <span className="text-secondary tabular-nums">{content}</span>;
const formatAddresses = (addresses: Mail["from"]) =>
  addresses.map((address, i) => (
    <span key={i}>
      {i ? ", " : null}
      {address.name ? (
        <>
          {address.name} {secondary(address.email)}
        </>
      ) : (
        address.email
      )}
    </span>
  ));

/** One mail in the right panel: who, when, the mail, and the ways into a conversation. Headers show at once, the body
 *  loads. Opening never marks it read, only the read button does. HTML goes in a frame sandboxed without any allowance
 *  (no scripts, no same origin; the backend sanitized it and set a CSP), "textView" shows what Claude reads instead. */
export function MailDetail({ panelKey }: { panelKey: string }) {
  const { t, locale } = useT();
  const item = useMailStore(s => s.list?.find(candidate => mailKey(candidate) === panelKey));
  const textView = useMailStore(s => s.textView.has(panelKey));
  const link = useMailStore(s => s.link);
  const body = useNavigationStore(s => s.panel.detail[panelKey]) as MailBody | undefined;
  const err = useNavigationStore(s => s.panel.err);

  // two groups: reading this mail on the left, the ways into a conversation on the right. A narrow panel wraps a whole group
  const isUnread = item ? unread(item) : false;
  const bar = (
    <div className="flex items-center flex-wrap gap-2 mb-3">
      <span className="flex items-center gap-2">
        {iconButton("close", t("pr.close"), closeDetail)}
        {item
          ? iconButton(isUnread ? "read" : "unread", isUnread ? t("mail.markRead") : t("mail.markUnread"), () =>
              mailSeen(panelKey, isUnread),
            )
          : null}
        {body?.html
          ? textView
            ? iconButton("html", t("mail.showMail"), toggleMailText)
            : iconButton("text", t("mail.showText"), toggleMailText)
          : null}
      </span>
      {item ? (
        <span className="flex items-center gap-2 ml-auto">
          {iconButton(
            "reply",
            t("mail.draft"),
            () => mailChat(panelKey, "draft"),
            "btn btn-icon",
            `${t("mail.draft")}: ${t("mail.draftTitle")}`,
          )}
          {iconButton(
            "talk",
            t("mail.talk"),
            () => mailChat(panelKey, "talk"),
            "btn btn-icon btn-primary",
            `${t("mail.talk")}: ${t("mail.talkTitle")}`,
          )}
        </span>
      ) : null}
    </div>
  );
  if (!item)
    return (
      <div>
        {bar}
        <Note>{t("mail.gone")}</Note>
      </div>
    );

  const sent = new Date(item.date).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  let content: ReactNode;
  if (err) content = <div className="err-box">{err}</div>;
  else if (body === undefined)
    // headers at once, a spinner and grey lines while the text loads
    content = (
      <>
        <div className="flex items-center gap-2 mt-3.5 text-sm text-secondary">
          <span className="spinner"></span>
          {t("mail.loadingBody")}
        </div>
        <div className="mt-3">
          {SKELETON_WIDTHS.map((width, i) => (
            <i
              key={i}
              className={`block mb-2 rounded-sm ${width ? "h-2.5 bg-fill animate-skel" : "h-1.5"}`}
              style={{ width: `${width}%` }}
            ></i>
          ))}
        </div>
      </>
    );
  else
    content = (
      <>
        {body.attachments.length ? (
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 mt-2.5 text-xs">
            {body.attachments.map(attachment => (
              <span key={attachment.index} className="text-secondary tabular-nums">
                {`${attachment.name} (${formatSize(attachment.size)})`}
              </span>
            ))}
          </div>
        ) : null}
        {body.html && !textView ? (
          // the empty sandbox comes before srcdoc, and the frame is not in the document yet when React sets them.
          // White because mails are designed for white; a mail wider than the panel scrolls inside the frame
          <iframe
            sandbox=""
            referrerPolicy="no-referrer"
            title={item.subject || t("mail.noSubject")}
            srcDoc={body.html}
            className="block w-full h-140 mt-3 border border-separator rounded-lg bg-white"
          ></iframe>
        ) : (
          <MailText text={body.text} />
        )}
      </>
    );
  return (
    <div>
      {bar}
      {link ? (
        // confirm before a link in a mail opens
        <div className="my-2 px-2.5 py-2 border border-separator rounded-lg bg-fill">
          <div className="text-xs break-all select-text">{link}</div>
          <div className="flex gap-2 mt-2">
            <button className="btn btn-primary" onClick={() => mailLinkGo(true)}>
              {t("mail.linkOpen")}
            </button>
            <button className="btn" onClick={() => mailLinkGo(false)}>
              {t("mail.linkCancel")}
            </button>
          </div>
        </div>
      ) : null}
      <h2 className="text-sm font-semibold mb-2 leading-snug">{item.subject || t("mail.noSubject")}</h2>
      <div className="text-sm leading-normal pb-2.5 border-b border-separator">
        <div>{formatAddresses(item.from)}</div>
        <div className="text-secondary tabular-nums">
          {t("mail.to")} {formatAddresses(item.to)}
        </div>
        <div className="text-secondary tabular-nums">{sent}</div>
      </div>
      {content}
    </div>
  );
}
