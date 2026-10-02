import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

function probe(provider: string, fixture: string) {
  const script = readFileSync(new URL(`../../agent-${provider}/defaults.py`, import.meta.url), "utf8");
  return JSON.parse(execFileSync("python3", ["-c", `import json, os\nfrom pathlib import Path\n${script}\n${fixture}`], { encoding: "utf8" }));
}

test("Codex resolves configured model and model-specific effort across catalog pages", () => {
  const result = probe("codex", `
start = lambda *a, **kw: None
send = lambda *a: None
def rpc(p, rid, method, params):
    if method == 'initialize': return {}
    if method == 'config/read': return {'config': {'model': 'custom'}}
    if not params.get('cursor'): return {'data': [{'model': 'first', 'isDefault': True, 'defaultReasoningEffort': 'low'}], 'nextCursor': 'next'}
    return {'data': [{'model': 'custom', 'defaultReasoningEffort': 'high'}]}
print(json.dumps([probe('bin', '/vault', ''), probe('bin', '/vault', 'first')]))`);
  assert.deepEqual(result, [{ model: "custom", effort: "high" }, { model: "custom", effort: "low" }]);
});

test("Claude resolves aliases, model defaults, project effort and environment overrides", () => {
  const result = probe("claude", `
catalog = [{'value':'default','resolvedModel':'claude-opus-5-5','supportsEffort':True}, {'value':'opus','resolvedModel':'claude-opus-5-5','supportsEffort':True}]
settings = [{'model':'opus','effortLevel':'high'}]
a = resolve(settings, catalog, '', {})
b = resolve(settings + [{'modelSettings': {'claude-opus-5-5': {'effortLevel':'low'}}}], catalog, '', {})
c = resolve(settings, catalog, '', {'CLAUDE_CODE_EFFORT_LEVEL':'max'})
print(json.dumps([a,b,c]))`);
  assert.deepEqual(result.map((x: { effort: string }) => x.effort), ["medium", "low", "max"]);
  assert.equal(result[0].model, "claude-opus-5-5");
});

test("Pi uses transient CLI overrides instead of persisting a model setting", () => {
  const result = probe("pi", `
args, requests = [], []
def start(argv, **kw): args.append(argv)
def send(p, value): requests.append(value['type'])
def receive(p, match): return {'data': {'model': {'provider':'test','id':'first'}, 'thinkingLevel':'medium'}}
value = probe('pi', '/vault', 'test/second')
print(json.dumps({'args':args,'requests':requests,'value':value}))`);
  assert.deepEqual(result.requests, ["get_state", "get_state"]);
  assert.deepEqual(result.args[1], ["pi", "--mode", "rpc", "--no-session", "--model", "test/second"]);
  assert.equal(result.value.model, "test/first");
});

test("OpenCode respects agent model/variant and distinguishes base settings", () => {
  const result = probe("opencode", `
data = {'/config': {}, '/config/providers': {'providers':[]}, '/agent': [{'name':'build','model':{'providerID':'test','modelID':'m'},'variant':'high'}]}
http_server = lambda *a: lambda path: data[path]
print(json.dumps([probe('bin', '/v', ''), probe('bin', '/v', 'test/other')]))`);
  assert.deepEqual(result, [{ model: "test/m", effort: "high" }, { model: "test/m", effort: "base" }]);
});
