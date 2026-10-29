'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Icon, DataTable, Btn, Modal, Field, Input, Select, Textarea, Check, useApi, Tabs, FileDrop, Kv, Empty } from '@/components/ui';
import { fdate, inr, fdt } from '@/lib/format';
import { AIRPORTS, AIRPORT_OF_CITY } from '@/lib/constants';

const OTHER = [['Travel Insurance', 'shield', 'Request travel insurance for your trip.'], ['International SIM', 'phone', 'Request international SIM card.'], ['Lounge Access', 'star', 'Request airport lounge access.'], ['Foreign Exchange', 'rupee', 'Request foreign exchange assistance.'], ['Conference Registration', 'calendar', 'Request conference / event registration.'], ['Other (Specify)', 'more', 'Any other travel related service.']];
const TILES = [['flight', 'Flight Booking', 'plane'], ['hotel', 'Hotel Booking', 'bed'], ['ground', 'Ground Transport', 'car'], ['visa', 'Visa Processing', 'globe'], ['other', 'Other Services', 'file']];
export const serviceTileDefs = TILES;

function PolicyBadge({ p }) { return <Badge tone={p.status === 'Compliant' ? 'green' : p.status === 'Exception Required' ? 'orange' : 'red'}>{p.status === 'Compliant' ? 'Compliant' : p.status === 'Exception Required' ? 'Exception Required' : 'Out of Policy'}</Badge>; }
const hhmm = (o) => `${o.depTime} → ${o.arrTime}${o.arrNextDay ? ' +1' : ''}`;

