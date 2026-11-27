import type { ReactNode } from "react";
import { agent as agentOf } from "../../../shared/plugins";
import type { AgentCfg } from "../../../domain/settings/types";
import type { AgentStatus } from "../../../domain/agents/types";
import { saveAgent, saveAgentBin, setDefaultAgent } from "../../../application/settings/agents-page";
import { Html } from "../../components/Html";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { buttonClass, DEFAULT_PILL, FIELD_BASE, PILL, SELECT, withoutColon } from "./blocks";
import { AgentAccounts } from "./AgentAccounts";
import { AgentGlyph, AgentStatusLine } from "./AgentBits";
import { ChangeInput } from "./ChangeInput";
import { Field } from "./Field";
import { McpServers } from "./McpServers";
import { Section } from "./Section";
import { SkillsSection } from "./SkillsSection";
import { Switch } from "./Switch";

export type AgentTab = "general" | "mcp" | "skills";

// the options' choices are sentences: as wide as the program field, so they read whole
const WIDE_SELECT = SELECT.replace(" w-50 ", " w-96 ");
const CAPS = ["images", "permissions", "questions", "subagents", "terminal", "limits", "effort"] as const;

/** One agent's settings, the right side of Settings › Agents: its header (name, status, the switch, Make default) and
 *  the tabs General (help, program, options, accounts, what it can do), MCP servers (Claude) and Skills (Claude, on
 *  and installed). An agent that is off has General only, with a card to switch it on. */
export function AgentSettings({
  status,
  config,
  isDefault,
  tab: picked,
  onTab,
}: {
  status: AgentStatus;
  config: AgentCfg;
  isDefault: boolean;
  tab: AgentTab;
  onTab: (tab: AgentTab) => void;
}) {
  const { t } = useT();
  const id = status.id;
  const on = config.on;
  const tabs: AgentTab[] = [
    "general",
    ...(on && status.caps.mcp ? (["mcp"] as const) : []),
    ...(on && id === "claude" && status.detect.installed ? (["skills"] as const) : []),
  ];
  // a tab this agent does not have (picked on another one) shows General
  const tab = tabs.includes(picked) ? picked : "general";
  const label = { general: t("ag.general"), mcp: t("mcp.title"), skills: t("ag.skills") };
  return (
    <div className="mx-auto grid max-w-240 grid-cols-1 gap-7 [&>*]:min-w-0">
      <header className="grid gap-4">
        <div className="flex items-center gap-3.5">
          <span className="grid size-11 flex-none place-items-center rounded-xl border border-s-border">
            <AgentGlyph id={id} className="glyph size-6 stroke-1" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold text-s-fg">{status.name}</h1>
            <div className="mt-0.5 flex">
              <AgentStatusLine detect={status.detect} />
            </div>
          </div>
          {on && (isDefault ? <span className={DEFAULT_PILL}>{t("ag.isDefault")}</span> : null)}
          {on && !isDefault && (
            <button className={buttonClass()} onClick={() => setDefaultAgent(id)}>
              {t("ag.makeDefault")}
            </button>
          )}
          <Switch id={`agon-${id}`} on={on} label={status.name} onToggle={next => saveAgent(id, { on: next })} />
        </div>
        <nav role="tablist" aria-label={status.name} className="flex gap-6 border-b border-s-seam">
          {tabs.map(name => (
            <button
              key={name}
              role="tab"
              aria-selected={tab === name}
              className={`-mb-px inline-flex h-11 items-center gap-1.5 border-b-2 px-0.5 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 ring-s-ring ${tab === name ? "border-s-primary text-s-fg" : "border-transparent text-s-muted hover:text-s-fg"}`}
              onClick={() => onTab(name)}
            >
              {label[name]}
            </button>
          ))}
        </nav>
      </header>
      {tab === "mcp" ? (
        <McpServers />
      ) : tab === "skills" ? (
        <SkillsSection />
      ) : (
        <General status={status} config={config} />
      )}
    </div>
  );
}

/** The General tab: help, program, options and accounts as rows of a card, what it can do below; or the card that
 *  switches an agent on. */
function General({ status, config }: { status: AgentStatus; config: AgentCfg }) {
  const { t, at, ath } = useT();
  const id = status.id;
  const agent = agentOf(id);
  if (!config.on)
    return (
      <section className="flex flex-wrap items-center gap-4 rounded-xl border border-s-border bg-s-hover p-4">
        <span className="grid size-9 flex-none place-items-center rounded-lg border border-s-border bg-raised text-s-muted">
          <Icon name="agent" className="size-4.5 fill-none stroke-current stroke-[1.5]" />
        </span>
        <div className="min-w-60 flex-1">
          <h2 className="text-[13px] font-semibold">{t("ag.offTitle", { agent: status.name })}</h2>
          <p className="mt-0.5 text-xs text-s-muted">{t("ag.offHelp")}</p>
        </div>
        <button className={buttonClass("primary")} onClick={() => saveAgent(id, { on: true })}>
          {t("ag.switchOn")}
        </button>
      </section>
    );
  const note = status.detect.note;
  const rows: ReactNode = (
    <>
      <Field
        label={withoutColon(t("ag.bin"))}
        id={`agbin-${id}`}
        hint={
          note ? (
            <span className="block truncate font-mono" title={note}>
              {note}
            </span>
          ) : (
            ""
          )
        }
      >
        <ChangeInput
          className={`${FIELD_BASE} h-8 w-96 text-sm`}
          id={`agbin-${id}`}
          value={config.bin}
          placeholder={t("ag.binPh", { bin: status.defaultBin })}
          spellCheck={false}
          onCommit={value => saveAgentBin(id, value.trim())}
        />
      </Field>
      {(agent?.options ?? []).map(option => {
        const optionId = `agopt-${id}-${option.id}`;
        return (
          <Field key={option.id} label={at(agent!, option.label)} id={optionId}>
            <Select
              className={WIDE_SELECT}
              id={optionId}
              options={option.choices.map(choice => ({ id: choice.id, name: at(agent!, choice.label) }))}
              value={String(config[option.id] ?? option.choices[0].id)}
              onChange={value => saveAgent(id, { [option.id]: value })}
            />
          </Field>
        );
      })}
      {status.caps.accounts && <AgentAccounts id={id} config={config} />}
    </>
  );
  return (
    <>
      <Section title={t("ag.runs")} desc={agent && <Html html={ath(agent, "set.help")} />} rows>
        {rows}
      </Section>
      {/* the label above the pills: a row of them on the right would wrap into a ragged column */}
      <Section title={t("ag.supports")}>
        <div className="flex flex-wrap gap-1">
          {CAPS.filter(name => status.caps[name]).map(name => (
            <span key={name} className={PILL}>
              {t(`ag.cap.${name}`)}
            </span>
          ))}
        </div>
      </Section>
    </>
  );
}
