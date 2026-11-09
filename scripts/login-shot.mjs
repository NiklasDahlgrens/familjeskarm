import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errs = [];
for (const [n, o] of [['login-tablet', { viewport: { width: 1920, height: 1200 } }], ['login-iphone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true }]]) {
  const p = await (await b.newContext({ ...o, locale: 'sv-SE', timezoneId: 'Europe/Stockholm' })).newPage();
  p.on('console', m => m.type() === 'error' && errs.push(n + ': ' + m.text())); p.on('pageerror', e => errs.push(n + ': ' + e.message));
  await p.goto('http://localhost:4173/'); await p.waitForSelector('#lf'); await p.waitForTimeout(800);
  await p.screenshot({ path: `screenshots/${n}.png` });
  if (n === 'login-tablet') { await p.fill('[name=email]', 'nobody@example.com'); await p.fill('[name=password]', 'wrongpass123'); await p.click('#lf button'); await p.waitForTimeout(2500); console.log('fel-login:', await p.textContent('.err')); errs.splice(0, errs.length, ...errs.filter(e => !/400/.test(e))); }
}
console.log('errors:', errs); await b.close();
