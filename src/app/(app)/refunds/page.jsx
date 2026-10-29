import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { listRefunds, refundDetail } from '@/lib/services/finance';
import { RefundsView } from '@/views/ops';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }) {
  const user = await requireUser();
  const sp = (await searchParams) || {};
  const db = getDb(); const data = listRefunds(db, user, sp);
  const id = Number(sp.selected) || data.rows[0]?.booking_id;
  let detail = null; if (id) { try { detail = refundDetail(db, user, id); } catch { detail = null; } }
  return <RefundsView user={user} data={data} detail={detail} />;
}
