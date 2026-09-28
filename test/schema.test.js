import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan, colorId, buildRRule, BadPlan, fmtLocal } from '../src/lib/schema.js';

test('parsePlan: weekly repeat with 화/목 byday and until → RRULE', () => {
  const { calendar, events } = parsePlan({
    calendar: '내 캘린더',
    events: [{ title: '수업', start: '2026-09-22T10:30', duration_min: 75,
      repeat: { freq: 'weekly', byday: ['화', '목'], until: '2026-12-18' } }],
  });
  assert.equal(calendar, '내 캘린더');
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.allDay, false);
  assert.equal(fmtLocal(e.start), '20260922T103000');
  assert.equal(fmtLocal(e.end), '20260922T114500');
  assert.equal(e.rrule, 'FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261218T145959Z');
});

test('parsePlan: date-only start → all-day, end = next day', () => {
  const { events: [e] } = parsePlan({ events: [{ title: '추석', start: '2026-09-25' }] });
  assert.equal(e.allDay, true);
  assert.equal(fmtLocal(e.start, e.allDay), '20260925');
  assert.equal(fmtLocal(e.end, e.allDay), '20260926');
});

test('parsePlan: default duration 60 min', () => {
  const { events: [e] } = parsePlan({ events: [{ title: 'x', start: '2026-10-01T10:00' }] });
  assert.equal(fmtLocal(e.end), '20261001T110000');
});

test('parsePlan: end before start → BadPlan', () => {
  assert.throws(() => parsePlan({ events: [{ title: 'x', start: '2026-10-01T10:00', end: '2026-10-01T09:00' }] }),
    (err) => err instanceof BadPlan && /종료가 시작보다/.test(err.message));
});

test('parsePlan: missing title → BadPlan', () => {
  assert.throws(() => parsePlan({ events: [{ start: '2026-10-01T10:00' }] }),
    (err) => err instanceof BadPlan && /title 필수/.test(err.message));
});

test('parsePlan: missing start → BadPlan', () => {
  assert.throws(() => parsePlan({ events: [{ title: 'x' }] }),
    (err) => err instanceof BadPlan && /start 필수/.test(err.message));
});

test('parsePlan: missing events array → BadPlan', () => {
  assert.throws(() => parsePlan({}), BadPlan);
  assert.throws(() => parsePlan(null), BadPlan);
});

test('parsePlan: bad date string → BadPlan', () => {
  assert.throws(() => parsePlan({ events: [{ title: 'x', start: '2026/10/01' }] }),
    (err) => err instanceof BadPlan && /날짜 형식/.test(err.message));
  assert.throws(() => parsePlan({ events: [{ title: 'x', start: '2026-13-01' }] }), BadPlan);
});

test('parsePlan: passes through color/sticker/alarm/location/description/_note', () => {
  const { events: [e] } = parsePlan({ events: [{ title: 'x', start: '2026-10-01T10:00',
    color: '파랑', sticker: 501, alarm_min: 10, location: '306', description: 'd', _note: '애매함' }] });
  assert.equal(e.color, 22);
  assert.equal(e.sticker, 501);
  assert.equal(e.alarmMin, 10);
  assert.equal(e.location, '306');
  assert.equal(e.description, 'd');
  assert.equal(e.note, '애매함');
  assert.match(e.uid, /@caiendar$/);
});

test('parsePlan: rrule string accepted as-is (RRULE: prefix stripped)', () => {
  const { events: [e] } = parsePlan({ events: [{ title: 'x', start: '2026-10-01T10:00',
    rrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261218T145959Z' }] });
  assert.equal(e.rrule, 'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261218T145959Z');
});

test('buildRRule: interval, count, english byday', () => {
  assert.equal(buildRRule({ freq: 'weekly', interval: 2, byday: ['MO', 'wed'], count: 8 }),
    'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=8');
  assert.equal(buildRRule({ freq: 'daily' }), 'FREQ=DAILY');
});

test('buildRRule: invalid freq / byday → BadPlan', () => {
  assert.throws(() => buildRRule({ freq: 'hourly' }), (e) => e instanceof BadPlan && /repeat\.freq/.test(e.message));
  assert.throws(() => buildRRule({ freq: 'weekly', byday: ['화', '무'] }), (e) => e instanceof BadPlan && /repeat\.byday/.test(e.message));
});

test('buildRRule: until with time is converted KST → UTC', () => {
  assert.equal(buildRRule({ freq: 'weekly', until: '2026-12-18T09:00' }), 'FREQ=WEEKLY;UNTIL=20261218T000000Z');
});

test('colorId: number, name, name+step, english', () => {
  assert.equal(colorId(12), 12);
  assert.equal(colorId('12'), 12);
  assert.equal(colorId('파랑'), 22);
  assert.equal(colorId('파랑3'), 23);
  assert.equal(colorId('green'), 17);
  assert.equal(colorId(' Blue 1 '), 21);
});

test('colorId: out of range / unknown → BadPlan', () => {
  for (const bad of [0, 36, '무지개', '파랑9', '파랑0']) {
    assert.throws(() => colorId(bad), BadPlan, `should reject ${bad}`);
  }
});
