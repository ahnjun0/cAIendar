// service worker — 메시지 라우팅. 네트워크(CalDAV, LLM)는 전부 여기서 나간다.
import { CalDAVClient } from './lib/caldav.js';
import { convertToPlan } from './lib/llm.js';
import { registerEvents, preflight } from './lib/register.js';
import { fetchNaverCodes } from './lib/naver_codes.js';
import { getSettings, getCalendarsCache, setCalendarsCache, getBatches, saveBatch, removeBatch, updateBatch, setColorMap, setStickerMap, setNaverMeta, getNaverMeta } from './lib/storage.js';

async function client() {
  const { caldav } = await getSettings();
  if (!caldav.username || !caldav.password) {
    throw new Error('네이버 아이디와 애플리케이션 비밀번호가 설정되지 않았습니다. 설정 화면에서 입력해 주세요.');
  }
  return new CalDAVClient({ baseUrl: caldav.baseUrl, username: caldav.username, password: caldav.password });
}

/** 오늘 날짜 (KST) 'YYYY-MM-DD (요일)' */
function todayKST() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const dow = '일월화수목금토'[d.getUTCDay()];
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} (${dow})`;
}

const VERSION = chrome.runtime.getManifest().version;

const handlers = {
  /** 워커가 어떤 버전으로 돌고 있는지 확인용 */
  async ping() { return { version: VERSION, handlers: Object.keys(handlers) }; },

  async listCalendars({ refresh = false } = {}) {
    if (!refresh) {
      const cached = await getCalendarsCache();
      if (cached.length) return cached;
    }
    const cals = await (await client()).discoverCalendars();
    await setCalendarsCache(cals);
    return cals;
  },

  async convert({ text }) {
    const { llm } = await getSettings();
    if (!llm.apiKey) throw new Error('AI 공급자 API 키가 설정되지 않았습니다. 설정 화면에서 입력해 주세요.');
    if (!text.trim()) throw new Error('변환할 내용이 없습니다.');
    try {
      const r = await convertToPlan({ text, settings: llm, today: todayKST() });
      return { ok: true, plan: r.plan, attempts: r.attempts };
    } catch (e) {
      if (e.name === 'LLMError') return { ok: false, error: e.message, raw: e.raw ?? '' };
      throw e;
    }
  },

  /** 등록 전 검사 (PUT 없음): 중복·시각 겹침 */
  async preflight({ calendarUrl, plan }) {
    return preflight({ client: await client(), calendarUrl, plan });
  },

  async register({ calendarUrl, calendarName, todoCalendarUrl, plan, allowDuplicate }) {
    const c = await client();
    // 한 건 등록될 때마다 기록을 갱신한다 → 워커가 중간에 종료돼도 되돌리기가 가능하다
    let pending = Promise.resolve();
    const r = await registerEvents({
      client: c, calendarUrl, calendarName, todoCalendarUrl, plan, allowDuplicate,
      onProgress: (batch) => { pending = pending.then(() => saveBatch(batch)).catch(() => {}); },
    });
    await pending;
    if (r.batch.events.length) await saveBatch(r.batch);
    return r;
  },

  /** 네이버 코드표 갱신 (본인 계정 설정을 읽기만 하는 GET). 실패해도 throw 하지 않고 errors로 알린다 */
  async refreshNaverCodes() {
    const r = await fetchNaverCodes();
    if (r.colors) await setColorMap(r.colors);
    if (r.stickers) await setStickerMap(r.stickers);
    if (r.initialData) await setNaverMeta(r.initialData);
    return { categories: Object.keys(r.initialData?.categoryNames ?? {}).length, colors: r.colors ? Object.keys(r.colors).length : 0, stickers: r.stickers ? Object.keys(r.stickers).length : 0, errors: r.errors };
  },

  async listBatches() {
    return getBatches();
  },

  /** 배치의 일정을 DELETE. 일부 실패하면 남은 것만 배치에 남긴다 */
  async undo({ batchId }) {
    const batch = (await getBatches()).find((b) => b.id === batchId);
    if (!batch) throw new Error('되돌릴 기록이 없습니다.');
    const c = await client();
    const deleted = [];
    const failed = [];
    for (const ev of batch.events) {
      try { await c.deleteEvent(ev.href); deleted.push(ev); } catch (e) { failed.push({ ...ev, error: e.message }); }
    }
    if (failed.length) await updateBatch({ ...batch, events: failed });
    else await removeBatch(batchId);
    return { deleted, failed };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const fn = handlers[msg?.type];
  if (!fn) { sendResponse({ ok: false, error: `알 수 없는 메시지: ${msg?.type} (워커 v${VERSION}). 확장을 새로고침하면 워커가 최신 코드로 교체됩니다.` }); return false; }
  fn(msg.payload ?? {})
    .then((result) => sendResponse({ ok: true, result }))
    .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) || '알 수 없는 오류가 발생했습니다.' }));
  return true; // 비동기 응답
});
