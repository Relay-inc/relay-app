import { useState } from "react";
import { useSettingsStore } from "../../../application/settings/store";
import { clearCalendarMessage, connectCalendar, dropCalendar } from "../../../application/settings/integrations";
import { Html } from "../../components/Html";
import { useT } from "../../hooks/useT";
import { buttonClass, ERROR_MESSAGE, FIELD, FOOTER_IN_ROW, HINT_IN_ROW, OK_MESSAGE, withoutColon } from "./blocks";
import { Field } from "./Field";
import { Footer } from "./Footer";
import { Section } from "./Section";

const NO_FEEDS: { email: string }[] = [];

/** Calendar's sections on its page in Integrations, like Mail's: the calendars read with an Add button, or, while one
 *  is being added, the steps to add it by its secret iCal address. The address goes straight to the keychain
 *  (calendar_connect), the settings only keep the email. */
export function CalendarSettings() {
  const { t, th } = useT();
  const feeds = useSettingsStore(s => s.settings.calendar?.feeds ?? NO_FEEDS);
  const busy = useSettingsStore(s => s.integrations.calendar.busy);
  const message = useSettingsStore(s => s.integrations.calendar.message);
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [url, setUrl] = useState("");

  // a calendar that was added brings the list back, with its message; a failed one keeps the fields to fix
  const connect = async () => {
    if (!(await connectCalendar(email.trim(), url.trim()))) return;
    setEmail("");
    setUrl("");
    setAdding(false);
  };

  if (adding)
    return (
      <Section
        title={t("cal.addH")}
        desc={<Html html={th("cal.steps")} />}
        action={
          <button className={buttonClass("ghost")} onClick={() => setAdding(false)}>
            {t("pop.cancel")}
          </button>
        }
      >
        <Field label={withoutColon(t("cal.emailL"))} id="calemail" className="w-full">
          <input
            className={FIELD}
            id="calemail"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="naam@bedrijf.be"
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
        <Field label={withoutColon(t("cal.urlL"))} id="calurl" className="w-full">
          <input
            className={FIELD}
            id="calurl"
            type="password"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
        <div className={FOOTER_IN_ROW}>
          {busy ? (
            <span className="spinner"></span>
          ) : (
            message && <span className={message.ok ? OK_MESSAGE : ERROR_MESSAGE}>{message.text}</span>
          )}
          <span className="flex-1"></span>
          <button className={buttonClass("primary")} disabled={busy || !email.trim() || !url.trim()} onClick={connect}>
            {t("cal.connect")}
          </button>
        </div>
      </Section>
    );

  return (
    <Section
      title={t("cal.feedsH")}
      desc={<Html html={th("cal.help")} />}
      action={
        <button
          className={buttonClass()}
          onClick={() => {
            clearCalendarMessage();
            setAdding(true);
          }}
        >
          {t("cal.add")}
        </button>
      }
    >
      {feeds.length ? (
        <div>
          {feeds.map(feed => (
            <div
              key={feed.email}
              className="group flex items-center gap-3 border-t border-s-border py-2.5 first:border-t-0 first:pt-0 last:pb-0"
            >
              <b className="min-w-0 flex-1 truncate font-medium">{feed.email}</b>
              <button
                className={`${buttonClass("ghost")} opacity-0 transition-opacity duration-150 ease-in-out group-focus-within:opacity-100 group-hover:opacity-100`}
                onClick={() => dropCalendar(feed.email)}
              >
                {t("mail.remove")}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className={HINT_IN_ROW}>{t("cal.setupIntro")}</p>
      )}
      {message && (
        <div className={FOOTER_IN_ROW}>
          <Footer message={message} />
        </div>
      )}
    </Section>
  );
}
