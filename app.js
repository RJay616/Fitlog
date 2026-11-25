/**
 * TaiChiFlow / FitLog 核心逻辑 v1.2
 *
 * 版本规范：
 *   - 小改动：1.1 → 1.2 → 1.3
 *   - 大改版：2.1 → 2.2
 *
 * 本次修复：
 *   1. 下拉刷新只刷新当前视图，不再整页重载跳回主页
 *   2. 版本号统一为 x.y
 *   3. 每个动作之间增加组间休息倒计时 + 滴滴提醒
 *   4. 语音播报增加队列看门狗 + 计数提示音兜底，减少断续/漏播
 *   5. 纯视频跟练：勾选后参数变灰失效，视频本地持久化
 *   6. 缓存清理有独立入口（首页快捷按钮 + 设置页）
 *   7. 一键复制数据并跳转 DeepSeek
 *   8. 退出界面/切后台时彻底关闭视频与声音
 */

const APP_VERSION = "1.2";

// 注意：动作数据 key 保持旧值，避免升级后用户已有编排丢失
const STORAGE_KEY_ACTIONS = "taichiflow_actions_v1_1";
const STORAGE_KEY_LOGS = "taichiflow_temp_logs";
const VIEW_STORAGE_KEY = "taichiflow_last_view_v1_2";

const USEFUL_CACHE_PREFIX = "taichiflow-useful-v";
const USELESS_CACHE_PREFIX = "taichiflow-useless-v";

// 本地视频存放在 IndexedDB，刷新/重开页面后仍可跟练
const MEDIA_DB_NAME = "taichiflow-media-v1_2";
const MEDIA_STORE = "videos";

const DEFAULT_ACTIONS = [
  {
    id: "act-1",
    name: "八段锦 · 双手托天理三焦",
    pureVideo: false,
    duration: 20,
    reps: 6,
    rest: 8,
    videoUrl: "",
    videoName: "",
    videoId: "",
    videoSize: 0
  },
  {
    id: "act-2",
    name: "经络拉伸 · 疏通胆经与肩颈",
    pureVideo: false,
    duration: 25,
    reps: 0,
    rest: 10,
    videoUrl: "",
    videoName: "",
    videoId: "",
    videoSize: 0
  },
  {
    id: "act-3",
    name: "太极云手 · 调息收功",
    pureVideo: false,
    duration: 20,
    reps: 5,
    rest: 0,
    videoUrl: "",
    videoName: "",
    videoId: "",
    videoSize: 0
  }
];

let actions = [];
let currentViewId = "view-home";
let playerState = {
  active: false,
  paused: false,
  stepIndex: 0,
  isResting: false,
  remainingSec: 0,
  currentRep: 0,
  timerHandle: null
};

// ==========================================
// 初始化
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
  initVersionDisplay();
  registerServiceWorker();
  initNavigationAndPullRefresh();
  initAudio();
  initActionForm();
  initPlayerControls();
  initCacheManager();
  initDeepseekExport();
  initAudioTestButtons();

  await loadActions();
  renderRoutineList();
  scanCacheSizes();
});

function initVersionDisplay() {
  const badge = document.getElementById("appVersionBadge");
  const settingsVer = document.getElementById("settingsVersionText");
  if (badge) badge.textContent = `v${APP_VERSION}`;
  if (settingsVer) settingsVer.textContent = `v${APP_VERSION}`;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service Worker 注册跳过：", err);
    });
  }
}

