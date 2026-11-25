/**
 * TaiChiFlow 核心逻辑
 * 需求2：版本号采用 1.1, 1.2 递增；大改版采用 2.1, 2.2
 */
const APP_VERSION = "1.1";
const USEFUL_CACHE_PREFIX = "taichiflow-useful-v";
const USELESS_CACHE_PREFIX = "taichiflow-useless-v";
const STORAGE_KEY_ACTIONS = "taichiflow_actions_v1_1";
const STORAGE_KEY_LOGS = "taichiflow_temp_logs";

// 默认内置动作编排
const DEFAULT_ACTIONS = [
  {
    id: "act-1",
    name: "八段锦 · 双手托天理三焦",
    pureVideo: false,
    duration: 20,
    reps: 6,
    rest: 8,
    videoUrl: "",
    videoName: ""
  },
  {
    id: "act-2",
    name: "经络拉伸 · 疏通胆经与肩颈",
    pureVideo: false,
    duration: 25,
    reps: 0,
    rest: 10,
    videoUrl: "",
    videoName: ""
  },
  {
    id: "act-3",
    name: "太极云手 · 调息收功",
    pureVideo: false,
    duration: 20,
    reps: 5,
    rest: 0,
    videoUrl: "",
    videoName: ""
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

// 初始化入口
document.addEventListener("DOMContentLoaded", () => {
  initVersionDisplay();
  registerServiceWorker();
  loadActions();
  initNavigationAndPullRefresh();
  initActionForm();
  initPlayerControls();
  initCacheManager();
  initDeepseekExport();
  initAudioTestButtons();
  renderRoutineList();
  scanCacheSizes();
});

// ==========================================
// 需求2：版本号显示 (1.1, 1.2 迭代规范)
// ==========================================
function initVersionDisplay() {
  const badge = document.getElementById("appVersionBadge");
  const settingsVer = document.getElementById("settingsVersionText");
  if (badge) badge.textContent = `v${APP_VERSION}`;
  if (settingsVer) settingsVer.textContent = `v${APP_VERSION}`;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("SW 注册跳过:", err);
    });
  }
}

// ==========================================
// 需求1：修复下拉刷新跳回主界面问题
// ==========================================
function initNavigationAndPullRefresh() {
  const navButtons = document.querySelectorAll(".nav-btn");

  // 读取 URL Hash 保持刷新后停留在当前子页面
  const initialHash = window.location.hash.replace("#", "");
  if (initialHash && document.getElementById(initialHash)) {
    switchView(initialHash, false);
  }

  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-target");
      switchView(target, true);
    });
  });

  window.addEventListener("hashchange", () => {
    const hashView = window.location.hash.replace("#", "");
    if (hashView && document.getElementById(hashView)) {
      switchView(hashView, false);
    }
  });

  // 自定义页面内下拉刷新：仅刷新当前视图的数据，绝不重置导航菜单
  let touchStartY = 0;
  let isPulling = false;
  const indicator = document.getElementById("pullIndicator");

  window.addEventListener(
    "touchstart",
    (e) => {
      if (window.scrollY === 0 && e.touches.length === 1) {
        touchStartY = e.touches[0].clientY;
        isPulling = true;
      }
    },
    { passive: true }
  );

  window.addEventListener(
    "touchmove",
    (e) => {
      if (!isPulling) return;
      const deltaY = e.touches[0].clientY - touchStartY;
      if (deltaY > 55 && window.scrollY === 0) {
        indicator.classList.add("visible");
      }
    },
    { passive: true }
  );

  window.addEventListener("touchend", () => {
    if (!isPulling) return;
    isPulling = false;
    if (indicator.classList.contains("visible")) {
      refreshCurrentViewOnly();
      setTimeout(() => {
        indicator.classList.remove("visible");
      }, 600);
    }
  });
}

function switchView(viewId, updateHash = true) {
  // 需求8：如果离开主训练界面，必须强制停止视频播放与声音
  if (viewId !== "view-home") {
    stopAndCleanupVideo();
  }

  currentViewId = viewId;
  document.querySelectorAll(".view-section").forEach((sec) => {
    sec.classList.toggle("active", sec.id === viewId);
  });

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-target") === viewId);
  });

  if (updateHash) {
    history.replaceState(null, "", `#${viewId}`);
  }

  if (viewId === "view-settings") {
    scanCacheSizes();
  }
}

