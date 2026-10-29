import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { masterList } from '@/lib/services/queries';
import { ExpenseCreateView } from '@/views/expenses';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }) {
  const user = await requireUser();
  const sp = (await searchParams) || {};
  const db = getDb();
  const trips = db.all("SELECT * FROM trips WHERE traveller_id=? AND status IN ('Approved','Booking In Progress','Travel In Progress','Expenses Pending','Closed') ORDER BY dep_date DESC", user.id);
  return <ExpenseCreateView user={user} trips={trips} master={masterList(db, user)} preselect={sp.trip || ''} upload={sp.upload === '1'} />;
}
