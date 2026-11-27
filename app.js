'use strict';

// 版本规范：小迭代 1.1、1.2、1.3；大改版 2.1、2.2
const APP_VERSION = '1.23';
const PAGE_STORAGE_KEY = 'fitlog-current-page';

const DB_NAME = 'fitlog-db';
const DB_VERSION = 4;
const STORES = ['exercises', 'plans', 'sessions', 'meta', 'bodyStats', 'moodNotes'];
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

// ===== 45 个居家/宾馆默认动作包（v1.18 新增）=====
// 节拍配色：呼气/发力=红，保持/停顿=蓝，吸气/还原=绿；节拍描述统一用一个字
const BEAT_COLOR = { e: '#ef4444', h: '#3b82f6', i: '#22c55e' };
const beat = (label, seconds, tone) => ({ label, seconds, color: BEAT_COLOR[tone], voice: label });

const DEFAULT_ACTION_PACK = [
  { name:'徒手深蹲', muscle:'腿部', type:'reps', notes:'双脚与肩同宽，膝对脚尖，臀后坐下蹲至大腿近水平。', cue:'膝盖外顶，别内扣', target:15, tempoPhases:[beat('蹲',3,'i'),beat('停',1,'h'),beat('起',2,'e')] },
  { name:'靠墙静蹲', muscle:'腿部', type:'time', notes:'背贴墙，膝约九十度，腰背贴紧，均匀呼吸勿憋气。', cue:'重心在后，膝别超脚尖', target:40, tempoPhases:[beat('稳',4,'h'),beat('吸',3,'i'),beat('呼',3,'e')] },
  { name:'弓步蹲（原地分腿蹲）', muscle:'腿部', type:'side', leftRight:true, notes:'前后脚站定，只上下沉，前膝对脚尖，重心居中。', cue:'重心居中，别前后晃', target:12, tempoPhases:[beat('蹲',3,'i'),beat('停',1,'h'),beat('起',2,'e')] },
  { name:'臀桥', muscle:'臀部', type:'reps', notes:'仰卧屈膝，脚跟发力顶髋，顶峰夹臀停一秒再落。', cue:'顶髋夹臀，别用腰', target:15, tempoPhases:[beat('顶',2,'e'),beat('停',2,'h'),beat('落',3,'i')] },
  { name:'单腿臀桥', muscle:'臀部', type:'side', leftRight:true, notes:'单腿撑地顶髋，骨盆保持水平，勿向一侧倾斜。', cue:'骨盆摆正，别歪', target:12, tempoPhases:[beat('顶',2,'e'),beat('停',2,'h'),beat('落',3,'i')] },
  { name:'臀桥交替抬腿', muscle:'臀部', type:'reps', notes:'臀桥顶峰稳住，交替轻抬一腿，骨盆不晃。', cue:'慢点别晃', target:12, tempoPhases:[beat('顶',2,'e'),beat('抬',2,'h'),beat('换',2,'h'),beat('落',2,'i')] },
  { name:'弹力带硬拉', muscle:'臀腿', type:'reps', notes:'踩住弹力带，屈髋后移，背挺直拉起再缓慢放下。', cue:'背挺直，臀后移', target:12, tempoPhases:[beat('拉',2,'e'),beat('停',1,'h'),beat('放',3,'i')] },
  { name:'徒手罗马尼亚硬拉／早安式', muscle:'臀腿', type:'reps', notes:'膝微屈，臀部后移，背挺直，感受大腿后侧拉伸。', cue:'背挺直，臀后推', target:12, tempoPhases:[beat('俯',3,'i'),beat('停',1,'h'),beat('起',2,'e')] },
  { name:'提踵', muscle:'腿部', type:'reps', notes:'扶稳支撑，踮脚至最高停一秒，再缓慢落下。', cue:'别借惯性弹', target:15, tempoPhases:[beat('踮',2,'e'),beat('停',1,'h'),beat('落',2,'i')] },
  { name:'站姿后踢腿', muscle:'臀部', type:'side', leftRight:true, notes:'扶椅背，腿向后伸直踢起，顶峰夹臀不甩腿。', cue:'夹臀发力，别甩腰', target:12, tempoPhases:[beat('踢',1,'e'),beat('停',2,'h'),beat('回',2,'i')] },
  { name:'蚌式开合', muscle:'臀部', type:'side', leftRight:true, notes:'侧卧屈膝，双脚并拢，膝盖缓慢开合，感受臀侧发力。', cue:'脚并拢，膝开合', target:15, tempoPhases:[beat('开',2,'e'),beat('停',1,'h'),beat('合',2,'i')] },
  { name:'侧卧抬腿', muscle:'臀部', type:'side', leftRight:true, notes:'侧卧，上腿伸直向上抬，脚尖略下压，慢起慢落。', cue:'腿往正上抬，别后甩', target:15, tempoPhases:[beat('抬',2,'e'),beat('停',1,'h'),beat('落',2,'i')] },
  { name:'站姿侧踢腿', muscle:'腿部', type:'side', leftRight:true, notes:'扶椅背，腿向侧面抬起，控制速度不借惯性。', cue:'慢起慢落，别甩', target:12, tempoPhases:[beat('踢',1,'e'),beat('停',1,'h'),beat('回',2,'i')] },
  { name:'螃蟹步', muscle:'臀部', type:'reps', notes:'半蹲屈膝，横向迈步，膝盖对脚尖，臀侧持续紧张。', cue:'半蹲稳住，别塌腰', target:12, tempoPhases:[beat('迈',2,'e'),beat('停',1,'h'),beat('收',2,'i')] },
  { name:'上斜俯卧撑', muscle:'胸', type:'reps', notes:'手扶稳固支撑，身体成直线，屈肘下沉再推起。', cue:'身体成线，支撑要稳', target:12, tempoPhases:[beat('下',3,'i'),beat('停',1,'h'),beat('撑',1,'e')] },
  { name:'跪姿俯卧撑', muscle:'胸', type:'reps', notes:'跪姿撑地，身体成线，胸口下沉至接近地面。', cue:'手腕垫好，身成线', target:12, tempoPhases:[beat('下',3,'i'),beat('停',1,'h'),beat('撑',1,'e')] },
  { name:'标准俯卧撑', muscle:'胸', type:'reps', notes:'双手略宽于肩，身体成线，屈肘下沉再推起。', cue:'收腹夹臀，别塌腰', target:12, tempoPhases:[beat('下',3,'i'),beat('停',1,'h'),beat('撑',1,'e')] },
  { name:'宽距俯卧撑', muscle:'胸', type:'reps', notes:'双手加宽，屈肘外展下沉，胸外侧发力推起。', cue:'肩痛就跳过', target:12, tempoPhases:[beat('下',3,'i'),beat('停',1,'h'),beat('撑',1,'e')] },
  { name:'窄距俯卧撑', muscle:'手臂', type:'reps', notes:'双手窄于肩，肘贴身体下沉，三头肌发力推起。', cue:'手腕立直，别塌', target:12, tempoPhases:[beat('下',3,'i'),beat('停',1,'h'),beat('撑',1,'e')] },
  { name:'钻石俯卧撑', muscle:'手臂', type:'reps', notes:'双手成菱形，肘贴身下沉，靠三头肌推起。', cue:'硬地别做', target:12, tempoPhases:[beat('下',3,'i'),beat('停',1,'h'),beat('撑',1,'e')] },
  { name:'下斜俯卧撑', muscle:'胸', type:'reps', notes:'脚垫高，身体成线，屈肘下沉再推起。', cue:'确认家具稳，再上脚', target:12, tempoPhases:[beat('下',3,'i'),beat('停',1,'h'),beat('撑',1,'e')] },
  { name:'弹力带划船', muscle:'背', type:'reps', notes:'踩住弹力带，屈髋前倾，肘向后拉夹肩胛。', cue:'肩下沉，肘后拉', target:12, tempoPhases:[beat('拉',2,'e'),beat('停',1,'h'),beat('放',3,'i')] },
  { name:'面拉', muscle:'背', type:'reps', notes:'弹力带固定眼前高度，肘外展向面部方向拉。', cue:'肘打开，拉向脸', target:15, tempoPhases:[beat('拉',2,'e'),beat('停',1,'h'),beat('放',2,'i')] },
  { name:'毛巾门框划船', muscle:'背', type:'reps', notes:'毛巾固定门把，身体后倾，肘向后拉夹背。', cue:'先确认门稳', target:12, tempoPhases:[beat('拉',2,'e'),beat('停',1,'h'),beat('放',3,'i')] },
  { name:'俯卧 Y-T-W', muscle:'背', type:'reps', notes:'俯身，双臂依次摆成 Y、T、W 形，收紧上背。', cue:'肩胛夹紧，别耸肩', target:12, tempoPhases:[beat('展',2,'e'),beat('停',1,'h'),beat('收',2,'i')] },
  { name:'超人式', muscle:'背', type:'reps', notes:'俯卧，手脚同时抬起，顶峰停两秒再落下。', cue:'慢起慢落，别弹', target:12, tempoPhases:[beat('抬',2,'e'),beat('停',2,'h'),beat('落',2,'i')] },
  { name:'平板支撑', muscle:'核心', type:'time', notes:'肘撑地，身体成直线，收腹夹臀，均匀呼吸。', cue:'收腹夹臀，腰别塌', target:40, tempoPhases:[beat('稳',4,'h'),beat('吸',3,'i'),beat('呼',3,'e')] },
  { name:'侧平板支撑', muscle:'核心', type:'side', leftRight:true, notes:'侧身肘撑，髋部抬起成直线，不前后倒。', cue:'髋顶起来，别下沉', target:3, tempoPhases:[beat('稳',4,'h'),beat('吸',3,'i'),beat('呼',3,'e')] },
  { name:'死虫式', muscle:'核心', type:'reps', notes:'仰卧，对侧手脚缓慢伸展，腰部始终贴地。', cue:'腰贴地，慢伸', target:12, tempoPhases:[beat('伸',2,'i'),beat('停',1,'h'),beat('收',2,'e')] },
  { name:'鸟狗式', muscle:'核心', type:'reps', notes:'四点跪姿，对侧手脚伸展，骨盆不晃。', cue:'骨盆摆正，别晃', target:12, tempoPhases:[beat('伸',2,'i'),beat('停',1,'h'),beat('收',2,'e')] },
  { name:'卷腹', muscle:'腰腹', type:'reps', notes:'仰卧屈膝，上背卷起，下巴不贴胸，慢起慢落。', cue:'下巴留空，别拽脖', target:15, tempoPhases:[beat('卷',2,'e'),beat('停',1,'h'),beat('落',2,'i')] },
  { name:'反向卷腹', muscle:'腰腹', type:'reps', notes:'仰卧屈膝，卷骨盆带下背离地，缓慢落下。', cue:'别用惯性', target:12, tempoPhases:[beat('卷',2,'e'),beat('停',1,'h'),beat('落',2,'i')] },
  { name:'仰卧举腿', muscle:'腰腹', type:'reps', notes:'仰卧，双腿伸直缓慢抬起再落下，下背贴地。', cue:'腰贴地，拱了就停', target:12, tempoPhases:[beat('举',2,'e'),beat('停',1,'h'),beat('落',3,'i')] },
  { name:'登山跑（慢速版）', muscle:'全身', type:'reps', notes:'俯撑，手脚交替轻点地，放慢速度保持节奏。', cue:'脚尖轻点，别砸地', target:20, tempoPhases:[beat('点',1,'e'),beat('换',1,'i'),beat('停',1,'h')] },
  { name:'原地高抬腿（静音版）', muscle:'全身', type:'reps', notes:'原地抬腿，前脚掌轻落地，不追求高度。', cue:'前掌落地，要轻', target:20, tempoPhases:[beat('抬',1,'e'),beat('落',1,'i'),beat('停',1,'h')] },
  { name:'开合步', muscle:'全身', type:'reps', notes:'原地开合踏步，脚不腾空，手脚协调配合。', cue:'脚别离地', target:20, tempoPhases:[beat('开',1,'e'),beat('合',1,'i'),beat('停',1,'h')] },
  { name:'影子拳击', muscle:'全身', type:'reps', notes:'轻步伐出拳组合，保持节奏，注意挥臂空间。', cue:'留空间，轻出拳', target:20, tempoPhases:[beat('出',1,'e'),beat('收',1,'i'),beat('停',1,'h')] },
  { name:'爬楼梯', muscle:'全身', type:'time', notes:'匀速上楼，身体略前倾，下楼坐电梯护膝。', cue:'下楼别跑', target:60, tempoPhases:[beat('上',2,'e'),beat('换',1,'i'),beat('停',1,'h')] },
  { name:'开合跳', muscle:'全身', type:'reps', notes:'双脚开合跳，落地屈膝缓冲，节奏均匀。', cue:'落地屈膝，慎扰民', target:20, tempoPhases:[beat('跳',1,'e'),beat('停',1,'h'),beat('落',1,'i')] },
  { name:'波比跳', muscle:'全身', type:'reps', notes:'下蹲撑地，俯身，起身跳起，连贯完成。', cue:'落地缓冲，宾馆别做', target:12, tempoPhases:[beat('蹲',1,'i'),beat('撑',1,'h'),beat('跳',1,'e'),beat('起',1,'e')] },
  { name:'猫牛式', muscle:'其他', type:'reps', notes:'四点跪姿，脊柱逐节屈伸，配合呼吸。', cue:'随呼吸，慢慢来', target:12, tempoPhases:[beat('弓',3,'e'),beat('停',1,'h'),beat('塌',3,'i')] },
  { name:'90/90 髋部旋转', muscle:'其他', type:'reps', notes:'坐姿双腿各成九十度，交替转髋，上身稳定。', cue:'上身别晃', target:12, tempoPhases:[beat('转',2,'e'),beat('停',1,'h'),beat('回',2,'i')] },
  { name:'髋屈肌拉伸', muscle:'腿部', type:'side', leftRight:true, notes:'弓步跪姿，前腿屈膝前推，后侧髋有拉伸感。', cue:'收臀前推，停三十秒', target:3, tempoPhases:[beat('推',3,'e'),beat('停',8,'h'),beat('收',3,'i')] },
  { name:'胸大肌门框拉伸', muscle:'胸', type:'side', leftRight:true, notes:'前臂贴门框，身体缓慢前转，胸前有拉伸感。', cue:'肩下沉，身体前转', target:3, tempoPhases:[beat('转',3,'e'),beat('停',8,'h'),beat('收',3,'i')] },
  { name:'婴儿式', muscle:'其他', type:'time', notes:'跪坐前趴，额头贴地，双臂前伸放松。', cue:'随呼吸，放松背', target:30, tempoPhases:[beat('伏',5,'h'),beat('吸',3,'i'),beat('呼',4,'e')] }
];

