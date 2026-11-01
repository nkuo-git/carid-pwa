// 大便龍的萬能軟體 — 行車紀錄
// 騎腳踏車、開車、跑步都能用：用 GPS 看現在多快、記下走過的路線、畫出速度曲線。
//
// 位置從哪裡來：
//   新的 App 外殼（有 CaridApp.tripStart）：外殼用前景服務在背景記 GPS，螢幕關掉、切到別的 App 都不會斷，
//     每個點用 window.caridTrip("fix", …) 交給這裡；這裡沒接到的（螢幕關著的時候）回來再用 tripPoints 補齊。
//   一般瀏覽器：navigator.geolocation，螢幕要亮著才會繼續記（有 wakeLock 的話幫忙撐著不關螢幕）。
//   舊的 App 外殼：WebView 不給用定位，請他先更新 App。
// 紀錄存在這支手機（IndexedDB carid-trip）；登入了的話（跟「紀錄」同一個帳號）每趟也存到雲端，
// 換手機登入同一個 email 就拿得回來。同步本身在 account.js，這裡只標 owner／dirty、畫登入卡和雲朵。
// 地圖底圖是 OpenStreetMap 的圖磚，要有網路；沒網路一樣會記，只是只畫路線沒有底圖。

const $ = (id) => document.getElementById(id);

function store(key, val) {
  try {
    if (val === null) localStorage.removeItem(key);
    else localStorage.setItem(key, val);
  } catch { /* 無痕視窗等情況，忽略 */ }
}
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ================= 三種模式、四種面板 ================= */

// max：速度表的滿格（km/h）；step：大刻度；launch：「0→多少」計時（km/h）；pace：顯示配速
const MODES = {
  bike: { name: "腳踏車", max: 60, step: 10, launch: 30 },
  car: { name: "開車", max: 200, step: 20, launch: 60 },
  run: { name: "跑步", max: 25, step: 5, pace: true },
};
const GAUGES = { num: "數字", dial: "圓錶", arc: "弧形", race: "賽車", simple: "簡潔", scifi: "科幻", retro: "復古", vfd: "數位", synth: "霓虹", nixie: "真空管" };
// 用 SVG 畫、要跟著格子縮放的面板；後面五種是「風格面板」，記錄中整個畫面換成同一個風格
const SVG_GAUGES = new Set(["dial", "arc", "scifi", "retro", "vfd", "synth", "nixie"]);
const STYLE_GAUGES = new Set(["scifi", "retro", "vfd", "synth", "nixie"]);
const MODE_KEY = "carid.trip.mode";
const GAUGE_KEY = "carid.trip.gauge";
const FOCUS_KEY = "carid.trip.focus";   // 記錄中「只看時速」：藏地圖和曲線，時速放最大

let mode = MODES[load(MODE_KEY)] ? load(MODE_KEY) : "car";
let gauge = GAUGES[load(GAUGE_KEY)] ? load(GAUGE_KEY) : "num";
let focus = load(FOCUS_KEY) === "1";

const ICONS = {
  bike: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5.8" cy="16" r="3.6"/><circle cx="18.2" cy="16" r="3.6"/><path d="M5.8 16 9.6 9h5.6l3 7"/><path d="M9.6 9l3.4 7h-.2"/><path d="M8.4 6.2h3"/><path d="M15.2 9l-.8-2.8h2"/></svg>',
  car: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 13l1.7-4.3A3 3 0 0 1 8 6.8h8a3 3 0 0 1 2.8 1.9L20.5 13"/><path d="M3.5 13h17v3.8h-17z"/><path d="M6.8 16.8v1.4"/><path d="M17.2 16.8v1.4"/></svg>',
  run: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="14.5" cy="4.6" r="1.9"/><path d="M7 11.5l2.8-3h4.4l2.2 3.2 2.6.8"/><path d="M12.6 8.6 10.8 15l3.6 2.4V21"/><path d="M10.8 15 8 21H5.5"/></svg>',
};
const CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

/* ================= 數字怎麼寫 ================= */

