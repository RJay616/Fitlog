'use strict';

// 版本规范：小迭代 1.1、1.2、1.3；大改版 2.1、2.2
const APP_VERSION = '1.7';
const PAGE_STORAGE_KEY = 'fitlog-current-page';

const DB_NAME = 'fitlog-db';
const DB_VERSION = 2;
const STORES = ['exercises', 'plans', 'sessions', 'meta'];
const DEFAULT_CATEGORIES = ['臀腿', '腰腹', '胸', '背', '肩', '手臂', '核心', '臀部', '腿部', '全身', '其他'];

// 阶段默认配色：呼气红 / 保持停顿黄 / 吸气绿（均可在编辑器里自定义）
const PHASE_COLOR = { exhale: '#ef4444', hold: '#f59e0b', inhale: '#22c55e', other: '#3b82f6' };
const TEMPO_PRESETS = {
  pushup: [
    { label: '吸气 · 缓慢向下', seconds: 3, countOut: true, voice: '吸气，缓慢向下', color: PHASE_COLOR.inhale },
    { label: '呼气 · 用力上撑', seconds: 1, countOut: false, voice: '呼气，用力上撑', color: PHASE_COLOR.exhale }
  ],
  kegel: [
    { label: '呼气 · 盆底肌收缩', seconds: 3, countOut: true, voice: '呼气，收缩', color: PHASE_COLOR.exhale },
    { label: '吸气 · 彻底放松', seconds: 10, countOut: true, voice: '吸气，放松', color: PHASE_COLOR.inhale }
  ],
  kickback: [
    { label: '呼气 · 向后踢出', seconds: 1, countOut: false, voice: '呼气，后踢', color: PHASE_COLOR.exhale },
    { label: '顶峰 · 保持收缩', seconds: 2, countOut: true, voice: '保持', color: PHASE_COLOR.hold },
    { label: '吸气 · 缓慢回收', seconds: 3, countOut: true, voice: '吸气，缓慢回收', color: PHASE_COLOR.inhale }
  ],
  squat: [
    { label: '吸气 · 屈髋下蹲', seconds: 3, countOut: true, voice: '吸气，下蹲', color: PHASE_COLOR.inhale },
    { label: '底部 · 稳定停顿', seconds: 1, countOut: false, voice: '保持稳定', color: PHASE_COLOR.hold },
    { label: '呼气 · 发力站起', seconds: 1, countOut: false, voice: '呼气，站起', color: PHASE_COLOR.exhale }
  ]
};

let db;
let currentPage = 'home';
let toastTimer;
let deferredInstallPrompt = null;
let runner = null;
let timerHandle = null;
// 训练进度快照（退出/刷新后回来可恢复）
const RUNNER_SNAPSHOT_KEY = 'fitlog-runner-snapshot';

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

