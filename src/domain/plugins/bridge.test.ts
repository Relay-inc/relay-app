import { test } from "node:test";
import assert from "node:assert/strict";
import { answer, isRpc, linkOk, PROTOCOL, type Host } from "./bridge.ts";

const calls: string[] = [];
const host: Host = {
  version: "1.2.3",
  context: () => ({
    theme: "dark",
    styles: { variables: { "--color-text-primary": "#fff" } },
    containerDimensions: { width: 800, height: 600 },
    displayMode: "inline",
    availableDisplayModes: ["inline"],
    locale: "en",
    platform: "desktop",
    userAgent: "relay/1.2.3",
  }),
  callTool: async (name, args) => {
    calls.push(`${name} ${JSON.stringify(args)}`);
    if (name === "refused") throw new Error("not allowed");
    return { content: [{ type: "text", text: "ok" }] };
  },
  openLink: async url => {
    calls.push(`open ${url}`);
  },
};

test("ui/initialize names the revision, the host and what it offers", async () => {
  const reply = await answer(
    { jsonrpc: "2.0", id: 1, method: "ui/initialize", params: { protocolVersion: "2025-11-21" } },
    host,
  );
  assert.deepEqual(reply, {
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2025-11-21",
      hostInfo: { name: "relay", version: "1.2.3" },
      hostCapabilities: { serverTools: {}, openLinks: {} },
      hostContext: host.context(),
    },
  });
  const other = await answer(
    { jsonrpc: "2.0", id: 2, method: "ui/initialize", params: { protocolVersion: "1999" } },
    host,
  );
  assert.equal((other as { result: { protocolVersion: string } }).result.protocolVersion, PROTOCOL);
});

test("tools/call goes to the host, its refusal comes back as an error", async () => {
  assert.deepEqual(
    await answer({ id: 3, method: "tools/call", params: { name: "roll", arguments: { sides: 6 } } }, host),
    {
      jsonrpc: "2.0",
      id: 3,
      result: { content: [{ type: "text", text: "ok" }] },
    },
  );
  assert.ok(calls.includes('roll {"sides":6}'));
  const refused = await answer({ id: 4, method: "tools/call", params: { name: "refused" } }, host);
  assert.deepEqual(refused, { jsonrpc: "2.0", id: 4, error: { code: -32000, message: "Error: not allowed" } });
  assert.ok(calls.includes("refused {}"), "no arguments is an empty object");
  assert.equal(
    ((await answer({ id: 5, method: "tools/call", params: {} }, host)) as { error: { code: number } }).error.code,
    -32602,
  );
});

test("links: web and mail only", async () => {
  assert.ok(
    linkOk("https://example.com/a") &&
      linkOk("mailto:a@b.c") &&
      !linkOk("javascript:alert(1)") &&
      !linkOk("file:///etc/passwd") &&
      !linkOk("nope") &&
      !linkOk(1),
  );
  assert.ok(
    "result" in (await answer({ id: 6, method: "ui/open-link", params: { url: "https://example.com" } }, host))!,
  );
  assert.ok(calls.includes("open https://example.com"));
  const bad = await answer({ id: 7, method: "ui/open-link", params: { url: "file:///etc/passwd" } }, host);
  assert.ok("error" in bad!);
  assert.ok(!calls.includes("open file:///etc/passwd"));
});

test("what has no answer, and what is not supported", async () => {
  assert.equal(await answer({ method: "ui/notifications/initialized" }, host), undefined);
  assert.equal(await answer({ id: 1, result: {} } as never, host), undefined, "a response to a request of ours");
  assert.deepEqual(await answer({ id: 8, method: "ui/request-display-mode", params: { mode: "fullscreen" } }, host), {
    jsonrpc: "2.0",
    id: 8,
    result: { mode: "inline" },
  });
  assert.equal(
    ((await answer({ id: 9, method: "resources/read", params: {} }, host)) as { error: { code: number } }).error.code,
    -32601,
  );
  assert.ok(isRpc({ jsonrpc: "2.0" }) && !isRpc("x") && !isRpc(null) && !isRpc({ id: 1 }));
});
