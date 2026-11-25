'use strict';

// 版本规范：小迭代 1.1、1.2、1.3；大改版 2.1、2.2
const APP_VERSION = '1.3';
const PAGE_STORAGE_KEY = 'fitlog-current-page';

const DB_NAME = 'fitlog-db';
const DB_VERSION = 2;
const STORES = ['exercises', 'plans', 'sessions', 'meta'];
const DEFAULT_CATEGORIES = ['臀腿', '腰腹', '胸', '背', '肩', '手臂', '核心', '臀部', '腿部', '全身', '其他'];

const TEMPO_PRESETS = {
  pushup: [
    { label: '吸气 · 缓慢向下', seconds: 3, countOut: true, voice: '吸气，缓慢向下' },
    { label: '呼气 · 用力上撑', seconds: 1, countOut: false, voice: '呼气，用力上撑' }
  ],
  kegel: [
    { label: '呼气 · 盆底肌收缩', seconds: 3, countOut: true, voice: '呼气，收缩' },
    { label: '吸气 · 彻底放松', seconds: 10, countOut: true, voice: '吸气，放松' }
  ],
  kickback: [
    { label: '呼气 · 向后踢出', seconds: 1, countOut: false, voice: '呼气，后踢' },
    { label: '顶峰 · 保持收缩', seconds: 2, countOut: true, voice: '保持' },
    { label: '吸气 · 缓慢回收', seconds: 3, countOut: true, voice: '吸气，缓慢回收' }
  ],
  squat: [
    { label: '吸气 · 屈髋下蹲', seconds: 3, countOut: true, voice: '吸气，下蹲' },
    { label: '底部 · 稳定停顿', seconds: 1, countOut: false, voice: '保持稳定' },
    { label: '呼气 · 发力站起', seconds: 1, countOut: false, voice: '呼气，站起' }
  ]
};

let db;
let currentPage = 'home';
let toastTimer;
let deferredInstallPrompt = null;
let runner = null;
let timerHandle = null;

// 课程编辑器临时状态
let draftPlanItems = []; // [{ exerciseId, sets, target, restSeconds }]
// 动作详情弹窗当前状态
let activeDetailExerciseId = null;
let activeDetailTab = 'info';
let activeChartMetric = 'primary';
// 动作表单临时视频 Blob
let draftExerciseVideoBlob = null;
let draftVideoObjectUrl = null;
let runnerVideoObjectUrl = null;
let detailVideoObjectUrl = null;
let wakeLockSentinel = null;

// 音频与语音状态
let audioCtx = null;
let audioUnlocked = false;
const speechQueue = [];
let isSpeaking = false;
let speechWatchdog = null;
let speechFinish = null;
let speechKeepAlive = null;

// 语音音色设置（持久化）
const VOICE_SETTINGS_KEY = 'fitlog-voice-settings';
// mode: full=完整语音 / count=仅报数与关键提示 / beep=仅提示音不说话
const voiceSettings = { mode: 'full', voiceURI: '', pitch: 0.9, rate: 1.0 };
let voicesLoaded = false;

const $ = id => document.getElementById(id);
const makeId = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const nowIso = () => new Date().toISOString();
const dateLabel = value => new Date(value).toLocaleString('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
const shortDateLabel = value => {
  const d = new Date(value);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const clampInt = (value, min, max, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('当前浏览器不支持 IndexedDB'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('exercises')) database.createObjectStore('exercises', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('plans')) database.createObjectStore('plans', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('sessions')) database.createObjectStore('sessions', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('数据库打开失败'));
  });
}

function storeRequest(storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let req;
    try { req = operation(store); } catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error || new Error('数据库操作失败'));
    tx.onabort = () => reject(tx.error || new Error('数据库操作已取消'));
  });
}

const getAll = name => storeRequest(name, 'readonly', store => store.getAll());
const put = (name, value) => storeRequest(name, 'readwrite', store => store.put(value));
const remove = (name, id) => storeRequest(name, 'readwrite', store => store.delete(id));
const clearStore = name => storeRequest(name, 'readwrite', store => store.clear());

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

/* ===================== 音频：提示音 + 语音队列 ===================== */
function ensureAudioContext() {
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  } catch (_) {
    return null;
  }
}

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  ensureAudioContext();
}

function initAudioUnlock() {
  ['touchend', 'click', 'keydown'].forEach(evt => {
    window.addEventListener(evt, unlockAudio, { once: true, passive: evt !== 'keydown' });
  });
}

function playBeep(freq = 880, durationMs = 160, count = 1, gapMs = 200) {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  try {
    for (let i = 0; i < count; i += 1) {
      const start = ctx.currentTime + 0.02 + (i * gapMs) / 1000;
      const end = start + durationMs / 1000;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.32, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  } catch (_) {}
}

function playCountCue() { playBeep(1180, 80, 2, 130); }
function playTickCue() { playBeep(880, 90, 1); }
function playRestStartCue() { playBeep(660, 180, 1); }
function playRestTickCue() { playBeep(980, 130, 1); }
function playRestEndCue() { playBeep(1200, 220, 3, 160); }

/* ---------- 语音音色设置 ---------- */
function loadVoiceSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(VOICE_SETTINGS_KEY) || '{}');
    if (saved && typeof saved === 'object') {
      if (['full', 'count', 'beep'].includes(saved.mode)) voiceSettings.mode = saved.mode;
      if (typeof saved.voiceURI === 'string') voiceSettings.voiceURI = saved.voiceURI;
      if (Number.isFinite(saved.pitch)) voiceSettings.pitch = Math.min(2, Math.max(0, saved.pitch));
      if (Number.isFinite(saved.rate)) voiceSettings.rate = Math.min(2, Math.max(0.5, saved.rate));
    }
  } catch (_) {}
}

function saveVoiceSettings() {
  try { localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(voiceSettings)); } catch (_) {}
}

function getAllVoices() {
  if (!('speechSynthesis' in window)) return [];
  try { return window.speechSynthesis.getVoices() || []; } catch (_) { return []; }
}

// 填充"语音音色"下拉：中文声音优先，再列其他可用声音
function refreshVoiceSelect() {
  const sel = $('voiceSelect');
  if (!sel) return;
  const voices = getAllVoices();
  const sorted = voices.slice().sort((a, b) => {
    const ac = isChineseVoice(a) ? 0 : 1;
    const bc = isChineseVoice(b) ? 0 : 1;
    return ac - bc || maleVoiceScore(b) - maleVoiceScore(a);
  });
  const current = voiceSettings.voiceURI;
  sel.innerHTML = `<option value="">自动优选男声${voices.length ? '' : '（系统暂无可用声音）'}</option>`
    + sorted.map(v => {
      const label = `${v.name}${v.localService ? '（本地）' : ''} · ${v.lang}`;
      return `<option value="${escapeHtml(v.voiceURI || v.name)}">${escapeHtml(label)}</option>`;
    }).join('');
  sel.value = current || '';
}

function isChineseVoice(v) {
  return /zh|cmn|Chinese/i.test(v.lang || '') || /中文|普通话|汉语|Chinese/i.test(v.name || '');
}

// 男声优先评分：名字里的男声关键词加分，女声关键词减分，本地语音加分
function maleVoiceScore(v) {
  const name = (v.name || '').toLowerCase();
  const lang = (v.lang || '').toLowerCase();
  let score = 0;
  // 明确的男声标识
  if (/male|男声|男|yunxi|yunyang|yunye|kangkang|kang|xiaoyong|xiaobo|xiaoyu|david|daniel|liang|wei|jun/i.test(name)) score += 100;
  // 常见女声标识，降权
  if (/female|女声|女|tingting|ting|huihui|xiaoxiao|xiaoyi|meijia|samantha|victoria|karen|mo|wei\s*\(|zhiyu/i.test(name)) score -= 60;
  // 本地离线语音更稳定，优先
  if (v.localService) score += 20;
  // 标准中文（大陆）优先
  if (/zh[-_]?cn|cmn[-_]?hans|chinese \(china|普通话/i.test(`${lang} ${name}`)) score += 10;
  return score;
}

function pickPreferredVoice() {
  const voices = getAllVoices();
  if (!voices.length) return null;
  if (voiceSettings.voiceURI) {
    const saved = voices.find(v => v.voiceURI === voiceSettings.voiceURI || v.name === voiceSettings.voiceURI);
    if (saved) return saved;
  }
  const zh = voices.filter(isChineseVoice);
  const pool = zh.length ? zh : voices;
  return pool.slice().sort((a, b) => maleVoiceScore(b) - maleVoiceScore(a))[0] || null;
}

function cancelSpeech() {
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (_) {}
  }
  if (speechWatchdog) clearTimeout(speechWatchdog);
  speechWatchdog = null;
  speechFinish = null;
  if (speechKeepAlive) clearInterval(speechKeepAlive);
  speechKeepAlive = null;
  speechQueue.length = 0;
  isSpeaking = false;
}

// kind: info=长句说明 / count=报数 / key=关键提示
function speak(text, interrupt = false, kind = 'info') {
  if (!text) return;
  const str = String(text);
  // 语音模式过滤：beep 完全不说话，count 只说报数与关键提示
  if (voiceSettings.mode === 'beep') return;
  if (voiceSettings.mode === 'count' && kind === 'info') return;
  if (interrupt) cancelSpeech();
  speechQueue.push({ text: str, kind });
  // 队列过长时丢弃最旧的普通说明，避免越积越多导致断续
  while (speechQueue.length > 6) {
    const idx = speechQueue.findIndex(q => q.kind === 'info');
    speechQueue.splice(idx >= 0 ? idx : 0, 1);
  }
  processSpeechQueue();
}

// 报数：提示音始终响（即使静音模式也听得见节奏），语音按模式决定
function speakCount(text) {
  playCountCue();
  speak(text, false, 'count');
}

function processSpeechQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  if (!('speechSynthesis' in window)) { speechQueue.length = 0; return; }

  const item = speechQueue.shift();
  const text = item.text;
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    if (speechWatchdog) clearTimeout(speechWatchdog);
    speechWatchdog = null;
    speechFinish = null;
    isSpeaking = false;
    if (speechKeepAlive) clearInterval(speechKeepAlive);
    speechKeepAlive = null;
    setTimeout(processSpeechQueue, 60);
  };

  let utterance;
  try { utterance = new SpeechSynthesisUtterance(text); } catch (_) { finish(); return; }
  const voice = pickPreferredVoice();
  if (voice) { utterance.voice = voice; utterance.lang = voice.lang || 'zh-CN'; }
  else utterance.lang = 'zh-CN';
  // 报数语速略快，长句保持正常；音调默认压低一点更接近男声
  utterance.rate = voiceSettings.rate * (item.kind === 'count' ? 1.12 : 1);
  utterance.pitch = voiceSettings.pitch;
  utterance.volume = 1;
  utterance.onend = finish;
  utterance.onerror = finish;

  isSpeaking = true;
  speechFinish = finish;
  // 安卓 Chrome 长文本容易被系统回收暂停，定时 resume 保活
  if (speechKeepAlive) clearInterval(speechKeepAlive);
  speechKeepAlive = setInterval(() => {
    try {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    } catch (_) {}
  }, 6000);

  const estimatedMs = Math.min(12000, 1200 + text.length * 300);
  speechWatchdog = setTimeout(() => {
    try { window.speechSynthesis.cancel(); } catch (_) {}
    if (speechFinish) speechFinish();
  }, estimatedMs);

  try { window.speechSynthesis.speak(utterance); } catch (_) { finish(); }
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    getAllVoices();
    voicesLoaded = true;
    refreshVoiceSelect();
  };
}