// ==========================================
// 需求1：下拉刷新不跳菜单，仅刷新当前内容
// ==========================================
function initNavigationAndPullRefresh() {
  const navButtons = document.querySelectorAll(".nav-btn");

  // 同时用 localStorage 和 URL Hash 记住当前菜单位置
  const savedView = localStorage.getItem(VIEW_STORAGE_KEY) || "";
  const hashView = window.location.hash.replace(/^#/, "");
  const initialView =
    [hashView, savedView].find((id) => id && document.getElementById(id)) || "view-home";
  switchView(initialView, false, false);

  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-target");
      switchView(target, true, true);
    });
  });

  window.addEventListener("hashchange", () => {
    const hash = window.location.hash.replace(/^#/, "");
    if (hash && document.getElementById(hash)) {
      switchView(hash, false, true);
    }
  });

  // 从后台/浏览器往返缓存恢复时，清掉可能残留的视频声音
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      stopAndCleanupVideo();
      if (playerState.active) exitWorkout();
      const restored = localStorage.getItem(VIEW_STORAGE_KEY) || "view-home";
      if (document.getElementById(restored)) switchView(restored, false, false);
    }
  });

  // 自定义下拉刷新：拦截浏览器原生整页刷新，只更新当前视图
  const indicator = document.getElementById("pullIndicator");
  let startY = 0;
  let pulling = false;
  let pullAmount = 0;

  const isAtTop = () => {
    const scroller = document.scrollingElement || document.documentElement;
    return (window.scrollY || scroller.scrollTop || 0) <= 0;
  };

  const resetIndicator = () => {
    if (!indicator) return;
    indicator.classList.remove("visible");
    indicator.style.height = "";
    indicator.textContent = "下拉刷新当前页面...";
  };

  window.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length !== 1 || !isAtTop()) return;
      startY = event.touches[0].clientY;
      pulling = true;
      pullAmount = 0;
    },
    { passive: true }
  );

  window.addEventListener(
    "touchmove",
    (event) => {
      if (!pulling || !indicator) return;
      const deltaY = event.touches[0].clientY - startY;

      // 用户其实是向上正常滚动，退出下拉逻辑
      if (deltaY <= 0 || !isAtTop()) {
        pulling = false;
        resetIndicator();
        return;
      }

      // 阻止 Android Chrome 的原生下拉整页刷新
      if (event.cancelable) event.preventDefault();

      pullAmount = deltaY;
      indicator.textContent = deltaY > 58 ? "松开刷新当前页面..." : "下拉刷新当前页面...";
      indicator.style.height = `${Math.min(36, Math.round(deltaY / 2))}px`;
      if (deltaY > 55) indicator.classList.add("visible");
    },
    { passive: false }
  );

  const finishPull = () => {
    if (!pulling) {
      resetIndicator();
      return;
    }
    pulling = false;
    if (pullAmount > 55) refreshCurrentViewOnly();
    pullAmount = 0;
    resetIndicator();
  };

  window.addEventListener("touchend", finishPull, { passive: true });
  window.addEventListener("touchcancel", finishPull, { passive: true });
}

function switchView(viewId, updateHash = true, persist = true) {
  if (!viewId || !document.getElementById(viewId)) return;

  // 离开训练主页时，结束训练并彻底关闭音视频
  if (viewId !== "view-home") {
    if (playerState.active) exitWorkout();
    stopAndCleanupVideo();
  }

  currentViewId = viewId;
  document.querySelectorAll(".view-section").forEach((section) => {
    section.classList.toggle("active", section.id === viewId);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-target") === viewId);
  });

  if (updateHash) {
    history.replaceState(null, "", `#${viewId}`);
  }
  if (persist) {
    localStorage.setItem(VIEW_STORAGE_KEY, viewId);
  }
  if (viewId === "view-settings") {
    scanCacheSizes();
  }
}

function refreshCurrentViewOnly() {
  const nowStr = new Date().toLocaleTimeString("zh-CN", { hour12: false });

  if (currentViewId === "view-home") {
    renderRoutineList();
    const stamp = document.getElementById("refreshTimestamp");
    if (stamp) stamp.textContent = `已刷新 (${nowStr})`;
  } else if (currentViewId === "view-builder") {
    // 保留表单里正在输入的内容，不做任何重置
  } else if (currentViewId === "view-settings") {
    scanCacheSizes();
  }

  showToast("已刷新当前界面内容");
}

// ==========================================
// 需求3 & 4：提示音解锁、语音队列与计数兜底
// ==========================================
let audioCtx = null;
let audioUnlocked = false;

function ensureAudioContext() {
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch (e) {
    console.warn("音频上下文初始化失败：", e);
    return null;
  }
}

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  ensureAudioContext();
}

function initAudio() {
  // 首次用户手势时解锁 Web Audio，避免定时器里播放被浏览器拦截
  ["touchend", "click", "keydown"].forEach((evt) => {
    window.addEventListener(evt, unlockAudio, {
      once: true,
      passive: evt !== "keydown"
    });
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
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.32, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  } catch (e) {
    console.warn("蜂鸣提示音播放受限：", e);
  }
}

function playCountCue() {
  // 计数时双短音，即使语音漏播也能听清节奏
  playBeep(1180, 80, 2, 130);
}

function playRestStartCue() {
  playBeep(660, 180, 1);
}

function playRestTickCue() {
  playBeep(980, 130, 1);
}

function playRestEndCue() {
  playBeep(1200, 220, 3, 160);
}

const speechQueue = [];
let isSpeaking = false;
let speechWatchdog = null;
let speechFinish = null;

function pickLocalVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  const zhVoices = voices.filter((v) => /zh|cmn|Chinese/i.test(v.lang));
  return zhVoices.find((v) => v.localService) || zhVoices[0] || null;
}

