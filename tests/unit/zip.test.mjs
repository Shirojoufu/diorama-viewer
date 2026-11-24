import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from '../helpers/extract.mjs';

const S = {}, layers = [{}, {}, {}];
const { zipBlob, crc32, stlParts, meshBoxes, stlBinary } =
  load(['CRC', 'crc32', 'zipBlob', 'stlParts', 'meshBoxes', 'stlBinary'], { S, layers });

// Which standard unzip tool this machine has: Info-ZIP's unzip, else Python's zipfile.
function findTool() {
  for (const [cmd, args] of [['unzip', ['-v']], ['python3', ['--version']], ['python', ['--version']]]) {
    try { execFileSync(cmd, args, { stdio: 'ignore' }); return cmd; } catch {}
  }
  return null;
}
const TOOL = findTool();

// Python's zipfile, run as a script on stdin: test every CRC, then print each entry.
const PY = `import sys, zipfile, hashlib
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
if bad: sys.exit("bad CRC in " + bad)
for i in z.infolist(): print(i.filename, i.file_size, hashlib.sha256(z.read(i)).hexdigest())`;

async function makeZip() {
  Object.assign(S, { mount: 'frame', w: 15, h: 20, thick: 3, gap: 15, slot: 6, clr: 0.3 });
  const files = Array.from(stlParts().parts, p => ({ name: `${p.name}_print-x${p.count}.stl`, data: stlBinary(meshBoxes(p.adds, p.subs)) }));
  files.push({ name: 'README.txt', data: new TextEncoder().encode('Diorama Viewer: printable mounts\r\n') });
  files.push({ name: 'empty.txt', data: new Uint8Array(0) });
  const blob = zipBlob(files);
  assert.equal(blob.type, 'application/zip');
  return { files, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('zipBlob output opens with a standard unzip tool', { skip: !TOOL && 'neither unzip nor Python is installed' }, async () => {
  const { files, bytes } = await makeZip();
  const dir = mkdtempSync(join(tmpdir(), 'diorama-zip-'));
  try {
    const path = join(dir, 'mounts.zip');
    writeFileSync(path, bytes);
    const { createHash } = await import('node:crypto');
    const expected = files.map(f => `${f.name} ${f.data.length} ${createHash('sha256').update(f.data).digest('hex')}`);
    if (TOOL === 'unzip') {
      execFileSync('unzip', ['-tq', path]);   // exits non-zero on any CRC or structure error
      const names = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).trim().split(/\r?\n/);
      assert.deepEqual(names, files.map(f => f.name));
      for (const f of files) {
        const out = execFileSync('unzip', ['-p', path, f.name]);
        assert.ok(Buffer.from(f.data).equals(out), `${f.name} round-trips`);
      }
    } else {
      const out = execFileSync(TOOL, ['-I', '-', path], { input: PY, encoding: 'utf8' });
      assert.deepEqual(out.trim().split(/\r?\n/), expected);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('zip records match the central directory', async () => {
  const { files, bytes } = await makeZip();
  const dv = new DataView(bytes.buffer);
  const eocd = bytes.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50, 'end of central directory record');
  assert.equal(dv.getUint16(eocd + 10, true), files.length);
  let cd = dv.getUint32(eocd + 16, true);
  assert.equal(cd + dv.getUint32(eocd + 12, true), eocd, 'central directory ends where the EOCD starts');
  for (const f of files) {
    assert.equal(dv.getUint32(cd, true), 0x02014b50);
    const local = dv.getUint32(cd + 42, true), nameLen = dv.getUint16(cd + 28, true);
    assert.equal(dv.getUint32(local, true), 0x04034b50, `${f.name} local header`);
    assert.equal(dv.getUint32(local + 14, true), dv.getUint32(cd + 16, true), 'CRCs agree');
    assert.equal(dv.getUint32(local + 14, true), crc32(f.data));
    assert.equal(new TextDecoder().decode(bytes.subarray(cd + 46, cd + 46 + nameLen)), f.name);
    cd += 46 + nameLen;
  }
});
