import { authRepository, accessRepository, eventRepository, settingsRepository } from "./repositories.js";

const STORAGE_KEY="uchilog_v1";
const categories={
  cleaning:{label:"掃除",icon:"🧹"},laundry:{label:"洗濯",icon:"🧺"},consumable:{label:"消耗品",icon:"🧴"},
  child:{label:"子ども",icon:"👶"},maintenance:{label:"メンテナンス",icon:"🔧"},memo:{label:"自由メモ",icon:"📝"},
  shopping:{label:"買い物",icon:"🛒"}
};
const fixedQuickItems=[
  {text:"買いたいもの",category:"shopping",action:"shopping-want"},
  {text:"お風呂掃除",category:"cleaning",interval:14},
  {text:"爪切り",category:"child",interval:10}
];

let state={events:[],settings:{householdName:"我が家",quickItems:[]}};
let currentUser=null,currentHistoryFilter="all",receiptItems=[],receiptFile=null;
let unsubscribeEvents=null,unsubscribeSettings=null,authGeneration=0,signInInProgress=false;

const $=id=>document.getElementById(id);
const showOnly=id=>["authLoadingScreen","loginScreen","unauthorizedScreen","appShell"].forEach(x=>$(x).classList.toggle("hidden",x!==id));
const isoToday=()=>new Date().toISOString().slice(0,10);
const uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random();
const fmtDate=d=>new Intl.DateTimeFormat("ja-JP",{month:"numeric",day:"numeric"}).format(new Date(d+"T00:00:00"));
const daysSince=d=>Math.floor((new Date(isoToday())-new Date(d+"T00:00:00"))/86400000);
const escapeHtml=(s="")=>String(s).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const emptyNode=()=>$("emptyTemplate").content.cloneNode(true);
const eventTime=e=>e.createdAt?.toMillis?.()||Date.parse(e.createdAt||0)||0;
const sortedEvents=()=>[...state.events].sort((a,b)=>(b.performedAt||"").localeCompare(a.performedAt||"")||eventTime(b)-eventTime(a));
const entries=()=>sortedEvents().filter(e=>e.action!=="wanted");
const shopping=()=>sortedEvents().filter(e=>e.category==="shopping");

function userFields(){
  return{createdBy:currentUser.uid,createdByName:currentUser.displayName||currentUser.email||"ユーザー"};
}
function setSyncStatus(message,type=""){
  $("syncStatus").textContent=message;
  $("syncStatus").className="sync-status"+(type?` ${type}`:"");
}
function readableError(error){
  console.error(error);
  const code=error?.code?`（${error.code}）`:"";
  return`${error?.message||"不明なエラー"}${code}`;
}
async function saveAction(action){
  setSyncStatus("保存中…");
  try{await action();setSyncStatus("保存成功");setTimeout(()=>navigator.onLine&&setSyncStatus("同期済み"),1200)}
  catch(error){setSyncStatus(`保存失敗：${readableError(error)}`,"error");throw error}
}
function stopDataSubscriptions(){
  unsubscribeEvents?.();unsubscribeSettings?.();unsubscribeEvents=null;unsubscribeSettings=null;
  state={events:[],settings:{householdName:"我が家",quickItems:[]}};
}

async function handleAuthenticatedUser(user,generation){
  showOnly("authLoadingScreen");$("authLoadingMessage").textContent="利用権限を確認中…";
  try{
    const allowed=await accessRepository.getAllowedUser(user.uid);
    if(generation!==authGeneration)return;
    if(!allowed?.active){
      currentUser=null;
      $("deniedName").textContent=user.displayName||"（未設定）";
      $("deniedEmail").textContent=user.email||"（未設定）";
      $("deniedUid").textContent=user.uid;
      showOnly("unauthorizedScreen");
      return;
    }
    currentUser=user;$("currentUserName").textContent=user.displayName||user.email;
    showOnly("appShell");setSyncStatus("データ取得中…");
    let eventsReady=false,settingsReady=false;
    const markReady=()=>{if(eventsReady&&settingsReady)setSyncStatus(navigator.onLine?"同期済み":"オフライン","offline")};
    unsubscribeEvents=eventRepository.subscribe(items=>{
      state.events=items;eventsReady=true;renderAll();markReady();
    },error=>setSyncStatus(`Firestore接続失敗：${readableError(error)}`,"error"));
    unsubscribeSettings=settingsRepository.subscribe(settings=>{
      state.settings={householdName:"我が家",quickItems:[],...settings};
      settingsReady=true;renderAll();markReady();
    },error=>setSyncStatus(`設定の取得失敗：${readableError(error)}`,"error"));
    await offerMigration();
  }catch(error){
    if(generation!==authGeneration)return;
    $("loginError").textContent=`利用権限の確認に失敗しました：${readableError(error)}`;
    $("loginError").classList.remove("hidden");showOnly("loginScreen");
  }
}

