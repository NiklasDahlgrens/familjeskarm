// Test av Workerns /api/ics: auktorisering, värdlista, redirects, cache, reservkopia och storlekstak.
// Kör: node scripts/ics.test.mjs  (inga riktiga nätverksanrop – fetch och Cache API är ersatta)
import vm from 'node:vm'; import fs from 'node:fs'; import zlib from 'node:zlib'; import assert from 'node:assert/strict';

const ICS = 'BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR';
const ID = '11111111-2222-3333-4444-555555555555';
let feedUrl = 'webcal://p12-caldav.icloud.com/published/2/AAAA', sbStatus = 200, sbRows = null, upstream = () => new Response(ICS);
const calls = [], cache = new Map(), tasks = [];
const ctx = vm.createContext({
  Response, Request, URL, AbortSignal, Date, console: { log() {}, info() {} }, btoa, crypto, TextEncoder, TextDecoder, Blob, DecompressionStream,
  setTimeout: f => setTimeout(f, 0), // hoppa över väntan mellan omförsök
  caches: { default: { match: async k => cache.get(k.url)?.clone(), put: async (k, v) => cache.set(k.url, v) } },
  fetch: async (url, opts) => {
    url = String(url);
    if (url.includes('/rest/v1/calendar_feeds')) return new Response(JSON.stringify(sbRows ?? [{ url: feedUrl }]), { status: sbStatus });
    calls.push([url, opts]); return upstream(url);
  },
});
vm.runInContext(fs.readFileSync('scripts/worker-api.js', 'utf8'), ctx);
const call = async ({ auth = 'Bearer test-token', id = ID, method = 'GET' } = {}) => {
  ctx.req = new Request('https://example.test/api/ics?id=' + id, { method, headers: auth ? { Authorization: auth } : {} });
  ctx.u = new URL(ctx.req.url); ctx.context = { waitUntil: p => tasks.push(p) };
  const r = await vm.runInContext('ics(req,u,context)', ctx); await Promise.all(tasks.splice(0)); return r;
};
const reset = () => { calls.length = 0; cache.clear(); sbStatus = 200; sbRows = null; upstream = () => new Response(ICS); feedUrl = 'webcal://p12-caldav.icloud.com/published/2/AAAA'; };
const ageCache = ms => { for (const [k, v] of cache) { const h = new Headers(v.headers); h.set('X-Fetched-At', String(Date.now() - ms)); cache.set(k, new Response(v.body, { headers: h })); } };
let n = 0; const test = async (name, fn) => { reset(); await fn(); n++; console.log('ok  ' + name); };

await test('utan token, med fel id eller fel metod nås varken Supabase eller källan', async () => {
  assert.equal((await call({ auth: '' })).status, 401);
  assert.equal((await call({ id: 'inte-ett-uuid' })).status, 400);
  assert.equal((await call({ method: 'POST' })).status, 405);
  assert.equal(calls.length, 0);
});

await test('Supabase avgör åtkomsten: 401 → 401, inga rader (RLS) → 404', async () => {
  sbStatus = 401; assert.equal((await call()).status, 401);
  sbStatus = 200; sbRows = []; assert.equal((await call()).status, 404);
  assert.equal(calls.length, 0);
});

await test('bara https till tillåtna värdar hämtas', async () => {
  for (const u of ['https://evil.example/cal.ics', 'http://p1.icloud.com/x', 'https://icloud.com.evil.example/x', 'https://p1.icloud.com@evil.example/x', 'inte en länk']) {
    feedUrl = u; const r = await call(); assert.ok([400, 403].includes(r.status), u + ' → ' + r.status);
  }
  assert.equal(calls.length, 0);
});

await test('redirect till otillåten värd stoppas, redirect inom värdlistan följs', async () => {
  upstream = () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/x' } });
  assert.equal((await call()).status, 403);
  upstream = url => url.includes('/published/') ? new Response(null, { status: 302, headers: { Location: 'https://p99-caldav.icloud.com/moved' } }) : new Response(ICS);
  const r = await call(); assert.equal(r.status, 200); assert.equal(await r.text(), ICS); assert.ok(calls.at(-1)[0].includes('/moved'));
  assert.equal(calls.at(-1)[1].headers.Authorization, undefined, 'användarens token får aldrig skickas till kalendervärden');
});

await test('färskt svar cachas; ändrad länk med samma längd får inte den gamla kopian', async () => {
  let r = await call(); assert.equal(r.headers.get('X-Ics-Cache'), 'miss');
  r = await call(); assert.equal(r.headers.get('X-Ics-Cache'), 'hit'); assert.equal(calls.length, 1);
  feedUrl = 'webcal://p12-caldav.icloud.com/published/2/BBBB';
  r = await call(); assert.equal(r.headers.get('X-Ics-Cache'), 'miss'); assert.equal(calls.length, 2);
});

await test('när källan strular serveras senaste lyckade kopia (stale), men inte vid 404', async () => {
  await call(); ageCache(60 * 60e3);
  upstream = () => new Response('fel', { status: 503 });
  let r = await call(); assert.equal(r.status, 200); assert.equal(r.headers.get('X-Ics-Cache'), 'stale'); assert.equal(await r.text(), ICS);
  assert.equal(calls.length, 1 + 3, 'tre försök mot källan');
  upstream = () => new Response('borta', { status: 404 });
  r = await call(); assert.equal(r.status, 404);
});

await test('gzip packas upp och innehåll som inte är en kalender avvisas', async () => {
  upstream = () => new Response(zlib.gzipSync(ICS));
  let r = await call(); assert.equal(r.status, 200); assert.equal(await r.text(), ICS);
  reset(); upstream = () => new Response('<html>logga in</html>');
  r = await call(); assert.equal(r.status, 502);
});

await test('för stora svar avbryts utan omförsök – även när de är små på vägen men stora uppackade', async () => {
  upstream = () => new Response(new Uint8Array(9 * 1024 * 1024));
  let r = await call(); assert.equal(r.status, 502); assert.equal((await r.json()).error, 'too large'); assert.equal(calls.length, 1);
  reset(); upstream = () => new Response(zlib.gzipSync(Buffer.alloc(9 * 1024 * 1024, 65)));
  r = await call(); assert.equal(r.status, 502); assert.equal((await r.json()).error, 'too large'); assert.equal(calls.length, 1);
});

console.log(`PASS: ${n} tester`);
