import { chromium } from '/Users/laurentmeersman/Documents/Antenna/craft-overnamemarkt/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'fs';
const snap = readFileSync('snapshot.json', 'utf8');
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 2 });
await p.addInitScript(snap => { const cbs = {}; let n = 0; window.__cb = cbs;
  window.__TAURI_INTERNALS__ = { transformCallback: fn => { const id = ++n; cbs[id] = fn; return id; }, invoke: async (c, a) => {
    if (c === 'snapshot') return JSON.parse(snap); if (c === 'get_settings') return { vault: '', projects: {}, overrides: {} };
    if (c === 'plugin:event|listen') { if (a.event === 'claude') window.__l = a.handler; return 1; }
    return ['agents', 'app_sids', 'pending', 'history_sid', 'chats', 'history'].includes(c) ? [] : null; } }; }, snap);
await p.goto('http://localhost:1420'); await p.waitForTimeout(700);
await p.click('[data-add=""]'); await p.fill('#c', 'hoe staat het met de facturatie?'); await p.press('#c', 'Enter'); await p.waitForTimeout(1300);
console.log('direct na versturen:', (await p.textContent('.working')).replace(/\s+/g, ' ').trim());
const k = await p.evaluate(() => Object.keys(JSON.parse(localStorage.chats))[0]);
await p.evaluate(k => window.__cb[window.__l]({ event: 'claude', payload: { project: k, event: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Read', input: { file_path: '/v/Weemaes.md' } }] } } } }), k);
await p.waitForTimeout(1100);
console.log('tijdens een tool:', (await p.textContent('.working')).replace(/\s+/g, ' ').trim());
await p.screenshot({ path: 'app-working.png' });
await p.evaluate(k => window.__cb[window.__l]({ event: 'claude', payload: { project: k, event: { type: 'result', subtype: 'success', result: '' } } }), k);
await p.waitForTimeout(200);
console.log('na het antwoord weg:', !(await p.$('.working')));
await b.close();
