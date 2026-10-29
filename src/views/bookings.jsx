'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, PageHead, Stat, Badge, Icon, DataTable, Pager, Btn, Modal, Field, Input, Select, Textarea, Check, useApi, useNav, Confirm, Menu, Pills, Kv, Tabs, Empty } from '@/components/ui';
import { fdate, inr, fdt } from '@/lib/format';
import { AIRPORTS, AIRPORT_OF_CITY } from '@/lib/constants';

const TYPE_ICON = { flight: 'plane', hotel: 'bed', bus: 'bus', train: 'train', cab: 'car', other: 'file' };
const TABS = [['all', 'All Bookings'], ['flight', 'Flights'], ['hotel', 'Hotels'], ['bus', 'Buses'], ['train', 'Trains'], ['cab', 'Cabs'], ['other', 'Others']];

function ics(b) {
  const day = (s) => String(s || '').replace(/-/g, '');
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GENIQ//Travel//EN', 'BEGIN:VEVENT', `UID:${b.booking_no}@geniq`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART;VALUE=DATE:${day(b.travel_date)}`, `DTEND;VALUE=DATE:${day(b.end_date || b.travel_date)}`, `SUMMARY:${b.title} ${b.route}`, `DESCRIPTION:Booking ${b.booking_no} ${b.supplier_ref || ''}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' })); a.download = `${b.booking_no}.ics`; a.click();
}

