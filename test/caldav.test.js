import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CalDAVClient, PRESETS, parseMultistatus, resolveUrl, xmlUnescape } from '../src/lib/caldav.js';

// ---------- fixtures (네이버 응답 형태를 본뜸) ----------
const MS = (body) => `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${body}</D:multistatus>`;
const PRINCIPAL_RES = MS(`<D:response><D:href>/</D:href><D:propstat><D:prop>
  <D:current-user-principal><D:href>/principals/users/tester/</D:href></D:current-user-principal>
</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`);
const HOME_RES = MS(`<D:response><D:href>/principals/users/tester/</D:href><D:propstat><D:prop>
  <C:calendar-home-set><D:href>/tester/</D:href></C:calendar-home-set>
</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`);
const LIST_RES = MS(`
<D:response><D:href>/tester/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
<D:response><D:href>/tester/cal1/</D:href><D:propstat><D:prop>
  <D:displayname>내 캘린더</D:displayname>
  <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
  <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
<D:response><D:href>/tester/todo/</D:href><D:propstat><D:prop>
  <D:displayname>할 일</D:displayname>
  <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
  <C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set>
</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
<D:response><D:href>/tester/cal2/</D:href><D:propstat><D:prop>
  <D:displayname>학교 &amp; 과제</D:displayname>
  <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`);

const ICS_A = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a\r\nSUMMARY:수업\r\nDTSTART;TZID=Asia/Seoul:20260922T103000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
const ICS_B = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:b\r\nSUMMARY:회의\r\nDTSTART;TZID=Asia/Seoul:20260922T140000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
// 네이버 특성: href만 있고 calendar-data가 비어 오는 항목이 섞인다
const REPORT_RES = MS(`
<D:response><D:href>/tester/cal1/a.ics</D:href><D:propstat><D:prop><D:getetag>"e1"</D:getetag>
  <C:calendar-data><![CDATA[${ICS_A}]]></C:calendar-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
<D:response><D:href>/tester/cal1/b.ics</D:href><D:propstat><D:prop><D:getetag>"e2"</D:getetag>
  <C:calendar-data></C:calendar-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
<D:response><D:href>/tester/cal1/c.ics</D:href><D:propstat><D:prop><D:getetag>"e3"</D:getetag></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`);

/** 요청을 기록하고 라우트에 따라 응답하는 가짜 fetch */
function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    const r = routes.find((x) => x.method === (init.method ?? 'GET') && (typeof x.url === 'string' ? x.url === url : x.url.test(url)));
    if (!r) return new Response('not found', { status: 404 });
    const res = typeof r.res === 'function' ? r.res(url, init) : r.res;
    const status = res.status ?? 207;
    return new Response(status === 204 ? null : (res.body ?? ''), { status, headers: res.headers ?? {} });
  };
  fn.calls = calls;
  return fn;
}

const auth = () => `Basic ${Buffer.from('tester:app-pw').toString('base64')}`;
const client = (fetchFn, baseUrl = 'https://caldav.calendar.naver.com') =>
  new CalDAVClient({ baseUrl, username: 'tester', password: 'app-pw', fetchFn });

// ---------- URL / XML helpers ----------


test('resolveUrl: absolute path, absolute URL, relative', () => {
  assert.equal(resolveUrl('https://h.example/x/', '/a/b/'), 'https://h.example/a/b/');
  assert.equal(resolveUrl('https://h.example/x/', 'https://other/z'), 'https://other/z');
  assert.equal(resolveUrl('https://h.example/x/', 'c.ics'), 'https://h.example/x/c.ics');
});

test('xmlUnescape: entities', () => {
  assert.equal(xmlUnescape('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#x41;'), 'a & b <c> "d" \'eA');
});

test('parseMultistatus: responses with href / props / calendar-data (CDATA and missing)', () => {
  const rs = parseMultistatus(REPORT_RES);
  assert.equal(rs.length, 3);
  assert.equal(rs[0].href, '/tester/cal1/a.ics');
  assert.equal(rs[0].etag, '"e1"');
  assert.equal(rs[0].calendarData, ICS_A);
  assert.equal(rs[1].calendarData, '');
  assert.equal(rs[2].calendarData, '');
});

test('parseMultistatus: displayname is unescaped, component set parsed', () => {
  const rs = parseMultistatus(LIST_RES);
  const cal2 = rs.find((r) => r.href === '/tester/cal2/');
  assert.equal(cal2.displayname, '학교 & 과제');
  assert.equal(cal2.isCalendar, true);
  assert.deepEqual(cal2.components, []);
  const todo = rs.find((r) => r.href === '/tester/todo/');
  assert.deepEqual(todo.components, ['VTODO']);
  assert.equal(rs[0].isCalendar, false);
});

