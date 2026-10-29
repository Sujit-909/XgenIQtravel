'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, Badge, Icon, Btn, Steps, Kv, DataTable, Confirm, useApi, useNav, Tabs, Modal, Empty, Field, Input, Select } from '@/components/ui';
import { ServicePanel, ServiceList, serviceTileDefs } from '@/views/services';
import { fdate, fdt, inr, range, nightsOf, fshort } from '@/lib/format';
import { serviceTiles } from '@/lib/service-tiles';

function Chain({ approvals }) {
  if (!approvals.length) return null;
  return (
    <Card title="Approval Chain" icon="users">
      <div className="vsteps">{approvals.filter((a) => a.status !== 'Cancelled').map((a) => (
        <div key={a.id} className={`vs ${a.status === 'Approved' ? 'done' : a.status === 'Pending' ? 'cur' : ['Rejected'].includes(a.status) ? 'bad' : ''}`}><span className="c">{a.level}</span>
          <div className="grow"><div className="row between"><b>{a.label}</b><Badge>{a.status}</Badge></div><div className="small muted">{a.approver_name || a.approver_role}{a.acted_at ? ` · ${fdt(a.acted_at)}` : ''}</div>{a.comment && <div className="small" style={{ marginTop: 2 }}>“{a.comment}”</div>}</div></div>))}</div>
    </Card>
  );
}