export function BookingsView({ user, data, detail }) {
  const nav = useNav(); const api = useApi(); const router = useRouter();
  const [cancel, setCancel] = useState(null); const [change, setChange] = useState(null); const [ticket, setTicket] = useState(false);
  const k = data.kpis; const b = detail?.booking;
  const claim = async (bk) => { const r = await api('POST', `/bookings/${bk.id}/claim`, {}, { refresh: false }); if (r.ok) router.push(`/expenses/${r.data.report.id}`); };
  return (<>
    <PageHead title="My Bookings" sub="View and manage all your travel bookings" actions={<Link href="/services/flight" className="btn"><Icon name="plus" size={15} />New Booking</Link>} />
    <div className="row wrap mb">{TABS.map(([key, label]) => <button key={key} className={`pill ${nav.get('type', 'all') === key ? 'on' : ''}`} onClick={() => nav.set({ type: key === 'all' ? '' : key })}>{label} <span className="c">{data.tabs[key] ?? 0}</span></button>)}</div>
    <div className="grid g6 mb"><Stat icon="list" value={k.total} label="Total Bookings" /><Stat icon="checkCircle" tone="green" value={k.confirmed} label="Confirmed" iconColor="#15803d" /><Stat icon="clock" tone="orange" value={k.pending} label="Created / Pending" iconColor="#d97706" /><Stat icon="x" tone="red" value={k.cancelled} label="Cancelled" iconColor="#d11a2a" /><Stat icon="file" tone="purple" value={k.claimed} label="Claimed / Reimbursed" iconColor="#6d3fd1" /><Stat icon="file" tone="gray" value={k.notClaimed} label="Not Claimed" iconColor="#55627f" /></div>
    <div className="main-side" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
      <Card body={false}>
        <div style={{ padding: '12px 16px 0' }}><Filters2 nav={nav} /></div>
        <DataTable rows={data.rows} onRowClick={(r) => nav.set({ selected: r.id }, true)} rowClass={(r) => (detail?.booking.id === r.id ? 'sel' : '')} empty="No bookings found." columns={[
          { key: 'booking_no', label: 'Booking ID', render: (r) => <><Link href="#" className="bold" onClick={(e) => e.preventDefault()}>{r.booking_no}</Link><div className="small muted">Ref: {r.supplier_ref || '-'}</div></> },
          { key: 'type', label: 'Service', render: (r) => <span className="ico-box soft"><Icon name={TYPE_ICON[r.type]} size={16} /></span> },
          { key: 'detail', label: 'Travel Details', render: (r) => <><b>{r.title}</b> {r.route}<div className="small muted">{r.detail}</div></> }, { key: 'booking_date', label: 'Booking Date', render: (r) => fdate(r.booking_date) }, { key: 'travel_date', label: 'Travel Date', render: (r) => fdate(r.travel_date) },
          { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> }, { key: 'claim_status', label: 'Claim Status', render: (r) => <Badge>{r.claim_status}</Badge> }, { key: 'amount', label: 'Amount (INR)', render: (r) => <b>{inr(r.amount)}</b> },
          { key: 'a', label: '', render: (r) => <span onClick={(e) => e.stopPropagation()}><Menu items={[{ label: 'View details', onClick: () => nav.set({ selected: r.id }, true) }, ...(['Confirmed', 'Completed'].includes(r.status) && r.claim_status === 'Not Claimed' && r.trip_id ? [{ label: 'Claim expenses', onClick: () => claim(r) }] : []), ...(['Confirmed', 'Changed'].includes(r.status) && r.trip_id ? [{ label: 'Request change', onClick: () => setChange(r) }] : []), ...(['Created', 'Ticketing Pending', 'Confirmed', 'Changed'].includes(r.status) ? [{ label: 'Cancel booking', onClick: () => setCancel(r) }] : [])]} /></span> },
        ]} />
        <Pager page={data.page} size={data.size} total={data.total} noun="bookings" />
      </Card>
      <div className="stack">
        {b ? (<>
          <Card title="Booking Details" icon={TYPE_ICON[b.type]} actions={<Badge>{b.status}</Badge>}>
            <Kv rows={[['Booking ID', b.booking_no], ['Reference No.', b.supplier_ref], ['Route', b.route], ['Supplier', b.supplier], ['Travel Date', fdate(b.travel_date)], ['Booking Date', fdate(b.booking_date)], ['Passenger(s)', b.traveller_name], ['Amount', inr(b.amount)], ['Trip', b.trip_no], ['Policy', b.policy_status]]} />
            {b.details?.depTime && <div className="small muted mt-sm">{b.details.depTime} → {b.details.arrTime} · {b.details.duration} · {b.details.baggageKg} kg baggage</div>}
            <div className="row mt"><Btn variant="outline" onClick={() => setTicket(true)}>View Ticket</Btn><Btn variant="outline" disabled={!['Confirmed', 'Changed', 'Created', 'Ticketing Pending'].includes(b.status)} onClick={() => setCancel(b)}>Manage Booking</Btn></div>
          </Card>
          <Card title="Quick Actions" icon="settings"><div className="grid g3" style={{ textAlign: 'center' }}>
            {[['Claim Expenses', 'file', () => claim(b), !(['Confirmed', 'Completed'].includes(b.status) && b.claim_status === 'Not Claimed' && b.trip_id)], ['Change / Cancel', 'edit', () => (['Confirmed', 'Changed'].includes(b.status) ? setChange(b) : setCancel(b)), !['Confirmed', 'Changed', 'Created', 'Ticketing Pending'].includes(b.status)], ['Add to Calendar', 'calendar', () => ics(b)], ['Share Details', 'send', async () => { await navigator.clipboard?.writeText(`${b.booking_no} ${b.title} ${b.route} on ${b.travel_date} (Ref ${b.supplier_ref})`); }], ['View Itinerary', 'list', () => router.push(b.trip_id ? `/trips/${b.trip_id}/details` : '/bookings')]].map(([l, i, fn, dis]) => <button key={l} className="opt-card" style={{ padding: 10, opacity: dis ? .45 : 1 }} disabled={dis} onClick={fn}><Icon name={i} size={19} /><div className="small bold">{l}</div></button>)}</div></Card>
          <Card title="Booking Timeline" icon="clock"><div className="vsteps">{detail.timeline.map((t) => <div key={t.label} className={`vs ${t.done ? 'done' : ''}`}><span className="c">{t.done ? '✓' : ''}</span><div className="row between grow"><b>{t.label}</b><span className="small muted">{fdate(t.at) === '-' ? t.at : fdate(t.at)}</span></div></div>)}</div></Card>
          {detail.refund && <Card title="Refund" icon="refresh"><Kv rows={[['Status', detail.refund.status], ['Expected', inr(detail.refund.expected_refund)], ['Credited', inr(detail.refund.actual_refund)]]} /><Link href="/refunds" className="small">Open refund centre →</Link></Card>}
        </>) : <Card><Empty>Select a booking to see its details.</Empty></Card>}
      </div>
    </div>
    {cancel && <Confirm title={`Cancel ${cancel.booking_no}`} danger needReason reasonLabel="Cancellation reason" confirmLabel="Cancel Booking" text="Cancellation charges follow the supplier fare rules. A refund case is opened automatically and tracked by the travel desk." onClose={() => setCancel(null)} onConfirm={async (reason) => { const r = await api('POST', `/bookings/${cancel.id}/cancel`, { reason }, { success: 'Booking cancelled - refund case opened' }); if (r.ok) setCancel(null); }} />}
    {change && <ChangeModal booking={change} onClose={() => setChange(null)} />}
    {ticket && b && <Modal title={`E-ticket / Voucher — ${b.booking_no}`} size="sm" onClose={() => setTicket(false)} footer={<><Btn variant="outline" onClick={() => window.print()}>Print</Btn><Btn onClick={() => setTicket(false)}>Close</Btn></>}><Kv rows={[['Traveller', b.traveller_name], ['Service', b.title], ['Route / Hotel', b.route], ['Supplier', b.supplier], ['Confirmation / PNR', b.supplier_ref], ['Ticket No.', b.ticket_no], ['Travel Date', fdate(b.travel_date)], ['Amount', inr(b.amount)], ['Status', b.status]]} /></Modal>}
  </>);
}
function Filters2({ nav }) {
  const [q, setQ] = useState(nav.get('q')); const [st, setSt] = useState(nav.get('status')); const [cl, setCl] = useState(nav.get('claim')); const [from, setFrom] = useState(nav.get('from')); const [to, setTo] = useState(nav.get('to'));
  return <div className="row wrap" style={{ alignItems: 'flex-end', marginBottom: 12 }}><Field label="Search" className="grow"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Booking ID, route, supplier, reference" onKeyDown={(e) => e.key === 'Enter' && nav.set({ q, status: st, claim: cl, from, to })} /></Field>
    <Field label="Status"><Select value={st} onChange={(e) => setSt(e.target.value)} options={[['', 'All'], ...['Created', 'Ticketing Pending', 'Confirmed', 'Changed', 'Cancelled', 'Completed'].map((s) => [s, s])]} /></Field>
    <Field label="Claim Status"><Select value={cl} onChange={(e) => setCl(e.target.value)} options={[['', 'All'], ...['Not Claimed', 'Claim In Progress', 'Claimed', 'N/A'].map((s) => [s, s])]} /></Field>
    <Field label="Travel from"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="Travel to"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field><Btn onClick={() => nav.set({ q, status: st, claim: cl, from, to })}>Apply</Btn></div>;
}
function ChangeModal({ booking, onClose }) {
  const api = useApi(); const [d, setD] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  return <Modal title={`Request change — ${booking.booking_no}`} size="sm" onClose={onClose} footer={<><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn busy={busy} disabled={!reason.trim()} onClick={async () => { setBusy(true); const r = await api('POST', `/bookings/${booking.id}/change`, { new_date: d || undefined, reason }, { success: 'Change request sent to the travel desk' }); setBusy(false); if (r.ok) onClose(); }}>Submit Request</Btn></>}>
    <div className="stack"><Field label="New travel date (optional)"><Input type="date" value={d} onChange={(e) => setD(e.target.value)} /></Field><Field label="Reason / comment" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field><div className="note small">The travel desk will confirm the change fee and revised fare before anything is changed.</div></div></Modal>;
}