/* ===================== 视频声音清理 ===================== */
function pauseAllVideos() {
  document.querySelectorAll('video').forEach(video => {
    try { video.pause(); } catch (_) {}
  });
}

function stopAllVideos() {
  document.querySelectorAll('video').forEach(video => {
    try {
      video.onended = null;
      video.onerror = null;
      video.pause();
      video.muted = true;
      video.removeAttribute('src');
      video.load();
    } catch (_) {}
  });
  [runnerVideoObjectUrl, detailVideoObjectUrl].forEach(url => {
    if (url) URL.revokeObjectURL(url);
  });
  runnerVideoObjectUrl = null;
  detailVideoObjectUrl = null;
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLockSentinel) {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
    }
  } catch (_) {}
}

async function releaseWakeLock() {
  try {
    if (wakeLockSentinel) {
      await wakeLockSentinel.release();
      wakeLockSentinel = null;
    }
  } catch (_) {}
}

function openDialog(id) { const dialog = $(id); if (dialog && !dialog.open) dialog.showModal(); }
function closeDialog(id) { const dialog = $(id); if (dialog && dialog.open) dialog.close(); }

// 分类管理
async function getCategories() {
  const metaList = await getAll('meta');
  const saved = metaList.find(m => m.key === 'categories')?.value || [];
  const exercises = await getAll('exercises');
  const fromEx = exercises.map(e => e.muscle).filter(Boolean);
  return Array.from(new Set([...DEFAULT_CATEGORIES, ...saved, ...fromEx]));
}

async function addCustomCategory(rawName) {
  const name = String(rawName || '').trim();
  if (!name) return null;
  const cats = await getCategories();
  if (!cats.includes(name)) {
    cats.push(name);
    await put('meta', { key: 'categories', value: cats });
  }
  await populateCategorySelects(name);
  return name;
}

async function populateCategorySelects(selectedMuscle = null) {
  const cats = await getCategories();
  const filterEl = $('muscleFilter');
  const prevFilter = filterEl.value || '全部';
  filterEl.innerHTML = `<option value="全部">全部分类</option>${cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}`;
  filterEl.value = cats.includes(prevFilter) || prevFilter === '全部' ? prevFilter : '全部';

  const exSelect = $('exerciseMuscle');
  const curEx = selectedMuscle || exSelect.value || '臀腿';
  exSelect.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  exSelect.value = cats.includes(curEx) ? curEx : cats[0];

  const qcSelect = $('qcMuscle');
  if (qcSelect) {
    const curQc = qcSelect.value || '臀腿';
    qcSelect.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    qcSelect.value = cats.includes(curQc) ? curQc : cats[0];
  }
}

async function seedData() {
  const exercises = await getAll('exercises');
  if (exercises.length) return;
  const samples = [
    {
      name: '俯卧撑', muscle: '胸', type: 'reps',
      notes: '双手略宽于肩，身体保持一条直线。下降时控制速度，推起时呼气，避免塌腰或耸肩。',
      cue: '注意核心收紧，吸气缓慢下放，呼气有力推起！',
      prepSeconds: 5,
      defaultTarget: { sets: 3, target: 12, weight: 0, restSeconds: 45 },
      tempoPhases: TEMPO_PRESETS.pushup
    },
    {
      name: '凯格尔收缩', muscle: '腰腹', type: 'time',
      notes: '仰卧或坐姿均可，保持腹部与臀部自然放松，专注盆底肌向内向上收紧与彻底放松。',
      cue: '呼气时收缩盆底肌，吸气时彻底放松，不要憋气！',
      prepSeconds: 5,
      defaultTarget: { sets: 3, target: 30, weight: 0, restSeconds: 30 },
      tempoPhases: TEMPO_PRESETS.kegel
    },
    {
      name: '弹力带后踢', muscle: '臀腿', type: 'side',
      notes: '骨盆保持稳定，核心微收，臀部发力向后上方踢出，避免腰部代偿甩动。',
      cue: '顶峰保持收紧，回程缓慢控制，绝不用腰借力！',
      prepSeconds: 5,
      defaultTarget: { sets: 3, target: 15, weight: 0, restSeconds: 45 },
      tempoPhases: TEMPO_PRESETS.kickback
    },
    {
      name: '徒手深蹲', muscle: '臀腿', type: 'reps',
      notes: '双脚与肩同宽，膝盖朝脚尖方向，臀部向后向下坐，脊柱保持中立。',
      cue: '注意背部挺直，下蹲吸气，站起呼气，膝盖不要内扣！',
      prepSeconds: 5,
      defaultTarget: { sets: 4, target: 15, weight: 0, restSeconds: 60 },
      tempoPhases: TEMPO_PRESETS.squat
    },
    {
      name: '臀桥', muscle: '臀腿', type: 'reps',
      notes: '仰卧屈膝，脚掌踩稳地面，顶起髋部时夹紧臀部，避免腰部过度反弓。',
      cue: '顶起时呼气并收紧臀部，下放时控制节奏吸气！',
      prepSeconds: 5,
      defaultTarget: { sets: 3, target: 15, weight: 0, restSeconds: 45 },
      tempoPhases: []
    },
    {
      name: '平板支撑', muscle: '腰腹', type: 'time',
      notes: '肘部位于肩膀正下方，头、背、髋保持自然直线，不塌腰也不撅臀。',
      cue: '保持均匀呼吸，不要憋气，核心持续发力！',
      prepSeconds: 5,
      defaultTarget: { sets: 3, target: 40, weight: 0, restSeconds: 45 },
      tempoPhases: []
    }
  ];
  for (const s of samples) {
    await put('exercises', {
      id: makeId(),
      name: s.name,
      muscle: s.muscle,
      type: s.type,
      notes: s.notes,
      cue: s.cue,
      prepSeconds: s.prepSeconds,
      defaultTarget: s.defaultTarget,
      tempoPhases: s.tempoPhases,
      videoUrl: '',
      videoBlob: null,
      createdAt: nowIso(),
      builtIn: true
    });
  }
}

function navigate(page, options = {}) {
  const { persist = true, scroll = true } = options;
  if (!document.getElementById(`page-${page}`)) page = 'home';

  currentPage = page;
  document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.id === `page-${page}`));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  if (page === 'home') renderHome();
  if (page === 'exercises') renderExercises();
  if (page === 'plans') renderPlans();
  if (page === 'history') renderHistory();
  if (page === 'data') {
    updateStorageStatus();
    scanCacheSizes();
  }
  if (persist) localStorage.setItem(PAGE_STORAGE_KEY, page);
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function restoreSavedPage() {
  const saved = localStorage.getItem(PAGE_STORAGE_KEY);
  if (saved && document.getElementById(`page-${saved}`)) {
    navigate(saved, { persist: false, scroll: false });
  }
}

/* ===================== 下拉刷新：只刷新当前页，不回首页 ===================== */
function initPullRefresh() {
  const indicator = $('pullIndicator');
  let startY = 0;
  let pulling = false;
  let pullAmount = 0;

  const atTop = () => {
    const scroller = document.scrollingElement || document.documentElement;
    return (window.scrollY || scroller.scrollTop || 0) <= 0;
  };
  const reset = () => {
    if (!indicator) return;
    indicator.classList.remove('show');
    indicator.style.height = '';
    indicator.textContent = '下拉刷新当前页面...';
  };

  // 对话框内部有自己的滚动容器，绝对不能在这里触发下拉刷新，
  // 否则 touchmove 的 preventDefault 会拦截弹窗内滚动，导致“添加课程滑几下就卡住”
  const insideDialog = e => {
    const t = e.target;
    return t && typeof t.closest === 'function' && t.closest('dialog');
  };

  window.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || !atTop() || insideDialog(e)) return;
    startY = e.touches[0].clientY;
    pulling = true;
    pullAmount = 0;
  }, { passive: true });

  window.addEventListener('touchmove', e => {
    if (!pulling || !indicator) return;
    if (insideDialog(e)) { pulling = false; reset(); return; }
    const deltaY = e.touches[0].clientY - startY;
    if (deltaY <= 0 || !atTop()) {
      pulling = false;
      reset();
      return;
    }
    if (e.cancelable) e.preventDefault();
    pullAmount = deltaY;
    indicator.textContent = deltaY > 58 ? '松开刷新当前页面...' : '下拉刷新当前页面...';
    indicator.style.height = `${Math.min(36, Math.round(deltaY / 2))}px`;
    if (deltaY > 55) indicator.classList.add('show');
  }, { passive: false });

  const finish = () => {
    if (!pulling) { reset(); return; }
    pulling = false;
    if (pullAmount > 55) {
      refreshCurrentPage();
      showToast('已刷新当前页面内容');
    }
    pullAmount = 0;
    reset();
  };
  window.addEventListener('touchend', finish, { passive: true });
  window.addEventListener('touchcancel', finish, { passive: true });
}

async function renderHome() {
  const sessions = (await getAll('sessions')).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  const now = new Date();
  const startOfWeek = new Date(now);
  const day = (now.getDay() + 6) % 7;
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(now.getDate() - day);
  const weekly = sessions.filter(s => new Date(s.startedAt) >= startOfWeek);
  const minutes = weekly.reduce((sum, s) => sum + (Number(s.durationSeconds) || 0), 0);
  $('weekSessions').textContent = weekly.length;
  $('weekMinutes').textContent = Math.round(minutes / 60);
  $('totalSessions').textContent = sessions.length;
  const recent = $('recentSessions');
  if (!sessions.length) {
    recent.className = 'list-card empty-state';
    recent.textContent = '还没有训练记录，完成第一次训练后会显示在这里。';
    return;
  }
  recent.className = 'stack-list';
  recent.innerHTML = sessions.slice(0, 3).map(sessionCardHtml).join('');
}

