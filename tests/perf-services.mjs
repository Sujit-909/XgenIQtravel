import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fresh, api } from './helpers';
import { listApprovals } from '../src/lib/services/approvals';
const label = process.argv.find(a=>a.startsWith('--label='))?.split('=')[1] || 'current';
const db = fresh();
const records=[];let active;
const measured={...db};
for(const kind of ['all','get','run']) measured[kind]=(...args)=>{
  const t=performance.now();const result=db[kind](...args);
  if(active){active.queries++;active.sqlMs+=performance.now()-t;if(Array.isArray(result))active.rows+=result.length;}
  return result;
};
globalThis.__geniqDb=measured;
for(const role of ['emp','mgr','fin','admin']){
  await api(role,'GET','/auth/me');
  for(const route of ['/dashboard','/trips','/bookings','/expenses','/approvals','/profile','/notifications','/reports/department_spend']){
    const samples=[];
    for(let i=0;i<25;i++){
      active={queries:0,sqlMs:0,rows:0};const start=performance.now();
      const r=await api(role,'GET',route);const ms=performance.now()-start;
      samples.push({ms,...active,status:r.status});active=null;
    }
    samples.sort((a,b)=>a.ms-b.ms);
    records.push({role,route,median:samples[12],p95:samples[23]});
  }
}
const manager=db.get("SELECT * FROM users WHERE role='manager' LIMIT 1");
const template=db.get("SELECT * FROM approvals WHERE entity_type='trip' LIMIT 1");
db.tx(()=>{for(let i=0;i<20000;i++)db.run('INSERT INTO approvals(entity_type,entity_id,level,label,approver_id,approver_role,status,created_at) VALUES(?,?,?,?,?,?,?,?)','trip',template.entity_id,1,'Performance fixture',manager.id,null,i%2?'Approved':'Pending',template.created_at);});
const samples=[];
for(let i=0;i<25;i++){active={queries:0,sqlMs:0,rows:0};const start=performance.now();listApprovals(measured,manager);samples.push({ms:performance.now()-start,...active});active=null;}
samples.sort((a,b)=>a.ms-b.ms);
records.push({role:'mgr',route:'/approvals (20,000 additional rows, isolated scaling fixture)',median:samples[12],p95:samples[23]});
mkdirSync('performance-results',{recursive:true});
writeFileSync(`performance-results/services-${label}.json`,JSON.stringify({conditions:'Seeded isolated in-memory SQLite; 25 warm service-dispatch calls including authorization and JSON serialization; not HTTP latency.',records},null,2));
console.log(JSON.stringify(records,null,2));