// ---------- Policy-aware search & fare comparison ----------
export function SearchView({ user, trips, initial }) {
  const api = useApi(); const nav = useNav();
  const [kind, setKind] = useState('both');
  const [q, setQ] = useState(initial);
  const [res, setRes] = useState(null); const [busy, setBusy] = useState(false); const [sel, setSel] = useState(null); const [onlyCompliant, setOC] = useState(false); const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    const qs = new URLSearchParams({ kind, from: q.from, to: q.to, date: q.date, return_date: q.return_date || '', cabin: q.cabin, city: q.city, check_in: q.date, check_out: q.return_date || '' }); if (q.trip_id) qs.set('trip_id', q.trip_id);
    const r = await api('GET', `/search?${qs}`, undefined, { refresh: false, silent: true }); setBusy(false);
    if (!r.ok) return setErr(r.error); setRes(r.data); setSel(r.data.flights?.recommendedId || null);
  };
  const flights = (res?.flights?.options || []).filter((o) => !onlyCompliant || o.policy.status === 'Compliant');
  const chosen = res?.flights?.options.find((o) => o.id === sel);
  return (<>
    <PageHead title="Policy-aware Search & Fare Comparison" sub="Compare flight and hotel options using policy compliance and total trip cost, not only the headline price." />
    <Card className="mb">
      <Tabs value={kind} onChange={setKind} tabs={[{ key: 'both', label: 'Flight + Hotel' }, { key: 'flight', label: 'Flight Only' }, { key: 'hotel', label: 'Hotel Only' }]} />
      <div className="form-grid fg6" style={{ alignItems: 'end' }}>
        <Field label="Trip (optional)"><Select value={q.trip_id || ''} onChange={(e) => setQ({ ...q, trip_id: e.target.value })} placeholder="No trip" options={trips.map((t) => [t.id, t.trip_no])} /></Field>
        <Field label="From"><Select value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} options={AIRPORTS} /></Field><Field label="To"><Select value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value, city: AIRPORTS.find((a) => a[0] === e.target.value)?.[1].replace(/ \(.*/, '') })} options={AIRPORTS} /></Field>
        <Field label="Departure"><Input type="date" value={q.date} onChange={(e) => setQ({ ...q, date: e.target.value })} /></Field><Field label="Return"><Input type="date" value={q.return_date} onChange={(e) => setQ({ ...q, return_date: e.target.value })} /></Field>
        <Btn busy={busy} icon="search" onClick={run}>Search</Btn></div>
      {err && <div className="err mt" role="alert">{err}</div>}
    </Card>
    {res?.flights && (<div className="main-side" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
      <div className="stack">
        <Card title={`Flight Options (${flights.length})`} icon="plane" actions={<Check checked={onlyCompliant} onChange={(e) => setOC(e.target.checked)}>Show only compliant</Check>} body={false}>
          {flights.map((o) => (
            <div key={o.id} className="row" style={{ padding: 14, borderBottom: '1px solid #eef2fa', background: sel === o.id ? 'var(--blue-xl)' : undefined, alignItems: 'flex-start' }}>
              <input type="radio" name="opt" checked={sel === o.id} onChange={() => setSel(o.id)} disabled={!o.bookable} aria-label={`Choose ${o.airline}`} />
              <div className="grow"><div className="row"><b>{o.airline}</b><span className="muted small">{o.flightNo}</span>{o.id === res.flights.recommendedId && <Badge tone="green">Recommended</Badge>}{o.id === res.flights.cheapestId && <Badge tone="blue">Cheapest</Badge>}{!o.bookable && <Badge tone="red">Sold out</Badge>}</div>
                <div className="row" style={{ marginTop: 4, gap: 24 }}><b>{o.depTime} → {o.arrTime}</b><span>{o.durationLabel} · {o.stopsLabel}</span><span className="small muted">{o.baggageKg} kg · {o.refundable ? 'Refundable' : 'Non-refundable'}{o.changeFee ? ` · change fee ${inr(o.changeFee)}` : ''}</span></div>
                {o.policy.checks.filter((c) => !c.ok && c.severity !== 'info').map((c) => <div key={c.label} className="warn small mt-sm" style={{ marginTop: 6 }}>⚠ {c.detail}. Rule: {c.rule}</div>)}</div>
              <div className="right"><div style={{ fontSize: 18, fontWeight: 800, color: 'var(--navy)' }}>{inr(o.fare)}</div><Badge tone={o.policy.status === 'Compliant' ? 'green' : o.policy.status === 'Exception Required' ? 'orange' : 'red'}>{o.policy.status}</Badge></div>
            </div>))}
          {flights.length === 0 && <Empty>No options match.</Empty>}
        </Card>
        {res.hotels?.length > 0 && <Card title="Recommended Hotels" icon="bed" body={false}><DataTable rows={res.hotels} dense columns={[{ key: 'name', label: 'Hotel', render: (h) => <><b>{h.name}</b><div className="small muted">{'★'.repeat(h.star)} {h.rating} · {h.area}</div></> }, { key: 'p', label: 'Per night', render: (h) => inr(h.pricePerNight) }, { key: 'a', label: 'Includes', render: (h) => `${h.breakfast ? 'Breakfast' : 'No breakfast'} · ${h.freeCancelDays ? 'Free cancellation' : 'Non-refundable'}` }, { key: 'pol', label: 'Policy', render: (h) => <Badge>{h.policy.status}</Badge> }]} /></Card>}
      </div>
      <div className="stack">
        {res.comparison && <Card title="Total Trip Cost Comparison" icon="rupee" body={false}><DataTable rows={res.comparison} rowKey="id" dense columns={[{ key: 'option', label: 'Option', render: (c) => `Opt ${c.option}${c.option === 1 ? ' (Rec.)' : ''}` }, { key: 'flightFare', label: 'Fare', render: (c) => inr(c.flightFare) }, { key: 'taxes', label: 'Taxes', render: (c) => inr(c.taxes) }, { key: 'hotel', label: 'Hotel', render: (c) => inr(c.hotel) }, { key: 'total', label: 'Total', render: (c) => <b>{inr(c.total)}</b> }]} /></Card>}
        {chosen && <Card title="Policy Details for Selected Option" icon="shield" actions={<Badge>{chosen.policy.status}</Badge>}>{chosen.policy.checks.map((c) => <div key={c.label} className="row between small" style={{ padding: '4px 0' }}><span><b>{c.label}</b><div className="muted">{c.detail}</div></span><Badge tone={c.ok ? 'green' : c.severity === 'info' ? 'gray' : 'orange'}>{c.ok ? 'OK' : c.severity === 'info' ? 'Info' : 'Check'}</Badge></div>)}
          {q.trip_id ? <Link href={`/trips/${q.trip_id}?service=flight`} className="btn mt">Book this option</Link> : <div className="note small mt">Select an approved trip above to book.</div>}</Card>}
        {res.cancellationExposure > 0 && <Card title="Cancellation Exposure" icon="alert"><b>{inr(res.cancellationExposure)}</b><div className="small muted">Estimated penalty + fees if the recommended option is cancelled.</div></Card>}
      </div>
    </div>)}
    <span hidden>{nav.path}{user.id}</span>
  </>);
}
export { AIRPORT_OF_CITY, fdt };
