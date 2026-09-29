import { chromium } from '/Users/laurentmeersman/Documents/Antenna/craft-overnamemarkt/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'fs';
const snap = readFileSync('snapshot.json', 'utf8'), agents = readFileSync('agents.json', 'utf8');
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.addInitScript(([snap, agents]) => { window.__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async c => {
  if (c === 'snapshot') return JSON.parse(snap); if (c === 'agents') return JSON.parse(agents); if (c === 'get_settings') return { vault: '', projects: {}, overrides: {} };
  if (c === 'history_sid') return { items: [], next: 0 }; return ['app_sids', 'pending', 'chats', 'history'].includes(c) ? [] : null; } }; }, [snap, agents]);
await p.goto('http://localhost:1420'); await p.waitForTimeout(900);
const secs = () => p.$$eval('.grp .gl', g => g.map(x => x.textContent).join(' | '));
const projs = () => p.$$eval('.sec[data-drop="Antenna"] .prow .nm', r => r.map(x => x.textContent).join(', '));
async function drag(from, to, where) { const a = await (await p.$(from)).boundingBox(), t = await (await p.$(to)).boundingBox();
  await p.mouse.move(a.x + 40, a.y + a.height / 2); await p.mouse.down();
  await p.mouse.move(a.x + 40, a.y + a.height / 2 + 12, { steps: 3 });
  await p.mouse.move(t.x + 40, where === 'top' ? t.y + 3 : t.y + t.height - 3, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(150); }
console.log('voor:', await secs(), '||', await projs());
await drag('.grp[data-sec="Personal"]', '.grp[data-sec="Algemeen"]', 'top');
console.log('Personal helemaal bovenaan:', await secs());
const names = await p.$$eval('.sec[data-drop="Antenna"] .prow', r => r.map(x => x.dataset.p));
await drag(`.prow[data-p="${names[names.length - 1]}"]`, `.prow[data-p="${names[0]}"]`, 'top');
console.log(`${names[names.length - 1]} helemaal bovenaan:`, await projs());
await drag(`.prow[data-p="${names[1]}"]`, `.prow[data-p="${names[names.length - 2]}"]`, 'bottom');
console.log(`${names[1]} onderaan:`, await projs());
console.log('secties nog open na slepen (geen klik-toggle):', !(await p.$('.grp.shut')));
console.log('fouten:', errs); await b.close();
