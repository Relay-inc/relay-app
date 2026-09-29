import { chromium } from '/Users/laurentmeersman/Documents/Antenna/craft-overnamemarkt/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'fs';
const snap = readFileSync('snapshot.json', 'utf8');
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.addInitScript(snap => {
  const cbs = {}; let n = 0; window.__cb = cbs; window.__sent = [];
  window.__TAURI_INTERNALS__ = { transformCallback: fn => { const id = ++n; cbs[id] = fn; return id; },
    invoke: async (cmd, a) => {
      if (cmd === 'snapshot') return JSON.parse(snap);
      if (cmd === 'chats') return ['Resolvus'];
      if (cmd === 'history') return a.project === 'Resolvus' ? [{ type: 'user', message: { content: 'is er nieuws van Joachim?' } }, { type: 'assistant', message: { content: [{ type: 'text', text: 'Nee, zijn laatste mail is van 21/8.' }] } }] : [];
      if (['agents', 'pending'].includes(cmd)) return [];
      if (cmd === 'plugin:event|listen') { window.__listener = a.handler; return 1; }
      if (cmd === 'send') window.__sent.push(a);
      return null; } };
}, snap);
await p.goto('http://localhost:1420'); await p.waitForTimeout(700);
const subs = () => p.$$eval('.row', rs => rs.map(r => (r.classList.contains('subrow') ? '   └ ' : '') + r.querySelector('.nm').textContent).filter(t => /Resolvus|└|Nieuw/.test(t)));
console.log('start:', await subs());
// new general chat that names Resolvus
await p.click('[data-add=""]'); await p.fill('#c', 'maak een samenvatting voor Pieter over resolvus'); await p.press('#c', 'Enter'); await p.waitForTimeout(300);
console.log('na eerste bericht:', await p.textContent('#t'), '|', await subs(), '| send name:', (await p.evaluate(() => window.__sent[0].name)));
// + on the project row
await p.hover('.prow[data-p="Resolvus"]'); await p.click('[data-add="Resolvus"]'); await p.waitForTimeout(200);
console.log('na +:', await p.textContent('#t'), '| composer placeholder:', await p.getAttribute('#c', 'placeholder'), '|', await subs());
// leave the empty draft: it must disappear
await p.click('.row[data-k="__wait"]'); await p.waitForTimeout(200);
console.log('lege draft weg:', await subs());
await p.click('.prow[data-p="Resolvus"]'); await p.waitForTimeout(300);
await p.screenshot({ path: 'app-sub.png' });
console.log('fouten:', errs);
await b.close();
