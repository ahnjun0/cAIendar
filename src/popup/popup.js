// 입력 → 변환(LLM) → 표로 확인·편집 → 등록 → 되돌리기. 등록은 "등록" 버튼을 눌러야만 나간다.
import { parsePlan, BadPlan, COLOR_HEX, KO_DAYS } from '../lib/schema.js';
import { exportICS } from '../lib/ical.js';
import { getSettings, getCalendarsCache, getBatches, getColorMap, getNaverMeta, getDraft, saveDraft, clearDraft } from '../lib/storage.js';
import { bundledColorMap } from '../lib/naver_codes.js';
import { kindOf } from '../lib/batchkind.js';
import { composeInput, pdfItemsToText, cleanPageText, addProvenance, MAX_DOC_CHARS } from '../lib/source.js';

const $ = (id) => document.getElementById(id);
const send = (type, payload) => new Promise((resolve, reject) => {
  chrome.runtime.sendMessage({ type, payload }, (res) => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    res?.ok ? resolve(res.result) : reject(new Error(res?.error ?? '알 수 없는 오류'));
  });
});

let plan = null;            // {calendar?, events:[raw]} — 스키마 그대로의 원본 JSON
let calendars = [];
let replaceBatch = null;    // 최근 등록을 불러와 고치는 중이면 그 배치 (등록 시 먼저 삭제한다)
let checks = null;          // preflight 결과 [{duplicate, overlaps}] — plan이 바뀌면 무효
let doc = null;             // 첨부 문서 {kind:'tab'|'pdf', label, text}
let colorMap = null;        // {id: '#rrggbb'}
let colorNames = {};        // {id: '카테고리 이름'} (네이버 메타, 없으면 빈 객체)
const EN_DAYS = Object.fromEntries(Object.entries(KO_DAYS).map(([k, v]) => [v, k]));

// ---------- 캘린더 ----------
function fillCalendars(selectedUrl) {
  const sel = $('calendar');
  const tsel = $('todoCalendar');
  sel.innerHTML = '';
  tsel.innerHTML = '';
  const eventCals = calendars.filter((c) => c.kind !== 'todo');
  const todoCals = calendars.filter((c) => c.kind === 'todo');
  if (!eventCals.length) sel.innerHTML = '<option value="">캘린더 없음 — 설정에서 연결</option>';
  for (const c of eventCals) { const o = document.createElement('option'); o.value = c.url; o.textContent = c.name; sel.appendChild(o); }
  if (selectedUrl && eventCals.some((c) => c.url === selectedUrl)) sel.value = selectedUrl;
  // 할 일 캘린더(VTODO)는 있을 때만 보여 준다
  for (const c of todoCals) { const o = document.createElement('option'); o.value = c.url; o.textContent = `☑ ${c.name}`; tsel.appendChild(o); }
  tsel.classList.toggle('hidden', !todoCals.length);
}

const isTodo = (ev) => String(ev?.kind ?? 'event').toLowerCase() === 'todo';

async function loadCalendars(refresh) {
  const s = await getSettings();
  try {
    calendars = refresh ? await send('listCalendars', { refresh: true }) : await getCalendarsCache();
    // 옛 버전이 저장한 캐시에는 kind/components 가 없어 할 일 캘린더를 못 찾는다 → 한 번 다시 읽는다
    const stale = calendars.length > 0 && calendars.some((c) => !c.kind);
    if ((!calendars.length || stale) && s.caldav.username) calendars = await send('listCalendars', { refresh: true });
  } catch (e) { setMsg('convertMsg', e.message, 'err'); }
  fillCalendars($('calendar').value || s.caldav.defaultCalendarUrl);
}

// ---------- 표 ----------
const colorHex = (id) => (colorMap?.[id] ?? (COLOR_HEX[id] ? `#${COLOR_HEX[id]}` : null));

function repeatOf(ev) {
  if (typeof ev.rrule === 'string' && ev.rrule) return { rrule: ev.rrule };
  return ev.repeat && typeof ev.repeat === 'object' ? ev.repeat : null;
}

/** 색 선택기: 사용자가 직접 고른다 (LLM은 color를 내지 않는다). 견본 버튼 → 7계열×5단계 그리드 팝오버 */
const GROUPS = ['빨강', '주황', '노랑', '초록', '파랑', '보라', '회색'];
const GROUP_NAME = (id) => `${GROUPS[Math.floor((id - 1) / 5)]} ${((id - 1) % 5) + 1}`;
const colorLabel = (id) => (colorNames[id] ? `${id} · ${colorNames[id]}` : `${id} · ${GROUP_NAME(id)}`);

