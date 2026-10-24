// Run: node tools/anki/test_browser.js. Uses the runner's playwright-core and a locally installed Chromium.
let playwright;try{playwright=require('../runner/node_modules/playwright-core')}catch(e){playwright=require('playwright-core')}
const {chromium}=playwright,fs=require('fs'),path=require('path'),assert=require('assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});let passed=0;
const check=async(name,f)=>{await f();passed++;console.log('OK '+name)};
try{
const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
await ctx.route('**/*',r=>r.request().url()==='http://uqu.test/'?r.fulfill({contentType:'text/html',body:html}):r.abort());
const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto('http://uqu.test/');await p.waitForFunction(()=>typeof sheetAnki==='function');
await check('site boots on a mobile viewport without JavaScript errors',()=>assert.deepEqual(errors,[]));
const id=await p.evaluate(()=>ALL.find(needsStudy).id);
await p.evaluate(async id=>{
  aiSet({key:'mock-key-for-tests-only',ok:Date.now()});S.aiv=Date.now();
  const source={story:'A causal story.',course:'Medicine',objectives:[{id:'O1',text:'Explain receptor signaling',verb:'Explain',slides:[1,2],inferred:false,weight:3},{id:'O2',text:'Identify a clinical finding',verb:'Identify',slides:[1,3],inferred:false,weight:1}],facts:[{id:'F1',s:2,sec:'Signaling',f:'Receptor inhibition reduces downstream signaling.',fam:'Pathways',obj:['O1'],alignment:3,exam:2,centrality:2,confusability:1,clinical:1,blurt:0,emphasized:true},{id:'F2',s:3,sec:'Findings',f:'The clinical response reflects a different physiological adaptation.',fam:'Responses',obj:['O2'],alignment:3,exam:2,centrality:2,confusability:1,clinical:1,blurt:0,emphasized:true}],dropped:[],ambiguous:[],errs:[],weak:[{n:1,ids:['F1']},{n:2,ids:['W1']}],extra:[{id:'W1',s:4,sec:'Weak spots',f:'A separate forgotten causal connection.',fam:'Pathways',obj:['O1']}]};
  const stems=['A kinase is blocked following ligand binding. Which response follows?','A child develops progressive weakness after exercise. Which cellular change explains this pattern?','Following removal of an inhibitory signal, which physiological outcome occurs?'];
  const cards=['F1','F2','W1'].map((key,i)=>({type:'Mechanism',section:i===1?'Findings':'Signaling',hy:true,stem:stems[i],options:{A:'Reduced signaling',B:'Enhanced secretion',C:'Preserved transport',D:'Reversed inhibition'},answer:'A',explain:'The relevant pathway mediates the observed response.',why:{A:'',B:'This belongs to a different pathway.',C:'This belongs to another response.',D:'This characterizes another process.'},warning:'',source:'Slide '+(i+2),keys:[key],ids:[key],obj:[i===1?'O2':'O1'],tier:'T1',weak:i===2}));
  window.calls=[];aiFetch=async(c,body,q)=>{window.calls.push({k:q.k,data:q.data,rules:q.rules,effort:q.effort,over:q.over});return{msg:{content:JSON.stringify(q.k==='anki1'?source:{cards})},fin:'stop',usage:{},ms:1}};
  await aiPut('slides',id,{full:true,n:4,txt:lectureText(['Objectives\nExplain receptor signaling\nIdentify a clinical finding','Receptor inhibition reduces downstream signaling.','Clinical response details.','A separate forgotten causal connection.']),name:'Lecture.pdf'});
  window.testDeck=await akGenerate(id,2,()=>{},new AbortController().signal);
},id);
await check('full two-stage generation preserves objectives, budget and extra weak card',async()=>{const d=await p.evaluate(()=>({v:testDeck.v,cap:testDeck.count.cap,main:testDeck.qa.main,extra:testDeck.qa.extras,cov:testDeck.qa.unO.length,out:testDeck.out}));assert.equal(d.v,3);assert.equal(d.cap,2);assert.equal(d.main,2);assert.equal(d.extra,1);assert.equal(d.cov,0);assert(d.out.every(c=>c.objective));});
await check('all AI stages receive the same-file objectives and full numbered pages',async()=>{const calls=await p.evaluate(()=>window.calls);assert.equal(calls.length,2);for(const c of calls){assert(c.data.includes('Explain receptor signaling'));assert(c.data.includes('--- PAGE 1 ---'));assert(c.data.includes('--- END PAGE 4 ---'));assert.equal(c.effort,'high');assert.equal(c.over,true)}assert(calls[1].data.includes('OBJECTIVES FROM THIS SAME LECTURE'));});
await check('new 15-page split sends complete boundaries and imports as 8 + 7 while saved clips stay intact',async()=>{
const result=await p.evaluate(async id=>{
  const oldSource=srcPages,oldCall=aiCall,oldSlides=await aiGet('slides',id),oldMark=mk(id).clips;
  const requests=[];
  try{
    const pages=Array.from({length:15},(_,i)=>i===0?'Objectives: Explain receptor signaling. Identify a clinical finding.':'Lecture page '+(i+1)+': Detailed mechanism and clinical response material.');
    srcPages=async()=>({pages,images:[],name:'Split.pdf'});
    aiCall=async q=>{requests.push(q);if(q.schema.properties.clips.maxItems!==1)throw new Error('Split schema must require one clip');const nums=[...q.data.matchAll(/--- PAGE (\d+) ---/g)].map(m=>+m[1]);const json={lecture:label(BY_ID[id]),clips:[{from:nums[0],to:nums.at(-1),title:'Mechanisms',ar:'الآليات',min:15,hook:'Why?',keys:['Signaling'],type:'why',prompt:'Explain'}]};if(!q.check(json))throw new Error('Real split validator rejected planned boundaries');return{json}};
    const out=await aiSplit(id,{},()=>{},new AbortController().signal),parsed=parseClips(out.json,BY_ID[id]);
    const manual=parseClips(JSON.stringify({slides:13,clips:[{from:1,to:7,keys:['first']},{from:8,to:13,keys:['tail']}]}),BY_ID[id]);
    return{err:parsed.err,lengths:parsed.c.map(c=>c.t-c.f+1),manualErr:manual.err,manualLengths:manual.c.map(c=>c.t-c.f+1),unchanged:mk(id).clips===oldMark,requests:requests.map(q=>({data:q.data,rules:q.rules}))};
  }finally{srcPages=oldSource;aiCall=oldCall;await aiPut('slides',id,oldSlides)}
},id);
assert.equal(result.err,undefined);assert.deepEqual(result.lengths,[8,7]);assert.equal(result.manualErr,undefined);assert.deepEqual(result.manualLengths,[13]);assert(result.unchanged);assert.equal(result.requests.length,2);assert(result.requests[0].data.includes('Objectives: Explain receptor signaling'));assert(result.requests[0].data.includes('--- END PAGE 8 ---'));assert(result.requests[1].data.includes('--- PAGE 9 ---'));assert(result.requests[1].data.includes('--- END PAGE 15 ---'));assert(result.requests.every(q=>q.rules.includes('AT LEAST 7 pages')&&q.rules.includes('EXACT OUTPUT')));
});
await check('real client → Python builder → APKG → token-free second device preserves the deck and deletion',async()=>{
  const dir=fs.mkdtempSync(path.join(require('os').tmpdir(),'uqu-pipeline-'));let job='',posted=null,dispatches=0,routeFailure=null,peer=null;
  const api=async route=>{try{
    const req=route.request(),url=new URL(req.url()),input=url.pathname.match(/\/in\/([a-z0-9]+)\.json$/);
    if(req.method()==='PUT'&&input){job=input[1];posted=JSON.parse(Buffer.from(req.postDataJSON().content,'base64').toString('utf8'));
      const code='import sys,json;sys.path.insert(0,sys.argv[1]);from job import build;st=build(sys.argv[2],json.load(sys.stdin),sys.argv[3]);assert st["ok"],st;open(sys.argv[3]+"/"+sys.argv[2]+".json","w").write(json.dumps(st))';
      require('child_process').execFileSync(process.env.PYTHON||'python3',['-c',code,path.join(__dirname),job,dir],{input:JSON.stringify(posted),timeout:30000});
      return route.fulfill({json:{content:{sha:'test-sha'}}});
    }
    if(req.method()==='POST'&&url.pathname.endsWith('/dispatches')){dispatches++;return route.fulfill({status:204})}
    const out=url.pathname.match(/\/out\/([a-z0-9]+)\.(json|apkg)$/);
    if(out&&out[1]===job)return route.fulfill({contentType:out[2]==='json'?'application/json':'application/octet-stream',body:fs.readFileSync(path.join(dir,job+'.'+out[2]))});
    return route.fulfill({status:404,json:{message:'not found'}});
  }catch(e){routeFailure=e;return route.fulfill({status:500,json:{message:'test backend failed'}})}};
  try{
    await ctx.route('https://api.github.com/**',api);
    const built=await p.evaluate(async()=>{aiSet({gh:'mock-github-token-for-tests-only'});const bytes=await ghBuild(testDeck,()=>{},new AbortController().signal);return{bytes:Array.from(bytes),ref:akjOf(testDeck.id)}});
    assert.equal(routeFailure,null);assert.equal(dispatches,1);assert.equal(posted.cards.length,3);assert.equal(posted.cap,2);assert.deepEqual(posted.objectives,['O1','O2']);assert.equal(posted.cards.filter(c=>c.weak).length,1);assert.equal(built.ref.j,job);
    assert.deepEqual(Buffer.from(built.bytes),fs.readFileSync(path.join(dir,job+'.apkg')));
    peer=await browser.newContext();await peer.route('**/*',r=>r.request().url()==='http://uqu.test/'?r.fulfill({contentType:'text/html',body:html}):r.abort());await peer.route('https://raw.githubusercontent.com/**',api);
    const other=await peer.newPage();other.on('pageerror',e=>errors.push(e.message));await other.goto('http://uqu.test/');
    const result=await other.evaluate(async({id,ref})=>{S.marks[id]={akj:JSON.stringify(ref)};const a=akjOf(id),review=await akReview(id,a),bytes=await akjBytes(id,a);const token=ghOn();await akDelete(id);let canceled=false;try{await akjBytes(id,a)}catch(e){canceled=e.code==='abort'}return{token,cards:review.cards.length,objectives:review.objectives.map(o=>o.id),bytes:Array.from(bytes),canceled}},{id,ref:built.ref});
    assert.equal(result.token,false);assert.equal(result.cards,3);assert.deepEqual(result.objectives,['O1','O2']);assert.deepEqual(result.bytes,built.bytes);assert(result.canceled);
  }finally{await ctx.unroute('https://api.github.com/**',api);if(peer)await peer.close();fs.rmSync(dir,{recursive:true,force:true});await p.evaluate(()=>aiSet({gh:''}));}
});
await p.evaluate(id=>sheetAnki(id),id);await p.waitForSelector('#akDelete');
await check('deck sheet shows objective coverage, command input and deletion',async()=>{assert(await p.locator('#akBox').innerText().then(t=>t.includes('خريطة أهداف المحاضرة')&&t.includes('Overflow')));assert(await p.locator('#akCommand').count());assert(await p.locator('#akDelete').count());});
await check('delete requires a second tap and clears deck bytes and ANKI marks only',async()=>{await p.evaluate(id=>{quietPatch(id,{studied:'2026-10-20',cards:3,anki:'2026-10-20',ak:JSON.stringify({n:3})});return aiPut('decks',id+'|apkg',{job:'abcdefgh1',u8:new Uint8Array([80,75,1])})},id);await p.waitForTimeout(400);await p.locator('#akDelete').click();assert(await p.evaluate(id=>!!mk(id).anki,id));await p.waitForTimeout(400);await p.locator('#akDelete').click();await p.waitForSelector('#akGo',{state:'attached',timeout:5000});const state=await p.evaluate(async id=>({mark:mk(id),deck:await aiGet('decks',id),bytes:await aiGet('decks',id+'|apkg')}),id);assert(state.mark.akx>0);assert.equal(state.mark.anki,false);assert.equal(state.mark.studied,'2026-10-20');assert(!state.deck);assert(!state.bytes);});
await check('a second device rejects stale cached decks after synced deletion',async()=>{const p2=await ctx.newPage();await p2.goto('http://uqu.test/');const tombstone=await p.evaluate(id=>mk(id).akx,id);const result=await p2.evaluate(({id,tombstone})=>{const stale={v:3,id,at:tombstone-1,cards:[{}],out:[{}],count:{},objectives:[]};S.marks[id]={akx:tombstone,akj:JSON.stringify({j:'abcdefgh1',at:tombstone-1})};return{deck:akDeckOK(stale),ref:akjOf(id)}},{id,tombstone});assert.equal(result.deck,false);assert.equal(result.ref,null);await p2.close()});
await check('legacy decks still open and can be deleted',async()=>{await p.evaluate(async id=>{closeSheet(true);const old={...testDeck,v:2,at:Date.now()+20};delete old.objectives;old.cards=old.cards.map(c=>({...c,type:'Direct'}));old.count={D:3,C:2,S:1,N:2,a:2,b:0,c:0};old.qa={bad:[],have:{Direct:3,Analytic:0,Hard:0},cov:'Coverage CORE 2/2 · SUPPORT 1/1'};await aiPut('decks',id,old);sheetAnki(id)},id);await p.waitForSelector('#akDelete');assert(await p.locator('#akRedo').count());await p.evaluate(()=>closeSheet(true));});
await check('synced settings retain review budget and FSRS parameters',async()=>{await p.evaluate(()=>setPage('settings'));await p.locator('#aiAdv').evaluate(e=>e.open=true);await p.locator('#akMin').fill('80');await p.locator('#akSec').fill('25');await p.locator('#akLpd').fill('3');await p.locator('#akRet').fill('0.95');await p.locator('#aiSaveAdv').click();const v=await p.evaluate(()=>akp());assert.equal(v.min,80);assert.equal(v.sec,25);assert.equal(v.lpd,3);assert.equal(v.ret,.95);});
assert.deepEqual(errors,[]);console.log(`${passed} browser checks passed`);
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