// ---------- discovery ----------
test('discoverCalendars: PROPFIND / → principal → home → list (VEVENT + VTODO calendars)', async () => {
  const f = mockFetch([
    { method: 'PROPFIND', url: 'https://caldav.calendar.naver.com/', res: { body: PRINCIPAL_RES } },
    { method: 'PROPFIND', url: 'https://caldav.calendar.naver.com/principals/users/tester/', res: { body: HOME_RES } },
    { method: 'PROPFIND', url: 'https://caldav.calendar.naver.com/tester/', res: { body: LIST_RES } },
  ]);
  const cals = await client(f).discoverCalendars();
  assert.deepEqual(cals.map((c) => c.name), ['내 캘린더', '할 일', '학교 & 과제']); // 컴포넌트 미표기는 일정으로 포함
  assert.equal(cals[0].url, 'https://caldav.calendar.naver.com/tester/cal1/');

  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[0].headers.Depth, '0');
  assert.equal(f.calls[0].headers.Authorization, auth());
  assert.match(f.calls[0].headers['Content-Type'], /application\/xml/);
  assert.match(f.calls[0].body, /current-user-principal/);
  assert.equal(f.calls[1].headers.Depth, '0');
  assert.match(f.calls[1].body, /calendar-home-set/);
  assert.equal(f.calls[2].headers.Depth, '1');
  assert.match(f.calls[2].body, /displayname/);
  assert.match(f.calls[2].body, /supported-calendar-component-set/);
});

test('discoverCalendars: 401 → error mentioning app password', async () => {
  const f = mockFetch([{ method: 'PROPFIND', url: /.*/, res: { status: 401, body: '' } }]);
  await assert.rejects(client(f).discoverCalendars(), /401|인증|앱 비밀번호/);
});

// ---------- PUT ----------
test('putEvent: PUT {calendarUrl}{uid}.ics with text/calendar and If-None-Match: *', async () => {
  const f = mockFetch([{ method: 'PUT', url: /\.ics$/, res: { status: 201, body: '', headers: { ETag: '"new"' } } }]);
  const r = await client(f).putEvent('https://caldav.calendar.naver.com/tester/cal1/', 'u-1@caiendar', ICS_A);
  assert.equal(r.href, 'https://caldav.calendar.naver.com/tester/cal1/u-1@caiendar.ics');
  assert.equal(r.etag, '"new"');
  const c = f.calls[0];
  assert.equal(c.method, 'PUT');
  assert.equal(c.url, 'https://caldav.calendar.naver.com/tester/cal1/u-1@caiendar.ics');
  assert.equal(c.headers['Content-Type'], 'text/calendar; charset=utf-8');
  assert.equal(c.headers['If-None-Match'], '*');
  assert.equal(c.headers.Authorization, auth());
  assert.equal(c.body, ICS_A);
});

test('putEvent: 412 (already exists) → error', async () => {
  const f = mockFetch([{ method: 'PUT', url: /.*/, res: { status: 412, body: '' } }]);
  await assert.rejects(client(f).putEvent('https://caldav.calendar.naver.com/tester/cal1/', 'u', ICS_A), /412/);
});

// ---------- REPORT + empty calendar-data fallback ----------
test('queryEvents: REPORT calendar-query with VEVENT time-range; empty calendar-data → GET fallback; still empty → unreadable', async () => {
  const f = mockFetch([
    { method: 'REPORT', url: 'https://caldav.calendar.naver.com/tester/cal1/', res: { body: REPORT_RES } },
    { method: 'GET', url: 'https://caldav.calendar.naver.com/tester/cal1/b.ics', res: { status: 200, body: ICS_B } },
    { method: 'GET', url: 'https://caldav.calendar.naver.com/tester/cal1/c.ics', res: { status: 500, body: '' } },
  ]);
  const r = await client(f).queryEvents('https://caldav.calendar.naver.com/tester/cal1/', '20260922T000000Z', '20260923T000000Z');
  assert.equal(r.events.length, 2);
  assert.equal(r.events[0].href, 'https://caldav.calendar.naver.com/tester/cal1/a.ics');
  assert.equal(r.events[0].ics, ICS_A);
  assert.equal(r.events[1].ics, ICS_B);
  assert.deepEqual(r.unreadable, ['https://caldav.calendar.naver.com/tester/cal1/c.ics']);

  const rep = f.calls[0];
  assert.equal(rep.method, 'REPORT');
  assert.equal(rep.headers.Depth, '1');
  assert.match(rep.body, /calendar-query/);
  assert.match(rep.body, /comp-filter name="VCALENDAR"/);
  assert.match(rep.body, /comp-filter name="VEVENT"/);
  assert.match(rep.body, /time-range start="20260922T000000Z" end="20260923T000000Z"/);
  assert.match(rep.body, /calendar-data/);
  assert.equal(f.calls.filter((c) => c.method === 'GET').length, 2, 'one GET retry per empty item');
});

