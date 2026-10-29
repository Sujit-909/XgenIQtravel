import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { getTrip } from '@/lib/services/trips';
import { ServicesHubView } from '@/views/services-hub';

export const dynamic = 'force-dynamic';
const TYPES = ['flight', 'hotel', 'ground', 'visa', 'other'];
export default async function Page({ params, searchParams }) {
  const user = await requireUser();
  const { type } = await params; const sp = await searchParams;
  if (!TYPES.includes(type)) notFound();
  const db = getDb();
  const trips = db.all("SELECT id, trip_no, title, dep_date, ret_date, dest_city FROM trips WHERE (traveller_id=? OR created_by=?) AND status IN ('Approved','Booking In Progress','Travel In Progress') ORDER BY dep_date", user.id, user.id);
  let data = null;
  if (sp?.trip && trips.some((t) => String(t.id) === String(sp.trip))) data = getTrip(db, user, Number(sp.trip));
  return <ServicesHubView user={user} type={type} trips={trips} data={data} />;
}
