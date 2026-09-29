// Minimal stdio MCP server: the app's permission tool. Logs every request, answers it.
import { createInterface } from 'readline';
import { appendFileSync } from 'fs';
const LOG = process.env.LOG, DECISION = process.env.DECISION || 'allow';
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  const req = JSON.parse(line);
  if (req.method === 'initialize') return send({ jsonrpc: '2.0', id: req.id, result: {
    protocolVersion: req.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'vaultperm', version: '0.1' } } });
  if (req.method === 'tools/list') return send({ jsonrpc: '2.0', id: req.id, result: { tools: [{
    name: 'approve', description: 'Ask Laurent to approve a tool call',
    inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] } }] } });
  if (req.method === 'tools/call') {
    const a = req.params.arguments;
    appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...a }) + '\n');
    let d;
    if (a.tool_name === 'AskUserQuestion') {
      const answers = Object.fromEntries((a.input.questions || []).map(q => [q.question, q.options?.[1]?.label ?? 'ja']));
      d = { behavior: 'allow', updatedInput: { ...a.input, answers } };
    } else d = DECISION === 'deny' ? { behavior: 'deny', message: 'Laurent weigerde dit in de app' } : { behavior: 'allow', updatedInput: a.input };
    return send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: JSON.stringify(d) }] } });
  }
  if (req.id !== undefined) send({ jsonrpc: '2.0', id: req.id, result: {} });
});
