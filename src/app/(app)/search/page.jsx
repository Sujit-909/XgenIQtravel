import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { SearchView } from '@/views/bookings';
import { addDays, today } from '@/lib/util';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }) {
  const user = await requireUser();
  const sp = (await searchParams) || {};
  const trips = getDb().all("SELECT id, trip_no, dep_city, dest_city, dep_date, ret_date FROM trips WHERE traveller_id=? AND status IN ('Approved','Booking In Progress')", user.id);
  const t = trips.find((x) => String(x.id) === String(sp.trip));
  const initial = { trip_id: t ? String(t.id) : '', from: user.homeAirport || 'BBI', to: 'BOM', date: t?.dep_date || addDays(today(), 14), return_date: t?.ret_date || addDays(today(), 16), cabin: 'Economy', city: t?.dest_city || 'Mumbai' };
  return <SearchView user={user} trips={trips} initial={initial} />;
}
