import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { readiness, assess } from '@/lib/services/queries';
import { ReadinessView } from '@/views/ops';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }) {
  const user = await requireUser(['manager', 'admin', 'travel_desk']);
  const sp = (await searchParams) || {}; const db = getDb();
  const data = readiness(db, user, sp);
  const open = Number(sp.open) || data.rows[0]?.id;
  const selected = data.rows.find((r) => r.id === open) || (open ? (() => { const t = db.get('SELECT * FROM trips WHERE id=?', open); return t ? assess(db, t) : null; })() : null);
  return <ReadinessView data={data} selected={selected} />;
}
