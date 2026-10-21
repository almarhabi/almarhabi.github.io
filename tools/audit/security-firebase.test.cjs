// Real Firebase Realtime Database rules emulator tests. Never contacts a live backend.
// Uses the emulator's REST protocol directly, so no Firebase browser/runtime dependency is needed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const projectId=process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT||'demo-uqu-audit';
const address=process.env.FIREBASE_DATABASE_EMULATOR_HOST||'';
if(!/^demo-[a-z0-9-]+$/.test(projectId)||!/^(?:127\.0\.0\.1|localhost):\d+$/.test(address))throw new Error('Refusing non-demo project or non-loopback/missing Firebase database emulator.');
const port=Number(address.split(':')[1]);
if(!(port>0&&port<65536))throw new Error('Invalid emulator port.');
const base='http://'+address,namespace=encodeURIComponent(projectId);
const rules=fs.readFileSync(path.join(__dirname,'../../infra/firebase/database.capability.rules.json'),'utf8');
const keyA='audit-fixture-capability-A-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',keyB='audit-fixture-capability-B-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
let count=0;const check=async(name,fn)=>{await fn();count++;console.log('OK '+name)};
async function request(location,method='GET',body,auth){
 const headers={'Content-Type':'application/json'};
 if(auth==='owner')headers.Authorization='Bearer owner';
 const suffix=auth&&auth!=='owner'?'&auth='+encodeURIComponent(auth):'';
 const response=await fetch(base+location+'?ns='+namespace+suffix,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});
 const text=await response.text();let data;try{data=JSON.parse(text)}catch{throw new Error('Non-JSON emulator response, HTTP '+response.status)}
 return {status:response.status,data};
}
function location(p){return '/'+p.split('/').filter(Boolean).map(encodeURIComponent).join('/')+'.json'}
async function succeed(p,method='GET',body,auth){const r=await request(location(p),method,body,auth);assert.equal(r.status,200,method+' '+p+': '+JSON.stringify(r.data));return r.data}
async function denied(p,method='GET',body,auth){const r=await request(location(p),method,body,auth);assert.equal(r.status,401,method+' '+p+' unexpectedly allowed');assert.match(String(r.data.error),/permission denied/i)}
function mockAuth(uid,claims={}){const now=Math.floor(Date.now()/1000);return Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({...claims,aud:projectId,iss:'https://securetoken.google.com/'+projectId,sub:uid,user_id:uid,iat:now,exp:now+3600,firebase:{sign_in_provider:'custom'}})).toString('base64url')+'.'}
async function installRules(body){const r=await request('/.settings/rules.json','PUT',typeof body==='string'?JSON.parse(body):body,'owner');assert.equal(r.status,200,'Emulator rejected database rules: '+JSON.stringify(r.data))}
(async()=>{
 // Verify the local emulator actually understands the fixture auth token before using it in access checks.
 await installRules({rules:{'.read':"auth != null && auth.uid === 'fixture-auth-check'",'.write':false}});
 await check('fixture JWT is authenticated by the real emulator; anonymous access is rejected',async()=>{await denied('fixture');await succeed('fixture','GET',undefined,mockAuth('fixture-auth-check'));await denied('fixture','GET',undefined,mockAuth('fixture-wrong-uid'))});
 await installRules(rules);
 try{
  await succeed('','PUT',{users:{[keyA]:{v:3,marks:{'9-3-1':{studied:'2026-10-20'}},lock:'LOCK'},[keyB]:{v:3,marks:{'9-3-1':{cards:4}}}},audio:{[keyA]:{fixture:{mime:'audio/webm',data:'fixture-bytes'}}}},'owner');
  await check('database root and users/audio parent enumeration are denied',async()=>{for(const p of ['','users','audio'])await denied(p)});
  await check('root and parent replacement writes are denied',async()=>{for(const p of ['','users','audio'])await denied(p,'PUT',{fixture:true})});
  await check('keys shorter than 20 or longer than the 768-byte database limit are rejected',async()=>{for(const root of ['users','audio']){await denied(root+'/'+'a'.repeat(19));await denied(root+'/'+'a'.repeat(19),'PUT',{fixture:true});for(const method of ['GET','PUT']){const r=await request(location(root+'/'+'a'.repeat(769)),method,method==='PUT'?{fixture:true}:undefined);assert([400,401].includes(r.status),'769-byte key unexpectedly accepted');assert(r.data.error,'Rejected oversized key must return an error')}}});
  await check('20, 128 and 200-character keys work; the total database path limit is honored',async()=>{for(const key of ['b'.repeat(20),'c'.repeat(128),'d'.repeat(200)])for(const root of ['users','audio']){await succeed(root+'/'+key,'PUT',{fixture:true});assert.equal((await succeed(root+'/'+key)).fixture,true)}for(const root of ['users','audio']){const bare=root+'/'+'e'.repeat(762),lock=root+'/'+'f'.repeat(757)+'/lock';await succeed(bare,'PUT',true);assert.equal(await succeed(bare),true);await succeed(lock,'PUT','LOCK');assert.equal(await succeed(lock),'LOCK');for(const method of ['GET','PUT']){const r=await request(location(root+'/'+'g'.repeat(768)),method,method==='PUT'?true:undefined);assert.equal(r.status,400);assert.match(String(r.data.error),/768 bytes/,'768-character nested key must fail the backend total-path bound, not the capability rule')}}});
  await check('Unicode and whitespace capability keys are rejected',async()=>{for(const key of ['contains spaces long enough','مفتاحمزامنةطويلجدًاواختبار']){await denied('users/'+key);await denied('users/'+key,'PUT',{fixture:true})}});
  await check('anonymous holder can read its exact state path without parent permission',async()=>{assert.equal((await succeed('users/'+keyA+'/marks/9-3-1')).studied,'2026-10-20')});
  await check('incremental state updates persist in a separate REST request',async()=>{await succeed('users/'+keyA,'PATCH',{'marks/9-3-1/cards':7,akp:JSON.stringify({min:60,sec:20,lpd:2,ret:.9})});assert.equal(await succeed('users/'+keyA+'/marks/9-3-1/cards'),7)});
  await check('recording subtree supports read, write and delete with its capability',async()=>{const p='audio/'+keyA+'/new-recording';await succeed(p,'PUT',{mime:'audio/webm',data:'fixture-bytes'});assert.equal((await succeed(p)).mime,'audio/webm');await succeed(p,'DELETE');assert.equal(await succeed(p),null)});
  await check('Shortcut unauthenticated REST lock leaf works while collection REST does not',async()=>{assert.equal(await succeed('users/'+keyA+'/lock'),'LOCK');await denied('users')});
  await check('an authenticated uid and admin claim do not grant collection or admin access',async()=>{const auth=mockAuth('fixture-other-uid',{admin:true});for(const p of ['','users','audio','admin'])await denied(p,'GET',undefined,auth);await denied('admin/setting','PUT',true,auth)});
  await check('known second capability grants access by design, not by authenticated uid',async()=>{assert.equal(await succeed('users/'+keyB+'/marks/9-3-1/cards','GET',undefined,mockAuth('fixture-unrelated-uid')),4)});
  await check('a mixed permitted/forbidden atomic update changes nothing',async()=>{await denied('','PATCH',{['users/'+keyA+'/lock']:'OPEN','admin/setting':'forbidden'});assert.equal(await succeed('users/'+keyA+'/lock'),'LOCK')});
  await check('an atomic update to two known capability paths remains compatible',async()=>{await succeed('','PATCH',{['users/'+keyA+'/lock']:'OPEN',['audio/'+keyA+'/atomic']:{mime:'audio/webm',data:'fixture'}});assert.equal(await succeed('users/'+keyA+'/lock'),'OPEN');assert.equal((await succeed('audio/'+keyA+'/atomic')).data,'fixture')});
  await check('all unlisted collections are denied',async()=>{for(const p of ['admin','public','settings','profiles','unknown']){await denied(p);await denied(p+'/fixture','PUT',true)}});
  await check('false tombstones and complete personal-state reset remain compatible',async()=>{const p='users/'+keyA;await succeed(p,'PATCH',{'marks/9-3-1/anki':false,'marks/9-3-1/akj':false});assert.equal(await succeed(p+'/marks/9-3-1/anki'),false);await succeed(p,'PUT',{v:3,epoch:'fixture-epoch',marks:{}});assert.equal(await succeed(p+'/v'),3)});
  console.log(count+' real Firebase rules emulator checks passed');
 }finally{await succeed('','DELETE',undefined,'owner')}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
