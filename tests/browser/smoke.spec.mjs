import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import gifenc from 'gifenc';
import { encodeTGA } from '../helpers/tga.mjs';

const { GIFEncoder, quantize, applyPalette } = gifenc;   // CommonJS package
const W = 60, H = 80;

// A gradient test card with a transparent corner, as RGBA rows top to bottom.
function card() {
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    px.set([x * 4, y * 3, 128, x < 10 && y < 10 ? 0 : 255], (y * W + x) * 4);
  return px;
}

function bmp(rgba) {
  const row = Math.ceil(W * 3 / 4) * 4, size = 54 + row * H, b = Buffer.alloc(size);
  b.write('BM'); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(W, 18); b.writeInt32LE(H, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (y * W + x) * 4, d = 54 + (H - 1 - y) * row + x * 3;
    b[d] = rgba[s + 2]; b[d + 1] = rgba[s + 1]; b[d + 2] = rgba[s];
  }
  return b;
}

function gif(rgba) {
  const g = GIFEncoder(), palette = quantize(rgba, 256);
  g.writeFrame(applyPalette(rgba, palette), W, H, { palette });
  g.finish();
  return Buffer.from(g.bytes());
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#3a6"/><circle cx="30" cy="40" r="20" fill="#fd5"/></svg>`;

// PNG, JPEG and WebP come from the browser's own encoders.
async function browserEncoded(page) {
  return page.evaluate(async ({ W, H }) => {
    const c = new OffscreenCanvas(W, H), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#c33'); g.addColorStop(1, '#33c');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const out = {};
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      const blob = await c.convertToBlob({ type, quality: 0.9 });
      if (blob.type !== type) throw new Error(`${type} encoding unsupported`);
      out[type] = [...new Uint8Array(await blob.arrayBuffer())];
    }
    return out;
  }, { W, H });
}

// Reads a stored (uncompressed) zip's entries and checks every CRC.
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThan(0);
  const entries = {};
  for (let i = 0, cd = buf.readUInt32LE(eocd + 16); i < buf.readUInt16LE(eocd + 10); i++) {
    const nameLen = buf.readUInt16LE(cd + 28), size = buf.readUInt32LE(cd + 24), local = buf.readUInt32LE(cd + 42);
    const name = buf.subarray(cd + 46, cd + 46 + nameLen).toString();
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    expect(crc32(data) >>> 0, `${name} CRC`).toBe(buf.readUInt32LE(cd + 16));
    entries[name] = data;
    cd += 46 + nameLen + buf.readUInt16LE(cd + 30) + buf.readUInt16LE(cd + 32);
  }
  return entries;
}

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  // Keep the run hermetic: the web font is optional, everything else must be served locally.
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route(url => !/^http:\/\/127\.0\.0\.1:4173\//.test(url.href) && !/fonts\.(googleapis|gstatic)\.com/.test(url.host) && !/^(data|file):/.test(url.href),
    r => { errors.push(`unexpected request to ${r.request().url()}`); return r.abort(); });
});
test.afterEach(() => expect(errors, 'console errors').toEqual([]));

const WHALE = ['Night sky', 'Clouds', 'Paper whale', 'Town and harbour', 'Waves'];
const DRAWN = ['Night sky', 'Mountains', 'Forest', 'Cabin', 'Foreground'];

async function open(page, url = '/') {
  await page.goto(url);
  await expect(page.locator('#list .nm')).toHaveText(WHALE);
  await expect(page.locator('#dims')).toContainText('5 layers');
}

