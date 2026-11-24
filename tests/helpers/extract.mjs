// Loads functions straight out of index.html into a Node vm context, so the tests run
// the exact code the page ships instead of a copy that could drift.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const SCRIPT = HTML.slice(HTML.lastIndexOf('<script>') + 8, HTML.lastIndexOf('</script>'));

// Index just past the end of the declaration starting at `start`: the matching `}` for a
// function, or the `;` at depth 0 for a const. Skips strings, template literals and comments.
function declarationEnd(src, start, isFunction) {
  let depth = 0, seenBody = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') {
      for (i++; src[i] !== ch; i++) if (src[i] === '\\') i++;
      continue;
    }
    if ('({['.includes(ch)) { depth++; if (ch === '{') seenBody = true; }
    else if (')}]'.includes(ch)) {
      depth--;
      if (isFunction && ch === '}' && depth === 0 && seenBody) return i + 1;
    } else if (!isFunction && ch === ';' && depth === 0) return i + 1;
  }
  throw new Error('Unterminated declaration');
}

export function extractSource(name) {
  const fn = SCRIPT.search(new RegExp(`\\n\\s*(async\\s+)?function ${name}\\s*\\(`));
  const cn = SCRIPT.search(new RegExp(`\\n\\s*const ${name}\\s*=`));
  const start = fn >= 0 ? fn : cn;
  if (start < 0) throw new Error(`${name} not found in index.html`);
  return SCRIPT.slice(start, declarationEnd(SCRIPT, start, fn >= 0)).trim();
}

/** Run the named declarations in a fresh context. `globals` become its global object. */
export function load(names, globals = {}) {
  const ctx = vm.createContext({ TextEncoder, Blob, Uint8Array, Uint8ClampedArray, ...globals });
  vm.runInContext(names.map(extractSource).join('\n'), ctx, { filename: 'index.html' });
  return { ctx, ...vm.runInContext(`({ ${names.join(', ')} })`, ctx) };
}
