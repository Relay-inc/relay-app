import type { AgentCfg } from "../../../domain/settings/types";
import type { AgentProvider, AgentStatus } from "../../../domain/agents/types";
import { saveAgent, saveAgentBin } from "../../../application/settings/agents-page";
import { Html } from "../../components/Html";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { FIELD, HINT_IN_ROW, PILL, SELECT, withoutColon } from "./blocks";
import { AgentAccounts } from "./AgentAccounts";
import { ChangeInput } from "./ChangeInput";
import { Field } from "./Field";
import { RemoveFooter } from "./RemoveFooter";

const CAPS = ["images", "permissions", "questions", "subagents", "terminal", "limits", "effort"] as const;

/** One coding agent's settings, in its folded-open row: help, the program, its options and what it can do. */
export function AgentSettings({
  status,
  config,
  agent,
  onRemove,
}: {
  status: AgentStatus;
  config: AgentCfg;
  /** The agent's own package: its help and options */
  agent: AgentProvider | undefined;
  onRemove: () => void;
}) {
  const { t, at, ath } = useT();
  const id = status.id;
  const note = status.detect.note;
  // its parts are rows of the folded-open row's grid, so they get its gap
  return (
    <>
      {agent && <Html as="p" className={HINT_IN_ROW} html={ath(agent, "set.help")} />}
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
          className={FIELD}
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
              className={SELECT}
              id={optionId}
              options={option.choices.map(choice => ({ id: choice.id, name: at(agent!, choice.label) }))}
              value={String(config[option.id] ?? option.choices[0].id)}
              onChange={value => saveAgent(id, { [option.id]: value })}
            />
          </Field>
        );
      })}
      {status.caps.accounts && <AgentAccounts id={id} config={config} />}
      {/* the label above the pills: a row of them on the right would wrap into a ragged column */}
      <div className="grid gap-1.5">
        <span className="text-[13px] text-s-fg">{withoutColon(t("ag.caps"))}</span>
        <div className="flex flex-wrap gap-1">
          {CAPS.filter(name => status.caps[name]).map(name => (
            <span key={name} className={PILL}>
              {t(`ag.cap.${name}`)}
            </span>
          ))}
        </div>
      </div>
      <RemoveFooter onRemove={onRemove} />
    </>
  );
}
