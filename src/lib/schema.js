// 일정 JSON → 내부 표현 (검증 포함). reference/naver_cal.py 의 parse_plan / _rrule / color_id 포팅.
// 스키마는 reference/SCHEMA.md 를 그대로 따른다. 새로 설계하지 않는다.
//
// 날짜/시각 표현: "Asia/Seoul 벽시계 값"을 Date 객체의 UTC 필드에 담아 다룬다.
// (실행 환경의 로컬 타임존에 영향받지 않고, 분/일 더하기가 단순해진다)

export class BadPlan extends Error {
  constructor(msg) { super(msg); this.name = 'BadPlan'; }
}

export const KST_OFFSET_MIN = 9 * 60;
export const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
export const KO_DAYS = { 월: 'MO', 화: 'TU', 수: 'WE', 목: 'TH', 금: 'FR', 토: 'SA', 일: 'SU' };

// 네이버 색상표 (calendar.naver.com/data/colors 실측). 7계열 × 5단계, 각 계열은 진한 → 연한 순
export const COLOR_HEX = {
  1: 'b93b4f', 2: 'e4617a', 3: 'fe90a9', 4: 'fdd6de', 5: 'ffecf1',
  6: 'af5131', 7: 'e0744e', 8: 'fa9a7a', 9: 'fedac9', 10: 'ffefe1',
  11: 'a7741c', 12: 'daa12b', 13: 'f5d064', 14: 'f9eeac', 15: 'fcf8cf',
  16: '167364', 17: '26aa85', 18: '69d4a5', 19: 'cdf4d4', 20: 'ebfae3',
  21: '343fa6', 22: '506ee2', 23: '7fa9fd', 24: 'cce2ff', 25: 'e8f4ff',
  26: '6024b0', 27: '8d4de2', 28: 'ba8ef4', 29: 'e3d1fa', 30: 'f8eaff',
  31: '5e6068', 32: '777d85', 33: 'a8aeb2', 34: 'd9dbdb', 35: 'efefef',
};
export const COLOR_GROUPS = { // 계열 이름 → 시작 id (기본은 2번째로 진한 색)
  빨강: 1, red: 1, 분홍: 1, pink: 1,
  주황: 6, orange: 6,
  노랑: 11, yellow: 11,
  초록: 16, green: 16,
  파랑: 21, blue: 21,
  보라: 26, purple: 26,
  회색: 31, gray: 31, grey: 31,
};

/** 12 같은 숫자, '파랑' 같은 계열 이름, '파랑3' 같은 단계 지정을 모두 받는다. */
export function colorId(v) {
  if (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v.trim()))) {
    const n = Number(v);
    if (!COLOR_HEX[n]) throw new BadPlan(`color: 1~35 범위여야 함 (받은 값 ${n})`);
    return n;
  }
  let name = String(v).trim().toLowerCase();
  let step = 2;
  if (name && /\d$/.test(name)) {
    step = Number(name.slice(-1));
    name = name.slice(0, -1).trim();
  }
  if (!(name in COLOR_GROUPS)) {
    const names = [...new Set(Object.keys(COLOR_GROUPS))].sort().join(', ');
    throw new BadPlan(`color: 알 수 없는 색 '${v}'. 가능한 값: ${names}`);
  }
  if (step < 1 || step > 5) throw new BadPlan(`color: 단계는 1~5 (받은 값 ${step})`);
  return COLOR_GROUPS[name] + step - 1;
}

// ---------- 날짜 파싱 (벽시계 UTC-필드 Date) ----------

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 'YYYY-MM-DD' → {date, allDay:true} / 'YYYY-MM-DDTHH:MM[:SS]' → {date, allDay:false} */
export function parseDt(v, fieldName) {
  if (typeof v !== 'string') throw new BadPlan(`${fieldName}: 문자열이어야 함`);
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  if (!m) throw new BadPlan(`${fieldName}: 날짜 형식이 잘못됨 '${v}' (YYYY-MM-DD 또는 YYYY-MM-DDTHH:MM)`);
  const [, Y, M, D, h, mi, s] = m.map((x) => (x === undefined ? undefined : Number(x)));
  const dateOnly = h === undefined;
  const d = new Date(Date.UTC(Y, M - 1, D, h ?? 0, mi ?? 0, s ?? 0));
  const valid = d.getUTCFullYear() === Y && d.getUTCMonth() === M - 1 && d.getUTCDate() === D
    && (dateOnly || (d.getUTCHours() === h && d.getUTCMinutes() === mi && d.getUTCSeconds() === (s ?? 0)));
  if (!valid) throw new BadPlan(`${fieldName}: 존재하지 않는 날짜/시각 '${v}'`);
  return { date: d, dateOnly };
}