async function initializeAuth(){
  try{await authRepository.initialize()}
  catch(error){$("loginError").textContent=`ログイン処理に失敗しました：${readableError(error)}`;$("loginError").classList.remove("hidden")}
  authRepository.subscribeAuthState(user=>{
    const generation=++authGeneration;stopDataSubscriptions();
    if(!user){currentUser=null;showOnly("loginScreen");return}
    handleAuthenticatedUser(user,generation);
  });
}

$("googleSignIn").onclick=async()=>{
  if(signInInProgress)return;
  signInInProgress=true;
  $("loginError").classList.add("hidden");$("googleSignIn").disabled=true;$("googleSignIn").textContent="Googleログイン処理中…";
  try{await authRepository.signIn()}
  catch(error){$("loginError").textContent=`Googleログインに失敗しました：${error?.code||"auth/unknown-error"}: ${error?.message||"不明なエラー"}`;$("loginError").classList.remove("hidden")}
  finally{signInInProgress=false;$("googleSignIn").disabled=false;$("googleSignIn").textContent="Googleでログイン"}
};
async function signOutUser(){
  stopDataSubscriptions();showOnly("authLoadingScreen");$("authLoadingMessage").textContent="ログアウト中…";
  try{await authRepository.signOut()}catch(error){$("authLoadingMessage").textContent=`ログアウト失敗：${readableError(error)}`}
}
$("signOut").onclick=signOutUser;$("deniedSignOut").onclick=signOutUser;
$("copyUid").onclick=async()=>{
  try{await navigator.clipboard.writeText($("deniedUid").textContent);$("copyStatus").textContent="UIDをコピーしました。"}
  catch{$("copyStatus").textContent="コピーできませんでした。UIDを長押ししてコピーしてください。"}
};

