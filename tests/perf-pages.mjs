// Production browser benchmark. Uses the app's own seed in an isolated in-memory DB.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const pause = ms => new Promise(r => setTimeout(r, ms));
const mode = process.argv.includes('--dev') ? 'dev' : 'start';
const label = process.argv.find(a => a.startsWith('--label='))?.split('=')[1] || 'current';
const logs = [];
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), mode, '-p', '3106'], { windowsHide: true, env: { ...process.env, DATABASE_PATH: ':memory:', AUTH_SECRET: 'isolated-performance-test-secret', DEMO_OTP: '246810' }, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', d => logs.push(String(d))); server.stderr.on('data', d => logs.push(String(d)));
const profile = mkdtempSync(path.join(tmpdir(), 'geniq-perf-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws;
try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i=0;i<150 && !existsSync(portFile);i++) await pause(200);
  const port = readFileSync(portFile,'utf8').split('\n')[0];
  for(let i=0;i<150;i++){try{if((await fetch('http://localhost:3106/login')).ok)break;}catch{}await pause(200);}
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let seq=0;const pending=new Map();const errors=[];
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(m.error):p?.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value||a.description));};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  async function visit(route){
    await send('Page.navigate',{url:'http://localhost:3106'+route});
    for(let i=0;i<600;i++){await pause(50);if(await ev(`document.readyState==='complete' && location.pathname===${JSON.stringify(route)} && !!document.querySelector('h1')`))break;}
    await pause(250);
    return ev(`(() => {const n=performance.getEntriesByType('navigation')[0];return {route:location.pathname,ttfbMs:n.responseStart,domContentLoadedMs:n.domContentLoadedEventEnd,loadMs:n.loadEventEnd,jsBytes:performance.getEntriesByType('resource').filter(r=>r.initiatorType==='script').reduce((s,r)=>s+r.encodedBodySize,0),resourceCount:performance.getEntriesByType('resource').length};})()`);
  }
  const login=await visit('/login');
  const roles=[];
  for(const [role,email] of [['employee','sujit@xgeniq.com'],['manager','manager@xgeniq.com'],['finance','karan.mehta@abccorp.com'],['admin','admin@xgeniq.com']]){
    const auth=await ev(`(async()=>{const a=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identifier:${JSON.stringify(email)},password:'Sujit@909'})});const d=await a.json();const m=await fetch('/api/auth/mfa',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:d.token,code:'246810'})});return m.status;})()`);
    assert.equal(auth,200);
    const dashboard=await visit('/dashboard');assert.equal(dashboard.route,'/dashboard');
    const routes=[];
    for(const route of ['/trips','/bookings','/expenses','/approvals','/notifications','/profile']){
      const start=Date.now();
      const clicked=await ev(`(() => {const a=document.querySelector('a[href="${route}"]');if(!a)return false;a.click();return true;})()`);
      if(clicked){for(let i=0;i<600;i++){await pause(20);if(await ev(`location.pathname==='${route}' && !!document.querySelector('.page-head')`))break;}await pause(100);routes.push({route,navigationMs:Date.now()-start});}
      else routes.push(await visit(route));
    }
    const apis=await ev(`(async()=>{const out=[];for(const url of ['/auth/me','/trips','/bookings','/expenses','/approvals']){const samples=[];let status;for(let i=0;i<5;i++){const t=performance.now();const r=await fetch('/api'+url);await r.text();status=r.status;samples.push(performance.now()-t);}samples.sort((a,b)=>a-b);out.push({url,status,medianMs:samples[2],samples});}return out;})()`);
    const forbidden=await ev(`fetch('/api/users').then(r=>r.status)`);
    if(role!=='admin')assert.equal(forbidden,403);
    const logout=await ev(`fetch('/api/auth/logout',{method:'POST'}).then(r=>r.status)`);assert.equal(logout,200);
    assert.equal(await ev(`fetch('/api/auth/me').then(r=>r.status)`),401);
    roles.push({role,dashboard,routes,apis,logout,usersStatus:forbidden});
    await visit('/login');
  }
  // Exercise real React controls separately so this does not warm timed routes.
  const waitFor=async expression=>{for(let i=0;i<300;i++){if(await ev(expression))return;await pause(50);}throw new Error('Timed out: '+expression);};
  await visit('/login');
  await ev(`document.querySelector('input[autocomplete=username]').focus()`);
  await send('Input.insertText',{text:'sujit@xgeniq.com'});
  await ev(`document.querySelector('input[autocomplete=current-password]').focus()`);
  await send('Input.insertText',{text:'Sujit@909'});
  await ev(`document.querySelector('form').requestSubmit()`);
  await waitFor(`location.pathname==='/mfa' && !!document.querySelector('.otp input')`);
  for(const [i,digit] of [...'246810'].entries()){
    await ev(`document.querySelectorAll('.otp input')[${i}].focus()`);
    await send('Input.insertText',{text:digit});await pause(30);
  }
  await ev(`document.querySelector('form').requestSubmit()`);
  await waitFor(`location.pathname==='/dashboard' && !!document.querySelector('.page-head')`);
  await ev(`document.querySelector('button[aria-label="Account options"]').click()`);
  await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Sign out').click()`);
  await waitFor(`location.pathname==='/login' && !!document.querySelector('.login-card')`);
  assert.equal(await ev(`fetch('/api/auth/me').then(r=>r.status)`),401);
  const sso=await ev(`fetch('/api/auth/sso',{method:'POST'}).then(async r=>({status:r.status,body:await r.json()}))`);
  assert.equal(sso.status,501);assert.match(sso.body.error,/not configured/);
  mkdirSync('performance-results',{recursive:true});
  const report={mode,label,conditions:'Local Chrome headless, 1440x900, no CPU/network throttling, isolated app seed, sequential roles; navigation timings include 100ms settling and 20ms polling. Load metrics are not hydration timings.',login,roles,browserInteractions:['login form','MFA controls and redirect','account-menu logout','SSO reports unconfigured'],errors};
  writeFileSync(`performance-results/${label}.json`,JSON.stringify(report,null,2));
  writeFileSync(`performance-results/${label}-server.log`,logs.join(''));
  assert.equal(errors.length,0,JSON.stringify(errors));
  console.log(JSON.stringify(report,null,2));
} finally {ws?.close();chrome.kill();server.kill();}
