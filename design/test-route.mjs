import { chromium } from '/Users/laurentmeersman/Documents/Antenna/craft-overnamemarkt/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'fs';
const snap = readFileSync('snapshot.json', 'utf8');
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
async function page() {
  const p = await b.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
  p.errs = []; p.on('pageerror', e => p.errs.push(String(e)));
  await p.addInitScript(snap => {
    const cbs = {}; let n = 0; window.__cb = cbs; window.__sent = []; window.__moved = [];
    window.__TAURI_INTERNALS__ = { transformCallback: fn => { const id = ++n; cbs[id] = fn; return id; },
      invoke: async (cmd, a) => {
        if (cmd === 'snapshot') return JSON.parse(snap);
        if (['history', 'agents', 'pending', 'chats'].includes(cmd)) return [];
        if (cmd === 'plugin:event|listen') { window.__listener = a.handler; return 1; }
        if (cmd === 'send') window.__sent.push(a);
        if (cmd === 'move_chat') window.__moved.push(a);
        return null; } };
  }, snap);
  await p.goto('http://localhost:1420'); await p.waitForTimeout(600);
  return p;
}
const newGen = async p => { await p.click('#addgen'); await p.waitForTimeout(150); };
const title = p => p.textContent('#t');

// 1. one project named -> goes to that project
let p = await page(); await newGen(p);
await p.fill('#c', 'waar staan we met weesoft?'); await p.press('#c', 'Enter'); await p.waitForTimeout(300);
console.log('1 doorsturen:', await title(p), JSON.stringify(await p.evaluate(() => window.__sent.map(s => s.project))),
  'algemene gesprekken:', await p.evaluate(() => Object.keys(JSON.parse(localStorage.gens)).length));

// 2. two projects named -> choice
p = await page(); await newGen(p);
await p.fill('#c', 'vergelijk cloet en joule'); await p.press('#c', 'Enter'); await p.waitForTimeout(300);
console.log('2 keuze:', await p.$$eval('[data-route-to]', bs => bs.map(b => b.textContent)));
await p.click('[data-route-to="Cloet"]'); await p.waitForTimeout(300);
console.log('  gekozen:', await title(p), JSON.stringify(await p.evaluate(() => window.__sent.map(s => s.project))));

// 3. general chat, no project in the text, then Claude reads a project note -> move bar
p = await page(); await newGen(p);
await p.fill('#c', 'hoe gaat het met de facturatie?'); await p.press('#c', 'Enter'); await p.waitForTimeout(200);
const key = await p.evaluate(() => window.__sent[0].project);
const emit = ev => p.evaluate(([k, ev]) => window.__cb[window.__listener]({ event: 'claude', payload: { project: k, event: ev } }), [key, ev]);
await emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/x/Contexts/Antenna/Portfolio/Weemaes/Weemaes.md' } }] } });
await emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'De automatische saldofacturatie draait sinds 14/9.' }] } });
await emit({ type: 'result', subtype: 'success', result: '' });
await p.waitForTimeout(300);
console.log('3 verhuisbalk:', (await p.textContent('#movebar')).replace(/\s+/g, ' ').trim(), '| naam in sidebar:', await p.textContent('.row.sel .nm'));
await p.screenshot({ path: 'app-movebar.png' });
await p.click('[data-move]'); await p.waitForTimeout(300);
console.log('  na verhuizen:', await title(p), JSON.stringify(await p.evaluate(() => window.__moved)));
console.log('fouten:', p.errs);
await b.close();
