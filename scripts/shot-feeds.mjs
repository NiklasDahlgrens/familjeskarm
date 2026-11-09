import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const PK = ['660a978d','164e229f','ec15923c','5b5e816f'];
async function run(sim, path) {
  const ctx = await b.newContext({ viewport:{width:1340,height:860}, locale:'sv-SE', timezoneId:'Europe/Stockholm', colorScheme:'light' });
  const p = await ctx.newPage(); let ok = 0;
  if (sim) await p.route('**/api/ics*', async r => { const id = new URL(r.request().url()).searchParams.get('id');
    try { const res = await r.fetch(); const body = await res.text();
      const h = { ...res.headers() }; if (PK.some(x => id.startsWith(x)) && !id.startsWith('5b5e816f')) { h['x-ics-cache']='stale'; h['x-ics-fetched-at']=String(Date.now()-2*3600e3); }
      await r.fulfill({ status: res.status(), headers: h, body }); } catch {} });
  p.on('response', r => { if (r.url().includes('/api/ics') && r.status()===200) ok++; });
  const dep = []; p.on('response', r => { if (r.url().includes('/api/departures')) dep.push(r.status()); });
  await p.goto('https://familjeskarm.rose-and-root-reminders.workers.dev/'); await p.waitForSelector('#lf');
  await p.fill('[name=email]', process.env.FAMILJESKARM_EMAIL); await p.fill('[name=password]', process.env.FAMILJESKARM_PASSWORD);
  await p.click('#lf button');
  for (let i=0;i<40 && ok<6;i++) await p.waitForTimeout(500);
  await p.waitForTimeout(1500);
  if (await p.locator('#night').isVisible()) await p.click('#night');
  await p.click('[data-view=kalender]'); await p.waitForTimeout(1200);
  const warn = await p.evaluate(() => document.querySelector('.warn')?.innerText || '');
  const h = await p.evaluate(() => document.querySelector('.warn')?.getBoundingClientRect().height || 0);
  await p.screenshot({ path });
  console.log(path, 'ics200=', ok, 'departures=', dep.join(','), 'warn=', JSON.stringify(warn), 'h=', Math.round(h));
  await p.unrouteAll({ behavior: 'ignoreErrors' }).catch(()=>{}); await ctx.close();
}
await run(false, 'screenshots/fix-feeds-kalender.png');
await run(true, 'screenshots/fix-feeds-banner-sim.png');
await b.close();
