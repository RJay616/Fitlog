'use strict';

const DB_NAME = 'fitlog-db';
const DB_VERSION = 1;
const STORES = ['exercises', 'plans', 'sessions'];
let db;
let currentPage = 'home';
let toastTimer;
let deferredInstallPrompt = null;
let runner = null;
let timerHandle = null;

const $ = id => document.getElementById(id);
const makeId = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const nowIso = () => new Date().toISOString();
const dateLabel = value => new Date(value).toLocaleString('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('当前浏览器不支持 IndexedDB'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('exercises')) database.createObjectStore('exercises', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('plans')) database.createObjectStore('plans', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('sessions')) database.createObjectStore('sessions', { keyPath: 'id' });
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
function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 0.92;
  window.speechSynthesis.speak(utterance);
}
function openDialog(id) { const dialog = $(id); if (dialog && !dialog.open) dialog.showModal(); }
function closeDialog(id) { const dialog = $(id); if (dialog && dialog.open) dialog.close(); }

async function seedData() {
  const exercises = await getAll('exercises');
  if (exercises.length) return;
  const samples = [
    ['俯卧撑','胸部','reps','双手略宽于肩，身体保持一条直线。下降时控制速度，推起时呼气。','身体保持稳定，发力时呼气。'],
    ['徒手深蹲','腿部','reps','双脚与肩同宽，膝盖朝脚尖方向，臀部向后向下坐。','下蹲吸气，站起时呼气，膝盖不要明显内扣。'],
    ['臀桥','臀部','reps','仰卧屈膝，脚掌踩稳地面，抬起髋部时避免腰部过度反弓。','顶起时呼气并收紧臀部，下放时吸气。'],
    ['平板支撑','核心','time','肘部位于肩膀下方，头、背、髋保持自然直线。','均匀呼吸，不要憋气。'],
    ['弹力带划船','背部','reps','肩膀放松，肘部向身体后方拉，避免耸肩和身体后仰。','拉动时呼气，缓慢回程时吸气。'],
    ['弹力带后踢腿','臀部','side','骨盆保持稳定，腿向后伸展，不要用腰部甩动。','后踢时呼气，缓慢回收时吸气。'],
    ['提踵','腿部','reps','扶稳支撑物，脚跟缓慢抬起，再控制下降。','抬起时呼气，下降时吸气。'],
    ['死虫式','核心','side','仰卧，腰背保持稳定，对侧手脚缓慢伸展。','伸展时呼气，回收时吸气。']
  ];
  for (const [name,muscle,type,notes,cue] of samples) await put('exercises', {id:makeId(),name,muscle,type,notes,cue,createdAt:nowIso(),builtIn:true});
}

function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.id === `page-${page}`));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  if (page === 'home') renderHome();
  if (page === 'exercises') renderExercises();
  if (page === 'plans') renderPlans();
  if (page === 'history') renderHistory();
  if (page === 'data') updateStorageStatus();
  window.scrollTo({top:0,behavior:'smooth'});
}

async function renderHome() {
  const sessions = (await getAll('sessions')).sort((a,b) => new Date(b.startedAt)-new Date(a.startedAt));
  const now = new Date();
  const startOfWeek = new Date(now);
  const day = (now.getDay()+6)%7;
  startOfWeek.setHours(0,0,0,0); startOfWeek.setDate(now.getDate()-day);
  const weekly = sessions.filter(s => new Date(s.startedAt) >= startOfWeek);
  const minutes = weekly.reduce((sum,s) => sum + (Number(s.durationSeconds)||0),0);
  $('weekSessions').textContent = weekly.length;
  $('weekMinutes').textContent = Math.round(minutes/60);
  $('totalSessions').textContent = sessions.length;
  const recent = $('recentSessions');
  if (!sessions.length) { recent.className='list-card empty-state'; recent.textContent='还没有训练记录，完成第一次训练后会显示在这里。'; return; }
  recent.className='stack-list';
  recent.innerHTML = sessions.slice(0,3).map(sessionCardHtml).join('');
}
function sessionCardHtml(s) {
  const names = (s.exercises||[]).map(e=>e.name).join('、');
  return `<article class="item-card"><div class="session-date">${escapeHtml(dateLabel(s.startedAt))}</div><div class="session-title">${escapeHtml(s.planName || '自由训练')}</div><div class="session-meta">${Math.round((s.durationSeconds||0)/60)} 分钟 · ${(s.exercises||[]).length} 个动作</div><div class="session-exercises">${escapeHtml(names || '无动作明细')}</div><div class="card-actions"><button class="small-btn" data-session-detail="${escapeHtml(s.id)}">查看详情</button></div></article>`;
}

