import { chromium } from '/Users/laurentmeersman/Documents/Antenna/craft-overnamemarkt/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'fs';
const snap = readFileSync('snapshot.json', 'utf8'), agents = readFileSync('agents.json', 'utf8');
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.addInitScript(([snap, agents]) => {
  window.__calls = []; let settings = { vault: '/Users/laurentmeersman/Documents/LaurentMe/Obsidian - Context-management', projects: {}, overrides: {} };
  window.__TAURI_INTERNALS__ = { transformCallback: () => 1,
    invoke: async (cmd, a) => {
      window.__calls.push([cmd, a]);
      if (cmd === 'snapshot') return JSON.parse(snap);
      if (cmd === 'agents') return JSON.parse(agents);
      if (cmd === 'get_settings') return settings;
      if (cmd === 'set_settings') { if (!a.settings.vault.includes('Obsidian')) throw 'Geen vault: work-state.md niet gevonden in ' + a.settings.vault; settings = a.settings; return settings; }
      if (cmd === 'chats') return ['Resolvus'];
      if (cmd === 'history') return [{ type: 'user', message: { content: 'is er nieuws van Joachim?' } }];
      if (['app_sids', 'history_sid', 'pending'].includes(cmd)) return [];
      if (cmd === 'plugin:event|listen') return 1;
      return null; } };
}, [snap, agents]);
await p.goto('http://localhost:1420'); await p.waitForTimeout(900);
console.log('Resolvus zichtbaar (app-gesprek blijft):', !!(await p.$('.prow[data-p="Resolvus"]')));
// reminders view
await p.click('.row[data-k="__rem"]'); await p.waitForTimeout(300);
await p.screenshot({ path: 'app-reminders.png' });
const btn = await p.$('#msgs [data-rem="push"]');
console.log('reminders: groepen', await p.$$eval('#msgs h2, #msgs .rem-group-head, #msgs [class*=head]', h => h.map(x => x.textContent.trim().slice(0, 20))));
if (btn) { await btn.click({ force: true }); await p.waitForTimeout(300); }
console.log('  reminder-call:', JSON.stringify((await p.evaluate(() => window.__calls)).filter(c => c[0] === 'reminder')));
// project panel on a conversation
await p.click('.subrow[data-k="Resolvus"]'); await p.waitForTimeout(300);
await p.click('#t'); await p.waitForTimeout(200);
await p.fill('#popicon', '⚖️'); await p.fill('#poplabel', 'Resolvus CRM'); await p.click('[data-pop="save"]'); await p.waitForTimeout(300);
console.log('paneel: titel', await p.textContent('#t'), '| zijbalk', await p.textContent('.prow[data-p="Resolvus"] .nm'));
await p.click('#t'); await p.selectOption('#popproj', 'Joule'); await p.click('[data-pop="save"]'); await p.waitForTimeout(300);
console.log('van project gewisseld: titel', await p.textContent('#t'), '| subitem onder Joule:', !!(await p.$('.prow[data-p="Joule"] ~ .subrow[data-k="Resolvus"]')));
// settings
await p.click('#gear'); await p.waitForTimeout(200);
await p.fill('#vaultpath', '/tmp/geenvault'); await p.click('[data-set="save"]'); await p.waitForTimeout(300);
console.log('instellingen fout:', (await p.textContent('#msgs .err'))?.slice(0, 60));
await p.screenshot({ path: 'app-settings.png' });
console.log('fouten:', errs); await b.close();
