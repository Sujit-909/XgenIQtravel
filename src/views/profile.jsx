'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { Card, PageHead, Stat, Badge, Icon, DataTable, Btn, Modal, Field, Input, Select, Textarea, Check, Switch, useApi, useNav, Tabs, Kv, Pills, Avatar, Empty, Confirm } from '@/components/ui';
import { fdate, fdt, inr } from '@/lib/format';

const DOC_TYPES = ['Passport', 'Visa', 'PAN Card', 'Aadhaar Card', 'Driving License', 'Work Permit', 'Other'];
const SCHEMAS = {
  documents: { title: 'Document', fields: [['doc_type', 'Document Type', 'select', DOC_TYPES, true], ['title', 'Title / Description'], ['doc_number', 'Document Number', 'text', null, true], ['issue_date', 'Issue Date', 'date'], ['expiry_date', 'Expiry Date', 'date'], ['country', 'Country']] },
  'payment-methods': { title: 'Payment Method', fields: [['kind', 'Type', 'select', [['corporate_card', 'Corporate Card'], ['personal_card', 'Personal Card'], ['upi', 'UPI / Wallet']], true], ['brand', 'Network / Brand'], ['label', 'Name', 'text', null, true], ['card_number', 'Card number (only the last 4 digits are stored)'], ['last4', 'Last 4 digits'], ['holder', 'Cardholder Name'], ['valid_thru', 'Valid Thru (MM/YY)'], ['handle', 'UPI ID']] },
  'bank-accounts': { title: 'Reimbursement Account', fields: [['bank', 'Bank Name', 'text', null, true], ['account_type', 'Account Type', 'select', ['Savings Account', 'Current Account'], true], ['holder', 'Account Holder Name', 'text', null, true], ['account_number', 'Account Number', 'text', null, true], ['ifsc', 'IFSC Code', 'text', null, true]] },
  'emergency-contacts': { title: 'Emergency Contact', fields: [['name', 'Name', 'text', null, true], ['relationship', 'Relationship', 'text', null, true], ['phone', 'Phone Number', 'text', null, true], ['email', 'Email'], ['is_primary', 'Primary contact', 'check']] },
  'family-members': { title: 'Family Member', fields: [['name', 'Name', 'text', null, true], ['relationship', 'Relationship', 'text', null, true], ['dob', 'Date of Birth', 'date'], ['gender', 'Gender', 'select', ['Male', 'Female', 'Other']], ['special_assistance', 'Special Assistance Needed']] },
  addresses: { title: 'Address', fields: [['kind', 'Address Type', 'select', ['Current', 'Permanent', 'Office', 'Other'], true], ['line', 'Address', 'textarea', null, true], ['city', 'City', 'text', null, true], ['state', 'State', 'text', null, true], ['pin', 'PIN Code'], ['country', 'Country', 'text', null, true], ['is_default', 'Set as default', 'check']] },
  'loyalty-programs': { title: 'Loyalty Program', fields: [['category', 'Category', 'select', [['airline', 'Airline'], ['hotel', 'Hotel'], ['car', 'Car Rental'], ['other', 'Other']], true], ['provider', 'Provider', 'text', null, true], ['program', 'Program Name', 'text', null, true], ['membership_no', 'Membership Number', 'text', null, true], ['tier', 'Tier / Status'], ['expiry_date', 'Expiry Date', 'date'], ['rank', 'Primary / Secondary label']] },
};
const INITIAL = { documents: { doc_type: 'Passport' }, 'payment-methods': { kind: 'personal_card' }, 'bank-accounts': { account_type: 'Savings Account' }, 'emergency-contacts': {}, 'family-members': {}, addresses: { kind: 'Current', country: 'India' }, 'loyalty-programs': { category: 'airline' } };