const pad2 = (n) => String(n).padStart(2, "0");
const kmh = (v) => Math.round(v * 3.6);
const kmh1 = (v) => (v * 3.6).toFixed(1);
const km = (m) => (m / 1000).toFixed(m < 10000 ? 2 : 1);
function hms(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return pad2(Math.floor(s / 3600)) + ":" + pad2(Math.floor(s / 60) % 60) + ":" + pad2(s % 60);
}
function durText(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + " 秒";
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  if (h) return h + " 小時 " + pad2(m) + " 分";
  return m + " 分 " + pad2(sec) + " 秒";
}
function durShort(ms) {
  const m = Math.round(ms / 60000);
  return m < 60 ? m + " 分鐘" : Math.floor(m / 60) + " 小時 " + pad2(m % 60) + " 分";
}
// 配速：每公里幾分幾秒
function paceText(v) {
  if (!(v > 0.3)) return "--";
  const s = Math.round(1000 / v);
  return Math.floor(s / 60) + "'" + pad2(s % 60) + '"';
}
function dayKey(t) {
  const d = new Date(t);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
function dayLabel(t) {
  const k = dayKey(t);
  if (k === dayKey(Date.now())) return "今天";
  if (k === dayKey(Date.now() - 864e5)) return "昨天";
  const d = new Date(t);
  const md = (d.getMonth() + 1) + "月" + d.getDate() + "日";
  return d.getFullYear() === new Date().getFullYear() ? md : d.getFullYear() + "年" + md;
}
function clockText(t) {
  const d = new Date(t);
  const h = d.getHours();
  const part = h < 5 ? "凌晨" : h < 12 ? "上午" : h < 13 ? "中午" : h < 18 ? "下午" : "晚上";
  return part + " " + (h % 12 || 12) + ":" + pad2(d.getMinutes());
}
const hhmm = (t) => { const d = new Date(t); return (d.getHours() % 12 || 12) + ":" + pad2(d.getMinutes()); };

/* ================= 算距離、收點 ================= */

// 兩點之間幾公尺
function haversine(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* 一趟正在記的東西。pts 裡每個點是 [時間, 緯度, 經度, 速度 m/s, 準度 m]。
   距離、最快、在動的時間都是收到點的時候一路算上去的；存檔前會用同一段程式從頭再算一次。 */
function newRec(m, start) {
  return {
    mode: m, start, pts: [],
    paused: false, pausedAt: 0, pausedMs: 0,
    dist: 0, maxV: 0, maxAt: 0, moving: 0,
    last: null, anchor: null, lastFixAt: 0, vShow: 0, acc: null,
    launch: null, launchFrom: null,   // 0→N km/h 最快幾秒
    shellN: 0,                        // 外殼那邊已經拿過幾個點
  };
}

const MOVING = 0.6;   // m/s，大約 2 km/h：比這快才算「在動」

function addPoint(r, p) {
  if (!(p.lat >= -90 && p.lat <= 90) || !(p.lon >= -180 && p.lon <= 180)) return false;
  const acc = p.acc > 0 ? p.acc : 30;
  if (acc > 60) { r.acc = acc; return false; }          // 太不準的點不要，但狀態要顯示訊號弱
  const last = r.last;
  let v = p.v >= 0 ? p.v : null;                         // GPS 自己算的速度；沒有就用距離÷時間
  if (last) {
    const dt = (p.t - last.t) / 1000;
    if (dt <= 0) return false;
    if (v === null) v = haversine(last, p) / dt;
    if (v > 90) v = r.vShow;                            // 324 km/h 以上是雜訊，照上一個
    if (v > MOVING && dt < 30) r.moving += dt * 1000;
  } else if (v === null || v > 90) {
    v = 0;
  }
  // 距離：從上一個「算過的點」量起，離它夠遠（超過準度的一半）才算、才換成新的起點。
  // 原地站著 GPS 飄來飄去就一直在那個圈圈裡，不會越站越遠；慢慢走的則幾步就累積過門檻。
  if (!r.anchor) r.anchor = { lat: p.lat, lon: p.lon };
  else {
    const d = haversine(r.anchor, p);
    if (d >= Math.max(3, acc * 0.5)) { r.dist += d; r.anchor = { lat: p.lat, lon: p.lon }; }
  }
  r.vShow = r.last ? r.vShow * 0.4 + v * 0.6 : v;        // 顯示用：稍微平滑，數字才不會跳來跳去
  if (v > r.maxV) { r.maxV = v; r.maxAt = p.t; }
  // 0→N：從幾乎停住（< 2 km/h）開始算，到 N km/h 花幾秒，記最快的一次
  const lim = MODES[r.mode]?.launch;
  if (lim) {
    if (v * 3.6 < 2) r.launchFrom = p.t;
    else if (r.launchFrom && v * 3.6 >= lim) {
      const s = (p.t - r.launchFrom) / 1000;
      if (s > 0.5 && (r.launch === null || s < r.launch)) r.launch = Math.round(s * 10) / 10;
      r.launchFrom = null;
    }
  }
  r.pts.push([p.t, Math.round(p.lat * 1e6) / 1e6, Math.round(p.lon * 1e6) / 1e6, Math.round(v * 10) / 10, Math.round(acc)]);
  r.last = { t: p.t, lat: p.lat, lon: p.lon };
  r.lastFixAt = Date.now();
  r.acc = acc;
  return true;
}
const ptObj = (a) => ({ t: a[0], lat: a[1], lon: a[2], v: a[3], acc: a[4] });

function elapsed(r) {
  return Math.max(0, (r.paused ? r.pausedAt : Date.now()) - r.start - r.pausedMs);
}

/* 存檔用：從點從頭算一次，整理成一筆紀錄 */
function finishTrip(m, start, pausedMs, pts, end) {
  const r = newRec(m, start);
  r.pausedMs = pausedMs;
  for (const a of pts) addPoint(r, ptObj(a));
  const last = r.pts.length ? r.pts[r.pts.length - 1][0] : start;
  end = Math.max(end || last, last);
  // 點太多就隔著丟（一秒一點，兩小時 7200 點；存 4000 點以內就夠畫了）
  let keep = r.pts;
  if (keep.length > 4000) {
    const k = Math.ceil(keep.length / 4000);
    keep = keep.filter((_, i) => i % k === 0 || i === keep.length - 1);
  }
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    mode: m, start, end, pausedMs,
    elapsed: Math.max(0, end - start - pausedMs),
    moving: r.moving, dist: Math.round(r.dist), maxV: r.maxV, maxAt: r.maxAt, launch: r.launch,
    pts: keep,
  };
}
const avgV = (t) => (t.moving > 0 ? t.dist / (t.moving / 1000) : 0);

/* ================= 存在手機裡（IndexedDB） ================= */

const TRIP_MAX = 200;
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const q = indexedDB.open("carid-trip", 1);
    q.onupgradeneeded = () => { q.result.createObjectStore("trips", { keyPath: "id" }); };
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}
function tx(mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction("trips", mode);
    const out = fn(t.objectStore("trips"));
    t.oncomplete = () => res(out?.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}
const allTrips = () => tx("readonly", (s) => s.getAll()).then((a) => (a || []).sort((x, y) => y.start - x.start));
const getTrip = (id) => tx("readonly", (s) => s.get(id));
const delTrip = (id) => tx("readwrite", (s) => s.delete(id));
/* 讀、改、寫在同一個交易裡（同步時標「傳好了」用）；不在了回 false */
function patchTrip(id, fn) {
  return tx("readwrite", (s) => {
    const out = { result: false };
    const q = s.get(id);
    q.onsuccess = () => {
      if (!q.result) return;
      fn(q.result);
      s.put(q.result);
      out.result = true;
    };
    return out;
  });
}
async function saveTrip(t) {
  await tx("readwrite", (s) => s.put(t));
  // 最多留 TRIP_MAX 趟（只算畫面上看得到的這一份），太舊的連雲端一起刪
  const all = (await allTrips()).filter(visibleTrip);
  for (const old of all.slice(TRIP_MAX)) {
    await delTrip(old.id);
    hooks.deleted?.(old);
  }
}
/** account.js 同步用的存取函式 */
export const tripStore = { all: allTrips, get: getTrip, put: (t) => tx("readwrite", (s) => s.put(t)), del: delTrip, patch: patchTrip };

/* ================= 帳號（登入、雲端）：app.js 接進來 ================= */

// hooks：{ who() 現在登入的人 { uid, email } 或 null, sync(delay) 跟雲端對齊, deleted(trip) 刪了一趟, apkHref() 新版 App 的網址 }
let hooks = {};
let acctSnap = null;      // account.js 最近一次的狀態 { user, sync }
let lastPhase = "idle";
export function tripInit(h) { hooks = h || {}; }
/** 登入狀態、同步進度有變（app.js 的 onAccount 叫）：重畫列表和登入那塊 */
export function tripAccount(snap) {
  acctSnap = snap;
  const phase = snap?.sync?.phase || "idle";
  if (view === "trip") {
    if (phase === "tdown") throttlePaint();
    else if (phase !== lastPhase || phase === "idle") paintList();
  }
  lastPhase = phase;
}
let paintTimer = 0, paintAt = 0;
function throttlePaint() {
  clearTimeout(paintTimer);
  paintTimer = setTimeout(() => { paintAt = Date.now(); paintList(); }, Math.max(0, paintAt + 1000 - Date.now()));
}
const whoNow = () => (hooks.who ? hooks.who() : null);
/** 看得到的：沒主人的，和現在登入的人的（別人的藏起來） */
function visibleTrip(t) {
  const w = whoNow();
  return !t.owner || (w && t.owner === w.uid);
}

/* ================= 外殼（新 App）還是瀏覽器 ================= */

const shellApp = () => {
  const a = window.CaridApp;
  return a && typeof a.tripStart === "function" ? a : null;
};
const oldShell = () => !shellApp() && /CaridApp\//.test(navigator.userAgent || "");

let rec = null;          // 正在記的那一趟
let tick = null;         // 每秒重畫
let watchId = null;      // 瀏覽器的 geolocation
let wake = null;         // 瀏覽器：撐著螢幕不關
let gpsErr = 0;          // 瀏覽器 geolocation 的錯誤碼
let noteMsg = "";        // 面板下面那行提示
let noteBtn = null;      // 提示旁的按鈕：{ text, fn }
let view = null;         // 現在看的是 "trip"、"item" 還是別的分頁

function onFix(p) {
  if (!rec || rec.paused) return;
  gpsErr = 0;
  addPoint(rec, p);
}

/* 外殼送過來的事：started / denied / fix / paused / resumed / stopped */
window.caridTrip = (evt, data) => {
  evt = String(evt);
  if (evt === "fix") {
    if (rec) { rec.shellN++; onFix(data || {}); }
    return;
  }
  if (evt === "started") {
    if (!rec) beginRec(mode, Number(data?.start) || Date.now());
    return;
  }
  if (evt === "denied") {
    setNote("手機不准這個 App 用位置，所以記不了。到手機設定裡把「位置」打開再試。", { text: "去設定", fn: () => { try { shellApp()?.openLocationSettings(); } catch { /* 算了 */ } } });
    paintPanel();
    return;
  }
  if (evt === "paused" || evt === "resumed") {
    if (!rec) return;
    if (evt === "paused" && !rec.paused) { rec.paused = true; rec.pausedAt = Number(data?.at) || Date.now(); }
    if (evt === "resumed" && rec.paused) { rec.pausedMs += (Number(data?.at) || Date.now()) - rec.pausedAt; rec.paused = false; }
    paintPanel();
    return;
  }
  if (evt === "stopped") {
    // 從通知那邊按了「結束」：GPS 已經停了，先存起來才不會丟，再問要留還是捨棄
    if (!rec) return;
    const r = rec;
    stopTick();
    rec = null;
    const t = fromShell(data) || finishTrip(r.mode, r.start, r.pausedMs, r.pts, Date.now());
    keepTrip(t, true).then((saved) => {
      if (!saved) { setNote("太短了，這趟沒有存。"); paintPanel(); paintList(); return; }
      if (view === "trip") openEnd(saved);
    });
  }
};

// 外殼交回來的整趟：{ mode, start, pausedMs, points: [[t, lat, lon, v, acc], …] }
function fromShell(d) {
  if (!d || !Array.isArray(d.points)) return null;
  const m = MODES[d.mode] ? d.mode : mode;
  return finishTrip(m, Number(d.start) || Date.now(), Number(d.pausedMs) || 0, d.points, Number(d.end) || Date.now());
}

// 螢幕關著的時候沒接到的點，從外殼那邊補
function backfill() {
  const sh = shellApp();
  if (!sh || !rec) return;
  try {
    const more = JSON.parse(sh.tripPoints(rec.shellN) || "[]");
    for (const a of more) { rec.shellN++; addPoint(rec, ptObj(a)); }
  } catch { /* 拿不到就等下一次 */ }
}

/* App 重開（或被手機殺掉再開）：外殼那邊還在記的話接回來；通知那邊按了結束而網頁沒開著的話，把那趟存起來 */
function recover() {
  const sh = shellApp();
  if (!sh) return;
  try {
    const pend = sh.tripPending();
    if (pend) {
      const t = fromShell(JSON.parse(pend));
      sh.tripPendingClear();
      if (t) keepTrip(t, true);
    }
  } catch { /* 算了 */ }
  try {
    const st = JSON.parse(sh.tripState() || "null");
    if (st && st.active && MODES[st.mode]) {
      rec = newRec(st.mode, Number(st.start) || Date.now());
      rec.pausedMs = Number(st.pausedMs) || 0;
      rec.paused = !!st.paused;
      rec.pausedAt = Number(st.pausedAt) || Date.now();
      mode = st.mode;
      backfill();
      startTick();
    }
  } catch { /* 算了 */ }
}

function setNote(msg, btn) { noteMsg = msg || ""; noteBtn = btn || null; }

function beginRec(m, start) {
  rec = newRec(m, start);
  mode = m;
  store(MODE_KEY, m);
  setNote("");
  startTick();
  paintPanel();
}

function startRec() {
  if (rec) return;
  const sh = shellApp();
  if (sh) {
    let r = "error";
    try { r = String(sh.tripStart(mode)); } catch { /* 下面當錯誤 */ }
    if (r === "started") { beginRec(mode, Date.now()); return; }
    if (r === "asking") { setNote("等你允許用位置…"); paintPanel(); return; }
    if (r === "denied") { window.caridTrip("denied"); return; }
    setNote("GPS 打不開，再按一次試試。"); paintPanel();
    return;
  }
  if (oldShell()) { paintPanel(); return; }
  if (!navigator.geolocation) { setNote("這個瀏覽器沒有定位功能。"); paintPanel(); return; }
  gpsErr = 0;
  beginRec(mode, Date.now());
  startWatch();
}

function startWatch() {
  stopWatch();
  try {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        onFix({ t: pos.timestamp || Date.now(), lat: c.latitude, lon: c.longitude, v: c.speed ?? -1, acc: c.accuracy });
      },
      (err) => { gpsErr = err?.code || 2; },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
  } catch { gpsErr = 2; }
  holdScreen();
}
function stopWatch() {
  if (watchId !== null) { try { navigator.geolocation.clearWatch(watchId); } catch { /* 算了 */ } }
  watchId = null;
  if (wake) { wake.release?.().catch?.(() => {}); wake = null; }
}
function holdScreen() {
  if (!rec || shellApp() || wake || !navigator.wakeLock) return;
  navigator.wakeLock.request("screen").then((l) => {
    wake = l;
    l.addEventListener?.("release", () => { wake = null; });
  }).catch(() => { /* 不給就算了 */ });
}

function pauseRec() {
  if (!rec || rec.paused) return;
  rec.paused = true;
  rec.pausedAt = Date.now();
  try { shellApp()?.tripPause(); } catch { /* 算了 */ }
  paintPanel();
}
function resumeRec() {
  if (!rec || !rec.paused) return;
  rec.pausedMs += Date.now() - rec.pausedAt;
  rec.paused = false;
  try { shellApp()?.tripResume(); } catch { /* 算了 */ }
  paintPanel();
}

function stopRec(discard, quiet) {
  if (!rec) return Promise.resolve(null);
  const r = rec;
  let fromApp = null;
  const sh = shellApp();
  if (sh) {
    try { fromApp = fromShell(JSON.parse(sh.tripStop() || "null")); } catch { /* 用自己收到的點 */ }
  } else {
    stopWatch();
  }
  stopTick();
  rec = null;
  if (r.paused) { r.pausedMs += Date.now() - r.pausedAt; r.paused = false; }
  if (discard) { setNote("這趟捨棄了，沒有存。"); paintPanel(); paintList(); return Promise.resolve(null); }
  return keepTrip(fromApp || finishTrip(r.mode, r.start, r.pausedMs, r.pts, Date.now()), quiet);
}

/* ================= 錄影＋記錄（tripcam.js，要用時才載入） ================= */

const camApi = {
  get rec() { return rec; },
  get gauge() { return gauge; },
  gaugeName: () => GAUGES[gauge] || "",
  isSvgGauge: () => SVG_GAUGES.has(gauge),
  gaugeSvg: (v, r) => gaugeHtml(v, r),
  mode: () => MODES[rec ? rec.mode : mode] || MODES.car,
  avgV, km, kmh, kmh1,
  openGaugePick: () => openGaugePick(),
  shell: () => {
    const a = window.CaridApp;
    return a && typeof a.videoBegin === "function" ? a : null;
  },
  endTrip: () => stopRec(false, true),
  // 關掉錄影：回到行車紀錄主頁（剛存的那趟在下面列表最上面）
  closed: () => {
    if (location.hash !== "#trip") { location.hash = "#trip"; return; }
    paintPanel(); paintList(); paintTripDot();
    try { scrollTo(0, 0); } catch { /* 算了 */ }
  },
};

function camReady() {
  const a = window.CaridApp;
  if (a && typeof a.videoBegin !== "function") return "錄影要新版的 App，請先把 App 更新到最新版（最上面會跳「更新」）。";
  if (oldShell()) return "錄影要新版的 App，請先把 App 更新到最新版（最上面會跳「更新」）。";
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return "這個瀏覽器不能錄影。";
  return "";
}

