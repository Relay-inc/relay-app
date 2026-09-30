import { chromium } from '/Users/laurentmeersman/Documents/Antenna/craft-overnamemarkt/node_modules/playwright-core/index.mjs';
const url = 'file:///Users/laurentmeersman/Documents/LaurentMe/Obsidian%20-%20Context-management/Contexts/Personal/Portfolio/Context%20Vault/Documents/Vault%202%20Plan.html';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
for (const [w, h, n] of [[1440, 900, 'plan-top'], [390, 800, 'plan-mobile']]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 }); await p.goto(url); await p.waitForTimeout(300);
  await p.screenshot({ path: `${n}.png` }); console.log(n, 'overflow:', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'hoogte:', await p.evaluate(() => document.documentElement.scrollHeight));
}
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }); await p.goto(url + '#kaart'); await p.waitForTimeout(300); await p.screenshot({ path: 'plan-kaart.png' });
await b.close();
