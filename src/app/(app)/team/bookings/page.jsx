import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { teamBookingAnalytics } from '@/lib/services/queries';
import { TeamBookingsView } from '@/views/ops';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }) {
  const user = await requireUser(['manager', 'admin', 'travel_desk', 'finance']);
  return <TeamBookingsView data={teamBookingAnalytics(getDb(), user, (await searchParams) || {})} />;
}
