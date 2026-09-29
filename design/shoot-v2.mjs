import { chromium } from '/Users/laurentmeersman/Documents/Antenna/craft-overnamemarkt/node_modules/playwright-core/index.mjs';
import path from 'path';
const url = 'file://' + path.resolve('mockup-v2.html');
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
for (const [w, h, scheme] of [[1280, 820, 'light'], [960, 640, 'light'], [1280, 820, 'dark']]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: scheme });
  await p.goto(url); await p.waitForTimeout(400);
  await p.screenshot({ path: `v2-${w}-${scheme}.png` });
  console.log(w, scheme, 'overflow', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth));
}
await b.close();
