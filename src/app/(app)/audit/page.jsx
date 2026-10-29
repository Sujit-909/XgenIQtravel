import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { auditLog } from '@/lib/services/queries';
import { AuditView } from '@/views/admin';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }) { const user = await requireUser(['admin']); return <AuditView data={auditLog(getDb(), user, (await searchParams) || {})} />; }