// 统一生成默认动作记录：起势缓冲 15 秒、组间休息 40 秒，其余字段按 v1.16 规范
function makePackRecord(s) {
  return {
    id: makeId(),
    name: s.name,
    muscle: s.muscle,
    type: s.type,
    leftRight: Boolean(s.leftRight),
    notes: s.notes,
    cue: s.cue,
    prepSeconds: 15,
    defaultTarget: { sets: 3, target: s.target, weight: 0, restSeconds: 40 },
    tempoPhases: s.tempoPhases,
    videoUrl: '',
    videoBlob: null,
    pureVideo: false,
    createdAt: nowIso(),
    builtIn: true
  };
}

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
let isLongSpeechPlaying = false;
let speechWatchdog = null;
let speechFinish = null;
let speechKeepAlive = null;
// 播报进度监听：安卓 TTS 的 onend 常不触发，用 speaking 状态兜底，避免播报标志卡死导致报数长期排队
let speechProgressTimer = null;
let speechProgressQuiet = 0;
let speechProgressStartAt = 0;

// 备份提醒（持久化）：记录上次导出 JSON 备份的时间戳
const LAST_BACKUP_KEY = 'fitlog-last-backup-at';
const BACKUP_REMIND_DAYS = 7;

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
      if (!database.objectStoreNames.contains('bodyStats')) database.createObjectStore('bodyStats', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('moodNotes')) database.createObjectStore('moodNotes', { keyPath: 'id' });
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

/* ===== 身体数据：主界面卡片、跑步打卡、AI 分享三处共用同一份数据 ===== */
async function getBodyStatsList() {
  const list = await getAll('bodyStats');
  return list.sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
}

// 取当前有效值：某一项为空时，继续找上一条非空记录（跑步打卡可能只填体重）
async function getCurrentBody() {
  const list = await getBodyStatsList();
  return {
    height: list.find(r => Number(r.height) > 0)?.height ?? null,
    weight: list.find(r => Number(r.weight) > 0)?.weight ?? null,
    updatedAt: list[0]?.recordedAt || null,
    list
  };
}

async function saveBodyStats({ height, weight, source = 'manual', recordedAt } = {}) {
  const h = Number(height);
  const w = Number(weight);
  if (!Number.isFinite(h) && !Number.isFinite(w)) return null;
  const record = {
    id: makeId(),
    height: Number.isFinite(h) && h > 0 ? h : null,
    weight: Number.isFinite(w) && w > 0 ? w : null,
    source,
    recordedAt: recordedAt || nowIso()
  };
  await put('bodyStats', record);
  return record;
}

/* ===== 心情 / 训练状态记录 ===== */
const MOOD_EXPORT_KEY = 'fitlog-mood-include-export';

function moodExportIncluded() {
  try { return localStorage.getItem(MOOD_EXPORT_KEY) === '1'; } catch (_) { return false; }
}

function setMoodExportIncluded(enabled) {
  try { localStorage.setItem(MOOD_EXPORT_KEY, enabled ? '1' : '0'); } catch (_) {}
}

