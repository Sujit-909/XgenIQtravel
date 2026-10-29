import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { integrations } from '@/lib/services/queries';
import { IntegrationsView } from '@/views/admin';

export const dynamic = 'force-dynamic';
export default async function Page() { const user = await requireUser(['admin']); return <IntegrationsView rows={integrations(getDb(), user)} />; }
