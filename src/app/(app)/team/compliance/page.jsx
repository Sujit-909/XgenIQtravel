import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { teamCompliance } from '@/lib/services/queries';
import { ComplianceView } from '@/views/ops';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }) {
  const user = await requireUser(['manager', 'admin', 'travel_desk']);
  return <ComplianceView data={teamCompliance(getDb(), user, (await searchParams) || {})} />;
}
