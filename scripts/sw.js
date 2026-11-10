// Genererar service worker med lista över alla byggfiler (offline-stöd)
import fs from 'fs'; import path from 'path';
const dist='dist'; const files=[];
(function walk(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f);fs.statSync(p).isDirectory()?walk(p):files.push('/'+path.relative(dist,p).replaceAll('\\','/'))}})(dist);
const v=Date.now();
fs.writeFileSync(path.join(dist,'sw.js'),`const C='fs-${v}';const F=${JSON.stringify(['/',...files.filter(f=>f!=='/sw.js')])};
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(F)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C&&x!=='fs-ics').map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);if(u.origin!==location.origin||u.pathname.startsWith('/api/'))return;
if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/')));return}
e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request).catch(()=>caches.match('/'))))});`);
console.log('sw.js:',files.length,'filer');