// 训练提醒（持久化）
const REMINDERS_KEY = 'fitlog-reminders';
const REMINDER_DRAFT_KEY = 'fitlog-reminder-draft';
// rules: [{ id, type:'once'|'daily'|'hourly', time:'HH:MM', start:'HH:MM', end:'HH:MM', text, enabled }]
const reminderState = { rules: [], tickTimer: null, visBound: false };

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
  if (options.focus) {
    setTimeout(() => {
      const el = $(options.focus);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  } else if (scroll) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
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
              ${(e.leftRight || e.type === 'side') ? `<span class="tag amber">左右分步</span>` : ''}
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
    'exerciseType', 'exerciseLeftRight', 'exDefaultSets', 'exDefaultTarget', 'exDefaultWeight',
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
      <label class="tp-color-wrap" title="自定义该阶段显示颜色">
        <span class="tp-color-dot" style="background:${/^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : PHASE_COLOR.other}"></span>
        <input type="color" class="tp-color" value="${/^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : PHASE_COLOR.other}">
      </label>
      <input type="number" class="tp-sec" min="1" max="120" value="${clampInt(p.seconds, 1, 120, 3)}" title="持续秒数">
      <button type="button" class="tempo-del-btn" data-remove-phase="${idx}" title="删除阶段">×</button>
    </div>
  `).join('');
}

function collectTempoPhasesFromEditor() {
  const rows = Array.from($('tempoPhaseList').querySelectorAll('.tempo-phase-row'));
  return rows.map(row => {
    const label = row.querySelector('.tp-label')?.value.trim() || '节拍阶段';
    const seconds = clampInt(row.querySelector('.tp-sec')?.value, 1, 120, 3);
    const rawColor = row.querySelector('.tp-color')?.value || '';
    const color = /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : PHASE_COLOR.other;
    return { label, seconds, color, voice: label };
  });
}

async function openExerciseEditor(exercise = null) {
  await populateCategorySelects(exercise?.muscle || '臀腿');
  $('exerciseDialogTitle').textContent = exercise ? '编辑动作' : '添加动作';
  $('exerciseId').value = exercise?.id || '';
  $('exerciseName').value = exercise?.name || '';
  $('exerciseMuscle').value = exercise?.muscle || $('exerciseMuscle').value;
  $('exerciseType').value = exercise?.type || 'reps';
  $('exerciseLeftRight').checked = Boolean(exercise?.leftRight);
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
    leftRight: Boolean($('exerciseLeftRight')?.checked),
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

// ===== 训练进度快照：退出/刷新后保存暂停点，回来询问是否继续 =====
function runnerSnapshotData() {
  if (!runner) return null;
  return {
    planId: runner.planId,
    planName: runner.planName,
    index: runner.index,
    setIndex: runner.setIndex,
    phase: runner.phase,
    remaining: runner.remaining,
    tempoIndex: runner.tempoIndex,
    tempoSecLeft: runner.tempoSecLeft,
    completedRepsInSet: runner.completedRepsInSet,
    elapsedSec: runner.elapsedSec,
    sideStage: runner.sideStage,
    enterSideRight: runner.enterSideRight,
    leftDone: runner.leftDone,
    rightDone: runner.rightDone,
    restKind: runner.restKind,
    pendingAdvance: runner.pendingAdvance,
    paused: true,
    session: runner.session,
    pausedAt: nowIso()
  };
}

function saveRunnerSnapshot() {
  const data = runnerSnapshotData();
  if (!data) return;
  try { sessionStorage.setItem(RUNNER_SNAPSHOT_KEY, JSON.stringify(data)); } catch (_) {}
}

function clearRunnerSnapshot() {
  try { sessionStorage.removeItem(RUNNER_SNAPSHOT_KEY); } catch (_) {}
}

function loadRunnerSnapshot() {
  try {
    const raw = sessionStorage.getItem(RUNNER_SNAPSHOT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && data.planId && data.session ? data : null;
  } catch (_) { return null; }
}

// 暂停当前训练：停止计时器、视频、语音，并保存快照
function pauseRunner() {
  if (!runner || runner.phase === 'done') return;
  stopRunnerTimer();
  const video = $('runnerVideo');
  if (video && typeof video.pause === 'function') video.pause();
  cancelSpeech();
  runner.paused = true;
  saveRunnerSnapshot();
  renderRunner();
  showToast('训练已暂停，进度已保存');
}

// 继续训练：清除暂停标记，按当前阶段重启计时/节拍/视频
function resumeRunner() {
  if (!runner) return;
  runner.paused = false;
  clearRunnerSnapshot();
  const exercise = currentRunnerItem()?.exercise;
  if (runner.phase === 'work' && exercise) {
    const hasTempo = Array.isArray(exercise.tempoPhases) && exercise.tempoPhases.length > 0;
    if (hasTempo) startTempoPhase(runner.tempoIndex || 0);
    else if (!exercise.pureVideo) startPlainTickLoop();
  } else if (runner.phase === 'prepare') {
    startCountdownLoop('prepare');
  } else if (runner.phase === 'rest') {
    startCountdownLoop('rest');
  }
  const video = $('runnerVideo');
  if (runner.phase === 'video' && video && typeof video.play === 'function') video.play().catch(() => {});
  renderRunner();
}

// 从快照恢复训练状态（重新载入动作数据）
async function restoreRunnerFromSnapshot(snap) {
  const plan = (await getAll('plans')).find(p => p.id === snap.planId);
  if (!plan) { clearRunnerSnapshot(); return false; }
  const all = await getAll('exercises');
  const map = new Map(all.map(e => [e.id, e]));
  const items = plan.items.map(i => ({ ...i, exercise: map.get(i.exerciseId) })).filter(i => i.exercise);
  if (!items.length) { clearRunnerSnapshot(); return false; }
  runner = {
    planId: snap.planId,
    planName: snap.planName,
    items,
    index: snap.index || 0,
    setIndex: snap.setIndex || 1,
    session: snap.session,
    phase: snap.phase || 'work',
    remaining: snap.remaining || 0,
    tempoIndex: snap.tempoIndex || 0,
    tempoSecLeft: snap.tempoSecLeft || 0,
    completedRepsInSet: snap.completedRepsInSet || 0,
    elapsedSec: snap.elapsedSec || 0,
    sideStage: snap.sideStage || null,
    enterSideRight: Boolean(snap.enterSideRight),
    leftDone: snap.leftDone ?? null,
    rightDone: snap.rightDone ?? null,
    restKind: snap.restKind || null,
    pendingAdvance: snap.pendingAdvance || null,
    paused: true
  };
  return true;
}

// 训练执行器（5秒起势准备 + 多阶段呼吸节拍引导 + 语音播报）
async function startPlan(id) {
  const plan = (await getAll('plans')).find(p => p.id === id);
  if (!plan) return;
  clearRunnerSnapshot();
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

// 左右两侧分步：左做完→切换休息→右做完→本组结束
function isSplitSide(exercise) {
  return Boolean(exercise?.leftRight) || exercise?.type === 'side';
}
const SIDE_SWITCH_SECONDS = 20;

function setupRunnerPhase(isFirstStart = false) {
  stopRunnerTimer();
  if (!runner) return;
  const item = currentRunnerItem();
  const exercise = item.exercise;
  const hasTempo = Array.isArray(exercise.tempoPhases) && exercise.tempoPhases.length > 0;
  const split = isSplitSide(exercise);

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
    runner.leftDone = null;
    runner.rightDone = null;
    if (split) { runner.sideStage = 'left'; runner.enterSideRight = false; }
    else runner.sideStage = null;
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
    if (split) {
      if (runner.enterSideRight) {
        runner.sideStage = 'right';
        runner.enterSideRight = false;
      } else {
        runner.sideStage = 'left';
        runner.leftDone = null;
        runner.rightDone = null;
      }
    } else {
      runner.sideStage = null;
    }
    renderRunner();
    const sideName = split ? (runner.sideStage === 'left' ? '左侧' : '右侧') : '';
    if (hasTempo) {
      if (split) speak(`${sideName}，${exercise.name}，第${runner.setIndex}组。`, true, 'key');
      startTempoPhase(0);
    } else {
      speak(`开始第${runner.setIndex}组，${sideName}${exercise.name}。`, true, 'key');
      startPlainTickLoop();
    }
  } else if (runner.phase === 'rest') {
    const isSwitch = runner.restKind === 'switch';
    runner.remaining = isSwitch ? SIDE_SWITCH_SECONDS : clampInt(item.restSeconds, 0, 600, 30);
    playRestStartCue();
    if (isSwitch) {
      speak(`左侧完成，休息${SIDE_SWITCH_SECONDS}秒，调整到右侧后继续。`, true, 'key');
    } else {
      speak(`本组完成，休息${runner.remaining}秒。`, true, 'key');
    }
    renderRunner();
    startCountdownLoop('rest');
  } else if (runner.phase === 'done') {
    renderRunner();
    speak('训练课程已经全部完成，太棒了！', true, 'key');
  }
}

// 同步更新彩色圆内数字与 1.4 风格倒计时数字（两处同时刷新）
function updateTempoNumber() {
  const val = Math.max(0, runner?.tempoSecLeft || 0);
  const main = $('runnerNumber');
  if (main) main.textContent = val;
  const circle = $('runnerNumberCircle');
  if (circle) circle.textContent = val;
}

// 简洁节拍：每秒滴一声掌握节奏；一次动作开始前只报纯数字（1、2、3…）
// 达到目标次数后自动进入休息 → 自动下一组 / 下一动作；左右侧动作按左→切换→右分步
function startTempoPhase(phaseIdx) {
  stopRunnerTimer();
  if (!runner || runner.phase !== 'work') return;
  const item = currentRunnerItem();
  const exercise = item.exercise;
  const phases = exercise.tempoPhases || [];
  if (!phases.length) return;

  runner.tempoIndex = phaseIdx % phases.length;
  const p = phases[runner.tempoIndex];
  runner.tempoSecLeft = clampInt(p.seconds, 1, 120, 3);

  // 一次动作开始前：只报数字，不说“第几个”
  if (phaseIdx === 0) {
    speak(String(runner.completedRepsInSet + 1), true, 'count');
  }

  renderRunner();

  timerHandle = setInterval(() => {
    if (!runner || runner.phase !== 'work') {
      stopRunnerTimer();
      return;
    }
    runner.tempoSecLeft -= 1;
    playTickCue(); // 每秒一声轻滴
    updateTempoNumber();

    if (runner.tempoSecLeft > 0) return;

    const nextIdx = runner.tempoIndex + 1;
    if (nextIdx < phases.length) {
      startTempoPhase(nextIdx);
    } else {
      // 一轮节拍走完 = 完成一次
      runner.completedRepsInSet += 1;
      const repsDoneEl = $('repsDone');
      if (repsDoneEl) repsDoneEl.textContent = runner.completedRepsInSet;
      const targetReps = item.target || exercise.defaultTarget?.target;
      if (targetReps && runner.completedRepsInSet >= targetReps) {
        stopRunnerTimer();
        onSideOrSetComplete();
      } else {
        startTempoPhase(0);
      }
    }
  }, 1000);
}

// 一次目标达成后：左右侧分步先切到另一侧，否则自动结算本组并进入休息
function onSideOrSetComplete() {
  if (!runner) return;
  const item = currentRunnerItem();
  const exercise = item.exercise;
  speak(String(runner.completedRepsInSet), true, 'count');

  if (isSplitSide(exercise)) {
    if (runner.sideStage === 'left') {
      runner.leftDone = runner.completedRepsInSet;
      beginSideSwitch();
      return;
    }
    runner.rightDone = runner.completedRepsInSet;
  }
  autoCompleteSet();
}

// 左侧完成 → 20 秒切换休息 → 右侧
function beginSideSwitch() {
  stopRunnerTimer();
  runner.restKind = 'switch';
  runner.pendingAdvance = { index: runner.index, setIndex: runner.setIndex, sideSwitch: true };
  runner.phase = 'rest';
  setupRunnerPhase(false);
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
        if (runner.pendingAdvance?.sideSwitch) {
          const target = runner.pendingAdvance;
          runner.pendingAdvance = null;
          runner.restKind = null;
          runner.enterSideRight = true;
          runner.index = target.index;
          runner.setIndex = target.setIndex;
          runner.phase = 'work';
          setupRunnerPhase(false);
          return;
        }
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
  const split = isSplitSide(exercise);
  const sideBadge = split
    ? `<span class="side-badge">${runner.sideStage === 'right' ? '右侧' : '左侧'}</span>`
    : '';

  // 工作阶段（有节拍）：上方彩色圆（描述大字+圆内数字），下方 1.4 风格倒计时区（数字两边暂停/停止）
  let centerHtml = '';
  if (runner.phase === 'work' && currentPhase) {
    const color = /^#[0-9a-f]{6}$/i.test(currentPhase.color || '') ? currentPhase.color : PHASE_COLOR.other;
    const descText = currentPhase.label || '跟练';
    centerHtml = `
      <div class="phase-circle" style="background:${color}">
        <div class="phase-circle-label">${escapeHtml(descText)}</div>
        <div class="phase-circle-count" id="runnerNumberCircle">${Math.max(0, runner.tempoSecLeft)}</div>
      </div>
      <div class="tempo-banner work-countdown">
        <div class="tempo-phase-title">当前节拍倒计时</div>
        <div class="work-countdown-row">
          <button type="button" class="cd-side-btn cd-pause" id="workPauseBtn" title="暂停/继续">⏸</button>
          <div class="runner-number" id="runnerNumber">${Math.max(0, runner.tempoSecLeft)}</div>
          <button type="button" class="cd-side-btn cd-stop" id="workStopBtn" title="结束训练">⏹</button>
        </div>
      </div>
      <div class="reps-progress">已完成 <b id="repsDone">${runner.completedRepsInSet}</b> / ${item.target || exercise.defaultTarget?.target || '—'} 次${split ? ` · ${runner.sideStage === 'right' ? '右侧' : '左侧'}` : ''}</div>
    `;
  }

  let bannerHtml = '';
  if (runner.phase === 'prepare') {
    bannerHtml = `<div class="tempo-banner prep-mode"><div class="tempo-phase-title">调整初始姿势（准备缓冲）</div><div class="tempo-phase-sub">先摆好姿势，倒计时结束后自动开始</div></div>`;
  } else if (runner.phase === 'rest') {
    const isSwitch = runner.restKind === 'switch';
    const nextName = runner.pendingAdvance
      ? (runner.items[runner.pendingAdvance.index]?.exercise.name || '下一动作')
      : '下一组';
    const title = isSwitch ? '切换休息 · 准备做右侧' : `组间休息 · 下一项：${nextName}`;
    bannerHtml = `<div class="tempo-banner rest-mode"><div class="tempo-phase-title">${escapeHtml(title)}</div><div class="tempo-phase-sub">放松呼吸，倒计时结束自动继续</div></div>`;
  } else if (runner.phase === 'video') {
    bannerHtml = `<div class="tempo-banner"><div class="tempo-phase-title">纯视频跟练</div><div class="tempo-phase-sub">跟随视频完成动作，结束后自动进入下一项</div></div>`;
  }

  const numberDisplay = runner.phase === 'done'
    ? '✓'
    : runner.phase === 'video'
      ? '▶'
      : (runner.phase === 'prepare' || runner.phase === 'rest')
      ? runner.remaining
      : '开始';

  const defaultVal = item.target || exercise.defaultTarget?.target || 12;

  // 工作阶段：有节拍自动结算（无需手动输入）；无节拍才显示输入框和“完成本组”
  let workControlsHtml = '';
  if (runner.phase === 'work' && !hasTempo) {
    workControlsHtml = `
      <div class="runner-inputs">${
        split
          ? `<label>左侧次数<input id="actualLeft" type="number" min="0" max="9999" value="${defaultVal}" inputmode="numeric"></label><label>右侧次数<input id="actualRight" type="number" min="0" max="9999" value="${defaultVal}" inputmode="numeric"></label>`
          : `<label>${exercise.type === 'time' ? '完成时长（秒）' : '完成次数'}<input id="actualValue" type="number" min="0" max="9999" value="${defaultVal}" inputmode="numeric"></label><label>重量（kg）<input id="actualWeight" type="number" min="0" max="9999" step="0.5" value="${exercise.defaultTarget?.weight ?? 0}" inputmode="decimal"></label>`
      }</div>
      <div class="runner-controls"><button class="main" id="completeSetBtn">完成本组</button></div>
    `;
  }

  $('runnerBody').innerHTML = `
    <div class="runner-kicker">动作 ${runner.index + 1} / ${runner.items.length} · ${isPureVideo ? '纯视频跟练（暂不统计）' : `第 ${runner.setIndex} / ${item.sets} 组（目标 ${item.target}${exercise.type === 'time' ? '秒' : '次'}）`}</div>
    <h2>${sideBadge}${escapeHtml(exercise.name)}</h2>
    ${exercise.cue ? `<p class="runner-cue">💡 ${escapeHtml(exercise.cue)}</p>` : ''}
    ${videoHtml}
    ${bannerHtml}
    ${centerHtml}
    ${(!centerHtml) ? `<div class="runner-label">${
      runner.phase === 'prepare' ? '起势准备倒计时'
        : runner.phase === 'rest' ? '休息剩余秒数'
          : runner.phase === 'video' ? '跟随视频完成本次练习'
            : runner.phase === 'done' ? '本次训练已全部完成'
              : '完成本组后记录实际数据'
    }</div><div class="runner-number" id="runnerNumber">${numberDisplay}</div>` : ''}
    ${workControlsHtml}
    ${runner.phase === 'prepare'
      ? `<div class="runner-controls"><button class="alt" id="skipPrepareBtn">立即开始</button></div>`
      : runner.phase === 'video'
        ? `<div class="runner-controls"><button class="alt" id="replayVideoBtn">重播视频</button><button class="main" id="nextVideoBtn">下一个动作</button></div>`
        : runner.phase === 'rest'
          ? `<div class="runner-controls"><button class="alt" id="skipRestBtn">跳过休息</button><button class="main" id="pauseRestBtn">暂停计时</button></div>`
          : runner.phase === 'done'
            ? `<div class="runner-controls"><button class="main" id="finishSessionBtn">保存并结束</button></div>`
            : `<div class="runner-controls"><button class="alt" id="runnerCueBtn">重播提示</button></div>`
    }
  `;

  if (runner.phase === 'prepare') {
    $('skipPrepareBtn').onclick = () => {
      runner.phase = 'work';
      setupRunnerPhase(false);
    };
  } else if (runner.phase === 'work') {
    if ($('runnerCueBtn')) $('runnerCueBtn').onclick = () => speak(exercise.cue || exercise.notes || exercise.name, true, 'key');
    if ($('completeSetBtn')) $('completeSetBtn').onclick = completeSet;
    // 有节拍时：1.4 倒计时区两侧的暂停/停止按钮
    if ($('workPauseBtn')) {
      $('workPauseBtn').textContent = runner.paused ? '▶' : '⏸';
      $('workPauseBtn').onclick = () => {
        if (runner.paused) resumeRunner(); else pauseRunner();
        const top = $('runnerPauseBtn');
        if (top) { top.textContent = runner.paused ? '▶' : '⏸'; top.title = runner.paused ? '继续训练' : '暂停训练'; }
        $('workPauseBtn').textContent = runner.paused ? '▶' : '⏸';
      };
    }
    if ($('workStopBtn')) $('workStopBtn').onclick = () => {
      const doneSets = runner.session?.exercises?.length || 0;
      if (confirm(doneSets > 0 ? `确定结束本次训练吗？已完成的 ${doneSets} 组会保存。` : '确定结束本次训练吗？尚未完成任何组，本次不保存记录。')) {
        clearRunnerSnapshot();
        finishSession();
      }
    };
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

  // 暂停态：加遮罩提示，避免误以为卡住
  const bodyEl = $('runnerBody');
  if (bodyEl) {
    bodyEl.classList.toggle('is-paused', Boolean(runner.paused));
    const oldMask = bodyEl.querySelector('.runner-paused-mask');
    if (oldMask) oldMask.remove();
    if (runner.paused) {
      const mask = document.createElement('div');
      mask.className = 'runner-paused-mask';
      mask.innerHTML = `<div class="rpm-card"><div class="rpm-icon">⏸</div><b>训练已暂停</b><p>点右上角 ▶ 继续训练</p></div>`;
      bodyEl.insertBefore(mask, bodyEl.firstChild);
    }
  }
}

// 自动结算本组：用节拍累计的次数作为实际次数，无需手动输入
function autoCompleteSet() {
  if (!runner) return;
  const item = currentRunnerItem();
  const exercise = item.exercise;
  const split = isSplitSide(exercise);
  const target = item.target || exercise.defaultTarget?.target || runner.completedRepsInSet;

  const left = split ? (runner.leftDone ?? target) : null;
  const right = split ? (runner.rightDone ?? target) : null;
  const actual = split ? null : (exercise.type === 'time' ? Math.max(0, runner.elapsedSec || 0) : runner.completedRepsInSet || target);
  const weight = split ? 0 : (exercise.defaultTarget?.weight ?? 0);

  recordSet(exercise, {
    reps: exercise.type === 'time' || split ? null : actual,
    leftReps: left,
    rightReps: right,
    durationSeconds: exercise.type === 'time' && !split ? actual : null,
    weightKg: weight
  });

  runner.leftDone = null;
  runner.rightDone = null;
  advanceAfterSet();
}

// 手动“完成本组”（无节拍动作使用）
function completeSet() {
  stopRunnerTimer();
  const item = currentRunnerItem();
  const exercise = item.exercise;
  const isSide = isSplitSide(exercise);
  const actual = isSide ? null : clampInt($('actualValue')?.value, 0, 9999, 0);
  const left = isSide ? clampInt($('actualLeft')?.value, 0, 9999, 0) : null;
  const right = isSide ? clampInt($('actualRight')?.value, 0, 9999, 0) : null;
  const weight = isSide ? 0 : Math.max(0, Number($('actualWeight')?.value) || 0);

  if (isSide ? (left <= 0 && right <= 0) : (actual <= 0)) {
    showToast('请输入本组实际完成数据');
    if (Array.isArray(exercise.tempoPhases) && exercise.tempoPhases.length) {
      startTempoPhase(runner.tempoIndex || 0);
    }
    return;
  }

  recordSet(exercise, {
    reps: exercise.type === 'time' || isSide ? null : actual,
    leftReps: left,
    rightReps: right,
    durationSeconds: exercise.type === 'time' ? actual : null,
    weightKg: weight
  });
  advanceAfterSet();
}

function recordSet(exercise, payload) {
  let exerciseRecord = runner.session.exercises.find(e => e.exerciseId === exercise.id);
  if (!exerciseRecord) {
    exerciseRecord = { exerciseId: exercise.id, name: exercise.name, type: exercise.type, sets: [] };
    runner.session.exercises.push(exerciseRecord);
  }
  exerciseRecord.sets.push({ setNumber: runner.setIndex, ...payload, completedAt: nowIso() });
}

// 本组结束后：同动作还有组 → 自动组间休息；否则进入下一动作（动作间也会休息）
function advanceAfterSet() {
  const item = currentRunnerItem();
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
  if (!runner.restKind) runner.restKind = 'set';
  runner.pendingAdvance = target;
  runner.phase = 'rest';
  setupRunnerPhase(false);
}

// 休息结束（或手动跳过）后继续：左右切换 → 右侧训练；否则按目标推进
function applyPendingAdvance() {
  const target = runner.pendingAdvance;
  runner.pendingAdvance = null;
  runner.restKind = null;

  if (target?.sideSwitch) {
    runner.enterSideRight = true;
    runner.index = target.index;
    runner.setIndex = target.setIndex;
    runner.phase = 'work';
    setupRunnerPhase(false);
    return;
  }
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
  clearRunnerSnapshot();
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
  if (runner.phase === 'done') {
    stopAllVideos();
    cancelSpeech();
    closeDialog('runnerDialog');
    return;
  }
  // 退出时保存进度快照，后续再打开会询问是否继续
  runner.paused = true;
  stopRunnerTimer();
  const video = $('runnerVideo');
  if (video && typeof video.pause === 'function') video.pause();
  saveRunnerSnapshot();
  stopAllVideos();
  cancelSpeech();
  releaseWakeLock();
  runner = null;
  closeDialog('runnerDialog');
  showToast('训练已退出，下次打开可继续');
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
  showToast(copied ? '训练数据已复制，正在调起系统分享…' : '复制受限，请在分享面板中手动选择文本');
  openDeepseek(text);
}

// 优先调起系统分享面板：DeepSeek 支持接收文本分享，点一下即把数据带入输入框
// 绝不再跳 Google Play 商店页（国内不可用）
function openDeepseek(text) {
  if (navigator.share) {
    navigator.share({
      title: 'FitLog 训练数据',
      text: text || ''
    }).then(() => {
      showToast('已调起系统分享，请在面板中选择 DeepSeek');
    }).catch(err => {
      if (err && err.name === 'AbortError') {
        showToast('已取消分享，数据仍在剪贴板中');
      } else {
        showToast('系统分享不可用，已为你打开网页版');
        openDeepseekWeb();
      }
    });
    return;
  }
  showToast('当前浏览器不支持系统分享，已打开网页版');
  openDeepseekWeb();
}

function openDeepseekWeb() {
  const opened = window.open('https://chat.deepseek.com/', '_blank');
  if (opened) {
    try { opened.opener = null; } catch (_) {}
  } else {
    showToast('弹窗被拦截，请手动访问 chat.deepseek.com 并粘贴');
  }
}

/* ===================== 训练提醒 ===================== */
function loadReminders() {
  try {
    const saved = JSON.parse(localStorage.getItem(REMINDERS_KEY) || '{}');
    if (saved && Array.isArray(saved.rules)) reminderState.rules = saved.rules;
  } catch (_) {}
}

function saveReminders() {
  try { localStorage.setItem(REMINDERS_KEY, JSON.stringify({ rules: reminderState.rules })); } catch (_) {}
}

// 恢复上次保存的提醒表单默认值
function restoreReminderDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(REMINDER_DRAFT_KEY) || 'null');
    if (!d || typeof d !== 'object') return;
    const typeSel = $('reminderType');
    if (typeSel && d.type) typeSel.value = d.type;
    if ($('reminderTime') && d.time) $('reminderTime').value = d.time;
    if ($('reminderDate') && d.date) $('reminderDate').value = d.date;
    if ($('reminderStart') && d.start) $('reminderStart').value = d.start;
    if ($('reminderEnd') && d.end) $('reminderEnd').value = d.end;
    if ($('reminderText')) $('reminderText').value = d.text || '';
  } catch (_) {}
}

const firedKey = (rule, dateKey, hour) => `fitlog-fired-${rule.id}-${dateKey}${hour != null ? '-' + hour : ''}`;

function wasFired(rule, dateKey, hour) {
  try { return localStorage.getItem(firedKey(rule, dateKey, hour)) === '1'; } catch (_) { return false; }
}

function markFired(rule, dateKey, hour) {
  try {
    const key = firedKey(rule, dateKey, hour);
    localStorage.setItem(key, '1');
    setTimeout(() => { try { localStorage.removeItem(key); } catch (_) {} }, 26 * 3600 * 1000);
  } catch (_) {}
}

function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  return { h: Math.min(23, Math.max(0, +m[1])), min: Math.min(59, Math.max(0, +m[2])) };
}

let reminderRingTimer = null;

// 响铃：连续播多轮提示音，直到用户关闭弹窗（声音兜底，确保能注意到）
function startReminderRing() {
  stopReminderRing();
  unlockAudio();
  let count = 0;
  const ring = () => {
    playBeep(1320, 180, 2, 150);
    count += 1;
    if (count >= 12) stopReminderRing();
  };
  ring();
  reminderRingTimer = setInterval(ring, 900);
}

function stopReminderRing() {
  if (reminderRingTimer) {
    clearInterval(reminderRingTimer);
    reminderRingTimer = null;
  }
}

function fireReminderNotification(rule) {
  const title = 'FitLog 训练提醒';
  const body = rule.text || '该动一动啦！';
  startReminderRing();
  speak(rule.text || '该起来活动一下了', true, 'key');

  // 强制弹窗提醒（不依赖系统通知是否成功）
  const textEl = $('reminderAlertText');
  const timeEl = $('reminderAlertTime');
  if (textEl) textEl.textContent = body;
  if (timeEl) timeEl.textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const dlg = $('reminderAlertDialog');
  if (dlg && typeof dlg.showModal === 'function' && !dlg.open) {
    try { dlg.showModal(); } catch (_) {}
  }
  showToast(body);

  // 系统通知作为补充（后台也能收到）
  if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      if (reg.showNotification) {
        reg.showNotification(title, { body, tag: 'fitlog-reminder-' + rule.id + '-' + Date.now(), icon: './icon-192.png', requireInteraction: true }).catch(() => {});
      }
    }).catch(() => {});
  } else if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: './icon-192.png' }); } catch (_) {}
  }
}

function checkReminders() {
  const now = new Date();
  const dateKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  const dateIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const curMin = now.getHours() * 60 + now.getMinutes();
  reminderState.rules.forEach(rule => {
    if (!rule.enabled) return;
    if (rule.type === 'daily' || rule.type === 'once') {
      const t = parseHHMM(rule.time);
      if (!t) return;
      // ±2 分钟容错，避免后台节流错过整点；markFired 保证每条每天只响一次
      if (Math.abs(curMin - (t.h * 60 + t.min)) <= 2) {
        if (rule.type === 'once' && rule.date && rule.date !== dateIso) return;
        if (!wasFired(rule, dateKey)) {
          markFired(rule, dateKey);
          fireReminderNotification(rule);
        }
      }
    } else if (rule.type === 'hourly') {
      const s = parseHHMM(rule.start), e = parseHHMM(rule.end);
      if (s && e && now.getHours() >= s.h && now.getHours() <= e.h && now.getMinutes() <= 2) {
        if (!wasFired(rule, dateKey, now.getHours())) {
          markFired(rule, dateKey, now.getHours());
          fireReminderNotification(rule);
        }
      }
    }
  });
}

function startReminderTicker() {
  if (reminderState.tickTimer) clearInterval(reminderState.tickTimer);
  checkReminders();
  // 缩到 15 秒，提高命中率；markFired 防止重复
  reminderState.tickTimer = setInterval(checkReminders, 15000);
  // 回到前台时立即补检查一次
  if (!reminderState.visBound) {
    reminderState.visBound = true;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkReminders();
    });
  }
}

function upcomingTriggerTimes(rule, from, hoursAhead) {
  const out = [];
  const limit = from.getTime() + hoursAhead * 3600 * 1000;
  if (rule.type === 'daily' || rule.type === 'once') {
    const t = parseHHMM(rule.time);
    if (!t) return out;
    for (let d = 0; d <= 2; d++) {
      const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d, t.h, t.min, 0, 0);
      const ts = date.getTime();
      if (ts <= from.getTime() + 1000 || ts > limit) continue;
      if (rule.type === 'once') {
        const ds = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        if (rule.date && rule.date !== ds) continue;
      }
      out.push(ts);
    }
  } else if (rule.type === 'hourly') {
    const s = parseHHMM(rule.start), e = parseHHMM(rule.end);
    if (!s || !e) return out;
    for (let d = 0; d <= 2; d++) {
      for (let h = s.h; h <= e.h; h++) {
        const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d, h, 0, 0, 0);
        const ts = date.getTime();
        if (ts > from.getTime() + 1000 && ts <= limit) out.push(ts);
      }
    }
  }
  return out;
}

// 增强：浏览器支持 Notification Triggers 时预约通知，App 关闭也能提醒
async function scheduleNotificationTriggers() {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return;
  if (typeof window.TimestampTrigger !== 'function') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const now = new Date();
    for (const rule of reminderState.rules) {
      if (!rule.enabled) continue;
      for (const ts of upcomingTriggerTimes(rule, now, 24)) {
        await reg.showNotification('FitLog 训练提醒', {
          body: rule.text || '该动一动啦！',
          tag: `fitlog-trigger-${rule.id}-${ts}`,
          icon: './icon-192.png',
          showTrigger: new window.TimestampTrigger(ts)
        });
      }
    }
  } catch (_) {}
}

async function requestNotifyPermission() {
  if (!('Notification' in window)) { showToast('当前浏览器不支持系统通知'); return false; }
  if (Notification.permission === 'granted') return true;
  const perm = await Notification.requestPermission();
  const ok = perm === 'granted';
  showToast(ok ? '通知权限已开启' : '未获权限，提醒将只在App内显示');
  return ok;
}

function updateReminderPermLabel() {
  const el = $('reminderPermStatus');
  if (!el) return;
  if (!('Notification' in window)) { el.textContent = '浏览器不支持通知'; return; }
  el.textContent = Notification.permission === 'granted'
    ? '系统通知已开启'
    : (Notification.permission === 'denied' ? '通知被拒绝，请在浏览器设置中开启' : '尚未开启系统通知');
}

function renderReminders() {
  const list = $('reminderList');
  if (!list) return;
  if (!reminderState.rules.length) {
    list.innerHTML = '<p class="muted small-text">还没有提醒。例如添加“每天 07:00 提醒拉伸”，或“9:00-17:00 每小时站起来活动”。</p>';
    return;
  }
  list.innerHTML = reminderState.rules.map(r => {
    let desc = '';
    if (r.type === 'daily') desc = `每天 ${r.time}`;
    else if (r.type === 'once') desc = `${r.date || '单次'} ${r.time}`;
    else if (r.type === 'hourly') desc = `${r.start} - ${r.end} 每小时`;
    return `<div class="reminder-row">
      <input type="checkbox" class="reminder-enabled" data-id="${r.id}" ${r.enabled ? 'checked' : ''}>
      <div class="reminder-info"><b>${escapeHtml(r.text || '训练提醒')}</b><small>${escapeHtml(desc)}</small></div>
      <button class="small-btn reminder-test" data-id="${r.id}">试响</button>
      <button class="small-btn danger-text reminder-del" data-id="${r.id}">删除</button>
    </div>`;
  }).join('');
}

function initReminders() {
  loadReminders();
  renderReminders();
  updateReminderPermLabel();

  const typeSel = $('reminderType');
  const toggleFields = () => {
    const onceBox = $('reminderOnceFields');
    const hourlyBox = $('reminderHourlyFields');
    const timeBox = $('reminderTimeField');
    if (onceBox) onceBox.classList.toggle('hidden', typeSel?.value !== 'once');
    if (hourlyBox) hourlyBox.classList.toggle('hidden', typeSel?.value !== 'hourly');
    if (timeBox) timeBox.classList.toggle('hidden', typeSel?.value === 'hourly');
  };
  if (typeSel) typeSel.addEventListener('change', toggleFields);
  toggleFields();

  // 保存表单设置为默认值（下次打开自动带入）
  const saveBtn = $('reminderSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    const draft = {
      type: typeSel?.value || 'daily',
      time: $('reminderTime')?.value || '07:00',
      date: $('reminderDate')?.value || '',
      start: $('reminderStart')?.value || '09:00',
      end: $('reminderEnd')?.value || '17:00',
      text: ($('reminderText')?.value || '').trim()
    };
    try { localStorage.setItem(REMINDER_DRAFT_KEY, JSON.stringify(draft)); } catch (_) {}
    showToast('设置已保存');
  });
  restoreReminderDraft();

  // 提醒弹窗：关闭并停止响铃
  const alertOk = $('reminderAlertOk');
  if (alertOk) alertOk.addEventListener('click', () => {
    stopReminderRing();
    closeDialog('reminderAlertDialog');
  });

  const addBtn = $('reminderAddBtn');
  if (addBtn) addBtn.addEventListener('click', () => {
    const type = typeSel?.value || 'daily';
    const text = ($('reminderText')?.value || '').trim();
    const rule = { id: makeId(), type, text: text || '该动一动啦，站起来活动一下！', enabled: true };
    if (type === 'hourly') {
      rule.start = $('reminderStart')?.value || '09:00';
      rule.end = $('reminderEnd')?.value || '17:00';
    } else {
      rule.time = $('reminderTime')?.value || '07:00';
      if (type === 'once') rule.date = $('reminderDate')?.value || '';
    }
    reminderState.rules.push(rule);
    saveReminders();
    renderReminders();
    startReminderTicker();
    scheduleNotificationTriggers();
    showToast('提醒已添加');
  });

  const list = $('reminderList');
  if (list) {
    list.addEventListener('change', e => {
      if (!e.target.classList.contains('reminder-enabled')) return;
      const r = reminderState.rules.find(x => x.id === e.target.dataset.id);
      if (!r) return;
      r.enabled = e.target.checked;
      saveReminders();
      scheduleNotificationTriggers();
      showToast(r.enabled ? '提醒已开启' : '提醒已暂停');
    });
    list.addEventListener('click', e => {
      const testBtn = e.target.closest('.reminder-test');
      const delBtn = e.target.closest('.reminder-del');
      if (testBtn) {
        const r = reminderState.rules.find(x => x.id === testBtn.dataset.id);
        if (r) fireReminderNotification(r);
      }
      if (delBtn) {
        reminderState.rules = reminderState.rules.filter(x => x.id !== delBtn.dataset.id);
        saveReminders();
        renderReminders();
        scheduleNotificationTriggers();
        showToast('提醒已删除');
      }
    });
  }

  const permBtn = $('reminderPermBtn');
  if (permBtn) permBtn.addEventListener('click', async () => {
    const ok = await requestNotifyPermission();
    updateReminderPermLabel();
    if (ok) scheduleNotificationTriggers();
  });

  startReminderTicker();
  scheduleNotificationTriggers();
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
  document.querySelectorAll('[data-go]').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.go, { focus: btn.dataset.focus })));
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

  // 选择颜色时，预览圆点实时变成所选颜色
  $('tempoPhaseList').addEventListener('input', e => {
    if (!e.target.classList.contains('tp-color')) return;
    const dot = e.target.closest('.tp-color-wrap')?.querySelector('.tp-color-dot');
    if (dot) dot.style.background = e.target.value;
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
  const pauseBtn = $('runnerPauseBtn');
  if (pauseBtn) pauseBtn.addEventListener('click', () => {
    if (!runner || runner.phase === 'done') return;
    if (runner.paused) resumeRunner();
    else pauseRunner();
    pauseBtn.textContent = runner.paused ? '▶' : '⏸';
    pauseBtn.title = runner.paused ? '继续训练' : '暂停训练';
  });
  const endBtn = $('runnerEndBtn');
  if (endBtn) endBtn.addEventListener('click', () => {
    if (!runner) return;
    const doneSets = runner.session?.exercises?.length || 0;
    if (confirm(doneSets > 0 ? `确定结束本次训练吗？已完成的 ${doneSets} 组会保存。` : '确定结束本次训练吗？尚未完成任何组，本次不保存记录。')) {
      clearRunnerSnapshot();
      finishSession();
    }
  });

  // 恢复训练弹窗
  const resumeYes = $('resumeTrainingYes');
  const resumeNo = $('resumeTrainingNo');
  if (resumeYes) resumeYes.addEventListener('click', async () => {
    closeDialog('resumeTrainingDialog');
    if (await restoreRunnerFromSnapshot(loadRunnerSnapshot())) {
      $('runnerPlanName').textContent = runner.planName;
      $('runnerPauseBtn').textContent = '▶';
      openDialog('runnerDialog');
      renderRunner();
      showToast('已恢复上次训练，点 ▶ 继续');
    }
  });
  if (resumeNo) resumeNo.addEventListener('click', () => {
    closeDialog('resumeTrainingDialog');
    clearRunnerSnapshot();
    showToast('已放弃上次的训练进度');
  });

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
    if (document.hidden) {
      pauseAllVideos();
      // 训练进行中切后台：保存快照，便于回来续练
      if (runner && runner.phase !== 'done' && !runner.paused) saveRunnerSnapshot();
    }
  });
  window.addEventListener('pagehide', () => {
    stopAllVideos();
    if (runner && runner.phase !== 'done' && !runner.paused) saveRunnerSnapshot();
  });
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
  initReminders();
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

    // 若存在未完成的训练快照，询问是否继续
    const snap = loadRunnerSnapshot();
    if (snap) {
      const pausedAt = snap.pausedAt ? new Date(snap.pausedAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
      const infoEl = $('resumeTrainingText');
      if (infoEl) infoEl.textContent = `“${snap.planName || '上次课程'}”尚未完成${pausedAt ? `（暂停于 ${pausedAt}）` : ''}，是否继续？`;
      openDialog('resumeTrainingDialog');
    }
  } catch (error) {
    console.error(error);
    alert(`FitLog初始化失败：${error.message}。请使用较新的Chrome浏览器，并确认未处于无痕模式。`);
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service Worker注册失败', error));
  }
}

document.addEventListener('DOMContentLoaded', init);