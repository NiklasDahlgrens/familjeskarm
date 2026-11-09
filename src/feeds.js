// iCloud/ICS-kalendrar (endast läsning). Hämtas via Workerns /api/ics så att länken aldrig hamnar i JS-bundlen.
import ICAL from 'ical.js';
const TZ = 'Europe/Stockholm';
const cache = new Map(); // feedId -> { comps, at }
const dstr = d => d.toLocaleDateString('sv-SE', { timeZone: TZ });
const tstr = d => d.toLocaleTimeString('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

export function parseIcs(text) {
  const comp = new ICAL.Component(ICAL.parse(text));
  for (const tz of comp.getAllSubcomponents('vtimezone')) { try { ICAL.TimezoneService.register(tz); } catch {} }
  const vevents = comp.getAllSubcomponents('vevent');
  const masters = new Map(), out = [];
  for (const v of vevents) { if (!v.hasProperty('recurrence-id')) { const e = new ICAL.Event(v); masters.set(e.uid, e); out.push(e); } }
  for (const v of vevents) { if (v.hasProperty('recurrence-id')) { const ex = new ICAL.Event(v); const m = masters.get(ex.uid); m ? m.relateException(ex) : out.push(ex); } }
  const col = String(comp.getFirstPropertyValue('x-apple-calendar-color') || '').trim();
  out.calColor = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(col) ? col.slice(0, 7) : null;
  return out;
}

// Källa för en kalenderlänk (styr ikon och text i appen)
export const feedKind = url => { const u = String(url || '').toLowerCase();
  return u.includes('icloud.com') ? 'icloud' : u.includes('personalkollen.se') ? 'personalkollen' : u.includes('google.com') ? 'google' : u.includes('outlook') ? 'outlook' : 'other'; };
const nextDay = ds => { const d = new Date(ds + 'T12:00'); d.setDate(d.getDate() + 1); return d.toLocaleDateString('sv-SE'); };

// Expandera händelser inom [from, to) till appens format.
// Tidsatta händelser som går över midnatt delas upp per dag (span: first/mid/last).
export function expand(events, from, to, feed) {
  const res = []; const src = feedKind(feed.url);
  const lo = dstr(new Date(+from - 864e5)), hi = dstr(to);
  const push = (summary, s, e, uid, loc) => {
    const allDay = s.isDate; const sd = s.toJSDate(), ed = e ? e.toJSDate() : sd;
    if (ed <= from && !(allDay && +ed === +sd) || sd >= to) return;
    const base = { title: String(summary || '').trim().replace(/\s+/g, ' ') || '(utan titel)', person: feed.person, readonly: true, feed: feed.name, feedId: feed.id, src, loc: String(loc || '').trim(), id: `ics:${feed.id}:${uid}:${+sd}` };
    if (allDay) { // heldag, kan sträcka sig över flera dagar (DTEND exklusiv)
      const d = new Date(sd); const last = +ed > +sd ? ed : new Date(+sd + 864e5);
      const first = dstr(sd), lastDay = dstr(new Date(+last - 864e5));
      for (let g = 0; d < last && g < 400; d.setDate(d.getDate() + 1), g++) { const ds = dstr(d); if (ds >= lo && ds < hi) res.push({ ...base, id: base.id + ':' + ds, date: ds, start: '', end: '', range: first !== lastDay ? [first, lastDay] : null }); }
    } else {
      const d0 = dstr(sd), d1 = dstr(new Date(Math.max(+sd, +ed - 1))); // slut exakt vid midnatt räknas till dagen innan
      if (d0 === d1) { if (d0 >= lo && d0 < hi) res.push({ ...base, date: d0, start: tstr(sd), end: tstr(ed) }); return; }
      for (let ds = d0, g = 0; ds <= d1 && g < 60; ds = nextDay(ds), g++) {
        if (ds < lo || ds >= hi) continue;
        const span = ds === d0 ? 'first' : ds === d1 ? 'last' : 'mid';
        res.push({ ...base, id: base.id + ':' + ds, date: ds, span, range: [d0, d1], start: span === 'first' ? tstr(sd) : span === 'last' ? '00:00' : '', end: span === 'last' ? tstr(ed) : '', s0: tstr(sd), e1: tstr(ed) });
      }
    }
  };
  const tFrom = ICAL.Time.fromJSDate(from, true), tTo = ICAL.Time.fromJSDate(to, true);
  for (const ev of events) {
    if (!ev.startDate) continue;
    if (ev.isRecurring()) {
      const it = ev.iterator(); let n, guard = 0;
      while ((n = it.next()) && guard++ < 5000) {
        if (n.compare(tTo) >= 0) break;
        const o = ev.getOccurrenceDetails(n);
        if (o.endDate.compare(tFrom) <= 0) continue;
        push(o.item.summary, o.startDate, o.endDate, ev.uid, o.item.location);
      }
    } else push(ev.summary, ev.startDate, ev.endDate, ev.uid, ev.location);
  }
  return res;
}

// Returnerar { events, fetchedAt, stale }. Workern svarar med senast lyckade kopia (stale) om källan tillfälligt strular.
export async function loadFeed(feed, token, force = false) {
  const c = cache.get(feed.id);
  if (c && !force && Date.now() - c.at < 15 * 60e3) return c.res;
  const r = await fetch(`/api/ics?id=${encodeURIComponent(feed.id)}`, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error(`Kunde inte hämta ”${feed.name}” (${r.status === 403 ? 'länken är inte tillåten' : r.status === 404 ? 'kalendern saknas' : r.status === 401 ? 'inloggningen har gått ut' : 'fel ' + r.status})`);
  const fetchedAt = Number(r.headers.get('X-Ics-Fetched-At')) || Date.now();
  const res = { events: parseIcs(await r.text()), fetchedAt, stale: r.headers.get('X-Ics-Cache') === 'stale' };
  cache.set(feed.id, { res, at: Date.now() }); return res;
}
export const forgetFeed = id => cache.delete(id);
