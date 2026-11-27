import { useEffect } from "react";
import type { Key } from "../../../shared/i18n";
import type { Policy } from "../../../domain/settings/types";
import {
  accessSummary,
  accessTools,
  loadActions,
  setAction,
  toggleTool,
  type AccessTool,
} from "../../../application/settings/actions";
import { useSettingsStore } from "../../../application/settings/store";
import { Html } from "../../components/Html";
import { Select } from "../../components/Select";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { ERROR_MESSAGE, SELECT } from "./blocks";
import { Section } from "./Section";
import { Switch } from "./Switch";

const POLICIES: Policy[] = ["auto", "ask", "deny"];

/** What agents may do with the user's tools (Privacy & access): one table, a row per tool with a summary of its
 *  policies and the switch for letting agents use it at all. A row unfolds to its actions, each Runs, Asks first or
 *  Never; one is open at a time. Read again whenever it mounts. */
export function AccessTable() {
  const { t, th } = useT();
  const tools = useDerived(accessTools);
  const error = useSettingsStore(s => s.actions.errors[""] || "");
  useEffect(() => {
    loadActions();
  }, []);
  return (
    <Section
      title={t("access.agents")}
      desc={<Html html={th("access.agentsHelp")} />}
      list
      footer={error ? <span className={ERROR_MESSAGE}>{error}</span> : null}
    >
      {tools.length ? tools.map(tool => <ToolRow key={tool.ext} tool={tool} />) : null}
    </Section>
  );
}

function ToolRow({ tool }: { tool: AccessTool }) {
  const { t } = useT();
  const entry = useSettingsStore(s => s.actions.entries[tool.ext]);
  const error = useSettingsStore(s => s.actions.errors[tool.ext] || "");
  const open = useSettingsStore(s => s.actions.open === tool.ext);
  const list = useSettingsStore(s => s.actions.list);
  const summary = useDerived(() => accessSummary(tool.ext));
  const on = entry?.access !== false;
  const unfolds = tool.connected && on;
  const unfolded = open && unfolds;
  const inherited = entry?.["*"] as Policy | undefined;
  return (
    <div className="border-t border-s-border first:border-t-0">
      <div className={`flex items-center gap-3 px-3.5 py-2.5 ${tool.connected ? "" : "opacity-55"}`}>
        <button
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:ring-2 ring-s-ring focus-visible:outline-none disabled:cursor-default"
          onClick={() => toggleTool(tool.ext)}
          aria-expanded={unfolds ? unfolded : undefined}
          disabled={!unfolds}
        >
          <svg
            className={`size-3.5 flex-none fill-none stroke-tertiary stroke-2 transition-transform duration-150 ease-in-out glyph ${unfolded ? "rotate-90" : ""}`}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
          <span className={`truncate text-[13px] ${unfolded ? "font-medium" : ""}`}>{tool.name}</span>
          {tool.ext === "mail" && (
            <span className="flex-none rounded-md bg-fill px-1.5 py-px text-[11px] text-s-muted">
              {t("act.claudeOnly")}
            </span>
          )}
        </button>
        <span className="flex-none text-xs text-s-muted">{tool.connected ? summary : t("int.notConnected")}</span>
        <Switch
          id={`acc-${tool.ext}`}
          on={on}
          label={t("act.access", { name: tool.name })}
          disabled={!tool.connected}
          onToggle={value => setAction(tool.ext, "access", value)}
        />
      </div>
      {unfolded && (
        <div className="grid bg-fill px-3.5 py-1 pl-9">
          {list
            .filter(action => action.ext === tool.ext)
            .map(action => {
              const id = `act-${action.id}`;
              const policy = inherited || action.default;
              return (
                <div
                  key={action.id}
                  className="flex items-center justify-between gap-3 border-t border-s-border py-2 first:border-t-0"
                >
                  <div className="min-w-0 flex-1">
                    <label htmlFor={id} className="block">
                      <code className="text-xs">{`${tool.ext}.${action.id}`}</code>
                    </label>
                    <p className="text-xs text-s-muted">{action.about}</p>
                  </div>
                  <Select
                    className={SELECT}
                    id={id}
                    empty={t("act.default", { p: t(`act.${policy}` as Key) })}
                    options={POLICIES.map(value => ({ id: value, name: t(`act.${value}` as Key) }))}
                    value={String(entry?.[action.id] ?? "")}
                    onChange={value => setAction(tool.ext, action.id, value)}
                  />
                </div>
              );
            })}
          {error && <span className={`${ERROR_MESSAGE} py-2`}>{error}</span>}
        </div>
      )}
    </div>
  );
}
