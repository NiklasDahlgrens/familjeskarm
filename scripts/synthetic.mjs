// Visuellt test med syntetiska kalenderdata (flerdagars, överlapp, långa titlar, heldagar, en trasig kalender). Ändrar ingen data.
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://localhost:4173/'; const OUT = process.env.OUT || '/workspace/qa';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const pad = n => String(n).padStart(2, '0');
const t = new Date(); const d = k => { const x = new Date(t); x.setDate(x.getDate() + k); return `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}`; };
const ev = (uid, s, e, sum) => `BEGIN:VEVENT\nUID:${uid}\nDTSTART${s.length === 8 ? ';VALUE=DATE' : ';TZID=Europe/Stockholm'}:${s}\nDTEND${e.length === 8 ? ';VALUE=DATE' : ';TZID=Europe/Stockholm'}:${e}\nSUMMARY:${sum}\nLOCATION:Testgatan 1\nEND:VEVENT`;
const ics = `BEGIN:VCALENDAR\nVERSION:2.0\n${[
  ev('a', d(0) + 'T080000', d(0) + 'T093000', 'Frukostmöte'), ev('b', d(0) + 'T090000', d(0) + 'T110000', 'Överlappande workshop med ett riktigt långt namn som måste kortas av snyggt'),
  ev('c', d(0) + 'T230000', d(2) + 'T070000', 'Nattresa till Stockholm'), ev('e', d(1), d(4), 'Semester i fjällen'),
  ev('f', d(1) + 'T120000', d(1) + 'T130000', 'Lunch'), ev('g', d(0) + 'T200000', d(0) + 'T235900', 'Kvällsfilm'),
].join('\n')}\nEND:VCALENDAR`;
for (const [dn, opts] of [['tab', { viewport: { width: 1340, height: 800 } }], ['ph', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
  const ctx = await b.newContext({ ...opts, timezoneId: 'Europe/Stockholm', locale: 'sv-SE' }); await ctx.addInitScript(() => localStorage.setItem('fs-theme', 'light'));
  const p = await ctx.newPage(); const errs = []; let n = 0, bad = null;
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.route('**/api/ics*', r => { n++; const id = new URL(r.request().url()).searchParams.get('id'); bad ||= id; return (id === bad ? r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"upstream 500"}' }) : r.fulfill({ status: 200, contentType: 'text/calendar', body: ics.replace(/UID:(\w)/g, `UID:$1${n}`) })); });
  await p.goto(BASE); await p.waitForSelector('#lf'); await p.fill('[name=email]', process.env.FAMILJESKARM_EMAIL); await p.fill('[name=password]', process.env.FAMILJESKARM_PASSWORD); await p.click('#lf button');
  await p.waitForSelector('#main .dash'); await p.waitForTimeout(4000);
  await p.screenshot({ path: `${OUT}/syn-${dn}-hem.png` });
  await p.click('.nav [data-view=kalender]'); await p.waitForTimeout(800); await p.screenshot({ path: `${OUT}/syn-${dn}-kalender.png` }); await p.evaluate(() => { const m = document.querySelector('#main'); m.style.scrollBehavior = 'auto'; m.scrollTop = 1e5; document.querySelectorAll('.dlist').forEach(x => x.scrollTop = 1e5); }); await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/syn-${dn}-kalender2.png` }); await p.click('[data-act=next]'); await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/syn-${dn}-kalender3.png` });
  await p.click('.nav [data-view=hem]'); await p.waitForTimeout(800); await p.screenshot({ path: `${OUT}/syn-${dn}-hem2.png` });
  console.log(dn, errs.join('\n') || 'inga fel'); await ctx.close();
}
await b.close();
