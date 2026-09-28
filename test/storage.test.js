import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// chrome.storage.local 가짜 구현 (모듈 import 전에 설치해야 한다)
const store = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(key) { return key in store ? { [key]: store[key] } : {}; },
      async set(obj) { Object.assign(store, obj); },
      async remove(key) { delete store[key]; },
    },
  },
};

const { getDraft, saveDraft, clearDraft, getBatches, saveBatch, removeBatch, MAX_BATCHES } = await import('../src/lib/storage.js');

beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

test('draft: 저장한 작성 내용을 그대로 돌려주고, 없으면 null', async () => {
  assert.equal(await getDraft(), null);
  const draft = { input: '내일 3시 치과', plan: { events: [{ title: '치과', start: '2026-10-01T15:00' }] },
    doc: { kind: 'pdf', label: 'a.pdf', text: '본문' }, calendarUrl: 'https://x/cal/' };
  await saveDraft(draft);
  const got = await getDraft();
  assert.equal(got.input, '내일 3시 치과');
  assert.deepEqual(got.plan, draft.plan);
  assert.equal(got.doc.label, 'a.pdf');
  assert.ok(got.at, '저장 시각이 남는다');
});

test('draft: 지우면 사라진다', async () => {
  await saveDraft({ input: 'x' });
  await clearDraft();
  assert.equal(await getDraft(), null);
});

test('draft: 첨부 문서 본문이 너무 길면 잘라서 저장한다 (저장소 한도 보호)', async () => {
  await saveDraft({ input: '', doc: { kind: 'tab', label: 't', text: 'a'.repeat(200_000) } });
  const got = await getDraft();
  assert.ok(got.doc.text.length <= 60_000, got.doc.text.length);
  assert.equal(got.doc.truncated, true);
});

test('batches: 최근 것이 앞에 오고, 상한을 넘으면 오래된 것이 밀린다', async () => {
  for (let i = 0; i < MAX_BATCHES + 5; i++) await saveBatch({ id: `b${i}`, at: new Date().toISOString(), events: [] });
  const list = await getBatches();
  assert.equal(list.length, MAX_BATCHES);
  assert.equal(list[0].id, `b${MAX_BATCHES + 4}`);
  assert.ok(!list.some((b) => b.id === 'b0'));
});

test('batches: id 로 지운다', async () => {
  await saveBatch({ id: 'a', events: [] });
  await saveBatch({ id: 'b', events: [] });
  await removeBatch('a');
  assert.deepEqual((await getBatches()).map((b) => b.id), ['b']);
});

test('saveBatch: 같은 id 면 덮어쓰고, 없으면 앞에 넣는다 (등록 중 점진 저장)', async () => {
  const { saveBatch } = await import('../src/lib/storage.js');
  await saveBatch({ id: 'x', events: [{ title: 'A' }] });
  await saveBatch({ id: 'x', events: [{ title: 'A' }, { title: 'B' }] });
  await saveBatch({ id: 'y', events: [] });
  const list = await getBatches();
  assert.deepEqual(list.map((b) => b.id), ['y', 'x']);
  assert.equal(list.find((b) => b.id === 'x').events.length, 2);
});
