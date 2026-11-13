// 부모님 메뉴: 보상 영상, 급수표, 기록, 설정
const PARENT_TABS = [['videos', '보상 영상'], ['levels', '급수표'], ['records', '기록'], ['settings', '설정']];
function parentMenu(tab = 'videos') {
  stopVideo();
  const body = el('div', { class: 'panel' });
  show(
    el('div', { class: 'top' }, el('h2', {}, '부모님 메뉴'), el('button', { class: 'quit', onclick: () => { stopVideo(); home(); } }, '닫기')),
    el('div', { class: 'chips' }, PARENT_TABS.map(([k, name]) => el('button', { class: k === tab ? 'on' : '', onclick: () => parentMenu(k) }, name))),
    body
  );
  ({ videos: pVideos, levels: pLevels, records: pRecords, settings: pSettings })[tab](body);
}

// ---------- 보상 영상 ----------
function pVideos(body) {
  const input = el('input', { type: 'url', placeholder: '유튜브 주소를 붙여 넣으세요', autocomplete: 'off' });
  const msg = el('div', { class: 'note' }), preview = el('div'), list = el('div', { class: 'done-list' });
  const test = v => {
    const holder = el('div', { class: 'video small' }); preview.innerHTML = ''; preview.append(holder);
    msg.textContent = '재생 검사 중…';
    playVideo(holder, v.id, {
      onTitle: t => { v.title = t; saveStore(); paint(); },
      onPlaying: () => { v.blocked = false; saveStore(); paint(); msg.textContent = '재생됩니다. 보상 영상으로 쓸 수 있습니다.'; },
      onError: code => { v.blocked = true; saveStore(); paint(); stopVideo(); preview.innerHTML = ''; msg.textContent = code === -1 ? '유튜브에 연결하지 못했습니다. 인터넷을 확인해 주세요.' : '이 영상은 앱 안에서 재생할 수 없습니다. 다른 영상을 넣어 주세요.'; }
    });
  };
  const paint = () => {
    list.innerHTML = '';
    if (!store.videos.length) list.append(el('p', { class: 'note' }, '등록된 영상이 없습니다. 10문제를 모두 맞히면 여기 넣은 영상 중 하나가 나옵니다.'));
    for (const v of store.videos) list.append(el('div', { class: 'row' },
      el('img', { class: 'thumb', src: 'https://i.ytimg.com/vi/' + v.id + '/mqdefault.jpg', alt: '' }),
      el('div', { class: 'body' }, el('div', { class: 'vtitle' }, v.title || v.id), el('div', { class: 'ai ' + (v.blocked ? 'bad' : '') }, v.blocked ? '앱 안에서 재생 불가' : v.lastPlayed ? '마지막으로 본 날: ' + new Date(v.lastPlayed).toLocaleDateString('ko-KR') : '아직 안 봄')),
      el('button', { class: 'small', onclick: () => test(v) }, '재생 검사'),
      el('button', { class: 'small', onclick: () => { if (confirm('이 영상을 목록에서 뺄까요?')) { store.videos = store.videos.filter(x => x !== v); saveStore(); stopVideo(); preview.innerHTML = ''; paint(); } } }, '삭제')));
  };
  const add = () => {
    const id = ytId(input.value);
    if (!id) { msg.textContent = '유튜브 주소를 알아볼 수 없습니다.'; return; }
    if (store.videos.some(v => v.id === id)) { msg.textContent = '이미 등록된 영상입니다.'; return; }
    const v = { id, title: '', lastPlayed: 0, blocked: false }; store.videos.push(v); saveStore(); input.value = ''; paint(); test(v);
  };
  body.append(el('div', { class: 'form-row' }, input, el('button', { class: 'primary', onclick: add }, '추가')), msg, preview, list);
  paint();
}

