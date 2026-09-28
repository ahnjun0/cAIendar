import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerEvents, dayRangeUtc, isDuplicate } from '../src/lib/register.js';
import { parsePlan } from '../src/lib/schema.js';
import { parseCalendar } from '../src/lib/ical.js';

const EXISTING = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:old\r\nSUMMARY:수업\r\nDTSTART;TZID=Asia/Seoul:20260922T103000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
const EXISTING_ALLDAY = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:old2\r\nSUMMARY:추석\r\nDTSTART;VALUE=DATE:20260925\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';

function fakeClient({ existing = [], unreadable = [], failPutFor = [] } = {}) {
  const puts = [];
  return {
    puts,
    isNaver: true,
    async queryEvents() { return { events: existing.map((ics, i) => ({ href: `h${i}`, ics })), unreadable }; },
    async putEvent(calUrl, uid, ics) {
      if (failPutFor.some((t) => ics.includes(`SUMMARY:${t}`))) throw new Error('HTTP 500');
      puts.push({ calUrl, uid, ics });
      return { href: `${calUrl}${uid}.ics`, etag: '"x"' };
    },
  };
}

test('dayRangeUtc: KST day → UTC range (start-of-day KST = 15:00Z previous day)', () => {
  const { events: [e] } = parsePlan({ events: [{ title: 'x', start: '2026-09-22T10:30' }] });
  assert.deepEqual(dayRangeUtc(e.start), { start: '20260921T150000Z', end: '20260922T150000Z' });
});

test('isDuplicate: same title + same start date (timed and all-day), RECURRENCE-ID ignored', () => {
  const { events: [e] } = parsePlan({ events: [{ title: '수업', start: '2026-09-22T10:30' }] });
  assert.equal(isDuplicate(e, parseCalendar(EXISTING)), true);
  assert.equal(isDuplicate({ ...e, title: '수업2' }, parseCalendar(EXISTING)), false);
  const { events: [h] } = parsePlan({ events: [{ title: '추석', start: '2026-09-25' }] });
  assert.equal(isDuplicate(h, parseCalendar(EXISTING_ALLDAY)), true);
  const exc = EXISTING.replace('UID:old', 'UID:old\r\nRECURRENCE-ID;TZID=Asia/Seoul:20260922T103000');
  assert.equal(isDuplicate(e, parseCalendar(exc)), false, 'exception instance alone is not a master event');
});

test('registerEvents: skips duplicates by default, PUTs the rest, returns batch', async () => {
  const c = fakeClient({ existing: [EXISTING] });
  const plan = { events: [
    { title: '수업', start: '2026-09-22T10:30' },
    { title: '스터디', start: '2026-09-22T19:00' },
  ] };
  const r = await registerEvents({ client: c, calendarUrl: 'https://x/cal/', calendarName: '내 캘린더', plan, now: new Date('2026-09-22T00:00:00Z') });
  assert.equal(r.added.length, 1);
  assert.equal(r.added[0].title, '스터디');
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].title, '수업');
  assert.equal(r.failed.length, 0);
  assert.equal(c.puts.length, 1);
  assert.match(c.puts[0].ics, /SUMMARY:스터디/);
  assert.equal(r.batch.calendarUrl, 'https://x/cal/');
  assert.equal(r.batch.events.length, 1);
  assert.equal(r.batch.events[0].type, 'event');
  assert.match(r.batch.events[0].summary, /스터디/); // 기록 화면에 그대로 보여 준다
  assert.equal(r.batch.events[0].href, `https://x/cal/${r.batch.events[0].uid}.ics`);
  assert.equal(r.unreadable, 0);
});

test('registerEvents: allowDuplicate=true registers anyway', async () => {
  const c = fakeClient({ existing: [EXISTING] });
  const r = await registerEvents({ client: c, calendarUrl: 'https://x/cal/', plan: { events: [{ title: '수업', start: '2026-09-22T10:30' }] }, allowDuplicate: true });
  assert.equal(r.added.length, 1);
  assert.equal(r.skipped.length, 0);
});

test('registerEvents: reports unreadable count instead of silently dropping', async () => {
  const c = fakeClient({ existing: [], unreadable: ['h9', 'h10'] });
  const r = await registerEvents({ client: c, calendarUrl: 'https://x/cal/', plan: { events: [{ title: '수업', start: '2026-09-22T10:30' }] } });
  assert.equal(r.unreadable, 2);
  assert.equal(r.added.length, 1);
});

test('registerEvents: a failing PUT is recorded in failed, others still proceed', async () => {
  const c = fakeClient({ failPutFor: ['B'] });
  const r = await registerEvents({ client: c, calendarUrl: 'https://x/cal/', plan: { events: [
    { title: 'A', start: '2026-09-22T10:00' }, { title: 'B', start: '2026-09-22T11:00' }, { title: 'C', start: '2026-09-22T12:00' },
  ] } });
  assert.deepEqual(r.added.map((e) => e.title), ['A', 'C']);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].title, 'B');
  assert.match(r.failed[0].error, /500/);
});

