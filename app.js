// 받아쓰기: 급수 선택 → 듣고 쓰기 → AI 1차 채점 → 부모 확인(PIN) → 결과 → 틀린 문제 다시 쓰기
const CFG = { perTest: 10, reads: 2, replays: 1, rate: 0.8, cols: 10, maxCell: 104 };
const ENDPOINT = 'https://inputtools.google.com/request?itc=ko-t-i0-handwrit&app=demopage';
const PIN_KEY = 'dictation-pin';
const app = document.getElementById('app');
let state = null;        // { level, all, items, idx, answers, replaysLeft, round, correct, attempt }
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
const show = (...nodes) => { app.innerHTML = ''; app.append(...nodes.flat().filter(n => n != null)); window.scrollTo(0, 0); };   // 비워 둔 자리(null)는 건너뛴다
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
const NUM_WORDS = ['일', '이', '삼', '사', '오', '육', '칠', '팔', '구', '십'];
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
  if (withNumber) { await speak(AUDIO.nums[item.no - 1], (NUM_WORDS[item.no - 1] || item.no) + '번'); await wait(400); }
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
  const levels = getLevels(), many = store.profiles.length > 1, d = new Date();
  const dateLine = (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + '일월화수목금토'[d.getDay()] + '요일';
  const grid = el('div', { class: 'levels' }, levels.map(lv =>
    el('button', { 'data-level': lv.id, onclick: () => ready(lv) }, el('span', { class: 'lv-name' }, lv.name), el('small', {}, Math.min(CFG.perTest, lv.items.length) + '문제'))));
  show(
    el('div', { class: 'top' },
      el('div', {}, el('div', { class: 'date' }, dateLine), el('h1', {}, '받아쓰기 시간')),
      el('div', { class: 'top-right' },
        many ? el('div', { class: 'chips' }, store.profiles.map(p => el('button', { class: p.id === curProfile().id ? 'on' : '', onclick: () => { store.currentProfile = p.id; saveStore(); home(); } }, p.name))) : null,
        el('button', { class: 'quit', onclick: () => pinGate(parentMenu, home) }, '부모님'))),
    el('p', { class: 'lead' }, (many ? curProfile().name + ', ' : '') + '몇 급을 써 볼까요? 동그라미를 눌러요.'),
    levels.length ? null : el('p', { class: 'note' }, '급수표가 비어 있습니다. 부모님 메뉴에서 급수를 추가해 주세요.'),
    grid,
    store.videos.some(v => !v.blocked) ? el('p', { class: 'promise' }, CFG.perTest + '문제를 다 맞히면 뮤직비디오 한 편!') : null
  );
  decorateLevels(grid);
}
// 지금 고른 아이의 기록을 보고, 통과한 급수에는 도장을, 아직 통과 못 한 급수에는 지난 점수를 붙인다.
async function decorateLevels(grid) {
  const name = curProfile().name;
  const mine = (await allAttempts()).filter(a => a.profile === name && a.score != null).sort((a, b) => a.id - b.id);
  for (const btn of grid.children) {
    const tries = mine.filter(a => a.levelId === btn.dataset.level);
    if (!tries.length) continue;
    if (tries.some(a => a.status === 'passed')) btn.append(el('span', { class: 'stamp' }, '참', el('br'), '잘했어요'));
    else btn.querySelector('small').textContent = '지난번 ' + tries.at(-1).score + '개';
  }
}

