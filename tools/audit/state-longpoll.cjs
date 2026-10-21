// Real Firebase JSONP/long-poll fallback under the production app's hash-based CSP.
// Uses cached public SDK bytes and a loopback demo emulator only; no live backend.
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),http=require('node:http');
let pw;try{pw=require('playwright-core')}catch{pw=require('../runner/node_modules/playwright-core')}
const address=process.env.FIREBASE_DATABASE_EMULATOR_HOST||'';
if(!/^(?:127\.0\.0\.1|localhost):\d+$/.test(address))throw Error('A loopback Firebase emulator is required.');
const namespace=process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT||'demo-uqu-longpoll';if(!/^demo-[a-z0-9-]+$/.test(namespace))throw Error('A synthetic demo- namespace is required.');
const port=Number(address.split(':')[1]);if(!(port>0&&port<65536))throw Error('Invalid emulator port');
// Different origins are essential: script-src self alone must not admit database JSONP.
const upstream='http://127.0.0.1:'+port,key='audit-longpoll-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';let origin,appUrl;
const root=path.resolve(__dirname,'../..'),html=fs.readFileSync(process.env.AI_AUDIT_SOURCE||path.join(root,'index.html'),'utf8');
const cache=process.env.AI_CDN_CACHE||path.join(os.tmpdir(),'uqu-cdn-audit'),manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'cdn-fixtures.json'),'utf8')),libraries=new Map();
for(const item of manifest.scripts.filter(x=>x.url.includes('/firebasejs/'))){const body=fs.readFileSync(path.join(cache,item.cache_file));assert.equal('sha384-'+crypto.createHash('sha384').update(body).digest('base64'),item.integrity,'Cached SDK bytes differ');libraries.set(item.url,{...item,body})}
assert.equal(libraries.size,2);assert(html.includes('http-equiv="Content-Security-Policy"'),'Production CSP is missing');
const baseline=html.replace(/\s*'strict-dynamic'/g,''),candidate=html.includes("'strict-dynamic'")?html:html.replace('content="script-src ','content="script-src \'strict-dynamic\' ');
if(!html.includes("'strict-dynamic'")&&!process.argv.includes('--candidate'))throw Error('Production CSP lacks strict-dynamic; use --candidate only to verify the proposed CSP delta.');
async function request(location,method='GET',body,owner=false){const response=await fetch(upstream+location+'?ns='+namespace,{method,headers:{'Content-Type':'application/json',...(owner?{Authorization:'Bearer owner'}:{})},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});const data=await response.json();assert.equal(response.status,200,'Emulator request failed: '+JSON.stringify(data));return data}
(async()=>{
 await request('/.settings/rules.json','PUT',JSON.parse(fs.readFileSync(path.join(root,'infra/firebase/database.capability.rules.json'),'utf8')),true);
 let servedSource=html;const appServer=http.createServer((req,res)=>{if(req.url==='/longpoll-audit/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(servedSource)}else{res.writeHead(204);res.end()}});
 await new Promise((resolve,reject)=>{appServer.once('error',reject);appServer.listen(0,'127.0.0.1',resolve)});origin='http://127.0.0.1:'+appServer.address().port;appUrl=origin+'/longpoll-audit/';
 let browser;try{browser=await pw.chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||process.env.CHROME_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});let passed=0;
  async function run(source){servedSource=source;const context=await browser.newContext({permissions:['local-network-access']}),consoleErrors=[],requests=[],responses=[];let ws=0;
   context.on('request',request=>requests.push(request.url()));context.on('response',response=>{if(response.url().startsWith(upstream+'/.lp?'))responses.push(response.status())});
   await context.route(url=>url.origin!==origin&&url.origin!==upstream,async route=>{const url=route.request().url();if(url===appUrl)return route.fulfill({contentType:'text/html',body:source});const item=libraries.get(url);if(item)return route.fulfill({contentType:item.content_type,headers:{'Access-Control-Allow-Origin':'*'},body:item.body});if(url.startsWith(upstream+'/'))return route.continue();if(url.startsWith('https://fonts.googleapis.com/'))return route.fulfill({contentType:'text/css',body:''});if(url.startsWith(origin+'/'))return route.fulfill({status:204,body:''});consoleErrors.push('Unexpected external request: '+url);return route.abort()});
   const page=await context.newPage();
   // Chromium 154 split localNetworkAccess into localNetwork/loopbackNetwork.
   // Grant only this isolated fixture context (including its blank JSONP iframe).
   // Keep the legacy and split permissions together; CSP and web security stay enabled.
   const cdp=await context.newCDPSession(page),{targetInfo}=await cdp.send('Target.getTargetInfo');
   try{await cdp.send('Browser.grantPermissions',{browserContextId:targetInfo.browserContextId,permissions:['localNetworkAccess','localNetwork','loopbackNetwork']})}
   catch(error){if(!/Unknown permission|Invalid parameters|Invalid PermissionType|Permission can't be granted/i.test(error.message))throw error;await context.grantPermissions(['local-network-access'])}
   await cdp.detach();page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});page.on('pageerror',e=>consoleErrors.push(e.message));page.on('websocket',()=>ws++);await page.goto(appUrl);await page.waitForFunction(()=>typeof loadScript==='function');
   await page.evaluate(async({namespace,port,key})=>{
    await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js');
    const app=firebase.initializeApp({apiKey:'fixture-public-config',projectId:namespace,databaseURL:'https://'+namespace+'.firebaseio.com'},'longpoll-fixture'),db=app.database();db.useEmulator('127.0.0.1',port);db.INTERNAL.forceLongPolling();window.longpollDB=db;window.longpollResult=null;
    fbAdapter(db.ref('users/'+key),db).updatePaths({'marks/fallback/cards':7},'').then(r=>{window.longpollResult={committed:r.committed,value:r.snapshot.val()}}).catch(e=>{window.longpollResult={error:e.message}});
   },{namespace,port,key});
   let success=false;try{await page.waitForFunction(()=>window.longpollResult!==null,undefined,{timeout:5000});success=await page.evaluate(()=>window.longpollResult&&window.longpollResult.committed===true)}catch{}
   const result={success,errors:consoleErrors,requests,responses,ws,sri:await page.evaluate(()=>[...document.scripts].filter(s=>s.src.includes('/firebasejs/')).map(s=>s.integrity))};await context.close();return result;
  }
  const blocked=await run(baseline);assert.equal(blocked.success,false,'Control CSP unexpectedly allowed cross-origin JSONP');assert(blocked.errors.some(e=>/Content Security Policy|violates.*script-src/i.test(e)&&/127\.0\.0\.1/.test(e)),'Control must fail specifically because CSP rejects database JSONP');assert.equal(blocked.ws,0);console.log('PASS actual SDK forced long-poll fallback is blocked by the original CDN-only CSP');passed++;
  const allowed=await run(candidate);assert.equal(allowed.success,true,'Trusted long-poll script failed: '+JSON.stringify(allowed.errors));assert(allowed.requests.some(u=>u.startsWith(upstream+'/.lp?')),'Actual database JSONP request was not observed');assert(allowed.responses.includes(200),'No real JSONP HTTP200 response was observed');assert.equal(allowed.ws,0,'Test used WebSockets instead of the long-poll fallback');assert.equal(allowed.sri.length,2);assert(allowed.sri.every(s=>s.startsWith('sha384-')));assert.deepEqual(allowed.errors,[]);assert.equal((await request('/users/'+key+'/marks/fallback/cards.json')),7);console.log('PASS strict-dynamic permits real JSONP descendants loaded through the app hash script and SRI loader ('+allowed.responses.length+' observed HTTP responses)');passed++;
  console.log(passed+' real Firebase long-poll/CSP integration checks passed');
 }finally{if(browser)await browser.close();await request('/users/'+key+'.json','DELETE',undefined,true);await new Promise(resolve=>appServer.close(resolve))}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
