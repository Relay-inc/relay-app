import { chromium } from '/Users/laurentmeersman/Documents/Antenna/craft-overnamemarkt/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'fs';
const snap = readFileSync('snapshot.json', 'utf8'), agents = readFileSync('agents.json', 'utf8');
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.addInitScript(([snap, agents]) => { let st = { vault: '/x/Obsidian', projects: {}, overrides: {} };
  window.__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (c, a) => {
    if (c === 'snapshot') return JSON.parse(snap); if (c === 'agents') return JSON.parse(agents);
    if (c === 'get_settings') return st; if (c === 'set_settings') { st = a.settings; return st; }
    return ['app_sids', 'pending', 'history_sid', 'chats', 'history'].includes(c) ? [] : null; } }; }, [snap, agents]);
await p.goto('http://localhost:1420'); await p.waitForTimeout(900);
const sections = () => p.$$eval('.grp', gs => gs.map(g => g.querySelector('.gl').textContent));
console.log('secties:', (await sections()).join(' | '));
console.log('actief:', await p.$$eval('.grp[data-sec="Actief"] ~ div .prow .nm', r => r.map(x => x.textContent)));
// close a terminal under Weemaes, undo, close again, reopen via right-click on the project
const sel = '.prow[data-p="Weemaes"] ~ .row.term';
const k = await p.getAttribute(sel, 'data-k');
await p.hover(`[data-k="${k}"]`); await p.click(`[data-k="${k}"] .x`); await p.waitForTimeout(200);
console.log('toast:', (await p.textContent('#toast')).replace(/\s+/g, ' ').trim().slice(0, 70), '| weg:', !(await p.$(`#nav [data-k="${k}"]`)));
await p.click('#undo'); await p.waitForTimeout(300);
console.log('na ongedaan maken terug:', !!(await p.$(`#nav [data-k="${k}"]`)));
await p.hover(`#nav [data-k="${k}"]`); await p.click(`#nav [data-k="${k}"] .x`); await p.waitForTimeout(200);
await p.click('.prow[data-p="Weemaes"]', { button: 'right' }); await p.waitForTimeout(150);
console.log('rechtsklik op project:', await p.$$eval('#ctx > *', r => r.map(x => x.textContent.slice(0, 34))));
await p.click(`#ctx [data-ctx="reopen"][data-k="${k}"]`); await p.waitForTimeout(300);
console.log('heropend en geselecteerd:', await p.evaluate(k => document.querySelector(`#nav [data-k="${k}"]`)?.classList.contains('sel'), k));
await p.screenshot({ path: 'app-active.png' });
console.log('fouten:', errs); await b.close();