export function EntityModal({ entity, item, onClose }) {
  const api = useApi(); const sc = SCHEMAS[entity];
  const [f, setF] = useState(item ? { ...item } : { ...INITIAL[entity] }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const visible = sc.fields.filter(([k]) => !(entity === 'bank-accounts' && item && k === 'account_number') && !(entity === 'payment-methods' && ((f.kind === 'upi' && ['brand', 'card_number', 'last4', 'holder', 'valid_thru'].includes(k)) || (f.kind !== 'upi' && k === 'handle') || (item && k === 'card_number'))));
  const save = async () => {
    setBusy(true); setErr(''); const body = {}; for (const [k] of visible) if (f[k] !== undefined && f[k] !== '') body[k] = f[k]; if (entity === 'bank-accounts' && item) delete body.account_number;
    const r = item ? await api('PATCH', `/profile/${entity}/${item.id}`, body, { silent: true, success: 'Saved' }) : await api('POST', `/profile/${entity}`, body, { silent: true, success: 'Added' }); setBusy(false);
    if (!r.ok) return setErr(r.error); onClose();
  };
  return <Modal title={`${item ? 'Edit' : 'Add'} ${sc.title}`} size="sm" onClose={onClose} footer={<><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn busy={busy} onClick={save}>Save</Btn></>}>
    <div className="stack">{visible.map(([k, label, type = 'text', opts, req]) => (type === 'check' ? <Check key={k} checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })}>{label}</Check> : <Field key={k} label={label} required={req}>{type === 'select' ? <Select value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} options={opts} placeholder="Select" /> : type === 'textarea' ? <Textarea value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /> : <Input type={type} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} autoComplete="off" />}</Field>))}
      {entity === 'payment-methods' && <div className="note small">For your security CVV / security codes are never accepted or stored.</div>}{err && <div className="err" role="alert">{err}</div>}</div></Modal>;
}
function RowActions({ entity, item, extra }) {
  const api = useApi(); const [edit, setEdit] = useState(false); const [del, setDel] = useState(false);
  return <span className="row gap-sm">{extra}<button className="icon-btn" onClick={() => setEdit(true)} aria-label="Edit"><Icon name="edit" size={16} /></button><button className="icon-btn red" onClick={() => setDel(true)} aria-label="Delete"><Icon name="trash" size={16} /></button>
    {edit && <EntityModal entity={entity} item={item} onClose={() => setEdit(false)} />}{del && <Confirm title="Delete record" danger confirmLabel="Delete" text="This cannot be undone." onClose={() => setDel(false)} onConfirm={async () => { const r = await api('DELETE', `/profile/${entity}/${item.id}`, undefined, { success: 'Deleted' }); if (r.ok) setDel(false); }} />}</span>;
}
function AddBtn({ entity, label }) { const [o, setO] = useState(false); return <><Btn icon="plus" onClick={() => setO(true)}>{label}</Btn>{o && <EntityModal entity={entity} onClose={() => setO(false)} />}</>; }
const docIcon = (t) => ({ Passport: 'globe', Visa: 'globe', 'PAN Card': 'card', 'Aadhaar Card': 'user', 'Driving License': 'car', 'Work Permit': 'briefcase' }[t] || 'file');
const catLabel = { airline: 'Airline Loyalty Programs', hotel: 'Hotel Loyalty Programs', car: 'Car Rental Loyalty Programs', other: 'Other Loyalty Programs' };
const catIcon = { airline: 'plane', hotel: 'building', car: 'car', other: 'gift' };

// ---------- Standalone: Travel Documents ----------
export function DocumentsView({ docs }) {
  const [f, setF] = useState('all'); const [q, setQ] = useState('');
  const match = (d) => (!q || `${d.doc_type} ${d.doc_number} ${d.title}`.toLowerCase().includes(q.toLowerCase()));
  const groups = [['Active Documents', 'green', 'checkCircle', docs.filter((d) => ['Valid', 'Verified'].includes(d.status) && match(d)), 'active'], ['Expiring Soon', 'orange', 'clock', docs.filter((d) => d.status === 'Expiring Soon' && match(d)), 'soon'], ['Expired Documents', 'red', 'x', docs.filter((d) => d.status === 'Expired' && match(d)), 'expired']];
  const n = (s) => docs.filter((d) => (s === 'active' ? ['Valid', 'Verified'].includes(d.status) : s === 'soon' ? d.status === 'Expiring Soon' : d.status === 'Expired')).length;
  return (<>
    <PageHead title="Travel Documents" sub="Manage your travel documents for official travel" actions={<AddBtn entity="documents" label="Add Documents" />} />
    <div className="row wrap mb"><Pills value={f} onChange={setF} items={[{ key: 'all', label: 'All Documents', count: docs.length }, { key: 'active', label: 'Active', count: n('active') }, { key: 'soon', label: 'Expiring Soon', count: n('soon') }, { key: 'expired', label: 'Expired', count: n('expired') }]} /><div className="grow" /><div className="search" style={{ maxWidth: 260 }}><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents..." aria-label="Search documents" /></div></div>
    {groups.filter(([, , , , k]) => f === 'all' || f === k).map(([title, tone, ic, rows]) => (
      <div key={title} className="mb"><div className={`group-bar ${tone === 'green' ? 'gb-green' : tone === 'orange' ? 'gb-orange' : 'gb-red'}`}><Icon name={ic} size={18} />{title} ({rows.length})</div>
        <Card body={false}><DataTable rows={rows} empty={`No ${title.toLowerCase()}.`} columns={[{ key: 'n', label: '#', render: (_, i) => i + 1 }, { key: 'doc_type', label: 'Document Type', render: (d) => <span className="row"><span className="ico-box soft"><Icon name={docIcon(d.doc_type)} size={15} /></span><span><b>{d.doc_type === 'Visa' ? d.title || 'Visa' : d.doc_type}</b><div className="small muted">{d.doc_type === 'Visa' ? d.country : d.title}</div></span></span> }, { key: 'doc_number', label: 'Document Number' }, { key: 'issue_date', label: 'Issue Date', render: (d) => fdate(d.issue_date) }, { key: 'expiry_date', label: 'Expiry Date', render: (d) => (d.expiry_date ? <span style={{ color: d.status === 'Valid' ? undefined : 'var(--red)' }}>{fdate(d.expiry_date)}</span> : '-') }, { key: 'status', label: 'Status', render: (d) => <Badge>{d.status}</Badge> }, { key: 'a', label: 'Action', render: (d) => <RowActions entity="documents" item={d} /> }]} /></Card></div>))}
    <div className="note"><b>Note:</b> PAN Card and Aadhaar Card do not have an expiry date and will not appear in expiry alerts.</div>
  </>);
}

