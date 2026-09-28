import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePlan } from '../src/lib/schema.js';
import { toICS, esc, foldLine, unfold, parseCalendar, masterEvents } from '../src/lib/ical.js';

const one = (ev, opts) => toICS(parsePlan({ events: [ev] }).events[0], { now: new Date('2026-09-22T00:00:00Z'), ...opts });
const lines = (ics) => unfold(ics).split('\r\n');

test('toICS: timed event with weekly repeat → DTSTART TZID + RRULE', () => {
  const ics = one({ title: '수업', start: '2026-09-22T10:30', duration_min: 75,
    repeat: { freq: 'weekly', byday: ['화', '목'], until: '2026-12-18' } });
  const L = lines(ics);
  assert.ok(L.includes('DTSTART;TZID=Asia/Seoul:20260922T103000'), ics);
  assert.ok(L.includes('DTEND;TZID=Asia/Seoul:20260922T114500'), ics);
  assert.ok(L.includes('RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261218T145959Z'), ics);
  assert.ok(L.includes('SUMMARY:수업'));
  assert.ok(L.includes('DTSTAMP:20260922T000000Z'));
});

test('toICS: all-day event → VALUE=DATE, no VTIMEZONE', () => {
  const ics = one({ title: '추석', start: '2026-09-25' });
  const L = lines(ics);
  assert.ok(L.includes('DTSTART;VALUE=DATE:20260925'));
  assert.ok(L.includes('DTEND;VALUE=DATE:20260926'));
  assert.ok(!L.includes('BEGIN:VTIMEZONE'));
});

test('toICS: timed event includes VTIMEZONE Asia/Seoul before VEVENT', () => {
  const L = lines(one({ title: 'x', start: '2026-10-01T10:00' }));
  assert.ok(L.includes('BEGIN:VTIMEZONE') && L.includes('TZID:Asia/Seoul') && L.includes('TZOFFSETTO:+0900'));
  assert.ok(L.indexOf('END:VTIMEZONE') < L.indexOf('BEGIN:VEVENT'));
});

test('toICS: alarm_min 10 → VALARM TRIGGER:-PT10M', () => {
  const L = lines(one({ title: '스터디', start: '2026-10-01T19:00', end: '2026-10-01T21:00', alarm_min: 10 }));
  assert.ok(L.includes('BEGIN:VALARM') && L.includes('TRIGGER:-PT10M') && L.includes('ACTION:DISPLAY'));
});

test('toICS: no alarm → no VALARM', () => {
  assert.ok(!one({ title: 'x', start: '2026-10-01T10:00' }).includes('VALARM'));
});

test('toICS: color and sticker → X-NAVER-* fields', () => {
  const L = lines(one({ title: '색', start: '2026-10-01T10:00', color: 12, sticker: 501 }));
  assert.ok(L.includes('X-NAVER-CATEGORY-COLOR:12'));
  assert.ok(L.includes('X-NAVER-STICKER;X-WORKSMOBILE-POS=0:501'));
});

test('toICS: naverFields=false suppresses X-NAVER-* fields', () => {
  const ics = one({ title: '색', start: '2026-10-01T10:00', color: 12, sticker: 501 }, { naverFields: false });
  assert.ok(!ics.includes('X-NAVER-'));
});

test('toICS: location and description escaped', () => {
  const L = lines(one({ title: 'a,b;c\\d\ne', start: '2026-10-01T10:00', location: 'x, y', description: 'l1\nl2' }));
  assert.ok(L.includes('SUMMARY:a\\,b\\;c\\\\d\\ne'), L.join('|'));
  assert.ok(L.includes('LOCATION:x\\, y'));
  assert.ok(L.includes('DESCRIPTION:l1\\nl2'));
});

