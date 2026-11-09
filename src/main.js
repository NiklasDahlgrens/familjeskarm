import './fonts.css';
import './style.css';
import './dashboard.css';
import { store } from './data/index.js';
import { mondayOf } from './data/seed.js';
import { loadFeed, expand, forgetFeed, feedKind } from './feeds.js';
import { icon } from './icons.js';
import { weather, loadWeather, wxIcon, wxText, deg, num, weatherPlace } from './weather.js';

import { transit, loadTransit } from './transit.js';

const TZ = 'Europe/Stockholm';
// Fasta färger per person (styrs av CSS-klasserna p-niklas/p-sambo/p-gemensamt)
const P = { niklas: 'Hubby', sambo: 'Wifey', gemensamt: 'Gemensamt' };
const DAYS = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag'];
const iso = d => d.toLocaleDateString('sv-SE');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, r = document) => r.querySelector(s);
const S = { view: 'hem', week: mondayOf(new Date()), data: {}, loaded: false, filter: new Set(Object.keys(P)), feeds: [], feedErr: [], feedStatus: {}, feedsLoading: false, showPast: false };
const VIEWS = [['hem', 'home', 'Hem'], ['kalender', 'calendar', 'Kalender'], ['todo', 'checksq', 'Att göra'], ['matsedel', 'meal', 'Matsedel'], ['recept', 'book', 'Recept'], ['inkop', 'cart', 'Inköp']];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isPhone = () => matchMedia('(max-width: 820px)').matches;
const SRC = { icloud: ['apple', 'iPhone-kalendern'], personalkollen: ['briefcase', 'Personalkollen'], google: ['calendar', 'Google Kalender'], outlook: ['calendar', 'Outlook'], other: ['link', 'den ursprungliga kalendern'] };
const srcIcon = e => e.readonly ? icon((SRC[e.src] || SRC.other)[0], 'ro-i') : '';
const ingr = r => r?.ingredients || [], stepsOf = r => r?.steps || [];

// ---------- tema: ljus / mörk / auto (mörk 21–06)
const nightNow = () => { const h = +new Date().toLocaleString('sv-SE', { hour: '2-digit', hour12: false, timeZone: TZ }); return h >= 21 || h < 6; };
const themePref = () => localStorage.getItem('fs-theme') || 'auto';
const THEME_TXT = { auto: 'Tema: automatiskt (mörkt 21–06)', dark: 'Tema: mörkt', light: 'Tema: ljust' };
function applyTheme() {
  const pref = themePref(); const dark = pref === 'dark' || (pref === 'auto' && nightNow());
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelectorAll('meta[name=theme-color]').forEach(m => { const md = m.getAttribute('media') || ''; if (md.includes('dark')) m.setAttribute('content', '#0b0f17'); else if (md.includes('light')) m.setAttribute('content', '#f6f2ec'); else m.setAttribute('content', dark ? '#0b0f17' : '#f6f2ec'); });
  for (const b of [$('#theme'), $('#theme2')]) if (b) { b.innerHTML = icon(pref === 'auto' ? 'auto' : pref === 'dark' ? 'moon' : 'sun'); b.title = THEME_TXT[pref]; b.setAttribute('aria-label', THEME_TXT[pref] + ' – tryck för att byta'); }
}
applyTheme();

// ---------- data
let feedSig = null, refreshing = null, again = false;
async function refresh() {
  if (!document.getElementById('main')) return;
  if (refreshing) { again = true; return refreshing; } // slå ihop samtidiga anrop, men kör en gång till efteråt
  refreshing = (async () => {
    const ts = ['events', 'todos', 'recipes', 'meal_plan', 'shopping_items', 'calendar_feeds'];
    const v = await Promise.all(ts.map(t => store.list(t))); ts.forEach((t, i) => S.data[t] = v[i] || []);
    S.loaded = true; lastRefresh = Date.now(); lastNightMinute = ''; render(false);
    const sig = (S.data.calendar_feeds || []).map(f => f.id + f.url + f.person + f.name).sort().join('|');
    if (sig !== feedSig) { feedSig = sig; loadFeeds(true); }
  })();
  try { await refreshing; } finally { refreshing = null; }
  if (again) { again = false; return refresh(); }
}
let lastRefresh = 0, refreshTimer;
store.subscribe(() => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 120); });

// ---------- prenumererade kalendrar (endast läsning)
let feedMemo = {}, lastFeedLoad = 0, roIndex = new Map();
const FEED_WARN_MS = 30 * 60e3;
async function loadFeeds(force = false) {
  if (!store.getAccessToken || S.feedsLoading) return;
  const token = await store.getAccessToken(); if (!token) return;
  S.feedsLoading = true; if (S.view === 'kalender') render(false);
  try {
    const list = (S.data.calendar_feeds && S.data.calendar_feeds.length) ? S.data.calendar_feeds : await store.list('calendar_feeds');
    const prev = new Map(S.feeds.map(x => [x.feed.id, x])); const err = [], feeds = [], status = {};
    await Promise.all(list.map(async f => {
      const was = S.feedStatus[f.id] || {};
      try { const res = await loadFeed(f, token, force); feeds.push({ feed: f, events: res.events });
        // stale = Workern visar senaste lyckade kopian; räkna det som ett fel sedan källan senast svarade
        status[f.id] = res.stale ? { ok: true, stale: true, at: res.fetchedAt, since: Math.min(was.since || Date.now(), res.fetchedAt + 20 * 60e3), msg: `”${f.name}” svarar inte just nu` } : { ok: true, at: res.fetchedAt }; }
      catch (e) { const old = prev.get(f.id); if (old) feeds.push({ ...old, feed: f }); // behåll senast hämtade pass
        status[f.id] = { ok: false, msg: e.message, at: was.at, since: was.since || Date.now(), hasData: !!old }; }
    }));
    // Visa bara varning när en kalender strulat i över 30 min, eller om vi saknar pass helt för den
    for (const [id, st] of Object.entries(status)) if ((!st.ok || st.stale) && (Date.now() - st.since > FEED_WARN_MS || (!st.ok && !st.hasData))) err.push(st.msg);
    lastNightMinute = ''; S.feeds = feeds; S.feedErr = err; S.feedStatus = status; feedMemo = {}; lastFeedLoad = Date.now();
  } finally { S.feedsLoading = false; }
  if (!$('#dlg')?.open) render(false); else updateFeedStatusUi();
}
function feedEvents(date) {
  const from = mondayOf(new Date(date + 'T12:00')); const wk = iso(from);
  if (!feedMemo[wk]) { const to = new Date(from); to.setDate(to.getDate() + 7);
    feedMemo[wk] = S.feeds.flatMap(({ feed, events }) => { try { return expand(events, from, to, feed); } catch (e) { console.warn(e); return []; } });
    feedMemo[wk].forEach(e => roIndex.set(e.id, e)); }
  return feedMemo[wk].filter(e => e.date === date);
}
const endKey = e => e.span === 'first' || e.span === 'mid' ? '24:00' : e.end === '00:00' && e.start ? '24:00' : (e.end || e.start);
const byTime = (a, b) => (a.start || '').localeCompare(b.start || '') || endKey(a).localeCompare(endKey(b)) || a.title.localeCompare(b.title, 'sv');
const eventsOn = (date, filtered = false) => [...(S.data.events || []).filter(e => e.date === date), ...feedEvents(date)]
  .filter(e => !filtered || S.filter.has(e.person)).sort(byTime);
// Uppdatera kalendrar var 3:e minut och när skärmen/appen visas igen; databasen som reserv om realtid tappats
setInterval(() => loadFeeds(true), 3 * 60e3);
setInterval(() => { if (Date.now() - lastRefresh > 4 * 60e3) refresh(); }, 60e3);
const wxRefresh = force => loadWeather(force).then(ok => { if (ok) lastNightMinute = ''; if (ok && S.view === 'hem' && !$('#dlg')?.open) render(false); });
setInterval(() => wxRefresh(true), 30 * 60e3);
const transitRefresh = () => loadTransit().then(ok => { if (ok && S.view === 'hem' && !$('#dlg')?.open) render(false); });
setInterval(() => { if (!document.hidden && $('#main')) transitRefresh(); }, 60e3);
const onShow = () => { if (document.hidden) return; transitRefresh(); syncNight(); requestWakeLock(); wxRefresh(); if (Date.now() - lastFeedLoad > 60e3) loadFeeds(true); if (Date.now() - lastRefresh > 30e3) refresh(); };
document.addEventListener('visibilitychange', onShow); addEventListener('focus', onShow);
addEventListener('online', () => { renderNet(); refresh(); loadFeeds(true); }); addEventListener('offline', () => renderNet());

// ---------- hjälpare
const nowHM = () => new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
const addDays = (ds, n) => { const d = new Date(ds + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); };
const weekNo = d => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); };
const cap = s => { if (!s) return s; const g = graphemes(s); return (g[0] || '').toLocaleUpperCase('sv-SE') + g.slice(1).join(''); };
const greeting = () => { const h = +nowHM().slice(0, 2); return h < 5 ? 'God natt' : h < 10 ? 'God morgon' : h < 13 ? 'God förmiddag' : h < 18 ? 'God eftermiddag' : 'God kväll'; };
const recipe = id => (S.data.recipes || []).find(r => r.id === id);
const mealFor = date => (S.data.meal_plan || []).find(m => m.date === date);
const weekDates = () => DAYS.map((n, i) => { const d = new Date(S.week); d.setDate(d.getDate() + i); return d; });
const hue = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 17);
const grad = s => { const h = hue(s); return `background:linear-gradient(135deg,hsl(${h} 70% 62%),hsl(${(h + 40) % 360} 75% 48%))`; };
const avatar = p => `<span class="av p-${p}" title="${P[p] || p}" aria-label="${P[p] || p}">${esc(firstGrapheme(P[p] || p))}</span>`;
const chip = p => `<span class="chip p-${p}"><i></i>${P[p] || p}</span>`;
const imgOr = (r, cls) => r.image ? `<div class="${cls}" style="${grad(r.title)}"><img src="${esc(r.image)}" alt="" loading="lazy" onerror="this.remove()"></div>` : `<div class="${cls} ph" style="${grad(r.title)}">${icon('meal')}</div>`;
const empty = (ic, title, sub = '', btn = '') => `<div class="empty">${icon(ic)}<b>${title}</b>${sub ? `<span>${sub}</span>` : ''}${btn}</div>`;
const timeLabel = e => e.span === 'first' ? `${e.start} →` : e.span === 'last' ? `→ ${e.end}` : e.span === 'mid' ? 'Hela dagen' : e.start ? `${e.start}${e.end ? '–' + e.end : ''}` : 'Heldag';
const mins = hm => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
const until = hm => { const d = mins(hm) - mins(nowHM()); if (d <= 0) return 'nu'; const h = Math.floor(d / 60), m = d % 60; return 'om ' + (h ? `${h} h${m ? ' ' + m + ' min' : ''}` : `${m} min`); };

const pad2 = n => String(n).padStart(2, '0');
const hmOf = (h, m) => `${pad2(h)}:${pad2(m)}`;
const addMinsHm = (hm, add) => { const t = Math.min(23 * 60 + 55, Math.max(0, mins(hm) + add)); return hmOf(Math.floor(t / 60), t % 60); };
const isTouchUi = () => matchMedia('(hover: none), (pointer: coarse)').matches;

