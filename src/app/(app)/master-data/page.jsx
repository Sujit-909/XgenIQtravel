import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { masterList } from '@/lib/services/queries';
import { MasterView } from '@/views/admin';

export const dynamic = 'force-dynamic';
export default async function Page() { const user = await requireUser(['admin', 'finance', 'travel_desk']); return <MasterView user={user} rows={masterList(getDb(), user)} />; }
