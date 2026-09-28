// 스토어 스크린샷용 하네스: chrome API 를 흉내 내고 샘플 데이터를 채운다. 확장 자체 코드는 그대로 쓴다.
(() => {
  const S = {
    settings: {
      caldav: { preset: 'naver', baseUrl: 'https://caldav.calendar.naver.com', username: 'sample', password: 'sample', defaultCalendarUrl: '' },
      llm: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', apiKey: 'sample' },
    },
    calendars: [
      { url: 'https://caldav.calendar.naver.com/caldav/sample/calendar/1/', name: '내 캘린더', kind: 'event', components: ['VEVENT'] },
      { url: 'https://caldav.calendar.naver.com/caldav/sample/calendar/2/', name: '수업/과제', kind: 'event', components: ['VEVENT'] },
      { url: 'https://caldav.calendar.naver.com/caldav/sample/calendar/9/', name: '내 할 일', kind: 'todo', components: ['VTODO'] },
    ],
    naverMeta: { categoryNames: { 23: '🏫 학교', 14: '과제', 22: '학원', 29: '👨‍👩‍👧가족' } },
    batches: [],
    draft: null,
  };
  const P = new URLSearchParams(location.search);

  const SAMPLE_PLAN = { events: [
    { title: '컴퓨터구조', start: '2026-09-29T10:30', duration_min: 75, location: '102-306',
      repeat: { freq: 'weekly', byday: ['화', '목'], until: '2026-12-18' }, color: 23 },
    { title: '캡스톤 팀 회의', start: '2026-09-30T19:00', end: '2026-09-30T21:00', location: '도서관 스터디룸',
      _note: '"다음 주 수요일" = 2026-09-30으로 해석' },
    { kind: 'todo', title: '데이터베이스 과제 제출', due: '2026-10-07', priority: '높음', color: 14 },
  ] };

  if (P.get('state') !== 'empty') {
    S.draft = { input: '다음 주부터 매주 화·목 10:30에 75분 컴퓨터구조 수업, 102-306호. 12/18까지.\n다음 주 수요일 저녁 7시~9시 캡스톤 팀 회의, 도서관 스터디룸.\n10/7까지 데이터베이스 과제 제출, 중요.', plan: SAMPLE_PLAN, doc: null, at: new Date().toISOString() };
  }
  if (P.get('state') === 'done') {
    S.batches = [{ id: 'b1', at: new Date().toISOString(), calendarName: '내 캘린더', plan: SAMPLE_PLAN,
      events: [
        { uid: 'u1', href: 'h1', title: '컴퓨터구조', type: 'event', summary: '2026-09-29 10:30~11:45  컴퓨터구조  102-306 [FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261218T145959Z]' },
        { uid: 'u2', href: 'h2', title: '캡스톤 팀 회의', type: 'event', summary: '2026-09-30 19:00~21:00  캡스톤 팀 회의  도서관 스터디룸' },
        { uid: 'u3', href: 'h3', title: '데이터베이스 과제 제출', type: 'todo', summary: '2026-10-07까지  데이터베이스 과제 제출  중요도 1' },
      ] }];
    S.draft = null;
  }

  const CHECKS = [
    { duplicate: false, overlaps: [] },
    { duplicate: false, overlaps: ['동아리 정기모임 19:30~21:00'] },
    { duplicate: false, overlaps: [] },
  ];

  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.14.0' }),
      getURL: (p) => `/${p}`,
      lastError: null,
      openOptionsPage() { location.href = '/src/options/options.html'; },
      sendMessage(msg, cb) {
        const reply = {
          ping: { version: '0.14.0' },
          listCalendars: S.calendars,
          listBatches: S.batches,
          preflight: { checks: CHECKS, unreadable: 0 },
          register: {
            added: [
              { uid: 'u1', href: 'h1', title: '컴퓨터구조', summary: '2026-09-29 10:30~11:45  컴퓨터구조  102-306 [FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261218T145959Z]' },
              { uid: 'u2', href: 'h2', title: '캡스톤 팀 회의', summary: '2026-09-30 19:00~21:00  캡스톤 팀 회의  도서관 스터디룸' },
              { uid: 'u3', href: 'h3', title: '데이터베이스 과제 제출', summary: '2026-10-07까지  데이터베이스 과제 제출  중요도 1' },
            ],
            skipped: [], failed: [], unreadable: 0,
            batch: { id: 'b1', at: new Date().toISOString(), calendarName: '내 캘린더', events: [{ uid: 'u1' }, { uid: 'u2' }, { uid: 'u3' }] },
          },
        }[msg.type];
        setTimeout(() => cb({ ok: true, result: reply ?? {} }), 60);
        return true;
      },
    },
    tabs: { create: () => {}, query: async () => [] },
    permissions: { contains: async () => true, request: async () => true },
    storage: { local: {
      async get(k) { return k in S ? { [k]: S[k] } : {}; },
      async set(o) { Object.assign(S, o); },
      async remove(k) { delete S[k]; },
    } },
  };
})();
