// 받아쓰기 1단계: 급수 선택 → 듣고 쓰기 10문항 → 끝 화면
const CFG = { perTest: 10, reads: 2, replays: 1, rate: 0.8, cols: 10, maxCell: 104 };
const app = document.getElementById('app');
let state = null;        // { level, items, idx, answers, replaysLeft }
let sheet = null;        // 현재 문항 답안지 { cells, history, size, erasing }
let penSeen = false;

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
};
const show = (...nodes) => { app.innerHTML = ''; app.append(...nodes); window.scrollTo(0, 0); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- 저장 (IndexedDB) ----------
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('dictation', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('attempts', { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function saveAttempt(a) {
  try {
    const d = await openDb();
    await new Promise((res, rej) => { const tx = d.transaction('attempts', 'readwrite'); tx.objectStore('attempts').put(a); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    return true;
  } catch { return false; }
}

// ---------- 음성 ----------
// 미리 만든 음성 파일(audio/manifest.js)이 있으면 그것을 재생하고, 없으면 기기 내장 음성으로 읽는다.
let speakToken = 0;
const player = new Audio();      // 사파리는 한 번 사용자 누름으로 재생된 같은 요소만 이후 자동 재생을 허용한다
const AUDIO = window.AUDIO || { nums: [], items: {} };
function stopSpeak() { speakToken++; try { speechSynthesis.cancel(); } catch {} try { player.pause(); } catch {} }
function say(text) {
  return new Promise(res => {
    let done = false; const fin = () => { if (!done) { done = true; res(); } };
    if (!('speechSynthesis' in window)) return fin();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; u.rate = CFG.rate;
    const v = speechSynthesis.getVoices().find(v => v.lang && v.lang.startsWith('ko')); if (v) u.voice = v;
    u.onend = fin; u.onerror = fin;
    setTimeout(fin, 1500 + text.length * 600);      // 사파리에서 끝남 신호가 오지 않을 때를 대비
    speechSynthesis.speak(u);
  });
}
function playFile(src) {
  return new Promise(res => {
    if (!src) return res(false);
    player.onended = () => res(true); player.onerror = () => res(false);
    player.onpause = () => { if (!player.ended) res(true); };      // 중간에 멈춘 경우에도 기다림을 끝낸다
    player.src = src; player.play().catch(() => res(false));
  });
}
async function speak(src, text) { const my = speakToken; if (!(await playFile(src)) && my === speakToken) await say(text); }
async function readItem(withNumber) {
  const my = ++speakToken, item = state.items[state.idx];
  setSpeaking(true);
  if (withNumber) { await speak(AUDIO.nums[state.idx], (['일', '이', '삼', '사', '오', '육', '칠', '팔', '구', '십'][state.idx] || state.idx + 1) + '번'); await wait(400); }
  for (let k = 0; k < CFG.reads && my === speakToken; k++) {
    await speak(item.audio || AUDIO.items[item.text], item.text);
    if (k < CFG.reads - 1 && my === speakToken) await wait(1200);
  }
  if (my === speakToken) setSpeaking(false);
}
function setSpeaking(on) {
  const hint = document.getElementById('hint'), again = document.getElementById('again');
  if (hint) { hint.textContent = on ? '잘 들어 보세요…' : '들은 대로 써 보세요.'; hint.className = 'hint' + (on ? ' speaking' : ''); }
  if (again) again.disabled = on || state.replaysLeft <= 0;
}

// ---------- 화면: 급수 선택 ----------
function home() {
  stopSpeak(); state = null; sheet = null;
  show(
    el('h1', {}, '받아쓰기'),
    el('p', { class: 'lead' }, '급수를 골라 주세요.'),
    el('div', { class: 'levels' }, window.LEVELS.map(lv =>
      el('button', { onclick: () => ready(lv) }, lv.name, el('small', {}, Math.min(CFG.perTest, lv.items.length) + '문제'))))
  );
}

// ---------- 화면: 준비 ----------
function ready(level) {
  state = { level, items: shuffle(level.items).slice(0, CFG.perTest), idx: 0, answers: [], replaysLeft: CFG.replays };
  show(el('div', { class: 'center' },
    el('h2', {}, level.name + ' 받아쓰기'),
    el('div', { class: 'num' }, '문제를 ' + CFG.reads + '번씩 읽어 줄게요. 잘 듣고 칸에 한 글자씩 써요.'),
    el('button', { class: 'primary big', onclick: () => { renderItem(); readItem(true); } }, '시작'),   // 이 누름으로 소리 재생이 허용됨
    el('button', { class: 'quit', onclick: home }, '급수 다시 고르기')
  ));
}

// ---------- 화면: 듣고 쓰기 ----------
function renderItem() {
  const n = state.items.length, i = state.idx, item = state.items[i];
  state.replaysLeft = CFG.replays;
  const size = Math.floor(Math.min(CFG.maxCell, (app.clientWidth - 56) / CFG.cols));
  const rows = Math.max(2, Math.ceil((Array.from(item.text).length + 2) / CFG.cols));
  const grid = el('div', { class: 'sheet', style: 'grid-template-columns:repeat(' + CFG.cols + ',' + (size + 2) + 'px)' });
  sheet = { cells: [], history: [], size, erasing: false, grid };
  for (let k = 0; k < rows * CFG.cols; k++) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cv = el('canvas', { width: size * dpr, height: size * dpr, style: 'width:' + size + 'px;height:' + size + 'px' });
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    const c = { canvas: cv, ctx, strokes: [] }; sheet.cells.push(c); attach(c, k); grid.append(cv);
  }
  const eraser = el('button', { id: 'eraser', onclick: () => { sheet.erasing = !sheet.erasing; eraser.className = sheet.erasing ? 'on' : ''; grid.classList.toggle('erasing', sheet.erasing); } }, '지우개');
  show(
    el('div', { class: 'top' },
      el('h2', {}, (i + 1) + '번'),
      el('div', { class: 'dots' }, state.items.map((_, k) => el('i', { class: k < i ? 'done' : k === i ? 'now' : '' }))),
      el('button', { class: 'quit', onclick: () => { if (confirm('그만할까요? 지금까지 쓴 것은 지워져요.')) home(); } }, '그만하기')),
    el('div', { class: 'listen' },
      el('button', { id: 'again', onclick: () => { if (state.replaysLeft > 0) { state.replaysLeft--; document.getElementById('again').textContent = againLabel(); readItem(false); } } }, againLabel()),
      el('span', { id: 'hint', class: 'hint' }, '들은 대로 써 보세요.')),
    grid,
    el('div', { class: 'tools' },
      el('div', { class: 'left' },
        el('button', { onclick: undo }, '되돌리기'), eraser,
        el('button', { onclick: () => { sheet.cells.forEach(clearCell); sheet.history = []; } }, '전부 지우기')),
      el('button', { class: 'primary', onclick: next }, i === n - 1 ? '끝! 다 썼어요' : '다 썼어요 →'))
  );
}
const againLabel = () => '다시 듣기 (' + state.replaysLeft + '번 남음)';

function penStyle(ctx, size) { ctx.lineWidth = Math.max(2.5, size / 30); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#23272f'; }
function drawStrokes(ctx, strokes, size, scale = 1) {
  penStyle(ctx, size * scale);
  for (const s of strokes) {
    ctx.beginPath(); ctx.moveTo(s[0][0] * scale, s[1][0] * scale);
    if (s[0].length === 1) ctx.lineTo(s[0][0] * scale + 0.1, s[1][0] * scale + 0.1);
    for (let p = 1; p < s[0].length; p++) ctx.lineTo(s[0][p] * scale, s[1][p] * scale);
    ctx.stroke();
  }
}
function clearCell(c) { c.strokes = []; c.ctx.clearRect(0, 0, sheet.size, sheet.size); }
function redraw(c) { c.ctx.clearRect(0, 0, sheet.size, sheet.size); drawStrokes(c.ctx, c.strokes, sheet.size); }
function undo() { const k = sheet.history.pop(); if (k == null) return; const c = sheet.cells[k]; c.strokes.pop(); redraw(c); }

function attach(c, k) {
  let cur = null, t0 = 0;
  const r1 = v => Math.round(v * 10) / 10;
  const pos = e => { const r = c.canvas.getBoundingClientRect(); return [r1(e.clientX - r.left), r1(e.clientY - r.top)]; };
  c.canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'pen') penSeen = true;
    if (penSeen && e.pointerType === 'touch') return;          // 펜을 쓰면 손바닥·손가락은 무시
    e.preventDefault();
    if (sheet.erasing) { clearCell(c); sheet.history = sheet.history.filter(h => h !== k); return; }
    c.canvas.setPointerCapture(e.pointerId);
    if (!c.strokes.length) t0 = performance.now();
    const [x, y] = pos(e); cur = [[x], [y], [Math.round(performance.now() - t0)]];
    penStyle(c.ctx, sheet.size); c.ctx.beginPath(); c.ctx.moveTo(x, y); c.ctx.lineTo(x + 0.1, y + 0.1); c.ctx.stroke();
  });
  c.canvas.addEventListener('pointermove', e => {
    if (!cur) return; e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of (evs.length ? evs : [e])) {
      const [x, y] = pos(ev);
      c.ctx.beginPath(); c.ctx.moveTo(cur[0].at(-1), cur[1].at(-1)); c.ctx.lineTo(x, y); c.ctx.stroke();
      cur[0].push(x); cur[1].push(y); cur[2].push(Math.round(performance.now() - t0));
    }
  });
  const end = () => { if (cur) { c.strokes.push(cur); sheet.history.push(k); cur = null; } };
  c.canvas.addEventListener('pointerup', end);
  c.canvas.addEventListener('pointercancel', end);
}

function next() {
  if (!sheet.cells.some(c => c.strokes.length) && !confirm('아직 아무것도 안 썼어요. 그래도 넘어갈까요?')) return;
  stopSpeak();
  state.answers[state.idx] = { text: state.items[state.idx].text, size: sheet.size, cols: CFG.cols, cells: sheet.cells.map(c => c.strokes) };
  if (state.idx < state.items.length - 1) { state.idx++; renderItem(); readItem(true); }
  else finish();
}

// ---------- 화면: 끝 ----------
async function finish() {
  const attempt = { id: Date.now(), when: new Date().toISOString(), levelId: state.level.id, levelName: state.level.name, status: 'written', answers: state.answers };
  const saved = await saveAttempt(attempt);
  const T = 44;
  const rows = state.answers.map((a, i) => {
    const used = a.cells.reduce((m, s, k) => s.length ? k : m, -1) + 1, cols = a.cols, nrow = Math.max(1, Math.ceil(used / cols));
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cv = el('canvas', { width: cols * T * dpr, height: nrow * T * dpr, style: 'width:' + cols * T + 'px;height:' + nrow * T + 'px' });
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    a.cells.slice(0, nrow * cols).forEach((s, k) => {
      const x = (k % cols) * T, y = Math.floor(k / cols) * T;
      ctx.strokeStyle = '#e3b9b1'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
      ctx.save(); ctx.translate(x, y); drawStrokes(ctx, s, a.size, T / a.size); ctx.restore();
    });
    return el('div', { class: 'row' }, el('b', {}, (i + 1) + '번'), cv);
  });
  show(
    el('h1', {}, '다 썼어요!'),
    el('p', { class: 'lead' }, '참 잘했어요. 이제 부모님을 불러 주세요.'),
    el('div', { class: 'done-list' }, rows),
    el('p', { class: 'note' }, saved ? '쓴 내용을 이 기기에 저장했습니다. 채점 화면은 다음 단계에서 추가됩니다.' : '저장하지 못했습니다. 이 화면을 닫으면 쓴 내용이 사라집니다.'),
    el('button', { onclick: home }, '처음으로')
  );
}

document.addEventListener('touchmove', e => { if (e.target.tagName === 'CANVAS') e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
home();
