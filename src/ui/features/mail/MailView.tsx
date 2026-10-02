import { useMailStore } from "../../../application/mail/store";
import { useSettingsStore } from "../../../application/settings/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { openDetail } from "../../../application/navigation/panel";
import { mailKey } from "../../../domain/navigation/keys";
import { sender, unread } from "../../../domain/mail/rules";
import { inbox, loadMails, mailSeen, moreMails, openMailSetup, setMailFilter } from "../../../application/mail/mail";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { MailBar } from "./MailBar";
import { MailRow } from "./MailRow";
import { MailSetup } from "./MailSetup";

/** The inbox: search, read state and project on top, the mails that pass the filters under one heading with the unread count. */
export function MailView() {
  const { t } = useT();
  const hasAccount = useSettingsStore(s => !!s.settings.mail.accounts?.length);
  const loaded = useMailStore(s => !!s.list);
  const total = useMailStore(s => s.list?.length ?? 0);
  const err = useMailStore(s => s.err);
  const busy = useMailStore(s => s.busy);
  const more = useMailStore(s => s.more);
  const end = useMailStore(s => s.end);
  const filter = useMailStore(s => s.filter);
  const open = useNavigationStore(s => s.panel.open);
  const { shown, unread: unreadCount, projects } = useDerived(inbox);

  if (!hasAccount) return <MailSetup onSetup={openMailSetup} />;

  // the count keeps the heading's number style, the word around it stays in the heading's font
  const [beforeCount, afterCount] = t("mail.unread", { n: "\u0000" }).split("\u0000");
  const notLoaded = busy ? null : <div className="text-secondary text-sm text-center">{t("pr.notLoaded")}</div>;
  return (
    <div className="flex flex-col gap-[18px]">
      <MailBar filter={filter} projects={projects} busy={busy} onFilter={setMailFilter} onReload={loadMails} />
      <div>
        {err ? <div className="err-box">{err}</div> : null}
        {loaded ? (
          <section className="mb-6">
            <h2 className="list-head">
              {t("mail.inbox")}
              {unreadCount ? (
                <>
                  {" "}
                  {beforeCount}
                  <span className="font-mono tabular-nums">{unreadCount}</span>
                  {afterCount}
                </>
              ) : null}
            </h2>
            {shown.length ? (
              shown.map(({ mail, project }) => {
                const key = mailKey(mail);
                return (
                  <MailRow
                    key={key}
                    mail={mail}
                    sender={sender(mail)}
                    project={project}
                    selected={open === key}
                    onOpen={() => openDetail(key)}
                    onFlip={() => mailSeen(key, unread(mail))}
                  />
                );
              })
            ) : (
              <div className="text-secondary text-sm py-2">{total ? t("mail.noMatch") : t("mail.none")}</div>
            )}
          </section>
        ) : (
          notLoaded
        )}
        {loaded && !end ? (
          <div className="flex justify-center py-3.5">
            <button className="btn inline-flex items-center gap-2" disabled={more} onClick={moreMails}>
              {more ? <span className="spinner"></span> : null}
              {t("mail.more")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
