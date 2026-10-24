// Failure-boundary regressions: malformed upstream JSON and nonsettling stream cleanup.
// Run: node tools/audit/ai-boundaries.cjs. No network, credentials or live user data.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(process.env.AI_AUDIT_SOURCE||path.join(__dirname,'../../index.html'),'utf8');
function fn(name){const m=new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\(').exec(html);assert(m,'missing function '+name);for(let i=html.indexOf('\n',m.index);i>=0;i=html.indexOf('\n',i+1)){const s=html.slice(m.index,i);try{new vm.Script(s);return s}catch(e){}}throw Error('Cannot isolate '+name)}
function context(){const c={console,Date,AbortController,TextEncoder,TextDecoder,ReadableStream,Uint8Array,setTimeout,clearTimeout,Number,URL,navigator:{onLine:true},isObj:v=>!!v&&typeof v==='object'&&!Array.isArray(v),aiURL:()=>'/mock',aiErr:(code,cause,status,text)=>Object.assign(new Error(code),{code,cause,status,text})};vm.createContext(c);return c}
async function bounded(p,ms=100){let timer;try{return await Promise.race([p,new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('cleanup prevented caller settlement')),ms)})])}finally{clearTimeout(timer)}}
function sse(value,neverCancel=false){return{ok:true,headers:{get:()=> 'text/event-stream'},body:new ReadableStream({start(ctl){ctl.enqueue(new TextEncoder().encode(value));if(!neverCancel)ctl.close()},cancel(){if(neverCancel)return new Promise(()=>{})}})}}
let passed=0,failed=0;async function test(name,f){try{await f();passed++;console.log('PASS '+name)}catch(e){failed++;console.error('FAIL '+name+': '+e.message)}}
(async()=>{
await test('null JSON upstream body reports invalid response rather than a TypeError',async()=>{const c=context();c.fetch=async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>null});vm.runInContext(fn('aiFetch'),c);await assert.rejects(vm.runInContext('aiFetch({key:"mock"},{},{})',c),e=>e.code==='bad')});
await test('null SSE JSON does not masquerade as a CORS/network failure',async()=>{const c=context();c.fetch=async()=>sse('data: null\n\ndata: {"choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}]}\n\n');vm.runInContext(fn('aiFetch'),c);try{const r=await vm.runInContext('aiFetch({key:"mock"},{},{})',c);assert.equal(r.msg.content,'{}')}catch(e){assert.equal(e.code,'bad','invalid SSE reported '+e.code)}});
await test('null streamed tool entries do not masquerade as CORS/network failures',async()=>{const c=context();c.fetch=async()=>sse('data: {"choices":[{"delta":{"tool_calls":[null],"content":"{}"},"finish_reason":"stop"}]}\n\n');vm.runInContext(fn('aiFetch'),c);try{const r=await vm.runInContext('aiFetch({key:"mock"},{},{})',c);assert.equal(r.msg.content,'{}')}catch(e){assert.equal(e.code,'bad','invalid tool entry reported '+e.code)}});
await test('AI error settles even when underlying stream cancellation never settles',async()=>{const c=context();c.fetch=async()=>sse('data: {"error":{"message":"upstream failure"}}\n\n',true);vm.runInContext(fn('aiFetch'),c);await assert.rejects(bounded(vm.runInContext('aiFetch({key:"mock"},{},{wait:30})',c)),e=>e.code==='http')});
await test('oversized download rejects even when stream cancellation never settles',async()=>{const c=context();c.fetch=async()=>({ok:true,status:200,headers:{get:()=>null},body:new ReadableStream({start(ctl){ctl.enqueue(new Uint8Array(11))},cancel(){return new Promise(()=>{})}})});vm.runInContext(fn('aiFileRequest'),c);await assert.rejects(bounded(vm.runInContext('aiFileRequest("/mock",{},null,10,30)',c)),e=>e.text==='big')});
await test('PDF document is destroyed after a page extraction failure',async()=>{const c=context();let destroyed=0;c.loadPdfJs=async()=>({getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>{throw Error('bad page')},destroy:async()=>{destroyed++}})})});vm.runInContext(fn('slideTexts'),c);await assert.rejects(vm.runInContext('slideTexts(new Uint8Array([37,80,68,70]),"lecture.pdf","application/pdf")',c),/bad page/);assert.equal(destroyed,1,'failed PDF document remained allocated')});
await test('pre-canceled PDF extraction does not initialize the parser',async()=>{const c=context(),ctl=new AbortController();let opened=0;ctl.abort();c.signal=ctl.signal;c.loadPdfJs=async()=>{opened++;throw Error('unexpected parser initialization')};vm.runInContext(fn('slideTexts'),c);await assert.rejects(vm.runInContext('slideTexts(new Uint8Array([37,80,68,70]),"lecture.pdf","application/pdf",null,signal)',c),e=>e.code==='abort');assert.equal(opened,0)});
await test('canceling PDF loading destroys its loading task and reports abort',async()=>{const c=context(),ctl=new AbortController();let destroyed=0,rejectLoading,started;const open=new Promise(r=>started=r),task={promise:new Promise((r,j)=>rejectLoading=j),destroy:async()=>{destroyed++;rejectLoading(Error('parser terminated'))}};c.signal=ctl.signal;c.loadPdfJs=async()=>({getDocument:()=>{started();return task}});vm.runInContext(fn('slideTexts'),c);const p=vm.runInContext('slideTexts(new Uint8Array([37,80,68,70]),"lecture.pdf","application/pdf",null,signal)',c);await open;ctl.abort();await assert.rejects(bounded(p),e=>e.code==='abort');assert.equal(destroyed,1)});
await test('successful PDF extraction removes its abort listener and destroys the document',async()=>{const c=context(),listeners=new Set();let destroyed=0;c.signal={aborted:false,addEventListener:(e,f)=>listeners.add(f),removeEventListener:(e,f)=>listeners.delete(f)};c.loadPdfJs=async()=>({getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>({getTextContent:async()=>({items:[{str:'Objective one',hasEOL:true}]})}),destroy:async()=>{destroyed++}})})});vm.runInContext(fn('slideTexts'),c);const pages=await vm.runInContext('slideTexts(new Uint8Array([37,80,68,70]),"lecture.pdf","application/pdf",null,signal)',c);assert.equal(pages[0],'Objective one\n');assert.equal(listeners.size,0);assert.equal(destroyed,1)});
// Exercise the real aiCall retry path: valid JSON can still fail page-boundary validation.
function splitContext(replies,fmt='schema'){
  const c=context();c.AI_SYS='Test system';c.AI_MODEL='test-model';c.RUNNER=false;
  c.aiCfg=()=>({key:'mock-key',cap:{fmt},budget:100000});c.aiTokToday=()=>0;c.tokEst=()=>1;c.aiSet=()=>{};c.aiUseAdd=()=>{};c.aiGate=async()=>()=>{};
  c.sObj=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});c.sArr=items=>({type:'array',items});c.S_STR={type:'string'};c.S_INT={type:'integer'};c.CLIP_T={why:1};c.requests=[];
  for(const name of ['SPLIT_S','SPLIT_PART_S'])vm.runInContext(html.match(new RegExp('^const '+name+'=.*$','m'))[0],c);
  for(const name of ['aiBody','aiJSON','aiCall','spValidPart','spReplySchema','spPartIssue'])vm.runInContext(fn(name),c);
  c.aiFetch=async(config,body)=>{c.requests.push(body);const text=replies[c.requests.length-1];assert.notEqual(text,undefined,'unexpected additional paid retry');return{msg:{content:text},fin:'stop',usage:{},ms:1}};
  vm.runInContext('var part={a:9,b:15};var opts={k:"split",rules:"Split supplied pages",data:"PRIVATE lecture text",schema:spReplySchema(part,true),fg:true,check:j=>!spPartIssue(j,part),invalid:j=>spPartIssue(j,part)}',c);
  return c;
}
await test('split schema requires exactly one clip and absolute from/to numbers in all output modes',async()=>{
  const c=splitContext([]);const schema=vm.runInContext('spReplySchema(part,true)',c);assert.equal(schema.properties.clips.minItems,1);assert.equal(schema.properties.clips.maxItems,1);assert.deepEqual(Array.from(schema.properties.clips.items.properties.from.enum),[9]);assert.deepEqual(Array.from(schema.properties.clips.items.properties.to.enum),[15]);assert(schema.properties.figs);
  assert.equal(vm.runInContext('spReplySchema({a:1,b:14})===SPLIT_S',c),true);
  for(const fmt of ['object','text']){const ctx=splitContext([],fmt),body=vm.runInContext('aiBody(opts,aiCfg(),false)',ctx);assert(body.messages[0].content.includes('"maxItems":1'));assert(body.messages[0].content.includes('"enum":[9]'))}
});
await test('valid JSON with two short clips receives targeted correction and succeeds on one retry',async()=>{
  const c=splitContext([JSON.stringify({clips:[{from:9,to:11},{from:12,to:15}]}),JSON.stringify({clips:[{from:9,to:15}]})]);const r=await vm.runInContext('aiCall(opts)',c);assert.equal(r.json.clips.length,1);assert.equal(c.requests.length,2);
  const fix=c.requests[1].messages.at(-1).content;assert(fix.includes('from=9, to=15'));assert(fix.includes('previous response failed validation'));assert(!fix.includes('PRIVATE'));assert.equal(c.requests[1].messages[1].content,'PRIVATE lecture text');
});
await test('repeated wrong part numbering stops after two replies with an actionable reason',async()=>{
  const reply=JSON.stringify({clips:[{from:1,to:7}]});const c=splitContext([reply,reply]);await assert.rejects(vm.runInContext('aiCall(opts)',c),e=>e.code==='splitreply'&&e.text.includes('from=9, to=15'));assert.equal(c.requests.length,2);
});
await test('malformed JSON has a different diagnostic from incorrect split boundaries',async()=>{
  const c=splitContext(['not JSON','not JSON']);await assert.rejects(vm.runInContext('aiCall(opts)',c),e=>e.code==='splitreply'&&e.text.includes('JSON'));assert.equal(c.requests.length,2);
});
await test('null clip entries, missing clips and string page numbers fail without crashing',async()=>{
  const c=splitContext([]);for(const input of [null,{},[],{clips:[null]},{clips:[{from:'9',to:'15'}]}]){c.input=input;assert(vm.runInContext('spPartIssue(input,part)',c));}
  assert.equal(vm.runInContext('spValidPart([null],part)',c),false);assert.equal(vm.runInContext('spPartIssue({clips:[{from:3,to:6}]},{a:3,b:6})',c),'');
});
await test('ordinary AI tasks keep their original generic failure and retry limit',async()=>{
  const c=splitContext(['not JSON','not JSON']);vm.runInContext('delete opts.invalid',c);await assert.rejects(vm.runInContext('aiCall(opts)',c),e=>e.code==='bad');assert.equal(c.requests.length,2);assert.equal(c.requests[1].messages.length,2);
});
console.log(`AI failure boundaries: ${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
})().catch(e=>{console.error(e.stack);process.exitCode=1});