function renderAll(){renderStats();renderFavorites();renderShopping();renderDue();renderEntries();renderCategories();renderLastDone();renderHistory()}
function renderStats(){
  $("todayLabel").textContent=new Intl.DateTimeFormat("ja-JP",{month:"long",day:"numeric",weekday:"short"}).format(new Date());
  $("shoppingCount").textContent=shopping().filter(x=>x.action==="wanted").length;
  $("dueCount").textContent=getDueItems().length;
  $("todayCount").textContent=entries().filter(x=>x.performedAt===isoToday()).length;
}
function quickItems(){return Array.isArray(state.settings.quickItems)?state.settings.quickItems.slice(0,3):[]}
function renderFavorites(){
  const el=$("favoriteGrid");el.innerHTML="";
  [...fixedQuickItems,...quickItems()].forEach(item=>{
    const button=document.createElement("button");button.className="favorite-button";
    button.innerHTML=`<span>${categories[item.category]?.icon||"○"}</span><strong>${escapeHtml(item.text)}</strong>`;
    button.onclick=()=>item.action?openEntryForm(item.action):addEntry({item:item.text,category:item.category,interval:item.interval});
    el.appendChild(button);
  });
}
function shoppingCard(item){
  const div=document.createElement("div");div.className="list-card";
  div.innerHTML=`<div class="list-card-main"><div class="badge-icon">🛒</div><div><h3>${escapeHtml(item.item)}</h3><p>${fmtDate(item.performedAt)}に追加</p></div></div><div class="card-actions"><button class="mini-button" data-edit="${item.id}">編集</button><button class="mini-button" data-buy="${item.id}">買った</button><button class="mini-button danger" data-remove-shop="${item.id}">×</button></div>`;
  return div;
}
function renderShopping(){
  const wants=shopping().filter(x=>x.action==="wanted");
  ["homeShoppingList","shoppingList"].forEach(id=>{
    const el=$(id);el.innerHTML="";wants.slice(0,id==="homeShoppingList"?5:999).forEach(x=>el.appendChild(shoppingCard(x)));if(!el.children.length)el.appendChild(emptyNode());
  });
  const bought=$("purchasedList");bought.innerHTML="";
  shopping().filter(x=>x.action==="bought").slice(0,20).forEach(x=>bought.appendChild(timelineNode(x,true)));
  if(!bought.children.length)bought.appendChild(emptyNode());
}
function getLatestByTask(){
  const map=new Map();entries().forEach(e=>{if(e.category!=="shopping"&&!map.has(e.item))map.set(e.item,e)});return[...map.values()];
}
function getDueItems(){return getLatestByTask().filter(e=>e.interval&&daysSince(e.performedAt)>=e.interval).sort((a,b)=>(daysSince(b.performedAt)-b.interval)-(daysSince(a.performedAt)-a.interval))}
function renderDue(){
  const el=$("dueList");el.innerHTML="";
  getDueItems().slice(0,8).forEach(e=>{
    const over=daysSince(e.performedAt)-e.interval,div=document.createElement("div");div.className="list-card";
    div.innerHTML=`<div class="list-card-main"><div class="badge-icon">${categories[e.category]?.icon||"○"}</div><div><h3>${escapeHtml(e.item)}</h3><p>${daysSince(e.performedAt)}日前・目安${e.interval}日${over>0?`（${over}日超過）`:""}</p></div></div><div class="card-actions"><button class="mini-button" data-repeat="${e.id}">今やった</button><button class="mini-button danger" data-delete-entry="${e.id}">削除</button></div>`;
    el.appendChild(div);
  });if(!el.children.length)el.appendChild(emptyNode());
}
function timelineNode(e,withDelete=false){
  const div=document.createElement("div");div.className="timeline-item";
  div.innerHTML=`<div class="badge-icon">${categories[e.category]?.icon||"○"}</div><div><h3>${escapeHtml(e.item)}</h3><p>${categories[e.category]?.label||""}${e.note?"・"+escapeHtml(e.note):""}${e.createdByName?"・"+escapeHtml(e.createdByName):""}</p></div><div class="time">${fmtDate(e.performedAt)}${withDelete?`<br><button class="text-button" data-edit="${e.id}">編集</button><button class="text-button" data-delete-entry="${e.id}">削除</button>`:""}</div>`;
  return div;
}
function renderEntries(){const el=$("recentList");el.innerHTML="";entries().slice(0,8).forEach(e=>el.appendChild(timelineNode(e,true)));if(!el.children.length)el.appendChild(emptyNode())}
function renderCategories(){
  const el=$("categoryGrid");el.innerHTML="";
  Object.entries(categories).filter(([key])=>key!=="shopping").forEach(([key,c])=>{
    const button=document.createElement("button");button.className="category-card";button.innerHTML=`<span>${c.icon}</span><div><strong>${c.label}</strong><small>記録を追加</small></div>`;button.onclick=()=>openEntryForm("chore",key);el.appendChild(button);
  });
}
function renderLastDone(){
  const el=$("lastDoneList");el.innerHTML="";
  getLatestByTask().slice(0,30).forEach(e=>{
    const div=document.createElement("div");div.className="list-card";
    div.innerHTML=`<div class="list-card-main"><div class="badge-icon">${categories[e.category]?.icon||"○"}</div><div><h3>${escapeHtml(e.item)}</h3><p>${fmtDate(e.performedAt)}・${daysSince(e.performedAt)}日前${e.interval?`・目安${e.interval}日`:""}</p></div></div><div class="card-actions"><button class="mini-button" data-repeat="${e.id}">今やった</button><button class="mini-button danger" data-delete-entry="${e.id}">削除</button></div>`;el.appendChild(div);
  });if(!el.children.length)el.appendChild(emptyNode());
}
function renderHistory(){
  const filters=$("historyFilters");filters.innerHTML="";
  [["all","すべて"],...Object.entries(categories).map(([key,value])=>[key,value.label])].forEach(([key,label])=>{
    const button=document.createElement("button");button.className="filter-button"+(currentHistoryFilter===key?" active":"");button.textContent=label;button.onclick=()=>{currentHistoryFilter=key;renderHistory()};filters.appendChild(button);
  });
  const el=$("historyList");el.innerHTML="";
  entries().filter(e=>currentHistoryFilter==="all"||e.category===currentHistoryFilter).forEach(e=>el.appendChild(timelineNode(e,true)));
  if(!el.children.length)el.appendChild(emptyNode());
}

