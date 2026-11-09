import { chromium } from 'playwright-core';
import fs from 'fs';

const BASE = process.env.FS_URL || 'https://familjeskarm.rose-and-root-reminders.workers.dev';
const OUT = '/workspace/familjeskarm/screenshots';
fs.mkdirSync(OUT, { recursive: true });
const pw = process.env.FAMILJESKARM_PASSWORD;
if (!pw) throw new Error('FAMILJESKARM_PASSWORD missing');

const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errors = [];

async function login(page) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  if (await page.locator('#lf').count()) {
    await page.fill('[name=email]', process.env.FAMILJESKARM_EMAIL);
    await page.fill('[name=password]', pw);
    await page.click('#lf button');
    await page.waitForSelector('#main', { timeout: 20000 });
    await page.waitForTimeout(2500);
  }
  if (await page.locator('#night').isVisible().catch(() => false)) await page.click('#night');
}

async function shotForm(name, viewport, { dark = false, openTime = false } = {}) {
  const ctx = await b.newContext({
    viewport,
    locale: 'sv-SE',
    timezoneId: 'Europe/Stockholm',
    colorScheme: dark ? 'dark' : 'light',
    isMobile: viewport.width <= 430,
    hasTouch: true,
  });
  if (dark) await ctx.addInitScript(() => localStorage.setItem('fs-theme', 'dark'));
  else await ctx.addInitScript(() => localStorage.setItem('fs-theme', 'light'));
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', e => logs.push('pageerror:' + e.message));
  await login(page);
  // Open new event via FAB or kalender
  await page.click('[data-view=kalender]').catch(() => {});
  await page.waitForTimeout(600);
  const add = page.locator('[data-act=newEvent]').first();
  if (await add.count()) await add.click();
  else {
    await page.click('#fab').catch(() => {});
    await page.waitForTimeout(300);
    await page.click('[data-a=ev]').catch(() => {});
  }
  await page.waitForSelector('#dlg[open] form.sheet', { timeout: 8000 });
  await page.waitForTimeout(400);

  if (openTime) {
    await page.locator('[data-tpick=start] .tpick-btn').click();
    await page.waitForTimeout(300);
  }

  // Assert Spara visible in viewport
  const save = page.locator('#dlg [data-save], #dlg .sh-f .primary').first();
  const box = await save.boundingBox();
  const vis = await save.isVisible();
  const inView = box && box.y + box.height <= viewport.height + 2 && box.y >= -2;
  console.log(name, { vis, inView, box, hasNativeTime: await page.locator('#dlg input[type=time]').count(), hasTpick: await page.locator('#dlg [data-tpick]').count() });
  if (!vis || !inView) errors.push(name + ': Spara not fully visible');
  if (await page.locator('#dlg input[type=time]').count()) errors.push(name + ': native time input still present');

  await page.screenshot({ path: `${OUT}/${name}.png`, type: 'png' });
  if (logs.length) { console.log('logs', name, logs); errors.push(...logs.map(l => name + ':' + l)); }
  await ctx.close();
  return { logs, box };
}

await shotForm('forms-tablet-event', { width: 1340, height: 800 });
await shotForm('forms-tablet-keyboard', { width: 1340, height: 420 }, { openTime: true });
await shotForm('forms-iphone-event', { width: 390, height: 844 });
await shotForm('forms-iphone-dark', { width: 390, height: 844 }, { dark: true });
await shotForm('forms-tiny', { width: 320, height: 568 });

// E2E create / edit / delete test event
{
  const ctx = await b.newContext({ viewport: { width: 1340, height: 800 }, locale: 'sv-SE', timezoneId: 'Europe/Stockholm' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('e2e:' + e.message));
  await login(page);
  await page.click('[data-view=kalender]');
  await page.waitForTimeout(500);
  await page.locator('[data-act=newEvent]').first().click();
  await page.waitForSelector('#dlg[open]');
  const title = 'QA-test ' + Date.now();
  await page.fill('[name=title]', title);
  // pick today chip if present
  await page.locator('.dpick [data-d]').first().click().catch(() => {});
  // set start via custom picker
  await page.locator('[data-tpick=start] .tpick-btn').click();
  await page.locator('[data-tpick=start] .tpick-presets [data-t="18:00"]').click();
  await page.locator('[data-tpick=start] .tpick-ok').click();
  // person Hubby
  await page.locator('.ppick input[value=niklas]').check({ force: true });
  await page.click('#dlg [data-save]');
  await page.waitForSelector('#dlg:not([open])', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  // find event
  const ev = page.locator(`[data-ev]`).filter({ hasText: title }).first();
  const found = await ev.count();
  console.log('created?', found);
  if (!found) errors.push('e2e: created event not found');
  else {
    await ev.click();
    await page.waitForSelector('#dlg[open]');
    await page.fill('[name=title]', title + ' redigerad');
    await page.click('#dlg [data-save]');
    await page.waitForTimeout(1200);
    page.once('dialog', d => d.accept());
    const ev2 = page.locator(`[data-ev]`).filter({ hasText: title + ' redigerad' }).first();
    if (await ev2.count()) {
      await ev2.click();
      await page.waitForSelector('#dlg[open]');
      page.once('dialog', d => d.accept());
      await page.click('#delEv');
      await page.waitForTimeout(1000);
      console.log('deleted?', !(await page.locator(`[data-ev]`).filter({ hasText: title }).count()));
    } else errors.push('e2e: edited event not found');
  }
  await page.screenshot({ path: `${OUT}/forms-e2e-done.png` });
  await ctx.close();
}

console.log('ERRORS', errors);
await b.close();
if (errors.length) process.exitCode = 1;
