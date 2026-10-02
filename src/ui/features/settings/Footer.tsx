import type { ReactNode } from "react";
import type { Message } from "../../../domain/settings/types";
import { ERROR_MESSAGE, OK_MESSAGE } from "./blocks";

/** A save result on the left, the buttons on the right; it goes inside a footer row (FOOTER or FOOTER_IN_ROW).
 *  `explain` turns an error's text into what to do about it. */
export function Footer({
  message,
  explain,
  children,
}: {
  message: Message | null | undefined;
  explain?: (error: string) => ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      {message && (
        <span className={message.ok ? OK_MESSAGE : ERROR_MESSAGE}>
          {message.ok || !explain ? message.text : explain(message.text)}
        </span>
      )}
      <span className="flex-1"></span>
      {children}
    </>
  );
}
