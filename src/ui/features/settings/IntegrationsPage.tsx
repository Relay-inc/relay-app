import { useEffect, useState, type ReactNode } from "react";
import { PROVIDERS } from "../../../shared/plugins";
import type { BoardProvider } from "../../../domain/board/types";
import type { Message } from "../../../domain/settings/types";
import { useSettingsStore } from "../../../application/settings/store";
import {
  askMcp,
  boardSetUp,
  disconnectIntegration,
  isBoardOn,
  loadIntegrations,
  switchIntegration,
} from "../../../application/settings/integrations";
import { Glyph } from "../../components/Glyph";
import { Icon } from "../../components/Icon";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { AgentAccess, LINK } from "./AgentAccess";
import { go } from "../../../application/settings/window";
import { buttonClass, HINT, TILE } from "./blocks";
import { BoardSettings } from "./BoardSettings";
import { BuddySettings } from "./BuddySettings";
import { CloudbuildSettings } from "./CloudbuildSettings";
import { AikidoSettings } from "./AikidoSettings";
import { BUDDY_LOGO } from "../buddy/mark";
import { CLOUDBUILD_LOGO } from "../buddy/cloudmark";
import { CalendarSettings } from "./CalendarSettings";
import { Footer } from "./Footer";
import { GithubSettings } from "./GithubSettings";
import { MailSettings } from "./MailSettings";
import { Field } from "./Field";
import { Section } from "./Section";
import { StatusLine } from "./StatusLine";

// a provider's 16×16 glyph on the 24×24 tile
const providerIcon = (provider: BoardProvider) => (
  <Glyph svg={`<g transform="scale(1.5)">${provider.glyph}</g>`} className={TILE} viewBox="0 0 24 24" />
);
// GitHub's mark (octicon mark-github), in the label colour
const GITHUB_MARK = (
  <svg className={TILE} viewBox="0 0 24 24" aria-hidden="true">
    <path
      transform="translate(4 4)"
      fill="currentColor"
      stroke="none"
      d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
    />
  </svg>
);
/** An integration: its row, its page, and what it keeps in the keychain (what Disconnect may delete with it). `ext`:
 *  its actions for agents, when it has some. `configured`: there is something to connect again. */
type Entry = {
  id: string;
  group: "boards" | "code" | "cicd" | "security" | "mail";
  icon: ReactNode;
  name: string;
  status: ReactNode;
  on: boolean;
  configured: boolean;
  secret?: "token" | "client" | "passwords" | "calendars";
  ext?: string;
  page: () => ReactNode;
};
const GROUPS = [
  ["boards", "int.gBoards"],
  ["code", "int.gCode"],
  ["cicd", "int.gCicd"],
  ["security", "int.gSecurity"],
  ["mail", "int.gMail"],
] as const;
const FORGET = {
  token: "int.forgetToken",
  client: "ak.forgetClient",
  passwords: "int.forgetPasswords",
  calendars: "int.forgetCalendars",
} as const;

/** Integrations: the board providers, GitHub, Mail, Calendar, Buddy, Cloud Build and Aikido in groups on the left, the picked one's page on
 *  the right (its connection, its agent access, Disconnect). On means in the sidebar (Calendar: under Today). A page
 *  reads its own state; this one only knows which are listed and which is picked. */
