// Production state races; no network or production data. Run: node tools/audit/state-regressions.cjs
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../../index.html'),'utf8');
const slice=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const tick=()=>new Promise(r=>setImmediate(r));
const tests=[];const test=(n,f)=>tests.push([n,f]);
const context=values=>vm.createContext({...values,console,Date,Math,Object,Array,JSON,Set,Map,Promise,setTimeout:()=>0});
const evalIn=(c,s)=>vm.runInContext(s,c);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};

test('calendar validates actual dates rather than Date.parse normalization',()=>{
 const c=context({});evalIn(c,slice('const isISO=','const isObj=')+';this.isISO=isISO');
 for(const d of ['2026-02-30','2026-04-31','2025-02-29','2026-13-01','0000-00-00'])assert.equal(c.isISO(d),false,d);
 for(const d of ['2024-02-29','2026-12-31','2000-01-01'])assert.equal(c.isISO(d),true,d);
});

test('reset acknowledgement preserves edits made while the write was pending',async()=>{
 const gate=deferred();let uploaded;
 const c=context({epochPush:false,jobs:[],busy:false,flushQ:true,remoteExists:true,merged:false,resetPend:'first',S:{epoch:'first',marks:{}},pending:{},pendingTop:{},sameV:(a,b)=>JSON.stringify(a)===JSON.stringify(b),savePend:()=>{},fullDoc:()=>JSON.parse(JSON.stringify(c.S)),remote:{set:async d=>{uploaded=d;await gate.promise}},pump:()=>{}});
 evalIn(c,slice('function pushReset(){','function applyRemote('));c.pushReset();const p=c.jobs[0]();await tick();
 c.S.marks.lecture={studied:'2026-10-21'};c.pending['lecture|studied']='2026-10-21';c.S.goal=80;c.pendingTop.goal=80;
 gate.resolve();await p;
 assert.equal(uploaded.marks.lecture,undefined,'fixture must edit after upload snapshot');
 assert.equal(c.pending['lecture|studied'],'2026-10-21','later lecture edit must remain queued');assert.equal(c.pendingTop.goal,80,'later setting edit must remain queued');
});

test('a newer reset requested during an older reset is not forgotten',async()=>{
 const gate=deferred();let writes=0;
 const c=context({epochPush:false,jobs:[],busy:false,flushQ:true,remoteExists:true,merged:false,resetPend:'first',S:{epoch:'first',marks:{}},pending:{},pendingTop:{},sameV:(a,b)=>JSON.stringify(a)===JSON.stringify(b),savePend:()=>{},fullDoc:()=>JSON.parse(JSON.stringify(c.S)),remote:{set:async()=>{if(++writes===1)await gate.promise}},pump:()=>{}});
 evalIn(c,slice('function pushReset(){','function applyRemote('));c.pushReset();const first=c.jobs[0]();await tick();
 c.S={epoch:'second',marks:{newer:{studied:'2026-10-21'}}};c.resetPend='second';c.pushReset();gate.resolve();await first;
 assert(c.resetPend==='second'||c.jobs.length>1,'newer reset must remain pending or be queued');
});

test('initial path writes from two devices do not overwrite each other',async()=>{
 let shared={},reads=0;const gate=deferred();
 const apply=paths=>{for(const [p,v]of Object.entries(paths)){const ks=p.split('/');let t=shared;for(const k of ks.slice(0,-1))t=t[k]||(t[k]={});t[ks.at(-1)]=v}};
 const mk=(field,val)=>{const c=context({S:{marks:{lecture:{[field]:val}}},flushQ:true,pending:{['lecture|'+field]:val},pendingTop:{},remoteExists:false,remote:{get:async()=>{if(++reads===2)gate.resolve();await gate.promise;return{exists:false}},set:async d=>{shared=JSON.parse(JSON.stringify(d))},updatePaths:async p=>apply(p)},sameV:(a,b)=>JSON.stringify(a)===JSON.stringify(b),vClean:v=>v,fullDoc:()=>({marks:{lecture:{[field]:val}}}),savePend:()=>{},renderSync:()=>{}});evalIn(c,slice('async function flushNow(){','// write some fields of one lecture:'));return c};
 const a=mk('studied','2026-10-21'),b=mk('cards',12);await Promise.all([a.flushNow(),b.flushNow()]);
 assert.equal(shared.marks.lecture.studied,'2026-10-21');assert.equal(shared.marks.lecture.cards,12);
});


test('IndexedDB transactions close their connections after completion',async()=>{
 let closed=0;const db={close:()=>closed++,transaction:()=>{const tx={objectStore:()=>({})};setImmediate(()=>tx.oncomplete&&tx.oncomplete());return tx}};
 const c=context({indexedDB:{open:()=>{const req={result:db};setImmediate(()=>req.onsuccess());return req}}});
 evalIn(c,slice('function idbAIopen(){','const aiGet='));await c.idbAI('decks','readonly',()=>({result:'okay'}));assert.equal(closed,1,'new database connection must be released');
});

test('IndexedDB abort rejects instead of leaving an operation pending forever',async()=>{
 let closed=0;const db={close:()=>closed++,transaction:()=>{const tx={error:new Error('aborted'),objectStore:()=>({})};setImmediate(()=>tx.onabort&&tx.onabort());return tx}};
 const c=context({indexedDB:{open:()=>{const req={result:db};setImmediate(()=>req.onsuccess());return req}}});
 evalIn(c,slice('function idbAIopen(){','const aiGet='));const r=await Promise.race([c.idbAI('decks','readwrite',()=>({})).then(()=> 'resolved',()=> 'rejected'),new Promise(r=>setTimeout(()=>r('hung'),30))]);assert.equal(r,'rejected');assert.equal(closed,1);
});


test('study-day rollover stays at local 04:00 across daylight-saving transitions',()=>{
 const oldTZ=process.env.TZ;process.env.TZ='America/New_York';
 try{const c=context({isoOf:t=>`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`,HR:3600000});evalIn(c,slice('const DAY_CUT=','const curDay=')+';this.dayKeyOf=dayKeyOf;this.dayStartMs=dayStartMs');
  assert.equal(c.dayKeyOf(new Date('2026-03-08T04:00:00').getTime()),'2026-03-08');assert.equal(c.dayKeyOf(new Date('2026-11-01T03:30:00').getTime()),'2026-10-31');
  assert.equal(new Date(c.dayStartMs('2026-03-08')).getHours(),4);assert.equal(new Date(c.dayStartMs('2026-11-01')).getHours(),4);
 }finally{if(oldTZ===undefined)delete process.env.TZ;else process.env.TZ=oldTZ}
});

(async()=>{let failed=0;for(const[n,f]of tests)try{await f();console.log('PASS '+n)}catch(e){failed++;console.error('FAIL '+n+': '+e.message)}console.log(`${tests.length-failed}/${tests.length} state regression checks passed`);process.exitCode=failed?1:0})();
