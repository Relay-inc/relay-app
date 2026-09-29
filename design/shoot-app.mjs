import { chromium } from '/Users/laurentmeersman/Documents/Antenna/craft-overnamemarkt/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'fs';
const snap = readFileSync('snapshot.json', 'utf8');
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.addInitScript(snap => {
  const cbs = {}; let n = 0; window.__cb = cbs;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (fn) => { const id = ++n; cbs[id] = fn; return id; },
    invoke: async (cmd, args) => {
      if (cmd === 'snapshot') return JSON.parse(snap);
      if (cmd === 'history' || cmd === 'agents') return [];
      if (cmd === 'pending') return window.__pending || [];
      if (cmd === 'plugin:event|listen') { window.__listener = args.handler; return 1; }
      if (cmd === 'send') { window.__sent = args; return null; }
      return null;
    },
  };
  localStorage.setItem('sel', 'Weemaes');
}, snap);
await p.goto('http://localhost:1420'); await p.waitForTimeout(800);
// simulate a turn: user typed, Claude reads, answers, then asks permission
await p.fill('#c', 'merge #741 als de checks groen zijn'); await p.press('#c', 'Enter');
const emit = ev => p.evaluate(ev => window.__cb[window.__listener]({ event: 'claude', payload: { project: 'Weemaes', event: ev } }), ev);
await emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'gh pr checks 741' } }] } });
await emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } });
await emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'Alle checks op **#741** zijn groen:\n\n| Check | Status |\n|---|---|\n| tests | ok |\n| phpstan | ok |\n\nIk merge nu.' }] } });
await p.evaluate(() => { window.__pending = [{ id: 'abc123def456', project: 'Weemaes', at: 1, tool_name: 'Bash', input: { command: 'gh pr merge 741 --squash' } }]; });
await p.waitForTimeout(1200);
await p.screenshot({ path: 'app-1280.png' });
console.log('sent:', JSON.stringify(await p.evaluate(() => window.__sent)));
console.log('errors:', errs);
await b.close();
