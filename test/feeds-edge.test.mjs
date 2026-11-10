// Kantfall i ICS-tolkningen: flyttade förekomster, långa serier, sommartid, midnatt, tidszoner och trasiga händelser.
// Kör: node test/feeds-edge.test.mjs
import assert from 'node:assert/strict';
import { parseIcs, expand } from '../src/feeds.js';

const TZB = `BEGIN:VTIMEZONE
TZID:Europe/Stockholm
BEGIN:STANDARD
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
END:DAYLIGHT
END:VTIMEZONE`;
const cal = body => `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//t//EN\n${TZB}\n${body}\nEND:VCALENDAR`;
const ev = lines => `BEGIN:VEVENT\n${lines.join('\n')}\nEND:VEVENT`;
const feed = { id: 'x', name: 'T', person: 'sambo', url: 'https://p1.icloud.com/x' };
const fmt = e => `${e.date} ${e.start}-${e.end} ${e.title}${e.span ? ' [' + e.span + ']' : ''}${e.range ? ' ' + e.range.join('..') : ''}`;
// Veckan byggs som i appen: måndag 00:00 i enhetens lokala tid
const week = (y, m, d, ics) => expand(parseIcs(cal(ics)), new Date(y, m - 1, d), new Date(y, m - 1, d + 7), feed).map(fmt).sort();
const SE = 'TZID=Europe/Stockholm';
let n = 0; const test = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

test('förekomst flyttad bakåt över en veckogräns visas i den nya veckan', () => {
  assert.deepEqual(week(2026, 11, 2, [
    ev(['UID:a', 'SUMMARY:Pass', `DTSTART;${SE}:20261005T180000`, `DTEND;${SE}:20261005T190000`, 'RRULE:FREQ=WEEKLY;BYDAY=MO']),
    ev(['UID:a', `RECURRENCE-ID;${SE}:20261109T180000`, 'SUMMARY:Pass flyttat', `DTSTART;${SE}:20261106T100000`, `DTEND;${SE}:20261106T110000`]),
  ].join('\n')), ['2026-11-02 18:00-19:00 Pass', '2026-11-06 10:00-11:00 Pass flyttat']);
});

test('daglig serie med fler än 5000 förekomster finns kvar', () => {
  const r = week(2026, 11, 2, ev(['UID:c', 'SUMMARY:Medicin', `DTSTART;${SE}:20100101T080000`, `DTEND;${SE}:20100101T081500`, 'RRULE:FREQ=DAILY']));
  assert.equal(r.length, 7); assert.equal(r[0], '2026-11-02 08:00-08:15 Medicin');
});

test('heldag på sommartidsdagen och vintertidsdagen hamnar på rätt dag utan omvänt intervall', () => {
  assert.deepEqual(week(2026, 3, 23, ev(['UID:b', 'SUMMARY:Heldag', 'DTSTART;VALUE=DATE:20260329', 'DTEND;VALUE=DATE:20260330'])), ['2026-03-29 - Heldag']);
  assert.deepEqual(week(2026, 10, 19, ev(['UID:b', 'SUMMARY:Heldag', 'DTSTART;VALUE=DATE:20261025', 'DTEND;VALUE=DATE:20261026'])), ['2026-10-25 - Heldag']);
});

test('flerdagars heldag, heldag utan DTEND och årlig heldag', () => {
  assert.deepEqual(week(2026, 11, 2, [
    ev(['UID:k', 'SUMMARY:Resa', 'DTSTART;VALUE=DATE:20261106', 'DTEND;VALUE=DATE:20261108']),
    ev(['UID:l', 'SUMMARY:Födelsedag', 'DTSTART;VALUE=DATE:19851104', 'RRULE:FREQ=YEARLY']),
    ev(['UID:m', 'SUMMARY:Utan DTEND', 'DTSTART;VALUE=DATE:20261105']),
  ].join('\n')), ['2026-11-04 - Födelsedag', '2026-11-05 - Utan DTEND', '2026-11-06 - Resa 2026-11-06..2026-11-07', '2026-11-07 - Resa 2026-11-06..2026-11-07']);
});

test('händelser över midnatt delas per dag, slut exakt vid midnatt stannar på startdagen', () => {
  assert.deepEqual(week(2026, 11, 2, [
    ev(['UID:d', 'SUMMARY:Nattpass', `DTSTART;${SE}:20261103T210000`, `DTEND;${SE}:20261104T070000`]),
    ev(['UID:e', 'SUMMARY:Slut midnatt', `DTSTART;${SE}:20261105T200000`, `DTEND;${SE}:20261106T000000`]),
    ev(['UID:f', 'SUMMARY:Sön-mån', `DTSTART;${SE}:20261108T220000`, `DTEND;${SE}:20261109T060000`]),
  ].join('\n')), [
    '2026-11-03 21:00- Nattpass [first] 2026-11-03..2026-11-04',
    '2026-11-04 00:00-07:00 Nattpass [last] 2026-11-03..2026-11-04',
    '2026-11-05 20:00-00:00 Slut midnatt',
    '2026-11-08 22:00- Sön-mån [first] 2026-11-08..2026-11-09',
  ]);
});

