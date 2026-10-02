import { Fragment } from "react";
import { ImageThumbs } from "../../components/ImageThumbs";

/** What the user sent: its images over a bubble with the text. Both sit in the conversation's column. */
export function UserMessage({ text, imgs }: { text: string; imgs: string[] | undefined }) {
  return (
    <>
      {imgs?.length ? <ImageThumbs className="self-end max-w-[78%] -mb-2.5" size="message" urls={imgs} /> : null}
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
    </>
  );
}