// ---------- 급수표 ----------
function pLevels(body) {
  const levels = getLevels();
  const noAudio = lv => lv.items.filter(i => !i.audio && !AUDIO.items[i.text]).length;
  const edit = lv => {
    const name = el('input', { type: 'text', value: lv ? lv.name : '', placeholder: '급수 이름 (예: 3급)', autocomplete: 'off' });
    const area = el('textarea', { rows: 12, placeholder: '한 줄에 한 문장씩 적어 주세요.', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false' });
    area.value = lv ? lv.items.map(i => i.text).join('\n') : '';
    const msg = el('div', { class: 'note' });
    const save = () => {
      const items = [...new Set(area.value.split('\n').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean))].map(text => ({ text }));
      if (!name.value.trim()) { msg.textContent = '급수 이름을 적어 주세요.'; return; }
      if (!items.length) { msg.textContent = '문장을 한 줄 이상 적어 주세요.'; return; }
      if (!store.levels) store.levels = window.LEVELS.map(l => ({ id: l.id, name: l.name, items: l.items.map(i => ({ text: i.text })) }));
      const cur = lv && store.levels.find(l => l.id === lv.id);
      if (cur) { cur.name = name.value.trim(); cur.items = items; } else store.levels.push({ id: 'c' + Date.now(), name: name.value.trim(), items });
      saveStore(); parentMenu('levels');
    };
    body.innerHTML = '';
    body.append(el('h3', {}, lv ? '급수 고치기' : '급수 추가'), name, area,
      el('p', { class: 'note' }, '띄어쓰기와 문장부호까지 정답으로 씁니다. 문장이 ' + CFG.perTest + '개보다 많으면 시험 때 ' + CFG.perTest + '개를 무작위로 뽑습니다.'), msg,
      el('div', { class: 'tools' }, el('button', { onclick: () => parentMenu('levels') }, '취소'), el('button', { class: 'primary', onclick: save }, '저장')));
  };
  const list = el('div', { class: 'done-list' }, levels.map(lv => {
    const n = noAudio(lv);
    return el('div', { class: 'row' },
      el('div', { class: 'body' }, el('div', { class: 'vtitle' }, lv.name + ' · ' + lv.items.length + '문장'), el('div', { class: 'ai' + (n ? ' warn' : '') }, n ? '음성 파일이 없는 문장 ' + n + '개 (기기 음성으로 읽습니다)' : '모든 문장에 음성 파일이 있습니다')),
      el('button', { class: 'small', onclick: () => edit(lv) }, '고치기'),
      el('button', { class: 'small', onclick: () => { if (confirm(lv.name + '을(를) 지울까요?')) { if (!store.levels) store.levels = window.LEVELS.map(l => ({ id: l.id, name: l.name, items: l.items.map(i => ({ text: i.text })) })); store.levels = store.levels.filter(l => l.id !== lv.id); saveStore(); parentMenu('levels'); } } }, '삭제'));
  }));
  body.append(list, el('div', { class: 'tools' },
    store.levels ? el('button', { onclick: () => { if (confirm('직접 고친 급수표를 지우고 기본 급수표로 되돌릴까요?')) { store.levels = null; saveStore(); parentMenu('levels'); } } }, '기본 급수표로 되돌리기') : el('span'),
    el('button', { class: 'primary', onclick: () => edit(null) }, '급수 추가')));
}

// ---------- 기록 ----------
async function allAttempts() {
  try { const d = await openDb(); return await new Promise(r => { const q = d.transaction('attempts').objectStore('attempts').getAll(); q.onsuccess = () => r(q.result || []); q.onerror = () => r([]); }); } catch { return []; }
}
async function pRecords(body) {
  const all = (await allAttempts()).filter(a => a.rounds && a.rounds.length).sort((a, b) => b.id - a.id);
  if (!all.length) { body.append(el('p', { class: 'note' }, '아직 시험 기록이 없습니다.')); return; }
  const status = a => a.status === 'passed' ? (a.rounds.length > 1 ? '다시 써서 통과' : '한 번에 통과') : a.status === 'graded' ? '다시 쓰기 남음' : '채점 전';
  const table = el('table', {}, el('tr', {}, ['날짜', '아이', '급수', '첫 점수', '결과'].map(h => el('th', {}, h))));
  for (const a of all) {
    const total = a.rounds[0].answers.length;
    table.append(el('tr', {}, [new Date(a.when).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }), a.profile || '-', a.levelName, a.score == null ? '-' : a.score + ' / ' + total, status(a)].map(c => el('td', {}, c))));
  }
  body.append(table);
}

