// Bygger en Worker som serverar dist/ (inbäddade filer) och <tempmapp>/deploy-worker.js för Cloudflare MCP
import fs from 'fs'; import path from 'path'; import os from 'os'; import crypto from 'crypto';
const dist='dist', files={};
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.png':'image/png','.woff2':'font/woff2','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const BIN=new Set(['.png','.woff2','.jpg','.jpeg','.webp','.gif','.ico']); // allt binärt måste bäddas in som base64, annars förstörs filen
(function walk(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f);fs.statSync(p).isDirectory()?walk(p):(()=>{const e=path.extname(p); files['/'+path.relative(dist,p).replaceAll('\\','/')]=BIN.has(e)?{t:types[e],b64:fs.readFileSync(p).toString('base64')}:{t:types[e]||'application/octet-stream',b:fs.readFileSync(p,"utf8")}})()}})(dist);
const env=Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));
const api=fs.readFileSync('scripts/worker-api.js','utf8').replace('__SB_URL__',env.VITE_SUPABASE_URL).replace('__SB_KEY__',env.VITE_SUPABASE_ANON_KEY);
// Säkerhetsheaders. Skript får bara komma från den egna adressen; det enda inline-skriptet (temat i index.html) tillåts via sin hash.
// Inline-stilar behövs (style-attribut i vyerna). Anslutningar tillåts bara till Supabase och Open-Meteo.
const inlineHashes=[...files['/index.html'].b.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
const sbOrigin=env.VITE_SUPABASE_URL?new URL(env.VITE_SUPABASE_URL).origin:'';
const csp=["default-src 'self'",`script-src 'self' ${inlineHashes.join(' ')}`.trim(),"style-src 'self' 'unsafe-inline'","img-src 'self' data: https:","font-src 'self'",
  `connect-src 'self' ${sbOrigin} ${sbOrigin.replace(/^http/,'ws')} https://api.open-meteo.com`.replace(/\s+/g,' ').trim(),
  "manifest-src 'self'","worker-src 'self'","object-src 'none'","base-uri 'self'","form-action 'self'","frame-ancestors 'none'"].join('; ');
const sec={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY'};
const worker=api+`const F=${JSON.stringify(files)};const SEC=${JSON.stringify(sec)};const CSP=${JSON.stringify(csp)};
export default { async fetch(req, env, ctx) {
  const u=new URL(req.url); if(u.pathname==='/api/ics') return ics(req,u,ctx); if(u.pathname==='/api/departures') return departures(req,env,ctx);
  if(req.method!=='GET'&&req.method!=='HEAD') return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD',...SEC}});
  let p=u.pathname; if(p==='/') p='/index.html';
  let f=F[p]; if(!f){ if(/\\.[a-z0-9]+$/i.test(p)) return new Response('Not found',{status:404,headers:SEC}); f=F['/index.html']; p='/index.html'; }
  const h={'Content-Type':f.t,...SEC};
  if(p==='/index.html') h['Content-Security-Policy']=CSP;
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
const out=path.join(os.tmpdir(),'deploy-worker.js'); // /tmp finns inte på Windows
fs.writeFileSync(out,code); console.log(Object.keys(files), worker.length, '→', out);
