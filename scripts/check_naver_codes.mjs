#!/usr/bin/env node
// calendar.naver.com 에서 색상표/스티커표 URL을 찾아 읽어지는지 확인 (읽기 전용, 로그인 불필요)
import { fetchNaverCodes } from '../src/lib/naver_codes.js';
const r = await fetchNaverCodes();
console.log('colors:', r.colors ? `${Object.keys(r.colors).length}개` : 'null', r.colors ? JSON.stringify(r.colors).slice(0, 80) + '…' : '');
console.log('stickers:', r.stickers ? `${Object.keys(r.stickers).length}개` : 'null');
for (const e of r.errors) console.log('error:', e);
