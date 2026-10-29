import { nowIso } from '../util';

// Create a sequential approval chain; level 1 starts Pending, the rest Waiting.
export function createChain(db, entityType, entityId, steps) {
  steps.forEach((s, i) => {
    db.run('INSERT INTO approvals(entity_type,entity_id,level,label,note,approver_id,approver_role,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      entityType, entityId, i + 1, s.label, s.note ?? null, s.approverId ?? null, s.approverRole ?? null, i === 0 ? 'Pending' : 'Waiting', nowIso());
  });
}

export const approvalsFor = (db, entityType, entityId) => db.all(
  `SELECT a.*, u.name approver_name FROM approvals a LEFT JOIN users u ON u.id=a.approver_id
   WHERE a.entity_type=? AND a.entity_id=? ORDER BY a.level, a.id`, entityType, entityId);

// Everyone reporting (directly or indirectly) to a user, plus the user.
export function teamIds(db, userId) {
  return db.all(
    `WITH RECURSIVE t(id) AS (SELECT ? UNION SELECT u.id FROM users u JOIN t ON u.manager_id=t.id) SELECT id FROM t`, userId,
  ).map((r) => r.id);
}
export const hasReports = (db, userId) => !!db.get('SELECT 1 x FROM users WHERE manager_id=? LIMIT 1', userId);
export const userName = (db, id) => (id ? db.get('SELECT name FROM users WHERE id=?', id)?.name || '' : '');
