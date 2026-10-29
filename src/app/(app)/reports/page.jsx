import { requireUser, guard } from '@/lib/session';
import { getDb } from '@/lib/db';
import { report, REPORTS } from '@/lib/services/queries';
import { ReportsView } from '@/views/admin';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }) {
  const user = await requireUser(['manager', 'finance', 'travel_desk', 'admin']);
  const sp = (await searchParams) || {};
  const current = REPORTS[sp.type] ? sp.type : 'actual_vs_budget';
  return <ReportsView list={Object.entries(REPORTS)} current={current} data={guard(() => report(getDb(), user, current))} />;
}
