import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { listNotifications, getNotifSettings } from '@/lib/services/profile';
import { NotificationsView } from '@/views/profile';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }) {
  const user = await requireUser();
  const sp = (await searchParams) || {};
  const db = getDb();
  return <NotificationsView data={listNotifications(db, user, sp.category)} settings={getNotifSettings(db, user.id)} category={sp.category} />;
}
