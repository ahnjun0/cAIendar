// 등록 기록: 배치 목록을 보여 주고 배치 단위로 되돌린다. 기록 자체는 chrome.storage.local 에만 있다.
import { getBatches, removeBatch } from '../lib/storage.js';
import { kindOf } from '../lib/batchkind.js';

const $ = (id) => document.getElementById(id);
const send = (type, payload) => new Promise((resolve, reject) => {
  chrome.runtime.sendMessage({ type, payload }, (res) => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    res?.ok ? resolve(res.result) : reject(new Error(res?.error ?? '알 수 없는 오류'));
  });
});
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '(시각 미상)' : d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
};

/** 종류 태그. 판단할 수 없으면 달지 않는다 (일정이라고 단정하지 않기 위해) */
const KIND_TAG = (e, batch) => {
  const k = kindOf(e, batch);
  return k ? `<span class="tag${k === 'todo' ? ' todo' : ''}">${k === 'todo' ? '할 일' : '일정'}</span>` : '';
};

async function render() {
  const list = $('list');
  const batches = await getBatches();
  list.innerHTML = '';
  if (!batches.length) {
    list.innerHTML = '<p class="msg">아직 등록한 내역이 없습니다.</p>';
    return;
  }
  for (const b of batches) {
    const card = document.createElement('div');
    card.className = 'batch';
    const items = (b.events ?? []).map((e) =>
      `<li>${KIND_TAG(e, b)}${esc(e.summary || e.title || '(제목 없음)')}</li>`).join('');
    card.innerHTML = `
      <div class="head">
        <span class="when">${esc(when(b.at))}</span>
        <span class="where">${esc(b.calendarName || '')} · ${b.events?.length ?? 0}건</span>
        <button type="button" class="b-undo">되돌리기</button>
        <button type="button" class="b-forget" title="캘린더는 그대로 두고 이 기록만 지웁니다">기록만 삭제</button>
        <span class="msg m-status"></span>
      </div>
      <ul>${items}</ul>`;
    card.querySelector('.b-undo').addEventListener('click', () => undo(b, card));
    card.querySelector('.b-forget').addEventListener('click', async () => {
      await removeBatch(b.id);
      render();
    });
    list.appendChild(card);
  }
}

async function undo(batch, card) {
  const status = card.querySelector('.m-status');
  const btn = card.querySelector('.b-undo');
  btn.disabled = true;
  status.textContent = '삭제 중…';
  status.className = 'msg';
  try {
    const r = await send('undo', { batchId: batch.id });
    if (r.failed.length) {
      status.textContent = `${r.deleted.length}건 삭제, ${r.failed.length}건 실패 — 다시 시도할 수 있습니다`;
      status.className = 'msg err';
      btn.disabled = false;
      render();
    } else {
      status.textContent = `${r.deleted.length}건 삭제됨`;
      status.className = 'msg ok';
      card.classList.add('gone');
      setTimeout(render, 800);
    }
  } catch (e) {
    status.textContent = e.message;
    status.className = 'msg err';
    btn.disabled = false;
  }
}

$('ver').textContent = `v${chrome.runtime.getManifest().version}`;
$('reload').addEventListener('click', render);
render();