function cancelSpeech() {
  if ("speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch (e) {}
  }
  if (speechWatchdog) clearTimeout(speechWatchdog);
  speechWatchdog = null;
  speechFinish = null;
  speechQueue.length = 0;
  isSpeaking = false;
}

function speakText(text, interrupt = false) {
  if (!("speechSynthesis" in window)) return;
  const message = String(text || "").trim();
  if (!message) return;

  if (interrupt) cancelSpeech();

  speechQueue.push(message);
  processSpeechQueue();
}

function processSpeechQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  if (!("speechSynthesis" in window)) return;

  const text = speechQueue.shift();
  let settled = false;

  const finish = () => {
    if (settled) return;
    settled = true;
    if (speechWatchdog) clearTimeout(speechWatchdog);
    speechWatchdog = null;
    speechFinish = null;
    isSpeaking = false;
    // 稍作间隔，避免 Android TTS 连续 cancel/speak 时卡住
    setTimeout(processSpeechQueue, 120);
  };

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = 0.95;
  utterance.pitch = 1;
  utterance.volume = 1;

  const voice = pickLocalVoice();
  if (voice) utterance.voice = voice;

  utterance.onend = finish;
  utterance.onerror = finish;

  isSpeaking = true;
  speechFinish = finish;

  // 看门狗：部分安卓 TTS 不会回调 onend，超过预估时长后强制放行队列
  const estimatedMs = Math.min(9000, 1400 + text.length * 260);
  speechWatchdog = setTimeout(() => {
    try {
      window.speechSynthesis.cancel();
    } catch (e) {}
    if (speechFinish) speechFinish();
  }, estimatedMs);

  try {
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.warn("语音合成调用失败：", e);
    finish();
  }
}

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    // 触发系统语音列表加载，后续优先选本地中文声音
    window.speechSynthesis.getVoices();
  };
}

function initAudioTestButtons() {
  const beepBtn = document.getElementById("btnTestBeep");
  const voiceBtn = document.getElementById("btnTestVoice");

  if (beepBtn) {
    beepBtn.addEventListener("click", () => {
      unlockAudio();
      playBeep(880, 160, 2);
      showToast("已触发滴滴提示音");
    });
  }

  if (voiceBtn) {
    voiceBtn.addEventListener("click", () => {
      unlockAudio();
      const voice = pickLocalVoice();
      const source = voice && voice.localService ? "本地语音" : "系统语音";
      speakText(`${source}测试开始。第1次，第2次，第3次。`, true);
      playCountCue();
      showToast(`正在使用${source}播报，请检查音量`);
    });
  }
}

// ==========================================
// 需求5：动作元件 + 纯视频跟练 + 本地视频持久化
// ==========================================
async function loadActions() {
  let raw;
  try {
    const saved = localStorage.getItem(STORAGE_KEY_ACTIONS);
    raw = saved ? JSON.parse(saved) : DEFAULT_ACTIONS.map((item) => ({ ...item }));
    if (!Array.isArray(raw)) raw = DEFAULT_ACTIONS.map((item) => ({ ...item }));
  } catch (e) {
    raw = DEFAULT_ACTIONS.map((item) => ({ ...item }));
  }

  actions = raw.map((item, index) => ({
    id: item.id || `act-${Date.now()}-${index}`,
    name: item.name || `未命名动作 ${index + 1}`,
    pureVideo: !!item.pureVideo,
    duration: Number(item.duration) || 30,
    reps: Math.max(0, Number(item.reps) || 0),
    // 老数据没有 rest 字段时，默认补 10 秒休息（最后一个动作不休息）
    rest:
      item.rest === undefined
        ? index < raw.length - 1
          ? 10
          : 0
        : Math.max(0, Number(item.rest) || 0),
    videoUrl: item.videoUrl || "",
    videoName: item.videoName || "",
    videoId: item.videoId || "",
    videoSize: Number(item.videoSize) || 0
  }));

  await hydrateVideoUrls();
}

