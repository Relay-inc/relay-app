import { chromium } from '/Users/laurentmeersman/Documents/Antenna/craft-overnamemarkt/node_modules/playwright-core/index.mjs';
import path from 'path';
const url = 'file://' + path.resolve('mockup.html');
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
for (const [w, h] of [[1280, 800], [960, 640], [1680, 1000]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await p.goto(url); await p.waitForTimeout(600);
  await p.screenshot({ path: `shot-${w}.png`, fullPage: false });
  const over = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  console.log(w, 'horizontal overflow:', over, 'height:', await p.evaluate(() => document.documentElement.scrollHeight));
}
await b.close();