test('registerEvents: invalid plan → throws before any PUT', async () => {
  const c = fakeClient();
  await assert.rejects(registerEvents({ client: c, calendarUrl: 'https://x/cal/', plan: { events: [{ title: 'x' }] } }), /start 필수/);
  assert.equal(c.puts.length, 0);
});

test('registerEvents: non-naver server omits X-NAVER fields', async () => {
  const c = { ...fakeClient(), isNaver: false };
  const r = await registerEvents({ client: c, calendarUrl: 'https://x/cal/', plan: { events: [{ title: 'x', start: '2026-09-22T10:00', color: 22 }] } });
  assert.equal(r.added.length, 1);
  assert.ok(!c.puts[0].ics.includes('X-NAVER'));
});

// ---------- 겹침 검사 (카카오테크캠퍼스 week6 busy_rows_overlap 아이디어) ----------
import { overlapping, preflight } from '../src/lib/register.js';

const MEETING = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:m\r\nSUMMARY:주간 미팅\r\nDTSTART;TZID=Asia/Seoul:20260922T190000\r\nDTEND;TZID=Asia/Seoul:20260922T210000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
const RECUR = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:r\r\nSUMMARY:매주 스터디\r\nDTSTART;TZID=Asia/Seoul:20260901T200000\r\nDTEND;TZID=Asia/Seoul:20260901T220000\r\nRRULE:FREQ=WEEKLY;BYDAY=TU\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';

test('overlapping: timed events on the same day that intersect', () => {
  const { events: [e] } = parsePlan({ events: [{ title: '스터디', start: '2026-09-22T20:00', duration_min: 60 }] });
  assert.deepEqual(overlapping(e, parseCalendar(MEETING)).map((v) => v.summary), ['주간 미팅']);
  const { events: [later] } = parsePlan({ events: [{ title: 'x', start: '2026-09-22T21:00', duration_min: 60 }] });
  assert.deepEqual(overlapping(later, parseCalendar(MEETING)), [], 'touching end boundary is not an overlap');
});

test('overlapping: all-day events never count; recurring master matched by time of day', () => {
  const { events: [allday] } = parsePlan({ events: [{ title: 'x', start: '2026-09-22' }] });
  assert.deepEqual(overlapping(allday, parseCalendar(MEETING)), []);
  const { events: [e] } = parsePlan({ events: [{ title: 'x', start: '2026-09-22T21:30', duration_min: 30 }] });
  assert.deepEqual(overlapping(e, parseCalendar(RECUR)).map((v) => v.summary), ['매주 스터디']);
});

test('preflight: reports duplicate and overlaps per event without any PUT', async () => {
  const c = fakeClient({ existing: [EXISTING, MEETING], unreadable: ['h9'] });
  const r = await preflight({ client: c, calendarUrl: 'https://x/cal/', plan: { events: [
    { title: '수업', start: '2026-09-22T10:30' },
    { title: '저녁 약속', start: '2026-09-22T20:00', duration_min: 60 },
    { title: '아침', start: '2026-09-22T08:00', duration_min: 30 },
  ] } });
  assert.equal(c.puts.length, 0);
  assert.equal(r.unreadable, 1);
  assert.deepEqual(r.checks.map((x) => x.duplicate), [true, false, false]);
  assert.deepEqual(r.checks.map((x) => x.overlaps), [[], ['주간 미팅 19:00~21:00'], []]);
});

// ---------- 할 일 (VTODO) ----------
const EXISTING_TODO = 'BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:t1\r\nSUMMARY:DB 과제\r\nDUE;VALUE=DATE:20261007\r\nEND:VTODO\r\nEND:VCALENDAR\r\n';

function fakeTodoClient({ existing = [], unreadable = [] } = {}) {
  const c = fakeClient();
  return { ...c, async queryTodos() { return { todos: existing.map((ics, i) => ({ href: `t${i}`, ics })), unreadable }; } };
}

test('registerEvents: todos are PUT as VTODO to the task calendar', async () => {
  const c = fakeTodoClient();
  const r = await registerEvents({ client: c, calendarUrl: 'https://x/cal/', todoCalendarUrl: 'https://x/todo/',
    plan: { events: [{ title: '수업', start: '2026-10-01T10:00' }, { kind: 'todo', title: 'DB 과제', due: '2026-10-07', group: 3 }] } });
  assert.equal(r.added.length, 2);
  assert.equal(c.puts.length, 2);
  const todoPut = c.puts.find((p) => p.ics.includes('BEGIN:VTODO'));
  assert.equal(todoPut.calUrl, 'https://x/todo/');
  assert.match(todoPut.ics, /DUE;VALUE=DATE:20261007/);
  assert.match(todoPut.ics, /X-NAVER-TASK-GROUP-ID:3/);
  assert.equal(r.batch.events.find((e) => e.title === 'DB 과제').href, `https://x/todo/${r.batch.events.find((e) => e.title === 'DB 과제').uid}.ics`);
});

