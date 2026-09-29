import { chromium } from '/Users/laurentmeersman/Documents/Antenna/craft-overnamemarkt/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'fs';
const snap = readFileSync('snapshot.json', 'utf8'), agents = readFileSync('agents.json', 'utf8');
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.addInitScript(([snap, agents]) => { let st = { vault: '/x/Obsidian', projects: {}, overrides: {} };
  window.__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (c, a) => {
    if (c === 'snapshot') return JSON.parse(snap); if (c === 'agents') return JSON.parse(agents);
    if (c === 'get_settings') return st; if (c === 'set_settings') { st = a.settings; return st; }
    if (c === 'chats') return ['Resolvus']; if (c === 'history') return [{ type: 'user', message: { content: 'is er nieuws van Joachim?' } }];
    return ['app_sids', 'pending', 'history_sid'].includes(c) ? [] : null; } }; }, [snap, agents]);
await p.goto('http://localhost:1420'); await p.waitForTimeout(900);
// 1. right-click a terminal session under Algemeen -> assign to Weemaes
const row = await p.$('.sec:not(.ctx-a):not(.ctx-m):not(.ctx-p) .row.term'); const k = await row.getAttribute('data-k'); const title = await row.textContent();
await row.click({ button: 'right' }); await p.waitForTimeout(150);
console.log('contextmenu:', await p.$$eval('#ctx button', bs => bs.map(x => x.textContent)));
await p.click('[data-ctx="assign"]'); await p.waitForTimeout(300);
await p.selectOption('#popproj', 'Weemaes'); await p.click('[data-pop="save"]'); await p.waitForTimeout(400);
console.log('terminal nu onder Weemaes:', !!(await p.$(`.sec.ctx-a [data-k="${k}"]`)), '|', title.trim().slice(0, 30));
// 2. button in the toolbar on an app conversation -> Joule
await p.click('.subrow[data-k="Resolvus"]'); await p.waitForTimeout(300);
await p.click('#assign'); await p.selectOption('#popproj', 'Joule'); await p.click('[data-pop="save"]'); await p.waitForTimeout(300);
console.log('app-gesprek nu onder Joule:', !!(await p.$('.prow[data-p="Joule"] ~ [data-k="Resolvus"]')), '| titel:', await p.textContent('#t'));
await p.click('#assign'); await p.waitForTimeout(200); await p.screenshot({ path: 'app-assign.png' });
console.log('fouten:', errs); await b.close();
