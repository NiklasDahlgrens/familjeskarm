// EXEMPELDATA – visas första gången appen öppnas. Rensa via Inställningar.
import { uid } from './local.js';
const iso = d => d.toLocaleDateString('sv-SE');
export function mondayOf(d) { const x = new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
export function seedData() {
  const m = mondayOf(new Date()); const day = n => { const d = new Date(m); d.setDate(d.getDate() + n); return iso(d); };
  const today = (new Date().getDay() + 6) % 7;
  const ex = { example: true };
  const R = [
    { title: 'Köttbullar med potatismos', image: 'https://images.unsplash.com/photo-1529042410759-befb1204b468?w=600', ingredients: ['500 g blandfärs', '1 ägg', '1 dl ströbröd', '1 kg potatis', '2 dl mjölk', 'Lingonsylt'], steps: ['Blanda färs, ägg och ströbröd.', 'Rulla bullar och stek.', 'Koka potatis och mosa med mjölk och smör.'] },
    { title: 'Laxpasta med citron', image: '', ingredients: ['400 g pasta', '300 g varmrökt lax', '2 dl matlagningsgrädde', '1 citron', 'Färsk dill'], steps: ['Koka pastan.', 'Värm grädde, citronskal och lax.', 'Blanda och toppa med dill.'] },
    { title: 'Tacofredag', image: '', ingredients: ['500 g nötfärs', 'Tacokrydda', 'Tortillabröd', 'Tomat', 'Gurka', 'Riven ost', 'Gräddfil'], steps: ['Stek färsen med krydda.', 'Hacka grönsaker.', 'Duka upp och njut.'] },
    { title: 'Linssoppa', image: '', ingredients: ['3 dl röda linser', '1 gul lök', '2 morötter', '1 burk krossade tomater', '1 l grönsaksbuljong'], steps: ['Fräs lök och morot.', 'Tillsätt linser, tomat och buljong.', 'Koka 20 min och mixa.'] },
  ].map(r => ({ id: uid(), ...r, ...ex }));
  return {
    events: [
      { title: 'Tandläkare', date: day(today), start: '08:30', end: '09:15', person: 'niklas' },
      { title: 'Yoga', date: day(today), start: '17:30', end: '18:30', person: 'sambo' },
      { title: 'Middag hos mamma', date: day(today), start: '19:00', end: '21:00', person: 'gemensamt' },
      { title: 'Padel', date: day((today + 1) % 7), start: '18:00', end: '19:30', person: 'niklas' },
      { title: 'Frisör', date: day((today + 2) % 7), start: '12:00', end: '13:00', person: 'sambo' },
      { title: 'IKEA-tur', date: day(5), start: '10:00', end: '13:00', person: 'gemensamt' },
      { title: 'Fika med Anna', date: day(6), start: '15:00', end: '16:00', person: 'sambo' },
      { title: 'Städdag', date: day(6), start: '10:00', end: '12:00', person: 'gemensamt' },
    ].map(e => ({ id: uid(), ...e, ...ex })),
    todos: [
      { title: 'Boka bilbesiktning', person: 'niklas', done: false },
      { title: 'Köpa present till Emma', person: 'sambo', done: false },
      { title: 'Vattna blommorna', person: 'gemensamt', done: true },
      { title: 'Betala elräkningen', person: 'gemensamt', done: false },
      { title: 'Lämna paket på Ica', person: 'niklas', done: false },
    ].map(t => ({ id: uid(), ...t, ...ex })),
    recipes: R,
    meal_plan: [[today, 0], [(today + 1) % 7, 3], [4, 2], [(today + 2) % 7, 1]].map(([d, r]) => ({ id: uid(), date: day(d), recipe_id: R[r].id, ...ex })),
    shopping_items: [
      { title: 'Mjölk', done: false, person: 'gemensamt' }, { title: 'Kaffe', done: false, person: 'niklas' }, { title: 'Bananer', done: true, person: 'sambo' },
    ].map(s => ({ id: uid(), ...s, ...ex })),
  };
}
