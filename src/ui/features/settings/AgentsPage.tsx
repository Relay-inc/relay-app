import { useEffect, useState } from "react";
import type { AgentCfg } from "../../../domain/settings/types";
import { useSettingsStore } from "../../../application/settings/store";
import { checkAgents, clearAgentsMessage } from "../../../application/settings/agents-page";
import { useT } from "../../hooks/useT";
import { buttonClass, DEFAULT_PILL, EMPTY_LIST } from "./blocks";
import { AgentGlyph } from "./AgentBits";
import { AgentOverview } from "./AgentOverview";
import { AgentSettings, type AgentTab } from "./AgentSettings";
import { Footer } from "./Footer";
import { Icon } from "../../components/Icon";
import { LoadingSection } from "./LoadingSection";

const OFF: AgentCfg = { on: false, bin: "" };
const ROW =
  "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-s-fg focus-visible:ring-2 ring-s-ring focus-visible:outline-none";

/** Agents: the overview and the agents on the left (on, then off), the picked one's settings on the right. A switch
 *  turns an agent on or off, every change saves at once. What is installed is checked when the window opens. */
export function AgentsPage() {
  const { t } = useT();
  const detected = useSettingsStore(s => s.agentsPage.detected);
  const message = useSettingsStore(s => s.agentsPage.message);
  const agents = useSettingsStore(s => s.settings.agents);
  // "" is the overview
  const [picked, setPicked] = useState("");
  const [tab, setTab] = useState<AgentTab>("general");
  useEffect(() => {
    checkAgents();
  }, []);

  if (!detected)
    return (
      <main className="min-w-0 flex-1 px-8 pt-7">
        <LoadingSection title={t("set.tab.agents")} text={message?.text || t("ag.checking")} />
      </main>
    );

  const config = (id: string) => agents?.providers[id] ?? OFF;
  const current = detected.providers.find(provider => provider.id === picked);
  const onOnes = detected.providers.filter(provider => config(provider.id).on);
  const offOnes = detected.providers.filter(provider => !config(provider.id).on);

  const summary = (id: string) => {
    const { detect } = detected.providers.find(provider => provider.id === id)!;
    if (!detect.installed) return t("ag.notInstalled");
    if (!config(id).on) return t("ag.off");
    const login = detect.loggedIn == null ? "" : ` · ${t(detect.loggedIn ? "ag.loggedIn" : "ag.loggedOut")}`;
    return (detect.version || t("ag.installedNoVersion")) + login;
  };
  const row = (id: string, tile: React.ReactNode, name: string, line: string, pill = false) => {
    const here = id === picked;
    return (
      <button
        key={id}
        className={`${ROW} ${here ? "bg-s-sel" : "hover:bg-s-hover"}`}
        aria-current={here ? "true" : undefined}
        onClick={() => setPicked(id)}
      >
        <span className="grid size-7 flex-none place-items-center rounded-md border border-s-border">{tile}</span>
        <span className="min-w-0 flex-1">
          <span className={`flex items-center gap-1.5 ${here ? "font-medium" : ""}`}>
            <span className="truncate">{name}</span>
            {pill && <span className={`${DEFAULT_PILL} flex-none`}>{t("ag.isDefault")}</span>}
          </span>
          <span className="block truncate text-xs text-s-muted">{line}</span>
        </span>
      </button>
    );
  };
  const group = (title: string, list: typeof onOnes) =>
    list.length > 0 && (
      <div className="grid gap-px">
        <div className="px-2.5 pt-1.5 pb-1 text-xs font-semibold tracking-wider text-s-muted uppercase">{title}</div>
        {list.map(provider =>
          row(
            provider.id,
            <AgentGlyph id={provider.id} />,
            provider.name,
            summary(provider.id),
            agents?.default === provider.id,
          ),
        )}
      </div>
    );

  return (
    <>
      <aside
        aria-label={t("set.tab.agents")}
        className="flex w-72 flex-none flex-col gap-3 overflow-y-auto border-r border-s-seam px-3 py-4"
      >
        <div className="grid gap-px">
          {row(
            "",
            <Icon name="agent" className="size-4 fill-none stroke-current stroke-2 glyph text-secondary" />,
            t("ag.overview"),
            t("ag.countOn", { on: onOnes.length, total: detected.providers.length }),
          )}
        </div>
        {group(t("ag.groupOn"), onOnes)}
        {group(t("ag.groupOff"), offOnes)}
        {!detected.providers.length && <div className={`${EMPTY_LIST} px-2.5`}>{t("ag.empty")}</div>}
        <div className="mt-auto flex flex-wrap items-center gap-2 px-1 pt-2">
          <button
            className={`${buttonClass()} h-6 px-2 text-xs font-normal`}
            onClick={() => {
              clearAgentsMessage();
              checkAgents(true);
            }}
          >
            {t("ag.recheck")}
          </button>
          {message && <Footer message={message} />}
        </div>
      </aside>
      <main className="@container min-w-0 flex-1 overflow-y-auto px-8 pt-7 pb-12">
        {current ? (
          <AgentSettings
            key={current.id}
            status={current}
            config={config(current.id)}
            isDefault={agents?.default === current.id}
            tab={tab}
            onTab={setTab}
          />
        ) : (
          <AgentOverview
            providers={detected.providers}
            config={config}
            defaultId={agents?.default ?? ""}
            onOpen={setPicked}
          />
        )}
      </main>
    </>
  );
}
