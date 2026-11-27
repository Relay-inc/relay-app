/** One MCP server as the settings page shows it (`agent_mcp`): `connector` is a claude.ai connector, signed in on claude.ai. */
export type McpServer = {
  name: string;
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled";
  error: string | null;
  connector: boolean;
};
export type McpOp =
  { op: "status" } | { op: "signin" | "reconnect"; server: string } | { op: "toggle"; server: string; on: boolean };
export type McpAction = "signin" | "connect" | "reconnect" | "on" | "off";

/** The one thing a row offers: a sign-in where one is needed (a claude.ai connector is connected on claude.ai), a new
 *  try for a failed one, a switch for the rest; a server still starting offers nothing. */
export function mcpAction({ status, connector }: McpServer): McpAction | null {
  switch (status) {
    case "needs-auth":
      return connector ? "connect" : "signin";
    case "failed":
      return "reconnect";
    case "disabled":
      return "on";
    case "connected":
      return "off";
    default:
      return null;
  }
}

/** The request behind an action. */
export const mcpOp = (action: McpAction, server: string): McpOp =>
  action === "on" || action === "off"
    ? { op: "toggle", server, on: action === "on" }
    : { op: action === "connect" ? "signin" : action, server };
