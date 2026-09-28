import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainHttp, explainNetwork, retryDelayMs, MAX_RETRIES, isRetryable } from '../src/lib/errors.js';

test('explainHttp: CalDAV 401/403 → 앱 비밀번호 안내', () => {
  for (const status of [401, 403]) {
    const e = explainHttp({ status, service: 'caldav' });
    assert.match(e.message, /인증/);
    assert.match(e.hint, /애플리케이션 비밀번호|앱 비밀번호/);
    assert.equal(e.retryable, false);
  }
});

test('explainHttp: 429 → 잠시 후 재시도, retryable', () => {
  const e = explainHttp({ status: 429, service: 'llm' });
  assert.match(e.message, /요청이 너무 잦/);
  assert.equal(e.retryable, true);
});

test('explainHttp: LLM 402/insufficient credit → 크레딧 안내', () => {
  const e = explainHttp({ status: 402, service: 'llm', body: 'requires more credits' });
  assert.match(e.message, /크레딧|잔액/);
  assert.equal(e.retryable, false);
});

test('explainHttp: LLM 401 → API 키, 404 → 모델 이름', () => {
  assert.match(explainHttp({ status: 401, service: 'llm' }).hint, /API 키/);
  assert.match(explainHttp({ status: 404, service: 'llm' }).hint, /모델/);
});

test('explainHttp: CalDAV 412 → 같은 UID 가 이미 있음', () => {
  const e = explainHttp({ status: 412, service: 'caldav' });
  assert.match(e.message, /이미 있/);
  assert.equal(e.retryable, false);
});

test('explainHttp: 5xx 는 서버 문제로 보고 재시도 대상', () => {
  for (const status of [500, 502, 503, 504]) {
    const e = explainHttp({ status, service: 'caldav' });
    assert.equal(e.retryable, true, String(status));
    assert.match(e.message, /서버/);
  }
});

test('explainHttp: 네이버 로그인 페이지가 200 으로 오면 로그인 안내', () => {
  const e = explainHttp({ status: 200, service: 'naver', body: "location.replace('https://nid.naver.com/nidlogin.login')" });
  assert.match(e.message, /로그인/);
  assert.equal(e.retryable, false);
});

test('explainHttp: 알 수 없는 상태 코드도 상태 번호를 남긴다', () => {
  const e = explainHttp({ status: 418, service: 'caldav' });
  assert.match(e.message, /418/);
});

test('explainHttp: 응답 본문은 길이를 제한해 덧붙인다', () => {
  const e = explainHttp({ status: 400, service: 'llm', body: 'x'.repeat(1000) });
  assert.ok(e.message.length < 400, e.message.length);
});

test('explainNetwork: 오프라인 / 타임아웃 / 차단을 구분한다', () => {
  assert.match(explainNetwork(new Error('Failed to fetch'), 'llm').message, /연결할 수 없|네트워크/);
  const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
  assert.match(explainNetwork(abort, 'caldav').message, /시간이 초과/);
  assert.equal(explainNetwork(abort, 'caldav').retryable, true);
});

test('retryDelayMs: 지수 백오프, Retry-After 헤더가 있으면 그것을 따른다', () => {
  assert.ok(retryDelayMs(0) < retryDelayMs(1));
  assert.ok(retryDelayMs(1) < retryDelayMs(2));
  assert.equal(retryDelayMs(0, '3'), 3000);
  assert.equal(retryDelayMs(1, '0'), 0);
  assert.ok(retryDelayMs(0, 'not-a-number') > 0);
  assert.ok(retryDelayMs(5) <= 20_000, '상한이 있다');
});

test('isRetryable: 429 와 5xx 만', () => {
  assert.equal(isRetryable(429), true);
  assert.equal(isRetryable(503), true);
  assert.equal(isRetryable(404), false);
  assert.equal(isRetryable(401), false);
  assert.ok(MAX_RETRIES >= 1);
});
