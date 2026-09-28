#!/usr/bin/env node
// 네이버 '할 일'이 CalDAV VTODO로 보이는지 확인 (읽기 전용 — 아무것도 만들지 않는다).
//   CALDAV_USER='아이디' CALDAV_PASS='앱비밀번호' node scripts/check_tasks.mjs
import { CalDAVClient, PRESETS, resolveUrl } from '../src/lib/caldav.js';

const user = process.env.CALDAV_USER;
const pass = process.env.CALDAV_PASS;
if (!user || !pass) { console.error('CALDAV_USER / CALDAV_PASS 환경변수가 필요합니다.'); process.exit(2); }

const client = new CalDAVClient({ baseUrl: PRESETS[process.argv[2] ?? 'naver'] ?? process.argv[2], username: user, password: pass });

const PROPFIND_ALL = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>';

// 1) 필터 없이 모든 컬렉션을 본다 (확장은 VEVENT 지원만 쓰지만 여기서는 전부)
const root = await client.propfind(client.baseUrl, '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>', 0);
const principal = resolveUrl(client.baseUrl, root.find((r) => r.principalHref).principalHref);
const p = await client.propfind(principal, '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>', 0);
const home = resolveUrl(client.baseUrl, p.find((r) => r.homeHref).homeHref);
const all = (await client.propfind(home, PROPFIND_ALL, 1)).filter((r) => r.isCalendar);

console.log(`캘린더 ${all.length}개 (필터 없음)`);
for (const c of all) console.log(`  - ${c.displayname || '(이름 없음)'}  components=[${c.components.join(',') || '표기 없음'}]`);

const todoCals = all.filter((c) => c.components.includes('VTODO'));
if (!todoCals.length) { console.log('\nVTODO를 지원한다고 광고하는 캘린더가 없습니다 → 할 일은 CalDAV로 접근 불가로 보입니다.'); process.exit(0); }

// 2) 할 일 캘린더에서 VTODO를 실제로 읽어 본다
for (const c of todoCals) {
  const url = resolveUrl(client.baseUrl, c.href);
  console.log(`\n[${c.displayname}] VTODO 조회: ${url}`);
  try {
    const { todos, unreadable } = await client.queryTodos(url);
    console.log(`  읽음 ${todos.length}건 / 못 읽음 ${unreadable.length}건`);
    for (const t of todos.slice(0, 3)) {
      console.log('  --- 원문 ---');
      console.log(t.ics.split(/\r?\n/).map((l) => `  ${l}`).join('\n'));
    }
  } catch (e) { console.log(`  실패: ${e.message}`); }
}
console.log('\n위에 VTODO 원문이 보이면 할 일 등록(PUT)도 가능할 가능성이 높습니다. DUE/STATUS/X-NAVER-TASK-GROUP-ID 가 어떻게 쓰였는지 알려 주세요.');