// ---------- DELETE ----------
test('deleteEvent: DELETE href with auth', async () => {
  const f = mockFetch([{ method: 'DELETE', url: /.*/, res: { status: 204, body: '' } }]);
  await client(f).deleteEvent('https://caldav.calendar.naver.com/tester/cal1/u.ics');
  assert.equal(f.calls[0].method, 'DELETE');
  assert.equal(f.calls[0].headers.Authorization, auth());
});

test('deleteEvent: 404 is treated as already gone (no throw)', async () => {
  const f = mockFetch([{ method: 'DELETE', url: /.*/, res: { status: 404, body: '' } }]);
  await client(f).deleteEvent('https://caldav.calendar.naver.com/tester/cal1/u.ics');
});

test('credentials never appear in thrown error messages', async () => {
  const f = mockFetch([{ method: 'PROPFIND', url: /.*/, res: { status: 500, body: 'boom' } }]);
  try { await client(f).discoverCalendars(); assert.fail('should throw'); } catch (e) {
    assert.ok(!e.message.includes('app-pw'));
    assert.ok(!e.message.includes(auth()));
  }
});

test('default fetchFn works when invoked as a method (no Illegal invocation)', async () => {
  const { createServer } = await import('node:http');
  const srv = createServer((req, res) => { res.writeHead(207, { 'Content-Type': 'application/xml' }); res.end(PRINCIPAL_RES); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const c = new CalDAVClient({ baseUrl: `http://127.0.0.1:${srv.address().port}/`, username: 'u', password: 'p' });
    const rows = await c.propfind(c.baseUrl, '<x/>', 0);
    assert.equal(rows[0].principalHref, '/principals/users/tester/');
  } finally { srv.close(); }
});

test('PRESETS: MVP 범위는 네이버 하나', () => {
  assert.deepEqual(Object.keys(PRESETS), ['naver']);
  assert.equal(PRESETS.naver, 'https://caldav.calendar.naver.com');
});

test('discoverCalendars: returns components so a VTODO task calendar is usable, and marks kind', async () => {
  const f = mockFetch([
    { method: 'PROPFIND', url: 'https://caldav.calendar.naver.com/', res: { body: PRINCIPAL_RES } },
    { method: 'PROPFIND', url: 'https://caldav.calendar.naver.com/principals/users/tester/', res: { body: HOME_RES } },
    { method: 'PROPFIND', url: 'https://caldav.calendar.naver.com/tester/', res: { body: LIST_RES } },
  ]);
  const cals = await client(f).discoverCalendars();
  assert.deepEqual(cals.map((c) => c.name), ['내 캘린더', '할 일', '학교 & 과제']);
  assert.deepEqual(cals.map((c) => c.kind), ['event', 'todo', 'event']);
  assert.deepEqual(cals.find((c) => c.kind === 'todo').components, ['VTODO']);
});

test('queryTodos: REPORT with VTODO comp-filter and no time-range', async () => {
  const TODO_RES = MS(`<D:response><D:href>/tester/todo/a.ics</D:href><D:propstat><D:prop><D:getetag>"t1"</D:getetag>
    <C:calendar-data><![CDATA[BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:a\r\nSUMMARY:과제\r\nDUE;VALUE=DATE:20261007\r\nEND:VTODO\r\nEND:VCALENDAR\r\n]]></C:calendar-data>
    </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`);
  const f = mockFetch([{ method: 'REPORT', url: 'https://caldav.calendar.naver.com/tester/todo/', res: { body: TODO_RES } }]);
  const r = await client(f).queryTodos('https://caldav.calendar.naver.com/tester/todo/');
  assert.equal(r.todos.length, 1);
  assert.match(r.todos[0].ics, /BEGIN:VTODO/);
  assert.match(f.calls[0].body, /comp-filter name="VTODO"/);
  assert.ok(!/time-range/.test(f.calls[0].body), 'due dates can be far in the past/future');
});

// ---------- 할 일 조회 성능 (807건 계정에서 멈추던 문제) ----------
const todoRes = (n, { withData = true } = {}) => MS(Array.from({ length: n }, (_, i) =>
  `<D:response><D:href>/tester/todo/${i}.ics</D:href><D:propstat><D:prop><D:getetag>"e${i}"</D:getetag>`
  + (withData ? `<C:calendar-data><![CDATA[BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:u${i}\r\nSUMMARY:t${i}\r\nDUE;VALUE=DATE:2026100${i % 10}\r\nEND:VTODO\r\nEND:VCALENDAR\r\n]]></C:calendar-data>` : '')
  + `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`).join(''));

test('queryTodos: a due range narrows the REPORT with a time-range filter', async () => {
  const f = mockFetch([{ method: 'REPORT', url: /todo\/$/, res: { body: todoRes(2) } }]);
  await client(f).queryTodos('https://caldav.calendar.naver.com/tester/todo/', { start: '20261001T000000Z', end: '20261009T000000Z' });
  assert.match(f.calls[0].body, /comp-filter name="VTODO"/);
  assert.match(f.calls[0].body, /time-range start="20261001T000000Z" end="20261009T000000Z"/);
});

test('queryTodos: server rejecting the time-range → one retry without it', async () => {
  let first = true;
  const f = mockFetch([{ method: 'REPORT', url: /.*/, res: () => (first ? (first = false, { status: 403, body: 'filter not supported' }) : { body: todoRes(1) }) }]);
  const r = await client(f).queryTodos('https://caldav.calendar.naver.com/tester/todo/', { start: 'a', end: 'b' });
  assert.equal(r.todos.length, 1);
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0].body, /time-range/);
  assert.ok(!/time-range/.test(f.calls[1].body));
});

