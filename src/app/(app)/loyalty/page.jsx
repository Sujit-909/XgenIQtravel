import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { listEntity } from '@/lib/services/profile';
import { LoyaltyView } from '@/views/profile';

export const dynamic = 'force-dynamic';
export default async function Page() { const user = await requireUser(); return <LoyaltyView items={listEntity(getDb(), user, 'loyalty-programs')} />; }
