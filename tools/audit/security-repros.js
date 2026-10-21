// Offline production-audit reproductions. No live services, user data or real credentials.
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright-core');
(async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext();await context.route('**/*',r=>r.request().url()==='http://audit.test/'?r.fulfill({contentType:'text/html',body:html}):r.abort());
  const page=await context.newPage();await page.goto('http://audit.test/');
  await page.evaluate(()=>{
   window.__securityXss=0;
   S.extra=JSON.stringify([{id:'audit"><img src="/invalid-image" onerror="window.__securityXss=1"><span data-x="',date:'2026-10-21',kind:'lec',from:1,to:2,topic:'Security fixture',dr:''}]);
   blkSig=null;applyEdits();st.wi=1;st.di=3;render();
  });
  await page.waitForTimeout(200);
  const xss=await page.evaluate(()=>window.__securityXss);
  const pollute=await page.evaluate(async()=>{
   delete Object.prototype.__securityPolluted;
   const doc={update:async()=>{}};
   try { await claudeAdapter(doc).updatePaths({'marks/audit/__proto__/__securityPolluted':true}); } catch (e) { /* rejecting the path is secure */ }
   const value=({}).__securityPolluted===true;
   delete Object.prototype.__securityPolluted;return value;
  });
  const extraSinks=await page.evaluate(async()=>{
   const wait=()=>new Promise(r=>setTimeout(r,100));
   const id=BASE_ALL[0].id,target=document.createElement('div');document.body.appendChild(target);
   window.__securityXssCpr=0;window.__securityXssKnot=0;window.__securityXssReward=0;window.__securityXssFrozenFine=0;
   S.extra=false;blkSig=null;applyEdits();
   const clip=JSON.stringify({n:4,a:Date.now(),c:[[1,4,'Clip','مقطع',10,'Hook',['A point'],'free','Recall it']]});
   S.marks[id]={clips:clip,cpr:JSON.stringify({r:['audit"><img src="/invalid-image" onerror="window.__securityXssCpr=1"><i x="'],t:[1],i:0,m:[]})};st.open=id;target.innerHTML=cardHTML(BY_ID[id]);await wait();
   const cpr=window.__securityXssCpr===1;
   S.marks[id]={knots:{['audit"><img src="/invalid-image" onerror="window.__securityXssKnot=1"><i x="']:{t:'Fixture knot',c:'2026-10-21'}}};target.innerHTML=cardHTML(BY_ID[id]);await wait();
   const knot=window.__securityXssKnot===1;
   S.rewards=JSON.stringify([{id:'audit"><img src="/invalid-image" onerror="window.__securityXssReward=1"><i x="',n:'Fixture reward',c:1}]);st.achTab='r';setPage('career');await wait();
   const reward=window.__securityXssReward===1;
   S.marks[id]={wpf:JSON.stringify([{at:Date.now(),a:-1,t:'<img src="/invalid-image" onerror="window.__securityXssFrozenFine=1">',what:'fixture'}])};LV++;LG=null;st.achTab='l';renderCareerPage();await wait();
   const frozen=window.__securityXssFrozenFine===1;
   target.remove();return{storedXssViaRecallRating:cpr,storedXssViaKnotKey:knot,storedXssViaRewardId:reward,storedXssViaFrozenFine:frozen};
  });
  const linkContext=await browser.newContext();await linkContext.route('**/*',r=>r.request().url().startsWith('http://audit.test/')?r.fulfill({contentType:'text/html',body:html}):r.abort());
  await linkContext.addInitScript(()=>{localStorage.setItem('uqu-fb',JSON.stringify({config:{apiKey:'mock',projectId:'audit-original',databaseURL:'https://audit-original.firebaseio.com'},key:'original-sync-key-000000000000'}));localStorage.setItem('uqu-state-v2',JSON.stringify({marks:{'9-3-1':{studied:'2026-10-20'}},lk:'original-sync-key-000000000000'}))});
  const lp=await linkContext.newPage(),payload=Buffer.from(JSON.stringify({c:{apiKey:'mock',projectId:'audit-foreign',databaseURL:'https://audit-foreign.firebaseio.com'},k:'foreign-sync-key-000000000000'})).toString('base64url');await lp.goto('http://audit.test/#sync='+payload);
  const switched=await lp.evaluate(()=>JSON.parse(localStorage.getItem('uqu-fb')||'{}').key==='foreign-sync-key-000000000000');await linkContext.close();
  const rewardsContext=await browser.newContext();await rewardsContext.route('**/*',r=>r.request().url().startsWith('http://audit.test/')?r.fulfill({contentType:'text/html',body:html}):r.abort());
  await rewardsContext.addInitScript(()=>{localStorage.setItem('uqu-state-v2',JSON.stringify({marks:{},rewards:JSON.stringify([{id:'private-reward',n:'Private local fixture',c:10}])}))});
  const rp=await rewardsContext.newPage();await rp.goto('http://audit.test/#sync='+payload);
  const rewardsSwitched=await rp.evaluate(()=>JSON.parse(localStorage.getItem('uqu-fb')||'{}').key==='foreign-sync-key-000000000000');await rewardsContext.close();
  const findings={storedXssViaCustomLectureId:xss===1,prototypePollutionViaNestedSyncPath:pollute,...extraSinks,existingSyncSilentlyReplacedByLink:switched,localRewardsSilentlyMergedByLink:rewardsSwitched}; console.log(JSON.stringify(findings));if(process.argv.includes('--assert-secure')&&Object.values(findings).some(Boolean))process.exitCode=1;
 }finally{await browser.close()}
})().catch(e=>{console.error(e.message);process.exit(1)});
