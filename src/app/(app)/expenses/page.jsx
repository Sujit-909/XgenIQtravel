import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { listReports } from '@/lib/services/expenses';
import { ExpensesView } from '@/views/expenses';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }) {
  const user = await requireUser();
  const sp = (await searchParams) || {};
  return <ExpensesView user={user} data={listReports(getDb(), user, sp)} />;
}