function refreshCurrentViewOnly() {
  const nowStr = new Date().toLocaleTimeString();
  if (currentViewId === "view-home") {
    renderRoutineList();
    const ts = document.getElementById("refreshTimestamp");
    if (ts) ts.textContent = `已刷新 (${nowStr})`;
  } else if (currentViewId === "view-builder") {
    // 保留表单当前输入状态，仅提示局部刷新完成
  } else if (currentViewId === "view-settings") {
    scanCacheSizes();
  }
  showToast("已刷新当前界面内容");
}

// ==========================================
// 需求4：本地 Web Audio 滴滴音效 & 防卡顿队列语音播报
// ==========================================
let audioCtx = null;
function playBeep(freq = 880, durationMs = 160, count = 1) {
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    for (let i = 0; i < count; i++) {
      const startTime = audioCtx.currentTime + i * 0.24;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.35, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + durationMs / 1000);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(startTime);
      osc.stop(startTime + durationMs / 1000 + 0.02);
    }
  } catch (e) {
    console.warn("蜂鸣提示音播放受限:", e);
  }
}

// 离线优先、防断断续续的语音合成队列
const speechQueue = [];
let isSpeaking = false;

function speakText(text, interrupt = false) {
  if (!("speechSynthesis" in window)) return;

  if (interrupt) {
    window.speechSynthesis.cancel();
    speechQueue.length = 0;
    isSpeaking = false;
  }

  speechQueue.push(String(text));
  processSpeechQueue();
}

function processSpeechQueue() {
  if (isSpeaking || speechQueue.length === 0) return;

  const nextText = speechQueue.shift();
  const utter = new SpeechSynthesisUtterance(nextText);
  utter.lang = "zh-CN";
  utter.rate = 1.05;
  utter.pitch = 1.0;

  // 优先选用本地离线语音包，避免网络波动导致断断续续
  const voices = window.speechSynthesis.getVoices();
  const localZhVoice = voices.find((v) => v.lang.includes("zh") && v.localService);
  if (localZhVoice) {
    utter.voice = localZhVoice;
  }

  isSpeaking = true;
  utter.onend = () => {
    isSpeaking = false;
    processSpeechQueue();
  };
  utter.onerror = () => {
    isSpeaking = false;
    processSpeechQueue();
  };

  window.speechSynthesis.speak(utter);
}

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}

function initAudioTestButtons() {
  document.getElementById("btnTestBeep").addEventListener("click", () => {
    playBeep(880, 160, 2);
    showToast("已触发滴滴提示音");
  });

  document.getElementById("btnTestVoice").addEventListener("click", () => {
    speakText("语音引擎正常，开始计数：1，2，3", true);
  });
}

// ==========================================
// 需求5：动作元件与“纯视频跟练”参数变灰失效逻辑
// ==========================================
function loadActions() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_ACTIONS);
    actions = saved ? JSON.parse(saved) : [...DEFAULT_ACTIONS];
  } catch (e) {
    actions = [...DEFAULT_ACTIONS];
  }
}

function saveActions() {
  const serializable = actions.map((item) => ({
    ...item,
    // Blob URL 仅在当前会话有效，刷新后不持久化无效指针
    videoUrl: item.videoUrl && item.videoUrl.startsWith("blob:") ? "" : item.videoUrl
  }));
  localStorage.setItem(STORAGE_KEY_ACTIONS, JSON.stringify(serializable));
}

function initActionForm() {
  const chkPureVideo = document.getElementById("chkPureVideoMode");
  const paramGroupBox = document.getElementById("paramGroupBox");
  const paramInputs = paramGroupBox.querySelectorAll("input");

  // 勾选“纯视频跟练”后，其他参数全部变灰失效
  chkPureVideo.addEventListener("change", () => {
    const isPure = chkPureVideo.checked;
    paramGroupBox.classList.toggle("disabled-group", isPure);
    paramInputs.forEach((inp) => {
      inp.disabled = isPure;
    });
  });

  document.getElementById("actionForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("inputActionName").value.trim();
    const fileInput = document.getElementById("inputVideoFile");
    const isPureVideo = chkPureVideo.checked;

    let videoUrl = "";
    let videoName = "";
    if (fileInput.files && fileInput.files[0]) {
      const file = fileInput.files[0];
      videoUrl = URL.createObjectURL(file);
      videoName = file.name;
      appendTempLog(`加载本地视频缓存: ${file.name} (${Math.round(file.size / 1024)}KB)`);
    }

    const newAction = {
      id: "act-" + Date.now(),
      name: name || "未命名气功动作",
      pureVideo: isPureVideo,
      duration: isPureVideo ? 0 : Math.max(5, Number(document.getElementById("inputDuration").value) || 30),
      reps: isPureVideo ? 0 : Math.max(0, Number(document.getElementById("inputReps").value) || 0),
      rest: isPureVideo ? 0 : Math.max(0, Number(document.getElementById("inputRest").value) || 10),
      videoUrl,
      videoName
    };

    actions.push(newAction);
    saveActions();
    renderRoutineList();

    // 重置表单并恢复参数输入框状态
    e.target.reset();
    paramGroupBox.classList.remove("disabled-group");
    paramInputs.forEach((inp) => (inp.disabled = false));

    showToast("动作元件已添加");
    switchView("view-home", true);
  });
}

