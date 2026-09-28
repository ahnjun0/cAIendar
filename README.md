# 🗓️ cAIendar

자연어로 적은 계획을 AI가 일정으로 바꾸고, 표에서 확인·수정한 뒤 **네이버 캘린더**에 등록하는 크롬 확장(MV3)입니다.
"다음 주 화·목 10:30 컴퓨터구조 75분, 12/18까지" 한 줄이면 반복 수업이 그대로 들어갑니다.

## 주요 기능

- **자연어 → 일정** — 문장을 그대로 적으면 반복·알림·장소·기간까지 채운 일정 표가 나옵니다
- **문서에서 추출** — 지금 보고 있는 탭의 본문이나 PDF(강의계획서·학사일정)에서 날짜가 있는 항목만 뽑습니다
- **할 일 지원** — "~까지 제출" 같은 마감은 네이버 '할 일'(VTODO)로 등록합니다
- **등록 전 검사** — 같은 제목·같은 날짜 중복과 시간 겹침을 미리 알려 주고, 확인해야 등록합니다
- **되돌리기** — 등록한 묶음을 버튼 하나로 캘린더에서 지웁니다 (최근 50번 기록)
- **이어 쓰기** — 팝업을 닫아도 입력과 변환 결과가 남고, 최근 등록은 불러와 고칠 수 있습니다
- **네이버 색상** — 35색 팔레트와 색마다 붙여 둔 카테고리 이름("과제", "학교")을 그대로 씁니다
- **ICS 내려받기** — CalDAV가 없는 구글·Outlook·카카오 캘린더는 파일로 받아 '가져오기'

## 설치 방법

### 크롬 웹스토어

> 심사 후 링크를 넣을 자리입니다.

### 직접 설치 (개발자 모드)

1. 이 저장소를 내려받습니다
2. `chrome://extensions` → 우상단 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드합니다** → 이 폴더 선택

## 사용 방법

1. **설정** (확장 아이콘 → 설정)
   - 네이버 아이디(`@naver.com` 없이)와 **애플리케이션 비밀번호** 입력 → `연결 테스트 · 캘린더 불러오기`
   - AI 공급자(Gemini / Alibaba Qwen / OpenRouter) 선택 후 **본인 API 키** 입력 → `저장`
2. **팝업** — 계획을 적거나 `현재 탭 본문` / `PDF 파일`을 첨부하고 `변환`
3. 표에서 제목·시각·반복·장소·색을 확인하고 고칩니다 (일정 ↔ 할 일 전환도 여기서)
4. `검사 후 등록` → 중복·겹침 경고를 확인하고 한 번 더 누르면 등록
5. 잘못됐으면 `되돌리기`, 다시 쓰려면 `불러와 고치기`

> 네이버가 2단계 인증을 쓰는 계정은 일반 비밀번호가 아니라 **애플리케이션 비밀번호**가 필요합니다.
> AI 키는 사용자가 직접 발급합니다 ([AI Studio](https://aistudio.google.com/apikey) 등). 무료 티어로 충분합니다.

## 프로젝트 구조

```
├── manifest.json          MV3
├── icons/                 16·32·48·128 (scripts/make_icons.py 로 생성)
├── src/
│   ├── background.js      서비스 워커 — 메시지 라우팅, 네트워크는 전부 여기서
│   ├── lib/
│   │   ├── schema.js      일정 JSON 검증 (일정 + kind:"todo" 할 일)
│   │   ├── ical.js        toICS / toVTODO / exportICS / VCALENDAR 파서
│   │   ├── caldav.js      PROPFIND·REPORT·PUT·DELETE
│   │   ├── llm.js         OpenAI 호환 chat.completions 호출
│   │   ├── register.js    검사(중복·겹침) → 등록 → 되돌리기 배치
│   │   ├── errors.js      HTTP·네트워크 오류 → 안내 문구 + 재시도 판단
│   │   ├── source.js      탭 본문·PDF 입력 합치기, 출처·서명 기록
│   │   ├── storage.js     chrome.storage.local (자격증명·기록·임시 저장)
│   │   └── naver_codes.js 네이버 색상표·카테고리 이름 읽기 (선택)
│   ├── popup/ options/ history/    UI
│   ├── data/colors.json   번들 색상표(35색)
│   └── vendor/            pdf.js (PDF 텍스트 추출)
├── test/                  단위 테스트 170개 (네트워크 없음)
├── scripts/               실계정 확인용 CLI, 아이콘·스크린샷 도구
└── tools/package.sh       스토어 제출용 zip
```

## 개발

```bash
npm test              # 단위 테스트 (의존성 없음, Node 내장 러너)
./tools/package.sh    # dist/caiendar-v<버전>.zip
python3 scripts/make_icons.py            # 아이콘 다시 생성
node scripts/screenshots/serve.mjs       # 스토어 스크린샷 하네스
CALDAV_USER=... CALDAV_PASS=... node scripts/check_calendars.mjs   # 실계정 연결 확인
```

빌드 단계가 없습니다. `src/`가 그대로 실행되는 코드입니다.

## 동작 원리

```
자연어/문서 → AI(OpenAI 호환) → 일정 JSON   ← AI의 역할은 여기까지
           → 결정적 검증(schema.js) → 확인 표(popup) → 검사(register.js)
           → toICS / toVTODO(ical.js) → 네이버 CalDAV PUT(caldav.js)
```

- AI는 **JSON까지만** 만듭니다. iCalendar 생성과 전송은 검증된 코드가 합니다
- 등록은 항상 **사용자가 버튼을 눌러야** 나갑니다. 자동 등록이 없습니다
- 색은 AI가 정하지 않습니다. 표에서 직접 고릅니다
- 일시적 오류(429/5xx/네트워크)는 최대 2회 자동 재시도, 인증·크레딧·모델 오류는 바로 안내합니다

## 요구 사항

- 크롬 114 이상 (MV3)
- 네이버 계정 + 애플리케이션 비밀번호
- AI 공급자 API 키 (Gemini / Alibaba Qwen / OpenRouter 중 하나)

## 권한

| 권한 | 쓰는 곳 |
|---|---|
| `storage` | 계정·키·캘린더 목록·등록 기록을 이 기기에 저장 |
| `activeTab`, `scripting` | **"현재 탭 본문"을 누른 그 순간** 그 탭의 텍스트만 읽음 |
| `caldav.calendar.naver.com` | 네이버 캘린더 CalDAV (설치 시 필요한 유일한 호스트) |
| (선택) AI 공급자 3곳, `calendar.naver.com` | 설정에서 저장·색상표 읽기를 누를 때만 요청 |

## 개인정보

- 앱 비밀번호와 API 키는 **이 기기의 확장 저장소에만** 저장되고 동기화되지 않습니다. 개발자는 접근할 수 없습니다
- 입력한 문장과 첨부 문서는 **사용자가 고른 AI 공급자**로만 전송됩니다 (변환 목적)
- 분석·광고·추적 없음. 자세한 내용은 [PRIVACY.md](PRIVACY.md) ([English](PRIVACY.en.md))

## 라이선스

[MIT](LICENSE)
