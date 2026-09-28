import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOf } from '../src/lib/batchkind.js';

test('kindOf: 기록에 type 이 있으면 그대로 쓴다', () => {
  assert.equal(kindOf({ type: 'todo' }), 'todo');
  assert.equal(kindOf({ type: 'event' }), 'event');
});

test('kindOf: type 이 없으면 같은 배치의 plan 에 남은 kind 로 판단한다', () => {
  const batch = { plan: { events: [
    { title: '컴퓨터구조', start: '2026-09-29T10:30' },
    { kind: 'todo', title: 'DB 과제 제출', due: '2026-10-07' },
  ] } };
  assert.equal(kindOf({ title: 'DB 과제 제출' }, batch), 'todo');
  assert.equal(kindOf({ title: '컴퓨터구조' }, batch), 'event');
});

test('kindOf: 근거가 없으면 모른다고 한다 (요약 문구로 넘겨짚지 않는다)', () => {
  assert.equal(kindOf({ summary: '2026-10-07까지  DB 과제 제출' }), null);
  assert.equal(kindOf({ title: '옛 기록' }, { plan: { events: [] } }), null);
  assert.equal(kindOf({}), null);
});