function currentColorId(ev) {
  if (ev.color === undefined || ev.color === null || ev.color === '') return null;
  try { return parsePlan({ events: [{ title: 'x', start: '2026-01-01', color: ev.color }] }).events[0].color; } catch { return null; }
}

function colorPicker(ev) {
  const wrap = document.createElement('div'); wrap.className = 'colorpick';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'colorbtn';
  const sw = document.createElement('span'); sw.className = 'swatch big';
  const txt = document.createElement('span'); txt.className = 'msg';
  btn.append(sw, txt);
  const paint = () => {
    const id = currentColorId(ev);
    sw.style.background = id ? colorHex(id) : 'transparent';
    sw.classList.toggle('none', !id);
    txt.textContent = id ? colorLabel(id) : '색: 캘린더 기본';
  };
  paint();
  btn.addEventListener('click', (e) => { e.stopPropagation(); openColorGrid(btn, ev, paint); });
  wrap.appendChild(btn);
  return wrap;
}

let gridEl = null;
function closeColorGrid() { gridEl?.remove(); gridEl = null; }
document.addEventListener('click', closeColorGrid);

function openColorGrid(anchor, ev, paint) {
  closeColorGrid();
  const grid = document.createElement('div'); grid.className = 'colorgrid';
  grid.addEventListener('click', (e) => e.stopPropagation());
  const cur = currentColorId(ev);
  const pick = (id) => {
    if (id) ev.color = id; else delete ev.color;
    paint(); closeColorGrid(); rerender();
  };
  GROUPS.forEach((g, gi) => {
    const row = document.createElement('div'); row.className = 'crow';
    const lab = document.createElement('span'); lab.className = 'clab'; lab.textContent = g; row.appendChild(lab);
    for (let k = 1; k <= 5; k++) {
      const id = gi * 5 + k;
      const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'ccell';
      cell.style.background = colorHex(id) ?? '#ccc';
      cell.title = colorLabel(id);
      if (id === cur) cell.classList.add('sel');
      if (colorNames[id]) { const n = document.createElement('span'); n.className = 'cname'; n.textContent = colorNames[id]; cell.appendChild(n); }
      cell.addEventListener('click', () => pick(id));
      row.appendChild(cell);
    }
    grid.appendChild(row);
  });
  const foot = document.createElement('div'); foot.className = 'cfoot';
  const none = document.createElement('button'); none.type = 'button'; none.textContent = '캘린더 기본색'; none.addEventListener('click', () => pick(null));
  const all = document.createElement('button'); all.type = 'button'; all.textContent = '이 색을 모든 일정에';
  all.title = '현재 선택된 색을 표의 모든 일정에 적용';
  all.addEventListener('click', () => { const id = currentColorId(ev); plan.events.forEach((e) => { if (id) e.color = id; else delete e.color; }); closeColorGrid(); rerender(); });
  foot.append(none, all);
  grid.appendChild(foot);
  anchor.closest('td').appendChild(grid);
  gridEl = grid;
}