// ---------- Flight (portal) ----------
function FlightPortal({ trip }) {
  const api = useApi();
  const [q, setQ] = useState({ from: AIRPORT_OF_CITY[trip.dep_city] || 'BBI', to: AIRPORT_OF_CITY[trip.dest_city] || 'BOM', date: trip.dep_date, cabin: 'Economy' });
  const [res, setRes] = useState(null); const [sel, setSel] = useState(null); const [comment, setComment] = useState(''); const [just, setJust] = useState(''); const [needJust, setNeedJust] = useState(false); const [busy, setBusy] = useState(false); const [done, setDone] = useState(null); const [stops, setStops] = useState([]); const [err, setErr] = useState('');
  const search = async () => { setBusy(true); setDone(null); setNeedJust(false); const r = await api('GET', `/search?kind=flight&from=${q.from}&to=${q.to}&date=${q.date}&cabin=${encodeURIComponent(q.cabin)}&trip_id=${trip.id}`, undefined, { refresh: false }); setBusy(false); if (r.ok) { setRes(r.data.flights); setSel(r.data.flights.recommendedId); } };
  const book = async () => {
    setBusy(true); setErr(''); const r = await api('POST', `/trips/${trip.id}/book`, { type: 'flight', offer_id: sel, comment, justification: just }, { silent: true });
    setBusy(false);
    if (r.ok) { setDone(r.data); return; }
    if (r.data?.requiresJustification) setNeedJust(true);
    setErr(r.error);
  };
  const opts = res?.options.filter((o) => !stops.length || stops.includes(o.stops === 0 ? 'Non-stop' : '1+ Stops')) || [];
  const chosen = res?.options.find((o) => o.id === sel);
  return (
    <div className="stack">
      <div className="form-grid fg6" style={{ alignItems: 'end' }}>
        <Field label="From" required><Select value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} options={AIRPORTS} /></Field>
        <Field label="To" required><Select value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} options={AIRPORTS} /></Field>
        <Field label="Departure Date" required><Input type="date" value={q.date} onChange={(e) => setQ({ ...q, date: e.target.value })} /></Field>
        <Field label="Class"><Select value={q.cabin} onChange={(e) => setQ({ ...q, cabin: e.target.value })} options={['Economy', 'Premium Economy', 'Business']} /></Field>
        <div style={{ gridColumn: 'span 2' }}><Btn icon="search" busy={busy} onClick={search}>Search Flights</Btn></div>
      </div>
      {res && (<div className="grid" style={{ gridTemplateColumns: '170px 1fr', alignItems: 'start' }}>
        <div className="card"><div className="card-b"><b>Filters</b><div className="mt-sm small">Stops</div>{['Non-stop', '1+ Stops'].map((s) => <Check key={s} checked={stops.includes(s)} onChange={(e) => setStops(e.target.checked ? [...stops, s] : stops.filter((x) => x !== s))}>{s}</Check>)}</div></div>
        <div className="card"><div className="card-h"><h3>Available Flights ({opts.length}) — {q.date}</h3></div>
          <DataTable rows={opts} dense empty="No flights found." columns={[
            { key: 'airline', label: 'Airline', render: (o) => <><b>{o.airline}</b> <span className="muted small">{o.flightNo}</span>{o.id === res.recommendedId && <div><Badge tone="green">Recommended</Badge></div>}</> },
            { key: 't', label: 'Departure → Arrival', render: hhmm }, { key: 'd', label: 'Duration', render: (o) => <>{o.durationLabel}<div className="small muted">{o.stopsLabel}</div></> },
            { key: 'fare', label: 'Fare (incl. taxes)', render: (o) => <b>{inr(o.fare)}</b> }, { key: 'b', label: 'Baggage', render: (o) => `${o.baggageKg} kg` }, { key: 'p', label: 'Policy', render: (o) => <PolicyBadge p={o.policy} /> },
            { key: 's', label: 'Select', render: (o) => <input type="radio" name="fl" disabled={!o.bookable} checked={sel === o.id} onChange={() => { setSel(o.id); setNeedJust(false); }} aria-label={`Select ${o.airline} ${o.flightNo}`} /> },
          ]} />
        </div></div>)}
      {chosen && !done && (<div className="card"><div className="card-b stack">
        <b>Policy check — {chosen.airline} {chosen.flightNo}, {inr(chosen.fare)}</b>
        <div className="stack" style={{ gap: 4 }}>{chosen.policy.checks.filter((c) => c.severity !== 'info' || true).map((c) => <div key={c.label} className="row small"><Icon name={c.ok ? 'checkCircle' : 'alert'} size={15} style={{ color: c.ok ? 'var(--green)' : c.severity === 'info' ? 'var(--muted)' : 'var(--red)' }} /><b>{c.label}:</b> {c.detail}</div>)}</div>
        {(needJust || chosen.policy.status !== 'Compliant') && <Field label="Justification for policy exception" required hint="Required for out-of-policy or over-budget options. Your manager will be asked to approve."><Textarea value={just} onChange={(e) => setJust(e.target.value)} /></Field>}
        <Field label="Comment" required><Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} placeholder="Add a note for this booking" /></Field>
        {err && <div className="err" role="alert">{err}</div>}
        <div><Btn busy={busy} disabled={!comment.trim()} onClick={book}>{chosen.policy.status === 'Compliant' ? 'Book Now' : 'Submit for Exception Approval'}</Btn></div>
      </div></div>)}
      {done && <div className={done.exception ? 'warn' : 'ok'}><b>{done.exception ? 'Submitted for approval' : 'Flight booked'}</b> — {done.booking.booking_no} ({done.booking.supplier_ref}).{done.exception ? ' Your approver has been notified.' : ' Ticket confirmed.'}</div>}
    </div>
  );
}

