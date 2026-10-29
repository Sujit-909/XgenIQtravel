import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { dashboard } from '@/lib/services/queries';
import DashboardView from '@/views/dashboard';

export const dynamic = 'force-dynamic';
export default async function Page() {
  const user = await requireUser();
  return <DashboardView user={user} data={dashboard(getDb(), user)} />;
}