// ---------- 화면: 준비 ----------
function ready(level) {
  const all = shuffle(level.items).slice(0, CFG.perTest).map((it, i) => ({ ...it, no: i + 1 }));
  state = {
    level, all, items: all, idx: 0, answers: [], replaysLeft: store.settings.replays, round: 1, correct: new Set(),
    attempt: { id: Date.now(), when: new Date().toISOString(), profile: curProfile().name, levelId: level.id, levelName: level.name, status: 'writing', rounds: [] }
  };
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
  state.replaysLeft = store.settings.replays;
  const pad = parseFloat(getComputedStyle(app).paddingLeft) * 2 + 32 + 4;      // 칠판 안쪽 여백 + 공책 종이 여백 + 테두리
  const size = Math.floor(Math.min(CFG.maxCell, (app.clientWidth - pad) / CFG.cols - 2));
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
      el('h2', {}, item.no + '번 문제' + (state.round > 1 ? ' 다시 쓰기' : '')),
      el('div', { class: 'dots' }, state.items.map((_, k) => el('i', { class: k < i ? 'done' : k === i ? 'now' : '' }))),
      el('button', { class: 'quit', onclick: () => { if (confirm('그만할까요? 지금까지 쓴 것은 지워져요.')) home(); } }, '그만하기')),
    el('div', { class: 'listen' },
      el('button', { id: 'again', onclick: () => { if (state.replaysLeft > 0) { state.replaysLeft--; document.getElementById('again').textContent = againLabel(); readItem(false); } } }, againLabel()),
      el('span', { id: 'hint', class: 'hint' }, '들은 대로 써 보세요.')),
    el('div', { class: 'paper' }, grid),
    el('div', { class: 'tools' },
      el('div', { class: 'left' },
        el('button', { onclick: undo }, '되돌리기'), eraser,
        el('button', { onclick: () => { sheet.cells.forEach(clearCell); sheet.history = []; } }, '전부 지우기')),
      el('button', { class: 'primary', onclick: next }, i === n - 1 ? '끝! 다 썼어요' : '다 썼어요 →'))
  );
}
const againLabel = () => '다시 듣기 (' + state.replaysLeft + '번 남음)';

function penStyle(ctx, size) { ctx.lineWidth = Math.max(1.5, size / 30); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#23272f'; }
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
  const item = state.items[state.idx];
  state.answers[state.idx] = { no: item.no, text: item.text, size: sheet.size, cols: CFG.cols, cells: sheet.cells.map(c => c.strokes) };
  if (state.idx < state.items.length - 1) { state.idx++; renderItem(); readItem(true); }
  else finishRound();
}

// ---------- AI 1차 채점 ----------
async function recognize(strokes, size) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const body = { options: 'enable_pre_space', requests: [{ writing_guide: { writing_area_width: size, writing_area_height: size }, ink: strokes, language: 'ko' }] };
    const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j[0] !== 'SUCCESS') throw new Error(String(j[0]));
    const raw = (j[1] && j[1][0] && j[1][0][1]) || [];
    return [...new Set(raw.map(s => s.trim()).filter(Boolean))];
  } finally { clearTimeout(timer); }
}

