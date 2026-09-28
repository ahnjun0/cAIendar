import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeInput, pdfItemsToText, MAX_DOC_CHARS, cleanPageText } from '../src/lib/source.js';

test('composeInput: user text only → unchanged', () => {
  assert.equal(composeInput('내일 3시 치과', null), '내일 3시 치과');
});

test('composeInput: document attached → instruction + fenced document with source label', () => {
  const r = composeInput('시간표 수업만 등록', { kind: 'tab', label: 'PLATO 강의계획서', text: '월 10:30 컴퓨터구조' });
  assert.match(r, /^시간표 수업만 등록/);
  assert.match(r, /\[첨부 문서: PLATO 강의계획서\]/);
  assert.match(r, /월 10:30 컴퓨터구조/);
});

test('composeInput: empty user text with document → default instruction', () => {
  const r = composeInput('', { kind: 'pdf', label: 'a.pdf', text: 'x' });
  assert.match(r, /문서에 있는 일정/);
});

test('composeInput: long document is truncated with a marker', () => {
  const r = composeInput('', { kind: 'pdf', label: 'big.pdf', text: 'a'.repeat(MAX_DOC_CHARS + 500) });
  assert.ok(r.length < MAX_DOC_CHARS + 400);
  assert.match(r, /잘림/);
});

test('cleanPageText: collapses whitespace runs and blank lines', () => {
  assert.equal(cleanPageText('a   b\n\n\n\nc \t d\n'), 'a b\n\nc d');
});

test('pdfItemsToText: joins items, newline on hasEOL or large y jump', () => {
  const items = [
    { str: '컴퓨터구조', transform: [1, 0, 0, 1, 50, 700], hasEOL: false },
    { str: '(060)', transform: [1, 0, 0, 1, 120, 700], hasEOL: true },
    { str: '화 10:30', transform: [1, 0, 0, 1, 50, 680], hasEOL: false },
    { str: '~11:45', transform: [1, 0, 0, 1, 110, 680], hasEOL: false },
    { str: '다음 페이지', transform: [1, 0, 0, 1, 50, 100], hasEOL: false },
  ];
  assert.equal(pdfItemsToText(items), '컴퓨터구조 (060)\n화 10:30 ~11:45\n다음 페이지');
});

// ---------- 출처·특이사항·서명 ----------
import { addProvenance, SIGNATURE } from '../src/lib/source.js';

const day = new Date('2026-09-26T00:00:00Z');

test('addProvenance: appends signature to every item, keeps the original description', () => {
  const p = addProvenance({ events: [
    { title: 'a', start: '2026-10-01T10:00', description: '원래 설명' },
    { kind: 'todo', title: 'b', due: '2026-10-07' },
  ] }, { today: day });
  assert.equal(p.events[0].description, `원래 설명\n${SIGNATURE} (2026-09-26)`);
  assert.equal(p.events[1].description, `${SIGNATURE} (2026-09-26)`);
});

test('addProvenance: _note becomes 특이사항 and is removed from the item', () => {
  const p = addProvenance({ events: [{ title: 'a', start: '2026-10-01T10:00', _note: '시각이 애매함' }] }, { today: day });
  assert.match(p.events[0].description, /^특이사항: 시각이 애매함\n/);
  assert.equal(p.events[0]._note, undefined);
});

test('addProvenance: source label is recorded when a document was attached', () => {
  const p = addProvenance({ events: [{ title: 'a', start: '2026-10-01T10:00' }] }, { source: 'PLATO 강의계획서', today: day });
  assert.equal(p.events[0].description, `출처: PLATO 강의계획서\n${SIGNATURE} (2026-09-26)`);
});

test('addProvenance: order is 설명 → 특이사항 → 출처 → 서명', () => {
  const p = addProvenance({ events: [{ title: 'a', start: '2026-10-01T10:00', description: 'D', _note: 'N' }] }, { source: 'S', today: day });
  assert.deepEqual(p.events[0].description.split('\n'), ['D', '특이사항: N', '출처: S', `${SIGNATURE} (2026-09-26)`]);
});

test('addProvenance: idempotent — re-applying does not stack signatures', () => {
  const once = addProvenance({ events: [{ title: 'a', start: '2026-10-01T10:00', description: 'D' }] }, { source: 'S', today: day });
  const twice = addProvenance(once, { source: 'S', today: day });
  assert.equal(twice.events[0].description, once.events[0].description);
});

test('addProvenance: long source labels are trimmed, plan is not mutated', () => {
  const plan = { events: [{ title: 'a', start: '2026-10-01T10:00' }] };
  const p = addProvenance(plan, { source: 'x'.repeat(200), today: day });
  assert.ok(p.events[0].description.split('\n')[0].length < 130);
  assert.match(p.events[0].description, /…/);
  assert.equal(plan.events[0].description, undefined, '원본은 그대로');
});

test('addProvenance: keeps calendar and other fields', () => {
  const p = addProvenance({ calendar: '내 캘린더', events: [{ title: 'a', start: '2026-10-01T10:00', location: '306' }] }, { today: day });
  assert.equal(p.calendar, '내 캘린더');
  assert.equal(p.events[0].location, '306');
});