function saveActions() {
  const serializable = actions.map((item) => ({
    ...item,
    // blob URL 只在当前会话有效，刷新后通过 IndexedDB 重新生成
    videoUrl: item.videoUrl && item.videoUrl.startsWith("blob:") ? "" : item.videoUrl
  }));
  localStorage.setItem(STORAGE_KEY_ACTIONS, JSON.stringify(serializable));
}

let mediaDbPromise = null;

function openMediaDb() {
  if (mediaDbPromise) return mediaDbPromise;

  mediaDbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("当前浏览器不支持 IndexedDB"));
      return;
    }
    const request = indexedDB.open(MEDIA_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        db.createObjectStore(MEDIA_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("打开视频数据库失败"));
  });

  return mediaDbPromise;
}

function saveVideoBlob(id, file) {
  return openMediaDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(MEDIA_STORE, "readwrite");
        tx.objectStore(MEDIA_STORE).put(file, id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("保存视频失败"));
      })
  );
}

function getVideoBlob(id) {
  return openMediaDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(MEDIA_STORE, "readonly");
        const request = tx.objectStore(MEDIA_STORE).get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("读取视频失败"));
      })
  );
}

function deleteVideoBlob(id) {
  if (!id) return Promise.resolve();
  return openMediaDb()
    .then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(MEDIA_STORE, "readwrite");
          tx.objectStore(MEDIA_STORE).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error("删除视频失败"));
        })
    )
    .catch((e) => console.warn("删除本地视频失败：", e));
}

function clearAllVideoBlobs() {
  return openMediaDb()
    .then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(MEDIA_STORE, "readwrite");
          tx.objectStore(MEDIA_STORE).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error("清空视频库失败"));
        })
    )
    .catch((e) => console.warn("清空本地视频库失败：", e));
}

async function hydrateVideoUrls() {
  for (const item of actions) {
    if (!item.videoId) continue;
    try {
      const blob = await getVideoBlob(item.videoId);
      if (blob) item.videoUrl = URL.createObjectURL(blob);
    } catch (e) {
      console.warn(`动作「${item.name}」的视频恢复失败：`, e);
    }
  }
}

function initActionForm() {
  const form = document.getElementById("actionForm");
  const chkPureVideo = document.getElementById("chkPureVideoMode");
  const paramGroupBox = document.getElementById("paramGroupBox");
  if (!form || !chkPureVideo || !paramGroupBox) return;

  const paramInputs = Array.from(paramGroupBox.querySelectorAll("input"));

  const applyPureVideoMode = () => {
    const isPure = chkPureVideo.checked;
    paramGroupBox.classList.toggle("disabled-group", isPure);
    paramInputs.forEach((input) => {
      input.disabled = isPure;
    });
  };

  chkPureVideo.addEventListener("change", applyPureVideoMode);
  applyPureVideoMode();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = document.getElementById("inputActionName").value.trim();
    const fileInput = document.getElementById("inputVideoFile");
    const file = fileInput.files && fileInput.files[0];
    const isPureVideo = chkPureVideo.checked;

    if (isPureVideo && !file) {
      showToast("纯视频跟练需要先选择一个视频文件");
      return;
    }

    const videoId = file ? `vid-${Date.now()}` : "";
    let videoUrl = "";
    let videoName = "";

    if (file) {
      videoUrl = URL.createObjectURL(file);
      videoName = file.name;
      try {
        await saveVideoBlob(videoId, file);
      } catch (e) {
        console.warn("视频持久化失败：", e);
        showToast("视频仅本次会话可用，请检查浏览器存储权限");
      }
      appendTempLog(`加载本地视频：${file.name} (${Math.round(file.size / 1024)}KB)`);
    }

    const newAction = {
      id: `act-${Date.now()}`,
      name: name || "未命名气功动作",
      pureVideo: isPureVideo,
      duration: isPureVideo ? 0 : Math.max(5, Number(document.getElementById("inputDuration").value) || 30),
      reps: isPureVideo ? 0 : Math.max(0, Number(document.getElementById("inputReps").value) || 0),
      rest: isPureVideo ? 0 : Math.max(0, Number(document.getElementById("inputRest").value) || 10),
      videoUrl,
      videoName,
      videoId,
      videoSize: file ? file.size : 0
    };

    actions.push(newAction);
    saveActions();
    renderRoutineList();

    form.reset();
    applyPureVideoMode();

    showToast(isPureVideo ? "纯视频动作已添加" : "动作元件已添加");
    switchView("view-home", true);
  });
}

