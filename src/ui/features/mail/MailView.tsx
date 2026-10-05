import { useMailStore } from "../../../application/mail/store";
import { useSettingsStore } from "../../../application/settings/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { openMail } from "../../../application/navigation/panel";
import { mailKey } from "../../../domain/navigation/keys";
import { sender, unread } from "../../../domain/mail/rules";
import {
  inbox,
  mailSeen,
  moreMails,
  openMailSetup,
  setMailFilter,
  mailMove,
  setMailPane,
  toggleMailSelect,
} from "../../../application/mail/mail";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { MailBar } from "./MailBar";
import { MailBoxes } from "./MailBoxes";
import { MailBulkBar } from "./MailBulkBar";
import { MailDetail } from "./MailDetail";
import { MailRow } from "./MailRow";
import { MailSetup } from "./MailSetup";

/** The inbox, as Mail does it: on the left search, read state and project on top and the mails that pass the filters
 *  under one heading with the unread count; on the right the mail you picked. */
export function MailView({ className = "" }: { className?: string }) {
  const { t } = useT();
  const hasAccount = useSettingsStore(s => !!s.settings.mail.accounts?.length);
  const loaded = useMailStore(s => !!s.list);
  const err = useMailStore(s => s.err);
  const busy = useMailStore(s => s.busy);
  const more = useMailStore(s => s.more);
  const filter = useMailStore(s => s.filter);
  const open = useNavigationStore(s => s.panel.mailOpen);
  const selected = useMailStore(s => s.selected);
  const { shown, split, boxUnread, total, unread: unreadCount, ended, projects } = useDerived(inbox);
  const root = `${className} grid grid-cols-[380px_minmax(0,1fr)] min-h-0`;

  if (!hasAccount)
    return (
      <div className={root}>
        <div className="col-span-2 max-w-170 w-full mx-auto px-8 pt-7">
          <MailSetup onSetup={openMailSetup} />
        </div>
      </div>
    );

  const notLoaded = busy ? null : <div className="text-secondary text-sm text-center">{t("pr.notLoaded")}</div>;
  return (
    <div className={root}>
      <div
        className="min-h-0 overflow-y-auto border-r border-separator px-2 pt-3 pb-4"
        onPointerDown={() => setMailPane(true)}
      >
        <MailBar className="block px-2" filter={filter} projects={projects} onFilter={setMailFilter} />
        {err ? <div className="err-box">{err}</div> : null}
        {loaded ? (
          <section>
            {/* with the experimental split: Inbox and Other as tabs, or what to do with the ticked mails */}
            {!split ? (
              <h2 className="flex items-baseline gap-1.5 px-2 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-tertiary">
                {t("mail.inbox")}
                {unreadCount ? <span className="tabular-nums">{t("mail.unread", { n: unreadCount })}</span> : null}
              </h2>
            ) : selected.size ? (
              <MailBulkBar count={selected.size} />
            ) : (
              <MailBoxes box={filter.box} unread={boxUnread} onBox={box => setMailFilter({ box })} />
            )}
            <div className="flex flex-col gap-0.5">
              {shown.length ? (
                shown.map(({ mail, project, account }) => {
                  const key = mailKey(mail);
                  return (
                    <MailRow
                      key={key}
                      mail={mail}
                      sender={sender(mail)}
                      project={project}
                      account={account}
                      selected={open === key}
                      selectable={split}
                      checked={selected.has(key)}
                      onOpen={() => openMail(key)}
                      onFlip={() => mailSeen(key, unread(mail))}
                      onSelect={range => toggleMailSelect(key, range)}
                      onArchive={() => mailMove([key], false)}
                      onTrash={() => mailMove([key], true)}
                    />
                  );
                })
              ) : (
                <div className="text-secondary text-sm px-2.5 py-2">{total ? t("mail.noMatch") : t("mail.none")}</div>
              )}
            </div>
          </section>
        ) : (
          notLoaded
        )}
        {loaded && !ended ? (
          <div className="flex justify-center py-3.5">
            <button className="btn inline-flex items-center gap-2" disabled={more} onClick={moreMails}>
              {more ? <span className="spinner"></span> : null}
              {t("mail.more")}
            </button>
          </div>
        ) : null}
      </div>
      <div className="min-h-0 overflow-y-auto" onPointerDown={() => setMailPane(false)}>
        {open ? (
          <MailDetail className="max-w-200 px-8 pt-5.5 pb-10 select-text cursor-auto" mailKey={open} />
        ) : (
          <div className="h-full grid place-items-center text-[13px] text-tertiary">{t("mail.pick")}</div>
        )}
      </div>
    </div>
  );
}