const buzz = (ms = 12) => {
  try {
    if (reduceMotion) return;
    const v = navigator.vibrate;
    if (typeof v === 'function') v.call(navigator, ms);
  } catch {}
};
/** Safe grapheme iteration (emoji / ZWJ / VS). */
const graphemes = (s) => {
  const str = String(s ?? '');
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return [...new Intl.Segmenter('sv', { granularity: 'grapheme' }).segment(str)].map(x => x.segment);
    }
  } catch {}
  try { return Array.from(str); } catch { return str.split(''); }
};
const firstGrapheme = (s) => graphemes(s)[0] || '';
/** Prefer single-codepoint / low-risk emoji (old Android Chrome chokes on some ZWJ/VS sequences). */
const EVENT_SUGGESTS = [
  ['🥗', 'Middag'], ['💪', 'Träning'], ['🎂', 'Kalas'], ['🦷', 'Tandläkare'],
  ['✈️', 'Resa'], ['🍻', 'Fest'], ['🎬', 'Bio'], ['🛒', 'Handla'],
];
const PLACE_EV = ['T.ex. Tandläkare', 'T.ex. Middag med vänner', 'T.ex. Träning', 'T.ex. Bio ikväll', 'T.ex. Kalas!'];
const PLACE_TODO = ['Vad behöver göras?', 'T.ex. Boka tvättid', 'T.ex. Köpa present', 'T.ex. Ringa mormor'];
const PLACE_SHOP = ['Lägg till vara…', 'T.ex. Mjölk', 'T.ex. Banancer', 'T.ex. Diskmedel'];
const PLACE_RECIPE = ['T.ex. Pannkakor', 'T.ex. Pasta carbonara', 'T.ex. Fredagstacos'];
const faceSvg = (color, dark = '#052e16') => `<svg class="face" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="${color}"/><circle cx="11.5" cy="13.5" r="2.1" fill="${dark}"/><circle cx="20.5" cy="13.5" r="2.1" fill="${dark}"/><path d="M11.5 19.5 q4.5 4 9 0" fill="none" stroke="${dark}" stroke-width="2.2" stroke-linecap="round"/></svg>`;
const FACES = { niklas: faceSvg('#22c55e'), sambo: faceSvg('#3b82f6', '#0f172a'), gemensamt: faceSvg('#ec4899', '#4a044e') };
const suggestRow = (items) => `<div class="suggest" role="list" aria-label="Snabbval">${items.map(([em, lab]) => `<button type="button" class="sug" data-sug="${esc(lab)}" data-emo="${esc(em)}" role="listitem"><span class="sug-e" aria-hidden="true">${em}</span><span>${esc(lab)}</span></button>`).join('')}</div>`;
const phTimers = new WeakMap();
function bindSuggests(root, inputSel = '[name=title]') {
  const inp = $(inputSel, root); if (!inp) return;
  root.querySelectorAll('[data-sug]').forEach(b => {
    b.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try {
        const emo = (b.getAttribute('data-emo') || '').trim();
        const lab = (b.getAttribute('data-sug') || '').trim();
        // Build title from graphemes so we never leave a lone surrogate in the field
        const title = [emo, lab].filter(Boolean).join(' ');
        inp.value = title;
        // stop rotating placeholder immediately
        const t = phTimers.get(inp); if (t) { clearInterval(t); phTimers.delete(inp); }
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        markDlgDirty();
        buzz(10);
        root.querySelectorAll('.sug.pop').forEach(x => x.classList.remove('pop'));
        b.classList.add('pop');
        setTimeout(() => b.classList.remove('pop'), 280);
        // Never force-focus on touch tablets/phones — Android IME + emoji can glitch the dialog
        if (!isTouchUi() && !isPhone()) {
          try { inp.focus({ preventScroll: true }); } catch { try { inp.focus(); } catch {} }
        }
      } catch (err) {
        console.warn('suggest', err);
        try { toast('Kunde inte välja snabbval', true); } catch {}
      }
    };
  });
}
function celebrate(anchor) {
  try {
    if (reduceMotion) return;
    // Low-end / busy: keep burst tiny (Samsung A11+ etc.)
    document.querySelectorAll('.burst').forEach(x => x.remove());
    const host = document.createElement('div');
    host.className = 'burst';
    host.setAttribute('aria-hidden', 'true');
    const rect = (anchor && anchor.getBoundingClientRect) ? anchor.getBoundingClientRect()
      : { left: innerWidth / 2, top: innerHeight * .7, width: 0, height: 0 };
    host.style.left = (rect.left + rect.width / 2) + 'px';
    host.style.top = (rect.top + rect.height / 2) + 'px';
    const bits = ['💕', '✨', '💖', '💚'];
    const n = isTouchUi() || isPhone() ? 6 : 10;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.textContent = bits[i % bits.length];
      const ang = (Math.PI * 2 * i) / n;
      const dist = 40 + (i % 3) * 18;
      s.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
      s.style.setProperty('--dy', (Math.sin(ang) * dist - 16).toFixed(1) + 'px');
      s.style.animationDelay = (i * 20) + 'ms';
      host.append(s);
    }
    document.body.append(host);
    setTimeout(() => { try { host.remove(); } catch {} }, 700);
  } catch (err) { console.warn('celebrate', err); }
}
function rotatePlaceholder(inp, list) {
  if (!inp || !list?.length || inp.value) return;
  const prev = phTimers.get(inp); if (prev) clearInterval(prev);
  let i = Math.floor(Math.random() * list.length);
  try { inp.placeholder = list[i]; } catch {}
  if (reduceMotion) return;
  const id = setInterval(() => {
    try {
      if (!inp.isConnected || document.activeElement === inp || inp.value) {
        clearInterval(id); phTimers.delete(inp); return;
      }
      i = (i + 1) % list.length;
      inp.placeholder = list[i];
    } catch { clearInterval(id); phTimers.delete(inp); }
  }, 4200);
  phTimers.set(inp, id);
}

const lastPerson = () => localStorage.getItem('fs-last-person') || 'gemensamt';
const rememberPerson = p => { if (P[p]) localStorage.setItem('fs-last-person', p); };

// ---------- dialog UX: sticky footer, tangentbord, osparade ändringar, svensk tid
let dlgDirty = false, vvCleanup = null;
const markDlgDirty = () => { dlgDirty = true; };
function syncDlgHeight() {
  const d = $('#dlg'); if (!d?.open) return;
  const vv = window.visualViewport;
  const h = Math.floor((vv?.height || window.innerHeight) - (isPhone() ? 28 : 16));
  d.style.setProperty('--dlg-max', Math.max(240, h) + 'px');
  const ae = document.activeElement;
  if (ae && d.contains(ae) && ae.matches('input,textarea,select,[contenteditable]')) {
    try { ae.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { ae.scrollIntoView(); }
  }
}
function bindDlgViewport(d) {
  vvCleanup?.();
  const on = () => syncDlgHeight();
  visualViewport?.addEventListener('resize', on);
  visualViewport?.addEventListener('scroll', on);
  addEventListener('resize', on);
  d.addEventListener('focusin', on);
  syncDlgHeight();
  vvCleanup = () => { visualViewport?.removeEventListener('resize', on); visualViewport?.removeEventListener('scroll', on); removeEventListener('resize', on); d.removeEventListener('focusin', on); vvCleanup = null; };
}

const TIME_PRESETS = ['08:00', '09:00', '10:00', '12:00', '13:00', '15:00', '17:00', '18:00', '19:00', '20:00'];
const MIN_STEPS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MONTHS_LONG = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
const DAYS_SHORT = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'];
const shortDate = ds => { const d = new Date(ds + 'T12:00'); return `${DAYS_SHORT[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; };
const shortDayChip = ds => { const d = new Date(ds + 'T12:00'); return `${DAYS_SHORT[(d.getDay() + 6) % 7]} ${d.getDate()}`; };
const nextHalfHour = () => {
  const h = +nowHM().slice(0, 2), m = +nowHM().slice(3, 5);
  if (m === 0 || m === 30) return hmOf(h, m);
  if (m < 30) return hmOf(h, 30);
  return h >= 23 ? '23:30' : hmOf(h + 1, 0);
};

function timePick(name, value = '') {
  const v = value || '';
  return `<div class="tpick" data-tpick="${name}">
    <input type="hidden" name="${name}" value="${esc(v)}">
    <button type="button" class="tpick-btn${v ? '' : ' empty'}" aria-haspopup="dialog" aria-expanded="false" aria-label="Välj tid">
      ${icon('clock')}<span class="tpick-val">${v || 'Välj tid'}</span>
    </button>
  </div>`;
}

function openTimeSheet(root, tpickEl, { onChange, onDone } = {}) {
  const hid = $('input[type=hidden]', tpickEl);
  const btn = $('.tpick-btn', tpickEl);
  const title = tpickEl.dataset.tpick === 'end' ? 'Sluttid' : 'Starttid';
  let draft = hid.value && /^\d{2}:\d{2}$/.test(hid.value) ? hid.value : nextHalfHour();

  // stäng eventuell öppen sheet
  root.querySelectorAll('.tsheet').forEach(x => x.remove());
  root.querySelectorAll('.tpick-btn[aria-expanded=true]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  btn.setAttribute('aria-expanded', 'true');

  const sheet = document.createElement('div');
  sheet.className = 'tsheet';
  sheet.innerHTML = `<div class="tsheet-bg" data-ts-close></div>
    <div class="tsheet-panel" role="dialog" aria-modal="true" aria-label="${title}">
      <header class="tsheet-h">
        <div><span class="tsheet-kicker">${title}</span><div class="tsheet-big" data-ts-big>${draft}</div></div>
        <button type="button" class="round" data-ts-close aria-label="Stäng">${icon('x')}</button>
      </header>
      <div class="tsheet-presets">${TIME_PRESETS.map(t => `<button type="button" class="chipbtn" data-t="${t}">${t}</button>`).join('')}</div>
      <div class="tsheet-cols">
        <div class="tsheet-col" data-kind="h" role="listbox" aria-label="Timme">
          ${Array.from({ length: 24 }, (_, h) => `<button type="button" role="option" class="tsheet-opt" data-h="${h}">${pad2(h)}</button>`).join('')}
        </div>
        <div class="tsheet-col" data-kind="m" role="listbox" aria-label="Minut">
          ${MIN_STEPS.map(m => `<button type="button" role="option" class="tsheet-opt" data-m="${m}">${pad2(m)}</button>`).join('')}
        </div>
      </div>
      <footer class="tsheet-f">
        <button type="button" class="ghost" data-ts-clear>Rensa</button>
        <span class="sp"></span>
        <button type="button" class="primary" data-ts-ok>Klar</button>
      </footer>
    </div>`;
  // append inside dialog so it layers above the form sheet
  (root.closest('dialog') || root).appendChild(sheet);

  const big = $('[data-ts-big]', sheet);
  const paint = () => {
    big.textContent = draft || '—:—';
    const h = draft ? +draft.slice(0, 2) : -1, m = draft ? +draft.slice(3, 5) : -1;
    sheet.querySelectorAll('[data-h]').forEach(b => b.classList.toggle('on', +b.dataset.h === h));
    sheet.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', +b.dataset.m === m));
    sheet.querySelectorAll('.tsheet-presets [data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === draft));
    const hc = sheet.querySelector(`[data-h="${h}"]`);
    const mc = sheet.querySelector(`[data-m="${m}"]`);
    requestAnimationFrame(() => {
      for (const el of [hc, mc]) {
        if (!el) continue;
        const col = el.closest('.tsheet-col');
        if (!col) continue;
        const c = col.getBoundingClientRect(), r = el.getBoundingClientRect();
        col.scrollTop += (r.top + r.height / 2) - (c.top + c.height / 2);
      }
    });
  };
  const setDraft = v => { draft = v || ''; paint(); };
  const close = () => { sheet.remove(); btn.setAttribute('aria-expanded', 'false'); };
  const apply = v => {
    hid.value = v || '';
    const valEl = $('.tpick-val', tpickEl);
    if (valEl) valEl.textContent = v || 'Välj tid';
    btn.classList.toggle('empty', !v);
    markDlgDirty();
    onChange?.(hid.name, hid.value);
    close();
    onDone?.();
  };

  sheet.addEventListener('click', e => {
    if (e.target.closest('[data-ts-close]')) { close(); return; }
    if (e.target.closest('[data-ts-ok]')) { apply(draft); return; }
    if (e.target.closest('[data-ts-clear]')) { apply(''); return; }
    const t = e.target.closest('[data-t],[data-h],[data-m]');
    if (!t) return;
    if (t.dataset.t) { setDraft(t.dataset.t); return; }
    const cur = draft && /^\d{2}:\d{2}$/.test(draft) ? draft : nextHalfHour();
    if (t.dataset.h != null) setDraft(hmOf(+t.dataset.h, +cur.slice(3, 5)));
    if (t.dataset.m != null) setDraft(hmOf(+cur.slice(0, 2), +t.dataset.m));
  });
  // Esc handled by dialog cancel; also stop backdrop click from closing main dlg
  sheet.addEventListener('pointerdown', e => e.stopPropagation());
  paint();
  syncDlgHeight();
  return sheet;
}

function bindTimePickers(root, { onChange } = {}) {
  root.querySelectorAll('[data-tpick]').forEach(el => {
    const btn = $('.tpick-btn', el);
    btn.onclick = e => {
      e.preventDefault(); e.stopPropagation();
      openTimeSheet(root, el, { onChange });
    };
  });
}

function datePick(value) {
  const t = todayIso(), v = value || t;
  const week = Array.from({ length: 7 }, (_, i) => addDays(t, i));
  return `<div class="dpick" data-dpick>
    <input type="hidden" name="date" value="${esc(v)}" required>
    <div class="dpick-chips" role="group" aria-label="Snabbval">
      <button type="button" class="chipbtn ${v === t ? 'on' : ''}" data-d="${t}">Idag</button>
      <button type="button" class="chipbtn ${v === addDays(t, 1) ? 'on' : ''}" data-d="${addDays(t, 1)}">Imorgon</button>
    </div>
    <div class="dpick-week" role="listbox" aria-label="Kommande dagar">
      ${week.map(ds => `<button type="button" role="option" class="chipbtn daychip ${ds === v ? 'on' : ''}" data-d="${ds}"><b>${shortDayChip(ds)}</b></button>`).join('')}
    </div>
    <button type="button" class="dpick-more" aria-haspopup="dialog" aria-expanded="false">
      <span class="dpick-more-lab">Annat datum</span>
      <span class="dpick-more-val">${esc(shortDate(v))}</span>
      ${icon('calendar')}
    </button>
    <div class="dpick-cal" hidden role="dialog" aria-label="Kalender">
      <div class="dpick-cal-h">
        <button type="button" class="round" data-cal-prev aria-label="Föregående månad">${icon('left')}</button>
        <b class="dpick-cal-title"></b>
        <button type="button" class="round" data-cal-next aria-label="Nästa månad">${icon('right')}</button>
      </div>
      <div class="dpick-dows">${DAYS_SHORT.map(x => `<span>${x}</span>`).join('')}</div>
      <div class="dpick-grid"></div>
    </div>
  </div>`;
}

function bindDatePick(root) {
  const wrap = $('[data-dpick]', root); if (!wrap) return;
  const hid = $('input[name=date]', wrap);
  const cal = $('.dpick-cal', wrap);
  const more = $('.dpick-more', wrap);
  let view = hid.value || todayIso();
  const monthStart = ds => { const d = new Date(ds + 'T12:00'); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`; };
  let cursor = monthStart(view);

  const paint = () => {
    const v = hid.value;
    wrap.querySelectorAll('[data-d]').forEach(b => b.classList.toggle('on', b.dataset.d === v));
    const mv = $('.dpick-more-val', wrap); if (mv) mv.textContent = shortDate(v);
    more.classList.toggle('on', !relDay(v) && !Array.from({ length: 7 }, (_, i) => addDays(todayIso(), i)).includes(v));
  };

  const renderCal = () => {
    const [y, m] = cursor.split('-').map(Number);
    const title = `${MONTHS_LONG[m - 1]} ${y}`;
    $('.dpick-cal-title', wrap).textContent = title;
    const first = new Date(y, m - 1, 1);
    const startPad = (first.getDay() + 6) % 7; // Monday=0
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells = [];
    for (let i = 0; i < startPad; i++) cells.push('<span class="dim"></span>');
    for (let day = 1; day <= daysInMonth; day++) {
      const ds = `${y}-${pad2(m)}-${pad2(day)}`;
      const cls = ['chipbtn', 'calday', ds === hid.value ? 'on' : '', ds === todayIso() ? 'today' : ''].filter(Boolean).join(' ');
      cells.push(`<button type="button" class="${cls}" data-cal-day="${ds}">${day}</button>`);
    }
    $('.dpick-grid', wrap).innerHTML = cells.join('');
  };

  const set = ds => {
    hid.value = ds; paint(); markDlgDirty(); buzz(8);
    hid.dispatchEvent(new Event('change', { bubbles: true }));
    cal.hidden = true; more.setAttribute('aria-expanded', 'false');
  };

  wrap.querySelectorAll('.dpick-chips [data-d], .dpick-week [data-d]').forEach(b => b.onclick = () => set(b.dataset.d));
  more.onclick = () => {
    const open = cal.hidden;
    cal.hidden = !open; more.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { cursor = monthStart(hid.value || todayIso()); renderCal(); syncDlgHeight(); }
  };
  $('[data-cal-prev]', wrap).onclick = () => { const d = new Date(cursor + 'T12:00'); d.setMonth(d.getMonth() - 1); cursor = monthStart(iso(d)); renderCal(); };
  $('[data-cal-next]', wrap).onclick = () => { const d = new Date(cursor + 'T12:00'); d.setMonth(d.getMonth() + 1); cursor = monthStart(iso(d)); renderCal(); };
  $('.dpick-grid', wrap).onclick = e => { const b = e.target.closest('[data-cal-day]'); if (b) set(b.dataset.calDay); };
  root.addEventListener('click', e => {
    if (!e.target.closest('[data-dpick]')) { cal.hidden = true; more.setAttribute('aria-expanded', 'false'); }
  });
  paint();
}

