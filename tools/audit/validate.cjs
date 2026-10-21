// Parse and correctness-lint source plus generated deployable scripts, without executing integrations.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {ESLint}=require('eslint'),globals=require('globals');
const root=path.resolve(__dirname,'../..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
require('./csp.cjs').check(html);
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(s=>s.trim());
const generated=key=>{const a=html.indexOf('const '+key+'=');if(a<0)throw Error('Missing '+key);const end=key==='WORKER_JS'?html.indexOf('// ---------- 📂 settings:',a):html.indexOf(';\n',a)+2;const c={};vm.createContext(c);vm.runInContext(html.slice(a,end)+';globalThis.generated='+key,c);return c.generated};
(async()=>{for(const s of scripts)new vm.Script(s);const worker=generated('WORKER_JS'),bridge=generated('BRIDGE_GS');
// The compatible PDF3 fallback has CVE-2024-4367; this required upstream mitigation must never regress.
const appCode=scripts.join('\n');if((appCode.match(/\.getDocument\s*\(/g)||[]).length!==1||!appCode.includes('L.getDocument({isEvalSupported:false,data:buf})'))throw Error('Review every PDF document entrypoint: isEvalSupported:false is required for the legacy fallback');
// Worker uses ESM export; source parsing is delegated to ESLint's parser below.
new vm.Script(bridge);
const lint=new ESLint({cwd:root,overrideConfigFile:true,overrideConfig:[{languageOptions:{ecmaVersion:'latest',sourceType:'script',globals:{...globals.browser,...globals.es2024,firebase:'readonly',webkitAudioContext:'readonly',webkitSpeechRecognition:'readonly',SpeechRecognition:'readonly'}},rules:{'no-undef':'error','no-unreachable':'error','no-dupe-args':'error','no-dupe-keys':'error','no-constant-binary-expression':'error','no-unsafe-finally':'error','no-unexpected-multiline':'error','no-cond-assign':['error','except-parens']}},{files:['**/generated-worker.mjs'],languageOptions:{sourceType:'module'}}]});
let results=[];for(let i=0;i<scripts.length;i++)results.push(...await lint.lintText(scripts[i],{filePath:'site-script-'+i+'.js'}));results.push(...await lint.lintText(worker,{filePath:'generated-worker.mjs'}));
const output=await(await lint.loadFormatter('stylish')).format(results);if(output)process.stdout.write(output);const errors=results.reduce((n,r)=>n+r.errorCount,0);if(errors)process.exitCode=1;else console.log(`PASS ${scripts.length} site script(s), generated Worker and Apps Script parse; correctness lint has 0 errors`);
})().catch(e=>{console.error(e.message);process.exitCode=1});