function HotelPortal({ trip }) {
  const api = useApi();
  const [q, setQ] = useState({ city: trip.dest_city, check_in: trip.dep_date, check_out: trip.ret_date > trip.dep_date ? trip.ret_date : '', rooms: 1, guests: 1, max_price: '', category: 'All', breakfast: false, free_cancel: false });
  const [list, setList] = useState(null); const [pick, setPick] = useState(null); const [comment, setComment] = useState(''); const [just, setJust] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(null); const [err, setErr] = useState('');
  const search = async () => { setBusy(true); setDone(null); const qs = new URLSearchParams({ kind: 'hotel', trip_id: trip.id, city: q.city, check_in: q.check_in, check_out: q.check_out, rooms: q.rooms, guests: q.guests, category: q.category, breakfast: q.breakfast, free_cancel: q.free_cancel, ...(q.max_price ? { max_price: q.max_price } : {}) }); const r = await api('GET', `/search?${qs}`, undefined, { refresh: false }); setBusy(false); if (r.ok) setList(r.data.hotels || []); };
  const book = async () => { setBusy(true); setErr(''); const r = await api('POST', `/trips/${trip.id}/book`, { type: 'hotel', offer_id: pick.id, rooms: q.rooms, guests: q.guests, comment, justification: just }, { silent: true }); setBusy(false); if (r.ok) { setDone(r.data); setPick(null); } else setErr(r.error); };
  return (
    <div className="stack">
      <div className="form-grid fg6" style={{ alignItems: 'end' }}>
        <Field label="Destination City" required><Input value={q.city} onChange={(e) => setQ({ ...q, city: e.target.value })} /></Field>
        <Field label="Check-in" required><Input type="date" value={q.check_in} onChange={(e) => setQ({ ...q, check_in: e.target.value })} /></Field>
        <Field label="Check-out" required><Input type="date" value={q.check_out} onChange={(e) => setQ({ ...q, check_out: e.target.value })} /></Field>
        <Field label="Rooms"><Input type="number" min="1" value={q.rooms} onChange={(e) => setQ({ ...q, rooms: e.target.value })} /></Field>
        <Field label="Max price / night"><Input type="number" value={q.max_price} onChange={(e) => setQ({ ...q, max_price: e.target.value })} placeholder="Any" /></Field>
        <Field label="Category"><Select value={q.category} onChange={(e) => setQ({ ...q, category: e.target.value })} options={['All', '3 Star', '4 Star', '5 Star']} /></Field>
      </div>
      <div className="row"><Check checked={q.breakfast} onChange={(e) => setQ({ ...q, breakfast: e.target.checked })}>Breakfast included</Check><Check checked={q.free_cancel} onChange={(e) => setQ({ ...q, free_cancel: e.target.checked })}>Free cancellation</Check><Btn icon="search" busy={busy} onClick={search}>Search Hotels</Btn></div>
      {list && <Card title={`Available Hotels (${list.length})`} body={false}><DataTable rows={list} dense empty="No hotels match your filters." columns={[
        { key: 'name', label: 'Hotel', render: (h) => <><b>{h.name}</b><div className="small muted">{'★'.repeat(h.star)} · {h.rating} ({h.reviews} reviews)</div></> }, { key: 'area', label: 'Location' }, { key: 'p', label: 'Price / Night', render: (h) => <b>{inr(h.pricePerNight)}</b> }, { key: 't', label: `Total (${list[0]?.nights || 1} night)`, render: (h) => inr(h.total) },
        { key: 'am', label: 'Amenities', render: (h) => h.amenities.join(', ') + (h.freeCancelDays ? ' · Free cancellation' : '') }, { key: 'pol', label: 'Policy', render: (h) => <PolicyBadge p={h.policy} /> }, { key: 's', label: 'Select', render: (h) => <Btn variant="outline" className="sm" onClick={() => setPick(h)}>Select</Btn> },
      ]} /></Card>}
      {done && <div className={done.exception ? 'warn' : 'ok'}><b>{done.exception ? 'Submitted for approval' : 'Hotel booked'}</b> — {done.booking.booking_no}, confirmation {done.booking.supplier_ref}.</div>}
      {pick && <Modal title={`Book ${pick.name}`} size="sm" onClose={() => setPick(null)} footer={<><Btn variant="outline" onClick={() => setPick(null)}>Cancel</Btn><Btn busy={busy} disabled={!comment.trim() || (pick.policy.status !== 'Compliant' && just.trim().length < 10)} onClick={book}>{pick.policy.status === 'Compliant' ? 'Confirm Booking' : 'Submit for Approval'}</Btn></>}>
        <Kv rows={[['Hotel', pick.name], ['Dates', `${fdate(pick.checkIn)} - ${fdate(pick.checkOut)} (${pick.nights} nights)`], ['Total', inr(pick.pricePerNight * pick.nights * Number(q.rooms || 1))]]} />
        <div className="stack mt">{pick.policy.checks.map((c) => <div key={c.label} className="row small"><Icon name={c.ok ? 'checkCircle' : 'alert'} size={15} style={{ color: c.ok ? 'var(--green)' : 'var(--red)' }} />{c.detail}</div>)}
          {pick.policy.status !== 'Compliant' && <Field label="Justification" required><Textarea value={just} onChange={(e) => setJust(e.target.value)} /></Field>}<Field label="Comment" required><Textarea value={comment} onChange={(e) => setComment(e.target.value)} /></Field>{err && <div className="err">{err}</div>}</div></Modal>}
    </div>
  );
}

