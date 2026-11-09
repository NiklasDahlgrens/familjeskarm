// Genererar /tmp/deploy.js för Cloudflare MCP execute (Pages direct upload)
import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
const dist = 'dist'; const files = [];
(function walk(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f);fs.statSync(p).isDirectory()?walk(p):files.push(p)}})(dist);
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','':'text/plain'};
const F = files.map(p => { const b64=fs.readFileSync(p).toString('base64'); const ext=path.extname(p);
  return { path:'/'+path.relative(dist,p).replaceAll('\\','/'), b64, hash: crypto.createHash('sha256').update(b64+ext.slice(1)).digest('hex').slice(0,32), ct: types[ext]||'application/octet-stream' }; });
const code = `async () => {
const F = ${JSON.stringify(F)};
const P='familjeskarm', A=\`/accounts/\${accountId}/pages/projects\`;
let proj; try { proj=(await cloudflare.request({method:'GET',path:A+'/'+P})).result } catch(e) {
  proj=(await cloudflare.request({method:'POST',path:A,body:{name:P,production_branch:'main'}})).result }
const jwt=(await cloudflare.request({method:'GET',path:A+'/'+P+'/upload-token'})).result.jwt;
const H={Authorization:'Bearer '+jwt,'Content-Type':'application/json'}, B='https://api.cloudflare.com/client/v4/pages/assets';
const miss=await (await fetch(B+'/check-missing',{method:'POST',headers:H,body:JSON.stringify({hashes:F.map(f=>f.hash)})})).json();
const need=new Set(miss.result||[]);
const up=F.filter(f=>need.has(f.hash)).map(f=>({key:f.hash,value:f.b64,metadata:{contentType:f.ct},base64:true}));
let upr=null; if(up.length) upr=await (await fetch(B+'/upload',{method:'POST',headers:H,body:JSON.stringify(up)})).json();
await fetch(B+'/upsert-hashes',{method:'POST',headers:H,body:JSON.stringify({hashes:F.map(f=>f.hash)})});
const form=new FormData(); form.append('manifest',JSON.stringify(Object.fromEntries(F.map(f=>[f.path,f.hash])))); form.append('branch','main');
form.append('_headers', new Blob(['/sw.js\\n  Cache-Control: no-cache\\n  Service-Worker-Allowed: /\\n/manifest.webmanifest\\n  Content-Type: application/manifest+json\\n/index.html\\n  Cache-Control: no-cache\\n'],{type:'text/plain'}),'_headers');
const dep=(await cloudflare.request({method:'POST',path:A+'/'+P+'/deployments',body:form})).result;
return {subdomain:proj.subdomain, url:dep.url, id:dep.id, missing:need.size, upload:upr&&upr.success, stage:dep.latest_stage};
}`;
fs.writeFileSync('/tmp/deploy.js', code); console.log(F.map(f=>f.path), code.length);
