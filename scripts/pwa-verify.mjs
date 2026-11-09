// Verifierar installbarhet + sparar ikonförhandsvisning och standalone-skärmdumpar
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const BASE = process.env.FS_URL || 'https://familjeskarm.rose-and-root-reminders.workers.dev';
const OUT = '/workspace/familjeskarm/screenshots';
fs.mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const logs = [];

// --- 1) Manifest + icons HTTP check via Chromium ---
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'sv-SE', timezoneId: 'Europe/Stockholm' });
  const p = await ctx.newPage();
  p.on('console', m => logs.push('console ' + m.type() + ': ' + m.text()));
  p.on('pageerror', e => logs.push('pageerror: ' + e.message));

  const manifestRes = await p.goto(BASE + '/manifest.webmanifest', { waitUntil: 'networkidle' });
  const manifestText = await manifestRes.text();
  const manifest = JSON.parse(manifestText);
  console.log('manifest status', manifestRes.status());
  console.log('name', manifest.name, 'short_name', manifest.short_name, 'display', manifest.display);
  console.log('display_override', manifest.display_override);
  console.log('id', manifest.id, 'lang', manifest.lang);

  const iconChecks = [];
  for (const ic of manifest.icons) {
    const r = await p.goto(BASE + ic.src, { waitUntil: 'load' });
    iconChecks.push({ src: ic.src, status: r.status(), type: r.headers()['content-type'], purpose: ic.purpose, sizes: ic.sizes });
  }
  console.log('icons', JSON.stringify(iconChecks, null, 2));

  // HTML meta
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  const meta = await p.evaluate(() => ({
    title: document.title,
    appleCapable: document.querySelector('meta[name=apple-mobile-web-app-capable]')?.content,
    appleTitle: document.querySelector('meta[name=apple-mobile-web-app-title]')?.content,
    appleStatus: document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]')?.content,
    themes: [...document.querySelectorAll('meta[name=theme-color]')].map(m => ({ content: m.content, media: m.media || null })),
    manifestHref: document.querySelector('link[rel=manifest]')?.href,
    appleIcon: document.querySelector('link[rel=apple-touch-icon]')?.href,
    viewport: document.querySelector('meta[name=viewport]')?.content,
  }));
  console.log('meta', JSON.stringify(meta, null, 2));

  // Installability-ish: manifest linked, icons 200, display standalone
  const badIcons = iconChecks.filter(i => i.status !== 200);
  if (badIcons.length) throw new Error('icon fetch failed: ' + JSON.stringify(badIcons));
  if (manifest.short_name.length > 12) throw new Error('short_name too long');
  if (!['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display)) throw new Error('bad display');

  await ctx.close();
}

// --- 2) Icon preview: mock Android + iOS home screens ---
{
  const p = await b.newPage({ viewport: { width: 1200, height: 700 }, deviceScaleFactor: 2 });
  const icon512 = fs.readFileSync('public/icon-512.png').toString('base64');
  const apple = fs.readFileSync('public/apple-touch-icon.png').toString('base64');
  const mask = fs.readFileSync('public/icon-maskable-512.png').toString('base64');
  await p.setContent(`<!doctype html><html><head><meta charset=utf-8><style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;650&display=swap');
    *{box-sizing:border-box} body{margin:0;font-family:Inter,system-ui,sans-serif;background:#1a1d24;color:#fff;display:flex;gap:28px;padding:36px;align-items:stretch;justify-content:center;min-height:100vh}
    .phone{width:340px;border-radius:36px;padding:28px 22px 36px;position:relative;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.45)}
    .android{background:linear-gradient(160deg,#3a7bd5 0%,#00d2ff 45%,#7b2ff7 100%)}
    .ios{background:linear-gradient(160deg,#ff9a9e 0%,#fad0c4 40%,#a18cd1 100%)}
    .label{font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.85;margin-bottom:18px;font-weight:650}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px 12px;justify-items:center}
    .app{display:flex;flex-direction:column;align-items:center;gap:7px;width:72px}
    .app span{font-size:11px;font-weight:500;text-align:center;text-shadow:0 1px 3px rgba(0,0,0,.35);max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .ic{width:60px;height:60px;border-radius:14px;background-size:cover;background-position:center;box-shadow:0 6px 16px rgba(0,0,0,.25)}
    .android .ic{border-radius:16px}
    .ios .ic{border-radius:13px}
    .android .ic.mask{border-radius:50%;width:60px;height:60px}
    .dock{margin-top:28px;display:flex;justify-content:center;gap:18px;padding:14px;border-radius:22px;background:rgba(255,255,255,.22);backdrop-filter:blur(16px)}
    .side{display:flex;flex-direction:column;justify-content:center;gap:18px;width:280px}
    .chip{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:16px 18px}
    .chip h3{margin:0 0 6px;font-size:15px}.chip p{margin:0;font-size:13px;opacity:.75;line-height:1.45}
    .big{width:96px;height:96px;border-radius:22px;background-size:cover;box-shadow:0 10px 30px rgba(0,0,0,.35)}
  </style></head><body>
  <div class="phone android">
    <div class="label">Android · startskärm</div>
    <div class="grid">
      <div class="app"><div class="ic" style="background-image:url(data:image/png;base64,${icon512})"></div><span>Familjen</span></div>
      <div class="app"><div class="ic" style="background:#fff3"></div><span>Chrome</span></div>
      <div class="app"><div class="ic" style="background:#fff3"></div><span>Kamera</span></div>
      <div class="app"><div class="ic" style="background:#fff3"></div><span>Foton</span></div>
      <div class="app"><div class="ic mask" style="background-image:url(data:image/png;base64,${mask})"></div><span>maskable</span></div>
      <div class="app"><div class="ic" style="background:#fff3"></div><span>Inställningar</span></div>
      <div class="app"><div class="ic" style="background:#fff3"></div><span>Klocka</span></div>
      <div class="app"><div class="ic" style="background:#fff3"></div><span>Play</span></div>
    </div>
    <div class="dock">
      <div class="ic" style="background-image:url(data:image/png;base64,${icon512})"></div>
      <div class="ic" style="background:#fff4"></div>
      <div class="ic" style="background:#fff4"></div>
      <div class="ic" style="background:#fff4"></div>
    </div>
  </div>
  <div class="phone ios">
    <div class="label">iPhone · hemskärm</div>
    <div class="grid">
      <div class="app"><div class="ic" style="background-image:url(data:image/png;base64,${apple})"></div><span>Familjen</span></div>
      <div class="app"><div class="ic" style="background:#fff6"></div><span>Safari</span></div>
      <div class="app"><div class="ic" style="background:#fff6"></div><span>Meddelanden</span></div>
      <div class="app"><div class="ic" style="background:#fff6"></div><span>Kamera</span></div>
      <div class="app"><div class="ic" style="background:#fff6"></div><span>Kalender</span></div>
      <div class="app"><div class="ic" style="background:#fff6"></div><span>Kartor</span></div>
      <div class="app"><div class="ic" style="background:#fff6"></div><span>Väder</span></div>
      <div class="app"><div class="ic" style="background:#fff6"></div><span>Musik</span></div>
    </div>
    <div class="dock">
      <div class="ic" style="background-image:url(data:image/png;base64,${apple})"></div>
      <div class="ic" style="background:#fff5"></div>
      <div class="ic" style="background:#fff5"></div>
      <div class="ic" style="background:#fff5"></div>
    </div>
  </div>
  <div class="side">
    <div class="big" style="background-image:url(data:image/png;base64,${icon512})"></div>
    <div class="chip"><h3>Familjeskärmen</h3><p>short_name <b>Familjen</b> · standalone · svenska personfärger grön / blå / rosa.</p></div>
  </div>
  </body></html>`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(OUT, 'icon-preview.png'), type: 'png' });
  await p.close();
  console.log('wrote icon-preview.png');
}

