import { useRef, useState } from "react";
import { useT } from "../../hooks/useT";

// a remote image in the mail: blocked until the user loads them (privacy: they are tracking pixels as often as logos)
const REMOTE_IMAGE = /<img\b[^>]*\bsrc\s*=\s*["']?https?:/i;

/** A mail's HTML as the backend made it (sanitized, with its own CSP that allows only data: images; cid: images are
 *  already data: URIs), in a frame that runs nothing: no scripts, forms or popups. `allow-same-origin` (no scripts,
 *  so nothing in it can use it) lets the frame take the height of the mail instead of scrolling inside a box.
 *  Remote images load only after "Load images", for this mail (as Keel does). */
export function MailFrame({
  html,
  title,
  className = "",
  bleed = false,
}: {
  html: string;
  title: string;
  className?: string;
  bleed?: boolean; // the frame past the column's edges by the mail's own 12px padding, so its text lines up
}) {
  const { t } = useT();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(0);
  // the mail it was asked for, so another mail starts blocked again
  const [imagesFor, setImagesFor] = useState("");
  const images = imagesFor === html;
  const remote = REMOTE_IMAGE.test(html);
  // the one CSP of the document (the sanitizer drops any other), widened to https: images on the user's click
  const doc = images ? html.replace("img-src data:", "img-src data: https:") : html;
  const fit = () => {
    const root = frame.current?.contentDocument?.documentElement;
    if (root) setHeight(root.scrollHeight);
  };
  const loaded = () => {
    fit();
    const body = frame.current?.contentDocument?.body;
    if (!body) return;
    // images and fonts arrive after load
    new ResizeObserver(fit).observe(body);
    body.querySelectorAll("img").forEach(img => img.addEventListener("load", fit));
  };
  return (
    <div className="flex flex-col gap-2">
      {remote && !images ? (
        <div className="flex items-center gap-3 text-xs text-tertiary">
          {t("mail.imagesBlocked")}
          <button className="text-secondary cursor-pointer hover:text-label" onClick={() => setImagesFor(html)}>
            {t("mail.loadImages")}
          </button>
        </div>
      ) : null}
      {/* the empty-ish sandbox comes before srcdoc: the frame is not in the document yet when React sets them */}
      <iframe
        ref={frame}
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        title={title}
        srcDoc={doc}
        onLoad={loaded}
        style={{ height: height || 240 }}
        className={`block border-0 bg-white ${bleed ? "-mx-3 w-[calc(100%+1.5rem)]" : "w-full"} ${className}`}
      />
    </div>
  );
}