function renderRoutineList() {
  const listEl = document.getElementById("routineList");
  listEl.innerHTML = "";

  actions.forEach((act, idx) => {
    const li = document.createElement("li");
    li.className = "routine-item";

    const metaText = act.pureVideo
      ? `模式：纯视频跟练（参数已忽略）${act.videoName ? " · 视频：" + act.videoName : ""}`
      : `时长 ${act.duration}秒 · 计数 ${act.reps > 0 ? act.reps + "次" : "无"} · 组间休息 ${act.rest}秒`;

    li.innerHTML = `
      <div>
        <strong>${idx + 1}. ${act.name}</strong>
        <div class="routine-meta">${metaText}</div>
      </div>
      <button class="btn ghost small" data-del-id="${act.id}">删除</button>
    `;

    li.querySelector("button").addEventListener("click", () => {
      if (act.videoUrl && act.videoUrl.startsWith("blob:")) {
        URL.revokeObjectURL(act.videoUrl);
      }
      actions = actions.filter((a) => a.id !== act.id);
      saveActions();
      renderRoutineList();
      showToast("已移除该动作");
    });

    listEl.appendChild(li);
  });
}

// ==========================================
// 需求3 & 需求8：组间休息滴滴倒计时 + 退出彻底关闭视频声音
// ==========================================
function initPlayerControls() {
  document.getElementById("btnStartWorkout").addEventListener("click", () => {
    if (actions.length === 0) {
      showToast("请先添加至少一个动作元件");
      return;
    }
    startWorkout();
  });

  document.getElementById("btnExitPlayer").addEventListener("click", () => {
    exitWorkout();
  });

  document.getElementById("btnPauseResume").addEventListener("click", () => {
    togglePauseWorkout();
  });

  document.getElementById("btnPrevStep").addEventListener("click", () => {
    if (playerState.stepIndex > 0) {
      runActionStep(playerState.stepIndex - 1);
    }
  });

  document.getElementById("btnNextStep").addEventListener("click", () => {
    advanceNextStep();
  });

  // 监听页面隐藏/切后台/关闭，确保视频声音不会后台残留
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      const videoEl = document.getElementById("actionVideo");
      if (videoEl && !videoEl.paused) {
        videoEl.pause();
      }
    }
  });

  window.addEventListener("pagehide", stopAndCleanupVideo);
  window.addEventListener("beforeunload", stopAndCleanupVideo);
}

function stopAndCleanupVideo() {
  const videoEl = document.getElementById("actionVideo");
  const videoWrapper = document.getElementById("videoWrapper");
  if (videoEl) {
    try {
      videoEl.pause();
      videoEl.muted = true;
      videoEl.currentTime = 0;
      videoEl.removeAttribute("src");
      videoEl.load();
    } catch (e) {
      console.warn("清理视频播放器异常:", e);
    }
  }
  if (videoWrapper) {
    videoWrapper.classList.add("hidden");
  }
}

function startWorkout() {
  playerState.active = true;
  playerState.paused = false;
  document.getElementById("playerPanel").classList.remove("hidden");
  document.getElementById("btnPauseResume").textContent = "暂停";
  runActionStep(0);
}

function exitWorkout() {
  clearInterval(playerState.timerHandle);
  playerState.active = false;
  playerState.paused = false;
  playerState.isResting = false;

  // 需求8：退出时彻底停止语音与视频音轨
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    speechQueue.length = 0;
    isSpeaking = false;
  }
  stopAndCleanupVideo();

  document.getElementById("playerPanel").classList.add("hidden");
  showToast("已退出训练并关闭所有音视频");
}

