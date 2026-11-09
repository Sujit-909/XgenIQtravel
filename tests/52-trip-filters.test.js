import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { fresh, EMAILS } from './helpers';
import { listTrips } from '@/lib/services/trips';
import TripFilters, { tripDateRange } from '@/components/TripFilters';
import { state } from 'next/navigation';

test('trip filters combine existing fields with destination and traveler before pagination', () => {
  const db = fresh(); const user = db.get('SELECT * FROM users WHERE email=?', EMAILS.admin);
  const all = listTrips(db, user, { size: 100 }); const trip = all.rows.find((t) => t.department && t.dest_city);
  assert.ok(trip);
  const filters = { status: trip.status, destination: trip.dest_city, department: trip.department, traveller_id: trip.traveller_id, travel_type: trip.travel_type, purpose: trip.purpose, from: trip.dep_date, to: trip.dep_date, q: trip.trip_no, size: 1 };
  const matching = listTrips(db, user, filters);
  assert.equal(matching.total, 1); assert.equal(matching.rows[0].id, trip.id);
  assert.deepEqual(matching.kpis, all.kpis, 'KPI behavior is unchanged');
  assert.deepEqual(matching.byStatus, all.byStatus, 'Chart and status-table aggregates are unchanged');
  assert.deepEqual(matching.destinations, all.destinations, 'Choices cover the complete accessible scope');
  assert.deepEqual(matching.travellers, all.travellers);
  assert.equal(listTrips(db, user, { ...filters, destination: '__no_matching_destination__' }).total, 0);
  assert.equal(listTrips(db, user, { ...filters, traveller_id: -1 }).total, 0);
  assert.equal(listTrips(db, user, { status: '', destination: '', traveller_id: '', from: '', to: '', q: '' }).total, all.total);
});

test('traveler and destination choices respect role scope and do not grant access', () => {
  const db = fresh();
  for (const role of ['emp', 'mgr']) {
    const user = db.get('SELECT * FROM users WHERE email=?', EMAILS[role]);
    const data = listTrips(db, user, { size: 100 });
    const ids = new Set(data.travellers.map((t) => t.id));
    assert.ok(data.rows.every((t) => ids.has(t.traveller_id)));
    const outsider = db.all('SELECT id FROM users').find((u) => !ids.has(u.id));
    assert.ok(outsider);
    const filtered = listTrips(db, user, { traveller_id: outsider.id });
    assert.equal(filtered.total, 0);
    assert.ok(filtered.travellers.every((t) => t.id !== outsider.id));
    assert.equal(listTrips(db, user, { destination: "' OR 1=1 --" }).total, 0);
  }
});

test('date presets map to the existing inclusive departure range', () => {
  assert.deepEqual(tripDateRange('week', '2026-11-04'), { from: '2026-11-04', to: '2026-11-10' });
  assert.deepEqual(tripDateRange('month', '2026-11-04'), { from: '2026-11-04', to: '2026-12-03' });
  assert.deepEqual(tripDateRange('calendar', '2028-02-12'), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(tripDateRange('', '2026-11-04'), { from: '', to: '' });
});

test('filter section renders selected URL state, real counts and all requested controls', () => {
  const db = fresh(); const user = db.get('SELECT * FROM users WHERE email=?', EMAILS.emp);
  const data = listTrips(db, user, {});
  const dates = tripDateRange('week', data.filterToday);
  state.search = new URLSearchParams({ status: 'Closed', view: 'upcoming', purpose: 'Client meeting', ...dates });
  try {
    const html = renderToString(React.createElement(TripFilters, { data }));
    for (const text of ['Trip Date', 'Trip Type', 'Destination', 'Department', 'Traveler', 'More trip statuses', 'Reset', 'Apply Filters', 'Search trips', 'Request Purpose', 'Dashboard filter']) assert.ok(html.includes(text), text);
    assert.match(html, /value="Closed" selected=""/);
    assert.match(html, /value="week" selected=""/);
    for (const status of ['Travel In Progress', 'Expenses Pending', 'Closed', 'Rejected', 'Cancelled']) assert.ok(html.includes(`${status} (${data.counts[status] || 0})`));
    assert.match(html, /type="submit"/);
  } finally { state.search = new URLSearchParams(); }
});
