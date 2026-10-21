// VM checks for secret-safe Apps Script transport; no real network or keys.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8'),a=html.indexOf('const GAS_NEED='),b=html.indexOf('// one folder (cached',a);
let source=html.slice(a,b);
if(process.argv.includes('--candidate')) {
 source=source.replace('async function gasOnce(c,op,extra,signal,ms,viaGet){','async function gasOnce(c,op,extra,signal,ms,viaGet){if(viaGet&&extra&&extra.key)throw gasErr("post");');
 source=source.replace('const g=await gasOnce(c,op,extra,signal,ms,true);','if(extra&&extra.key)throw gasErr("post");const g=await gasOnce(c,op,extra,signal,ms,true);');
}
function harness(reply){const calls=[],context={AbortController,setTimeout,clearTimeout,isObj:v=>!!v&&typeof v==='object'&&!Array.isArray(v),aiCfg:()=>({gas:'https://script.google.com/macros/s/fixturebridgecapability123456/exec',gtok:'fixture-bridge-capability'}),gasErr:(text)=>Object.assign(new Error('gas'),{code:'gas',text}),fetch:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(reply(calls.length,url,init)),{headers:{'Content-Type':'application/json'}})}};vm.createContext(context);vm.runInContext(source,context);return{calls,run:s=>vm.runInContext(s,context)};}
let passed=0;async function check(name,fn){await fn();passed++;console.log('OK '+name)}
(async()=>{
 await check('normal secret-bearing text request uses POST body only',async()=>{const h=harness(()=>({ok:true,op:'text',pages:['fixture']}));const r=await h.run('gasCall("text",{id:"abcdefghijklmnop",key:"fixture-api-key"})');assert.equal(r.ok,true);assert.equal(h.calls.length,1);assert.equal(h.calls[0].init.method,'POST');assert(!h.calls[0].url.includes('fixture-api-key'));assert.equal(JSON.parse(h.calls[0].init.body).key,'fixture-api-key')});
 await check('old bridge response cannot turn API key into GET query',async()=>{const h=harness(()=>({ok:false,err:'get',op:'get'}));await assert.rejects(()=>h.run('gasCall("text",{id:"abcdefghijklmnop",key:"fixture-api-key"})'));assert.equal(h.calls.length,1);assert(h.calls.every(c=>c.init.method==='POST'&&!c.url.includes('fixture-api-key')))});
 await check('gasOnce itself rejects a direct secret-bearing GET call',async()=>{const h=harness(()=>({ok:true,op:'text',pages:['fixture']}));await assert.rejects(()=>h.run('gasOnce(aiCfg(),"text",{key:"fixture-api-key"},undefined,1000,true)'));assert.equal(h.calls.length,0)});
 await check('safe ping GET fallback remains compatible',async()=>{const h=harness(n=>n===1?{ok:false,err:'get',op:'get'}:{ok:true,op:'ping',v:4});const r=await h.run('gasCall("ping",{})');assert.equal(r.ok,true);assert.equal(h.calls.length,2);assert.equal(h.calls[0].init.method,'POST');assert(new URL(h.calls[1].url).searchParams.has('q'))});
 console.log(passed+' secret-safe client transport checks passed');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