function openCamera() {
  const why = camReady();
  if (why) { setNote(why); paintPanel(); return; }
  if (!rec) startRec();
  import("./tripcam.js?v=58").then((m) => m.openCam(camApi)).catch(() => { setNote("錄影畫面打不開，等一下再試。"); paintPanel(); });
}

/* 按「結束」：先暫停，問要存起來、捨棄，還是繼續記 */
let endWasPaused = false;   // 按結束前就暫停著，按「繼續記」就不要自動恢復
let endSaved = null;        // 從通知結束的那趟（已經存了），等著選留或捨棄
function askEnd() {
  if (!rec) return;
  endWasPaused = rec.paused;
  if (!rec.paused) pauseRec();
  openEnd(null);
}
function openEnd(saved) {
  endSaved = saved;
  const r = rec;
  const src = saved || r;
  if (!src) return;
  const M = MODES[src.mode] || MODES.car;
  const dist = src.dist, el = saved ? saved.elapsed : elapsed(r);
  const avg = saved ? avgV(saved) : avgV(r);
  const short = !saved && ((r.pts.length < 2) || dist < 20);
  $("tripEndTitle").textContent = saved ? "這趟結束了" : "結束這趟？";
  S.tripEndStats.innerHTML =
    `<div class="stat"><b>${km(dist)}<small>km</small></b><span>距離</span></div>` +
    `<div class="stat"><b>${esc(durText(el))}</b><span>花了多久</span></div>` +
    (M.pace
      ? `<div class="stat"><b>${esc(paceText(avg))}</b><span>平均配速 /km</span></div>`
      : `<div class="stat"><b>${kmh(src.maxV)}</b><span>最快 km/h</span></div>`);
  S.tripEndNote.textContent = short ? "太短了，存不起來。" : "";
  S.tripEndNote.hidden = !short;
  S.tripEndKeep.disabled = short;
  S.tripEndKeep.textContent = saved ? "留著" : "存起來";
  S.tripEndMore.hidden = !!saved;
  S.tripEndClose.hidden = !!saved;
  S.tripEndWrap.hidden = false;
  document.body.classList.add("sharing");
}
function closeEnd() {
  S.tripEndWrap.hidden = true;
  document.body.classList.remove("sharing");
}
function endContinue() {
  closeEnd();
  if (endSaved) { endSaved = null; paintList(); return; }
  if (rec?.paused && !endWasPaused) resumeRec();
}
function endKeep() {
  closeEnd();
  if (endSaved) { const t = endSaved; endSaved = null; location.hash = "#trip/" + encodeURIComponent(t.id); return; }
  stopRec(false);
}
async function endDrop() {
  closeEnd();
  if (endSaved) {
    const t = endSaved; endSaved = null;
    try { await delTrip(t.id); } catch { /* 算了 */ }
    hooks.deleted?.(t);
    setNote("這趟捨棄了，沒有存。"); paintPanel(); paintList();
    return;
  }
  stopRec(true);
}

/** 存一筆；太短不存。回傳存進去的那筆，沒存回傳 null */
async function keepTrip(t, quiet) {
  if (t.pts.length < 2 || t.dist < 20) {
    if (!quiet) { setNote("太短了，這趟沒有存。"); paintPanel(); paintList(); }
    return null;
  }
  const w = whoNow();
  if (w) { t.owner = w.uid; t.dirty = true; }       // 登入中：等一下傳上雲端；沒登入的沒主人，登入時再一起傳
  try { await saveTrip(t); } catch { setNote("存不進手機裡（儲存空間不給用）。"); paintPanel(); return null; }
  hooks.sync?.(800);
  if (!quiet) location.hash = "#trip/" + encodeURIComponent(t.id);
  else if (view === "trip") paintList();
  return t;
}

function startTick() {
  stopTick();
  tick = setInterval(onTick, 1000);
  onTick();
}
function stopTick() { if (tick) clearInterval(tick); tick = null; }
let frame = 0;
function onTick() {
  frame++;
  if (rec && !rec.paused && Date.now() - rec.lastFixAt > 5000) rec.vShow *= 0.6;   // 一陣子沒訊號，數字慢慢歸零
  paintTripDot();
  if (view !== "trip") return;
  paintLiveNumbers();
  if (frame % 2 === 0) paintLiveChart();
  if (frame % 3 === 0) paintLiveMap();
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden || !rec) return;
  backfill();
  holdScreen();
  if (view === "trip") paintPanel();
});

/* ================= 速度表 ================= */

