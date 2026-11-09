import { createHmac, randomUUID } from 'node:crypto';
import { json } from '../db';
import { secret } from '../crypto';
import { bad, conflict, HttpError, nowIso, audit, daysBetween } from '../util';
import { containsCredentials } from '../assistant-safety';
import { extractTravel, travelIntent, travelToday } from '../travel-intent';
import { AIRPORTS } from '../constants';
import { validateFlightSearch, airportCode, CABINS } from '../flight-search';
import { validateHotelSearch, hotelParameters } from '../hotel-search';
import { fetchGoogleFlights, fetchGoogleHotels, normalizeItinerary, normalizeBookingOptions, rateLimitSerpApi } from '../providers/serpapi';
import { normalizeHotel, publicHotel } from '../providers/hotels';
import { createTrip, validateTrip, computeWorkflow } from './trips';
import { evaluateFlight, evaluateHotel } from './policy';
import { saveService } from './services';

const TOOLS = new Set(['updateTravelPlan','searchFlights','searchHotels','nextFlights','getFlightBookingOptions','getHotelDetails','selectFlight','selectHotel','selectOptions','calculateTripCost','submitTravelRequest','requestTravelDesk','checkApprovalStatus','getBookingStatus','createFlightBooking','createHotelBooking','cancelBooking']);
const TEXT = ['origin','destination','dep_country','dest_country','departure','return_date','check_in','check_out','hotel_query','purpose','purpose_text','cost_object_type','cost_object','special_requirements','departure_time'];
const NUM = ['adults','guests','rooms','children','travel_class','type','hotel_budget','flight_budget','estimated_budget','return_offset_days'];
const BOOL = ['needs_flight','needs_hotel','free_cancellation'];
const expiry = () => new Date(Date.now()+15*60000).toISOString();
const reference = (title,url)=>({title,url});
const current = (db,user,scope,conversation) => db.get('SELECT * FROM assistant_travel_plans WHERE user_id=? AND session_hash=? AND conversation_id=?',user.id,scope,conversation);
function patchPlan(data, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw bad('Enter valid travel details');
  const out = {...data};
  for(const [key,value] of Object.entries(patch)) {
    if (![...TEXT,...NUM,...BOOL,'legs','children_ages'].includes(key)) throw bad(`Unsupported travel field: ${key}`);
    if(TEXT.includes(key)) { if(typeof value!=='string'||value.length>500||containsCredentials(value)||(process.env.SERPAPI_API_KEY&&value.includes(process.env.SERPAPI_API_KEY))) throw bad('Travel fields must contain short text without credentials'); out[key]=value.trim(); }
    if(NUM.includes(key)) { if(value===''||value===null){delete out[key];continue;} const n=Number(value); if(!Number.isFinite(n)||n<0||n>10000000)throw bad('Invalid travel number'); if(['adults','guests','rooms','children','travel_class','type'].includes(key)&&(!Number.isInteger(n)||n>20))throw bad('Enter a valid whole-number count'); if(['adults','guests','rooms','hotel_budget','flight_budget'].includes(key)&&n<1)throw bad('Passenger, guest, room and budget values must be positive');if(key==='return_offset_days'&&(!Number.isInteger(n)||n>365))throw bad('Trip duration must be a whole number up to 365 days');if(key==='type'&&![1,2,3].includes(n))throw bad('Select a supported flight type');if(key==='travel_class'&&![1,2,3,4].includes(n))throw bad('Select a supported travel class');out[key]=n; }
    if(BOOL.includes(key)) { if(typeof value!=='boolean')throw bad('Invalid travel preference');out[key]=value; }
    if(key==='children_ages'){ if(!Array.isArray(value)||value.length>10||value.some(v=>!Number.isInteger(v)||v<1||v>17))throw bad('Provide valid child ages');out[key]=value; }
    if(key==='legs'){if(!Array.isArray(value)||value.length>6)throw bad('Enter at most six flight legs');out.legs=value.map(v=>({departure_id:String(v.departure_id||'').slice(0,80),arrival_id:String(v.arrival_id||'').slice(0,80),date:String(v.date||'').slice(0,10)}));}
  }
  return out;
}
function countries(db,data) {
  for(const [city,key] of [['origin','dep_country'],['destination','dest_country']]) {
    const known = AIRPORTS.find(([code,label]) => code === airportCode(data[city]) && (code === String(data[city]).toUpperCase() || label.split(' (')[0].toLowerCase() === String(data[city]).toLowerCase()));
    if(known)data[city]=known[1].split(' (')[0];
    const country=json(db.get("SELECT meta FROM master_data WHERE kind='city' AND lower(name)=lower(?) AND active=1",data[city]||'')?.meta,{}).country;
    if(country)data[key]=country;
  }
  return data;
}
function flightCriteria(d) {
  try { return validateFlightSearch({ type:d.type||1,departure_id:airportCode(d.origin),arrival_id:airportCode(d.destination),outbound_date:d.departure,return_date:d.return_date,adults:d.adults||1,children:d.children||0,travel_class:d.travel_class||1,legs:d.legs },travelToday()); }
  catch (error) { throw bad(error.message); }
}
function hotelCriteria(d) {
  try { return validateHotelSearch({q:d.hotel_query||d.destination,check_in_date:d.check_in||d.departure,check_out_date:d.check_out||d.return_date,adults:d.guests||d.adults||1,children:d.children||0,children_ages:d.children_ages||[],rooms:d.rooms||1,max_price:d.hotel_budget,free_cancellation:d.free_cancellation||false},travelToday()); }
  catch (error) { throw bad(error.message); }
}
function missing(d) {
  const fields=[];
  if(!d.destination)fields.push('destination');
  if(d.needs_flight&&!d.origin)fields.push('origin');
  if(!d.departure)fields.push('departure date');
  if((d.needs_hotel || (d.needs_flight && d.type!==2))&&!d.return_date)fields.push('return / check-out date');
  return fields;
}
function writable(row,input) {
  if(row.trip_id)throw conflict('This plan has already been submitted. Use the existing trip change workflow.');
  if(input && (input.plan_id!==row.id || Number(input.version)!==row.version))throw conflict('This travel card is out of date. Use the latest plan card.');
}
function save(db,row,data,{review=false}={}) {
  const version=row.version+1;
  const changed=db.run('UPDATE assistant_travel_plans SET payload=?,version=?,review_version=?,updated_at=? WHERE id=? AND version=?',data,version,review?version:null,nowIso(),row.id,row.version);
  if(!changed.changes)throw conflict('Travel details changed. Refresh the plan.');
  return {...row,payload:JSON.stringify(data),version,review_version:review?version:null};
}
function confirmation(row, action='submit') { return createHmac('sha256',secret()).update(`${action}:${row.id}:${row.user_id}:${row.session_hash}:${row.version}:${row.payload}`).digest('base64url'); }
const unexpired = (search) => search && search.expires_at>nowIso();
function cost(data) {
  const f=data.flight_selection?.price??null;
  const hotel=data.hotel_selection?.hotel; const rate=data.hotel_selection?.rate;
  const nightly=rate?.nightly?.amount??hotel?.nightly?.amount??null;
  const nights=data.needs_hotel?daysBetween(data.check_in||data.departure,data.check_out||data.return_date):0;
  const supplied=rate?.total?.amount??hotel?.total?.amount;
  const h=data.needs_hotel?(supplied??(nightly!==null&&nights>0?nightly*nights:null)):0;
  const complete=(!data.needs_flight||f!==null)&&(!data.needs_hotel||h!==null);
  return {flight:data.needs_flight?f:0,hotel:h,nightly,nights,total:complete?(data.needs_flight?f:0)+h:null,currency:'INR',indicative:true,fees:'Taxes, baggage, room allocation and provider fees require final verification. This is not a payable quote.'};
}
function assessment(db,user,d) {
  const checks=[];
  if(d.flight_selection && typeof d.flight_selection.price==='number')checks.push(evaluateFlight(db,{offer:{fare:d.flight_selection.price,duration:d.flight_selection.selected.reduce((n,f)=>n+(f.duration||0),0),cabin:CABINS[(d.travel_class||1)-1],date:d.departure},travelType:d.dep_country===d.dest_country?'Domestic':'International',destCountry:d.dest_country,grade:user.grade}));
  if(d.hotel_selection)checks.push(evaluateHotel(db,{hotel:{city:d.destination,pricePerNight:cost(d).nightly??Infinity,star:d.hotel_selection.hotel.stars},travelType:d.dep_country===d.dest_country?'Domestic':'International',destCountry:d.dest_country}));
  const issues=checks.flatMap(p=>p.checks.filter(c=>!c.ok&&c.severity!=='info').map(c=>c.detail));
  if(d.rooms>1)issues.push('Room count is a preference; Google Hotels does not quote a combined room allocation. Travel desk verification is required.');
  if(d.flight_budget && cost(d).flight>d.flight_budget)issues.push('Selected flight exceeds your flight budget.');
  if(cost(d).total!==null&&d.estimated_budget&&cost(d).total>d.estimated_budget)issues.push('Selections exceed the stated estimated trip budget.');
  return {status:issues.length?'Review required':'Policy checks completed; approval required',issues,rules:checks.flatMap(p=>p.rules)};
}
function requestInput(user,d) {
  const c=cost(d);
  return { created_for_type:'Self',title:`${d.purpose||'Business trip'} - ${d.destination||''}`,purpose:d.purpose,purpose_text:d.purpose_text,department:user.department,dep_country:d.dep_country,dest_country:d.dest_country,dep_city:d.origin,dest_city:d.destination,dep_date:d.departure,ret_date:d.return_date,
    travel_type:d.dep_country===d.dest_country?'Domestic':'International',travel_mode:d.needs_flight?'Flight':'Other',extra_reqs:d.needs_hotel?['Hotel accommodation']:[],company_code:user.company_code,cost_object_type:d.cost_object_type,cost_object:d.cost_object,est_budget:Math.max(c.total||0,d.estimated_budget||0),advance_needed:false,comment:`Submitted from employee-confirmed AI travel plan. ${d.special_requirements||''}`.trim() };
}
function status(db,user,row) {
  if(!row.trip_id)return null;
  const trip=db.get('SELECT id,trip_no,status,dep_date,ret_date FROM trips WHERE id=? AND traveller_id=?',row.trip_id,user.id);
  if(!trip)throw new HttpError(404,'Travel request not found');
  return {trip,services:db.all("SELECT id,srv_no,type,status FROM services WHERE trip_id=? AND created_by=? AND json_extract(details,'$.agent_plan_id')=?",trip.id,user.id,row.id),approvals:db.all("SELECT a.level,a.status,a.label FROM approvals a WHERE a.entity_type='trip' AND a.entity_id=? ORDER BY a.level",trip.id),bookings:db.all('SELECT id,type,supplier,status,travel_date,end_date,supplier_ref FROM bookings WHERE trip_id=? AND traveller_id=?',trip.id,user.id).map(b=>({...b,verification:'Recorded GENIQ status; not independently verified with a booking provider by this assistant.'}))};
}
function result(db,user,row,answer) {
  const d=json(row.payload,{});const c=cost(d); const policy=assessment(db,user,d);
  let errors=[]; try{validateTrip(db,user,requestInput(user,d),{submit:true});}catch(e){errors=e.extra?.errors||[e.message];}
  if(d.needs_flight&&!d.flight_selection)errors.unshift('Select all flight legs.');
  if(d.needs_hotel&&!d.hotel_selection)errors.unshift('Select a hotel.');
  if(d.needs_flight&&!unexpired(d.flights))errors.push('Flight prices have expired; search again.');
  if(d.needs_hotel&&!unexpired(d.hotels))errors.push('Hotel prices have expired; search again.');
  if(c.total===null&&!d.estimated_budget)errors.push('A quoted total or employee-entered estimated budget is required.');
  const {flights,hotels,flight_selection,hotel_selection,...details}=d;
  const costObjects=db.all("SELECT kind,code,name FROM master_data WHERE active=1 AND kind IN ('cost_center','project','sales_order') ORDER BY kind,code");
  const approvalRoute = computeWorkflow(db, requestInput(user,d), user);
  const existingTrips=db.all("SELECT id,trip_no,dest_city,dep_date,ret_date,status FROM trips WHERE traveller_id=? AND lower(dest_city)=lower(?) AND status NOT IN ('Cancelled','Rejected','Closed') ORDER BY dep_date LIMIT 5",user.id,d.destination||'');
  const recorded=status(db,user,row);
  return {answer,references:[reference('Travel policies','/policy'),...(row.trip_id?[reference('View itinerary',`/trips/${row.trip_id}`)]:[])],related_questions:[],answer_kind:'travel',travel:{plan_id:row.id,version:row.version,details,missing:missing(d),cost:c,policy,profile:{name:user.name,emp_id:user.emp_id,department:user.department},cost_objects:costObjects,
    flights:flights?{criteria:flights.criteria,stage:flights.stage,rows:flights.offers.map(o=>o.view),selected:flights.selected,booking_options:flights.booking_options?.map(({request,...option})=>option)||null,expires_at:flights.expires_at}:null,
    hotels:hotels?{criteria:hotels.criteria,properties:hotels.properties.map(p=>publicHotel(p.view)),expires_at:hotels.expires_at}:null,
    flight_selection:flight_selection||null,hotel_selection:hotel_selection?{hotel:publicHotel(hotel_selection.hotel),rate:hotel_selection.rate?{...hotel_selection.rate,link:undefined}:null}:null,
    existing_trips:existingTrips,approval_route:approvalRoute,submission_errors:errors,confirmation:row.review_version===row.version&&!row.trip_id&&!errors.length?confirmation(row):null,desk_confirmation:recorded&&['Approved','Booking In Progress','Travel In Progress'].includes(recorded.trip.status)&&!recorded.services.length?confirmation(row,'desk'):null,status:recorded,booking_available:false}};
}
async function flights(db,user,data,token,mode='search') {
  const criteria=flightCriteria(data);rateLimitSerpApi(db,user);
  const {legs,...rest}=criteria;
  const raw=await fetchGoogleFlights({...rest,...(legs?{multi_city_json:JSON.stringify(legs)}:{}),...(token?{[mode==='booking'?'booking_token':'departure_token']:token}:{})});
  const offers=[];
  for(const group of ['best_flights','other_flights'])for(const f of (Array.isArray(raw[group])?raw[group]:[]))if(f.flights?.length){const view=normalizeItinerary(f,randomUUID(),group==='best_flights');if(data.flight_budget&&view.price!==null&&view.price>data.flight_budget)continue;const hour=Number(view.segments[0]?.departure.time?.slice(11,13));if(data.departure_time==='morning'&&!(hour>=5&&hour<12))continue;if(data.departure_time==='afternoon'&&!(hour>=12&&hour<18))continue;if(data.departure_time==='evening'&&!(hour>=18&&hour<24))continue;offers.push({view,departure_token:f.departure_token||null,booking_token:f.booking_token||null});}
  offers.sort((a,b)=>(a.view.price??Infinity)-(b.view.price??Infinity));
  return {criteria,offers:offers.slice(0,20),stage:mode==='search'?0:data.flights.stage+(mode==='next'?1:0),selected:mode==='search'?[]:data.flights.selected,booking_options:mode==='booking'?normalizeBookingOptions(raw):null,expires_at:expiry()};
}
async function hotels(db,user,data,token) {
  const criteria=hotelCriteria(data);rateLimitSerpApi(db,user);
  const raw=await fetchGoogleHotels({...hotelParameters(criteria,!!token),...(token?{property_token:token}:{})});
  const rows=token?(raw.name?[raw]:[]):Array.isArray(raw.properties)?raw.properties:[];
  return {criteria,properties:rows.slice(0,20).map(p=>({view:normalizeHotel(p,randomUUID()),token:p.property_token||null})),expires_at:expiry()};
}
function ensureQuote(d,key){if(!unexpired(d[key]))throw new HttpError(410,'Travel search expired. Search again for current options.');}

