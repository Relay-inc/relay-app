import { chromium } from '/Users/laurentmeersman/Documents/Antenna/craft-overnamemarkt/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'fs';
const snap = readFileSync('snapshot.json', 'utf8');
const sid = JSON.parse(snap).sessions.items[0].sessionId;
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.addInitScript(([snap, sid]) => {
  const cbs = {}; let n = 0; window.__sent = [];
  // a 1x1 red png, as a transcript would hold it
  const red = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  window.__TAURI_INTERNALS__ = { transformCallback: fn => { const id = ++n; cbs[id] = fn; return id; },
    invoke: async (cmd, a) => {
      if (cmd === 'snapshot') return JSON.parse(snap);
      if (cmd === 'chats') return ['Resolvus'];
      if (cmd === 'history') return [
        { type: 'user', message: { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: red } }, { type: 'text', text: 'wat zie je hier?' }] } },
        { type: 'user', message: { content: [{ type: 'image', source: { type: 'url', url: 'https://x' } }] } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Een rood vierkant.' }] } }];
      if (cmd === 'agents') return [{ sessionId: sid, id: 'term1', kind: 'interactive', status: 'idle', name: 'Terminalsessie test' }];
      if (cmd === 'history_sid') return { items: [], next: 0 };
      if (cmd === 'send') { window.__sent.push(a); return null; }
      if (['pending', 'app_sids'].includes(cmd)) return [];
      if (cmd === 'subagents') return {};
      if (cmd === 'plugin:event|listen') return 1;
      return null; } };
}, [snap, sid]);
await p.goto('http://localhost:1420'); await p.waitForTimeout(900);

// history: an inline image is a thumbnail, a non-inline one a placeholder
await p.click('.row.conv[data-k="Resolvus"]'); await p.waitForTimeout(400);
console.log('historiek thumbs:', await p.$$eval('#msgs .mimgs img', x => x.length), 'placeholder:', await p.$$eval('#msgs .imgph', x => x.map(e => e.textContent)));

// paste helper: a File made on a canvas, inside a DataTransfer on a synthetic ClipboardEvent
const paste = (w, h, type = 'image/png', text) => p.evaluate(async ([w, h, type, text]) => {
  const dt = new DataTransfer();
  if (w) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#0a0'; x.fillRect(0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, type)); dt.items.add(new File([blob], 'shot.png', { type })); }
  if (text) dt.setData('text/plain', text);
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  document.getElementById('c').dispatchEvent(ev); return ev.defaultPrevented;
}, [w, h, type, text]);

console.log('tekst-plak onderschept:', await paste(0, 0, 'image/png', 'gewone tekst'));
console.log('beeld-plak onderschept:', await paste(40, 30));
await paste(3000, 1200, 'image/jpeg'); await p.waitForTimeout(300);
console.log('thumbs in composer:', await p.$$eval('#atts img', x => x.length));
await p.hover('#atts .att:nth-child(1)');
console.log('× zichtbaar bij hover:', await p.$eval('#atts .att:nth-child(1) .rm', e => getComputedStyle(e).display));
await p.screenshot({ path: 'app-images-composer.png' });
await p.click('#atts .att:nth-child(2) img'); await p.waitForTimeout(100);
console.log('overlay open:', await p.$eval('#zoom', e => !e.hidden));
await p.keyboard.press('Escape');
console.log('overlay dicht na Esc:', await p.$eval('#zoom', e => e.hidden));
await p.hover('#atts .att:nth-child(1)'); await p.click('#atts .att:nth-child(1) .rm');
console.log('na verwijderen:', await p.$$eval('#atts img', x => x.length));

// send with text: one message, image block plus text, composer emptied
await p.fill('#c', 'welke kleur?'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
const s1 = await p.evaluate(() => window.__sent.at(-1));
const im = s1.images[0];
const dims = await p.evaluate(async d => { const i = new Image(); i.src = `data:${d.media_type};base64,${d.data}`; await i.decode(); return [i.naturalWidth, i.naturalHeight]; }, im);
console.log('send:', { text: s1.text, images: s1.images.length, media_type: im.media_type, kb: Math.round(im.data.length * 3 / 4 / 1024), dims });
console.log('composer leeg:', await p.$eval('#atts', e => e.hidden), 'thumbs in bericht:', await p.$$eval('#msgs .mimgs img', x => x.length));

// image only, no text
await paste(20, 20); await p.waitForTimeout(200);
await p.focus('#c'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
const s2 = await p.evaluate(() => window.__sent.at(-1));
console.log('enkel beeld:', { text: JSON.stringify(s2.text), images: s2.images.length, sends: await p.evaluate(() => window.__sent.length) });

// drop on the composer
await p.evaluate(() => { window.__sent = []; });
await p.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = c.height = 10; const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer(); dt.items.add(new File([blob], 'drop.png', { type: 'image/png' }));
  document.getElementById('composer').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
}); await p.waitForTimeout(200);
console.log('na drop:', await p.$$eval('#atts img', x => x.length));

// fork: a terminal session continued in the app goes through send with fork and the image
await p.click(`.row.conv[data-k="t:${sid}"]`); await p.waitForTimeout(400);
await p.fill('#c', 'verder met beeld'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
const s3 = await p.evaluate(() => window.__sent.at(-1));
console.log('fork:', { fork: s3?.fork === sid, images: s3?.images.length, text: s3?.text });
await p.screenshot({ path: 'app-images.png' });
console.log('fouten:', errs);
await b.close();