// 把 0..max 的值換成錶上的角度：左下 135° 到右下 405°，掃 270°
const polar = (cx, cy, r, v, max) => {
  const a = (135 + 270 * Math.min(1, Math.max(0, v / max))) * Math.PI / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
const f1 = (n) => n.toFixed(1);
function arcPath(cx, cy, r, v0, v1, max) {
  const [x0, y0] = polar(cx, cy, r, v0, max);
  const [x1, y1] = polar(cx, cy, r, v1, max);
  const large = 270 * (v1 - v0) / max > 180 ? 1 : 0;
  return `M${f1(x0)} ${f1(y0)}A${r} ${r} 0 ${large} 1 ${f1(x1)} ${f1(y1)}`;
}

function gaugeHtml(v, r, g = gauge, lit = false) {
  const M = MODES[mode];
  const on = lit || (!!r && !r.paused);
  const speed = kmh(v);
  const maxV = r ? r.maxV : 0;
  if (g === "dial") return gaugeDial(speed, M, maxV * 3.6, on);
  if (g === "arc") return gaugeArc(speed, M, maxV * 3.6, on);
  if (g === "race") return gaugeRace(speed, M, r, on);
  if (g === "simple") return gaugeSimple(speed, M, r, on);
  if (g === "scifi") return gaugeScifi(speed, M, r, maxV * 3.6, on);
  if (g === "retro") return gaugeRetro(speed, M, r, maxV * 3.6, on);
  if (g === "vfd") return gaugeVfd(speed, M, r, maxV * 3.6, on);
  if (g === "synth") return gaugeSynth(speed, M, r, maxV * 3.6, on);
  if (g === "nixie") return gaugeNixie(speed, M, r, maxV * 3.6, on);
  return `<div class="big${on ? " on" : ""}">${speed}</div><div class="unit">KM/H</div>` +
    (M.pace ? `<div class="pace">配速 <b>${esc(paceText(v))}</b> /km</div>` : "");
}

/* 簡潔：時速超大在左，右邊三格 距離／平均（跑步是配速）／最快；下面那排數字就不重複了 */
function gaugeSimple(speed, M, r, on) {
  const avg = r ? avgV(r) : 0;
  const tile = (k, v, unit) => `<div><span>${k}</span><b>${v}${unit ? `<small>${unit}</small>` : ""}</b></div>`;
  return `<div class="simple"><div class="sbig"><div class="big${on ? " on" : ""}">${speed}</div><div class="unit">KM/H</div></div><div class="stiles">` +
    tile("距離", km(r ? r.dist : 0), "km") +
    (M.pace ? tile("配速 /km", esc(paceText(avg))) : tile("平均 km/h", avg ? kmh1(avg) : "0")) +
    tile("最快 km/h", kmh(r ? r.maxV : 0)) +
    `</div></div>`;
}

function gaugeDial(speed, M, maxK, on) {
  const cx = 160, cy = 160, max = M.max, minor = M.step / 2;
  let ticks = "", red = "", labels = "";
  const redFrom = max * 0.8;
  for (let v = 0; v <= max; v += minor) {
    const major = Math.abs(v / M.step - Math.round(v / M.step)) < 1e-6;
    const [x1, y1] = polar(cx, cy, 140, v, max);
    const [x2, y2] = polar(cx, cy, major ? 124 : 132, v, max);
    const seg = `M${f1(x1)} ${f1(y1)}L${f1(x2)} ${f1(y2)}`;
    if (major && v >= redFrom) red += seg; else ticks += seg;
    if (major) {
      const [lx, ly] = polar(cx, cy, 108, v, max);
      labels += `<text x="${f1(lx)}" y="${f1(ly + 6)}"${v >= redFrom ? ' class="hot"' : ""}>${v}</text>`;
    }
  }
  const [nx, ny] = polar(cx, cy, 118, speed, max);
  const [tx, ty] = polar(cx, cy, -18, speed, max);
  const [m1x, m1y] = polar(cx, cy, 148, maxK, max);
  const [m2x, m2y] = polar(cx, cy, 112, maxK, max);
  return `<svg class="dial" viewBox="0 0 320 320" width="300" height="300" role="img" aria-label="現在 ${speed} km/h">
<circle cx="160" cy="160" r="152" class="face"/>
<path d="${arcPath(cx, cy, 145, redFrom, max, max)}" class="redarc"/>
<path d="${ticks}" class="tick"/><path d="${red}" class="tick hot"/>
<g class="lab">${labels}</g>
${maxK > 0 ? `<path d="M${f1(m1x)} ${f1(m1y)}L${f1(m2x)} ${f1(m2y)}" class="maxmark"/>` : ""}
<line x1="${f1(tx)}" y1="${f1(ty)}" x2="${f1(nx)}" y2="${f1(ny)}" class="needle${on ? " on" : ""}"/>
<circle cx="160" cy="160" r="13" class="hub"/>
<text x="160" y="240" class="num">${speed}</text><text x="160" y="262" class="unit">KM/H</text>
</svg>` + (M.pace ? `<div class="pace">配速 <b>${esc(paceText(speed / 3.6))}</b> /km</div>` : "");
}

function gaugeArc(speed, M, maxK, on) {
  const max = M.max;
  let ticks = "";
  for (let v = 0; v <= max; v += M.step) {
    const [x1, y1] = polar(160, 160, 150, v, max);
    const [x2, y2] = polar(160, 160, 156, v, max);
    ticks += `M${f1(x1)} ${f1(y1)}L${f1(x2)} ${f1(y2)}`;
  }
  const [mx1, my1] = polar(160, 160, 141, maxK, max);
  const [mx2, my2] = polar(160, 160, 119, maxK, max);
  return `<svg class="arcg" viewBox="0 0 320 300" width="300" height="281" role="img" aria-label="現在 ${speed} km/h">
<path d="${ticks}" class="tick"/>
<path d="${arcPath(160, 160, 130, 0, max, max)}" class="track"/>
${speed > 0 ? `<path d="${arcPath(160, 160, 130, 0, Math.min(speed, max), max)}" class="fill${on ? " on" : ""}"/>` : ""}
${maxK > 0 ? `<path d="M${f1(mx1)} ${f1(my1)}L${f1(mx2)} ${f1(my2)}" class="maxmark"/>` : ""}
<text x="90" y="232" class="lab">0</text><text x="230" y="232" class="lab">${max}</text>
<text x="160" y="186" class="num">${speed}</text><text x="160" y="214" class="unit">KM/H</text>
<text x="160" y="262" class="cap">${maxK > 0 ? `白線是這趟最快 ${Math.round(maxK)}` : ""}</text>
</svg>` + (M.pace ? `<div class="pace">配速 <b>${esc(paceText(speed / 3.6))}</b> /km</div>` : "");
}

function gaugeRace(speed, M, r, on) {
  const n = 20;
  const lit = Math.round(n * Math.min(1, speed / M.max));
  let lights = "";
  for (let i = 0; i < n; i++) {
    const c = i < 8 ? "g" : i < 11 ? "y" : i < 15 ? "o" : "r";
    lights += `<i class="${c}${i < lit ? " lit" : ""}"></i>`;
  }
  const avg = r ? avgV(r) : 0;
  const diff = r && avg > 0 ? Math.round(speed - avg * 3.6) : null;
  const labs = [0, 0.25, 0.5, 0.75].map((f) => Math.round(M.max * f));
  const tiles = M.pace
    ? [["配速", esc(paceText(speed / 3.6)), "/km"], ["最快", kmh(r?.maxV || 0), "km/h"], ["平均", avg ? kmh1(avg) : "0", "km/h"], ["距離", km(r?.dist || 0), "km"]]
    : [["最快", kmh(r?.maxV || 0), "km/h"], ["平均", avg ? kmh1(avg) : "0", "km/h"], ["距離", km(r?.dist || 0), "km"], ["0 → " + M.launch + " 最快", r?.launch != null ? r.launch : "--", "秒"]];
  return `<div class="race${on ? " on" : ""}" role="img" aria-label="現在 ${speed} km/h">
<div class="lights">${lights}</div>
<div class="scale">${labs.map((l) => `<span>${l}</span>`).join("")}</div>
<div class="rbig"><span class="rnum">${speed}</span><span class="rside"><span class="runit">KM/H</span>${diff !== null ? `<span class="rdiff${diff >= 0 ? " up" : " dn"}">${diff >= 0 ? "+" : ""}${diff}</span><span class="rcap">比平均${diff >= 0 ? "快" : "慢"}</span>` : ""}</span></div>
<div class="rtiles">${tiles.map(([k, v, u]) => `<div><span class="k">${k}</span><b>${v}<small>${u}</small></b></div>`).join("")}</div>
</div>`;
}

/* ================= 風格面板：科幻／復古指針／80 年代數位／霓虹／真空管 ================= */
// 這五種記錄中會把整個畫面（底色、數字、按鈕）換成同一個風格，見 styles.css「風格面板」

const angOf = (v, max) => 135 + 270 * Math.min(1, Math.max(0, v / max));
const ptA = (cx, cy, r, a) => { const t = a * Math.PI / 180; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; };
function arcA(cx, cy, r, a1, a2) {
  const [x1, y1] = ptA(cx, cy, r, a1), [x2, y2] = ptA(cx, cy, r, a2);
  return `M${f1(x1)} ${f1(y1)}A${r} ${r} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${f1(x2)} ${f1(y2)}`;
}
const lineA = (cx, cy, r1, r2, a) => { const [x1, y1] = ptA(cx, cy, r1, a), [x2, y2] = ptA(cx, cy, r2, a); return `M${f1(x1)} ${f1(y1)}L${f1(x2)} ${f1(y2)}`; };
const labStep = (M) => (M.max / M.step > 6 ? M.step * 2 : M.step);
const paceDiv = (M, speed) => (M.pace ? `<div class="pace">配速 <b>${esc(paceText(speed / 3.6))}</b> /km</div>` : "");
const tripKm = (r) => ((r ? r.dist : 0) / 1000);

function gaugeScifi(speed, M, r, maxK, on) {
  const C = "#3DF2FF", max = M.max, N = 45, lit = Math.round(N * Math.min(1, speed / max));
  let segOn = "", segOff = "", head = "";
  for (let i = 0; i < N; i++) {
    const d = arcA(180, 180, 146, 135 + i * 6, 139.6 + i * 6);
    if (i === lit - 1) head = d; else if (i < lit) segOn += d; else segOff += d;
  }
  let tMin = "", tMaj = "";
  for (let i = 0; i <= 40; i++) { const d = lineA(180, 180, i % 4 ? 160 : 156, 168, 135 + i * 6.75); if (i % 4) tMin += d; else tMaj += d; }
  let labs = "";
  for (let v = 0; v <= max + 1e-6; v += labStep(M)) {
    const [x, y] = ptA(180, 180, 120, angOf(v, max));
    labs += `<text x="${f1(x)}" y="${f1(y + 4)}">${Math.round(v)}</text>`;
  }
  const avg = r ? avgV(r) : 0;
  const diff = r && avg > 0 ? speed - Math.round(avg * 3.6) : null;
  return `<svg class="gx gsf${on ? " on" : ""}" viewBox="0 0 360 360" width="300" height="300" role="img" aria-label="現在 ${speed} km/h">
<defs><filter id="gsfGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<radialGradient id="gsfCore"><stop offset="0" stop-color="${C}" stop-opacity=".16"/><stop offset="1" stop-color="${C}" stop-opacity="0"/></radialGradient></defs>
<circle cx="180" cy="180" r="176" fill="none" stroke="${C}" stroke-opacity=".25"/>
<path d="${arcA(180, 180, 176, 200, 250)}${arcA(180, 180, 176, 290, 340)}" stroke="${C}" stroke-width="3" fill="none"/>
<path d="${tMin}" stroke="${C}" stroke-opacity=".35"/><path d="${tMaj}" stroke="${C}" stroke-opacity=".9" stroke-width="2"/>
<path d="${segOff}" stroke="#0B2A33" stroke-width="16" fill="none"/>
<g class="hl" filter="url(#gsfGlow)"><path d="${segOn}" stroke="${C}" stroke-width="16" fill="none"/>${head ? `<path d="${head}" stroke="#E8FFFF" stroke-width="16" fill="none"/>` : ""}</g>
${maxK > 0 ? `<path d="${lineA(180, 180, 170, 180, angOf(maxK, max))}" stroke="#FFFFFF" stroke-width="3"/>` : ""}
<circle cx="180" cy="180" r="104" fill="url(#gsfCore)" stroke="${C}" stroke-opacity=".55" stroke-dasharray="2 5"/>
<circle cx="180" cy="180" r="94" fill="none" stroke="${C}" stroke-opacity=".2"/>
<path d="${arcA(180, 180, 94, 300, 360)}${arcA(180, 180, 94, 120, 180)}" stroke="${C}" stroke-width="2" fill="none" stroke-opacity=".8"/>
<g class="lab" fill="${C}" fill-opacity=".7" font-size="12" text-anchor="middle">${labs}</g>
<text x="180" y="132" class="mono" text-anchor="middle" font-size="11" letter-spacing="3" fill="${C}" fill-opacity=".75">SPD · 時速</text>
<text x="180" y="208" class="orb hl" text-anchor="middle" font-weight="700" font-size="80" fill="#E8FFFF" filter="url(#gsfGlow)">${String(speed).padStart(3, "0")}</text>
<text x="180" y="236" class="orb" text-anchor="middle" font-size="13" letter-spacing="5" fill="${C}">KM/H</text>
${diff !== null ? `<text x="180" y="262" class="mono" text-anchor="middle" font-size="10" letter-spacing="2" fill="${C}" fill-opacity=".6">${diff >= 0 ? "▲ +" : "▼ "}${diff} vs AVG</text>` : ""}
</svg>` + paceDiv(M, speed);
}

function gaugeRetro(speed, M, r, maxK, on) {
  const max = M.max, INK = "#1B1712", RED = "#C8402A", n = Math.round(max / (M.step / 4));
  let tMaj = "", tMid = "", tMin = "", nums = "";
  for (let i = 0; i <= n; i++) {
    const v = i * max / n, a = angOf(v, max);
    if (i % 4 === 0) {
      tMaj += lineA(180, 180, 136, 158, a);
      const [x, y] = ptA(180, 180, 116, a);
      nums += `<text x="${f1(x)}" y="${f1(y + 8)}">${Math.round(v)}</text>`;
    } else if (i % 2 === 0) tMid += lineA(180, 180, 146, 158, a);
    else tMin += lineA(180, 180, 151, 158, a);
  }
  const na = angOf(speed, max);
  const [tx, ty] = ptA(180, 180, 152, na), [bx, by] = ptA(180, 180, 16, na + 180);
  const [l1x, l1y] = ptA(180, 180, 5, na + 90), [l2x, l2y] = ptA(180, 180, 5, na - 90);
  const odo = String(Math.min(99999, Math.floor(tripKm(r) * 10))).padStart(5, "0");
  let odoSvg = "";
  for (let i = 0; i < 5; i++) {
    const last = i === 4;
    odoSvg += `<rect x="${126 + i * 18}" y="236" width="16" height="24" rx="2" fill="${last ? "#F4F1EA" : "#151515"}"/><text x="${134 + i * 18}" y="254" fill="${last ? "#151515" : "#F4F1EA"}">${odo[i]}</text>`;
  }
  return `<svg class="gx grt${on ? " on" : ""}" viewBox="0 0 360 360" width="300" height="300" role="img" aria-label="現在 ${speed} km/h">
<defs>
<radialGradient id="grtChrome" cx="35%" cy="25%" r="85%"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".45" stop-color="#A9AEB5"/><stop offset=".75" stop-color="#4A4E55"/><stop offset="1" stop-color="#C9CDD2"/></radialGradient>
<radialGradient id="grtFace" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#F6EFDD"/><stop offset=".85" stop-color="#EFE6CF"/><stop offset="1" stop-color="#D2C4A2"/></radialGradient>
<linearGradient id="grtGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient>
<filter id="grtSh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="2" dy="3" stdDeviation="2" flood-opacity=".35"/></filter>
</defs>
<circle cx="180" cy="180" r="178" fill="url(#grtChrome)"/>
<circle cx="180" cy="180" r="166" fill="url(#grtFace)" stroke="#2A241C" stroke-width="2"/>
<path d="${tMin}" stroke="${INK}" stroke-width="1.2"/><path d="${tMid}" stroke="${INK}" stroke-width="1.8"/><path d="${tMaj}" stroke="${INK}" stroke-width="3.2"/>
<g class="osw" font-weight="500" font-size="22" fill="${INK}" text-anchor="middle">${nums}</g>
${maxK > 0 ? `<path d="${lineA(180, 180, 158, 166, angOf(maxK, max))}" stroke="${RED}" stroke-width="4"/>` : ""}
<text x="180" y="226" class="osw" text-anchor="middle" font-weight="600" font-size="40" fill="${INK}">${speed}</text>
<rect x="122" y="232" width="98" height="32" rx="4" fill="#2B2620"/>
<g class="osw" font-size="17" text-anchor="middle">${odoSvg}</g>
<text x="226" y="254" class="serif" font-size="10" fill="${INK}" fill-opacity=".7">km</text>
<text x="180" y="290" class="serif" text-anchor="middle" font-weight="700" font-size="13" letter-spacing="4" fill="${INK}" fill-opacity=".7">KM/H</text>
<g filter="url(#grtSh)"><path class="needle" d="M${f1(bx)} ${f1(by)}L${f1(l1x)} ${f1(l1y)}L${f1(tx)} ${f1(ty)}L${f1(l2x)} ${f1(l2y)}Z" fill="${on ? RED : "#7A6A5A"}"/>
<circle cx="180" cy="180" r="15" fill="#1C1C1C"/><circle cx="176" cy="176" r="5" fill="#fff" fill-opacity=".25"/></g>
<circle cx="180" cy="180" r="166" fill="url(#grtGlass)"/>
</svg>` + paceDiv(M, speed);
}

const SEG7 = { 0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd", 6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abcdfg" };
function seven(ch, ox, oy, w, h, t) {
  const g = 3;
  const hs = (x1, x2, yc) => `${f1(x1)},${f1(yc)} ${f1(x1 + t / 2)},${f1(yc - t / 2)} ${f1(x2 - t / 2)},${f1(yc - t / 2)} ${f1(x2)},${f1(yc)} ${f1(x2 - t / 2)},${f1(yc + t / 2)} ${f1(x1 + t / 2)},${f1(yc + t / 2)}`;
  const vs = (xc, y1, y2) => `${f1(xc)},${f1(y1)} ${f1(xc + t / 2)},${f1(y1 + t / 2)} ${f1(xc + t / 2)},${f1(y2 - t / 2)} ${f1(xc)},${f1(y2)} ${f1(xc - t / 2)},${f1(y2 - t / 2)} ${f1(xc - t / 2)},${f1(y1 + t / 2)}`;
  const xl = ox + t / 2, xr = ox + w - t / 2, yt = oy + t / 2, ym = oy + h / 2, yb = oy + h - t / 2;
  const segs = { a: hs(xl + g, xr - g, yt), g: hs(xl + g, xr - g, ym), d: hs(xl + g, xr - g, yb), f: vs(xl, yt + g, ym - g), b: vs(xr, yt + g, ym - g), e: vs(xl, ym + g, yb - g), c: vs(xr, ym + g, yb - g) };
  const lit = SEG7[ch] || "";
  let on = "", off = "";
  for (const [k, p] of Object.entries(segs)) { if (lit.includes(k)) on += `<polygon points="${p}"/>`; else off += `<polygon points="${p}"/>`; }
  return [on, off];
}
function gaugeVfd(speed, M, r, maxK, on) {
  const G = "#5CF2C2", AMB = "#FFB547", max = M.max, NB = 30, lit = Math.round(NB * Math.min(1, speed / max));
  let bars = "", ghost = "";
  for (let i = 0; i < NB; i++) {
    const hh = 14 + i * 2.6, x = 8 + i * 11.4, f = i / NB;
    const rect = `<rect x="${f1(x)}" y="${f1(110 - hh)}" width="8.4" height="${f1(hh)}"`;
    if (i < lit) bars += `${rect} fill="${f < 0.6 ? G : f < 0.8 ? AMB : "#FF5A4E"}"/>`;
    else ghost += `${rect}/>`;
  }
  let scale = "";
  for (let k = 0; k <= 5; k++) {
    const v = Math.round(max * k / 5), x = Math.min(8 + k / 5 * NB * 11.4, 344);
    scale += `<text x="${f1(x)}" y="126"${k === 5 ? ' text-anchor="end"' : ""}>${v}</text>`;
  }
  const txt = String(speed).padStart(3, " ");
  let dOn = "", dOff = "";
  for (let i = 0; i < 3; i++) { const [a, b] = seven(txt[i], 16 + i * 108, 150, 92, 176, 17); dOn += a; dOff += b; }
  const mk = maxK > 0 ? Math.min(NB - 1, Math.round(NB * Math.min(1, maxK / max)) - 1) : -1;
  return `<svg class="gx gvf${on ? " on" : ""}" viewBox="0 0 352 380" width="290" height="313" role="img" aria-label="現在 ${speed} km/h">
<defs><filter id="gvfGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<text x="8" y="22" class="mono" font-size="12" letter-spacing="2" fill="${AMB}">SPEED</text>
<g fill="rgba(92,242,194,.08)">${ghost}</g>
<g class="hl" filter="url(#gvfGlow)">${bars}</g>
${mk >= 0 ? `<rect x="${f1(8 + mk * 11.4)}" y="0" width="8.4" height="3" fill="#FFFFFF" opacity=".8"/>` : ""}
<g class="mono" font-size="11" fill="${AMB}" fill-opacity=".8">${scale}</g>
<g transform="skewX(-6) translate(18 0)"><g fill="rgba(92,242,194,.07)">${dOff}</g><g class="hl" fill="${G}" filter="url(#gvfGlow)">${dOn}</g></g>
<text x="336" y="356" class="mono hl" text-anchor="end" font-size="20" letter-spacing="3" fill="${G}" filter="url(#gvfGlow)">km/h</text>
<text x="8" y="356" class="mono" font-size="12" letter-spacing="2" fill="${AMB}" fill-opacity=".85">TRIP ${tripKm(r).toFixed(1).padStart(5, "0")}</text>
</svg>` + paceDiv(M, speed);
}

function gaugeSynth(speed, M, r, maxK, on) {
  const PINK = "#FF2E88";
  let grid = "";
  for (let i = -12; i <= 12; i++) grid += `M${f1(180 + i * 14)} 250L${f1(180 + i * 70)} 400`;
  [2, 8, 18, 32, 52, 80, 114, 150].forEach((y) => { grid += `M0 ${250 + y}H360`; });
  const bands = [[55, 172], [177, 190], [196, 208], [214, 223], [229, 237], [242, 250]];
  return `<svg class="gx gsy${on ? " on" : ""}" viewBox="0 0 360 400" width="300" height="333" role="img" aria-label="現在 ${speed} km/h">
<defs>
<linearGradient id="gsySky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0A0220"/><stop offset=".55" stop-color="#1E0838"/><stop offset="1" stop-color="#3B0A55"/></linearGradient>
<linearGradient id="gsySun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE14D"/><stop offset=".45" stop-color="#FF8A3D"/><stop offset=".85" stop-color="${PINK}"/></linearGradient>
<linearGradient id="gsyTxt" gradientUnits="userSpaceOnUse" x1="0" y1="112" x2="0" y2="250"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".46" stop-color="#3DF2FF"/><stop offset=".5" stop-color="#1B2B8F"/><stop offset=".54" stop-color="#FF8AD0"/><stop offset="1" stop-color="#FFFFFF"/></linearGradient>
<linearGradient id="gsyFade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".14" stop-color="#fff"/><stop offset=".86" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<mask id="gsyMask"><rect width="360" height="400" fill="url(#gsyFade)"/></mask>
<clipPath id="gsyBands">${bands.map(([a, b]) => `<rect x="0" y="${a}" width="360" height="${b - a}"/>`).join("")}</clipPath>
<filter id="gsyGlow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="7" flood-color="${PINK}" flood-opacity=".9"/></filter>
</defs>
<g mask="url(#gsyMask)">
<rect width="360" height="250" fill="url(#gsySky)"/><rect y="250" width="360" height="150" fill="#0A0220"/>
<circle cx="180" cy="170" r="115" fill="url(#gsySun)" clip-path="url(#gsyBands)" class="hl"/>
<path d="${grid}" stroke="${PINK}" stroke-width="1.4" stroke-opacity=".75" fill="none"/>
<path d="M0 250H360" stroke="${PINK}" stroke-width="2.5" filter="url(#gsyGlow)"/>
</g>
<text x="180" y="248" class="bci hl" text-anchor="middle" font-size="190" fill="url(#gsyTxt)" stroke="rgba(255,255,255,.55)" stroke-width="2" filter="url(#gsyGlow)">${speed}</text>
<text x="292" y="306" class="script" font-size="34" fill="${PINK}" transform="rotate(-8 292 306)" filter="url(#gsyGlow)">km/h</text>
</svg>` + paceDiv(M, speed);
}

function gaugeNixie(speed, M, r, maxK, on) {
  const txt = String(speed).padStart(3, " ");
  const ghosts = ["0", "3", "6"];
  let tubes = "";
  for (let i = 0; i < 3; i++) {
    const x = 18 + i * 112, y = 18, d = txt[i] !== " " ? txt[i] : "";
    const shape = `M${x} ${y + 50}A50 50 0 0 1 ${x + 100} ${y + 50}V${y + 228}a12 12 0 0 1 -12 12H${x + 12}a12 12 0 0 1 -12 -12Z`;
    tubes += `<path d="${shape}" fill="#120B07"/>` + (d ? `<path d="${shape}" fill="url(#gnxTube)"/>` : "") +
      `<path d="${shape}" fill="url(#gnxMesh)"/>` +
      `<text x="${x + 50}" y="206" fill="rgba(255,160,90,.05)">${ghosts[i]}</text>` +
      (d ? `<text x="${x + 50}" y="204" fill="#FFD0A0" class="hl" filter="url(#gnxGlow)">${d}</text>` : "") +
      `<path d="${shape}" fill="none" stroke="rgba(255,220,180,.22)"/>` +
      `<rect x="${x + 9}" y="${y + 18}" width="12" height="${200}" rx="6" fill="url(#gnxHi)"/>` +
      `<rect x="${x + 6}" y="${y + 238}" width="88" height="18" rx="6" fill="#1F1812" stroke="#3A2F25"/>`;
  }
  return `<svg class="gx gnx${on ? " on" : ""}" viewBox="0 0 360 340" width="300" height="283" role="img" aria-label="現在 ${speed} km/h">
<defs>
<filter id="gnxGlow" x="-60%" y="-40%" width="220%" height="180%"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="a"/><feGaussianBlur in="SourceGraphic" stdDeviation="11" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="a"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<pattern id="gnxMesh" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="3.5" cy="3.5" r="1" fill="rgba(255,200,150,.10)"/></pattern>
<radialGradient id="gnxTube" cx="50%" cy="55%" r="60%"><stop offset="0" stop-color="#FF6E28" stop-opacity=".2"/><stop offset="1" stop-color="#120B07" stop-opacity="0"/></radialGradient>
<linearGradient id="gnxHi" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="gnxBrass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9A35E"/><stop offset="1" stop-color="#8A6A35"/></linearGradient>
</defs>
<rect x="4" y="4" width="352" height="284" rx="18" fill="#1F160F" stroke="#4A3826"/>
<g class="bcl" font-size="190" text-anchor="middle">${tubes}</g>
<rect x="130" y="302" width="100" height="28" rx="4" fill="url(#gnxBrass)"/>
<text x="180" y="322" class="bc" text-anchor="middle" font-weight="700" font-size="16" letter-spacing="5" fill="#2A1C0B">KM/H</text>
</svg>` + paceDiv(M, speed);
}

/* ================= 地圖（OpenStreetMap 圖磚） ================= */

const TILE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const tiles = new Map();   // url → Image（載好的或還在載的）
const MAX_Z = 17;

function tileOf(lon, lat, z) {
  const n = 2 ** z;
  const x = (lon + 180) / 360 * n;
  const la = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n;
  return [x, y];
}

// 速度對顏色：慢是藍、中間黃、快是主色（橘）
function speedColor(v, vmax) {
  const f = Math.max(0, Math.min(1, vmax > 0 ? v / vmax : 0));
  const stops = [[76, 154, 255], [224, 179, 65], accentRgb()];
  const i = f < 0.5 ? 0 : 1, t = f < 0.5 ? f * 2 : (f - 0.5) * 2;
  const c = stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function accentRgb() {
  const s = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (!m) return [255, 106, 31];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const isDark = () => getComputedStyle(document.documentElement).colorScheme?.includes("dark") || !document.documentElement.getAttribute("data-theme") || document.documentElement.getAttribute("data-theme") === "dark";

/* 把一段路線畫到 canvas 上：底圖是 OSM 圖磚（載不到就只有暗底），線的顏色照速度，起點白圈、終點／現在的位置實心 */
class RouteMap {
  constructor(canvas) {
    this.c = canvas;
    this.pts = [];
    this.mark = -1;
    this.pending = 0;
  }
  draw(pts, mark = -1) {
    this.pts = pts;
    this.mark = mark;
    this.paint();
  }
  paint() {
    const c = this.c, box = c.parentElement;
    if (!box || !box.clientWidth) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = box.clientWidth, H = box.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = isDark() ? "#1A1D23" : "#E8E8E3";
    g.fillRect(0, 0, W, H);
    const pts = this.pts;
    if (!pts.length) { this.grid(g, W, H); return; }

    // 把整條路線框起來，挑一個放得下的縮放
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const p of pts) { if (p[1] < minLat) minLat = p[1]; if (p[1] > maxLat) maxLat = p[1]; if (p[2] < minLon) minLon = p[2]; if (p[2] > maxLon) maxLon = p[2]; }
    const pad = 28;
    let z = MAX_Z;
    for (; z > 2; z--) {
      const [x0, y0] = tileOf(minLon, maxLat, z), [x1, y1] = tileOf(maxLon, minLat, z);
      if ((x1 - x0) * 256 <= W - pad * 2 && (y1 - y0) * 256 <= H - pad * 2) break;
    }
    const [ax, ay] = tileOf(minLon, maxLat, z), [bx, by] = tileOf(maxLon, minLat, z);
    const cx = (ax + bx) / 2, cy = (ay + by) / 2;         // 圖磚座標的中心
    const toPx = (lon, lat) => { const [x, y] = tileOf(lon, lat, z); return [W / 2 + (x - cx) * 256, H / 2 + (y - cy) * 256]; };

    // 底圖
    const n = 2 ** z;
    const tx0 = Math.floor(cx - W / 512), tx1 = Math.floor(cx + W / 512);
    const ty0 = Math.floor(cy - H / 512), ty1 = Math.floor(cy + H / 512);
    let drewTile = false;
    g.save();
    if (isDark()) g.filter = "invert(1) hue-rotate(180deg) brightness(.82) saturate(.45)";
    for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
      if (ty < 0 || ty >= n) continue;
      const img = this.tile(z, ((tx % n) + n) % n, ty);
      if (img?.complete && img.naturalWidth) {
        g.drawImage(img, W / 2 + (tx - cx) * 256, H / 2 + (ty - cy) * 256, 256, 256);
        drewTile = true;
      }
    }
    g.restore();
    if (!drewTile) this.grid(g, W, H);

    // 路線：一段一段照速度上色
    let vmax = 0;
    for (const p of pts) if (p[3] > vmax) vmax = p[3];
    vmax = Math.max(vmax, MODES[mode].max / 3.6 * 0.4);
    g.lineCap = "round"; g.lineJoin = "round";
    g.lineWidth = 7; g.strokeStyle = isDark() ? "rgba(14,15,18,.7)" : "rgba(255,255,255,.8)";
    g.beginPath();
    for (let i = 0; i < pts.length; i++) { const [x, y] = toPx(pts[i][2], pts[i][1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
    g.lineWidth = 4;
    let [px, py] = toPx(pts[0][2], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const [x, y] = toPx(pts[i][2], pts[i][1]);
      g.strokeStyle = speedColor(pts[i][3], vmax);
      g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke();
      px = x; py = y;
    }
    // 起點、終點（或現在）
    const dot = (x, y, r, fill, ring) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); g.lineWidth = 2.5; g.strokeStyle = ring; g.stroke(); };
    const ink = isDark() ? "#F2F3F5" : "#15181D", ground = isDark() ? "#0E0F12" : "#FFFFFF";
    const [sx, sy] = toPx(pts[0][2], pts[0][1]);
    dot(sx, sy, 5, ground, ink);
    const last = pts[pts.length - 1];
    const [ex, ey] = toPx(last[2], last[1]);
    const acc = `rgb(${accentRgb().join(",")})`;
    if (this.mark < 0) {
      g.beginPath(); g.arc(ex, ey, 14, 0, Math.PI * 2); g.fillStyle = acc; g.globalAlpha = .2; g.fill(); g.globalAlpha = 1;
      dot(ex, ey, 6, acc, ink);
    } else {
      dot(ex, ey, 5, ink, ground);
      const m = pts[Math.min(this.mark, pts.length - 1)];
      const [mx, my] = toPx(m[2], m[1]);
      dot(mx, my, 7, acc, ink);
    }
  }
  grid(g, W, H) {
    g.strokeStyle = isDark() ? "#252931" : "#D6D6D0"; g.lineWidth = 1;
    for (let x = 20; x < W; x += 52) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 20; y < H; y += 52) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  }
  tile(z, x, y) {
    const url = TILE.replace("{z}", z).replace("{x}", x).replace("{y}", y);
    let img = tiles.get(url);
    if (!img) {
      img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => { if (this.pending < 2) { this.pending++; requestAnimationFrame(() => { this.pending--; this.paint(); }); } };
      img.onerror = () => { tiles.delete(url); setTimeout(() => { /* 之後再試 */ }, 0); };
      img.src = url;
      tiles.set(url, img);
      if (tiles.size > 400) tiles.delete(tiles.keys().next().value);
    }
    return img;
  }
}

/* ================= 速度曲線（SVG） ================= */

const niceMax = (k) => {
  if (k <= 10) return 10;
  const steps = [20, 30, 40, 60, 80, 100, 120, 160, 200, 250, 300];
  return steps.find((s) => s >= k) || Math.ceil(k / 100) * 100;
};

/* pts：[t, lat, lon, v, acc]；from/to：橫軸的時間範圍；xLabels：[[t, 字]]；scrub：手指停在第幾個點 */
function chartSvg(pts, { w = 358, h = 190, from, to, xLabels = [], scrub = -1, live = false, ymax }) {
  const L = 36, R = 12, T = 14, B = live ? 6 : 26;
  const span = Math.max(1, to - from);
  let vm = 0;
  for (const p of pts) if (p[0] >= from && p[3] * 3.6 > vm) vm = p[3] * 3.6;
  const Y = ymax || niceMax(Math.max(vm, 5));
  const X = (t) => L + (w - L - R) * Math.min(1, Math.max(0, (t - from) / span));
  const Yp = (k) => T + (h - T - B) * (1 - Math.min(1, k / Y));
  const ticks = Y <= 40 ? [0, Y / 2, Y] : [0, Y / 3, (2 * Y) / 3, Y].map((v) => Math.round(v));
  let grid = "", ylab = "";
  for (const k of ticks) {
    const y = f1(Yp(k));
    grid += `M${L} ${y}H${w - R}`;
    ylab += `<text x="${L - 6}" y="${f1(Yp(k) + 4)}">${k}</text>`;
  }
  let xlab = "";
  for (const [t, s] of xLabels) xlab += `<text x="${f1(X(t))}" y="${h - 8}" text-anchor="middle">${esc(s)}</text>`;
  // 點比像素多就每個像素取最大值，曲線才不會變成一團毛
  let line = "", first = true, lastX = -1, bucketMax = 0, bucketX = 0;
  const flush = () => { if (lastX < 0) return; line += (first ? "M" : "L") + f1(bucketX) + " " + f1(Yp(bucketMax)); first = false; };
  for (const p of pts) {
    if (p[0] < from || p[0] > to) continue;
    const x = Math.round(X(p[0]) * 2) / 2, k = p[3] * 3.6;
    if (x !== lastX) { flush(); lastX = x; bucketX = x; bucketMax = k; } else if (k > bucketMax) bucketMax = k;
  }
  flush();
  const area = line ? `${line.replace(/^M([\d.]+) [\d.]+/, (m, x) => `M${x} ${f1(Yp(0))}L${m.slice(1)}`)}L${f1(bucketX)} ${f1(Yp(0))}Z` : "";
  let scrubG = "";
  if (scrub >= 0 && pts[scrub]) {
    const p = pts[scrub], x = f1(X(p[0])), k = kmh(p[3]);
    scrubG = `<g class="scrub"><path d="M${x} ${f1(Yp(Y))}V${f1(Yp(0))}"/><circle cx="${x}" cy="${f1(Yp(k))}" r="5"/><rect x="${f1(Math.min(w - R - 74, Math.max(L, X(p[0]) - 37)))}" y="2" width="74" height="18" rx="5"/><text x="${f1(Math.min(w - R - 37, Math.max(L + 37, X(p[0]))))}" y="15" text-anchor="middle">${k} km/h・${hhmm(p[0])}</text></g>`;
  }
  let maxG = "";
  if (!live && pts.length) {
    let mi = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i][3] > pts[mi][3]) mi = i;
    const p = pts[mi];
    if (p[3] > 0) maxG = `<circle class="maxpt" cx="${f1(X(p[0]))}" cy="${f1(Yp(p[3] * 3.6))}" r="4.5"/>`;
  }
  const endDot = live && pts.length && pts[pts.length - 1][0] >= from ? `<circle class="endpt" cx="${f1(X(pts[pts.length - 1][0]))}" cy="${f1(Yp(pts[pts.length - 1][3] * 3.6))}" r="4"/>` : "";
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="速度曲線">
<path class="grid" d="${grid}"/><g class="ylab">${ylab}</g><g class="xlab">${xlab}</g>
${area ? `<path class="area" d="${area}"/>` : ""}${line ? `<path class="line" d="${line}"/>` : ""}${maxG}${endDot}${scrubG}
</svg>`;
}

// 整趟的橫軸標籤：挑一個刻度讓標籤不超過 6 個
function xLabelsFor(from, to) {
  const mins = (to - from) / 60000;
  const step = [1, 2, 5, 10, 15, 30, 60, 120].find((s) => mins / s <= 6) || 240;
  const out = [];
  for (let m = 0; m <= mins + 1e-9; m += step) out.push([from + m * 60000, m === 0 ? "0" : m < 60 ? m + " 分" : (m / 60).toFixed(m % 60 ? 1 : 0) + " 小時"]);
  return out;
}

/* ================= 畫面：行車紀錄那一頁 ================= */

const S = {};
function grab() {
  for (const id of ["tripModes", "tripRecBar", "tripStatus", "tripGauge", "tripGaugeSel", "tripStats", "tripMapBox", "tripMap", "tripChartBox", "tripChart", "tripStart", "tripPause", "tripStop", "tripNote", "tripList", "tripEmpty", "tripDot", "tiMode", "tiTitle", "tiMap", "tiTable", "tiChart", "tiHint", "tiDel", "tiMapBox", "tripFocus", "tripEndWrap", "tripEndDim", "tripEndStats", "tripEndNote", "tripEndDrop", "tripEndKeep", "tripEndMore", "tripEndClose", "tripAcctCard", "tripAcctText", "tripAcctBtn", "tripAcctLine", "tripAcctStatus", "tripAcctStatusIc", "tripAcctStatusText", "tripAcctStatusNum", "tripAcctBar", "tripAcctBarFill", "tripListNote", "tripGaugeWrap", "tripGaugeDim", "tripGaugeList", "tripGaugeClose", "tripCamGo", "tripCamNote"]) S[id] = $(id);
}
let liveMap = null, itemMap = null;

function paintModes() {
  const box = S.tripModes;
  box.setAttribute("aria-disabled", rec ? "true" : "false");
  box.innerHTML = Object.entries(MODES).map(([k, m]) =>
    `<button type="button" data-mode="${k}" aria-pressed="${k === mode}">${ICONS[k]}${m.name}</button>`).join("");
}
// 面板只放一顆按鈕寫現在用哪個，點下去從下面跳出來選（每個附小預覽）
const CHEV_DN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>';
function paintGaugeSel() {
  S.tripGaugeSel.innerHTML = `<span class="k">面板</span><b>${GAUGES[gauge]}</b>${CHEV_DN}`;
  S.tripGaugeSel.setAttribute("aria-label", `時速面板：${GAUGES[gauge]}，點一下換`);
}
function openGaugePick() {
  const M = MODES[mode];
  const v = Math.round(M.max * 0.44) / 3.6;
  S.tripGaugeList.innerHTML = Object.entries(GAUGES).map(([k, n]) =>
    `<button type="button" data-gauge="${k}" aria-pressed="${k === gauge}"><span class="gprev" aria-hidden="true"><span class="gpv" data-kind="${k}" data-shape="${SVG_GAUGES.has(k) ? "svg" : ""}">${gaugeHtml(v, null, k, true)}</span></span><span class="gname">${n}</span></button>`).join("");
  S.tripGaugeWrap.hidden = false;
  document.body.classList.add("sharing");
  S.tripGaugeList.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
}
function closeGaugePick() {
  S.tripGaugeWrap.hidden = true;
  S.tripGaugeList.innerHTML = "";   // 預覽裡的 SVG 跟現在的面板同名，關掉就清掉
  document.body.classList.remove("sharing");
}

function paintPanel() {
  if (view !== "trip") return;
  paintModes();
  paintGaugeSel();
  const M = MODES[mode];
  const live = !!rec;
  S.tripRecBar.hidden = !live;
  S.tripStats.hidden = !live || gauge === "simple" || (focus && gauge === "race");   // 簡潔面板把這三個數字放在旁邊了
  S.tripMapBox.hidden = !live || focus;
  S.tripChartBox.hidden = !live || focus;
  S.tripFocus.hidden = !live;
  S.tripFocus.setAttribute("aria-pressed", String(focus));
  S.tripFocus.title = focus ? "顯示地圖和曲線" : "只看時速";
  S.tripFocus.setAttribute("aria-label", S.tripFocus.title);
  S.tripStart.hidden = live;
  S.tripPause.hidden = !live;
  S.tripStop.hidden = !live;
  S.tripStatus.hidden = live;
  const old = oldShell();
  S.tripStart.disabled = old;
  S.tripCamGo.hidden = live;
  S.tripCamNote.hidden = live;

  if (!live) {
    let txt, cls = "";
    if (old) txt = "這個功能要新版的 App 才有，請先把 App 更新到最新版（有新版時最上面會跳「更新」）。";
    else if (shellApp()) txt = "按「開始記錄」會打開 GPS；螢幕關掉也會繼續記。";
    else if (navigator.wakeLock) txt = "按「開始記錄」會打開 GPS；記錄時螢幕會保持亮著。";
    else txt = "按「開始記錄」會打開 GPS；螢幕要一直亮著才會繼續記。";
    S.tripStatus.innerHTML = `<span class="d${cls}"></span>${esc(txt)}`;
  }
  const noteHtml = noteMsg ? esc(noteMsg) + (noteBtn ? ` <button type="button" class="small" id="tripNoteBtn">${esc(noteBtn.text)}</button>` : "") : "";
  S.tripNote.innerHTML = noteHtml;
  S.tripNote.hidden = !noteHtml;
  if (noteBtn) $("tripNoteBtn")?.addEventListener("click", noteBtn.fn);

  S.tripPause.innerHTML = rec?.paused ? PLAY + "繼續" : PAUSE + "暫停";
  S.tripRecBar.classList.toggle("paused", !!rec?.paused);
  paintLiveNumbers();
  if (live && !focus) { paintLiveChart(); paintLiveMap(); }
  else S.tripGauge.innerHTML = gaugeHtml(0, null);
  S.tripGauge.dataset.kind = gauge;
  S.tripGauge.dataset.shape = SVG_GAUGES.has(gauge) ? "svg" : "";
  paintTheme();
}
// 風格面板：body 標上是哪一種，CSS 在記錄中把底色、數字、按鈕換掉
function paintTheme() {
  const st = STYLE_GAUGES.has(gauge);
  document.body.classList.toggle("tgs", st);
  if (st) document.body.dataset.gstyle = gauge; else delete document.body.dataset.gstyle;
}

const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.8v14.4a1 1 0 0 0 1.5.9l11.5-7.2a1 1 0 0 0 0-1.8L8.5 3.9A1 1 0 0 0 7 4.8z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5.5" y="4" width="4.5" height="16" rx="1.2"/><rect x="14" y="4" width="4.5" height="16" rx="1.2"/></svg>';

function gpsText(r) {
  if (gpsErr === 1) return "手機不准用位置";
  if (!r.last) return gpsErr ? "抓不到 GPS 訊號，到戶外空曠的地方試試" : "正在抓 GPS 訊號…";
  if (Date.now() - r.lastFixAt > 8000) return "GPS 訊號弱";
  if (r.acc <= 20) return "GPS 定位好了";
  return "GPS 準度 ±" + Math.round(r.acc) + " m";
}

function paintLiveNumbers() {
  if (view !== "trip") return;
  const r = rec;
  if (!r) return;
  const M = MODES[r.mode];
  S.tripRecBar.innerHTML = `<span class="d${r.paused ? "" : " rec"}"></span><span class="t">${r.paused ? "暫停了" : "記錄中"}・${M.name}</span><span class="gps">${esc(gpsText(r))}</span><time>${hms(elapsed(r))}</time>`;
  S.tripGauge.innerHTML = gaugeHtml(r.paused ? 0 : r.vShow, r);
  S.tripGauge.dataset.n = M.max >= 100 ? "3" : "2";   // 腳踏車、跑步最多兩位數：只看時速時字可以放更大
  const avg = avgV(r);
  S.tripStats.innerHTML =
    `<div class="stat"><b>${km(r.dist)}<small>km</small></b><span>距離</span></div>` +
    (M.pace
      ? `<div class="stat"><b>${esc(paceText(avg))}</b><span>平均配速 /km</span></div>`
      : `<div class="stat"><b>${avg ? kmh1(avg) : "0"}</b><span>平均 km/h</span></div>`) +
    `<div class="stat"><b>${kmh(r.maxV)}</b><span>最快 km/h</span></div>`;
}

/* 手機打橫：CSS 會把曲線框變寬變矮，SVG 就照框的大小畫 */
const isLand = () => matchMedia("(orientation: landscape) and (max-height: 600px)").matches;
function chartSize(box, h) {
  // 記錄中（直的也全螢幕）和橫的：框是固定高度，照框算；其他時候照預設比例
  const fixed = isLand() || (box === S.tripChart && document.body.classList.contains("triplive"));
  if (!fixed) return { w: 358, h };
  return { w: box.clientWidth || 358, h: box.clientHeight || h };
}
let itemChartW = 358;

function paintLiveChart() {
  if (view !== "trip" || !rec || focus) return;
  const now = rec.paused ? rec.pausedAt : Date.now();
  const from = Math.max(rec.start, now - 10 * 60000);
  const sz = chartSize(S.tripChart, 100);
  S.tripChart.innerHTML = chartSvg(rec.pts, { ...sz, from, to: Math.max(now, from + 60000), live: true, ymax: niceMax(Math.max(10, rec.maxV * 3.6, MODES[rec.mode].max * 0.3)) });
}
function paintLiveMap() {
  if (view !== "trip" || !rec || focus) return;
  if (!liveMap) liveMap = new RouteMap(S.tripMap);
  liveMap.draw(rec.pts);
}
function paintTripDot() {
  if (S.tripDot) S.tripDot.hidden = !rec;
  document.body.classList.toggle("triplive", !!rec);
  document.body.classList.toggle("tripfocus", !!rec && focus);
}

/* 之前的紀錄 */
function thumbSvg(pts) {
  if (pts.length < 2) return "";
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const p of pts) { if (p[1] < minLat) minLat = p[1]; if (p[1] > maxLat) maxLat = p[1]; if (p[2] < minLon) minLon = p[2]; if (p[2] > maxLon) maxLon = p[2]; }
  const cos = Math.cos((minLat + maxLat) / 2 * Math.PI / 180);
  const spanX = (maxLon - minLon) * cos || 1e-6, spanY = (maxLat - minLat) || 1e-6;
  const s = 36 / Math.max(spanX, spanY);
  const ox = (44 - spanX * s) / 2, oy = (44 - spanY * s) / 2;
  const k = Math.max(1, Math.floor(pts.length / 80));
  let d = "";
  for (let i = 0; i < pts.length; i += k) {
    const p = pts[i];
    d += (d ? "L" : "M") + f1(ox + (p[2] - minLon) * cos * s) + " " + f1(oy + (maxLat - p[1]) * s);
  }
  return `<svg viewBox="0 0 44 44" aria-hidden="true"><path d="${d}"/></svg>`;
}

async function paintList() {
  let all = [];
  try { all = await allTrips(); } catch { /* 不給用 IndexedDB 就當沒有 */ }
  if (view !== "trip") return;
  all = all.filter(visibleTrip);
  const w = whoNow();
  dirtyCount = w ? all.filter((t) => !(t.owner === w.uid && !t.dirty)).length : 0;
  S.tripEmpty.hidden = all.length > 0;
  let html = "", last = "";
  for (const t of all) {
    const g = dayLabel(t.start);
    if (g !== last) { html += `<div class="hgroup">${esc(g)}</div>`; last = g; }
    const M = MODES[t.mode] || MODES.car;
    const tail = M.pace ? "配速 " + esc(paceText(avgV(t))) : "最快 " + kmh(t.maxV) + " km/h";
    // 登入了每趟右邊一朵雲：綠的打勾＝存好了，箭頭＝還沒傳（等網路）
    const cloud = !w ? "" : (t.owner === w.uid && !t.dirty)
      ? `<span class="tcloud ok" title="已存到雲端">${CLOUD_OK}</span>`
      : `<span class="tcloud up" title="還沒傳到雲端">${CLOUD_UP}</span>`;
    html += `<a class="hrow trow" href="#trip/${encodeURIComponent(t.id)}"><span class="hthumb tthumb">${thumbSvg(t.pts)}</span>` +
      `<span class="hinfo"><span class="tline1"><b class="tmode">${M.name}</b><span class="tdist">${km(t.dist)} km</span></span>` +
      `<span class="tsub">${esc(clockText(t.start))}・${durShort(t.elapsed)}・${tail}</span></span>${cloud}${CHEV}</a>`;
  }
  S.tripList.innerHTML = html;
  // 右上角那行字
  if (!w) S.tripListNote.textContent = "只存在這支手機";
  else {
    const inCloud = all.filter((t) => t.owner === w.uid && !t.dirty).length;
    const waiting = all.length - inCloud;
    S.tripListNote.textContent = all.length
      ? `${all.length} 趟・${inCloud} 趟在雲端${waiting ? `，${waiting} 趟等網路` : ""}`
      : "會存到雲端";
  }
  paintTripAcct();
}

const CLOUD_PATH = '<path d="M7 18.5h10.3a4.2 4.2 0 0 0 .5-8.4 6 6 0 0 0-11.5-.9A4.7 4.7 0 0 0 7 18.5z"/>';
const cloudSvg = (more) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CLOUD_PATH}${more}</svg>`;
const CLOUD = cloudSvg("");
const CLOUD_OK = cloudSvg('<path d="M9.4 13.6l1.9 1.9 3.5-3.7"/>');
const CLOUD_UP = cloudSvg('<path d="M12 16v-5M9.5 13.5 12 11l2.5 2.5"/>');
const SYNC_IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-13.7 5.6"/><path d="M4 12a8 8 0 0 1 13.7-5.6"/><path d="M17.7 3v3.6h-3.6"/><path d="M6.3 21v-3.6h3.6"/></svg>';
const ALERT_IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.4v5.4"/><path d="M12 16.1v.3"/></svg>';

