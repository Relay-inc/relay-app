import { useEffect, useState } from "react";
import { useSettingsStore } from "../../../application/settings/store";
import { importPlugin, loadPlugins, removePlugin, switchPlugin } from "../../../application/settings/plugins";
import type { Plugin } from "../../../domain/plugins/types";
import { Html } from "../../components/Html";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { BUTTON_GLYPH, buttonClass, TILE } from "./blocks";
import { Footer } from "./Footer";
import { PluginEditor } from "./PluginEditor";
import { Section } from "./Section";
import { SettingsFold } from "./SettingsFold";
import { StatusLine } from "./StatusLine";

const NO_PLUGINS: Plugin[] = [];

/** Plugins: every MCP server added, a switch for each, and a page per plugin to set it up (PluginEditor). A new plugin is
 *  added by hand or taken over from Claude Code's MCP config. */
export function PluginsPage({ active }: { active: boolean }) {
  const { t, th, tn } = useT();
  const plugins = useSettingsStore(s => s.settings.plugins ?? NO_PLUGINS);
  const imports = useSettingsStore(s => s.pluginsPage.imports);
  const message = useSettingsStore(s => s.pluginsPage.messages[""]);
  const loaded = useSettingsStore(s => s.pluginsPage.loaded);
  // the plugin whose page is open, "new" for a plugin being added, or null for the list
  const [detail, setDetail] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
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

  const status = (plugin: Plugin) =>
    plugin.view ? (
      <StatusLine level="ok">
        {t("plug.viewStatus")}, {tn("plug.allowed", plugin.allowed.length)}
      </StatusLine>
    ) : (
      <StatusLine level="off">{t("plug.noView")}</StatusLine>
    );
  const take = async (name: string) => {
    setImporting(false);
    const id = await importPlugin(name);
    if (id) setDetail(id);
  };
  return (
    <Section
      title={t("set.tab.plugins")}
      desc={<Html html={th("plug.help")} />}
      list
      action={
        <>
          {imports.length > 0 && (
            <button className={buttonClass()} onClick={() => setImporting(!importing)} aria-expanded={importing}>
              {t("plug.import")}
            </button>
          )}
          <button className={buttonClass()} onClick={() => setDetail("new")}>
            {t("plug.add")}
          </button>
        </>
      }
      footer={message && <Footer message={message} />}
    >
      {importing && (
        <div className="grid gap-1 border-b border-s-border px-3.5 py-3">
          <p className="text-xs text-s-muted">{t("plug.importHelp")}</p>
          <div className="flex flex-wrap gap-1.5">
            {imports.map(name => (
              <button key={name} className={buttonClass()} onClick={() => take(name)}>
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
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
  );
}
