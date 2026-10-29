'use client';
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, PageHead, Stat, Badge, Icon, DataTable, Pager, Filters, Btn, Modal, Field, Input, Select, Textarea, Check, useApi, useNav, Confirm, Menu, FileDrop, Steps, Kv, Tabs } from '@/components/ui';
import { Donut, Legend } from '@/components/charts';
import { fdate, inr, range, nightsOf, fdt } from '@/lib/format';
import { PURPOSES, TRAVEL_MODES, TRIP_STATUSES } from '@/lib/constants';
import { OtpBoxes } from '@/views/auth';

const STATUS_ICON = { Draft: 'file', Submitted: 'send', 'Pending for Review': 'clock', 'Under Approval': 'hourglass', Approved: 'checkCircle', 'Booking In Progress': 'settings', 'Travel In Progress': 'plane', 'Expenses Pending': 'receipt', Closed: 'check', Rejected: 'x', Cancelled: 'x' };

// ---------- Create-new-trip modal (Self / Agency / Colleague + traveller verification) ----------
export function CreateTripModal({ user, onClose }) {
  const router = useRouter(); const api = useApi();
  const [kind, setKind] = useState('Self'); const [step, setStep] = useState('choose'); const [ident, setIdent] = useState(''); const [tid, setTid] = useState(null); const [code, setCode] = useState(''); const [found, setFound] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const canAgency = ['travel_desk', 'admin'].includes(user.role);
  const go = async () => {
    setErr('');
    if (kind === 'Self') { router.push('/trips/new'); return; }
    if (step === 'choose') setStep('lookup');
    else if (step === 'lookup') { setBusy(true); const r = await api('POST', '/traveller/lookup', { identifier: ident }, { silent: true, refresh: false }); setBusy(false); if (!r.ok) return setErr(r.error); setTid(r.data.traveller_id); setStep('otp'); }
    else if (step === 'otp') { setBusy(true); const r = await api('POST', '/traveller/verify', { traveller_id: tid, code }, { silent: true, refresh: false }); setBusy(false); if (!r.ok) return setErr(r.error); setFound(r.data); setStep('found'); }
    else if (step === 'found') { sessionStorage.setItem('geniq_traveller', JSON.stringify({ ...found, kind })); router.push(`/trips/new?for=${kind.toLowerCase()}`); }
  };
  const opts = [['Self', 'user', 'I am travelling'], ['Agency', 'building', 'Travel agency creating the trip'], ['Colleague', 'users', 'Create on behalf of a colleague']];
  return (
    <Modal title="Create New Trip" size="sm" onClose={onClose} footer={<><Btn variant="outline" onClick={step === 'choose' ? onClose : () => setStep('choose')}>{step === 'choose' ? 'Cancel' : 'Back'}</Btn><Btn busy={busy} onClick={go} disabled={(step === 'lookup' && !ident.trim()) || (step === 'otp' && code.length < 6)}>{step === 'found' ? 'Confirm & Continue' : step === 'otp' ? 'Verify & Continue' : 'Continue'}</Btn></>}>
      {step === 'choose' && (<><h3 style={{ marginTop: 0 }}>Who is this trip being created for?</h3><div className="muted mb">Raise a business trip for yourself, on behalf of a colleague, or for an agency booking.</div>
        <div className="grid g3">{opts.map(([k, i, d]) => { const dis = k === 'Agency' && !canAgency; return <div key={k} className={`opt-card ${kind === k ? 'on' : ''}`} style={dis ? { opacity: .5, cursor: 'not-allowed' } : undefined} onClick={() => !dis && setKind(k)} role="radio" aria-checked={kind === k} aria-disabled={dis}>{kind === k && <span className="tick"><Icon name="check" size={13} /></span>}<Icon name={i} size={26} /><div className="bold" style={{ color: 'var(--navy)' }}>{k}</div><div className="small muted">{dis ? 'Travel desk only' : d}</div></div>; })}</div></>)}
      {step === 'lookup' && (<><h3 style={{ marginTop: 0 }}>Verify the traveller</h3><div className="muted mb">Enter the traveller's registered corporate email ID or mobile number. A verification code is sent to them as consent.</div><Field label="Corporate email / mobile number" required><Input value={ident} onChange={(e) => setIdent(e.target.value)} placeholder="rahul.mehta@abccorp.com" /></Field></>)}
      {step === 'otp' && (<><h3 style={{ marginTop: 0 }}>Verify Identity</h3><div className="muted mb">Enter the 6-digit code the traveller received.</div><OtpBoxes value={code} onChange={setCode} /><div className="note small mt">Demo environment: the code is <b>246810</b>.</div></>)}
      {step === 'found' && found && (<><div className="center"><span className="ico-box" style={{ background: 'var(--green)', width: 44, height: 44, borderRadius: '50%' }}><Icon name="check" size={22} /></span><h3>Account Found</h3><div className="muted small">We found the traveller's profile. Their details will be pre-filled.</div></div>
        <div className="card mt"><div className="card-b row"><span className="avatar">{found.traveller.name.split(' ').map((x) => x[0]).join('')}</span><div><b>{found.traveller.name}</b><div className="small muted">{found.traveller.emp_id} | {found.traveller.department}</div><div className="small muted">{found.traveller.email}</div></div></div></div></>)}
      {err && <div className="err mt" role="alert">{err}</div>}
    </Modal>
  );
}

// ---------- Trips list ----------
export function TripsView({ user, data }) {
  const nav = useNav(); const api = useApi(); const router = useRouter();
  const [create, setCreate] = useState(false); const [sel, setSel] = useState([]); const [cancel, setCancel] = useState(null);
  const k = data.kpis; const colors = ['#9aa4b8', '#1d5fe0', '#f5a623', '#ef6c3c', '#16a34a', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b', '#dc2626', '#0f172a'];
  const donut = data.byStatus.map((s, i) => ({ label: s.status, value: s.count, color: colors[i] }));
  const exportCsv = () => { const head = ['Trip ID', 'Title', 'Employee', 'Department', 'Destination', 'Type', 'Departure', 'Return', 'Estimate', 'Status']; const rows = data.rows.map((t) => [t.trip_no, t.title, t.traveller_name, t.department, t.dest_city, t.travel_type, t.dep_date, t.ret_date, t.est_budget, t.status]); const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'trips.csv'; a.click(); };
  return (<>
    <PageHead title={user.role === 'employee' ? 'My Trips' : 'Manage Business Trips'} sub="Monitor travel requests, approvals and trip status" actions={<><Btn icon="plus" onClick={() => setCreate(true)}>Create New Request</Btn><Btn variant="outline" icon="copy" disabled={sel.length !== 1} onClick={async () => { const r = await api('POST', `/trips/${sel[0]}/copy`, {}, { refresh: false }); if (r.ok) router.push(`/trips/${r.data.id}`); }}>Copy & Create</Btn></>} />
    <div className="grid g4 mb"><Stat icon="briefcase" value={k.total} label="Total Trips" delta={k.totalDelta} /><Stat icon="clock" tone="orange" value={k.pending} label="Pending Approval" delta={k.pendingDelta} iconColor="#d97706" /><Stat icon="plane" tone="purple" value={k.booking} label="Booking In Progress" delta={k.bookingDelta} iconColor="#6d3fd1" /><Stat icon="checkCircle" tone="green" value={k.completed} label="Completed Trips" delta={k.completedDelta} iconColor="#15803d" /></div>
    <div className="row wrap mb" style={{ gap: 8 }}>{data.byStatus.map((s) => <button key={s.status} className="pill" onClick={() => nav.set({ status: s.status })} aria-label={`${s.status}: ${s.count}`}><Icon name={STATUS_ICON[s.status]} size={13} />{s.status} <span className="c">{s.count}</span></button>)}</div>
    <div className="grid g2 mb">
      <Card title="Trip Status Distribution" icon="chart"><div className="row" style={{ gap: 24 }}><Donut data={donut} label="Total Trips" /><div className="grow"><Legend data={donut} total={data.counts && Object.values(data.counts).reduce((a, b) => a + b, 0)} /></div></div></Card>
      <Card title="Trip Count by Status" icon="list" body={false}><DataTable rows={data.byStatus} rowKey="status" dense columns={[{ key: 'status', label: 'Status', render: (s) => <Badge>{s.status}</Badge> }, { key: 'count', label: 'Trip Count' }, { key: 'thisMonth', label: 'This Month' }, { key: 'avgApproval', label: 'Avg. Approval Time' }, { key: 'v', label: 'Action', render: (s) => <a href="#" onClick={(e) => { e.preventDefault(); nav.set({ status: s.status }); }}>View</a> }]} /></Card>
    </div>
    <Card title="Recent Business Trips" icon="briefcase" actions={<Btn variant="outline" icon="download" onClick={exportCsv}>Export</Btn>} body={false}>
      <div style={{ padding: '12px 16px 0' }}><Filters fields={[{ key: 'q', label: 'Search', placeholder: 'Trip ID, title, destination, employee' }, { key: 'status', label: 'Status', type: 'select', options: TRIP_STATUSES.map((s) => [s, s]), all: 'All Statuses' }, { key: 'purpose', label: 'Request Purpose', type: 'select', options: PURPOSES.map((s) => [s, s]), all: 'All Purposes' }, { key: 'travel_type', label: 'Travel Type', type: 'select', options: [['Domestic', 'Domestic'], ['International', 'International']], all: 'All Types' }, { key: 'from', label: 'Departure from', type: 'date' }, { key: 'to', label: 'Departure to', type: 'date' }, ...(user.role !== 'employee' ? [{ key: 'department', label: 'Department', type: 'select', options: data.departments.map((d) => [d, d]), all: 'All Departments' }] : [])]} onApplyLabel="Search" /></div>
      <DataTable rows={data.rows} selectable selected={sel} onSelect={setSel} empty="No trips match your filters." columns={[
        { key: 'trip_no', label: 'Request ID', render: (t) => <Link href={`/trips/${t.id}`} className="bold">{t.trip_no}</Link> }, { key: 'title', label: 'Trip Title' }, { key: 'traveller_name', label: 'Employee Name' }, { key: 'department', label: 'Department' }, { key: 'dest_city', label: 'Destination', render: (t) => `${t.dest_city}, ${t.dest_country}` },
        { key: 'travel_type', label: 'Travel Type' }, { key: 'dep_date', label: 'Departure Date', render: (t) => fdate(t.dep_date) }, { key: 'ret_date', label: 'Return Date', render: (t) => fdate(t.ret_date) }, { key: 'est_budget', label: 'Estimated Cost', render: (t) => inr(t.est_budget) }, { key: 'status', label: 'Status', render: (t) => <Badge>{t.status}</Badge> },
        { key: 'a', label: 'Actions', render: (t) => <span className="row gap-sm"><Link href={`/trips/${t.id}`} className="icon-btn" aria-label="View"><Icon name="eye" size={16} /></Link>{['Draft', 'Pending for Review'].includes(t.status) && t.created_by === user.id && <Link href={`/trips/${t.id}/edit`} className="icon-btn" aria-label="Edit"><Icon name="edit" size={16} /></Link>}
          <Menu items={[{ label: 'Copy & Create', onClick: async () => { const r = await api('POST', `/trips/${t.id}/copy`, {}, { refresh: false }); if (r.ok) router.push(`/trips/${r.data.id}`); } }, { label: 'Itinerary & Details', href: `/trips/${t.id}/details` }, ...(!['Closed', 'Cancelled', 'Rejected'].includes(t.status) && (t.created_by === user.id || t.traveller_id === user.id) ? [{ label: 'Cancel Trip', onClick: () => setCancel(t) }] : [])]} /></span> },
      ]} />
      <Pager page={data.page} size={data.size} total={data.total} noun="trips" />
    </Card>
    {create && <CreateTripModal user={user} onClose={() => setCreate(false)} />}
    {cancel && <Confirm title="Cancel Trip" danger needReason reasonLabel="Reason for cancellation" confirmLabel="Cancel Trip" text={`Cancel ${cancel.trip_no}? Active bookings will be cancelled and refund cases opened.`} onClose={() => setCancel(null)} onConfirm={async (reason) => { const r = await api('POST', `/trips/${cancel.id}/cancel`, { reason }, { success: 'Trip cancelled' }); if (r.ok) setCancel(null); }} />}
  </>);
}

// ---------- Trip request form ----------
const BLANK = (user) => ({ purpose: '', title: '', purpose_text: '', travel_type: 'Domestic', department: user.department || '', dest_country: 'India', dep_country: 'India', dep_city: user.homeCity || '', dest_city: '', dep_date: '', ret_date: '', travel_mode: 'Flight', extra_reqs: ['Hotel accommodation'], extra_other: '', company_code: 'ABC01', cost_object_type: 'Cost Center', cost_object: '', currency: 'INR', est_budget: '', advance_needed: false, advance_amount: '', comment: '', emergency: false, emergency_justification: '' });
const EXTRA = ['Hotel accommodation', 'Airport / local taxi', 'Meal'];

export function TripFormView({ user, master, trip, attachments = [], formId }) {
  const api = useApi(); const router = useRouter(); const nav = useNav();
  const [f, setF] = useState(() => (trip ? { ...BLANK(user), ...Object.fromEntries(Object.entries(trip).filter(([, v]) => v !== null && v !== undefined)), extra_reqs: trip.extra_reqs || [], advance_needed: !!trip.advance_needed, emergency: !!trip.emergency } : BLANK(user)));
  const [errs, setErrs] = useState([]); const [busy, setBusy] = useState(false); const [wf, setWf] = useState(null); const [files, setFiles] = useState([]);
  const [forWho, setForWho] = useState({ kind: 'Self', traveller: null });
  useEffect(() => { if (nav.get('for')) { try { const s = JSON.parse(sessionStorage.getItem('geniq_traveller') || 'null'); if (s) { setForWho({ kind: s.kind, traveller: s.traveller, token: s.token }); setF((x) => ({ ...x, department: s.traveller.department })); } } catch { /* ignore */ } } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const kind = { 'Cost Center': 'cost_center', Project: 'project', 'Sales Order': 'sales_order' }[f.cost_object_type];
  const objs = master.filter((m) => m.kind === kind);
  const intl = f.dest_country && f.dep_country && f.dest_country !== f.dep_country;
  useEffect(() => { if (intl && f.travel_type !== 'International') set('travel_type', 'International'); if (!intl && f.dest_country && f.travel_type === 'International') set('travel_type', 'Domestic'); }, [f.dest_country, f.dep_country]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(async () => { const r = await api('POST', '/trips/workflow', { ...f, traveller_id: forWho.traveller?.id, traveller_token: forWho.token }, { silent: true, refresh: false }); if (r.ok) setWf(r.data); }, 350);
    return () => clearTimeout(t);
  }, [f.travel_type, f.est_budget, f.cost_object_type, f.cost_object, f.emergency, forWho.traveller]); // eslint-disable-line react-hooks/exhaustive-deps
  const countries = ['India', 'Singapore', 'UAE', 'United Kingdom'];
  const cities = master.filter((m) => m.kind === 'city').filter((c) => c.meta.country === f.dest_country);
  const homeCities = master.filter((m) => m.kind === 'city').filter((c) => c.meta.country === f.dep_country);
  const save = async (submit) => {
    setBusy(true); setErrs([]);
    const body = { ...f, est_budget: Number(f.est_budget || 0), advance_amount: Number(f.advance_amount || 0), submit, created_for_type: forWho.kind, traveller_id: forWho.traveller?.id, traveller_token: forWho.token };
    let r;
    if (formId) { r = await api('PATCH', `/trips/${formId}`, body, { refresh: false }); if (r.ok && submit) r = await api('POST', `/trips/${formId}/submit`, {}, { refresh: false }); }
    else r = await api('POST', '/trips', body, { refresh: false });
    if (!r.ok) { setBusy(false); setErrs(r.data?.errors || [r.error]); window.scrollTo({ top: 0 }); return; }
    const id = formId || r.data.id;
    if (files.length) { const fd = new FormData(); files.forEach((x) => fd.append('files', x)); await api('POST', `/trips/${id}/attachments`, fd, { refresh: false }); }
    setBusy(false); sessionStorage.removeItem('geniq_traveller'); router.push(`/trips/${id}`); router.refresh();
  };
  const creator = `${user.name} (${user.empId})`; const created_for = forWho.traveller ? `${forWho.traveller.name} (${forWho.traveller.emp_id}) — ${forWho.kind}` : `${user.name} (${user.empId}) — Self`;
  return (
    <div className="main-side" style={{ '--side-width': '300px' }}>
      <Card title={formId ? `Edit Business Trip Request ${trip?.trip_no || ''}` : 'Business Trip Request'} icon="file" actions={<Link href="/trips" className="small">Cancel</Link>}>
        {errs.length > 0 && <div className="err mb" role="alert">{errs.map((e) => <div key={e}>• {e}</div>)}</div>}
        <div className="form-grid fg2"><Field label="Created By" required><Input className="ro" value={creator} readOnly /></Field><Field label="Created For" required><Input className="ro" value={created_for} readOnly /></Field></div>
        <div className="section-bar">1. Basic Information</div>
        <div className="form-grid fg4">
          <Field label="Request Purpose" required><Select value={f.purpose} onChange={(e) => set('purpose', e.target.value)} placeholder="Select" options={PURPOSES} /></Field>
          <Field label="Trip Title" required><Input value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={120} /></Field>
          <Field label="Purpose of travel" required><Input value={f.purpose_text} onChange={(e) => set('purpose_text', e.target.value)} /></Field>
          <Field label="Travel Type" required><div className="row" style={{ height: 36 }}>{['Domestic', 'International'].map((t) => <label key={t} className="chk"><input type="radio" checked={f.travel_type === t} onChange={() => { set('travel_type', t); if (t === 'Domestic') set('dest_country', f.dep_country); }} />{t === 'Domestic' ? 'Domestic trip' : 'International travel'}</label>)}</div></Field>
        </div>
        <div className="form-grid fg6 mt-sm" style={{ marginTop: 12 }}>
          <Field label="Department" required><Select value={f.department} onChange={(e) => set('department', e.target.value)} options={master.filter((m) => m.kind === 'department').map((m) => m.name)} placeholder="Select" /></Field>
          <Field label="Destination Country" required><Select value={f.dest_country} onChange={(e) => { set('dest_country', e.target.value); set('dest_city', ''); }} options={countries} /></Field>
          <Field label="Departure Country" required><Select value={f.dep_country} onChange={(e) => set('dep_country', e.target.value)} options={countries} /></Field>
          <Field label="Departure City" required><Select value={f.dep_city} onChange={(e) => set('dep_city', e.target.value)} options={homeCities.map((c) => c.name).concat(homeCities.some((c) => c.name === f.dep_city) || !f.dep_city ? [] : [f.dep_city])} placeholder="Select" /></Field>
          <Field label="Destination City" required><Select value={f.dest_city} onChange={(e) => set('dest_city', e.target.value)} options={cities.map((c) => c.name)} placeholder="Select" /></Field>
          <Field label="Departure Date" required><Input type="date" value={f.dep_date || ''} onChange={(e) => set('dep_date', e.target.value)} /></Field>
        </div>
        <div className="form-grid fg6" style={{ marginTop: 12 }}><Field label="Return Date" required><Input type="date" value={f.ret_date || ''} min={f.dep_date || undefined} onChange={(e) => set('ret_date', e.target.value)} /></Field>
          <div style={{ gridColumn: 'span 3', alignSelf: 'end' }}><Check checked={f.emergency} onChange={(e) => set('emergency', e.target.checked)}>Emergency travel (needs justification)</Check></div></div>
        {f.emergency && <Field label="Emergency justification" required><Textarea value={f.emergency_justification} onChange={(e) => set('emergency_justification', e.target.value)} /></Field>}
        <div className="section-bar">2. Travel Preferences</div>
        <div className="form-grid fg3"><Field label="Preferred travel mode" required><Select value={f.travel_mode} onChange={(e) => set('travel_mode', e.target.value)} options={TRAVEL_MODES} /></Field>
          <div style={{ gridColumn: 'span 2' }}><Field label="Additional booking requirements"><div className="row wrap" style={{ minHeight: 36 }}>{EXTRA.map((x) => <Check key={x} checked={f.extra_reqs.includes(x)} onChange={(e) => set('extra_reqs', e.target.checked ? [...f.extra_reqs, x] : f.extra_reqs.filter((y) => y !== x))}>{x}</Check>)}<Input placeholder="Other requirement" value={f.extra_other || ''} onChange={(e) => set('extra_other', e.target.value)} style={{ maxWidth: 220 }} /></div></Field></div></div>
        <div className="section-bar">3. Accounting and Budget Information</div>
        <div className="form-grid fg6">
          <Field label="Company Code" required><Select value={f.company_code} onChange={(e) => set('company_code', e.target.value)} options={['ABC01']} /></Field>
          <Field label="Cost Object Type" required><div className="row" style={{ height: 36, flexWrap: 'wrap' }}>{['Cost Center', 'Project', 'Sales Order'].map((t) => <label key={t} className="chk"><input type="radio" checked={f.cost_object_type === t} onChange={() => { set('cost_object_type', t); set('cost_object', ''); }} />{t}</label>)}</div></Field>
          <div style={{ gridColumn: 'span 2' }}><Field label="Cost Object" required><Select value={f.cost_object} onChange={(e) => set('cost_object', e.target.value)} placeholder="Select" options={objs.map((o) => `${o.code} - ${o.name}`)} /></Field></div>
          <div className="f" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><label htmlFor="est_budget" style={{ fontWeight: 600, fontSize: 12, color: 'var(--navy)' }}>Estimated total budget <span className="req" style={{ color: 'var(--red)' }}>*</span></label><div className="row gap-sm"><Select aria-label="Currency" value={f.currency} onChange={(e) => set('currency', e.target.value)} options={['INR']} /><Input id="est_budget" type="number" min="0" value={f.est_budget} onChange={(e) => set('est_budget', e.target.value)} /></div></div>
          <Field label="Travel advance needed"><Select value={f.advance_needed ? 'Yes' : 'No'} onChange={(e) => set('advance_needed', e.target.value === 'Yes')} options={['No', 'Yes']} /></Field>
        </div>
        {f.advance_needed && <div className="form-grid fg4" style={{ marginTop: 12 }}><Field label="Advance amount" required hint="Maximum ₹50,000 as per policy"><Input type="number" min="0" value={f.advance_amount} onChange={(e) => set('advance_amount', e.target.value)} /></Field></div>}
        <div className="section-bar">4. Additional Information</div>
        <div className="grid g2"><Field label="Comment" required><Textarea value={f.comment} onChange={(e) => set('comment', e.target.value)} maxLength={2000} rows={5} /><span className="small muted right">Characters: {f.comment.length}/2000</span></Field>
          <Field label="Attachment"><FileDrop onFiles={(x) => setFiles((a) => [...a, ...x])} />{(files.length > 0 || attachments.length > 0) && <div className="stack" style={{ gap: 4 }}>{attachments.map((a) => <div key={a.id} className="small"><Icon name="paperclip" size={13} /> {a.name}</div>)}{files.map((x, i) => <div key={i} className="row between small"><span><Icon name="paperclip" size={13} /> {x.name}</span><button className="icon-btn red" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="x" size={14} /></button></div>)}</div>}</Field></div>
        <div className="row mt"><Btn busy={busy} onClick={() => save(true)}>Submit for Approval</Btn><Btn variant="outline" busy={busy} onClick={() => save(false)}>Save as Draft</Btn><Link href="/trips" className="btn outline">Cancel</Link></div>
      </Card>
      <div className="stack">
        <Card title="Approval Workflow" icon="users"><div className="vsteps">{(wf?.steps || []).map((s, i) => <div key={s.label} className="vs"><span className="c">{i + 1}</span><div><b>{s.label}</b><div className="small muted">{s.approverName} — {s.note}</div></div></div>)}{!wf && <div className="muted small">Determined from policy and trip type.</div>}</div>{wf && <div className="small muted mt-sm">Route: {wf.kind}</div>}</Card>
        <Card title="Request Status" icon="hourglass"><Badge>{trip?.status || 'Draft'}</Badge><Kv rows={[['Trip No.', trip?.trip_no || 'Generated on save'], ['Created By', creator], ['Created On', fdt(trip?.created_at || new Date().toISOString())]]} /></Card>
      </div>
    </div>
  );
}
