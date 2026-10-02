import { useEffect, useState, type ReactNode } from "react";
import { PROVIDERS } from "../../../shared/plugins";
import type { BoardProvider } from "../../../domain/board/types";
import { useSettingsStore } from "../../../application/settings/store";
import {
  askMcp,
  boardSetUp,
  isBoardOn,
  loadIntegrations,
  switchIntegration,
} from "../../../application/settings/integrations";
import { Glyph } from "../../components/Glyph";
import { Html } from "../../components/Html";
import { Icon } from "../../components/Icon";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { ActionsSection } from "./ActionsSection";
import { BUTTON_GLYPH, buttonClass, EMPTY_LIST, TILE } from "./blocks";
import { BoardSettings } from "./BoardSettings";
import { Footer } from "./Footer";
import { GithubSettings } from "./GithubSettings";
import { MailSettings } from "./MailSettings";
import { Section } from "./Section";
import { SettingsFold } from "./SettingsFold";
import { SettingsMenu } from "./SettingsMenu";
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
/** An integration: its row, and its page (sections of its own). */
type Entry = { id: string; icon: ReactNode; name: string; status: ReactNode; on: boolean; page: () => ReactNode };

/** Integrations: the ones in use are listed (a board provider set up or added, GitHub and Mail switched on), the
 *  others are in the Add menu. In the list means in the sidebar; a row opens the integration's own page, Remove
 *  switches it off and keeps the token. A page reads its own state; this one only knows which rows are listed and
 *  which page is open. */
export function IntegrationsPage({ active }: { active: boolean }) {
  const { t, th, tn } = useT();
  const loaded = useSettingsStore(s => s.integrations.loaded);
  const listMessage = useSettingsStore(s => s.integrations.listMessage);
  const mcp = useSettingsStore(s => s.integrations.mcp);
  const github = useSettingsStore(s => s.integrations.github);
  const mailCount = useSettingsStore(s => s.integrations.mail.edit.accounts.length);
  const githubOn = useSettingsStore(s => !!s.settings.github.on);
  const mailOn = useSettingsStore(s => !!s.settings.mail?.on);
  // per provider: set up, and in the list
  const boardsState = useDerived(() =>
    Object.fromEntries(
      PROVIDERS.map(provider => [provider.id, { setUp: !!boardSetUp(provider), on: isBoardOn(provider) }]),
    ),
  );
  // the integration whose page is open, or null for the list
  const [detail, setDetail] = useState<string | null>(null);
  useEffect(() => {
    loadIntegrations();
  }, []);
  useEffect(() => {
    if (active) askMcp();
  }, [active]);

  if (!loaded) return null;

  // an integration in or out of the list: on for the sidebar, a board provider's token stays in the keychain
  const switchTo = (id: string, on: boolean) => {
    setDetail(on ? id : null);
    switchIntegration(id, on);
  };
  const boardStatus = (provider: BoardProvider) => {
    const isSetUp = boardsState[provider.id].setUp;
    if (!isSetUp && mcp[provider.id]?.found) return <StatusLine level="warn">{t("int.foundClaude")}</StatusLine>;
    return <StatusLine level={isSetUp ? "ok" : "off"}>{isSetUp ? t("int.set") : t("int.notSet")}</StatusLine>;
  };

  const entries: Entry[] = [
    ...PROVIDERS.map(provider => ({
      id: provider.id,
      icon: providerIcon(provider),
      name: provider.name,
      status: boardStatus(provider),
      on: boardsState[provider.id].on,
      page: () => (
        <>
          <BoardSettings provider={provider} onRemove={() => switchTo(provider.id, false)} />
          <ActionsSection ext={provider.id} name={provider.name} />
        </>
      ),
    })),
    {
      id: "github",
      icon: GITHUB_MARK,
      name: "GitHub",
      status: github.login ? (
        <StatusLine level="ok">{t("gh.connected", { login: github.login })}</StatusLine>
      ) : (
        <StatusLine level={github.error ? "warn" : "off"}>{github.error || t("gh.checking")}</StatusLine>
      ),
      on: githubOn,
      // GitHub has no actions for the agent, so no access section
      page: () => (
        <Section title={t("int.connection")}>
          <GithubSettings onRemove={() => switchTo("github", false)} />
        </Section>
      ),
    },
    {
      id: "mail",
      icon: <Icon name="mail" className={TILE} />,
      name: "Mail",
      status: <StatusLine level={mailCount ? "ok" : "off"}>{tn("mail.accounts", mailCount)}</StatusLine>,
      on: mailOn,
      page: () => (
        <>
          <MailSettings onRemove={() => switchTo("mail", false)} />
          <ActionsSection ext="mail" name="Mail" />
        </>
      ),
    },
  ];
  // an integration's own page: back to the list, its name and status, then its sections
  const open = entries.find(entry => entry.id === detail && entry.on);
  if (open)
    return (
      <>
        <header className="grid gap-3">
          <button className={`${buttonClass("ghost")} -ml-2 justify-self-start`} onClick={() => setDetail(null)}>
            <Icon name="left" className={BUTTON_GLYPH} />
            {t("set.tab.integrations")}
          </button>
          <div className="flex items-center gap-3">
            <span className="grid size-9 flex-none place-items-center rounded-lg border border-s-border bg-s-bg">
              {open.icon}
            </span>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-s-fg">{open.name}</h1>
              <div className="mt-px flex">{open.status}</div>
            </div>
          </div>
        </header>
        {open.page()}
      </>
    );
  const listed = entries.filter(entry => entry.on);
  return (
    <Section
      title={t("set.tab.integrations")}
      desc={<Html html={th("int.listHelp")} />}
      list
      footer={listMessage && <Footer message={listMessage} />}
      action={
        <SettingsMenu
          label={t("int.add")}
          items={entries.filter(entry => !entry.on).map(({ id, icon, name, status }) => ({ id, icon, name, status }))}
          onPick={id => switchTo(id, true)}
        />
      }
    >
      {listed.length ? (
        listed.map(entry => (
          <SettingsFold
            key={entry.id}
            nav
            icon={entry.icon}
            name={entry.name}
            status={entry.status}
            onToggle={() => setDetail(entry.id)}
          />
        ))
      ) : (
        <div className={EMPTY_LIST}>{t("int.empty")}</div>
      )}
    </Section>
  );
}