function input(value, placeholder, onChange, type = 'text') {
  const el = document.createElement('input');
  el.type = type; el.value = value ?? ''; el.placeholder = placeholder ?? '';
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

function renderRows() {
  const tbody = $('rows');
  tbody.innerHTML = '';
  if (!plan) return;
  const errors = validate();
  plan.events.forEach((ev, i) => {
    const tr = document.createElement('tr');

    // 제목 (+색상 표시)
    const tdTitle = document.createElement('td');
    const st = document.createElement('div'); st.className = 'stack';
    st.appendChild(input(ev.title, '제목', (v) => { ev.title = v; rerender(); }));
    st.appendChild(colorPicker(ev));
    tdTitle.appendChild(st);

    // 일시 / 마감
    const tdWhen = document.createElement('td');
    const sw = document.createElement('div'); sw.className = 'stack';
    if (isTodo(ev)) {
      sw.appendChild(input(ev.due ?? ev.start ?? '', '마감 YYYY-MM-DD', (v) => { ev.due = v.trim(); delete ev.start; rerender(); }));
      const pr = document.createElement('select');
      for (const [v, t] of [['', '중요도 없음'], ['높음', '높음'], ['보통', '보통'], ['낮음', '낮음']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; pr.appendChild(o); }
      pr.value = ev.priority ?? '';
      pr.addEventListener('change', () => { if (pr.value) ev.priority = pr.value; else delete ev.priority; rerender(); });
      sw.appendChild(pr);
      tdWhen.appendChild(sw);
    } else {
      sw.appendChild(input(ev.start, 'YYYY-MM-DDTHH:MM 또는 YYYY-MM-DD', (v) => { ev.start = v.trim(); rerender(); }));
      const endRow = document.createElement('div'); endRow.className = 'inline';
      endRow.appendChild(input(ev.end ?? '', '종료 시각 (비우면 길이로 계산)', (v) => { v = v.trim(); if (v) { ev.end = v; delete ev.duration_min; } else delete ev.end; rerender(); }));
      const dur = input(ev.end ? '' : (ev.duration_min ?? (ev.start?.length === 10 ? '' : 60)), '길이(분)', (v) => { if (v) { ev.duration_min = Number(v); delete ev.end; } else delete ev.duration_min; rerender(); }, 'number');
      dur.style.maxWidth = '64px'; dur.title = '종료 시각 대신 길이(분)로 지정. 예: 75'; dur.disabled = Boolean(ev.end) || ev.start?.length === 10;
      endRow.appendChild(dur);
      sw.appendChild(endRow);
      if (ev.alarm_min !== undefined && ev.alarm_min !== null) {
        const a = document.createElement('span'); a.className = 'msg'; a.textContent = `⏰ ${ev.alarm_min}분 전`; sw.appendChild(a);
      }
      tdWhen.appendChild(sw);
    }

    // 반복 (할 일은 반복 없음 — 대신 일정/할 일 전환)
    const tdRep = document.createElement('td');
    if (isTodo(ev)) {
      const back = document.createElement('button'); back.type = 'button'; back.textContent = '일정으로 바꾸기';
      back.addEventListener('click', () => { delete ev.kind; ev.start = ev.due ?? ev.start; delete ev.due; delete ev.priority; delete ev.group; delete ev.done; rerender(); });
      tdRep.appendChild(back);
      tr.append(tdTitle, tdWhen, tdRep);
      const tdLoc0 = document.createElement('td'); tdLoc0.innerHTML = '<span class="msg">할 일</span>'; tr.appendChild(tdLoc0);
      const tdDel0 = document.createElement('td');
      const del0 = document.createElement('button'); del0.type = 'button'; del0.className = 'del'; del0.title = '이 항목 빼기'; del0.textContent = '×';
      del0.addEventListener('click', () => { plan.events.splice(i, 1); rerender(); });
      tdDel0.appendChild(del0); tr.appendChild(tdDel0);
      tbody.appendChild(tr);
      appendNoteAndError(tbody, ev, errors[i], checks?.[i]);
      return;
    }
    const rep = repeatOf(ev);
    if (rep?.rrule) {
      tdRep.appendChild(input(rep.rrule, 'RRULE', (v) => { ev.rrule = v.trim(); if (!ev.rrule) delete ev.rrule; rerender(); }));
    } else {
      const sr = document.createElement('div'); sr.className = 'stack';
      const freq = document.createElement('select');
      for (const [v, t] of [['', '없음'], ['daily', '매일'], ['weekly', '매주'], ['monthly', '매월'], ['yearly', '매년']]) {
        const o = document.createElement('option'); o.value = v; o.textContent = t; freq.appendChild(o);
      }
      freq.value = rep?.freq ?? '';
      freq.addEventListener('change', () => {
        if (!freq.value) delete ev.repeat; else ev.repeat = { ...(ev.repeat ?? {}), freq: freq.value };
        rerender();
      });
      sr.appendChild(freq);
      if (rep) {
        const line = document.createElement('div'); line.className = 'inline';
        const byday = (rep.byday ?? []).map((d) => EN_DAYS[String(d).toUpperCase()] ?? d).join(',');
        line.appendChild(input(byday, '요일 예: 화,목', (v) => {
          const arr = v.split(/[,\s·]+/).filter(Boolean);
          if (arr.length) ev.repeat.byday = arr; else delete ev.repeat.byday;
          rerender();
        }));
        line.appendChild(input(rep.until ?? (rep.count ? `${rep.count}회` : ''), '종료일 또는 N회', (v) => {
          v = v.trim(); delete ev.repeat.until; delete ev.repeat.count;
          if (/^\d+\s*회$/.test(v)) ev.repeat.count = Number(v.replace(/\D/g, ''));
          else if (v) ev.repeat.until = v;
          rerender();
        }));
        sr.appendChild(line);
        if (rep.interval && Number(rep.interval) !== 1) {
          const iv = document.createElement('span'); iv.className = 'msg'; iv.textContent = `${rep.interval}주기마다`; sr.appendChild(iv);
        }
      }
      tdRep.appendChild(sr);
    }

    // 장소 (+ 할 일 전환)
    const tdLoc = document.createElement('td');
    const locStack = document.createElement('div'); locStack.className = 'stack';
    locStack.appendChild(input(ev.location ?? '', '장소', (v) => { if (v.trim()) ev.location = v.trim(); else delete ev.location; rerender(); }));
    if (calendars.some((c) => c.kind === 'todo')) {
      const toTodo = document.createElement('button'); toTodo.type = 'button'; toTodo.className = 'msg'; toTodo.style.padding = '1px 4px'; toTodo.textContent = '할 일로 바꾸기';
      toTodo.addEventListener('click', () => {
        ev.kind = 'todo';
        ev.due = String(ev.start ?? '').slice(0, 10); // 마감은 날짜 기준
        delete ev.start; delete ev.end; delete ev.duration_min; delete ev.repeat; delete ev.rrule; delete ev.location; delete ev.alarm_min;
        rerender();
      });
      locStack.appendChild(toTodo);
    }
    tdLoc.appendChild(locStack);

    // 삭제
    const tdDel = document.createElement('td');
    const del = document.createElement('button'); del.type = 'button'; del.className = 'del'; del.title = '이 일정 빼기'; del.textContent = '×';
    del.addEventListener('click', () => { plan.events.splice(i, 1); rerender(); });
    tdDel.appendChild(del);

    tr.append(tdTitle, tdWhen, tdRep, tdLoc, tdDel);
    tbody.appendChild(tr);

    appendNoteAndError(tbody, ev, errors[i], checks?.[i]);
  });

  const anyErr = Object.keys(errors).length > 0 || errors.top;
  // 왜 못 누르는지 항상 보이게 한다 (조용히 비활성화되면 "눌러도 반응 없음"으로 보인다)
  const blocked = !plan.events.length ? '등록할 일정이 없습니다'
    : anyErr ? '오류를 고쳐야 등록할 수 있습니다'
    : !$('calendar').value ? '등록할 캘린더가 없습니다 — 설정에서 CalDAV 계정을 확인하고 ↻로 목록을 불러오세요'
    : plan.events.some(isTodo) && !$('todoCalendar').value ? '할 일 캘린더가 없습니다 — 이 서버는 할 일(VTODO)을 지원하지 않습니다'
    : '';
  $('registerBtn').disabled = Boolean(blocked);
  $('icsBtn').disabled = anyErr || !plan.events.length;
  $('registerBtn').textContent = checks ? '등록' : '검사 후 등록';
  $('registerBtn').title = blocked || '기존 일정과 비교한 뒤 등록합니다';
  setMsg('validMsg', errors.top ? errors.top : blocked || `${plan.events.length}건 확인 후 등록`, anyErr || blocked ? 'err' : '');
  $('preview').classList.toggle('hidden', !plan);
}

/** _note 경고 · 검사 결과 · 오류를 행 아래에 붙인다 */
function appendNoteAndError(tbody, ev, error, ck) {
  const row = (cls, html) => {
    const tr = document.createElement('tr'); tr.className = cls;
    const td = document.createElement('td'); td.colSpan = 5; td.innerHTML = html;
    tr.appendChild(td); tbody.appendChild(tr);
  };
  if (ev._note) row('note', `<span class="warn">⚠ 확인 필요: ${escapeHtml(String(ev._note))}</span>`);
  if (ck && (ck.duplicate || ck.overlaps.length)) {
    const parts = [];
    if (ck.duplicate) parts.push($('allowDup').checked ? '같은 제목·같은 날짜가 이미 있음 (체크되어 있어 등록됨)' : '같은 제목·같은 날짜가 이미 있음 → 건너뜀');
    if (ck.overlaps.length) parts.push(`시간 겹침: ${ck.overlaps.join(', ')}`);
    row('note', `<span class="warn">⚠ ${escapeHtml(parts.join(' · '))}</span>`);
  }
  if (error) row('rowerr', `✖ ${escapeHtml(error)}`);
}

/** 결정적 검증. 반환: {idx: message} (+ top) */
function validate() {
  const errors = {};
  if (!plan) return errors;
  plan.events.forEach((ev, i) => {
    try { parsePlan({ events: [ev] }); } catch (e) {
      if (e instanceof BadPlan) errors[i] = e.message.replace(/^events\[1\]/, '').replace(/^[.:\s]+/, '');
      else errors[i] = e.message;
    }
  });
  try { parsePlan(plan); } catch (e) { if (!Object.keys(errors).length) errors.top = e.message; }
  return errors;
}

function rerender() {
  checks = null; // 내용이 바뀌면 검사 결과는 무효
  scheduleDraftSave();
  if ($('jsonBox').style.display !== 'none') $('jsonBox').value = JSON.stringify(plan, null, 2);
  renderRows();
}

// 팝업은 창만 넘어가도 닫히므로 작성 중인 내용을 계속 보관한다
let draftTimer = null;
function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    saveDraft({
      input: $('input').value,
      plan,
      doc,
      calendarUrl: $('calendar').value,
      todoCalendarUrl: $('todoCalendar').value,
    }).catch(() => { /* 저장 실패는 작업을 막지 않는다 */ });
  }, 400);
}

