import { PRESETS } from '../lib/caldav.js';
import { LLM_PRESETS } from '../lib/llm.js';
import { getSettings, saveSettings, getCalendarsCache, getColorMap, getNaverMeta } from '../lib/storage.js';
import { bundledColorMap } from '../lib/naver_codes.js';

const $ = (id) => document.getElementById(id);
const send = (type, payload) => new Promise((resolve, reject) => {
  chrome.runtime.sendMessage({ type, payload }, (res) => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    res?.ok ? resolve(res.result) : reject(new Error(res?.error ?? '알 수 없는 오류'));
  });
});

// manifest의 host_permissions에 없는 호스트는 optional_host_permissions에서 요청
// 네이버 외의 호스트는 manifest의 optional_host_permissions 에 있고, 사용자가 버튼을 눌렀을 때만 요청된다
async function ensureHost(url) {
  let origin;
  try { origin = `${new URL(url).origin}/*`; } catch { throw new Error(`주소 형식이 잘못됨: ${url}`); }
  if (await chrome.permissions.contains({ origins: [origin] })) return;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) throw new Error(`${origin} 접근 권한이 거부되었습니다.`);
}

function fillCalendars(cals, selected) {
  const list = $('calList');
  list.innerHTML = '';
  const sel = $('defaultCalendar');
  sel.innerHTML = '<option value="">(첫 번째 캘린더)</option>';
  for (const c of cals) {
    const li = document.createElement('li'); li.textContent = c.name; list.appendChild(li);
    const o = document.createElement('option'); o.value = c.url; o.textContent = c.name; sel.appendChild(o);
  }
  sel.value = selected ?? '';
}

function fillPresetSelects() {
  const ls = $('llmPreset');
  for (const [k, p] of Object.entries(LLM_PRESETS)) { const o = document.createElement('option'); o.value = k; o.textContent = p.label; ls.appendChild(o); }
}

/** 저장된 baseUrl 로부터 어떤 LLM 프리셋인지 역추적 */
function llmPresetOf(baseUrl) {
  const u = String(baseUrl ?? '').replace(/\/+$/, '');
  return Object.keys(LLM_PRESETS).find((k) => LLM_PRESETS[k].baseUrl === u) ?? 'gemini';
}

function readForm() {
  return {
    caldav: {
      preset: 'naver',
      baseUrl: PRESETS.naver,
      username: $('username').value.trim(),
      password: $('password').value,
      defaultCalendarUrl: $('defaultCalendar').value,
    },
    llm: { baseUrl: $('llmBaseUrl').value.trim(), model: $('llmModel').value.trim(), apiKey: $('llmKey').value },
  };
}

function renderPalette(map, names = {}) {
  const box = $('palette');
  box.innerHTML = '';
  for (const id of Object.keys(map).map(Number).sort((a, b) => a - b)) {
    const sw = document.createElement('span'); sw.style.background = map[id];
    sw.textContent = names[id] ? `${id} ${names[id]}` : String(id);
    sw.title = `${id} ${map[id]}${names[id] ? ` · ${names[id]}` : ''}`;
    box.appendChild(sw);
  }
}
async function refreshPalette() {
  renderPalette((await getColorMap()) ?? bundledColorMap(), (await getNaverMeta())?.categoryNames ?? {});
}

/** 저장돼 있는데 권한이 없는 호스트를 알려 준다 (설치 시에는 네이버 CalDAV만 필요하므로) */
async function checkGranted(s) {
  const need = [];
  for (const [url, label] of [[PRESETS.naver, '네이버 캘린더'], [s.llm.baseUrl, 'LLM 공급자']]) {
    if (!url) continue;
    try {
      const origin = `${new URL(url).origin}/*`;
      if (!(await chrome.permissions.contains({ origins: [origin] }))) need.push(`${label}(${new URL(url).host})`);
    } catch { /* 주소가 비정상이면 저장할 때 걸린다 */ }
  }
  if (need.length) { const m = $('saveMsg'); m.textContent = `권한 필요: ${need.join(', ')} — 저장을 한 번 눌러 승인해 주세요`; m.className = 'hint err'; }
}

async function init() {
  fillPresetSelects();
  $('ver').textContent = `v${chrome.runtime.getManifest().version}`;
  await refreshPalette();
  $('colorsBtn').addEventListener('click', async () => {
    const msg = $('colorsMsg'); msg.textContent = '읽는 중…'; msg.className = 'hint';
    try {
      await ensureHost('https://calendar.naver.com/'); // 이 버튼을 누를 때만 권한을 요청한다
      const r = await send('refreshNaverCodes');
      const parts = [];
      if (r.colors) parts.push(`색상 ${r.colors}개`);
      if (r.categories) parts.push(`카테고리 이름 ${r.categories}개`);
      if (r.stickers) parts.push(`스티커 ${r.stickers}개`);
      if (r.errors.length) parts.push(r.errors.join(' / '));
      msg.textContent = parts.join(' · ') || '변화 없음';
      msg.className = r.colors ? 'hint ok' : 'hint err';
      await refreshPalette();
    } catch (e) { msg.textContent = e.message; msg.className = 'hint err'; }
  });

  const s = await getSettings();
  $('baseUrl').value = PRESETS.naver;
  $('username').value = s.caldav.username;
  $('password').value = s.caldav.password;
  $('llmBaseUrl').value = s.llm.baseUrl;
  $('llmModel').value = s.llm.model;
  $('llmKey').value = s.llm.apiKey;
  fillCalendars(await getCalendarsCache(), s.caldav.defaultCalendarUrl);
  checkGranted(s);

  $('llmPreset').value = llmPresetOf(s.llm.baseUrl);
  const onLlmPreset = (apply) => {
    const key = $('llmPreset').value;
    const p = LLM_PRESETS[key];
    $('llmBaseUrl').value = p.baseUrl; // 프리셋의 주소만 쓴다 (권한이 승인된 호스트)
    if (apply) $('llmModel').value = p.model;
    $('llmHint').textContent = p.note;
  };
  $('llmPreset').addEventListener('change', () => onLlmPreset(true));
  onLlmPreset(false);

  $('testBtn').addEventListener('click', async () => {
    const msg = $('testMsg'); msg.textContent = '연결 중…'; msg.className = 'hint';
    try {
      const form = readForm();
      await ensureHost(form.caldav.baseUrl);
      const prev = await getSettings();
      await saveSettings({ ...prev, ...form }); // 백그라운드가 저장된 값으로 접속
      const cals = await send('listCalendars', { refresh: true });
      fillCalendars(cals, form.caldav.defaultCalendarUrl);
      msg.textContent = `캘린더 ${cals.length}개`; msg.className = 'hint ok';
    } catch (e) { msg.textContent = e.message; msg.className = 'hint err'; }
  });

  $('saveBtn').addEventListener('click', async () => {
    const msg = $('saveMsg');
    try {
      const form = readForm();
      await ensureHost(form.caldav.baseUrl);
      if (form.llm.baseUrl) await ensureHost(form.llm.baseUrl);
      const prev = await getSettings();
      await saveSettings({ ...prev, ...form });
      msg.textContent = '저장됨'; msg.className = 'hint ok';
    } catch (e) { msg.textContent = e.message; msg.className = 'hint err'; }
  });
}

init();
