import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../helpers/extract.mjs';

const S = {}, layers = [];
const { stlParts, meshBoxes, stlBinary } = load(['stlParts', 'meshBoxes', 'stlBinary'], { S, layers });

// Sheet settings as the sliders set them: cm for w/h, mm for the rest.
const CONFIGS = [
  { label: 'default', w: 15, h: 20, thick: 3, gap: 15, slot: 6, clr: 0.3 },
  { label: 'smallest', w: 5, h: 5, thick: 1, gap: 3, slot: 3, clr: 0.1 },
  { label: 'largest', w: 60, h: 60, thick: 10, gap: 60, slot: 15, clr: 1 },
  { label: 'narrow, deep slots', w: 5, h: 30, thick: 6, gap: 8, slot: 15, clr: 0.55 },
  { label: 'gap thinner than sheet', w: 20, h: 12, thick: 8, gap: 4, slot: 9, clr: 0.25 },
];
const LAYER_COUNTS = [1, 2, 7];

const BASE = 6, WALL = 5, EXT = 8;
function expectedParts(mount, c, n) {
  const W = c.w * 10, H = c.h * 10, L = 2 * EXT + (n - 1) * c.gap + c.thick + c.clr;
  switch (mount) {
    case 'L': return { 'L-bracket': [2, Math.min(35, W * 0.25) + WALL, L, BASE + Math.min(50, H * 0.3)] };
    case 'Lfull': return { 'full-L-holder': [1, WALL + W + 0.5 + 3, L, BASE + H] };
    case 'C': return { 'C-bracket': [2, Math.min(30, W * 0.2) + WALL, L, BASE + H + 0.5 + BASE] };
    case 'frame': return {
      'surround-base-rail': [1, W + 0.5 + 18, L, 10 + c.slot],
      'surround-top-rail': [1, W + 0.5 + 18, L, 9 + c.slot],
      'surround-side-post': [2, 9 + c.slot, L, H + 0.5 + 8],
    };
  }
}

const key = v => v.map(x => x.toFixed(5)).join(',');
const sub = (a, b) => a.map((x, i) => x - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Checks a triangle soup is a closed, consistently wound 2-manifold; returns volume and bounds. */
function analyse(tris) {
  const directed = new Map();
  let volume = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const [n, a, b, c] of tris) {
    const face = cross(sub(b, a), sub(c, a)), area = Math.hypot(...face) / 2;
    assert.ok(area > 1e-9, `degenerate triangle ${key(a)} ${key(b)} ${key(c)}`);
    const dot = (face[0] * n[0] + face[1] * n[1] + face[2] * n[2]) / (2 * area);
    assert.ok(Math.abs(dot - 1) < 1e-4, 'stored normal disagrees with the winding');
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = key(u) + '>' + key(v);
      directed.set(k, (directed.get(k) || 0) + 1);
    }
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    for (const p of [a, b, c]) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  }
  // Each edge used once in each direction means every edge has exactly two triangles,
  // wound oppositely: closed, manifold and orientable.
  for (const [k, count] of directed) {
    assert.equal(count, 1, `edge ${k} is used ${count} times in the same direction`);
    const [u, v] = k.split('>');
    assert.equal(directed.get(v + '>' + u), 1, `edge ${k} has no opposite half-edge (hole)`);
  }
  return { volume, size: hi.map((h, k) => h - lo[k]) };
}

function parseStl(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), n = dv.getUint32(80, true);
  assert.equal(bytes.length, 84 + 50 * n, 'file length matches the triangle count');
  assert.notEqual(String.fromCharCode(...bytes.subarray(0, 5)), 'solid', 'binary STL must not start with "solid"');
  const tris = [];
  for (let t = 0; t < n; t++) {
    const f = i => dv.getFloat32(84 + 50 * t + 4 * i, true);
    tris.push([0, 1, 2, 3].map(v => [f(3 * v), f(3 * v + 1), f(3 * v + 2)]));
  }
  return tris;
}

// A gap thinner than the sheet gives rib spans with y1 < y0. The mesher fills nothing for
// those, so they count as empty here too.
const boxVolume = b => Math.max(0, b[1] - b[0]) * Math.max(0, b[3] - b[2]) * Math.max(0, b[5] - b[4]);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

for (const mount of ['L', 'Lfull', 'C', 'frame']) {
  describe(`STL ${mount}`, () => {
    for (const c of CONFIGS) for (const n of LAYER_COUNTS) {
      test(`${mount}: ${c.label}, ${n} sheet${n > 1 ? 's' : ''}`, () => {
        Object.assign(S, { mount, w: c.w, h: c.h, thick: c.thick, gap: c.gap, slot: c.slot, clr: c.clr });
        layers.length = 0; for (let i = 0; i < n; i++) layers.push({});
        const { parts } = stlParts(), want = expectedParts(mount, c, n);
        // Array.from: parts come from the vm's realm, whose Array prototype differs
        assert.deepEqual(Array.from(parts, p => p.name).sort(), Object.keys(want).sort());
        for (const p of parts) {
          const [count, ...dims] = want[p.name];
          assert.equal(p.count, count, `${p.name} count`);
          dims.forEach((d, k) => near(p.size[k], d, 1e-6, `${p.name} reported size[${k}]`));

          const mesh = analyse(meshBoxes(p.adds, p.subs));
          dims.forEach((d, k) => near(mesh.size[k], d, 1e-6, `${p.name} mesh size[${k}]`));
          assert.ok(mesh.volume > 0, `${p.name} volume is positive`);
          const largest = Math.max(...p.adds.map(boxVolume)), total = p.adds.reduce((s, b) => s + boxVolume(b), 0);
          const holes = p.subs.reduce((s, b) => s + boxVolume(b), 0);
          assert.ok(mesh.volume >= largest - holes - 1e-6 && mesh.volume <= total + 1e-6, `${p.name} volume ${mesh.volume} is plausible`);

          // the same checks after the float32 rounding of the binary file
          const file = analyse(parseStl(stlBinary(meshBoxes(p.adds, p.subs))));
          near(file.volume, mesh.volume, mesh.volume * 1e-4, `${p.name} volume survives float32`);
          dims.forEach((d, k) => near(file.size[k], d, 1e-3, `${p.name} STL size[${k}]`));
        }
      });
    }
  });
}

test('slots are thickness plus clearance, and ribs fill the gaps between them', () => {
  Object.assign(S, { mount: 'L', w: 15, h: 20, thick: 3, gap: 15, slot: 6, clr: 0.3 });
  layers.length = 3;
  const P = stlParts();
  near(P.SLOT, 3.3, 1e-9, 'slot width');
  near(P.rib, 11.7, 1e-9, 'rib width');
  near(P.L, 16 + 2 * 15 + 3.3, 1e-9, 'length');
});

test('standoffs and none have no printable parts', () => {
  for (const mount of ['standoff', 'none']) {
    Object.assign(S, { mount });
    assert.equal(stlParts().parts.length, 0);
  }
});
