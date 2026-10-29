import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { listTrips } from '@/lib/services/trips';
import { TripsView } from '@/views/trips';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }) {
  const user = await requireUser();
  const sp = (await searchParams) || {};
  const data = listTrips(getDb(), user, sp);
  return <TripsView user={user} data={data} />;
}
