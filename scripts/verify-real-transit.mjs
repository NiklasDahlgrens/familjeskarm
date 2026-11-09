import {chromium} from 'playwright-core';import assert from 'node:assert/strict';
const url='https://familjeskarm.rose-and-root-reminders.workers.dev/';const errors=[];
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
function log(p){p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});}
const ctx=await b.newContext({viewport:{width:1340,height:800},locale:'sv-SE',timezoneId:'Europe/Stockholm'});const p=await ctx.newPage();log(p);
try{
await p.goto(url);await p.fill('[name=email]',process.env.FAMILJESKARM_EMAIL);await p.fill('[name=password]',process.env.FAMILJESKARM_PASSWORD);await p.click('#lf button');await p.waitForSelector('.dep-list');
if(await p.locator('#night').isVisible())await p.click('#night');await p.waitForTimeout(3500);
let d=await (await ctx.request.get(url+'api/departures')).json();assert.equal(d.status,'ok');assert.equal(d.gid,'9021014012140000');assert.ok(d.departures.length>0);
for(const theme of ['light','dark']){await p.click('#settings');await p.click(`[data-theme-set=${theme}]`);await p.click('#dlg [data-close]');await p.waitForFunction(()=>!document.querySelector('#dlg').open);await p.waitForTimeout(400);assert.ok(await p.locator('.dep').count());await p.locator('.side').evaluate(n=>{const c=n.querySelector('.transit');n.scrollTop=c.offsetTop-n.offsetTop;});await p.waitForTimeout(250);await p.screenshot({path:`screenshots/transit-tablet-${theme}.png`});}
const storage=await ctx.storageState();storage.origins.forEach(o=>o.localStorage=o.localStorage.filter(x=>x.name!=='fs-night'));
const phone=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'sv-SE',timezoneId:'Europe/Stockholm',storageState:storage});const q=await phone.newPage();log(q);await q.goto(url);await q.waitForSelector('.dep-list');assert.equal(await q.locator('#night').isVisible(),false);
for(const theme of ['light','dark']){await q.click('#settings2');await q.click(`[data-theme-set=${theme}]`);await q.click('#dlg [data-close]');await q.waitForFunction(()=>!document.querySelector('#dlg').open);await q.locator('.transit').scrollIntoViewIfNeeded();await q.waitForTimeout(400);await q.screenshot({path:`screenshots/transit-iphone${theme==='light'?'':'-dark'}.png`});assert.ok(await q.locator('.dep').count());}
assert.equal(errors.length,0);console.log('PASS: live real departures, tablet light/dark, iPhone light/dark, no console/page errors');
console.log('Verified GID:',d.gid);console.log('Lines/directions:',[...new Set(d.departures.map(x=>x.line+' → '+x.destination))].join('; '));
console.log('Examples (Europe/Stockholm):',JSON.stringify(d.departures.slice(0,6).map(x=>({line:x.line,destination:x.destination,planned:new Date(x.planned).toLocaleTimeString('sv-SE',{timeZone:'Europe/Stockholm',hour:'2-digit',minute:'2-digit'}),estimated:x.estimated?new Date(x.estimated).toLocaleTimeString('sv-SE',{timeZone:'Europe/Stockholm',hour:'2-digit',minute:'2-digit'}):null,platform:x.platform}))));
}finally{await b.close();}
