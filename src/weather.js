// Väder för Mölndal från Open-Meteo (gratis, ingen nyckel, CORS öppet). Cachas i localStorage.
const LAT = 57.665, LON = 12.012, PLACE = 'Mölndal';
const URL_ = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}`
  + '&current=temperature_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_gusts_10m,precipitation'
  + '&hourly=temperature_2m,weather_code,precipitation_probability,precipitation,is_day'
  + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max'
  + '&wind_speed_unit=ms&timezone=Europe%2FStockholm&forecast_days=8';
const KEY = 'fs-wx:v2';
let wx = null; try { wx = JSON.parse(localStorage.getItem(KEY)); } catch {}
let lastTry = 0, inflight = null;
export const weather = () => (wx && Date.now() - wx.at < 6 * 3600e3 ? wx.d : null); // äldre än 6 h visas inte
export const weatherPlace = PLACE;
export async function loadWeather(force = false) {
  if (inflight) return inflight;
  if (!force && wx && Date.now() - wx.at < 10 * 60e3) return false;
  if (Date.now() - lastTry < 30e3) return false; lastTry = Date.now();
  inflight = (async () => {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
      const r = await fetch(URL_, { signal: ctl.signal, cache: 'no-store' }); clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json(); if (!d.current || !d.hourly || !d.daily) throw new Error('ofullständigt svar');
      wx = { at: Date.now(), d }; try { localStorage.setItem(KEY, JSON.stringify(wx)); } catch {}
      return true;
    } catch (e) { console.info('Väder kunde inte hämtas:', e.message); return false; }
    finally { inflight = null; }
  })();
  return inflight;
}

// ---- WMO-koder → svensk text + ikon
const T = { 0: 'Klart', 1: 'Mestadels klart', 2: 'Halvklart', 3: 'Mulet', 45: 'Dimma', 48: 'Dimma', 51: 'Lätt duggregn', 53: 'Duggregn', 55: 'Tätt duggregn', 56: 'Underkylt duggregn', 57: 'Underkylt duggregn',
  61: 'Lätt regn', 63: 'Regn', 65: 'Kraftigt regn', 66: 'Underkylt regn', 67: 'Underkylt regn', 71: 'Lätt snöfall', 73: 'Snöfall', 75: 'Kraftigt snöfall', 77: 'Kornsnö',
  80: 'Lätta regnskurar', 81: 'Regnskurar', 82: 'Kraftiga skurar', 85: 'Snöbyar', 86: 'Kraftiga snöbyar', 95: 'Åska', 96: 'Åska med hagel', 99: 'Åska med hagel' };
export const wxText = c => T[c] || '–';
const kind = c => c === 0 ? 'clear' : c <= 2 ? 'partly' : c === 3 ? 'cloud' : c <= 48 ? 'fog' : c <= 55 ? 'drizzle' : c <= 57 ? 'sleet' : c <= 65 ? 'rain' : c <= 67 ? 'sleet' : c <= 77 ? 'snow' : c <= 82 ? 'showers' : c <= 86 ? 'snow' : 'thunder';
const CL = 'M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2';
const g = (cls, d) => `<g class="${cls}">${d}</g>`;
const sun = g('wx-sun', '<circle cx="12" cy="12" r="4.2" class="wx-fill"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>');
const moon = g('wx-moon', '<path class="wx-fill" d="M20.5 13.6A8.5 8.5 0 1 1 10.4 3.5a6.6 6.6 0 0 0 10.1 10.1z"/>');
const smallSun = g('wx-sun', '<path d="M12 2v2M4.9 4.9l1.4 1.4M20 12h2M19.1 4.9l-1.4 1.4"/><path class="wx-fill" d="M15.9 12.6a4 4 0 0 0-5.9-4.1"/>');
const smallMoon = g('wx-moon', '<path class="wx-fill" d="M10.1 9A6 6 0 0 1 16 4a4 4 0 0 0 6 6 6 6 0 0 1-3 5.2"/>');
const smallCloud = g('wx-cloud', '<path class="wx-cfill" d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>');
const showerCloud = g('wx-cloud', '<path d="M3 20a5 5 0 1 1 8.9-4H13a3 3 0 0 1 2 5.2"/>');
const drops = n => g('wx-drop', n === 'drizzle' ? '<path d="M8 14v1M8 19v1M12 16v1M12 21v1M16 14v1M16 19v1"/>' : '<path d="M8 14v5M12 16v6M16 14v5"/>');
export function wxIcon(code, day = true, cls = '') {
  const k = kind(code); let b = '';
  if (k === 'clear') b = day ? sun : moon;
  else if (k === 'partly') b = (day ? smallSun : smallMoon) + smallCloud;
  else if (k === 'cloud') b = g('wx-cloud', '<path class="wx-cfill" d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z"/>');
  else if (k === 'fog') b = g('wx-cloud', `<path d="${CL}"/>`) + g('wx-fog', '<path d="M16 17H7M17 21H9"/>');
  else if (k === 'drizzle' || k === 'rain') b = g('wx-cloud', `<path d="${CL}"/>`) + drops(k);
  else if (k === 'showers') b = (day ? smallSun : smallMoon) + showerCloud + g('wx-drop', '<path d="M11 20v2M7 19v2"/>');
  else if (k === 'snow') b = g('wx-cloud', `<path d="${CL}"/>`) + g('wx-snow', '<path d="M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01"/>');
  else if (k === 'sleet') b = g('wx-cloud', `<path d="${CL}"/>`) + g('wx-drop', '<path d="M8 14v4M16 14v4"/>') + g('wx-snow', '<path d="M12 17h.01M12 21h.01M8 21h.01M16 21h.01"/>');
  else b = g('wx-cloud', '<path d="M6 16.3A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 .5 9"/>') + g('wx-bolt', '<path class="wx-fill" d="m13 12-3 5h4l-3 5"/>');
  return `<svg class="wxi ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${wxText(code)}">${b}</svg>`;
}
export const deg = v => (v == null || isNaN(v) ? '–' : (Math.round(v) < 0 ? '−' + Math.abs(Math.round(v)) : Math.round(v)) + '°');
export const num = (v, dec = 1) => String(Math.round(v * 10 ** dec) / 10 ** dec).replace('.', ',');
