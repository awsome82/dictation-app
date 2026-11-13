// 기기에 저장하는 작은 데이터: 영상 목록, 직접 고친 급수표, 프로필, 설정. (시험 기록은 IndexedDB)
const STORE_KEY = 'dictation-data';
const store = {
  videos: [],                                   // { id, title, lastPlayed, blocked }
  levels: null,                                 // null이면 levels.js의 기본 급수표를 쓴다
  profiles: [{ id: 'p1', name: '우리 아이' }],
  currentProfile: 'p1',
  settings: { dailyVideos: 1, replays: 1 },
  rewardLog: { date: '', count: 0 }
};
try { Object.assign(store, JSON.parse(localStorage.getItem(STORE_KEY)) || {}); } catch {}
store.settings = Object.assign({ dailyVideos: 1, replays: 1 }, store.settings);
if (!Array.isArray(store.profiles) || !store.profiles.length) store.profiles = [{ id: 'p1', name: '우리 아이' }];

function saveStore() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); return true; } catch { return false; } }
const getLevels = () => store.levels || window.LEVELS;
const curProfile = () => store.profiles.find(p => p.id === store.currentProfile) || store.profiles[0];
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// 유튜브 주소에서 영상 ID를 꺼낸다 (watch?v=, youtu.be/, shorts/, embed/, live/ 또는 ID 그대로).
function ytId(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
  return m ? m[1] : null;
}
