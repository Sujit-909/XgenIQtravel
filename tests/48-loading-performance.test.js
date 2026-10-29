import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh } from './helpers';
import { listApprovals } from '@/lib/services/approvals';
import { report } from '@/lib/services/queries';
import { profileBundle } from '@/lib/services/profile';
import { round2 } from '@/lib/util';

test('approval aggregation preserves user/role visibility and global KPIs across filters', () => {
  const db = fresh();
  for (const role of ['employee', 'manager', 'finance', 'admin']) {
    const user = db.get('SELECT * FROM users WHERE role=? LIMIT 1', role);
    const all = db.all('SELECT * FROM approvals WHERE approver_id=? OR (approver_id IS NULL AND approver_role=?)', user.id, role);
    for (const type of ['trip', 'expense', 'booking']) {
      const base = all.filter(a => a.entity_type === type);
      for (const status of ['Pending', 'Approved', 'All', 'Pending > 7 days']) {
        const result = listApprovals(db, user, { type, status, size: 5 });
        assert.deepEqual(result.kpis, {
          total: base.length, pending: base.filter(a=>a.status==='Pending').length,
          approved: base.filter(a=>a.status==='Approved').length, rejected: base.filter(a=>a.status==='Rejected').length,
          overdue: base.filter(a=>a.status==='Pending' && Date.now()-Date.parse(a.created_at)>7*86400000).length,
        });
        assert.deepEqual(result.tabs, Object.fromEntries(['trip','expense','booking'].map(t=>[t,all.filter(a=>a.entity_type===t && a.status==='Pending').length])));
        assert.ok(result.rows.length <= 5);
        assert.ok(result.rows.every(r=>all.some(a=>a.id===r.approval_id)));
      }
    }
  }
});

test('approval history reads stay bounded and changed decisions are immediately reflected', () => {
  const db = fresh(); const user = db.get("SELECT * FROM users WHERE role='manager' LIMIT 1");
  const original = db.get("SELECT * FROM approvals WHERE entity_type='trip' LIMIT 1");
  db.tx(()=>{for(let i=0;i<1000;i++)db.run('INSERT INTO approvals(entity_type,entity_id,level,label,approver_id,status,created_at) VALUES(?,?,?,?,?,?,?)','trip',original.entity_id,1,'History',user.id,'Pending','2020-01-01T00:00:00.000Z');});
  let rowsRead=0;
  const measured={...db,all:(...args)=>{const rows=db.all(...args);rowsRead+=rows.length;return rows;}};
  const before=listApprovals(measured,user,{size:5});
  assert.ok(rowsRead<=8,`Materialized ${rowsRead} rows`);
  db.run("UPDATE approvals SET status='Approved' WHERE id=?",before.rows[0].approval_id);
  const after=listApprovals(db,user,{size:5});
  assert.equal(after.kpis.pending,before.kpis.pending-1);
  assert.equal(after.kpis.approved,before.kpis.approved+1);
});

test('department expense batching preserves report amounts with a bounded query count', () => {
  const db=fresh();
  for(const role of ['manager','finance','admin']){
    const user=db.get('SELECT * FROM users WHERE role=? LIMIT 1',role);
    let reads=0;
    const measured={...db,all:(...args)=>{reads++;return db.all(...args);},get:(...args)=>{reads++;return db.get(...args);}};
    const result=report(measured,user,'department_spend');
    assert.ok(reads<=3,`Expected two grouped queries plus manager scope, got ${reads}`);
    for(const row of result.rows){
      const expected=db.get('SELECT COALESCE(SUM((i.amount+i.tax)*i.fx_rate),0) s FROM expense_items i JOIN expense_reports e ON e.id=i.report_id JOIN users u ON u.id=e.user_id WHERE u.department=?',row[0]).s;
      assert.equal(row[3],round2(expected));
    }
  }
  const employee=db.get("SELECT * FROM users WHERE role='employee' LIMIT 1");
  assert.throws(()=>report(db,employee,'department_spend'),e=>e.status===403);
});

test('profile statistics reuse the displayed documents without a duplicate read', () => {
  const db=fresh();const user=db.get("SELECT * FROM users WHERE role='employee' LIMIT 1");
  let documentReads=0;
  const measured={...db,all:(sql,...args)=>{if(sql.includes('FROM documents'))documentReads++;return db.all(sql,...args);}};
  const bundle=profileBundle(measured,user);
  assert.equal(documentReads,1);
  assert.equal(bundle.stats.documents,bundle.data.documents.length);
  assert.equal(bundle.stats.documentsValid,bundle.data.documents.filter(d=>['Valid','Verified'].includes(d.status)).length);
});
