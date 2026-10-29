import { requireUser } from '@/lib/session';
import { HelpView } from '@/views/admin';

export const dynamic = 'force-dynamic';
export default async function Page() { const user = await requireUser(); return <HelpView user={user} />; }
