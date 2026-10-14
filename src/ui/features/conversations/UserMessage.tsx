import { Fragment } from "react";
import { ImageThumbs } from "../../components/ImageThumbs";
import { FileChips } from "../../components/FileChips";
import { useT } from "../../hooks/useT";
import { sentAt } from "../../../shared/format";

/** What the user sent: its images and files over a bubble with the text, and when it was sent under it. All sit in the
 *  conversation's column. */
export function UserMessage({
  text,
  imgs,
  files,
  at,
}: {
  text: string;
  imgs?: string[];
  files?: string[];
  at?: number;
}) {
  const { locale } = useT();
  return (
    <>
      {imgs?.length ? <ImageThumbs className="self-end max-w-[78%] -mb-2.5" size="message" urls={imgs} /> : null}
      {files?.length ? <FileChips className="self-end max-w-[78%] -mb-2.5" end paths={files} /> : null}
      {text ? (
        <div className="self-end max-w-[78%] bg-fill-2 rounded-[14px_14px_4px_14px] px-3.5 py-2.25 text-[15px] leading-normal wrap-anywhere">
          {text.split("\n").map((line, i) => (
            <Fragment key={i}>
              {i ? <br /> : null}
              {line}
            </Fragment>
          ))}
        </div>
      ) : null}
      {at ? <div className="self-end -mt-3.5 text-[11px] text-tertiary tabular-nums">{sentAt(at, locale)}</div> : null}
    </>
  );
}
