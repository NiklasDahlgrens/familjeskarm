// QA: skärmdumpar av alla vyer, tablet/iPhone, ljust/mörkt. BASE=url OUT=dir
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://localhost:4173/';
const LIVE = 'https://familjeskarm.rose-and-root-reminders.workers.dev';
const OUT = process.env.OUT || '/workspace/qa';
const ONLY = process.env.ONLY || '';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errs = [];
const devs = {
  tab: { viewport: { width: 1340, height: 800 }, deviceScaleFactor: 1, hasTouch: true },
  ph: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
for (const [dn, opts] of Object.entries(devs)) for (const theme of ['light', 'dark']) {
  if (ONLY && !ONLY.split(',').includes(dn + '-' + theme)) continue;
  const ctx = await b.newContext({ ...opts, timezoneId: 'Europe/Stockholm', locale: 'sv-SE' });
  await ctx.addInitScript(t => localStorage.setItem('fs-theme', t), theme);
  const p = await ctx.newPage(); const tag = `${dn}-${theme}`;
  if (!BASE.includes('workers.dev')) await p.route('**/api/ics*', async r => { const u = new URL(r.request().url()); const res = await r.fetch({ url: LIVE + u.pathname + u.search }); await r.fulfill({ response: res }); });
  p.on('console', m => (m.type() === 'error' || m.type() === 'warning') && errs.push(tag + ' ' + m.type() + ': ' + m.text()));
  p.on('pageerror', e => errs.push(tag + ' pageerror: ' + e.message));
  p.on('response', r => { if (r.status() >= 400) errs.push(tag + ' HTTP ' + r.status() + ' ' + r.url().slice(0, 120)); });
  await p.goto(BASE); await p.waitForSelector('#lf, #main', { timeout: 15000 });
  if (await p.$('#lf')) {
    await p.screenshot({ path: `${OUT}/${tag}-login.png` });
    await p.fill('[name=email]', process.env.FAMILJESKARM_EMAIL); await p.fill('[name=password]', process.env.FAMILJESKARM_PASSWORD);
    await p.click('#lf button');
  }
  await p.waitForSelector('#main'); await p.waitForTimeout(5000);
  for (const v of ['hem', 'kalender', 'todo', 'matsedel', 'recept', 'inkop']) {
    await p.click(`.nav [data-view=${v}]`); await p.waitForTimeout(700);
    await p.screenshot({ path: `${OUT}/${tag}-${v}.png`, fullPage: false });
    const ov = await p.evaluate(() => { const m = document.querySelector('#main'); const bad = []; document.querySelectorAll('#main *').forEach(el => { const r = el.getBoundingClientRect(); if (r.width && r.right > innerWidth + 1) bad.push(el.className || el.tagName); }); return { sw: m.scrollWidth, cw: m.clientWidth, bad: [...new Set(bad)].slice(0, 6) }; });
    if (ov.sw > ov.cw + 1 || ov.bad.length) errs.push(`${tag} ${v} overflow ${JSON.stringify(ov)}`);
    const small = await p.evaluate(() => [...document.querySelectorAll('button,[role=button],a,label.row-item,input,.fchip')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height && (r.height < 44 || r.width < 44) && getComputedStyle(e).visibility !== 'hidden'; }).map(e => (e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)).slice(0, 10));
    if (small.length) errs.push(`${tag} ${v} small targets ${small.join(', ')}`);
  }
  // dialoger
  await p.click('.nav [data-view=kalender]'); await p.waitForTimeout(400);
  await p.locator('.dadd:visible').first().click(); await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/${tag}-dlg-event.png` }); await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await (dn === 'ph' ? p.click('#settings2') : p.click('#settings')); await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/${tag}-dlg-settings.png` }); await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  if (dn === 'ph') { await p.click('#fab'); await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/${tag}-dlg-add.png` }); await p.keyboard.press('Escape'); }
  await ctx.close();
}
console.log(errs.join('\n') || 'inga fel'); await b.close();
