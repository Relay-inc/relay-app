import { useState } from "react";
import type { Meeting } from "../../../domain/calendar/types";
import {
  addCc,
  discardFollowup,
  editFollowup,
  removeAddr,
  saveFollowup,
  startFollowup,
  type Followup,
} from "../../../application/calendar/followup";
import { initials } from "../today/parts";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { OUTLINE, PRIMARY } from "./buttons";

const LABEL = "w-13 flex-none text-secondary";
function Chip({ addr, onRemove }: { addr: { name: string | null; email: string }; onRemove: () => void }) {
  const { t } = useT();
  const name = addr.name || addr.email;
  return (
    <span
      title={addr.email}
      className="inline-flex items-center gap-1.5 h-6 pl-0.75 pr-1.5 rounded-full bg-fill-2 text-xs text-label"
    >
      <span className="grid place-items-center size-4.5 rounded-full bg-fill-2 text-secondary text-[9px] font-semibold">
        {initials(name)}
      </span>
      {name}
      <button
        aria-label={t("meet.mail.remove", { name })}
        className="grid place-items-center size-4 rounded-full text-secondary cursor-pointer hover:bg-fill-2 hover:text-label"
        onClick={onRemove}
      >
        <Icon name="close" className="glyph size-2.5" />
      </button>
    </span>
  );
}

/** The follow-up mail as a composer in place of the steps (the design's m4): to everyone invited (each removable), an
 *  optional Cc, the subject and the text, then Save as draft or Discard. Relay never sends. */
export function FollowupComposer({ meeting, mail }: { meeting: Meeting; mail: Followup }) {
  const { t } = useT();
  const [typed, setTyped] = useState("");
  const [bad, setBad] = useState(false);
  const id = meeting.id;
  const ready = mail.phase === "ready" || mail.phase === "saving";
  return (
    <section
      aria-label={t("meet.mail.title")}
      className="min-w-0 min-h-0 overflow-y-auto border-l border-separator px-6 pt-5 pb-8"
    >
      <div className="flex items-center">
        <h2 className="flex-1 m-0 text-[15px] font-semibold">{t("meet.mail.title")}</h2>
        <span className="text-xs text-secondary">{t("meet.wrap.draft")}</span>
      </div>
      {mail.phase === "generating" ? (
        <div
          role="status"
          aria-label={t("meet.mail.writing")}
          className="mt-2.5 rounded-xl border border-separator-strong bg-raised p-3.5 flex flex-col gap-2.5 animate-skel"
        >
          {[40, 60, 100, 94, 0, 70, 88, 52].map((w, i) =>
            w ? (
              <span key={i} className="h-3 rounded-sm bg-fill-2" style={{ width: `${w}%` }} />
            ) : (
              <span key={i} className="h-1.5" />
            ),
          )}
          <span className="text-xs text-secondary">{t("meet.mail.writing")}</span>
        </div>
      ) : mail.phase === "error" ? (
        <div className="mt-2.5 flex flex-col items-start gap-3 rounded-xl border border-dashed border-separator-strong bg-sidebar p-4">
          <span className="text-sm font-semibold">{t("meet.mail.failed")}</span>
          <span className="text-[13px] text-secondary wrap-anywhere">{mail.error}</span>
          <div className="flex gap-2">
            <button className={PRIMARY} onClick={() => void startFollowup(meeting)}>
              {t("rec.retry")}
            </button>
            <button className={OUTLINE} onClick={() => discardFollowup(id)}>
              {t("meet.mail.discard")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-2.5 flex flex-col overflow-hidden rounded-xl border border-separator-strong bg-raised">
            <div className="flex items-center flex-wrap gap-2 min-h-9.5 px-3 py-1 border-b border-separator">
              <span className={LABEL}>{t("meet.mail.to")}</span>
              {mail.to.map((addr, i) => (
                <Chip key={addr.email} addr={addr} onRemove={() => removeAddr(id, "to", i)} />
              ))}
              <span className="flex-1" />
              <button
                className="text-xs text-secondary cursor-pointer hover:text-label"
                aria-pressed={mail.ccOn}
                onClick={() => editFollowup(id, { ccOn: !mail.ccOn })}
              >
                {t("meet.mail.cc")}
              </button>
            </div>
            {mail.ccOn ? (
              <div className="flex items-center flex-wrap gap-2 min-h-9.5 px-3 py-1 border-b border-separator">
                <span className={LABEL}>{t("meet.mail.cc")}</span>
                {mail.cc.map((addr, i) => (
                  <Chip key={addr.email} addr={addr} onRemove={() => removeAddr(id, "cc", i)} />
                ))}
                <input
                  value={typed}
                  aria-label={t("meet.mail.ccAdd")}
                  placeholder={t("meet.mail.ccAdd")}
                  onChange={e => {
                    setTyped(e.target.value);
                    setBad(false);
                  }}
                  onKeyDown={e => {
                    if (e.key !== "Enter" && e.key !== ",") return;
                    e.preventDefault();
                    if (!typed.trim()) return;
                    if (addCc(id, typed)) setTyped("");
                    else setBad(true);
                  }}
                  className={`flex-1 min-w-32 h-6 bg-transparent outline-0 text-[13px] ${bad ? "text-late" : ""}`}
                />
              </div>
            ) : null}
            <label className="flex items-center gap-2 h-9.5 px-3 border-b border-separator">
              <span className={LABEL}>{t("meet.mail.subject")}</span>
              <input
                value={mail.subject}
                disabled={!ready}
                onChange={e => editFollowup(id, { subject: e.target.value })}
                className="flex-1 min-w-0 bg-transparent outline-0 font-medium"
              />
            </label>
            <textarea
              value={mail.body}
              aria-label={t("meet.mail.body")}
              onChange={e => editFollowup(id, { body: e.target.value })}
              rows={Math.max(10, mail.body.split("\n").length + 3)}
              className="block w-full resize-y bg-transparent outline-0 px-3.5 py-3 text-[13.5px] leading-[1.55] whitespace-pre-wrap"
            />
          </div>
          {mail.error ? <p className="m-0 mt-2 text-xs text-late wrap-anywhere">{mail.error}</p> : null}
          <div className="flex gap-2 mt-3">
            <button className={PRIMARY} disabled={mail.phase === "saving"} onClick={() => void saveFollowup(meeting)}>
              {t("meet.mail.save")}
            </button>
            <button className={OUTLINE} disabled={mail.phase === "saving"} onClick={() => discardFollowup(id)}>
              {t("meet.mail.discard")}
            </button>
          </div>
          <p className="m-0 mt-2 text-xs text-secondary">{t("meet.mail.never")}</p>
        </>
      )}
    </section>
  );
}
