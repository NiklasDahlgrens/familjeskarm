// Test av Supabase-lagret mot ett låtsas-API: sidvis hämtning, cache vid fel, ändringshändelser per tabell och tömning.
// Kör: node test/store.test.mjs  (inga riktiga nätverksanrop)
import assert from 'node:assert/strict';

const mem = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: i => [...mem.keys()][i], get length() { return mem.size; },
} });
globalThis.addEventListener = () => {};

const rows = Array.from({ length: 2500 }, (_, i) => ({ id: String(i).padStart(4, '0'), title: 'H' + i, date: '2026-11-09', start: '08:30:00', end: null, created_at: '2026-01-01T00:00:00Z' }));
const calls = []; let down = false;
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url); const method = opts.method || 'GET'; calls.push({ method, path: u.pathname, q: u.search, signal: !!opts.signal });
  if (down) throw new TypeError('Failed to fetch');
  const json = (body, headers = {}, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  if (u.pathname === '/rest/v1/events' && method === 'GET') {
    const off = +u.searchParams.get('offset') || 0, lim = +u.searchParams.get('limit') || 1000; const part = rows.slice(off, off + lim);
    return json(part, { 'Content-Range': `${off}-${off + part.length - 1}/${rows.length}` }, 206);
  }
  if (u.pathname === '/rest/v1/todos' && method === 'GET') return json([], { 'Content-Range': '*/0' });
  if (u.pathname === '/rest/v1/todos' && method === 'POST') return json({ id: 'n1', ...JSON.parse(opts.body) }, {}, 201);
  if (method === 'DELETE') return new Response(null, { status: 204 });
  return json({ message: 'okänd väg ' + u.pathname }, {}, 404);
};

const { createSupabaseStore, authCallbackParams, isRecoveryRedirect, redirectAuthError, flowTypeFromHref } = await import('../src/data/supabase.js');
const store = createSupabaseStore({ supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'sb_publishable_test' });
const seen = []; store.subscribe(t => seen.push(t));
let n = 0; const test = async (name, fn) => { calls.length = 0; seen.length = 0; await fn(); n++; console.log('ok  ' + name); };

await test('hämtar alla rader sidvis förbi 1000-radersgränsen, med timeout på anropen', async () => {
  const d = await store.list('events');
  assert.equal(d.length, 2500); assert.equal(d[0].id, '0000'); assert.equal(d[2499].id, '2499');
  assert.equal(d[0].start, '08:30', 'klockslag normaliseras till HH:MM');
  assert.equal(calls.filter(c => c.path === '/rest/v1/events').length, 3);
  assert.ok(calls.every(c => c.signal), 'alla anrop ska ha en avbrottssignal (timeout)');
  assert.equal(JSON.parse(localStorage.getItem('familjeskarm:cache:events')).length, 2500);
});

await test('tom tabell kostar ett anrop', async () => {
  assert.deepEqual(await store.list('todos'), []);
  assert.equal(calls.length, 1);
});

await test('vid nätfel returneras senast sparade kopia', async () => {
  down = true; try { assert.equal((await store.list('events')).length, 2500); } finally { down = false; }
});

await test('trasig cache ger tom lista i stället för krasch', async () => {
  localStorage.setItem('familjeskarm:cache:recipes', '{inte json'); down = true;
  try { assert.deepEqual(await store.list('recipes'), []); } finally { down = false; }
});

await test('ändringar meddelar vilken tabell som ändrats', async () => {
  await store.add('todos', { title: 'Ny', done: false }); assert.deepEqual(seen, ['todos']);
  seen.length = 0; await store.remove('recipes', 'r1'); assert.deepEqual(seen, ['recipes', 'meal_plan'], 'borttaget recept tar med sig matsedeln');
});

await test('clear tömmer en tabell i ett enda anrop', async () => {
  await store.clear('events');
  assert.equal(calls.length, 1); assert.equal(calls[0].method, 'DELETE'); assert.match(calls[0].q, /id=not\.is\.null/); assert.deepEqual(seen, ['events']);
});

await test('utan sparad session rapporteras ingen', async () => {
  assert.equal(store.hasStoredSession(), false);
  localStorage.setItem('sb-test-auth-token', '{}'); assert.equal(store.hasStoredSession(), true); localStorage.removeItem('sb-test-auth-token');
});

await test('känner igen återställningslänk i hash och PKCE-kod i query', () => {
  assert.equal(isRecoveryRedirect('https://app.example/#access_token=x&type=recovery'), true);
  assert.equal(isRecoveryRedirect('https://app.example/?type=recovery&code=abc'), true);
  assert.equal(isRecoveryRedirect('https://app.example/#access_token=x&type=signup'), false);
  assert.equal(flowTypeFromHref('https://app.example/?code=abc'), 'pkce');
  assert.equal(flowTypeFromHref('https://app.example/#access_token=x&type=recovery'), 'implicit');
  assert.equal(authCallbackParams('https://app.example/#type=recovery').get('type'), 'recovery');
});

await test('utgången återställningslänk ger ett läsbart fel', () => {
  const e = redirectAuthError('https://app.example/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&type=recovery');
  assert.equal(e.code, 'otp_expired');
  assert.match(e.description, /expired/i);
  assert.equal(isRecoveryRedirect('https://app.example/#error=access_denied&error_code=otp_expired&type=recovery'), true);
});

console.log(`PASS: ${n} tester`);
process.exit(0); // Supabase-klienten håller annars processen vid liv (automatisk tokenförnyelse)
