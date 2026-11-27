import { useEffect } from "react";
import { mcpAction, type McpServer } from "../../../domain/agents/mcp";
import { loadMcp, runMcp, useMcpStore } from "../../../application/settings/mcp";
import { useT } from "../../hooks/useT";
import { buttonClass, ERROR_MESSAGE } from "./blocks";
import { Section } from "./Section";
import { StatusLine } from "./StatusLine";

const LEVEL = { connected: "ok", failed: "warn", "needs-auth": "warn", pending: "off", disabled: "off" } as const;
const ROW = "flex items-center gap-3 px-3.5 py-3 [&+&]:border-t [&+&]:border-s-border";

/** The MCP servers Claude Code runs itself in this vault, the second section of Settings › Plugins: each with its
 *  state, the error of a failed one (one muted line, the whole text on hover), the one action that fits and, for one
 *  Relay can take over (`importable`), Import. `active` loads the list when the page shows. */
export function McpServers({
  active,
  importable,
  onImport,
}: {
  active: boolean;
  importable: (name: string) => boolean;
  onImport: (name: string) => void;
}) {
  const { t } = useT();
  const servers = useMcpStore(s => s.servers);
  const busy = useMcpStore(s => s.busy);
  const error = useMcpStore(s => s.error);
  useEffect(() => {
    if (active) void loadMcp();
  }, [active]);

  const row = (server: McpServer) => {
    const action = mcpAction(server);
    const here = busy?.name === server.name;
    const text = server.error ?? (error?.name === server.name ? error.text : null);
    return (
      <div key={server.name} className={ROW}>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate font-mono text-[13px] text-s-fg" title={server.name}>
            {server.name}
          </span>
          {server.connector && <span className="truncate text-xs text-s-muted">{t("mcp.connector")}</span>}
          {text && (
            <span
              className={`truncate text-xs ${error?.name === server.name ? "text-s-err" : "text-s-faint"}`}
              title={text}
            >
              {text}
            </span>
          )}
        </div>
        <span className="flex w-28 flex-none">
          <StatusLine level={LEVEL[server.status]}>{t(`mcp.state.${server.status}`)}</StatusLine>
        </span>
        <span className="flex w-16 flex-none justify-end">
          {importable(server.name) && (
            <button className={buttonClass()} onClick={() => onImport(server.name)}>
              {t("plug.import")}
            </button>
          )}
        </span>
        <span className="flex w-36 flex-none justify-end">
          {action && (
            <button
              className={buttonClass(action === "signin" || action === "connect" ? "primary" : "plain")}
              disabled={!!busy}
              onClick={() => runMcp(action, server.name)}
            >
              {here && action === "signin" ? t("mcp.waiting") : t(`mcp.${action}`)}
            </button>
          )}
        </span>
      </div>
    );
  };

  return (
    <Section
      title={t("plug.claudeH")}
      desc={t("plug.importHelp")}
      list
      action={
        <button className={buttonClass()} disabled={!!busy || !servers} onClick={() => loadMcp(true)}>
          {t("ag.recheck")}
        </button>
      }
      footer={error?.name === "" ? <span className={ERROR_MESSAGE}>{error.text}</span> : undefined}
    >
      {!servers ? (
        <span className="inline-flex items-center gap-1.5 px-3.5 py-3 text-xs text-s-muted">
          <span className="spinner"></span>
          {t("mcp.checking")}
        </span>
      ) : servers.length ? (
        servers.map(row)
      ) : (
        <span className="block px-3.5 py-3 text-xs text-s-faint">{t("mcp.none")}</span>
      )}
    </Section>
  );
}
