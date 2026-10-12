import { useEffect, useState } from "react";
import { useSettingsStore } from "../../../application/settings/store";
import { allowTool, claudeHas, savePlugin, testPlugin } from "../../../application/settings/plugins";
import { formatEnv, parseArgs, parseEnv, pluginId } from "../../../domain/plugins/rules";
import type { Plugin, PluginTool } from "../../../domain/plugins/types";
import { Html } from "../../components/Html";
import { useT } from "../../hooks/useT";
import { AREA, buttonClass, FIELD, FIELD_CHIP, FOOTER_IN_ROW, HINT_IN_ROW } from "./blocks";
import { Field } from "./Field";
import { Footer } from "./Footer";
import { Section } from "./Section";
import { StatusLine } from "./StatusLine";
import { Switch } from "./Switch";

const NO_PLUGINS: Plugin[] = [];
const NO_SECRETS: Record<string, boolean> = {};
type SecretRow = { name: string; value: string };

/** One plugin's page: how its server starts (command, arguments, environment, secrets), then what it offers once it has
 *  been tested: the tools, each switched on for the plugin's view or not. `plugin` is null for one being added. */
export function PluginEditor({ plugin, onSaved }: { plugin: Plugin | null; onSaved: (id: string) => void }) {
  const { t, th } = useT();
  const plugins = useSettingsStore(s => s.settings.plugins ?? NO_PLUGINS);
  const stored = useSettingsStore(s => (plugin ? s.pluginsPage.secrets[plugin.id] : undefined) ?? NO_SECRETS);
  const message = useSettingsStore(s => s.pluginsPage.messages[plugin?.id ?? ""]);
  const test = useSettingsStore(s => (plugin ? s.pluginsPage.tests[plugin.id] : undefined));
  // what is typed, kept until Save
  const [name, setName] = useState(plugin?.name ?? "");
  const [mcp, setMcp] = useState(plugin?.mcp ?? "");
  const [command, setCommand] = useState(plugin?.command ?? "");
  const [args, setArgs] = useState((plugin?.args ?? []).join("\n"));
  const [env, setEnv] = useState(formatEnv(plugin?.env ?? {}));
  const [secrets, setSecrets] = useState<SecretRow[]>(
    (plugin?.secrets ?? []).map(secret => ({ name: secret, value: "" })),
  );
  const [sync, setSync] = useState(plugin?.sync ?? false);
  const [taken, setTaken] = useState(false);
  const [busy, setBusy] = useState(false);
  // switching it on for a name Claude Code already has replaces that server: say so
  const claudeName =
    mcp.trim() ||
    plugin?.id ||
    pluginId(
      name.trim(),
      plugins.map(other => other.id),
    );
  const wasSynced = !!plugin?.sync && claudeName === (plugin.mcp ?? plugin.id);
  useEffect(() => {
    if (!sync || wasSynced) return;
    let current = true;
    void claudeHas(claudeName).then(has => current && setTaken(has));
    return () => {
      current = false;
    };
  }, [sync, wasSynced, claudeName]);

  const setRow = (index: number, patch: Partial<SecretRow>) =>
    setSecrets(secrets.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  const names = secrets.map(row => row.name.trim()).filter(Boolean);
  const envMap = parseEnv(env);
  // a name is a secret or plain environment, not both; the backend would refuse the entry
  const clash = names.some(secret => secret in envMap) || new Set(names).size !== names.length;
  const complete = !!name.trim() && !!command.trim() && !clash;

  const save = async () => {
    setBusy(true);
    const entry: Plugin = {
      id:
        plugin?.id ??
        pluginId(
          name.trim(),
          plugins.map(other => other.id),
        ),
      name: name.trim(),
      command: command.trim(),
      args: parseArgs(args),
      env: envMap,
      secrets: names,
      on: plugin?.on ?? true,
      allowed: plugin?.allowed ?? [],
      views: plugin?.views ?? [],
      toolViews: plugin?.toolViews ?? {},
      mcp: mcp.trim() || null,
      ...(plugin?.source ? { source: plugin.source } : {}),
      sync,
    };
    const values = Object.fromEntries(secrets.filter(row => row.name.trim()).map(row => [row.name.trim(), row.value]));
    const ok = await savePlugin(
      entry,
      values,
      (plugin?.secrets ?? []).filter(secret => !names.includes(secret)),
    );
    if (ok) {
      setSecrets(secrets.filter(row => row.name.trim()).map(row => ({ name: row.name.trim(), value: "" })));
      if (!plugin) onSaved(entry.id);
      // every save starts the server afresh and reads its views, so the sidebar entry is there without a separate test
      await testPlugin(entry.id);
    }
    setBusy(false);
  };

  // the tools of this session's test, else the allowed ones by name (nothing is known of the rest until a test)
  const tools: PluginTool[] =
    test?.result?.tools ?? (plugin?.allowed ?? []).map(tool => ({ name: tool, view: null, app: true }));
  return (
    <>
      <Section title={t("plug.serverH")} rows>
        <Field label={t("plug.name")} id="plugname">
          <input
            className={FIELD}
            id="plugname"
            value={name}
            onChange={e => setName(e.target.value)}
            spellCheck={false}
          />
        </Field>
        <Field label={t("plug.mcp")} id="plugmcp" hint={<Html html={th("plug.mcpHint")} />}>
          <input
            className={`${FIELD} font-mono text-xs`}
            id="plugmcp"
            value={mcp}
            onChange={e => setMcp(e.target.value)}
            placeholder={plugin?.id ?? ""}
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
        <Field label={t("plug.command")} id="plugcommand" hint={<Html html={th("plug.commandHint")} />}>
          <input
            className={`${FIELD} font-mono text-xs`}
            id="plugcommand"
            value={command}
            onChange={e => setCommand(e.target.value)}
            placeholder="npx"
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
        <Field label={t("plug.args")} id="plugargs" hint={t("plug.argsHint")}>
          <textarea
            className={AREA}
            id="plugargs"
            value={args}
            onChange={e => setArgs(e.target.value)}
            spellCheck={false}
          />
        </Field>
        <Field label={t("plug.env")} id="plugenv" hint={<Html html={th("plug.envHint")} />}>
          <textarea
            className={AREA}
            id="plugenv"
            value={env}
            onChange={e => setEnv(e.target.value)}
            spellCheck={false}
          />
        </Field>
      </Section>
      <Section title={t("plug.cardClaude")} rows>
        <Field
          label={t("plug.cardClaude")}
          id="plugsync"
          hint={
            <>
              <Html html={th("plug.cardClaudeHint", { name: claudeName })} />
              {sync && !wasSynced && taken && (
                <span className="mt-1 block">
                  <StatusLine level="warn">{t("plug.cardClaudeExists", { name: claudeName })}</StatusLine>
                </span>
              )}
            </>
          }
        >
          <Switch id="plugsync" on={sync} onToggle={setSync} />
        </Field>
      </Section>
      <Section
        title={t("plug.secrets")}
        desc={t("plug.secretsHelp")}
        action={
          <button className={buttonClass()} onClick={() => setSecrets([...secrets, { name: "", value: "" }])}>
            {t("plug.addSecret")}
          </button>
        }
        footer={
          <Footer message={clash ? { text: t("plug.secretClash"), ok: false } : message}>
            <button className={buttonClass("primary")} disabled={busy || !complete} onClick={save}>
              {t("set.save")}
            </button>
          </Footer>
        }
      >
        {secrets.length ? (
          secrets.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                className={`${FIELD_CHIP} font-mono`}
                aria-label={t("plug.secretName")}
                value={row.name}
                onChange={e => setRow(index, { name: e.target.value })}
                placeholder="API_KEY"
                spellCheck={false}
                autoComplete="off"
              />
              <input
                className={`${FIELD_CHIP} min-w-0 flex-1`}
                type="password"
                aria-label={t("plug.secretValue")}
                value={row.value}
                onChange={e => setRow(index, { value: e.target.value })}
                placeholder={stored[row.name.trim()] ? t("plug.secretStored") : t("plug.secretValue")}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                className={buttonClass("ghost")}
                onClick={() => setSecrets(secrets.filter((_, at) => at !== index))}
              >
                {t("mail.remove")}
              </button>
            </div>
          ))
        ) : (
          <p className={HINT_IN_ROW}>{t("plug.secretsNone")}</p>
        )}
      </Section>
      {plugin && (
        <Section title={t("plug.toolsH")} desc={t("plug.toolsHelp")} rows={tools.length > 0}>
          {test?.busy ? (
            <div className={FOOTER_IN_ROW}>
              <span className="spinner"></span>
              <span className="text-xs text-s-muted">{t("plug.testing")}</span>
            </div>
          ) : tools.length ? (
            tools.map(tool => (
              <Field
                key={tool.name}
                label={<span className="font-mono text-xs">{tool.name}</span>}
                hint={tool.app ? tool.description : t("plug.toolHidden")}
              >
                {tool.app && (
                  <Switch
                    id={`tool-${tool.name}`}
                    on={plugin.allowed.includes(tool.name)}
                    label={tool.name}
                    onToggle={on => allowTool(plugin.id, tool.name, on)}
                  />
                )}
              </Field>
            ))
          ) : (
            <p className={HINT_IN_ROW}>{test?.result ? t("plug.toolsNone") : t("plug.noTools")}</p>
          )}
        </Section>
      )}
    </>
  );
}