test('registerEvents: todos are registered without a duplicate query (account may hold hundreds)', async () => {
  const c = fakeTodoClient({ existing: [EXISTING_TODO] });
  let queried = false;
  c.queryTodos = async () => { queried = true; return { todos: [], unreadable: [] }; };
  const r = await registerEvents({ client: c, calendarUrl: 'https://x/cal/', todoCalendarUrl: 'https://x/todo/',
    plan: { events: [{ kind: 'todo', title: 'DB 과제', due: '2026-10-07' }, { kind: 'todo', title: 'DB 과제', due: '2026-10-08' }] } });
  assert.equal(queried, false, '할 일 조회를 하지 않아야 한다');
  assert.equal(r.skipped.length, 0);
  assert.equal(r.added.length, 2);
});

test('registerEvents: todos without a task calendar → failed with a clear reason, events still registered', async () => {
  const c = fakeTodoClient();
  const r = await registerEvents({ client: c, calendarUrl: 'https://x/cal/',
    plan: { events: [{ title: '수업', start: '2026-10-01T10:00' }, { kind: 'todo', title: 'DB 과제', due: '2026-10-07' }] } });
  assert.deepEqual(r.added.map((e) => e.title), ['수업']);
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0].error, /할 일 캘린더/);
});

test('preflight: todos are not checked and trigger no network call', async () => {
  const c = fakeTodoClient({ existing: [EXISTING_TODO] });
  c.queryTodos = async () => { throw new Error('할 일 조회를 하면 안 된다'); };
  const r = await preflight({ client: c, calendarUrl: 'https://x/cal/',
    plan: { events: [{ kind: 'todo', title: 'DB 과제', due: '2026-10-07' }] } });
  assert.deepEqual(r.checks, [{ duplicate: false, overlaps: [] }]);
  assert.equal(r.unreadable, 0);
});

test('registerEvents: batch keeps the registered plan so it can be edited later', async () => {
  const c = fakeClient();
  const plan = { calendar: '내 캘린더', events: [
    { title: '수업', start: '2026-10-01T10:00', description: 'cAIendar로 등록됨 (2026-09-26)' },
    { title: '건너뛸 것', start: '2026-10-01T12:00' },
  ] };
  const r = await registerEvents({ client: c, calendarUrl: 'https://x/cal/', plan });
  assert.deepEqual(r.batch.plan, plan, '표에 다시 불러올 수 있도록 등록한 그대로 보관');
});

test('registerEvents: batch.plan keeps only what was actually added', async () => {
  const c = fakeClient({ existing: [EXISTING] });
  const r = await registerEvents({ client: c, calendarUrl: 'https://x/cal/', plan: { events: [
    { title: '수업', start: '2026-09-22T10:30' },   // 중복 → 건너뜀
    { title: '스터디', start: '2026-09-22T19:00' },
  ] } });
  assert.deepEqual(r.batch.plan.events.map((e) => e.title), ['스터디']);
});

test('registerEvents: 한 건 등록할 때마다 진행 상황을 알려 준다 (중간에 중단돼도 되돌릴 수 있게)', async () => {
  const c = fakeClient();
  const seen = [];
  const r = await registerEvents({ client: c, calendarUrl: 'https://x/cal/', calendarName: '내 캘린더',
    plan: { events: [
      { title: 'A', start: '2026-10-01T10:00' },
      { title: 'B', start: '2026-10-02T10:00' },
      { kind: 'todo', title: 'C', due: '2026-10-03' },
    ] },
    todoCalendarUrl: 'https://x/todo/',
    onProgress: (b) => seen.push(JSON.parse(JSON.stringify(b))) });
  assert.equal(seen.length, 3, 'PUT 성공마다 한 번씩');
  assert.deepEqual(seen.map((b) => b.events.length), [1, 2, 3]);
  assert.equal(seen[0].id, r.batch.id, '같은 배치가 갱신된다');
  assert.deepEqual(seen.at(-1).events.map((e) => e.title), ['A', 'B', 'C']);
  assert.deepEqual(seen.at(-1).plan.events.map((e) => e.title), ['A', 'B', 'C']);
});

test('registerEvents: 중간에 실패해도 그 전까지 등록된 것은 진행 보고에 남는다', async () => {
  const c = fakeClient({ failPutFor: ['B'] });
  const seen = [];
  await registerEvents({ client: c, calendarUrl: 'https://x/cal/',
    plan: { events: [{ title: 'A', start: '2026-10-01T10:00' }, { title: 'B', start: '2026-10-02T10:00' }] },
    onProgress: (b) => seen.push(b.events.length) });
  assert.deepEqual(seen, [1]);
});