function sessionCardHtml(s) {
  const names = (s.exercises || []).map(e => e.name).join('、');
  return `<article class="item-card"><div class="session-date">${escapeHtml(dateLabel(s.startedAt))}</div><div class="session-title">${escapeHtml(s.planName || '自由训练')}</div><div class="session-meta">${Math.round((s.durationSeconds || 0) / 60)} 分钟 · ${(s.exercises || []).length} 个动作</div><div class="session-exercises">${escapeHtml(names || '无动作明细')}</div><div class="card-actions"><button class="small-btn" data-session-detail="${escapeHtml(s.id)}">查看详情</button></div></article>`;
}

// 动作库与编辑
async function renderExercises() {
  await populateCategorySelects();
  const all = await getAll('exercises');
  const query = $('exerciseSearch').value.trim().toLowerCase();
  const muscle = $('muscleFilter').value;
  const filtered = all
    .filter(e => (muscle === '全部' || e.muscle === muscle) && (!query || `${e.name} ${e.muscle} ${e.notes || ''} ${e.cue || ''}`.toLowerCase().includes(query)))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  $('exerciseList').innerHTML = filtered.length
    ? filtered.map(e => {
        const hasTempo = Array.isArray(e.tempoPhases) && e.tempoPhases.length > 0;
        const hasVideo = Boolean(e.videoBlob || e.videoUrl);
        return `<article class="item-card">
          <div class="item-top">
            <div>
              <h3>${escapeHtml(e.name)}</h3>
              <span class="tag">${escapeHtml(e.muscle)}</span>
              <span class="tag">${typeLabel(e.type)}</span>
              ${e.pureVideo ? `<span class="tag amber">纯视频跟练</span>` : ''}
              ${hasTempo ? `<span class="tag green">节拍引导(${e.tempoPhases.length}段)</span>` : ''}
              ${hasVideo ? `<span class="tag amber">含视频</span>` : ''}
            </div>
          </div>
          <p>${escapeHtml(e.notes || '暂无动作要领')}</p>
          <div class="card-actions">
            <button class="small-btn blue" data-exercise-detail="${escapeHtml(e.id)}">详情与历史</button>
            <button class="small-btn" data-edit-exercise="${escapeHtml(e.id)}">编辑</button>
            <button class="small-btn" data-delete-exercise="${escapeHtml(e.id)}">删除</button>
          </div>
        </article>`;
      }).join('')
    : '<div class="list-card empty-state">没有找到动作。点击右上角“＋ 添加”创建自己的动作。</div>';
}

function typeLabel(type) {
  return ({ reps: '次数型', weight: '负重型', time: '时间型', side: '左右侧型' })[type] || '次数型';
}

function setVideoPreviewSrc(src) {
  if (draftVideoObjectUrl) {
    URL.revokeObjectURL(draftVideoObjectUrl);
    draftVideoObjectUrl = null;
  }
  const wrap = $('exerciseVideoPreviewWrap');
  const video = $('exerciseVideoPreview');
  if (!src) {
    video.removeAttribute('src');
    wrap.classList.add('hidden');
    return;
  }
  if (src instanceof Blob) {
    draftVideoObjectUrl = URL.createObjectURL(src);
    video.src = draftVideoObjectUrl;
  } else {
    video.src = src;
  }
  wrap.classList.remove('hidden');
}

function applyPureVideoMode() {
  const isPure = Boolean($('exercisePureVideo')?.checked);
  const ids = [
    'exerciseType', 'exDefaultSets', 'exDefaultTarget', 'exDefaultWeight',
    'exDefaultRest', 'exPrepSeconds', 'tempoPresetSelect', 'addTempoPhaseBtn',
    'exerciseNotes', 'exerciseCue'
  ];
  ids.forEach(id => {
    const el = $(id);
    if (el) el.disabled = isPure;
  });
  const boxIds = ['exDefaultSets', 'tempoPresetSelect'];
  boxIds.forEach(id => {
    const box = $(id)?.closest('.form-section-box');
    if (box) box.classList.toggle('disabled-group', isPure);
  });
}

function renderTempoPhaseEditor(phases = []) {
  const list = $('tempoPhaseList');
  if (!phases.length) {
    list.innerHTML = '<div class="empty-state" style="padding:10px">未设置呼吸节拍，训练时将自由完成每组。可从上方选模板或点击下方添加阶段。</div>';
    return;
  }
  list.innerHTML = phases.map((p, idx) => `
    <div class="tempo-phase-row" data-phase-idx="${idx}">
      <input type="text" class="tp-label" value="${escapeHtml(p.label || '')}" placeholder="如：吸气-向下">
      <input type="number" class="tp-sec" min="1" max="120" value="${clampInt(p.seconds, 1, 120, 3)}" title="持续秒数">
      <label class="tempo-count-toggle" title="保留阶段标记（不影响报数，训练时每秒滴答、每完成一次报数）">
        <input type="checkbox" class="tp-count" ${p.countOut ? 'checked' : ''}>阶段
      </label>
      <button type="button" class="tempo-del-btn" data-remove-phase="${idx}" title="删除阶段">×</button>
    </div>
  `).join('');
}

function collectTempoPhasesFromEditor() {
  const rows = Array.from($('tempoPhaseList').querySelectorAll('.tempo-phase-row'));
  return rows.map(row => {
    const label = row.querySelector('.tp-label')?.value.trim() || '节拍阶段';
    const seconds = clampInt(row.querySelector('.tp-sec')?.value, 1, 120, 3);
    const countOut = Boolean(row.querySelector('.tp-count')?.checked);
    return { label, seconds, countOut, voice: label };
  });
}

async function openExerciseEditor(exercise = null) {
  await populateCategorySelects(exercise?.muscle || '臀腿');
  $('exerciseDialogTitle').textContent = exercise ? '编辑动作' : '添加动作';
  $('exerciseId').value = exercise?.id || '';
  $('exerciseName').value = exercise?.name || '';
  $('exerciseMuscle').value = exercise?.muscle || $('exerciseMuscle').value;
  $('exerciseType').value = exercise?.type || 'reps';
  $('exDefaultSets').value = exercise?.defaultTarget?.sets ?? 3;
  $('exDefaultTarget').value = exercise?.defaultTarget?.target ?? (exercise?.type === 'time' ? 30 : 12);
  $('exDefaultWeight').value = exercise?.defaultTarget?.weight ?? 0;
  $('exDefaultRest').value = exercise?.defaultTarget?.restSeconds ?? 45;
  $('exerciseVideoFile').value = '';
  $('exerciseVideoUrl').value = exercise?.videoUrl || '';
  draftExerciseVideoBlob = exercise?.videoBlob || null;

  if (draftExerciseVideoBlob) {
    setVideoPreviewSrc(draftExerciseVideoBlob);
  } else if (exercise?.videoUrl) {
    setVideoPreviewSrc(exercise.videoUrl);
  } else {
    setVideoPreviewSrc(null);
  }

  $('exerciseNotes').value = exercise?.notes || '';
  $('exerciseCue').value = exercise?.cue || '';
  $('exPrepSeconds').value = exercise?.prepSeconds ?? 5;
  $('exercisePureVideo').checked = Boolean(exercise?.pureVideo);
  applyPureVideoMode();
  $('tempoPresetSelect').value = '';
  renderTempoPhaseEditor(exercise?.tempoPhases || []);
  openDialog('exerciseDialog');
}

async function saveExercise(event) {
  event.preventDefault();
  const id = $('exerciseId').value || makeId();
  const old = (await getAll('exercises')).find(e => e.id === id);
  const name = $('exerciseName').value.trim();
  const muscle = await addCustomCategory($('exerciseMuscle').value);
  const type = $('exerciseType').value;
  const videoUrl = $('exerciseVideoUrl').value.trim();

  await put('exercises', {
    id,
    name,
    muscle,
    type,
    notes: $('exerciseNotes').value.trim(),
    cue: $('exerciseCue').value.trim(),
    prepSeconds: clampInt($('exPrepSeconds').value, 0, 30, 5),
    defaultTarget: {
      sets: clampInt($('exDefaultSets').value, 1, 20, 3),
      target: clampInt($('exDefaultTarget').value, 1, 999, 12),
      weight: Math.max(0, Number($('exDefaultWeight').value) || 0),
      restSeconds: clampInt($('exDefaultRest').value, 0, 600, 45)
    },
    pureVideo: Boolean($('exercisePureVideo')?.checked),
    tempoPhases: $('exercisePureVideo')?.checked ? [] : collectTempoPhasesFromEditor(),
    videoUrl,
    videoBlob: draftExerciseVideoBlob || null,
    createdAt: old?.createdAt || nowIso(),
    builtIn: false
  });

  closeDialog('exerciseDialog');
  await renderExercises();
  showToast('动作已保存');
}

