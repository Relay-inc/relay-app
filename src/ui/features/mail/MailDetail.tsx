import type { ReactNode } from "react";
import type { Mail, MailBody } from "../../../domain/mail/types";
import { useMailStore } from "../../../application/mail/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { mailKey } from "../../../domain/navigation/keys";
import { unread } from "../../../domain/mail/rules";
import { mailChat, mailMove, openAttachment, mailSeen, toggleMailText } from "../../../application/mail/mail";
import { useBoardStore } from "../../../application/board/store";
import { useSettingsStore } from "../../../application/settings/store";
import { mailExperimental } from "../../../domain/settings/types";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Note } from "../../components/Note";
import { MailLinkBar, MailText } from "./MailText";
import { MailFrame } from "./MailFrame";

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

/** One mail next to the Mail list: who, when, the mail, and the ways into a conversation. Headers show at once, the body
 *  loads. Opening never marks it read, only the read button does. HTML goes in a frame sandboxed without any allowance
 *  (no scripts, no same origin; the backend sanitized it and set a CSP), "textView" shows what Claude reads instead. */
export function MailDetail({
  mailKey: key,
  className,
  readOnReply = false,
  bare = false,
}: {
  mailKey: string;
  className?: string;
  readOnReply?: boolean; // a reply marks the mail read
  bare?: boolean; // Today: its own actions and title above, here only who, when and the mail
}) {
  const { t, locale } = useT();
  const item = useMailStore(s => s.list?.find(candidate => mailKey(candidate) === key));
  const textView = useMailStore(s => s.textView.has(key));
  const body = useNavigationStore(s => s.panel.detail[key]) as MailBody | undefined;
  const err = useNavigationStore(s => s.panel.err);
  const experimental = useSettingsStore(s => mailExperimental(s.settings));
  const hasBoard = useBoardStore(s => s.ready.length > 0);

  const reply = async (how: "draft" | "draftAll") => {
    if (readOnReply && item && unread(item)) await mailSeen(key, true);
    await mailChat(key, how);
  };
  // two groups: reading this mail on the left, the ways into a conversation on the right
  const isUnread = item ? unread(item) : false;
  const bar = (
    <div className="flex items-center flex-wrap gap-2 mb-3">
      <span className="flex items-center gap-2">
        {item ? (
          <>
            {/* experimental: archive and delete, the next mail opens in its place */}
            {experimental ? (
              <>
                {iconButton(
                  "archive",
                  t("mail.archive"),
                  () => mailMove([key], false),
                  "btn btn-icon",
                  `${t("mail.archive")} (E)`,
                )}
                {iconButton(
                  "trash",
                  t("mail.trash"),
                  () => mailMove([key], true),
                  "btn btn-icon",
                  `${t("mail.trash")} (#)`,
                )}
              </>
            ) : null}
            {iconButton(isUnread ? "read" : "unread", isUnread ? t("mail.markRead") : t("mail.markUnread"), () =>
              mailSeen(key, isUnread),
            )}
          </>
        ) : null}
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
            () => reply("draft"),
            "btn btn-icon",
            `${t("mail.draft")}: ${t("mail.draftTitle")}`,
          )}
          {iconButton(
            "replyAll",
            t("mail.draftAll"),
            () => reply("draftAll"),
            "btn btn-icon",
            `${t("mail.draftAll")}: ${t("mail.draftTitle")}`,
          )}
          {hasBoard
            ? iconButton(
                "notes",
                t("mail.ticket"),
                () => mailChat(key, "ticket"),
                "btn btn-icon",
                `${t("mail.ticket")}: ${t("mail.ticketTitle")}`,
              )
            : null}
          {iconButton(
            "talk",
            t("mail.talk"),
            () => mailChat(key, "talk"),
            "btn btn-icon btn-primary",
            `${t("mail.talk")}: ${t("mail.talkTitle")}`,
          )}
        </span>
      ) : null}
    </div>
  );
  if (!item)
    return (
      <div className={className}>
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
              <button
                key={attachment.index}
                title={t("mail.openAttachment")}
                onClick={() => openAttachment(key, attachment.index)}
                className="text-accent tabular-nums cursor-pointer hover:underline"
              >
                {`${attachment.name} (${formatSize(attachment.size)})`}
              </button>
            ))}
          </div>
        ) : null}
        {body.html && !textView ? (
          // white because mails are designed for white; as tall as the mail, a wider one scrolls sideways inside it
          <div className="mt-3">
            <MailFrame html={body.html} title={item.subject || t("mail.noSubject")} className="rounded-lg" />
          </div>
        ) : (
          <MailText text={body.text} />
        )}
      </>
    );
  return (
    <div className={className}>
      {bare ? null : bar}
      <MailLinkBar />
      {bare ? null : (
        <h2 className="text-xl font-semibold tracking-tight mb-2.5 leading-snug text-pretty">
          {item.subject || t("mail.noSubject")}
        </h2>
      )}
      <div className="text-[13px] leading-normal pb-3 border-b border-separator">
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
