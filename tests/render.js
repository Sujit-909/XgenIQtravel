import path from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { login } from './helpers';
import { ctx } from 'next/headers';

const root = path.resolve(__dirname, '..');

// Props passed from server components to client components must be plain, serialisable data.
export function assertSerializable(node, where = 'root', seen = new Set()) {
  if (node === null || node === undefined || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return;
  if (Array.isArray(node)) return node.forEach((c, i) => assertSerializable(c, `${where}[${i}]`, seen));
  if (React.isValidElement(node)) {
    const props = node.props || {};
    for (const [k, v] of Object.entries(props)) {
      if (k === 'children') { assertSerializable(v, `${where}>children`, seen); continue; }
      checkValue(v, `${where}<${typeof node.type === 'string' ? node.type : node.type?.name || 'Component'}>.${k}`, seen);
    }
    return;
  }
  throw new Error(`Unexpected node at ${where}: ${typeof node}`);
}
function checkValue(v, where, seen) {
  if (v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v)) return;
  if (typeof v === 'function') throw new Error(`Function passed as prop: ${where}`);
  if (typeof v === 'symbol' || typeof v === 'bigint') throw new Error(`Non-serialisable prop (${typeof v}): ${where}`);
  if (React.isValidElement(v)) return assertSerializable(v, where, seen);
  if (v instanceof Date) throw new Error(`Date passed as prop: ${where}`);
  if (typeof v === 'object') {
    if (seen.has(v)) return; seen.add(v);
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null && !Array.isArray(v)) throw new Error(`Class instance passed as prop: ${where}`);
    for (const [k, x] of Object.entries(v)) checkValue(x, `${where}.${k}`, seen);
  }
}

export async function renderPage(file, { who = 'emp', params = {}, sp = {} } = {}) {
  const cookie = who ? await login(who) : '';
  ctx.cookies = cookie ? { geniq_session: decodeURIComponent(cookie.split('=').slice(1).join('=')) } : {};
  const mod = require(path.join(root, 'src/app', file));
  const el = await mod.default({ params: Promise.resolve(params), searchParams: Promise.resolve(sp) });
  assertSerializable(el);
  return renderToString(el);
}
export async function expectRedirect(file, opts) {
  try { await renderPage(file, opts); } catch (e) { if (e.digest?.startsWith('NEXT_REDIRECT')) return e.to; if (e.digest === 'NEXT_NOT_FOUND') return 'NOT_FOUND'; throw e; }
  return null;
}
