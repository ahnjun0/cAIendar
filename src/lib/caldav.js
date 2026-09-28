import { explainHttp, explainNetwork, retryDelayMs, toMessage, MAX_RETRIES } from './errors.js';

// CalDAV 클라이언트 — PROPFIND / REPORT / PUT / DELETE. 표준 CalDAV만 쓴다.
// service worker에는 DOMParser가 없어서 multistatus XML은 아래의 작은 파서로 읽는다.
// (필요한 것은 response/href/displayname/resourcetype/comp/getetag/calendar-data 정도라 충분하다)

// MVP 범위: 네이버 캘린더만 지원한다. 다른 CalDAV 서버는 표준상 동작하지만 검증 범위 밖이라 열지 않는다.
export const NAVER_CALDAV = 'https://caldav.calendar.naver.com';
export const PRESETS = { naver: NAVER_CALDAV };

export class CalDAVError extends Error {
  constructor(msg, { status, method, url, retryable = false } = {}) {
    super(msg); this.name = 'CalDAVError'; this.status = status; this.method = method; this.url = url; this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function resolveUrl(base, href) {
  return new URL(href, base).toString();
}

export function xmlUnescape(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// 네임스페이스 접두어(D:, C:, d:, cal: …)는 무엇이든 올 수 있으므로 태그 로컬 이름만 본다.
const tagRe = (name) => new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}\\s*>`, 'g');
const emptyTagRe = (name) => new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?\\/>`);

function inner(xml, name) {
  const m = tagRe(name).exec(xml);
  return m ? m[1] : null;
}
function allInner(xml, name) {
  return [...xml.matchAll(tagRe(name))].map((m) => m[1]);
}
function hasTag(xml, name) {
  return emptyTagRe(name).test(xml) || tagRe(name).test(xml);
}
function textOf(xml, name) {
  const v = inner(xml, name);
  if (v === null) return null;
  const cdata = v.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return cdata ? cdata[1] : xmlUnescape(v.trim());
}

/** multistatus XML → [{href, status, displayname, isCalendar, components, etag, calendarData, principalHref, homeHref}] */
export function parseMultistatus(xml) {
  return allInner(xml, 'response').map((r) => {
    const href = textOf(r, 'href') ?? '';
    const props = allInner(r, 'prop').join('');
    const compSet = inner(props, 'supported-calendar-component-set') ?? '';
    const components = [...compSet.matchAll(/<(?:[\w.-]+:)?comp\s+[^>]*name="([^"]+)"/g)].map((m) => m[1]);
    const resourcetype = inner(props, 'resourcetype') ?? '';
    const cup = inner(props, 'current-user-principal');
    const chs = inner(props, 'calendar-home-set');
    return {
      href,
      status: textOf(r, 'status'),
      displayname: textOf(props, 'displayname') ?? '',
      isCalendar: hasTag(resourcetype, 'calendar'),
      components,
      etag: textOf(props, 'getetag'),
      calendarData: textOf(props, 'calendar-data') ?? '',
      principalHref: cup ? textOf(cup, 'href') : null,
      homeHref: chs ? textOf(chs, 'href') : null,
    };
  });
}

const PROPFIND_PRINCIPAL = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
const PROPFIND_HOME = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>';
const PROPFIND_CALENDARS = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>';
const todoQuery = (range) => '<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO">'
  + (range ? `<c:time-range start="${range.start}" end="${range.end}"/>` : '')
  + '</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>';

// 비어 온 calendar-data 를 개별 GET 으로 메우는 횟수 상한.
// 할 일이 수백 건인 계정에서 전부 재시도하면 멈춘 것처럼 보인다 (실측: 807건).
const MAX_REFETCH = 20;
const reportQuery = (start, end) => `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${start}" end="${end}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;

function toBase64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export class CalDAVClient {
  // fetch는 this가 전역이어야 한다 (메서드로 저장해 호출하면 Illegal invocation) → 래퍼로 감싼다
  constructor({ baseUrl, username, password, fetchFn = (...a) => globalThis.fetch(...a), timeoutMs = 30_000 }) {
    if (!baseUrl || !username || !password) throw new CalDAVError('CalDAV 서버 주소·아이디·앱 비밀번호가 모두 필요합니다.');
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.fetchFn = fetchFn;
    this.timeoutMs = timeoutMs;
    this._auth = `Basic ${toBase64(`${username}:${password}`)}`;
  }

  get isNaver() { return /naver\.com/.test(this.baseUrl); }

  /**
   * 공통 요청. 자격증명은 헤더에만 있고 오류 메시지에는 절대 넣지 않는다.
   * 일시적 오류(429/5xx/네트워크)는 Retry-After 를 존중해 최대 MAX_RETRIES 회 다시 시도한다.
   */
  async request(method, url, { headers = {}, body, ok, retries = MAX_RETRIES } = {}) {
    const okFn = ok ?? ((s) => s >= 200 && s < 300);
    let last = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
      let res;
      try {
        res = await this.fetchFn(url, {
          method, headers: { Authorization: this._auth, ...headers }, body, signal: ctl.signal,
        });
      } catch (err) {
        last = explainNetwork(err, 'caldav');
        if (!last.retryable || attempt === retries) break;
        await sleep(retryDelayMs(attempt));
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (okFn(res.status)) return res;
      const text = await res.text().catch(() => '');
      last = explainHttp({ status: res.status, service: 'caldav', body: text });
      if (!last.retryable || attempt === retries) break;
      await sleep(retryDelayMs(attempt, res.headers?.get?.('Retry-After')));
    }
    throw new CalDAVError(`${toMessage(last)} [${method}]`, { status: last.status, method, url, retryable: last.retryable });
  }

  async propfind(url, body, depth) {
    const res = await this.request('PROPFIND', url, {
      headers: { Depth: String(depth), 'Content-Type': 'application/xml; charset=utf-8' }, body,
    });
    return parseMultistatus(await res.text());
  }

  /** PROPFIND / → principal → calendar-home-set → 캘린더 목록 (VEVENT 지원 또는 컴포넌트 미표기만) */
  async discoverCalendars() {
    const root = await this.propfind(this.baseUrl, PROPFIND_PRINCIPAL, 0);
    const principalHref = root.find((r) => r.principalHref)?.principalHref;
    if (!principalHref) throw new CalDAVError('current-user-principal을 찾지 못했습니다.');
    const principalUrl = resolveUrl(this.baseUrl, principalHref);

    const p = await this.propfind(principalUrl, PROPFIND_HOME, 0);
    const homeHref = p.find((r) => r.homeHref)?.homeHref;
    if (!homeHref) throw new CalDAVError('calendar-home-set을 찾지 못했습니다.');
    const homeUrl = resolveUrl(this.baseUrl, homeHref);

    const list = await this.propfind(homeUrl, PROPFIND_CALENDARS, 1);
    // VEVENT 캘린더와 VTODO('할 일') 캘린더를 모두 돌려주고, 어느 쪽인지 kind로 표시한다
    return list
      .filter((r) => r.isCalendar && (r.components.length === 0 || r.components.includes('VEVENT') || r.components.includes('VTODO')))
      .map((r) => ({
        url: resolveUrl(this.baseUrl, r.href),
        name: r.displayname || '(이름 없음)',
        components: r.components,
        kind: !r.components.includes('VEVENT') && r.components.includes('VTODO') ? 'todo' : 'event',
      }));
  }

  /** PUT {calendarUrl}{uid}.ics — 새 일정만 (If-None-Match: *) */
  async putEvent(calendarUrl, uid, ics) {
    // UID의 '@'는 경로에 그대로 둔다 (네이버 자체 UID도 '@'를 쓴다). 경로를 깨는 문자만 인코딩.
    const safeUid = String(uid).replace(/[^A-Za-z0-9@._-]/g, (c) => encodeURIComponent(c));
    const href = `${calendarUrl.endsWith('/') ? calendarUrl : `${calendarUrl}/`}${safeUid}.ics`;
    const res = await this.request('PUT', href, {
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' }, body: ics,
    });
    return { href, etag: res.headers.get('ETag') };
  }

  /** 개별 조회. 빈 calendar-data 를 메우는 폴백으로 쓰므로 재시도하지 않는다 (실패하면 '못 읽음'으로 보고) */
  async getEvent(href, { retries = 0 } = {}) {
    const res = await this.request('GET', href, { retries });
    return res.text();
  }

  /**
   * REPORT calendar-query(VEVENT, time-range). start/end는 'YYYYMMDDTHHMMSSZ'.
   * 네이버는 calendar-data가 빈 항목을 돌려주기도 한다 → href로 GET 1회 재시도, 그래도 없으면 unreadable에 담아 UI가 알리게 한다.
   * @returns {{events: {href, etag, ics}[], unreadable: string[]}}
   */
  async queryEvents(calendarUrl, start, end) {
    const res = await this.request('REPORT', calendarUrl, {
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }, body: reportQuery(start, end),
    });
    const rows = parseMultistatus(await res.text()).filter((r) => r.href && !r.href.endsWith('/'));
    const events = [];
    const unreadable = [];
    for (const r of rows) {
      const href = resolveUrl(this.baseUrl, r.href);
      let ics = r.calendarData?.trim() ? r.calendarData : '';
      if (!ics) {
        try { ics = await this.getEvent(href); } catch { ics = ''; }
      }
      if (ics && ics.includes('BEGIN:VEVENT')) events.push({ href, etag: r.etag, ics });
      else unreadable.push(href);
    }
    return { events, unreadable };
  }

  /**
   * 할 일 조회. range(마감일 UTC 범위)를 주면 그 범위만 받는다 — 계정에 할 일이 수백 건이면 필수.
   * 서버가 time-range 필터를 거부하면 범위 없이 한 번만 다시 시도한다.
   * @returns {{todos: {href, etag, ics}[], unreadable: string[]}}
   */
  async queryTodos(calendarUrl, range = null) {
    const ask = async (r) => this.request('REPORT', calendarUrl, {
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }, body: todoQuery(r),
    });
    let res;
    try {
      res = await ask(range);
    } catch (e) {
      if (!range) throw e;
      res = await ask(null); // 네이버가 VTODO time-range 를 지원하는지는 미검증이라 폴백을 둔다
    }
    const rows = parseMultistatus(await res.text()).filter((r) => r.href && !r.href.endsWith('/'));
    const todos = [];
    const unreadable = [];
    let refetched = 0;
    for (const r of rows) {
      const href = resolveUrl(this.baseUrl, r.href);
      let ics = r.calendarData?.trim() ? r.calendarData : '';
      if (!ics && refetched < MAX_REFETCH) {
        refetched += 1;
        try { ics = await this.getEvent(href); } catch { ics = ''; }
      }
      if (ics && ics.includes('BEGIN:VTODO')) todos.push({ href, etag: r.etag, ics });
      else unreadable.push(href);
    }
    return { todos, unreadable };
  }

  /** DELETE. 이미 없으면(404) 성공으로 본다 — 되돌리기를 두 번 눌러도 안전하게 */
  async deleteEvent(href) {
    await this.request('DELETE', href, { ok: (s) => (s >= 200 && s < 300) || s === 404 });
  }
}