async function discover(db,user,row) {
  const d=json(row.payload,{}); const errors=[];
  if(!d.search_requested||missing(d).length)return {row,note:''};
  for(const [needed,key,run] of [[d.needs_flight,'flights',flights],[d.needs_hotel,'hotels',hotels]])if(needed&&!d[key]) {
    try { d[key]=await run(db,user,d); } catch(e) { errors.push(e instanceof HttpError?e.message:'Search is temporarily unavailable. Try the search button again.'); }
  }
  return {row:save(db,row,d),note:errors.length?` ${errors.join(' ')}`:' Live comparison results are shown below; these are not bookings.'};
}

export async function travelAgent(db,user,scope,conversation,message,toolInput) {
  const employee=db.get('SELECT id,name,emp_id,department,grade,manager_id,home_city,company_code FROM users WHERE id=? AND active=1',user.id);
  if(!employee)throw new HttpError(401,'Please sign in to continue');
  user={...user,...employee};
  let row=current(db,user,scope,conversation);
  if(!row&&toolInput&&['checkApprovalStatus','getBookingStatus','requestTravelDesk','submitTravelRequest'].includes(toolInput.tool)) {
    const submitted=db.get('SELECT * FROM assistant_travel_plans WHERE id=? AND user_id=? AND session_hash=? AND trip_id IS NOT NULL',toolInput.plan_id,user.id,scope);
    if(submitted){db.run('UPDATE assistant_travel_plans SET conversation_id=? WHERE id=?',conversation,submitted.id);row={...submitted,conversation_id:conversation};}
  }
  const tracking=/\b(?:show|view|check)\b.*\b(?:itinerar|upcoming travel|booking status|approval status)/i.test(message);
  if(!toolInput&&!row&&!travelIntent(message)&&!tracking)return null;
  if(!toolInput&&!travelIntent(message)&&!tracking&&row&&!/^(?:yes[, ]+)?submit(?: it| this| the (?:trip|request))?[.!]?$/i.test(message)&&!/^\s*(?:choose|select|search|find|change|return|back|morning|evening|afternoon|under|budget|\d|today|tomorrow|next\b)/i.test(message)&&!/(?:client meeting|training|conference|internal meeting|site visit|show.*(?:flights|hotels))/i.test(message))return null;
  if(toolInput&&(!toolInput.tool||!TOOLS.has(toolInput.tool)))throw bad('Unsupported travel tool');
  if(!row) {
    if(toolInput)throw new HttpError(404,'Start a travel plan in this conversation first.');
    if(tracking){const rows=db.all('SELECT id,trip_no,dest_city,dep_date,ret_date,status FROM trips WHERE traveller_id=? AND ret_date>=? ORDER BY dep_date LIMIT 15',user.id,travelToday());return {answer:rows.length?`## Your upcoming itineraries\n\n${rows.map(t=>`- [${t.trip_no}: ${t.dest_city}](/trips/${t.id}) — ${t.dep_date} to ${t.ret_date}; recorded status: ${t.status}`).join('\n')}`:'No upcoming travel requests were found.',references:[reference('My trips','/trips')],related_questions:[],answer_kind:'internal'};}
    const data=countries(db,{origin:user.home_city||'',needs_flight:true,needs_hotel:false,type:1,adults:1,guests:1,rooms:1,travel_class:1,search_requested:/\b(find|search|book|need)\b/i.test(message),...extractTravel(message)});
    const id=randomUUID();db.run('INSERT INTO assistant_travel_plans(id,conversation_id,user_id,session_hash,payload,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',id,conversation,user.id,scope,data,nowIso(),nowIso(),new Date(Date.now()+86400000).toISOString());row=current(db,user,scope,conversation);
    audit(db,user,'agent.plan.create','assistant_travel_plan',id,'Created structured travel planning context; no trip or booking created');
    const found=await discover(db,user,row);row=found.row;
    return result(db,user,row,(missing(data).length?`I can plan this trip. Please provide: ${missing(data).join(', ')}. Review the details below; nothing has been submitted or reserved.`:'Travel details are ready to review. Use Search flights / Search hotels for live comparison results. Nothing is reserved.')+found.note);
  }
  if(row.expires_at<=nowIso()&&!row.trip_id)throw new HttpError(410,'This travel plan expired. Start a new conversation.');
  if(toolInput&&toolInput.plan_id!==row.id)throw new HttpError(404,'Travel plan not found in this conversation');
  const d=json(row.payload,{});let tool=toolInput?.tool;let args=toolInput?.args||{};
  if(!tool) {
    if(tracking)tool='checkApprovalStatus';
    else if(/^(?:yes[, ]+)?submit(?: it| this| the (?:trip|request))?[.!]?$/i.test(message)) {tool='submitTravelRequest';args={confirmation:row.review_version===row.version?confirmation(row):null,consent:true};}
    else if(/\b(?:choose|select)\b/i.test(message)) {
      const ordinal=message.match(/\b(first|second|third|fourth|fifth|\d+)\b/i)?.[1];const n=({first:0,second:1,third:2,fourth:3,fifth:4})[ordinal?.toLowerCase()]??(Number(ordinal)-1);
      if(/flight/i.test(message)&&/hotel/i.test(message)) {
        const hotelOrdinal=message.match(/\b(first|second|third|fourth|fifth|\d+)\s+hotel/i)?.[1]?.toLowerCase();const hi=({first:0,second:1,third:2,fourth:3,fifth:4})[hotelOrdinal]??(Number(hotelOrdinal)-1);
        const flight=/morning/i.test(message)?d.flights?.offers.find(o=>{const h=Number(o.view.segments[0]?.departure.time?.slice(11,13));return h>=5&&h<12;}):d.flights?.offers[n];
        tool='selectOptions';args={flight_offer_id:flight?.view.id,hotel_offer_id:d.hotels?.properties[hi]?.view.id};
      }
      else if(/hotel/i.test(message)){tool='selectHotel';args={offer_id:d.hotels?.properties[n]?.view.id};}
      else {tool='selectFlight';const morning=/morning/i.test(message)?d.flights?.offers.find(o=>{const h=Number(o.view.segments[0]?.departure.time?.slice(11,13));return h>=5&&h<12;}):null;args={offer_id:morning?.view.id||d.flights?.offers[n]?.view.id};}
    } else if(/^(search|find)\b/i.test(message)&&!Object.keys(extractTravel(message,d)).filter(k=>!['needs_flight','needs_hotel'].includes(k)).length)tool=/hotel/i.test(message)?'searchHotels':'searchFlights';
    else {tool='updateTravelPlan';args={patch:extractTravel(message,d)};}
  }
  if(['checkApprovalStatus','getBookingStatus'].includes(tool))return result(db,user,row,row.trip_id?'Current approval and booking records are shown below. Provider verification is not available through this assistant.':'This plan has not been submitted for approval. Review the itinerary before submitting.');
  if(tool==='requestTravelDesk') {
    if(!row.trip_id)throw conflict('Submit the trip and wait for approval before requesting travel-desk booking.');
    return db.tx(()=>{
      const trip=db.get('SELECT * FROM trips WHERE id=? AND traveller_id=?',row.trip_id,user.id);
      if(!trip||!['Approved','Booking In Progress','Travel In Progress'].includes(trip.status))throw conflict('Manager approval is required before a travel-desk request.');
      const existing=db.all("SELECT id FROM services WHERE trip_id=? AND created_by=? AND json_extract(details,'$.agent_plan_id')=?",trip.id,user.id,row.id);
      if(existing.length)return result(db,user,row,'These options were already sent to the travel desk. No duplicate service requests were created.');
      if(toolInput?.version!==row.version||args.consent!==true||args.confirmation!==confirmation(row,'desk'))throw conflict('Review the approved itinerary and explicitly authorize sending it to the travel desk.');
      const common={agent_plan_id:row.id,reservation_status:'Not booked; travel desk must verify pricing, terms and provider confirmation',special_requirements:d.special_requirements||''};
      const comment='Employee authorized sending selected options for travel desk review. Estimates must be revalidated; this does not authorize a charge or confirm a booking.';
      if(d.needs_flight)saveService(db,user,trip.id,{type:'flight',channel:'agency',comment,details:{...common,from:d.origin,to:d.destination,depart_date:d.departure,return_date:d.return_date,passengers:d.adults,children:d.children||0,cabin:CABINS[(d.travel_class||1)-1],preferred_time:d.departure_time||'Any time',selected_itineraries:d.flight_selection?.selected||[],quoted_total:cost(d).flight}});
      if(d.needs_hotel)saveService(db,user,trip.id,{type:'hotel',channel:'agency',comment,details:{...common,city:d.destination,check_in:d.check_in||d.departure,check_out:d.check_out||d.return_date,rooms:d.rooms,guests:d.guests,hotel_name:d.hotel_selection?.hotel.name||'',hotel_address:d.hotel_selection?.hotel.address||'',quoted_total:cost(d).hotel,quoted_nightly:cost(d).nightly}});
      audit(db,user,'agent.desk.request','trip',trip.id,`Explicit review request for plan ${row.id}; no ticket, reservation or payment`);
      return result(db,user,row,'Your selected options have been sent to the travel desk through the existing agency workflow. They are not bookings. The desk must verify availability, final prices and terms.');
    });
  }
  if(['createFlightBooking','createHotelBooking','cancelBooking'].includes(tool))throw new HttpError(503,'Transactional booking and cancellation are not configured. No reservation or payment was made. Use the travel desk workflow after approval.');
  if(tool==='submitTravelRequest' && row.trip_id)return result(db,user,row,'This travel plan was already submitted. No duplicate request was created.');
  writable(row,toolInput);
  if(tool==='updateTravelPlan') {
    const next=countries(db,patchPlan(d,args.patch));
    if(!toolInput&&/\b(?:show|search|find)\b/i.test(message))next.search_requested=true;
    const changed=(keys)=>keys.some(k=>JSON.stringify(next[k])!==JSON.stringify(d[k]));
    if(changed(['origin','destination','departure','return_date','adults','children','travel_class','type','legs','flight_budget','departure_time','needs_flight'])){delete next.flights;delete next.flight_selection;}
    if(changed(['destination','departure','return_date','check_in','check_out','guests','children','children_ages','rooms','hotel_query','hotel_budget','free_cancellation','needs_hotel'])){delete next.hotels;delete next.hotel_selection;}
    row=save(db,row,next);const found=await discover(db,user,row);row=found.row;return result(db,user,row,(missing(next).length?`Please provide: ${missing(next).join(', ')}.`:'Travel details updated. Search again to use prices for these exact dates and preferences.')+found.note);
  }
  if(tool==='searchFlights'){d.flights=await flights(db,user,d);delete d.flight_selection;}
  if(tool==='searchHotels'){d.hotels=await hotels(db,user,d);delete d.hotel_selection;}
  if(['selectFlight','nextFlights','getFlightBookingOptions','selectOptions'].includes(tool)) {
    ensureQuote(d,'flights');const offer=d.flights.offers.find(o=>o.view.id===(args.flight_offer_id||args.offer_id));if(!offer)throw bad('Select a flight returned in this plan.');
    const total=d.flights.criteria.type===1?2:d.flights.criteria.type===3?d.flights.criteria.legs.length:1;
    if(tool==='getFlightBookingOptions') {
      if(d.flights.stage!==total-1||!offer.booking_token)throw conflict('Select every itinerary leg before viewing booking options.');
      const selected=[...d.flights.selected,offer.view];d.flights=await flights(db,user,d,offer.booking_token,'booking');d.flights.selected=selected;
      d.flight_selection={selected,price:offer.view.price};
    } else if(d.flights.stage<total-1){if(!offer.departure_token)throw conflict('No continuation is available for this flight. Choose another option.');const selected=[...d.flights.selected,offer.view];d.flights=await flights(db,user,d,offer.departure_token,'next');d.flights.selected=selected;delete d.flight_selection;}
    else d.flight_selection={selected:[...d.flights.selected,offer.view],price:offer.view.price};
  }
  if(['selectHotel','getHotelDetails','selectOptions'].includes(tool)) {
    ensureQuote(d,'hotels');const property=d.hotels.properties.find(p=>p.view.id===(args.hotel_offer_id||args.offer_id));if(!property)throw bad('Select a hotel returned in this plan.');
    if(tool==='getHotelDetails'){if(!property.token)throw conflict('Property details are unavailable.');d.hotels=await hotels(db,user,d,property.token);delete d.hotel_selection;}
    else {const rate=args.rate_id?property.view.rates.find(r=>r.id===args.rate_id):null;if(args.rate_id&&!rate)throw bad('Choose a rate returned for this hotel');d.hotel_selection={hotel:property.view,rate};}
  }
  if(tool==='submitTravelRequest') {
    if(args.consent!==true||!args.confirmation||row.review_version!==row.version||args.confirmation!==confirmation(row))throw conflict('Review the current trip summary and explicitly confirm submission first.');
    const preview=result(db,user,row,'');if(preview.travel.submission_errors.length)throw bad(preview.travel.submission_errors[0]);
    const input=requestInput(user,d);
    input.comment = `${input.comment} Policy review: ${preview.travel.policy.issues.join('; ') || 'No exceptions identified by available rules.'}`.slice(0,2000);
    return db.tx(()=>{
      const latest=current(db,user,scope,conversation);if(latest.trip_id)return result(db,user,latest,'This plan was already submitted.');if(latest.version!==row.version)throw conflict('Travel details changed. Review again.');
      const existing=db.get("SELECT id FROM trips WHERE traveller_id=? AND dep_city=? AND dest_city=? AND dep_date=? AND ret_date=? AND status NOT IN ('Cancelled','Rejected','Closed')",user.id,d.origin,d.destination,d.departure,d.return_date);
      if(existing)throw conflict(`A matching trip already exists. Review trip ${existing.id} in My Trips instead of creating a duplicate.`);
      const trip=createTrip(db,user,input,{submit:true});
      const snapshot={criteria:d.flights?.criteria,selected:d.flight_selection?.selected,indicative_price:cost(d).flight,currency:'INR',source:'AI travel plan; not a reservation'};
      if(d.flight_selection)db.run('INSERT INTO flight_options(id,trip_id,user_id,fingerprint,snapshot,created_at) VALUES(?,?,?,?,?,?)',randomUUID(),trip.id,user.id,row.id,snapshot,nowIso());
      db.run('UPDATE assistant_travel_plans SET trip_id=?,updated_at=? WHERE id=?',trip.id,nowIso(),row.id);
      audit(db,user,'agent.trip.submit','trip',trip.id,`Explicit employee confirmation for plan ${row.id}; no booking or payment`);
      return result(db,user,{...row,trip_id:trip.id},`Your travel request ${trip.trip_no} has been submitted for approval. Flights and hotels are not booked. Selected options remain indicative and will need revalidation after approval.`);
    });
  }
  row=save(db,row,d,{review:tool==='calculateTripCost'});
  audit(db,user,`agent.${tool}`,'assistant_travel_plan',row.id,'Structured travel tool completed; no payment or reservation');
  return result(db,user,row,tool==='calculateTripCost'?'Review your itinerary, estimated costs, policy checks and approval route. Submit only when these details are correct.':tool.startsWith('search')?'Live search results are shown below. Prices are estimates; no reservation has been made.':'Selection updated. Review the trip summary before submitting.');
}
