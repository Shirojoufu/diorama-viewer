// Screenshot and turntable GIF of the Paper Whale sample stack for the README:
//   npm run capture   ->  docs/screenshot.png, docs/turntable.gif
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import gifenc from 'gifenc';
import { startServer } from '../tests/serve.mjs';
import { WEBGL_ARGS } from '../playwright.config.mjs';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const PORT = 4174, GIF_W = 520, GIF_H = 360, STEPS = 24, PX_PER_STEP = 9;

const server = await startServer(PORT);
const browser = await chromium.launch({ args: WEBGL_ARGS });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.locator('#list .nm', { hasText: 'Waves' }).waitFor();   // the Paper Whale stack has loaded
  await page.evaluate(() => document.fonts.ready);
  const frames = n => page.evaluate(n => new Promise(ok => { const f = () => --n ? requestAnimationFrame(f) : ok(); requestAnimationFrame(f); }), n);
  await frames(30);   // let the orbit damping settle

  mkdirSync('docs', { recursive: true });
  await page.screenshot({ path: 'docs/screenshot.png' });
  console.log('wrote docs/screenshot.png');

  // Turntable: hide the panel, then orbit by dragging and grab the WebGL canvas each step.
  await page.click('#hidePanel');
  await page.click('#angle');
  await frames(40);
  const grab = () => page.evaluate(({ w, h }) => {
    const src = document.querySelector('#stage canvas'), c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'), s = Math.max(w / src.width, h / src.height);
    x.drawImage(src, (w - src.width * s) / 2, (h - src.height * s) / 2, src.width * s, src.height * s);
    return Array.from(x.getImageData(0, 0, w, h).data);
  }, { w: GIF_W, h: GIF_H });

  const shots = [];
  await page.mouse.move(900, 400);
  await page.mouse.down();
  for (let i = 0, x = 900; i < STEPS; i++) {
    await page.mouse.move(x -= PX_PER_STEP, 400, { steps: 2 });
    await frames(4);
    shots.push(Uint8Array.from(await grab()));
  }
  await page.mouse.up();

  // ping-pong so the loop is seamless
  const loop = [...shots, ...shots.slice(1, -1).reverse()];
  const palette = quantize(loop[Math.floor(STEPS / 2)], 256);
  const gif = GIFEncoder();
  for (const rgba of loop) gif.writeFrame(applyPalette(rgba, palette), GIF_W, GIF_H, { palette, delay: 70 });
  gif.finish();
  writeFileSync('docs/turntable.gif', gif.bytes());
  console.log(`wrote docs/turntable.gif (${loop.length} frames, ${(gif.bytes().length / 1024).toFixed(0)} KB)`);
} finally {
  await browser.close();
  server.close();
}