async function renderExercises() {
  const all = await getAll('exercises');
  const query = $('exerciseSearch').value.trim().toLowerCase();
  const muscle = $('muscleFilter').value;
  const filtered = all.filter(e => (muscle==='全部'||e.muscle===muscle) && (!query || `${e.name} ${e.muscle} ${e.notes}`.toLowerCase().includes(query))).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  $('exerciseList').innerHTML = filtered.length ? filtered.map(e=>`<article class="item-card"><div class="item-top"><div><h3>${escapeHtml(e.name)}</h3><span class="tag">${escapeHtml(e.muscle)}</span><span class="tag">${typeLabel(e.type)}</span></div></div><p>${escapeHtml(e.notes || '暂无动作说明')}</p><div class="card-actions"><button class="small-btn blue" data-exercise-detail="${escapeHtml(e.id)}">动作详情</button><button class="small-btn" data-edit-exercise="${escapeHtml(e.id)}">编辑</button><button class="small-btn" data-delete-exercise="${escapeHtml(e.id)}">删除</button></div></article>`).join('') : '<div class="list-card empty-state">没有找到动作。你可以添加自己的动作。</div>';
}
function typeLabel(type) { return ({reps:'次数型',weight:'负重型',time:'时间型',side:'左右侧型'})[type] || '次数型'; }
function openExerciseEditor(exercise=null) {
  $('exerciseDialogTitle').textContent = exercise ? '编辑动作' : '添加动作';
  $('exerciseId').value = exercise?.id || '';
  $('exerciseName').value = exercise?.name || '';
  $('exerciseMuscle').value = exercise?.muscle || '胸部';
  $('exerciseType').value = exercise?.type || 'reps';
  $('exerciseNotes').value = exercise?.notes || '';
  $('exerciseCue').value = exercise?.cue || '';
  openDialog('exerciseDialog');
}
async function saveExercise(event) {
  event.preventDefault();
  const id = $('exerciseId').value || makeId();
  const old = (await getAll('exercises')).find(e=>e.id===id);
  await put('exercises',{id,name:$('exerciseName').value.trim(),muscle:$('exerciseMuscle').value,type:$('exerciseType').value,notes:$('exerciseNotes').value.trim(),cue:$('exerciseCue').value.trim(),createdAt:old?.createdAt||nowIso(),builtIn:false});
  closeDialog('exerciseDialog'); await renderExercises(); showToast('动作已保存');
}
async function showExerciseDetail(id) {
  const exercise = (await getAll('exercises')).find(e=>e.id===id); if(!exercise) return;
  const sessions = await getAll('sessions');
  const records=[];
  sessions.forEach(s=>(s.exercises||[]).forEach(e=>{if(e.exerciseId===id) records.push({date:s.startedAt,...e});}));
  records.sort((a,b)=>new Date(b.date)-new Date(a.date));
  $('detailTitle').textContent=exercise.name;
  $('detailContent').innerHTML=`<div class="detail-line"><b>主要肌群：</b>${escapeHtml(exercise.muscle)}　<b>类型：</b>${typeLabel(exercise.type)}</div><div class="detail-line"><b>动作要领</b><br>${escapeHtml(exercise.notes||'暂无')}</div><div class="detail-line"><b>语音提示</b><br>${escapeHtml(exercise.cue||'暂无')}</div><div class="detail-line"><b>历史训练</b><br>${records.length?records.slice(0,8).map(r=>`${escapeHtml(dateLabel(r.date))} · ${escapeHtml((r.sets||[]).map(x=>x.reps!=null?`${x.reps}次`:x.durationSeconds?`${x.durationSeconds}秒`:'已记录').join(' / '))}`).join('<br>'):'暂无训练记录'}</div>`;
  openDialog('detailDialog');
}