/* 列表上面：沒登入一張卡（用 email 登入），登入了一行字（誰、存好了沒）＋同步進度 */
function paintTripAcct() {
  if (view !== "trip" || !S.tripAcctCard) return;
  const w = whoNow();
  const s = acctSnap?.sync || {};
  const old = oldShell();
  S.tripAcctCard.hidden = !!w;
  if (!w) {
    S.tripAcctText.textContent = old
      ? "要用 email 登入，得先更新到最新版。手機上的紀錄不會不見。"
      : "用 email 登入，每趟結束存起來就會一起存到雲端。換手機用同一個 email 登入，紀錄就拿得回來。跟「紀錄」用同一個帳號，那邊登入過這邊就不用再登。";
    S.tripAcctBtn.textContent = old ? "更新" : "用 email 登入";
    S.tripAcctBtn.href = old ? (hooks.apkHref?.() || "#") : "#login";
  }
  S.tripAcctLine.hidden = !w;
  if (w) {
    const busy = s.phase && s.phase !== "idle";
    const synced = !!acctSnap?.user && !busy && !s.error && !dirtyCount;
    S.tripAcctLine.innerHTML = synced
      ? `<span class="ok">${CLOUD_OK}</span><span>已存到雲端・${esc(w.email)}</span>`
      : `${CLOUD}<span>已登入・${esc(w.email)}</span>`;
  }
  // 行車紀錄自己的同步進度（tup／tdown）；辨車紀錄那邊的進度在「紀錄」頁顯示
  let st = null;
  if (w && s.phase === "tup") st = ["busy", SYNC_IC, "正在把這支手機的行車紀錄存上去…", s.total ? `${Math.min(s.done, s.total)} / ${s.total}` : "", s.total ? Math.min(1, s.done / s.total) : null];
  else if (w && s.phase === "tdown") st = ["busy", SYNC_IC, "正在把雲端的行車紀錄拿回來…", s.total ? `${Math.min(s.done, s.total)} / ${s.total}` : "", s.total ? Math.min(1, s.done / s.total) : null];
  else if (w && s.phase === "idle" && s.error) st = ["bad", ALERT_IC, s.error?.code === "permission-denied" ? "雲端還不讓這個帳號存紀錄，紀錄先留在這支手機" : "雲端同步沒成功，有網路時會再試一次"];
  S.tripAcctStatus.hidden = !st;
  if (st) {
    S.tripAcctStatus.className = "acct-status " + st[0];
    S.tripAcctStatusIc.innerHTML = st[1];
    S.tripAcctStatusText.textContent = st[2];
    S.tripAcctStatusNum.textContent = st[3] || "";
    S.tripAcctStatusNum.hidden = !st[3];
    S.tripAcctBar.hidden = st[4] == null;
    S.tripAcctBarFill.style.width = st[4] == null ? "0%" : (st[4] * 100).toFixed(1) + "%";
  }
}
let dirtyCount = 0;   // 自己的、還沒傳的有幾趟（paintList 順便算）