export function IntegrationsPage({ active }: { active: boolean }) {
  const { t, tn } = useT();
  const loaded = useSettingsStore(s => s.integrations.loaded);
  const listMessage = useSettingsStore(s => s.integrations.listMessage);
  const mcp = useSettingsStore(s => s.integrations.mcp);
  const github = useSettingsStore(s => s.integrations.github);
  const mailCount = useSettingsStore(s => s.integrations.mail.edit.accounts.length);
  const githubOn = useSettingsStore(s => !!s.settings.github.on);
  const mailOn = useSettingsStore(s => !!s.settings.mail?.on);
  const calendarCount = useSettingsStore(s => s.settings.calendar?.feeds.length ?? 0);
  const calendarOn = useSettingsStore(s => !!s.settings.calendar?.on);
  const buddyOn = useSettingsStore(s => s.settings.integrations.buddy?.on === true);
  const cloudbuild = useSettingsStore(s => s.integrations.cloudbuild);
  const cloudbuildOn = useSettingsStore(s => s.settings.integrations.cloudbuild?.on === true);
  const buddyToken = useSettingsStore(s => !!s.integrations.tokens.buddy);
  const aikidoOn = useSettingsStore(s => s.settings.integrations.aikido?.on === true);
  const aikidoToken = useSettingsStore(s => !!s.integrations.tokens.aikido);
  // per provider: set up, and in use
  const boardsState = useDerived(() =>
    Object.fromEntries(
      PROVIDERS.map(provider => [provider.id, { setUp: !!boardSetUp(provider), on: isBoardOn(provider) }]),
    ),
  );
  const [picked, setPicked] = useState("");
  useEffect(() => {
    loadIntegrations();
  }, []);
  useEffect(() => {
    if (active) askMcp();
  }, [active]);

  if (!loaded) return null;

  const connected = (on: boolean, text: ReactNode) =>
    on ? <StatusLine level="ok">{text}</StatusLine> : <StatusLine level="off">{t("int.notConnected")}</StatusLine>;
  const boardStatus = (provider: BoardProvider) => {
    const { setUp, on } = boardsState[provider.id];
    if (!setUp && mcp[provider.id]?.found) return <StatusLine level="warn">{t("int.foundClaude")}</StatusLine>;
    return connected(on && setUp, t("int.connected"));
  };

  const entries: Entry[] = [
    ...PROVIDERS.map(provider => ({
      id: provider.id,
      group: "boards" as const,
      icon: providerIcon(provider),
      name: provider.name,
      status: boardStatus(provider),
      on: boardsState[provider.id].on,
      configured: boardsState[provider.id].setUp,
      secret: "token" as const,
      ext: provider.id,
      page: () => <BoardSettings provider={provider} />,
    })),
    {
      id: "github",
      group: "code",
      icon: GITHUB_MARK,
      name: "GitHub",
      status: !githubOn ? (
        <StatusLine level="off">{t("int.notConnected")}</StatusLine>
      ) : github.login ? (
        <StatusLine level="ok">{t("gh.connected", { login: github.login })}</StatusLine>
      ) : (
        <StatusLine level={github.error ? "warn" : "off"}>{github.error || t("gh.checking")}</StatusLine>
      ),
      on: githubOn,
      // gh's own login: nothing of ours to connect again, nothing in the keychain
      configured: !!github.login,
      // GitHub has no actions for the agent
      page: () => (
        <Section title={t("int.connection")}>
          <GithubSettings />
        </Section>
      ),
    },
    {
      id: "mail",
      group: "mail",
      icon: <Icon name="mail" className={TILE} />,
      name: "Mail",
      status: connected(mailOn && mailCount > 0, tn("mail.accounts", mailCount)),
      on: mailOn,
      configured: mailCount > 0,
      secret: "passwords",
      ext: "mail",
      page: () => <MailSettings />,
    },
    {
      id: "calendar",
      group: "mail",
      icon: <Icon name="cal" className={TILE} />,
      name: t("cal.name"),
      status: connected(calendarOn && calendarCount > 0, tn("cal.feeds", calendarCount)),
      on: calendarOn,
      configured: calendarCount > 0,
      secret: "calendars",
      ext: "calendar",
      page: () => <CalendarSettings />,
    },
    {
      id: "buddy",
      group: "cicd",
      icon: <Glyph svg={BUDDY_LOGO} className="size-4" viewBox="0 0 24 24" />,
      name: "Buddy",
      status: connected(buddyOn && buddyToken, t("int.connected")),
      on: buddyOn,
      configured: buddyToken,
      secret: "token",
      // read-only, so no actions for the agent
      page: () => <BuddySettings />,
    },
    {
      id: "cloudbuild",
      group: "cicd",
      icon: <Glyph svg={CLOUDBUILD_LOGO} className="size-4" viewBox="0 0 24 24" />,
      name: "Cloud Build",
      status: !cloudbuildOn ? (
        <StatusLine level="off">{t("int.notConnected")}</StatusLine>
      ) : cloudbuild.account ? (
        <StatusLine level="ok">{t("cb.account", { account: cloudbuild.account })}</StatusLine>
      ) : (
        <StatusLine level={cloudbuild.error ? "warn" : "off"}>{cloudbuild.error || t("gh.checking")}</StatusLine>
      ),
      on: cloudbuildOn,
      // gcloud's own login: nothing of ours to connect again, nothing in the keychain; read-only, so no actions for the agent
      configured: !!cloudbuild.account,
      page: () => <CloudbuildSettings />,
    },
    {
      id: "aikido",
      group: "security",
      icon: <Icon name="shield" className={TILE} />,
      name: "Aikido",
      status: connected(aikidoOn && aikidoToken, t("int.connected")),
      on: aikidoOn,
      configured: aikidoToken,
      secret: "client",
      // read-only, so no actions for the agent
      page: () => <AikidoSettings />,
    },
  ];
  const current = entries.find(entry => entry.id === picked) ?? entries[0];
  const row = (entry: Entry) => {
    const here = entry === current;
    return (
      <button
        key={entry.id}
        className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-s-fg focus-visible:ring-2 ring-s-ring focus-visible:outline-none ${here ? "bg-s-sel" : "hover:bg-s-hover"}`}
        aria-current={here ? "true" : undefined}
        onClick={() => setPicked(entry.id)}
      >
        <span className="grid size-7 flex-none place-items-center rounded-md border border-s-border">{entry.icon}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${here ? "font-medium" : ""}`}>{entry.name}</span>
          <span className="flex">{entry.status}</span>
        </span>
      </button>
    );
  };
  return (
    <>
      <aside
        aria-label={t("set.tab.integrations")}
        className="flex w-72 flex-none flex-col gap-3 overflow-y-auto border-r border-s-seam px-3 py-4"
      >
        {GROUPS.map(([id, title]) => (
          <div key={id} className="grid gap-px">
            <div className="px-2.5 pt-1.5 pb-1 text-xs font-semibold tracking-wider text-s-muted uppercase">
              {t(title)}
            </div>
            {entries.filter(entry => entry.group === id).map(row)}
          </div>
        ))}
      </aside>
      <main className="@container min-w-0 flex-1 overflow-y-auto px-8 pt-7 pb-12">
        <Detail key={current.id} entry={current} message={listMessage} />
      </main>
    </>
  );
}

