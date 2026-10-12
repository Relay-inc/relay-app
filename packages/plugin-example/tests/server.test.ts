import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

// The server over its real stdio, the way Relay's backend talks to it: one JSON-RPC message per line.
const server = fileURLToPath(new URL("../server.mjs", import.meta.url));

async function session() {
  const child = spawn(process.execPath, [server], { stdio: ["pipe", "pipe", "inherit"] });
  const iterator = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let id = 0;
  const call = async (method: string, params: object = {}) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params })}\n`);
    return JSON.parse((await iterator.next()).value as string);
  };
  return { call, close: () => child.kill() };
}

test("the handshake, the tool, the view", async () => {
  const { call, close } = await session();
  try {
    const init = await call("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    assert.equal(init.result.protocolVersion, "2025-11-25");
    const tools = (await call("tools/list")).result.tools;
    assert.equal(tools[0].name, "roll");
    assert.equal(tools[0]._meta.ui.resourceUri, "ui://relay-example/dice");
    const rolled = (await call("tools/call", { name: "roll", arguments: { sides: 6 } })).result;
    assert.ok(rolled.structuredContent.value >= 1 && rolled.structuredContent.value <= 6);
    // a bad number of sides falls back to a d6 instead of failing
    assert.equal((await call("tools/call", { name: "roll", arguments: { sides: "x" } })).result.structuredContent.sides, 6);
    const read = (await call("resources/read", { uri: "ui://relay-example/dice" })).result.contents[0];
    assert.equal(read.mimeType, "text/html;profile=mcp-app");
    assert.match(read.text, /ui\/initialize/);
    assert.equal((await call("resources/read", { uri: "ui://nope" })).error.code, -32602);
    assert.equal((await call("nope")).error.code, -32601);
  } finally {
    close();
  }
});
