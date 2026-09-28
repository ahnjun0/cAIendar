import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findCodeUrl, parseColors, bundledColorMap, fetchNaverCodes } from '../src/lib/naver_codes.js';
import { COLOR_HEX } from '../src/lib/schema.js';

const bundled = JSON.parse(readFileSync(new URL('../src/data/colors.json', import.meta.url), 'utf8'));

test('bundled colors.json matches COLOR_HEX in schema.js (35 colors)', () => {
  assert.equal(bundled.length, 35);
  for (const { colorId, colorCode } of bundled) assert.equal(COLOR_HEX[colorId], colorCode);
});

test('bundledColorMap: {id: "#rrggbb"}', () => {
  const m = bundledColorMap();
  assert.equal(Object.keys(m).length, 35);
  assert.equal(m[22], '#506ee2');
});

test('findCodeUrl: finds /data/colors URL in HTML in various encodings, never hardcodes ts/lm', () => {
  assert.equal(findCodeUrl('<script>load("/data/colors?lc=ko&ts=123&lm=456")</script>', 'colors'),
    'https://calendar.naver.com/data/colors?lc=ko&ts=123&lm=456');
  assert.equal(findCodeUrl('x="https://calendar.naver.com/data/colors?lc=ko&amp;ts=9&amp;lm=8"', 'colors'),
    'https://calendar.naver.com/data/colors?lc=ko&ts=9&lm=8');
  assert.equal(findCodeUrl('{"u":"\\/data\\/colors?lc=ko&ts=1&lm=2"}', 'colors'),
    'https://calendar.naver.com/data/colors?lc=ko&ts=1&lm=2');
  assert.equal(findCodeUrl('<html>nothing here</html>', 'colors'), null);
  assert.equal(findCodeUrl('/data/stickers?ts=5&lm=6', 'stickers'), 'https://calendar.naver.com/data/stickers?ts=5&lm=6');
});

test('parseColors: array of {colorId, colorCode} → map; rejects junk', () => {
  assert.deepEqual(parseColors([{ colorId: 1, colorCode: 'b93b4f' }, { colorId: 2, colorCode: '#E4617A' }]), { 1: '#b93b4f', 2: '#e4617a' });
  assert.equal(parseColors([]), null);
  assert.equal(parseColors({ not: 'array' }), null);
  assert.equal(parseColors([{ colorId: 'x', colorCode: 'zzz' }]), null);
  assert.equal(Object.keys(parseColors(bundled)).length, 35);
});

const mock = (routes) => {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const r = routes[url];
    if (!r) return new Response('nf', { status: 404 });
    return new Response(r.body, { status: r.status ?? 200 });
  };
  fn.calls = calls;
  return fn;
};

test('fetchNaverCodes: GET home → find URL → GET json → colors map; stickers optional', async () => {
  const f = mock({
    'https://calendar.naver.com/main': { body: '<html>"/data/colors?lc=ko&ts=11&lm=22" "/data/stickers?ts=1&lm=2"</html>' },
    'https://calendar.naver.com/data/colors?lc=ko&ts=11&lm=22': { body: JSON.stringify(bundled) },
    'https://calendar.naver.com/data/stickers?ts=1&lm=2': { body: JSON.stringify([{ stickerId: 501, imageUrl: 'a.png' }, { stickerId: 506, imageUrl: 'b.png' }]) },
  });
  const r = await fetchNaverCodes(f);
  assert.equal(Object.keys(r.colors).length, 35);
  assert.equal(r.colors[7], '#e0744e');
  assert.deepEqual(r.stickers, { 501: 'a.png', 506: 'b.png' });
  assert.equal(r.errors.length, 0);
  assert.equal(f.calls[0], 'https://calendar.naver.com/main');
});

test('fetchNaverCodes: no colors URL in HTML → colors null with a message, no throw', async () => {
  const f = mock({ 'https://calendar.naver.com/main': { body: '<html></html>' } });
  const r = await fetchNaverCodes(f);
  assert.equal(r.colors, null);
  assert.equal(r.stickers, null);
  assert.ok(r.errors.length >= 1);
});