async function addEntry({item,category,performedAt=isoToday(),interval=null,note="",action="done"}){
  await saveAction(()=>eventRepository.add({item,category,action,note,performedAt,interval:interval?Number(interval):null,...userFields()}));
}
async function addShopping(item,action="wanted",performedAt=isoToday(),note=""){
  await saveAction(()=>eventRepository.add({item,category:"shopping",action,note,performedAt,interval:null,...userFields()}));
}
async function markBought(id){await saveAction(()=>eventRepository.update(id,{action:"bought",performedAt:isoToday(),updatedBy:currentUser.uid,updatedByName:currentUser.displayName||currentUser.email||"ユーザー"}))}
async function removeEvent(id){await saveAction(()=>eventRepository.remove(id))}

function openEntryForm(type,forcedCategory=null){
  $("entryType").value=type;$("entryEditId").value="";$("entryText").value="";$("entryNote").value="";$("entryDate").value=isoToday();$("entryInterval").value="";
  const select=$("entryCategory");select.innerHTML="";Object.entries(categories).filter(([key])=>key!=="shopping").forEach(([key,value])=>select.add(new Option(value.label,key)));if(forcedCategory)select.value=forcedCategory;
  $("categoryWrap").classList.toggle("hidden",type.startsWith("shopping"));$("intervalWrap").classList.toggle("hidden",type.startsWith("shopping"));
  const isWant=type==="shopping-want";$("formEyebrow").textContent=type.startsWith("shopping")?"SHOPPING":"HOUSE LOG";$("formTitle").textContent=isWant?"買いたいものを追加":type==="shopping-bought"?"買ったものを記録":"家事の記録を追加";$("entryText").placeholder=isWant?"例：ヨーグルト":type==="shopping-bought"?"例：バナナ":"例：トイレ掃除";
  $("entryDialog").showModal();setTimeout(()=>$("entryText").focus(),50);
}
function openEditForm(id){
  const source=state.events.find(x=>x.id===id);if(!source)return;
  const type=source.category==="shopping"?(source.action==="wanted"?"shopping-want":"shopping-bought"):"chore";
  openEntryForm(type,source.category);
  $("entryEditId").value=id;$("entryText").value=source.item;$("entryNote").value=source.note||"";$("entryDate").value=source.performedAt;$("entryInterval").value=source.interval||"";
  if(source.category!=="shopping")$("entryCategory").value=source.category;
  $("formTitle").textContent=source.category==="shopping"?"買い物を編集":"家事の記録を編集";
}
document.querySelectorAll(".tab-button").forEach(button=>button.onclick=()=>{document.querySelectorAll(".tab-button,.view").forEach(x=>x.classList.remove("active"));button.classList.add("active");$("view-"+button.dataset.view).classList.add("active")});
document.querySelectorAll("[data-open-form]").forEach(button=>button.onclick=()=>openEntryForm(button.dataset.openForm));$("openQuickAdd").onclick=()=>openEntryForm("chore");
$("entryForm").addEventListener("submit",async event=>{
  event.preventDefault();const type=$("entryType").value,editId=$("entryEditId").value,item=$("entryText").value.trim();if(!item)return;
  $("entryDialog").close();
  try{
    if(editId)await saveAction(()=>eventRepository.update(editId,{item,category:type.startsWith("shopping")?"shopping":$("entryCategory").value,action:type==="shopping-want"?"wanted":type==="shopping-bought"?"bought":"done",performedAt:$("entryDate").value,interval:type.startsWith("shopping")?null:($("entryInterval").value?Number($("entryInterval").value):null),note:$("entryNote").value.trim()}));
    else if(type==="shopping-want")await addShopping(item,"wanted",$("entryDate").value);
    else if(type==="shopping-bought")await addShopping(item,"bought",$("entryDate").value,$("entryNote").value.trim());
    else await addEntry({item,category:$("entryCategory").value,performedAt:$("entryDate").value,interval:$("entryInterval").value,note:$("entryNote").value.trim()});
  }catch{}
});
document.body.addEventListener("click",async event=>{
  const target=event.target;
  try{
    if(target.dataset.closeDialog){$(target.dataset.closeDialog)?.close();return}
    if(target.dataset.buy)await markBought(target.dataset.buy);
    if(target.dataset.edit)openEditForm(target.dataset.edit);
    if(target.dataset.removeShop&&confirm("この買い物項目を削除しますか？"))await removeEvent(target.dataset.removeShop);
    if(target.dataset.repeat){const source=state.events.find(x=>x.id===target.dataset.repeat);if(source)await addEntry({item:source.item,category:source.category,interval:source.interval,note:source.note})}
    if(target.dataset.deleteEntry&&confirm("この記録を削除しますか？"))await removeEvent(target.dataset.deleteEntry);
  }catch{}
});