test('veckoserie behåller klockslaget över vintertidsskiftet', () => {
  const yoga = ev(['UID:h', 'SUMMARY:Yoga', `DTSTART;${SE}:20260907T180000`, `DTEND;${SE}:20260907T190000`, 'RRULE:FREQ=WEEKLY']);
  assert.deepEqual(week(2026, 10, 19, yoga), ['2026-10-19 18:00-19:00 Yoga']);
  assert.deepEqual(week(2026, 10, 26, yoga), ['2026-10-26 18:00-19:00 Yoga']);
});

test('TZID utan VTIMEZONE: IANA-zon räknas om, okänt zonnamn och flytande tid tolkas som svensk tid', () => {
  assert.deepEqual(week(2026, 11, 2, [
    ev(['UID:i', 'SUMMARY:New York', 'DTSTART;TZID=America/New_York:20261104T090000', 'DTEND;TZID=America/New_York:20261104T100000']),
    ev(['UID:j', 'SUMMARY:Flytande', 'DTSTART:20261104T090000', 'DTEND:20261104T100000']),
    ev(['UID:w', 'SUMMARY:Windows-zon', 'DTSTART;TZID=W. Europe Standard Time:20261104T120000', 'DTEND;TZID=W. Europe Standard Time:20261104T130000']),
    ev(['UID:u', 'SUMMARY:UTC', 'DTSTART:20261105T120000Z', 'DTEND:20261105T130000Z']),
  ].join('\n')), ['2026-11-04 09:00-10:00 Flytande', '2026-11-04 12:00-13:00 Windows-zon', '2026-11-04 15:00-16:00 New York', '2026-11-05 13:00-14:00 UTC']);
});

test('en ogiltig händelse hoppas över utan att resten av kalendern försvinner', () => {
  const warn = console.warn; console.warn = () => {};
  try {
    assert.deepEqual(week(2026, 11, 2, [
      ev(['UID:q', 'SUMMARY:Trasig', 'DTSTART:20261104T090000Z', 'RRULE:FREQ=WEEKLY;BYDAY=XX']),
      ev(['UID:ok', 'SUMMARY:Bra', 'DTSTART:20261104T100000Z', 'DTEND:20261104T110000Z']),
    ].join('\n')), ['2026-11-04 11:00-12:00 Bra']);
  } finally { console.warn = warn; }
});

test('tomt, avklippt eller icke-ICS-innehåll kastar fel (anroparen behåller då senaste lyckade kopia)', () => {
  for (const t of ['', '<html>hej</html>', 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:z\nSUMMARY:x\nDTSTART:2026110']) assert.throws(() => parseIcs(t));
  assert.deepEqual(expand(parseIcs('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR'), new Date(2026, 10, 2), new Date(2026, 10, 9), feed), []);
});

test('resultatet är detsamma oavsett enhetens tidszon', () => {
  const ics = [
    ev(['UID:k', 'SUMMARY:Resa', 'DTSTART;VALUE=DATE:20261106', 'DTEND;VALUE=DATE:20261108']),
    ev(['UID:s', 'SUMMARY:Söndag kväll', `DTSTART;${SE}:20261108T200000`, `DTEND;${SE}:20261108T210000`]),
    ev(['UID:m', 'SUMMARY:Måndag morgon', `DTSTART;${SE}:20261102T060000`, `DTEND;${SE}:20261102T070000`]),
    ev(['UID:j', 'SUMMARY:Flytande', 'DTSTART:20261104T090000', 'DTEND:20261104T100000']),
  ].join('\n');
  const want = ['2026-11-02 06:00-07:00 Måndag morgon', '2026-11-04 09:00-10:00 Flytande', '2026-11-06 - Resa 2026-11-06..2026-11-07', '2026-11-07 - Resa 2026-11-06..2026-11-07', '2026-11-08 20:00-21:00 Söndag kväll'];
  const before = process.env.TZ;
  try { for (const z of ['Europe/Stockholm', 'Europe/Helsinki', 'Asia/Bangkok', 'America/New_York', 'Pacific/Auckland']) { process.env.TZ = z; assert.deepEqual(week(2026, 11, 2, ics), want, 'tidszon ' + z); } }
  finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
});

console.log(`PASS: ${n} tester`);
