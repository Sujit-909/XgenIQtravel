'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Card, Badge, Btn, Field, Input, Select, Icon, Empty, useApi } from '@/components/ui';
import { AIRPORTS, AIRPORT_OF_CITY } from '@/lib/constants';
import { CABINS, validateFlightSearch, filterFlights, flightDuration } from '@/lib/flight-search';
import { inr, fdt } from '@/lib/format';

const EMPTY_FILTERS = { airline: '', stops: '', max_price: '', max_duration: '', departure: '', arrival: '', sort: 'recommended' };
const price = (value) => value === null || value === undefined ? 'Price unavailable' : inr(value);
const initial = (trip) => ({ type: 2, departure_id: AIRPORT_OF_CITY[trip.dep_city] || '', arrival_id: AIRPORT_OF_CITY[trip.dest_city] || '', outbound_date: trip.dep_date, return_date: trip.ret_date, adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0, travel_class: 1 });
function AirlineLogo({ src }) { return src ? <img src={src} alt="" width="28" height="28" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : <Icon name="plane" size={24} />; }
function AirportInput({ label, value, onChange, disabled }) {
  const id = React.useId();
  return <Field label={label} required><Input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} list={id} maxLength={100} placeholder="City or IATA code" required autoComplete="off" /><datalist id={id}>{AIRPORTS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</datalist></Field>;
}
function Itinerary({ flight, children }) {
  const first = flight.segments[0]; const last = flight.segments.at(-1);
  if (!first || !last) return null;
  return <article className="flight-itinerary">
    <div className="row between wrap"><div className="row"><AirlineLogo src={flight.logo || first.logo} /><div><b>{[...new Set(flight.segments.map((s) => s.airline).filter(Boolean))].join(', ') || 'Airline not provided'}</b><div className="small muted">{flight.segments.map((s) => s.flight_number).filter(Boolean).join(' / ') || 'Flight number unavailable'}</div></div></div>{flight.recommended && <Badge tone="green">Recommended</Badge>}</div>
    <div className="flight-route"><div><b>{first.departure.id || first.departure.name}</b><div>{first.departure.time || 'Time unavailable'}</div><div className="small muted">{first.departure.name}</div></div><div className="center small"><Icon name="plane" size={16} /><div>{flightDuration(flight.duration)}</div><span className="muted">{flight.stops ? `${flight.stops} stop${flight.stops > 1 ? 's' : ''}` : 'Non-stop'}</span></div><div><b>{last.arrival.id || last.arrival.name}</b><div>{last.arrival.time || 'Time unavailable'}</div><div className="small muted">{last.arrival.name}</div></div></div>
    <div className="row between wrap"><span className="small muted">{[...new Set(flight.segments.map((s) => s.cabin).filter(Boolean))].join(' / ') || 'Cabin not provided'}</span><b>{price(flight.price)}</b></div>
    {flight.layovers.length > 0 && <div className="small muted">Layovers: {flight.layovers.map((l) => `${l.name || l.id} (${flightDuration(l.duration)})${l.overnight ? ', overnight' : ''}`).join('; ')}</div>}
    <details><summary>Flight details and fare conditions</summary><div className="stack mt-sm">{flight.segments.map((s, i) => <div key={i} className="small"><b>{s.flight_number || s.airline}</b> — {s.departure.id} {s.departure.time} → {s.arrival.id} {s.arrival.time}<div className="muted">{s.airplane} · {flightDuration(s.duration)} · {s.cabin}</div>{s.extensions.map((v, j) => <div key={j}>{v}</div>)}</div>)}{flight.extensions.map((v, i) => <div key={i} className="small">{v}</div>)}{flight.policy && <div className="small"><Badge>{flight.policy.status}</Badge>{flight.policy.checks.map((c, i) => <div key={i}>{c.label}: {c.detail}</div>)}</div>}</div></details>
    {children}
  </article>;
}
function Provider({ option }) {
  return <div className="flight-itinerary"><div className="row between wrap"><div className="row"><AirlineLogo src={option.logo} /><b>{option.provider}</b></div><b>{price(option.price)}</b></div>
    <div className="small muted">{option.airline === true ? 'Airline direct' : option.airline === false ? 'Third-party provider' : 'Provider type not supplied'}{option.leg !== 'together' ? ` · ${option.leg} flight` : ''}</div>
    {option.separate && <div className="warn small">Separate tickets: check each ticket and connection independently.</div>}
    {option.marketed_as.length > 0 && <div className="small">{option.marketed_as.join(', ')}</div>}{option.baggage.map((v, i) => <div key={i} className="small muted">{v}</div>)}
    {option.request ? option.request.fields ? <form method="post" action={option.request.url} target="_blank" rel="noopener noreferrer">{option.request.fields.map((f, i) => <input key={i} type="hidden" name={f.name} value={f.value} />)}<button className="btn outline" type="submit">Continue to {option.provider} <Icon name="link" size={14} /></button></form> : <a className="btn outline" href={option.request.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Continue to {option.provider} <Icon name="link" size={14} /></a> : <div className="small">{option.phone ? `Book by phone: ${option.phone}` : 'No booking link was supplied for this provider.'}</div>}
  </div>;
}

export default function FlightPortal({ trip }) {
  const api = useApi(); const lock = useRef(false); const generation = useRef(0);
  const [q, setQ] = useState(() => initial(trip)); const [legs, setLegs] = useState(() => [{ departure_id: AIRPORT_OF_CITY[trip.dep_city] || '', arrival_id: AIRPORT_OF_CITY[trip.dest_city] || '', date: trip.dep_date }, { departure_id: AIRPORT_OF_CITY[trip.dest_city] || '', arrival_id: AIRPORT_OF_CITY[trip.dep_city] || '', date: trip.ret_date }]);
  const [result, setResult] = useState(null); const [history, setHistory] = useState({ searches: [], options: [] }); const [historyError, setHistoryError] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS); const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const loadHistory = async () => { const r = await api('GET', `/flights/history?trip_id=${trip.id}`, undefined, { refresh: false, silent: true }); if (r.ok) { setHistory(r.data); setHistoryError(''); } else setHistoryError(r.error || 'Search history could not be loaded.'); };
  useEffect(() => {
    const version = ++generation.current;
    api('GET', `/flights/history?trip_id=${trip.id}`, undefined, { refresh: false, silent: true }).then((r) => { if (version === generation.current) { if (r.ok) setHistory(r.data); else setHistoryError(r.error || 'Search history could not be loaded.'); } });
    return () => { generation.current++; };
  }, [api, trip.id]);
  const request = async (name, endpoint, body, onSuccess) => {
    if (lock.current) return;
    lock.current = true; setBusy(name); setError(''); setNotice(''); const version = generation.current;
    try {
      const r = await api(body ? 'POST' : 'GET', endpoint, body, { refresh: false, silent: true });
      if (version !== generation.current) return;
      if (!r.ok) { setError(r.error || 'Flight search failed. Please try again.'); return; }
      onSuccess(r.data);
    } finally { lock.current = false; if (version === generation.current) setBusy(''); }
  };
  const search = (e) => {
    e.preventDefault(); let criteria;
    try { criteria = validateFlightSearch({ ...q, legs }); } catch (e) { setError(e.message); return; }
    setResult(null); setFilters(EMPTY_FILTERS);
    request('Searching flights', '/flights/search', { trip_id: trip.id, ...criteria }, (data) => { setResult(data); loadHistory(); });
  };
  const select = (offer) => {
    const nextLeg = result.stage + 1 < totalLegs;
    const endpoint = nextLeg ? 'next' : 'booking-options';
    request(nextLeg ? 'Loading next flights' : 'Loading booking options', `/flights/${endpoint}`, { search_id: result.search_id, offer_id: offer.id }, (data) => { setResult(data); setFilters(EMPTY_FILTERS); loadHistory(); });
  };
  const save = (offer) => request('Saving option', '/flights/options', { search_id: result.search_id, ...(offer ? { offer_id: offer.id } : {}) }, () => { setNotice('Travel option saved to this trip. No reservation or ticket has been issued.'); loadHistory(); });
  const set = (k, v) => setQ((old) => ({ ...old, [k]: v }));
  const changeLeg = (i, patch) => setLegs((old) => old.map((l, j) => j === i ? { ...l, ...patch } : l));
  const shown = filterFlights(result?.rows || [], filters);
  const airlines = [...new Set((result?.rows || []).flatMap((r) => r.segments.map((s) => s.airline)).filter(Boolean))].sort();
  const totalLegs = result?.criteria.type === 1 ? 2 : result?.criteria.type === 3 ? result.criteria.legs.length : 1;
  return <div className="stack flight-portal">
    <div className="note small">Compare live flight options in INR. Booking and payment take place with the provider. Saving an option or opening a provider website does not confirm a reservation or issue a ticket.</div>
    <form onSubmit={search} className="stack">
      <fieldset disabled={!!busy} className="flight-fieldset stack"><Field label="Journey type"><Select value={q.type} onChange={(e) => set('type', Number(e.target.value))} options={[[2, 'One-way'], [1, 'Round-trip'], [3, 'Multi-city']]} /></Field>
        {q.type !== 3 ? <div className="flight-search-grid"><AirportInput label="From airport / city" value={q.departure_id} onChange={(v) => set('departure_id', v)} /><button type="button" className="btn outline flight-swap" aria-label="Swap origin and destination" onClick={() => setQ({ ...q, departure_id: q.arrival_id, arrival_id: q.departure_id })}>⇄</button><AirportInput label="To airport / city" value={q.arrival_id} onChange={(v) => set('arrival_id', v)} /><Field label="Departure date" required><Input type="date" required value={q.outbound_date} onChange={(e) => set('outbound_date', e.target.value)} /></Field>{q.type === 1 && <Field label="Return date" required><Input type="date" required min={q.outbound_date} value={q.return_date} onChange={(e) => set('return_date', e.target.value)} /></Field>}</div> : <div className="stack">{legs.map((l, i) => <div key={i} className="flight-leg"><span className="small bold">Leg {i + 1}</span><AirportInput label={`From (leg ${i + 1})`} value={l.departure_id} onChange={(v) => changeLeg(i, { departure_id: v })} /><button className="btn outline flight-swap" type="button" aria-label={`Swap airports for leg ${i + 1}`} onClick={() => changeLeg(i, { departure_id: l.arrival_id, arrival_id: l.departure_id })}>⇄</button><AirportInput label={`To (leg ${i + 1})`} value={l.arrival_id} onChange={(v) => changeLeg(i, { arrival_id: v })} /><Field label={`Date (leg ${i + 1})`} required><Input type="date" required value={l.date} onChange={(e) => changeLeg(i, { date: e.target.value })} /></Field><button type="button" className="btn outline" disabled={legs.length <= 2} onClick={() => setLegs(legs.filter((_, j) => j !== i))} aria-label={`Remove leg ${i + 1}`}>Remove</button></div>)}<div><button type="button" className="btn outline" disabled={legs.length >= 6} onClick={() => setLegs([...legs, { departure_id: legs.at(-1).arrival_id, arrival_id: '', date: legs.at(-1).date }])}>Add flight leg</button></div></div>}
        <div className="form-grid fg6">{[['adults', 'Adults', 1], ['children', 'Children', 0], ['infants_in_seat', 'Infants (own seat)', 0], ['infants_on_lap', 'Infants (on lap)', 0]].map(([key, label, min]) => <Field key={key} label={label}><Input type="number" min={min} max="9" step="1" required value={q[key]} onChange={(e) => set(key, e.target.value)} /></Field>)}<Field label="Cabin class"><Select value={q.travel_class} onChange={(e) => set('travel_class', Number(e.target.value))} options={CABINS.map((c, i) => [i + 1, c])} /></Field></div>
        <div><button type="submit" className="btn"><Icon name="search" size={16} />Search Flights</button></div>
      </fieldset>
    </form>
    {busy && <div role="status" aria-live="polite" className="note">{busy}...</div>}{error && <div className="err" role="alert">{error}</div>}{notice && <div className="ok" role="status">{notice}</div>}
    {result && <div className="small muted">Search: {result.criteria.type === 1 ? 'Round-trip' : result.criteria.type === 3 ? 'Multi-city' : 'One-way'} · {CABINS[result.criteria.travel_class - 1]} · {result.criteria.adults} adult(s), {result.criteria.children} child(ren), {result.criteria.infants_in_seat + result.criteria.infants_on_lap} infant(s) · Prices checked {fdt(result.created_at)}. All airport times are local.</div>}
    {result?.selected.length > 0 && <Card title="Selected itinerary"><div className="stack">{result.selected.map((r, i) => <div key={i}><div className="small bold mb">Leg {i + 1}</div><Itinerary flight={r} /></div>)}</div></Card>}
    {result && result.booking_options === null && <>
      <h3>{result.criteria.type === 1 && result.stage === 1 ? 'Select a return flight' : `Select flight ${result.stage + 1} of ${totalLegs}`}</h3>
      <div className="form-grid fg4">{[['sort', 'Sort', [['recommended', 'Recommended'], ['cheapest', 'Cheapest'], ['fastest', 'Fastest'], ['earliest', 'Earliest departure']]], ['airline', 'Airline', [['', 'All airlines'], ...airlines.map((a) => [a, a])]], ['stops', 'Stops', [['', 'Any'], ['0', 'Non-stop'], ['1', 'One stop']]]].map(([key, label, options]) => <Field key={key} label={label}><Select value={filters[key]} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })} options={options} /></Field>)}{[['max_price', 'Maximum price (INR)', 'number'], ['max_duration', 'Maximum duration (minutes)', 'number'], ['departure', 'Depart at or after', 'time'], ['arrival', 'Arrive at or before', 'time']].map(([key, label, type]) => <Field key={key} label={label}><Input type={type} min={type === 'number' ? '0' : undefined} value={filters[key]} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })} /></Field>)}<div><Btn variant="outline" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</Btn></div></div>
      <div className="small muted">{shown.length} of {result.rows.length} options · Prices are provider itinerary estimates for all passengers; they may change with later selections. No leg prices are added together.</div>
      {shown.length ? <div className="flight-results" aria-busy={!!busy}>{shown.map((r) => <Itinerary key={r.id} flight={r}><div className="row wrap"><Btn disabled={!!busy || (result.stage + 1 < totalLegs ? !r.canContinue : !r.canBook)} onClick={() => select(r)}>{result.stage + 1 < totalLegs ? r.canContinue ? 'Select and view next flights' : 'Next flights unavailable' : r.canBook ? 'View booking options' : 'Booking options unavailable'}</Btn><Btn variant="outline" disabled={!!busy} onClick={() => save(r)}>Save travel option</Btn></div></Itinerary>)}</div> : <Empty>{result.rows.length ? 'No flights match these filters. Adjust or clear filters.' : 'No flights were returned. Try different airports or dates.'}</Empty>}
    </>}
    {result?.booking_options !== null && result?.booking_options !== undefined && <Card title="Available booking options"><div className="stack"><div className="small muted">Prices are supplied by the providers for the selected itinerary. Verify availability, fare conditions and the final total before paying.</div><div><Btn disabled={!!busy} onClick={() => save()}>Save selected itinerary</Btn></div>{result.booking_options.length ? result.booking_options.map((b) => <Provider key={b.id} option={b} />) : <Empty>No providers supplied booking options for this itinerary. Search again or contact your travel desk.</Empty>}</div></Card>}
    <details><summary>Saved travel options ({history.options.length})</summary><div className="stack mt">{history.options.map((o) => <Card key={o.id} title={`Saved option · ${fdt(o.created_at)}`}><div className="small muted mb">{o.snapshot.selected_legs} of {o.snapshot.total_legs} legs selected · Indicative quote: {price(o.snapshot.indicative_price)} · Reservation not confirmed</div><div className="stack">{o.snapshot.selected.map((r, i) => <Itinerary key={i} flight={r} />)}</div><Btn variant="outline" disabled={!!busy} onClick={() => { setQ({ ...initial(trip), ...o.snapshot.criteria }); if (o.snapshot.criteria.legs) setLegs(o.snapshot.criteria.legs); setResult(null); setNotice('Saved search criteria restored. Search again for current prices and booking options.'); }}>Search these dates again</Btn></Card>)}{!history.options.length && <Empty>No saved travel options for this trip.</Empty>}</div></details>
    <details><summary>Recent flight searches</summary><div className="stack mt">{historyError && <div className="err" role="alert">{historyError}<Btn variant="outline" onClick={loadHistory}>Retry history</Btn></div>}{history.searches.map((s) => <div key={s.id} className="row between wrap small"><span>{s.criteria.type === 3 ? s.criteria.legs.map((l) => `${l.departure_id} → ${l.arrival_id} (${l.date})`).join('; ') : `${s.criteria.departure_id} → ${s.criteria.arrival_id} (${s.criteria.outbound_date})`} · {fdt(s.created_at)}</span><Btn variant="outline" disabled={!!busy} onClick={() => { setQ({ ...initial(trip), ...s.criteria }); if (s.criteria.legs) setLegs(s.criteria.legs); setResult(null); setNotice('Search criteria restored. Search again to refresh results.'); }}>Use search</Btn></div>)}{!history.searches.length && !historyError && <Empty>No flight searches yet.</Empty>}</div></details>
  </div>;
}
