// The host side of MCP Apps (spec 2026-01-26, github.com/modelcontextprotocol/ext-apps): what a plugin's view may ask
// over postMessage and what the host answers. JSON-RPC 2.0, the view is the client. Without the DOM: the frame, the
// events and the backend are the application's (application/plugins/host.ts), this decides the answers.
//
// The official App Bridge (@modelcontextprotocol/ext-apps) is not used: it is built on the MCP SDK v2 packages and zod
// and speaks for a whole MCP client, where a view needs five methods. A view built with the official SDK talks to this
// the same way, it only sees JSON-RPC messages.

export const PROTOCOL = "2026-01-26";
/** Revisions a view may name in `ui/initialize`; any other gets ours back and decides whether it can work with it. */
const SUPPORTED = ["2026-01-26", "2025-11-21"];
const METHOD_NOT_FOUND = -32601;
const FAILED = -32000; // implementation-defined, what the spec uses for a denied or failed request

export type Rpc = { jsonrpc?: string; id?: number | string; method?: string; params?: Record<string, unknown> };
export type Reply =
  | { jsonrpc: "2.0"; id: number | string; result: unknown }
  | { jsonrpc: "2.0"; id: number | string; error: { code: number; message: string } };
/** What the host tells the view about itself (spec: HostContext), as far as Relay has it. */
export type HostContext = {
  theme: "light" | "dark";
  styles: { variables: Record<string, string> };
  /** The frame has the size of the pane: the view fills it (spec: a fixed container, so no `size-changed` is needed). */
  containerDimensions: { width: number; height: number };
  displayMode: "inline";
  availableDisplayModes: ["inline"];
  locale: string;
  platform: "desktop";
  userAgent: string;
};
/** The things a view asks the host to do. */
export type Host = {
  version: string;
  context: () => HostContext;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  openLink: (url: string) => Promise<void>;
};

export const isRpc = (data: unknown): data is Rpc =>
  typeof data === "object" && data !== null && (data as Rpc).jsonrpc === "2.0";
/** A link a view may have opened: a web or mail address, nothing that runs or reads a file. */
export const linkOk = (url: unknown): url is string => {
  try {
    return typeof url === "string" && ["http:", "https:", "mailto:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};
const failure = (id: number | string, code: number, message: string): Reply => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

/** The answer to a request from the view, undefined for what needs none: a notification (it has no `id`) or a response
 *  to a request of ours (`ui/resource-teardown`). */
export async function answer(message: Rpc, host: Host): Promise<Reply | undefined> {
  const { id, method, params = {} } = message;
  if (id === undefined || method === undefined) return undefined;
  const ok = (result: unknown): Reply => ({ jsonrpc: "2.0", id, result });
  try {
    if (method === "ui/initialize") {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok({
        protocolVersion: SUPPORTED.includes(asked) ? asked : PROTOCOL,
        hostInfo: { name: "relay", version: host.version },
        // what is offered is what is answered: tool calls and links, no resource reads, no model context, no files
        hostCapabilities: { serverTools: {}, openLinks: {} },
        hostContext: host.context(),
      });
    }
    if (method === "tools/call") {
      if (typeof params.name !== "string") return failure(id, -32602, "Invalid params");
      const args = params.arguments;
      return ok(
        await host.callTool(params.name, typeof args === "object" && args ? (args as Record<string, unknown>) : {}),
      );
    }
    if (method === "ui/open-link") {
      if (!linkOk(params.url)) return failure(id, FAILED, "Invalid URL");
      await host.openLink(params.url);
      return ok({});
    }
    // the view stays inline: the answer to a request for more is where it is
    if (method === "ui/request-display-mode") return ok({ mode: "inline" });
    if (method === "ping") return ok({});
    return failure(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
  } catch (error) {
    return failure(id, FAILED, String(error));
  }
}
