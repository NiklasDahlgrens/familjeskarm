// /api/ics?id=<feed id> – hämtar en kalender server-side. Kräver Supabase-token; RLS avgör åtkomst.
const SB_URL='__SB_URL__', SB_KEY='__SB_KEY__';
const ALLOWED=[/(^|\.)icloud\.com$/i,/^calendar\.google\.com$/i,/^outlook\.office365\.com$/i,/^outlook\.live\.com$/i,/(^|\.)personalkollen\.se$/i];
const J=(m,s)=>new Response(JSON.stringify({error:m}),{status:s,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const ICS_UA='Mozilla/5.0 (compatible; Familjeskarm/1.1; +https://familjeskarm.rose-and-root-reminders.workers.dev) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const allowedHost=h=>ALLOWED.some(x=>x.test(h));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const MAX_ICS=8*1024*1024; // tak för en kalenderfil (även efter uppackning), så att ett jättesvar inte kan fylla Workerns minne
const tooLarge=()=>Object.assign(new Error('too large'),{name:'TooLarge'});
async function readCapped(res,max){
  if(Number(res.headers.get('Content-Length'))>max) throw tooLarge();
  if(!res.body) return new Uint8Array(0);
  const reader=res.body.getReader(), chunks=[]; let n=0;
  for(;;){ const {done,value}=await reader.read(); if(done) break; n+=value.length; if(n>max){ try{ await reader.cancel(); }catch{} throw tooLarge(); } chunks.push(value); }
  const out=new Uint8Array(n); let o=0; for(const c of chunks){ out.set(c,o); o+=c.length; } return out;
}
const sha256hex=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');
// Hämtar med egna redirects (bara inom tillåtna värdar), timeout och omförsök med backoff vid nätverksfel/5xx/429.
async function fetchIcs(src){
  let last='';
  for(let attempt=0;attempt<3;attempt++){
    if(attempt) await sleep(attempt===1?500:1500);
    try{
      let url=src, up;
      for(let hop=0;;hop++){
        up=await fetch(url.toString(),{headers:{'User-Agent':ICS_UA,'Accept':'text/calendar, text/plain;q=0.9, */*;q=0.8','Accept-Language':'sv-SE,sv;q=0.9,en;q=0.5'},redirect:'manual',signal:AbortSignal.timeout(10000)});
        if(up.status<300||up.status>=400) break;
        const loc=up.headers.get('Location'); if(!loc||hop>=4) return {status:502,error:'redirect loop'};
        url=new URL(loc,url); if(url.protocol!=='https:'||!allowedHost(url.hostname)) return {status:403,error:'redirect to '+url.hostname+' not allowed'};
      }
      if(!up.ok){ last='upstream '+up.status; if(up.status>=500||up.status===429||up.status===408) continue; return {status:up.status===404||up.status===410?404:502,error:last,final:true}; }
      let buf=await readCapped(up,MAX_ICS);
      if(buf[0]===0x1f&&buf[1]===0x8b) buf=await readCapped(new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))),MAX_ICS);
      const body=new TextDecoder().decode(buf);
      if(!/BEGIN:VCALENDAR/.test(body)){ last='not ics'; continue; }
      return {body};
    }catch(e){
      if(e&&e.name==='TooLarge') return {status:502,error:'too large',final:true}; // ingen idé att försöka igen
      last=(e&&e.name==='TimeoutError')?'timeout':'network '+(e&&e.name||'error');
    }
  }
  return {status:502,error:last};
}
async function ics(req,u,ctx){
  if(req.method!=='GET') return new Response(null,{status:405,headers:{Allow:'GET'}});
  const auth=req.headers.get('Authorization')||''; const id=u.searchParams.get('id')||'';
  if(!/^Bearer \S+$/.test(auth)) return J('unauthorized',401);
  if(!/^[0-9a-f-]{36}$/i.test(id)) return J('bad id',400);
  const r=await fetch(`${SB_URL}/rest/v1/calendar_feeds?id=eq.${id}&select=url`,{headers:{apikey:SB_KEY,Authorization:auth}});
  if(r.status===401||r.status===403) return J('unauthorized',401);
  if(!r.ok) return J('lookup failed',502);
  const rows=await r.json(); if(!rows.length) return J('not found',404);
  let src; try{ src=new URL(rows[0].url.trim().replace(/^webcal:/i,'https:')); }catch{ return J('bad url',400); }
  if(src.protocol!=='https:'||!allowedHost(src.hostname)) return J('host not allowed',403);
  // Schemakällor (Personalkollen) ändras sällan: 20 min färskt. Allt sparas 7 dygn som reserv (stale-if-error).
  const ttl=/personalkollen\.se$/i.test(src.hostname)?20*60e3:2*60e3;
  // Nyckeln bygger på länkens innehåll (inte dess längd), så en ändrad länk aldrig får den gamla länkens kopia.
  const key=new Request('https://ics-cache.familjeskarm.internal/v4/'+id+'/'+(await sha256hex(src.toString())).slice(0,32));
  const cache=caches.default; const hit=await cache.match(key);
  const hitAt=hit?Number(hit.headers.get('X-Fetched-At'))||0:0;
  const out=(body,at,extra={})=>new Response(body,{headers:{'Content-Type':'text/calendar; charset=utf-8','Cache-Control':'private, no-store','X-Ics-Fetched-At':String(at),...extra}});
  if(hit&&Date.now()-hitAt<ttl) return out(hit.body,hitAt,{'X-Ics-Cache':'hit'});
  const res=await fetchIcs(src);
  if(res.body){
    const now=Date.now();
    ctx.waitUntil(cache.put(key,new Response(res.body,{headers:{'Content-Type':'text/calendar; charset=utf-8','Cache-Control':'public, max-age=604800','X-Fetched-At':String(now)}})));
    return out(res.body,now,{'X-Ics-Cache':'miss'});
  }
  console.log(JSON.stringify({ics:'fail',feed:id,host:src.hostname,error:res.error,stale:!!hit}));
  if(hit&&!res.final) return out(hit.body,hitAt,{'X-Ics-Cache':'stale','X-Ics-Error':res.error});
  return J(res.error,res.status||502);
}

