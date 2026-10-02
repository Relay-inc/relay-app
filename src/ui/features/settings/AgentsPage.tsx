import { useEffect } from "react";
import { agent } from "../../../shared/plugins";
import type { AgentStatus } from "../../../domain/agents/types";
import type { AgentCfg } from "../../../domain/settings/types";
import { useSettingsStore } from "../../../application/settings/store";
import {
  checkAgents,
  checkServer,
  clearAgentsMessage,
  saveAgent,
  saveServerAddr,
  saveServerToken,
  setDefaultAgent,
} from "../../../application/settings/agents-page";
import { Glyph } from "../../components/Glyph";
import { Html } from "../../components/Html";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { buttonClass, DEFAULT_PILL, EMPTY_LIST, FIELD, SELECT, TILE } from "./blocks";
import { ChangeInput } from "./ChangeInput";
import { Field } from "./Field";
import { AgentSettings } from "./AgentSettings";
import { Footer } from "./Footer";
import { LoadingSection } from "./LoadingSection";
import { Section } from "./Section";
import { SettingsFold } from "./SettingsFold";
import { SettingsMenu } from "./SettingsMenu";
import { StatusLine } from "./StatusLine";
import { useToggleSet } from "./useToggleSet";

const OFF: AgentCfg = { on: false, bin: "" };

const agentGlyph = (id: string) => {
  const provider = agent(id);
  return provider ? <Glyph svg={provider.glyph} className={TILE} /> : null;
};

/** Agents: only the ones switched on are listed, the others are in the Add menu. A row folds open to its program and
 *  options. Every change saves at once. What is installed is checked when the window opens. */
export function AgentsPage() {
  const { t, th } = useT();
  const detected = useSettingsStore(s => s.agentsPage.detected);
  const message = useSettingsStore(s => s.agentsPage.message);
  const agents = useSettingsStore(s => s.settings.agents);
  const serverAddr = useSettingsStore(s => s.settings.server?.addr ?? "");
  const server = useSettingsStore(s => s.agentsPage.server);
  const folds = useToggleSet();
  useEffect(() => {
    checkAgents();
    checkServer();
  }, []);

  if (!detected) return <LoadingSection title={t("set.tab.agents")} text={message?.text || t("ag.checking")} />;

  const config = (id: string) => agents?.providers[id] ?? OFF;
  // add (folded open, to set it up) and remove
  const switchTo = (id: string, on: boolean) => {
    folds.setOpen(id, on);
    saveAgent(id, { on });
  };
  const status = ({ detect }: AgentStatus) => {
    const found = !detect.installed
      ? t("ag.missing", { bin: detect.bin })
      : detect.version
        ? t("ag.installed", { version: detect.version })
        : t("ag.installedNoVersion");
    const login = detect.loggedIn == null ? "" : ` · ${detect.loggedIn ? t("ag.loggedIn") : t("ag.loggedOut")}`;
    const level = !detect.installed ? "off" : detect.loggedIn === false ? "warn" : "ok";
    return <StatusLine level={level}>{found + login}</StatusLine>;
  };

  const listed = detected.providers.filter(provider => config(provider.id).on);
  const unused = detected.providers.filter(provider => !config(provider.id).on);
  const rows = listed.length ? (
    listed.map(provider => {
      const id = provider.id;
      const open = folds.isOpen(id);
      return (
        <SettingsFold
          key={id}
          open={open}
          onToggle={() => folds.toggle(id)}
          icon={agentGlyph(id)}
          status={status(provider)}
          name={
            <>
              {provider.name}
              {agents?.default === id && (
                <>
                  {" "}
                  <span className={DEFAULT_PILL}>{t("ag.isDefault")}</span>
                </>
              )}
            </>
          }
        >
          {open && (
            <AgentSettings
              status={provider}
              config={config(id)}
              agent={agent(id)}
              onRemove={() => switchTo(id, false)}
            />
          )}
        </SettingsFold>
      );
    })
  ) : (
    <div className={EMPTY_LIST}>{t("ag.empty")}</div>
  );

  return (
    <>
      <Section
        title={t("set.tab.agents")}
        desc={<Html html={th("ag.listHelp")} />}
        list
        footer={message && <Footer message={message} />}
        action={
          <>
            <button
              className={buttonClass("ghost")}
              onClick={() => {
                clearAgentsMessage();
                checkAgents(true);
              }}
            >
              {t("ag.recheck")}
            </button>
            <SettingsMenu
              label={t("ag.add")}
              items={unused.map(provider => ({
                id: provider.id,
                icon: agentGlyph(provider.id),
                name: provider.name,
                status: status(provider),
              }))}
              onPick={id => switchTo(id, true)}
            />
          </>
        }
      >
        {rows}
      </Section>
      {/* with one agent there is nothing to choose */}
      {listed.length >= 2 && (
        <Section
          title={t("ag.default")}
          desc={<Html html={th("ag.defaultHelp")} />}
          action={
            <Select
              className={SELECT}
              id="agdefault"
              aria-label={t("ag.default")}
              options={listed.map(provider => ({ id: provider.id, name: provider.name }))}
              value={agents?.default ?? ""}
              onChange={setDefaultAgent}
            />
          }
        />
      )}
      <Section
        title={t("srv.title")}
        desc={<Html html={th("srv.help")} />}
        action={
          <button className={buttonClass("ghost")} onClick={checkServer}>
            {t("srv.check")}
          </button>
        }
      >
        <Field label={t("srv.addr")} hint={t("srv.addrHint")} id="srvaddr">
          <ChangeInput
            id="srvaddr"
            className={FIELD}
            value={serverAddr}
            placeholder="100.64.0.1:7311"
            spellCheck={false}
            onCommit={saveServerAddr}
          />
        </Field>
        <Field label={t("srv.token")} hint={t("srv.tokenHint")} id="srvtoken">
          <ChangeInput
            id="srvtoken"
            type="password"
            className={FIELD}
            value=""
            placeholder={server?.configured ? t("srv.tokenSaved") : ""}
            onCommit={(token, input) => {
              saveServerToken(token);
              input.value = "";
            }}
          />
        </Field>
        {server && (
          <StatusLine level={server.online ? "ok" : server.configured ? "warn" : "off"}>
            {server.online
              ? t("srv.online", { version: server.version ?? "" })
              : server.configured
                ? t("srv.offline", { error: server.error ?? "" })
                : t("srv.none")}
          </StatusLine>
        )}
      </Section>
    </>
  );
}
