// 내부 표현 → iCalendar (reference/naver_cal.py to_ics 포팅) + 네이버 응답 파서.
// LLM은 여기 관여하지 않는다. 결정적 코드만.
import { fmtLocal } from './schema.js';

export const PRODID = '-//caiendar//KO';

/** RFC 5545 TEXT 이스케이프 */
export function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// 네이버가 시각 일정에 함께 보내는 VTIMEZONE 블록 (RFC 5545는 TZID 참조 시 동봉을 요구)
export const VTIMEZONE_SEOUL = [
  'BEGIN:VTIMEZONE', 'TZID:Asia/Seoul', 'X-LIC-LOCATION:Asia/Seoul',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900',
  'TZNAME:KST', 'DTSTART:19700101T000000', 'END:STANDARD', 'END:VTIMEZONE',
];

const enc = new TextEncoder();
const byteLen = (s) => enc.encode(s).length;

/**
 * 75옥텟 초과 줄 접기. 문자(코드포인트) 단위로 잘라 UTF-8 경계를 깨지 않는다.
 * 이어지는 줄은 공백 1개로 시작 (그 공백까지 포함해 75옥텟 이내).
 */
export function foldLine(line) {
  if (byteLen(line) <= 75) return line;
  const out = [];
  let cur = '';
  let limit = 75;
  for (const ch of line) {
    if (byteLen(cur) + byteLen(ch) > limit) {
      out.push(cur);
      cur = ' ';
      limit = 75;
    }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}

/** 접힌 줄 펴기 (CRLF/LF 모두 허용) */
export function unfold(text) {
  return text.replace(/\r?\n[ \t]/g, '');
}

/** 줄 배열 → 접힘 처리 + CRLF + 끝 CRLF */
export function serialize(lines) {
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

const fmtUtcNow = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};

/**
 * Event → VCALENDAR 문자열 (VEVENT 1개).
 * @param {object} e parsePlan이 만든 이벤트
 * @param {{now?: Date, naverFields?: boolean}} opts naverFields=false면 X-NAVER-* 생략 (타 서버용)
 */
export function toICS(e, { now = new Date(), naverFields = true } = {}) {
  let ds, de;
  if (e.allDay) {
    ds = `DTSTART;VALUE=DATE:${fmtLocal(e.start, true)}`;
    de = `DTEND;VALUE=DATE:${fmtLocal(e.end, true)}`;
  } else {
    ds = `DTSTART;TZID=Asia/Seoul:${fmtLocal(e.start)}`;
    de = `DTEND;TZID=Asia/Seoul:${fmtLocal(e.end)}`;
  }
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PRODID}`, 'CALSCALE:GREGORIAN'];
  if (!e.allDay) lines.push(...VTIMEZONE_SEOUL);
  lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${fmtUtcNow(now)}`, ds, de, `SUMMARY:${esc(e.title)}`);
  if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
  if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
  if (e.rrule) lines.push(`RRULE:${e.rrule}`);
  if (naverFields) {
    if (e.color !== null && e.color !== undefined) lines.push(`X-NAVER-CATEGORY-COLOR:${Number(e.color)}`); // 네이버 전용: 색상
    if (e.sticker !== null && e.sticker !== undefined) lines.push(`X-NAVER-STICKER;X-WORKSMOBILE-POS=0:${Number(e.sticker)}`); // 네이버 전용: 스티커
  }
  if (e.alarmMin !== null && e.alarmMin !== undefined) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, `TRIGGER:-PT${Number(e.alarmMin)}M`, 'END:VALARM');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return serialize(lines);
}

/**
 * 할 일 → VCALENDAR(VTODO) 하나. 네이버 '할 일' 캘린더(components=[VTODO])에 PUT 한다.
 * 실측: DUE;VALUE=DATE, STATUS, PRIORITY, X-NAVER-TASK-GROUP-ID, X-NAVER-CATEGORY-COLOR.
 * X-NAVER-REGISTERER / ORGANIZER / X-NAVER-LAST-MODIFIER 는 서버가 채우므로 보내지 않는다.
 */
