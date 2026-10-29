import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh } from './helpers';
import { readiness, assess } from '@/lib/services/queries';
const withoutTime = ({ last_checked, ...row }) => row;

test('batched readiness matches individual assessments, bounds reads, and refreshes changed data', () => {
  const db = fresh();
  const user = db.get("SELECT * FROM users WHERE role='admin' LIMIT 1");
  let reads = 0;
  const measured = { ...db, get: (...args) => { reads++; return db.get(...args); }, all: (...args) => { reads++; return db.all(...args); } };
  const result = readiness(measured, user, { days: 365, size: 100 });
  assert.ok(result.total > 1);
  assert.ok(reads <= 10, `Expected bounded read count, got ${reads}`);
  for (const row of result.rows) {
    const trip = db.get('SELECT * FROM trips WHERE id=?', row.id);
    assert.deepEqual(withoutTime(row), withoutTime(assess(db, trip)));
  }
  const row = result.rows[0]; const trip = db.get('SELECT * FROM trips WHERE id=?', row.id);
  const original = db.all('SELECT * FROM emergency_contacts WHERE user_id=?', trip.traveller_id);
  try {
    db.run('DELETE FROM emergency_contacts WHERE user_id=?', trip.traveller_id);
    const updated = readiness(db, user, { days: 365, size: 100 }).rows.find((r) => r.id === row.id);
    assert.equal(updated.checklist.find((c) => c.key === 'emergency').status, 'Missing');
    assert.deepEqual(withoutTime(updated), withoutTime(assess(db, trip)));
  } finally {
    for (const contact of original) {
      const keys = Object.keys(contact);
      db.run(`INSERT INTO emergency_contacts (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => contact[k]));
    }
  }
});