function renderRoutineList() {
  const listEl = document.getElementById("routineList");
  if (!listEl) return;
  listEl.innerHTML = "";

  actions.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = "routine-item";
    li.innerHTML = `
      <div>
        <strong class="routine-name"></strong>
        <div class="routine-meta"></div>
      </div>
      <button class="btn ghost small" type="button">删除</button>
    `;

    li.querySelector(".routine-name").textContent = `${index + 1}. ${item.name}`;

    let metaText;
    if (item.pureVideo) {
      metaText = `纯视频跟练（参数已忽略）${item.videoName ? " · 视频：" + item.videoName : " · 未选择视频"}`;
    } else {
      const repText = item.reps > 0 ? `计数 ${item.reps} 次` : "仅计时";
      const restText = item.rest > 0 ? `组间休息 ${item.rest} 秒` : "无组间休息";
      const videoText = item.videoName ? ` · 视频：${item.videoName}` : "";
      metaText = `时长 ${item.duration} 秒 · ${repText} · ${restText}${videoText}`;
    }
    li.querySelector(".routine-meta").textContent = metaText;

    li.querySelector("button").addEventListener("click", async () => {
      if (item.videoUrl && item.videoUrl.startsWith("blob:")) {
        URL.revokeObjectURL(item.videoUrl);
      }
      if (item.videoId) await deleteVideoBlob(item.videoId);
      actions = actions.filter((action) => action.id !== item.id);
      saveActions();
      renderRoutineList();
      scanCacheSizes();
      showToast("已移除该动作");
    });

    listEl.appendChild(li);
  });
}

// ==========================================
// 需求3 & 8：组间休息倒计时 + 视频彻底清理
// ==========================================
function initPlayerControls() {
  const startBtn = document.getElementById("btnStartWorkout");
  const exitBtn = document.getElementById("btnExitPlayer");
  const pauseBtn = document.getElementById("btnPauseResume");
  const prevBtn = document.getElementById("btnPrevStep");
  const nextBtn = document.getElementById("btnNextStep");

  if (startBtn) {
    startBtn.addEventListener("click", () => {
      if (actions.length === 0) {
        showToast("请先添加至少一个动作元件");
        return;
      }
      startWorkout();
    });
  }
  if (exitBtn) exitBtn.addEventListener("click", () => exitWorkout());
  if (pauseBtn) pauseBtn.addEventListener("click", () => togglePauseWorkout());
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (playerState.stepIndex > 0) runActionStep(playerState.stepIndex - 1);
    });
  }
  if (nextBtn) nextBtn.addEventListener("click", () => advanceNextStep());

  document.addEventListener("visibilitychange", () => {
    // 切到后台只暂停，不卸载视频；退出界面/关闭页面才做彻底清理
    if (document.hidden) {
      const videoEl = document.getElementById("actionVideo");
      if (videoEl && !videoEl.paused) videoEl.pause();
    }
  });

  window.addEventListener("pagehide", stopAndCleanupVideo);
  window.addEventListener("beforeunload", stopAndCleanupVideo);
}

function clearPlayerTimer() {
  if (playerState.timerHandle === null) return;
  clearInterval(playerState.timerHandle);
  clearTimeout(playerState.timerHandle);
  playerState.timerHandle = null;
}

function stopAndCleanupVideo() {
  const videoEl = document.getElementById("actionVideo");
  const videoWrapper = document.getElementById("videoWrapper");

  if (videoEl) {
    try {
      videoEl.onended = null;
      videoEl.onerror = null;
      videoEl.pause();
      videoEl.muted = true;
      videoEl.currentTime = 0;
      videoEl.removeAttribute("src");
      videoEl.load();
    } catch (e) {
      console.warn("清理视频播放器异常：", e);
    }
  }
  if (videoWrapper) videoWrapper.classList.add("hidden");
}

function startWorkout() {
  unlockAudio();
  if ("speechSynthesis" in window) {
    try {
      window.speechSynthesis.getVoices();
    } catch (e) {}
  }

  playerState.active = true;
  playerState.paused = false;
  const panel = document.getElementById("playerPanel");
  const pauseBtn = document.getElementById("btnPauseResume");
  if (panel) panel.classList.remove("hidden");
  if (pauseBtn) pauseBtn.textContent = "暂停";

  runActionStep(0);
}