export function TripDetailView({ user, data }) {
  const { trip, traveller, approvals, services, bookings, tracker, summary, can, workflow, files, reports } = data;
  const api = useApi(); const router = useRouter(); const nav = useNav();
  const [cancel, setCancel] = useState(false); const [blockers, setBlockers] = useState(null);
  const tiles = serviceTiles(trip, services); const sel = nav.get('service', 'flight');
  const info = approvals.find((a) => a.status === 'Info Requested');
  const isOwner = trip.created_by === user.id || trip.traveller_id === user.id;
  const close = async () => { const r = await api('POST', `/trips/${trip.id}/close`, {}, { silent: true }); if (!r.ok) setBlockers(r.data?.blockers || [r.error]); };
  return (<>
    <Link href="/trips" className="small">‹ Back to Trips</Link>
    <div className="page-head mt-sm" style={{ marginTop: 6 }}>
      <div><h1>Trip No. {trip.trip_no} <Badge>{trip.status}</Badge></h1><p>{trip.title}</p><div className="row wrap small muted"><span><Icon name="calendar" size={14} /> {range(trip.dep_date, trip.ret_date)} ({nightsOf(trip.dep_date, trip.ret_date) + 1} days)</span><span><Icon name="plane" size={14} /> {trip.dep_city} → {trip.dest_city}, {trip.dest_country}</span><span><Icon name="briefcase" size={14} /> {trip.purpose}</span><span><Icon name="user" size={14} /> {traveller.name} ({traveller.emp_id})</span></div></div>
      <div style={{ minWidth: 420 }}><Steps steps={tracker.map((t) => ({ ...t, sub: t.date }))} /></div>
    </div>
    {info && isOwner && <div className="warn mb"><b>More information requested:</b> {info.comment} — edit the request and resubmit.</div>}
    {trip.status === 'Rejected' && <div className="err mb"><b>Rejected:</b> {approvals.find((a) => a.status === 'Rejected')?.comment}</div>}
    <div className="row wrap mb">
      {can.edit && <Link href={`/trips/${trip.id}/edit`} className="btn outline"><Icon name="edit" size={15} />Edit Request</Link>}
      {can.edit && <Btn onClick={async () => { await api('POST', `/trips/${trip.id}/submit`, {}, { success: 'Submitted for approval' }); }}>{trip.status === 'Draft' ? 'Submit for Approval' : 'Resubmit'}</Btn>}
      <Link href={`/trips/${trip.id}/details`} className="btn outline"><Icon name="list" size={15} />Itinerary & Details</Link>
      {can.expense && isOwner && <Link href={`/expenses/new?trip=${trip.id}`} className="btn outline"><Icon name="file" size={15} />Raise Expense</Link>}
      {can.close && <Btn variant="outline" onClick={close}>Close Trip</Btn>}
      <Btn variant="outline" icon="copy" onClick={async () => { const r = await api('POST', `/trips/${trip.id}/copy`, {}, { refresh: false }); if (r.ok) router.push(`/trips/${r.data.id}`); }}>Copy & Create</Btn>
      {can.cancel && <Btn variant="danger" onClick={() => setCancel(true)}>Cancel Trip</Btn>}
    </div>
    <div className="main-side" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
      <div className="stack">
        {can.book ? (<>
          <div className="grid g5">{tiles.map((t) => { const def = serviceTileDefs.find((d) => d[0] === t.type); return (
            <button key={t.type} className={`opt-card ${sel === t.type ? 'on' : ''}`} style={{ textAlign: 'left', padding: 12 }} onClick={() => nav.set({ service: t.type }, true)} aria-pressed={sel === t.type}><div className="row"><Icon name={def[2]} size={22} /><div><b style={{ color: 'var(--navy)' }}>{def[1]}</b><div className="small" style={{ color: t.status === 'Confirmed' ? 'var(--green)' : t.status === 'In Progress' ? 'var(--blue)' : 'var(--muted)' }}>{t.status}</div></div></div></button>); })}</div>
          <ServicePanel trip={trip} services={services} type={sel} user={user} />
        </>) : <div className="note">{['Draft', 'Pending for Review'].includes(trip.status) ? 'Submit this request for approval. Booking services unlock once the trip is approved.' : ['Submitted', 'Under Approval'].includes(trip.status) ? 'Awaiting approval. Booking services unlock once the trip is approved.' : 'Booking is not available for this trip status.'}</div>}
        <Card title="Service Requests" icon="list" body={false}><ServiceList services={services} user={user} /></Card>
        <Card title="Bookings" icon="briefcase" body={false}><DataTable rows={bookings} empty="No bookings yet." columns={[{ key: 'booking_no', label: 'Booking' }, { key: 'type', label: 'Type' }, { key: 'detail', label: 'Details' }, { key: 'travel_date', label: 'Date', render: (b) => fdate(b.travel_date) }, { key: 'amount', label: 'Amount', render: (b) => inr(b.amount) }, { key: 'policy_status', label: 'Policy', render: (b) => (b.policy_status ? <Badge>{b.policy_status}</Badge> : '-') }, { key: 'status', label: 'Status', render: (b) => <Badge>{b.status}</Badge> }]} /></Card>
      </div>
      <div className="stack">
        <Chain approvals={approvals} />
        {workflow && <Card title="Approval Workflow (on submit)" icon="users"><div className="vsteps">{workflow.steps.map((s, i) => <div key={s.label} className="vs"><span className="c">{i + 1}</span><div><b>{s.label}</b><div className="small muted">{s.approverName}</div></div></div>)}</div></Card>}
        <Card title="Trip Summary" icon="file" actions={can.edit && <Link href={`/trips/${trip.id}/edit`}>Edit</Link>}><Kv rows={[['Trip No.', trip.trip_no], ['Employee', `${traveller.name} (${traveller.emp_id})`], ['Department', trip.department], ['Purpose', trip.purpose], ['Travel Type', trip.travel_type], ['Destination', `${trip.dep_city} → ${trip.dest_city}`], ['Travel Dates', range(trip.dep_date, trip.ret_date)], ['Company Code', trip.company_code], ['Cost Object', trip.cost_object], ['Approved Budget', inr(trip.est_budget)], ['Utilized (Bookings)', inr(summary.utilized)], ['Balance', inr(summary.balance)], ['Travel Advance', inr(trip.advance_amount)]]} /></Card>
        <Card title="Employee Travel Profile" icon="user" actions={<Link href="/profile">View Full Profile</Link>}><Kv rows={[['Employee Name', traveller.name], ['Employee ID', traveller.emp_id], ['Department', traveller.department], ['Nationality', traveller.nationality], ['Work Email', traveller.email], ['Contact', traveller.phone]]} /><div className="note small mt">These details are fetched from the employee profile. Please review and update if required for this trip.</div></Card>
        {files.length > 0 && <Card title="Attachments" icon="paperclip">{files.map((f) => <div key={f.id}><a href={`/api/files/${f.id}`}>{f.name}</a></div>)}</Card>}
        {reports.length > 0 && <Card title="Expense Reports" icon="file">{reports.map((r) => <div key={r.id} className="row between"><Link href={`/expenses/${r.id}`}>{r.report_no}</Link><Badge>{r.status}</Badge></div>)}</Card>}
      </div>
    </div>
    {cancel && <Confirm title="Cancel Trip" danger needReason reasonLabel="Reason for cancellation" confirmLabel="Cancel Trip" text="Active bookings will be cancelled and refund cases opened for the travel desk." onClose={() => setCancel(false)} onConfirm={async (reason) => { const r = await api('POST', `/trips/${trip.id}/cancel`, { reason }, { success: 'Trip cancelled' }); if (r.ok) setCancel(false); }} />}
    {blockers && <Modal title="This trip cannot be closed yet" size="sm" onClose={() => setBlockers(null)} footer={<Btn onClick={() => setBlockers(null)}>OK</Btn>}><ul>{blockers.map((b) => <li key={b}>{b}</li>)}</ul></Modal>}
  </>);
}

