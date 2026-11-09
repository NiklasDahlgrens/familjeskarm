// Bygger en Worker som serverar dist/ (inbäddade filer) och /tmp/deploy-worker.js för Cloudflare MCP
import fs from 'fs'; import path from 'path';
const dist='dist', files={};
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.png':'image/png','.woff2':'font/woff2'};
const BIN=new Set(['.png','.woff2']);
(function walk(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f);fs.statSync(p).isDirectory()?walk(p):(()=>{const e=path.extname(p); files['/'+path.relative(dist,p).replaceAll('\\','/')]=BIN.has(e)?{t:types[e],b64:fs.readFileSync(p).toString('base64')}:{t:types[e]||'application/octet-stream',b:fs.readFileSync(p,"utf8")}})()}})(dist);
const env=Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));
const api=fs.readFileSync('scripts/worker-api.js','utf8').replace('__SB_URL__',env.VITE_SUPABASE_URL).replace('__SB_KEY__',env.VITE_SUPABASE_ANON_KEY);
const worker=api+`const F=${JSON.stringify(files)};
export default { async fetch(req, env, ctx) {
  const u=new URL(req.url); if(u.pathname==='/api/ics') return ics(req,u,ctx); if(u.pathname==='/api/departures') return departures(req,env,ctx); let p=u.pathname; if(p==='/') p='/index.html';
  let f=F[p]; if(!f){ if(/\\.[a-z0-9]+$/i.test(p)) return new Response('Not found',{status:404}); f=F['/index.html']; p='/index.html'; }
  const h={'Content-Type':f.t,'X-Content-Type-Options':'nosniff'};
  h['Cache-Control']=p.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache';
  if(p==='/sw.js') h['Service-Worker-Allowed']='/';
  const body=f.b64?Uint8Array.from(atob(f.b64),c=>c.charCodeAt(0)):f.b;
  return new Response(req.method==='HEAD'?null:body,{headers:h});
}};`;
fs.writeFileSync('scripts/worker.generated.js',worker);
const code=`async () => {
const W=${JSON.stringify(worker)};
const N='familjeskarm', S=\`/accounts/\${accountId}/workers/scripts/\${N}\`;
const form=new FormData();
form.append('metadata',new Blob([JSON.stringify({main_module:'worker.js',compatibility_date:'2026-11-01',keep_bindings:['plain_text','secret_text']})],{type:'application/json'}));
form.append('worker.js',new Blob([W],{type:'application/javascript+module'}),'worker.js');
const up=await cloudflare.request({method:'PUT',path:S,body:form});
const sd=await cloudflare.request({method:'POST',path:S+'/subdomain',body:{enabled:true,previews_enabled:false}});
return {ok:up.success, id:up.result&&up.result.id, sub:sd.result};
}`;
fs.writeFileSync('/tmp/deploy-worker.js',code); console.log(Object.keys(files), worker.length);
