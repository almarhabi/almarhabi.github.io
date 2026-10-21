// Delayed wipe and cross-tab pending-state regressions. No external services.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
const source=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const tests=[],test=(name,fn)=>tests.push([name,fn]);
const tick=()=>new Promise(r=>setImmediate(r));
function wipeContext(){
 let now=1792576800000;const timers=[],deletedAudio=[],stores={slides:new Map(),decks:new Map()};
 class Clock extends Date{static now(){return now}}
 const c={Date:Clock,console,Set,Map,Object,JSON,S:{aiv:1,marks:{a:{studied:'2026-10-21',clips:'old'},b:{studied:'2026-10-21'}}},BY_ID:{a:{id:'a'},b:{id:'b'}},ledger:()=>({E:[]}),activeSession:()=>null,recsOf:id=>[{k:'audio-'+id,w:false,a:true}],AIX:f=>c.S.aiv?f():null,spGet:()=>null,spDrop:()=>{},focusSync:()=>{},audioStore:{del:k=>deletedAudio.push(k)},setTimeout:(fn,ms)=>{timers.push({fn,at:now+ms});return timers.length},clearTimeout:()=>{},akqOf:()=>null,AKRUN:{},AKB:{},sjson:(s,d)=>{try{return JSON.parse(s)||d}catch(e){return d}},aiGet:async(store,key)=>stores[store].get(key),idbAI:async(store,mode,fn)=>{const request=fn({delete:key=>stores[store].delete(key),get:key=>{const r={result:stores[store].get(key)};queueMicrotask(()=>r.onsuccess&&r.onsuccess({target:r}));return r},put:(value,key)=>stores[store].set(key,value)});await new Promise(r=>setImmediate(r));return request&&request.result}};
 c.mk=id=>c.S.marks[id]||{};c.savePatch=(id,p)=>c.S.marks[id]={...c.mk(id),...p};c.quietPatch=c.savePatch;
 vm.createContext(c);vm.runInContext(source('const WIPE_KEEP=','function sheetWipe('),c);
 return{c,stores,deletedAudio,advance:n=>now+=n,finish:async()=>{now+=31000;for(const t of timers)await t.fn();await tick();await tick()}};
}
test('expired wipe removes its original local source, deck and audio',async()=>{
 const f=wipeContext();f.stores.slides.set('a',{at:f.c.Date.now()-1e9,txt:'old'});f.stores.decks.set('a',{at:f.c.Date.now()-1e9,cards:['old'],job:{id:'oldjob123'}});f.stores.decks.set('a|apkg',{job:'oldjob123',u8:[80,75]});f.c.wipeLecture('a');await f.finish();assert.equal(f.stores.slides.has('a'),false);assert.equal(f.stores.decks.has('a'),false);assert.equal(f.stores.decks.has('a|apkg'),false);assert(f.deletedAudio.includes('audio-a'));
});
test('wipe deletes old AI caches even when AI features are switched off',async()=>{
 const f=wipeContext();f.c.S.aiv=false;f.stores.slides.set('a',{at:1,txt:'old'});f.stores.decks.set('a',{at:1,cards:['old']});f.c.wipeLecture('a');await f.finish();assert.equal(f.stores.slides.has('a'),false);assert.equal(f.stores.decks.has('a'),false);
});
test('old wipe cleanup cannot delete a newly read lecture or regenerated deck',async()=>{
 const f=wipeContext(),w=f.c.wipeLecture('a');f.advance(1000);f.stores.slides.set('a',{at:w.at+1,full:true,txt:'NEW lecture source'});f.stores.decks.set('a',{at:w.at+1,id:'a',cards:['new'],job:{id:'newjob123'}});f.stores.decks.set('a|apkg',{job:'newjob123',u8:[80,75]});await f.finish();assert.equal(f.stores.slides.get('a')?.txt,'NEW lecture source');assert.deepEqual(f.stores.decks.get('a')?.cards,['new']);assert.equal(f.stores.decks.get('a|apkg')?.job,'newjob123');
});
test('wiping a second lecture does not orphan the first cleanup',async()=>{
 const f=wipeContext();f.stores.slides.set('a',{at:1,txt:'old a'});f.stores.slides.set('b',{at:1,txt:'old b'});f.c.wipeLecture('a');f.advance(1000);f.c.wipeLecture('b');await f.finish();assert(f.deletedAudio.includes('audio-a'),'first lecture audio must be cleaned');assert(f.deletedAudio.includes('audio-b'),'second lecture audio must be cleaned');assert.equal(f.stores.slides.has('a'),false);assert.equal(f.stores.slides.has('b'),false);
});
test('undo preserves the original cache and restores valid lecture marks',async()=>{
 const f=wipeContext();f.stores.slides.set('a',{at:1,txt:'original'});f.c.wipeLecture('a');assert.equal(f.c.undoWipe(),true);await f.finish();assert.equal(f.stores.slides.get('a')?.txt,'original');assert.equal(f.c.S.marks.a.studied,'2026-10-21');assert(!f.deletedAudio.includes('audio-a'));
});
function storageContext(){
 const epoch=(1792576800000).toString(36),c={console,JSON,Object,Set,LS:'uqu-state-v2',S:{epoch,marks:{lecture:{studied:'2026-10-21'}}},LV:0,pending:{'lecture|studied':'2026-10-21','lecture|knots/knew':{t:'new knot',c:'2026-10-21'}},pendingTop:{goal:80},resetPend:null,render:()=>{},savePend:()=>{},cache:()=>{},cleanS:o=>JSON.parse(JSON.stringify(o)),isObj:o=>!!o&&typeof o==='object'&&!Array.isArray(o),epochMs:e=>typeof e==='string'?parseInt(e,36)||0:0,safeId:s=>typeof s==='string'&&/^[A-Za-z0-9_-]+$/.test(s)&&!['__proto__','constructor','prototype'].includes(s),window:{addEventListener:(event,fn)=>{if(event==='storage')c.handler=fn}}};
 c.wipeLocal=ns=>{c.S=ns;for(const k of Object.keys(c.pending))delete c.pending[k];for(const k of Object.keys(c.pendingTop))delete c.pendingTop[k]};vm.createContext(c);vm.runInContext(source('// another tab of the site on this device changed something:','function setPts('),c);return c;
}
test('ordinary storage event keeps this tab pending fields while accepting other tab edits',()=>{
 const c=storageContext();c.handler({key:c.LS,newValue:JSON.stringify({epoch:c.S.epoch,goal:60,marks:{other:{studied:'2026-10-20'}}})});assert.equal(c.S.marks.lecture?.studied,'2026-10-21');assert.equal(c.S.marks.lecture?.knots?.knew?.t,'new knot');assert.equal(c.S.goal,80);assert.equal(c.S.marks.other?.studied,'2026-10-20');
});
test('newer cross-tab reset wins over this tab old pending edits',()=>{
 const c=storageContext(),newEpoch=(c.epochMs(c.S.epoch)+1000).toString(36);c.handler({key:c.LS,newValue:JSON.stringify({epoch:newEpoch,marks:{}})});assert.equal(c.S.epoch,newEpoch);assert.equal(c.S.marks.lecture,undefined);assert.deepEqual(Object.keys(c.pending),[]);assert.deepEqual(Object.keys(c.pendingTop),[]);
});
test('older cross-tab snapshot cannot revert a local reset epoch',()=>{
 const c=storageContext(),currentEpoch=c.S.epoch;c.S.marks={};c.handler({key:c.LS,newValue:JSON.stringify({epoch:(c.epochMs(currentEpoch)-1000).toString(36),marks:{old:{studied:'2026-10-20'}}})});assert.equal(c.S.epoch,currentEpoch);assert.equal(c.S.marks.old,undefined);
});
(async()=>{let failed=0;for(const[name,fn]of tests)try{await fn();console.log('PASS '+name)}catch(e){failed++;console.error('FAIL '+name+': '+e.message)}console.log(`${tests.length-failed}/${tests.length} wipe/storage checks passed`);process.exitCode=failed?1:0})();
