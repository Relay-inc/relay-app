import { chromium } from '/Users/laurentmeersman/Documents/Antenna/craft-overnamemarkt/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'fs';
const snap = readFileSync('snapshot.json', 'utf8'), agents = readFileSync('agents.json', 'utf8');
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.addInitScript(([snap, agents]) => {
  window.__reset = [];
  window.__TAURI_INTERNALS__ = { transformCallback: () => 1,
    invoke: async (cmd, a) => {
      if (cmd === 'snapshot') return JSON.parse(snap);
      if (cmd === 'agents') return JSON.parse(agents);
      if (cmd === 'chats') return ['Resolvus'];
      if (cmd === 'history') return [{ type: 'user', message: { content: 'is er nieuws van Joachim?' } }];
      if (cmd === 'reset') window.__reset.push(a.project);
      if (['app_sids', 'history_sid', 'pending'].includes(cmd)) return [];
      if (cmd === 'plugin:event|listen') return 1;
      return null; } };
}, [snap, agents]);
await p.goto('http://localhost:1420'); await p.waitForTimeout(900);
const count = () => p.$$eval('.subrow', r => r.length);
const before = await count();
await p.hover('.subrow[data-k="Resolvus"]'); await p.click('.subrow[data-k="Resolvus"] .x'); await p.waitForTimeout(300);
console.log('app-gesprek gesloten, reset:', JSON.stringify(await p.evaluate(() => window.__reset)), '| subitems', before, '->', await count());
const t = await p.$('.row.term'); const k = await t.getAttribute('data-k');
await t.hover(); await p.click(`[data-k="${k}"] .x`); await p.waitForTimeout(300);
console.log('terminal verborgen:', !(await p.$(`[data-k="${k}"]`)), '| subitems nu', await count());
await p.reload(); await p.waitForTimeout(900);
console.log('na herladen nog weg:', !(await p.$(`[data-k="${k}"]`)));
console.log('fouten:', errs); await b.close();