function togglePauseWorkout() {
  if (!playerState.active) return;
  playerState.paused = !playerState.paused;
  const videoEl = document.getElementById("actionVideo");

  if (playerState.paused) {
    document.getElementById("btnPauseResume").textContent = "继续";
    if (videoEl && !videoEl.paused) videoEl.pause();
    if ("speechSynthesis" in window) window.speechSynthesis.pause();
  } else {
    document.getElementById("btnPauseResume").textContent = "暂停";
    if (videoEl && videoEl.src) videoEl.play().catch(() => {});
    if ("speechSynthesis" in window) window.speechSynthesis.resume();
  }
}

function runActionStep(index) {
  clearInterval(playerState.timerHandle);
  stopAndCleanupVideo();

  if (index >= actions.length) {
    speakText("恭喜，今日全部气功太极训练已完成！", true);
    playBeep(1046, 220, 2);
    exitWorkout();
    return;
  }

  const act = actions[index];
  playerState.stepIndex = index;
  playerState.isResting = false;
  playerState.currentRep = 0;

  document.getElementById("playerStepTag").textContent = `动作 ${index + 1}/${actions.length}`;
  document.getElementById("playerActionTitle").textContent = act.name;

  const videoEl = document.getElementById("actionVideo");
  const videoWrapper = document.getElementById("videoWrapper");

  if (act.videoUrl) {
    videoWrapper.classList.remove("hidden");
    videoEl.muted = false;
    videoEl.src = act.videoUrl;
    videoEl.play().catch(() => {});
  }

  // 纯视频跟练模式：不启用参数计数与组间休息
  if (act.pureVideo) {
    document.getElementById("playerActionDesc").textContent = "纯视频跟练模式（已跳过参数计时）";
    document.getElementById("timerModeLabel").textContent = "跟随视频练习中";
    document.getElementById("timerValue").textContent = "跟练";
    document.getElementById("timerUnit").textContent = "视频播放完毕自动进入下一项";
    speakText(`开始纯视频跟练：${act.name}`, true);

    if (act.videoUrl) {
      videoEl.onended = () => {
        if (playerState.active) runActionStep(index + 1);
      };
    }
    return;
  }

  // 常规参数模式
  playerState.remainingSec = act.duration;
  const repInterval = act.reps > 0 ? Math.max(2, Math.floor(act.duration / act.reps)) : 0;

  document.getElementById("playerActionDesc").textContent =
    act.reps > 0 ? `目标计数：${act.reps} 次` : "保持深呼吸，平稳完成动作";
  document.getElementById("timerModeLabel").textContent = "动作进行中";
  document.getElementById("timerValue").textContent = String(playerState.remainingSec);
  document.getElementById("timerUnit").textContent =
    act.reps > 0 ? `秒（计数 0/${act.reps}）` : "秒";

  speakText(`开始第${index + 1}个动作，${act.name}`, true);

  playerState.timerHandle = setInterval(() => {
    if (!playerState.active || playerState.paused) return;

    playerState.remainingSec -= 1;
    const elapsed = act.duration - playerState.remainingSec;

    // 语音计数播报
    if (repInterval > 0 && elapsed > 0 && elapsed % repInterval === 0 && playerState.currentRep < act.reps) {
      playerState.currentRep += 1;
      speakText(`${playerState.currentRep}`, false);
    }

    document.getElementById("timerValue").textContent = String(Math.max(0, playerState.remainingSec));
    document.getElementById("timerUnit").textContent =
      act.reps > 0 ? `秒（计数 ${playerState.currentRep}/${act.reps}）` : "秒";

    // 最后3秒滴滴提示
    if (playerState.remainingSec > 0 && playerState.remainingSec <= 3) {
      playBeep(760, 120, 1);
    }

    if (playerState.remainingSec <= 0) {
      clearInterval(playerState.timerHandle);
      stopAndCleanupVideo();

      // 判断是否需要进入组间休息倒计时
      if (act.rest > 0 && index < actions.length - 1) {
        startRestCountdown(act.rest, index + 1);
      } else {
        runActionStep(index + 1);
      }
    }
  }, 1000);
}

