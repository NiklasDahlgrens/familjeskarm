// Flödestest mot BASE: lägger till/ändrar/tar bort testrader med prefix "QA-test" (städas bort efteråt).
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://localhost:4173/';
const LIVE = 'https://familjeskarm.rose-and-root-reminders.workers.dev';
const OUT = process.env.OUT || '/workspace/qa';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1340, height: 800 }, timezoneId: 'Europe/Stockholm', locale: 'sv-SE', hasTouch: true });
await ctx.addInitScript(() => localStorage.setItem('fs-theme', 'light'));
const p = await ctx.newPage(); const errs = []; const log = m => console.log('✓', m);
if (!BASE.includes('workers.dev')) await p.route('**/api/ics*', async r => { const u = new URL(r.request().url()); await r.fulfill({ response: await r.fetch({ url: LIVE + u.pathname + u.search }) }); });
p.on('console', m => (m.type() === 'error' || m.type() === 'warning') && errs.push(m.type() + ': ' + m.text())); p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('dialog', d => d.accept());
await p.goto(BASE); await p.waitForSelector('#lf, #main');
if (await p.$('#lf')) { await p.fill('[name=email]', process.env.FAMILJESKARM_EMAIL); await p.fill('[name=password]', process.env.FAMILJESKARM_PASSWORD); await p.click('#lf button'); }
await p.waitForSelector('#main .dash', { timeout: 20000 }); await p.waitForTimeout(2500);
const toastTxt = async () => (await p.locator('.toast').last().textContent({ timeout: 4000 }).catch(() => '')) || '';
const nav = v => p.click(`.nav [data-view=${v}]`);
try {
  // Todo
  await nav('todo'); await p.fill('[data-form=todo] input[name=title]', 'QA-test uppgift med en ganska lång titel som borde radbrytas snyggt i listan'); await p.click('[data-form=todo] label.p-sambo'); await p.click('[data-form=todo] .primary');
  await p.waitForSelector('text=QA-test uppgift'); log('todo tillagd: ' + await toastTxt());
  await p.screenshot({ path: `${OUT}/flow-todo.png` });
  await p.locator('.row-item', { hasText: 'QA-test uppgift' }).locator('.cbx').click(); await p.waitForTimeout(2000);
  if (!(await p.locator('.done-box').count())) throw new Error('todo ej avbockad'); log('todo avbockad');
  await p.click('.done-box summary'); await p.locator('.done-box .row-item', { hasText: 'QA-test' }).locator('.del').click(); await p.waitForTimeout(1200);
  log('todo borttagen: ' + await toastTxt()); await p.click('.toast button'); await p.waitForTimeout(1500);
  if (!(await p.locator('text=QA-test uppgift').count())) throw new Error('ångra fungerade inte'); log('ångra återställde todo');
  // Shopping
  await nav('inkop'); await p.fill('[data-form=shop] input', 'QA-test mjölk'); await p.press('[data-form=shop] input', 'Enter'); await p.waitForSelector('text=QA-test mjölk'); log('vara tillagd');
  await p.locator('.row-item', { hasText: 'QA-test mjölk' }).locator('.cbx').click(); await p.waitForTimeout(1500); log('vara avbockad');
  // Event timed
  await nav('kalender'); for (let i = 0; i < 8; i++) { await p.click('[data-act=next]'); await p.waitForTimeout(150); }
  await p.locator('.dadd').nth(1).click(); await p.waitForSelector('#dlg[open]');
  await p.click('#dlg .primary'); const e1 = await p.locator('[data-ferr]').textContent(); log('validering tom titel: ' + e1);
  await p.fill('#dlg [name=title]', 'QA-test möte'); await p.fill('#dlg [name=start]', '10:00'); await p.dispatchEvent('#dlg [name=start]', 'change');
  log('auto-sluttid: ' + await p.inputValue('#dlg [name=end]'));
  await p.fill('#dlg [name=end]', '09:00'); await p.click('#dlg .primary'); log('validering sluttid: ' + await p.locator('[data-ferr]').textContent());
  await p.fill('#dlg [name=end]', '11:30'); await p.click('#dlg label.p-niklas'); await p.click('#dlg .primary'); await p.waitForSelector('.wev:has-text("QA-test möte")'); log('händelse tillagd');
  // overlapping + all-day + long
  await p.locator('.dadd').nth(1).click(); await p.fill('#dlg [name=title]', 'QA-test överlapp'); await p.fill('#dlg [name=start]', '10:30'); await p.fill('#dlg [name=end]', '12:00'); await p.click('#dlg .primary'); await p.waitForTimeout(800);
  await p.locator('.dadd').nth(1).click(); await p.fill('#dlg [name=title]', 'QA-test heldag med väldigt lång titel som inte får spräcka layouten'); await p.click('#dlg .switch'); await p.click('#dlg .primary'); await p.waitForSelector('.wad:has-text("QA-test heldag")'); log('heldag tillagd');
  await p.screenshot({ path: `${OUT}/flow-week.png` });
  // edit
  await p.click('.wev:has-text("QA-test möte")'); await p.fill('#dlg [name=title]', 'QA-test möte ändrat'); await p.click('#dlg .primary'); await p.waitForSelector('.wev:has-text("QA-test möte ändrat")'); log('händelse ändrad');
  // filter
  await p.click('[data-filter=niklas]'); await p.waitForTimeout(300); log('filter Hubby av: möte synligt=' + await p.locator('.wev:has-text("QA-test möte ändrat")').count());
  await p.click('[data-filter=niklas]'); await p.waitForTimeout(300);
  // delete + check
  await p.click('.wev:has-text("QA-test möte ändrat")'); await p.click('#delEv'); await p.waitForTimeout(1200); await p.screenshot({ path: `${OUT}/flow-undo.png` }); log('händelse borttagen: ' + await toastTxt());
  // read-only info
  await p.click('[data-act=thisweek]'); await p.waitForTimeout(500); const ro = p.locator('[data-ro]').first(); if (await ro.count()) { await ro.click(); await p.waitForSelector('#dlg[open] .ro-info'); await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/flow-ro.png` }); log('info-ark för synkad händelse'); await p.keyboard.press('Escape'); await p.waitForTimeout(400); }
  // Recipe + meal
  await nav('recept'); await p.click('.bar [data-act=newRecipe]'); await p.fill('#dlg [name=title]', 'QA-test gryta'); await p.fill('#dlg [name=ingredients]', 'QA-test lök\nQA-test morot'); await p.fill('#dlg [name=steps]', 'Hacka\nKoka'); await p.click('#dlg .primary');
  await p.waitForSelector('.rcard:has-text("QA-test gryta")'); log('recept tillagt');
  await p.click('.rcard:has-text("QA-test gryta")'); await p.waitForSelector('#dlg[open] .recipe-v'); await p.screenshot({ path: `${OUT}/flow-recipe.png` }); await p.click('#dlg [data-close]'); await p.waitForTimeout(400);
  await nav('matsedel'); for (let i = 0; i < 8; i++) { await p.click('[data-act=next]'); await p.waitForTimeout(120); }
  await p.locator('.mday').first().click(); await p.click('#dlg .pick:has-text("QA-test gryta")'); await p.waitForSelector('.mday:has-text("QA-test gryta")'); log('middag vald');
  await p.click('.bar [data-act=mealsToShopping]'); await p.waitForTimeout(2500); log('till inköpslistan: ' + await toastTxt());
  await p.screenshot({ path: `${OUT}/flow-meal.png` });
  await p.locator('.mday:has-text("QA-test gryta") .del').click(); await p.waitForTimeout(1200); log('middag borttagen: ' + await toastTxt());
  await nav('recept'); await p.click('.rcard:has-text("QA-test gryta")'); await p.click('#rd'); await p.waitForTimeout(1200); log('recept borttaget');
  // Settings refresh
  await p.click('#settings'); await p.click('#feedsync'); await p.waitForTimeout(3500); log('kalendrar: ' + await toastTxt()); await p.screenshot({ path: `${OUT}/flow-settings.png` }); await p.keyboard.press('Escape');
} catch (e) { errs.push('FLOW FAIL: ' + e.message.split('\n')[0]); await p.screenshot({ path: `${OUT}/flow-fail.png` }); }
console.log(errs.join('\n') || 'inga fel'); await b.close();
