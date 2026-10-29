import { requireUser, guard } from '@/lib/session';
import { getDb } from '@/lib/db';
import { getReport } from '@/lib/services/expenses';
import { ExpenseReportView } from '@/views/expenses';

export const dynamic = 'force-dynamic';
export default async function Page({ params, searchParams }) {
  const user = await requireUser();
  const { id } = await params; const sp = (await searchParams) || {};
  const data = guard(() => getReport(getDb(), user, Number(id)));
  return <ExpenseReportView user={user} data={data} step={sp.step || 'items'} autoUpload={sp.upload === '1'} />;
}
