import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { listBookings, getBooking } from '@/lib/services/bookings';
import { BookingsView } from '@/views/bookings';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }) {
  const user = await requireUser();
  const sp = (await searchParams) || {};
  const db = getDb();
  const data = listBookings(db, user, { ...sp, scope: 'mine' });
  let detail = null;
  const id = Number(sp.selected) || data.rows[0]?.id;
  if (id) { try { detail = getBooking(db, user, id); } catch { detail = null; } }
  return <BookingsView user={user} data={data} detail={detail} />;
}