// Västtrafik Planera Resa v4. Endast serverhemligheter; inga exempelavgångar.
const VT_BASE='https://ext-api.vasttrafik.se/pr/v4';
let vtToken=null, vtStop=null;
const vtJson = body => new Response(JSON.stringify(body), {headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
async function vtFetch(url, options={}) {
  return fetch(url,{...options,signal:AbortSignal.timeout(10000)});
}
async function vtAccess(env) {
  if(vtToken && vtToken.client===env.VASTTRAFIK_CLIENT_ID && vtToken.expires>Date.now()) return vtToken.value;
  const r=await vtFetch('https://ext-api.vasttrafik.se/token',{method:'POST',headers:{Authorization:'Basic '+btoa(env.VASTTRAFIK_CLIENT_ID+':'+env.VASTTRAFIK_CLIENT_SECRET),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
  if(!r.ok) throw new Error('token');
  const d=await r.json(); if(!d.access_token) throw new Error('token');
  vtToken={client:env.VASTTRAFIK_CLIENT_ID,value:d.access_token,expires:Date.now()+Math.max(0,Number(d.expires_in||300)-60)*1000};
  return vtToken.value;
}
async function vtGet(path,env) {
  let token=await vtAccess(env);
  let r=await vtFetch(VT_BASE+path,{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
  if(r.status===401){ vtToken=null; token=await vtAccess(env); r=await vtFetch(VT_BASE+path,{headers:{Authorization:'Bearer '+token,Accept:'application/json'}}); }
  if(!r.ok) throw new Error('upstream');
  return r.json();
}
async function vtStopGid(env) {
  if(env.VASTTRAFIK_STOP_GID){if(!/^9021\d{12}$/.test(env.VASTTRAFIK_STOP_GID)) throw new Error('stop'); return env.VASTTRAFIK_STOP_GID;}
  if(vtStop) return vtStop;
  const d=await vtGet('/locations/by-text?q=Lackareb%C3%A4ck&types=stoparea&limit=20&latitude=57.665&longitude=12.012',env);
  const candidates=(d.results||[]).filter(x=>/^9021\d{12}$/.test(x.gid)&&/^Lackarebäck(?:,|$)/i.test(x.name||''));
  // Prioritera exakt hållplatsnamn i Mölndal; annars närmast hemorten. Inga hållplatslägen filtreras bort.
  candidates.sort((a,b)=>Number(/Mölndal/i.test(b.name))-Number(/Mölndal/i.test(a.name))||((a.latitude-57.665)**2+(a.longitude-12.012)**2)-((b.latitude-57.665)**2+(b.longitude-12.012)**2));
  if(!candidates.length) throw new Error('stop'); vtStop=candidates[0].gid; return vtStop;
}
const vtColor=(s,f)=>/^#?[0-9a-f]{6}$/i.test(s||'')?'#'+s.replace('#',''):f;
async function departures(req,env,ctx) {
  if(req.method!=='GET') return new Response(null,{status:405,headers:{Allow:'GET'}});
  if(!env.VASTTRAFIK_CLIENT_ID||!env.VASTTRAFIK_CLIENT_SECRET) return vtJson({status:'unconfigured',stop:'Lackarebäck',departures:[]});
  try {
    const gid=await vtStopGid(env);
    const key=new Request('https://departures-cache.familjeskarm.internal/v1/'+gid);
    const cached=await caches.default.match(key); if(cached) return vtJson(await cached.json());
    const d=await vtGet('/stop-areas/'+gid+'/departures?timeSpanInMinutes=120&maxDeparturesPerLineAndDirection=2&limit=12',env);
    if(!Array.isArray(d.results)) throw new Error('shape');
    const rows=d.results.map(x=>{const j=x.serviceJourney||{},l=j.line||{};return {
      line:l.shortName||l.designation||l.name||'–',destination:j.direction||'Okänd destination',
      background:vtColor(l.backgroundColor,'#475569'),foreground:vtColor(l.foregroundColor,'#ffffff'),
      planned:x.plannedTime,estimated:x.estimatedTime||null,cancelled:!!x.isCancelled,partCancelled:!!x.isPartCancelled,
      platform:x.stopPoint?.platform||'',
    };}).filter(x=>Number.isFinite(Date.parse(x.planned))).sort((a,b)=>Date.parse(a.estimated||a.planned)-Date.parse(b.estimated||b.planned));
    const body={status:'ok',stop:'Lackarebäck',gid,updatedAt:new Date().toISOString(),departures:rows};
    ctx.waitUntil(caches.default.put(key,new Response(JSON.stringify(body),{headers:{'Cache-Control':'public, max-age=30','Content-Type':'application/json'}})).catch(()=>{}));
    return vtJson(body);
  } catch(e) {
    // Logga aldrig tokens eller uppströms svar som kan innehålla hemligheter.
    console.info('Västtrafik kunde inte hämtas:',e.message==='stop'?'hållplats saknas':'tillfälligt fel');
    return vtJson({status:'unavailable',stop:'Lackarebäck',departures:[]});
  }
}
