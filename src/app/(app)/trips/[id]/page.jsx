import { requireUser, guard } from '@/lib/session';
import { getDb } from '@/lib/db';
import { getTrip } from '@/lib/services/trips';
import { TripDetailView } from '@/views/trip-detail';

export const dynamic = 'force-dynamic';
export default async function Page({ params }) {
  const user = await requireUser();
  const { id } = await params;
  const data = guard(() => getTrip(getDb(), user, Number(id)));
  return <TripDetailView user={user} data={data} />;
}