async function renderPlans() {
  const plans=(await getAll('plans')).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
  const exercises=await getAll('exercises'); const map=new Map(exercises.map(e=>[e.id,e]));
  $('planList').innerHTML=plans.length?plans.map(p=>`<article class="item-card"><div class="item-top"><div><h3>${escapeHtml(p.name)}</h3><p>${(p.items||[]).map(i=>escapeHtml(map.get(i.exerciseId)?.name||'已删除动作')).join('、')}</p></div><span class="tag">${(p.items||[]).length}个动作</span></div><div class="card-actions"><button class="small-btn blue" data-start-plan="${escapeHtml(p.id)}">开始训练</button><button class="small-btn" data-edit-plan="${escapeHtml(p.id)}">编辑</button><button class="small-btn" data-delete-plan="${escapeHtml(p.id)}">删除</button></div></article>`).join(''):'<div class="list-card empty-state">还没有训练课程。点击右上角新建第一套课程。</div>';
}
async function openPlanEditor(plan=null) {
  const exercises=(await getAll('exercises')).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  $('planDialogTitle').textContent=plan?'编辑课程':'新建课程'; $('planId').value=plan?.id||''; $('planName').value=plan?.name||'';
  const selected=new Map((plan?.items||[]).map(i=>[i.exerciseId,i]));
  $('planExerciseChoices').innerHTML=exercises.map(e=>{const item=selected.get(e.id);return `<label class="choice-row"><input type="checkbox" value="${escapeHtml(e.id)}" ${item?'checked':''}><span><b>${escapeHtml(e.name)}</b><small style="display:block;color:#8190a2;margin-top:3px">${escapeHtml(e.muscle)} · ${typeLabel(e.type)}</small><span class="choice-extra" data-extra="${escapeHtml(e.id)}" style="display:${item?'grid':'none'};grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px"><input aria-label="组数" type="number" min="1" max="20" value="${item?.sets||3}" placeholder="组数"><input aria-label="次数或秒数" type="number" min="1" max="999" value="${item?.target|| (e.type==='time'?30:12)}" placeholder="次数/秒"><input aria-label="休息秒数" type="number" min="0" max="600" value="${item?.restSeconds??60}" placeholder="休息秒"></span></span></label>`;}).join('')||'<p class="empty-state">请先在动作库添加动作。</p>';
  $('planExerciseChoices').querySelectorAll('input[type=checkbox]').forEach(box=>box.addEventListener('change',()=>{const extra=$('planExerciseChoices').querySelector(`[data-extra="${CSS.escape(box.value)}"]`);if(extra)extra.style.display=box.checked?'grid':'none';}));
  openDialog('planDialog');
}
async function savePlan(event) {
  event.preventDefault();
  const exercises=await getAll('exercises'); const byId=new Map(exercises.map(e=>[e.id,e]));
  const oldId=$('planId').value; const old=(await getAll('plans')).find(p=>p.id===oldId);
  const items=[];
  $('planExerciseChoices').querySelectorAll('input[type=checkbox]:checked').forEach(box=>{
    const extra=$('planExerciseChoices').querySelector(`[data-extra="${CSS.escape(box.value)}"]`);const inputs=extra?extra.querySelectorAll('input'):[];
    items.push({exerciseId:box.value,sets:clampInt(inputs[0]?.value,1,20,3),target:clampInt(inputs[1]?.value,1,999,12),restSeconds:clampInt(inputs[2]?.value,0,600,60)});
  });
  if(!items.length){showToast('请至少选择一个动作');return;}
  if(items.some(i=>!byId.has(i.exerciseId))){showToast('课程中有不存在的动作，请重新选择');return;}
  await put('plans',{id:oldId||makeId(),name:$('planName').value.trim(),items,createdAt:old?.createdAt||nowIso(),updatedAt:nowIso()});
  closeDialog('planDialog');await renderPlans();showToast('课程已保存');
}
function clampInt(value,min,max,fallback){const n=Number.parseInt(value,10);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;}

