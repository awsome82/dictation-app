// 보상 영상: 유튜브 공식 플레이어를 앱 화면 안에 넣어 재생한다.
let ytLoading = null, ytPlayer = null;
function loadYT() {
  if (window.YT && YT.Player) return Promise.resolve();
  if (!ytLoading) ytLoading = new Promise((res, rej) => {
    const fail = () => { ytLoading = null; rej(new Error('youtube')); };
    window.onYouTubeIframeAPIReady = () => res();
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.onerror = fail; document.head.append(s);
    setTimeout(() => { if (!(window.YT && YT.Player)) fail(); }, 12000);
  });
  return ytLoading;
}
function stopVideo() { try { if (ytPlayer) ytPlayer.destroy(); } catch {} ytPlayer = null; }

// holder 안에 영상을 재생한다. cb: { onPlaying, onEnd, onError(code), onTitle(title) }
async function playVideo(holder, id, cb = {}) {
  stopVideo(); holder.innerHTML = ''; const slot = el('div'); holder.append(slot);
  try { await loadYT(); } catch { if (cb.onError) cb.onError(-1); return; }
  let started = false;
  ytPlayer = new YT.Player(slot, {
    videoId: id, width: '100%', height: '100%',
    playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, fs: 0 },
    events: {
      onReady: e => { try { const t = e.target.getVideoData().title; if (t && cb.onTitle) cb.onTitle(t); } catch {} },
      onStateChange: e => {
        if (e.data === 1 && !started) { started = true; try { const t = e.target.getVideoData().title; if (t && cb.onTitle) cb.onTitle(t); } catch {} if (cb.onPlaying) cb.onPlaying(); }
        if (e.data === 0 && cb.onEnd) cb.onEnd();
      },
      onError: e => { if (cb.onError) cb.onError(e.data); }
    }
  });
}

// 최근에 본 영상은 뒤로 미루고, 덜 본 절반 안에서 무작위로 고른다.
function pickVideo(exclude = []) {
  const list = store.videos.filter(v => !v.blocked && !exclude.includes(v.id)).sort((a, b) => (a.lastPlayed || 0) - (b.lastPlayed || 0));
  if (!list.length) return null;
  return list[Math.floor(Math.random() * Math.ceil(list.length / 2))];
}

function rewardScreen(headline, sub) {
  if (store.rewardLog.date !== today()) store.rewardLog = { date: today(), count: 0 };
  const usable = store.videos.filter(v => !v.blocked).length, left = store.settings.dailyVideos - store.rewardLog.count;
  const kids = [el('h1', {}, headline), el('div', { class: 'num' }, sub)];
  if (!usable) kids.push(el('p', { class: 'note' }, '보상 영상이 아직 없어요. 부모님께 영상을 넣어 달라고 말해 주세요.'));
  else if (left <= 0) kids.push(el('p', { class: 'note' }, '오늘 영상은 다 봤어요. 내일 또 만나요.'));
  else kids.push(el('button', { class: 'primary big', onclick: () => watch([]) }, '보상 영상 보기'));
  kids.push(el('button', { class: usable && left > 0 ? 'quit' : 'primary', onclick: home }, '처음으로'));
  show(el('div', { class: 'center' }, kids));
}

function watch(tried) {
  const v = pickVideo(tried);
  if (!v) return show(el('div', { class: 'center' }, el('h2', {}, '영상을 틀 수 없어요'), el('div', { class: 'num' }, '부모님께 영상을 다시 넣어 달라고 말해 주세요.'), el('button', { class: 'primary', onclick: home }, '처음으로')));
  const holder = el('div', { class: 'video' });
  show(
    el('div', { class: 'top' }, el('h2', {}, '보상 영상'), el('button', { class: 'quit', onclick: () => endVideo('그만 볼게요') }, '그만 보기')),
    holder
  );
  playVideo(holder, v.id, {
    onTitle: t => { v.title = t; saveStore(); },
    onPlaying: () => { v.lastPlayed = Date.now(); store.rewardLog.count++; saveStore(); },       // 재생이 시작된 때에만 하루 편수에 넣는다
    onEnd: () => endVideo('참 잘했어요!'),
    onError: code => { if ([100, 101, 150].includes(code)) { v.blocked = true; saveStore(); } stopVideo(); watch(tried.concat(v.id)); }
  });
}
// 영상이 끝나면 추천 영상이 보이기 전에 플레이어를 없애고 앱 화면으로 덮는다.
function endVideo(headline) {
  stopVideo();
  show(el('div', { class: 'center' }, el('h1', {}, headline), el('div', { class: 'num' }, '오늘의 영상은 여기까지예요.'), el('button', { class: 'primary', onclick: home }, '처음으로')));
}
