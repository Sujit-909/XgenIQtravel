'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon, Btn, useApi, Badge } from '@/components/ui';
import { fdate, inr } from '@/lib/format';

const CHIPS = ['Show my upcoming trips', 'What is the hotel policy?', 'What is my claim limit?', 'Show reimbursement status'];
const TOP = [['Plan a Trip', 'plane', 'I need to travel to Mumbai next week for a client meeting'], ['Book Services', 'bed', 'Show my upcoming trips'], ['Raise Expense', 'file', 'I want to raise an expense reimbursement'], ['Policy & Guidelines', 'shield', 'What is the travel policy?'], ['My Trips', 'briefcase', 'Show my upcoming trips'], ['Reimbursement', 'rupee', 'Show reimbursement status']];

function Card({ c }) {
  if (!c) return null;
  if (c.type === 'trip_draft') return <div className="card" style={{ marginTop: 8 }}><div className="card-b grid g3" style={{ gap: 10 }}>{[['From', c.from], ['To', c.to], ['Travel Dates', `${fdate(c.dep)} - ${fdate(c.ret)} (${c.days} Days, ${c.nights} Nights)`], ['Purpose', c.purpose], ['Estimated Cost', `${inr(c.estimate)} (as per policy)`], ['Traveller', c.traveller]].map(([k, v]) => <div key={k}><div className="small muted">{k}</div><b>{v}</b></div>)}</div></div>;
  if (c.type === 'trip_created') return <div className="card" style={{ marginTop: 8 }}><div className="card-b"><div className="row between ok" style={{ marginBottom: 8 }}><b>Trip ID: {c.trip_no}</b><Badge>{c.status}</Badge></div><div className="row wrap gap-lg"><span>{fdate(c.dep)} - {fdate(c.ret)}</span><span>{c.from} → {c.to}</span><span>{c.purpose}</span><span>{inr(c.estimate)} (Estimated)</span></div></div></div>;
  if (c.type === 'list') return <div style={{ marginTop: 8 }} className="stack" >{c.items.map((i) => <div key={i.title} className="card"><div className="card-b row between"><div><b>{i.title}</b><div className="small muted">{i.sub}</div></div>{i.href && <Link href={i.href} className="btn outline sm">Open</Link>}</div></div>)}</div>;
  return null;
}

export function AssistantView({ user, initial }) {
  const api = useApi(); const [msgs, setMsgs] = useState(initial); const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView?.({ behavior: 'smooth' }); }, [msgs]);
  const send = async (t) => {
    const m = (t ?? text).trim(); if (!m || busy) return; setBusy(true); setText('');
    setMsgs((x) => [...x, { id: `tmp${x.length}`, role: 'user', text: m }]);
    const r = await api('POST', '/assistant', { message: m }, { refresh: false });
    setBusy(false);
    if (r.ok) setMsgs((x) => [...x.slice(0, -1), ...r.data.messages]);
  };
  return (<>
    <div className="page-head"><div className="row"><span className="ico-box" style={{ width: 52, height: 52, borderRadius: 14 }}><Icon name="bot" size={26} /></span><div><h1>GENIQ Travel Assistant</h1><p>Your assistant for trips, bookings, expenses and reimbursements</p></div></div><div className="row"><Link href="/trips/new" className="btn outline">New Trip Request</Link><Link href="/expenses/new" className="btn outline">New Expense Report</Link></div></div>
    <div className="row wrap mb">{TOP.map(([l, i, m]) => <button key={l} className="pill" onClick={() => send(m)}><Icon name={i} size={14} />{l}</button>)}</div>
    <div className="card"><div className="card-b chat" style={{ minHeight: 360, maxHeight: '58vh', overflowY: 'auto' }} aria-live="polite">
      {msgs.length === 0 && <div className="muted center" style={{ padding: 40 }}>Hi {user.name.split(' ')[0]}! Try: “I need to travel to Mumbai from 12 Nov to 14 Nov for a client meeting”.</div>}
      {msgs.map((m) => <div key={m.id} className={`bubble ${m.role === 'user' ? 'user' : 'bot'}`}><div>{m.text}</div><Card c={m.card} />{m.actions && <div className="row wrap mt-sm" style={{ marginTop: 8 }}>{m.actions.map((a) => <Link key={a.label} href={a.href} className={`btn ${a.primary ? '' : 'outline'} sm`}>{a.label}</Link>)}</div>}</div>)}
      {msgs.at(-1)?.card?.type === 'trip_draft' && !busy && <div className="row" style={{ marginLeft: 8 }}><Btn onClick={() => send('Yes, please create it')}>Yes, create the trip request</Btn><Btn variant="outline" onClick={() => send('No')}>No, discard</Btn></div>}
      <div ref={end} />
    </div>
    <div className="card-b" style={{ borderTop: '1px solid var(--border)' }}><div className="row wrap mb">{CHIPS.map((c) => <button key={c} className="pill small" onClick={() => send(c)}>{c}</button>)}</div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); send(); }}><input className="in" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your message here… (e.g. create trip, raise expense, check policy)" maxLength={500} aria-label="Message" /><Btn type="submit" busy={busy} icon="send">Send</Btn></form></div></div>
  </>);
}
