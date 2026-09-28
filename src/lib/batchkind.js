// 등록 기록의 항목이 일정인지 할 일인지 판단한다. 저장된 값만 본다 — 요약 문구로 넘겨짚지 않는다.
// v0.11.0 이전 기록에는 type 이, v0.12.0 이전 기록에는 plan 이 없어서 그때는 알 수 없다(null).

/**
 * @param {{type?: string, title?: string}} entry 기록의 항목
 * @param {{plan?: {events?: {kind?: string, title?: string}[]}}} [batch] 그 항목이 속한 배치
 * @returns {'todo'|'event'|null} 판단할 수 없으면 null
 */
export function kindOf(entry, batch = null) {
  if (entry?.type === 'todo' || entry?.type === 'event') return entry.type;
  const raw = batch?.plan?.events?.find((e) => e?.title === entry?.title);
  if (!raw) return null;
  return String(raw.kind ?? 'event').toLowerCase() === 'todo' ? 'todo' : 'event';
}
