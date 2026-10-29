// Pure helper (no server imports) so the client trip page can compute service tiles too.
export const SERVICE_TYPES = ['flight', 'hotel', 'ground', 'visa', 'other'];
export function serviceTiles(trip, services) {
  const label = (type) => {
    const s = services.find((x) => x.type === type && x.status !== 'Cancelled');
    if (!s) return type === 'visa' && trip.travel_type !== 'International' ? 'Not Required' : type === 'other' ? 'Optional' : 'Not Requested';
    if (s.status === 'Draft') return 'Draft'; if (s.status === 'Confirmed') return 'Confirmed'; if (s.status === 'Failed') return 'Failed';
    return 'In Progress';
  };
  return SERVICE_TYPES.map((t) => ({ type: t, status: label(t) }));
}