export const addMinutes = (d, n) => new Date(d.getTime() + n * 60_000);
export const addDays = (d, n) => addMinutes(d, n * 1440);

/** 벽시계 Date → 'YYYYMMDD' (allDay) 또는 'YYYYMMDDTHHMMSS' */
export function fmtLocal(d, dateOnly = false) {
  const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  if (dateOnly) return ymd;
  return `${ymd}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

/** KST 벽시계 Date → 'YYYYMMDDTHHMMSSZ' (UTC) */
export function fmtUtcFromKst(d) {
  return `${fmtLocal(addMinutes(d, -KST_OFFSET_MIN), false)}Z`;
}

// ---------- RRULE ----------

/** repeat 객체 또는 rrule 문자열 → RRULE 값 (naver_cal.py _rrule 포팅) */
export function buildRRule(rep) {
  if (typeof rep === 'string') return rep.replace(/^RRULE:/, '');
  const freq = String(rep.freq ?? 'weekly').toUpperCase();
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) throw new BadPlan(`repeat.freq 값이 잘못됨: ${freq}`);
  const parts = [`FREQ=${freq}`];
  const interval = rep.interval ?? 1;
  if (Number(interval) !== 1) {
    if (!Number.isInteger(Number(interval)) || Number(interval) < 1) throw new BadPlan(`repeat.interval 값이 잘못됨: ${interval}`);
    parts.push(`INTERVAL=${Number(interval)}`);
  }
  if (rep.byday && rep.byday.length) {
    const codes = rep.byday.map((d) => KO_DAYS[d] ?? String(d).toUpperCase().slice(0, 2));
    const bad = codes.filter((c) => !DAYS.includes(c));
    if (bad.length) throw new BadPlan(`repeat.byday 값이 잘못됨: ${JSON.stringify(bad)}`);
    parts.push(`BYDAY=${codes.join(',')}`);
  }
  if (rep.until) {
    let { date: u, dateOnly } = parseDt(rep.until, 'repeat.until');
    if (dateOnly) u = new Date(u.getTime() + (23 * 3600 + 59 * 60 + 59) * 1000); // 그날 23:59:59 KST
    parts.push(`UNTIL=${fmtUtcFromKst(u)}`);
  } else if (rep.count) {
    if (!Number.isInteger(Number(rep.count)) || Number(rep.count) < 1) throw new BadPlan(`repeat.count 값이 잘못됨: ${rep.count}`);
    parts.push(`COUNT=${Number(rep.count)}`);
  }
  return parts.join(';');
}

// ---------- parse_plan ----------

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// 종류가 다른데 섞여 온 필드는 조용히 버리지 않고 오류로 알린다 (LLM은 오류를 받아 1회 재요청된다)
const EVENT_ONLY = ['end', 'duration_min', 'all_day', 'repeat', 'rrule', 'alarm_min', 'location'];
const TODO_ONLY = ['due', 'priority', 'group', 'done'];

function rejectMixedFields(raw, where, kind) {
  const bad = (kind === 'todo' ? EVENT_ONLY : TODO_ONLY).filter((k) => raw[k] !== undefined && raw[k] !== null && raw[k] !== '');
  if (!bad.length) return;
  const what = kind === 'todo' ? '할 일에는 쓸 수 없는' : '일정에는 쓸 수 없는';
  throw new BadPlan(`${where}: ${what} 필드가 있습니다: ${bad.join(', ')}`);
}

const PRIORITY_NAMES = { 높음: 1, 보통: 5, 낮음: 9, high: 1, normal: 5, low: 9 };

/** 할 일 한 건 검증 → {title, due, dueDateOnly, description, priority, group, done, color, uid} */
function parseTodo(raw, where) {
  if (!raw.title) throw new BadPlan(`${where}: title 필수`);
  rejectMixedFields(raw, where, 'todo');
  const rawDue = raw.due ?? raw.start; // LLM이 start로 줄 수 있어 별칭으로 받는다
  if (!rawDue) throw new BadPlan(`${where}: due 필수 (할 일은 마감일이 있어야 합니다)`);
  const d = parseDt(rawDue, `${where}.due`);

  let priority = 0;
  if (raw.priority !== undefined && raw.priority !== null && raw.priority !== '') {
    priority = PRIORITY_NAMES[String(raw.priority).trim().toLowerCase()] ?? Number(raw.priority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 9) throw new BadPlan(`${where}.priority: 0~9 또는 높음/보통/낮음 (받은 값 ${raw.priority})`);
  }
  let group = null;
  if (raw.group !== undefined && raw.group !== null && raw.group !== '') {
    group = Number(raw.group);
    if (!Number.isInteger(group) || group < 0) throw new BadPlan(`${where}.group: 할 일 그룹 id(정수)여야 함 (받은 값 ${raw.group})`);
  }
  return {
    title: String(raw.title),
    due: d.date,
    dueDateOnly: d.dateOnly,
    description: raw.description ? String(raw.description) : '',
    priority,
    group,
    done: Boolean(raw.done),
    color: raw.color !== undefined && raw.color !== null && raw.color !== '' ? colorId(raw.color) : null,
    uid: `${uuid()}@caiendar`,
    note: raw._note ? String(raw._note) : '',
  };
}

/**
 * @returns {{calendar: string|null, events: Event[], todos: Todo[]}}
 * Event: {title, start, end, allDay, location, description, rrule, alarmMin, color, sticker, uid, note}
 */
export function parsePlan(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.events)) {
    throw new BadPlan("최상위에 'events' 배열이 있어야 합니다.");
  }
  const events = [];
  const todos = [];
  data.events.forEach((raw, idx) => {
    const where = `events[${idx + 1}]`;
    if (!raw || typeof raw !== 'object') throw new BadPlan(`${where}: 객체여야 함`);
    const kind = raw.kind ? String(raw.kind).toLowerCase() : 'event';
    if (kind !== 'event' && kind !== 'todo') throw new BadPlan(`${where}.kind: 'event' 또는 'todo' (받은 값 ${raw.kind})`);
    if (kind === 'todo') { todos.push(parseTodo(raw, where)); return; }
    if (!raw.title) throw new BadPlan(`${where}: title 필수`);
    rejectMixedFields(raw, where, 'event');
    if (raw.start === undefined || raw.start === null || raw.start === '') throw new BadPlan(`${where}: start 필수`);
    const s = parseDt(raw.start, `${where}.start`);
    const allDay = Boolean(raw.all_day) || s.dateOnly;
    const start = s.date;
    let end;
    if (raw.end) end = parseDt(raw.end, `${where}.end`).date;
    else if (allDay) end = addDays(start, 1);
    else {
      const dur = Number(raw.duration_min ?? 60);
      if (!Number.isFinite(dur)) throw new BadPlan(`${where}.duration_min: 숫자여야 함`);
      end = addMinutes(start, dur);
    }
    if (end <= start) {
      throw new BadPlan(`${where}: 종료가 시작보다 빠르거나 같음 (${fmtLocal(start, allDay)} → ${fmtLocal(end, allDay)})`);
    }
    const rep = raw.repeat || raw.rrule;
    let alarmMin = null;
    if (raw.alarm_min !== undefined && raw.alarm_min !== null) {
      alarmMin = Number(raw.alarm_min);
      if (!Number.isInteger(alarmMin) || alarmMin < 0) throw new BadPlan(`${where}.alarm_min: 0 이상 정수여야 함`);
    }
    let sticker = null;
    if (raw.sticker !== undefined && raw.sticker !== null) {
      sticker = Number(raw.sticker);
      if (!Number.isInteger(sticker)) throw new BadPlan(`${where}.sticker: 정수여야 함`);
    }
    events.push({
      title: String(raw.title),
      start, end, allDay,
      location: raw.location ? String(raw.location) : '',
      description: raw.description ? String(raw.description) : '',
      rrule: rep ? buildRRule(rep) : '',
      alarmMin,
      color: raw.color !== undefined && raw.color !== null && raw.color !== '' ? colorId(raw.color) : null,
      sticker,
      uid: `${uuid()}@caiendar`,
      note: raw._note ? String(raw._note) : '',
    });
  });
  return { calendar: data.calendar ?? null, events, todos };
}

/** 미리보기용 한 줄 설명 (naver_cal.py describe 포팅) */
export function describe(e) {
  const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hm = (d) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const when = e.allDay ? ymd(e.start) : `${ymd(e.start)} ${hm(e.start)}~${hm(e.end)}`;
  const extra = [e.location, e.rrule ? `[${e.rrule}]` : '', e.color ? `(색 ${e.color}=#${COLOR_HEX[e.color]})` : '']
    .filter(Boolean).join(' ');
  return `${when}  ${e.title}  ${extra}`.trimEnd();
}
