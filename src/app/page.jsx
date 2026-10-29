import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { listQueue, serviceDetail } from '@/lib/services/desk';
import { DeskView } from '@/views/ops';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }) {
  const user = await requireUser(['travel_desk', 'admin']);
  const sp = (await searchParams) || {}; const db = getDb();
  const data = listQueue(db, user, sp);
  const id = Number(sp.open) || data.rows[0]?.id;
  let detail = null; if (id) { try { detail = serviceDetail(db, user, id); } catch { detail = null; } }
  return <DeskView user={user} data={data} detail={detail} />;
}
