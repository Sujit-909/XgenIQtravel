import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { listApprovals } from '@/lib/services/approvals';
import { ApprovalsView } from '@/views/approvals';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }) {
  const user = await requireUser();
  const sp = (await searchParams) || {};
  const type = sp.type || (user.role === 'finance' ? 'expense' : 'trip');
  return <ApprovalsView user={user} data={listApprovals(getDb(), user, { ...sp, type })} />;
}
