import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan, BadPlan } from '../src/lib/schema.js';
import { toVTODO, parseCalendar, unfold } from '../src/lib/ical.js';

const lines = (ics) => unfold(ics).split('\r\n');
const one = (raw, opts) => toVTODO(parsePlan({ events: [raw] }).todos[0], { now: new Date('2026-09-26T00:00:00Z'), ...opts });

test('parsePlan: kind "todo" items go to todos, not events', () => {
  const { events, todos } = parsePlan({ events: [
    { kind: 'todo', title: 'DB 과제 제출', due: '2026-10-07' },
    { title: '수업', start: '2026-10-01T10:00' },
  ] });
  assert.equal(events.length, 1);
  assert.equal(todos.length, 1);
  assert.equal(todos[0].title, 'DB 과제 제출');
  assert.equal(todos[0].dueDateOnly, true);
  assert.match(todos[0].uid, /@caiendar$/);
  assert.equal(todos[0].priority, 0);
  assert.equal(todos[0].group, null);
  assert.equal(todos[0].done, false);
});

test('parsePlan: todo accepts start as an alias for due, and a timed due', () => {
  const { todos } = parsePlan({ events: [
    { kind: 'todo', title: 'a', start: '2026-10-07' },
    { kind: 'todo', title: 'b', due: '2026-10-07T23:59' },
  ] });
  assert.equal(todos[0].dueDateOnly, true);
  assert.equal(todos[1].dueDateOnly, false);
});

test('parsePlan: todo without title or due → BadPlan', () => {
  assert.throws(() => parsePlan({ events: [{ kind: 'todo', due: '2026-10-07' }] }), (e) => e instanceof BadPlan && /title 필수/.test(e.message));
  assert.throws(() => parsePlan({ events: [{ kind: 'todo', title: 'x' }] }), (e) => e instanceof BadPlan && /due 필수/.test(e.message));
});

test('parsePlan: todo priority/group/done/color validated', () => {
  const { todos: [t] } = parsePlan({ events: [{ kind: 'todo', title: 'x', due: '2026-10-07', priority: '높음', group: 3, done: true, color: '파랑' }] });
  assert.equal(t.priority, 1);
  assert.equal(t.group, 3);
  assert.equal(t.done, true);
  assert.equal(t.color, 22);
  assert.throws(() => parsePlan({ events: [{ kind: 'todo', title: 'x', due: '2026-10-07', priority: 99 }] }), BadPlan);
  assert.throws(() => parsePlan({ events: [{ kind: 'todo', title: 'x', due: '2026-10-07', group: 'x' }] }), BadPlan);
});

test('parsePlan: unknown kind → BadPlan; kind "event" behaves as before', () => {
  assert.throws(() => parsePlan({ events: [{ kind: 'reminder', title: 'x', start: '2026-10-07' }] }), (e) => e instanceof BadPlan && /kind/.test(e.message));
  const { events, todos } = parsePlan({ events: [{ kind: 'event', title: 'x', start: '2026-10-07' }] });
  assert.equal(events.length, 1);
  assert.equal(todos.length, 0);
});

test('toVTODO: date-only due → DUE;VALUE=DATE, no VTIMEZONE, NEEDS-ACTION', () => {
  const L = lines(one({ kind: 'todo', title: 'DB 과제 제출', due: '2026-10-07' }));
  assert.ok(L.includes('BEGIN:VTODO'));
  assert.ok(L.includes('DUE;VALUE=DATE:20261007'));
  assert.ok(L.includes('SUMMARY:DB 과제 제출'));
  assert.ok(L.includes('STATUS:NEEDS-ACTION'));
  assert.ok(L.includes('DTSTAMP:20260926T000000Z'));
  assert.ok(!L.includes('BEGIN:VTIMEZONE'));
  assert.ok(!L.some((l) => l.startsWith('DTSTART')), 'no DTSTART for a plain deadline');
});

test('toVTODO: timed due → TZID + VTIMEZONE', () => {
  const L = lines(one({ kind: 'todo', title: 'x', due: '2026-10-07T23:59' }));
  assert.ok(L.includes('DUE;TZID=Asia/Seoul:20261007T235900'));
  assert.ok(L.includes('BEGIN:VTIMEZONE'));
});

test('toVTODO: group / priority / color / description / done', () => {
  const L = lines(one({ kind: 'todo', title: 'x', due: '2026-10-07', group: 4, priority: 1, color: 23, description: '메모', done: true }));
  assert.ok(L.includes('X-NAVER-TASK-GROUP-ID:4'));
  assert.ok(L.includes('PRIORITY:1'));
  assert.ok(L.includes('X-NAVER-CATEGORY-COLOR:23'));
  assert.ok(L.includes('DESCRIPTION:메모'));
  assert.ok(L.includes('STATUS:COMPLETED'));
});

