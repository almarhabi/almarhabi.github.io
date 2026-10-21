// CDN loader lifecycle: integrity pinning, deduplicated requests, timeout and retries.
// Run: node tools/audit/ai-loader.cjs. No network or downloaded JavaScript execution.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(process.env.AI_AUDIT_SOURCE||path.join(__dirname,'../../index.html'),'utf8');
function helper(){const m=/function\s+loadScript\s*\(/.exec(html);assert(m);for(let i=html.indexOf('\n',m.index);i>=0;i=html.indexOf('\n',i+1)){const s=html.slice(m.index,i);try{new vm.Script(s);return s}catch(e){}}throw Error('Cannot isolate loadScript')}
function context(){const tags=[],timers=new Map();let next=1;const c={URL,Map,Object,Error,Promise,location:{href:'https://uqu.test/'},setTimeout:f=>{const id=next++;timers.set(id,f);return id},clearTimeout:id=>timers.delete(id),document:{baseURI:'https://uqu.test/',createElement:()=>({remove(){this.removed=true}}),head:{appendChild:s=>tags.push(s)}}};vm.createContext(c);
 const start=html.indexOf('const SCRIPT_SRI='),end=html.indexOf('function loadScript(');if(start>=0&&start<end)vm.runInContext(html.slice(start,end),c);vm.runInContext(helper(),c);return{c,tags,timers,load:url=>{c.url=url;return vm.runInContext('loadScript(url)',c)}}}
let passed=0,failed=0;async function test(name,f){try{await f();passed++;console.log('PASS '+name)}catch(e){failed++;console.error('FAIL '+name+': '+e.message)}}
(async()=>{
await test('concurrent requests for the same script share one promise and script tag',async()=>{const {load,tags,timers}=context(),p=load('/one.js'),q=load('/one.js');assert.equal(p,q);assert.equal(tags.length,1);tags[0].onload();await p;assert.equal(timers.size,0);assert.equal(tags[0].onload,null)});
await test('successful script is reused by subsequent callers',async()=>{const {load,tags}=context(),p=load('/one.js');tags[0].onload();await p;const q=load('/one.js');assert.equal(tags.length,1);await q});
await test('failed script is removed and can be retried',async()=>{const {load,tags,timers}=context(),p=load('/one.js');tags[0].onerror();await assert.rejects(p);assert.equal(tags[0].removed,true);assert.equal(timers.size,0);const q=load('/one.js');assert.equal(tags.length,2);tags[1].onload();await q});
await test('a stalled script times out, clears handlers and permits retry',async()=>{const {load,tags,timers}=context(),p=load('/one.js');assert.equal(timers.size,1,'loader has no deadline');[...timers.values()][0]();await assert.rejects(p);assert.equal(tags[0].onload,null);assert.equal(tags[0].onerror,null);assert.equal(tags[0].removed,true);const q=load('/one.js');tags[1].onload();await q});
await test('known JSZip bytes have the verified SRI hash and anonymous CORS',async()=>{const {load,tags}=context(),p=load('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');assert.equal(tags[0].integrity,'sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG');assert.equal(tags[0].crossOrigin,'anonymous');tags[0].onload();await p});
await test('unknown versions and custom scripts are not assigned another file integrity',async()=>{const {load,tags}=context(),p=load('https://cdn.example/another.js');assert.equal(tags[0].integrity,undefined);assert.equal(tags[0].crossOrigin,undefined);tags[0].onload();await p});
console.log(`Script loader: ${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
})().catch(e=>{console.error(e.stack);process.exitCode=1});
