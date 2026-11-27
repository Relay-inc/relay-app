import type { AgentStatus } from "../../../domain/agents/types";
import type { AgentCfg } from "../../../domain/settings/types";
import { saveAgent, setDefaultAgent } from "../../../application/settings/agents-page";
import { Html } from "../../components/Html";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { DEFAULT_PILL, EMPTY_LIST, SELECT } from "./blocks";
import { ActionsSection } from "./ActionsSection";
import { AgentGlyph, AgentStatusLine } from "./AgentBits";
import { RunDefault } from "./RunDefault";
import { Section } from "./Section";
import { Switch } from "./Switch";

/** The right side with Overview picked: every agent in one table (its status and a switch, the name opens it), then
 *  the default agent, where new conversations run and the agents' access to knowledge workspaces. */
export function AgentOverview({
  providers,
  config,
  defaultId,
  onOpen,
}: {
  providers: AgentStatus[];
  config: (id: string) => AgentCfg;
  defaultId: string;
  onOpen: (id: string) => void;
}) {
  const { t, th } = useT();
  const listed = providers.filter(provider => config(provider.id).on);
  return (
    <div className="mx-auto grid max-w-240 grid-cols-1 gap-7 [&>*]:min-w-0">
      <header className="flex items-center gap-3.5">
        <span className="grid size-11 flex-none place-items-center rounded-xl border border-s-border">
          <Icon name="agent" className="size-5 fill-none stroke-current stroke-2 glyph text-secondary" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold text-s-fg">{t("set.tab.agents")}</h1>
          <Html as="div" className="text-xs text-s-muted" html={th("ag.listHelp")} />
        </div>
      </header>
      <div className="grid rounded-xl border border-s-border bg-raised">
        {providers.length ? (
          providers.map(provider => {
            const id = provider.id;
            const on = config(id).on;
            return (
              <div key={id} className="flex items-center gap-3 border-t border-s-border px-3.5 py-2.5 first:border-t-0">
                <button
                  className={`flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:ring-2 ring-s-ring focus-visible:outline-none ${on ? "" : "opacity-55"}`}
                  onClick={() => onOpen(id)}
                >
                  <span className="grid size-7 flex-none place-items-center rounded-md border border-s-border">
                    <AgentGlyph id={id} />
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
                    <span className="truncate">{provider.name}</span>
                    {defaultId === id && <span className={DEFAULT_PILL}>{t("ag.isDefault")}</span>}
                  </span>
                  <span className="ml-auto flex min-w-0">
                    <AgentStatusLine detect={provider.detect} />
                  </span>
                </button>
                <Switch
                  id={`agon-${id}`}
                  on={on}
                  label={provider.name}
                  onToggle={next => saveAgent(id, { on: next })}
                />
              </div>
            );
          })
        ) : (
          <div className={`${EMPTY_LIST} px-3.5`}>{t("ag.empty")}</div>
        )}
      </div>
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
              value={defaultId}
              onChange={setDefaultAgent}
            />
          }
        />
      )}
      <RunDefault />
      <ActionsSection ext="knowledge" name={t("act.knowledge")} />
    </div>
  );
}
