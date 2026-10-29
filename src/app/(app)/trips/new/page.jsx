import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { masterList } from '@/lib/services/queries';
import { TripFormView } from '@/views/trips';

export const dynamic = 'force-dynamic';
export default async function Page() {
  const user = await requireUser();
  return <TripFormView user={user} master={masterList(getDb(), user)} />;
}