/** The picked integration: its header, its own sections, Agent access, and last Disconnect (Connect while it is off). */
function Detail({ entry, message }: { entry: Entry; message: Message | null }) {
  const { t } = useT();
  const [forget, setForget] = useState(false);
  const calendar = entry.id === "calendar";
  return (
    <div className="mx-auto grid max-w-240 grid-cols-1 gap-7 [&>*]:min-w-0">
      <header className="flex items-center gap-3.5">
        <span className="grid size-11 flex-none place-items-center rounded-xl border border-s-border">
          {entry.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold text-s-fg">{entry.name}</h1>
          <div className="flex">{entry.status}</div>
        </div>
      </header>
      {entry.page()}
      {entry.ext && (
        <AgentAccess ext={entry.ext} name={entry.name}>
          {entry.ext === "mail" && (
            <Field label={t("labs.mail")}>
              <button className={LINK} onClick={() => go("labs")}>
                {t("mail.labsOpen")}
              </button>
            </Field>
          )}
        </AgentAccess>
      )}
      {(entry.on || entry.configured) && (
        <div className="flex items-start gap-4 border-t border-s-seam pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold text-s-fg">
              {t(entry.on ? "int.disconnectH" : "int.connectH", { name: entry.name })}
            </h2>
            <p className={HINT}>
              {t(entry.on ? (calendar ? "int.disconnectHelpCal" : "int.disconnectHelp") : "int.connectHelp", {
                name: entry.name,
              })}
            </p>
            {entry.on && entry.secret && (
              <label className="mt-2 flex items-center gap-2 text-xs text-s-fg">
                <input type="checkbox" checked={forget} onChange={e => setForget(e.target.checked)} />
                {t(FORGET[entry.secret])}
              </label>
            )}
            {message && (
              <div className="mt-2">
                <Footer message={message} />
              </div>
            )}
          </div>
          {entry.on ? (
            <button
              className={buttonClass("danger")}
              onClick={() => {
                disconnectIntegration(entry.id, forget);
                setForget(false);
              }}
            >
              {t("int.disconnect")}
            </button>
          ) : (
            <button className={buttonClass("primary")} onClick={() => switchIntegration(entry.id, true)}>
              {t("int.connect")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