const dayName = ds => DAYS[(new Date(ds + 'T12:00').getDay() + 6) % 7];
const relDay = ds => { const t = todayIso(); return ds === t ? 'Idag' : ds === addDays(t, 1) ? 'Imorgon' : ds === addDays(t, -1) ? 'Igår' : ''; };
const fmtDate = ds => new Date(ds + 'T12:00').toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });
const evAttrs = e => e.readonly ? `data-ro="${esc(e.id)}" role="button" tabindex="0" aria-label="${esc(e.title)}, ${timeLabel(e)}, ${P[e.person] || ''} (från ${(SRC[e.src] || SRC.other)[1]})"` : `data-ev="${e.id}" role="button" tabindex="0" aria-label="Ändra ${esc(e.title)}, ${timeLabel(e)}"`;
const isCur = (e, now) => e.start && e.start <= now && endKey(e) > now && e.span !== 'mid';

// ---------- skal
function shell() {
  $('#app').innerHTML = `
  <nav class="nav" aria-label="Huvudmeny"><div class="brand">${logo()}</div>
    ${VIEWS.map(([k, i, l]) => `<button data-view="${k}">${icon(i)}<small>${l}</small></button>`).join('')}
    <div class="nav-foot"><button id="theme" class="nav-mini"></button><button id="settings" class="nav-mini" aria-label="Inställningar" title="Inställningar">${icon('settings')}</button></div></nav>
  <header class="mbar"><div><div class="m-date" id="mdate"></div><h1 class="m-title" id="mtitle"></h1></div><div class="m-act"><button id="theme2" class="round"></button><button id="settings2" class="round" aria-label="Inställningar">${icon('settings')}</button></div></header>
  <main id="main" tabindex="-1"></main>
  <button class="fab" id="fab" aria-label="Lägg till">${icon('plus')}</button>
  <div id="net" class="net" hidden role="status">${icon('wifioff')}<span>Offline – visar senast sparade data</span></div>
  <dialog id="dlg" aria-labelledby="dlg-title"></dialog><div id="night" class="night" hidden role="button" tabindex="0" aria-label="Väck skärmen i två minuter"><div class="n-content"><div class="n-clock"></div><div class="n-date"></div><div class="n-weather"></div><div class="n-next"></div><div class="n-hint">Tryck för att väcka skärmen</div></div></div>`;
  $('.nav').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) go(b.dataset.view); });
  const cycle = () => { const o = ['auto', 'light', 'dark']; localStorage.setItem('fs-theme', o[(o.indexOf(themePref()) + 1) % 3]); applyTheme(); toast(THEME_TXT[themePref()]); };
  $('#theme').onclick = cycle; $('#theme2').onclick = cycle; $('#settings').onclick = settings; $('#settings2').onclick = settings;
  $('#fab').onclick = addMenu; $('#night').onclick = wake;
  $('#dlg').addEventListener('close', () => { vvCleanup?.(); dlgDirty = false; if (pendingReload) location.reload(); });
  $('#dlg').addEventListener('cancel', e => { if (dlgDirty) { e.preventDefault(); requestCloseDlg(); } });
  applyTheme(); renderNet(); tick(); clearInterval(tickTimer); tickTimer = setInterval(tick, 1000); requestWakeLock();
}
function renderNet() { const n = $('#net'); if (n) n.hidden = navigator.onLine; }
const logo = () => `<svg viewBox="0 0 48 48" class="logo" aria-hidden="true"><defs><linearGradient id="lgbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffaf3"/><stop offset="1" stop-color="#fde8ff"/></linearGradient></defs><rect width="48" height="48" rx="14" fill="url(#lgbg)"/><circle cx="16.5" cy="17" r="7.2" fill="#22c55e"/><circle cx="14.2" cy="15.8" r="1.15" fill="#052e16"/><circle cx="18.4" cy="15.8" r="1.15" fill="#052e16"/><path d="M14.5 18.6 q2 1.7 4 0" fill="none" stroke="#052e16" stroke-width=".9" stroke-linecap="round"/><circle cx="31.5" cy="17" r="7.2" fill="#3b82f6"/><circle cx="29.2" cy="15.8" r="1.15" fill="#0f172a"/><circle cx="33.4" cy="15.8" r="1.15" fill="#0f172a"/><path d="M29.5 18.6 q2 1.7 4 0" fill="none" stroke="#0f172a" stroke-width=".9" stroke-linecap="round"/><rect x="8" y="22" width="32" height="20" rx="5" fill="#fff" stroke="#ec4899" stroke-width="2"/><rect x="8" y="22" width="32" height="6.5" rx="5" fill="#ec4899"/><rect x="8" y="25.5" width="32" height="3" fill="#ec4899"/><circle cx="15" cy="33.5" r="2" fill="#22c55e"/><circle cx="24" cy="33.5" r="2" fill="#3b82f6"/><circle cx="33" cy="33.5" r="2" fill="#f9a8d4"/><circle cx="15" cy="38.8" r="2" fill="#86efac"/><circle cx="24" cy="38.8" r="2" fill="#93c5fd"/><circle cx="33" cy="38.8" r="2" fill="#fbcfe8"/><circle cx="24" cy="21.5" r="5.2" fill="#fff"/><path d="M24 23.4 C24 21.7 22.7 20.7 21.4 20.7 C20.3 20.7 19.6 21.5 19.6 22.5 C19.6 24.4 22.4 25.7 24 27 C25.6 25.7 28.4 24.4 28.4 22.5 C28.4 21.5 27.7 20.7 26.6 20.7 C25.3 20.7 24 21.7 24 23.4 Z" fill="#ec4899"/></svg>`;
function go(v) {
  if (v === S.view) { $('#main').scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); return; }
  S.view = v; if (v !== 'kalender') S.showPast = false;
  if (document.startViewTransition && !reduceMotion) document.startViewTransition(() => render()); else render();
  $('#main').scrollTop = 0;
}
let lastMin = '', tickTimer;
function tick() {
  const n = new Date(); const hm = nowHM();
  const d = cap(n.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }));
  document.querySelectorAll('[data-clock]').forEach(x => x.textContent = hm);
  if ($('#mdate')) $('#mdate').textContent = `${d} · ${hm}`;
  syncNight();
  const ng = $('#night'); if (ng && !ng.hidden) { $('.n-clock', ng).textContent = hm; $('.n-date', ng).textContent = d; updateNightContent(); }
  if (hm !== lastMin) { lastMin = hm; applyTheme();
    // rita om varje minut så att nu-linje, "pågår nu" och nedräkning stämmer
    if ((S.view === 'hem' || S.view === 'kalender') && !$('#dlg').open && !document.hidden) render(false); }
}

// Nattläge sparas per enhet. Skärmens faktiska ljusstyrka styrs fortfarande av Android.
const NIGHT_DEFAULTS = { enabled: !isPhone(), start: '23:00', end: '06:00' };
const NIGHT_WAKE_MS = 2 * 60e3;
function nightSettings() {
  try { const v = JSON.parse(localStorage.getItem('fs-night') || '{}'); return { enabled: typeof v.enabled === 'boolean' ? v.enabled : NIGHT_DEFAULTS.enabled, start: /^([01]\d|2[0-3]):[0-5]\d$/.test(v.start) ? v.start : NIGHT_DEFAULTS.start, end: /^([01]\d|2[0-3]):[0-5]\d$/.test(v.end) ? v.end : NIGHT_DEFAULTS.end }; } catch { return { ...NIGHT_DEFAULTS }; }
}
function nightActive() {
  const n = nightSettings(), hm = nowHM();
  return n.enabled && n.start !== n.end && (n.start > n.end ? hm >= n.start || hm < n.end : hm >= n.start && hm < n.end);
}
let awakeUntil = 0, idle, lastTouch = 0, wakeLock = null, wakePending = false, lastNightMinute = '';
async function requestWakeLock() {
  if (!navigator.wakeLock || document.hidden || !$('#main') || wakeLock || wakePending) return;
  wakePending = true;
  try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch { /* Webbläsaren kan neka vid låg batterinivå. */ } finally { wakePending = false; }
}
function syncNight() {
  const n = $('#night'); if (!n) return;
  const show = nightActive() && Date.now() >= awakeUntil && !$('#dlg')?.open;
  if (!show) { n.hidden = true; return; }
  if (n.hidden) sleepScreen();
}
function updateNightContent() {
  const n = $('#night'); if (!n || n.hidden) return;
  const minute = todayIso() + nowHM(); if (minute === lastNightMinute) return; lastNightMinute = minute;
  const c = weather()?.current;
  $('.n-weather', n).innerHTML = c ? `${wxIcon(c.weather_code, !!c.is_day)}<span>${deg(c.temperature_2m)} · ${wxText(c.weather_code)} · Mölndal</span>` : 'Väder saknas just nu';
  const day = nowHM() >= nightSettings().start ? addDays(todayIso(), 1) : todayIso();
  const nx = eventsOn(day).find(e => !e.start || e.start >= (day === todayIso() ? nowHM() : '00:00'));
  $('.n-next', n).innerHTML = nx ? `${day === todayIso() ? 'Idag' : 'Imorgon'} ${nx.start ? 'kl ' + esc(nx.start) : '· Heldag'} · ${esc(nx.title)}` : '';
  // Små lägesförflyttningar varje minut för att undvika statiska pixlar.
  const m = Math.floor(Date.now() / 60000);
  $('.n-content', n).style.transform = `translate(${(m % 9 - 4) * 7}px,${(Math.floor(m / 9) % 7 - 3) * 6}px)`;
}
function sleepScreen() { const n = $('#night'); if (!n) return; n.hidden = false; lastNightMinute = ''; updateNightContent(); }
function wake() { awakeUntil = Date.now() + NIGHT_WAKE_MS; $('#night').hidden = true; requestWakeLock(); resetIdle(); }
const resetIdle = () => { clearTimeout(idle); idle = setTimeout(() => {
  if (!$('#main')) return;
  if ($('#dlg')?.open) return resetIdle();
  if (pendingReload) return location.reload();
  if (S.view !== 'hem' || iso(S.week) !== iso(mondayOf(new Date()))) { S.view = 'hem'; S.week = mondayOf(new Date()); S.showPast = false; render(); }
}, 180000); };
['pointerdown', 'keydown', 'wheel'].forEach(e => addEventListener(e, () => { lastTouch = Date.now(); resetIdle(); if (nightActive() && $('#night')?.hidden) awakeUntil = Date.now() + NIGHT_WAKE_MS; requestWakeLock(); }, { passive: true }));

