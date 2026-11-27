import { useEffect, useState } from "react";
import { useSettingsStore } from "../../../application/settings/store";
import { importPlugin, loadPlugins, removePlugin, switchPlugin } from "../../../application/settings/plugins";
import type { Plugin } from "../../../domain/plugins/types";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { BUTTON_GLYPH, buttonClass, TILE } from "./blocks";
import { Footer } from "./Footer";
import { McpServers } from "./McpServers";
import { PluginEditor } from "./PluginEditor";
import { Section } from "./Section";
import { SettingsFold } from "./SettingsFold";
import { StatusLine } from "./StatusLine";

const NO_PLUGINS: Plugin[] = [];

/** Plugins: every MCP server, by who runs it. Relay's own, each with a switch and a page to set it up (PluginEditor),
 *  added by hand or taken over from Claude Code's MCP config; and the ones Claude Code runs (McpServers). */
export function PluginsPage({ active }: { active: boolean }) {
  const { t, tn } = useT();
  const plugins = useSettingsStore(s => s.settings.plugins ?? NO_PLUGINS);
  const imports = useSettingsStore(s => s.pluginsPage.imports);
  const message = useSettingsStore(s => s.pluginsPage.messages[""]);
  const loaded = useSettingsStore(s => s.pluginsPage.loaded);
  // the plugin whose page is open, "new" for a plugin being added, or null for the list
  const [detail, setDetail] = useState<string | null>(null);
  useEffect(() => {
    if (active) void loadPlugins();
  }, [active]);
  if (!loaded) return null;

  const open = plugins.find(plugin => plugin.id === detail);
  if (detail === "new" || open)
    return (
      <>
        <header className="grid gap-3">
          <button className={`${buttonClass("ghost")} -ml-2 justify-self-start`} onClick={() => setDetail(null)}>
            <Icon name="left" className={BUTTON_GLYPH} />
            {t("set.tab.plugins")}
          </button>
          <h1 className="text-base font-semibold text-s-fg">{open?.name ?? t("plug.add")}</h1>
        </header>
        <PluginEditor key={detail} plugin={open ?? null} onSaved={setDetail} />
        {open && (
          <Section
            title={t("plug.removeH", { name: open.name })}
            desc={t("plug.removeHelp")}
            action={
              <button
                className={buttonClass("danger")}
                onClick={async () => (await removePlugin(open.id)) && setDetail(null)}
              >
                {t("ag.remove")}
              </button>
            }
          />
        )}
      </>
    );

  const status = (plugin: Plugin) => (
    <StatusLine level={plugin.views.length ? "ok" : "off"}>
      {plugin.views.length ? t("plug.viewStatus") : t("plug.noView")} · {tn("plug.allowed", plugin.allowed.length)}
    </StatusLine>
  );
  const take = async (name: string) => {
    const id = await importPlugin(name);
    if (id) setDetail(id);
  };
  return (
    <>
      <div className="flex items-end gap-3">
        <p className="min-w-0 flex-1 text-xs leading-[1.45] text-s-muted">{t("plug.intro")}</p>
        <button className={buttonClass("primary")} onClick={() => setDetail("new")}>
          {t("plug.add")}
        </button>
      </div>
      <Section title={t("plug.relayH")} info={t("plug.help")} list>
        {plugins.length ? (
          plugins.map(plugin => (
            <SettingsFold
              key={plugin.id}
              id={plugin.id}
              nav
              on={plugin.on}
              icon={<Icon name="puzzle" className={TILE} />}
              name={plugin.name}
              status={status(plugin)}
              onSwitch={on => switchPlugin(plugin.id, on)}
              onToggle={() => setDetail(plugin.id)}
            />
          ))
        ) : (
          <p className="px-3.5 py-3 text-xs text-s-faint">{t("plug.empty")}</p>
        )}
      </Section>
      <McpServers
        active={active}
        importable={name => imports.includes(name) && !plugins.some(plugin => plugin.name === name)}
        onImport={take}
      />
      {message && <Footer message={message} />}
    </>
  );
}
