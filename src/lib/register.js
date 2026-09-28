// 등록 오케스트레이션: plan JSON → 검증 → 중복 검사 → PUT → 배치 기록. 네트워크는 주입된 client로만.
import { parsePlan, fmtLocal, addMinutes, KST_OFFSET_MIN, describe, COLOR_HEX } from './schema.js';
import { toICS, toVTODO, parseCalendar, masterEvents } from './ical.js';

/** 일정과 할 일을 원래 plan.events 순서대로 되돌린다 (표의 행 순서와 맞추기 위해) */
function orderedItems(plan) {
  const { events, todos } = parsePlan(plan);
  let ei = 0;
  let ti = 0;
  return (plan.events ?? []).map((raw) => (String(raw?.kind ?? 'event').toLowerCase() === 'todo'
    ? { type: 'todo', item: todos[ti++] }
    : { type: 'event', item: events[ei++] }));
}

/** 할 일 미리보기 문구 */
export function describeTodo(t) {
  const d = fmtLocal(t.due, t.dueDateOnly);
  const when = t.dueDateOnly ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)} ${d.slice(9, 11)}:${d.slice(11, 13)}`;
  const extra = [t.priority ? `중요도 ${t.priority}` : '', t.color ? `(색 ${t.color}=#${COLOR_HEX[t.color]})` : ''].filter(Boolean).join(' ');
  return `${when}까지  ${t.title}  ${extra}`.trimEnd();
}

/** KST 벽시계 Date의 그 날 하루 → UTC time-range 문자열 */
export function dayRangeUtc(start) {
  const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const s = addMinutes(day, -KST_OFFSET_MIN);
  const e = addMinutes(s, 1440);
  return { start: `${fmtLocal(s)}Z`, end: `${fmtLocal(e)}Z` };
}

/** 같은 제목 + 같은 시작 날짜의 (예외 회차가 아닌) 일정이 있으면 중복 */
export function isDuplicate(event, cal) {
  const ymd = fmtLocal(event.start, true);
  return masterEvents(cal).some((v) => v.summary === event.title && (v.dtstart?.value ?? '').startsWith(ymd));
}

