// 입력 소스(현재 탭 본문, PDF 텍스트)를 LLM 입력으로 합치는 순수 함수. 네트워크·DOM 없음.

export const MAX_DOC_CHARS = 30_000; // qwen-plus 등 128k 컨텍스트에 여유 있게

/** 공백 뭉치·빈 줄 정리 */
export function cleanPageText(s) {
  return String(s).replace(/\r/g, '').split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** pdf.js getTextContent().items → 줄 구조를 살린 텍스트 (y 좌표가 크게 바뀌면 줄바꿈) */
export function pdfItemsToText(items) {
  let out = '';
  let lastY = null;
  for (const it of items) {
    if (!('str' in it)) continue;
    const y = it.transform?.[5];
    const jumped = lastY !== null && y !== undefined && Math.abs(y - lastY) > 3;
    if (jumped && !out.endsWith('\n')) out += '\n';
    else if (!jumped && out && !out.endsWith('\n') && it.str) out += ' ';
    out += it.str;
    if (it.hasEOL) out += '\n';
    if (y !== undefined) lastY = y;
  }
  return cleanPageText(out);
}

/**
 * @param {string} userText 사용자가 적은 지시/계획
 * @param {{kind: 'tab'|'pdf', label: string, text: string}|null} doc 첨부 문서
 */
export function composeInput(userText, doc) {
  const u = String(userText ?? '').trim();
  if (!doc || !doc.text) return u;
  let body = cleanPageText(doc.text);
  let note = '';
  if (body.length > MAX_DOC_CHARS) { body = body.slice(0, MAX_DOC_CHARS); note = '\n…(문서가 길어 뒷부분 잘림)'; }
  const instruction = u || '아래 첨부 문서에 있는 일정(수업, 마감, 행사 등)을 모두 찾아 일정 JSON으로 만든다. 문서의 설명문은 무시하고 날짜·시간이 있는 항목만 뽑는다.';
  return `${instruction}\n\n[첨부 문서: ${doc.label}]\n${body}${note}\n[첨부 문서 끝]`;
}

// ---------- 출처·특이사항·서명 ----------

export const SIGNATURE = 'cAIendar로 등록됨';
const MAX_LABEL = 100;

const ymd = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

/**
 * 일정·할 일의 설명에 특이사항(_note) · 출처 · 서명을 덧붙인다. LLM이 아니라 여기서 결정적으로 붙인다.
 * 원본 plan 은 건드리지 않고 새 객체를 돌려준다. 같은 plan 에 두 번 적용해도 서명이 중복되지 않는다.
 * @param {object} plan 스키마 그대로의 plan
 * @param {{source?: string, today?: Date}} opts source: 첨부 문서 이름(탭 제목/파일명)
 */
export function addProvenance(plan, { source = '', today = new Date() } = {}) {
  const kstToday = new Date(today.getTime() + 9 * 3600 * 1000);
  const sign = `${SIGNATURE} (${ymd(kstToday)})`;
  const label = source.length > MAX_LABEL ? `${source.slice(0, MAX_LABEL)}…` : source;
  const events = (plan.events ?? []).map((raw) => {
    const { _note, ...ev } = raw;
    const lines = [];
    const base = String(ev.description ?? '').trim();
    // 이미 붙인 줄은 다시 붙이지 않는다 (JSON 편집 후 재등록, 재시도 등)
    const kept = base.split(/\r?\n/).filter((l) => !l.startsWith(SIGNATURE) && !l.startsWith('특이사항: ') && !l.startsWith('출처: ')).join('\n').trim();
    if (kept) lines.push(kept);
    if (_note) lines.push(`특이사항: ${String(_note).trim()}`);
    if (label) lines.push(`출처: ${label}`);
    lines.push(sign);
    return { ...ev, description: lines.join('\n') };
  });
  return { ...plan, events };
}
