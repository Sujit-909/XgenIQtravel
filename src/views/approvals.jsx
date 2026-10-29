'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHead, Stat, Badge, Icon, DataTable, Pager, Btn, Modal, Field, Textarea, useApi, useNav, Kv, Tabs, Avatar, Empty } from '@/components/ui';
import { fdate, inr, fdt, range } from '@/lib/format';

export function ApprovalsView({ user, data, selected }) {
  const nav = useNav(); const api = useApi();
  const [sel, setSel] = useState([]); const [detail, setDetail] = useState(null); const [dlg, setDlg] = useState(null);
  const type = data.type; const k = data.kpis;
  useEffect(() => { setDetail(null); const id = nav.get('open'); if (id) api('GET', `/approvals/${id}`, undefined, { refresh: false, silent: true }).then((r) => r.ok && setDetail(r.data)); }, [nav.get('open')]); // eslint-disable-line react-hooks/exhaustive-deps
  const decide = async (id, decision, comment) => { const r = await api('POST', `/approvals/${id}/decision`, { decision, comment }, { success: decision === 'approve' ? 'Approved' : decision === 'reject' ? 'Rejected' : 'Information requested' }); if (r.ok) { setDlg(null); nav.set({ open: '' }, true); } return r; };
  const bulkApprove = async () => { let n = 0; for (const id of sel) { const r = await api('POST', `/approvals/${id}/decision`, { decision: 'approve' }, { silent: true, refresh: false }); if (r.ok) n += 1; } setSel([]); nav.set({ open: '' }, true); return n; };
  const tabs = [{ key: 'trip', label: 'Trip Approvals', icon: 'plane', count: data.tabs.trip }, { key: 'expense', label: 'Expense Approvals', icon: 'file', count: data.tabs.expense }, { key: 'booking', label: 'Policy Exceptions', icon: 'shield', count: data.tabs.booking }];
  const e = detail?.entity;
  return (<>
    <PageHead title="My Approvals" sub="Review and approve trip requests, expense reports and policy exceptions" />
    <Tabs tabs={tabs} value={type} onChange={(t) => nav.set({ type: t, status: '', open: '' })} />
    <div className="grid g5 mb"><Stat icon="list" value={k.total} label={`Total ${type === 'trip' ? 'Trip Requests' : type === 'expense' ? 'Expense Reports' : 'Exceptions'}`} /><Stat icon="clock" tone="orange" value={k.pending} label="Pending Approval" iconColor="#d97706" /><Stat icon="checkCircle" tone="green" value={k.approved} label="Approved" iconColor="#15803d" /><Stat icon="x" tone="red" value={k.rejected} label="Rejected" iconColor="#d11a2a" /><Stat icon="hourglass" tone="purple" value={k.overdue} label="Pending > 7 Days" iconColor="#6d3fd1" /></div>
    <div className="row wrap mb">{['Pending', 'Approved', 'Rejected', 'Pending > 7 days', 'All'].map((s) => <button key={s} className={`pill ${nav.get('status', 'Pending') === s ? 'on' : ''}`} onClick={() => nav.set({ status: s === 'Pending' ? '' : s, open: '' })}>{s}</button>)}
      <div className="grow" /><input className="in" style={{ maxWidth: 280 }} defaultValue={nav.get('q')} placeholder="Search by ID, employee, title" aria-label="Search approvals" onKeyDown={(ev) => ev.key === 'Enter' && nav.set({ q: ev.target.value })} />{sel.length > 0 && <Btn icon="check" onClick={bulkApprove}>Approve selected ({sel.length})</Btn>}</div>
    <div className="main-side" style={{ gridTemplateColumns: detail ? 'minmax(0,1fr) 380px' : '1fr' }}>
      <Card body={false}>
        <DataTable rows={data.rows} rowKey="approval_id" selectable={data.rows.some((r) => r.status === 'Pending')} selected={sel} onSelect={setSel} onRowClick={(r) => nav.set({ open: r.approval_id }, true)} rowClass={(r) => (String(r.approval_id) === nav.get('open') ? 'sel' : '')} empty="No approvals in this view." columns={[
          { key: 'ref', label: type === 'trip' ? 'Trip ID' : type === 'expense' ? 'Report No.' : 'Booking', render: (r) => <b style={{ color: 'var(--blue)' }}>{r.ref}</b> },
          { key: 'employee', label: 'Employee', render: (r) => <span className="row"><Avatar name={r.employee} size="sm light" /><span><b>{r.employee}</b><div className="small muted">{r.emp_id} | {r.department}</div></span></span> },
          { key: 'dates', label: type === 'booking' ? 'Travel Date' : 'Travel Period', render: (r) => (r.dep_date ? range(r.dep_date, r.ret_date || r.dep_date) : '-') }, { key: 'dest_city', label: type === 'booking' ? 'Route' : 'Destination' }, { key: 'title', label: 'Details' }, { key: 'purpose', label: 'Purpose' },
          { key: 'amount', label: 'Est. Cost', render: (r) => inr(r.amount) }, { key: 'label', label: 'Level' }, { key: 'status', label: 'Status', render: (r) => <Badge>{r.status === 'Pending' && r.pendingDays > 7 ? 'Pending > 7 days' : r.status}</Badge> },
          ...(type === 'trip' ? [{ key: 'priority', label: 'Priority', render: (r) => <Badge tone={r.priority === 'High' ? 'red' : 'blue'}>{r.priority}</Badge> }] : []),
        ]} />
        <Pager page={data.page} size={data.size} total={data.total} noun="requests" />
      </Card>
      {detail && (
        <Card title={type === 'trip' ? 'Trip Request Details' : type === 'expense' ? 'Expense Report Details' : 'Exception Details'} icon="file" actions={<button className="icon-btn" onClick={() => nav.set({ open: '' }, true)} aria-label="Close"><Icon name="x" /></button>}>
          <div className="row between mb"><b style={{ fontSize: 16 }}>{e.trip_no || e.report_no || e.booking_no}</b><Badge>{detail.approval.status}</Badge></div>
          <h3>Employee</h3><div className="row mb"><Avatar name={e.employee} /><div><b>{e.employee}</b><div className="small muted">{e.emp_id} | {e.department}</div></div></div>
          {type === 'trip' && <><Kv rows={[['Travel Period', range(e.dep_date, e.ret_date)], ['Destination', `${e.dep_city} → ${e.dest_city}`], ['Purpose', e.purpose], ['Estimated Cost', inr(e.est_budget)], ['Cost Object', e.cost_object], ['Travel Advance', inr(e.advance_amount)], ['Comment', e.comment]]} />{e.emergency ? <div className="warn mt">Emergency travel: {e.emergency_justification}</div> : null}
            {detail.bookings?.length > 0 && <><h3 className="mt">Itinerary (for information)</h3>{detail.bookings.map((b, i) => <div key={i} className="row between small" style={{ padding: '4px 0' }}><span>{b.type}: {b.detail}</span><b>{inr(b.amount)}</b></div>)}</>}</>}
          {type === 'expense' && <><Kv rows={[['Purpose', e.purpose], ['Category', e.category], ['Travel Advance', inr(e.advance)], ['Gross Claim', inr(detail.calc.gross)], ['Payable', inr(detail.calc.estimatedReimbursement)], ['Items needing review', detail.calc.needsReview]]} /><h3 className="mt">Line items</h3>{detail.items.map((i) => <div key={i.id} className="row between small" style={{ padding: '4px 0' }}><span>{i.type} - {i.vendor} {i.status === 'Needs Review' && <Badge tone="orange">Review</Badge>}</span><b>{inr(i.total_inr)}</b></div>)}<Link href={`/expenses/${e.id}`} className="small">Open full report →</Link></>}
          {type === 'booking' && <><Kv rows={[['Booking', e.detail], ['Route', e.route], ['Amount', inr(e.amount)], ['Policy', e.policy_status], ['Issues', e.policy_note], ['Justification', e.justification]]} /></>}
          <h3 className="mt">Approvals & Comments</h3><div className="vsteps">{detail.chain.filter((c) => c.status !== 'Cancelled').map((c) => <div key={c.id} className={`vs ${c.status === 'Approved' ? 'done' : c.status === 'Pending' ? 'cur' : c.status === 'Rejected' ? 'bad' : ''}`}><span className="c">{c.level}</span><div><b>{c.label}</b> <Badge>{c.status}</Badge><div className="small muted">{c.approver_name || c.approver_role}{c.acted_at ? ` · ${fdt(c.acted_at)}` : ''}</div>{c.comment && <div className="small">“{c.comment}”</div>}</div></div>)}</div>
          {detail.approval.status === 'Pending' && <div className="row mt"><Btn variant="success" icon="check" onClick={() => decide(detail.approval.id, 'approve')}>Approve</Btn><Btn variant="danger" icon="x" onClick={() => setDlg('reject')}>Reject</Btn><Btn variant="outline" onClick={() => setDlg('info')}>Request Info</Btn></div>}
        </Card>)}
    </div>
    {dlg && <ReasonDialog kind={dlg} onClose={() => setDlg(null)} onSubmit={(c) => decide(detail.approval.id, dlg, c)} />}
  </>);
}
function ReasonDialog({ kind, onClose, onSubmit }) {
  const [c, setC] = useState(''); const [busy, setBusy] = useState(false);
  return <Modal title={kind === 'reject' ? 'Reject request' : 'Request more information'} size="sm" onClose={onClose} footer={<><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn variant={kind === 'reject' ? 'danger' : ''} busy={busy} disabled={!c.trim()} onClick={async () => { setBusy(true); await onSubmit(c); setBusy(false); }}>{kind === 'reject' ? 'Reject' : 'Send request'}</Btn></>}><Field label={kind === 'reject' ? 'Reason for rejection' : 'What information is needed?'} required><Textarea value={c} onChange={(e) => setC(e.target.value)} /></Field></Modal>;
}
export { Empty };
