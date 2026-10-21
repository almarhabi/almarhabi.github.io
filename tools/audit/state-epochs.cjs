// Actual pinned Firebase browser SDK + real local RTDB emulator transaction regressions.
// No live backend, real credentials, paid API or uncached CDN requests.
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
let pw;try{pw=require('playwright-core')}catch{pw=require('../runner/node_modules/playwright-core')}
const address=process.env.FIREBASE_DATABASE_EMULATOR_HOST||'';
if(!/^(?:127\.0\.0\.1|localhost):\d+$/.test(address)||!(Number(address.split(':')[1])>0&&Number(address.split(':')[1])<65536))throw Error('A loopback Firebase emulator address is required.');
const namespace=process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT||'demo-uqu-state-epochs';
if(!/^demo-[a-z0-9-]+$/.test(namespace))throw Error('A synthetic demo- Firebase namespace is required.');
const base='http://'+address,key='audit-epochs-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',ns='?ns='+namespace;
const root=path.resolve(__dirname,'../..'),html=fs.readFileSync(process.env.AI_AUDIT_SOURCE||path.join(root,'index.html'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'cdn-fixtures.json'),'utf8'));
const cache=process.env.AI_CDN_CACHE||path.join(os.tmpdir(),'uqu-cdn-audit'),libraries=new Map();
for(const item of manifest.scripts.filter(x=>x.url.includes('/firebasejs/'))){const file=path.join(cache,item.cache_file);if(!fs.existsSync(file))throw Error('Run python3 tools/audit/cache-cdn.py first; missing '+item.url);const body=fs.readFileSync(file);assert.equal('sha384-'+crypto.createHash('sha384').update(body).digest('base64'),item.integrity,'Firebase fixture bytes failed integrity check');libraries.set(item.url,{...item,body})}
assert.equal(libraries.size,2,'Expected pinned Firebase app/database fixtures');
const declarations=['isObj','BAD_K','safeId','safePath','epochMs'].map(name=>{const line=html.match(new RegExp('^const '+name+'=.*;$','m'));assert(line,'Missing actual source helper '+name);return line[0]}).join('\n');
const start=html.indexOf('function fbAdapter('),end=html.indexOf('\nfunction claudeAdapter(',start);assert(start>=0&&end>start,'Actual Firebase adapter source was not found');
const adapterSource=declarations+'\n'+html.slice(start,end);
const rules=fs.readFileSync(path.join(root,'infra/firebase/database.capability.rules.json'),'utf8');
let passed=0;const check=async(name,fn)=>{await fn();passed++;console.log('PASS '+name)};
const bounded=(promise,label)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),20000)})]).finally(()=>clearTimeout(timer))};
async function request(location,method='GET',body,owner=false){const response=await fetch(base+location+ns,{method,headers:{'Content-Type':'application/json',...(owner?{Authorization:'Bearer owner'}:{})},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});const data=await response.json();assert.equal(response.status,200,'Local emulator '+method+' failed: '+JSON.stringify(data));return data}
const state=()=>request('/users/'+key+'.json');
const op=(page,method,...args)=>bounded(page.evaluate(async({method,args})=>{const r=await window.auditAdapter[method](...args);return{committed:r.committed,value:r.snapshot.val()}},{method,args}),method+' transaction');
(async()=>{
 await request('/.settings/rules.json','PUT',JSON.parse(rules),true);
 await request('/users/'+key+'.json','DELETE',undefined,true);
 const browser=await pw.chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||process.env.CHROME_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 const contexts=[];const errors=[];let clientCounter=0;
 try{
  async function client(){
   const context=await browser.newContext();contexts.push(context);
   await context.route('**/*',async route=>{const url=route.request().url();if(url===base+'/epoch-audit/')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated Firebase transaction audit</title>'});const item=libraries.get(url);if(item)return route.fulfill({contentType:item.content_type,headers:{'Access-Control-Allow-Origin':'*'},body:item.body});if(url.startsWith(base+'/'))return route.continue();errors.push('Unexpected request blocked: '+url);return route.abort()});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/epoch-audit/');
   for(const item of libraries.values())await page.addScriptTag({url:item.url});
   await page.addScriptTag({content:adapterSource});
   await bounded(page.evaluate(async({namespace,address,key,name})=>{
    const app=firebase.initializeApp({apiKey:'fixture-public-config',projectId:namespace,databaseURL:'https://'+namespace+'.firebaseio.com'},name);
    const db=app.database(),[host,port]=address.split(':');db.useEmulator(host,Number(port));
    const ref=db.ref('users/'+key),original=ref.transaction.bind(ref);window.auditTransactionArgs=[];window.auditNullCallbacks=0;
    ref.transaction=(update,complete,applyLocally)=>{window.auditTransactionArgs.push(applyLocally);return original(value=>{if(value===null)window.auditNullCallbacks++;return update(value)},complete,applyLocally)};
    window.auditDB=db;window.auditAdapter=fbAdapter(ref,db);
    await new Promise((resolve,reject)=>{const c=db.ref('.info/connected'),timeout=setTimeout(()=>{c.off('value',listener);reject(Error('SDK did not connect to local emulator'))},10000);function listener(s){if(s.val()===true){clearTimeout(timeout);c.off('value',listener);resolve()}}c.on('value',listener,reject)});
    return firebase.SDK_VERSION;
   },{namespace,address,key,name:'epoch-client-'+(++clientCounter)}),'SDK emulator connection');
   assert.equal(await page.evaluate(()=>firebase.SDK_VERSION),'10.12.2');return page;
  }
  const a=await client(),b=await client();
  await check('two actual Firebase SDK clients preserve independent initial parallel writes',async()=>{const results=await Promise.all([op(a,'updatePaths',{'marks/lecture-a/cards':1},''),op(b,'updatePaths',{'marks/lecture-b/cards':2},'')]);assert(results.every(r=>r.committed===true));const s=await state();assert.equal(s.marks['lecture-a'].cards,1);assert.equal(s.marks['lecture-b'].cards,2)});
  const e1=Date.UTC(2026,9,21,12,0,0).toString(36),e2=Date.UTC(2026,9,21,12,0,1).toString(36);
  const firstReset={v:3,epoch:e1,marks:{fresh:{cards:1}}};
  await check('a newer reset commits and removes prior lecture fields atomically',async()=>{const r=await op(a,'set',firstReset);assert.equal(r.committed,true);assert.deepEqual(await state(),firstReset)});
  await check('same-epoch independent concurrent edits survive repeated transaction retries',async()=>{for(let i=0;i<8;i++){const results=await Promise.all([op(a,'updatePaths',{['marks/parallel-a/cards']:i},e1),op(b,'updatePaths',{['marks/parallel-b/cards']:i+10},e1)]);assert(results.every(r=>r.committed===true))}const s=await state();assert.equal(s.epoch,e1);assert.equal(s.marks['parallel-a'].cards,7);assert.equal(s.marks['parallel-b'].cards,17)});
  const c=await client();
  await check('a cold-cache client can update the existing matching epoch',async()=>{const r=await op(c,'updatePaths',{'marks/cold-cache/cards':8},e1);assert.equal(r.committed,true);assert.equal((await state()).marks['cold-cache'].cards,8);assert((await c.evaluate(()=>window.auditNullCallbacks))>0,'Expected real SDK initial-null callback was not exercised')});
  const secondReset={v:3,epoch:e2,marks:{replacement:{cards:4}}};
  await check('an already queued old-epoch edit cannot resurrect fields after a newer reset',async()=>{
   await a.evaluate(epoch=>{window.auditDB.goOffline();window.auditOldPatch=window.auditAdapter.updatePaths({'marks/resurrected/cards':999},epoch);window.auditOldPatch.catch(()=>{})},e1);
   const reset=await op(b,'set',secondReset);assert.equal(reset.committed,true);
   await a.evaluate(()=>window.auditDB.goOnline());
   const old=await bounded(a.evaluate(()=>window.auditOldPatch.then(r=>({committed:r.committed,value:r.snapshot.val()}))),'queued old-epoch edit');
   assert.equal(old.committed,false);assert.equal(old.value.epoch,e2);assert.deepEqual(await state(),secondReset);
  });
  await check('an older reset is rejected with the authoritative newer snapshot',async()=>{const r=await op(a,'set',firstReset);assert.equal(r.committed,false);assert.equal(r.value.epoch,e2);assert.deepEqual(await state(),secondReset)});
  await check('replaying the same reset after another client edits it preserves that edit',async()=>{const edit=await op(a,'updatePaths',{'marks/after-reset/cards':6},e2);assert.equal(edit.committed,true);const r=await op(b,'set',secondReset);assert.equal(r.committed,false);assert.equal(r.value.marks['after-reset'].cards,6);assert.equal((await state()).marks['after-reset'].cards,6)});
  await check('current-epoch writes succeed after a stale operation is rejected',async()=>{const r=await op(a,'updatePaths',{'marks/current/cards':11},e2);assert.equal(r.committed,true);const s=await state();assert.equal(s.epoch,e2);assert.equal(s.marks.current.cards,11);assert.equal(s.marks['after-reset'].cards,6);assert.equal(s.marks.resurrected,undefined)});
  await check('all actual SDK transactions suppress speculative local events',async()=>{for(const page of [a,b,c]){const args=await page.evaluate(()=>window.auditTransactionArgs);assert(args.length>0);assert(args.every(x=>x===false),'A transaction omitted applyLocally=false')}assert.deepEqual(errors,[])});
  console.log(passed+' real Firebase SDK epoch transaction checks passed');
 }finally{for(const context of contexts)await context.close();await browser.close();await request('/users/'+key+'.json','DELETE',undefined,true)}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