async function startPlan(id) {
  const plan=(await getAll('plans')).find(p=>p.id===id);if(!plan)return;
  const all=await getAll('exercises');const map=new Map(all.map(e=>[e.id,e]));
  const items=plan.items.map(i=>({...i,exercise:map.get(i.exerciseId)})).filter(i=>i.exercise);
  if(!items.length){showToast('课程没有可用动作');return;}
  runner={planId:plan.id,planName:plan.name,items,index:0,setIndex:1,session:{id:makeId(),planId:plan.id,planName:plan.name,startedAt:nowIso(),endedAt:null,durationSeconds:0,exercises:[]},phase:'prepare',remaining:5,interval:null};
  $('runnerPlanName').textContent=plan.name;renderRunner();openDialog('runnerDialog');
  speak(`开始训练，${plan.name}。第一个动作，${items[0].exercise.name}。`);
}
function currentRunnerItem(){return runner?.items[runner.index];}
function renderRunner(){
  if(!runner)return;
  const item=currentRunnerItem();const exercise=item.exercise;
  const total=runner.items.reduce((sum,i)=>sum+i.sets,0);const completed=runner.items.slice(0,runner.index).reduce((sum,i)=>sum+i.sets,0)+runner.setIndex-1;
  $('runnerProgressBar').style.width=`${Math.min(100,completed/total*100)}%`;
  $('runnerBody').innerHTML=`<div class="runner-kicker">动作 ${runner.index+1} / ${runner.items.length}　·　第 ${runner.setIndex} / ${item.sets} 组</div><h2>${escapeHtml(exercise.name)}</h2><p class="runner-cue">${escapeHtml(exercise.cue||exercise.notes||'按照自己的能力完成动作，保持稳定呼吸。')}</p><div class="runner-label">${runner.phase==='rest'?'组间休息':runner.phase==='prepare'?'动作准备':runner.phase==='done'?'训练完成':'本组完成后记录数据'}</div><div class="runner-number" id="runnerNumber">${runner.phase==='rest'||runner.phase==='prepare'?runner.remaining:runner.phase==='done'?'✓':'准备好了？'}</div>${runner.phase==='prepare'?`<div class="runner-controls"><button class="alt" id="skipPrepareBtn">跳过准备</button></div>`:runner.phase==='work'?`<div class="runner-inputs">${exercise.type==='side'?`<label>左侧次数<input id="actualLeft" type="number" min="0" max="9999" value="${item.target}" inputmode="numeric"></label><label>右侧次数<input id="actualRight" type="number" min="0" max="9999" value="${item.target}" inputmode="numeric"></label>`:`<label>${exercise.type==='time'?'完成时长（秒）':'完成次数'}<input id="actualValue" type="number" min="0" max="9999" value="${item.target}" inputmode="numeric"></label><label>重量（kg）<input id="actualWeight" type="number" min="0" max="9999" step="0.1" value="0" inputmode="decimal"></label>`}</div><div class="runner-controls"><button class="alt" id="runnerCueBtn">语音提示</button><button class="main" id="completeSetBtn">完成本组</button></div>`:runner.phase==='rest'?`<div class="runner-controls"><button class="alt" id="skipRestBtn">跳过休息</button><button class="main" id="pauseRestBtn">暂停计时</button></div>`:`<div class="runner-controls"><button class="main" id="finishSessionBtn">保存并结束</button></div>`}`;
  if(runner.phase==='prepare'){
    $('skipPrepareBtn').onclick=()=>{stopRunnerTimer();runner.phase='work';renderRunner();};
    startPrepareTimer();
  } else if(runner.phase==='work'){
    $('runnerCueBtn').onclick=()=>speak(exercise.cue||exercise.notes||exercise.name);
    $('completeSetBtn').onclick=completeSet;
  } else if(runner.phase==='rest'){
    $('skipRestBtn').onclick=()=>{stopRunnerTimer();advanceRunner();};
    $('pauseRestBtn').onclick=()=>{if(timerHandle){stopRunnerTimer();$('pauseRestBtn').textContent='继续计时';$('pauseRestBtn').onclick=startRestTimer;}else{startRestTimer();$('pauseRestBtn').textContent='暂停计时';$('pauseRestBtn').onclick=()=>{stopRunnerTimer();$('pauseRestBtn').textContent='继续计时';$('pauseRestBtn').onclick=startRestTimer;};}};
    startRestTimer();
  } else if(runner.phase==='done') $('finishSessionBtn').onclick=finishSession;
}
function completeSet(){
  const item=currentRunnerItem();const exercise=item.exercise;
  const isSide=exercise.type==='side';const actual=isSide?null:clampInt($('actualValue').value,0,9999,0);const left=isSide?clampInt($('actualLeft').value,0,9999,0):null;const right=isSide?clampInt($('actualRight').value,0,9999,0):null;const weight=isSide?0:Math.max(0,Number($('actualWeight').value)||0);
  if(isSide?(left<=0||right<=0):(actual<=0)){showToast('请输入本组实际完成数据');return;}
  let exerciseRecord=runner.session.exercises.find(e=>e.exerciseId===exercise.id);
  if(!exerciseRecord){exerciseRecord={exerciseId:exercise.id,name:exercise.name,type:exercise.type,sets:[]};runner.session.exercises.push(exerciseRecord);}
  exerciseRecord.sets.push({setNumber:runner.setIndex,reps:exercise.type==='time'||isSide?null:actual,leftReps:left,rightReps:right,durationSeconds:exercise.type==='time'?actual:null,weightKg:weight,completedAt:nowIso()});
  speak('本组完成，做得不错。');
  if(runner.setIndex<item.sets && item.restSeconds>0){runner.phase='rest';runner.remaining=item.restSeconds;renderRunner();}
  else advanceRunner();
}
function advanceRunner(){
  stopRunnerTimer();const item=currentRunnerItem();
  if(runner.setIndex<item.sets){runner.setIndex++;runner.phase='prepare';runner.remaining=5;renderRunner();speak(`第${runner.setIndex}组，准备开始。`);return;}
  if(runner.index<runner.items.length-1){runner.index++;runner.setIndex=1;runner.phase='prepare';runner.remaining=5;renderRunner();speak(`下一个动作，${currentRunnerItem().exercise.name}，准备开始。`);return;}
  runner.phase='done';renderRunner();speak('训练课程已经完成。');
}
function startPrepareTimer(){
  if(!runner||runner.phase!=='prepare'||timerHandle)return;
  timerHandle=setInterval(()=>{runner.remaining=Math.max(0,runner.remaining-1);const num=$('runnerNumber');if(num)num.textContent=runner.remaining;if(runner.remaining<=0){stopRunnerTimer();runner.phase='work';renderRunner();speak('准备完成，开始动作。');}},1000);
}
function startRestTimer(){
  if(!runner||runner.phase!=='rest'||timerHandle)return;
  timerHandle=setInterval(()=>{runner.remaining=Math.max(0,runner.remaining-1);const num=$('runnerNumber');if(num)num.textContent=runner.remaining;if(runner.remaining<=0){stopRunnerTimer();speak('休息结束，准备下一组。');advanceRunner();}},1000);
}
function stopRunnerTimer(){if(timerHandle){clearInterval(timerHandle);timerHandle=null;}}
async function finishSession(){
  if(!runner)return;stopRunnerTimer();
  const ended=Date.now();runner.session.endedAt=new Date(ended).toISOString();runner.session.durationSeconds=Math.max(0,Math.round((ended-new Date(runner.session.startedAt).getTime())/1000));
  await put('sessions',runner.session);runner=null;closeDialog('runnerDialog');showToast('训练记录已保存');await renderHome();if(currentPage==='history')await renderHistory();
}
function closeRunner(){if(!runner){closeDialog('runnerDialog');return;}if(confirm('训练尚未结束。确定退出吗？当前训练数据将不会保存。')){stopRunnerTimer();window.speechSynthesis?.cancel();runner=null;closeDialog('runnerDialog');}}

