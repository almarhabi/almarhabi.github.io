// Real same-origin Web Locks integration: two tabs call the actual akStart entry point.
// No API/credentials/live-data calls: generation is deliberately held using an in-page mock.
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let pw;try{pw=require('../runner/node_modules/playwright-core')}catch(e){pw=require('playwright-core')}
const html=fs.readFileSync(process.env.AI_AUDIT_SOURCE||path.join(__dirname,'../../index.html'),'utf8');
(async()=>{const browser=await pw.chromium.launch({executablePath:process.env.CHROMIUM_PATH||process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});try{
  const context=await browser.newContext({reducedMotion:'reduce'});await context.route('**/*',r=>r.request().url()==='https://uqu.test/'?r.fulfill({contentType:'text/html',body:html}):r.abort());
  const first=await context.newPage(),second=await context.newPage(),crashes=[];for(const p of[first,second]){p.on('pageerror',e=>crashes.push(e.message));await p.goto('https://uqu.test/');await p.waitForFunction(()=>typeof akStart==='function');assert(await p.evaluate(()=>!!navigator.locks),'secure Chromium context must expose Web Locks')}
  const id=await first.evaluate(()=>ALL.find(needsStudy).id);
  for(const p of[first,second])await p.evaluate(id=>{window.testStarted=0;window.startTest=()=>{window.testRun=akStart(id,'new',0);window.testResult=null;window.testRun.p.then(()=>{window.testResult={ok:true}},e=>{window.testResult={ok:false,code:e.code}})}},id);
  // Include the real AbortSignal when intercepting the generation function.
  for(const p of[first,second])await p.evaluate(()=>{akGenerate=async(id,n,step,signal)=>{window.testStarted++;return new Promise((resolve,reject)=>{window.releaseTest=()=>resolve({id,at:Date.now()+1,cards:[{}],deck:'Mock deck'});if(signal.aborted)reject(aiErr('abort'));else signal.addEventListener('abort',()=>reject(aiErr('abort')),{once:true})})}});
  await first.evaluate(()=>window.startTest());await first.waitForFunction(()=>window.testStarted===1);
  await second.evaluate(()=>window.startTest());await second.waitForFunction(()=>window.testStarted>0||window.testResult!==null);const denied=await second.evaluate(()=>({started:window.testStarted,result:window.testResult}));assert.equal(denied.started,0,'a second tab issued duplicate generation work');assert.deepEqual(denied.result,{ok:false,code:'akbusy'});console.log('PASS second tab cannot duplicate a running lecture task');
  await first.evaluate(()=>window.testRun.ctl.abort());await first.waitForFunction(()=>window.testResult?.code==='abort');
  await second.evaluate(()=>window.startTest());await second.waitForFunction(()=>window.testStarted===1);await second.evaluate(()=>window.releaseTest());await second.waitForFunction(()=>window.testResult?.ok);console.log('PASS cancellation releases the lock and permits a later retry');
  assert.deepEqual(crashes,[]);console.log('PASS no uncaught errors in either tab');console.log('AI real-tab integration: 3 passed');
}finally{await browser.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});