// ---------- Itinerary & details ----------
export function TripItineraryView({ user, data }) {
  const { trip, traveller, approvals, bookings, services, files, history } = data;
  const nav = useNav(); const tab = nav.get('tab', 'itinerary');
  const cats = { flight: ['plane', 'Flight'], hotel: ['bed', 'Hotel'], cab: ['car', 'Ground Transport'], bus: ['bus', 'Bus'], train: ['train', 'Train'], other: ['file', 'Service'] };
  const sorted = [...bookings].sort((a, b) => String(a.travel_date).localeCompare(String(b.travel_date)));
  const total = bookings.filter((b) => b.status !== 'Cancelled').reduce((s, b) => s + b.amount, 0);
  const summary = data.summary;
  const five = [['Trip Approved', ['Approved', 'Booking In Progress', 'Travel In Progress', 'Expenses Pending', 'Closed']], ['Bookings Confirmed', bookings.some((b) => ['Confirmed', 'Completed'].includes(b.status)) ? ['Booking In Progress', 'Travel In Progress', 'Expenses Pending', 'Closed'] : ['Closed']], ['Ticket Issued', bookings.some((b) => b.ticket_no) ? ['Travel In Progress', 'Expenses Pending', 'Closed', 'Booking In Progress'] : []], ['In Travel', ['Travel In Progress', 'Expenses Pending', 'Closed']], ['Trip Completed', ['Closed']]];
  const idx = five.reduce((last, [, on], i) => (on.includes(trip.status) ? i : last), -1);
  const steps = five.map(([label], i) => ({ label, state: i < idx ? 'done' : i === idx ? 'current' : 'todo', sub: i === 0 ? fshort(trip.approved_at) : i === 4 ? fshort(trip.closed_at) : '' }));
  return (<>
    <Link href={`/trips/${trip.id}`} className="small">‹ Back to Trip</Link>
    <div className="page-head" style={{ marginTop: 6 }}><div><h1>Trip Details – {trip.trip_no} <Badge>{trip.status}</Badge></h1><p>Complete itinerary and service details for your trip in one view.</p></div>
      <div className="row"><Btn variant="outline" icon="download" onClick={() => window.print()}>Download Trip Pack</Btn><Link className="btn" href={`/trips/${trip.id}`}>Manage Trip</Link></div></div>
    <Card className="mb"><div className="grid g6"><Kv rows={[['Traveller', traveller.name], ['', traveller.department]]} /><Kv rows={[['Trip Purpose', trip.purpose]]} /><Kv rows={[['Cost Object', trip.cost_object]]} /><Kv rows={[['Approver', approvals[0]?.approver_name]]} /><Kv rows={[['Travel Dates', range(trip.dep_date, trip.ret_date)]]} /><Kv rows={[['Destination', trip.dest_city], ['Est. Trip Cost', inr(trip.est_budget)]]} /></div><div className="mt"><Steps steps={steps} /></div></Card>
    <Tabs value={tab} onChange={(t) => nav.set({ tab: t }, true)} tabs={[{ key: 'itinerary', label: 'Itinerary' }, { key: 'services', label: 'Service Details' }, { key: 'documents', label: 'Documents' }, { key: 'cost', label: 'Cost & Invoices' }, { key: 'approvals', label: 'Approvals' }, { key: 'communication', label: 'Communication' }, { key: 'history', label: 'History' }]} />
    {tab === 'itinerary' && <div className="main-side">
      <Card title="Trip Itinerary Timeline" icon="clock">{sorted.length === 0 ? <Empty>No bookings yet.</Empty> : sorted.map((b) => { const [ic, lab] = cats[b.type] || cats.other; return (
        <div key={b.id} className="row" style={{ alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid #eef2fa' }}><div style={{ width: 70 }} className="bold">{fshort(b.travel_date)}</div><span className="ico-box soft"><Icon name={ic} size={17} /></span>
          <div className="grow"><div className="row"><b>{lab}: {b.detail}</b><Badge>{b.status}</Badge></div><div className="small muted">{b.route}{b.details?.depTime ? ` · ${b.details.depTime} → ${b.details.arrTime} · ${b.details.duration}` : ''}{b.details?.nights ? ` · ${b.details.nights} nights` : ''}</div></div><div className="small right">Ref: <b>{b.supplier_ref || '-'}</b>{b.ticket_no && <div>Ticket: {b.ticket_no}</div>}</div></div>); })}</Card>
      <div className="stack"><Card title="Important Information" icon="info"><Kv rows={[['Passport Validity', 'Check profile'], ['Visa', trip.travel_type === 'International' ? 'Required' : 'Not Required'], ['Emergency Contact', 'On profile'], ['Travel Policy Status', <Badge key="p" tone="green">Compliant</Badge>]]} /></Card>
        <Card title="Quick Actions" icon="settings"><div className="stack"><Link className="btn outline" href={`/trips/${trip.id}`}>Manage services</Link><Link className="btn outline" href="/bookings">View all bookings</Link></div></Card></div></div>}
    {tab === 'services' && <Card title="Service Summary" body={false}><DataTable rows={bookings} empty="No services yet." columns={[{ key: 'type', label: 'Service Type' }, { key: 'supplier', label: 'Supplier' }, { key: 'supplier_ref', label: 'Reference' }, { key: 'status', label: 'Status', render: (b) => <Badge>{b.status}</Badge> }, { key: 'amount', label: 'Amount', render: (b) => inr(b.amount) }]} /><div className="right bold" style={{ padding: 12 }}>Total Trip Cost: {inr(total)}</div></Card>}
    {tab === 'documents' && <Card title="Documents" icon="file">{files.length === 0 ? <Empty>No documents uploaded.</Empty> : files.map((f) => <div key={f.id} className="row between" style={{ padding: '6px 0' }}><span><Icon name="file" size={15} /> {f.name}</span><a href={`/api/files/${f.id}`}>Download</a></div>)}</Card>}
    {tab === 'cost' && <Card title="Cost & Invoices" body={false}><DataTable rows={bookings} empty="No costs yet." columns={[{ key: 'booking_no', label: 'Booking' }, { key: 'detail', label: 'Details' }, { key: 'amount', label: 'Amount', render: (b) => inr(b.amount) }, { key: 'claim_status', label: 'Claim' }]} /><div className="row between" style={{ padding: 12 }}><span>Approved budget {inr(trip.est_budget)}</span><b>Utilized {inr(summary.utilized)} · Balance {inr(summary.balance)}</b></div></Card>}
    {tab === 'approvals' && <Chain approvals={approvals} />}
    {tab === 'communication' && <Card title="Service Requests" body={false}><ServiceList services={services} user={user} /></Card>}
    {tab === 'history' && <Card title="History" body={false}><DataTable rows={history.map((h, i) => ({ ...h, id: i }))} empty="No history." columns={[{ key: 'ts', label: 'When', render: (h) => fdt(h.ts) }, { key: 'actor_name', label: 'By' }, { key: 'action', label: 'Action' }, { key: 'detail', label: 'Detail' }]} /></Card>}
  </>);
}
