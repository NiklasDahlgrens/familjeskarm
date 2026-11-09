import { chromium } from 'playwright-core';import assert from 'node:assert/strict';
const URL='https://familjeskarm.rose-and-root-reminders.workers.dev/';
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const errors=[];
const ctx=await b.newContext({viewport:{width:1340,height:800},timezoneId:'Europe/Stockholm',locale:'sv-SE'});const p=await ctx.newPage();
function log(p){p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});}log(p);
try{
await p.clock.install({time:new Date()});
await p.goto(URL);await p.fill('[name=email]',process.env.FAMILJESKARM_EMAIL);await p.fill('[name=password]',process.env.FAMILJESKARM_PASSWORD);await p.click('#lf button');await p.waitForSelector('.transit');await p.waitForFunction(()=>document.querySelector('.dep-empty')?.textContent.includes('inte konfigurerade'));await p.waitForTimeout(3000);
assert.equal((await (await ctx.request.get(URL+'api/departures')).json()).status,'unconfigured');
if(await p.locator('#night').isVisible())await p.click('#night');
await p.evaluate(()=>localStorage.setItem('fs-theme','light'));await p.reload();await p.waitForSelector('.transit');if(await p.locator('#night').isVisible())await p.click('#night');await p.waitForTimeout(1500);await p.screenshot({path:'screenshots/transit-tablet-light.png'});
for(const view of ['kalender','todo','matsedel','recept','inkop','hem']){await p.click(`[data-view=${view}]`);await p.waitForTimeout(250);assert.ok(await p.locator('#main').innerText());}
await p.click('#settings');await p.click('[data-theme-set=dark]');await p.locator('#dlg [data-close]').click();await p.waitForFunction(()=>!document.querySelector('#dlg').open);await p.screenshot({path:'screenshots/transit-tablet-dark.png'});await p.click('#settings');await p.click('[data-theme-set=light]');assert.equal(await p.locator('#night-enabled').isChecked(),true);await p.uncheck('#night-enabled');assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('fs-night')).enabled),false);await p.check('#night-enabled');await p.locator('#dlg [data-close]').click();
// Fixera endast testwebbläsarens klocka, ingen testparameter i produktionen.
await p.waitForFunction(()=>!document.querySelector('#dlg').open);
await p.clock.setSystemTime(new Date('2026-11-08T22:00:00+01:00'));await p.reload();await p.waitForSelector('.transit');await p.waitForTimeout(1500);await p.clock.runFor(1100);assert.equal(await p.locator('#night').isVisible(),false);
await p.clock.setSystemTime(new Date('2026-11-08T23:00:01+01:00'));await p.clock.runFor(1100);assert.equal(await p.locator('#night').isVisible(),true);await p.screenshot({path:'screenshots/nightmode-tablet.png'});
const before=await p.locator('.n-content').evaluate(n=>n.style.transform);await p.clock.runFor(61000);const after=await p.locator('.n-content').evaluate(n=>n.style.transform);assert.notEqual(before,after);
await p.click('#night');assert.equal(await p.locator('#night').isVisible(),false);await p.clock.runFor(119000);assert.equal(await p.locator('#night').isVisible(),false);await p.clock.runFor(2200);assert.equal(await p.locator('#night').isVisible(),true);
await p.clock.setSystemTime(new Date('2026-11-09T05:59:00+01:00'));await p.clock.runFor(1100);assert.equal(await p.locator('#night').isVisible(),true);await p.clock.setSystemTime(new Date('2026-11-09T06:00:00+01:00'));await p.clock.runFor(1100);assert.equal(await p.locator('#night').isVisible(),false);
const storage=await ctx.storageState();storage.origins.forEach(o=>o.localStorage=o.localStorage.filter(v=>v.name!=='fs-night'));
const phone=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Stockholm',locale:'sv-SE',storageState:storage});const q=await phone.newPage();log(q);await q.goto(URL);await q.waitForSelector('.transit');await q.click('#settings2');assert.equal(await q.locator('#night-enabled').isChecked(),false);await q.locator('#dlg [data-close]').click();await q.screenshot({path:'screenshots/transit-iphone.png',fullPage:true});await phone.close();
console.log('PASS: live unconfigured endpoint, six existing views, settings persistence, 23–06 schedule, 2 min wake, position shift, automatic morning wake, iPhone default off');console.log('Console/page errors:',JSON.stringify(errors));assert.equal(errors.length,0);
}finally{await b.close();}