/* ================= 畫面：一筆紀錄 ================= */

let item = null, scrubIdx = -1;

async function paintItem(id) {
  item = null;
  scrubIdx = -1;
  try { item = await getTrip(id); } catch { /* 下面當沒有 */ }
  if (item && !visibleTrip(item)) item = null;
  if (view !== "item") return;
  if (!item) { S.tiTitle.textContent = "找不到這筆紀錄"; S.tiMode.textContent = ""; S.tiTable.innerHTML = ""; S.tiChart.innerHTML = ""; S.tiMapBox.hidden = true; S.tiDel.hidden = true; return; }
  S.tiMapBox.hidden = false;
  S.tiDel.hidden = false;
  const t = item, M = MODES[t.mode] || MODES.car;
  S.tiMode.textContent = M.name;
  S.tiTitle.textContent = dayLabel(t.start) + " " + clockText(t.start);
  const avg = avgV(t);
  const stopped = Math.max(0, t.elapsed - t.moving);
  const row = (k, v, small) => `<tr><th>${k}</th><td><b class="n">${v}</b>${small ? `<span class="tsmall">${esc(small)}</span>` : ""}</td></tr>`;
  S.tiTable.innerHTML =
    row("距離", km(t.dist) + " km") +
    row("花了多久", durText(t.elapsed), hhmm(t.start) + " – " + hhmm(t.end)) +
    (M.pace ? row("平均配速", esc(paceText(avg)) + " /km") : "") +
    row("平均時速", (avg ? kmh1(avg) : "0") + " km/h", t.pausedMs > 1000 ? "暫停了 " + durText(t.pausedMs) + "，沒算進去" : "") +
    row("最快", kmh(t.maxV) + " km/h", t.maxAt ? clockText(t.maxAt) : "") +
    row("停下來", durText(stopped), M.pace ? "" : "紅燈、塞車") +
    (!M.pace && t.launch != null ? row("0 → " + M.launch + " 最快", t.launch + " 秒") : "");
  if (!itemMap) itemMap = new RouteMap(S.tiMap);
  itemMap.draw(t.pts, -1);
  paintItemChart();
}
function paintItemChart() {
  const t = item;
  if (!t || view !== "item") return;
  const from = t.start, to = Math.max(t.end, t.start + 60000);
  const sz = chartSize(S.tiChart, 190);
  itemChartW = sz.w;
  S.tiChart.innerHTML = chartSvg(t.pts, { ...sz, from, to, xLabels: xLabelsFor(from, to), scrub: scrubIdx });
  S.tiHint.textContent = scrubIdx >= 0 && t.pts[scrubIdx]
    ? `${hhmm(t.pts[scrubIdx][0])}　${kmh(t.pts[scrubIdx][3])} km/h${MODES[t.mode]?.pace ? "　配速 " + paceText(t.pts[scrubIdx][3]) : ""}`
    : "手指在曲線上左右滑，看那一刻多快、在地圖哪裡。";
}
function scrubAt(clientX) {
  const t = item;
  if (!t || !t.pts.length) return;
  const svg = S.tiChart.querySelector("svg");
  if (!svg) return;
  const box = svg.getBoundingClientRect();
  const L = 36 / itemChartW * box.width, R = 12 / itemChartW * box.width;
  const f = Math.min(1, Math.max(0, (clientX - box.left - L) / (box.width - L - R)));
  const want = t.start + f * (Math.max(t.end, t.start + 60000) - t.start);
  // 二分找最接近的點
  let lo = 0, hi = t.pts.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (t.pts[mid][0] < want) lo = mid + 1; else hi = mid; }
  if (lo > 0 && Math.abs(t.pts[lo - 1][0] - want) < Math.abs(t.pts[lo][0] - want)) lo--;
  if (lo === scrubIdx) return;
  scrubIdx = lo;
  paintItemChart();
  itemMap?.draw(t.pts, scrubIdx);
}

