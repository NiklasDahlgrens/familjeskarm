// Supabase-implementation med realtidssynk och localStorage som offline-cache (läsning).
import { createClient } from '@supabase/supabase-js';
const CACHE = 'familjeskarm:cache:';
const PAGE = 1000; // PostgREST svarar som standard med högst 1000 rader per anrop
const TIMEOUT_MS = 20000;

// Tolkar både implicit-hash (#access_token&type=recovery) och PKCE (?code=).
export function authCallbackParams(href) {
  const u = new URL(href, 'http://local');
  const all = new URLSearchParams(u.search);
  for (const [k, v] of new URLSearchParams((u.hash || '').replace(/^#/, ''))) all.set(k, v);
  return all;
}
export function flowTypeFromHref(href) {
  try { const p = authCallbackParams(href); if (p.get('code') && !p.get('access_token')) return 'pkce'; } catch {}
  return 'implicit';
}
export function isRecoveryRedirect(href) {
  try { return authCallbackParams(href).get('type') === 'recovery'; } catch { return false; }
}
export function redirectAuthError(href) {
  try {
    const p = authCallbackParams(href);
    if (p.get('error') || p.get('error_code') || p.get('error_description')) {
      return { error: p.get('error'), code: p.get('error_code'), description: (p.get('error_description') || '').replace(/\+/g, ' ') };
    }
  } catch {}
  return null;
}

export function createSupabaseStore({ supabaseUrl, supabaseAnonKey }) {
  // Utan timeout kan ett hängande anrop på dåligt wifi låsa all vidare uppdatering.
  const timedFetch = (u, o = {}) => fetch(u, { ...o, signal: o.signal ?? AbortSignal.timeout?.(TIMEOUT_MS) });
  const startHref = typeof location !== 'undefined' ? location.href : '';
  const sb = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: flowTypeFromHref(startHref) },
    global: { fetch: timedFetch },
  });
  const subs = new Set(); let ch, onAuth = () => {};
  // Fånga type=recovery/fel i URL:en nu, innan supabase-js rensar hashen efter inläsning.
  let recovering = isRecoveryRedirect(startHref);
  const startAuthError = redirectAuthError(startHref);
  // emit(tabell) = bara den tabellen har ändrats; emit() = ladda om allt
  const emit = t => subs.forEach(f => f(typeof t === 'string' ? t : undefined));
  const chk = ({ data, error }) => { if (error) throw error; return data; };
  function listen() {
    if (ch) return;
    ch = sb.channel('familj').on('postgres_changes', { event: '*', schema: 'public' }, p => emit(p.table)).subscribe();
  }
  sb.auth.onAuthStateChange((ev, s) => {
    if (ev === 'PASSWORD_RECOVERY') recovering = true;
    if (s) listen(); if (ev === 'SIGNED_OUT' && ch) { sb.removeChannel(ch); ch = null; }
    setTimeout(() => onAuth(ev, !!s), 0); // aldrig Supabase-anrop direkt i den här callbacken (risk för låsning)
  });
  addEventListener('online', () => emit());
  const hm = v => (typeof v === 'string' && v.length > 5 ? v.slice(0, 5) : v);
  const norm = r => (r && ('start' in r || 'end' in r) ? { ...r, start: hm(r.start), end: hm(r.end) } : r);
  const cached = t => { try { return JSON.parse(localStorage.getItem(CACHE + t) || '[]').map(norm); } catch { return []; } };
  // Hämtar alla rader sidvis så att inget tappas när en tabell växer förbi API:ts radgräns.
  async function fetchAll(t) {
    const rows = [];
    for (;;) {
      const { data, count, error } = await sb.from(t).select('*', { count: 'exact' }).order('created_at').order('id').range(rows.length, rows.length + PAGE - 1);
      if (error) throw error;
      rows.push(...data);
      if (!data.length || count == null || rows.length >= count) return rows;
    }
  }
  return {
    kind: 'supabase', client: sb,
    async list(t) {
      let d;
      try { d = (await fetchAll(t)).map(norm); }
      catch (e) { console.warn('offline, använder cache', t, e.message); return cached(t); }
      try { localStorage.setItem(CACHE + t, JSON.stringify(d)); } catch { /* full lagring ska inte dölja färsk data */ }
      return d;
    },
    async add(t, o) { const r = norm(chk(await sb.from(t).insert(o).select().single())); emit(t); return r; },
    async update(t, id, p) { const r = norm(chk(await sb.from(t).update(p).eq('id', id).select().single())); emit(t); return r; },
    async remove(t, id) { chk(await sb.from(t).delete().eq('id', id)); emit(t); if (t === 'recipes') emit('meal_plan'); },
    // Tömmer en hel tabell i ett anrop (används av "Rensa all data")
    async clear(t) { chk(await sb.from(t).delete().not('id', 'is', null)); emit(t); },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    // f(händelse, harSession) – låter appen reagera på utloggning och på att sessionen kommer tillbaka
    onAuthChange(f) { onAuth = f; },
    // Finns en sparad session kvar i webbläsaren? (Supabase tar bort den vid riktig utloggning, men inte vid nätfel.)
    hasStoredSession() { try { for (let i = 0; i < localStorage.length; i++) if (/^sb-.+-auth-token$/.test(localStorage.key(i))) return true; } catch {} return false; },
    async getAccessToken() { return (await sb.auth.getSession()).data.session?.access_token; },
    async getSession() { return (await sb.auth.getSession()).data.session; },
    async signIn(email, password) { const r = chk(await sb.auth.signInWithPassword({ email, password })); listen(); return r; },
    async signOut() { await sb.auth.signOut(); Object.keys(localStorage).filter(k => k.startsWith(CACHE)).forEach(k => localStorage.removeItem(k)); },
    isPasswordRecovery() { return recovering; },
    authRedirectError() { return startAuthError; },
    clearPasswordRecovery() { recovering = false; },
    async resetPassword(email) {
      const redirectTo = typeof location !== 'undefined' ? location.origin : undefined;
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
    },
    async updatePassword(password) {
      const r = chk(await sb.auth.updateUser({ password }));
      recovering = false;
      return r;
    },
  };
}
