import { chromium } from '/Users/laurentmeersman/Documents/Antenna/craft-overnamemarkt/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'fs';
const snap = readFileSync('snapshot.json', 'utf8');
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.addInitScript(snap => {
  const cbs = {}; let n = 0; const ago = m => new Date(Date.now() - m * 60000).toISOString();
  const subs = { Resolvus: [
    { id: 'a1', description: 'Opkuis Weemaes stand', agentType: 'general-purpose', model: 'sonnet', running: false, started_at: ago(50), last_at: ago(46), text: 'klaar' },
    { id: 'a2', description: 'Moving commands into System/skills folders', agentType: 'general-purpose', model: 'sonnet', running: true, started_at: ago(2.8), last_at: ago(0.1), tool: 'Bash', input: { command: 'git mv commands System/skills' } },
    { id: 'a3', description: 'Tauri mogelijkheden opzoeken', agentType: 'web-researcher', model: 'haiku', running: true, started_at: ago(0.5), last_at: ago(0.1), tool: 'WebSearch', input: { query: 'tauri tray icon' } },
    { id: 'a4', description: 'Stap 3: documenten een thuis', agentType: 'general-purpose', running: false, started_at: ago(30), last_at: ago(28), text: 'ok' } ] };
  window.__TAURI_INTERNALS__ = { transformCallback: fn => { const id = ++n; cbs[id] = fn; return id; },
    invoke: async (cmd, a) => {
      if (cmd === 'snapshot') return JSON.parse(snap);
      if (cmd === 'chats') return ['Resolvus'];
      if (cmd === 'subagents') return subs;
      if (cmd === 'agent_log') return ['Ik verplaats de **commands** nu.', 'Klaar met stap 1.'];
      if (['agents', 'pending', 'history', 'app_sids'].includes(cmd)) return [];
      if (cmd === 'plugin:event|listen') return 1;
      return null; } };
}, snap);
await p.goto('http://localhost:1420'); await p.waitForTimeout(900);
console.log('badge in zijbalk:', await p.$$eval('.row.conv', rs => rs.map(r => r.querySelector('.nm').textContent + ' [' + (r.querySelector('.acount')?.textContent || '') + ']')));
await p.click('.row.conv[data-k="Resolvus"]'); await p.waitForTimeout(1200);
const strip = () => p.$$eval('#subs > *', rs => rs.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
console.log('strip:', await strip());
await p.click('[data-subs-toggle]'); await p.waitForTimeout(100);
console.log('uitgeklapt:', await strip());
await p.click('[data-agent="a2"]'); await p.waitForTimeout(200);
console.log('log a2:', await p.textContent('.slog'));
await p.screenshot({ path: 'app-subagents.png' });
await p.click('.row[data-k="__wait"]'); await p.waitForTimeout(200);
console.log('verborgen in Wacht op jou:', await p.$eval('#subs', e => e.style.display === 'none'));
console.log('fouten:', errs);
await b.close();
