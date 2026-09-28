// 네트워크 오류를 사용자가 무엇을 해야 할지 알 수 있는 문구로 바꾼다.
// 원칙: 상태 코드를 숨기지 않되(제보·디버깅용), 앞에는 사람이 읽을 설명과 다음 행동을 둔다.

export const MAX_RETRIES = 2;          // 429/5xx 재시도 횟수
const MAX_BODY = 200;                  // 오류 메시지에 덧붙일 응답 본문 길이
const BASE_DELAY = 1000;
const MAX_DELAY = 20_000;

/** 재시도해 볼 만한 상태인가 (일시적 문제만) */
export const isRetryable = (status) => status === 429 || (status >= 500 && status < 600);

/** 재시도 전 대기 시간. Retry-After(초) 헤더가 있으면 그것을 따른다 */
export function retryDelayMs(attempt, retryAfter = null) {
  if (retryAfter !== null && retryAfter !== undefined && retryAfter !== '') {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, MAX_DELAY);
  }
  return Math.min(BASE_DELAY * 2 ** attempt, MAX_DELAY);
}

const clip = (body) => {
  const t = String(body ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > MAX_BODY ? `${t.slice(0, MAX_BODY)}…` : t;
};

// 네이버는 비로그인 상태에서 200과 함께 로그인 리다이렉트 HTML을 돌려준다
const isNaverLoginPage = (body) => /location\.replace\(\s*['"]https:\/\/nid\.naver\.com\/nidlogin/.test(String(body ?? ''));

const SERVICE_NAME = { caldav: '네이버 캘린더', llm: 'AI 공급자', naver: '네이버' };

/**
 * @param {{status: number, service: 'caldav'|'llm'|'naver', body?: string, url?: string}} p
 * @returns {{message: string, hint: string, retryable: boolean, status: number}}
 */
export function explainHttp({ status, service, body = '' }) {
  const who = SERVICE_NAME[service] ?? '서버';
  const tail = clip(body);
  const out = (message, hint = '', retryable = false) => ({
    message: tail && !message.includes(tail) ? `${message} (HTTP ${status}: ${tail})` : message,
    hint,
    retryable,
    status,
  });

  if (isNaverLoginPage(body)) {
    return out('네이버에 로그인되어 있지 않습니다.', '같은 브라우저에서 calendar.naver.com 에 로그인한 뒤 다시 시도하세요.');
  }

  switch (status) {
    case 400:
      return out(`${who}가 요청을 거부했습니다 (400).`, service === 'llm' ? '모델 이름이나 설정을 확인하세요.' : '');
    case 401:
    case 403:
      return service === 'llm'
        ? out(`${who} 인증에 실패했습니다 (${status}).`, 'API 키가 맞는지, 만료되지 않았는지 확인하세요.')
        : out(`${who} 인증에 실패했습니다 (${status}).`, '아이디와 비밀번호를 확인하세요. 2단계 인증을 쓰면 애플리케이션 비밀번호가 필요합니다.');
    case 402:
      return out(`${who}의 크레딧(잔액)이 부족합니다 (402).`, '공급자 콘솔에서 잔액이나 키 한도를 확인하세요.');
    case 404:
      return service === 'llm'
        ? out(`${who}에서 대상을 찾지 못했습니다 (404).`, '모델 이름이 맞는지 확인하세요. 공급자가 모델명을 바꾸는 경우가 있습니다.')
        : out('대상을 찾지 못했습니다 (404).', '캘린더 목록을 새로 읽어 보세요.');
    case 412:
      return out('같은 식별자의 항목이 이미 있습니다 (412).', '같은 내용을 다시 등록하려면 중복 허용을 켜고 시도하세요.');
    case 413:
      return out('보낸 내용이 너무 큽니다 (413).', '첨부한 문서를 줄이거나 일정 수를 나눠서 등록하세요.');
    case 429:
      return out(`${who}에 요청이 너무 잦습니다 (429).`, '잠시 후 자동으로 다시 시도합니다. 계속되면 몇 분 뒤에 시도하세요.', true);
    case 507:
      return out('캘린더 저장 공간이 부족합니다 (507).', '', false);
    default:
      if (status >= 500) return out(`${who} 서버에 문제가 있습니다 (${status}).`, '잠시 후 다시 시도하세요.', true);
      return out(`${who} 요청이 실패했습니다 (HTTP ${status}).`);
  }
}

/**
 * fetch 자체가 실패한 경우 (네트워크·타임아웃·권한).
 * @returns {{message: string, hint: string, retryable: boolean, status: null}}
 */
export function explainNetwork(err, service) {
  const who = SERVICE_NAME[service] ?? '서버';
  if (err?.name === 'AbortError' || /abort/i.test(err?.message ?? '')) {
    return { message: `${who} 응답 시간이 초과되었습니다.`, hint: '네트워크 상태를 확인한 뒤 다시 시도하세요.', retryable: true, status: null };
  }
  return {
    message: `${who}에 연결할 수 없습니다 (네트워크 오류: ${err?.message ?? '원인 불명'}).`,
    hint: '인터넷 연결과 확장의 사이트 접근 권한을 확인하세요.',
    retryable: true,
    status: null,
  };
}

/** explain 결과를 한 줄 문구로 */
export const toMessage = (e) => (e.hint ? `${e.message} ${e.hint}` : e.message);