test('queryTodos: individual GET retries are capped, the rest are reported unreadable', async () => {
  const f = mockFetch([
    { method: 'REPORT', url: /.*/, res: { body: todoRes(50, { withData: false }) } },
    { method: 'GET', url: /.*/, res: { status: 200, body: 'BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:x\r\nEND:VTODO\r\nEND:VCALENDAR\r\n' } },
  ]);
  const r = await client(f).queryTodos('https://caldav.calendar.naver.com/tester/todo/');
  const gets = f.calls.filter((c) => c.method === 'GET').length;
  assert.ok(gets <= 20, `too many GETs: ${gets}`);
  assert.equal(r.todos.length, gets);
  assert.equal(r.unreadable.length, 50 - gets);
});

// ---------- 오류 처리 ----------
test('request: 429 는 Retry-After 만큼 기다렸다가 자동 재시도한다', async () => {
  let n = 0;
  const f = mockFetch([{ method: 'PROPFIND', url: /.*/, res: () => (++n === 1 ? { status: 429, body: '', headers: { 'Retry-After': '0' } } : { body: PRINCIPAL_RES }) }]);
  const rows = await client(f).propfind('https://caldav.calendar.naver.com/', '<x/>', 0);
  assert.equal(n, 2);
  assert.equal(rows[0].principalHref, '/principals/users/tester/');
});

test('request: 5xx 도 재시도하되 횟수 상한을 넘기면 안내 문구와 함께 실패한다', async () => {
  let n = 0;
  const f = mockFetch([{ method: 'PROPFIND', url: /.*/, res: () => (n++, { status: 503, body: '', headers: { 'Retry-After': '0' } }) }]);
  await assert.rejects(client(f).discoverCalendars(), (e) => /서버에 문제/.test(e.message) && /503/.test(e.message));
  assert.equal(n, 3, '최초 1회 + 재시도 2회');
});

test('request: 401 은 재시도하지 않고 앱 비밀번호를 안내한다', async () => {
  let n = 0;
  const f = mockFetch([{ method: 'PROPFIND', url: /.*/, res: () => (n++, { status: 401, body: '' }) }]);
  await assert.rejects(client(f).discoverCalendars(), (e) => /애플리케이션 비밀번호/.test(e.message));
  assert.equal(n, 1);
});

test('request: 네트워크 실패도 재시도하고, 끝내 실패하면 연결 오류로 알린다', async () => {
  let n = 0;
  const f = async () => { n++; throw new Error('Failed to fetch'); };
  await assert.rejects(client(f).discoverCalendars(), (e) => /연결할 수 없/.test(e.message));
  assert.equal(n, 3);
});

test('request: 자격증명은 어떤 오류 메시지에도 들어가지 않는다', async () => {
  const f = mockFetch([{ method: 'PROPFIND', url: /.*/, res: { status: 500, body: 'boom app-pw' } }]);
  try { await client(f).discoverCalendars(); assert.fail('던져야 한다'); } catch (e) {
    assert.ok(!e.message.includes(auth()));
  }
});

test('request: 시간이 오래 걸리면 중단하고 시간 초과로 알린다', async () => {
  const f = (url, init) => new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const c = new CalDAVClient({ baseUrl: 'https://caldav.calendar.naver.com', username: 'u', password: 'p', fetchFn: f, timeoutMs: 20 });
  await assert.rejects(c.discoverCalendars(), (e) => /시간이 초과/.test(e.message));
});