// ---------- Standalone: Reimbursement Accounts ----------
export function ReimbAccountsView({ accounts, user }) {
  const api = useApi(); const [shown, setShown] = useState({}); const [f, setF] = useState('all'); const [q, setQ] = useState('');
  const reveal = async (a) => { if (shown[a.id]) return setShown({ ...shown, [a.id]: null }); const r = await api('POST', `/profile/bank-accounts/${a.id}/reveal`, {}, { refresh: false }); if (r.ok) { setShown({ ...shown, [a.id]: r.data.account_number }); setTimeout(() => setShown((s) => ({ ...s, [a.id]: null })), 15000); } };
  const match = (a) => !q || `${a.bank} ${a.holder} ${a.ifsc}`.toLowerCase().includes(q.toLowerCase());
  const active = accounts.filter((a) => a.active && match(a)); const inactive = accounts.filter((a) => !a.active && match(a));
  const cols = (isActive) => [{ key: 'n', label: '#', render: (_, i) => i + 1 }, { key: 'account_type', label: 'Account Type', render: (a) => <span className="row"><span className="ico-box soft"><Icon name="building" size={15} /></span>{a.account_type}</span> }, { key: 'holder', label: 'Account Holder Name' }, { key: 'bank', label: 'Bank Name' },
    { key: 'acc', label: 'Account Number', render: (a) => <span className="row gap-sm"><span style={{ fontFamily: 'monospace' }}>{shown[a.id] || a.account_masked}</span><button className="icon-btn" onClick={() => reveal(a)} aria-label={shown[a.id] ? 'Hide account number' : 'Show account number'}><Icon name="eye" size={15} /></button></span> }, { key: 'ifsc', label: 'IFSC Code' },
    { key: 'v', label: 'Verification Status', render: (a) => <Badge tone={a.verified ? 'green' : 'orange'}>{a.verified ? 'Verified' : 'Pending Verification'}</Badge> },
    { key: 'd', label: 'Default', render: (a) => (a.is_default ? <Badge tone="blue">Default</Badge> : isActive ? <Btn variant="outline" className="sm" onClick={() => api('PATCH', `/profile/bank-accounts/${a.id}`, { is_default: true }, { success: 'Default account updated' })}>Set Default</Btn> : '-') },
    { key: 'a', label: 'Action', render: (a) => <span className="row gap-sm"><RowActions entity="bank-accounts" item={a} extra={<button className="icon-btn" aria-label={isActive ? 'Deactivate' : 'Activate'} onClick={() => api('PATCH', `/profile/bank-accounts/${a.id}`, { active: !a.active }, { success: a.active ? 'Account deactivated' : 'Account activated' })}><Icon name={isActive ? 'power' : 'play'} size={16} /></button>} />{['finance', 'admin'].includes(user.role) && !a.verified && <Btn className="sm" variant="outline" onClick={() => api('POST', `/profile/bank-accounts/${a.id}/verify`, {})}>Verify</Btn>}</span> }];
  return (<>
    <PageHead title="Reimbursement Accounts" sub="Manage accounts used for approved reimbursements" actions={<AddBtn entity="bank-accounts" label="Add Account" />} />
    <div className="row wrap mb"><Pills value={f} onChange={setF} items={[{ key: 'all', label: 'All Accounts', count: accounts.length }, { key: 'active', label: 'Active', count: accounts.filter((a) => a.active).length }, { key: 'inactive', label: 'Inactive', count: accounts.filter((a) => !a.active).length }]} /><div className="grow" /><div className="search" style={{ maxWidth: 260 }}><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts..." aria-label="Search accounts" /></div></div>
    {(f === 'all' || f === 'active') && <div className="mb"><div className="group-bar gb-green"><Icon name="checkCircle" size={18} />Active Accounts ({active.length})</div><Card body={false}><DataTable rows={active} empty="No active accounts." columns={cols(true)} /></Card></div>}
    {(f === 'all' || f === 'inactive') && <div><div className="group-bar gb-gray"><Icon name="x" size={18} />Inactive Accounts ({inactive.length})</div><Card body={false}><DataTable rows={inactive} empty="No inactive accounts." columns={cols(false)} /></Card></div>}
    <div className="note mt">Account numbers are encrypted at rest and masked everywhere. Reimbursements are paid only to a <b>verified, active, default</b> account.</div>
  </>);
}

