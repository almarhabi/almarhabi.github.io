// Optional local comparison; outside CI. No remote APIs or real credentials.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
let pw;try{pw=require('playwright-core')}catch{pw=require('../runner/node_modules/playwright-core')}const {chromium}=pw;
const ROOT=path.resolve(__dirname,'../..'), OUT=process.env.AUDIT_PERF_OUTPUT||path.join(require('node:os').tmpdir(),'uqu-performance-audit');
const BASE_REF=process.env.AUDIT_BASE_REF||'e8b0dd6204819245e65e4d8820283250dcbe650c';
fs.mkdirSync(OUT,{recursive:true});
const baseline=execFileSync('git',['show',BASE_REF+':index.html'],{cwd:ROOT,maxBuffer:3*1024*1024}).toString('utf8');
const working=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
for(const [name,html] of Object.entries({baseline,working})) fs.writeFileSync(path.join(OUT,name+'.html'),html);
const documents={baseline,working};
const SAMPLE_COUNT=10;
const median = a => { const v=[...a].sort((x,y)=>x-y); return (v[Math.floor((v.length-1)/2)]+v[Math.ceil((v.length-1)/2)])/2; };
(async()=>{
 const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost'), variant=u.pathname.split('/')[1];
  if(documents[variant] && /^\/(baseline|working)\/?$/.test(u.pathname)){
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
   res.end(documents[variant].replace(/<link\b[^>]*rel=["']preconnect["'][^>]*>/g,''));return;
  }
  const file=path.basename(u.pathname);
  if(/^(?:favicon|icon-192|icon-512|apple-touch-icon)\.png$/.test(file)){
   res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});res.end(fs.readFileSync(path.join(ROOT,file)));return;
  }
  res.writeHead(404);res.end();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const results={started:new Date().toISOString(),baselineCommit:execFileSync('git',['rev-parse',BASE_REF],{cwd:ROOT}).toString().trim(),browser:browser.version(),viewport:{width:390,height:844},cpuThrottle:4,samples:SAMPLE_COUNT,source:{},raw:{baseline:[],working:[]},faults:[]};
 for(const [name,html] of Object.entries(documents)) results.source[name]={bytes:Buffer.byteLength(html),sha256:crypto.createHash('sha256').update(html).digest('hex')};
 try{
  for(let run=0;run<SAMPLE_COUNT;run++) for(const name of (run%2?['working','baseline']:['baseline','working'])){
   const ctx=await browser.newContext({viewport:results.viewport,isMobile:true,hasTouch:true,deviceScaleFactor:1,reducedMotion:'reduce'});
   await ctx.route('**/*',r=>{
    if(new URL(r.request().url()).origin===origin)return r.continue();
    return r.fulfill({status:200,contentType:r.request().resourceType()==='stylesheet'?'text/css':'text/plain',body:''});
   });
   await ctx.addInitScript(()=>{localStorage.setItem('uqu-motion','low');localStorage.setItem('uqu-sfx','0');localStorage.setItem('uqu-fsnd','off');localStorage.setItem('uqu-hap','0')});
   const page=await ctx.newPage(),cdp=await ctx.newCDPSession(page);
   await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
   await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
   page.on('pageerror',e=>results.faults.push({variant:name,run,error:e.message}));
   await page.goto(origin+'/'+name+'/',{waitUntil:'load'});
   await page.waitForFunction(()=>typeof render==='function'&&!!document.querySelector('#weeks button'));
   const cold=await page.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0];return{load:n.loadEventEnd,domContentLoaded:n.domContentLoadedEventEnd,transferBytes:n.transferSize}});
   await page.waitForTimeout(100);
   const operations=await page.evaluate(()=>{
    const id=(ALL.find(b=>needsStudy(b)&&heldDate(b)===todayISO)||ALL.find(needsStudy)).id;
    // Warm caches once. Each measured render invalidates the model version, reflecting a data change.
    document.activeElement?.blur();if(!document.querySelector('#ov').hidden)closeSheet(true);st.page='main';st.view='day';st.open=null;render();
    const flush=()=>void document.documentElement.offsetHeight;
    const measure=f=>{const a=performance.now();f();flush();return performance.now()-a};
    const fullRender=measure(()=>{LV++;render()});
    st.open=null;render();flush();
    const openLecture=measure(()=>go(id));
    // Actual local bookmark save: state/cache/serialization/render, no Firebase credentials configured.
    const saveBookmark=measure(()=>savePatch(id,{bm:JSON.stringify({at:Date.now(),i:0,w:'Performance fixture bookmark',q:'Mechanism?',s:'Page 1'})}));
    return{fullRender,openLecture,saveBookmark,noteCount:Object.keys(S.marks).length,domNodes:document.querySelectorAll('*').length};
   });
   results.raw[name].push({run,...cold,...operations});
   console.log(name,run+1,JSON.stringify({cold:cold.load,render:operations.fullRender,open:operations.openLecture,save:operations.saveBookmark}));
   await ctx.close();
  }
  results.summary={};
  for(const metric of ['load','domContentLoaded','fullRender','openLecture','saveBookmark']){
   const a=median(results.raw.baseline.map(x=>x[metric])),b=median(results.raw.working.map(x=>x[metric]));
   results.summary[metric]={baselineMedianMs:+a.toFixed(2),workingMedianMs:+b.toFixed(2),changePercent:+((b-a)/a*100).toFixed(1),baselineMinMax:[Math.min(...results.raw.baseline.map(x=>x[metric])),Math.max(...results.raw.baseline.map(x=>x[metric]))],workingMinMax:[Math.min(...results.raw.working.map(x=>x[metric])),Math.max(...results.raw.working.map(x=>x[metric]))]};
  }
  results.finished=new Date().toISOString();fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(results,null,2));
  console.log('SUMMARY',JSON.stringify(results.summary));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
