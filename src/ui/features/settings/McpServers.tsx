import { useEffect } from "react";
import { mcpAction, type McpServer } from "../../../domain/agents/mcp";
import { loadMcp, runMcp, useMcpStore } from "../../../application/settings/mcp";
import { useT } from "../../hooks/useT";
import { buttonClass, ERROR_MESSAGE } from "./blocks";
import { Section } from "./Section";
import { StatusLine } from "./StatusLine";

const LEVEL = { connected: "ok", failed: "warn", "needs-auth": "warn", pending: "off", disabled: "off" } as const;

/** The MCP servers Claude has in this vault: each with its state, the error of a failed one (one muted line, the whole
 *  text on hover) and the one action that fits. The MCP servers tab of Settings › Agents. */
export function McpServers() {
  const { t } = useT();
  const servers = useMcpStore(s => s.servers);
  const busy = useMcpStore(s => s.busy);
  const error = useMcpStore(s => s.error);
  useEffect(() => {
    loadMcp();
  }, []);

  const row = (server: McpServer) => {
    const action = mcpAction(server);
    const here = busy?.name === server.name;
    const text = server.error ?? (error?.name === server.name ? error.text : null);
    return (
      <div key={server.name} className="grid gap-0.5">
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-sm text-s-fg" title={server.name}>
            {server.name}
          </span>
          <StatusLine level={LEVEL[server.status]}>{t(`mcp.state.${server.status}`)}</StatusLine>
          <span className="flex w-36 justify-end">
            {action && (
              <button className={buttonClass("ghost")} disabled={!!busy} onClick={() => runMcp(action, server.name)}>
                {here && action === "signin" ? t("mcp.waiting") : t(`mcp.${action}`)}
              </button>
            )}
          </span>
        </div>
        {text && (
          <span
            className={`truncate text-xs ${error?.name === server.name ? "text-s-err" : "text-s-faint"}`}
            title={text}
          >
            {text}
          </span>
        )}
      </div>
    );
  };

  return (
    <Section
      title={t("mcp.title")}
      desc={t("mcp.help")}
      action={
        <button className={buttonClass("ghost")} disabled={!!busy || !servers} onClick={() => loadMcp(true)}>
          {t("ag.recheck")}
        </button>
      }
      footer={error?.name === "" ? <span className={ERROR_MESSAGE}>{error.text}</span> : undefined}
    >
      {!servers ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-s-muted">
          <span className="spinner"></span>
          {t("mcp.checking")}
        </span>
      ) : servers.length ? (
        <div className="grid gap-2">{servers.map(row)}</div>
      ) : (
        <span className="text-xs text-s-faint">{t("mcp.none")}</span>
      )}
    </Section>
  );
}