// Receipt OCR: only confirmed text is saved. The image never leaves this browser.
const receiptInput=$("receiptInput"),preview=$("receiptPreview");
$("openReceipt").onclick=()=>{receiptItems=[];receiptFile=null;receiptInput.value="";preview.classList.add("hidden");renderReceiptItems();$("receiptDialog").showModal()};
receiptInput.onchange=()=>{receiptFile=receiptInput.files[0]||null;if(receiptFile){preview.src=URL.createObjectURL(receiptFile);preview.classList.remove("hidden");$("ocrStatus").textContent="画像を選択しました。"}};
$("runOcr").onclick=async()=>{
  if(!receiptFile)return alert("画像を選択してください");const status=$("ocrStatus");status.textContent="OCRを準備しています…";
  try{const result=await Tesseract.recognize(receiptFile,"jpn+eng",{logger:m=>{if(m.progress)status.textContent=`読み取り中… ${Math.round(m.progress*100)}%`}});$("ocrText").value=result.data.text;status.textContent="読み取りが完了しました。"}
  catch(error){console.error(error);status.textContent="OCRに失敗しました。手入力で商品を追加できます。"}
};
$("addReceiptItem").onclick=()=>{const input=$("receiptItem"),value=input.value.trim();if(value&&!receiptItems.includes(value)){receiptItems.push(value);input.value="";renderReceiptItems()}};
function renderReceiptItems(){const el=$("receiptItems");el.innerHTML="";receiptItems.forEach((item,index)=>{const chip=document.createElement("div");chip.className="chip";chip.innerHTML=`${escapeHtml(item)} <button data-receipt-remove="${index}">×</button>`;el.appendChild(chip)})}
$("receiptItems").onclick=event=>{if(event.target.dataset.receiptRemove!==undefined){receiptItems.splice(Number(event.target.dataset.receiptRemove),1);renderReceiptItems()}};
$("saveReceiptItems").onclick=async()=>{
  if(!receiptItems.length)return alert("商品を追加してください");$("saveReceiptItems").disabled=true;
  try{for(const item of receiptItems)await addShopping(item,"bought",isoToday(),"レシートから登録");$("receiptDialog").close()}
  finally{$("saveReceiptItems").disabled=false}
};

// Shared quick items in settings/default
function renderFavoritesEditor(){
  const el=$("favoritesEditor");el.innerHTML="";
  fixedQuickItems.forEach(item=>{const row=document.createElement("div");row.className="favorite-edit-row";row.innerHTML=`<div><strong>${escapeHtml(item.text)}</strong><br><small>${categories[item.category].label}</small></div><span class="fixed-label">固定</span>`;el.appendChild(row)});
  quickItems().forEach((item,index)=>{const row=document.createElement("div");row.className="favorite-edit-row";row.innerHTML=`<div><strong>${escapeHtml(item.text)}</strong><br><small>${categories[item.category].label}</small></div><button type="button" class="mini-button danger" data-fav-remove="${index}">削除</button>`;el.appendChild(row)});
  const atLimit=quickItems().length>=3;$("newFavoriteText").disabled=atLimit;$("newFavoriteCategory").disabled=atLimit;$("addFavorite").disabled=atLimit;$("favoriteLimitNote").textContent=`追加枠 ${quickItems().length}/3件${atLimit?"（上限です）":""}`;
}
$("manageFavorites").onclick=()=>{const select=$("newFavoriteCategory");select.innerHTML="";Object.entries(categories).filter(([key])=>key!=="shopping").forEach(([key,value])=>select.add(new Option(value.label,key)));renderFavoritesEditor();$("favoritesDialog").showModal()};
$("favoritesEditor").onclick=async event=>{
  if(event.target.dataset.favRemove===undefined)return;
  const next=quickItems();next.splice(Number(event.target.dataset.favRemove),1);
  try{await saveAction(()=>settingsRepository.update({quickItems:next}));state.settings.quickItems=next;renderFavoritesEditor()}catch{}
};
$("addFavorite").onclick=async()=>{
  const items=quickItems();if(items.length>=3)return;const input=$("newFavoriteText"),text=input.value.trim(),category=$("newFavoriteCategory").value;if(!text)return;
  if(fixedQuickItems.some(x=>x.text===text)||items.some(x=>x.text===text&&x.category===category))return alert("その項目はすでに表示されています");
  const next=[...items,{text,category,interval:null}];
  try{await saveAction(()=>settingsRepository.update({quickItems:next}));state.settings.quickItems=next;input.value="";renderFavoritesEditor()}catch{}
};