async function restoreDraft() {
  const d = await getDraft();
  if (!d) return;
  if (d.input) $('input').value = d.input;
  if (d.doc) setDoc(d.doc);
  if (d.plan?.events?.length) {
    plan = d.plan;
    renderRows();
    setMsg('convertMsg', `이어서 작성 중 (${new Date(d.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} 저장) — "새로 쓰기"로 비울 수 있습니다`);
  }
  if (d.calendarUrl) $('calendar').value = d.calendarUrl;
  if (d.todoCalendarUrl) $('todoCalendar').value = d.todoCalendarUrl;
}

function resetAll() {
  plan = null; checks = null; doc = null; replaceBatch = null;
  updateReplaceBar();
  $('input').value = '';
  setDoc(null);
  $('jsonBox').value = '';
  $('preview').classList.add('hidden');
  $('result').classList.add('hidden');
  $('rows').innerHTML = '';
  setMsg('convertMsg', '');
  clearDraft();
}

function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function setMsg(id, text, cls = '') { const el = $(id); el.textContent = text; el.className = `msg ${cls}`; }

// ---------- 변환 ----------
async function convert() {
  const text = composeInput($('input').value, doc);
  if (!text) return setMsg('convertMsg', '계획을 입력하거나 문서를 첨부하세요', 'err');
  $('convertBtn').disabled = true;
  setMsg('convertMsg', 'LLM 변환 중…');
  $('result').classList.add('hidden');
  try {
    const r = await send('convert', { text });
    if (r.ok) {
      plan = r.plan;
      scheduleDraftSave();
      setMsg('convertMsg', `${plan.events.length}건 변환됨${r.attempts > 1 ? ' (재요청 1회)' : ''} — 내용을 확인·수정한 뒤 등록하세요`);
      if (plan.calendar) {
        const c = calendars.find((x) => x.name === plan.calendar);
        if (c) $('calendar').value = c.url;
        else setMsg('convertMsg', `'${plan.calendar}' 캘린더가 없어 선택된 캘린더에 등록합니다`, 'err');
      }
      rerender();
    } else {
      plan = null; renderRows();
      setMsg('convertMsg', `${r.error} — 아래 원문을 직접 고쳐 JSON으로 적용할 수 있습니다`, 'err');
      $('jsonBox').style.display = 'block'; $('jsonBox').value = r.raw || '';
    }
  } catch (e) { setMsg('convertMsg', e.message, 'err'); }
  $('convertBtn').disabled = false;
}