function exitWorkout(completed = false) {
  if (!playerState.active) return;

  clearPlayerTimer();
  playerState.active = false;
  playerState.paused = false;
  playerState.isResting = false;
  playerState.currentRep = 0;

  cancelSpeech();
  stopAndCleanupVideo();

  const panel = document.getElementById("playerPanel");
  if (panel) panel.classList.add("hidden");
  showToast(completed ? "今日训练已完成，音视频已关闭" : "已退出训练并关闭所有音视频");
}

function togglePauseWorkout() {
  if (!playerState.active) return;

  playerState.paused = !playerState.paused;
  const pauseBtn = document.getElementById("btnPauseResume");
  const videoEl = document.getElementById("actionVideo");

  if (playerState.paused) {
    if (pauseBtn) pauseBtn.textContent = "继续";
    if (videoEl && !videoEl.paused) videoEl.pause();
    // 暂停时取消语音，避免后台继续播报
    cancelSpeech();
  } else {
    if (pauseBtn) pauseBtn.textContent = "暂停";
    if (videoEl && videoEl.src) videoEl.play().catch(() => {});
    speakText("继续训练", true);
  }
}

function setPlayerTexts({ title, desc, mode, value, unit }) {
  const map = {
    playerActionTitle: title,
    playerActionDesc: desc,
    timerModeLabel: mode,
    timerValue: value,
    timerUnit: unit
  };
  Object.entries(map).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el && val !== undefined) el.textContent = String(val);
  });
}

function runActionStep(index) {
  clearPlayerTimer();
  stopAndCleanupVideo();
  cancelSpeech();

  if (index >= actions.length) {
    exitWorkout(true);
    playBeep(1046, 220, 2, 200);
    speakText("恭喜，今日全部训练已完成！", true);
    return;
  }

  const act = actions[index];
  playerState.stepIndex = index;
  playerState.isResting = false;
  playerState.currentRep = 0;
  playerState.remainingSec = 0;

  const stepTag = document.getElementById("playerStepTag");
  if (stepTag) stepTag.textContent = `动作 ${index + 1}/${actions.length}`;

  const videoEl = document.getElementById("actionVideo");
  const videoWrapper = document.getElementById("videoWrapper");

  if (act.videoUrl && videoEl && videoWrapper) {
    videoWrapper.classList.remove("hidden");
    videoEl.muted = false;
    videoEl.src = act.videoUrl;
    videoEl.onerror = () => {
      if (playerState.active && playerState.stepIndex === index) {
        showToast("视频加载失败，已跳过该动作");
        setTimeout(() => runActionStep(index + 1), 500);
      }
    };
    videoEl.play().catch(() => {});
  }

  // 纯视频跟练：不计时、不计数、不休息，视频播完自动下一项
  if (act.pureVideo) {
    if (!act.videoUrl) {
      setPlayerTexts({
        title: act.name,
        desc: "未找到本地视频，已自动跳过该动作",
        mode: "纯视频跟练",
        value: "跳过",
        unit: "请在动作元件中重新选择视频"
      });
      showToast("纯视频动作未找到视频，已跳过");
      playerState.timerHandle = setTimeout(() => runActionStep(index + 1), 800);
      return;
    }

    setPlayerTexts({
      title: act.name,
      desc: "纯视频跟练模式（计时/计数/休息参数已忽略）",
      mode: "跟随视频练习中",
      value: "跟练",
      unit: "视频播放完毕自动进入下一项"
    });
    speakText(`开始纯视频跟练：${act.name}`, true);

    if (videoEl) {
      videoEl.onended = () => {
        if (
          playerState.active &&
          !playerState.paused &&
          playerState.stepIndex === index
        ) {
          runActionStep(index + 1);
        }
      };
    }
    return;
  }

  // 常规参数模式
  const duration = Math.max(1, Number(act.duration) || 30);
  const reps = Math.max(0, Number(act.reps) || 0);
  const rest = Math.max(0, Number(act.rest) || 0);
  const repInterval = reps > 0 ? Math.max(2, Math.floor(duration / reps)) : 0;

  playerState.remainingSec = duration;

  setPlayerTexts({
    title: act.name,
    desc: reps > 0 ? `目标计数：${reps} 次` : "保持深呼吸，平稳完成动作",
    mode: "动作进行中",
    value: duration,
    unit: reps > 0 ? `秒（计数 0/${reps}）` : "秒"
  });

  speakText(`开始第${index + 1}个动作，${act.name}`, true);

  playerState.timerHandle = setInterval(() => {
    if (!playerState.active || playerState.paused) return;

    playerState.remainingSec -= 1;
    const elapsed = duration - playerState.remainingSec;

    if (
      repInterval > 0 &&
      elapsed > 0 &&
      elapsed % repInterval === 0 &&
      playerState.currentRep < reps
    ) {
      playerState.currentRep += 1;
      playCountCue();
      speakText(`第${playerState.currentRep}次`, true);
    }

    const valueEl = document.getElementById("timerValue");
    const unitEl = document.getElementById("timerUnit");
    if (valueEl) valueEl.textContent = String(Math.max(0, playerState.remainingSec));
    if (unitEl) {
      unitEl.textContent = reps > 0 ? `秒（计数 ${playerState.currentRep}/${reps}）` : "秒";
    }

    if (playerState.remainingSec > 0 && playerState.remainingSec <= 3) {
      playBeep(760, 120, 1);
    }

    if (playerState.remainingSec <= 0) {
      clearPlayerTimer();
      stopAndCleanupVideo();

      if (rest > 0 && index < actions.length - 1) {
        startRestCountdown(rest, index + 1);
      } else {
        runActionStep(index + 1);
      }
    }
  }, 1000);
}

