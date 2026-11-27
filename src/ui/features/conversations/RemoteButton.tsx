import { useRef, useState } from "react";
import type { Key } from "../../../shared/i18n";
import { copyText } from "../../components/copy";
import { Icon } from "../../components/Icon";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../hooks/useT";
import { openExternal } from "../../../application/navigation/navigation";
import { PopHeading } from "../board/PopHeading";
import { POPOVER, POP_ROW } from "../board/toolbar";

/** Remote Control is on for the open conversation: a phone in its title bar, a popover with the session's link
 *  (open it on claude.ai, copy it to send to the phone) and the switch to turn it off. */
export function RemoteButton({ remote, onStop }: { remote: { url: string; state: string }; onStop: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useDismiss(root, open, () => setOpen(false));
  const state = t(
    `remote.state.${remote.state === "failed" ? "failed" : remote.state === "connected" ? "connected" : "ready"}` as Key,
  );
  return (
    <span ref={root} className="relative flex">
      <button
        className={`btn-icon relative ${open ? "bg-accent-soft" : ""} text-accent-text`}
        title={`${t("remote.title")} · ${state}`}
        aria-label={t("remote.title")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="phone" className="glyph size-4" />
        <span
          className={`absolute right-1 bottom-1 size-1.5 rounded-full bg-current ${remote.state === "failed" ? "text-late" : remote.state === "connected" ? "text-ok" : "text-soon"}`}
        ></span>
      </button>
      {open && (
        <div className={`absolute top-full right-0 mt-2 z-30 w-72 p-1 rounded-[10px] ${POPOVER}`} role="menu">
          <PopHeading>{`${t("remote.title")} · ${state}`}</PopHeading>
          <div className="px-2 pb-1.5 text-xs text-secondary">{t("remote.hint")}</div>
          <button
            type="button"
            role="menuitem"
            className={`w-full text-left ${POP_ROW}`}
            onClick={() => {
              setOpen(false);
              openExternal(remote.url);
            }}
          >
            <Icon name="globe" className="glyph size-3.75 flex-none text-secondary" />
            {t("remote.open")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={`w-full text-left ${POP_ROW}`}
            onClick={() => copyText(remote.url)}
          >
            <Icon name="copy" className="glyph size-3.75 flex-none text-secondary" />
            {t("remote.copy")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={`w-full text-left ${POP_ROW}`}
            onClick={() => {
              setOpen(false);
              onStop();
            }}
          >
            <Icon name="close" className="glyph size-3.75 flex-none text-secondary" />
            {t("remote.stop")}
          </button>
        </div>
      )}
    </span>
  );
}
