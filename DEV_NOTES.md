# 개발 메모 (실측 사실)

스펙에 없지만 구현 중 실제로 확인한 것들. 다시 밟지 않기 위해 남긴다.

## 크롬 확장

- 서비스 워커에서 `fetch`를 객체 속성으로 저장해 `this.fetchFn(...)`으로 호출하면 `Illegal invocation`이 난다 → 항상 `(...a) => globalThis.fetch(...a)` 래퍼로 감싼다
- ↻ 새로고침만으로는 서비스 워커가 옛 코드로 남는 일이 있다. 팝업이 시작할 때 `ping`으로 버전을 비교해 불일치를 알린다
- MV3 워커는 긴 작업 도중 종료될 수 있다 → 되돌리기 기록은 **한 건 등록할 때마다** 저장한다

## 네이버 CalDAV

- 공식 안내 인터페이스(`caldav.calendar.naver.com`, 앱 비밀번호)만 쓴다
- 캘린더 목록에 **할 일 캘린더**가 `supported-calendar-component-set=[VTODO]`로 함께 온다
- 할 일 VTODO 실측 속성: `DUE;VALUE=DATE:YYYYMMDD`, `STATUS:COMPLETED|NEEDS-ACTION`, `PRIORITY:0|1`,
  `X-NAVER-TASK-GROUP-ID:<int>`(파라미터 `X-NAVER-TASK-GROUP-NAME`), `X-NAVER-CATEGORY-COLOR`
- `ORGANIZER`, `X-NAVER-REGISTERER`, `X-NAVER-LAST-MODIFIER`는 서버가 채운다 → 보내지 않는다
- multiget 응답에서 `calendar-data`가 비어 오는 항목이 있다 → 개별 GET으로 한 번 메우되 횟수 상한을 둔다
  (할 일이 800건 넘는 계정에서 전부 재시도하면 멈춘 것처럼 보인다)
- 반복 일정의 예외 회차는 같은 UID + `RECURRENCE-ID`로 온다 → 별개 일정으로 세지 않는다

## 네이버 색상표 (선택 기능, 읽기 전용)

- `calendar.naver.com/data/colors?lc=ko`는 `ts`/`lm` 없이도 동작한다 (HTML에 URL이 없어 이 폴백을 먼저 쓴다)
- 비로그인 응답은 `location.replace('https://nid.naver.com/nidlogin…')` 한 줄 HTML이다.
  로그인된 페이지에도 `nidlogin` **링크**가 있으므로 반드시 `location.replace` 형태로만 판정한다
- `/main` HTML의 `oInitialData.oCategoryList`에 색상 id별 사용자 카테고리 이름이 있다

## AI 공급자

- OpenRouter는 `max_tokens`가 없으면 모델 최대치를 예약해 크레딧 검사에서 402를 낸다 → 4096 고정
- 일부 공급자·모델은 `response_format: json_object`를 거부한다 → 400이면 그것만 빼고 한 번 더
- `finish_reason: "length"`면 JSON이 잘린 것이다 → 파싱 실패로 뭉개지 말고 그대로 알린다
- **추론(reasoning) 모델은 `max_tokens`를 생각하는 데 먼저 쓴다.** 한도에 걸리면 `content: null` + `message.reasoning` 만 오고
  `finish_reason: "length"` 가 된다 (실측: OpenRouter `deepseek/deepseek-v4.1-flash`). 본문 없음과 구분해 안내한다.
  상한은 8192 — 값이 없으면 OpenRouter 가 모델 최대치를 예약해 402 를 내므로 무한정 키울 수는 없다

## 약관

- 주 경로는 표준 CalDAV와 ICS 파일뿐이다. 네이버 웹페이지 DOM을 조작하는 코드는 확장에 없다
  (시간표 '과목등록' 자동 입력 실험은 저장소 밖 `../extras/timetable/`에 보관)
