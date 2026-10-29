import test from 'node:test';
import assert from 'node:assert/strict';
import { getDb, resetDbForTests } from '@/lib/db';
import { migrateDemoAccounts } from '@/lib/seed';
import { hashPassword, verifyPassword } from '@/lib/crypto';

test('database seeds with consistent reference data', () => {
  resetDbForTests();
  const db = getDb();
  const c = (t) => db.get(`SELECT COUNT(*) c FROM ${t}`).c;
  assert.equal(c('users'), 16);
  assert.ok(c('trips') > 60, 'trips seeded');
  assert.ok(c('bookings') > 40, 'bookings seeded');
  assert.ok(c('expense_reports') >= 14);
  assert.equal(c('policy_rules'), 12);
  // every trip number is unique and formatted
  const bad = db.all("SELECT trip_no FROM trips WHERE trip_no NOT GLOB 'BT-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9]'");
  assert.equal(bad.length, 0);
  // foreign keys are enforced
  assert.throws(() => db.run('INSERT INTO trips(trip_no,created_by,traveller_id,purpose,title,travel_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)', 'X', 999, 999, 'p', 't', 'Domestic', 'a', 'b'));
});

test('audit log is immutable', () => {
  const db = getDb();
  db.run("INSERT INTO audit_log(ts,action) VALUES('now','test')");
  assert.throws(() => db.run("UPDATE audit_log SET action='x'"), /immutable/);
  assert.throws(() => db.run('DELETE FROM audit_log'), /immutable/);
});

test('legacy demo accounts migrate to the current IDs and password', () => {
  const db = getDb();
  for (const [emp, email] of [
    ['EMP001', 'rabindra.shau@abccorp.com'],
    ['EMP002', 'amit.singh@abccorp.com'],
    ['EMP020', 'anita.desai@abccorp.com'],
    ['EMP022', 'sujata.nair@abccorp.com'],
  ]) {
    db.run('UPDATE users SET email=?, password_hash=? WHERE emp_id=?', email, hashPassword('Password@123'), emp);
  }

  migrateDemoAccounts(db);

  for (const [emp, email] of [
    ['EMP001', 'sujit@xgeniq.com'],
    ['EMP002', 'manager@xgeniq.com'],
    ['EMP020', 'travel@xgeniq.com'],
    ['EMP022', 'admin@xgeniq.com'],
  ]) {
    const user = db.get('SELECT email, password_hash FROM users WHERE emp_id=?', emp);
    assert.equal(user.email, email);
    assert.equal(verifyPassword('Sujit@909', user.password_hash), true);
  }
});
