import { Suspense } from 'react';
import Shell from '@/components/Shell';
import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { navFor } from '@/lib/nav';
import { pendingCount } from '@/lib/services/approvals';
import { unreadCount } from '@/lib/services/profile';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }) {
  const user = await requireUser();
  const db = getDb();
  const counts = { pending: pendingCount(db, user), unread: unreadCount(db, user) };
  return <Suspense fallback={null}><Shell user={user} nav={navFor(user)} counts={counts}>{children}</Shell></Suspense>;
}
