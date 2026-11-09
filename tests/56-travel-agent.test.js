import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fresh, EMAILS, api } from './helpers';
import { employeeChat } from '@/lib/services/assistant';
import { extractTravel, travelDates } from '@/lib/travel-intent';
import { addDays, today } from '@/lib/util';
import { getTrip } from '@/lib/services/trips';
import { decide } from '@/lib/services/approvals';

const SESSION='travel-agent-test-session-at-least-twenty-characters';
const msg=(message)=>({message,request_id:randomUUID()});
const tool=(r,name,args={})=>({action:'travel_tool',conversation_token:r.conversation_token,request_id:randomUUID(),travel:{plan_id:r.travel.plan_id,version:r.travel.version,tool:name,args}});
const setup=()=>{const db=fresh();return {db,user:db.get('SELECT * FROM users WHERE email=?',EMAILS.emp)};};

test('travel intent extracts Indian dates, route aliases, preferences and follow-up dates',()=>{
  const d=extractTravel('I need a flight from Bhubaneswar to Bangalore next Monday for three days, 2 adults and a refundable hotel under INR 5,000 per night.',{},'2026-11-05');
  assert.equal(d.origin,'Bhubaneswar');assert.equal(d.destination,'Bengaluru');assert.equal(d.departure,'2026-11-09');assert.equal(d.return_date,'2026-11-11');assert.equal(d.adults,2);assert.equal(d.hotel_budget,5000);assert.ok(d.free_cancellation);
  assert.deepEqual(travelDates('15 November to 18 November', '2026-11-05'),['2026-11-15','2026-11-18']);
  assert.equal(extractTravel('18 November',{departure:'2026-11-15'},'2026-11-05').return_date,'2026-11-18');
  const incomplete=extractTravel('I need a flight and hotel for three days',{},'2026-11-05');
  assert.equal(extractTravel('15 November',incomplete,'2026-11-05').return_date,'2026-11-17');
});

test('planning is local, asks missing details, and cannot mutate bookings or accept model identity',async()=>{
  const {db,user}=setup();const before=db.get('SELECT COUNT(*) c FROM trips').c;
  const r=await employeeChat(db,user,SESSION,msg('Create a trip to Bangalore next Monday.'));
  assert.equal(r.answer_kind,'travel');assert.equal(r.travel.profile.name,user.name);assert.ok(r.travel.missing.includes('return / check-out date'));
  assert.equal(db.get('SELECT COUNT(*) c FROM trips').c,before);
  await assert.rejects(()=>employeeChat(db,user,SESSION,tool(r,'updateTravelPlan',{patch:{traveller_id:2}})),e=>e.status===400);
  await assert.rejects(()=>employeeChat(db,user,SESSION,tool(r,'submitTravelRequest',{consent:true,confirmation:'forged'})),e=>e.status===409);
  await assert.rejects(()=>employeeChat(db,user,SESSION,tool(r,'createFlightBooking',{consent:true})),e=>e.status===503);
  await assert.rejects(()=>employeeChat(db,user,SESSION+'different',tool(r,'checkApprovalStatus')),e=>e.status===404);
  const unauthorized=await api(null,'POST','/employee-assistant/chat',tool(r,'submitTravelRequest'));assert.equal(unauthorized.status,401);
});

