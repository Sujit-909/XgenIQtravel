'use client';
import React from 'react';
import Link from 'next/link';
import { Card, PageHead, Select, Field, useNav, Empty } from '@/components/ui';
import { ServicePanel } from '@/views/services';
import { fdate } from '@/lib/format';

const TITLE = { flight: 'Flight Booking', hotel: 'Hotel Booking', ground: 'Ground Transport', visa: 'Visa Processing', other: 'Other Services' };
export function ServicesHubView({ user, type, trips, data }) {
  const nav = useNav();
  return (<>
    <PageHead title={TITLE[type]} sub="Choose an approved trip to book or request services for it." />
    <Card className="mb"><div className="row"><Field label="Approved trip" className="grow"><Select value={data?.trip.id || ''} onChange={(e) => nav.set({ trip: e.target.value }, true)} placeholder="Select a trip" options={trips.map((t) => [t.id, `${t.trip_no} - ${t.title} (${fdate(t.dep_date)})`])} /></Field></div></Card>
    {trips.length === 0 && <Card><Empty>You have no approved trips yet. <Link href="/trips/new">Create a trip request</Link> and get it approved first.</Empty></Card>}
    {data && <ServicePanel trip={data.trip} services={data.services} type={type} user={user} />}
  </>);
}
