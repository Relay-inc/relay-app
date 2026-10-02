import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("command discovery times out and reaps a provider that never answers", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-discovery-"));
  try {
    const prelude = readFileSync(new URL("../discover.py", import.meta.url), "utf8").replace("signal.alarm(15)", "signal.alarm(1)");
    const output = execFileSync("python3", ["-c", `${prelude}
def probe(*args):
    p = start([sys.executable, '-c', 'import time; time.sleep(60)'])
    with open(sys.argv[1], 'w') as f: f.write(str(p.pid))
    return receive(p, lambda _: True)
main()
`, join(dir, "pid")], { encoding: "utf8", timeout: 5000 });
    assert.deepEqual(JSON.parse(output), {});
    const pid = Number(readFileSync(join(dir, "pid"), "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Codex discovery excludes disabled skills and keeps built-ins distinct from skill names", () => {
  const script = readFileSync(new URL("../../agent-codex/commands.py", import.meta.url), "utf8");
  const output = execFileSync("python3", ["-c", `import json
${script}
start = lambda *a, **kw: None
send = lambda *a: None
rpc = lambda *a: {'data':[{'skills':[{'name':'review','description':'Review skill'},{'name':'hidden','enabled':False},{'name':'review'}]}]}
print(json.dumps(probe('codex', '/v', '')))
`], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(output).map((c: { name: string }) => c.name), ["compact", "review", "skill:review"]);
});
