import type { AgentCfg } from "../../../domain/settings/types";
import type { AgentProvider, AgentStatus } from "../../../domain/agents/types";
import { saveAgent, saveAgentBin } from "../../../application/settings/agents-page";
import { Html } from "../../components/Html";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { buttonClass, FIELD, HINT_IN_ROW, PILL, SELECT, withoutColon } from "./blocks";
import { ChangeInput } from "./ChangeInput";
import { Field } from "./Field";

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
  // one element: the fold's gap is between bodies, the fields inside sit without one
  return (
    <div>
      {agent && <Html as="p" className={HINT_IN_ROW} html={ath(agent, "set.help")} />}
      <Field label={withoutColon(t("ag.bin"))} id={`agbin-${id}`} hint={note ? <code>{note}</code> : ""}>
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
      <Field label={withoutColon(t("ag.caps"))}>
        <span className="flex max-w-2xs flex-wrap justify-end gap-1">
          {CAPS.filter(name => status.caps[name]).map(name => (
            <span key={name} className={PILL}>
              {t(`ag.cap.${name}`)}
            </span>
          ))}
        </span>
      </Field>
      <div className="mt-0.5 flex flex-wrap items-center gap-2">
        <span className="flex-1"></span>
        <button className={buttonClass("ghost")} onClick={onRemove}>
          {t("ag.remove")}
        </button>
      </div>
    </div>
  );
}