test('toICS: uses CRLF line endings only, ends with CRLF', () => {
  const ics = one({ title: 'x', start: '2026-10-01T10:00' });
  assert.ok(!/(^|[^\r])\n/.test(ics), 'bare LF found');
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

test('toICS: never emits X-NAVER-REGISTERER / LAST-MODIFIER', () => {
  const ics = one({ title: 'x', start: '2026-10-01T10:00', color: 1 });
  assert.ok(!ics.includes('X-NAVER-REGISTERER') && !ics.includes('X-NAVER-LAST-MODIFIER'));
});

test('esc: backslash, semicolon, comma, newline', () => {
  assert.equal(esc('a\\b;c,d\ne'), 'a\\\\b\\;c\\,d\\ne');
  assert.equal(esc(123), '123');
});

test('foldLine: long Korean title folds at UTF-8 byte boundary, ≤75 octets per line', () => {
  const title = '아주아주긴한글제목'.repeat(8); // 72 chars × 3 bytes
  const folded = foldLine('SUMMARY:' + title);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1);
  for (const [i, p] of parts.entries()) {
    assert.ok(Buffer.byteLength(p, 'utf8') <= 75, `line ${i} is ${Buffer.byteLength(p)} bytes`);
    if (i > 0) assert.ok(p.startsWith(' '), 'continuation must start with space');
    assert.ok(!p.includes('�'));
    assert.equal(Buffer.from(p, 'utf8').toString('utf8'), p);
  }
  assert.equal(unfold(folded), 'SUMMARY:' + title);
});

test('foldLine: short line untouched', () => {
  assert.equal(foldLine('SUMMARY:짧음'), 'SUMMARY:짧음');
});

test('toICS: long title survives fold/unfold roundtrip', () => {
  const title = '컴퓨터구조와운영체제및네트워크종합설계실습'.repeat(3);
  const ics = one({ title, start: '2026-10-01T10:00' });
  for (const l of ics.split('\r\n')) assert.ok(Buffer.byteLength(l, 'utf8') <= 75, l);
  assert.ok(lines(ics).includes('SUMMARY:' + title));
});

// ---------- parser against real Naver output ----------
const sample = readFileSync(new URL('./fixtures/naver_event_sample.ics', import.meta.url), 'utf8');
const blocks = sample.split(/\n(?=BEGIN:VCALENDAR)/).filter((b) => b.includes('BEGIN:VCALENDAR'));
const stripComments = (s) => s.split('\n').filter((l) => !l.startsWith('#')).join('\r\n');
const cal1 = stripComments(blocks[0]);
const cal2 = stripComments(blocks[1]);

test('parseCalendar: Naver all-day sample — X-NAVER-* props do not break parsing', () => {
  const cal = parseCalendar(cal1);
  assert.equal(cal.vevents.length, 1);
  const ev = cal.vevents[0];
  assert.equal(ev.summary, 'someone 생일');
  assert.equal(ev.uid, '82473eea...@naver.com_caldavApp');
  assert.equal(ev.dtstart.value, '20190515');
  assert.equal(ev.dtstart.params.VALUE, 'DATE');
  assert.equal(ev.props['X-NAVER-CATEGORY-COLOR'][0].value, '7');
  assert.equal(ev.props['X-NAVER-STICKER'][0].value, '506');
  assert.equal(ev.props['X-NAVER-STICKER'][0].params['X-WORKSMOBILE-POS'], '0');
  assert.equal(ev.props['X-NAVER-REGISTERER'][0].params['X-WORKSMOBILE-WID'], 'someid');
  assert.equal(ev.alarms.length, 2);
  assert.equal(ev.recurrenceId, null);
});

test('parseCalendar: Naver recurring sample — RECURRENCE-ID VEVENT is not a separate event', () => {
  const cal = parseCalendar(cal2);
  assert.equal(cal.vevents.length, 2, 'raw VEVENT count');
  const masters = masterEvents(cal);
  assert.equal(masters.length, 1);
  assert.equal(masters[0].summary, '주간 미팅');
  assert.equal(masters[0].dtstart.value, '20260926T190000');
  assert.equal(masters[0].dtstart.params.TZID, 'Asia/Seoul');
  assert.equal(masters[0].rrule, 'FREQ=WEEKLY;UNTIL=20261107T100000Z;INTERVAL=1;BYDAY=SA');
  const exc = cal.vevents.find((v) => v.recurrenceId);
  assert.equal(exc.recurrenceId.value, '20260926T190000');
  assert.equal(exc.uid, masters[0].uid);
});

test('parseCalendar: tolerates bare LF and folded lines', () => {
  const ics = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:u1\nSUMMARY:긴 제\n 목 이어짐\nDTSTART;VALUE=DATE:20260101\nEND:VEVENT\nEND:VCALENDAR\n';
  const cal = parseCalendar(ics);
  assert.equal(cal.vevents[0].summary, '긴 제목 이어짐');
});

test('parseCalendar: unescapes SUMMARY text', () => {
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:u\r\nSUMMARY:a\\,b\\;c\\\\d\\ne\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  assert.equal(parseCalendar(ics).vevents[0].summary, 'a,b;c\\d\ne');
});

test('parseCalendar: roundtrip of our own output', () => {
  const ics = one({ title: '왕복, 테스트', start: '2026-10-01T10:00', color: 22, sticker: 501, alarm_min: 5,
    repeat: { freq: 'weekly', byday: ['목'], count: 3 } });
  const [ev] = masterEvents(parseCalendar(ics));
  assert.equal(ev.summary, '왕복, 테스트');
  assert.equal(ev.dtstart.value, '20261001T100000');
  assert.equal(ev.rrule, 'FREQ=WEEKLY;BYDAY=TH;COUNT=3');
  assert.equal(ev.alarms.length, 1);
});

// ---------- 여러 일정 → ICS 파일 (CalDAV 없는 서비스의 '가져오기'용, naver_cal.py export 포팅) ----------
import { exportICS } from '../src/lib/ical.js';

test('exportICS: one VCALENDAR, VTIMEZONE once only when a timed event exists, all VEVENTs inside', () => {
  const { events } = parsePlan({ events: [
    { title: '수업', start: '2026-09-22T10:30', duration_min: 75 },
    { title: '추석', start: '2026-09-25' },
  ] });
  const ics = exportICS(events, { now: new Date('2026-09-22T00:00:00Z') });
  const L = lines(ics);
  assert.equal(L.filter((l) => l === 'BEGIN:VCALENDAR').length, 1);
  assert.equal(L.filter((l) => l === 'BEGIN:VTIMEZONE').length, 1);
  assert.equal(L.filter((l) => l === 'BEGIN:VEVENT').length, 2);
  assert.ok(L.indexOf('END:VTIMEZONE') < L.indexOf('BEGIN:VEVENT'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(masterEvents(parseCalendar(ics)).length, 2);
});

test('exportICS: all-day only → no VTIMEZONE; naverFields off by default', () => {
  const { events } = parsePlan({ events: [{ title: '추석', start: '2026-09-25', color: 3 }] });
  const ics = exportICS(events);
  assert.ok(!ics.includes('VTIMEZONE'));
  assert.ok(!ics.includes('X-NAVER'));
});
