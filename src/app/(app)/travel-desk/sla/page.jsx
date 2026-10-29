import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { slaMonitor } from '@/lib/services/desk';
import { SlaView } from '@/views/ops';

export const dynamic = 'force-dynamic';
export default async function Page() { const user = await requireUser(['travel_desk', 'admin']); return <SlaView data={slaMonitor(getDb(), user)} />; }