async function getMoodNotes() {
  const list = await getAll('moodNotes');
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function saveMoodNoteFromDialog() {
  const input = $('moodText');
  const content = (input?.value || '').trim();
  if (!content) { showToast('写点内容再保存吧'); return; }
  await put('moodNotes', { id: makeId(), content, createdAt: nowIso() });
  input.value = '';
  closeDialog('moodDialog');
  showToast('已保存，返回主界面');
}

async function renderMoodHistory() {
  const notes = await getMoodNotes();
  const list = $('moodHistoryList');
  if (!list) return;
  list.innerHTML = notes.length
    ? notes.map(n => `<article class="item-card"><div class="session-date">${escapeHtml(dateLabel(n.createdAt))}</div><div class="session-exercises">${escapeHtml(n.content)}</div><div class="card-actions"><button class="small-btn danger-text" data-mood-delete="${escapeHtml(n.id)}">删除</button></div></article>`).join('')
    : '<div class="list-card empty-state">还没有心情记录。</div>';
}

async function openMoodDialog() {
  const toggle = $('moodExportToggle');
  if (toggle) toggle.checked = moodExportIncluded();
  openDialog('moodDialog');
}

async function exportMoodNotes() {
  const notes = await getMoodNotes();
  if (!notes.length) { showToast('还没有心情记录可导出'); return; }
  const rows = [['记录时间', '心情/训练状态记录'], ...notes.map(n => [dateLabel(n.createdAt), n.content])];
  downloadFile(`fitlog-mood-${new Date().toISOString().slice(0, 10)}.csv`, '\uFEFF' + csvSerialize(rows), 'text/csv;charset=utf-8');
  showToast('心情记录CSV已导出到下载文件夹');
}

function showToast(message) {
  const toast = $('toast');
  // 原生 dialog 处于浏览器顶层(top layer)，普通 z-index 无法盖住它。
  // 若有打开的弹窗，把提示临时挂到该弹窗内部，确保提示显示在画面最前面。
  const openDialog = document.querySelector('dialog[open]');
  const host = openDialog || document.body;
  if (toast.parentElement !== host) host.appendChild(toast);
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

// 把长要领按中文标点拆成短句，降低安卓长文本 TTS 被系统回收的概率
function splitIntoSentences(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  const parts = [];
  let buf = '';
  for (const ch of s) {
    buf += ch;
    if ('。！？!?；;'.includes(ch)) { parts.push(buf.trim()); buf = ''; }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.length ? parts : [s];
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
  if (speechProgressTimer) clearInterval(speechProgressTimer);
  speechProgressTimer = null;
  speechProgressQuiet = 0;
  speechQueue.length = 0;
  isSpeaking = false;
  isLongSpeechPlaying = false;
}

// kind: info=长句说明 / count=报数 / key=关键提示
// 保护式队列（方案A）：长句(key/info)正在播时，报数(count)不打断，只入队等长句播完再补播
function speak(text, interrupt = false, kind = 'info') {
  if (!text) return;
  const str = String(text);
  // 语音模式过滤：beep 完全不说话，count 只说报数与关键提示
  if (voiceSettings.mode === 'beep') return;
  if (voiceSettings.mode === 'count' && kind === 'info') return;

  // 长句（动作要领/专属播报）正在播时，报数照常排队但按正常间隔补播，
  // 既不丢数字（不跳号），也不会一次性快速吐出（不连读）。只保留最近 4 个避免严重滞后。
  if (kind === 'count' && isLongSpeechPlaying) {
    speechQueue.push({ text: str, kind });
    trimDeferredCounts();
    return;
  }
  // 长句之间才允许打断旧的；报数永不打断当前播报
  if (interrupt && kind !== 'count') cancelSpeech();
  speechQueue.push({ text: str, kind });
  trimSpeechQueue();
  processSpeechQueue();
}

// 队列过长时优先丢弃最旧的普通说明，其次关键提示，尽量保住报数
function trimSpeechQueue() {
  while (speechQueue.length > 10) {
    let idx = speechQueue.findIndex(q => q.kind === 'info');
    if (idx < 0) idx = speechQueue.findIndex(q => q.kind === 'key');
    if (idx < 0) idx = 0;
    speechQueue.splice(idx, 1);
  }
}

// 播报期间积压的报数只保留「最新一个」：它最接近当前真实进度。
// 播报一结束立刻补报这个数，然后跟上动作节奏——既不连读（无积压串），
// 也不会报出过时的旧数字。重复的旧数直接丢弃。
function trimDeferredCounts() {
  const counts = speechQueue.filter(q => q.kind === 'count');
  if (counts.length > 1) {
    const keep = counts[counts.length - 1];
    let seen = false;
    for (let i = speechQueue.length - 1; i >= 0; i--) {
      if (speechQueue[i].kind !== 'count') continue;
      if (speechQueue[i] === keep && !seen) { seen = true; continue; }
      speechQueue.splice(i, 1);
    }
  }
}

// 用 speaking 状态兜底检测播报是否真的念完：
// 安卓 TTS 的 onend 经常不触发，若只靠 watchdog（最长 30 秒），播报标志会卡死，
// 期间报数一直排队，播报念完后才集中吐出 → 就是「等很久才连读」的根因。
function startSpeechProgressWatch() {
  if (speechProgressTimer) clearInterval(speechProgressTimer);
  speechProgressQuiet = 0;
  speechProgressStartAt = Date.now();
  speechProgressTimer = setInterval(() => {
    // 启动保护期 900ms：安卓 TTS 真正开口前 speaking 会短暂为 false，避免误判念完
    if (Date.now() - speechProgressStartAt < 900) return;
    let active = false;
    try { active = !!(window.speechSynthesis.speaking || window.speechSynthesis.pending); } catch (_) {}
    if (!active) {
      speechProgressQuiet += 1;
      // 连续 ~300ms 空闲即判定本句念完，主动结束，让排队的报数立刻接上
      if (speechProgressQuiet >= 3 && speechFinish) speechFinish();
    } else {
      speechProgressQuiet = 0;
    }
  }, 100);
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
    if (speechProgressTimer) clearInterval(speechProgressTimer);
    speechProgressTimer = null;
    speechProgressQuiet = 0;
    speechFinish = null;
    isSpeaking = false;
    isLongSpeechPlaying = false;
    if (speechKeepAlive) clearInterval(speechKeepAlive);
    speechKeepAlive = null;
    // 衔接间隔：长句→报数、报数→报数都保持正常报数节奏，数字不挤在一起；
    // 播报期间只留了最新一个报数，所以这里不会有「一串旧数字」连读。
    const nextIsCount = speechQueue.length && speechQueue[0].kind === 'count';
    let gap = 90;
    if (nextIsCount) gap = item.kind === 'count' ? 380 : 220;
    setTimeout(processSpeechQueue, gap);
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
  isLongSpeechPlaying = item.kind !== 'count';
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

  // watchdog 只作最终兜底；真正结束由 onend 或 speaking 进度监听提前判定
  const estimatedMs = item.kind === 'count'
    ? Math.min(5000, 1200 + text.length * 300)
    : Math.min(30000, 3000 + text.length * 420);
  speechWatchdog = setTimeout(() => {
    try { window.speechSynthesis.cancel(); } catch (_) {}
    if (speechFinish) speechFinish();
  }, estimatedMs);

  try {
    window.speechSynthesis.speak(utterance);
    // 启动进度监听：安卓 onend 不触发时，靠 speaking 状态判定念完，
    // 避免播报标志长时间卡住、报数一直排队（「等很久才报」的根因）
    startSpeechProgressWatch();
  } catch (_) { finish(); }
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    getAllVoices();
    voicesLoaded = true;
    refreshVoiceSelect();
  };
}

/* ===================== 视频声音清理 ===================== */
// 纯视频跟练：进入正式跟练时请求全屏。
// 注意：多种方式都要尝试，旧版在 webkitEnterFullscreen 存在时直接 return，
// 导致安卓上这个方法静默失败时不再走标准的 requestFullscreen，全屏就没生效。
function isVideoFullscreen(videoEl) {
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) return true;
    if (videoEl && videoEl.webkitDisplayingFullscreen) return true;
  } catch (_) {}
  return false;
}
function enterVideoFullscreen(videoEl) {
  if (!videoEl) return;
  if (isVideoFullscreen(videoEl)) return;
  // 方式一：视频原生全屏（iOS Safari / 部分安卓 WebView，对 video 元素最有效）
  try {
    if (typeof videoEl.webkitEnterFullscreen === 'function') videoEl.webkitEnterFullscreen();
  } catch (_) {}
  // 方式二：标准全屏 API（安卓 Chrome 主用），不因方式一失败而跳过
  try {
    if (!isVideoFullscreen(videoEl) && typeof videoEl.requestFullscreen === 'function') {
      const p = videoEl.requestFullscreen();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  } catch (_) {}
  // 方式三：ms 前缀兼容
  try {
    if (!isVideoFullscreen(videoEl) && typeof videoEl.msRequestFullscreen === 'function') {
      videoEl.msRequestFullscreen();
    }
  } catch (_) {}
}

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

// 首次安装：直接播种 45 个默认动作
async function seedData() {
  const exercises = await getAll('exercises');
  if (exercises.length) return;
  for (const s of DEFAULT_ACTION_PACK) await put('exercises', makePackRecord(s));
}

// 老用户升级：按动作名补齐缺失的默认动作，绝不覆盖用户已有动作（含用户改过的同名动作）
async function migrateActionPack() {
  const META_KEY = 'default-action-pack-v18';
  const metaList = await getAll('meta');
  if (metaList.find(m => m.key === META_KEY)) return;
  const exercises = await getAll('exercises');
  const existingNames = new Set(exercises.map(e => e.name));
  let added = 0;
  for (const s of DEFAULT_ACTION_PACK) {
    if (existingNames.has(s.name)) continue;
    await put('exercises', makePackRecord(s));
    added += 1;
  }
  await put('meta', { key: META_KEY, value: { at: nowIso(), added } });
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
  await renderBodyCard();
  const recent = $('recentSessions');
  if (!sessions.length) {
    recent.className = 'list-card empty-state';
    recent.textContent = '还没有训练记录，完成第一次训练后会显示在这里。';
    return;
  }
  recent.className = 'stack-list';
  recent.innerHTML = sessions.slice(0, 3).map(sessionCardHtml).join('');
}

/* ===== 身高体重卡片 / 体重曲线 ===== */
function weightPointsFrom(list, days = 0) {
  const cutoff = days ? Date.now() - days * 86400000 : 0;
  return list
    .filter(r => Number(r.weight) > 0 && new Date(r.recordedAt).getTime() >= cutoff)
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt))
    .map(r => ({ label: dateLabel(r.recordedAt), value: Number(r.weight), date: r.recordedAt }));
}