// 动作详情 + 历史记录与趋势图
async function showExerciseDetail(id, tab = 'info', chartMetric = 'primary') {
  const exercise = (await getAll('exercises')).find(e => e.id === id);
  if (!exercise) return;
  activeDetailExerciseId = id;
  activeDetailTab = tab;
  activeChartMetric = chartMetric;

  $('detailTitle').textContent = exercise.name;
  $('detailTabs').classList.remove('hidden');
  $('detailTabs').querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.detailTab === activeDetailTab);
  });

  if (detailVideoObjectUrl) {
    URL.revokeObjectURL(detailVideoObjectUrl);
    detailVideoObjectUrl = null;
  }

  if (activeDetailTab === 'info') {
    let videoHtml = '';
    if (exercise.videoBlob) {
      detailVideoObjectUrl = URL.createObjectURL(exercise.videoBlob);
      videoHtml = `<div class="detail-line"><b>教学视频</b><br><video class="detail-video" controls playsinline loop src="${detailVideoObjectUrl}"></video></div>`;
    } else if (exercise.videoUrl) {
      videoHtml = `<div class="detail-line"><b>教学视频</b><br><video class="detail-video" controls playsinline loop src="${escapeHtml(exercise.videoUrl)}"></video></div>`;
    }
    const tempoHtml = (exercise.tempoPhases && exercise.tempoPhases.length)
      ? `<div class="detail-line"><b>节拍节奏（起势准备 ${exercise.prepSeconds ?? 5} 秒）</b><br>${exercise.tempoPhases.map((p, i) => `${i + 1}. ${escapeHtml(p.label)}（${p.seconds}秒）`).join('<br>')}<br>训练时每秒滴一声，每完成一次报一个数。</div>`
      : `<div class="detail-line"><b>起势准备</b>：${exercise.prepSeconds ?? 5} 秒</div>`;

    $('detailContent').innerHTML = `
      <div class="detail-line"><b>模式：</b>${exercise.pureVideo ? '纯视频跟练（统计参数暂不启用）' : `${typeLabel(exercise.type)} · 常规训练`}</div>
      <div class="detail-line"><b>分类：</b>${escapeHtml(exercise.muscle)} <b>类型：</b>${typeLabel(exercise.type)}</div>
      ${videoHtml}
      <div class="detail-line"><b>动作要领</b><br>${escapeHtml(exercise.notes || '暂无')}</div>
      <div class="detail-line"><b>专属语音提示</b><br>${escapeHtml(exercise.cue || '暂无')}</div>
      ${tempoHtml}
    `;
  } else {
    const sessions = (await getAll('sessions')).sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
    const records = [];
    sessions.forEach(s => {
      (s.exercises || []).forEach(e => {
        if (e.exerciseId === id && Array.isArray(e.sets) && e.sets.length) {
          const totalReps = e.sets.reduce((acc, st) => acc + (Number(st.reps) || 0) + (Number(st.leftReps) || 0) + (Number(st.rightReps) || 0), 0);
          const totalSecs = e.sets.reduce((acc, st) => acc + (Number(st.durationSeconds) || 0), 0);
          const maxWeight = Math.max(0, ...e.sets.map(st => Number(st.weightKg) || 0));
          const volume = e.sets.reduce((acc, st) => {
            const count = (Number(st.reps) || 0) + (Number(st.leftReps) || 0) + (Number(st.rightReps) || 0) || 1;
            const w = Number(st.weightKg) || 0;
            return acc + (w > 0 ? count * w : 0);
          }, 0);
          records.push({
            date: s.startedAt,
            setsCount: e.sets.length,
            totalReps,
            totalSecs,
            maxWeight,
            volume,
            sets: e.sets
          });
        }
      });
    });

    const hasWeightData = records.some(r => r.maxWeight > 0 || r.volume > 0);
    const chartPoints = records.map(r => {
      if (activeChartMetric === 'weight') {
        return { label: shortDateLabel(r.date), value: hasWeightData ? (r.volume > 0 ? r.volume : r.maxWeight) : (r.totalReps || r.totalSecs) };
      }
      return { label: shortDateLabel(r.date), value: r.totalReps > 0 ? r.totalReps : r.totalSecs };
    });

    const metricTitle = activeChartMetric === 'weight'
      ? (hasWeightData ? '训练容量/最大重量趋势' : '单次完成量趋势')
      : (records.some(r => r.totalReps > 0) ? '单次总次数趋势' : '单次累计时长（秒）趋势');

    const svgChart = buildSvgChart(chartPoints);
    const recentFirst = [...records].reverse();

    $('detailContent').innerHTML = `
      <div class="chart-card">
        <div class="chart-header">
          <span><b>${metricTitle}</b></span>
          <div class="chart-mode-btns">
            <button type="button" class="chart-mode-btn ${activeChartMetric === 'primary' ? 'active' : ''}" data-chart-metric="primary">次数/时长</button>
            <button type="button" class="chart-mode-btn ${activeChartMetric === 'weight' ? 'active' : ''}" data-chart-metric="weight">负重/容量</button>
          </div>
        </div>
        ${svgChart}
      </div>
      <div class="detail-line"><b>历史完成明细（共 ${records.length} 次）</b><br>${
        recentFirst.length
          ? recentFirst.slice(0, 12).map(r => {
              const setDesc = r.sets.map(st => {
                const base = st.leftReps != null ? `左${st.leftReps}/右${st.rightReps}次` : st.reps != null ? `${st.reps}次` : `${st.durationSeconds}秒`;
                return `${base}${st.weightKg ? `(${st.weightKg}kg)` : ''}`;
              }).join(' · ');
              return `<div style="margin-top:6px"><b>${escapeHtml(dateLabel(r.date))}</b> · ${r.setsCount}组<br><span style="color:#64748b">${escapeHtml(setDesc)}</span></div>`;
            }).join('')
          : '暂无该动作的训练记录'
      }</div>
    `;
  }

  openDialog('detailDialog');
}

