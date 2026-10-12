// An MCP server over stdio (one JSON-RPC message per line) with one tool, `roll`, and the MCP Apps view that calls it.
// No SDK: what a plugin needs is this small. Relay starts it from Settings › Plugins:
//   command: node    args: <path to this file>
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";

const VIEW = "ui://relay-example/dice";
const MIME = "text/html;profile=mcp-app";
const html = readFileSync(new URL("./view.html", import.meta.url), "utf8");

const tools = [
  {
    name: "roll",
    description: "Roll a die with the given number of sides.",
    inputSchema: { type: "object", properties: { sides: { type: "integer", minimum: 2, maximum: 100, default: 6 } } },
    // the view this tool's result is shown in (MCP Apps: _meta.ui.resourceUri)
    _meta: { ui: { resourceUri: VIEW } },
  },
];

function roll({ sides = 6 } = {}) {
  const n = Number.isInteger(sides) && sides >= 2 && sides <= 100 ? sides : 6;
  const value = 1 + Math.floor(Math.random() * n);
  return { content: [{ type: "text", text: `Rolled ${value} on a d${n}` }], structuredContent: { value, sides: n } };
}

const methods = {
  initialize: params => ({
    protocolVersion: params.protocolVersion,
    capabilities: { tools: {}, resources: {} },
    serverInfo: { name: "relay-example", version: "0.1.0" },
  }),
  ping: () => ({}),
  "tools/list": () => ({ tools }),
  "tools/call": params => {
    if (params.name !== "roll") throw { code: -32602, message: `Unknown tool: ${params.name}` };
    return roll(params.arguments);
  },
  "resources/list": () => ({ resources: [{ uri: VIEW, name: "Dice", mimeType: MIME }] }),
  "resources/read": params => {
    if (params.uri !== VIEW) throw { code: -32602, message: `Unknown resource: ${params.uri}` };
    return { contents: [{ uri: VIEW, mimeType: MIME, text: html, _meta: { ui: { prefersBorder: false } } }] };
  },
};

const send = message => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

createInterface({ input: process.stdin }).on("line", line => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return; // a notification (notifications/initialized): nothing to answer
  try {
    const handler = methods[message.method];
    if (!handler) throw { code: -32601, message: `Method not found: ${message.method}` };
    send({ id: message.id, result: handler(message.params ?? {}) });
  } catch (error) {
    send({ id: message.id, error: { code: error.code ?? -32603, message: error.message ?? String(error) } });
  }
});