function startRestCountdown(restSeconds, nextActionIndex) {
  clearPlayerTimer();
  stopAndCleanupVideo();
  cancelSpeech();

  const seconds = Math.max(1, Number(restSeconds) || 10);
  const nextAct = actions[nextActionIndex] || { name: "下一动作" };

  playerState.isResting = true;
  playerState.remainingSec = seconds;

  setPlayerTexts({
    title: `休息调整 · 下一项：${nextAct.name}`,
    desc: "请放松呼吸，倒计时结束后自动开始",
    mode: "组间休息倒计时",
    value: seconds,
    unit: "秒后自动开始下一个动作"
  });

  playRestStartCue();
  speakText(`组间休息 ${seconds} 秒`, true);

  playerState.timerHandle = setInterval(() => {
    if (!playerState.active || playerState.paused) return;

    playerState.remainingSec -= 1;
    const valueEl = document.getElementById("timerValue");
    if (valueEl) valueEl.textContent = String(Math.max(0, playerState.remainingSec));

    if (playerState.remainingSec > 0 && playerState.remainingSec <= 3) {
      playRestTickCue();
    }

    if (playerState.remainingSec <= 0) {
      clearPlayerTimer();
      playRestEndCue();
      runActionStep(nextActionIndex);
    }
  }, 1000);
}

function advanceNextStep() {
  if (!playerState.active) return;

  if (playerState.isResting) {
    runActionStep(playerState.stepIndex + 1);
    return;
  }

  const act = actions[playerState.stepIndex];
  if (act && !act.pureVideo && act.rest > 0 && playerState.stepIndex < actions.length - 1) {
    startRestCountdown(act.rest, playerState.stepIndex + 1);
  } else {
    runActionStep(playerState.stepIndex + 1);
  }
}

// ==========================================
// 需求6：缓存分级清理（首页也有入口）
// ==========================================
function appendTempLog(msg) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LOGS) || "[]";
    const arr = JSON.parse(raw);
    arr.push(`[${new Date().toISOString()}] ${msg}`);
    localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(arr.slice(-50)));
  } catch (e) {}
}

