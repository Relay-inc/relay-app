import { mcpOp, type McpAction, type McpServer } from "../../domain/agents/mcp";
import * as backend from "../../infrastructure/backend";
import { makeStore } from "../make-store";

// Settings › Agents › Claude Code › MCP servers: the list, and the one action that runs at a time on a row.
type McpState = {
  servers: McpServer[] | null;
  /** The row an action runs on (a sign-in waits for the browser, up to three minutes) */
  busy: { name: string; action: McpAction } | null;
  /** What went wrong on a row, or on the list when `name` is "" */
  error: { name: string; text: string } | null;
};
export const useMcpStore = makeStore<McpState>(() => ({ servers: null, busy: null, error: null }));
const set = useMcpStore.setState;

const PROVIDER = "claude";

/** The servers now; `quiet` keeps the old list shown meanwhile. */
export async function loadMcp(quiet = false) {
  if (!quiet) set(draft => void (draft.servers = null));
  try {
    const servers = await backend.agentMcp(PROVIDER, { op: "status" });
    set(draft => void (draft.servers = servers));
  } catch (error) {
    set(draft => void ((draft.servers = []), (draft.error = { name: "", text: String(error) })));
  }
}

/** One action on a row, then the list again (the answer of the action is that list). */
export async function runMcp(action: McpAction, server: string) {
  if (useMcpStore.getState().busy) return;
  set(draft => void ((draft.busy = { name: server, action }), (draft.error = null)));
  try {
    const servers = await backend.agentMcp(PROVIDER, mcpOp(action, server));
    set(draft => void (draft.servers = servers));
  } catch (error) {
    set(draft => void (draft.error = { name: server, text: String(error) }));
    await loadMcp(true);
  } finally {
    set(draft => void (draft.busy = null));
  }
}