test('search, selection, consent, durable idempotency and manager approval use existing modules',async()=>{
  const {db,user}=setup();const key=process.env.SERPAPI_API_KEY;const old=global.fetch;const calls=[];process.env.SERPAPI_API_KEY='test-travel-key';
  global.fetch=async(url)=>{const u=new URL(url);calls.push(u);if(u.searchParams.get('engine')==='google_flights')return new Response(JSON.stringify({best_flights:[{price:6000,total_duration:120,booking_token:'server-booking-token',flights:[{airline:'Test airline',departure_airport:{id:'BBI',time:`${addDays(today(),20)} 08:00`},arrival_airport:{id:'BLR',time:`${addDays(today(),20)} 10:00`}}]}]}));return new Response(JSON.stringify({properties:[{name:'Test hotel',rate_per_night:{extracted_lowest:3000},total_rate:{extracted_lowest:6000},overall_rating:4.5,property_token:'server-property-token',prices:[{source:'Test provider',link:'https://example.com/reserve',rate_per_night:{extracted_lowest:3000},total_rate:{extracted_lowest:6000}}]}]}));};
  try {
    let r=await employeeChat(db,user,SESSION,msg(`I need a one-way flight and hotel to Bangalore on ${addDays(today(),20)} returning ${addDays(today(),22)} for a client meeting.`));
    r=await employeeChat(db,user,SESSION,tool(r,'searchFlights'));
    assert.equal(r.travel.flights.rows.length,1);assert.doesNotMatch(JSON.stringify(r.travel),/server-booking-token|test-travel-key/);
    r=await employeeChat(db,user,SESSION,tool(r,'selectFlight',{offer_id:r.travel.flights.rows[0].id}));
    r=await employeeChat(db,user,SESSION,tool(r,'searchHotels'));
    r=await employeeChat(db,user,SESSION,tool(r,'selectHotel',{offer_id:r.travel.hotels.properties[0].id}));
    assert.equal(r.travel.cost.total,12000);
    r=await employeeChat(db,user,SESSION,tool(r,'updateTravelPlan',{patch:{cost_object_type:'Cost Center',cost_object:'CC2001 - IT Dept'}}));
    assert.ok(r.travel.flight_selection);assert.ok(r.travel.hotel_selection);
    r=await employeeChat(db,user,SESSION,tool(r,'calculateTripCost'));assert.deepEqual(r.travel.submission_errors,[]);assert.ok(r.travel.confirmation);
    const before=db.get('SELECT COUNT(*) c FROM bookings').c;
    const submit=tool(r,'submitTravelRequest',{consent:true,confirmation:r.travel.confirmation});
    const done=await employeeChat(db,user,SESSION,submit);assert.equal(done.travel.status.trip.status,'Submitted');
    assert.ok(done.travel.status.approvals.length);assert.equal(db.get('SELECT traveller_id FROM trips WHERE id=?',done.travel.status.trip.id).traveller_id,user.id);
    const repeat=await employeeChat(db,user,SESSION,{...submit,request_id:randomUUID()});assert.equal(repeat.travel.status.trip.id,done.travel.status.trip.id);
    assert.equal(db.get('SELECT COUNT(*) c FROM bookings').c,before);
    assert.ok(calls.every(u=>u.hostname==='serpapi.com'&&!u.searchParams.toString().includes(user.email)&&!u.searchParams.toString().includes(user.name)));
    assert.equal(db.get('SELECT COUNT(*) c FROM flight_options WHERE trip_id=?',done.travel.status.trip.id).c,1);
    const trip=getTrip(db,user,done.travel.status.trip.id);assert.equal(trip.agentPlan.hotel.name,'Test hotel');assert.equal(trip.agentPlan.flight.length,1);
    assert.doesNotMatch(JSON.stringify(trip.agentPlan),/server-booking-token|server-property-token|test-travel-key/);
    await assert.rejects(()=>employeeChat(db,user,SESSION,tool(done,'requestTravelDesk',{consent:true,confirmation:'forged'})),e=>e.status===409);
    const approval=db.get("SELECT * FROM approvals WHERE entity_type='trip' AND entity_id=? AND status='Pending'",done.travel.status.trip.id);
    const manager=db.get('SELECT * FROM users WHERE id=?',approval.approver_id);decide(db,manager,approval.id,{decision:'approve',comment:'Approved through the existing manager workflow'});
    const approved=await employeeChat(db,user,SESSION,tool(done,'checkApprovalStatus'));assert.equal(approved.travel.status.trip.status,'Approved');assert.ok(approved.travel.desk_confirmation);
    const handoff=tool(approved,'requestTravelDesk',{consent:true,confirmation:approved.travel.desk_confirmation});
    const handed=await employeeChat(db,user,SESSION,handoff);assert.equal(handed.travel.status.services.length,2);assert.equal(handed.travel.status.trip.status,'Booking In Progress');
    const again=await employeeChat(db,user,SESSION,{...handoff,request_id:randomUUID()});assert.equal(again.travel.status.services.length,2);assert.equal(db.get('SELECT COUNT(*) c FROM bookings').c,before);
  } finally {global.fetch=old;if(key===undefined)delete process.env.SERPAPI_API_KEY;else process.env.SERPAPI_API_KEY=key;}
});

