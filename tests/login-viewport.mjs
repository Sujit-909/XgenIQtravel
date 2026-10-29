import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-p', '3105'], { windowsHide: true, stdio: 'ignore' });
const profile = mkdtempSync(path.join(tmpdir(), 'geniq-login-qa-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws;
try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i=0; i<100 && !existsSync(portFile); i++) await pause(200);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  for (let i=0; i<100; i++) { try { if ((await fetch('http://localhost:3105/login')).ok) break; } catch {} await pause(200); }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => { ws.onopen=resolve; ws.onerror=reject; });
  let seq=0; const pending=new Map(); const errors=[];
  ws.onmessage = ({data}) => { const m=JSON.parse(data); if(m.id) { const p=pending.get(m.id); pending.delete(m.id); m.error ? p?.reject(m.error) : p?.resolve(m.result); } else if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); else if(m.method==='Runtime.consoleAPICalled' && m.params.type==='error') errors.push(m.params.args.map((a)=>a.value || a.description).join(' ')); };
  const send = (method,params={}) => new Promise((resolve,reject) => { const id=++seq; pending.set(id,{resolve,reject}); ws.send(JSON.stringify({id,method,params})); });
  const evaluate = async (expression) => (await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
  await send('Page.enable'); await send('Runtime.enable');
  const results=[]; mkdirSync('.next/login-qa',{recursive:true});
  for (const [width,height] of [[1366,768],[1440,900],[1920,1080],[1366,650],[390,844]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:'http://localhost:3105/login'});
    for(let i=0;i<80;i++) { await pause(100); if(await evaluate("document.readyState === 'complete' && !!document.querySelector('.login-card')")) break; }
    await pause(300);
    const measure=()=>evaluate(`(() => { const card=document.querySelector('.login-card').getBoundingClientRect(); const panel=document.querySelector('.login-auth-panel'); return { width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,panelScroll:panel.scrollHeight>panel.clientHeight+1,cardTop:Math.round(card.top),cardBottom:Math.round(card.bottom),allControlsVisible:card.top>=0 && card.bottom<=innerHeight }; })()`);
    const signin=await measure();
    await evaluate("[...document.querySelectorAll('.login-tabs button')].find(b=>b.textContent==='Create Account').click()"); await pause(100);
    const registration=await measure();
    results.push({viewport:`${width}x${height}`,signin,registration});
    if(width===1366 && height===768) { await evaluate("document.querySelector('.login-tabs button').click()"); await pause(100); const shot=await send('Page.captureScreenshot',{format:'png'}); writeFileSync('.next/login-qa/1366.png',Buffer.from(shot.data,'base64')); }
  }
  for (const result of results.filter(r=>!r.viewport.startsWith('390'))) {
    for (const state of [result.signin,result.registration]) {
      assert.equal(state.documentWidth,state.width,result.viewport+' horizontal overflow');
      assert.equal(state.documentHeight,state.height,result.viewport+' document scroll');
      assert.equal(state.panelScroll,false,result.viewport+' panel scroll');
      assert.equal(state.allControlsVisible,true,result.viewport+' clipped controls');
    }
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://localhost:3105/login'});
  await pause(800);
  assert.equal(await evaluate("document.querySelector('input[autocomplete=current-password]').type"),'password');
  await evaluate("document.querySelector('button[aria-label=\"Show password\"]').click()");
  await pause(100);
  assert.equal(await evaluate("document.querySelector('input[autocomplete=current-password]').type"),'text');
  const remembered=await evaluate("document.querySelector('input[type=checkbox]').checked");
  await evaluate("document.querySelector('input[type=checkbox]').click()"); await pause(100);
  assert.equal(await evaluate("document.querySelector('input[type=checkbox]').checked"),!remembered);
  assert.equal(await evaluate("document.querySelector('a[href=\"/forgot-password\"]').getAttribute('href')"),'/forgot-password');
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Sign in with SSO')).click()");
  for(let i=0;i<50;i++){await pause(100);if(await evaluate("!!document.querySelector('[role=alert]')"))break;}
  assert.match(await evaluate("document.querySelector('[role=alert]').textContent"),/SSO is not configured/);
  // The expected SSO HTTP 501 is represented by the inline message, not a JS exception.
  const report={results,errors,interactionChecks:['password visibility','remember me toggle','forgot-password link','SSO inline error','registration tab']};
  writeFileSync('.next/login-qa/results.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally { ws?.close(); chrome.kill(); server.kill(); }
