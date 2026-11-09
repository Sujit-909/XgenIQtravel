'use client';
import React, { useEffect, useState, useTransition } from 'react';
import { Btn, Field, Icon, Input, Select, useNav } from '@/components/ui';
import { PURPOSES, TRIP_STATUSES } from '@/lib/constants';

const KEYS = ['status', 'from', 'to', 'travel_type', 'destination', 'department', 'traveller_id', 'q', 'purpose', 'view'];
const MORE = ['Travel In Progress', 'Expenses Pending', 'Closed', 'Rejected', 'Cancelled'];
const ICONS = { Draft: 'file', Submitted: 'send', 'Pending for Review': 'clock', 'Under Approval': 'hourglass', Approved: 'checkCircle', 'Booking In Progress': 'settings' };
const empty = () => Object.fromEntries(KEYS.map((key) => [key, '']));
export function tripDateRange(preset, today) {
  const shift = (days) => { const date = new Date(`${today}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
  if (preset === 'week') return { from: today, to: shift(6) };
  if (preset === 'month') return { from: today, to: shift(29) };
  if (preset === 'calendar') { const date = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + 1); date.setUTCDate(0); return { from: `${today.slice(0, 7)}-01`, to: date.toISOString().slice(0, 10) }; }
  return { from: '', to: '' };
}
export default function TripFilters({ data }) {
  const nav = useNav(); const [pending, startTransition] = useTransition();
  const urlState = JSON.stringify(Object.fromEntries(KEYS.map((key) => [key, nav.get(key)])));
  const [draft, setDraft] = useState(() => JSON.parse(urlState)); const [customDates, setCustomDates] = useState(false); const [error, setError] = useState('');
  const today = data.filterToday;
  useEffect(() => { setDraft(JSON.parse(urlState)); setCustomDates(false); setError(''); }, [urlState]);
  const change = (key, value) => { setDraft((old) => ({ ...old, [key]: value })); setError(''); };
  const preset = customDates ? 'custom' : ['week', 'month', 'calendar'].find((key) => { const range = tripDateRange(key, today); return draft.from === range.from && draft.to === range.to; }) || (draft.from || draft.to ? 'custom' : '');
  const apply = (values = draft) => {
    if (values.from && values.to && values.from > values.to) { setError('The end date must be on or after the start date.'); return; }
    setError(''); setDraft(values); startTransition(() => nav.set(values));
  };
  const reset = () => { setCustomDates(false); setError(''); const values = empty(); setDraft(values); startTransition(() => nav.set(values)); };
  const status = draft.status === 'All' ? '' : draft.status;
  return <section className="trip-filters mb" aria-label="Trip filters" aria-busy={pending}>
    <form onSubmit={(e) => { e.preventDefault(); apply(); }}>
      <div className="trip-filter-statuses" role="group" aria-label="Filter by trip status">
        <button className={`pill ${!status ? 'on' : ''}`} type="button" disabled={pending} aria-pressed={!status} onClick={() => apply({ ...draft, status: '' })}><Icon name="list" size={14} />All Trips<span className="c">{data.kpis.total}</span></button>
        {TRIP_STATUSES.filter((s) => !MORE.includes(s)).map((s) => <button key={s} className={`pill ${status === s ? 'on' : ''}`} type="button" disabled={pending} aria-pressed={status === s} onClick={() => apply({ ...draft, status: s })}><Icon name={ICONS[s]} size={14} />{s}<span className="c">{data.counts[s] || 0}</span></button>)}
        <label className={`trip-filter-more ${MORE.includes(status) ? 'on' : ''}`}><Icon name="more" size={14} /><span>More</span><Select aria-label="More trip statuses" disabled={pending} value={MORE.includes(status) ? status : ''} onChange={(e) => apply({ ...draft, status: e.target.value })} options={[["", 'More statuses'], ...MORE.map((s) => [s, `${s} (${data.counts[s] || 0})`])]} /></label>
      </div>
      <div className="trip-filter-fields">
        <Field label="Trip Date"><Select value={preset} disabled={pending} onChange={(e) => { const v = e.target.value; setCustomDates(v === 'custom'); if (v !== 'custom') setDraft((old) => ({ ...old, ...tripDateRange(v, today) })); }} options={[["", 'All dates'], ['week', 'Next 7 days'], ['month', 'Next 30 days'], ['calendar', 'This month'], ['custom', 'Custom date range']]} /></Field>
        <Field label="Trip Type"><Select value={draft.travel_type} disabled={pending} onChange={(e) => change('travel_type', e.target.value)} options={[["", 'All types'], ['Domestic', 'Domestic'], ['International', 'International']]} /></Field>
        <Field label="Destination"><Select value={draft.destination} disabled={pending} onChange={(e) => change('destination', e.target.value)} options={[["", 'All destinations'], ...data.destinations.map((d) => [d, d])]} /></Field>
        <Field label="Department"><Select value={draft.department} disabled={pending} onChange={(e) => change('department', e.target.value)} options={[["", 'All departments'], ...data.departments.map((d) => [d, d])]} /></Field>
        <Field label="Traveler"><Select value={draft.traveller_id} disabled={pending} onChange={(e) => change('traveller_id', e.target.value)} options={[["", 'All travelers'], ...data.travellers.map((t) => [t.id, t.name])]} /></Field>
      </div>
      {preset === 'custom' && <div className="trip-filter-date-range"><Field label="Departure from"><Input type="date" disabled={pending} value={draft.from} onChange={(e) => change('from', e.target.value)} /></Field><Field label="Departure to"><Input type="date" disabled={pending} min={draft.from || undefined} value={draft.to} onChange={(e) => change('to', e.target.value)} /></Field></div>}
      <div className="trip-filter-tools">
        <Field label="Search trips" className="trip-filter-search"><Input type="search" disabled={pending} value={draft.q} onChange={(e) => change('q', e.target.value)} placeholder="Trip ID, title, destination, employee" /></Field>
        <details className="trip-filter-extra" open={draft.purpose || draft.view ? true : undefined}><summary>Additional filters{draft.purpose || draft.view ? ' (active)' : ''}</summary><div className="trip-filter-extra-fields"><Field label="Request Purpose"><Select disabled={pending} value={draft.purpose} onChange={(e) => change('purpose', e.target.value)} options={[["", 'All purposes'], ...PURPOSES.map((s) => [s, s])]} /></Field><Field label="Dashboard filter"><Select disabled={pending} value={draft.view} onChange={(e) => change('view', e.target.value)} options={[["", 'All trips'], ['upcoming', 'Upcoming trips'], ['waiting', 'Waiting for your reply']]} /></Field></div></details>
        <div className="trip-filter-actions"><Btn type="button" variant="outline" icon="refresh" disabled={pending} onClick={reset}>Reset</Btn><Btn type="submit" icon="filter" busy={pending}>Apply Filters</Btn></div>
      </div>
      {error && <div className="err mt-sm" role="alert">{error}</div>}
      <div className="trip-filter-caption" role="status">{pending ? 'Applying filters...' : `${data.total} matching trip${data.total === 1 ? '' : 's'}`}<span>Status counts cover all trips in this view.</span></div>
    </form>
  </section>;
}