// ---------- rendering
function render(animate = true) {
  const m = $('#main'); if (!m || touchDrag) return;
  document.querySelectorAll('.nav [data-view]').forEach(b => { const on = b.dataset.view === S.view; b.classList.toggle('on', on); on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
  const title = VIEWS.find(v => v[0] === S.view)[2]; if ($('#mtitle')) $('#mtitle').textContent = S.view === 'hem' ? greeting() : title;
  document.title = (S.view === 'hem' ? '' : title + ' · ') + 'Familjeskärmen';
  const st = m.scrollTop; const keep = !animate; const sx = keep ? [...m.querySelectorAll('[data-keep-scroll]')].map(x => x.scrollTop) : [];
  m.className = 'view-' + S.view + (animate && !reduceMotion ? ' enter' : '');
  m.innerHTML = S.loaded ? ({ hem, kalender, todo, matsedel, recept, inkop })[S.view]() : skeleton();
  if (keep) { m.scrollTop = st; m.querySelectorAll('[data-keep-scroll]').forEach((x, i) => { if (sx[i] != null) x.scrollTop = sx[i]; }); }
  requestAnimationFrame(updateDayOverflow);
  // Hem: håll "nu" i bild i dagens lista så länge ingen har rört skärmen den senaste minuten
  if (S.view === 'hem' && (!keep || Date.now() - lastTouch > 60e3)) { const c = $('.timeline .cur, .timeline .nowline'); const tl = $('.timeline'); if (c && tl && tl.scrollHeight > tl.clientHeight) tl.scrollTop = Math.max(0, c.offsetTop - tl.offsetTop - 12); }
}
function updateDayOverflow() {
  document.querySelectorAll('.dlist[data-day]').forEach(list => {
    const btn = list.closest('.day').querySelector('.day-overflow'); if (!btn) return;
    const update = () => { const bottom = list.getBoundingClientRect().bottom; const count = [...list.querySelectorAll('.wev,.wad')].filter(x => x.getBoundingClientRect().bottom > bottom + 3).length; btn.hidden = !count; btn.textContent = `+${count} längre ner ↓`; };
    list.onscroll = update; btn.onclick = () => list.scrollBy({top: Math.max(100,list.clientHeight * .75),behavior:reduceMotion?'instant':'smooth'}); update();
  });
}
addEventListener('resize', updateDayOverflow);
const skeleton = () => `<div class="skel-wrap" aria-busy="true" aria-label="Laddar">${'<div class="skel"></div>'.repeat(3)}</div>`;

// ----- Hem
function nextUp() {
  const t = todayIso(), now = nowHM();
  const cur = eventsOn(t).filter(e => isCur(e, now));
  const nx = eventsOn(t).find(e => e.start && e.start > now && e.span !== 'last');
  if (nx) return `<span class="nx-k">Härnäst</span> <b>${esc(nx.title)}</b> kl ${nx.start} <span class="nx-u">${until(nx.start)}</span>`;
  if (cur.length) return `<span class="nx-k">Pågår</span> <b>${esc(cur[0].title)}</b>${cur[0].end && endKey(cur[0]) !== '24:00' ? ` till ${cur[0].end}` : ''}`;
  const tm = eventsOn(addDays(t, 1)).find(e => e.start && e.span !== 'last') || eventsOn(addDays(t, 1))[0];
  return tm ? `<span class="nx-k">Imorgon</span> <b>${esc(tm.title)}</b>${tm.start ? ' kl ' + tm.start : ''}` : '';
}
// ----- Väder (Hem)
function wxNow(d, cls = '') {
  if (!d) return `<div class="wx-now wx-miss ${cls}">${icon('cloudoff')}<span>Väder saknas just nu</span></div>`;
  const c = d.current, D = d.daily; const di = Math.max(0, D.time.indexOf(todayIso()));
  const pp = D.precipitation_probability_max?.[di], ps = D.precipitation_sum?.[di];
  return `<div class="wx-now ${cls}" aria-label="Vädret i ${weatherPlace}: ${wxText(c.weather_code)}, ${deg(c.temperature_2m)}">${wxIcon(c.weather_code, !!c.is_day, 'big')}<div class="wx-t">${deg(c.temperature_2m)}</div>
    <div class="wx-info"><b>${wxText(c.weather_code)}</b><span>${weatherPlace} · <span class="wx-hl">↑ ${deg(D.temperature_2m_max[di])}  ↓ ${deg(D.temperature_2m_min[di])}</span></span>
    <span class="wx-meta"><span>${icon('wind')}${num(c.wind_speed_10m, 0)} m/s</span><span>${icon('drop')}${pp ?? 0} %${ps >= 0.1 ? ' · ' + num(ps) + ' mm' : ''}</span></span></div></div>`;
}
function wxFc(d) {
  if (!d) return `<section class="card wxfc"><header><div><span class="section-kicker">Väder</span><h2>Mölndal</h2></div></header>${wxNow(null)}<p class="muted small">Prognosen uppdateras automatiskt.</p></section>`;
  const H = d.hourly, D = d.daily;
  const hNow = +nowHM().slice(0, 2), late = hNow >= 20;
  const day = late ? addDays(todayIso(), 1) : todayIso(), from = late ? 7 : hNow + 1;
  const step = 22 - from <= 5 ? 1 : 22 - from <= 10 ? 2 : 3;
  const hours = []; for (let h = from; h <= 22; h += step) hours.push(h);
  if (hours.at(-1) !== 22 && from <= 22) hours.push(22);
  const hrs = hours.slice(-7).map(h => H.time.indexOf(`${day}T${String(h).padStart(2, '0')}:00`)).filter(i => i >= 0);
  const days = D.time.map((date, i) => ({date, i})).filter(x => x.date > todayIso()).slice(0, 7);
  const finite = v => v != null && Number.isFinite(+v);
  const rain = i => finite(D.precipitation_probability_max?.[i]) ? D.precipitation_probability_max[i] + ' %' : '–';
  return `<section class="card wxfc" aria-label="Väder och sjudygnsprognos för Mölndal"><header><div><span class="section-kicker">Vädret hemma</span><h2>Mölndal</h2></div><span class="weather-source">Open-Meteo</span></header>
    ${wxNow(d, 'weather-current')}
    ${hrs.length ? `<div class="forecast-label"><span>${late ? 'Timprognos · ' + dayName(day).toLowerCase() : 'Fram till kvällen'}</span><small>${late ? new Date(day + 'T12:00').toLocaleDateString('sv-SE', {day:'numeric',month:'short'}) : 'Idag'}</small></div><div class="wxrow hours" style="grid-template-columns:repeat(${hrs.length},minmax(0,1fr))">${hrs.map(i => `<div class="wxh"><span>${H.time[i].slice(11,16)}</span>${wxIcon(H.weather_code[i], !!H.is_day[i])}<b>${deg(H.temperature_2m[i])}</b><small class="wx-p">${H.precipitation_probability[i] != null ? H.precipitation_probability[i] + ' %' : '–'}</small></div>`).join('')}</div>` : ''}
    <div class="forecast-label daily-label"><span>Kommande sju dagar</span><small>Max / min · regnrisk</small></div>
    <div class="forecast-days">${days.map(({date,i},k) => `<div class="forecast-day"><div class="forecast-date"><b>${k === 0 ? 'Imorgon' : dayName(date)}</b><small>${new Date(date+'T12:00').toLocaleDateString('sv-SE',{day:'numeric',month:'short'})}</small></div>${wxIcon(D.weather_code[i],true)}<div class="forecast-temps"><b>${deg(D.temperature_2m_max[i])}</b><span>${deg(D.temperature_2m_min[i])}</span></div><span class="forecast-rain" title="${finite(D.precipitation_sum?.[i]) ? num(D.precipitation_sum[i]) + ' mm nederbörd' : 'Regnrisk'}">${icon('drop')}${rain(i)}</span></div>`).join('')}</div>
  </section>`;
}
function transitCard() {
  const d = transit(), fresh = d.updatedAt && Date.now() - Date.parse(d.updatedAt) < 3 * 60e3;
  const rows = fresh ? d.departures.filter(x => Date.parse(x.estimated || x.planned) >= Date.now() - 30000).slice(0, 6) : [];
  const message = d.status === 'loading' ? 'Hämtar avgångar…' : d.status === 'unconfigured' ? 'Avgångar är inte konfigurerade än' : d.status !== 'ok' || !fresh ? 'Avgångar kan inte hämtas just nu' : 'Inga avgångar de närmaste två timmarna';
  return `<section class="card transit" aria-label="Avgångar från Lackarebäck"><header><div><span class="eyebrow">Västtrafik</span><h2>Lackarebäck</h2></div><span class="transit-mark" aria-hidden="true">↗</span></header>
    ${rows.length ? `<div class="dep-list">${rows.map(x => { const m = Math.max(0, Math.ceil((Date.parse(x.estimated || x.planned) - Date.now()) / 60000)); const delay = x.estimated ? Math.round((Date.parse(x.estimated) - Date.parse(x.planned)) / 60000) : 0; return `<div class="dep ${x.cancelled ? 'cancelled' : ''}"><b class="dep-line" style="background:${esc(x.background)};color:${esc(x.foreground)}">${esc(x.line)}</b><div class="dep-dest" title="${esc(x.destination)}"><b>${esc(x.destination.split(',')[0])}</b><small>${x.platform ? 'Läge ' + esc(x.platform) + ' · ' : ''}${x.cancelled ? 'Inställd' : delay > 0 ? '+' + delay + ' min försenad' : x.partCancelled ? 'Delvis inställd' : x.destination.includes('Ersätter') ? 'Ersätter spårvagn' : x.estimated ? 'Realtid' : 'Tidtabell'}</small></div><strong>${x.cancelled ? '–' : m < 1 ? 'Nu' : m <= 60 ? m + ' min' : new Date(x.estimated || x.planned).toLocaleTimeString('sv-SE', {hour:'2-digit',minute:'2-digit',timeZone:TZ})}</strong></div>`; }).join('')}</div><div class="dep-foot">Uppdaterad ${new Date(d.updatedAt).toLocaleTimeString('sv-SE', {hour:'2-digit',minute:'2-digit',timeZone:TZ})} · alla lägen</div>` : `<div class="dep-empty"><b>${message}</b><span>${d.status === 'unconfigured' ? 'Västtrafik behöver kopplas in. Här visas sedan nästa buss eller spårvagn.' : 'Uppdateras automatiskt varje minut.'}</span></div>`}
  </section>`;
}
function hem() {
  const t = todayIso(), tm = addDays(t, 1); const ev = eventsOn(t), evT = eventsOn(tm);
  const r = null;
  const todos = (S.data.todos || []).filter(x => !x.done); const doneN = (S.data.todos || []).length - todos.length;
  const now = nowHM(); const d = new Date();
  const allDay = ev.filter(e => !e.start), timed = ev.filter(e => e.start);
  const next = timed.find(e => endKey(e) > now);
  const tl = timed.map(e => { const past = endKey(e) <= now; const cur = isCur(e, now);
    return `${e === next && !cur ? '<div class="nowline" role="presentation"><span>' + now + '</span></div>' : ''}<div class="tl ${past ? 'past' : ''} ${cur ? 'cur' : ''} p-${e.person} ${e.readonly ? 'ro' : ''}" ${evAttrs(e)}>
      <div class="tl-time">${e.span === 'last' ? '<small>till</small>' + e.end : e.start}<small>${e.span === 'first' ? '→' : e.span === 'last' ? '' : e.end || ''}</small></div><div class="tl-body"><b>${esc(e.title)}</b><span class="meta">${cur ? '<em class="live">Pågår nu</em>' : ''}${srcIcon(e)}${P[e.person]}${e.readonly ? ' · ' + esc(e.feed) : ''}</span></div></div>`; }).join('')
    + (timed.length && !next ? `<div class="nowline end"><span>${now}</span></div>` : '');
  const nx = nextUp(); const wd = weather();
  return `<div class="dash">
    <section class="hero">
      <div class="greet">${greeting()}</div>
      <div class="bigclock" data-clock>${now}</div>
      <div class="bigdate">${cap(d.toLocaleDateString('sv-SE', { weekday: 'long', timeZone: TZ }))} ${d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', timeZone: TZ })} <span>· vecka ${weekNo(d)}</span></div>
      <div class="summary">${nx ? `<div class="nextup">${nx}</div>` : summaryLine(ev, todos, r)}</div>
      <div class="household-legend"><span class="p-niklas"><i></i>Hubby</span><span class="p-sambo"><i></i>Wifey</span><span class="p-gemensamt"><i></i>Gemensamt</span></div>
    </section>
    <section class="card today"><header><div><h2>Idag</h2><div class="hsub">${summaryLine(ev, todos, r, true)}</div></div><button class="pill" data-act="newEvent" data-date="${t}">${icon('plus')}Händelse</button></header>
      ${nx ? `<div class="nextup m-only">${nx}</div>` : ''}
      ${allDay.length ? `<div class="allday">${allDay.map(e => `<span class="adchip p-${e.person}" ${evAttrs(e)}>${srcIcon(e)}${esc(e.title)}</span>`).join('')}</div>` : ''}
      <div class="timeline" data-keep-scroll>${timed.length ? tl : allDay.length ? '' : empty('sparkle', 'En lugn dag ☁️', 'Inget inplanerat – njut av andrummet.')}</div>
      <div class="tomorrow"><h3>Imorgon · ${dayName(tm).toLowerCase()}</h3>${evT.length ? `<div class="tm-list">${evT.slice(0, 3).map(e => `<span class="tm p-${e.person}" ${evAttrs(e)}><i></i><b>${e.start && e.span !== 'last' ? e.start : e.span === 'last' ? '→' + e.end : 'Heldag'}</b><span class="tm-t">${esc(e.title)}</span></span>`).join('')}${evT.length > 3 ? `<button class="tm more" data-view-go="kalender">+${evT.length - 3} till</button>` : ''}</div>` : '<span class="muted">Inget planerat än</span>'}</div>
    </section>
    ${wxFc(wd)}
    <div class="dashboard-aside">${transitCard()}<section class="card todos"><header><h2>Att göra <span class="count" aria-label="${todos.length} kvar">${todos.length}</span></h2><button class="todo-add" data-act="newTodo" aria-label="Ny uppgift">${icon('plus')}</button></header>
      <div class="list" data-keep-scroll>${todos.slice(0, 3).map(todoRow).join('') || empty('check', 'Allt är klart! 🎉', doneN ? `${doneN} ${doneN === 1 ? 'uppgift' : 'uppgifter'} avbockade – snyggt!` : 'Listan gapar tom… på ett bra sätt.')}</div>
      ${todos.length > 3 ? `<button class="link" data-view-go="todo">Visa alla ${todos.length} ${icon('right')}</button>` : todos.length ? `<button class="link" data-act="newTodo">${icon('plus')}Ny uppgift</button>` : ''}</section></div>
  </div>`;
}
function summaryLine(ev, todos, r, short = false) {
  const parts = [];
  parts.push(ev.length ? `${ev.length} ${ev.length === 1 ? 'händelse' : 'händelser'}` + (short ? '' : ' idag') : short ? 'Inga händelser' : 'Inga händelser idag');
  if (!short && todos.length) parts.push(`${todos.length} att göra`);
  if (!short && r) parts.push(`${esc(r.title).toLowerCase()} till middag`);
  return parts.join(' · ');
}
const todoRow = x => `<label class="row-item ${x.done ? 'done' : ''}"><input type="checkbox" class="cb" data-todo="${x.id}" ${x.done ? 'checked' : ''}><span class="cbx">${icon('check')}</span><span class="t">${esc(x.title)}</span>${avatar(x.person)}<button class="del" data-del="todos:${x.id}" aria-label="Ta bort ${esc(x.title)}">${icon('x')}</button></label>`;

// ----- Kalender
function weekBar(title, extra = '') {
  const end = new Date(S.week); end.setDate(end.getDate() + 6);
  const f = d => d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' }).replace('.', '');
  const isThis = iso(S.week) === iso(mondayOf(new Date()));
  const rel = isThis ? 'Denna vecka' : iso(S.week) === addDays(iso(mondayOf(new Date())), 7) ? 'Nästa vecka' : iso(S.week) === addDays(iso(mondayOf(new Date())), -7) ? 'Förra veckan' : '';
  return `<div class="bar"><div><h1>${title}</h1><div class="sub">${rel ? `<span class="rel ${isThis ? 'now' : ''}">${rel}</span>` : ''}Vecka ${weekNo(S.week)} · ${f(S.week)} – ${f(end)}</div></div>
    <div class="bar-r">${extra}<div class="seg" role="group" aria-label="Byt vecka"><button data-act="prev" aria-label="Föregående vecka">${icon('left')}</button><button data-act="thisweek" ${isThis ? 'disabled' : ''} aria-label="Gå till denna vecka">Idag</button><button data-act="next" aria-label="Nästa vecka">${icon('right')}</button></div></div></div>`;
}
function feedWarn() {
  if (!S.feedErr.length) return '';
  const n = S.feedErr.length;
  return `<div class="warn warn-compact" role="status">${icon('info')}<details><summary><b>${n === 1 ? 'En kalender' : n + ' kalendrar'} kunde inte uppdateras</b> · Senast hämtade pass visas <u>Visa detaljer</u></summary><span>${S.feedErr.map(esc).join('<br>')}</span></details><button class="pill" data-act="reloadFeeds">${icon('refresh')}Försök igen</button></div>`;
}
function kalender() {
  const t = todayIso(), now = nowHM();
  const filters = `<div class="filters" role="group" aria-label="Visa personer">${Object.keys(P).map(p => `<button class="fchip p-${p} ${S.filter.has(p) ? 'on' : ''}" data-filter="${p}" aria-pressed="${S.filter.has(p)}"><i></i>${P[p]}</button>`).join('')}${S.feedsLoading ? `<span class="spin" role="status" aria-label="Hämtar kalendrar">${icon('refresh')}</span>` : ''}</div>`;
  const days = weekDates(); const isThis = iso(S.week) === iso(mondayOf(new Date()));
  const hidePast = isPhone() && isThis && !S.showPast; const pastN = days.filter(d => iso(d) < t).length;
  const cards = days.map((d, i) => {
    const ds = iso(d); const ev = eventsOn(ds, true); const ad = ev.filter(e => !e.start), tm = ev.filter(e => e.start);
    const m = mealFor(ds); const r = m && recipe(m.recipe_id); const isT = ds === t; let lineDone = !isT;
    const items = tm.map(e => { let line = ''; if (!lineDone && e.start > now) { line = `<div class="wnow" aria-hidden="true"><span>${now}</span></div>`; lineDone = true; }
      const past = (ds < t) || (isT && endKey(e) <= now);
      return line + `<div class="wev p-${e.person} ${e.readonly ? 'ro' : ''} ${past && isT ? 'past' : ''} ${isT && isCur(e, now) ? 'cur' : ''}" ${evAttrs(e)}><div class="wt"><b>${timeLabel(e)}</b>${srcIcon(e)}</div><span class="wtt">${esc(e.title).replace(/\//g, '/<wbr>')}</span></div>`; }).join('') + (!lineDone ? `<div class="wnow" aria-hidden="true"><span>${now}</span></div>` : '');
    const rel = relDay(ds);
    return `<div class="day ${isT ? 'today' : ''} ${ds < t ? 'pastday' : ''} ${hidePast && ds < t ? 'hidden-past' : ''}">
      <div class="dh"><span class="dn"><span class="s">${DAYS[i].slice(0, 3)}</span><span class="l">${DAYS[i]}</span></span><b>${d.getDate()}</b>${rel && rel !== 'Igår' ? `<em class="drel">${rel}</em>` : ''}</div>
      <div class="dlist" data-day="${ds}" data-keep-scroll>${ad.length ? `<div class="adrow">${ad.map(e => `<div class="wad p-${e.person}" ${evAttrs(e)}>${srcIcon(e)}${esc(e.title)}</div>`).join('')}</div>` : ''}${items || (ad.length ? '' : '<div class="dempty">Inget inplanerat</div>')}</div>
      <button class="day-overflow" data-overflow="${ds}" hidden aria-label="Visa fler händelser denna dag"></button>
      <button class="dadd" data-act="newEvent" data-date="${ds}" aria-label="Ny händelse ${DAYS[i].toLowerCase()} ${d.getDate()}/${d.getMonth() + 1}">${icon('plus')}<span>Lägg till</span></button>
      ${r ? `<div class="dmeal" data-recipe="${r.id}" role="button" tabindex="0">${icon('meal')}<span>${esc(r.title)}</span></div>` : ''}</div>`;
  }).join('');
  const kinds = [...new Set(S.feeds.map(f => feedKind(f.feed.url)))];
  return weekBar('Kalender', filters) + feedWarn()
    + (hidePast && pastN ? `<button class="showpast" data-act="showPast">${icon('left')}Visa tidigare dagar i veckan (${pastN})</button>` : '')
    + `<div class="week">${cards}</div><button class="nextweek" data-act="next">Nästa vecka ${icon('right')}</button>`
    + (kinds.length ? `<div class="legend">${kinds.map(k => `<span>${icon((SRC[k] || SRC.other)[0], 'ro-i')}från ${(SRC[k] || SRC.other)[1]}</span>`).join('')}<span class="muted">Synkade händelser ändras i källan – tryck för detaljer.</span></div>` : '');
}

// ----- Att göra
function todo() {
  const all = S.data.todos || []; const open = all.filter(x => !x.done), done = all.filter(x => x.done);
  const groups = Object.keys(P).map(p => [p, open.filter(x => x.person === p)]).filter(g => g[1].length);
  return `<div class="bar"><div><h1>Att göra</h1><div class="sub">${open.length ? `${open.length} kvar` : 'Allt klart'}${done.length ? ` · ${done.length} klara` : ''}</div></div></div>
  <form class="quick" data-form="todo"><input name="title" placeholder="Vad behöver göras?" required autocomplete="off" enterkeyhint="done" aria-label="Ny uppgift" maxlength="200">${personPick()}<button class="primary">${icon('plus')}<span>Lägg till</span></button></form>
  ${groups.length ? `<div class="groups">${groups.map(([p, xs]) => `<section class="card group"><header>${chip(p)}<span class="count">${xs.length}</span></header><div class="list">${xs.map(todoRow).join('')}</div></section>`).join('')}</div>` : `<div class="card">${empty('check', 'Inget kvar att göra 🛋️', 'Njut av lugnet – eller lägg till något ovan.')}</div>`}
  ${done.length ? `<details class="card done-box"><summary>Klara (${done.length})</summary><div class="list">${done.map(todoRow).join('')}</div><button class="link" data-act="clearDone">${icon('trash')}Rensa klara</button></details>` : ''}`;
}
const personPick = (v) => { const cur = v || lastPerson(); return `<div class="ppick" role="radiogroup" aria-label="Vem gäller det?">${Object.entries(P).map(([k, l]) => `<label class="p-${k}"><input type="radio" name="person" value="${k}" ${k === cur ? 'checked' : ''}><span class="ppill">${FACES[k] || ''}<em>${l}</em></span></label>`).join('')}</div>`; };

// ----- Matsedel
function matsedel() {
  const t = todayIso(); const recs = S.data.recipes || [];
  return weekBar('Matsedel', `<button class="pill" data-act="mealsToShopping">${icon('cart')}Till inköpslistan</button>`) + `<div class="mealgrid"><div class="mdays">${weekDates().map((d, i) => {
    const ds = iso(d); const m = mealFor(ds); const r = m && recipe(m.recipe_id);
    return `<div class="mday ${ds === t ? 'today' : ''} ${ds < t ? 'pastday' : ''} ${r ? '' : 'emptyday'}" data-drop="${ds}" data-act="pickMeal" data-date="${ds}" role="button" tabindex="0" aria-label="${DAYS[i]}: ${r ? esc(r.title) + ' – tryck för att byta' : 'välj middag'}">
      ${r ? imgOr(r, 'm-img') : `<div class="m-img add">${icon('plus')}</div>`}
      <div class="m-txt"><span>${DAYS[i]} ${d.getDate()}/${d.getMonth() + 1}${ds === t ? ' · idag' : ''}</span><b>${r ? esc(r.title) : 'Välj middag'}</b></div>
      ${m ? `<button class="del" data-del="meal_plan:${m.id}" aria-label="Ta bort middagen ${DAYS[i].toLowerCase()}">${icon('x')}</button>` : ''}</div>`;
  }).join('')}</div>
  <aside class="card rside"><header><h2>Recept</h2><button class="pill" data-act="newRecipe">${icon('plus')}Nytt</button></header>${recs.length ? `<p class="muted small">Dra med handtaget till en dag, eller tryck på dagen för att välja.</p>` : ''}
  <div class="rlist">${recs.map(r => `<div class="drag" draggable="true" data-drag="${r.id}" data-recipe="${r.id}" role="button" tabindex="0">${imgOr(r, 'r-th')}<span>${esc(r.title)}</span><button class="drag-handle" data-touch-drag="${r.id}" aria-label="Dra ${esc(r.title)} till en dag" title="Dra till en dag">⠿</button></div>`).join('') || empty('book', 'Receptboken väntar 👨‍🍳', 'Spara ett recept så kan du planera veckans middagar.', `<button class="pill" data-act="newRecipe">${icon('plus')}Lägg till det första</button>`)}</div></aside></div>`;
}

// ----- Recept
function recept() {
  const recs = S.data.recipes || [];
  return `<div class="bar"><div><h1>Recept</h1><div class="sub">${recs.length} ${recs.length === 1 ? 'sparat' : 'sparade'}</div></div><button class="primary" data-act="newRecipe">${icon('plus')}<span>Nytt recept</span></button></div>
  ${recs.length ? `<div class="recipes">${recs.map(r => `<article class="rcard" data-recipe="${r.id}" role="button" tabindex="0">${imgOr(r, 'rc-img')}<div class="rc-b"><b>${esc(r.title)}</b><small>${ingr(r).length || stepsOf(r).length ? `${ingr(r).length} ingredienser · ${stepsOf(r).length} steg` : 'Inga ingredienser än'}</small></div></article>`).join('')}</div>`
    : `<div class="card">${empty('book', 'Receptboken är tom 📖', 'Spara era favoriter så blir matsedeln enkel.', `<button class="primary" data-act="newRecipe">${icon('plus')}<span>Nytt recept</span></button>`)}</div>`}`;
}

// ----- Inköp
function inkop() {
  const it = S.data.shopping_items || []; const open = it.filter(x => !x.done), done = it.filter(x => x.done);
  const row = x => `<label class="row-item ${x.done ? 'done' : ''}"><input type="checkbox" class="cb" data-shop="${x.id}" ${x.done ? 'checked' : ''}><span class="cbx">${icon('check')}</span><span class="t">${esc(x.title)}</span><button class="del" data-del="shopping_items:${x.id}" aria-label="Ta bort ${esc(x.title)}">${icon('x')}</button></label>`;
  const bySrc = {}; open.forEach(x => (bySrc[x.source || 'Övrigt'] ||= []).push(x));
  const keys = Object.keys(bySrc).sort((a, b) => a === 'Övrigt' ? -1 : b === 'Övrigt' ? 1 : a.localeCompare(b, 'sv'));
  return `<div class="bar"><div><h1>Inköpslista</h1><div class="sub">${open.length ? `${open.length} ${open.length === 1 ? 'vara' : 'varor'} kvar` : 'Inget kvar att handla'}${done.length ? ` · ${done.length} i korgen` : ''}</div></div><button class="pill" data-act="mealsToShopping">${icon('meal')}Från veckans matsedel</button></div>
  <form class="quick" data-form="shop"><input name="title" placeholder="Lägg till vara…" required autocomplete="off" enterkeyhint="done" aria-label="Ny vara" maxlength="200"><button class="primary">${icon('plus')}<span>Lägg till</span></button></form>
  ${open.length ? `<div class="groups">${keys.map(k => `<section class="card group"><header><h3>${k === 'Övrigt' ? 'Varor' : esc(k)}</h3><span class="count">${bySrc[k].length}</span></header><div class="list">${bySrc[k].map(row).join('')}</div></section>`).join('')}</div>` : `<div class="card">${empty('cart', 'Inköpslistan är tom 🛒', 'Lägg till varor ovan eller hämta från veckans matsedel.')}</div>`}
  ${done.length ? `<details class="card done-box"><summary>I korgen (${done.length})</summary><div class="list">${done.map(row).join('')}</div><button class="link" data-act="clearShop">${icon('trash')}Rensa avbockade</button></details>` : ''}`;
}

// ---------- ark/dialoger (bottenark på mobil, modal på platta)
let closeTimer;
function openDlg(html, cls = '', focus = true) {
  const d = $('#dlg'); clearTimeout(closeTimer); d.classList.remove('closing'); if (d.open) d.close();
  dlgDirty = false;
  d.className = cls; d.innerHTML = `<div class="grab" aria-hidden="true"></div>${html}`;
  const inset = isPhone() ? 28 : 16;
  const vvH = Math.floor((window.visualViewport?.height || window.innerHeight) - inset);
  d.style.setProperty('--dlg-max', Math.max(240, vvH) + 'px');
  d.showModal();
  d.onclick = e => { if (e.target === d) requestCloseDlg(); };
  d.querySelectorAll('[data-close]').forEach(b => b.onclick = e => { e.preventDefault(); requestCloseDlg(); });
  bindDlgViewport(d);
  // Autofokus bara när tangentbordet inte stör (mus/desktop) – plattan öppnar annars IME och täcker Spara
  const f = d.querySelector('input:not([type=radio]):not([type=checkbox]):not([type=hidden]):not([type=date]),textarea');
  if (f && focus && !isPhone() && !isTouchUi()) setTimeout(() => f.focus({ preventScroll: true }), 60);
  else d.querySelector('.sh-b')?.scrollTo(0, 0);
  return d;
}
function closeDlg() {
  const d = $('#dlg'); if (!d?.open) return;
  dlgDirty = false; vvCleanup?.();
  if (reduceMotion) return d.close();
  d.classList.add('closing'); closeTimer = setTimeout(() => { d.classList.remove('closing'); d.close(); }, 180);
}
function requestCloseDlg() {
  if (dlgDirty && !confirm('Du har osparade ändringar. Stäng formuläret ändå?')) return;
  closeDlg();
}
const hdr = title => `<header class="sh-h"><h2 id="dlg-title">${title}</h2><button type="button" class="round" data-close aria-label="Stäng">${icon('x')}</button></header>`;
function form(title, body, onSubmit, extra = '', okText = 'Spara') {
  const d = openDlg(`<form class="sheet" novalidate>${hdr(title)}<div class="sh-b">${body}<p class="err" role="alert" data-ferr></p></div><footer class="sh-f">${extra}<span class="sp"></span><button type="button" class="ghost" data-close>Avbryt</button><button class="primary" data-save>${okText}</button></footer></form>`);
  const f = $('form', d);
  f.addEventListener('input', markDlgDirty);
  f.addEventListener('change', markDlgDirty);
  f.querySelectorAll('.ppick input').forEach(inp => inp.addEventListener('change', () => {
    try {
      buzz(10);
      const lab = inp.closest('label');
      lab?.classList.add('picked'); setTimeout(() => lab?.classList.remove('picked'), 320);
    } catch (err) { console.warn('ppick', err); }
  }));
  const phInp = $('[name=title]', f) || $('input:not([type=hidden]):not([type=checkbox]):not([type=radio])', f);
  const ttl = ($('#dlg-title')?.textContent || '').toLowerCase();
  const phList = /recept/.test(ttl) ? PLACE_RECIPE : /uppgift|göra/.test(ttl) ? PLACE_TODO : /vara|inköp/.test(ttl) ? PLACE_SHOP : PLACE_EV;
  rotatePlaceholder(phInp, phList);
  f.onsubmit = async e => {
    e.preventDefault(); const er = $('[data-ferr]', f); er.textContent = '';
    const bad = [...f.querySelectorAll('[required]')].find(x => !(x.value || '').trim());
    if (bad) {
      er.textContent = `Fyll i ”${(bad.closest('.fld')?.querySelector(':scope > span')?.textContent || 'fältet').replace(/[?:]$/, '')}”.`;
      (bad.closest('.tpick')?.querySelector('.tpick-btn') || bad).focus?.();
      bad.scrollIntoView?.({ block: 'center' });
      return;
    }
    const b = $('[data-save]', f); b.disabled = true; b.classList.add('busy'); const prev = b.textContent; b.textContent = 'Sparar…';
    try {
      const res = await onSubmit(Object.fromEntries(new FormData(f)), f);
      if (typeof res === 'string') { er.textContent = res; er.scrollIntoView({ block: 'nearest' }); }
      else if (res !== false) { const p = f.person?.value || f.querySelector('[name=person]:checked')?.value; if (p) rememberPerson(p); dlgDirty = false; const saveBtn = b; celebrate(saveBtn); buzz(18); closeDlg(); toast('Sparat! 💕'); }
    } catch (err) { er.textContent = 'Kunde inte spara: ' + friendly(err); }
    b.disabled = false; b.classList.remove('busy'); b.textContent = prev;
  };
  return d;
}
const field = (label, input, cls = '') => `<div class="fld ${cls}"><span class="fld-l">${label}</span>${input}</div>`;
const friendly = err => !navigator.onLine ? 'ingen internetanslutning' : (err?.message || String(err));
function eventDlg(ev = {}, date) {
  const allDay = !!ev.id && !ev.start;
  const start = ev.start || (ev.id || allDay ? '' : nextHalfHour());
  const end = ev.end || (start ? addMinsHm(start, 60) : '');
  form(ev.id ? 'Ändra händelse' : 'Ny händelse', `${field('Vad händer?', `<input name="title" placeholder="T.ex. Tandläkare" value="${esc(ev.title)}" required maxlength="120" autocomplete="off" enterkeyhint="done">${ev.id ? '' : suggestRow(EVENT_SUGGESTS)}`)}
    ${field('Dag', datePick(ev.date || date))}
    <label class="switch"><input type="checkbox" name="allday" ${allDay ? 'checked' : ''}><span class="sw" aria-hidden="true"></span><span>Heldag</span></label>
    <div class="two times" ${allDay ? 'hidden' : ''}>${field('Börjar', timePick('start', start))}${field('Slutar', timePick('end', end))}</div>
    ${field('Vem', personPick(ev.person))}`,
    async v => {
      const o = { title: v.title.trim(), date: v.date, person: v.person || lastPerson(), start: v.allday ? null : v.start || null, end: v.allday ? null : v.end || null };
      if (!o.start) o.end = null;
      if (o.start && o.end && o.end <= o.start) return 'Sluttiden måste vara efter starttiden.';
      if (!v.allday && !o.start) return 'Välj en starttid, eller kryssa i Heldag.';
      ev.id ? await store.update('events', ev.id, o) : await store.add('events', o);
    },
    ev.id ? `<button type="button" class="danger" id="delEv">${icon('trash')}<span>Ta bort</span></button>` : '');
  const d = $('#dlg'); const sw = $('[name=allday]', d);
  const syncAllDay = () => {
    const on = sw.checked;
    $('.times', d).hidden = on;
  };
  sw.onchange = () => { syncAllDay(); markDlgDirty(); buzz(10); };
  bindDatePick(d);
  bindTimePickers(d, {
    onChange: (name, value) => {
      if (name !== 'start' || !value) return;
      const en = d.querySelector('[data-tpick=end] input[type=hidden]');
      if (!en) return;
      if (!en.value || en.value <= value) {
        en.value = addMinsHm(value, 60);
        const endWrap = d.querySelector('[data-tpick=end]');
        const valEl = $('.tpick-val', endWrap); if (valEl) valEl.textContent = en.value;
        endWrap?.querySelector('.tpick-btn')?.classList.remove('empty');
      }
    },
  });
  syncAllDay();
  bindSuggests(d);
  buzz(8);
  if (ev.id) $('#delEv').onclick = async () => {
    if (!confirm(`Ta bort händelsen ”${ev.title}”?`)) return;
    dlgDirty = false; closeDlg(); await removeUndo('events', ev.id, 'Händelsen togs bort');
  };
}
function roDlg(e) {
  if (!e) return; const [ic, name] = SRC[e.src] || SRC.other;
  const when = e.range ? `${cap(fmtDate(e.range[0]))}${e.s0 ? ' ' + e.s0 : ''} – ${fmtDate(e.range[1])}${e.e1 ? ' ' + e.e1 : ''}` : `${cap(fmtDate(e.date))} · ${e.start ? `${e.start}${e.end ? '–' + e.end : ''}` : 'heldag'}`;
  openDlg(`<div class="sheet">${hdr(esc(e.title))}<div class="sh-b ro-info">
    <div class="ri">${icon('clock')}<span>${esc(when)}</span></div>
    <div class="ri">${icon('person')}<span>${chip(e.person)}</span></div>
    ${e.loc ? `<div class="ri">${icon('pin')}<span>${esc(e.loc)}</span></div>` : ''}
    <div class="ri">${icon(ic)}<span>${esc(e.feed)}</span></div>
    <p class="note">${icon('lock')}<span>Den här händelsen kommer från ${name} och kan bara ändras där. Ändringar syns här inom några minuter.</span></p>
    </div><footer class="sh-f"><span class="sp"></span><button class="primary" data-close>Okej</button></footer></div>`);
}
function recipeDlg(r = { ingredients: [], steps: [] }) {
  form(r.id ? 'Ändra recept' : 'Nytt recept', `${field('Namn', `<input name="title" placeholder="T.ex. Pannkakor" data-ph="recipe" value="${esc(r.title)}" required maxlength="120" autocomplete="off">`)}
    ${field('Bildlänk (valfritt)', `<input name="image" type="url" inputmode="url" placeholder="https://…" value="${esc(r.image)}">`)}
    ${field('Ingredienser – en per rad', `<textarea name="ingredients" rows="5" placeholder="3 dl mjöl&#10;6 dl mjölk&#10;3 ägg">${esc(ingr(r).join('\n'))}</textarea>`)}
    ${field('Gör så här – ett steg per rad', `<textarea name="steps" rows="5" placeholder="Vispa ihop smeten&#10;Stek i smör">${esc(stepsOf(r).join('\n'))}</textarea>`)}`,
    async v => { if (v.image && !/^https?:\/\//i.test(v.image.trim())) return 'Bildlänken måste börja med https://';
      const o = { title: v.title.trim(), image: (v.image || '').trim(), ingredients: lines(v.ingredients), steps: lines(v.steps) }; r.id ? await store.update('recipes', r.id, o) : await store.add('recipes', o); });
}
const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
function showRecipe(r) {
  if (!r) return;
  const d = openDlg(`<div class="sheet recipe-v">${imgOr(r, 'rv-img')}<button class="round floating" data-close aria-label="Stäng">${icon('x')}</button>
    <div class="sh-b"><h2 id="dlg-title">${esc(r.title)}</h2>${ingr(r).length || stepsOf(r).length ? `<div class="rv-cols"><section><h3>Ingredienser</h3>${ingr(r).length ? `<ul class="ing">${ingr(r).map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="muted">Inga ingredienser.</p>'}</section>
    <section><h3>Gör så här</h3>${stepsOf(r).length ? `<ol class="steps">${stepsOf(r).map(i => `<li>${esc(i)}</li>`).join('')}</ol>` : '<p class="muted">Inga steg.</p>'}</section></div>` : `<p class="muted">Receptet saknar ingredienser och steg än. Tryck på <b>Ändra</b> för att fylla i.</p>`}</div>
    <footer class="sh-f"><button class="danger" id="rd">${icon('trash')}<span>Ta bort</span></button><span class="sp"></span><button class="ghost" id="re">${icon('edit')}Ändra</button><button class="primary" data-close>Klar</button></footer></div>`, 'wide');
  $('#re').onclick = () => recipeDlg(r);
  $('#rd').onclick = async () => { if (confirm(`Ta bort receptet ”${r.title}”?`)) { closeDlg(); await store.remove('recipes', r.id); toast('Receptet togs bort'); } };
}
function pickMeal(date) {
  const cur = mealFor(date)?.recipe_id; const dn = dayName(date).toLowerCase(); const rel = relDay(date);
  const recs = S.data.recipes || [];
  const d = openDlg(`<div class="sheet">${hdr(`Middag ${rel === 'Idag' ? 'ikväll' : rel === 'Imorgon' ? 'imorgon' : dn}`)}
    <div class="sh-b"><div class="pickgrid">${recs.map(r => `<button class="pick ${r.id === cur ? 'on' : ''}" data-pick="${r.id}" aria-pressed="${r.id === cur}">${imgOr(r, 'pk-img')}<span>${esc(r.title)}</span></button>`).join('') || empty('book', 'Inga recept än 🍽️', 'Lägg till ett recept först – sen blir det enkelt.')}</div></div>
    <footer class="sh-f"><button class="ghost" data-new>${icon('plus')}Nytt recept</button><span class="sp"></span><button class="ghost" data-close>Avbryt</button></footer></div>`);
  $('[data-new]', d).onclick = () => recipeDlg();
  d.querySelectorAll('[data-pick]').forEach(b => b.onclick = async () => { closeDlg(); try { await setMeal(date, b.dataset.pick); toast('Middag vald ✓'); } catch (e) { toast('Kunde inte spara: ' + friendly(e), true); } });
}
async function setMeal(date, recipe_id) { if (!recipe_id) return; const m = mealFor(date); m ? await store.update('meal_plan', m.id, { recipe_id }) : await store.add('meal_plan', { date, recipe_id }); }
const todoForm = () => { const d = form('Ny uppgift', `${field('Vad?', '<input name="title" required placeholder="T.ex. Boka tvättid" maxlength="200" autocomplete="off">')}${field('Vem', personPick())}`, v => store.add('todos', { title: v.title.trim(), person: v.person || lastPerson(), done: false }), '', 'Lägg till'); buzz(8); return d; };
function addMenu() {
  const t = todayIso();
  const d = openDlg(`<div class="sheet">${hdr('Lägg till')}<div class="sh-b addmenu">
    <button data-a="ev">${icon('calendar')}<b>Händelse</b><span>I kalendern</span></button><button data-a="todo">${icon('checksq')}<b>Uppgift</b><span>Att göra</span></button>
    <button data-a="shop">${icon('cart')}<b>Vara</b><span>Inköpslistan</span></button><button data-a="meal">${icon('meal')}<b>Middag</b><span>Ikväll</span></button></div></div>`);
  d.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { const a = b.dataset.a;
    if (a === 'ev') eventDlg({}, t); if (a === 'meal') pickMeal(t);
    if (a === 'todo') todoForm();
    if (a === 'shop') form('Ny vara', field('Vara', '<input name="title" required placeholder="T.ex. Mjölk" maxlength="200" autocomplete="off">'), v => store.add('shopping_items', { title: v.title.trim(), done: false, person: 'gemensamt' }), '', 'Lägg till'); });
}
const feedRow = f => { const st = S.feedStatus[f.id]; const [ic] = SRC[feedKind(f.url)] || SRC.other;
  return `<div class="row-item static feed" data-feedrow="${f.id}">${icon(ic, 'ro-i')}<span class="t"><b>${esc(f.name)}</b><span class="fmeta">${chip(f.person)}<small class="fst ${st ? (st.ok && !st.stale ? 'ok' : 'bad') : ''}">${st ? (st.stale ? '⚠ Visar kopia från ' + new Date(st.at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : st.ok ? '✓ Synkad' : '⚠ Kunde inte hämtas') : S.feedsLoading ? 'Hämtar…' : ''}</small></span></span><button class="del" data-delfeed="${f.id}" aria-label="Ta bort ${esc(f.name)}">${icon('x')}</button></div>`; };
function updateFeedStatusUi() { const l = $('#feedlist'); if (l) l.innerHTML = (S.data.calendar_feeds || []).map(feedRow).join(''); const u = $('#feedupd'); if (u) u.textContent = lastFeedLoad ? 'Senast uppdaterad ' + new Date(lastFeedLoad).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : ''; }
function settings() {
  const feeds = S.data.calendar_feeds || [];
  const ns = nightSettings();
  const d = openDlg(`<div class="sheet">${hdr('Inställningar')}<div class="sh-b">
    <section class="set"><h3>Utseende</h3><div class="seg wide" role="radiogroup" aria-label="Tema">${[['auto', 'Auto'], ['light', 'Ljust'], ['dark', 'Mörkt']].map(([k, l]) => `<button role="radio" aria-checked="${themePref() === k}" data-theme-set="${k}" class="${themePref() === k ? 'on' : ''}">${l}</button>`).join('')}</div><p class="muted small">Auto växlar till mörkt tema mellan 21 och 06.</p></section>
    <section class="set"><h3>Nattläge på den här enheten</h3><label class="night-toggle"><input type="checkbox" id="night-enabled" ${ns.enabled ? 'checked' : ''}> Visa en dämpad nattklocka</label><div class="night-times"><label>Från<select id="night-start">${Array.from({ length: 24 }, (_, h) => { const t = pad2(h) + ':00'; return `<option value="${t}" ${ns.start === t || ns.start.startsWith(pad2(h)+':') && h === +ns.start.slice(0,2) ? 'selected' : ''}>${t}</option>`; }).join('')}</select></label><label>Till<select id="night-end">${Array.from({ length: 24 }, (_, h) => { const t = pad2(h) + ':00'; return `<option value="${t}" ${ns.end === t || (ns.end.startsWith(pad2(h)+':') && h === +ns.end.slice(0,2)) ? 'selected' : ''}>${t}</option>`; }).join('')}</select></label></div><p class="muted small">Svensk tid. Tryck på klockan för att väcka skärmen i två minuter. Sänker inte Androids ljusstyrka.</p></section>
    ${store.getAccessToken ? `<section class="set"><div class="set-h"><h3>Kalendrar</h3><button class="pill" id="feedsync">${icon('refresh')}Uppdatera nu</button></div><p class="muted small" id="feedupd"></p>
    <div class="list" id="feedlist">${feeds.map(feedRow).join('') || '<p class="muted small">Inga kalendrar tillagda.</p>'}</div>
    <details class="addfeed"><summary>${icon('plus')}Lägg till kalender</summary><p class="muted small">iPhone: Kalender → Kalendrar → ⓘ vid kalendern → slå på Offentlig kalender → Dela länk. Länkar från Personalkollen, Google och Outlook fungerar också.</p>
    <form id="feedform" class="feedform" novalidate>${field('Namn', '<input name="name" placeholder="T.ex. Jobb" required autocomplete="off">')}${field('Länk', '<input name="url" placeholder="webcal://p…-caldav.icloud.com/published/2/…" required autocomplete="off" inputmode="url">')}${field('Vem', personPick())}<button class="primary">${icon('link')}Lägg till kalender</button><p class="err" id="feederr" role="alert"></p></form></details></section>` : ''}
    <section class="set"><h3>Konto</h3><p class="muted small">${store.kind === 'local' ? 'Data sparas lokalt på den här enheten.' : 'Allt synkas automatiskt mellan era enheter.'}</p>
    <div class="btnrow">${store.signOut ? `<button class="ghost" id="out">${icon('logout')}Logga ut</button>` : ''}${store.reset ? '<button class="ghost" id="seed">Återställ exempeldata</button>' : ''}</div></section>
    <details class="set danger-zone"><summary>Avancerat</summary><p class="muted small">Raderar alla händelser, uppgifter, recept, matsedlar, inköpslistor och kalenderlänkar för hela hushållet. Kan inte ångras.</p><button class="danger" id="wipe">${icon('trash')}Rensa all data</button></details>
    </div></div>`, '', false);
  updateFeedStatusUi();
  for (const id of ['night-enabled', 'night-start', 'night-end']) $('#' + id).onchange = () => { const start = $('#night-start').value, end = $('#night-end').value; if (!start || !end || start === end) return toast('Välj två olika klockslag', true); localStorage.setItem('fs-night', JSON.stringify({ enabled: $('#night-enabled').checked, start, end })); awakeUntil = Date.now() + NIGHT_WAKE_MS; syncNight(); };
  d.querySelectorAll('[data-theme-set]').forEach(b => b.onclick = () => { localStorage.setItem('fs-theme', b.dataset.themeSet); applyTheme(); d.querySelectorAll('[data-theme-set]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); });
  if ($('#feedsync')) $('#feedsync').onclick = async e => { const b = e.currentTarget; b.disabled = true; b.classList.add('busy'); await refresh(); await loadFeeds(true); updateFeedStatusUi(); b.disabled = false; b.classList.remove('busy'); toast(S.feedErr.length ? 'Vissa kalendrar kunde inte hämtas' : 'Kalendrarna är uppdaterade', !!S.feedErr.length); };
  $('#feedform') && ($('#feedform').onsubmit = async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); v.url = (v.url || '').trim(); v.name = (v.name || '').trim();
    if (!v.name) { $('#feederr').textContent = 'Ge kalendern ett namn.'; return; }
    if (!/^(webcal|https):\/\/([^/]*\.)?(icloud\.com|calendar\.google\.com|outlook\.office365\.com|outlook\.live\.com|personalkollen\.se)\//i.test(v.url)) { $('#feederr').textContent = 'Länken måste komma från iCloud, Google, Outlook eller Personalkollen.'; return; }
    try { await store.add('calendar_feeds', v); closeDlg(); toast('Kalendern lades till ✓'); await refresh(); loadFeeds(true); } catch (err) { $('#feederr').textContent = 'Kunde inte spara: ' + friendly(err); } });
  d.addEventListener('click', async e => { const b = e.target.closest('[data-delfeed]'); if (!b) return; const f = feeds.find(x => x.id === b.dataset.delfeed);
    if (!confirm(`Ta bort kalendern ”${f?.name || ''}” från skärmen?`)) return; forgetFeed(b.dataset.delfeed); await store.remove('calendar_feeds', b.dataset.delfeed); closeDlg(); toast('Kalendern togs bort'); await refresh(); loadFeeds(); });
  $('#wipe').onclick = async () => { if (!confirm('Radera ALL data för hela hushållet? Det går inte att ångra.')) return; for (const t of Object.keys(S.data)) for (const x of S.data[t]) await store.remove(t, x.id); closeDlg(); };
  if ($('#seed')) $('#seed').onclick = async () => { await store.reset(); closeDlg(); };
  if ($('#out')) $('#out').onclick = async () => { if (!confirm('Logga ut från den här enheten?')) return; await store.signOut(); d.close(); loginScreen(); };
}

// ---------- ta bort med ångra
async function removeUndo(t, id, msg) {
  const row = (S.data[t] || []).find(x => x.id === id);
  if (row) S.data[t] = S.data[t].filter(x => x.id !== id);
  try { await store.remove(t, id); } catch (e) { toast('Kunde inte ta bort: ' + friendly(e), true); refresh(); return; }
  if (row) toast(msg || 'Borttaget', false, { label: 'Ångra', fn: () => store.add(t, row) });
}
async function removeManyUndo(t, rows, msg) {
  try { for (const x of rows) await store.remove(t, x.id); } catch (e) { toast('Kunde inte ta bort: ' + friendly(e), true); return; }
  toast(msg, false, { label: 'Ångra', fn: async () => { for (const x of rows) await store.add(t, x); } });
}

// ---------- händelser
document.addEventListener('click', async e => {
  const el = e.target;
  if (Date.now() < suppressDragClick || el.closest('[data-touch-drag]')) return;
  const del = el.closest('[data-del]'); if (del) { e.preventDefault(); e.stopPropagation(); const [t, id] = del.dataset.del.split(':'); const row = del.closest('.row-item,.mday'); row?.classList.add('leaving');
    const label = { todos: 'Uppgiften togs bort', shopping_items: 'Varan togs bort', meal_plan: 'Middagen togs bort' }[t];
    setTimeout(() => removeUndo(t, id, label), reduceMotion ? 0 : 160); return; }
  const fl = el.closest('[data-filter]'); if (fl) { const p = fl.dataset.filter; if (S.filter.has(p) && S.filter.size === 1) return toast('Minst en person måste visas'); S.filter.has(p) ? S.filter.delete(p) : S.filter.add(p); return render(false); }
  const vg = el.closest('[data-view-go]'); if (vg) return go(vg.dataset.viewGo);
  if (el.closest('#dlg')) return;
  const ro = el.closest('[data-ro]'); if (ro) return roDlg(roIndex.get(ro.dataset.ro));
  const ev = el.closest('[data-ev]'); if (ev) { const x = (S.data.events || []).find(x => x.id === ev.dataset.ev); return x ? eventDlg(x) : toast('Händelsen finns inte längre', true); }
  const rc = el.closest('[data-recipe]'); if (rc && !el.closest('[data-act]')) return showRecipe(recipe(rc.dataset.recipe));
  const a = el.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act;
  if (act === 'prev' || act === 'next') { S.week = new Date(S.week); S.week.setDate(S.week.getDate() + (act === 'prev' ? -7 : 7)); render(); }
  if (act === 'thisweek') { S.week = mondayOf(new Date()); render(); }
  if (act === 'showPast') { S.showPast = true; render(false); }
  if (act === 'reloadFeeds') { await loadFeeds(true); toast(S.feedErr.length ? 'Fortfarande problem med en kalender' : 'Kalendrarna är uppdaterade', !!S.feedErr.length); }
  if (act === 'newEvent') eventDlg({}, a.dataset.date);
  if (act === 'newTodo') todoForm();
  if (act === 'newRecipe') recipeDlg();
  if (act === 'pickMeal') pickMeal(a.dataset.date);
  if (act === 'clearDone') { const xs = (S.data.todos || []).filter(x => x.done); removeManyUndo('todos', xs, `${xs.length} klara uppgifter rensades`); }
  if (act === 'clearShop') { const xs = (S.data.shopping_items || []).filter(x => x.done); removeManyUndo('shopping_items', xs, `${xs.length} varor rensades`); }
  if (act === 'mealsToShopping') {
    const ds = weekDates().map(iso); const meals = (S.data.meal_plan || []).filter(m => ds.includes(m.date) && recipe(m.recipe_id));
    if (!meals.length) return toast('Ingen middag planerad den här veckan');
    const have = new Set((S.data.shopping_items || []).filter(x => !x.done).map(x => x.title.toLowerCase())); let n = 0, total = 0; a.disabled = true;
    try { for (const m of meals) { const r = recipe(m.recipe_id);
      for (const i of ingr(r)) { total++; if (!have.has(i.toLowerCase())) { have.add(i.toLowerCase()); n++; await store.add('shopping_items', { title: i, done: false, person: 'gemensamt', source: r.title }); } } } }
    catch (err) { toast('Kunde inte spara: ' + friendly(err), true); } finally { a.disabled = false; }
    toast(n ? `${n} ${n === 1 ? 'vara' : 'varor'} lades i inköpslistan ✓` : total ? 'Allt finns redan på listan' : 'Veckans recept saknar ingredienser');
  }
});
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button]')) { e.preventDefault(); e.target.click(); } });
document.addEventListener('change', e => {
  const t = e.target.dataset.todo, s = e.target.dataset.shop; if (!t && !s) return;
  const done = e.target.checked, tbl = t ? 'todos' : 'shopping_items', id = t || s;
  const row = e.target.closest('.row-item'); row?.classList.toggle('done', done); if (done) row?.classList.add('pop');
  const rec = (S.data[tbl] || []).find(x => x.id === id); if (rec) rec.done = done; // optimistiskt, så att en omritning inte visar gammalt läge
  setTimeout(async () => { try { await store.update(tbl, id, { done }); } catch (err) { toast('Kunde inte spara: ' + friendly(err), true); refresh(); } }, reduceMotion ? 0 : 450);
});
document.addEventListener('submit', async e => {
  const f = e.target.dataset.form; if (!f) return; e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); const title = (v.title || '').trim(); if (!title) return;
  const b = $('.primary', e.target); b.disabled = true;
  try {
    if (f === 'todo') await store.add('todos', { title, person: v.person || 'gemensamt', done: false });
    if (f === 'shop') await store.add('shopping_items', { title, done: false, person: 'gemensamt' });
    toast(f === 'todo' ? 'Uppgiften lades till ✓' : 'Varan lades till ✓');
  } catch (err) { toast('Kunde inte spara: ' + friendly(err), true); }
  setTimeout(() => { const i = $(`[data-form=${f}] input[name=title]`); if (i && !isPhone()) i.focus(); const bb = $(`[data-form=${f}] .primary`); if (bb) bb.disabled = false; }, 200);
});
// Ett separat handtag låter touchanvändare dra utan att blockera vanlig sidrullning.
let touchDrag = null, suppressDragClick = 0;
document.addEventListener('pointerdown', e => {
  const h = e.target.closest?.('[data-touch-drag]'); if (!h || e.button !== 0) return;
  e.preventDefault(); h.setPointerCapture(e.pointerId);
  const r = recipe(h.dataset.touchDrag); if (!r) return;
  const ghost = document.createElement('div'); ghost.className = 'meal-drag-ghost'; ghost.textContent = r.title; document.body.append(ghost);
  touchDrag = {id:r.id,pointer:e.pointerId,ghost,handle:h,target:null,x:e.clientX,y:e.clientY}; moveTouchDrag(e); requestAnimationFrame(autoScrollMeal);
});
function moveTouchDrag(e) {
  if (!touchDrag || e.pointerId !== touchDrag.pointer) return;
  const d = touchDrag; d.x=e.clientX; d.y=e.clientY; d.ghost.style.transform = `translate(${Math.min(innerWidth-190,Math.max(8,e.clientX+14))}px,${Math.max(8,e.clientY-44)}px)`;
  document.querySelectorAll('[data-drop].over').forEach(x=>x.classList.remove('over'));
  d.target = document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-drop]'); d.target?.classList.add('over');

}
function autoScrollMeal() {
  const d = touchDrag; if (!d) return; const main = $('#main'), bounds=main.getBoundingClientRect();
  const delta = d.y < bounds.top+65 ? -7 : d.y > bounds.bottom-65 ? 7 : 0;
  if(delta) { main.scrollTop += delta; moveTouchDrag({pointerId:d.pointer,clientX:d.x,clientY:d.y}); }
  requestAnimationFrame(autoScrollMeal);
}
document.addEventListener('pointermove', e => { if(touchDrag) { e.preventDefault(); moveTouchDrag(e); } },{passive:false});
async function endTouchDrag(e) {
  const d = touchDrag; if (!d || e.pointerId !== d.pointer) return;
  touchDrag=null; suppressDragClick=Date.now()+600; d.ghost.remove(); d.target?.classList.remove('over');
  if(e.type === 'pointerup' && d.target) { try { await setMeal(d.target.dataset.drop,d.id); toast('Middag vald ✓'); } catch(err) { toast('Kunde inte spara: '+friendly(err),true); } }
}
document.addEventListener('pointerup',endTouchDrag); document.addEventListener('pointercancel',endTouchDrag);
document.addEventListener('dragstart', e => { if(touchDrag) {e.preventDefault();return;} const d = e.target.closest?.('[data-drag]'); if (d) e.dataTransfer.setData('text/plain', d.dataset.drag); });
document.addEventListener('dragover', e => { const z = e.target.closest?.('[data-drop]'); if (z) { e.preventDefault(); z.classList.add('over'); } });
document.addEventListener('dragleave', e => e.target.closest?.('[data-drop]')?.classList.remove('over'));
document.addEventListener('drop', async e => { const z = e.target.closest?.('[data-drop]'); if (z) { e.preventDefault(); z.classList.remove('over'); try { await setMeal(z.dataset.drop, e.dataTransfer.getData('text/plain')); toast('Middag vald ✓'); } catch (err) { toast('Kunde inte spara: ' + friendly(err), true); } } });
addEventListener('unhandledrejection', e => { console.warn(e.reason); try { toast('Något gick fel: ' + friendly(e.reason), true); } catch {} });
addEventListener('error', e => {
  console.warn('error', e.error || e.message);
  try {
    const msg = friendly(e.error || e.message || 'Okänt fel');
    if (msg && !/Script error|ResizeObserver/i.test(String(msg))) toast('Något gick fel: ' + msg, true);
  } catch {}
});
let toastTimer;
function toast(m, bad = false, action = null) {
  document.querySelectorAll('.toast').forEach(x => x.remove()); clearTimeout(toastTimer);
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.setAttribute('role', bad ? 'alert' : 'status');
  const sp = document.createElement('span'); sp.textContent = m; t.append(sp);
  if (action) { const b = document.createElement('button'); b.textContent = action.label; b.onclick = async () => { t.remove(); try { await action.fn(); toast('Återställt ✓'); } catch (err) { toast('Kunde inte ångra: ' + friendly(err), true); } }; t.append(b); }
  document.body.append(t); if (t.showPopover) { t.popover = 'manual'; try { t.showPopover(); } catch {} } const ms = action ? 6000 : bad ? 4500 : 2400;
  toastTimer = setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, ms);
}

// ---------- start / inloggning
async function boot() {
  if (store.getSession && !(await store.getSession())) return loginScreen();
  shell(); render(); refresh(); wxRefresh(true); transitRefresh(); resetIdle();
}
function loginScreen(msg = '') {
  clearInterval(tickTimer); wakeLock?.release().catch(() => {});
  $('#app').innerHTML = `<div class="login"><form class="login-card" id="lf">${logo()}<h1>Familjeskärmen</h1>
    <p class="muted">Logga in med hushållets konto</p>${field('E-post', '<input name="email" type="email" autocomplete="username" inputmode="email" required>')}
    ${field('Lösenord', '<input name="password" type="password" autocomplete="current-password" required>')}
    <button class="primary big">Logga in</button><p class="err" role="alert">${esc(msg)}</p></form></div>`;
  $('#lf').onsubmit = async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); const b = $('#lf .primary'); b.disabled = true; b.textContent = 'Loggar in…';
    try { await store.signIn(v.email.trim(), v.password); boot(); } catch (err) { loginScreen(/invalid/i.test(err.message) ? 'Fel e-post eller lösenord' : !navigator.onLine ? 'Ingen internetanslutning' : 'Kunde inte logga in: ' + err.message); } };
}
boot();

// ---------- service worker: hämta ny version automatiskt (laddar om när ingen dialog är öppen)
let pendingReload = false;
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!had || pendingReload) return; if ($('#dlg')?.open || document.activeElement?.matches?.('input,textarea')) pendingReload = true; else location.reload(); });
  navigator.serviceWorker.register('/sw.js').then(reg => {
    setInterval(() => reg.update().catch(() => {}), 30 * 60e3);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (pendingReload && !$('#dlg')?.open) return location.reload();
      reg.update().catch(() => {});
    });
  }).catch(e => console.warn('SW', e));
}
