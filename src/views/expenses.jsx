'use client';
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, PageHead, Stat, Badge, Icon, DataTable, Pager, Filters, Btn, Modal, Field, Input, Select, Textarea, Check, Switch, useApi, useNav, Menu, Tabs, Kv, FileDrop, Empty, Confirm } from '@/components/ui';
import { fdate, inr, num2, range, fdt } from '@/lib/format';
import { EXPENSE_TYPES } from '@/lib/constants';

const KP = [['Draft', 'file', 'blue'], ['Submitted', 'send', 'blue'], ['In Review', 'clock', 'orange'], ['Approved', 'checkCircle', 'green'], ['Rejected', 'x', 'red'], ['Paid', 'rupee', 'purple'], ['Returned', 'refresh', 'orange']];
const T_ICON = { 'Air Fare': 'plane', Hotel: 'bed', 'Cab Fare': 'car', Meals: 'gift', Bus: 'bus', 'Train Fare': 'train' };

export function ExpensesView({ user, data }) {
  const nav = useNav(); const router = useRouter(); const api = useApi();
  const [sel, setSel] = useState([]); const scope = data.scope; const canTeam = ['manager', 'finance', 'admin'].includes(user.role);
  return (<>
    <PageHead title="Manage Expenses" sub="Create, view and manage your expense reports" actions={<Link href="/expenses/new" className="btn"><Icon name="plus" size={15} />Create Expense Report</Link>} />
    <div className="grid g6 mb" >{KP.map(([k, i, t]) => <Stat key={k} icon={i} tone={t} value={data.kpis[k].count} label={k} delta={data.kpis[k].delta} />)}</div>
    <Card body={false}>
      {canTeam && <div style={{ padding: '4px 16px 0' }}><Tabs value={scope === 'mine' ? 'mine' : 'team'} onChange={(t) => nav.set({ scope: t === 'mine' ? 'mine' : user.role === 'manager' ? 'team' : 'all' })} tabs={[{ key: 'mine', label: 'My Expense Reports' }, { key: 'team', label: 'Team Reports' }]} /></div>}
      <div style={{ padding: '12px 16px 0' }}><Filters fields={[{ key: 'q', label: 'Search', placeholder: 'Report no., trip ID, employee, purpose' }, { key: 'status', label: 'Status', type: 'select', all: 'All Statuses', options: ['Draft', 'Submitted', 'In Review', 'Approved', 'Rejected', 'Paid', 'Returned'].map((s) => [s, s]) }, { key: 'category', label: 'Category', type: 'select', all: 'All Categories', options: ['Travel', 'Non Travel', 'Event'].map((s) => [s, s]) }, { key: 'department', label: 'Department', type: 'select', all: 'All Departments', options: data.departments.map((s) => [s, s]) }, { key: 'cost_object_type', label: 'Cost Object Type', type: 'select', all: 'All Types', options: ['Cost Center', 'WBS Element', 'Internal Order'].map((s) => [s, s]) }, { key: 'from', label: 'Travel start from', type: 'date' }, { key: 'to', label: 'to', type: 'date' }]} /></div>
      <DataTable rows={data.rows} selectable selected={sel} onSelect={setSel} empty="No expense reports found." columns={[
        { key: 'report_no', label: 'Report No.', render: (r) => <Link href={`/expenses/${r.id}`} className="bold">{r.report_no}</Link> }, { key: 'trip_no', label: 'Trip ID', render: (r) => (r.trip_no ? <Link href={`/trips/${r.trip_id}`}>{r.trip_no}</Link> : '-') }, { key: 'employee', label: 'Employee Name' }, { key: 'emp_id', label: 'Employee ID' }, { key: 'department', label: 'Department' }, { key: 'category', label: 'Category' }, { key: 'purpose', label: 'Purpose' },
        { key: 'start_date', label: 'Travel Start', render: (r) => fdate(r.start_date) }, { key: 'end_date', label: 'Travel End', render: (r) => fdate(r.end_date) }, { key: 'cost_object_type', label: 'Cost Object Type' }, { key: 'advance', label: 'Travel Advance', render: (r) => inr(r.advance) }, { key: 'total_amount', label: 'Total Amount', render: (r) => inr(r.total_amount) }, { key: 'reimbursed', label: 'Reimbursed', render: (r) => inr(r.reimbursed) },
        { key: 'status', label: 'Status', render: (r) => <Badge>{r.reimb_status === 'Paid' ? 'Paid' : r.status}</Badge> },
        { key: 'a', label: 'Actions', render: (r) => <span className="row gap-sm"><Link href={`/expenses/${r.id}`} className="icon-btn" aria-label="View"><Icon name="eye" size={16} /></Link>{r.user_id === user.id && ['Draft', 'Returned for Correction'].includes(r.status) && <Link href={`/expenses/${r.id}?step=items`} className="icon-btn" aria-label="Edit"><Icon name="edit" size={16} /></Link>}<Menu items={[{ label: 'Download PDF', onClick: () => window.open(`/api/expenses/${r.id}/pdf`, '_blank') }]} /></span> },
      ]} />
      <Pager page={data.page} size={data.size} total={data.total} noun="entries" />
    </Card>
    <span hidden>{router && api ? '' : ''}</span>
  </>);
}