test('toVTODO: omits group/priority when unset, never sends server-filled fields', () => {
  const ics = one({ kind: 'todo', title: 'x', due: '2026-10-07' });
  assert.ok(!ics.includes('X-NAVER-TASK-GROUP-ID'));
  assert.ok(!ics.includes('PRIORITY'));
  assert.ok(!ics.includes('X-NAVER-REGISTERER') && !ics.includes('ORGANIZER') && !ics.includes('X-NAVER-LAST-MODIFIER'));
});

test('toVTODO: naverFields=false drops X-NAVER-*', () => {
  const ics = one({ kind: 'todo', title: 'x', due: '2026-10-07', group: 1, color: 3 }, { naverFields: false });
  assert.ok(!ics.includes('X-NAVER'));
});

// 실제 네이버 응답 원문 (check_tasks.mjs 로 덤프한 형태)
const NAVER_VTODO = ['BEGIN:VCALENDAR', 'PRODID:Naver Calendar', 'VERSION:2.0', 'CALSCALE:GREGORIAN',
  'BEGIN:VTIMEZONE', 'TZID:Asia/Seoul', 'BEGIN:STANDARD', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'DTSTART:19700101T000000', 'END:STANDARD', 'END:VTIMEZONE',
  'BEGIN:VTODO', 'X-NAVER-REGISTERER;CUTYPE=INDIVIDUAL;X-WORKSMOBILE-WID=tester:1790397771043',
  'X-NAVER-TASK-GROUP-ID;X-NAVER-TASK-GROUP-NAME="내 할 일":0',
  'UID:abc@naver.com_caldavApp', 'SUMMARY:[통계학] 중간고사 전 휴강', 'DUE;VALUE=DATE:20231023',
  'STATUS:COMPLETED', 'PRIORITY:1', 'X-NAVER-CATEGORY-COLOR:23', 'END:VTODO', 'END:VCALENDAR'].join('\r\n');

test('parseCalendar: VTODO is parsed into vtodos, separate from vevents', () => {
  const cal = parseCalendar(NAVER_VTODO);
  assert.equal(cal.vevents.length, 0);
  assert.equal(cal.vtodos.length, 1);
  const t = cal.vtodos[0];
  assert.equal(t.summary, '[통계학] 중간고사 전 휴강');
  assert.equal(t.due.value, '20231023');
  assert.equal(t.due.params.VALUE, 'DATE');
  assert.equal(t.status, 'COMPLETED');
  assert.equal(t.props['X-NAVER-TASK-GROUP-ID'][0].value, '0');
  assert.equal(t.props['X-NAVER-TASK-GROUP-ID'][0].params['X-NAVER-TASK-GROUP-NAME'], '내 할 일');
});

test('toVTODO output round-trips through parseCalendar', () => {
  const t = parseCalendar(one({ kind: 'todo', title: '왕복, 테스트', due: '2026-10-07', group: 2 })).vtodos[0];
  assert.equal(t.summary, '왕복, 테스트');
  assert.equal(t.due.value, '20261007');
  assert.equal(t.status, 'NEEDS-ACTION');
});

test('parsePlan: todo carrying event-only fields is rejected, not silently dropped', () => {
  for (const extra of [{ repeat: { freq: 'weekly' } }, { rrule: 'FREQ=WEEKLY' }, { end: '2026-10-07T12:00' }, { duration_min: 60 }, { alarm_min: 10 }, { all_day: true }]) {
    assert.throws(
      () => parsePlan({ events: [{ kind: 'todo', title: 'x', due: '2026-10-07', ...extra }] }),
      (e) => e instanceof BadPlan && /할 일에는 쓸 수 없는/.test(e.message),
      `should reject ${Object.keys(extra)[0]}`,
    );
  }
});

test('parsePlan: event carrying todo-only fields is rejected too', () => {
  assert.throws(() => parsePlan({ events: [{ title: 'x', start: '2026-10-07T10:00', due: '2026-10-08' }] }),
    (e) => e instanceof BadPlan && /일정에는 쓸 수 없는/.test(e.message));
  assert.throws(() => parsePlan({ events: [{ title: 'x', start: '2026-10-07T10:00', priority: '높음' }] }), BadPlan);
});

test('parsePlan: todo still accepts its own fields plus shared ones', () => {
  const { todos: [t] } = parsePlan({ events: [{ kind: 'todo', title: 'x', due: '2026-10-07', description: 'd', color: 3, priority: 1, group: 0, done: false, _note: 'n' }] });
  assert.equal(t.description, 'd');
  assert.equal(t.note, 'n');
});