export function toVTODO(t, { now = new Date(), naverFields = true } = {}) {
  const due = t.dueDateOnly
    ? `DUE;VALUE=DATE:${fmtLocal(t.due, true)}`
    : `DUE;TZID=Asia/Seoul:${fmtLocal(t.due)}`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PRODID}`, 'CALSCALE:GREGORIAN'];
  if (!t.dueDateOnly) lines.push(...VTIMEZONE_SEOUL);
  lines.push('BEGIN:VTODO', `UID:${t.uid}`, `DTSTAMP:${fmtUtcNow(now)}`, due, `SUMMARY:${esc(t.title)}`);
  if (t.description) lines.push(`DESCRIPTION:${esc(t.description)}`);
  lines.push(`STATUS:${t.done ? 'COMPLETED' : 'NEEDS-ACTION'}`);
  if (t.priority) lines.push(`PRIORITY:${Number(t.priority)}`);
  if (naverFields) {
    if (t.group !== null && t.group !== undefined) lines.push(`X-NAVER-TASK-GROUP-ID:${Number(t.group)}`);
    if (t.color !== null && t.color !== undefined) lines.push(`X-NAVER-CATEGORY-COLOR:${Number(t.color)}`);
  }
  lines.push('END:VTODO', 'END:VCALENDAR');
  return serialize(lines);
}

/**
 * 여러 일정 → VCALENDAR 하나 (CalDAV가 없는 서비스의 '일정 가져오기'용). naver_cal.py cmd_export 포팅.
 * 기본적으로 X-NAVER-* 는 넣지 않는다 (다른 서비스는 무시하지만 굳이 보낼 이유가 없다).
 */
export function exportICS(events, { now = new Date(), naverFields = false } = {}) {
  const body = [];
  for (const e of events) {
    const ls = toICS(e, { now, naverFields }).split('\r\n');
    body.push(...ls.slice(ls.indexOf('BEGIN:VEVENT'), ls.indexOf('END:VEVENT') + 1));
  }
  const tz = events.some((e) => !e.allDay) ? VTIMEZONE_SEOUL : [];
  // toICS 출력은 이미 접혀 있으므로 다시 접지 않는다
  return [...['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PRODID}`, 'CALSCALE:GREGORIAN'].map(foldLine), ...tz, ...body, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

// ---------- 파서 (서버가 돌려준 VCALENDAR 읽기) ----------

/** 'NAME;P1=v1;P2="v 2":value' → {name, params, value} */
export function parseContentLine(line) {
  let i = 0;
  let inQuote = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) break;
  }
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const [rawName, ...rawParams] = splitParams(head);
  const params = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"(.*)"$/, '$1');
  }
  return { name: rawName.toUpperCase(), params, value };
}

function splitParams(head) {
  const parts = [];
  let cur = '';
  let inQuote = false;
  for (const c of head) {
    if (c === '"') inQuote = !inQuote;
    if (c === ';' && !inQuote) { parts.push(cur); cur = ''; } else cur += c;
  }
  parts.push(cur);
  return parts;
}

export function unesc(s) {
  return String(s).replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

/**
 * VCALENDAR 텍스트 → { vevents: [...] }.
 * 각 VEVENT: {uid, summary, dtstart:{value,params}, dtend, rrule, recurrenceId, alarms:[props], props:{NAME:[{params,value}]}}
 * X-NAVER-* 등 모르는 속성은 props에 그대로 보존한다. RECURRENCE-ID가 있는 VEVENT는 예외 회차다.
 */
export function parseCalendar(text) {
  const lines = unfold(text.replace(/\r\n|\r|\n/g, '\r\n')).split('\r\n').filter((l) => l.length);
  const vevents = [];
  const vtodos = [];
  const stack = [];
  let cur = null;
  for (const line of lines) {
    const { name, params, value } = parseContentLine(line);
    if (name === 'BEGIN') {
      const comp = { type: value.toUpperCase(), props: {}, children: [] };
      if (cur) cur.children.push(comp);
      stack.push(comp);
      cur = comp;
      continue;
    }
    if (name === 'END') {
      const done = stack.pop();
      cur = stack[stack.length - 1] ?? null;
      if (done && done.type === 'VEVENT') vevents.push(toEvent(done));
      if (done && done.type === 'VTODO') vtodos.push(toTodo(done));
      continue;
    }
    if (!cur) continue;
    (cur.props[name] ??= []).push({ params, value });
  }
  return { vevents, vtodos };
}

function toTodo(comp) {
  const first = (n) => comp.props[n]?.[0] ?? null;
  return {
    uid: first('UID')?.value ?? '',
    summary: first('SUMMARY') ? unesc(first('SUMMARY').value) : '',
    description: first('DESCRIPTION') ? unesc(first('DESCRIPTION').value) : '',
    due: first('DUE') ? { value: first('DUE').value, params: first('DUE').params } : null,
    status: first('STATUS')?.value ?? '',
    priority: first('PRIORITY')?.value ?? '',
    props: comp.props,
  };
}

function toEvent(comp) {
  const first = (n) => comp.props[n]?.[0] ?? null;
  const prop = (n) => (first(n) ? { value: first(n).value, params: first(n).params } : null);
  return {
    uid: first('UID')?.value ?? '',
    summary: first('SUMMARY') ? unesc(first('SUMMARY').value) : '',
    location: first('LOCATION') ? unesc(first('LOCATION').value) : '',
    description: first('DESCRIPTION') ? unesc(first('DESCRIPTION').value) : '',
    dtstart: prop('DTSTART'),
    dtend: prop('DTEND'),
    rrule: first('RRULE')?.value ?? '',
    recurrenceId: prop('RECURRENCE-ID'),
    alarms: comp.children.filter((c) => c.type === 'VALARM').map((c) => c.props),
    props: comp.props,
  };
}

/** 예외 회차(RECURRENCE-ID)를 뺀 "진짜" 일정 목록 */
export function masterEvents(cal) {
  return cal.vevents.filter((v) => !v.recurrenceId);
}
