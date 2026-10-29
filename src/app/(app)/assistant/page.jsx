import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { history } from '@/lib/services/assistant';
import { AssistantView } from '@/views/assistant';

export const dynamic = 'force-dynamic';
export default async function Page() {
  const user = await requireUser();
  return <AssistantView user={user} initial={history(getDb(), user)} />;
}
