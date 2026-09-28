import { explainHttp, explainNetwork, toMessage } from './errors.js';
// 네이버 코드표(색상·스티커) 읽기 — 읽기 전용, 선택 기능.
// 실패해도 등록 경로에 영향이 없어야 하므로 이 모듈은 절대 throw 하지 않고 {colors, stickers, errors}를 돌려준다.
// ts/lm은 버전 값이라 하드코딩하지 않고 calendar.naver.com HTML에서 매번 찾는다.
import { COLOR_HEX } from './schema.js';

export const LOGIN_MSG = '네이버에 로그인되어 있지 않습니다. 같은 브라우저에서 calendar.naver.com 에 로그인한 뒤 다시 시도하세요.';
export const NAVER_ORIGIN = 'https://calendar.naver.com/';
// 루트(/)는 리다이렉트를 거쳐 워커 fetch가 실패하는 경우가 있어(실측) 로그인 후 실제 페이지인 /main 을 직접 부른다
export const NAVER_HOME = 'https://calendar.naver.com/main';

/** 번들 기본값 (reference/colors.json == schema.js COLOR_HEX) */
export function bundledColorMap() {
  return Object.fromEntries(Object.entries(COLOR_HEX).map(([id, hex]) => [id, `#${hex}`]));
}

/** HTML에서 /data/{kind}?... URL을 찾아 절대 URL로. 없으면 null */
export function findCodeUrl(html, kind) {
  const text = String(html).replace(/\\\//g, '/').replace(/&amp;/g, '&');
  const m = text.match(new RegExp(`(?:https?://calendar\\.naver\\.com)?/data/${kind}\\?[A-Za-z0-9_=&.%-]+`));
  if (!m) return null;
  return new URL(m[0], NAVER_ORIGIN).toString();
}

/** [{colorId, colorCode}] → {id: '#rrggbb'}; 형식이 이상하면 null */
export function parseColors(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  const out = {};
  for (const it of arr) {
    const id = Number(it?.colorId);
    const code = String(it?.colorCode ?? '').replace(/^#/, '').toLowerCase();
    if (!Number.isInteger(id) || !/^[0-9a-f]{6}$/.test(code)) return null;
    out[id] = `#${code}`;
  }
  return out;
}

/** 스티커 목록은 미검증 엔드포인트 — 형식을 느슨하게 받고 id → 이미지 URL만 뽑는다 */
export function parseStickers(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  const out = {};
  for (const it of arr) {
    const id = Number(it?.stickerId ?? it?.id);
    const url = it?.imageUrl ?? it?.url ?? it?.image ?? '';
    if (Number.isInteger(id)) out[id] = String(url);
  }
  return Object.keys(out).length ? out : null;
}

/** 'oInitialData.NAME = <JSON>;' 블록 하나를 JSON으로. 없거나 깨졌으면 null */
function initialBlock(html, name) {
  const m = String(html).match(new RegExp(`oInitialData\\.${name}\\s*=\\s*([\\[{][\\s\\S]*?)\\s*;\\s*\\n`));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/**
 * 로그인 후 /main HTML의 oInitialData에서 CalDAV로는 알 수 없는 것들을 뽑는다 (읽기 전용).
 * - categoryNames: 색상 id → 사용자가 붙인 카테고리 이름 (oCategoryList)
 * - calendars: calendarId ↔ 이름 ↔ 색 (CalDAV URL 끝이 calendarId)
 * - timetables: 시간표 학기 시작/종료일 (until 기본값용)
 */
export function parseInitialData(html) {
  const out = { categoryNames: {}, calendars: [], timetables: [], today: null, defaultCalendarId: null, language: null };
  const cats = initialBlock(html, 'oCategoryList');
  if (Array.isArray(cats)) {
    for (const c of cats) {
      const id = Number(c?.categoryColor ?? c?.categoryId);
      const name = String(c?.categoryName ?? '').trim();
      if (Number.isInteger(id) && name) out.categoryNames[id] = name;
    }
  }
  const cals = initialBlock(html, 'aCalendarList');
  if (Array.isArray(cals)) {
    out.calendars = cals.filter((c) => c?.calendarId).map((c) => ({
      calendarId: String(c.calendarId), name: String(c.name ?? ''), colorId: Number(c.color?.colorId) || null, isTimetable: Boolean(c.isTimetable),
    }));
  }
  const tts = initialBlock(html, 'aTimetableList');
  if (Array.isArray(tts)) {
    out.timetables = tts.filter((t) => t?.calendarId).map((t) => ({
      calendarId: String(t.calendarId),
      name: out.calendars.find((c) => c.calendarId === String(t.calendarId))?.name ?? '',
      semesterStartDate: t.semesterStartDate ?? null, semesterEndDate: t.semesterEndDate ?? null,
    }));
  }
  const cfg = initialBlock(html, 'oConfig');
  if (cfg && typeof cfg === 'object') {
    out.today = typeof cfg.today === 'string' ? cfg.today.slice(0, 10) : null;
    out.defaultCalendarId = cfg.defaultCalendarId ? String(cfg.defaultCalendarId) : null;
    out.language = typeof cfg.language === 'string' ? cfg.language : null;
  }
  return out;
}

// 네이버 캘린더는 비로그인이면 location.replace('https://nid.naver.com/nidlogin.login?...') 한 줄짜리 HTML을 돌려준다.
// 로그인된 페이지에도 로그인/로그아웃 링크로 같은 호스트가 들어 있으므로 반드시 location.replace 형태로만 판정한다.
export const isLoginRedirect = (html) => /location\.replace\(\s*['"]https:\/\/nid\.naver\.com\/nidlogin/.test(String(html));

// 확장의 host_permissions(calendar.naver.com) 덕에 사용자의 네이버 로그인 쿠키가 함께 간다 (읽기 전용 GET만)
const OPTS = { credentials: 'include' };

async function getText(fetchFn, url) {
  let res;
  try {
    res = await fetchFn(url, OPTS);
  } catch (e) {
    throw new Error(toMessage(explainNetwork(e, 'naver')));
  }
  if (!res.ok) throw new Error(toMessage(explainHttp({ status: res.status, service: 'naver' })));
  return res.text();
}

function parseJsonText(text) {
  if (text.startsWith('__ERR__')) throw new Error(text.slice(7));
  if (isLoginRedirect(text)) throw new Error(LOGIN_MSG);
  try { return JSON.parse(text); } catch { throw new Error('JSON이 아닌 응답이 왔습니다 (페이지 구조가 바뀌었을 수 있습니다)'); }
}

/**
 * 페이지 HTML + 색상/스티커 응답 텍스트 → 결과 조립 (순수 함수).
 * 워커 fetch 경로와 탭 안에서 읽어온 경로가 모두 이 함수를 쓴다.
 */
export function codesFromPage({ html, colorsText = null, stickersText = null }) {
  const out = { colors: null, stickers: null, initialData: null, errors: [] };
  if (isLoginRedirect(html)) { out.errors.push(LOGIN_MSG); return out; }
  out.initialData = parseInitialData(html);
  if (colorsText === null) out.errors.push('HTML에서 /data/colors URL을 찾지 못했습니다 (페이지 구조 변경?)');
  else {
    try {
      out.colors = parseColors(parseJsonText(colorsText));
      if (!out.colors) out.errors.push('색상표 형식이 예상과 다릅니다');
    } catch (e) { out.errors.push(`색상표 읽기 실패: ${e.message}`); }
  }
  if (stickersText !== null) {
    try { out.stickers = parseStickers(parseJsonText(stickersText)); } catch (e) { out.errors.push(`스티커표 읽기 실패: ${e.message}`); }
  }
  return out;
}

/**
 * @returns {Promise<{colors: object|null, stickers: object|null, initialData: object|null, errors: string[]}>}
 */
export async function fetchNaverCodes(fetchFn = (...a) => globalThis.fetch(...a)) {
  let html;
  try {
    html = await getText(fetchFn, NAVER_HOME);
  } catch (e) {
    return { colors: null, stickers: null, initialData: null, errors: [`calendar.naver.com 읽기 실패: ${e.message}`] };
  }
  if (isLoginRedirect(html)) return codesFromPage({ html });
  const fetchOpt = async (url) => { try { return url ? await getText(fetchFn, url) : null; } catch (e) { return `__ERR__${e.message}`; } };
  let colorsText = await fetchOpt(findCodeUrl(html, 'colors'));
  if (colorsText === null) {
    // HTML에 URL이 없으면(페이지 JS가 만들어 요청함) ts/lm 없이 시도. 실패하면 background가 탭 안에서 다시 찾는다
    const lang = parseInitialData(html).language ?? 'ko';
    colorsText = await fetchOpt(`${NAVER_ORIGIN}data/colors?lc=${encodeURIComponent(lang)}`);
  }
  const stickersText = await fetchOpt(findCodeUrl(html, 'stickers'));
  return codesFromPage({ html, colorsText, stickersText });
}