// 需求3：组间休息倒计时与滴滴提醒
function startRestCountdown(restSeconds, nextActionIndex) {
  playerState.isResting = true;
  playerState.remainingSec = restSeconds;

  const nextAct = actions[nextActionIndex];
  document.getElementById("timerModeLabel").textContent = "组间休息倒计时";
  document.getElementById("playerActionTitle").textContent = `休息调整 · 下一项：${nextAct.name}`;
  document.getElementById("timerValue").textContent = String(restSeconds);
  document.getElementById("timerUnit").textContent = "秒后自动开始下一个动作";

  playBeep(660, 180, 1);
  speakText(`组间休息 ${restSeconds} 秒，下一个动作是 ${nextAct.name}`, true);

  playerState.timerHandle = setInterval(() => {
    if (!playerState.active || playerState.paused) return;

    playerState.remainingSec -= 1;
    document.getElementById("timerValue").textContent = String(Math.max(0, playerState.remainingSec));

    // 休息结束前 3、2、1 秒发出清脆滴滴声
    if (playerState.remainingSec > 0 && playerState.remainingSec <= 3) {
      playBeep(980, 150, 1);
    }

    if (playerState.remainingSec <= 0) {
      clearInterval(playerState.timerHandle);
      playBeep(1180, 240, 2);
      runActionStep(nextActionIndex);
    }
  }, 1000);
}

function advanceNextStep() {
  if (!playerState.active) return;
  if (playerState.isResting) {
    runActionStep(playerState.stepIndex + 1);
  } else {
    const act = actions[playerState.stepIndex];
    if (act && act.rest > 0 && playerState.stepIndex < actions.length - 1) {
      startRestCountdown(act.rest, playerState.stepIndex + 1);
    } else {
      runActionStep(playerState.stepIndex + 1);
    }
  }
}

// ==========================================
// 需求6：手机缓存分级清理（有用 vs 无用）
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
  document.getElementById("btnScanCache").addEventListener("click", () => {
    scanCacheSizes();
    showToast("缓存扫描已完成");
  });

  document.getElementById("btnCleanCache").addEventListener("click", async () => {
    const cleanUseful = document.getElementById("chkCacheUseful").checked;
    const cleanUseless = document.getElementById("chkCacheUseless").checked;

    if (!cleanUseful && !cleanUseless) {
      showToast("请至少勾选一项要清理的缓存类别");
      return;
    }

    if (cleanUseless) {
      localStorage.removeItem(STORAGE_KEY_LOGS);
      if ("caches" in window) {
        const keys = await caches.keys();
        for (const key of keys) {
          if (!key.startsWith(USEFUL_CACHE_PREFIX)) {
            await caches.delete(key);
          }
        }
      }
    }

    if (cleanUseful) {
      localStorage.removeItem(STORAGE_KEY_ACTIONS);
      actions = [...DEFAULT_ACTIONS];
      renderRoutineList();
      if ("caches" in window) {
        const keys = await caches.keys();
        for (const key of keys) {
          if (key.startsWith(USEFUL_CACHE_PREFIX)) {
            await caches.delete(key);
          }
        }
      }
    }

    await scanCacheSizes();
    showToast("所选缓存已清理完毕");
  });
}

async function scanCacheSizes() {
  let usefulBytes = new Blob([localStorage.getItem(STORAGE_KEY_ACTIONS) || ""]).size;
  let uselessBytes = new Blob([localStorage.getItem(STORAGE_KEY_LOGS) || ""]).size;

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

  document.getElementById("sizeUseful").textContent = formatBytes(usefulBytes);
  document.getElementById("sizeUseless").textContent = formatBytes(uselessBytes);
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
      `导出时间：${new Date().toLocaleString()}`,
      `动作总数：${actions.length} 项`,
      `------------------------`,
      ...actions.map((a, idx) => {
        if (a.pureVideo) {
          return `${idx + 1}. ${a.name} | 模式：纯视频跟练`;
        }
        return `${idx + 1}. ${a.name} | 时长：${a.duration}秒 | 计数：${a.reps}次 | 组间休息：${a.rest}秒`;
      }),
      `------------------------`,
      `请作为中医养生与太极气功教练，分析以上训练编排的强度、经络覆盖合理性，并给出改进建议：`
    ];

    const exportText = summaryLines.join("\n");

    try {
      await navigator.clipboard.writeText(exportText);
      showToast("训练数据已复制，正在打开 DeepSeek...");
    } catch (err) {
      // 降级复制兼容方案
      const textarea = document.createElement("textarea");
      textarea.value = exportText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      showToast("数据已复制，正在跳转 DeepSeek...");
    }

    setTimeout(() => {
      window.open("https://chat.deepseek.com/", "_blank", "noopener,noreferrer");
    }, 450);
  };

  document.getElementById("btnCopyDeepseek").addEventListener("click", handleExport);
  document.getElementById("btnSettingsDeepseek").addEventListener("click", handleExport);
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 2400);
}
