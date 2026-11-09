import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fresh, EMAILS, api } from './helpers';
import { extractTravel } from '@/lib/travel-intent';
import { listTrips } from '@/lib/services/trips';
import { listReports } from '@/lib/services/expenses';
import { teamBookingAnalytics } from '@/lib/services/queries';

test('malformed calendar dates and zero-day durations reach validation without parser crashes', () => {
  for (const date of ['2026-99-99','2026-02-31']) {
    const parsed=extractTravel(`Plan a trip to Delhi on ${date} for three days`,{},'2026-11-05');
    assert.equal(parsed.departure,date);
    assert.equal(parsed.return_date,date);
  }
  assert.doesNotThrow(()=>extractTravel('Plan a trip to Delhi on 2026-11-15 for 0 days',{},'2026-11-05'));
});

test('invalid assistant flight and hotel search fields return validation errors rather than HTTP 500', async () => {
  fresh();
  const r=await api('emp','POST','/employee-assistant/chat',{message:'Create a trip to Delhi',request_id:randomUUID()});
  assert.equal(r.status,200);
  for(const tool of ['searchFlights','searchHotels']) {
    const invalid=await api('emp','POST','/employee-assistant/chat',{action:'travel_tool',conversation_token:r.data.conversation_token,request_id:randomUUID(),travel:{plan_id:r.data.travel.plan_id,version:r.data.travel.version,tool}});
    assert.equal(invalid.status,400);
    assert.match(invalid.data.error,/date/i);
  }
});

test('month-end reports compare the actual previous calendar month without rollover', (t) => {
  const db=fresh();const user=db.get('SELECT * FROM users WHERE email=?',EMAILS.emp);const manager=db.get('SELECT * FROM users WHERE email=?',EMAILS.mgr);
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-03-31T12:00:00Z')});
  try {
    db.run("UPDATE trips SET created_at='2000-01-01' WHERE traveller_id=?",user.id);
    const trips=db.all('SELECT id FROM trips WHERE traveller_id=? LIMIT 3',user.id);assert.equal(trips.length,3);
    db.run("UPDATE trips SET created_at='2026-02-15' WHERE id=?",trips[0].id);
    for(const trip of trips.slice(1))db.run("UPDATE trips SET created_at='2026-03-15' WHERE id=?",trip.id);
    assert.equal(listTrips(db,user,{}).kpis.totalDelta,100);
    db.run("UPDATE expense_reports SET created_at='2000-01-01' WHERE user_id=?",user.id);
    const reports=db.all('SELECT id FROM expense_reports WHERE user_id=? LIMIT 2',user.id);assert.equal(reports.length,2);
    for(const report of reports)db.run("UPDATE expense_reports SET status='Draft',created_at='2026-02-15' WHERE id=?",report.id);
    assert.equal(listReports(db,user,{}).kpis.Draft.delta,-100);
    assert.deepEqual(teamBookingAnalytics(db,manager,{}).trend.map(r=>r.label),['2026-01','2026-02','2026-03']);
  } finally {t.mock.timers.reset();}
});
