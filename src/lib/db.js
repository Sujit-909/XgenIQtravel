import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from './schema';
import { migrateDemoAccounts, seedDatabase } from './seed';

const norm = (params) =>
  params.map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v !== null && typeof v === 'object') return JSON.stringify(v);
    return v;
  });

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec(SCHEMA);
  return raw;
}

function wrap(raw, file) {
  const cache = new Map();
  const prep = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };
  let depth = 0;
  return {
    raw,
    file,
    all: (sql, ...p) => prep(sql).all(...norm(p)).map((r) => ({ ...r })),
    get: (sql, ...p) => { const r = prep(sql).get(...norm(p)); return r ? { ...r } : null; },
    run: (sql, ...p) => { const r = prep(sql).run(...norm(p)); return { id: Number(r.lastInsertRowid), changes: Number(r.changes) }; },
    exec: (sql) => raw.exec(sql),
    // Re-entrant transaction helper (inner calls simply join the outer transaction).
    tx(fn) {
      if (depth > 0) return fn();
      raw.exec('BEGIN IMMEDIATE');
      depth++;
      try {
        const out = fn();
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        try { raw.exec('ROLLBACK'); } catch { /* ignore */ }
        throw e;
      } finally {
        depth--;
      }
    },
  };
}

export function getDb() {
  if (!globalThis.__geniqDb) {
    const file = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'geniq.db');
    const db = wrap(open(file), file);
    globalThis.__geniqDb = db;
    if (!db.get('SELECT id FROM users LIMIT 1')) seedDatabase(db);
    migrateDemoAccounts(db);
  }
  return globalThis.__geniqDb;
}

export function resetDbForTests() {
  if (globalThis.__geniqDb) { try { globalThis.__geniqDb.raw.close(); } catch { /* ignore */ } }
  globalThis.__geniqDb = undefined;
}

export const json = (v, fallback = null) => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};
