// iCloud/ICS-kalendrar (endast läsning). Hämtas via Workerns /api/ics så att länken aldrig hamnar i JS-bundlen.
import ICAL from 'ical.js';
import { TZ, dstr, tstr, addDays, pad2 } from './time.js';
const cache = new Map(); // feedId -> { res, sig, at, savedAt }
const ICS_CACHE = 'fs-ics'; // senaste kopian per kalender, så att passen finns kvar efter omladdning utan nät

// Ett enda trasigt VEVENT ska inte fälla hela kalendern: tolka händelserna en och en och hoppa över de ogiltiga.
function parseLenient(text, err) {
  const blocks = text.match(/^BEGIN:VEVENT\r?\n[\s\S]*?^END:VEVENT\r?$/gm);
  if (!blocks) throw err;
  const comp = new ICAL.Component(ICAL.parse(text.replace(/^BEGIN:VEVENT\r?\n[\s\S]*?^END:VEVENT\r?\n?/gm, ''))); // kastar om även ramen är trasig
  let bad = 0;
  for (const b of blocks) { try { comp.addSubcomponent(new ICAL.Component(ICAL.parse(b))); } catch { bad++; } }
  if (bad === blocks.length) throw err;
  console.warn(`ICS: hoppade över ${bad} ogiltig(a) händelse(r):`, err.message);
  return comp;
}

export function parseIcs(text) {
  let comp;
  try { comp = new ICAL.Component(ICAL.parse(text)); } catch (e) { comp = parseLenient(String(text || ''), e); }
  for (const tz of comp.getAllSubcomponents('vtimezone')) { try { ICAL.TimezoneService.register(tz); } catch {} }
  const vevents = comp.getAllSubcomponents('vevent');
  const masters = new Map(), out = [];
  for (const v of vevents) { if (!v.hasProperty('recurrence-id')) { const e = new ICAL.Event(v); masters.set(e.uid, e); out.push(e); } }
  for (const v of vevents) { if (v.hasProperty('recurrence-id')) { const ex = new ICAL.Event(v); const m = masters.get(ex.uid); m ? m.relateException(ex) : out.push(ex); } }
  return out;
}

// Källa för en kalenderlänk (styr ikon och text i appen)
export const feedKind = url => { const u = String(url || '').toLowerCase();
  return u.includes('icloud.com') ? 'icloud' : u.includes('personalkollen.se') ? 'personalkollen' : u.includes('google.com') ? 'google' : u.includes('outlook') ? 'outlook' : 'other'; };

// ---- tidszoner
// Tider utan känd zon (flytande, eller TZID som saknar VTIMEZONE i filen) tolkas som väggklockstid i TZID:t om det är
// ett giltigt IANA-namn, annars som svensk tid – aldrig som enhetens tidszon.
const zoneFmt = new Map();
const fmtFor = zone => {
  if (!zoneFmt.has(zone)) { let f = null; try { f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch {} zoneFmt.set(zone, f); }
  return zoneFmt.get(zone);
};
function wallToDate(y, mo, d, h, mi, s, zone) {
  const f = fmtFor(zone) || fmtFor(TZ); const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset = t => { const p = {}; for (const x of f.formatToParts(new Date(t))) p[x.type] = +x.value; return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - t; };
  let t = wall - offset(wall); t = wall - offset(t); // två varv räcker även runt sommartidsskiften
  return new Date(t);
}
const tzidOf = ev => { try { return ev.component.getFirstProperty('dtstart')?.getParameter('tzid') || ''; } catch { return ''; } };
const toDate = (t, tzid) => t.zone && t.zone !== ICAL.Timezone.localTimezone ? t.toJSDate()
  : wallToDate(t.year, t.month, t.day, t.hour, t.minute, t.second, tzid && fmtFor(tzid) ? tzid : TZ);
const ymd = t => `${t.year}-${pad2(t.month)}-${pad2(t.day)}`;

// Expandera händelser inom [from, to) till appens format.
// Tidsatta händelser som går över midnatt delas upp per dag (span: first/mid/last).
export function expand(events, from, to, feed) {
  const res = []; const src = feedKind(feed.url);
  // Datumgränser i svensk tid. Mitt på dagen som ankare gör att fönstret blir rätt även om enheten står i en annan tidszon.
  const lo = dstr(new Date(+from + 12 * 3600e3)), hi = dstr(new Date(+to + 12 * 3600e3));
  const push = (summary, s, e, uid, loc, tzid) => {
    const base = { title: String(summary || '').trim().replace(/\s+/g, ' ') || '(utan titel)', person: feed.person, readonly: true, feed: feed.name, feedId: feed.id, src, loc: String(loc || '').trim() };
    if (s.isDate) { // heldag: räkna på datumkomponenterna (DTEND är exklusiv), aldrig via klockslag i enhetens tidszon
      const first = ymd(s); let endEx = e ? ymd(e) : first; if (endEx <= first) endEx = addDays(first, 1);
      const lastDay = addDays(endEx, -1); if (lastDay < lo || first >= hi) return;
      const id = `ics:${feed.id}:${uid}:${first}`;
      for (let ds = first < lo ? lo : first, g = 0; ds < endEx && ds < hi && g < 400; ds = addDays(ds, 1), g++) res.push({ ...base, id: id + ':' + ds, date: ds, start: '', end: '', range: first !== lastDay ? [first, lastDay] : null });
      return;
    }
    const sd = toDate(s, tzid), ed = e ? toDate(e, tzid) : sd;
    base.id = `ics:${feed.id}:${uid}:${+sd}`;
    const d0 = dstr(sd), d1 = dstr(new Date(Math.max(+sd, +ed - 1))); // slut exakt vid midnatt räknas till dagen innan
    if (d1 < lo || d0 >= hi) return;
    if (d0 === d1) { res.push({ ...base, date: d0, start: tstr(sd), end: tstr(ed) }); return; }
    for (let ds = d0, g = 0; ds <= d1 && g < 60; ds = addDays(ds, 1), g++) {
      if (ds < lo || ds >= hi) continue;
      const span = ds === d0 ? 'first' : ds === d1 ? 'last' : 'mid';
      res.push({ ...base, id: base.id + ':' + ds, date: ds, span, range: [d0, d1], start: span === 'first' ? tstr(sd) : span === 'last' ? '00:00' : '', end: span === 'last' ? tstr(ed) : '', s0: tstr(sd), e1: tstr(ed) });
    }
  };
  // En flyttad förekomst kan ligga långt från sitt ursprungliga datum, så serien gås igenom med marginal åt båda håll
  // och push() avgör vad som faktiskt hamnar i veckan.
  const SLACK = 45 * 864e5;
  const tTo = ICAL.Time.fromJSDate(new Date(+to + SLACK), true), fromS = (+from - SLACK) / 1000;
  for (const ev of events) {
    if (!ev.startDate) continue;
    try {
      if (ev.isRecurring()) {
        const it = ev.iterator(); let n, guard = 0;
        while ((n = it.next()) && guard++ < 50000) {
          if (n.compare(tTo) >= 0) break;
          if (n.toUnixTime() < fromS) continue; // billig förkontroll: hoppa över gamla förekomster utan att räkna ut detaljerna
          const o = ev.getOccurrenceDetails(n);
          push(o.item.summary, o.startDate, o.endDate, ev.uid, o.item.location, tzidOf(o.item));
        }
      } else push(ev.summary, ev.startDate, ev.endDate, ev.uid, ev.location, tzidOf(ev));
    } catch (e) { console.warn('ICS: hoppar över händelse', ev.uid, e); }
  }
  return res;
}

// ---- senaste kopian på enheten (Cache API)
const copyKey = id => '/__ics/' + id;
const copies = () => (globalThis.caches ? caches.open(ICS_CACHE) : Promise.reject(new Error('ingen cache')));
async function saveCopy(id, text, at) { try { await (await copies()).put(copyKey(id), new Response(text, { headers: { 'X-At': String(at) } })); } catch {} }
async function readCopy(id) { try { const r = await (await copies()).match(copyKey(id)); return r ? { text: await r.text(), fetchedAt: Number(r.headers.get('X-At')) || 0 } : null; } catch { return null; } }
const sigOf = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return s.length + ':' + (h >>> 0); };