test('HTTP planning uses authenticated profile and rejects stale cards, forged tools and expired selections',async()=>{
  const {db}=setup();
  let r=(await api('emp','POST','/employee-assistant/chat',msg(`Find a one-way flight to Delhi on ${addDays(today(),25)}`))).data;
  assert.equal(r.answer_kind,'travel');assert.equal(r.travel.details.dep_country,'India');
  const initial=r;
  const updated=await api('emp','POST','/employee-assistant/chat',tool(r,'updateTravelPlan',{patch:{return_date:addDays(today(),27),purpose:'Client meeting',purpose_text:'Client meeting',cost_object_type:'Cost Center',cost_object:'CC2001 - IT Dept'}}));
  assert.equal(updated.status,200);r=updated.data;
  assert.equal((await api('emp','POST','/employee-assistant/chat',tool(initial,'calculateTripCost'))).status,409);
  assert.equal((await api('emp','POST','/employee-assistant/chat',tool(r,'approveTrip'))).status,400);
  for(const patch of [{adults:0},{rooms:0},{travel_class:9},{type:0}])assert.equal((await api('emp','POST','/employee-assistant/chat',tool(r,'updateTravelPlan',{patch}))).status,400);
  assert.equal((await api('mgr','POST','/employee-assistant/chat',tool(r,'checkApprovalStatus'))).status,404);
  const stored=db.get('SELECT * FROM assistant_travel_plans WHERE id=?',r.travel.plan_id);const d=JSON.parse(stored.payload);
  d.flights={expires_at:'2000-01-01',offers:[{view:{id:'old'}}]};db.run('UPDATE assistant_travel_plans SET payload=? WHERE id=?',d,stored.id);
  assert.equal((await api('emp','POST','/employee-assistant/chat',tool(r,'selectFlight',{offer_id:'old'}))).status,410);
});

test('hotel-only planning and unavailable provider fail safely without financial side effects',async()=>{
  const {db,user}=setup();let r=await employeeChat(db,user,SESSION,msg(`Find a refundable hotel in Delhi on ${addDays(today(),20)} to ${addDays(today(),22)} under INR 5000 per night`));
  assert.equal(r.travel.details.needs_flight,false);assert.equal(r.travel.details.hotel_budget,5000);
  const key=process.env.SERPAPI_API_KEY;delete process.env.SERPAPI_API_KEY;
  try {await assert.rejects(()=>employeeChat(db,user,SESSION,tool(r,'searchHotels')),e=>e.status===503);}finally{if(key!==undefined)process.env.SERPAPI_API_KEY=key;}
  assert.equal(db.get('SELECT trip_id FROM assistant_travel_plans WHERE id=?',r.travel.plan_id).trip_id,null);
});

test('assistant round trips retain criteria, follow server tokens, and redact checkout requests',async()=>{
  const {db,user}=setup();const old=global.fetch,key=process.env.SERPAPI_API_KEY;const calls=[];process.env.SERPAPI_API_KEY='round-trip-test-key';
  global.fetch=async(url)=>{const u=new URL(url);calls.push(u);if(u.searchParams.has('booking_token'))return new Response(JSON.stringify({booking_options:[{together:{book_with:'Test provider',price:11000,booking_request:{url:'https://example.com/checkout',post_data:'offer=provider-only'}}}]}));
    const returning=u.searchParams.has('departure_token');return new Response(JSON.stringify({best_flights:[{price:returning?11000:5500,total_duration:120,...(returning?{booking_token:'private-booking-token'}:{departure_token:'private-departure-token'}),flights:[{airline:'Test airline',departure_airport:{id:returning?'BLR':'BBI',time:`${addDays(today(),20)} 08:00`},arrival_airport:{id:returning?'BBI':'BLR',time:`${addDays(today(),20)} 10:00`}}]}]}));};
  try{
    let r=await employeeChat(db,user,SESSION,msg(`Create a trip to Bangalore on ${addDays(today(),20)} returning ${addDays(today(),22)}`));
    r=await employeeChat(db,user,SESSION,tool(r,'searchFlights'));r=await employeeChat(db,user,SESSION,tool(r,'selectFlight',{offer_id:r.travel.flights.rows[0].id}));
    assert.equal(r.travel.flights.stage,1);assert.equal(calls[1].searchParams.get('departure_token'),'private-departure-token');assert.equal(calls[1].searchParams.get('return_date'),addDays(today(),22));
    r=await employeeChat(db,user,SESSION,tool(r,'getFlightBookingOptions',{offer_id:r.travel.flights.rows[0].id}));
    assert.equal(r.travel.flight_selection.selected.length,2);assert.equal(r.travel.cost.flight,11000);assert.equal(r.travel.flights.booking_options[0].provider,'Test provider');
    assert.doesNotMatch(JSON.stringify(r.travel),/private-booking-token|private-departure-token|checkout|provider-only/);
    const reviewed=await employeeChat(db,user,SESSION,tool(r,'calculateTripCost'));
    const changed=await employeeChat(db,user,SESSION,tool(reviewed,'updateTravelPlan',{patch:{departure:addDays(today(),21)}}));assert.equal(changed.travel.flight_selection,null);assert.equal(changed.travel.confirmation,null);
    await assert.rejects(()=>employeeChat(db,user,SESSION,tool(reviewed,'submitTravelRequest',{consent:true,confirmation:reviewed.travel.confirmation})),e=>e.status===409);
  }finally{global.fetch=old;if(key===undefined)delete process.env.SERPAPI_API_KEY;else process.env.SERPAPI_API_KEY=key;}
});