// ---------- Standalone: Loyalty ----------
export function LoyaltyView({ items }) {
  const [f, setF] = useState('all'); const [q, setQ] = useState('');
  const m = (l) => !q || `${l.provider} ${l.program} ${l.membership_no}`.toLowerCase().includes(q.toLowerCase());
  const st = (s) => items.filter((l) => l.status === s).length;
  const tone = { airline: 'gb-blue', hotel: 'gb-green', car: 'gb-orange', other: 'gb-purple' };
  return (<>
    <PageHead title="Loyalty Programs" sub="Manage your travel loyalty memberships to earn and redeem benefits" actions={<AddBtn entity="loyalty-programs" label="Add Loyalty Program" />} />
    <div className="row wrap mb"><Pills value={f} onChange={setF} items={[{ key: 'all', label: 'All Programs', count: items.length }, { key: 'Valid', label: 'Active', count: st('Valid') }, { key: 'Expiring Soon', label: 'Expiring Soon', count: st('Expiring Soon') }, { key: 'Expired', label: 'Expired', count: st('Expired') }]} /><div className="grow" /><div className="search" style={{ maxWidth: 260 }}><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search loyalty programs..." aria-label="Search loyalty programs" /></div></div>
    {['airline', 'hotel', 'car', 'other'].map((c) => { const rows = items.filter((l) => l.category === c && m(l) && (f === 'all' || l.status === f)); return (
      <div key={c} className="mb"><div className={`group-bar ${tone[c]}`}><Icon name={catIcon[c]} size={18} />{catLabel[c]} ({rows.length})</div><Card body={false}><DataTable rows={rows} empty="No programs." columns={[{ key: 'n', label: '#', render: (_, i) => i + 1 }, { key: 'provider', label: c === 'airline' ? 'Airline' : c === 'hotel' ? 'Hotel Chain' : c === 'car' ? 'Car Rental' : 'Program', render: (l) => <b>{l.provider}</b> }, { key: 'program', label: 'Program Name' }, { key: 'membership_no', label: 'Membership Number' }, { key: 'tier', label: 'Tier / Status', render: (l) => l.tier || '-' }, { key: 'rank', label: 'Primary', render: (l) => l.rank || '-' }, { key: 'expiry_date', label: 'Expiry Date', render: (l) => fdate(l.expiry_date) }, { key: 'status', label: 'Status', render: (l) => <Badge tone={l.status === 'Valid' ? 'green' : undefined}>{l.status === 'Valid' ? 'Active' : l.status}</Badge> }, { key: 'a', label: 'Action', render: (l) => <RowActions entity="loyalty-programs" item={l} /> }]} /></Card></div>); })}
    <div className="note"><b>Note:</b> Link your loyalty accounts to get membership benefits during bookings. Set a primary airline and hotel to apply benefits automatically. Details are used only for booking purposes.</div>
  </>);
}