test('fetchNaverCodes: login redirect page → clear login message, colors null', async () => {
  const f = mock({ 'https://calendar.naver.com/main': { body: "<script>target.location.replace('https://nid.naver.com/nidlogin.login?mode=form&url=x');</script>" } });
  const r = await fetchNaverCodes(f);
  assert.equal(r.colors, null);
  assert.match(r.errors.join(' '), /로그인/);
});

test('fetchNaverCodes: sends cookies (credentials: include) for the read-only GETs', async () => {
  const seen = [];
  const f = async (url, init) => { seen.push(init?.credentials); return new Response('<html></html>', { status: 200 }); };
  await fetchNaverCodes(f);
  assert.ok(seen.length >= 1);
  assert.ok(seen.every((c) => c === 'include'), JSON.stringify(seen));
});

test('fetchNaverCodes: network failure → nulls + error, never throws', async () => {
  const r = await fetchNaverCodes(async () => { throw new Error('offline'); });
  assert.equal(r.colors, null);
  assert.match(r.errors.join(' '), /offline/);
});

test('fetchNaverCodes: colors JSON malformed → colors null (bundled stays in use)', async () => {
  const f = mock({
    'https://calendar.naver.com/main': { body: '"/data/colors?lc=ko&ts=1&lm=1"' },
    'https://calendar.naver.com/data/colors?lc=ko&ts=1&lm=1': { body: '<html>login</html>' },
  });
  const r = await fetchNaverCodes(f);
  assert.equal(r.colors, null);
  assert.ok(r.errors.length >= 1);
});

// ---------- 로그인 후 /main 의 oInitialData (실측 형태를 본뜬 합성 픽스처) ----------
const MAIN_HTML = `<html><script>
    var oInitialData = {};
    oInitialData.sUserId = "tester";
    oInitialData.oConfig = {"defaultCalendarId":"53581063","userTimezone":"Asia/Seoul","today":"2026-09-22 11:05:41","language":"ko"};
    oInitialData.aCalendarList = [{"color":{"colorId":22,"colorCode":"506ee2"},"isTimetable":false,"calendarServiceType":"NORMAL","calendarId":"53581063","name":"내 캘린더","desc":""},{"color":{"colorId":14,"colorCode":"f9eeac"},"isTimetable":true,"calendarServiceType":"TIMETABLE","calendarId":"921d8805-f11c-4052-a051-69fc3cc97703","name":"2026학년도 2학기 시간표","desc":"내 시간표"}];
    oInitialData.aTimetableList = [{"calendarId":"921d8805-f11c-4052-a051-69fc3cc97703","displayStartTime":"0900","displayEndTime":"2230","semesterStartDate":"2026-09-01","semesterEndDate":"2026-12-21","timetableType":"1","version":2}];
    oInitialData.oCategoryList = [{"categoryId":1,"categoryName":"","categoryColor":1},{"categoryId":22,"categoryName":"학원","categoryColor":22},{"categoryId":23,"categoryName":"🏫 학교","categoryColor":23},{"categoryId":29,"categoryName":"👨‍👩‍👧가족","categoryColor":29}];
    oInitialData.oAdditionalTimezone = null ||{};
</script>"/data/colors?lc=ko&ts=5&lm=6"</html>`;

test('parseInitialData: category names by color id (empty names dropped)', async () => {
  const { parseInitialData } = await import('../src/lib/naver_codes.js');
  const d = parseInitialData(MAIN_HTML);
  assert.deepEqual(d.categoryNames, { 22: '학원', 23: '🏫 학교', 29: '👨‍👩‍👧가족' });
});

test('parseInitialData: calendars, timetables, today, defaultCalendarId', async () => {
  const { parseInitialData } = await import('../src/lib/naver_codes.js');
  const d = parseInitialData(MAIN_HTML);
  assert.deepEqual(d.calendars, [
    { calendarId: '53581063', name: '내 캘린더', colorId: 22, isTimetable: false },
    { calendarId: '921d8805-f11c-4052-a051-69fc3cc97703', name: '2026학년도 2학기 시간표', colorId: 14, isTimetable: true },
  ]);
  assert.deepEqual(d.timetables, [{ calendarId: '921d8805-f11c-4052-a051-69fc3cc97703', name: '2026학년도 2학기 시간표', semesterStartDate: '2026-09-01', semesterEndDate: '2026-12-21' }]);
  assert.equal(d.today, '2026-09-22');
  assert.equal(d.defaultCalendarId, '53581063');
});