/** 'YYYYMMDDTHHMMSS' 의 시각 부분 → 자정 기준 분. 날짜만이면 null */
function minutesOfDay(v) {
  const m = /T(\d{2})(\d{2})/.exec(String(v ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * 같은 날 시각이 겹치는 기존 일정 (종일 일정은 양쪽 다 제외).
 * 반복 일정의 master는 DTSTART 날짜가 달라도 REPORT time-range에 걸린 것이므로 "그날 그 시각에 있다"고 보고 시각만 비교한다.
 * @returns {{summary: string, range: string}[]}
 */
export function overlapping(event, cal) {
  if (event.allDay) return [];
  const s = event.start.getUTCHours() * 60 + event.start.getUTCMinutes();
  const e = s + Math.round((event.end - event.start) / 60_000);
  const ymd = fmtLocal(event.start, true);
  const out = [];
  for (const v of masterEvents(cal)) {
    const vs = minutesOfDay(v.dtstart?.value);
    if (vs === null) continue; // 종일
    if (!v.rrule && !(v.dtstart.value ?? '').startsWith(ymd)) continue;
    let ve = minutesOfDay(v.dtend?.value);
    if (ve === null || ve <= vs) ve = vs + 60;
    if (s < ve && vs < e) out.push({ summary: v.summary, range: `${hhmm(vs)}~${hhmm(ve)}` });
  }
  return out;
}

/** 그날의 기존 일정을 날짜별로 한 번만 REPORT */
async function loadDays(client, calendarUrl, events) {
  const days = new Map();
  let unreadable = 0;
  for (const e of events) {
    const key = fmtLocal(e.start, true);
    if (days.has(key)) continue;
    const { start, end } = dayRangeUtc(e.start);
    const q = await client.queryEvents(calendarUrl, start, end);
    unreadable += q.unreadable.length;
    days.set(key, q.events.map((x) => parseCalendar(x.ics)));
  }
  return { days, unreadable };
}

/**
 * 등록 전 검사만 — PUT 없음. 표에 경고를 띄우기 위한 것.
 * @returns {{checks: {duplicate: boolean, overlaps: string[]}[], unreadable: number}}
 */
export async function preflight({ client, calendarUrl, plan }) {
  const items = orderedItems(plan);
  const { days, unreadable } = await loadDays(client, calendarUrl, items.filter((x) => x.type === 'event').map((x) => x.item));
  const checks = items.map(({ type, item }) => {
    // 할 일은 중복·겹침을 검사하지 않는다: 마감일 범위를 좁힐 수 없어 계정의 할 일 전체를 받아야 하고
    // (실측 807건) 얻는 이득보다 비용이 크다. 같은 마감의 할 일이 둘 생겨도 해가 없다.
    if (type === 'todo') return { duplicate: false, overlaps: [] };
    const cals = days.get(fmtLocal(item.start, true)) ?? [];
    const duplicate = cals.some((cal) => isDuplicate(item, cal));
    return {
      duplicate,
      // 중복으로 잡힌 같은 제목의 일정은 겹침으로 또 세지 않는다
      overlaps: cals.flatMap((cal) => overlapping(item, cal)).filter((o) => !(duplicate && o.summary === item.title)).map((o) => `${o.summary} ${o.range}`),
    };
  });
  return { checks, unreadable };
}

/**
 * @param {{client, calendarUrl, calendarName?, plan, allowDuplicate?, now?}} p
 * @returns {{added, skipped, failed:[{title,error}], unreadable:number, batch}}
 */
export async function registerEvents({ client, calendarUrl, calendarName = '', todoCalendarUrl = '', plan, allowDuplicate = false, now = new Date(), onProgress = null }) {
  const items = orderedItems(plan); // 어긋나면 여기서 던져서 아무것도 등록하지 않는다
  const events = items.filter((x) => x.type === 'event').map((x) => x.item);
  const added = [];
  const skipped = [];
  const failed = [];
  const naverFields = client.isNaver !== false;
  const batchId = `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
  const { days, unreadable } = await loadDays(client, calendarUrl, events); // 같은 날짜는 REPORT 한 번만

  // 실제로 등록된 항목만 원본 JSON 으로 보관한다 → 팝업에서 "불러와 고치기"에 쓴다
  const buildBatch = () => {
    const addedUids = new Set(added.map((a) => a.uid));
    return {
      id: batchId,
      at: now.toISOString(),
      calendarUrl,
      calendarName,
      todoCalendarUrl,
      plan: { ...plan, events: (plan.events ?? []).filter((_, i) => addedUids.has(items[i]?.item?.uid)) },
      events: added.map(({ uid, href, title, summary, type }) => ({ uid, href, title, summary, type })),
    };
  };

  for (const { type, item } of items) {
    const summary = type === 'todo' ? describeTodo(item) : describe(item);
    const row = { uid: item.uid, title: item.title, summary, type };
    if (type === 'todo' && !todoCalendarUrl) {
      failed.push({ ...row, error: '할 일 캘린더가 지정되지 않았습니다 (네이버의 VTODO 캘린더를 골라 주세요)' });
      continue;
    }
    // 할 일은 중복 검사 없이 그대로 등록한다 (위 preflight 주석 참고)
    const dup = type === 'event' && (days.get(fmtLocal(item.start, true)) ?? []).some((cal) => isDuplicate(item, cal));
    if (!allowDuplicate && dup) { skipped.push(row); continue; }
    try {
      const url = type === 'todo' ? todoCalendarUrl : calendarUrl;
      const body = type === 'todo' ? toVTODO(item, { now, naverFields }) : toICS(item, { now, naverFields });
      const { href } = await client.putEvent(url, item.uid, body);
      added.push({ ...row, href });
      // 한 건 성공할 때마다 알린다 → 호출자가 저장해 두면 도중에 중단돼도 되돌릴 수 있다
      if (onProgress) { try { onProgress(buildBatch()); } catch { /* 저장 실패가 등록을 막지 않는다 */ } }
    } catch (err) {
      failed.push({ ...row, error: err.message });
    }
  }

  return { added, skipped, failed, unreadable, batch: buildBatch() };
}
