import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../helpers/extract.mjs';
import { encodeTGA } from '../helpers/tga.mjs';

// decodeTGA draws into a canvas; this stand-in keeps the ImageData it is given.
class ImageData { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } }
const document = {
  createElement: () => {
    const c = { getContext: () => ({ putImageData: img => { c.image = img; } }) };
    return c;
  },
};
const { decodeTGA } = load(['decodeTGA'], { document, ImageData });

const W = 7, H = 3;
// A test card: every pixel differs from its neighbours except for runs that RLE can pack,
// one of which wraps from the end of row 0 onto row 1.
function card({ grey = false, alpha = 'full' } = {}) {
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, run = (y === 0 && x >= 4) || (y === 1 && x <= 1) || y === 2 && x >= 3;
    let r = run ? 200 : 30 + x * 31, g = run ? 40 : 10 + y * 90, b = run ? 120 : (x * 53 + y * 17) % 256;
    if (grey) g = b = r;
    const a = alpha === 'none' ? 255 : alpha === 'bit' ? ((x + y) % 2 ? 255 : 0) : run ? 255 : 20 + x * 30;
    px.set([r, g, b, a], i);
  }
  return px;
}

// What the decoder should give back: 5-bit channels for 15/16-bit, alpha dropped where absent.
function expected(src, { type, bpp, alphaBits = 0 }) {
  const out = new Uint8ClampedArray(src.length), grey = type === 3 || type === 11;
  for (let i = 0; i < src.length; i += 4) {
    let [r, g, b, a] = src.subarray(i, i + 4);
    if (!grey && bpp <= 16) { [r, g, b] = [r, g, b].map(v => (v >> 3) * 255 / 31); a = alphaBits ? (a >= 128 ? 255 : 0) : 255; }
    if (grey && bpp === 8 || !grey && bpp === 24) a = 255;
    out.set([r, g, b, a], i);
  }
  return out;
}

const VARIANTS = [
  { name: '24-bit', type: 2, bpp: 24 },
  { name: '32-bit with alpha', type: 2, bpp: 32, alphaBits: 8 },
  { name: '16-bit with 1-bit alpha', type: 2, bpp: 16, alphaBits: 1, alpha: 'bit' },
  { name: '16-bit without alpha', type: 2, bpp: 16 },
  { name: '15-bit', type: 2, bpp: 15 },
  { name: '8-bit grey', type: 3, bpp: 8, grey: true },
  { name: '16-bit grey + alpha', type: 3, bpp: 16, grey: true, alphaBits: 8 },
  { name: 'RLE 24-bit', type: 10, bpp: 24 },
  { name: 'RLE 32-bit with alpha', type: 10, bpp: 32, alphaBits: 8 },
  { name: 'RLE 16-bit with 1-bit alpha', type: 10, bpp: 16, alphaBits: 1, alpha: 'bit' },
  { name: 'RLE 15-bit', type: 10, bpp: 15 },
  { name: 'RLE 8-bit grey', type: 11, bpp: 8, grey: true },
  { name: 'RLE 16-bit grey + alpha', type: 11, bpp: 16, grey: true, alphaBits: 8 },
];
const ORIGINS = [
  { name: 'bottom-left origin', top: false, right: false },
  { name: 'top-left origin', top: true, right: false },
  { name: 'bottom-right origin', top: false, right: true },
  { name: 'top-right origin', top: true, right: true },
];

function decode(bytes) {
  const c = decodeTGA(bytes);
  return { w: c.width, h: c.height, data: Uint8ClampedArray.from(c.image.data) };
}

for (const v of VARIANTS) for (const o of ORIGINS) {
  test(`TGA ${v.name}, ${o.name}`, () => {
    const src = card(v);
    const out = decode(encodeTGA({ w: W, h: H, rgba: src, ...v, ...o }));
    assert.equal(out.w, W); assert.equal(out.h, H);
    assert.deepEqual(out.data, expected(src, v));
  });
}

test('TGA RLE output is actually compressed, with packets crossing scanlines', () => {
  const src = card();
  const raw = encodeTGA({ w: W, h: H, rgba: src, type: 2, bpp: 24 });
  const rle = encodeTGA({ w: W, h: H, rgba: src, type: 10, bpp: 24, top: true });
  assert.ok(rle.length < raw.length);
  // the run from (4,0) to (1,1) is one 5-pixel packet in a top-left file
  assert.ok(rle.subarray(18).includes(0x80 | 4));
});

test('TGA skips the image ID and colour map fields', () => {
  const src = card();
  const out = decode(encodeTGA({ w: W, h: H, rgba: src, type: 2, bpp: 24, id: 'made by a test', colorMap: 5 }));
  assert.deepEqual(out.data, expected(src, { type: 2, bpp: 24 }));
});

test('TGA 32-bit with an all-zero alpha channel is treated as opaque', () => {
  const src = card(); for (let i = 3; i < src.length; i += 4) src[i] = 0;
  const out = decode(encodeTGA({ w: W, h: H, rgba: src, type: 2, bpp: 32, alphaBits: 8 }));
  for (let i = 3; i < out.data.length; i += 4) assert.equal(out.data[i], 255);
});

test('TGA 16-bit with every alpha bit clear is treated as opaque', () => {
  const src = card(); for (let i = 3; i < src.length; i += 4) src[i] = 0;
  const out = decode(encodeTGA({ w: W, h: H, rgba: src, type: 10, bpp: 16, alphaBits: 1 }));
  for (let i = 3; i < out.data.length; i += 4) assert.equal(out.data[i], 255);
});

test('TGA rejects files it cannot read', () => {
  const ok = encodeTGA({ w: W, h: H, rgba: card(), type: 2, bpp: 24 });
  const withByte = (i, v) => { const b = ok.slice(); b[i] = v; return b; };
  assert.throws(() => decodeTGA(withByte(2, 1)), /Unsupported TGA type/, 'colour-mapped');
  assert.throws(() => decodeTGA(withByte(2, 9)), /Unsupported TGA type/, 'RLE colour-mapped');
  assert.throws(() => decodeTGA(withByte(12, 0)), /Unsupported TGA type/, 'zero width');
  assert.throws(() => decodeTGA(withByte(16, 8)), /bit depth/, '8-bit true colour');
  assert.throws(() => decodeTGA(ok.subarray(0, ok.length - 5)), /Truncated/, 'truncated');
  const rle = encodeTGA({ w: W, h: H, rgba: card(), type: 10, bpp: 32, alphaBits: 8 });
  assert.throws(() => decodeTGA(rle.subarray(0, rle.length - 3)), /Truncated/, 'truncated RLE');
});
