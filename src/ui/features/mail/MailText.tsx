import { mailParts, prose, type MailPart } from "../../../domain/mail/text";
import { mailLinkClicked } from "../../../application/mail/mail";
import { useT } from "../../hooks/useT";

// no whitespace inside: the text is pre-wrap. Inside a quote the gap above is smaller
function block(text: string, quoted: boolean, key: number) {
  return (
    <div key={key} className={`whitespace-pre-wrap wrap-anywhere text-sm leading-normal ${quoted ? "mt-1.5" : "mt-3"}`}>
      {prose(text).map((piece, i) =>
        piece.kind === "link" ? (
          <a
            key={i}
            className="text-accent no-underline"
            href={piece.text}
            // untrusted text: the link waits for the go in the confirmation bar, as the html view's do
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
      )}
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
