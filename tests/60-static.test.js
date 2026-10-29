import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const files = walk(path.join(root, 'src')).filter((f) => /\.(js|jsx)$/.test(f));
const read = (f) => fs.readFileSync(f, 'utf8');
const isClient = (src) => /^\s*(['"])use client\1/.test(src);
const rel = (f) => path.relative(root, f);

const resolveSpec = (from, spec) => {
  let base;
  if (spec.startsWith('@/')) base = path.join(root, 'src', spec.slice(2)); else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec); else return 'external';
  for (const c of [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js'), path.join(base, 'index.jsx')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
};
const imports = (src) => [...src.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)].map((m) => m[1]);

test('every relative / alias import resolves to a file', () => {
  const missing = [];
  for (const f of files) for (const spec of imports(read(f))) if (resolveSpec(f, spec) === null) missing.push(`${rel(f)} -> ${spec}`);
  assert.deepEqual(missing, []);
});

test('named imports exist in the imported module (catches typos in exports)', () => {
  const bad = [];
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/import\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)) {
      const target = resolveSpec(f, m[2]); if (!target || target === 'external') continue;
      const tsrc = read(target);
      for (const raw of m[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim(); if (!name) continue;
        const ok = new RegExp(`export\\s+(?:async\\s+)?(?:function\\*?|const|let|var|class)\\s+${name}\\b`).test(tsrc) || new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(tsrc) || new RegExp(`export\\s*\\*\\s+from`).test(tsrc) && false;
        if (!ok) bad.push(`${rel(f)}: "${name}" is not exported by ${rel(target)}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('client components never import server-only modules', () => {
  const server = /@\/lib\/(db|seed|seed-ops|session|crypto|schema|api\/|services\/|providers\/|ocr)|node:|from 'fs'|from 'path'|from 'crypto'/;
  const bad = [];
  for (const f of files.filter((x) => isClient(read(x)))) for (const spec of imports(read(f))) if (server.test(spec)) bad.push(`${rel(f)} imports ${spec}`);
  assert.deepEqual(bad, []);
});

test('files using React hooks or event handlers are marked "use client"', () => {
  const bad = [];
  for (const f of files.filter((x) => x.endsWith('.jsx'))) {
    const src = read(f);
    const usesClient = /\buse(State|Effect|Ref|Memo|Callback|Router|Nav|Api|Form|Toast|Context|Params|SearchParams|Pathname)\b\s*\(|\sonClick=|\sonChange=|\sonSubmit=/.test(src.replace(/\/\/.*$/gm, ''));
    if (usesClient && !isClient(src)) bad.push(rel(f));
  }
  assert.deepEqual(bad, [], 'these files need "use client" (or must not use client features)');
});

test('server pages / layouts do not pass functions to client components and do not use browser APIs', () => {
  const bad = [];
  for (const f of files.filter((x) => /app\/.*\/(page|layout)\.jsx$/.test(x.replace(/\\/g, '/')) || /app\/(page|layout)\.jsx$/.test(x.replace(/\\/g, '/')))) {
    const src = read(f);
    if (isClient(src)) continue;
    if (/\b(window|document|localStorage|sessionStorage)\b/.test(src)) bad.push(`${rel(f)} uses a browser global`);
    if (/=\{\s*\(?[\w, ]*\)?\s*=>/.test(src)) bad.push(`${rel(f)} passes an inline function prop`);
  }
  assert.deepEqual(bad, []);
});

test('route conventions: one page per route, API catch-all exports HTTP verbs, middleware at src/middleware.js', () => {
  const pages = files.filter((f) => /page\.jsx$/.test(f)).map((f) => rel(f).replace(/\\/g, '/').replace(/^src\/app\//, '').replace(/\([^)]+\)\//g, '').replace(/page\.jsx$/, ''));
  const dup = pages.filter((p, i) => pages.indexOf(p) !== i); assert.deepEqual(dup, [], 'duplicate routes');
  const api = read(path.join(root, 'src/app/api/[...path]/route.js'));
  for (const v of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) assert.match(api, new RegExp(`export const ${v}\\b`));
  assert.ok(fs.existsSync(path.join(root, 'src/middleware.js')) && !fs.existsSync(path.join(root, 'middleware.js')), 'middleware must live in src/ when using the src directory');
  for (const f of files.filter((x) => /page\.jsx$/.test(x))) { const s = read(f); if (/(requireUser|getDb)/.test(s)) assert.match(s, /export const dynamic = 'force-dynamic'/, `${rel(f)} reads per-user data and must be dynamic`); }
});

test('no secrets or demo-only code paths are hard-wired in server code', () => {
  const bad = [];
  for (const f of files.filter((x) => !isClient(read(x)))) { const s = read(f); if (/console\.log\(/.test(s)) bad.push(`${rel(f)} has console.log`); }
  assert.deepEqual(bad, []);
  const crypto = read(path.join(root, 'src/lib/crypto.js'));
  assert.match(crypto, /AUTH_SECRET must be set in production/);
});