// --- 3) Standalone-ish screenshots (login if needed) ---
async function shot(name, viewport, isMobile = false) {
  const ctx = await b.newContext({
    viewport,
    locale: 'sv-SE',
    timezoneId: 'Europe/Stockholm',
    isMobile,
    hasTouch: true,
    userAgent: isMobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (Linux; Android 13; SM-T500) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  // Emulate standalone display-mode
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q) => {
        if (String(q).includes('display-mode')) {
          return { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
        }
        return window._mm ? window._mm(q) : { matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
      },
    });
  });
  const p = await ctx.newPage();
  const localLogs = [];
  p.on('console', m => { if (m.type() === 'error') localLogs.push(m.text()); });
  p.on('pageerror', e => localLogs.push(e.message));
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  if (await p.locator('#lf').count()) {
    await p.fill('[name=email]', process.env.FAMILJESKARM_EMAIL);
    await p.fill('[name=password]', process.env.FAMILJESKARM_PASSWORD || '');
    await p.click('#lf button');
    await p.waitForSelector('.view-hem, .dash, .bigclock', { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(4000);
  }
  if (await p.locator('#night').isVisible().catch(() => false)) await p.click('#night');
  await p.screenshot({ path: path.join(OUT, name), type: 'png' });
  console.log('wrote', name, 'errors', localLogs);
  await ctx.close();
  return localLogs;
}

const pw = process.env.FAMILJESKARM_PASSWORD;
if (!pw) {
  // try from .env
  const env = fs.readFileSync('/workspace/familjeskarm/.env', 'utf8');
  const m = env.match(/^FAMILJESKARM_PASSWORD=(.*)$/m);
  if (m) process.env.FAMILJESKARM_PASSWORD = m[1].trim();
}

const e1 = await shot('standalone-tablet.png', { width: 1340, height: 800 }, false);
const e2 = await shot('standalone-iphone.png', { width: 390, height: 844 }, true);

console.log('ALL_LOGS', logs.filter(l => /error|pageerror/i.test(l)).join('\n') || '(no errors)');
console.log('shot_errors', [...e1, ...e2]);
await b.close();