// 글자와 띄어쓰기를 따로 채점한다.
// 1) 빈칸을 뺀 글자끼리 정답과 맞춰 정렬해서 글자를 채점한다(띄어쓰기 때문에 칸이 밀려도 영향 없음).
// 2) 이웃한 두 글자 사이를 띄웠는지를 정답과 비교해서 띄어쓰기만 따로 판정한다.
// info[k] = { has: 그 칸에 글씨가 있는지, cands: 인식 후보 }
function gradeOne(text, info) {
  const tl = []; let sp = false;
  for (const ch of Array.from(text.trim())) { if (ch === ' ') sp = true; else { tl.push({ ch, spaceBefore: sp }); sp = false; } }
  const wl = []; let blanks = 0;
  info.forEach((c, k) => { if (c.has) { wl.push({ k, cands: c.cands, blanksBefore: blanks }); blanks = 0; } else blanks++; });
  const n = wl.length, m = tl.length, GAP = 1;
  const sub = (w, t) => { const r = w.cands.indexOf(t.ch); return r === 0 ? 0 : r > 0 ? 0.4 : 1.5; };
  const D = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) D[i][0] = i * GAP;
  for (let j = 1; j <= m; j++) D[0][j] = j * GAP;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++)
    D[i][j] = Math.min(D[i - 1][j - 1] + sub(wl[i - 1], tl[j - 1]), D[i - 1][j] + GAP, D[i][j - 1] + GAP);
  const cells = {}, pairs = [], missing = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + sub(wl[i - 1], tl[j - 1])) { pairs.push([i - 1, j - 1]); i--; j--; }
    else if (i > 0 && D[i][j] === D[i - 1][j] + GAP) { cells[wl[i - 1].k] = { target: '', verdict: 'bad', read: wl[i - 1].cands[0] || '' }; i--; }   // 정답에 없는 글자
    else { missing.push(tl[j - 1].ch); j--; }                                                                                               // 빠뜨린 글자
  }
  pairs.reverse(); missing.reverse();
  let spaceErr = 0;
  pairs.forEach(([wi, tj], p) => {
    const w = wl[wi], rank = w.cands.indexOf(tl[tj].ch);
    const c = cells[w.k] = { target: tl[tj].ch, verdict: rank === 0 ? 'good' : rank > 0 ? 'warn' : 'bad', read: w.cands[0] || '' };
    const prev = pairs[p - 1];
    if (prev && prev[0] === wi - 1 && prev[1] === tj - 1) {          // 바로 앞 글자도 짝이 맞을 때만 그 사이를 본다
      const wrote = w.blanksBefore > 0, want = tl[tj].spaceBefore;
      if (wrote !== want) { c.spaceNote = want ? '앞을 띄어야 함' : '앞을 붙여야 함'; spaceErr++; }
    }
  });
  const vals = Object.values(cells);
  const letterErr = vals.filter(c => c.verdict === 'bad').length + missing.length, check = vals.filter(c => c.verdict === 'warn').length;
  return { cells, missing, letterErr, check, spaceErr, verdict: letterErr || spaceErr ? 'bad' : check ? 'check' : 'good' };
}