function buildSvgChart(points) {
  if (!points.length) {
    return '<div class="empty-state" style="padding:26px 8px">暂无历史数据，完成训练后自动生成趋势图</div>';
  }
  const sliced = points.slice(-10);
  const w = 360;
  const h = 140;
  const padL = 28;
  const padR = 14;
  const padT = 16;
  const padB = 24;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const maxVal = Math.max(1, ...sliced.map(p => p.value));

  const coords = sliced.map((p, idx) => {
    const x = sliced.length === 1 ? padL + plotW / 2 : padL + (idx / (sliced.length - 1)) * plotW;
    const y = padT + plotH - (p.value / maxVal) * plotH;
    return { ...p, x, y };
  });

  const polylinePts = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const barsHtml = coords.map(c => {
    const barW = Math.min(22, Math.max(8, plotW / (sliced.length * 1.8)));
    const barH = Math.max(2, (c.value / maxVal) * plotH);
    return `<rect x="${(c.x - barW / 2).toFixed(1)}" y="${(padT + plotH - barH).toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="4" fill="#dbeafe"></rect>`;
  }).join('');

  const dotsHtml = coords.map(c => `
    <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.5" fill="#2864dc"></circle>
    <text x="${c.x.toFixed(1)}" y="${(c.y - 6).toFixed(1)}" text-anchor="middle" font-size="9" fill="#1e293b">${c.value}</text>
    <text x="${c.x.toFixed(1)}" y="${h - 6}" text-anchor="middle" font-size="9" fill="#64748b">${escapeHtml(c.label)}</text>
  `).join('');

  return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="训练趋势图">
    <line x1="${padL}" y1="${padT + plotH}" x2="${w - padR}" y2="${padT + plotH}" stroke="#e2e8f0" stroke-width="1"></line>
    <text x="4" y="${padT + 4}" font-size="8" fill="#94a3b8">${maxVal}</text>
    <text x="4" y="${padT + plotH}" font-size="8" fill="#94a3b8">0</text>
    ${barsHtml}
    <polyline fill="none" stroke="#2864dc" stroke-width="2" points="${polylinePts}"></polyline>
    ${dotsHtml}
  </svg>`;
}

// 课程管理（含自定义动作加入课程 & 排序）
async function renderPlans() {
  const plans = (await getAll('plans')).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const exercises = await getAll('exercises');
  const map = new Map(exercises.map(e => [e.id, e]));
  $('planList').innerHTML = plans.length
    ? plans.map(p => `<article class="item-card"><div class="item-top"><div><h3>${escapeHtml(p.name)}</h3><p>${(p.items || []).map(i => escapeHtml(map.get(i.exerciseId)?.name || '已删除动作')).join('、')}</p></div><span class="tag">${(p.items || []).length}个动作</span></div><div class="card-actions"><button class="small-btn blue" data-start-plan="${escapeHtml(p.id)}">开始训练</button><button class="small-btn" data-edit-plan="${escapeHtml(p.id)}">编辑</button><button class="small-btn" data-delete-plan="${escapeHtml(p.id)}">删除</button></div></article>`).join('')
    : '<div class="list-card empty-state">还没有训练课程。点击右上角新建第一套课程。</div>';
}

async function openPlanEditor(plan = null) {
  await populateCategorySelects();
  $('planDialogTitle').textContent = plan ? '编辑课程' : '新建课程';
  $('planId').value = plan?.id || '';
  $('planName').value = plan?.name || '';
  $('planExerciseSearch').value = '';
  $('quickCustomPanel').classList.add('hidden');
  $('quickCustomArrow').textContent = '▾';
  $('qcName').value = '';
  $('qcCue').value = '';

  draftPlanItems = (plan?.items || []).map(i => ({
    exerciseId: i.exerciseId,
    sets: clampInt(i.sets, 1, 20, 3),
    target: clampInt(i.target, 1, 999, 12),
    restSeconds: clampInt(i.restSeconds, 0, 600, 45)
  }));

  await renderPlanEditorLists();
  openDialog('planDialog');
}

async function renderPlanEditorLists() {
  const exercises = (await getAll('exercises')).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const byId = new Map(exercises.map(e => [e.id, e]));
  const query = $('planExerciseSearch').value.trim().toLowerCase();

  // 1. 已选动作列表（支持上移/下移/移除/改组数与目标）
  const selContainer = $('selectedPlanItems');
  if (!draftPlanItems.length) {
    selContainer.innerHTML = '<div class="empty-state" style="padding:10px">尚未添加动作，请在下方勾选或使用上方“自定义动作加入课程”。</div>';
  } else {
    selContainer.innerHTML = draftPlanItems.map((item, idx) => {
      const ex = byId.get(item.exerciseId);
      const title = ex ? `${ex.name}（${ex.muscle}）` : '已删除动作';
      return `
        <div class="selected-plan-card" data-sel-idx="${idx}">
          <div class="selected-plan-head">
            <b>${idx + 1}. ${escapeHtml(title)}</b>
            <div class="selected-plan-ops">
              <button type="button" class="mini-op-btn" data-move-up="${idx}" ${idx === 0 ? 'disabled' : ''}>↑</button>
              <button type="button" class="mini-op-btn" data-move-down="${idx}" ${idx === draftPlanItems.length - 1 ? 'disabled' : ''}>↓</button>
              <button type="button" class="mini-op-btn" data-remove-sel="${idx}">移除</button>
            </div>
          </div>
          <div class="selected-plan-inputs">
            <label>组数<input type="number" min="1" max="20" class="sel-sets" value="${item.sets}"></label>
            <label>次数/秒<input type="number" min="1" max="999" class="sel-target" value="${item.target}"></label>
            <label>休息(秒)<input type="number" min="0" max="600" class="sel-rest" value="${item.restSeconds}"></label>
          </div>
        </div>
      `;
    }).join('');
  }

  // 2. 动作库勾选列表
  const selectedIds = new Set(draftPlanItems.map(i => i.exerciseId));
  const filteredEx = exercises.filter(e => !query || `${e.name} ${e.muscle}`.toLowerCase().includes(query));
  $('planExerciseChoices').innerHTML = filteredEx.map(e => `
    <label class="choice-row">
      <input type="checkbox" class="plan-ex-check" value="${escapeHtml(e.id)}" ${selectedIds.has(e.id) ? 'checked' : ''}>
      <span><b>${escapeHtml(e.name)}</b><small style="display:block;color:#8190a2;margin-top:2px">${escapeHtml(e.muscle)} · ${typeLabel(e.type)}（默认 ${e.defaultTarget?.sets ?? 3}组 × ${e.defaultTarget?.target ?? 12}）</small></span>
    </label>
  `).join('') || '<p class="empty-state">没有匹配的动作。</p>';
}

function syncDraftItemsFromDom() {
  const cards = Array.from($('selectedPlanItems').querySelectorAll('.selected-plan-card'));
  cards.forEach((card, idx) => {
    if (!draftPlanItems[idx]) return;
    draftPlanItems[idx].sets = clampInt(card.querySelector('.sel-sets')?.value, 1, 20, 3);
    draftPlanItems[idx].target = clampInt(card.querySelector('.sel-target')?.value, 1, 999, 12);
    draftPlanItems[idx].restSeconds = clampInt(card.querySelector('.sel-rest')?.value, 0, 600, 45);
  });
}

async function handleQuickCustomExerciseForPlan() {
  const name = $('qcName').value.trim();
  if (!name) {
    showToast('请先输入自定义动作名称');
    return;
  }
  syncDraftItemsFromDom();
  const muscle = await addCustomCategory($('qcMuscle').value);
  const type = $('qcType').value;
  const sets = clampInt($('qcSets').value, 1, 20, 3);
  const target = clampInt($('qcTarget').value, 1, 999, 12);
  const restSeconds = clampInt($('qcRest').value, 0, 600, 45);
  const cue = $('qcCue').value.trim();

  const newEx = {
    id: makeId(),
    name,
    muscle,
    type,
    notes: '',
    cue,
    prepSeconds: 5,
    defaultTarget: { sets, target, weight: 0, restSeconds },
    tempoPhases: [],
    videoUrl: '',
    videoBlob: null,
    createdAt: nowIso(),
    builtIn: false
  };
  await put('exercises', newEx);
  draftPlanItems.push({ exerciseId: newEx.id, sets, target, restSeconds });
  $('qcName').value = '';
  $('qcCue').value = '';
  await renderPlanEditorLists();
  showToast(`已创建“${name}”并加入课程`);
}

async function savePlan(event) {
  event.preventDefault();
  syncDraftItemsFromDom();
  const exercises = await getAll('exercises');
  const byId = new Map(exercises.map(e => [e.id, e]));
  const oldId = $('planId').value;
  const old = (await getAll('plans')).find(p => p.id === oldId);
  const validItems = draftPlanItems.filter(i => byId.has(i.exerciseId));
  if (!validItems.length) {
    showToast('请至少选择或自定义一个动作');
    return;
  }
  await put('plans', {
    id: oldId || makeId(),
    name: $('planName').value.trim(),
    items: validItems,
    createdAt: old?.createdAt || nowIso(),
    updatedAt: nowIso()
  });
  closeDialog('planDialog');
  await renderPlans();
  showToast('课程已保存');
}

// 训练执行器（5秒起势准备 + 多阶段呼吸节拍引导 + 语音播报）
async function startPlan(id) {
  const plan = (await getAll('plans')).find(p => p.id === id);
  if (!plan) return;
  const all = await getAll('exercises');
  const map = new Map(all.map(e => [e.id, e]));
  const items = plan.items.map(i => ({ ...i, exercise: map.get(i.exerciseId) })).filter(i => i.exercise);
  if (!items.length) {
    showToast('课程没有可用动作');
    return;
  }

  const firstEx = items[0].exercise;
  const firstPure = Boolean(firstEx.pureVideo);
  const prepSec = clampInt(firstEx.prepSeconds, 0, 30, 5);
  runner = {
    planId: plan.id,
    planName: plan.name,
    items,
    index: 0,
    setIndex: 1,
    session: {
      id: makeId(),
      planId: plan.id,
      planName: plan.name,
      startedAt: nowIso(),
      endedAt: null,
      durationSeconds: 0,
      exercises: []
    },
    phase: firstPure ? 'video' : (prepSec > 0 ? 'prepare' : 'work'),
    remaining: firstPure ? 0 : (prepSec > 0 ? prepSec : 0),
    // 节拍状态
    tempoIndex: 0,
    tempoSecLeft: 0,
    completedRepsInSet: 0,
    pendingAdvance: null
  };

  await requestWakeLock();
  $('runnerPlanName').textContent = plan.name;
  setupRunnerPhase(true);
  openDialog('runnerDialog');
}

function currentRunnerItem() {
  return runner?.items[runner.index];
}

function setupRunnerPhase(isFirstStart = false) {
  stopRunnerTimer();
  if (!runner) return;
  const item = currentRunnerItem();
  const exercise = item.exercise;
  const hasTempo = Array.isArray(exercise.tempoPhases) && exercise.tempoPhases.length > 0;

  // 纯视频跟练：不计时、不计数、不休息，视频播完自动下一项
  if (exercise.pureVideo) {
    runner.phase = 'video';
    runner.tempoIndex = 0;
    runner.completedRepsInSet = 0;
    renderRunner();
    const videoEl = $('runnerVideo');
    if (videoEl) {
      videoEl.onended = () => {
        if (runner && runner.phase === 'video') advanceRunner();
      };
      videoEl.play().catch(() => showToast('若视频未自动播放，请点视频上的播放按钮'));
    } else {
      showToast('该纯视频动作没有视频，已自动跳过');
      setTimeout(() => {
        if (runner && runner.phase === 'video') advanceRunner();
      }, 900);
    }
    speak(`纯视频跟练：${exercise.name}`, true, 'key');
    return;
  }

  if (runner.phase === 'prepare') {
    const prepSec = clampInt(exercise.prepSeconds, 0, 30, 5);
    runner.remaining = prepSec;
    runner.completedRepsInSet = 0;
    const prefix = isFirstStart
      ? `开始训练，${runner.planName}。第一个动作，${exercise.name}。`
      : `准备动作，${exercise.name}，第${runner.setIndex}组。`;
    speak(`${prefix}请调整初始姿势，准备开始。`, true, 'key');
    renderRunner();
    startCountdownLoop('prepare');
  } else if (runner.phase === 'work') {
    runner.tempoIndex = 0;
    runner.completedRepsInSet = 0;
    runner.elapsedSec = 0;
    renderRunner();
    if (hasTempo) {
      startTempoPhase(0);
    } else {
      // 无节拍动作（如平板支撑）：每秒滴一声，帮用户掌握节奏，不用语音描述
      speak(`开始第${runner.setIndex}组，${exercise.name}。`, true, 'key');
      startPlainTickLoop();
    }
  } else if (runner.phase === 'rest') {
    runner.remaining = clampInt(item.restSeconds, 0, 600, 30);
    playRestStartCue();
    speak(`本组完成，休息${runner.remaining}秒。`, true, 'key');
    renderRunner();
    startCountdownLoop('rest');
  } else if (runner.phase === 'done') {
    renderRunner();
    speak('训练课程已经全部完成，太棒了！', true, 'key');
  }
}

// 简洁节拍：每秒滴一声掌握节奏，每完成一个动作报一次数（1、2、3…）
// 不再播报“吸气下蹲 / 呼气站起”等描述，避免语音嘈杂断续
function startTempoPhase(phaseIdx) {
  stopRunnerTimer();
  if (!runner || runner.phase !== 'work') return;
  const exercise = currentRunnerItem().exercise;
  const phases = exercise.tempoPhases || [];
  if (!phases.length) return;

  runner.tempoIndex = phaseIdx % phases.length;
  const p = phases[runner.tempoIndex];
  runner.tempoSecLeft = clampInt(p.seconds, 1, 120, 3);
  renderRunner();

  timerHandle = setInterval(() => {
    if (!runner || runner.phase !== 'work') {
      stopRunnerTimer();
      return;
    }
    runner.tempoSecLeft -= 1;
    playTickCue(); // 每秒一声轻滴
    const numEl = $('runnerNumber');
    if (numEl) numEl.textContent = Math.max(0, runner.tempoSecLeft);

    if (runner.tempoSecLeft > 0) return;

    const nextIdx = runner.tempoIndex + 1;
    if (nextIdx < phases.length) {
      startTempoPhase(nextIdx);
    } else {
      // 一轮节拍走完 = 完成一个动作，报数
      runner.completedRepsInSet += 1;
      const countText = exercise.type === 'time'
        ? `${runner.completedRepsInSet}次`
        : String(runner.completedRepsInSet);
      speakCount(countText);
      const targetReps = currentRunnerItem().target;
      const inputEl = $('actualValue');
      if (inputEl && exercise.type !== 'side') inputEl.value = runner.completedRepsInSet;
      if (targetReps && runner.completedRepsInSet >= targetReps) {
        stopRunnerTimer();
        speak(`已完成${targetReps}次，本组结束。`, true, 'key');
      } else {
        startTempoPhase(0);
      }
    }
  }, 1000);
}

// 无节拍动作（如平板支撑）：每秒滴一声，显示已坚持秒数，不说话
function startPlainTickLoop() {
  stopRunnerTimer();
  if (!runner || runner.phase !== 'work') return;
  runner.elapsedSec = 0;
  timerHandle = setInterval(() => {
    if (!runner || runner.phase !== 'work') { stopRunnerTimer(); return; }
    runner.elapsedSec = (runner.elapsedSec || 0) + 1;
    playTickCue();
    const numEl = $('runnerNumber');
    if (numEl) numEl.textContent = runner.elapsedSec;
  }, 1000);
}

function startCountdownLoop(mode) {
  stopRunnerTimer();
  if (!runner || runner.phase !== mode) return;
  timerHandle = setInterval(() => {
    if (!runner || runner.phase !== mode) {
      stopRunnerTimer();
      return;
    }
    runner.remaining = Math.max(0, runner.remaining - 1);
    const numEl = $('runnerNumber');
    if (numEl) numEl.textContent = runner.remaining;

    if ((mode === 'prepare' || mode === 'rest') && runner.remaining > 0 && runner.remaining <= 3) {
      if (mode === 'rest') playRestTickCue();
      else playBeep(760, 120, 1);
      speakCount(String(runner.remaining));
    }

    if (runner.remaining <= 0) {
      stopRunnerTimer();
      if (mode === 'prepare') {
        runner.phase = 'work';
        setupRunnerPhase(false);
      } else if (mode === 'rest') {
        playRestEndCue();
        applyPendingAdvance();
      }
    }
  }, 1000);
}

function renderRunner() {
  if (!runner) return;
  const item = currentRunnerItem();
  const exercise = item.exercise;
  const totalSets = runner.items.reduce((sum, i) => sum + i.sets, 0);
  const completedSets = runner.items.slice(0, runner.index).reduce((sum, i) => sum + i.sets, 0) + runner.setIndex - 1;
  $('runnerProgressBar').style.width = `${Math.min(100, (completedSets / Math.max(1, totalSets)) * 100)}%`;

  if (runnerVideoObjectUrl) {
    URL.revokeObjectURL(runnerVideoObjectUrl);
    runnerVideoObjectUrl = null;
  }
  let videoSrc = '';
  if (exercise.videoBlob) {
    runnerVideoObjectUrl = URL.createObjectURL(exercise.videoBlob);
    videoSrc = runnerVideoObjectUrl;
  } else if (exercise.videoUrl) {
    videoSrc = exercise.videoUrl;
  }
  const isPureVideo = Boolean(exercise.pureVideo);
  const videoHtml = videoSrc
    ? isPureVideo
      ? `<video id="runnerVideo" class="runner-video" src="${escapeHtml(videoSrc)}" autoplay playsinline controls></video>`
      : `<video id="runnerVideo" class="runner-video" src="${escapeHtml(videoSrc)}" autoplay loop muted playsinline controls></video>`
    : '';

  const hasTempo = Array.isArray(exercise.tempoPhases) && exercise.tempoPhases.length > 0;
  const currentPhase = hasTempo ? exercise.tempoPhases[runner.tempoIndex] : null;

  let bannerHtml = '';
  if (runner.phase === 'prepare') {
    bannerHtml = `<div class="tempo-banner prep-mode"><div class="tempo-phase-title">调整初始姿势（准备缓冲）</div><div class="tempo-phase-sub">先摆好姿势，倒计时结束后开始做动作</div></div>`;
  } else if (runner.phase === 'work' && currentPhase) {
    bannerHtml = `<div class="tempo-banner"><div class="tempo-phase-title">${escapeHtml(currentPhase.label)}</div><div class="tempo-phase-sub" id="tempoStatusSub">本组节拍已完成：${runner.completedRepsInSet} / 目标 ${item.target}</div></div>`;
  } else if (runner.phase === 'rest') {
    const nextName = runner.pendingAdvance
      ? (runner.items[runner.pendingAdvance.index]?.exercise.name || '下一动作')
      : '下一组';
    bannerHtml = `<div class="tempo-banner rest-mode"><div class="tempo-phase-title">组间休息 · 下一项：${escapeHtml(nextName)}</div><div class="tempo-phase-sub">放松呼吸，倒计时结束自动继续</div></div>`;
  } else if (runner.phase === 'video') {
    bannerHtml = `<div class="tempo-banner"><div class="tempo-phase-title">纯视频跟练</div><div class="tempo-phase-sub">跟随视频完成动作，结束后自动进入下一项</div></div>`;
  }

  const numberDisplay = runner.phase === 'done'
    ? '✓'
    : runner.phase === 'video'
      ? '▶'
      : (runner.phase === 'prepare' || runner.phase === 'rest')
      ? runner.remaining
      : hasTempo
        ? runner.tempoSecLeft
        : '开始';

  const defaultVal = (hasTempo && runner.completedRepsInSet > 0) ? runner.completedRepsInSet : item.target;

  $('runnerBody').innerHTML = `
    <div class="runner-kicker">动作 ${runner.index + 1} / ${runner.items.length} · ${isPureVideo ? '纯视频跟练（暂不统计）' : `第 ${runner.setIndex} / ${item.sets} 组（目标 ${item.target}${exercise.type === 'time' ? '秒' : '次'}）`}</div>
    <h2>${escapeHtml(exercise.name)}</h2>
    ${exercise.cue ? `<p class="runner-cue">💡 ${escapeHtml(exercise.cue)}</p>` : ''}
    ${videoHtml}
    ${bannerHtml}
    <div class="runner-label">${
      runner.phase === 'prepare' ? '起势准备倒计时'
        : runner.phase === 'rest' ? '休息剩余秒数'
          : runner.phase === 'video' ? '跟随视频完成本次练习'
            : runner.phase === 'done' ? '本次训练已全部完成'
              : hasTempo ? '当前节拍倒计时' : '完成本组后记录实际数据'
    }</div>
    <div class="runner-number" id="runnerNumber">${numberDisplay}</div>
    ${runner.phase === 'prepare'
      ? `<div class="runner-controls"><button class="alt" id="skipPrepareBtn">立即开始</button></div>`
      : runner.phase === 'work'
        ? `<div class="runner-inputs">${
            exercise.type === 'side'
              ? `<label>左侧次数<input id="actualLeft" type="number" min="0" max="9999" value="${defaultVal}" inputmode="numeric"></label><label>右侧次数<input id="actualRight" type="number" min="0" max="9999" value="${defaultVal}" inputmode="numeric"></label>`
              : `<label>${exercise.type === 'time' ? '完成时长（秒）' : '完成次数'}<input id="actualValue" type="number" min="0" max="9999" value="${defaultVal}" inputmode="numeric"></label><label>重量（kg）<input id="actualWeight" type="number" min="0" max="9999" step="0.5" value="${exercise.defaultTarget?.weight ?? 0}" inputmode="decimal"></label>`
          }</div>
          <div class="runner-controls">
            <button class="alt" id="runnerCueBtn">重播提示</button>
            ${hasTempo ? `<button class="alt" id="restartTempoBtn">重计节拍</button>` : ''}
            <button class="main" id="completeSetBtn">完成本组</button>
          </div>`
        : runner.phase === 'video'
          ? `<div class="runner-controls"><button class="alt" id="replayVideoBtn">重播视频</button><button class="main" id="nextVideoBtn">下一个动作</button></div>`
          : runner.phase === 'rest'
            ? `<div class="runner-controls"><button class="alt" id="skipRestBtn">跳过休息</button><button class="main" id="pauseRestBtn">暂停计时</button></div>`
            : `<div class="runner-controls"><button class="main" id="finishSessionBtn">保存并结束</button></div>`
    }
  `;

  if (runner.phase === 'prepare') {
    $('skipPrepareBtn').onclick = () => {
      runner.phase = 'work';
      setupRunnerPhase(false);
    };
  } else if (runner.phase === 'work') {
    $('runnerCueBtn').onclick = () => speak(exercise.cue || exercise.notes || exercise.name, true, 'key');
    if ($('restartTempoBtn')) {
      $('restartTempoBtn').onclick = () => {
        runner.completedRepsInSet = 0;
        startTempoPhase(0);
      };
    }
    $('completeSetBtn').onclick = completeSet;
  } else if (runner.phase === 'video') {
    $('nextVideoBtn').onclick = () => advanceRunner();
    $('replayVideoBtn').onclick = () => {
      const video = $('runnerVideo');
      if (video) {
        video.currentTime = 0;
        video.play().catch(() => {});
      }
    };
  } else if (runner.phase === 'rest') {
    $('skipRestBtn').onclick = () => applyPendingAdvance();
    $('pauseRestBtn').onclick = () => {
      if (timerHandle) {
        stopRunnerTimer();
        $('pauseRestBtn').textContent = '继续计时';
      } else {
        $('pauseRestBtn').textContent = '暂停计时';
        startCountdownLoop('rest');
      }
    };
  } else if (runner.phase === 'done') {
    $('finishSessionBtn').onclick = finishSession;
  }
}

function completeSet() {
  stopRunnerTimer();
  const item = currentRunnerItem();
  const exercise = item.exercise;
  const isSide = exercise.type === 'side';
  const actual = isSide ? null : clampInt($('actualValue').value, 0, 9999, 0);
  const left = isSide ? clampInt($('actualLeft').value, 0, 9999, 0) : null;
  const right = isSide ? clampInt($('actualRight').value, 0, 9999, 0) : null;
  const weight = isSide ? 0 : Math.max(0, Number($('actualWeight').value) || 0);

  if (isSide ? (left <= 0 && right <= 0) : (actual <= 0)) {
    showToast('请输入本组实际完成数据');
    if (Array.isArray(exercise.tempoPhases) && exercise.tempoPhases.length) {
      startTempoPhase(runner.tempoIndex || 0);
    }
    return;
  }

  let exerciseRecord = runner.session.exercises.find(e => e.exerciseId === exercise.id);
  if (!exerciseRecord) {
    exerciseRecord = { exerciseId: exercise.id, name: exercise.name, type: exercise.type, sets: [] };
    runner.session.exercises.push(exerciseRecord);
  }
  exerciseRecord.sets.push({
    setNumber: runner.setIndex,
    reps: exercise.type === 'time' || isSide ? null : actual,
    leftReps: left,
    rightReps: right,
    durationSeconds: exercise.type === 'time' ? actual : null,
    weightKg: weight,
    completedAt: nowIso()
  });

  if (runner.setIndex < item.sets && item.restSeconds > 0) {
    beginRest({ index: runner.index, setIndex: runner.setIndex + 1 });
  } else {
    advanceRunner();
  }
}

function getNextStep() {
  const item = currentRunnerItem();
  if (!item.exercise.pureVideo && runner.setIndex < item.sets) {
    return { index: runner.index, setIndex: runner.setIndex + 1 };
  }
  if (runner.index < runner.items.length - 1) {
    return { index: runner.index + 1, setIndex: 1 };
  }
  return null;
}

function beginRest(target) {
  stopRunnerTimer();
  runner.pendingAdvance = target;
  runner.phase = 'rest';
  setupRunnerPhase(false);
}

function applyPendingAdvance() {
  const target = runner.pendingAdvance;
  runner.pendingAdvance = null;
  if (target) {
    runner.index = target.index;
    runner.setIndex = target.setIndex;
    runner.phase = runner.items[target.index].exercise.pureVideo ? 'video' : 'prepare';
    setupRunnerPhase(false);
  } else {
    advanceRunner();
  }
}

function advanceRunner() {
  stopRunnerTimer();
  const next = getNextStep();
  if (!next) {
    runner.phase = 'done';
    setupRunnerPhase(false);
    return;
  }

  const currentItem = currentRunnerItem();
  const nextExercise = runner.items[next.index].exercise;
  const isNewAction = next.index !== runner.index;

  // 动作之间也加组间休息（纯视频动作暂不启用统计参数，跳过休息）
  if (
    isNewAction &&
    !currentItem.exercise.pureVideo &&
    !nextExercise.pureVideo &&
    currentItem.restSeconds > 0
  ) {
    beginRest(next);
    return;
  }

  runner.index = next.index;
  runner.setIndex = next.setIndex;
  runner.phase = nextExercise.pureVideo ? 'video' : 'prepare';
  setupRunnerPhase(false);
}

function stopRunnerTimer() {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}

async function finishSession() {
  if (!runner) return;
  stopRunnerTimer();
  stopAllVideos();
  cancelSpeech();
  await releaseWakeLock();
  const ended = Date.now();
  runner.session.endedAt = new Date(ended).toISOString();
  runner.session.durationSeconds = Math.max(0, Math.round((ended - new Date(runner.session.startedAt).getTime()) / 1000));
  await put('sessions', runner.session);
  runner = null;
  closeDialog('runnerDialog');
  showToast('训练记录已保存');
  await renderHome();
  if (currentPage === 'history') await renderHistory();
}

function closeRunner() {
  if (!runner) {
    stopAllVideos();
    cancelSpeech();
    closeDialog('runnerDialog');
    return;
  }
  if (confirm('训练尚未结束。确定退出吗？当前训练数据将不会保存。')) {
    stopRunnerTimer();
    stopAllVideos();
    cancelSpeech();
    releaseWakeLock();
    runner = null;
    closeDialog('runnerDialog');
  }
}

// 历史与备份
async function renderHistory() {
  const sessions = (await getAll('sessions')).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  $('historyTotal').textContent = sessions.length;
  $('historyMinutes').textContent = Math.round(sessions.reduce((sum, s) => sum + (s.durationSeconds || 0), 0) / 60);
  $('historyList').innerHTML = sessions.length ? sessions.map(sessionCardHtml).join('') : '<div class="list-card empty-state">还没有训练记录。</div>';
}

async function showSessionDetail(id) {
  const s = (await getAll('sessions')).find(x => x.id === id);
  if (!s) return;
  activeDetailExerciseId = null;
  $('detailTabs').classList.add('hidden');
  $('detailTitle').textContent = s.planName || '训练详情';
  const lines = (s.exercises || []).map(e => `<div class="detail-line"><b>${escapeHtml(e.name)}</b><br>${(e.sets || []).map(set => `第${set.setNumber}组：${set.leftReps != null ? `左${set.leftReps}次 / 右${set.rightReps}次` : set.reps != null ? `${set.reps}次` : `${set.durationSeconds}秒`}${set.weightKg ? ` · ${set.weightKg}kg` : ''}`).join('<br>')}</div>`).join('');
  $('detailContent').innerHTML = `<div class="detail-line">${escapeHtml(dateLabel(s.startedAt))}<br>训练时长：${Math.round((s.durationSeconds || 0) / 60)}分钟</div>${lines || '<p>没有详细动作数据</p>'}`;
  openDialog('detailDialog');
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function exportJson() {
  const exercises = (await getAll('exercises')).map(e => {
    const copy = { ...e };
    delete copy.videoBlob; // 跳过本地大视频 Blob，保证备份体积小且稳定
    return copy;
  });
  const backup = {
    app: 'FitLog',
    version: 2,
    exportedAt: nowIso(),
    categories: await getCategories(),
    exercises,
    plans: await getAll('plans'),
    sessions: await getAll('sessions')
  };
  downloadFile(`fitlog-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), 'application/json');
  showToast('JSON备份已导出');
}

