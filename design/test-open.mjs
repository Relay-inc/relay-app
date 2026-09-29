import { chromium } from '/Users/laurentmeersman/Documents/Antenna/craft-overnamemarkt/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'fs';
const snap = readFileSync('snapshot.json', 'utf8'), agents = readFileSync('agents.json', 'utf8');
const appSid = JSON.parse(snap).sessions.items.find(x => (x.name || '').startsWith('Weemaes:'))?.sessionId;
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.addInitScript(([snap, agents, appSid]) => {
  const cbs = {}; let n = 0; window.__cb = cbs;
  window.__TAURI_INTERNALS__ = { transformCallback: fn => { const id = ++n; cbs[id] = fn; return id; },
    invoke: async (cmd, a) => {
      if (cmd === 'snapshot') return JSON.parse(snap);
      if (cmd === 'agents') return JSON.parse(agents);
      if (cmd === 'app_sids') return appSid ? [appSid] : [];
      if (cmd === 'history_sid') return [{ type: 'user', message: { content: 'is die tankvolume altijd van de laatste 900 seconden?' } }, { type: 'assistant', message: { content: [{ type: 'text', text: 'Ja, het venster is 900 seconden.' }] } }];
      if (['chats', 'history', 'pending'].includes(cmd)) return [];
      if (cmd === 'plugin:event|listen') return 1;
      return null; } };
}, [snap, agents, appSid]);
await p.goto('http://localhost:1420'); await p.waitForTimeout(900);
const nav = await p.$$eval('#nav > *', rs => rs.map(r => r.classList.contains('grp') ? '[' + r.textContent.replace('+', '').trim() + ']' : (r.classList.contains('subrow') ? '   └ ' : '') + r.querySelector('.nm').textContent + (r.classList.contains('term') ? '  (terminal)' : '')));
console.log(nav.join('\n'));
await p.click('.row.term >> text=is die tankvolume'); await p.waitForTimeout(400);
console.log('\nkop:', await p.textContent('#t'), '| composer zichtbaar:', await p.isVisible('#composer'), '| eerste regel:', (await p.textContent('#msgs')).slice(0, 80));
await p.screenshot({ path: 'app-open.png' });
console.log('fouten:', errs);
await b.close();