// ---------- Step 1: create report ----------
export function ExpenseCreateView({ user, trips, master, preselect, upload }) {
  const api = useApi(); const router = useRouter();
  const [f, setF] = useState({ title: '', purpose: '', category: 'Travel', trip_id: preselect || '', company_code: 'ABC01', cost_object_type: 'Cost Center', travel_allowance: true, comment: '' });
  const [cos, setCos] = useState([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const trip = trips.find((t) => String(t.id) === String(f.trip_id));
  useEffect(() => { if (trip) { setF((x) => ({ ...x, title: x.title || trip.title, purpose: x.purpose || trip.purpose_text || trip.title, cost_object_type: trip.cost_object_type === 'Project' ? 'WBS Element' : trip.cost_object_type })); setCos([{ costObject: trip.cost_object, percentage: 100 }]); } }, [f.trip_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const kind = { 'Cost Center': 'cost_center', 'WBS Element': 'project', Project: 'project', 'Internal Order': 'internal_order', 'Sales Order': 'sales_order' }[f.cost_object_type];
  const options = master.filter((m) => m.kind === kind).map((m) => `${m.code} - ${m.name}`);
  const total = cos.reduce((s, c) => s + Number(c.percentage || 0), 0);
  const addCo = (v) => { if (v && !cos.some((c) => c.costObject === v)) setCos(cos.length === 0 ? [{ costObject: v, percentage: 100 }] : [...cos, { costObject: v, percentage: 0 }]); };
  const next = async () => {
    setBusy(true); setErr('');
    const r = await api('POST', '/expenses', { ...f, trip_id: f.category === 'Travel' ? Number(f.trip_id) || undefined : undefined, cost_objects: cos.map((c) => ({ ...c, type: f.cost_object_type })) }, { silent: true, refresh: false });
    setBusy(false); if (!r.ok) return setErr(r.error); router.push(`/expenses/${r.data.id}?step=items${upload ? '&upload=1' : ''}`);
  };
  return (
    <div className="main-side" style={{ '--side-width': '340px' }}>
      <Card title="Create Expense Report" icon="file" actions={<div className="steps" style={{ width: 'min(460px, 100%)' }}>{['Report Details', 'Expense Items', 'Review & Submit', 'Confirmation'].map((s, i) => <div key={s} className={`step ${i === 0 ? 'current' : ''}`}><span className="c">{i + 1}</span><span>{s}</span></div>)}</div>}>
        {err && <div className="err mb" role="alert">{err}</div>}
        <div className="section-bar">1. Basic Details</div>
        <Field label="Expense Category" required><div className="grid g3" style={{ maxWidth: 420 }}>{[['Travel', 'plane'], ['Non Travel', 'briefcase'], ['Event', 'calendar']].map(([c, i]) => <div key={c} className={`opt-card ${f.category === c ? 'on' : ''}`} style={{ padding: 10 }} onClick={() => setF({ ...f, category: c })} role="radio" aria-checked={f.category === c}><Icon name={i} size={20} /><div className="small bold">{c}</div></div>)}</div></Field>
        <div className="form-grid fg3 mt" style={{ marginTop: 12 }}><Field label="Expense Report Title" required><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field><Field label="Report Purpose" required><Input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></Field>
          {f.category === 'Travel' && <Field label="Trip ID" required><Select value={f.trip_id} onChange={(e) => setF({ ...f, trip_id: e.target.value })} placeholder="Select trip" options={trips.map((t) => [t.id, `${t.trip_no} (${t.title})`])} /></Field>}</div>
        {f.category === 'Travel' && trips.length === 0 && <div className="warn mt">You have no approved trips. <Link href="/trips/new">Create a new trip</Link> first.</div>}
        <div className="section-bar">2. Trip Information</div>
        <div className="form-grid fg4"><Field label="Travel Start Date"><Input className="ro" value={trip ? fdate(trip.dep_date) : ''} readOnly /></Field><Field label="Travel End Date"><Input className="ro" value={trip ? fdate(trip.ret_date) : ''} readOnly /></Field><Field label="Destination Country"><Input className="ro" value={trip?.dest_country || ''} readOnly /></Field><Field label="Destination City"><Input className="ro" value={trip?.dest_city || ''} readOnly /></Field></div>
        <div className="section-bar">3. Traveller Information</div>
        <div className="form-grid fg4"><Field label="Employee Name"><Input className="ro" value={user.name} readOnly /></Field><Field label="Employee ID"><Input className="ro" value={user.empId} readOnly /></Field><Field label="Department"><Input className="ro" value={user.department} readOnly /></Field><Field label="Company Code" required><Select value={f.company_code} onChange={(e) => setF({ ...f, company_code: e.target.value })} options={['ABC01']} /></Field></div>
        <div className="section-bar">4. Accounting Information</div>
        <div className="form-grid fg2"><Field label="Cost Object Type" required><Select value={f.cost_object_type} onChange={(e) => { setF({ ...f, cost_object_type: e.target.value }); setCos([]); }} options={['Cost Center', 'WBS Element', 'Internal Order']} /></Field><Field label="Cost Object(s)" required><Select value="" onChange={(e) => addCo(e.target.value)} placeholder="+ Add Cost Object" options={options.filter((o) => !cos.some((c) => c.costObject === o))} /></Field></div>
        <div className="section-bar">5. Travel Allowance</div>
        <div className="note row"><Icon name="info" size={16} />Select if you have travel and require lodging, meals, or incidental travel allowances.<div className="grow" /><label className="chk"><input type="radio" checked={f.travel_allowance} onChange={() => setF({ ...f, travel_allowance: true })} />Yes, I require Travel Allowance</label><label className="chk"><input type="radio" checked={!f.travel_allowance} onChange={() => setF({ ...f, travel_allowance: false })} />No</label></div>
        <div className="section-bar">6. Additional Information</div>
        <Field label="Comment"><Textarea value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} maxLength={2000} /><span className="small muted right">Characters: {f.comment.length}/2000</span></Field>
        <div className="row between mt"><Link href="/expenses" className="btn outline">Cancel</Link><Btn busy={busy} onClick={next} disabled={!f.title || !f.purpose || cos.length === 0}>Next: Add Expense Items →</Btn></div>
      </Card>
      <div className="stack">
        <Card title="Trip Details (Auto-fetched)" icon="plane">{trip ? <Kv rows={[['Trip ID', trip.trip_no], ['Trip Category', trip.travel_type], ['Travel Dates', range(trip.dep_date, trip.ret_date)], ['Destination', `${trip.dest_city}, ${trip.dest_country}`], ['Company Code', trip.company_code]]} /> : <Empty>Select a trip.</Empty>}</Card>
        <Card title={`Selected Cost Objects (${cos.length})`} icon="list">{cos.map((c, i) => <div key={c.costObject} className="row" style={{ marginBottom: 6 }}><span className="grow small">{c.costObject}</span><input className="in" style={{ width: 70 }} type="number" min="0" max="100" value={c.percentage} aria-label={`Percentage for ${c.costObject}`} onChange={(e) => setCos(cos.map((x, j) => (j === i ? { ...x, percentage: e.target.value } : x)))} />%<button className="icon-btn red" onClick={() => setCos(cos.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="trash" size={14} /></button></div>)}
          <div className="row between bold" style={{ background: Math.abs(total - 100) < .01 ? 'var(--green-bg)' : 'var(--red-bg)', padding: '6px 10px', borderRadius: 6 }}><span>Total</span><span>{total} %</span></div>{Math.abs(total - 100) >= .01 && cos.length > 0 && <div className="small" style={{ color: 'var(--red)' }}>Allocation must total 100%.</div>}</Card>
        <Card title="Policy Information" icon="shield"><Kv rows={[['Physical Receipt Mandatory', 'Yes (As per policy)'], ['Maximum Advance Allowed', 'INR 50,000'], ['Currency', 'INR'], ['Reimbursement Policy', <Link key="p" href="/policy">View Policy</Link>]]} /></Card>
        <Card title="Financial Summary (Header)" icon="rupee"><Kv rows={[['Travel Advance (INR)', inr(trip?.advance_needed ? trip.advance_amount : 0)]]} /></Card>
      </div>
    </div>
  );
}

// ---------- Item add/edit modal ----------
function ItemModal({ report, item, costObjects, currencies, onClose }) {
  const api = useApi();
  const blank = { type: 'Air Fare', vendor: '', city: report.dest_city || '', txn_date: '', from_date: '', to_date: '', payment_type: 'Employee Paid', amount: '', tax: '0', currency: 'INR', personal: false, comment: '', allocation_basis: 'Percentage', allocation: null, itemization: [], receipt_file_id: null };
  const [f, setF] = useState(item ? { ...blank, ...Object.fromEntries(Object.entries(item).filter(([, v]) => v !== null)), personal: !!item.personal } : blank);
  const [alloc, setAlloc] = useState(item?.allocation?.length ? item.allocation.map((a) => ({ ...a })) : costObjects.map((c) => ({ costObject: c.cost_object, costObjectType: c.type, percentage: c.percentage, amount: 0 })));
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [itz, setItz] = useState(false); const [fileName, setFileName] = useState(item?.receipt_file_id ? 'Receipt attached' : '');
  const fx = { INR: 1, USD: 83.5, EUR: 90.2, SGD: 62, AED: 22.7, GBP: 105.4 }[f.currency] || 1;
  const total = Math.round((Number(f.amount || 0) + Number(f.tax || 0)) * fx * 100) / 100;
  const nights = f.type === 'Hotel' && f.from_date && f.to_date ? Math.max(0, Math.round((Date.parse(f.to_date) - Date.parse(f.from_date)) / 86400000)) : 0;
  const sumP = alloc.reduce((s, a) => s + Number(f.allocation_basis === 'Amount' ? a.amount : a.percentage || 0), 0);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const upload = async (files) => { const fd = new FormData(); fd.append('files', files[0]); fd.append('mode', 'attach'); const r = await api('POST', `/expenses/${report.id}/receipts`, fd, { refresh: false }); if (r.ok) { set('receipt_file_id', r.data.files[0].id); setFileName(files[0].name); } };
  const save = async (again) => {
    setBusy(true); setErr('');
    const body = { ...f, amount: Number(f.amount), tax: Number(f.tax || 0), allocation: alloc.map((a) => ({ costObject: a.costObject, costObjectType: a.costObjectType, percentage: Number(a.percentage), amount: Number(a.amount) })), allocation_basis: f.allocation_basis };
    ['id', 'report_id', 'flags', 'total', 'total_inr', 'created_at', 'receipt_hash', 'fx_rate', 'fx_source', 'status', 'source', 'confidence'].forEach((k) => delete body[k]);
    const r = item ? await api('PATCH', `/expenses/${report.id}/items/${item.id}`, body, { silent: true }) : await api('POST', `/expenses/${report.id}/items`, body, { silent: true });
    setBusy(false); if (!r.ok) return setErr(r.error);
    if (again) { setF({ ...blank, city: f.city }); setFileName(''); } else onClose();
  };
  return (
    <Modal title={item ? 'Edit Expense Item' : 'Add Expense Item'} size="lg" onClose={onClose} footer={<><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn variant="outline" busy={busy} onClick={() => save(false)}>Save</Btn>{!item && <Btn busy={busy} icon="plus" onClick={() => save(true)}>Add & Save</Btn>}</>}>
      {err && <div className="err mb" role="alert">{err}</div>}
      <div className="main-side expense-item-layout">
        <div className="stack">
          <div className="section-bar" style={{ marginTop: 0 }}>Expense Details</div>
          <div className="form-grid fg4"><Field label="Expense Type" required><Select value={f.type} onChange={(e) => set('type', e.target.value)} options={EXPENSE_TYPES} /></Field><Field label="Vendor Name" required><Input value={f.vendor} onChange={(e) => set('vendor', e.target.value)} /></Field><Field label="City of Purchase" required><Input value={f.city} onChange={(e) => set('city', e.target.value)} /></Field><Field label="Transaction Date" required><Input type="date" value={f.txn_date || ''} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set('txn_date', e.target.value)} /></Field></div>
          {f.type === 'Hotel' && <div className="form-grid fg4"><Field label="From Date" required><Input type="date" value={f.from_date || ''} onChange={(e) => set('from_date', e.target.value)} /></Field><Field label="To Date" required><Input type="date" value={f.to_date || ''} onChange={(e) => set('to_date', e.target.value)} /></Field><Field label="No. of Nights"><Input className="ro" readOnly value={nights} /></Field><div style={{ alignSelf: 'end' }}><Btn variant="outline" icon="list" onClick={() => setItz(true)}>Itemization ({f.itemization.length})</Btn></div></div>}
          <div className="section-bar">Payment Details</div>
          <div className="form-grid fg4"><Field label="Payment Type" required><Select value={f.payment_type} onChange={(e) => set('payment_type', e.target.value)} options={['Employee Paid', 'Company Paid']} /></Field><Field label="Amount (Excl. Tax)" required><Input type="number" min="0" step="0.01" value={f.amount} onChange={(e) => set('amount', e.target.value)} /></Field><Field label="Tax Amount"><Input type="number" min="0" step="0.01" value={f.tax} onChange={(e) => set('tax', e.target.value)} /></Field><Field label="Currency" required><Select value={f.currency} onChange={(e) => set('currency', e.target.value)} options={currencies} /></Field></div>
          {f.currency !== 'INR' && <div className="note small">Converted at {fx} INR per {f.currency} (company rate table): total {inr(total)}</div>}
          <div className="section-bar">Cost Allocation <span style={{ float: 'right', fontWeight: 500 }}>Basis: <label className="chk"><input type="radio" checked={f.allocation_basis === 'Percentage'} onChange={() => set('allocation_basis', 'Percentage')} />Percentage (%)</label> <label className="chk"><input type="radio" checked={f.allocation_basis === 'Amount'} onChange={() => set('allocation_basis', 'Amount')} />Amount (INR)</label></span></div>
          <table className="tbl"><thead><tr><th>#</th><th>Cost Object</th><th>{f.allocation_basis === 'Amount' ? 'Amount (INR)' : 'Percentage (%)'}</th><th>Amount (INR)</th></tr></thead><tbody>{alloc.map((a, i) => <tr key={a.costObject}><td>{i + 1}</td><td>{a.costObject}</td><td><input className="in" style={{ width: 100 }} type="number" value={f.allocation_basis === 'Amount' ? a.amount : a.percentage} aria-label={`Allocation for ${a.costObject}`} onChange={(e) => setAlloc(alloc.map((x, j) => (j === i ? { ...x, [f.allocation_basis === 'Amount' ? 'amount' : 'percentage']: e.target.value } : x)))} /></td><td>{num2(f.allocation_basis === 'Amount' ? a.amount : (Number(a.percentage) / 100) * total)}</td></tr>)}</tbody><tfoot><tr><td colSpan={2} className="bold">Total</td><td className="bold" style={{ color: (f.allocation_basis === 'Amount' ? Math.abs(sumP - total) < .01 : Math.abs(sumP - 100) < .01) ? 'var(--green)' : 'var(--red)' }}>{f.allocation_basis === 'Amount' ? num2(sumP) : `${sumP} %`}</td><td className="bold">{num2(total)}</td></tr></tfoot></table>
          <div style={{ border: '1px solid var(--red)', borderRadius: 8, padding: 10 }}><Check checked={f.personal} onChange={(e) => set('personal', e.target.checked)}><b>Personal Expense (Do not reimburse)</b></Check><div className="small muted">Exclude this amount from employee reimbursement.</div></div>
          <Field label="Comment"><Textarea value={f.comment} maxLength={500} onChange={(e) => set('comment', e.target.value)} /><span className="small muted right">{(f.comment || '').length}/500</span></Field>
        </div>
        <div className="stack"><b>Attach Receipt {!f.personal && <span style={{ color: 'var(--red)' }}>*</span>}</b><FileDrop multiple={false} accept=".pdf,.jpg,.jpeg,.png" label="Drag receipt here or" hint="PDF, JPG, PNG (max 10 MB)" onFiles={upload} />{fileName && <div className="ok small"><Icon name="paperclip" size={13} /> {fileName}</div>}<div className="muted small">Physical receipt is mandatory as per policy and is checked when you submit.</div></div>
      </div>
      {itz && <Itemization f={f} nights={nights} onClose={() => setItz(false)} onSave={(rows) => { set('itemization', rows); setItz(false); }} />}
    </Modal>
  );
}
function Itemization({ f, nights, onClose, onSave }) {
  const start = f.from_date; const init = f.itemization.length ? f.itemization : Array.from({ length: Math.max(1, nights) }, (_, i) => ({ date: start ? new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10) : '', description: 'Room Charge', amount: Math.round((Number(f.amount || 0) / Math.max(1, nights)) * 100) / 100, tax: Math.round((Number(f.tax || 0) / Math.max(1, nights)) * 100) / 100 }));
  const [rows, setRows] = useState(init); const sa = rows.reduce((s, r) => s + Number(r.amount || 0), 0); const st = rows.reduce((s, r) => s + Number(r.tax || 0), 0);
  return <Modal title="Itemization (Day-wise Breakdown)" onClose={onClose} footer={<><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn onClick={() => onSave(rows.map((r) => ({ ...r, amount: Number(r.amount), tax: Number(r.tax) })))}>Save</Btn></>}>
    <table className="tbl"><thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Tax</th><th /></tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{['date', 'description', 'amount', 'tax'].map((k) => <td key={k}><input className="in" type={k === 'date' ? 'date' : k === 'description' ? 'text' : 'number'} value={r[k]} aria-label={k} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} /></td>)}<td><button className="icon-btn red" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove row"><Icon name="trash" size={14} /></button></td></tr>)}</tbody><tfoot><tr><td colSpan={2} className="bold">Total</td><td className="bold" style={{ color: Math.abs(sa - Number(f.amount)) <= 1 ? 'var(--green)' : 'var(--red)' }}>{num2(sa)}</td><td className="bold" style={{ color: Math.abs(st - Number(f.tax)) <= 1 ? 'var(--green)' : 'var(--red)' }}>{num2(st)}</td><td /></tr></tfoot></table>
    <Btn variant="outline" icon="plus" className="mt" onClick={() => setRows([...rows, { date: '', description: '', amount: 0, tax: 0 }])}>Add Itemization</Btn><div className="small muted mt-sm">Totals must match the item amount ({num2(f.amount)}) and tax ({num2(f.tax)}).</div></Modal>;
}

// ---------- Steps 2-4 ----------
export function ExpenseReportView({ user, data, step, autoUpload }) {
  const { report: r, items, calc, costObjects, trip, approvals, reimbursement, policyChecks, can, receipts } = data;
  const api = useApi(); const router = useRouter(); const nav = useNav();
  const [modal, setModal] = useState(null); const [sel, setSel] = useState([]); const [up, setUp] = useState(autoUpload ? { files: [] } : null); const [busy, setBusy] = useState(false);
  const [decl, setDecl] = useState(!!r.declaration); const [comment, setComment] = useState(r.comment || ''); const [err, setErr] = useState(''); const [prog, setProg] = useState(null);
  const editable = can.edit; const cur = !editable ? 'review' : step === 'review' ? 'review' : 'items';
  const steps = [['Report Header', 'done'], ['Expense Items', cur === 'items' ? 'current' : 'done'], ['Review & Submit', cur === 'review' ? (editable ? 'current' : 'done') : 'todo'], ['Confirmation', editable ? 'todo' : 'current']];
  const submit = async () => { setBusy(true); setErr(''); const x = await api('POST', `/expenses/${r.id}/submit`, { declaration: decl, comment }, { silent: true }); setBusy(false); if (!x.ok) return setErr(x.error); nav.set({ step: '' }, true); };
  const generate = async () => {
    setProg(['Extracting vendor information', 'Identifying expense category', 'Reading date, amount and tax', 'Creating expense line items']); const fd = new FormData(); up.files.forEach((f) => fd.append('files', f)); fd.append('mode', 'extract');
    const x = await api('POST', `/expenses/${r.id}/receipts`, fd, { silent: true }); setProg(null); if (!x.ok) return setErr(x.error); setUp(null); setErr('');
  };
  return (<>
    <div className="page-head"><div><Link href="/expenses" className="small">‹ Expenses</Link><h1>{editable ? (cur === 'items' ? 'Add Expense Items' : 'Review & Submit — Overall Expense Report') : r.report_no}</h1><p>{r.report_no} · {r.title} <Badge>{r.status}</Badge></p></div><div style={{ width: 'min(520px, 100%)' }} className="steps">{steps.map(([l, s], i) => <div key={l} className={`step ${s}`}><span className="c">{s === 'done' ? '✓' : i + 1}</span><span>{l}</span></div>)}</div></div>
    {r.return_reason && ['Returned for Correction', 'Rejected'].includes(r.status) && <div className="warn mb"><b>{r.status === 'Rejected' ? 'Rejected' : 'Returned for correction'}:</b> {r.return_reason}</div>}
    <Card className="mb"><div className="row wrap gap-lg">{[['Report No.', r.report_no], ['Category', r.category], ['Trip ID', trip?.trip_no || '-'], ['Traveller', `${data.owner.name}`], ['Travel Dates', range(r.start_date, r.end_date)], ['Destination', [r.dest_city, r.dest_country].filter(Boolean).join(', ') || '-']].map(([k, v]) => <div key={k}><div className="small muted">{k}</div><b>{v}</b></div>)}</div></Card>
    {cur === 'items' && (<>
      <div className="grid g3 mb">{[['Bulk Upload Receipts', 'upload', 'Upload multiple receipts and let AI extract expense details into draft line items.', ['Supports PDF, JPG, PNG (Max 10 MB each)', 'Automatically extracts key details (date, amount, vendor)', 'Creates multiple expense items in draft'], 'Upload Receipts', () => setUp({ files: [] })], ['Upload Receipt', 'file', 'Add one receipt and extract details for a single expense item.', ['Supports PDF, JPG, PNG (Max 10 MB)', 'Extracts details automatically', 'Ideal for adding individual receipts'], 'Upload Single Receipt', () => setUp({ files: [], single: true })], ['Manually Add Expense', 'edit', 'Enter expense item from scratch, one at a time.', ['Select expense type and enter details', 'Attach receipt (optional)', 'Full control over all fields'], 'Add Expense Manually', () => setModal({})]].map(([t, i, d, bl, btn, fn], idx) => (
        <div key={t} className={`opt-card ${idx === 0 ? 'on' : ''}`} style={{ textAlign: 'left' }}><div className="center"><span className="ico-box soft" style={{ width: 52, height: 52, borderRadius: '50%' }}><Icon name={i} size={24} /></span><h3 style={{ marginTop: 8 }}>{t}</h3><div className="small muted mb">{d}</div></div>{bl.map((b) => <div key={b} className="small row"><Icon name="checkCircle" size={14} style={{ color: 'var(--green)' }} />{b}</div>)}<div className="mt"><Btn variant={idx === 0 ? '' : 'outline'} onClick={fn} style={{ width: '100%', justifyContent: 'center' }}>{btn}</Btn></div></div>))}</div>
      {err && <div className="err mb" role="alert">{err}</div>}
      <Card title="Extracted / Added Expense Items" icon="list" sub={`${items.length} item(s) · ${calc.needsReview} need review`} actions={<><Btn variant="outline" icon="plus" onClick={() => setModal({})}>Add Expense Manually</Btn><Btn variant="outline" icon="upload" onClick={() => setUp({ files: [] })}>Upload More</Btn></>} body={false}>
        <DataTable rows={items} selectable selected={sel} onSelect={setSel} empty="No expense items yet. Upload receipts or add an item manually." columns={[
          { key: 'type', label: 'Expense Type', render: (i) => <span className="row gap-sm"><Icon name={T_ICON[i.type] || 'file'} size={16} style={{ color: 'var(--blue)' }} />{i.type}</span> }, { key: 'txn_date', label: 'Transaction Date', render: (i) => (i.type === 'Hotel' && i.from_date ? `${fdate(i.from_date)} - ${fdate(i.to_date)}` : fdate(i.txn_date)) }, { key: 'vendor', label: 'Vendor Name' },
          { key: 'total_inr', label: 'Amount (INR)', align: 'right', render: (i) => <b>{num2(i.total_inr)}</b> }, { key: 'payment_type', label: 'Payment Type', render: (i) => (i.personal ? 'Personal' : i.payment_type) },
          { key: 'receipt', label: 'Receipt', render: (i) => (i.receipt_file_id ? <a href={`/api/files/${i.receipt_file_id}`} aria-label="Open receipt"><Icon name="paperclip" size={15} /></a> : <Badge tone="red">Missing</Badge>) }, { key: 'comment', label: 'Comment' },
          { key: 'status', label: 'Status', render: (i) => <span title={(i.flags || []).join('; ')}><Badge>{i.status}</Badge></span> },
          { key: 'a', label: 'Action', render: (i) => <span className="row gap-sm"><button className="icon-btn" onClick={() => setModal(i)} aria-label="Edit item"><Icon name="edit" size={16} /></button><button className="icon-btn red" aria-label="Delete item" onClick={async () => { await api('POST', `/expenses/${r.id}/items/delete`, { ids: [i.id] }, { success: 'Item deleted' }); }}><Icon name="trash" size={16} /></button></span> },
        ]} />
        <div className="row between" style={{ padding: 14, background: '#f7faff' }}><Btn variant="danger" icon="trash" disabled={!sel.length} onClick={async () => { await api('POST', `/expenses/${r.id}/items/delete`, { ids: sel }, { success: 'Items deleted' }); setSel([]); }}>Delete Selected</Btn><div className="row gap-lg"><span>Total Amount (INR) <b style={{ fontSize: 17 }}>{inr(calc.gross)}</b></span><span>Valid Items <b>{items.length - calc.needsReview}</b></span><span style={{ color: 'var(--orange)' }}>Needs Review <b>{calc.needsReview}</b></span></div></div>
      </Card>
      <div className="row between mt"><Link href="/expenses/new" className="btn outline">← Back</Link><Btn disabled={!items.length} onClick={() => nav.set({ step: 'review' }, true)}>Next: Review & Submit →</Btn></div>
    </>)}
    {cur === 'review' && (<>
      <div className="grid g6 mb">{[['Total Expense Items', calc.count, 'list', 'blue'], ['Amount Excl. Tax', inr(calc.excl), 'rupee', 'blue'], ['Total Tax', inr(calc.tax), 'file', 'blue'], ['Gross Claim Amount', inr(calc.gross), 'card', 'blue'], ['Travel Advance', inr(calc.advance), 'rupee', 'orange'], ['Company-Paid', inr(calc.company), 'building', 'purple']].map(([l, v, i, t]) => <Stat key={l} icon={i} tone={t} value={v} label={l} />)}</div>
      <div className="grid g3 mb"><Stat icon="user" tone="red" value={inr(calc.personal)} label="Personal / Non-Reimbursable" /><Stat icon="rupee" tone="green" value={inr(calc.estimatedReimbursement)} label="Estimated Reimbursement" sub={`(Gross ${inr(calc.reimbursable)} − Advance ${inr(calc.advance)})`} />{calc.advanceRecoverable > 0 && <Stat icon="alert" tone="orange" value={inr(calc.advanceRecoverable)} label="Advance to be recovered" />}</div>
      <div className="main-side" style={{ '--side-width': '300px' }}>
        <Card title={`Expense Items (${items.length})`} icon="list" body={false}><DataTable rows={items} dense columns={[{ key: 'n', label: '#', render: (_, i) => i + 1 }, { key: 'type', label: 'Expense Type' }, { key: 'txn_date', label: 'Date', render: (i) => fdate(i.txn_date) }, { key: 'vendor', label: 'Vendor' }, { key: 'payment_type', label: 'Payment' }, { key: 'amount', label: 'Excl. Tax', align: 'right', render: (i) => num2(i.amount * i.fx_rate) }, { key: 'tax', label: 'Tax', align: 'right', render: (i) => num2(i.tax * i.fx_rate) }, { key: 'total', label: 'Total', align: 'right', render: (i) => <b>{num2(i.total_inr)}</b> }, { key: 'r', label: 'Receipt Status', render: (i) => (i.receipt_file_id ? <Badge tone={i.status === 'Needs Review' ? 'orange' : 'green'}>{i.status === 'Needs Review' ? 'Needs Review' : 'Attached'}</Badge> : <Badge tone="red">Missing</Badge>) }]} /></Card>
        <Card title="Overall PDF Preview" icon="file"><div className="small">The generated PDF includes:</div>{['Report header and travel details', 'All expense items with amounts and tax', 'Cost allocation summary', 'Receipt attachment index', 'Travel allowance information', 'Policy check summary', 'Approval and finance sign-off fields', 'Audit and report metadata'].map((x) => <div key={x} className="small row" style={{ padding: '2px 0' }}><Icon name="checkCircle" size={13} style={{ color: 'var(--blue)' }} />{x}</div>)}<a className="btn outline mt" href={`/api/expenses/${r.id}/pdf`} target="_blank" rel="noreferrer"><Icon name="eye" size={15} />Preview Overall PDF</a></Card>
      </div>
      <div className="grid g4 mt">
        <Card title="Cost Allocation Summary" icon="list" body={false}><DataTable rows={costObjects} dense columns={[{ key: 'type', label: 'Type' }, { key: 'cost_object', label: 'Cost Object' }, { key: 'percentage', label: '%', render: (c) => `${c.percentage}%` }, { key: 'amt', label: 'Amount', align: 'right', render: (c) => num2((calc.gross * c.percentage) / 100) }]} /></Card>
        <Card title="Travel Allowance" icon="plane"><div className="center"><div className="num" style={{ fontSize: 24, fontWeight: 800 }}>{r.travel_allowance ? 'Yes' : 'No'}</div><div className="small muted">Required</div></div></Card>
        <Card title="Receipt Compliance" icon="receipt"><b>{policyChecks.verified} of {policyChecks.receiptsTotal}</b><div className="small muted">items verified · {policyChecks.receiptsAttached} receipt(s) attached</div></Card>
        <Card title="Policy Checks" icon="shield"><b style={{ color: policyChecks.needsReview ? 'var(--orange)' : 'var(--green)' }}>{policyChecks.needsReview} item(s)</b><div className="small muted">need review</div>{items.filter((i) => i.flags?.length).slice(0, 3).map((i) => <div key={i.id} className="small" style={{ color: 'var(--orange)' }}>{i.vendor}: {i.flags[0]}</div>)}</Card>
      </div>
      {editable ? (<Card className="mt" title="Comments & Declaration" icon="edit"><Field label="Overall Report Comment"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} /></Field><div className="mt"><Check checked={decl} onChange={(e) => setDecl(e.target.checked)}>I certify that these expenses were incurred for official business and all details are accurate.</Check></div>{err && <div className="err mt" role="alert">{err}</div>}
        <div className="row between mt"><Btn variant="outline" onClick={() => nav.set({ step: 'items' }, true)}>← Back to Expense Items</Btn><div className="row"><Link href="/expenses" className="btn outline"><Icon name="file" size={15} />Save as Draft</Link><Btn busy={busy} icon="send" disabled={!decl} onClick={submit}>Submit for Approval</Btn></div></div></Card>)
        : (<div className="grid g2 mt"><Card title="Approval Status" icon="users"><div className="vsteps">{approvals.map((a) => <div key={a.id} className={`vs ${a.status === 'Approved' ? 'done' : a.status === 'Pending' ? 'cur' : a.status === 'Rejected' ? 'bad' : ''}`}><span className="c">{a.level}</span><div><b>{a.label}</b> <Badge>{a.status}</Badge><div className="small muted">{a.approver_name || a.approver_role}{a.comment ? ` — “${a.comment}”` : ''}</div></div></div>)}{approvals.length === 0 && <div className="muted">Not submitted yet.</div>}</div></Card>
          <Card title="Reimbursement" icon="rupee">{reimbursement ? <Kv rows={[['Status', <Badge key="s">{reimbursement.status}</Badge>], ['Payable', inr(reimbursement.payable_amount)], ['Payment Ref.', reimbursement.payment_ref], ['Paid On', fdt(reimbursement.paid_at)], ['Failure Reason', reimbursement.failure_reason]]} /> : <div className="muted">Reimbursement is created after finance approval.</div>}</Card></div>)}
    </>)}
    {modal && <ItemModal report={r} item={modal.id ? modal : null} costObjects={costObjects} currencies={data.currencies} onClose={() => setModal(null)} />}
    {up && <Modal title="Upload Documents / Generate with AI" onClose={() => { setUp(null); setProg(null); }} footer={<><Btn variant="outline" onClick={() => setUp(null)}>Cancel</Btn><Btn busy={!!prog} disabled={!up.files.length} onClick={generate}>Generate My Expense Report</Btn></>}>
      <FileDrop multiple={!up.single} accept=".pdf,.jpg,.jpeg,.png" label="Drag and drop receipts here or" hint="Supported files: PDF, JPG, PNG (Max 10 MB each)" onFiles={(x) => setUp({ ...up, files: up.single ? x.slice(0, 1) : [...up.files, ...x] })} />
      {up.files.length > 0 && <div className="mt"><b>Uploaded Documents ({up.files.length})</b>{up.files.map((f, i) => <div key={i} className="row between small" style={{ padding: '4px 0' }}><span><Icon name="file" size={14} /> {f.name} <span className="muted">{Math.round(f.size / 1024)} KB</span></span><button className="icon-btn red" onClick={() => setUp({ ...up, files: up.files.filter((_, j) => j !== i) })} aria-label="Remove file"><Icon name="trash" size={14} /></button></div>)}</div>}
      {prog && <div className="note mt"><b>AI is reading your documents…</b>{prog.map((p) => <div key={p} className="small">• {p}</div>)}</div>}
      {err && <div className="err mt" role="alert">{err}</div>}</Modal>}
    <span hidden>{router && receipts.length}{user.id}</span>
  </>);
}
export { Confirm, Switch };