// Returnerar { events, fetchedAt, stale }. Workern svarar med senast lyckade kopia (stale) om källan tillfälligt strular.
// Är texten oförändrad sedan förra hämtningen återanvänds den tolkade kalendern (samma events-objekt).
export async function loadFeed(feed, token, force = false) {
  const c = cache.get(feed.id);
  if (c && !force && Date.now() - c.at < 15 * 60e3) return c.res;
  let text, fetchedAt, stale = false, fromCopy = false;
  try {
    const r = await fetch(`/api/ics?id=${encodeURIComponent(feed.id)}`, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout?.(45000) });
    if (!r.ok) throw Object.assign(new Error(`Kunde inte hämta ”${feed.name}” (${r.status === 403 ? 'länken är inte tillåten' : r.status === 404 ? 'kalendern saknas' : r.status === 401 ? 'inloggningen har gått ut' : 'fel ' + r.status})`), { status: r.status });
    text = await r.text(); fetchedAt = Number(r.headers.get('X-Ics-Fetched-At')) || Date.now(); stale = r.headers.get('X-Ics-Cache') === 'stale';
  } catch (e) {
    const err = e.status ? e : new Error(`Kunde inte hämta ”${feed.name}” (ingen kontakt med servern)`);
    // Har vi redan pass i minnet behåller anroparen dem. Annars: använd kopian på enheten vid nät- eller serverfel.
    if (c || [401, 403, 404].includes(e.status)) throw err;
    const copy = await readCopy(feed.id); if (!copy) throw err;
    ({ text, fetchedAt } = copy); stale = true; fromCopy = true;
  }
  const sig = sigOf(text); let events;
  if (c && c.sig === sig) events = c.res.events;
  else { try { events = parseIcs(text); } catch (e) { console.warn('ICS', feed.name, e); throw new Error(`Kunde inte tolka kalendern ”${feed.name}”`); } }
  const res = { events, fetchedAt, stale }; let savedAt = c?.savedAt || 0;
  if (!fromCopy && (!c || c.sig !== sig || Date.now() - savedAt > 30 * 60e3)) { savedAt = Date.now(); saveCopy(feed.id, text, fetchedAt); }
  cache.set(feed.id, { res, sig, at: Date.now(), savedAt }); return res;
}
export const forgetFeed = id => { cache.delete(id); copies().then(c => c.delete(copyKey(id))).catch(() => {}); };
export const forgetAllFeeds = () => { cache.clear(); try { globalThis.caches?.delete(ICS_CACHE).catch(() => {}); } catch {} };