$("exportData").onclick=()=>{
  const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),events:state.events,settings:state.settings},null,2)],{type:"application/json"});
  const anchor=document.createElement("a");anchor.href=URL.createObjectURL(blob);anchor.download=`uchilog-backup-${isoToday()}.json`;anchor.click();URL.revokeObjectURL(anchor.href);
};

function readLegacyState(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return null;const data=JSON.parse(raw);
    if(!(data?.entries?.length||data?.shopping?.length||data?.favorites?.length))return null;
    return data;
  }catch{return null}
}
function legacyEvents(data){
  const results=[],boughtKeys=new Set((data.entries||[]).filter(x=>x.category==="shopping").map(x=>`${x.text}\u0000${x.date}`));
  (data.entries||[]).forEach((item,index)=>results.push({
    item:item.text,category:item.category,action:item.category==="shopping"?"bought":"done",note:item.note||"",performedAt:item.date||isoToday(),interval:item.interval?Number(item.interval):null,
    migrationSourceId:`entry_${item.id||index}`,...userFields()
  }));
  (data.shopping||[]).forEach((item,index)=>{
    if(item.status==="bought"&&boughtKeys.has(`${item.text}\u0000${item.date}`))return;
    results.push({item:item.text,category:"shopping",action:item.status==="bought"?"bought":"wanted",note:"",performedAt:item.date||isoToday(),interval:null,migrationSourceId:`shopping_${item.id||index}`,...userFields()});
  });
  return results;
}
async function offerMigration(){
  const legacy=readLegacyState();if(!legacy||localStorage.getItem(`uchilog_migration_${currentUser.uid}`)==="done")return;
  try{
    if(await eventRepository.migrationCompleted(currentUser.uid)){localStorage.setItem(`uchilog_migration_${currentUser.uid}`,"done");return}
  }catch(error){setSyncStatus(`移行状態の確認失敗：${readableError(error)}`,"error");return}
  const count=(legacy.entries?.length||0)+(legacy.shopping?.length||0);
  $("migrationSummary").textContent=`記録・買い物 ${count}件${legacy.favorites?.length?`、ワンタップ項目 ${Math.min(legacy.favorites.length,3)}件`:""}`;
  $("migrationError").classList.add("hidden");$("migrationDialog").showModal();
  $("skipMigration").onclick=()=>$("migrationDialog").close();
  $("runMigration").onclick=async()=>{
    $("runMigration").disabled=true;$("skipMigration").disabled=true;$("runMigration").textContent="移行中…";
    try{
      const eventsToMigrate=legacyEvents(legacy);
      await eventRepository.migrate(eventsToMigrate,currentUser.uid);
      const fixedTexts=new Set(fixedQuickItems.map(x=>x.text));
      const quick=(legacy.favorites||[]).filter(x=>x?.text&&!fixedTexts.has(x.text)&&categories[x.category]&&x.category!=="shopping").slice(0,3);
      if(quick.length)await settingsRepository.update({quickItems:quick});
      await eventRepository.completeMigration(currentUser.uid,eventsToMigrate.length);
      localStorage.setItem(`uchilog_migration_${currentUser.uid}`,"done");
      $("migrationDialog").close();setSyncStatus("端末データの移行が完了しました");
    }catch(error){$("migrationError").textContent=`移行に失敗しました：${readableError(error)}`;$("migrationError").classList.remove("hidden")}
    finally{$("runMigration").disabled=false;$("skipMigration").disabled=false;$("runMigration").textContent="移行する"}
  };
}

window.addEventListener("offline",()=>currentUser&&setSyncStatus("オフライン：再接続後に同期します","offline"));
window.addEventListener("online",()=>currentUser&&setSyncStatus("再接続しました。同期中…"));
if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(console.error);
renderAll();
initializeAuth();