test('opens on the Paper Whale stack, from the Pages sub-path, with vendored three.js and no console errors', async ({ page }) => {
  const requests = [];
  page.on('request', r => { if (r.url().startsWith('http://127.0.0.1')) requests.push(new URL(r.url()).pathname); });
  await open(page, '/diorama-viewer/');
  // every asset path is relative, so all of them resolve under the sub-path
  expect(requests.filter(p => !p.startsWith('/diorama-viewer/'))).toEqual([]);
  expect(requests).toEqual(expect.arrayContaining([
    '/diorama-viewer/vendor/three/three.min.js', '/diorama-viewer/vendor/three/OrbitControls.js', '/diorama-viewer/vendor/three/RoomEnvironment.js',
    ...['whale-1-sky', 'whale-2-clouds', 'whale-3-whale', 'whale-4-town', 'whale-5-waves'].map(f => `/diorama-viewer/samples/${f}.webp`),
  ]));
  await expect(page.locator('#list .meta span').first()).toHaveText('Back');
  await expect(page.locator('#list .meta span').last()).toHaveText('Front');
  // the WebGL canvas actually drew something: count distinct colours in a downscaled copy
  const colours = await page.evaluate(() => new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(() => {
    const src = document.querySelector('#stage canvas'), c = document.createElement('canvas'); c.width = 64; c.height = 40;
    const x = c.getContext('2d'); x.drawImage(src, 0, 0, 64, 40);
    const d = x.getImageData(0, 0, 64, 40).data, seen = new Set();
    for (let i = 0; i < d.length; i += 4) seen.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | d[i + 2] >> 4);
    ok(seen.size);
  }))));
  expect(colours).toBeGreaterThan(20);
});