async function renderHistory(){
  const sessions=(await getAll('sessions')).sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt));
  $('historyTotal').textContent=sessions.length;$('historyMinutes').textContent=Math.round(sessions.reduce((sum,s)=>sum+(s.durationSeconds||0),0)/60);
  $('historyList').innerHTML=sessions.length?sessions.map(sessionCardHtml).join(''):'<div class="list-card empty-state">还没有训练记录。</div>';
}
async function showSessionDetail(id){
  const s=(await getAll('sessions')).find(x=>x.id===id);if(!s)return;
  $('detailTitle').textContent=s.planName||'训练详情';
  const lines=(s.exercises||[]).map(e=>`<div class="detail-line"><b>${escapeHtml(e.name)}</b><br>${(e.sets||[]).map(set=>`第${set.setNumber}组：${set.leftReps!=null?`左${set.leftReps}次 / 右${set.rightReps}次`:set.reps!=null?`${set.reps}次`:`${set.durationSeconds}秒`}${set.weightKg?` · ${set.weightKg}kg`:''}`).join('<br>')}</div>`).join('');
  $('detailContent').innerHTML=`<div class="detail-line">${escapeHtml(dateLabel(s.startedAt))}<br>训练时长：${Math.round((s.durationSeconds||0)/60)}分钟</div>${lines||'<p>没有详细动作数据</p>'}`;openDialog('detailDialog');
}

