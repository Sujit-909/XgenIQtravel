import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { profileBundle, syncAlerts } from '@/lib/services/profile';
import { ProfileView } from '@/views/profile';

export const dynamic = 'force-dynamic';
export default async function Page() {
  const user = await requireUser();
  const db = getDb(); syncAlerts(db, user);
  return <ProfileView data={profileBundle(db, user)} />;
}
