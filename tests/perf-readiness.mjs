import { performance } from 'node:perf_hooks';
import { getDb } from '../src/lib/db';
import { readiness } from '../src/lib/services/queries';
const db = getDb();
const user = db.get("SELECT * FROM users WHERE role='admin' LIMIT 1");
let reads = 0;
const measured = { ...db, all: (...args) => { reads++; return db.all(...args); }, get: (...args) => { reads++; return db.get(...args); } };
for (let i = 0; i < 10; i++) readiness(measured, user, { days: 365, size: 100 });
const samples = []; reads = 0; let result;
for (let i = 0; i < 100; i++) { const start = performance.now(); result = readiness(measured, user, { days: 365, size: 100 }); samples.push(performance.now() - start); }
samples.sort((a,b) => a-b);
console.log(JSON.stringify({ trips: result.total, readsPerCall: reads / 100, medianMs: samples[50], p95Ms: samples[95], iterations: 100, fixture: 'seeded in-memory database, admin readiness, 365 days' }, null, 2));
