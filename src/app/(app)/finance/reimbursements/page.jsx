import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { listReimbursements, reimbursementDetail } from '@/lib/services/finance';
import { ReimbursementsView } from '@/views/finance';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }) {
  const user = await requireUser(['finance', 'admin']);
  const sp = (await searchParams) || {}; const db = getDb();
  const data = listReimbursements(db, user, sp);
  const id = Number(sp.open) || data.rows[0]?.id;
  let detail = null; if (id) { try { detail = reimbursementDetail(db, user, id); } catch { detail = null; } }
  return <ReimbursementsView data={data} detail={detail} />;
}