// ---------- 설정 ----------
function pSettings(body) {
  const stepper = (label, key, min, max, unit) => {
    const val = el('b', {}, store.settings[key] + unit);
    const set = d => { store.settings[key] = Math.max(min, Math.min(max, store.settings[key] + d)); saveStore(); val.textContent = store.settings[key] + unit; };
    return el('div', { class: 'form-row' }, el('span', { class: 'label' }, label), el('button', { class: 'small', onclick: () => set(-1) }, '−'), val, el('button', { class: 'small', onclick: () => set(1) }, '+'));
  };
  const pname = el('input', { type: 'text', placeholder: '아이 이름', autocomplete: 'off' });
  const plist = el('div', { class: 'chips' });
  const paintProfiles = () => {
    plist.innerHTML = '';
    for (const p of store.profiles) plist.append(el('button', { onclick: () => { if (store.profiles.length < 2) return alert('프로필은 하나 이상 있어야 합니다.'); if (confirm(p.name + ' 프로필을 지울까요? 시험 기록은 남습니다.')) { store.profiles = store.profiles.filter(x => x !== p); if (store.currentProfile === p.id) store.currentProfile = store.profiles[0].id; saveStore(); paintProfiles(); } } }, p.name + ' ×'));
  };
  const addProfile = () => { const n = pname.value.trim(); if (!n) return; store.profiles.push({ id: 'p' + Date.now(), name: n }); saveStore(); pname.value = ''; paintProfiles(); };
  const msg = el('div', { class: 'note' });
  const exportAll = async () => {
    const data = { app: 'dictation', exportedAt: new Date().toISOString(), store, attempts: await allAttempts() };
    const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })), download: 'dictation-backup-' + today() + '.json' });
    document.body.append(a); a.click(); a.remove(); msg.textContent = '백업 파일을 내려받았습니다.';
  };
  const file = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
  file.onchange = async () => {
    try {
      const data = JSON.parse(await file.files[0].text());
      if (data.app !== 'dictation' || !data.store) throw new Error();
      if (!confirm('지금의 영상 목록, 급수표, 프로필, 설정을 백업 파일의 내용으로 바꿀까요?')) return;
      for (const k of ['videos', 'levels', 'profiles', 'currentProfile', 'settings', 'rewardLog']) if (k in data.store) store[k] = data.store[k];
      saveStore();
      if (Array.isArray(data.attempts)) for (const a of data.attempts) await saveAttempt(a);
      parentMenu('settings');
    } catch { msg.textContent = '백업 파일을 읽지 못했습니다.'; }
  };
  paintProfiles();
  body.append(
    el('h3', {}, '아이 프로필'), plist, el('div', { class: 'form-row' }, pname, el('button', { onclick: addProfile }, '추가')),
    el('h3', {}, '시험과 보상'),
    stepper('하루에 볼 수 있는 보상 영상', 'dailyVideos', 0, 5, '편'),
    stepper('문제마다 다시 듣기', 'replays', 0, 3, '번'),
    el('h3', {}, '부모님 번호'),
    el('div', { class: 'form-row' }, el('button', { onclick: () => pinGate(() => parentMenu('settings'), () => parentMenu('settings'), true) }, '번호 바꾸기')),
    el('h3', {}, '백업'),
    el('p', { class: 'note' }, '기록과 설정은 이 기기에만 저장됩니다. 기기를 바꾸거나 사파리 데이터를 지우기 전에 내려받아 두세요.'),
    el('div', { class: 'form-row' }, el('button', { onclick: exportAll }, '백업 내려받기'), el('button', { onclick: () => file.click() }, '백업 불러오기'), file), msg
  );
}
