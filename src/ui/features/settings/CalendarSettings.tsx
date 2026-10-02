import { useState } from "react";
import { useSettingsStore } from "../../../application/settings/store";
import { connectCalendar, dropCalendar } from "../../../application/settings/integrations";
import { Html } from "../../components/Html";
import { useT } from "../../hooks/useT";
import { buttonClass, FIELD, HINT_IN_ROW, withoutColon } from "./blocks";
import { Field } from "./Field";
import { RemoveFooter } from "./RemoveFooter";

const SUB = "mt-2 grid gap-0.5 border-t border-s-border pt-3";
const NO_FEEDS: { email: string }[] = [];

/** Calendar's body on its page in Integrations: the calendars read, and the fields to add one by its secret iCal
 *  address. The address goes straight to the keychain (calendar_connect), the settings only keep the email. */
export function CalendarSettings({ onRemove }: { onRemove: () => void }) {
  const { t, th } = useT();
  const feeds = useSettingsStore(s => s.settings.calendar?.feeds ?? NO_FEEDS);
  const busy = useSettingsStore(s => s.integrations.calendar.busy);
  const message = useSettingsStore(s => s.integrations.calendar.message);
  const [email, setEmail] = useState("");
  const [url, setUrl] = useState("");

  // a calendar that was added clears the fields; a failed one keeps them to fix
  const connect = async () => {
    if (!(await connectCalendar(email.trim(), url.trim()))) return;
    setEmail("");
    setUrl("");
  };
  return (
    <div>
      <Html as="p" className={HINT_IN_ROW} html={th("cal.help")} />
      {feeds.length ? (
        <div className="rounded-md border border-s-border px-3">
          {feeds.map(feed => (
            <div
              key={feed.email}
              className="group flex items-center gap-3 border-t border-s-border py-2.5 first:border-t-0"
            >
              <b className="min-w-0 flex-1 truncate font-medium">{feed.email}</b>
              <button
                className={`${buttonClass("ghost")} opacity-0 group-focus-within:opacity-100 group-hover:opacity-100`}
                onClick={() => dropCalendar(feed.email)}
              >
                {t("mail.remove")}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className={SUB}>
        <b className="text-xs font-semibold">{t("cal.addH")}</b>
      </div>
      <Html as="p" className={HINT_IN_ROW} html={th("cal.steps")} />
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
      <RemoveFooter onRemove={onRemove} message={message}>
        <button className={buttonClass("primary")} disabled={busy || !email.trim() || !url.trim()} onClick={connect}>
          {busy ? <span className="spinner"></span> : null}
          {t("cal.connect")}
        </button>
      </RemoveFooter>
    </div>
  );
}
