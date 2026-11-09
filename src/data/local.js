import { seedData } from './seed.js';
const KEY = 'familjeskarm:v1';
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export function createLocalStore() {
  const subs = new Set();
  let db = load();
  function load() {
    try { const d = JSON.parse(localStorage.getItem(KEY)); if (d) return d; } catch {}
    const d = seedData(); localStorage.setItem(KEY, JSON.stringify(d)); return d;
  }
  const save = () => { localStorage.setItem(KEY, JSON.stringify(db)); subs.forEach(f => f()); };
  // synk mellan flikar
  window.addEventListener('storage', e => { if (e.key === KEY) { db = load(); subs.forEach(f => f()); } });
  return {
    kind: 'local',
    async list(t) { return structuredClone(db[t] || []); },
    async add(t, o) { const r = { id: uid(), created_at: new Date().toISOString(), ...o }; (db[t] ||= []).push(r); save(); return r; },
    async update(t, id, p) { const r = db[t].find(x => x.id === id); if (r) Object.assign(r, p); save(); return r; },
    async remove(t, id) { db[t] = db[t].filter(x => x.id !== id); save(); },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    async reset() { db = seedData(); save(); },
  };
}