function initCacheManager() {
  const homeCacheBtn = document.getElementById("btnHomeCache");
  if (homeCacheBtn) {
    homeCacheBtn.addEventListener("click", () => switchView("view-settings"));
  }

  const scanBtn = document.getElementById("btnScanCache");
  if (scanBtn) {
    scanBtn.addEventListener("click", () => {
      scanCacheSizes();
      showToast("缓存扫描已完成");
    });
  }

  const cleanBtn = document.getElementById("btnCleanCache");
  if (!cleanBtn) return;

  cleanBtn.addEventListener("click", async () => {
    const cleanUseful = document.getElementById("chkCacheUseful").checked;
    const cleanUseless = document.getElementById("chkCacheUseless").checked;

    if (!cleanUseful && !cleanUseless) {
      showToast("请至少勾选一项要清理的缓存类别");
      return;
    }

    const items = [];
    if (cleanUseful) items.push("· 动作编排与本地视频（恢复默认动作）");
    if (cleanUseless) items.push("· 临时日志与过期缓存");

    if (!window.confirm(`确认清理以下内容？此操作不可撤销：\n\n${items.join("\n")}`)) {
      return;
    }

    if (cleanUseless) {
      localStorage.removeItem(STORAGE_KEY_LOGS);
      if ("caches" in window) {
        try {
          const keys = await caches.keys();
          for (const key of keys) {
            if (!key.startsWith(USEFUL_CACHE_PREFIX)) {
              await caches.delete(key);
            }
          }
        } catch (e) {}
      }
    }

    if (cleanUseful) {
      if (playerState.active) exitWorkout();
      actions.forEach((item) => {
        if (item.videoUrl && item.videoUrl.startsWith("blob:")) {
          URL.revokeObjectURL(item.videoUrl);
        }
      });
      await clearAllVideoBlobs();
      localStorage.removeItem(STORAGE_KEY_ACTIONS);
      actions = DEFAULT_ACTIONS.map((item) => ({ ...item }));
      saveActions();
      renderRoutineList();

      if ("caches" in window) {
        try {
          const keys = await caches.keys();
          for (const key of keys) {
            if (key.startsWith(USEFUL_CACHE_PREFIX)) {
              await caches.delete(key);
            }
          }
        } catch (e) {}
      }
    }

    await scanCacheSizes();
    showToast("所选缓存已清理完毕");
  });
}

async function scanCacheSizes() {
  let usefulBytes = new Blob([localStorage.getItem(STORAGE_KEY_ACTIONS) || ""]).size;
  let uselessBytes = new Blob([localStorage.getItem(STORAGE_KEY_LOGS) || ""]).size;

  usefulBytes += actions.reduce((sum, item) => sum + (Number(item.videoSize) || 0), 0);

  if ("caches" in window) {
    try {
      const keys = await caches.keys();
      for (const key of keys) {
        const cache = await caches.open(key);
        const requests = await cache.keys();
        const estimated = requests.length * 18 * 1024;
        if (key.startsWith(USEFUL_CACHE_PREFIX)) {
          usefulBytes += estimated;
        } else {
          uselessBytes += estimated;
        }
      }
    } catch (e) {}
  }

  const usefulEl = document.getElementById("sizeUseful");
  const uselessEl = document.getElementById("sizeUseless");
  if (usefulEl) usefulEl.textContent = formatBytes(usefulBytes);
  if (uselessEl) uselessEl.textContent = formatBytes(uselessBytes);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ==========================================
// 需求7：一键复制数据并跳转 DeepSeek
// ==========================================
function initDeepseekExport() {
  const handleExport = async () => {
    const summaryLines = [
      `【TaiChiFlow v${APP_VERSION} 训练编排数据】`,
      `导出时间：${new Date().toLocaleString("zh-CN")}`,
      `动作总数：${actions.length} 项`,
      `------------------------`,
      ...actions.map((item, index) => {
        if (item.pureVideo) {
          return `${index + 1}. ${item.name} | 模式：纯视频跟练${item.videoName ? ` | 视频：${item.videoName}` : ""}`;
        }
        return `${index + 1}. ${item.name} | 时长：${item.duration}秒 | 计数：${item.reps}次 | 组间休息：${item.rest}秒`;
      }),
      `------------------------`,
      `请作为中医养生与太极气功教练，分析以上训练编排的强度、经络覆盖合理性，并给出改进建议：`
    ];

    const exportText = summaryLines.join("\n");
    const copied = await copyText(exportText);

    showToast(copied ? "数据已复制，正在打开 DeepSeek..." : "复制受限，请手动粘贴已选中的文本");

    // 紧跟用户操作打开，避免被浏览器弹窗拦截
    const opened = window.open("https://chat.deepseek.com/", "_blank");
    if (opened) {
      try {
        opened.opener = null;
      } catch (e) {}
    } else {
      showToast("弹窗被拦截，请手动访问 chat.deepseek.com");
    }
  };

  const homeBtn = document.getElementById("btnCopyDeepseek");
  const settingsBtn = document.getElementById("btnSettingsDeepseek");
  if (homeBtn) homeBtn.addEventListener("click", handleExport);
  if (settingsBtn) settingsBtn.addEventListener("click", handleExport);
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {}

  // 降级方案：WebView / 旧版浏览器仍可复制
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch (e) {
    return false;
  }
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 2400);
}