// ---------- Notifications ----------
export function AlertSettings({ settings }) {
  const api = useApi(); const [s, setS] = useState(settings); const [busy, setBusy] = useState(false);
  const rows = [['Passport', 'globe'], ['Visa', 'globe'], ['Driving License', 'car'], ['Work Permit', 'briefcase'], ['Other Documents', 'file']];
  const ch = [['inApp', 'In-App Notification', 'bell'], ['email', 'Email Notification', 'mail'], ['push', 'Mobile Push Notification (if app installed)', 'phone'], ['whatsapp', 'WhatsApp Notification', 'send'], ['teams', 'Microsoft Teams Notification', 'users']];
  const save = async () => { setBusy(true); await api('PUT', '/profile/notification-settings', s, { success: 'Alert settings saved' }); setBusy(false); };
  return (
    <Card title="Alert Settings (Employee)" icon="settings" sub="Get notified before your important travel documents expire." actions={<Btn busy={busy} onClick={save}>Save Settings</Btn>}>
      <h3>Notify me before expiry</h3>{rows.map(([k, i]) => <div key={k} className="row" style={{ padding: '8px 0', borderBottom: '1px solid #eef2fa' }}><input type="checkbox" checked={!!s.expiry[k]?.on} onChange={(e) => setS({ ...s, expiry: { ...s.expiry, [k]: { ...s.expiry[k], on: e.target.checked } } })} aria-label={`Alert for ${k}`} /><Icon name={i} size={18} style={{ color: 'var(--blue)' }} /><span className="grow">{k}</span><input className="in" type="number" min="1" max="365" style={{ width: 80 }} value={s.expiry[k]?.days ?? 30} aria-label={`${k} days before`} onChange={(e) => setS({ ...s, expiry: { ...s.expiry, [k]: { ...s.expiry[k], days: Number(e.target.value) } } })} /><span className="muted">days before</span></div>)}
      <div className="err mt">Aadhaar Card and PAN Card are not included in expiry alerts as they do not have a validity period.</div>
      <h3 className="mt">Notification Channels</h3><div className="small muted mb">Choose how you want to receive alerts and reminders.</div>
      {ch.map(([k, l, i]) => <div key={k} className="row" style={{ padding: '8px 0', borderBottom: '1px solid #eef2fa' }}><input type="checkbox" checked={!!s.channels[k]} onChange={(e) => setS({ ...s, channels: { ...s.channels, [k]: e.target.checked } })} aria-label={l} /><Icon name={i} size={18} style={{ color: 'var(--blue)' }} /><span>{l}</span></div>)}
      <div className="note small mt">In-app alerts are active. Email, push, WhatsApp and Teams delivery need the matching gateway to be connected by your administrator.</div>
    </Card>
  );
}
export function NotificationsView({ data, settings, category }) {
  const api = useApi(); const nav = useNav(); const c = data.counts;
  const icon = { expiry: 'alert', approval: 'checkCircle', other: 'info' };
  return (<>
    <PageHead title="Notifications" sub="Document expiry alerts, approvals and travel updates" />
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <AlertSettings settings={settings} />
      <Card title={`Recent Notifications (${data.rows.length})`} icon="bell" actions={<a href="#" onClick={async (e) => { e.preventDefault(); await api('POST', '/notifications/read', {}); }}>Mark All as Read</a>}>
        <Tabs value={category || 'all'} onChange={(t) => nav.set({ category: t === 'all' ? '' : t })} tabs={[{ key: 'all', label: `All (${c.all})` }, { key: 'expiry', label: `Expiry Alerts (${c.expiry})` }, { key: 'approval', label: `Approvals (${c.approval})` }, { key: 'other', label: `Others (${c.other})` }]} />
        {data.rows.length === 0 && <Empty>No notifications.</Empty>}
        {data.rows.map((n) => <div key={n.id} className="row" style={{ alignItems: 'flex-start', padding: '10px 6px', borderBottom: '1px solid #eef2fa', background: n.is_read ? '#f7f9fd' : undefined }}><span className="ico-box" style={{ background: n.severity === 'danger' ? 'var(--red-bg)' : 'var(--blue-l)', color: n.severity === 'danger' ? 'var(--red)' : 'var(--blue)', borderRadius: '50%' }}><Icon name={icon[n.category]} size={17} /></span>
          <div className="grow"><div className="bold" style={{ color: 'var(--navy)' }}>{n.link ? <Link href={n.link} onClick={() => api('POST', '/notifications/read', { id: n.id }, { refresh: false })}>{n.title}</Link> : n.title}</div><div className="small">{n.body}</div></div><div className="right small muted"><div>{fdt(n.created_at)}</div>{n.is_read ? <Badge tone="gray">Read</Badge> : <button className="badge t-red" style={{ border: 0 }} onClick={() => api('POST', '/notifications/read', { id: n.id })}>Unread</button>}</div></div>)}
      </Card>
    </div>
  </>);
}

