import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, EMAILS } from './helpers';
import { dashboard } from '@/lib/services/queries';
import { listTrips } from '@/lib/services/trips';
import { listReports } from '@/lib/services/expenses';
import { listReimbursements, listRefunds, reconciliation } from '@/lib/services/finance';
import { listQueue, STAGES } from '@/lib/services/desk';
import { listApprovals } from '@/lib/services/approvals';
import { renderPage } from './render';
import { state } from 'next/navigation';
import { listEntity } from '@/lib/services/profile';

test('dashboard destinations match counts and retain scope across pagination', () => {
  const db = fresh();
  const user = (who) => db.get('SELECT * FROM users WHERE email=?', EMAILS[who]);
  for (const who of ['emp', 'mgr', 'desk', 'fin', 'admin']) {
    const u = user(who); const d = dashboard(db, u); const k = d.kpis;
    if (who === 'emp') {
      const upcoming = listTrips(db, u, { view: 'upcoming', size: 1 });
      assert.equal(upcoming.total, k.upcoming);
      assert.ok(upcoming.rows.every((r) => r.traveller_id === u.id));
      if (upcoming.total > 1) {
        const next = listTrips(db, u, { view: 'upcoming', size: 1, page: 2 });
        assert.equal(next.total, upcoming.total);
        assert.notEqual(next.rows[0].id, upcoming.rows[0].id);
      }
      assert.equal(listTrips(db, u, { view: 'waiting' }).total, k.waiting);
      const docs = listEntity(db, u, 'documents');
      assert.equal(docs.filter((r) => r.status === 'Expiring Soon' && r.days_left <= 7).length, k.expiringSoon);
      assert.equal(docs.filter((r) => r.status === 'Expired').length, k.expired);
      const pending = listReports(db, u, { view: 'to-submit', scope: 'mine' });
      assert.equal(pending.total + pending.pendingTrips.length, k.expensesPending);
      assert.ok(pending.rows.every((r) => r.user_id === u.id));
    }
    if (who === 'mgr') {
      assert.equal(listTrips(db, u, { view: 'upcoming', scope: 'team', size: 1 }).total, k.teamTrips);
      for (const [type, key] of [['trip', 'pendingTrips'], ['expense', 'pendingExpenses'], ['booking', 'exceptions']]) {
        assert.equal(listApprovals(db, u, { type, status: 'Pending' }).total, k[key]);
      }
    }
    if (who === 'desk') for (const tab of STAGES) assert.equal(listQueue(db, u, { tab, size: 1 }).total, k[tab]);
    if (who === 'fin') {
      assert.equal(listApprovals(db, u, { type: 'expense', status: 'Pending' }).total, k.expenseApprovals);
      assert.equal(listReimbursements(db, u, { payment_status: 'Payable' }).total, k.payable);
      assert.equal(listReimbursements(db, u, { payment_status: 'Failed / Returned' }).total, k.failed);
      assert.equal(reconciliation(db, u, { match: 'Missing Invoice' }).total, k.exceptions);
    }
    if (['mgr', 'fin', 'desk'].includes(who)) {
      assert.equal(listRefunds(db, u, { status: 'Unresolved', size: 1 }).total, who === 'desk' ? d.refunds : k.refunds);
    }
  }
  assert.throws(() => listQueue(db, user('emp'), {}));
  assert.throws(() => listReimbursements(db, user('mgr'), {}));
});

test('every dashboard summary renders one complete link to an existing listing', async () => {
  fresh();
  for (const [who, count] of [['emp', 5], ['mgr', 6], ['desk', 7], ['fin', 5], ['admin', 5]]) {
    state.search = new URLSearchParams();
    const html = await renderPage('(app)/dashboard/page.jsx', { who });
    const cards = [...html.matchAll(/<a\b[^>]*class="stat summary-card [^"]*"[^>]*>[\s\S]*?<\/a>/g)];
    assert.equal(cards.length, count, who);
    for (const [card] of cards) {
      assert.match(card, /href="\/(trips|documents|expenses|approvals|readiness|refunds|travel-desk|finance|users|policy|reports|audit)/);
      assert.equal((card.match(/<a\b/g) || []).length, 1);
      assert.doesNotMatch(card, /<button\b/);
    }
  }
});
