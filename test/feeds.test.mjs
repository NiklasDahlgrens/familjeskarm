import fs from 'fs'; import { parseIcs, expand } from '../src/feeds.js';
const ev = parseIcs(fs.readFileSync(new URL('./sample.ics', import.meta.url), 'utf8'));
const out = expand(ev, new Date('2026-11-02T00:00:00+01:00'), new Date('2026-11-09T00:00:00+01:00'), { id: 'x', name: 'Test', person: 'sambo' });
const got = out.map(e => `${e.date} ${e.start}-${e.end} ${e.title}`).sort();
console.log(got.join('\n'));
const want = ['2026-11-02 20:00-21:00 Simträning (flyttad)', '2026-11-05 13:00-14:00 Möte UTC', '2026-11-06 - Farmors födelsedag', '2026-11-07 - Farmors födelsedag'];
const ok = JSON.stringify(got) === JSON.stringify(want.sort()); console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