function GroundPortal({ trip }) {
  const api = useApi();
  const [f, setF] = useState({ transport_type: 'Airport Transfer', pickup: '', dropoff: '', pickup_date: trip.dep_date, pickup_time: '11:00', passengers: 1, luggage: 1, comment: '' });
  const [veh, setVeh] = useState(null); const [sel, setSel] = useState(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState(null); const [err, setErr] = useState('');
  const search = async () => { const r = await api('GET', `/search?kind=ground&transport=${encodeURIComponent(f.transport_type)}&passengers=${f.passengers}&luggage=${f.luggage}`, undefined, { refresh: false }); if (r.ok) setVeh(r.data.vehicles); };
  const book = async () => { setBusy(true); setErr(''); const r = await api('POST', `/trips/${trip.id}/book`, { type: 'ground', offer_id: sel, ...f }, { silent: true }); setBusy(false); if (r.ok) setDone(r.data); else setErr(r.error); };
  return (
    <div className="stack">
      <Field label="Transport Type" required><div className="row wrap">{['Airport Transfer', 'Local Taxi', 'Rental Cab', 'Company Cab'].map((t) => <label key={t} className="chk"><input type="radio" checked={f.transport_type === t} onChange={() => setF({ ...f, transport_type: t })} />{t}</label>)}</div></Field>
      <div className="form-grid fg4"><Field label="Pickup Location" required><Input value={f.pickup} onChange={(e) => setF({ ...f, pickup: e.target.value })} /></Field><Field label="Drop-off Location" required><Input value={f.dropoff} onChange={(e) => setF({ ...f, dropoff: e.target.value })} /></Field><Field label="Pickup Date" required><Input type="date" value={f.pickup_date} onChange={(e) => setF({ ...f, pickup_date: e.target.value })} /></Field><Field label="Pickup Time" required><Input type="time" value={f.pickup_time} onChange={(e) => setF({ ...f, pickup_time: e.target.value })} /></Field><Field label="No. of Passengers"><Input type="number" min="1" value={f.passengers} onChange={(e) => setF({ ...f, passengers: e.target.value })} /></Field><Field label="Luggage Count"><Input type="number" min="0" value={f.luggage} onChange={(e) => setF({ ...f, luggage: e.target.value })} /></Field></div>
      <div><Btn icon="search" onClick={search} disabled={!f.pickup || !f.dropoff}>Search Vehicles</Btn></div>
      {veh && <div className="grid g3">{veh.map((v) => <div key={v.id} className={`opt-card ${sel === v.id ? 'on' : ''}`} onClick={() => setSel(v.id)} role="radio" aria-checked={sel === v.id}><Icon name="car" size={26} /><div className="bold">{v.vehicle}</div><div className="small muted">Up to {v.capacity} passengers · {v.provider}</div><div className="bold">{inr(v.fare)}</div></div>)}{veh.length === 0 && <Empty>No vehicle can carry that many passengers.</Empty>}</div>}
      {sel && !done && <><Field label="Comments" required><Textarea value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} /></Field>{err && <div className="err">{err}</div>}<div><Btn busy={busy} disabled={!f.comment.trim()} onClick={book}>Book Vehicle</Btn></div></>}
      {done && <div className="ok"><b>Vehicle booked</b> — {done.booking.booking_no}, ref {done.booking.supplier_ref}.</div>}
    </div>
  );
}