async function exportCsv() {
  const sessions = await getAll('sessions');
  const rows = [['训练日期', '课程', '动作', '组数', '组序号', '次数', '左侧次数', '右侧次数', '时长秒', '重量kg']];
  sessions.forEach(s => (s.exercises || []).forEach(e => (e.sets || []).forEach(set => rows.push([s.startedAt, s.planName || '', e.name, (e.sets || []).length, set.setNumber, set.reps ?? '', set.leftReps ?? '', set.rightReps ?? '', set.durationSeconds ?? '', set.weightKg ?? 0]))));
  const csv = '\uFEFF' + rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  downloadFile(`fitlog-training-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
  showToast('CSV明细已导出');
}

async function importJson(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || parsed.app !== 'FitLog' || !Array.isArray(parsed.exercises) || !Array.isArray(parsed.plans) || !Array.isArray(parsed.sessions)) {
      throw new Error('文件格式不正确，无法识别为FitLog备份');
    }
    if (!confirm(`将恢复 ${parsed.exercises.length} 个动作、${parsed.plans.length} 个课程、${parsed.sessions.length} 条训练记录。恢复会覆盖当前全部数据，确定继续吗？`)) return;
    for (const name of STORES) await clearStore(name);
    if (Array.isArray(parsed.categories)) {
      await put('meta', { key: 'categories', value: parsed.categories });
    }
    for (const item of parsed.exercises) if (item && item.id) await put('exercises', item);
    for (const item of parsed.plans) if (item && item.id) await put('plans', item);
    for (const item of parsed.sessions) if (item && item.id) await put('sessions', item);
    showToast('备份恢复成功');
    await refreshCurrentPage();
  } catch (error) {
    alert(`恢复失败：${error.message}`);
  } finally {
    $('importJsonInput').value = '';
  }
}

async function updateStorageStatus() {
  try {
    const estimate = await navigator.storage?.estimate?.();
    $('storageStatus').textContent = estimate ? `浏览器存储估算：已使用 ${(estimate.usage / 1024 / 1024).toFixed(2)} MB。` : '本地数据库已就绪。';
  } catch {
    $('storageStatus').textContent = '本地数据库已就绪。';
  }
}

/* ===================== 缓存分级清理 ===================== */
const USEFUL_CACHE_NAME = `fitlog-v${APP_VERSION}-cache`;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function scanCacheSizes() {
  let usefulBytes = 0;
  let uselessBytes = 0;
  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      for (const key of keys) {
        const cache = await caches.open(key);
        const requests = await cache.keys();
        const estimated = requests.length * 18 * 1024;
        if (key === USEFUL_CACHE_NAME) usefulBytes += estimated;
        else uselessBytes += estimated;
      }
    } catch (_) {}
  }
  const usefulEl = $('sizeUseful');
  const uselessEl = $('sizeUseless');
  if (usefulEl) usefulEl.textContent = formatBytes(usefulBytes);
  if (uselessEl) uselessEl.textContent = formatBytes(uselessBytes);
}

function initCacheManager() {
  const scanBtn = $('btnScanCache');
  if (scanBtn) scanBtn.addEventListener('click', () => {
    scanCacheSizes();
    showToast('缓存扫描已完成');
  });

  const cleanBtn = $('btnCleanCache');
  if (!cleanBtn) return;

  cleanBtn.addEventListener('click', async () => {
    const cleanUseful = $('chkCacheUseful').checked;
    const cleanUseless = $('chkCacheUseless').checked;
    if (!cleanUseful && !cleanUseless) {
      showToast('请至少勾选一项要清理的缓存');
      return;
    }
    const items = [];
    if (cleanUseful) items.push('· 当前版本离线页面缓存（下次联网会自动重建）');
    if (cleanUseless) items.push('· 旧版本残留缓存');
    if (!confirm(`确认清理所选缓存？\n\n${items.join('\n')}`)) return;

    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        for (const key of keys) {
          const shouldDelete = key === USEFUL_CACHE_NAME ? cleanUseful : cleanUseless;
          if (shouldDelete) await caches.delete(key);
        }
      } catch (_) {}
    }
    await scanCacheSizes();
    showToast('所选缓存已清理完毕');
  });
}

/* ===================== DeepSeek 一键导出 ===================== */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {}
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch (_) {
    return false;
  }
}

async function exportDeepseek() {
  const [exercises, plans, sessions] = await Promise.all([
    getAll('exercises'), getAll('plans'), getAll('sessions')
  ]);
  const exerciseMap = new Map(exercises.map(e => [e.id, e]));
  const lines = [
    `【FitLog v${APP_VERSION} 训练数据】`,
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    `动作库：${exercises.length} 个动作 · 课程：${plans.length} 套 · 训练记录：${sessions.length} 条`,
    `------------------------`,
    `一、动作库`,
    ...exercises.map((e, i) => `${i + 1}. ${e.name}（${e.muscle}）| ${e.pureVideo ? '纯视频跟练，统计参数暂不启用' : `${typeLabel(e.type)} | 默认 ${e.defaultTarget?.sets ?? 3}组 × ${e.defaultTarget?.target ?? 12} | 休息 ${e.defaultTarget?.restSeconds ?? 45}秒`}`),
    `------------------------`,
    `二、训练课程`,
    ...plans.map((p, i) => `${i + 1}. ${p.name}：${(p.items || []).map(item => {
      const e = exerciseMap.get(item.exerciseId);
      return `${e?.name || '已删除动作'} ${item.sets}组×${item.target}${e?.type === 'time' ? '秒' : '次'}/休息${item.restSeconds}秒`;
    }).join('、')}`),
    `------------------------`,
    `三、最近训练`,
    ...sessions.slice(-5).map(s => `${dateLabel(s.startedAt)} | ${s.planName || '自由训练'} | ${Math.round((s.durationSeconds || 0) / 60)}分钟 | ${(s.exercises || []).length}个动作`),
    `------------------------`,
    `请作为专业健身教练，基于以上动作库、课程编排与训练记录，分析训练强度、肌群覆盖和恢复安排是否合理，并给出具体改进建议：`
  ];

  const text = lines.join('\n');
  const copied = await copyText(text);
  showToast(copied ? '训练数据已复制，正在尝试打开 DeepSeek App…' : '复制受限，请手动粘贴已选中的文本');
  openDeepseek();
}

// 优先唤起 DeepSeek App，1.6 秒内没离开页面（说明没装或唤起失败）则回退网页版
function openDeepseek() {
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  let leftPage = false;
  const onHide = () => { if (document.hidden) leftPage = true; };
  document.addEventListener('visibilitychange', onHide);

  const fallbackWeb = () => {
    document.removeEventListener('visibilitychange', onHide);
    if (leftPage || document.hidden) return;
    const opened = window.open('https://chat.deepseek.com/', '_blank');
    if (opened) {
      try { opened.opener = null; } catch (_) {}
      showToast('未检测到 DeepSeek App，已打开网页版，请粘贴数据');
    } else {
      showToast('请手动打开 DeepSeek App 或网页版粘贴数据');
    }
  };

  // 安卓用 intent 指向官方包名，iOS/其他用 URL Scheme
  const target = isAndroid
    ? 'intent://chat#Intent;scheme=deepseek;package=com.deepseek.chat;end'
    : 'deepseek://';
  try { window.location.href = target; } catch (_) {}
  setTimeout(fallbackWeb, 1600);
}

async function refreshCurrentPage() {
  await renderHome();
  if (currentPage === 'exercises') await renderExercises();
  if (currentPage === 'plans') await renderPlans();
  if (currentPage === 'history') await renderHistory();
  if (currentPage === 'data') await updateStorageStatus();
}

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.page)));
  document.querySelectorAll('[data-go]').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.go)));
  document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.close;
    if (id === 'exerciseDialog') setVideoPreviewSrc(null);
    if (id === 'detailDialog' || id === 'runnerDialog') stopAllVideos();
    closeDialog(id);
  }));
  $('homeStartBtn').addEventListener('click', () => navigate('plans'));

  // 动作库事件
  $('addExerciseBtn').addEventListener('click', () => openExerciseEditor());
  $('exerciseForm').addEventListener('submit', saveExercise);
  $('exerciseSearch').addEventListener('input', renderExercises);
  $('muscleFilter').addEventListener('change', renderExercises);

  $('addCustomCategoryBtn').addEventListener('click', async () => {
    const cat = prompt('请输入新的动作分类名称（如：臀腿、腰腹、胸、背、肩、手臂）：');
    if (cat && cat.trim()) {
      await addCustomCategory(cat.trim());
      showToast(`已添加分类“${cat.trim()}”`);
    }
  });

  $('exercisePureVideo').addEventListener('change', applyPureVideoMode);

  $('exerciseVideoFile').addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      showToast('视频超过 25MB，建议选较短示范视频或填视频链接');
    }
    draftExerciseVideoBlob = file;
    $('exerciseVideoUrl').value = '';
    setVideoPreviewSrc(file);
  });

  $('exerciseVideoUrl').addEventListener('input', e => {
    const url = e.target.value.trim();
    if (url) {
      draftExerciseVideoBlob = null;
      $('exerciseVideoFile').value = '';
      setVideoPreviewSrc(url);
    } else if (!draftExerciseVideoBlob) {
      setVideoPreviewSrc(null);
    }
  });

  $('clearExerciseVideoBtn').addEventListener('click', () => {
    draftExerciseVideoBlob = null;
    $('exerciseVideoFile').value = '';
    $('exerciseVideoUrl').value = '';
    setVideoPreviewSrc(null);
  });

  $('tempoPresetSelect').addEventListener('change', e => {
    const key = e.target.value;
    if (!key || !TEMPO_PRESETS[key]) return;
    renderTempoPhaseEditor(TEMPO_PRESETS[key]);
    showToast('已套用节拍模板，可按需调整秒数或阶段');
  });

  $('addTempoPhaseBtn').addEventListener('click', () => {
    const current = collectTempoPhasesFromEditor();
    current.push({ label: '呼气发力', seconds: 2, countOut: false, voice: '呼气发力' });
    renderTempoPhaseEditor(current);
  });

  $('tempoPhaseList').addEventListener('click', e => {
    const delBtn = e.target.closest('[data-remove-phase]');
    if (!delBtn) return;
    const idx = Number(delBtn.dataset.removePhase);
    const current = collectTempoPhasesFromEditor();
    current.splice(idx, 1);
    renderTempoPhaseEditor(current);
  });

  // 动作详情 Tab 与图表切换
  $('detailTabs').addEventListener('click', e => {
    const tabBtn = e.target.closest('[data-detail-tab]');
    if (!tabBtn || !activeDetailExerciseId) return;
    showExerciseDetail(activeDetailExerciseId, tabBtn.dataset.detailTab, activeChartMetric);
  });

  $('detailContent').addEventListener('click', e => {
    const metricBtn = e.target.closest('[data-chart-metric]');
    if (!metricBtn || !activeDetailExerciseId) return;
    showExerciseDetail(activeDetailExerciseId, 'history', metricBtn.dataset.chartMetric);
  });

  // 课程事件
  $('addPlanBtn').addEventListener('click', () => openPlanEditor());
  $('planForm').addEventListener('submit', savePlan);
  let planSearchTimer = null;
  $('planExerciseSearch').addEventListener('input', () => {
    syncDraftItemsFromDom();
    clearTimeout(planSearchTimer);
    planSearchTimer = setTimeout(() => renderPlanEditorLists(), 180);
  });

  $('toggleQuickCustomBtn').addEventListener('click', () => {
    const panel = $('quickCustomPanel');
    const isHidden = panel.classList.toggle('hidden');
    $('quickCustomArrow').textContent = isHidden ? '▾' : '▴';
  });

  $('saveQuickCustomBtn').addEventListener('click', handleQuickCustomExerciseForPlan);

  $('planExerciseChoices').addEventListener('change', async e => {
    const box = e.target.closest('.plan-ex-check');
    if (!box) return;
    syncDraftItemsFromDom();
    const id = box.value;
    if (box.checked) {
      if (!draftPlanItems.some(i => i.exerciseId === id)) {
        const ex = (await getAll('exercises')).find(x => x.id === id);
        draftPlanItems.push({
          exerciseId: id,
          sets: ex?.defaultTarget?.sets ?? 3,
          target: ex?.defaultTarget?.target ?? 12,
          restSeconds: ex?.defaultTarget?.restSeconds ?? 45
        });
      }
    } else {
      draftPlanItems = draftPlanItems.filter(i => i.exerciseId !== id);
    }
    await renderPlanEditorLists();
  });

  $('selectedPlanItems').addEventListener('click', async e => {
    const upBtn = e.target.closest('[data-move-up]');
    const downBtn = e.target.closest('[data-move-down]');
    const remBtn = e.target.closest('[data-remove-sel]');
    if (!upBtn && !downBtn && !remBtn) return;
    syncDraftItemsFromDom();
    if (upBtn) {
      const idx = Number(upBtn.dataset.moveUp);
      if (idx > 0) {
        [draftPlanItems[idx - 1], draftPlanItems[idx]] = [draftPlanItems[idx], draftPlanItems[idx - 1]];
        await renderPlanEditorLists();
      }
    } else if (downBtn) {
      const idx = Number(downBtn.dataset.moveDown);
      if (idx < draftPlanItems.length - 1) {
        [draftPlanItems[idx], draftPlanItems[idx + 1]] = [draftPlanItems[idx + 1], draftPlanItems[idx]];
        await renderPlanEditorLists();
      }
    } else if (remBtn) {
      const idx = Number(remBtn.dataset.removeSel);
      draftPlanItems.splice(idx, 1);
      await renderPlanEditorLists();
    }
  });

  // 执行器与数据备份事件
  $('runnerCloseBtn').addEventListener('click', closeRunner);
  $('exportJsonBtn').addEventListener('click', exportJson);
  $('exportCsvBtn').addEventListener('click', exportCsv);
  $('btnDeepseekExport').addEventListener('click', exportDeepseek);
  $('importJsonInput').addEventListener('change', event => importJson(event.target.files?.[0]));

  const testBeepBtn = $('btnTestBeep');
  if (testBeepBtn) testBeepBtn.addEventListener('click', () => {
    unlockAudio();
    playBeep(880, 160, 2);
    showToast('已触发滴滴提示音');
  });
  // 语音音色设置
  const voiceModeSel = $('voiceMode');
  const voiceSelect = $('voiceSelect');
  const voicePitch = $('voicePitch');
  const voiceRate = $('voiceRate');
  const syncVoiceControls = () => {
    if (voiceModeSel) voiceModeSel.value = voiceSettings.mode;
    if (voicePitch) { voicePitch.value = voiceSettings.pitch; const v = $('voicePitchVal'); if (v) v.textContent = Number(voiceSettings.pitch).toFixed(1); }
    if (voiceRate) { voiceRate.value = voiceSettings.rate; const v = $('voiceRateVal'); if (v) v.textContent = Number(voiceSettings.rate).toFixed(1); }
    if (voiceSelect) voiceSelect.value = voiceSettings.voiceURI || '';
  };
  syncVoiceControls();
  if (voiceModeSel) voiceModeSel.addEventListener('change', e => { voiceSettings.mode = e.target.value; saveVoiceSettings(); showToast('播报模式已保存'); });
  if (voiceSelect) voiceSelect.addEventListener('change', e => { voiceSettings.voiceURI = e.target.value; saveVoiceSettings(); showToast('语音音色已保存'); });
  if (voicePitch) voicePitch.addEventListener('input', e => {
    voiceSettings.pitch = Number(e.target.value);
    const v = $('voicePitchVal'); if (v) v.textContent = voiceSettings.pitch.toFixed(1);
  });
  if (voicePitch) voicePitch.addEventListener('change', () => { saveVoiceSettings(); });
  if (voiceRate) voiceRate.addEventListener('input', e => {
    voiceSettings.rate = Number(e.target.value);
    const v = $('voiceRateVal'); if (v) v.textContent = voiceSettings.rate.toFixed(1);
  });
  if (voiceRate) voiceRate.addEventListener('change', () => { saveVoiceSettings(); });

  const testVoiceBtn = $('btnTestVoice');
  if (testVoiceBtn) testVoiceBtn.addEventListener('click', () => {
    unlockAudio();
    const voice = pickPreferredVoice();
    const name = voice ? voice.name : '系统默认语音';
    if (voiceSettings.mode === 'beep') {
      playCountCue();
      showToast('当前为“仅提示音”模式，已播放滴滴声');
      return;
    }
    speak('第1次，第2次，第3次，做得很棒。', true, 'key');
    playCountCue();
    showToast(`正在试听：${name}`);
  });

  // 切后台只暂停；退出页面/返回缓存页时彻底关闭视频声音
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseAllVideos();
  });
  window.addEventListener('pagehide', stopAllVideos);
  window.addEventListener('beforeunload', stopAllVideos);
  window.addEventListener('pageshow', event => {
    if (event.persisted) stopAllVideos();
  });

  document.body.addEventListener('click', async event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.exerciseDetail) showExerciseDetail(target.dataset.exerciseDetail, 'info', 'primary');
    if (target.dataset.editExercise) {
      const e = (await getAll('exercises')).find(x => x.id === target.dataset.editExercise);
      if (e) openExerciseEditor(e);
    }
    if (target.dataset.deleteExercise) {
      const id = target.dataset.deleteExercise;
      const plans = await getAll('plans');
      if (plans.some(p => (p.items || []).some(i => i.exerciseId === id))) {
        showToast('该动作正在课程中使用，请先从课程移除');
        return;
      }
      if (confirm('确定删除这个动作吗？')) {
        await remove('exercises', id);
        await renderExercises();
        showToast('动作已删除');
      }
    }
    if (target.dataset.editPlan) {
      const p = (await getAll('plans')).find(x => x.id === target.dataset.editPlan);
      if (p) openPlanEditor(p);
    }
    if (target.dataset.deletePlan && confirm('确定删除这套课程吗？')) {
      await remove('plans', target.dataset.deletePlan);
      await renderPlans();
      showToast('课程已删除');
    }
    if (target.dataset.startPlan) startPlan(target.dataset.startPlan);
    if (target.dataset.sessionDetail) showSessionDetail(target.dataset.sessionDetail);
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $('installBtn').classList.remove('hidden');
  });
  $('installBtn').addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      showToast('请使用浏览器菜单中的“安装应用”或“添加到主屏幕”');
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $('installBtn').classList.add('hidden');
  });
}

async function init() {
  loadVoiceSettings();
  initAudioUnlock();
  initPullRefresh();
  initCacheManager();
  bindEvents();

  // 系统声音列表通常是异步加载的，多次尝试填充音色下拉
  refreshVoiceSelect();
  [300, 1200].forEach(delay => setTimeout(refreshVoiceSelect, delay));

  const versionEl = $('appVersion');
  if (versionEl) versionEl.textContent = `v${APP_VERSION}`;
  const versionDataEl = $('appVersionData');
  if (versionDataEl) versionDataEl.textContent = `v${APP_VERSION}`;

  try {
    db = await openDatabase();
    await seedData();
    await populateCategorySelects();
    await renderHome();
    restoreSavedPage();
    $('storageStatus').textContent = '本地数据库已连接。';
    await scanCacheSizes();
  } catch (error) {
    console.error(error);
    alert(`FitLog初始化失败：${error.message}。请使用较新的Chrome浏览器，并确认未处于无痕模式。`);
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service Worker注册失败', error));
  }
}

document.addEventListener('DOMContentLoaded', init);