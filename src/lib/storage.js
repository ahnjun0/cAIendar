// chrome.storage.local 접근. 자격증명은 local에만 두고 sync는 쓰지 않는다.
import { PRESETS } from './caldav.js';
import { DEFAULT_LLM } from './llm.js';

export const DEFAULT_SETTINGS = {
  caldav: { preset: 'naver', baseUrl: PRESETS.naver, username: '', password: '', defaultCalendarUrl: '' },
  llm: { ...DEFAULT_LLM },
};

const area = () => globalThis.chrome?.storage?.local;

export async function getSettings() {
  const { settings } = await area().get('settings');
  return {
    caldav: { ...DEFAULT_SETTINGS.caldav, ...(settings?.caldav ?? {}) },
    llm: { ...DEFAULT_SETTINGS.llm, ...(settings?.llm ?? {}) },
  };
}

export async function saveSettings(settings) {
  await area().set({ settings });
}

export async function getCalendarsCache() {
  const { calendars } = await area().get('calendars');
  // kind 가 없는 것은 0.6.0 이전 캐시 → 호출자가 다시 읽도록 그대로 돌려준다
  return calendars ?? [];
}
export async function setCalendarsCache(calendars) {
  await area().set({ calendars });
}

export const MAX_BATCHES = 50;      // 등록 기록 보관 개수
const MAX_DRAFT_DOC = 60_000;       // 임시 저장에 담는 첨부 문서 길이 상한

/**
 * 작성 중인 내용 (팝업을 닫아도 남는다).
 * @returns {Promise<null|{input, plan, doc, calendarUrl, todoCalendarUrl, at}>}
 */
export async function getDraft() {
  const { draft } = await area().get('draft');
  return draft ?? null;
}

export async function saveDraft(draft) {
  const doc = draft.doc
    ? { ...draft.doc, text: String(draft.doc.text ?? '').slice(0, MAX_DRAFT_DOC), truncated: String(draft.doc.text ?? '').length > MAX_DRAFT_DOC }
    : null;
  await area().set({ draft: { ...draft, doc, at: new Date().toISOString() } });
}

export async function clearDraft() {
  await area().remove('draft');
}

/** 등록 배치 (되돌리기·기록용). 최근 것이 앞에 */
export async function getBatches() {
  const { batches } = await area().get('batches');
  return batches ?? [];
}
export async function removeBatch(id) {
  const batches = (await getBatches()).filter((b) => b.id !== id);
  await area().set({ batches });
}
/** 있으면 덮어쓰고 없으면 새로 넣는다. 등록 도중 중단돼도 되돌릴 수 있도록 건건이 저장할 때 쓴다 */
export async function saveBatch(batch) {
  const batches = await getBatches();
  const i = batches.findIndex((b) => b.id === batch.id);
  if (i >= 0) batches[i] = batch; else batches.unshift(batch);
  await area().set({ batches: batches.slice(0, MAX_BATCHES) });
}

export async function updateBatch(batch) {
  const batches = (await getBatches()).map((b) => (b.id === batch.id ? batch : b));
  await area().set({ batches });
}

/** 네이버 색상표 캐시 {id: '#rrggbb'} */
export async function getColorMap() {
  const { colorMap } = await area().get('colorMap');
  return colorMap ?? null;
}
export async function setColorMap(colorMap) {
  await area().set({ colorMap, colorMapAt: new Date().toISOString() });
}

export async function setStickerMap(stickerMap) {
  await area().set({ stickerMap, stickerMapAt: new Date().toISOString() });
}

/** /main oInitialData 에서 뽑은 메타 (카테고리 이름, 캘린더 id, 시간표 학기) */
export async function getNaverMeta() {
  const { naverMeta } = await area().get('naverMeta');
  return naverMeta ?? null;
}
export async function setNaverMeta(meta) {
  await area().set({ naverMeta: { ...meta, at: new Date().toISOString() } });
}
