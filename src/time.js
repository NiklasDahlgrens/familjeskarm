// Datum- och tidshjälpare. Appen räknar alltid i svensk tid, oavsett enhetens tidszon.
// Formaterarna skapas en gång: toLocale*String med alternativ bygger annars en ny Intl-instans per anrop.
export const TZ = 'Europe/Stockholm';
const fDate = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ });
const fTime = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
export const pad2 = n => String(n).padStart(2, '0');
export const dstr = d => fDate.format(d); // ÅÅÅÅ-MM-DD i svensk tid
export const tstr = d => fTime.format(d); // HH:MM i svensk tid
export const todayIso = () => dstr(new Date());
export const nowHM = () => tstr(new Date());
// Ren datumaritmetik på ÅÅÅÅ-MM-DD (mitt på dagen, så att sommartid aldrig flyttar datumet)
export const iso = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const addDays = (ds, n) => { const d = new Date(ds + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); };
export function mondayOf(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
// Måndagen i den svenska veckan just nu, även om enheten står i en annan tidszon
export const thisMonday = () => mondayOf(new Date(todayIso() + 'T12:00'));
