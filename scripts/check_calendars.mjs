#!/usr/bin/env node
// 실제 계정으로 캘린더 목록 조회 확인 (읽기 전용, 일정 생성 없음).
//   CALDAV_USER='네이버아이디' CALDAV_PASS='앱비밀번호' node scripts/check_calendars.mjs
import { CalDAVClient, PRESETS } from '../src/lib/caldav.js';

const user = process.env.CALDAV_USER;
const pass = process.env.CALDAV_PASS;
if (!user || !pass) {
  console.error('CALDAV_USER / CALDAV_PASS 환경변수를 설정해 주세요.');
  process.exit(2);
}
const baseUrl = PRESETS.naver;

const client = new CalDAVClient({ baseUrl, username: user, password: pass });
console.log(`접속: ${baseUrl}`);
try {
  const cals = await client.discoverCalendars();
  console.log(`캘린더 ${cals.length}개`);
  for (const c of cals) console.log(`  - ${c.name}  ${c.url}`);
} catch (e) {
  console.error(`실패: ${e.message}`);
  process.exit(1);
}
