// Inga avgångar sparas offline: gammal information ska inte se ut som realtid.
let state={status:'loading',departures:[]}, busy=false, lastTry=0;
export const transit=()=>state;
export async function loadTransit(force=false){
  if(busy||(!force&&Date.now()-lastTry<45000)) return false;
  busy=true;lastTry=Date.now();
  try{
    const r=await fetch('/api/departures',{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!r.ok) throw new Error('HTTP');
    const d=await r.json(); if(!['ok','unconfigured','unavailable'].includes(d.status)||!Array.isArray(d.departures)) throw new Error('shape');
    state=d;
  }catch{state={status:'unavailable',departures:[]};}
  finally{busy=false;}
  return true;
}
