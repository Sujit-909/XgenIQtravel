import { notFound } from 'next/navigation';
import { requireUser, guard } from '@/lib/session';
import { getDb } from '@/lib/db';
import { getTrip } from '@/lib/services/trips';
import { masterList } from '@/lib/services/queries';
import { TripFormView } from '@/views/trips';

export const dynamic = 'force-dynamic';
export default async function Page({ params }) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const data = guard(() => getTrip(db, user, Number(id)));
  if (!data.can.edit) notFound();
  return <TripFormView user={user} master={masterList(db, user)} trip={data.trip} attachments={data.files} formId={data.trip.id} />;
}
