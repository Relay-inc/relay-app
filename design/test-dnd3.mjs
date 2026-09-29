import { chromium } from '/Users/laurentmeersman/Documents/Antenna/craft-overnamemarkt/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'fs';
const snap = readFileSync('snapshot.json', 'utf8'), agents = readFileSync('agents.json', 'utf8');
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 1100 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.addInitScript(([snap, agents]) => { window.__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async c => {
  if (c === 'snapshot') return JSON.parse(snap); if (c === 'agents') return JSON.parse(agents); if (c === 'get_settings') return { vault: '', projects: {}, overrides: {} };
  if (c === 'history_sid') return { items: [], next: 0 }; return ['app_sids', 'pending', 'chats', 'history'].includes(c) ? [] : null; } }; }, [snap, agents]);
await p.goto('http://localhost:1420'); await p.waitForTimeout(900);
async function drag(from, to, where) { const a = await (await p.$(from)).boundingBox(), t = await (await p.$(to)).boundingBox();
  await p.mouse.move(a.x + 60, a.y + a.height / 2); await p.mouse.down(); await p.mouse.move(a.x + 60, a.y + a.height / 2 + 12, { steps: 3 });
  await p.mouse.move(t.x + 60, where === 'top' ? t.y + 3 : t.y + t.height - 3, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(150); }
const list = parent => p.$$eval(`.row.conv[data-parent="${parent}"] .nm`, r => r.map(x => x.textContent.slice(0, 22)));
const parent = await p.$eval('.subrow.conv', r => r.dataset.parent);
const before = await list(parent); console.log(`${parent} voor:`, before);
const keys = await p.$$eval(`.row.conv[data-parent="${parent}"]`, r => r.map(x => x.dataset.k));
await drag(`[data-k="${keys[keys.length - 1]}"]`, `[data-k="${keys[0]}"]`, 'top');
console.log(`${parent} na slepen:`, await list(parent));
const g = await p.$$eval('.row.conv[data-parent=""]', r => r.map(x => x.dataset.k));
await drag(`[data-k="${g[0]}"]`, `[data-k="${g[g.length - 1]}"]`, 'bottom');
console.log('Algemeen: eerste nu onderaan:', (await p.$$eval('.row.conv[data-parent=""]', r => r.map(x => x.dataset.k))).at(-1) === g[0]);
await p.reload(); await p.waitForTimeout(900);
console.log(`${parent} na herladen:`, await list(parent), '| geselecteerd na slepen:', await p.$$eval('.row.sel', r => r.length));
console.log('fouten:', errs); await b.close();
