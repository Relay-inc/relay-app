import { mailParts, prose, type MailPart } from "../../../domain/mail/text";
import { mailLinkClicked, mailLinkGo } from "../../../application/mail/mail";
import { useMailStore } from "../../../application/mail/store";
import { useT } from "../../hooks/useT";

/** Untrusted mail text with its links clickable: a click waits for the go in the confirmation bar (MailLinkBar), as
 *  the html view's links do. */
export function Linked({ text }: { text: string }) {
  return prose(text).map((piece, i) =>
    piece.kind === "link" ? (
      <a
        key={i}
        className="text-accent no-underline wrap-anywhere"
        href={piece.text}
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          mailLinkClicked(piece.text);
        }}
      >
        {piece.text}
      </a>
    ) : piece.kind === "image" ? (
      <span key={i} className="text-secondary text-xs">
        [{piece.text}]
      </span>
    ) : (
      piece.text
    ),
  );
}

/** A link clicked in a mail, waiting for the user's go before it opens. */
export function MailLinkBar() {
  const { t } = useT();
  const link = useMailStore(s => s.link);
  if (!link) return null;
  return (
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
  );
}

// no whitespace inside: the text is pre-wrap. Inside a quote the gap above is smaller
function block(text: string, quoted: boolean, key: number) {
  return (
    <div key={key} className={`whitespace-pre-wrap wrap-anywhere text-sm leading-normal ${quoted ? "mt-1.5" : "mt-3"}`}>
      <Linked text={text} />
    </div>
  );
}

/** The text of a plain-text mail (`text`), or one level of it (`parts`): the new part, then each earlier mail as a fold
 *  whose label is its "On … wrote:" line. */
export function MailText({ text, parts = mailParts(text ?? "") }: { text?: string; parts?: MailPart[] }) {
  const { t } = useT();
  return (
    <div>
      {parts.map((part, i) =>
        part.kind === "block" ? (
          block(part.text, part.quoted, i)
        ) : (
          <details key={i} className="mt-3.5" open={part.open}>
            <summary className="text-xs text-secondary cursor-default py-1 list-outside ml-3.5 hover:text-label">
              {part.label ?? t("mail.earlier")}
            </summary>
            <blockquote className="mt-1.5 pl-3 border-l-2 border-separator text-secondary">
              <MailText parts={part.quote} />
            </blockquote>
          </details>
        ),
      )}
    </div>
  );
}
