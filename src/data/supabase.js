// Supabase-implementation med realtidssynk och localStorage som offline-cache (läsning).
import { createClient } from '@supabase/supabase-js';
const CACHE = 'familjeskarm:cache:';
export function createSupabaseStore({ supabaseUrl, supabaseAnonKey }) {
  const sb = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const subs = new Set(); let ch;
  const emit = () => subs.forEach(f => f());
  const chk = ({ data, error }) => { if (error) throw error; return data; };
  function listen() {
    if (ch) return;
    ch = sb.channel('familj').on('postgres_changes', { event: '*', schema: 'public' }, emit).subscribe();
  }
  sb.auth.onAuthStateChange((ev, s) => { if (s) listen(); if (ev === 'SIGNED_OUT' && ch) { sb.removeChannel(ch); ch = null; } });
  addEventListener('online', emit);
  const hm = v => (typeof v === 'string' && v.length > 5 ? v.slice(0, 5) : v);
  const norm = r => (r && ('start' in r || 'end' in r) ? { ...r, start: hm(r.start), end: hm(r.end) } : r);
  const after = async r => { emit(); return r; };
  return {
    kind: 'supabase', client: sb,
    async list(t) {
      try { const d = chk(await sb.from(t).select('*').order('created_at')).map(norm); localStorage.setItem(CACHE + t, JSON.stringify(d)); return d; }
      catch (e) { console.warn('offline, använder cache', t, e.message); return JSON.parse(localStorage.getItem(CACHE + t) || '[]').map(norm); }
    },
    async add(t, o) { return after(norm(chk(await sb.from(t).insert(o).select().single()))); },
    async update(t, id, p) { return after(norm(chk(await sb.from(t).update(p).eq('id', id).select().single()))); },
    async remove(t, id) { chk(await sb.from(t).delete().eq('id', id)); emit(); },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    async getAccessToken() { return (await sb.auth.getSession()).data.session?.access_token; },
    async getSession() { return (await sb.auth.getSession()).data.session; },
    async signIn(email, password) { const r = chk(await sb.auth.signInWithPassword({ email, password })); listen(); return r; },
    async signOut() { await sb.auth.signOut(); Object.keys(localStorage).filter(k => k.startsWith(CACHE)).forEach(k => localStorage.removeItem(k)); },
  };
}
