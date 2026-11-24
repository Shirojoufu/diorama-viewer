// A small TGA writer for test fixtures: every variant decodeTGA() claims to read.

/**
 * @param {object} o
 * @param {number} o.w, o.h
 * @param {Uint8Array} o.rgba  pixels top-to-bottom, left-to-right
 * @param {2|3|10|11} o.type    2/10 true colour, 3/11 grey; 10/11 are RLE
 * @param {number} o.bpp        8|16 for grey; 15|16|24|32 for colour
 * @param {number} [o.alphaBits]  low nibble of the descriptor
 * @param {boolean} [o.top]      top-left origin (default bottom-left)
 * @param {boolean} [o.right]    right-to-left columns
 * @param {string} [o.id]        image ID field
 * @param {number} [o.colorMap]  entries of a (skipped) colour map to include
 */
export function encodeTGA({ w, h, rgba, type, bpp, alphaBits = 0, top = false, right = false, id = '', colorMap = 0 }) {
  const grey = type === 3 || type === 11, bp = (bpp + 7) >> 3;
  const header = new Uint8Array(18);
  header[0] = id.length; header[1] = colorMap ? 1 : 0; header[2] = type;
  header[5] = colorMap & 255; header[6] = colorMap >> 8; header[7] = colorMap ? 24 : 0;
  header[12] = w & 255; header[13] = w >> 8; header[14] = h & 255; header[15] = h >> 8;
  header[16] = bpp; header[17] = alphaBits | (top ? 0x20 : 0) | (right ? 0x10 : 0);

  const pixel = i => {
    const [r, g, b, a] = rgba.subarray(i * 4, i * 4 + 4);
    if (grey) return bp === 2 ? [r, a] : [r];
    if (bp === 2) {
      const v = (a >= 128 ? 0x8000 : 0) | (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
      return [v & 255, v >> 8];
    }
    return bp === 4 ? [b, g, r, a] : [b, g, r];
  };
  // pixels in file order
  const order = [];
  for (let fy = 0; fy < h; fy++) for (let fx = 0; fx < w; fx++) {
    const y = top ? fy : h - 1 - fy, x = right ? w - 1 - fx : fx;
    order.push(pixel(y * w + x));
  }
  const body = type >= 9 ? rle(order) : order.flat();
  return Uint8Array.from([...header, ...Buffer.from(id, 'latin1'), ...new Array(colorMap * 3).fill(7), ...body]);
}

// Run-length packets may cross scanlines, as the spec allows.
function rle(pixels) {
  const out = [], same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  for (let i = 0; i < pixels.length; ) {
    let run = 1;
    while (i + run < pixels.length && run < 128 && same(pixels[i], pixels[i + run])) run++;
    if (run > 1) { out.push(0x80 | (run - 1), ...pixels[i]); i += run; continue; }
    let raw = 1;
    while (i + raw < pixels.length && raw < 128 && !same(pixels[i + raw], pixels[i + raw + 1] ?? [])) raw++;
    out.push(raw - 1, ...pixels.slice(i, i + raw).flat()); i += raw;
  }
  return out;
}
