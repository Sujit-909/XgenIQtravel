import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { reconciliation, reconciliationDetail } from '@/lib/services/finance';
import { ReconciliationView } from '@/views/finance';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }) {
  const user = await requireUser(['finance', 'admin']);
  const sp = (await searchParams) || {}; const db = getDb();
  const data = reconciliation(db, user, sp);
  const id = Number(sp.open) || data.rows[0]?.booking_id;
  let detail = null; if (id) { try { detail = reconciliationDetail(db, user, id); } catch { detail = null; } }
  return <ReconciliationView data={data} detail={detail} />;
}