// ---------- Agency (request) forms ----------
const SPECIAL = { flight: ['Flexible dates (± 1 day)', 'Wheelchair assistance', 'Need extra baggage', 'Prefer morning flight'], hotel: ['Early check-in', 'Late check-out', 'Non-smoking room', 'Wi-Fi required'], ground: ['Child seat', 'Extra luggage space', 'Meet & Greet service'], visa: ['Appointment assistance', 'Document pickup from office'] };
export function AgencyForm({ trip, type, channel = 'agency', draftId, onDone }) {
  const api = useApi();
  const init = { flight: { from: `${trip.dep_city} (${AIRPORT_OF_CITY[trip.dep_city] || ''})`, to: `${trip.dest_city} (${AIRPORT_OF_CITY[trip.dest_city] || ''})`, depart_date: trip.dep_date, return_date: trip.ret_date, preferred_time: 'Any time', cabin: 'Economy', seat: 'Window', meal: 'Vegetarian', special: [], frequent_flyer: '' },
    hotel: { city: trip.dest_city, check_in: trip.dep_date, check_out: trip.ret_date > trip.dep_date ? trip.ret_date : '', rooms: 1, guests: 1, category: '3 Star / Business', area: '', breakfast: true, free_cancel: false, special: [] },
    ground: { transport_type: 'Airport Transfer', pickup: '', dropoff: '', pickup_date: trip.dep_date, pickup_time: '11:00', passengers: 1, luggage: 1, special: [] },
    visa: { country: trip.dest_country, visa_type: 'Business Visa', purpose: 'Client meeting', entries: 'Single Entry', passport_number: '', passport_expiry: '', applied_before: 'No', special: [] }, other: { services: [] } }[type];
  const [d, setD] = useState(init); const [comment, setComment] = useState(''); const [files, setFiles] = useState([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k, v) => setD((x) => ({ ...x, [k]: v })); const tog = (k, v, on) => set(k, on ? [...(d[k] || []), v] : (d[k] || []).filter((x) => x !== v));
  const submit = async (draft) => {
    setBusy(true); setErr('');
    const r = await api('POST', `/trips/${trip.id}/services`, { type, channel, details: d, comment, draft, id: draftId }, { silent: true, refresh: false });
    if (!r.ok) { setBusy(false); setErr(r.error); return; }
    if (files.length) { const fd = new FormData(); files.forEach((x) => fd.append('files', x)); await api('POST', `/services/${r.data.id}/attachments`, fd, { refresh: false, silent: true }); }
    setBusy(false); onDone?.(r.data, draft);
  };
  const F = ({ k, label, type: t = 'text', options, req, span }) => (<div style={span ? { gridColumn: `span ${span}` } : undefined}><Field label={label} required={req}>{options ? <Select value={d[k]} onChange={(e) => set(k, e.target.value)} options={options} /> : <Input type={t} value={d[k] ?? ''} onChange={(e) => set(k, e.target.value)} />}</Field></div>);
  return (
    <div className="stack">
      {type === 'flight' && <div className="form-grid fg4"><F k="from" label="From" req /><F k="to" label="To" req /><F k="depart_date" label="Departure Date" type="date" req /><F k="return_date" label="Return Date" type="date" /><F k="preferred_time" label="Preferred Time" options={['Any time', 'Morning', 'Afternoon', 'Evening']} /><F k="cabin" label="Preferred Class" options={['Economy', 'Premium Economy', 'Business']} /><F k="seat" label="Seat Preference" options={['Window', 'Aisle', 'No preference']} /><F k="meal" label="Meal Preference" options={['Vegetarian', 'Non-vegetarian', 'No preference']} /></div>}
      {type === 'hotel' && <div className="form-grid fg4"><F k="city" label="Destination City" req /><F k="check_in" label="Check-in Date" type="date" req /><F k="check_out" label="Check-out Date" type="date" req /><F k="rooms" label="Rooms" type="number" req /><F k="category" label="Preferred Hotel Category" options={['3 Star / Business', '4 Star', '5 Star', 'Budget']} /><F k="area" label="Preferred Area / Location" /><div style={{ alignSelf: 'end' }}><Check checked={d.breakfast} onChange={(e) => set('breakfast', e.target.checked)}>Breakfast included</Check></div><div style={{ alignSelf: 'end' }}><Check checked={d.free_cancel} onChange={(e) => set('free_cancel', e.target.checked)}>Free cancellation</Check></div></div>}
      {type === 'ground' && <><Field label="Transport Type" required><div className="row wrap">{['Airport Transfer', 'Local Taxi', 'Rental Cab', 'Pickup & Drop'].map((t) => <label key={t} className="chk"><input type="radio" checked={d.transport_type === t} onChange={() => set('transport_type', t)} />{t}</label>)}</div></Field><div className="form-grid fg4"><F k="pickup" label="Pickup Location" req /><F k="dropoff" label="Drop-off Location" req /><F k="pickup_date" label="Date" type="date" req /><F k="pickup_time" label="Time" type="time" req /><F k="passengers" label="No. of Passengers" type="number" req /><F k="luggage" label="Luggage Count" type="number" /></div></>}
      {type === 'visa' && <><div className="form-grid fg4"><F k="country" label="Destination Country" req /><F k="visa_type" label="Visa Type" options={['Business Visa', 'Tourist Visa', 'Transit Visa']} req /><F k="purpose" label="Purpose of Visit" req /><F k="entries" label="Number of Entries" options={['Single Entry', 'Multiple Entry']} /><F k="passport_number" label="Passport Number" req /><F k="passport_expiry" label="Passport Expiry Date" type="date" req /><F k="applied_before" label="Have you applied before?" options={['No', 'Yes']} /></div><div className="note small">Travel dates ({fdate(trip.dep_date)} - {fdate(trip.ret_date)}) are taken from the trip. Passport must be valid for at least 6 months after travel.</div></>}
      {type === 'other' && <div className="grid g3">{OTHER.map(([n, i, t]) => { const on = (d.services || []).includes(n); return <div key={n} className={`opt-card ${on ? 'on' : ''}`} onClick={() => tog('services', n, !on)} role="checkbox" aria-checked={on}>{on && <span className="tick"><Icon name="check" size={13} /></span>}<Icon name={i} size={24} /><div className="bold" style={{ color: 'var(--navy)' }}>{n}</div><div className="small muted">{t}</div></div>; })}</div>}
      {SPECIAL[type] && <Field label="Special requirements"><div className="row wrap">{SPECIAL[type].map((s) => <Check key={s} checked={(d.special || []).includes(s)} onChange={(e) => tog('special', s, e.target.checked)}>{s}</Check>)}</div></Field>}
      <div className="grid g2"><Field label="Comment" required><Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} /><span className="small muted right">{comment.length}/1000</span></Field><Field label="Attachments"><FileDrop onFiles={(x) => setFiles((a) => [...a, ...x])} />{files.map((x, i) => <div key={i} className="small row between"><span><Icon name="paperclip" size={13} /> {x.name}</span><button className="icon-btn red" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="x" size={13} /></button></div>)}</Field></div>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="row"><Btn busy={busy} onClick={() => submit(false)}>{type === 'visa' ? 'Submit Request' : 'Submit Request to Agency'}</Btn><Btn variant="outline" busy={busy} onClick={() => submit(true)}>Save as Draft</Btn></div>
    </div>
  );
}