/* ================= 接上畫面 ================= */

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  grab();
  S.tripModes.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (!b || rec) return;
    mode = b.dataset.mode;
    store(MODE_KEY, mode);
    setNote("");
    paintPanel();
  });
  S.tripGaugeSel.addEventListener("click", openGaugePick);
  S.tripGaugeList.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-gauge]");
    if (!b) return;
    gauge = b.dataset.gauge;
    store(GAUGE_KEY, gauge);
    closeGaugePick();
    paintPanel();
  });
  S.tripGaugeDim.addEventListener("click", closeGaugePick);
  S.tripGaugeClose.addEventListener("click", closeGaugePick);
  S.tripStart.addEventListener("click", startRec);
  S.tripCamGo.addEventListener("click", openCamera);
  S.tripPause.addEventListener("click", () => (rec?.paused ? resumeRec() : pauseRec()));
  S.tripStop.addEventListener("click", askEnd);
  S.tripFocus.addEventListener("click", () => {
    focus = !focus;
    store(FOCUS_KEY, focus ? "1" : null);
    paintTripDot();
    paintPanel();
  });
  S.tripEndKeep.addEventListener("click", endKeep);
  S.tripEndDrop.addEventListener("click", endDrop);
  S.tripEndMore.addEventListener("click", endContinue);
  S.tripEndClose.addEventListener("click", endContinue);
  S.tripEndDim.addEventListener("click", endContinue);
  S.tiDel.addEventListener("click", async () => {
    if (!item || !confirm("刪除這筆行車紀錄？刪了就拿不回來。")) return;
    try { await delTrip(item.id); } catch { /* 算了 */ }
    hooks.deleted?.(item);
    location.hash = "#trip";
  });
  let scrubbing = false;
  S.tiChart.addEventListener("pointerdown", (e) => { scrubbing = true; S.tiChart.setPointerCapture?.(e.pointerId); scrubAt(e.clientX); });
  S.tiChart.addEventListener("pointermove", (e) => { if (scrubbing) scrubAt(e.clientX); });
  const end = () => { scrubbing = false; };
  S.tiChart.addEventListener("pointerup", end);
  S.tiChart.addEventListener("pointercancel", end);
  // 轉成橫的：地圖重畫、曲線照新的框重算（曲線是拉伸的 SVG，不重算字會變形）
  window.addEventListener("resize", () => { liveMap?.paint(); itemMap?.paint(); paintLiveChart(); paintItemChart(); });
  // 離開這一頁、關掉：瀏覽器模式沒辦法在背景記，至少把 wakeLock 放掉
  window.addEventListener("pagehide", () => { if (wake) { wake.release?.().catch?.(() => {}); wake = null; } });
  recover();
}

/** app.js 的路由叫這個：view 是 "trip"（行車紀錄那一頁）、"item"（一筆紀錄）或 null（在別的分頁） */
export function tripRoute(v, id) {
  wire();
  view = v;
  if (v === "trip") {
    paintPanel();
    paintList();
    backfill();
  } else if (v === "item") {
    paintItem(id);
  }
  paintTripDot();
}

/** 正在記錄中（底部分頁上要亮紅點） */
export const tripActive = () => !!rec;