function downloadFile(filename,content,mime){
  const blob=new Blob([content],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
async function exportJson(){
  const backup={app:'FitLog',version:1,exportedAt:nowIso(),exercises:await getAll('exercises'),plans:await getAll('plans'),sessions:await getAll('sessions')};
  downloadFile(`fitlog-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(backup,null,2),'application/json');showToast('JSON备份已导出');
}
async function exportCsv(){
  const sessions=await getAll('sessions');const rows=[['训练日期','课程','动作','组数','组序号','次数','左侧次数','右侧次数','时长秒','重量kg']];
  sessions.forEach(s=>(s.exercises||[]).forEach(e=>(e.sets||[]).forEach(set=>rows.push([s.startedAt,s.planName||'',e.name,(e.sets||[]).length,set.setNumber,set.reps??'',set.leftReps??'',set.rightReps??'',set.durationSeconds??'',set.weightKg??0]))));
  const csv='\uFEFF'+rows.map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');
  downloadFile(`fitlog-training-${new Date().toISOString().slice(0,10)}.csv`,csv,'text/csv;charset=utf-8');showToast('CSV明细已导出');
}
async function importJson(file){
  if(!file)return;
  try{
    const parsed=JSON.parse(await file.text());
    if(!parsed||parsed.app!=='FitLog'||!Array.isArray(parsed.exercises)||!Array.isArray(parsed.plans)||!Array.isArray(parsed.sessions))throw new Error('文件格式不正确，无法识别为FitLog备份');
    if(!confirm(`将恢复 ${parsed.exercises.length} 个动作、${parsed.plans.length} 个课程、${parsed.sessions.length} 条训练记录。恢复会覆盖当前全部数据，确定继续吗？`))return;
    for(const name of STORES)await clearStore(name);
    for(const item of parsed.exercises)if(item&&item.id)await put('exercises',item);
    for(const item of parsed.plans)if(item&&item.id)await put('plans',item);
    for(const item of parsed.sessions)if(item&&item.id)await put('sessions',item);
    showToast('备份恢复成功');await refreshCurrentPage();
  }catch(error){alert(`恢复失败：${error.message}`);}finally{$('importJsonInput').value='';}
}
async function updateStorageStatus(){
  try{const estimate=await navigator.storage?.estimate?.();$('storageStatus').textContent=estimate?`浏览器存储估算：已使用 ${(estimate.usage/1024/1024).toFixed(2)} MB。`:'本地数据库已就绪。';}catch{$('storageStatus').textContent='本地数据库已就绪。';}
}
async function refreshCurrentPage(){await renderHome();if(currentPage==='exercises')await renderExercises();if(currentPage==='plans')await renderPlans();if(currentPage==='history')await renderHistory();if(currentPage==='data')await updateStorageStatus();}

function bindEvents(){
  document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.page)));
  document.querySelectorAll('[data-go]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.go)));
  document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',()=>closeDialog(btn.dataset.close)));
  $('homeStartBtn').addEventListener('click',()=>navigate('plans'));
  $('addExerciseBtn').addEventListener('click',()=>openExerciseEditor());
  $('exerciseForm').addEventListener('submit',saveExercise);
  $('exerciseSearch').addEventListener('input',renderExercises);
  $('muscleFilter').addEventListener('change',renderExercises);
  $('addPlanBtn').addEventListener('click',()=>openPlanEditor());
  $('planForm').addEventListener('submit',savePlan);
  $('runnerCloseBtn').addEventListener('click',closeRunner);
  $('exportJsonBtn').addEventListener('click',exportJson);
  $('exportCsvBtn').addEventListener('click',exportCsv);
  $('importJsonInput').addEventListener('change',event=>importJson(event.target.files?.[0]));
  document.body.addEventListener('click',async event=>{
    const target=event.target.closest('button');if(!target)return;
    if(target.dataset.exerciseDetail)showExerciseDetail(target.dataset.exerciseDetail);
    if(target.dataset.editExercise){const e=(await getAll('exercises')).find(x=>x.id===target.dataset.editExercise);if(e)openExerciseEditor(e);}
    if(target.dataset.deleteExercise){const id=target.dataset.deleteExercise;const plans=await getAll('plans');if(plans.some(p=>p.items.some(i=>i.exerciseId===id))){showToast('该动作正在课程中使用，请先从课程移除');return;}if(confirm('确定删除这个动作吗？')){await remove('exercises',id);await renderExercises();showToast('动作已删除');}}
    if(target.dataset.editPlan){const p=(await getAll('plans')).find(x=>x.id===target.dataset.editPlan);if(p)openPlanEditor(p);}
    if(target.dataset.deletePlan&&confirm('确定删除这套课程吗？')){await remove('plans',target.dataset.deletePlan);await renderPlans();showToast('课程已删除');}
    if(target.dataset.startPlan)startPlan(target.dataset.startPlan);
    if(target.dataset.sessionDetail)showSessionDetail(target.dataset.sessionDetail);
  });
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;$('installBtn').classList.remove('hidden');});
  $('installBtn').addEventListener('click',async()=>{if(!deferredInstallPrompt){showToast('请使用浏览器菜单中的“安装应用”或“添加到主屏幕”');return;}deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;$('installBtn').classList.add('hidden');});
}

async function init(){
  bindEvents();
  try{db=await openDatabase();await seedData();await renderHome();$('storageStatus').textContent='本地数据库已连接。';}
  catch(error){console.error(error);alert(`FitLog初始化失败：${error.message}。请使用较新的Chrome浏览器，并确认未处于无痕模式。`);}
  if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost')){
    navigator.serviceWorker.register('./sw.js').catch(error=>console.warn('Service Worker注册失败',error));
  }
}

document.addEventListener('DOMContentLoaded',init);