// ---------- 입력 소스: 현재 탭 / PDF (브라우저 안에서만 처리, 어디에도 업로드하지 않음) ----------
function setDoc(d) {
  doc = d;
  scheduleDraftSave();
  const info = $('docInfo');
  const prev = $('docPreview');
  if (!d) { info.textContent = ''; $('docClear').classList.add('hidden'); prev.style.display = 'none'; prev.value = ''; return; }
  const n = d.text.length;
  info.textContent = `📎 ${d.label} · ${n.toLocaleString()}자${n > MAX_DOC_CHARS ? ` (앞 ${MAX_DOC_CHARS.toLocaleString()}자만 사용)` : ''}`;
  $('docClear').classList.remove('hidden');
  prev.style.display = 'block'; prev.value = d.text.slice(0, 3000) + (n > 3000 ? '\n…' : '');
}

/** activeTab 권한: 사용자가 확장을 클릭한 그 탭에만 일시적으로 접근한다 (host 권한 불필요) */
async function grabActiveTab() {
  setMsg('convertMsg', '탭 본문 읽는 중…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || /^(chrome|edge|about|chrome-extension):/.test(tab.url ?? '')) throw new Error('이 탭에서는 본문을 읽을 수 없습니다');
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ title: document.title, text: (document.body?.innerText ?? '') }),
    });
    const text = cleanPageText(result?.text ?? '');
    if (!text) throw new Error('본문 텍스트가 비어 있습니다');
    setDoc({ kind: 'tab', label: result.title || tab.url, text });
    setMsg('convertMsg', '탭 본문을 첨부했습니다. 지시를 적고(선택) 변환하세요');
  } catch (e) { setMsg('convertMsg', e.message, 'err'); }
}