test('parseInitialData: missing/malformed blocks → empty values, no throw', async () => {
  const { parseInitialData } = await import('../src/lib/naver_codes.js');
  const d = parseInitialData('<html>oInitialData.oCategoryList = [broken;</html>');
  assert.deepEqual(d.categoryNames, {});
  assert.deepEqual(d.calendars, []);
  assert.deepEqual(d.timetables, []);
  assert.equal(d.today, null);
});

test('fetchNaverCodes: also returns initialData from the main page', async () => {
  const f = mock({
    'https://calendar.naver.com/main': { body: MAIN_HTML },
    'https://calendar.naver.com/data/colors?lc=ko&ts=5&lm=6': { body: JSON.stringify(bundled) },
  });
  const r = await fetchNaverCodes(f);
  assert.equal(Object.keys(r.colors).length, 35);
  assert.equal(r.initialData.categoryNames[22], '학원');
  assert.equal(r.initialData.timetables.length, 1);
});

test('codesFromPage: pure assembly from page html + colors/stickers text (tab fallback path)', async () => {
  const { codesFromPage } = await import('../src/lib/naver_codes.js');
  const r = codesFromPage({ html: MAIN_HTML, colorsText: JSON.stringify(bundled), stickersText: null });
  assert.equal(Object.keys(r.colors).length, 35);
  assert.equal(r.stickers, null);
  assert.equal(r.initialData.categoryNames[22], '학원');
  assert.deepEqual(r.errors, []);
  const bad = codesFromPage({ html: MAIN_HTML, colorsText: '<html>login</html>', stickersText: null });
  assert.equal(bad.colors, null);
  assert.ok(bad.errors.length);
  const login = codesFromPage({ html: "<script>location.replace('https://nid.naver.com/nidlogin.login')</script>", colorsText: null });
  assert.equal(login.initialData, null);
  assert.match(login.errors.join(' '), /로그인/);
});

test('isLoginRedirect: only the tiny redirect page, not a logged-in page that merely links to nidlogin', async () => {
  const { isLoginRedirect } = await import('../src/lib/naver_codes.js');
  assert.equal(isLoginRedirect("<script>target.location.replace('https://nid.naver.com/nidlogin.login?mode=form&url=x');</script>"), true);
  assert.equal(isLoginRedirect('<script>location.replace("https://nid.naver.com/nidlogin.login")</script>'), true);
  assert.equal(isLoginRedirect(MAIN_HTML + '<a href="https://nid.naver.com/nidlogin.logout">로그아웃</a><a href="https://nid.naver.com/nidlogin.login">로그인</a>'), false);
});

test('fetchNaverCodes: colors URL absent from HTML → tries /data/colors?lc=<lang> without ts/lm', async () => {
  const html = MAIN_HTML.replace('"/data/colors?lc=ko&ts=5&lm=6"', '');
  const f = mock({
    'https://calendar.naver.com/main': { body: html },
    'https://calendar.naver.com/data/colors?lc=ko': { body: JSON.stringify(bundled) },
  });
  const r = await fetchNaverCodes(f);
  assert.equal(Object.keys(r.colors).length, 35);
  assert.deepEqual(r.errors, []);
});

test('fetchNaverCodes: fallback URL also fails → colors null with error, categories still returned', async () => {
  const html = MAIN_HTML.replace('"/data/colors?lc=ko&ts=5&lm=6"', '');
  const f = mock({ 'https://calendar.naver.com/main': { body: html } });
  const r = await fetchNaverCodes(f);
  assert.equal(r.colors, null);
  assert.equal(r.initialData.categoryNames[22], '학원');
  assert.ok(r.errors.length);
});
