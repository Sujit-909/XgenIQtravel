import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-p', '3105'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, DATABASE_PATH: ':memory:', AUTH_SECRET: 'local-assistant-ui-qa', DEMO_OTP: '246810' } });
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
  const results=[]; mkdirSync('.next/assistant-qa',{recursive:true});
  await send('Page.navigate',{url:'http://localhost:3105/login'}); await pause(1000);
  const auth = await evaluate(`(async () => { const first = await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identifier:'sujit@xgeniq.com',password:'Sujit@909'})}); const body=await first.json(); const second=await fetch('/api/auth/mfa',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:body.token,code:'246810',remember:false})}); return second.status; })()`);
  assert.equal(auth,200);
  for (const [width,height] of [[1366,768],[1440,900],[1600,900],[1920,1080],[1024,900],[390,844]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:'http://localhost:3105/assistant'});
    for(let i=0;i<80;i++){ await pause(100); if(await evaluate("!!document.querySelector('.employee-services')"))break; }
    await pause(500);
    const layout=await evaluate(`({height:innerHeight,documentHeight:document.documentElement.scrollHeight,headerHeight:document.querySelector('.topbar').getBoundingClientRect().height,sections:Object.fromEntries(['.page-head','.employee-history','.employee-services','.employee-chat-panel','.employee-chat-compose','.employee-message-input button[type=submit]'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return [selector,{top:r.top,bottom:r.bottom,height:r.height}]})),width:innerWidth,documentWidth:document.documentElement.scrollWidth,cards:document.querySelectorAll('.employee-service').length,font:getComputedStyle(document.body).fontFamily,sendDisabled:document.querySelector('.employee-message-input button[type=submit]').disabled})`);
    assert.equal(await evaluate("document.querySelectorAll('.employee-hero,.employee-chat-toolbar').length"),0);
    assert.equal(layout.cards,5); assert.ok(layout.documentWidth<=width); assert.ok(layout.sendDisabled);
    if(width>=1100 && !process.env.ASSISTANT_BASELINE) {
      assert.ok(layout.documentHeight<=height,JSON.stringify(layout));
      for(const box of Object.values(layout.sections)){assert.ok(box.height>0 && box.top>=0 && box.bottom<=height+1,JSON.stringify(layout));}
      const cardTops=await evaluate("[...document.querySelectorAll('.employee-service')].map(el=>el.getBoundingClientRect().top)"); assert.equal(new Set(cardTops).size,1);
      assert.ok(layout.sections['.employee-services'].height<=106);
      const expandedWidth=await evaluate("document.querySelector('.employee-main').getBoundingClientRect().width");
      await evaluate("document.querySelector('.employee-history-collapse').click()"); await pause(300);
      assert.equal(Math.round(await evaluate("document.querySelector('.employee-history').getBoundingClientRect().width")),64);
      assert.ok(await evaluate("document.querySelector('.employee-main').getBoundingClientRect().width")>expandedWidth);
      await evaluate("document.querySelector('.employee-history-collapse').click()"); await pause(300);
      assert.equal(Math.round(await evaluate("document.querySelector('.employee-history').getBoundingClientRect().width")),220);
      const stress=await evaluate(`(() => {const log=document.querySelector('.employee-chat-log');const node=document.createElement('div');node.style.cssText='height:3000px;flex-shrink:0';node.textContent='Long conversation layout stress fixture';log.append(node);log.scrollTop=1000;const result={documentHeight:document.documentElement.scrollHeight,logHeight:log.clientHeight,scrollHeight:log.scrollHeight,scrollTop:log.scrollTop,composerBottom:document.querySelector('.employee-chat-compose').getBoundingClientRect().bottom};node.remove();return result;})()`);
      assert.ok(stress.scrollHeight>stress.logHeight && stress.scrollTop>0);assert.ok(stress.documentHeight<=height && stress.composerBottom<=height+1);layout.longConversation=stress;
    }
    for(let i=0;i<5;i++) { await evaluate(`document.querySelectorAll('.employee-service')[${i}].click()`); await pause(100); assert.ok(await evaluate("document.querySelector('textarea').value.length > 0")); }
    if(width===390){ await evaluate("document.querySelector('.employee-history-toggle').click()"); await pause(100); assert.equal(await evaluate("getComputedStyle(document.querySelector('.employee-history')).display"),'flex'); await evaluate("document.querySelector('.employee-drawer-close').click()"); }
    await evaluate('window.scrollTo(0,0)'); await pause(100);
    const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true}); writeFileSync(`.next/assistant-qa/${width}.png`,Buffer.from(screenshot.data,'base64')); results.push(layout);
  }
  // Use the existing company-information path; no external AI response is fabricated.
  await evaluate("document.querySelectorAll('.employee-service')[2].click()"); await pause(100);
  await evaluate("document.querySelector('.employee-message-input button[type=submit]').click()");
  for(let i=0;i<100;i++){await pause(100);if(await evaluate("!!document.querySelector('.employee-answer') || !!document.querySelector('[role=alert]')"))break;}
  assert.equal(await evaluate("document.querySelectorAll('.employee-user').length"),1);
  assert.equal(await evaluate("document.querySelectorAll('.employee-answer').length"),1);
  assert.equal(await evaluate("document.querySelector('.page-head a[href=\"/trips/new\"]').getAttribute('href')"),'/trips/new');
  assert.equal(await evaluate("document.querySelector('.page-head a[href=\"/expenses/new\"]').getAttribute('href')"),'/expenses/new');
  await evaluate("document.querySelector('.employee-retry').click()");
  for(let i=0;i<100;i++){await pause(100);if(await evaluate("!!document.querySelector('.employee-answer') && !document.querySelector('.employee-thinking')"))break;}
  assert.equal(await evaluate("document.querySelectorAll('.employee-answer').length"),1);
  const sources=await evaluate("document.querySelectorAll('.employee-sources a').length");
  await evaluate("document.querySelector('.employee-history-toggle').click()"); await pause(100);
  await evaluate("document.querySelector('.employee-new-conversation').click()");
  for(let i=0;i<50;i++){await pause(100);if(await evaluate("!!document.querySelector('.employee-chat-empty')"))break;}
  assert.ok(await evaluate("!!document.querySelector('.employee-chat-empty')"));
  await evaluate("document.querySelector('.employee-history-toggle').click()"); await pause(100);
  assert.equal(await evaluate("document.querySelectorAll('.employee-history-entry').length"),1);
  await evaluate("document.querySelector('.employee-history-entry .icon-btn').click()"); await pause(100);
  await evaluate("document.querySelectorAll('.employee-history nav button')[1].click()"); await pause(100);
  assert.equal(await evaluate("document.querySelectorAll('.employee-history-entry').length"),1);
  await evaluate("document.querySelector('.employee-history-entry .employee-history-item').click()"); await pause(100);
  assert.ok(await evaluate("document.querySelector('.employee-chat-compose').hidden"));
  assert.ok(await evaluate("!document.querySelector('.employee-history').classList.contains('is-open')"));
  assert.equal(await evaluate("document.querySelectorAll('.employee-answer').length"),1);
  assert.ok(sources>0);
  await evaluate("[...document.querySelectorAll('.employee-chat-notice button')].find(b=>b.textContent.includes('Return to current')).click()"); await pause(100);
  await evaluate("document.querySelectorAll('.employee-service')[1].click()"); await pause(100);
  await evaluate("document.querySelector('.employee-message-input button[type=submit]').click()");
  for(let i=0;i<80;i++){await pause(100);if(await evaluate("!!document.querySelector('.agent-plan')"))break;}
  assert.equal(await evaluate("document.querySelectorAll('.agent-plan').length"),1);
  assert.ok(await evaluate("document.querySelector('.agent-details').textContent.includes('destination')"));
  await evaluate("document.querySelector('.employee-message-input textarea').focus()");
  const dep=new Date(Date.now()+25*86400000).toISOString().slice(0,10), ret=new Date(Date.now()+27*86400000).toISOString().slice(0,10);
  await send('Input.insertText',{text:`I need a trip to Bangalore on ${dep} returning ${ret} for a client meeting.`});
  await evaluate("document.querySelector('.employee-message-input button[type=submit]').click()");
  for(let i=0;i<80;i++){await pause(100);if(await evaluate("document.querySelectorAll('.agent-plan').length===2"))break;}
  assert.equal(await evaluate("document.querySelectorAll('.agent-plan').length"),2);
  await pause(300);
  assert.ok(await evaluate("(() => {const log=document.querySelector('.employee-chat-log');return log.scrollHeight-log.scrollTop-log.clientHeight<80;})()"));
  assert.ok(await evaluate("[...document.querySelectorAll('.agent-summary')].at(-1).textContent.includes('Bengaluru')"));
  for(const [width,height] of [[1366,768],[1440,900],[1920,1080]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await pause(300);
    const check=await evaluate("({height:innerHeight,documentHeight:document.documentElement.scrollHeight,width:innerWidth,documentWidth:document.documentElement.scrollWidth,composerBottom:document.querySelector('.employee-chat-compose').getBoundingClientRect().bottom,logScroll:document.querySelector('.employee-chat-log').scrollHeight>document.querySelector('.employee-chat-log').clientHeight})");
    assert.ok(check.documentHeight<=height&&check.documentWidth<=width&&check.composerBottom<=height&&check.logScroll);results.push({travelCard:check});
    const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`.next/assistant-qa/travel-${width}.png`,Buffer.from(shot.data,'base64'));
  }
  const report={results,sources,errors}; writeFileSync('.next/assistant-qa/results.json',JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2)); assert.equal(errors.length,0);
} finally { ws?.close(); chrome.kill(); server.kill(); }