function buildWeightSvg(points, withDates = false) {
  const valid = points.filter(p => Number(p.value) > 0);
  if (!valid.length) return '<div class="empty-state" style="padding:16px 6px">还没有体重记录，点「更新」添加第一条。</div>';
  const w = 340;
  const h = withDates ? 175 : 68;
  const padL = 32, padR = 12, padT = 12, padB = withDates ? 26 : 10;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const values = valid.map(p => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 2) {
    const mid = (max + min) / 2;
    min = mid - 1;
    max = mid + 1;
  } else {
    min -= 0.6;
    max += 0.6;
  }
  const coords = valid.map((p, idx) => ({
    ...p,
    x: valid.length === 1 ? padL + plotW / 2 : padL + (idx / (valid.length - 1)) * plotW,
    y: padT + plotH - ((p.value - min) / (max - min)) * plotH
  }));
  const line = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `${padL},${padT + plotH} ${line} ${coords[coords.length - 1].x.toFixed(1)},${padT + plotH}`;
  const grid = [max, (max + min) / 2, min].map((v, i) => {
    const y = padT + (i / 2) * plotH;
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-dasharray="3 3"></line><text x="${padL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#94a3b8">${v.toFixed(1)}</text>`;
  }).join('');
  const dots = coords.map(c => `
    <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3" fill="#2864dc"></circle>
    ${withDates ? `<text x="${c.x.toFixed(1)}" y="${(c.y - 7).toFixed(1)}" text-anchor="middle" font-size="9" fill="#1e293b">${c.value}</text><text x="${c.x.toFixed(1)}" y="${h - 7}" text-anchor="middle" font-size="9" fill="#64748b">${escapeHtml(c.label)}</text>` : ''}
  `).join('');
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="体重曲线">${grid}${valid.length > 1 ? `<polygon points="${area}" fill="#dbeafe" opacity="0.5"></polygon><polyline points="${line}" fill="none" stroke="#2864dc" stroke-width="2" stroke-linejoin="round"></polyline>` : ''}${dots}</svg>`;
}

const fmtBodyNum = value => value == null ? '—' : String(Number(value).toFixed(1)).replace(/\.0$/, '');

async function renderBodyCard() {
  const body = await getCurrentBody();
  if ($('bodyHeightVal')) $('bodyHeightVal').textContent = fmtBodyNum(body.height);
  if ($('bodyWeightVal')) $('bodyWeightVal').textContent = fmtBodyNum(body.weight);
  if ($('homeWeightChart')) $('homeWeightChart').innerHTML = buildWeightSvg(weightPointsFrom(body.list, 30), false);
}

async function openBodyStatsDialog() {
  const body = await getCurrentBody();
  $('inputHeight').value = body.height ?? '';
  $('inputWeight').value = body.weight ?? '';
  openDialog('bodyStatsDialog');
}

async function saveBodyStatsFromDialog() {
  const height = $('inputHeight').value.trim();
  const weight = $('inputWeight').value.trim();
  if (!height && !weight) { showToast('请至少填写身高或体重'); return; }
  await saveBodyStats({ height: height || null, weight: weight || null, source: 'manual' });
  closeDialog('bodyStatsDialog');
  showToast('身高体重已保存');
  await renderBodyCard();
  if (currentPage === 'data') await updateStorageStatus();
}

async function openBodyDetailDialog() {
  const body = await getCurrentBody();
  const points = weightPointsFrom(body.list);
  $('bodyDetailChart').innerHTML = buildWeightSvg(points, true);
  const rows = body.list.slice(0, 60).map(r => `<div style="margin-top:5px"><b>${escapeHtml(dateLabel(r.recordedAt))}</b> · 身高 ${fmtBodyNum(r.height)}cm · 体重 ${fmtBodyNum(r.weight)}kg${r.source === 'run' ? '（跑步打卡同步）' : ''}</div>`).join('');
  $('bodyDetailList').innerHTML = `<b>历史记录（共 ${body.list.length} 条）</b><br>${rows || '暂无记录'}`;
  openDialog('bodyDetailDialog');
}

const fmtPlainNum = value => value == null || value === '' ? '—' : String(Number(value));

function sessionCardHtml(s) {
  const actions = `<div class="card-actions"><button class="small-btn" data-session-detail="${escapeHtml(s.id)}">查看详情</button><button class="small-btn danger-text" data-session-delete="${escapeHtml(s.id)}">删除记录</button></div>`;
  if (s.kind === 'checkin') {
    const c = s.checkin || {};
    const mins = fmtPlainNum(c.minutes ?? Math.round((s.durationSeconds || 0) / 60));
    const meta = s.checkinType === 'run'
      ? `${mins} 分钟 · ${fmtPlainNum(c.distanceKm)} 公里${c.heartRate ? ` · 心率 ${c.heartRate}` : ''}`
      : `${fmtPlainNum(c.sets)} 组 × ${fmtPlainNum(c.reps)} 次 · ${mins} 分钟`;
    const detail = s.checkinType === 'run'
      ? `身高 ${fmtBodyNum(c.height)}cm · 体重 ${fmtBodyNum(c.weight)}kg`
      : escapeHtml(c.note || '自定义运动打卡');
    return `<article class="item-card"><div class="session-date">${escapeHtml(dateLabel(s.startedAt))} <span class="tag">打卡</span></div><div class="session-title">${escapeHtml(s.planName || '运动打卡')}</div><div class="session-meta">${meta}</div><div class="session-exercises">${detail}</div>${actions}</article>`;
  }
  const names = (s.exercises || []).map(e => e.name).join('、');
  return `<article class="item-card"><div class="session-date">${escapeHtml(dateLabel(s.startedAt))}</div><div class="session-title">${escapeHtml(s.planName || '自由训练')}</div><div class="session-meta">${Math.round((s.durationSeconds || 0) / 60)} 分钟 · ${(s.exercises || []).length} 个动作</div><div class="session-exercises">${escapeHtml(names || '无动作明细')}</div>${actions}</article>`;
}

/* ===== 运动打卡 ===== */
async function openCheckinDialog() {
  const body = await getCurrentBody();
  $('checkinHeight').value = body.height ?? '';
  $('checkinWeight').value = body.weight ?? '';
  $('checkinType').value = 'run';
  toggleCheckinFields();
  openDialog('checkinDialog');
}

function toggleCheckinFields() {
  const isRun = $('checkinType').value === 'run';
  $('checkinRunFields').classList.toggle('hidden', !isRun);
  $('checkinOtherFields').classList.toggle('hidden', isRun);
}

async function saveCheckin() {
  const type = $('checkinType').value;
  const stamped = nowIso();
  const session = { id: makeId(), kind: 'checkin', checkinType: type, startedAt: stamped, endedAt: stamped, exercises: [] };

  if (type === 'run') {
    const minutes = Number($('checkinMinutes').value);
    const distance = Number($('checkinDistance').value);
    if (!(minutes > 0)) { showToast('请填写跑步时间'); return; }
    if (!(distance > 0)) { showToast('请填写跑步距离'); return; }
    const height = $('checkinHeight').value.trim();
    const weight = $('checkinWeight').value.trim();
    const heartRate = $('checkinHeartRate').value.trim();
    if (height || weight) await saveBodyStats({ height: height || null, weight: weight || null, source: 'run' });
    session.planName = '跑步打卡';
    session.durationSeconds = Math.round(minutes * 60);
    session.checkin = {
      minutes,
      distanceKm: distance,
      height: height ? Number(height) : null,
      weight: weight ? Number(weight) : null,
      heartRate: heartRate ? Number(heartRate) : null
    };
  } else {
    const name = $('checkinName').value.trim();
    if (!name) { showToast('请填写运动名称'); return; }
    const sets = clampInt($('checkinSets').value, 1, 99, 3);
    const reps = clampInt($('checkinReps').value, 1, 9999, 20);
    const minutes = Math.max(0, Number($('checkinDurationMin').value) || 0);
    const weightKg = Math.max(0, Number($('checkinWeightKg').value) || 0);
    const note = $('checkinNote').value.trim();
    session.planName = name;
    session.durationSeconds = Math.round(minutes * 60);
    session.checkin = { name, sets, reps, minutes, weightKg, note };
  }

  await put('sessions', session);
  closeDialog('checkinDialog');
  showToast('打卡已保存到运动记录');
  await renderHome();
  if (currentPage === 'history') await renderHistory();
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
  const statsBox = $('videoStatsBox');
  if (statsBox) statsBox.classList.toggle('hidden', !isPure);
  // 纯视频默认 10 秒、普通默认 5 秒；仅当当前仍是另一模式的默认值时才自动切换
  const prepEl = $('exPrepSeconds');
  if (prepEl) {
    const v = clampInt(prepEl.value, 0, 30, 5);
    if (isPure && v === 5) prepEl.value = 10;
    else if (!isPure && v === 10) prepEl.value = 5;
  }
  const ids = [
    'exerciseType', 'exerciseLeftRight', 'exDefaultSets', 'exDefaultTarget', 'exDefaultWeight',
    'exDefaultRest', 'tempoPresetSelect', 'addTempoPhaseBtn',
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
  const pureVideo = Boolean(exercise?.pureVideo);
  $('exercisePureVideo').checked = pureVideo;
  $('exPrepSeconds').value = exercise?.prepSeconds ?? (pureVideo ? 10 : 5);
  const vs = exercise?.videoStats || {};
  $('videoStatDuration').value = vs.durationSeconds ?? 300;
  $('videoStatSets').value = vs.sets ?? 3;
  $('videoStatWeightMode').value = vs.weightMode || 'self';
  $('videoStatWeightKg').value = vs.weightKg ?? 0;
  $('videoStatNote').value = vs.note || '';
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
    videoStats: $('exercisePureVideo')?.checked ? {
      durationSeconds: clampInt($('videoStatDuration').value, 1, 7200, 300),
      sets: clampInt($('videoStatSets').value, 1, 20, 3),
      weightMode: $('videoStatWeightMode').value === 'weighted' ? 'weighted' : 'self',
      weightKg: Math.max(0, Number($('videoStatWeightKg').value) || 0),
      note: $('videoStatNote').value.trim()
    } : null,
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
      <div class="detail-line"><b>模式：</b>${exercise.pureVideo ? '纯视频跟练（记录时长与负重）' : `${typeLabel(exercise.type)} · 常规训练`}</div>
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
              <button type="button" class="mini-op-btn" data-add-again="${idx}" title="在课程中再安排一次该动作">+1次</button>
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
  const prepSec = clampInt(firstEx.prepSeconds, 0, 30, firstPure ? 10 : 5);
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
    phase: prepSec > 0 ? 'prepare' : (firstPure ? 'video' : 'work'),
    remaining: prepSec > 0 ? prepSec : 0,
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

  // 纯视频跟练：准备倒计时结束后直接进入视频，不播报多余语音，自动播放并尝试全屏
  if (exercise.pureVideo && runner.phase === 'video') {
    runner.tempoIndex = 0;
    runner.completedRepsInSet = 0;
    renderRunner();
    const videoEl = $('runnerVideo');
    if (videoEl) {
      videoEl.onended = () => {
        if (runner && runner.phase === 'video') advanceRunner();
      };
      // 正式跟练阶段取消静音，确保视频有声音
      videoEl.muted = false;
      // 视频真正开始播放时（已有用户手势上下文）再尝试全屏，成功率最高
      videoEl.addEventListener('playing', () => {
        enterVideoFullscreen(videoEl);
        setTimeout(() => enterVideoFullscreen(videoEl), 200);
        setTimeout(() => enterVideoFullscreen(videoEl), 600);
      }, { once: true });
      // 点击视频本身也可进入全屏（浏览器拒绝自动全屏时的兜底）
      videoEl.addEventListener('click', () => enterVideoFullscreen(videoEl));
      videoEl.play().then(() => {
        enterVideoFullscreen(videoEl);
        setTimeout(() => enterVideoFullscreen(videoEl), 350);
      }).catch(() => showToast('若视频未自动播放，请点视频上的播放按钮'));
    } else {
      showToast('该纯视频动作没有视频，已自动跳过');
      setTimeout(() => {
        if (runner && runner.phase === 'video') advanceRunner();
      }, 900);
    }
    return;
  }

  // 起势准备缓冲（纯视频动作同样适用，默认 10 秒）
  if (runner.phase === 'prepare') {
    const prepSec = clampInt(exercise.prepSeconds, 0, 30, exercise.pureVideo ? 10 : 5);
    runner.remaining = prepSec;
    runner.completedRepsInSet = 0;
    runner.leftDone = null;
    runner.rightDone = null;
    if (split) { runner.sideStage = 'left'; runner.enterSideRight = false; }
    else runner.sideStage = null;
    // 起势准备阶段只念一次「动作要领」（notes，缺省时用 cue），并先清空旧队列。
    // 不再播计划名/动作名/组数等冗长开场，避免要领被拖到进入动作之后才念；
    // 次数型与计时型统一在此念要领，进入动作后一律直接报数，不再念长句。
    cancelSpeech();
    const leadText = (exercise.notes || exercise.cue || '').trim();
    const leadParts = splitIntoSentences(leadText);
    if (leadParts.length) {
      // 逐句播（每句独立入队），避免单条超长文本被安卓系统回收、中途“没声音”
      leadParts.forEach((part, idx) => speak(part, idx === 0, 'key'));
    }
    renderRunner();
    startCountdownLoop('prepare');
  } else if (runner.phase === 'work') {
    // 进入动作前清空准备阶段残留的要领队列，保证动作一开始就直接报 1、2、3
    cancelSpeech();
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
      // 非左右侧：开场与要领已在准备阶段播完，这里直接报数 1、2、3
      startTempoPhase(0);
    } else {
      // 计时型动作同理：要领已在准备阶段播完，仅左右侧需要提示侧别
      if (split) speak(`${sideName}，第${runner.setIndex}组，开始计时。`, true, 'key');
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

// 更新页面最下方的大倒计时数字
function updateTempoNumber() {
  const item = runner ? currentRunnerItem() : null;
  // 计时型显示累计秒数，次数型显示当前节拍剩余秒
  const val = item?.exercise?.type === 'time'
    ? Math.max(0, runner?.elapsedSec || 0)
    : Math.max(0, runner?.tempoSecLeft || 0);
  const main = $('runnerNumber');
  if (main) main.textContent = val;
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
  // 计时型动作带节拍时按真实秒数计时，而不是按节拍轮数（否则 40 秒会被做成 40 轮）
  const isTimed = exercise.type === 'time';
  const targetSec = isTimed ? Math.max(0, Number(item.target ?? exercise.defaultTarget?.target ?? 0) || 0) : 0;
  if (isTimed && !runner.plainCueFired) runner.plainCueFired = { ten: false, half: false, left: false, done: false, lastCueSec: -1 };

  // 一次动作开始前：只报数字，不说“第几个”（计时型不报数）
  if (!isTimed && phaseIdx === 0) {
    const nextNum = runner.completedRepsInSet + 1;
    speak(String(nextNum), true, 'count');
    // 第 3 次、之后每完成 5 次插播专属语音播报（数字滴声之后播）：完成数 = 3、8、13…
    // 例如做了 8 个，报数 9 的滴声之后播一次；总次数自动取动作默认目标参数
    const rawTarget = Number(item.target ?? exercise.defaultTarget?.target);
    const totalTarget = Number.isFinite(rawTarget) && rawTarget > 0 ? rawTarget : 0;
    const cueText = (exercise.cue || '').trim();
    const done = runner.completedRepsInSet;
    if (cueText && done >= 3 && (done - 3) % 5 === 0
        && (!totalTarget || done < totalTarget)) {
      speak(cueText, false, 'key');
    }
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

    // 计时型：按真实秒数累计，并复用计时播报（10 秒 / 过半 / 最后 10 秒 / 到点）
    if (isTimed) {
      runner.elapsedSec = (runner.elapsedSec || 0) + 1;
      const sec = runner.elapsedSec;
      const numEl = $('runnerNumber');
      if (numEl) numEl.textContent = sec;
      if (targetSec >= 2 && runner.plainCueFired) {
        const fired = runner.plainCueFired;
        const cueText = (exercise.cue || '').trim();
        const halfSec = Math.floor(targetSec / 2);
        const playCueOnce = () => { if (fired.lastCueSec !== sec) { fired.lastCueSec = sec; speak(cueText, false, 'key'); } };
        if (cueText && sec >= 10 && !fired.ten && 10 < targetSec) { fired.ten = true; playCueOnce(); }
        if (cueText && halfSec >= 2 && sec >= halfSec && !fired.half) { fired.half = true; playCueOnce(); }
        if (targetSec > 10 && sec >= targetSec - 10 && !fired.left) { fired.left = true; speak('最后10秒，坚持住', false, 'key'); }
        if (!fired.done && sec >= targetSec) {
          fired.done = true;
          stopRunnerTimer();
          speak('时间到，本组完成', false, 'key');
          onSideOrSetComplete();
          return;
        }
      }
    }

    if (runner.tempoSecLeft > 0) return;

    const nextIdx = runner.tempoIndex + 1;
    if (nextIdx < phases.length) {
      startTempoPhase(nextIdx);
    } else {
      // 一轮节拍走完
      if (isTimed) {
        // 计时型：一轮节拍结束后继续下一轮，直到累计秒数到达目标（到点不自动结束，保持手动确认）
        startTempoPhase(0);
        return;
      }
      // 次数型：一轮节拍走完 = 完成一次
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
  const isTimed = exercise.type === 'time';
  const doneValue = isTimed ? Math.max(0, runner.elapsedSec || 0) : runner.completedRepsInSet;
  if (!isTimed) speak(String(doneValue), true, 'count');

  if (isSplitSide(exercise)) {
    if (runner.sideStage === 'left') {
      runner.leftDone = doneValue;
      beginSideSwitch();
      return;
    }
    runner.rightDone = doneValue;
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

// 无节拍计时型动作（如平板支撑）：每秒滴一声，按时间节点插播语音
function startPlainTickLoop() {
  stopRunnerTimer();
  if (!runner || runner.phase !== 'work') return;
  const item = currentRunnerItem();
  const exercise = item?.exercise;
  const targetSec = Math.max(0, Number(item?.target ?? exercise?.defaultTarget?.target ?? 0) || 0);
  // 动作要领已在起势准备阶段念完；这里只播「专属语音播报」内容，不再混入 notes 或重复播
  const cueText = (exercise?.cue || '').trim();
  const isTimed = exercise?.type === 'time';

  runner.elapsedSec = 0;
  runner.plainCueFired = { ten: false, half: false, left: false, done: false, lastCueSec: -1 };

  timerHandle = setInterval(() => {
    if (!runner || runner.phase !== 'work') { stopRunnerTimer(); return; }
    runner.elapsedSec = (runner.elapsedSec || 0) + 1;
    playTickCue();
    const sec = runner.elapsedSec;
    const numEl = $('runnerNumber');
    if (numEl) numEl.textContent = sec;

    if (!isTimed || targetSec < 2) return;
    const fired = runner.plainCueFired;
    const halfSec = Math.floor(targetSec / 2);

    // 10 秒节点、过半节点：各播一次专属语音播报内容（同一秒只播一次，避免重复）
    const playCueOnce = () => { if (fired.lastCueSec !== sec) { fired.lastCueSec = sec; speak(cueText, false, 'key'); } };
    if (cueText && sec >= 10 && !fired.ten && 10 < targetSec) {
      fired.ten = true;
      playCueOnce();
    }
    if (cueText && halfSec >= 2 && sec >= halfSec && !fired.half) {
      fired.half = true;
      playCueOnce();
    }
    // 剩 10 秒：播「最后10秒，坚持住」
    if (targetSec > 10 && sec >= targetSec - 10 && !fired.left) {
      fired.left = true;
      speak('最后10秒，坚持住', false, 'key');
    }
    // 到点：提示可完成本组（不自动结束，保持手动流程）
    if (!fired.done && sec >= targetSec) {
      fired.done = true;
      speak('时间到，做得好，可以点完成本组了', false, 'key');
    }
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
        const curEx = currentRunnerItem()?.exercise;
        runner.phase = curEx?.pureVideo ? 'video' : 'work';
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
  // 纯视频在「起势准备」阶段保持静音，只做预览；进入正式跟练（video 阶段）时再解除静音
  const pureVideoMuted = isPureVideo && runner.phase === 'prepare' ? ' muted' : '';
  const videoHtml = videoSrc
    ? isPureVideo
      ? `<video id="runnerVideo" class="runner-video" src="${escapeHtml(videoSrc)}" autoplay${pureVideoMuted} playsinline controls></video>`
      : `<video id="runnerVideo" class="runner-video" src="${escapeHtml(videoSrc)}" autoplay loop muted playsinline controls></video>`
    : '';

  const hasTempo = Array.isArray(exercise.tempoPhases) && exercise.tempoPhases.length > 0;
  const currentPhase = hasTempo ? exercise.tempoPhases[runner.tempoIndex] : null;
  const split = isSplitSide(exercise);
  const sideBadge = split
    ? `<span class="side-badge">${runner.sideStage === 'right' ? '右侧' : '左侧'}</span>`
    : '';

  // 工作阶段（有节拍）：彩色圆内只放节拍描述汉字；倒计时与暂停/停止放到页面最下方
  let centerHtml = '';
  if (runner.phase === 'work' && currentPhase) {
    const color = /^#[0-9a-f]{6}$/i.test(currentPhase.color || '') ? currentPhase.color : PHASE_COLOR.other;
    const descText = currentPhase.label || '跟练';
    centerHtml = `
      <div class="phase-circle" style="background:${color}">
        <div class="phase-circle-label">${escapeHtml(descText)}</div>
      </div>
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

  // 工作阶段有节拍：页面最下方 = 已完成次数 + 大号黑色倒计时 + 暂停/继续（黄）+ 停止（红）
  let workBottomHtml = '';
  if (runner.phase === 'work' && currentPhase) {
    workBottomHtml = `
      <div class="work-bottom">
        <div class="reps-progress">${exercise.type === 'time' ? `已计时 <b id="repsDone">${runner.elapsedSec || 0}</b> / ${item.target || exercise.defaultTarget?.target || '—'} 秒` : `已完成 <b id="repsDone">${runner.completedRepsInSet}</b> / ${item.target || exercise.defaultTarget?.target || '—'} 次`}${split ? ` · ${runner.sideStage === 'right' ? '右侧' : '左侧'}` : ''}</div>
        <div class="work-countdown-row">
          <button type="button" class="cd-side-btn cd-pause" id="workPauseBtn" title="暂停/继续">⏸</button>
          <div class="runner-number" id="runnerNumber">${Math.max(0, runner.tempoSecLeft)}</div>
          <button type="button" class="cd-side-btn cd-stop" id="workStopBtn" title="结束训练">⏹</button>
        </div>
      </div>
    `;
  }

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
    <div class="runner-kicker">动作 ${runner.index + 1} / ${runner.items.length} · ${isPureVideo ? `纯视频跟练 · 第 ${runner.setIndex} / ${item.sets} 组（记录时长）` : `第 ${runner.setIndex} / ${item.sets} 组（目标 ${item.target}${exercise.type === 'time' ? '秒' : '次'}）`}</div>
    <h2>${sideBadge}${escapeHtml(exercise.name)}</h2>
    ${(exercise.notes || exercise.cue) ? `<p class="runner-cue">💡 ${escapeHtml(exercise.notes || exercise.cue)}</p>` : ''}
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
    ${workBottomHtml}
    ${runner.phase === 'prepare'
      ? `<div class="runner-controls"><button class="alt" id="skipPrepareBtn">立即开始</button></div>`
      : runner.phase === 'video'
        ? `<div class="runner-controls"><button class="alt" id="replayVideoBtn">重播视频</button><button class="alt" id="fullscreenVideoBtn">⛶ 全屏</button><button class="main" id="nextVideoBtn">下一个动作</button></div>`
        : runner.phase === 'rest'
          ? `<div class="runner-controls"><button class="alt" id="skipRestBtn">跳过休息</button><button class="main" id="pauseRestBtn">暂停计时</button></div>`
          : runner.phase === 'done'
            ? `<div class="runner-controls"><button class="main" id="finishSessionBtn">保存并结束</button></div>`
            : ''
    }
  `;

  // 顶部右上角「重播提示」按钮（原底部重播提示已移至此，所有阶段可用）
  const cueBtn = $('runnerCueBtn');
  if (cueBtn) cueBtn.onclick = () => speak(exercise.cue || exercise.notes || exercise.name, true, 'key');

  if (runner.phase === 'prepare') {
    $('skipPrepareBtn').onclick = () => {
      runner.phase = exercise.pureVideo ? 'video' : 'work';
      setupRunnerPhase(false);
    };
  } else if (runner.phase === 'work') {
    if ($('completeSetBtn')) $('completeSetBtn').onclick = completeSet;
    // 底部大倒计时两侧的暂停/继续、停止按钮（顶部按钮已取消）
    if ($('workPauseBtn')) {
      $('workPauseBtn').textContent = runner.paused ? '▶' : '⏸';
      $('workPauseBtn').title = runner.paused ? '继续训练' : '暂停训练';
      $('workPauseBtn').onclick = () => {
        if (runner.paused) resumeRunner(); else pauseRunner();
        $('workPauseBtn').textContent = runner.paused ? '▶' : '⏸';
        $('workPauseBtn').title = runner.paused ? '继续训练' : '暂停训练';
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
    // 「全屏」按钮：在用户点击的同步手势栈里请求视频全屏，成功率最高。
    // 只做视频元素全屏（沉浸铺满），不改动训练流程；安卓返回键可退出全屏。
    const fsBtn = $('fullscreenVideoBtn');
    if (fsBtn) fsBtn.onclick = () => {
      const video = $('runnerVideo');
      if (video) enterVideoFullscreen(video);
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
      mask.innerHTML = `<div class="rpm-card" id="rpmResumeCard" title="点击继续训练"><div class="rpm-icon">▶</div><b>点击继续训练</b><p>点击此图标或底部 ▶ 均可继续</p></div>`;
      // 必须先插入 DOM 再绑定事件；否则 getElementById 取不到，点击会毫无反应
      bodyEl.insertBefore(mask, bodyEl.firstChild);
      const card = mask.querySelector('#rpmResumeCard');
      if (card) card.onclick = () => { if (runner && runner.paused) resumeRunner(); };
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

// 纯视频动作没有“完成本组”按钮，推进到下一动作前补记一组统计（防重复）
function recordPureVideoSetIfNeeded() {
  if (!runner || !runner.session) return;
  const item = currentRunnerItem();
  if (!item || !item.exercise.pureVideo) return;
  if (!Array.isArray(runner._recordedVideoKeys)) runner._recordedVideoKeys = [];
  const key = `${runner.index}-${runner.setIndex}`;
  if (runner._recordedVideoKeys.includes(key)) return;
  runner._recordedVideoKeys.push(key);

  const videoEl = $('runnerVideo');
  const actualSec = videoEl && Number(videoEl.duration) > 0 ? Math.round(videoEl.duration) : null;
  const vs = item.exercise.videoStats || {};
  recordSet(item.exercise, {
    reps: null,
    leftReps: null,
    rightReps: null,
    durationSeconds: actualSec ?? clampInt(vs.durationSeconds, 1, 7200, 300),
    plannedSets: clampInt(vs.sets, 1, 20, 3),
    weightMode: vs.weightMode || 'self',
    weightKg: vs.weightMode === 'weighted' ? Math.max(0, Number(vs.weightKg) || 0) : 0,
    videoNote: vs.note || ''
  });
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
    const nextEx = runner.items[target.index].exercise;
    const prep = clampInt(nextEx.prepSeconds, 0, 30, nextEx.pureVideo ? 10 : 5);
    runner.phase = prep > 0 ? 'prepare' : (nextEx.pureVideo ? 'video' : 'work');
    runner.remaining = prep > 0 ? prep : 0;
    setupRunnerPhase(false);
  } else {
    advanceRunner();
  }
}

function advanceRunner() {
  recordPureVideoSetIfNeeded();
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
  const prep = clampInt(nextExercise.prepSeconds, 0, 30, nextExercise.pureVideo ? 10 : 5);
  runner.phase = prep > 0 ? 'prepare' : (nextExercise.pureVideo ? 'video' : 'work');
  runner.remaining = prep > 0 ? prep : 0;
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

  if (s.kind === 'checkin') {
    const c = s.checkin || {};
    const body = s.checkinType === 'run'
      ? `时间：${fmtPlainNum(c.minutes ?? Math.round((s.durationSeconds || 0) / 60))} 分钟<br>距离：${fmtPlainNum(c.distanceKm)} 公里<br>平均心率：${fmtPlainNum(c.heartRate)} 次/分<br>身高：${fmtBodyNum(c.height)} cm<br>体重：${fmtBodyNum(c.weight)} kg`
      : `运动名称：${escapeHtml(c.name || s.planName || '')}<br>组数：${fmtPlainNum(c.sets)}<br>每组次数：${fmtPlainNum(c.reps)}<br>时长：${fmtPlainNum(c.minutes ?? Math.round((s.durationSeconds || 0) / 60))} 分钟<br>重量：${fmtPlainNum(c.weightKg)} kg<br>备注：${escapeHtml(c.note || '无')}`;
    $('detailContent').innerHTML = `<div class="detail-line"><b>${escapeHtml(dateLabel(s.startedAt))} · 运动打卡</b><br>${body}</div>`;
    openDialog('detailDialog');
    return;
  }

  const lines = (s.exercises || []).map(e => `<div class="detail-line"><b>${escapeHtml(e.name)}</b><br>${(e.sets || []).map(set => {
    let desc;
    if (set.videoNote != null || set.weightMode != null) {
      desc = `视频 ${fmtPlainNum(set.durationSeconds)}秒 · ${fmtPlainNum(set.plannedSets)}组 · ${set.weightMode === 'weighted' ? `负重 ${fmtPlainNum(set.weightKg)}kg` : '自重'}${set.videoNote ? ` · ${escapeHtml(set.videoNote)}` : ''}`;
    } else {
      desc = set.leftReps != null ? `左${set.leftReps}次 / 右${set.rightReps}次` : set.reps != null ? `${set.reps}次` : `${set.durationSeconds}秒`;
      if (set.weightKg) desc += ` · ${set.weightKg}kg`;
    }
    return `第${set.setNumber}组：${desc}`;
  }).join('<br>')}</div>`).join('');
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
    version: 4,
    exportedAt: nowIso(),
    categories: await getCategories(),
    exercises,
    plans: await getAll('plans'),
    sessions: await getAll('sessions'),
    bodyStats: await getAll('bodyStats'),
    moodNotes: await getAll('moodNotes')
  };
  downloadFile(`fitlog-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), 'application/json');
  try { localStorage.setItem(LAST_BACKUP_KEY, String(Date.now())); } catch (_) {}
  showToast('JSON备份已导出到下载文件夹');
}

// 备份提醒：超过 N 天未备份则弹窗提示（备份文件保存在浏览器下载文件夹）
function checkBackupReminder(force = false) {
  let last = 0;
  try { last = Number(localStorage.getItem(LAST_BACKUP_KEY)) || 0; } catch (_) {}
  const elapsedDays = last ? (Date.now() - last) / 86400000 : Infinity;
  if (!force && elapsedDays < BACKUP_REMIND_DAYS) return;
  const textEl = $('backupReminderText');
  if (textEl) {
    if (!last) textEl.textContent = '你还没有备份过数据。导出 JSON 备份会保存在手机的下载文件夹，建议现在备份一次。';
    else textEl.textContent = `距离上次备份已经 ${Math.floor(elapsedDays)} 天了。导出 JSON 备份会保存在手机的下载文件夹，建议现在备份一次。`;
  }
  openDialog('backupReminderDialog');
}

/* ===== 训练明细 CSV：同一次训练的同一动作只占一行 ===== */
const TRAINING_CSV_HEADER = ['训练日期', '课程', '动作类别', '动作', '组数', '总次数', '左侧次数', '右侧次数', '总时长秒', '重量kg', '分组明细', '备注', '身高cm', '体重kg'];

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function csvSerialize(rows, withBom = false) {
  const text = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  return (withBom ? '\uFEFF' : '') + text;
}

function setDetailText(set) {
  if (set.videoNote != null || set.weightMode != null) {
    const parts = [`视频 ${set.durationSeconds ?? 0}秒`, `${set.plannedSets ?? 1}组`, set.weightMode === 'weighted' ? `负重 ${set.weightKg ?? 0}kg` : '自重'];
    if (set.videoNote) parts.push(String(set.videoNote));
    return `第${set.setNumber}组 ${parts.join(' · ')}`;
  }
  if (set.leftReps != null) return `第${set.setNumber}组 左${set.leftReps}次/右${set.rightReps ?? 0}次`;
  if (set.reps != null) return `第${set.setNumber}组 ${set.reps}次`;
  return `第${set.setNumber}组 ${set.durationSeconds ?? 0}秒`;
}

// 返回二维数组：一次训练 + 一个动作 = 一行，各组数据汇总到列里
function buildTrainingCsvRows(sessions, body = null, moods = []) {
  const rows = [TRAINING_CSV_HEADER.slice()];
  const currentHeight = body?.height ?? '';
  const currentWeight = body?.weight ?? '';
  const sorted = [...sessions].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));

  sorted.forEach(s => {
    const date = dateLabel(s.startedAt);
    const planName = s.planName || (s.kind === 'checkin' ? '运动打卡' : '自由训练');

    if (s.kind === 'checkin') {
      const c = s.checkin || {};
      const isRun = s.checkinType === 'run';
      const name = isRun ? '跑步打卡' : (c.name || '运动打卡');
      const detail = isRun
        ? `距离 ${fmtPlainNum(c.distanceKm)}公里 · 平均心率 ${fmtPlainNum(c.heartRate)}次/分`
        : (c.note || '自定义运动打卡');
      rows.push([
        date, planName, isRun ? '跑步打卡' : '运动打卡', name,
        isRun ? 1 : (c.sets ?? ''), isRun ? '' : (c.reps ?? ''), '', '',
        c.minutes != null ? Math.round(Number(c.minutes) * 60) : Math.round(s.durationSeconds || 0),
        isRun ? '' : (c.weightKg ?? ''), '', detail,
        c.height ?? currentHeight, c.weight ?? currentWeight
      ]);
      return;
    }

    const grouped = new Map();
    (s.exercises || []).forEach(e => {
      const key = `${e.exerciseId || ''}|${e.name || ''}`;
      if (!grouped.has(key)) grouped.set(key, { name: e.name || '', type: e.type, sets: [] });
      grouped.get(key).sets.push(...(e.sets || []));
    });

    grouped.forEach(e => {
      const sets = e.sets || [];
      const sum = key => sets.reduce((total, set) => total + (Number(set[key]) || 0), 0);
      const weights = [...new Set(sets.map(set => Number(set.weightKg) || 0).filter(Boolean))];
      const notes = sets.map(set => set.videoNote).filter(Boolean);
      const kind = sets.some(set => set.videoNote != null || set.weightMode != null) ? '纯视频跟练' : typeLabel(e.type);
      rows.push([
        date, planName, kind, e.name, sets.length,
        sum('reps') || '', sum('leftReps') || '', sum('rightReps') || '',
        sum('durationSeconds') || '', weights.join(' / ') || '',
        sets.map(setDetailText).join('；'), notes.join('；'),
        currentHeight, currentWeight
      ]);
    });
  });

  // 勾选后才把心情/训练状态记录并入同一张 CSV 表，不动作列留空
  [...moods].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).forEach(m => {
    rows.push([
      dateLabel(m.createdAt), '心情记录', '心情/状态', '心情记录',
      '', '', '', '', '', '', '', m.content || '', '', ''
    ]);
  });
  return rows;
}

async function importJson(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || parsed.app !== 'FitLog' || !Array.isArray(parsed.exercises) || !Array.isArray(parsed.plans) || !Array.isArray(parsed.sessions)) {
      throw new Error('文件格式不正确，无法识别为FitLog备份');
    }
    const bodyCount = Array.isArray(parsed.bodyStats) ? parsed.bodyStats.length : 0;
    const moodCount = Array.isArray(parsed.moodNotes) ? parsed.moodNotes.length : 0;
    if (!confirm(`将恢复 ${parsed.exercises.length} 个动作、${parsed.plans.length} 个课程、${parsed.sessions.length} 条训练记录、${bodyCount} 条身高体重记录、${moodCount} 条心情记录。恢复会覆盖当前全部数据，确定继续吗？`)) return;
    for (const name of STORES) await clearStore(name);
    if (Array.isArray(parsed.categories)) {
      await put('meta', { key: 'categories', value: parsed.categories });
    }
    for (const item of parsed.exercises) if (item && item.id) await put('exercises', item);
    for (const item of parsed.plans) if (item && item.id) await put('plans', item);
    for (const item of parsed.sessions) if (item && item.id) await put('sessions', item);
    for (const item of parsed.bodyStats || []) if (item && item.id) await put('bodyStats', item);
    for (const item of parsed.moodNotes || []) if (item && item.id) await put('moodNotes', item);
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

/* ===================== 运动数据分享导出 ===================== */
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

const SHARE_RANGE_LABELS = { today: '今日', week: '本周', month: '本月', year: '本年', all: '全部' };

function getRangeStart(range) {
  const now = new Date();
  const start = new Date(now);
  if (range === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (range === 'week') {
    start.setHours(0, 0, 0, 0);
    start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  } else if (range === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else if (range === 'year') {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
  } else {
    return null;
  }
  return start.getTime();
}

async function exportShareData(range = 'all') {
  const [sessions, body] = await Promise.all([getAll('sessions'), getCurrentBody()]);
  const cutoff = getRangeStart(range);
  const scoped = (cutoff ? sessions.filter(s => new Date(s.startedAt).getTime() >= cutoff) : sessions);
  const rangeLabel = SHARE_RANGE_LABELS[range] || '全部';
  const moods = moodExportIncluded()
    ? (await getMoodNotes()).filter(m => !cutoff || new Date(m.createdAt).getTime() >= cutoff)
    : [];
  const rows = buildTrainingCsvRows(scoped, body, moods);
  if (rows.length === 1) {
    showToast(`${rangeLabel}没有训练记录，无需导出`);
    return;
  }
  const text = csvSerialize(rows);
  const safeLabel = String(rangeLabel).replace(/[\\/:*?"<>|]/g, '');
  downloadFile(`fitlog-training-${safeLabel}-${new Date().toISOString().slice(0, 10)}.csv`, '\uFEFF' + text, 'text/csv;charset=utf-8');
  const copied = await copyText(text);
  showToast(copied ? `${rangeLabel}训练数据已下载并复制，正在调起系统分享…` : `${rangeLabel}训练数据已下载，复制受限请在分享面板中手动选择文本`);
  shareText(text);
}

// 调起系统分享面板，由用户选择任意 AI 助手；不再强跳固定网站
function shareText(text) {
  if (navigator.share) {
    navigator.share({ title: 'FitLog 运动数据', text: text || '' })
      .then(() => showToast('已调起系统分享，可选择任意 AI 助手'))
      .catch(err => {
        if (err && err.name === 'AbortError') showToast('已取消分享，数据仍在剪贴板中');
        else showToast('系统分享不可用，数据已复制，请手动粘贴到 AI 助手');
      });
    return;
  }
  showToast('数据已复制，请打开任意 AI 助手粘贴');
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

  // 身高体重
  $('bodyEditBtn').addEventListener('click', openBodyStatsDialog);
  $('bodyChartWrap').addEventListener('click', openBodyDetailDialog);
  $('openBodyDetailBtn').addEventListener('click', () => { closeDialog('bodyStatsDialog'); openBodyDetailDialog(); });
  $('saveBodyBtn').addEventListener('click', saveBodyStatsFromDialog);
  $('bodyDetailAddBtn').addEventListener('click', () => { closeDialog('bodyDetailDialog'); openBodyStatsDialog(); });

  // 运动打卡
  $('quickCheckinBtn').addEventListener('click', openCheckinDialog);
  $('quickMoodBtn').addEventListener('click', openMoodDialog);
  $('saveMoodBtn').addEventListener('click', saveMoodNoteFromDialog);
  $('viewMoodHistoryBtn').addEventListener('click', async () => { await renderMoodHistory(); openDialog('moodHistoryDialog'); });
  $('exportMoodBtn').addEventListener('click', exportMoodNotes);
  $('moodExportToggle').addEventListener('change', e => { setMoodExportIncluded(e.target.checked); showToast(e.target.checked ? '已开启：导出训练数据时包含心情/状态记录（立即生效，无需点保存）' : '已关闭：导出训练数据不含心情/状态记录（立即生效）'); });
  $('moodHistoryList').addEventListener('click', async e => {
    const del = e.target.closest('[data-mood-delete]');
    if (!del) return;
    if (!confirm('删除这条心情记录？')) return;
    await remove('moodNotes', del.dataset.moodDelete);
    await renderMoodHistory();
    showToast('已删除心情记录');
  });
  $('checkinType').addEventListener('change', toggleCheckinFields);
  $('saveCheckinBtn').addEventListener('click', saveCheckin);

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
    const againBtn = e.target.closest('[data-add-again]');
    if (!upBtn && !downBtn && !remBtn && !againBtn) return;
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
    } else if (againBtn) {
      const idx = Number(againBtn.dataset.addAgain);
      const source = draftPlanItems[idx];
      if (source) {
        draftPlanItems.splice(idx + 1, 0, { ...source });
        showToast('已再安排一次该动作，可用上下箭头调整间隔');
        await renderPlanEditorLists();
      }
    } else if (remBtn) {
      const idx = Number(remBtn.dataset.removeSel);
      draftPlanItems.splice(idx, 1);
      await renderPlanEditorLists();
    }
  });

  // 执行器与数据备份事件（暂停/停止已移到训练界面底部倒计时两侧）
  $('runnerCloseBtn').addEventListener('click', closeRunner);

  // 恢复训练弹窗
  const resumeYes = $('resumeTrainingYes');
  const resumeNo = $('resumeTrainingNo');
  if (resumeYes) resumeYes.addEventListener('click', async () => {
    closeDialog('resumeTrainingDialog');
    if (await restoreRunnerFromSnapshot(loadRunnerSnapshot())) {
      $('runnerPlanName').textContent = runner.planName;
      openDialog('runnerDialog');
      renderRunner();
      showToast('已恢复上次训练，点底部 ▶ 继续');
    }
  });
  if (resumeNo) resumeNo.addEventListener('click', () => {
    closeDialog('resumeTrainingDialog');
    clearRunnerSnapshot();
    showToast('已放弃上次的训练进度');
  });

  $('exportJsonBtn').addEventListener('click', exportJson);
  // 备份提醒弹窗
  const backupLaterBtn = $('backupRemindLater');
  if (backupLaterBtn) backupLaterBtn.addEventListener('click', () => closeDialog('backupReminderDialog'));
  const backupNowBtn = $('backupRemindNow');
  if (backupNowBtn) backupNowBtn.addEventListener('click', async () => {
    closeDialog('backupReminderDialog');
    await exportJson();
  });
  $('btnExportShare').addEventListener('click', () => openDialog('shareDialog'));
  $('quickExportShareBtn').addEventListener('click', () => openDialog('shareDialog'));
  $('shareDialog').addEventListener('click', async e => {
    const rangeBtn = e.target.closest('[data-share-range]');
    if (!rangeBtn) return;
    closeDialog('shareDialog');
    await exportShareData(rangeBtn.dataset.shareRange);
  });
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
    if (target.dataset.sessionDelete && confirm('确定删除这条训练记录吗？删除后无法恢复。')) {
      await remove('sessions', target.dataset.sessionDelete);
      await refreshCurrentPage();
      showToast('训练记录已删除');
    }
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
    await migrateActionPack();
    await populateCategorySelects();
    await renderHome();
    restoreSavedPage();
    $('storageStatus').textContent = '本地数据库已连接。';

    // 若存在未完成的训练快照，询问是否继续；否则检查是否需要备份提醒
    const snap = loadRunnerSnapshot();
    if (snap) {
      const pausedAt = snap.pausedAt ? new Date(snap.pausedAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
      const infoEl = $('resumeTrainingText');
      if (infoEl) infoEl.textContent = `“${snap.planName || '上次课程'}”尚未完成${pausedAt ? `（暂停于 ${pausedAt}）` : ''}，是否继续？`;
      openDialog('resumeTrainingDialog');
    } else {
      setTimeout(() => checkBackupReminder(), 600);
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