test('each sample WebP decodes at 750 × 1000, with alpha on every layer but the sky', async ({ page }) => {
  await open(page);
  const info = await page.evaluate(async () => {
    const out = {};
    for (const f of ['whale-1-sky', 'whale-2-clouds', 'whale-3-whale', 'whale-4-town', 'whale-5-waves']) {
      const bmp = await createImageBitmap(await (await fetch(`samples/${f}.webp`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
      const d = x.getImageData(0, 0, bmp.width, bmp.height).data;
      let transparent = 0; for (let i = 3; i < d.length; i += 4) if (d[i] < 255) transparent++;
      out[f] = { w: bmp.width, h: bmp.height, transparent };
    }
    return out;
  });
  for (const [f, { w, h, transparent }] of Object.entries(info)) {
    expect([w, h], f).toEqual([750, 1000]);
    if (f === 'whale-1-sky') expect(transparent, `${f} is fully opaque`).toBe(0);
    else expect(transparent, `${f} has transparent pixels`).toBeGreaterThan(1000);
  }
});

test('"Sample stack" restores the whale after the layers are changed', async ({ page }) => {
  await open(page);
  await page.locator('#list li').first().locator('button[data-a="del"]').click();
  await page.locator('#list li').first().locator('button[data-a="fwd"]').click();
  await expect(page.locator('#list .nm')).toHaveText(['Paper whale', 'Clouds', 'Town and harbour', 'Waves']);
  await page.click('#clear');
  await expect(page.locator('#list li')).toHaveText(/No layers yet/);
  await page.click('#sample');
  await expect(page.locator('#list .nm')).toHaveText(WHALE);
});

test('opened from file://, it falls back to the drawn stack without errors', async ({ page }) => {
  await page.goto(new URL('../../index.html', import.meta.url).href);
  await expect(page.locator('#list .nm')).toHaveText(DRAWN);
  await expect(page.locator('#dims')).toContainText('5 layers');
});

test('adds a layer from each supported image format', async ({ page }) => {
  await open(page);
  const enc = await browserEncoded(page), rgba = card();
  const files = [
    { name: '1-layer.png', mimeType: 'image/png', buffer: Buffer.from(enc['image/png']) },
    { name: '2-layer.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(enc['image/jpeg']) },
    { name: '3-layer.webp', mimeType: 'image/webp', buffer: Buffer.from(enc['image/webp']) },
    { name: '4-layer.gif', mimeType: 'image/gif', buffer: gif(rgba) },
    { name: '5-layer.bmp', mimeType: 'image/bmp', buffer: bmp(rgba) },
    { name: '6-layer.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) },
    // browsers give TGA files no MIME type, so this one is recognised by extension
    { name: '7-layer.tga', mimeType: '', buffer: Buffer.from(encodeTGA({ w: W, h: H, rgba, type: 10, bpp: 32, alphaBits: 8 })) },
  ];
  await page.setInputFiles('#file', files);
  await expect(page.locator('#loadMsg')).toHaveText('Added 7 layers.');
  await expect(page.locator('#list li')).toHaveCount(12);
  await expect(page.locator('#dims')).toContainText('12 layers');
  for (const f of files) await expect(page.locator('#list .nm', { hasText: f.name })).toHaveCount(1);
  // each new layer got a real thumbnail
  const thumbs = await page.locator('#list li img').evaluateAll(imgs => imgs.slice(5).map(i => [i.naturalWidth, i.naturalHeight]));
  for (const [w, h] of thumbs) { expect(w).toBeGreaterThan(0); expect(h).toBeGreaterThan(0); }
});

test('reports files it cannot open and keeps the rest', async ({ page }) => {
  await open(page);
  const enc = await browserEncoded(page);
  await page.setInputFiles('#file', [
    { name: 'a-good.png', mimeType: 'image/png', buffer: Buffer.from(enc['image/png']) },
    { name: 'b-broken.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') },
    { name: 'c-broken.tga', mimeType: '', buffer: Buffer.from([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 4, 0, 24, 0, 1, 2]) },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
  ]);
  await expect(page.locator('#loadMsg')).toHaveText("Couldn't open b-broken.png, c-broken.tga, notes.txt. Try exporting as PNG. Added 1 other layer.");
  await expect(page.locator('#list li')).toHaveCount(6);
});

test('downloads the STL zip as a normal browser download', async ({ page }) => {
  await open(page);
  await page.selectOption('#mount', 'L');
  await expect(page.locator('#stlInfo')).toContainText('2 × L bracket');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#stlBtn')]);
  expect(download.suggestedFilename()).toBe('diorama-L-bracket-stl.zip');
  const zip = readZip(readFileSync(await download.path()));
  expect(Object.keys(zip)).toEqual(['L-bracket_print-x2.stl', 'README.txt']);
  const stl = zip['L-bracket_print-x2.stl'];
  expect(stl.length).toBe(84 + 50 * stl.readUInt32LE(80));
  expect(zip['README.txt'].toString()).toContain('Sheets: 5 at 15 x 20 cm, 3 mm thick, 15 mm centre to centre.');
  await expect(page.locator('#stlMsg')).toHaveText('Saved.');
});

test.describe("with Claude's downloads API", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__saved = [];
      window.claude = {
        use: async name => name === 'downloads' && {
          save: async ({ filename, data }) => {
            if (window.__decline) throw Object.assign(new Error('declined'), { code: 'declined' });
            window.__saved.push({ filename, size: data.size, type: data.type, head: [...new Uint8Array(await data.slice(0, 4).arrayBuffer())] });
          },
        },
      };
    });
  });

  test('saves the STL zip through it instead of a browser download', async ({ page }) => {
    let browserDownloads = 0;
    page.on('download', () => browserDownloads++);
    await open(page);
    await page.selectOption('#mount', 'frame');
    await page.click('#stlBtn');
    await expect(page.locator('#stlMsg')).toHaveText('Saved.');
    const saved = await page.evaluate(() => window.__saved);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ filename: 'diorama-surround-stl.zip', type: 'application/zip', head: [0x50, 0x4b, 3, 4] });
    expect(saved[0].size).toBeGreaterThan(1000);
    expect(browserDownloads).toBe(0);
  });

  test('says so when the person declines the save', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { window.__decline = true; });
    await page.selectOption('#mount', 'C');
    await page.click('#stlBtn');
    await expect(page.locator('#stlMsg')).toHaveText('Download cancelled.');
  });
});
