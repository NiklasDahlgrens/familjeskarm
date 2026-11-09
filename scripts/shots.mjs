import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errs = [];
async function run(name, opts, views) {
  const ctx = await b.newContext({ ...opts, timezoneId: 'Europe/Stockholm', locale: 'sv-SE' });
  const p = await ctx.newPage();
  p.on('console', m => m.type() === 'error' && errs.push(name + ': ' + m.text())); p.on('pageerror', e => errs.push(name + ': ' + e.message));
  await p.goto('http://localhost:4173/'); await p.waitForTimeout(2500);
  await p.screenshot({ path: `screenshots/${name}.png` });
  for (const v of views) { await p.click(`[data-view=${v}]`); await p.waitForTimeout(300); await p.screenshot({ path: `screenshots/${name}-${v}.png` }); }
  await p.click('[data-view=matsedel]'); await p.click('[data-act=mealsToShopping]');
  await p.click('[data-view=todo]'); await p.fill('[data-form=todo] input', 'Test'); await p.press('[data-form=todo] input', 'Enter');
  await p.waitForTimeout(300);
  await ctx.close();
}
await run('tablet-dashboard', { viewport: { width: 1920, height: 1200 } }, ['kalender', 'matsedel']);
await run('iphone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, []);
console.log('errors:', errs); await b.close();
