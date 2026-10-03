import { Fragment } from "react";
import { tokenize } from "../../shared/highlight";

/** `code` in the syntax colours of `lang` (shared/highlight.ts), as text in spans: for a `<pre>` or `<code>`. */
export function Highlighted({ code, lang }: { code: string; lang: string }) {
  return (
    <>
      {tokenize(code, lang).map(([kind, text], i) =>
        kind ? (
          <span key={i} className={`tok-${kind}`}>
            {text}
          </span>
        ) : (
          <Fragment key={i}>{text}</Fragment>
        ),
      )}
    </>
  );
}
