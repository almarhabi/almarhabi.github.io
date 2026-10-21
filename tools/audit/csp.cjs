// Keep the static page's inline-code hash in sync without enabling unsafe-inline.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const target=path.resolve(__dirname,'../../index.html');
function expected(html){
 const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>! /\bsrc\s*=/i.test(m[1])&&m[2].trim());
 if(!scripts.length)throw Error('No inline application script found');
 const hashes=scripts.map(m=>"'sha256-"+crypto.createHash('sha256').update(m[2]).digest('base64')+"'");
 return "script-src 'self' "+hashes.join(' ')+" 'strict-dynamic' https://www.gstatic.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; object-src 'none'; base-uri 'none'; form-action 'self'; worker-src 'self' blob: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com";
}
function check(html){const m=html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);if(!m||m[1]!==expected(html))throw Error('CSP hash is missing or stale. Run node tools/audit/csp.cjs --write after editing index.html');if(!html.includes('<meta name="referrer" content="no-referrer">'))throw Error('Missing no-referrer metadata')}
if(require.main===module){let html=fs.readFileSync(target,'utf8');if(process.argv.includes('--write')){const tag='<meta http-equiv="Content-Security-Policy" content="'+expected(html)+'">';html=html.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">\n?/,'');html=html.replace('<meta charset="utf-8">','<meta charset="utf-8">\n'+tag);fs.writeFileSync(target,html)}check(html);console.log('PASS CSP hashes match application code; unsafe-inline is not enabled; referrer policy is present')}
module.exports={check,expected};