// ---------- My Profile ----------
const PREF = { classes: ['Economy', 'Premium Economy', 'Business'], seats: ['Window', 'Aisle', 'No preference'], meals: ['Vegetarian', 'Non-vegetarian', 'Vegan', 'No preference'], hotel: ['Budget', '3 Star / Business', '4 Star', '5 Star'], rooms: ['Non-smoking room', 'Smoking room', 'No preference'], ground: ['Company Cab', 'Local Taxi', 'Rental Cab', 'Public transport'], airlines: ['IndiGo', 'Air India', 'Vistara', 'SpiceJet', 'Singapore Airlines', 'Emirates'], special: ['Wheelchair assistance', 'Extra baggage allowance', 'Medical assistance', 'Prefer morning flight', 'Connect to Wi-Fi in hotel'] };
function PersonalTab({ u, manager }) {
  const [edit, setEdit] = useState(false);
  return (<><Card title="Personal Information" icon="user" sub="View and manage your personal details." actions={<Btn icon="edit" onClick={() => setEdit(true)}>Edit</Btn>}>
    <div className="row" style={{ alignItems: 'flex-start', gap: 28 }}><div className="center"><Avatar name={u.name} size="lg" /><div className="small muted mt">JPG, PNG (Max 2 MB)</div></div>
      <div className="grow grid g2">{[['Full Name', u.name], ['Blood Group', u.blood_group], ['Employee ID', u.emp_id], ['Department', u.department], ['Date of Birth', u.dob ? `${fdate(u.dob)} (${Math.floor((Date.now() - Date.parse(u.dob)) / 31557600000)} years)` : '-'], ['Designation', u.designation], ['Gender', u.gender], ['Work Email', u.email], ['Nationality', u.nationality], ['Work Phone', u.phone], ['Reporting Manager', manager || '-'], ['Grade', u.grade]].map(([k, v]) => <Field key={k} label={k}><Input className="ro" readOnly value={v || ''} /></Field>)}</div></div></Card>
    <Card className="mt" title="Other Information" icon="shield"><div className="grid g2"><Kv rows={[['Marital Status', u.marital_status], ['Dependent Family Members', 'See Emergency & Family'], ['Medical Conditions', u.medical_conditions]]} /><Kv rows={[['Allergies', u.allergies], ['Special Notes', u.special_notes]]} /></div></Card>
    {edit && <PersonalModal u={u} onClose={() => setEdit(false)} />}</>);
}
function PersonalModal({ u, onClose }) {
  const api = useApi(); const [f, setF] = useState({ dob: u.dob || '', gender: u.gender || '', nationality: u.nationality || '', blood_group: u.blood_group || '', marital_status: u.marital_status || '', allergies: u.allergies || '', medical_conditions: u.medical_conditions || '', special_notes: u.special_notes || '', phone: u.phone || '' }); const [err, setErr] = useState('');
  return <Modal title="Edit Personal Information" onClose={onClose} footer={<><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn onClick={async () => { const r = await api('PATCH', '/profile/personal', f, { silent: true, success: 'Profile updated' }); if (!r.ok) return setErr(r.error); onClose(); }}>Save</Btn></>}>
    <div className="form-grid fg2"><Field label="Date of Birth"><Input type="date" value={f.dob} onChange={(e) => setF({ ...f, dob: e.target.value })} /></Field><Field label="Gender"><Select value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })} options={['Male', 'Female', 'Other']} placeholder="Select" /></Field><Field label="Nationality"><Input value={f.nationality} onChange={(e) => setF({ ...f, nationality: e.target.value })} /></Field><Field label="Blood Group"><Select value={f.blood_group} onChange={(e) => setF({ ...f, blood_group: e.target.value })} options={['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']} placeholder="Select" /></Field><Field label="Work Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field><Field label="Marital Status"><Select value={f.marital_status} onChange={(e) => setF({ ...f, marital_status: e.target.value })} options={['Single', 'Married', 'Other']} placeholder="Select" /></Field><Field label="Allergies"><Input value={f.allergies} onChange={(e) => setF({ ...f, allergies: e.target.value })} /></Field><Field label="Medical Conditions"><Input value={f.medical_conditions} onChange={(e) => setF({ ...f, medical_conditions: e.target.value })} /></Field></div><Field label="Special Notes" className="mt"><Textarea value={f.special_notes} onChange={(e) => setF({ ...f, special_notes: e.target.value })} /></Field>{err && <div className="err mt" role="alert">{err}</div>}</Modal>;
}
function PrefTab({ prefs }) {
  const api = useApi(); const [p, setP] = useState(prefs); const set = (k, v) => setP({ ...p, [k]: v });
  return <Card title="Travel Preferences" icon="plane" sub="Set your preferred travel options for a smoother booking experience." actions={<Btn icon="check" onClick={() => api('PUT', '/profile/preferences', p, { success: 'Preferences saved' })}>Save</Btn>}>
    <Field label="Preferred Travel Class"><div className="row">{PREF.classes.map((c) => <label key={c} className="chk"><input type="radio" checked={p.class === c} onChange={() => set('class', c)} />{c}</label>)}</div></Field>
    <div className="form-grid fg2 mt"><Field label="Preferred Seat"><Select value={p.seat} onChange={(e) => set('seat', e.target.value)} options={PREF.seats} /></Field><Field label="Meal Preference"><Select value={p.meal} onChange={(e) => set('meal', e.target.value)} options={PREF.meals} /></Field>
      <Field label="Preferred Airlines"><div className="row wrap">{PREF.airlines.map((a) => <Check key={a} checked={p.airlines.includes(a)} onChange={(e) => set('airlines', e.target.checked ? [...p.airlines, a] : p.airlines.filter((x) => x !== a))}>{a}</Check>)}</div></Field><span />
      <Field label="Preferred Hotel Category"><Select value={p.hotelCategory} onChange={(e) => set('hotelCategory', e.target.value)} options={PREF.hotel} /></Field><Field label="Preferred Room Type"><Select value={p.roomType} onChange={(e) => set('roomType', e.target.value)} options={PREF.rooms} /></Field>
      <Field label="Ground Transport Preference"><Select value={p.groundTransport} onChange={(e) => set('groundTransport', e.target.value)} options={PREF.ground} /></Field><Field label="Use loyalty programs for booking"><Switch on={p.useLoyalty} onChange={(v) => set('useLoyalty', v)} label="Use loyalty programs" /></Field></div>
    <Field label="Special Requirements" className="mt"><div className="grid g2">{PREF.special.map((s) => <Check key={s} checked={p.special.includes(s)} onChange={(e) => set('special', e.target.checked ? [...p.special, s] : p.special.filter((x) => x !== s))}>{s}</Check>)}</div></Field><Field label="Others (specify)" className="mt"><Input value={p.otherSpecial || ''} onChange={(e) => set('otherSpecial', e.target.value)} placeholder="Enter requirement" /></Field></Card>;
}
function ListCard({ title, icon, entity, add, rows, columns, sub }) {
  return <Card title={title} icon={icon} sub={sub} actions={<AddBtn entity={entity} label={add} />} body={false}><DataTable rows={rows} empty={`No ${title.toLowerCase()} added yet.`} columns={[...columns, { key: 'a', label: 'Actions', render: (r) => <RowActions entity={entity} item={r} /> }]} /></Card>;
}
export function ProfileView({ data }) {
  const nav = useNav(); const tab = nav.get('tab', 'personal'); const { user: u, stats, data: d } = data;
  const tabs = [['personal', 'Personal Information', 'user'], ['prefs', 'Travel Preferences', 'plane'], ['docs', 'Travel Documents', 'file'], ['pay', 'Payment & Accounts', 'card'], ['family', 'Emergency & Family', 'shield'], ['addr', 'Addresses', 'pin'], ['loyalty', 'Loyalty Programs', 'trophy'], ['notif', 'Notifications', 'bell']];
  return (<>
    <PageHead title="My Profile" sub="Manage your personal information, travel preferences and account settings." />
    <div className="grid" style={{ gridTemplateColumns: '1.2fr 2fr', marginBottom: 14 }}>
      <Card><div className="row"><Avatar name={u.name} size="lg" /><div className="stack" style={{ gap: 4 }}><h2>{u.name}</h2><div className="small">{u.emp_id} | {u.role === 'employee' ? 'Employee' : u.designation}</div><div className="small muted"><Icon name="building" size={13} /> {u.department} Department</div><div className="small muted"><Icon name="user" size={13} /> {u.designation}</div><div className="small muted"><Icon name="mail" size={13} /> {u.email}</div><div className="small muted"><Icon name="phone" size={13} /> {u.phone}</div><div className="small muted"><Icon name="pin" size={13} /> {u.location}</div></div></div></Card>
      <div className="grid g4"><Stat icon="file" value={stats.documents} label="Travel Documents" sub={`${stats.documentsValid} valid`} /><Stat icon="card" value={stats.payments} label="Payment Methods" sub="Active" /><Stat icon="plane" value={stats.flyers} label="Frequent Flyer" sub="Linked" /><Stat icon="shield" tone="red" value={stats.emergency} label="Emergency Contact" sub="Added" iconColor="#d11a2a" /></div></div>
    <Tabs value={tab} onChange={(t) => nav.set({ tab: t }, true)} tabs={tabs.map(([key, label, icon]) => ({ key, label, icon }))} />
    {tab === 'personal' && <PersonalTab u={u} manager={data.manager} />}
    {tab === 'prefs' && <PrefTab prefs={data.preferences} />}
    {tab === 'docs' && <ListCard title="Travel Documents" icon="file" entity="documents" add="Add Document" sub="Manage your travel identity documents and validity." rows={d.documents} columns={[{ key: 'doc_type', label: 'Document', render: (x) => <><b>{x.doc_type}</b><div className="small muted">{x.title}</div></> }, { key: 'doc_number', label: 'Document Number' }, { key: 'issue_date', label: 'Issue Date', render: (x) => fdate(x.issue_date) }, { key: 'expiry_date', label: 'Expiry Date', render: (x) => fdate(x.expiry_date) }, { key: 'status', label: 'Status', render: (x) => <Badge>{x.status}</Badge> }]} />}
    {tab === 'pay' && <div className="stack">
      <ListCard title="Payment Methods" icon="card" entity="payment-methods" add="Add Payment Method" sub="Corporate cards, personal cards and UPI for bookings." rows={d['payment-methods']} columns={[{ key: 'label', label: 'Name', render: (x) => <><b>{x.label}</b><div className="small muted">{x.kind === 'upi' ? x.handle : `**** **** **** ${x.last4}`}</div></> }, { key: 'holder', label: 'Cardholder Name', render: (x) => x.holder || '-' }, { key: 'valid_thru', label: 'Valid Thru', render: (x) => x.valid_thru || '-' }, { key: 'status', label: 'Status', render: (x) => <Badge>{x.is_default ? 'Default' : x.status}</Badge> }]} />
      <Card title="Bank Accounts for Reimbursement" icon="building" actions={<Link href="/reimbursement-accounts" className="btn outline sm">Manage Accounts</Link>} body={false}><DataTable rows={d['bank-accounts']} columns={[{ key: 'bank', label: 'Bank' }, { key: 'account_masked', label: 'Account Number' }, { key: 'holder', label: 'Account Holder Name' }, { key: 'account_type', label: 'Account Type' }, { key: 'ifsc', label: 'IFSC Code' }, { key: 'v', label: 'Status', render: (x) => <Badge tone={x.verified ? 'green' : 'orange'}>{x.verified ? 'Verified' : 'Pending'}</Badge> }]} /></Card></div>}
    {tab === 'family' && <div className="stack"><div className="note">Emergency contacts will be used for urgent travel assistance and communication during trips.</div>
      <ListCard title={`Emergency Contacts (${d['emergency-contacts'].length})`} icon="phone" entity="emergency-contacts" add="Add Contact" rows={d['emergency-contacts']} columns={[{ key: 'name', label: 'Name', render: (x) => <b>{x.name}</b> }, { key: 'relationship', label: 'Relationship' }, { key: 'phone', label: 'Phone Number' }, { key: 'email', label: 'Email' }, { key: 'is_primary', label: 'Primary', render: (x) => <Badge tone={x.is_primary ? 'green' : 'blue'}>{x.is_primary ? 'Primary' : 'Secondary'}</Badge> }]} />
      <ListCard title={`Family Members (${d['family-members'].length})`} icon="users" entity="family-members" add="Add Family Member" rows={d['family-members']} columns={[{ key: 'name', label: 'Name', render: (x) => <b>{x.name}</b> }, { key: 'relationship', label: 'Relationship' }, { key: 'dob', label: 'Date of Birth', render: (x) => fdate(x.dob) }, { key: 'gender', label: 'Gender' }, { key: 'special_assistance', label: 'Special Assistance Needed' }]} />
      <Card title="Medical Information" icon="heart"><Kv rows={[['Medical Conditions', u.medical_conditions], ['Allergies', u.allergies], ['Special Notes', u.special_notes]]} /></Card></div>}
    {tab === 'addr' && <ListCard title="Addresses" icon="pin" entity="addresses" add="Add Address" sub="Manage residential, office and other addresses." rows={d.addresses} columns={[{ key: 'kind', label: 'Type', render: (x) => <b>{x.kind}</b> }, { key: 'line', label: 'Address' }, { key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'pin', label: 'PIN Code' }, { key: 'country', label: 'Country' }, { key: 'is_default', label: '', render: (x) => (x.is_default ? <Badge tone="green">Default</Badge> : <Badge tone="gray">{x.kind}</Badge>) }]} />}
    {tab === 'loyalty' && <ListCard title="Loyalty Programs" icon="trophy" entity="loyalty-programs" add="Add Loyalty Program" rows={d['loyalty-programs']} columns={[{ key: 'provider', label: 'Provider', render: (x) => <><b>{x.program}</b><div className="small muted">{x.provider}</div></> }, { key: 'membership_no', label: 'Membership Number' }, { key: 'tier', label: 'Tier' }, { key: 'expiry_date', label: 'Valid Till', render: (x) => fdate(x.expiry_date) }, { key: 'status', label: 'Status', render: (x) => <Badge>{x.status === 'Valid' ? 'Active' : x.status}</Badge> }]} />}
    {tab === 'notif' && <AlertSettings settings={data.notifSettings} />}
  </>);
}
export { inr };
