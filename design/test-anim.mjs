import { chromium } from '/Users/laurentmeersman/Documents/Antenna/craft-overnamemarkt/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'fs';
const snap = readFileSync('snapshot.json', 'utf8');
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
await p.addInitScript(snap => { window.__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async c => c === 'snapshot' ? JSON.parse(snap) : c === 'get_settings' ? { vault: '', projects: {}, overrides: {} } : ['agents','chats','app_sids','pending','history','history_sid'].includes(c) ? [] : null }; }, snap);
await p.goto('http://localhost:1420'); await p.waitForTimeout(700);
const w = () => p.evaluate(() => Math.round(document.querySelector('aside.insp').getBoundingClientRect().width));
const widths = [await w()]; await p.click('#toggleinsp');
for (let i = 0; i < 6; i++) { await p.waitForTimeout(50); widths.push(await w()); }
await p.waitForTimeout(300); widths.push(await w());
await p.click('#toggleinsp'); await p.waitForTimeout(120); const mid = await w(); await p.waitForTimeout(300);
console.log('dichtklappen, breedte per 50 ms:', widths.join(' → '), '| openklappen halverwege:', mid, '→', await w());
await b.close();