// ---------- request list & detail modal ----------
export function ServiceModal({ id, onClose, user }) {
  const api = useApi(); const [d, setD] = useState(null); const [note, setNote] = useState('');
  const load = async () => { const r = await api('GET', `/services/${id}`, undefined, { refresh: false }); if (r.ok) setD(r.data); };
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (body, ok) => { const r = await api('POST', `/services/${id}/respond`, body, { success: ok }); if (r.ok) { setNote(''); setD(r.data); } };
  if (!d) return <Modal title="Service request" onClose={onClose}>Loading…</Modal>;
  const s = d.service; const mine = !d.isDesk;
  return (
    <Modal title={`${s.srv_no} — ${s.type[0].toUpperCase()}${s.type.slice(1)} (${s.channel === 'agency' ? 'Travel Agency' : 'Portal'})`} size="lg" onClose={onClose}>
      <div className="row mb"><Badge>{s.status}</Badge>{s.desk_stage && <Badge>{s.desk_stage}</Badge>}<span className="muted small">SLA: {d.sla.status} ({d.sla.label})</span></div>
      <div className="grid g2"><Card title="Request details"><Kv rows={[...Object.entries(s.details).filter(([, v]) => v !== '' && v != null && !Array.isArray(v)).map(([k, v]) => [k.replace(/_/g, ' '), String(v)]), s.details.special?.length ? ['special', s.details.special.join(', ')] : null, ['Comment', s.comment]]} /></Card>
        <Card title="Quotes">{d.quotes.length === 0 ? <Empty>No quotes yet.</Empty> : d.quotes.map((q) => <div key={q.id} className="card" style={{ marginBottom: 8 }}><div className="card-b"><div className="row between"><b>{q.supplier} {q.reference}</b><b>{inr(q.amount)}</b></div><div className="small muted">{q.details}</div><div className="small muted">Valid till {fdate(q.valid_till)}</div>
          {mine && q.sent && !q.accepted && !s.booking_id && <div className="row mt-sm"><Btn onClick={() => act({ action: 'accept_quote', quote_id: q.id }, 'Quote accepted')}>Approve & Accept</Btn><Btn variant="danger" disabled={!note.trim()} onClick={() => act({ action: 'reject_quote', quote_id: q.id, note }, 'Quote rejected')}>Reject (add reason below)</Btn></div>}{q.accepted ? <Badge tone="green">Accepted</Badge> : null}</div></div>)}</Card></div>
      <Card title="Communication" className="mt">{d.comments.map((c) => <div key={c.id} className="row" style={{ alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid #eef2fa' }}><span className="avatar sm light">{c.author.split(' ').map((x) => x[0]).join('').slice(0, 2)}</span><div className="grow"><b>{c.author}</b> <span className="small muted">{c.org} · {fdt(c.created_at)}</span><div>{c.body}</div></div></div>)}
        {mine && !['Confirmed', 'Cancelled', 'Failed'].includes(s.status) && <div className="row mt"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Type a reply…" /><Btn disabled={!note.trim()} onClick={() => act({ action: 'reply', note }, 'Reply sent')}>Send</Btn></div>}</Card>
      {d.files.length > 0 && <div className="small mt">Attachments: {d.files.map((f) => <a key={f.id} href={`/api/files/${f.id}`} style={{ marginRight: 10 }}>{f.name}</a>)}</div>}
    </Modal>
  );
}

export function ServiceList({ services, user }) {
  const [open, setOpen] = useState(null); const api = useApi();
  return (<>
    <DataTable rows={services} empty="No service requests yet." columns={[
      { key: 'srv_no', label: 'Request', render: (s) => <a href="#" onClick={(e) => { e.preventDefault(); setOpen(s.id); }}>{s.srv_no}</a> }, { key: 'type', label: 'Service', render: (s) => s.type[0].toUpperCase() + s.type.slice(1) }, { key: 'channel', label: 'Channel', render: (s) => (s.channel === 'agency' ? 'Travel Agency' : 'Portal') },
      { key: 'status', label: 'Status', render: (s) => <Badge>{s.status}</Badge> }, { key: 'desk_stage', label: 'Stage', render: (s) => s.desk_stage || '-' }, { key: 'q', label: 'Quotes', render: (s) => (s.quotes?.filter((q) => q.sent).length ? <Badge tone="orange">{s.quotes.filter((q) => q.sent).length} awaiting you</Badge> : '-') },
      { key: 'created_at', label: 'Created', render: (s) => fdate(s.created_at) }, { key: 'a', label: '', render: (s) => <Btn variant="outline" className="sm" onClick={() => setOpen(s.id)}>View</Btn> },
    ]} />
    {open && <ServiceModal id={open} user={user} onClose={() => { setOpen(null); }} />}
  </>);
}

export function ServicePanel({ trip, services, type, user }) {
  const [tab, setTab] = useState(type === 'visa' ? 'agency' : type === 'other' ? 'agency' : 'portal'); const [msg, setMsg] = useState('');
  useEffect(() => { setTab(['visa', 'other'].includes(type) ? 'agency' : 'portal'); setMsg(''); }, [type]);
  const draft = services.find((s) => s.type === type && s.status === 'Draft');
  const tabs = type === 'visa' ? [{ key: 'agency', label: 'Request Visa Assistance' }, { key: 'status', label: 'View Request Status' }] : type === 'other' ? [] : [{ key: 'portal', label: 'Book through Portal' }, { key: 'agency', label: 'Request to Travel Agency' }];
  if (type === 'visa' && trip.travel_type !== 'International') return <Card title="Visa Processing" icon="globe"><div className="note">Visa processing is only required for international trips. This trip is domestic.</div></Card>;
  return (
    <Card title={{ flight: 'Flight Booking', hotel: 'Hotel Booking', ground: 'Ground Transport / Taxi', visa: 'Visa Processing', other: 'Other Travel Services' }[type]} icon={{ flight: 'plane', hotel: 'bed', ground: 'car', visa: 'globe', other: 'file' }[type]}>
      {tabs.length > 0 && <Tabs tabs={tabs} value={tab} onChange={(t) => { setTab(t); setMsg(''); }} />}
      {msg && <div className="ok mb">{msg}</div>}
      {tab === 'portal' && type === 'flight' && <FlightPortal trip={trip} />}{tab === 'portal' && type === 'hotel' && <HotelPortal trip={trip} />}{tab === 'portal' && type === 'ground' && <GroundPortal trip={trip} />}
      {tab === 'agency' && <AgencyForm key={`${type}-${draft?.id || 'new'}`} trip={trip} type={type} draftId={draft?.id} onDone={(s, d) => setMsg(d ? `Draft saved (${s.srv_no}).` : `Request ${s.srv_no} submitted. The travel desk will respond with options.`)} />}
      {tab === 'status' && <ServiceList services={services.filter((s) => s.type === type)} user={user} />}
    </Card>
  );
}