// 모든 답안의 글씨 칸을 인식하고 답안마다 ai 결과를 붙인다. 인식이 안 된 답안은 ai = null (부모 채점만으로 진행).
async function gradeAnswers(answers) {
  const jobs = [], cands = new Map(), failed = new Set();
  answers.forEach(a => a.cells.forEach((s, k) => { if (s.length) jobs.push({ a, k, s }); }));
  let p = 0;
  const worker = async () => {
    while (p < jobs.length) {
      const job = jobs[p++];
      if (failed.has(job.a)) continue;
      try { cands.set(job.a.no + ':' + job.k, await recognize(job.s, job.a.size)); } catch { failed.add(job.a); }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  for (const a of answers)
    a.ai = failed.has(a) ? null : gradeOne(a.text, a.cells.map((s, k) => ({ has: s.length > 0, cands: cands.get(a.no + ':' + k) || [] })));
}

// 답안 한 줄을 작은 원고지로 그린다. marked이면 AI 판정을 칸 색으로 표시한다.
function answerCanvas(a, T, marked) {
  const used = a.cells.reduce((m, s, k) => s.length ? k : m, -1) + 1, cols = a.cols, nrow = Math.max(1, Math.ceil(used / cols));
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cv = el('canvas', { width: cols * T * dpr, height: nrow * T * dpr, style: 'width:' + cols * T + 'px;height:' + nrow * T + 'px' });
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  a.cells.slice(0, nrow * cols).forEach((s, k) => {
    const x = (k % cols) * T, y = Math.floor(k / cols) * T, mark = marked && a.ai && a.ai.cells[k];
    if (mark && mark.verdict !== 'good') { ctx.fillStyle = mark.verdict === 'bad' ? '#fbd5cf' : '#fff0b8'; ctx.fillRect(x, y, T, T); }
    ctx.strokeStyle = '#a9c3ea'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
    if (mark && mark.spaceNote) { ctx.fillStyle = '#e8710a'; ctx.fillRect(x, y, 5, T); }      // 띄어쓰기 오류: 칸 왼쪽에 주황 띠
    ctx.save(); ctx.translate(x, y); drawStrokes(ctx, s, a.size, T / a.size); ctx.restore();
  });
  return cv;
}

// ---------- 화면: 채점 대기 → 부모 호출 ----------
async function finishRound() {
  const answers = state.answers;
  show(el('div', { class: 'center' }, el('h2', {}, '채점하고 있어요…'), el('div', { class: 'num' }, '잠깐만 기다려 주세요.')));
  await gradeAnswers(answers);
  state.attempt.rounds.push({ round: state.round, answers });
  state.attempt.status = 'written';
  await saveAttempt(state.attempt);
  callParent();
}
function callParent() {
  show(
    el('h1', {}, '다 썼어요!'),
    el('p', { class: 'lead' }, '참 잘했어요. 이제 부모님을 불러 주세요.'),
    el('div', { class: 'done-list' }, state.answers.map(a => el('div', { class: 'row' }, el('b', {}, a.no + '번'), answerCanvas(a, 44, false)))),
    el('button', { class: 'primary', onclick: () => pinGate(review, callParent) }, '부모님 확인')
  );
}

// ---------- 화면: PIN ----------
// reset = true 이면 번호를 새로 정한다(부모님 메뉴 안에서만 부른다).
function pinGate(onOk, onCancel, reset = false) {
  let saved = null; try { saved = localStorage.getItem(PIN_KEY); } catch {}
  let mode = saved && !reset ? 'enter' : 'set1', first = '', typed = '';
  const title = el('h2', {}), msg = el('div', { class: 'num' }), dots = el('div', { class: 'pin-dots' });
  const paint = () => {
    title.textContent = mode === 'enter' ? '부모님 번호를 눌러 주세요' : mode === 'set1' ? '부모님 번호 4자리를 정해 주세요' : '같은 번호를 한 번 더 눌러 주세요';
    dots.innerHTML = ''; for (let k = 0; k < 4; k++) dots.append(el('i', { class: k < typed.length ? 'on' : '' }));
  };
  const done = () => {
    if (mode === 'enter') { if (typed === saved) return onOk(); msg.textContent = '번호가 달라요. 다시 눌러 주세요.'; }
    else if (mode === 'set1') { first = typed; mode = 'set2'; msg.textContent = ''; }
    else if (typed === first) { try { localStorage.setItem(PIN_KEY, typed); } catch {} return onOk(); }
    else { mode = 'set1'; msg.textContent = '두 번호가 달라요. 처음부터 다시 정해 주세요.'; }
    typed = ''; paint();
  };
  const press = d => { if (typed.length >= 4) return; typed += d; paint(); if (typed.length === 4) setTimeout(done, 150); };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => el('button', { onclick: () => press(d) }, d));
  keys.push(el('button', { class: 'small', onclick: onCancel }, '취소'), el('button', { onclick: () => press('0') }, '0'),
    el('button', { class: 'small', onclick: () => { typed = typed.slice(0, -1); paint(); } }, '지우기'));
  paint();
  show(el('div', { class: 'center' }, title, dots, msg, el('div', { class: 'keypad' }, keys)));
}

// ---------- 화면: 부모 채점 확인 ----------
function aiLine(a) {
  if (!a.ai) return ['none', 'AI 채점을 하지 못했습니다. 직접 확인해 주세요.'];
  if (a.ai.verdict === 'good') return ['good', 'AI: 맞음 추정'];
  const parts = [];
  if (a.ai.letterErr) parts.push('글자 오류 ' + a.ai.letterErr);
  if (a.ai.check) parts.push('확인 필요 ' + a.ai.check);
  if (a.ai.spaceErr) parts.push('띄어쓰기 오류 ' + a.ai.spaceErr);
  if (a.ai.missing.length) parts.push('빠뜨린 글자: ' + a.ai.missing.join(' '));
  return [a.ai.verdict === 'bad' ? 'bad' : 'warn', 'AI: ' + parts.join(', ')];
}
function review() {
  const answers = state.answers;
  for (const a of answers) if (a.parent === undefined) a.parent = !a.ai || a.ai.verdict === 'check' ? null : a.ai.verdict === 'good';
  const confirmBtn = el('button', { class: 'primary', onclick: applyGrades }, '채점 확정');
  const count = el('span', { class: 'note' });
  const refresh = () => {
    const left = answers.filter(a => a.parent === null).length;
    confirmBtn.disabled = left > 0;
    count.textContent = left ? '아직 ' + left + '문제를 정하지 않았습니다.' : '맞음 ' + answers.filter(a => a.parent).length + ' · 틀림 ' + answers.filter(a => a.parent === false).length;
  };
  const rows = answers.map(a => {
    const [cls, line] = aiLine(a);
    const o = el('button', {}, 'O'), x = el('button', {}, 'X');
    const paint = () => { o.className = a.parent === true ? 'on good' : ''; x.className = a.parent === false ? 'on bad' : ''; };
    o.onclick = () => { a.parent = true; paint(); refresh(); }; x.onclick = () => { a.parent = false; paint(); refresh(); };
    paint();
    return el('div', { class: 'row review' },
      el('b', {}, a.no + '번'),
      el('div', { class: 'body' }, el('div', { class: 'ans-text' }, a.text), answerCanvas(a, 52, true), el('div', { class: 'ai ' + cls }, line)),
      el('div', { class: 'ox' }, o, x));
  });
  refresh();
  show(
    el('div', { class: 'top' }, el('h2', {}, '채점 확인 · ' + state.level.name + (state.round > 1 ? ' (다시 쓰기)' : '')), count),
    el('p', { class: 'note' }, '빨간 칸은 틀림 추정, 노란 칸은 확인 필요, 칸 왼쪽의 주황 띠는 띄어쓰기 오류입니다. O/X는 AI 판정으로 미리 골라 두었으니 다른 것만 바꾸세요.'),
    el('div', { class: 'done-list' }, rows),
    el('div', { class: 'tools' }, el('span'), confirmBtn)
  );
}
async function applyGrades() {
  for (const a of state.answers) if (a.parent) state.correct.add(a.no);
  state.attempt.status = state.correct.size === state.all.length ? 'passed' : 'graded';
  state.attempt.score = state.attempt.score ?? state.answers.filter(a => a.parent).length;     // 점수는 첫 시도 기준
  await saveAttempt(state.attempt);
  result();
}

// ---------- 화면: 결과 ----------
function result() {
  const total = state.all.length, answers = state.answers, right = answers.filter(a => a.parent).length;
  if (state.correct.size === total) {
    return rewardScreen('모두 맞혔어요!', state.round === 1 ? total + '문제를 한 번에 다 맞혔어요. 참 잘했어요.' : '다시 써서 ' + total + '문제를 모두 맞혔어요. 참 잘했어요.');
  }
  const wrong = answers.filter(a => !a.parent);
  show(
    el('h1', {}, answers.length + '문제 중 ' + right + '개 맞았어요'),
    el('p', { class: 'lead' }, '틀린 문제의 바른 글씨를 보고, 다시 써 봐요.'),
    el('div', { class: 'done-list' }, wrong.map(a => el('div', { class: 'row review' },
      el('b', {}, a.no + '번'),
      el('div', { class: 'body' }, el('div', { class: 'ans-text' }, a.text), answerCanvas(a, 44, false))))),
    el('div', { class: 'tools' },
      el('button', { class: 'quit', onclick: () => { if (confirm('그만할까요?')) home(); } }, '그만하기'),
      el('button', { class: 'primary', onclick: retry }, '틀린 문제 다시 쓰기'))
  );
}
function retry() {
  state.round++; state.items = state.all.filter(it => !state.correct.has(it.no)); state.idx = 0; state.answers = [];
  renderItem(); readItem(true);
}

document.addEventListener('touchmove', e => { if (e.target.tagName === 'CANVAS') e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
// 첫 화면(home)은 모든 스크립트가 불린 뒤 index.html에서 연다.
