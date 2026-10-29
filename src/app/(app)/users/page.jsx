import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { usersList } from '@/lib/services/queries';
import { UsersView } from '@/views/admin';

export const dynamic = 'force-dynamic';
export default async function Page() { const user = await requireUser(['admin']); return <UsersView me={user} users={usersList(getDb(), user)} />; }
