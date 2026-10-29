import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { listPolicy } from '@/lib/services/policy';
import { PolicyView } from '@/views/admin';

export const dynamic = 'force-dynamic';
export default async function Page() { const user = await requireUser(); return <PolicyView user={user} data={listPolicy(getDb())} />; }
