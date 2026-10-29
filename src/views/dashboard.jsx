'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHead, Stat, Badge, Icon, DataTable, Btn, Avatar, useApi } from '@/components/ui';
import { fdate, range, inr, nightsOf } from '@/lib/format';

const QUICK = [['Plan a Trip', 'plane', '/trips/new', 'blue'], ['Book Flights', 'plane', '/services/flight', 'purple'], ['Book Hotels', 'bed', '/services/hotel', 'red'], ['Book Cabs', 'car', '/services/ground', 'orange'], ['Raise Expense', 'file', '/expenses/new', 'green'], ['Check Policy', 'shield', '/policy', 'purple']];

function EmployeeDash({ user, data }) {
  const k = data.kpis;
  // Greeting depends on the viewer's local time, so it is set after mount (avoids a server/client hydration mismatch)
  const [greeting, setGreeting] = useState('Welcome');
  useEffect(() => { const h = new Date().getHours(); setGreeting(h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening'); }, []);
  return (<>
    <PageHead title={`${greeting}, ${user.name.split(' ')[0]}!`} sub="Here's your travel overview and key actions for a smooth travel experience." actions={<Link href="/trips/new" className="btn"><Icon name="plus" size={16} />New Trip Request</Link>} />
    <div className="grid g5 mb">
      <Stat icon="plane" tone="blue" value={k.upcoming} label="Upcoming Trips" more="View Trips" href="/trips" />
      <Stat icon="hourglass" tone="orange" value={k.waiting} label="Waiting for Your Reply" more="Take Action" iconColor="#d97706" href="#waiting" />
      <Stat icon="alert" tone="red" value={k.expiringSoon} label="Expiring Soon" sub="(Next 7 Days)" more="View Details" iconColor="#d11a2a" href="/documents" />
      <Stat icon="calendar" tone="purple" value={k.expired} label="Expired" more="View Details" iconColor="#6d3fd1" href="/documents" />
      <Stat icon="file" tone="green" value={k.expensesPending} label="Expense Reports" sub="Pending to Submit" more="Raise Expense" iconColor="#15803d" href="/expenses" />
    </div>
    <div className="main-side mb" style={{ '--side-width': '380px' }}>
      <Card title="Upcoming Trips" icon="plane" actions={<Link href="/trips">View All Trips →</Link>} body={false}>
        <DataTable rows={data.upcoming} empty="No upcoming trips. Start by creating a trip request." columns={[
          { key: 'trip_no', label: 'Trip ID', render: (t) => <Link href={`/trips/${t.id}`} className="bold">{t.trip_no}</Link> },
          { key: 'dest', label: 'Destination', render: (t) => <><b>{t.dep_city} → {t.dest_city}</b><div className="small muted">{nightsOf(t.dep_date, t.ret_date) + 1} Days, {nightsOf(t.dep_date, t.ret_date)} Nights</div></> },
          { key: 'dates', label: 'Travel Dates', render: (t) => range(t.dep_date, t.ret_date) }, { key: 'purpose', label: 'Purpose' },
          { key: 'status', label: 'Status', render: (t) => <Badge>{t.status === 'Under Approval' || t.status === 'Submitted' ? 'Under Review' : t.status}</Badge> },
          { key: 'act', label: 'Action', render: (t) => <Link href={`/trips/${t.id}`} className="btn outline sm">View Details</Link> },
        ]} />
      </Card>
      <Card title="Quick Actions" icon="settings"><div className="grid g3">{QUICK.map(([l, i, h, t]) => <Link key={l} href={h} className={`stat ${t}`} style={{ alignItems: 'center', textAlign: 'center', textDecoration: 'none', padding: 14 }}><span className="ico"><Icon name={i} size={22} /></span><b style={{ color: 'var(--navy)' }}>{l}</b></Link>)}</div></Card>
    </div>
    <div className="grid g2" id="waiting">
      <Card title={`Waiting for Your Reply (${data.replies.length})`} icon="hourglass" body={false}>
        <DataTable rows={data.replies} rowKey="ref" empty="You are all caught up." columns={[
          { key: 'item', label: 'Item', render: (r) => <><b style={{ color: 'var(--blue)' }}>{r.label}</b><div className="small" style={{ color: 'var(--orange)' }}>{r.sub}</div></> }, { key: 'ref', label: 'Reference No.' }, { key: 'details', label: 'Details' },
          { key: 'd', label: 'Days Pending', render: (r) => <Badge tone="orange">{r.daysPending}</Badge> }, { key: 'a', label: 'Action', render: (r) => <Link href={r.link} className="btn outline sm">{r.action}</Link> },
        ]} />
      </Card>
      <Card title={`Expiring Soon (${data.expiring.length})`} icon="alert" body={false}>
        <DataTable rows={data.expiring} empty="No documents expiring soon." columns={[
          { key: 'i', label: 'Item', render: (d) => <b>{d.title || d.doc_type}</b> }, { key: 'n', label: 'Reference No.', render: (d) => d.doc_number }, { key: 'e', label: 'Expiry Date', render: (d) => <span style={{ color: 'var(--red)' }}>{fdate(d.expiry_date)}</span> },
          { key: 'l', label: 'Days Left', render: (d) => <Badge tone="red">{d.days_left}</Badge> }, { key: 'a', label: 'Action', render: () => <Link href="/documents" className="btn outline sm">View Details</Link> },
        ]} />
      </Card>
    </div>
  </>);
}

function ManagerDash({ data }) {
  const k = data.kpis;
  return (<>
    <PageHead title="Manager Dashboard" sub="Team travel overview, approvals and risks" />
    <div className="grid g6 mb">
      <Stat icon="checkCircle" tone="orange" value={k.pendingTrips} label="Trip Approvals" more="Review" href="/approvals" /><Stat icon="file" tone="orange" value={k.pendingExpenses} label="Expense Approvals" more="Review" href="/approvals?type=expense" />
      <Stat icon="plane" tone="blue" value={k.teamTrips} label="Team Trips Upcoming" href="/trips" /><Stat icon="shield" tone="purple" value={k.exceptions} label="Policy Exceptions" href="/approvals?type=booking" />
      <Stat icon="alert" tone="red" value={k.highRisk} label="High-Risk Trips" more="Readiness" href="/readiness" /><Stat icon="refresh" tone="green" value={k.refunds} label="Refunds Pending" href="/refunds" />
    </div>
    <div className="grid g2">
      <Card title="Awaiting Your Approval" icon="checkCircle" body={false}><DataTable rows={data.pendingTrips} rowKey="approval_id" empty="Nothing waiting." columns={[{ key: 'trip_no', label: 'Trip' }, { key: 'employee', label: 'Employee' }, { key: 'title', label: 'Title' }, { key: 'dep_date', label: 'Departure', render: (r) => fdate(r.dep_date) }, { key: 'est_budget', label: 'Estimate', render: (r) => inr(r.est_budget) }]} /></Card>
      <Card title="Upcoming Team Trips - Readiness" icon="plane" body={false}><DataTable rows={data.upcoming} empty="No upcoming team trips." columns={[{ key: 'trip_no', label: 'Trip' }, { key: 'traveller_name', label: 'Traveller' }, { key: 'dest_city', label: 'Destination' }, { key: 'readiness', label: 'Readiness', render: (r) => <Badge>{r.readiness}</Badge> }, { key: 'risk', label: 'Risk', render: (r) => <Badge>{r.risk}</Badge> }]} /></Card>
    </div>
  </>);
}
function DeskDash({ data }) {
  const k = data.kpis;
  return (<>
    <PageHead title="Travel Desk Dashboard" sub="Agency requests and service operations" actions={<Link href="/travel-desk" className="btn">Open Operations Queue</Link>} />
    <div className="grid g6 mb">{[['Awaiting Agency Quote', 'orange'], ['Traveller Info', 'blue'], ['Approval Pending', 'purple'], ['Booking in Progress', 'green'], ['Ticketing Pending', 'blue'], ['Failed / Issues', 'red']].map(([s, t]) => <Stat key={s} tone={t} value={k[s] ?? 0} label={s} href={`/travel-desk?tab=${encodeURIComponent(s)}`} />)}</div>
    <div className="grid g2"><Card title="Latest Requests" icon="list" body={false}><DataTable rows={data.queue} empty="Queue is empty." columns={[{ key: 'srv_no', label: 'Req ID' }, { key: 'employee', label: 'Employee' }, { key: 'type', label: 'Service' }, { key: 'desk_stage', label: 'Stage', render: (r) => <Badge>{r.desk_stage}</Badge> }, { key: 's', label: 'SLA', render: (r) => <Badge>{r.sla.status}</Badge> }]} /></Card>
      <Card title="Open Refund Cases" icon="refresh"><div className="stat blue"><div className="num">{data.refunds}</div><Link href="/refunds">Open Refund Centre →</Link></div></Card></div>
  </>);
}
function FinanceDash({ data }) {
  const k = data.kpis;
  return (<>
    <PageHead title="Finance Dashboard" sub="Approvals, reimbursements and reconciliation" />
    <div className="grid g5 mb"><Stat icon="checkCircle" tone="orange" value={k.expenseApprovals} label="Expense Approvals" href="/approvals?type=expense" /><Stat icon="rupee" tone="blue" value={k.payable} label="Ready to Pay" href="/finance/reimbursements" /><Stat icon="alert" tone="red" value={k.failed} label="Failed Payments" href="/finance/reimbursements" /><Stat icon="file" tone="purple" value={k.exceptions} label="Missing Invoices" href="/finance/reconciliation?tab=exceptions" /><Stat icon="refresh" tone="green" value={k.refunds} label="Refunds Pending" href="/refunds" /></div>
    <Card title="Recent Expense Reports" icon="file" body={false}><DataTable rows={data.recent} empty="No reports." columns={[{ key: 'report_no', label: 'Report', render: (r) => <Link href={`/expenses/${r.id}`}>{r.report_no}</Link> }, { key: 'employee', label: 'Employee' }, { key: 'title', label: 'Title' }, { key: 'payment_status', label: 'Payment', render: (r) => <Badge>{r.payment_status || 'Awaiting Finance'}</Badge> }, { key: 'payable_amount', label: 'Payable', render: (r) => inr(r.payable_amount) }]} /></Card>
  </>);
}
function AdminDash({ data }) {
  const k = data.kpis;
  return (<>
    <PageHead title="Administration" sub="Policy, users and system health" />
    <div className="grid g5 mb"><Stat icon="users" tone="blue" value={k.users} label="Active Users" href="/users" /><Stat icon="shield" tone="green" value={k.rules} label="Active Policy Rules" href="/policy" /><Stat icon="plane" tone="purple" value={k.trips} label="Trips" href="/trips" /><Stat icon="alert" tone="orange" value={k.exceptions} label="Policy Exceptions" href="/reports" /><Stat icon="file" tone="gray" value={k.audit} label="Audit Records" href="/audit" /></div>
    <Card title="Recent Activity" icon="clock" body={false}><DataTable rows={data.recentAudit} empty="No activity yet." columns={[{ key: 'ts', label: 'Time', render: (r) => String(r.ts).slice(0, 16).replace('T', ' ') }, { key: 'actor_name', label: 'Actor' }, { key: 'action', label: 'Action' }, { key: 'detail', label: 'Detail' }]} /></Card>
  </>);
}
export default function DashboardView({ user, data }) {
  if (user.role === 'manager') return <ManagerDash data={data} />; if (user.role === 'travel_desk') return <DeskDash data={data} />; if (user.role === 'finance') return <FinanceDash data={data} />; if (user.role === 'admin') return <AdminDash data={data} />;
  return <EmployeeDash user={user} data={data} />;
}
export { Btn, Avatar, useApi };