async function grabPdf(file) {
  if (!file) return;
  setMsg('convertMsg', `PDF 읽는 중… (${file.name})`);
  try {
    const pdfjs = await import('../vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('src/vendor/pdf.worker.min.mjs');
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      pages.push(pdfItemsToText((await page.getTextContent()).items));
    }
    const text = pages.join('\n\n');
    if (!text.trim()) throw new Error('텍스트를 추출하지 못했습니다 (스캔 이미지 PDF일 수 있음)');
    setDoc({ kind: 'pdf', label: `${file.name} (${pdf.numPages}쪽)`, text });
    setMsg('convertMsg', 'PDF 텍스트를 첨부했습니다. 지시를 적고(선택) 변환하세요');
  } catch (e) { setMsg('convertMsg', `PDF 읽기 실패: ${e.message}`, 'err'); }
}

// ICS 파일 내려받기 — CalDAV가 없는 서비스(구글 캘린더 등)의 '가져오기'용. 네트워크 없음
function downloadICS() {
  if (!plan) return;
  try {
    const { events } = parsePlan(addProvenance(plan, { source: doc?.label ?? '' }));
    const ics = exportICS(events);
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `caiendar-${new Date().toISOString().slice(0, 10)}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg('validMsg', `${events.length}건을 ICS로 내려받았습니다. 구글 캘린더: 설정 → 가져오기·내보내기`);
  } catch (e) { setMsg('validMsg', e.message, 'err'); }
}

// JSON 직접 편집: 표와 양방향
function toggleJson() {
  const box = $('jsonBox');
  const show = box.style.display === 'none' || !box.style.display;
  box.style.display = show ? 'block' : 'none';
  if (show) box.value = plan ? JSON.stringify(plan, null, 2) : '{\n  "events": []\n}';
}
function applyJson() {
  try {
    const obj = JSON.parse($('jsonBox').value);
    if (!obj || !Array.isArray(obj.events)) throw new Error("최상위에 'events' 배열이 있어야 합니다.");
    plan = obj; renderRows(); setMsg('convertMsg', 'JSON 적용됨');
  } catch (e) { setMsg('convertMsg', `JSON 오류: ${e.message}`, 'err'); }
}

// ---------- 등록 / 되돌리기 ----------
async function register() {
  if (!plan || validate().top || Object.keys(validate()).length) return;
  const calendarUrl = $('calendar').value;
  const calendarName = calendars.find((c) => c.url === calendarUrl)?.name ?? '';
  const todoCalendarUrl = $('todoCalendar').value;
  // _note(특이사항)·출처·서명을 설명에 남긴다. 원문 plan 은 표 편집을 위해 그대로 둔다
  const clean = addProvenance(plan, { source: doc?.label ?? '' });
  $('registerBtn').disabled = true;

  // 0단계: 수정 모드면 기존 등록을 먼저 지운다 (지우고 나야 중복 검사 결과가 깨끗하다)
  if (replaceBatch) {
    setMsg('validMsg', `기존 ${replaceBatch.events.length}건 삭제 중…`);
    try {
      const r = await send('undo', { batchId: replaceBatch.id });
      if (r.failed.length) {
        setMsg('validMsg', `기존 항목 ${r.failed.length}건을 지우지 못했습니다 — 캘린더에서 직접 지운 뒤 다시 시도하세요`, 'err');
        $('registerBtn').disabled = false;
        return;
      }
      replaceBatch = null;
      updateReplaceBar();
    } catch (e) {
      setMsg('validMsg', `기존 항목 삭제 실패: ${e.message}`, 'err');
      $('registerBtn').disabled = false;
      return;
    }
  }

  // 1단계: 검사만 (PUT 없음). 경고가 있으면 표에 띄우고 한 번 더 누르게 한다
  if (!checks) {
    setMsg('validMsg', '기존 일정과 비교 중…');
    try {
      const r = await send('preflight', { calendarUrl, plan: clean });
      checks = r.checks;
      renderRows();
      const nDup = checks.filter((c) => c.duplicate).length;
      const nOv = checks.filter((c) => c.overlaps.length).length;
      const warn = [nDup ? `중복 ${nDup}건` : '', nOv ? `겹침 ${nOv}건` : '', r.unreadable ? `기존 일정 ${r.unreadable}건 읽기 실패` : ''].filter(Boolean).join(' · ');
      if (warn) { setMsg('validMsg', `${warn} — 확인 후 등록을 다시 누르세요`, 'err'); $('registerBtn').disabled = false; return; }
      setMsg('validMsg', '이상 없음 — 등록합니다');
    } catch (e) { setMsg('validMsg', `검사 실패: ${e.message}`, 'err'); checks = null; renderRows(); $('registerBtn').disabled = false; return; }
  }

  // 2단계: 실제 등록
  $('registerBtn').disabled = true;
  setMsg('validMsg', '등록 중…');
  try {
    const r = await send('register', { calendarUrl, calendarName, todoCalendarUrl, plan: clean, allowDuplicate: $('allowDup').checked });
    showResult(r, calendarName);
    checks = null;
    replaceBatch = null;
    updateReplaceBar();
    clearDraft();
    setMsg('validMsg', '');
  } catch (e) { setMsg('validMsg', e.message, 'err'); $('registerBtn').disabled = false; }
}

function showResult(r, calendarName) {
  const box = $('result');
  box.classList.remove('hidden');
  const li = (cls, icon, text) => `<li class="${cls}">${icon} ${escapeHtml(text)}</li>`;
  let html = `<b>'${escapeHtml(calendarName)}'</b>에 ${r.added.length}건 등록`;
  if (r.skipped.length) html += `, ${r.skipped.length}건 건너뜀`;
  if (r.failed.length) html += `, <span class="err">${r.failed.length}건 실패</span>`;
  if (r.unreadable) html += `<div class="warn" style="margin-top:4px">⚠ 기존 일정 ${r.unreadable}건을 읽지 못해 중복 검사가 불완전할 수 있습니다</div>`;
  html += '<ul>';
  html += r.added.map((e) => li('ok', '✅', e.summary)).join('');
  html += r.skipped.map((e) => li('skip', '⏭', `이미 있음: ${e.summary}`)).join('');
  html += r.failed.map((e) => li('err', '❌', `${e.summary} — ${e.error}`)).join('');
  html += '</ul>';
  if (r.failed.length) html += `<button id="retryFailed" type="button">실패한 ${r.failed.length}건 다시 시도</button> `;
  if (r.batch.events.length) html += `<button id="undoBtn" type="button" data-id="${r.batch.id}">이번 등록 ${r.batch.events.length}건 되돌리기</button> <span id="undoMsg" class="msg"></span>`;
  box.innerHTML = html;
  $('undoBtn')?.addEventListener('click', () => undo(r.batch.id));
  $('retryFailed')?.addEventListener('click', () => {
    // 실패한 항목만 표로 되돌려 다시 등록할 수 있게 한다 (성공분은 그대로 둔다)
    const failedTitles = new Set(r.failed.map((e) => e.title));
    plan = { ...plan, events: plan.events.filter((e) => failedTitles.has(e.title)) };
    checks = null;
    $('result').classList.add('hidden');
    renderRows();
    setMsg('validMsg', `실패한 ${r.failed.length}건만 남겼습니다. 확인 후 등록하세요`, 'err');
  });
}

async function undo(batchId) {
  const btn = $('undoBtn'); btn.disabled = true;
  setMsg('undoMsg', '삭제 중…');
  try {
    const r = await send('undo', { batchId });
    setMsg('undoMsg', `${r.deleted.length}건 삭제${r.failed.length ? `, ${r.failed.length}건 실패 (다시 시도 가능)` : ''}`, r.failed.length ? 'err' : 'ok');
    if (r.failed.length) btn.disabled = false;
  } catch (e) { setMsg('undoMsg', e.message, 'err'); btn.disabled = false; }
}

async function showLastBatch() {
  const [b] = await getBatches();
  if (!b?.events?.length) return;
  renderBatchPanel(b);
}

/** 종류 태그. 판단할 수 없으면 달지 않는다 (일정이라고 단정하지 않기 위해) */
const KIND_TAG = (e, batch) => {
  const k = kindOf(e, batch);
  return k ? `<span class="tag${k === 'todo' ? ' todo' : ''}">${k === 'todo' ? '할 일' : '일정'}</span>` : '';
};

/** 최근 등록 1건을 팝업 안에서 보여 주고, 바로 고칠 수 있게 한다 */
function renderBatchPanel(b) {
  const box = $('result');
  box.classList.remove('hidden');
  const when = new Date(b.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const items = b.events.map((e) =>
    `<li>${KIND_TAG(e, b)}${escapeHtml(e.summary || e.title || '(제목 없음)')}</li>`).join('');
  box.innerHTML = `<span class="msg">최근 등록 (${escapeHtml(when)}, '${escapeHtml(b.calendarName || '')}') ${b.events.length}건</span>`
    + `<ul>${items}</ul>`
    + `<button id="editBtn" type="button"${b.plan?.events?.length ? '' : ' disabled title="이 버전에서 등록한 내역만 불러올 수 있습니다"'}>불러와 고치기</button> `
    + `<button id="undoBtn" type="button">되돌리기</button> <span id="undoMsg" class="msg"></span>`;
  $('undoBtn').addEventListener('click', () => undo(b.id));
  $('editBtn').addEventListener('click', () => loadForEdit(b));
}

/** 등록했던 내용을 표로 되돌려 편집 상태로 만든다. 다시 등록할 때 기존 항목을 먼저 지운다 */
function loadForEdit(b) {
  plan = JSON.parse(JSON.stringify(b.plan));
  replaceBatch = b;
  checks = null;
  if (b.calendarUrl) $('calendar').value = b.calendarUrl;
  if (b.todoCalendarUrl) $('todoCalendar').value = b.todoCalendarUrl;
  $('result').classList.add('hidden');
  updateReplaceBar();
  renderRows();
  scheduleDraftSave();
  setMsg('convertMsg', '최근 등록을 불러왔습니다. 고친 뒤 등록하면 기존 항목은 삭제되고 새로 등록됩니다');
}

function updateReplaceBar() {
  const bar = $('replaceBar');
  bar.classList.toggle('hidden', !replaceBatch);
  if (!replaceBatch) return;
  bar.innerHTML = `✏️ 최근 등록 ${replaceBatch.events.length}건을 고치는 중 — 등록하면 기존 항목을 먼저 삭제합니다. `
    + `<button id="cancelReplace" type="button" style="font-size:11.5px;padding:1px 6px">취소</button>`;
  $('cancelReplace').addEventListener('click', () => { replaceBatch = null; updateReplaceBar(); renderRows(); showLastBatch(); });
}

// ---------- 초기화 ----------
async function init() {
  $('convertBtn').addEventListener('click', convert);
  $('registerBtn').addEventListener('click', register);
  $('icsBtn').addEventListener('click', downloadICS);
  $('jsonToggle').addEventListener('click', toggleJson);
  $('jsonBox').addEventListener('change', applyJson);
  $('refreshCals').addEventListener('click', () => loadCalendars(true));
  $('tabBtn').addEventListener('click', grabActiveTab);
  $('pdfBtn').addEventListener('click', () => $('pdfFile').click());
  $('pdfFile').addEventListener('change', () => { grabPdf($('pdfFile').files[0]); $('pdfFile').value = ''; });
  $('docClear').addEventListener('click', () => setDoc(null));
  $('calendar').addEventListener('change', () => { checks = null; renderRows(); });
  $('todoCalendar').addEventListener('change', () => { checks = null; renderRows(); });
  $('allowDup').addEventListener('change', renderRows);
  $('openOptions').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
  $('openHistory').addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: chrome.runtime.getURL('src/history/history.html') }); });
  $('clearBtn').addEventListener('click', resetAll);
  $('input').addEventListener('input', scheduleDraftSave);
  const s = await getSettings();
  colorMap = (await getColorMap()) ?? bundledColorMap();
  colorNames = (await getNaverMeta())?.categoryNames ?? {};
  await loadCalendars(false);
  await restoreDraft();
  await showLastBatch();
  if (!s.caldav.username || !s.caldav.password) setMsg('convertMsg', 'CalDAV 계정이 없습니다 — 설정에서 입력하세요', 'err');
  else if (!s.llm.apiKey) setMsg('convertMsg', 'LLM API 키가 없습니다 — 설정에서 입력하세요 (JSON 직접 입력은 가능)', 'err');
}

init();
