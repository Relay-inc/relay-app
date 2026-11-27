import { test } from "node:test";
import assert from "node:assert/strict";
import { mcpAction, mcpOp, type McpServer } from "./mcp.ts";

const server = (status: McpServer["status"], connector = false): McpServer => ({
  name: "acme-docs",
  status,
  error: null,
  connector,
});

test("a row offers the one action that fits its state", () => {
  assert.equal(mcpAction(server("needs-auth")), "signin");
  assert.equal(mcpAction(server("needs-auth", true)), "connect");
  assert.equal(mcpAction(server("failed")), "reconnect");
  assert.equal(mcpAction(server("disabled")), "on");
  assert.equal(mcpAction(server("connected")), "off");
  assert.equal(mcpAction(server("pending")), null);
});

test("an action becomes the request the backend takes", () => {
  assert.deepEqual(mcpOp("connect", "claude.ai Linear"), { op: "signin", server: "claude.ai Linear" });
  assert.deepEqual(mcpOp("reconnect", "acme-docs"), { op: "reconnect", server: "acme-docs" });
  assert.deepEqual(mcpOp("off", "acme-docs"), { op: "toggle", server: "acme-docs", on: false });
  assert.deepEqual(mcpOp("on", "acme-docs"), { op: "toggle", server: "acme-docs", on: true });
});
