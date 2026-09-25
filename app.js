// 大便龍的萬能軟體 — Android App 裡跑的網頁
// 辨車透過 Firebase AI Logic 呼叫 Google Gemini。使用者不用自己申請金鑰：
// Gemini 的金鑰留在 Firebase 那邊，App 靠 App Check（reCAPTCHA）證明自己是這個 App。

/* 依序試：先用便宜的 lite，不行再換一般的 flash。
   兩個都失敗才算失敗。使用者不用選，也不會知道用的是哪一個。
   Firebase 建議寫死穩定版的名字，不要用 -latest。 */
const MODEL_CHAIN = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];

/* Firebase 專案的公開設定和 reCAPTCHA 的 key ID。這兩個本來就會出現在網頁原始碼裡，
   不是金鑰；別人抄走也過不了 App Check，用不到 Gemini。 */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBdfoxNYRp_IucYCHzKHvKjwO4ggJ8BezQ",
  authDomain: "beaupower-307a5.firebaseapp.com",
  projectId: "beaupower-307a5",
  storageBucket: "beaupower-307a5.firebasestorage.app",
  messagingSenderId: "211232229775",
  appId: "1:211232229775:web:d4e39ba53ee75e61a8a3fa",
};
const RECAPTCHA_KEY = "6LdJF84tAAAAAOhEqju6oi0J2XDnQZO0M0_kWSLB";
const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/12.19.0/";

// 以前要使用者自己貼的 Gemini 金鑰，現在用不到了，順手從手機裡清掉
const OLD_KEY_STORE = "carid.apikey";

/* ================= 外觀：配色與明暗 ================= */

const PRESETS = [
  { hex: null, name: "預設（賽道橘）", chip: "#FF6A1F" },
  { hex: "#E0B341", name: "琥珀黃", chip: "#E0B341" },
  { hex: "#4C9AFF", name: "鈦藍", chip: "#4C9AFF" },
  { hex: "#E5484D", name: "磚紅", chip: "#E5484D" },
  { hex: "#1F8A70", name: "森林綠", chip: "#1F8A70" },
  { hex: "#8A55D6", name: "夜紫", chip: "#8A55D6" },
];

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const swatchBox = $("swatches");
const customSwatch = $("customSwatch");
const accentPicker = $("accentPicker");

let accentHex = null;
let themeMode = "dark";   // 介面是照深色設計的，預設就給暗的

function store(key, val) {
  try {
    if (val === null) localStorage.removeItem(key);
    else localStorage.setItem(key, val);
  } catch { /* 無痕視窗等情況，忽略 */ }
}
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lum(rgb) {
  const a = rgb.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
const mixWhite = (rgb, amt) => rgb.map((v) => Math.round(v + (255 - v) * amt));
const hexOf = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

function isDarkNow() {
  if (themeMode === "dark") return true;
  if (themeMode === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function applyAccent() {
  const s = root.style;
  if (!accentHex) {
    s.removeProperty("--accent");
    s.removeProperty("--accent-ink");
    s.removeProperty("--accent-wash");
    return;
  }
  let rgb = hexToRgb(accentHex);
  if (!rgb) return;
  if (isDarkNow() && lum(rgb) < 0.18) rgb = mixWhite(rgb, 0.24);
  s.setProperty("--accent", hexOf(rgb));
  s.setProperty("--accent-ink", lum(rgb) > 0.19 ? "#0E0F12" : "#FFFFFF");
  s.setProperty("--accent-wash", `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${isDarkNow() ? 0.16 : 0.09})`);
}

function applyTheme() {
  if (themeMode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", themeMode);
  applyAccent();
}

function markSwatches() {
  for (const b of swatchBox.querySelectorAll(".swatch")) {
    const own = b.getAttribute("data-hex") || null;
    const on = b === customSwatch
      ? !!(accentHex && !PRESETS.some((p) => p.hex && p.hex.toLowerCase() === accentHex.toLowerCase()))
      : own === accentHex || (own === null && accentHex === null && b !== customSwatch);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

function setAccent(hex) {
  accentHex = hex;
  store("carid.accent", hex);
  applyAccent();
  markSwatches();
}

for (const p of [...PRESETS].reverse()) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "swatch";
  b.style.background = p.chip;
  b.title = p.name;
  b.setAttribute("aria-label", "主色：" + p.name);
  if (p.hex) b.setAttribute("data-hex", p.hex);
  b.addEventListener("click", () => setAccent(p.hex));
  swatchBox.insertBefore(b, swatchBox.firstChild);
}

accentPicker.addEventListener("input", () => setAccent(accentPicker.value));

for (const r of document.querySelectorAll('input[name="theme"]')) {
  r.addEventListener("change", () => {
    if (!r.checked) return;
    themeMode = r.value;
    store("carid.theme", themeMode);
    applyTheme();
  });
}

window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
  if (themeMode === "system") applyAccent();
});

const prefsSheetEl = $("prefsSheet");
function setPrefs(open) {
  prefsSheetEl.hidden = !open;
  $("prefsBtn").setAttribute("aria-expanded", open ? "true" : "false");
}
$("prefsBtn").addEventListener("click", () => setPrefs(prefsSheetEl.hidden));

(function restoreLook() {
  const savedTheme = load("carid.theme");
  if (savedTheme === "light" || savedTheme === "dark" || savedTheme === "system") {
    themeMode = savedTheme;
    const el = $("theme" + savedTheme[0].toUpperCase() + savedTheme.slice(1));
    if (el) el.checked = true;
  }
  const savedAccent = load("carid.accent");
  if (savedAccent && hexToRgb(savedAccent)) {
    accentHex = savedAccent;
    accentPicker.value = savedAccent;
  }
  applyTheme();
  markSwatches();
})();

/* ================= 版本 ================= */

/* 網頁內容的版號，跟 sw.js 的 CACHE、index.html 和 mc.html 裡的 ?v= 一起加
   （account.js 也用這個版號載入） */
const WEB_BUILD = 28;

function appBuild() {
  const m = /CaridApp\/(\d+)/.exec(navigator.userAgent || "");
  return m ? Number(m[1]) : null;
}

function paintVersion() {
  const el = $("versionState");
  if (!el) return;
  const app = appBuild();
  el.textContent = (app ? "App " + app + "\u3000" : "") + "內容 " + WEB_BUILD;
}

/* ================= Firebase ================= */

// Firebase 的 SDK 用到 AbortSignal.any，比較舊的 Android WebView 沒有，補一個
if (typeof AbortSignal !== "undefined" && !AbortSignal.any) {
  AbortSignal.any = (signals) => {
    const c = new AbortController();
    for (const sig of signals) {
      if (sig.aborted) { c.abort(sig.reason); break; }
      sig.addEventListener("abort", () => c.abort(sig.reason), { once: true });
    }
    return c.signal;
  };
}

/* 第一次要用時才去載 Firebase，載不到（例如沒網路）也不會拖垮整個 App，
   下次要用會再試。App Check 一初始化就會在背景拿通行證。
   辨車和帳號（登入、雲端紀錄）共用同一個 Firebase app。 */
let appReady = null;
function firebaseApp() {
  if (!appReady) {
    appReady = (async () => {
      const [{ initializeApp, getApps }, { initializeAppCheck, ReCaptchaEnterpriseProvider }] = await Promise.all([
        import(FIREBASE_SDK + "firebase-app.js"),
        import(FIREBASE_SDK + "firebase-app-check.js"),
      ]);
      const app = getApps()[0] || initializeApp(FIREBASE_CONFIG);
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_KEY),
        isTokenAutoRefreshEnabled: true,
      });
      return { app, sdk: FIREBASE_SDK };
    })();
    appReady.catch(() => { appReady = null; });
  }
  return appReady;
}

let aiReady = null;
function firebaseAI() {
  if (!aiReady) {
    aiReady = (async () => {
      const [{ app }, fai] = await Promise.all([firebaseApp(), import(FIREBASE_SDK + "firebase-ai.js")]);
      return { ai: fai.getAI(app, { backend: new fai.GoogleAIBackend() }), getGenerativeModel: fai.getGenerativeModel };
    })();
    aiReady.catch(() => { aiReady = null; });
  }
  return aiReady;
}

/* ================= 辨識 ================= */

const drop = $("drop");
const dropInner = $("dropInner");
const fileInput = $("file");
const camInput = $("fileCam");
const camBtn = $("cam");
const pickBtn = $("pick");
const goBtn = $("go");
const stopBtn = $("stop");
const redoBtn = $("redo");
const againBtn = $("again");
const screenCapture = $("screenCapture");
const screenResult = $("screenResult");
const resultBody = $("resultBody");
const resultNotes = $("resultNotes");
const stateTag = $("stateTag");
const collage = $("collage");
const actionbar = $("actionbar");
const shotsEl = $("shots");
const pcount = $("pcount");
const premove = $("premove");
const tipEl = $("tip");
const TIP_EMPTY = tipEl.textContent;

/* 這次要辨的照片。同一台車最多 5 張（拍照、相簿加起來），一起送去判讀 */
const MAX_SHOTS = 5;
let shots = [];       // [{ blob, url, name, ratio }]
let sel = 0;          // 大圖現在是第幾張
let controller = null;
let busy = false;
let screen = "capture";

const hasCamera = window.matchMedia?.("(pointer: coarse)").matches ?? false;
const PICK_WORD = hasCamera ? "相簿" : "選照片";

// App 6 以前的外殼接不到相簿一次選的好幾張（選了會整個沒反應），在那些版本裡相簿一次選一張
const shellBuild = appBuild();
if (shellBuild !== null && shellBuild <= 6) fileInput.multiple = false;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

function setTag(text, live) {
  stateTag.textContent = text;
  stateTag.className = "tag" + (live ? " live" : "");
}

function showScreen(name) {
  screen = name;
  screenCapture.hidden = name !== "capture";
  screenResult.hidden = name !== "result";
  updateBar();
  window.scrollTo(0, 0);
}

function updateBar() {
  const onResult = screen === "result";
  const n = shots.length;
  const full = n >= MAX_SHOTS;
  // 還沒放照片時「拍照」是主按鈕；放了以後拍照、相簿都變成「再加一張」
  camBtn.hidden = busy || onResult || !hasCamera || full;
  pickBtn.hidden = busy || onResult || full;
  camBtn.textContent = n ? "＋ 拍照" : "拍照";
  pickBtn.textContent = n ? "＋ " + PICK_WORD : PICK_WORD;
  camBtn.classList.toggle("primary", n === 0);
  camBtn.classList.toggle("wide", n === 0);
  goBtn.hidden = busy || onResult || n === 0;
  goBtn.innerHTML = n > 1 ? `開始辨識<span class="cnt">${n} 張</span>` : "開始辨識";
  stopBtn.hidden = !busy;
  redoBtn.hidden = busy || !onResult;
  againBtn.hidden = busy || !onResult;
}

/* ---------- 選擇照片 ---------- */

const PLUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

/* 預覽框的長寬跟著照片走，橫的就是橫的，直的就是直的，不要硬裁成 3:4。
   只看第 1 張：點其他縮圖時框的大小不變，下面那排縮圖才不會跟著跳 */
function fitDrop() {
  const r = shots[0]?.ratio;
  // 太極端的全景或長截圖還是夾住，不然版面會被拉爆
  drop.style.aspectRatio = r ? String(Math.min(2.2, Math.max(0.5, r))) : "";
}

function addShot(blob, name) {
  const sh = { blob, url: URL.createObjectURL(blob), name, ratio: 0 };
  shots.push(sh);
  const probe = new Image();
  probe.onload = () => {
    sh.ratio = probe.naturalHeight ? probe.naturalWidth / probe.naturalHeight : 0;
    if (shots[0] === sh) fitDrop();
  };
  probe.src = sh.url;
}

/* 大圖、縮圖列、按鈕、提示一起照 shots 重畫 */
function paintShots(extra) {
  const n = shots.length;
  let img = drop.querySelector("img");

  if (!n) {
    img?.remove();
    drop.style.aspectRatio = "";
    drop.classList.remove("has-shots");
    drop.setAttribute("role", "button");
    drop.tabIndex = 0;
    dropInner.hidden = false;
    pcount.hidden = true;
    premove.hidden = true;
  } else {
    const s = shots[sel];
    if (!img) {
      img = document.createElement("img");
      drop.insertBefore(img, pcount);   // 放在「2 / 3」和「拿掉」底下
    }
    fitDrop();
    img.alt = n > 1 ? `第 ${sel + 1} 張照片` : "已選擇的汽車照片";
    if (img.getAttribute("src") !== s.url) img.src = s.url;
    // 放了照片以後大圖只是給你看，要加照片用下面的「＋」
    drop.classList.add("has-shots");
    drop.removeAttribute("role");
    drop.tabIndex = -1;
    dropInner.hidden = true;
    pcount.hidden = n < 2;
    pcount.textContent = `${sel + 1} / ${n}`;
    premove.hidden = false;
  }

  shotsEl.hidden = n === 0;
  shotsEl.innerHTML =
    shots.map((sh, i) =>
      `<button type="button" class="shot${i === sel ? " on" : ""}" data-i="${i}" aria-label="第 ${i + 1} 張"` +
      (i === sel ? ' aria-current="true"' : "") + `><img src="${sh.url}" alt=""></button>`
    ).join("") +
    (n && n < MAX_SHOTS ? `<button type="button" class="shot add" data-add="1" aria-label="再加一張">${PLUS_SVG}<span>加一張</span></button>` : "");

  const tips = [];
  if (extra) tips.push(extra);
  if (!n) tips.push(TIP_EMPTY);
  else if (n >= MAX_SHOTS) tips.push(`已經 ${MAX_SHOTS} 張了。要換照片，先把其中一張拿掉。`);
  else tips.push(`點縮圖看大張。拍照、${PICK_WORD}都是再加一張，加起來最多 ${MAX_SHOTS} 張。`);
  tipEl.textContent = tips.join(" ");

  updateBar();
}

function clearShots() {
  shots.forEach((sh) => URL.revokeObjectURL(sh.url));
  shots = [];
  sel = 0;
}

/* 加照片：一次可以好幾張（相簿多選、拖曳），超過 5 張的就不收 */
function acceptFiles(list, name) {
  const files = [...(list || [])].filter(Boolean);
  if (!files.length) return;
  const imgs = files.filter((f) => /^image\//.test(f.type));
  if (screen !== "capture") showScreen("capture");
  const room = MAX_SHOTS - shots.length;
  const take = imgs.slice(0, Math.max(0, room));
  for (const f of take) addShot(f, name || f.name || "photo");
  if (take.length) sel = shots.length - 1;
  const msgs = [];
  if (imgs.length < files.length) {
    msgs.push(imgs.length ? `有 ${files.length - imgs.length} 個不是圖片的檔案沒有放進來。` : "這個檔案不是圖片。請選 JPG、PNG 或 WebP 格式的照片。");
  }
  const skipped = imgs.length - take.length;
  if (skipped > 0) msgs.push(`最多 ${MAX_SHOTS} 張，多的 ${skipped} 張沒有放進來。`);
  paintShots(msgs.join(" "));
}

shotsEl.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || busy) return;
  if (b.dataset.add) { fileInput.click(); return; }
  const i = Number(b.dataset.i);
  if (Number.isInteger(i) && shots[i]) { sel = i; paintShots(); }
});

premove.addEventListener("click", (e) => {
  e.stopPropagation();
  if (busy) return;
  const [gone] = shots.splice(sel, 1);
  if (gone) URL.revokeObjectURL(gone.url);
  sel = Math.max(0, Math.min(sel, shots.length - 1));
  paintShots();
});

camBtn.addEventListener("click", () => camInput.click());
pickBtn.addEventListener("click", () => fileInput.click());
againBtn.addEventListener("click", () => {
  // 換一台：清掉這次的照片，直接開相機（或相簿）拍下一台
  clearShots();
  showScreen("capture");
  paintShots();
  (hasCamera ? camInput : fileInput).click();
});
drop.addEventListener("click", () => {
  if (!shots.length) (hasCamera ? camInput : fileInput).click();
});
drop.addEventListener("keydown", (e) => {
  if (shots.length) return;
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
});
// 選完把 value 清掉，同一張再選一次才會觸發 change
fileInput.addEventListener("change", () => { acceptFiles(fileInput.files); fileInput.value = ""; });
camInput.addEventListener("change", () => { acceptFiles(camInput.files); camInput.value = ""; });

for (const ev of ["dragenter", "dragover"]) {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); });
}
for (const ev of ["dragleave", "drop"]) {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("is-over"); });
}
drop.addEventListener("drop", (e) => {
  if (!busy) acceptFiles(e.dataTransfer?.files);
});
document.addEventListener("paste", (e) => {
  if (!busy && e.clipboardData?.files?.length) acceptFiles(e.clipboardData.files);
});

/* ---------- 照片轉成 API 要的 base64 ---------- */

async function toBase64Jpeg(blob, max = 1600) {
  let w, h, src;

  if (typeof createImageBitmap === "function") {
    src = await createImageBitmap(blob, { imageOrientation: "from-image" });
    w = src.width; h = src.height;
  } else {
    src = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = URL.createObjectURL(blob);
    });
    w = src.naturalWidth; h = src.naturalHeight;
  }

  const scale = Math.min(1, max / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  canvas.getContext("2d").drawImage(src, 0, 0, cw, ch);
  src.close?.();

  const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
  return { data: dataUrl.slice(dataUrl.indexOf(",") + 1), canvas };
}

/* ---------- 畫面狀態 ---------- */

function renderThinking(label) {
  setTag("辨識中", true);
  resultNotes.innerHTML = "";
  resultBody.innerHTML =
    '<div class="thinking"><p class="think-title">辨識中</p>' +
    '<div class="bar" aria-hidden="true"><i></i></div>' +
    `<p id="thinkLabel">${esc(label)}</p></div>`;
}

function renderError(msg, detail, status, title) {
  setTag("沒辨出來", false);
  const alert =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9"/><path d="M12 7.4v5.4"/><path d="M12 16.1v.3"/></svg>';

  resultBody.innerHTML =
    '<div class="fail">' +
    `<div class="fail-icon">${alert}</div>` +
    `<p class="fail-title">${esc(title || "這次沒辨出來")}</p>` +
    `<p class="fail-body">${esc(msg)}</p>` +
    (detail
      ? '<div class="raw"><div class="raw-head">' +
        (status ? `<span class="raw-code">HTTP ${esc(status)}</span>` : "") +
        '<span class="raw-cap">Google 原本的回覆</span></div>' +
        `<p>${esc(detail)}</p></div>`
      : "") +
    '</div>';
  resultNotes.innerHTML = "";
}

/* 連不到的時候多做兩個小測試，直接把結論寫在畫面上，
   不然「Failed to fetch」看不出是手機沒網路還是被瀏覽器擋下來 */
async function diagnose() {
  const bits = [navigator.onLine ? "系統：有網路" : "系統：沒網路"];
  try {
    const res = await fetch("https://firebasevertexai.googleapis.com/", { method: "GET" });
    bits.push("連得到 Google（HTTP " + res.status + "）→ 問題出在送照片那一次的請求");
  } catch (e) {
    bits.push("連不到 Google：" + (e?.message || "不明原因"));
  }
  return bits.join("　·　");
}

/* 付費方案的預付額度用完：Google 回 402，或是 429 加上「prepayment credits are depleted」。
   這種不會隔天自己恢復，要去 AI Studio 儲值 */
function outOfCredit(err) {
  return err?.status === 402 || (err?.status === 429 && /prepay|credit/i.test(err?.detail || err?.message || ""));
}

function messageFor(err) {
  const status = err?.status;
  if (err?.name === "AbortError") return null;
  if (outOfCredit(err)) return "不是網路的問題，照片也沒事。App 用的 Google 預付額度用完了，要等儲值之後才能再辨識。";
  if (status === 401 || status === 403) return "這支手機這次沒通過 Google 的驗證。把 App 關掉重開，再辨識一次看看。";
  if (status === 429) return "不是網路的問題，照片也沒事。大家共用的免費額度今天用完了，明天會重來。";
  if (status === 400) return "這次的請求 Google 不收。換一張 JPG 或 PNG 照片再試一次。";
  if (status === 413) return "照片太大了，換一張小一點的再試一次。";
  if (status >= 500) return "Google 那邊暫時有狀況，等一下再辨識一次。";
  if (err instanceof TypeError || /fetch|network|Failed to fetch/i.test(err?.message || "")) {
    return "連不到 Google。先看看手機的網路正不正常。";
  }
  return "再試一次看看，通常第二次就好了。";
}

/* 錯誤畫面上的那一行大標 */
function titleFor(err) {
  const status = err?.status;
  if (outOfCredit(err)) return "預付額度用完了";
  if (status === 401 || status === 403) return "驗證沒過";
  if (status === 429) return "今天的免費額度用完了";
  if (status === 413) return "照片太大了";
  if (status >= 500) return "Google 那邊出了點狀況";
  if (!status) return "連不到 Google";
  return "這次沒辨出來";
}

function row(label, value, cls) {
  if (value === undefined || value === null || value === "") return "";
  return `<tr${cls ? ` class="${cls}"` : ""}><th>${esc(label)}</th><td>${value}</td></tr>`;
}

function renderResult(d, out) {
  const bodyEl = out?.body || resultBody;
  const notesEl = out?.notes || resultNotes;
  if (!out) setTag("已辨識", true);
  notesEl.innerHTML = "";

  if (d && d.is_vehicle === false) {
    bodyEl.innerHTML = '<p class="headline">照片裡沒有看到汽車</p>';
    notesEl.innerHTML = `<p class="note warn">${esc(d.note || "請換一張拍到整台車的照片，側面或四分之三角度最好認。")}</p>`;
    return;
  }

  const v = (k) => (d && d[k] ? esc(d[k]) : "");
  const conf = Math.max(0, Math.min(100, Math.round(Number(d?.confidence) || 0)));
  const cls = conf >= 70 ? "" : conf >= 40 ? " mid" : " low";

  let makeCell = "";
  if (d?.make) makeCell = esc(d.make) + (d.make_zh ? `　<span class="muted">${esc(d.make_zh)}</span>` : "");
  else if (d?.make_zh) makeCell = esc(d.make_zh);

  const confCell =
    `<div class="conf-cell"><span class="conf-num">${conf}%</span>` +
    `<div class="track"><div class="fill${cls}" style="width:0"></div></div></div>`;

  const alts = Array.isArray(d?.alternatives) ? d.alternatives.filter(Boolean).slice(0, 3) : [];
  const altCell = alts.map((a) => {
    const name = [a.make, a.model].filter(Boolean).join(" ") || "其他車型";
    const p = Number(a.confidence);
    return esc(name) + (isFinite(p) && p > 0 ? " " + Math.round(p) + "%" : "");
  }).join("　·　");

  const hasEngine = !!(d?.engine || d?.displacement || d?.power || d?.transmission || d?.drivetrain || d?.fuel);
  const hasMarket = !!(d?.price_new || d?.price_used || d?.count_tw || d?.count_global || d?.limited);

  const rows =
    row("車型", d?.model ? esc(d.model) : '<span class="muted">無法確定</span>') +
    row("品牌", makeCell) +
    row("世代", v("generation")) +
    row("年份", v("years")) +
    row("車身型式", v("body_style")) +
    row("車色", v("color")) +
    row("把握程度", confCell) +
    row("引擎", v("engine"), "gap") +
    row("排氣量", v("displacement")) +
    row("最大馬力", v("power")) +
    row("變速箱", v("transmission")) +
    row("驅動", v("drivetrain")) +
    row("燃料", v("fuel")) +
    row("油電混合", v("hybrid")) +
    row("引擎特性", d?.engine_note ? `<span class="muted para">${esc(d.engine_note)}</span>` : "") +
    row("新車參考價", v("price_new"), "gap") +
    row("中古行情", v("price_used")) +
    row("台灣數量", v("count_tw")) +
    row("全球數量", v("count_global")) +
    row("是否限量", v("limited")) +
    row("其他可能", altCell, "gap") +
    row("備註", d?.note ? `<span class="muted para">${esc(d.note)}</span>` : "", "gap");

  const confWord = conf >= 70 ? "高" : conf >= 40 ? "普通" : "偏低";
  const confClass = conf >= 70 ? " good" : conf >= 40 ? "" : " weak";
  const heroMake = d?.make || d?.make_zh || "";
  const heroSub = [d?.years, d?.body_style].filter(Boolean).map(esc).join("　");
  const hero =
    '<div class="hero">' +
    (heroMake ? `<div class="hero-make">${esc(heroMake)}</div>` : "") +
    `<h2 class="hero-model">${esc(d?.model || "無法確定車型")}</h2>` +
    '<div class="hero-meta">' +
    `<span class="chip${confClass}">把握度　${confWord}</span>` +
    (heroSub ? `<span class="hero-sub">${heroSub}</span>` : "") +
    (out?.when ? `<span class="hero-sub">${esc(out.when)}</span>` : "") +
    '</div></div>';

  bodyEl.innerHTML = hero + `<table class="spec"><tbody>${rows}</tbody></table>`;

  let notes = "";
  if (d?.same_car === false) notes += '<p class="note warn">這幾張看起來不是同一台車，結果以第 1 張為主。</p>';
  if (hasEngine) notes += '<p class="caveat">動力規格為該車型年份的常見配置，實際依等級與販售市場而異。</p>';
  if (hasMarket) notes += '<p class="caveat">價格與數量是模型依既有知識的粗估，沒有連接任何行情或掛牌資料庫，請以實際報價與官方統計為準。</p>';
  if (conf < 50) notes += '<p class="note warn">把握程度偏低。換一個角度（車頭或四分之三角度）、離近一點、避免逆光，通常會準很多。</p>';
  notesEl.innerHTML = notes;

  const fill = bodyEl.querySelector(".fill");
  if (fill) requestAnimationFrame(() => { fill.style.width = conf + "%"; });
}

/* ---------- 提示詞 ---------- */

const PROMPT = `你是資深的汽車辨識專家。請看這張照片，判斷照片中主要車輛的品牌與車型，並介紹它的動力系統。

只回覆一個 JSON 物件，格式如下，不要有其他文字：
{"is_vehicle":true,"make":"Toyota","make_zh":"豐田","model":"Corolla Altis","generation":"第 12 代","years":"2019–2024","body_style":"四門轎車","color":"銀白色","confidence":78,"engine":"2.0L 直列四缸自然進氣（Dynamic Force）","displacement":"1,987 c.c.","power":"170 hp","transmission":"CVT","drivetrain":"前輪驅動","fuel":"汽油","hybrid":"否，純汽油引擎（同代另有 Hybrid 油電車型）","engine_note":"高壓縮比的自然進氣引擎，主打省油與低速好開，不是衝刺性能。","price_new":"台灣新車約 NT$ 80–95 萬（2024 年式）","price_used":"約 NT$ 45–75 萬，依年份與里程","count_tw":"近年每年掛牌約 1.5 萬輛（概估）","count_global":"車系全球累計銷量逾 5,000 萬輛","limited":"非限量，量產車款","alternatives":[{"make":"Honda","model":"Civic","confidence":12}],"note":""}

規則：
- confidence 是 0 到 100 的整數，代表你對 make 加 model 的把握程度。不確定就給低分，不要灌水。
- engine_note 用一到兩句繁體中文介紹這具引擎的個性（自然進氣或渦輪、著重省油或性能、開起來的感覺），寫給不懂車的人看。
- hybrid 先寫「是」或「否」再補說明：油電（HEV）、插電式油電（PHEV）、輕油電（MHEV）、純電或純燃油要分清楚。照片上有 Hybrid 字樣或充電孔等線索時，在說明裡提到。同一車型同時有燃油版與油電版而照片看不出來時，寫「照片看不出來，此車型同時有燃油版與油電版」。
- 電動車的 engine 寫馬達配置（例如「單馬達後驅」），displacement 留空字串，fuel 寫「純電」，power 寫綜效馬力。
- 任何一欄不確定就給空字串，不要編造精確數字。
- price_new 是台灣的新車參考價，price_used 是中古行情，都用新台幣並寫成區間，標註年式或依據。台灣沒賣的車款就寫該車主要市場的價格並註明市場。
- count_tw 是台灣的掛牌或保有數量，count_global 是全球累計產量或銷量。
- 你沒有即時行情也沒有任何資料庫，price 與 count 這四欄一律是依既有知識的粗估：要用「約」「概估」等字樣並盡量標出基準年份。沒有把握或沒有公開統計時就寫「無公開資料」，絕對不要編造看起來精確的數字。
- limited 寫「非限量，量產車款」，或限量資訊（例如「全球限量 500 台」「台灣配額 30 台」）。
- alternatives 最多 3 個其他可能的車型，依可能性排序；沒有就給空陣列。
- 不要寫出車牌號碼，也不要描述照片中的人。
- 只看得出車廠看不出確切車型時，model 給最接近的推測，並在 note 說明限制。
- 照片裡沒有汽車時，is_vehicle 設為 false，並在 note 說明你看到什麼。
- 除了 make、model 等專有名詞外，所有文字都用繁體中文。`;

/* 好幾張照片時換掉開頭、多一個 same_car 欄位和兩條規則；一張的時候跟以前一模一樣 */
function promptFor(n) {
  if (n < 2) return PROMPT;
  const swaps = [
    ["請看這張照片，判斷照片中主要車輛的品牌與車型",
      `下面有 ${n} 張照片，拍的是同一台車的不同角度或局部。請把所有照片合起來看，判斷這台車的品牌與車型`],
    ['{"is_vehicle":true,', '{"is_vehicle":true,"same_car":true,'],
    ["規則：\n",
      "規則：\n" +
      `- 這 ${n} 張是同一台車。把每張看到的線索（車頭、車尾、側面、輪圈、車尾字樣、內裝等）合起來判斷，confidence 是看完全部照片後的把握程度。\n` +
      "- same_car：這幾張看起來是同一台車就給 true；明顯是不同的車就給 false，並以第 1 張照片裡的車為準回答，在 note 說明哪幾張不一樣。\n"],
    ["- 照片裡沒有汽車時，is_vehicle 設為 false，並在 note 說明你看到什麼。",
      "- 有幾張沒拍到車或看不清楚就略過那幾張；全部照片都沒有汽車時，is_vehicle 才設為 false，並在 note 說明你看到什麼。"],
  ];
  return swaps.reduce((t, [a, b]) => t.replace(a, b), PROMPT);
}

/* 容錯解析：整段 JSON、程式碼區塊、或第一個 { 到最後一個 } */
function parseJson(text) {
  const tries = [];
  tries.push(text.trim());
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) tries.push(fence[1].trim());
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a !== -1 && b > a) tries.push(text.slice(a, b + 1));
  for (const t of tries) {
    try { return JSON.parse(t); } catch { /* 換下一種 */ }
  }
  return null;
}

function setBusy(on) {
  busy = on;
  updateBar();
  drop.style.pointerEvents = on ? "none" : "";
}

stopBtn.addEventListener("click", () => controller?.abort());

/* 對單一模型送一次請求（所有照片放在同一個請求裡），回傳模型寫的文字；失敗就丟出帶 status 的錯誤 */
async function askModel(model, images, effort) {
  const { ai, getGenerativeModel } = await firebaseAI();
  const generationConfig = { responseMimeType: "application/json" };
  // 深入模式才特別要求多想；標準模式用模型自己的預設值
  if (effort === "deep") generationConfig.thinkingConfig = { thinkingLevel: "HIGH" };
  const m = getGenerativeModel(ai, { model, generationConfig });

  try {
    const result = await m.generateContent(
      [promptFor(images.length), ...images.map((data) => ({ inlineData: { data, mimeType: "image/jpeg" } }))],
      { signal: controller.signal },
    );
    return result.response.text();
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    // SDK 的訊息長這樣：「AI: Error fetching from <網址>: [429 Too Many Requests] <Google 的原文> (AI/fetch-error)」，
    // 錯誤畫面只留 Google 的原文，才看得出原因
    const detail = String(e?.message || "")
      .replace(/^(AI:\s*)?Error fetching from \S+:\s*(\[[^\]]*\]\s*)?/, "")
      .replace(/\s*\(AI\/[\w-]+\)\s*$/, "");
    const err = new Error(detail);
    err.status = e?.customErrorData?.status || (e?.code === "api-not-enabled" ? 403 : undefined);
    err.detail = detail;
    throw err;
  }
}

/* 依序試 MODEL_CHAIN 裡的模型，全部失敗才把最後一個錯誤丟出去 */
async function askModels(images, effort) {
  let last;
  for (const model of MODEL_CHAIN) {
    try {
      return await askModel(model, images, effort);
    } catch (err) {
      // 使用者自己按停止就不用再試下一個；SDK 自己逾時也是 AbortError，那種就換下一個
      if (err?.name === "AbortError" && controller?.signal.aborted) throw err;
      // 額度用完是整個帳戶的事，換模型也一樣，不用再多等一次
      if (outOfCredit(err)) throw err;
      last = err;
    }
  }
  throw last;
}

/* 結果頁上面的照片：1 張滿版，好幾張拼在一起 */
function paintCollage(urls) {
  const n = Math.min(urls.length, MAX_SHOTS);
  collage.hidden = n === 0;
  collage.className = "collage n" + n;
  collage.innerHTML = urls.slice(0, n)
    .map((u, i) => `<img src="${u}" alt="${n > 1 ? `第 ${i + 1} 張照片` : "這次辨識的照片"}">`).join("");
}

async function run() {
  if (busy || !shots.length) return;
  const n = shots.length;

  showScreen("result");
  paintCollage(shots.map((sh) => sh.url));
  controller = new AbortController();
  setBusy(true);
  renderThinking(n > 1 ? `正在看這 ${n} 張照片…` : "正在看這張照片…");

  try {
    // 好幾張時每張縮小一點，上傳比較快。一張一張轉，手機記憶體才不會一下子吃太多
    const prepared = [];
    for (const sh of shots.slice(0, MAX_SHOTS)) prepared.push(await toBase64Jpeg(sh.blob, n > 1 ? 1280 : 1600));
    const effort = document.querySelector('input[name="tier"]:checked').value;

    const label = $("thinkLabel");
    if (label) label.textContent = n > 1 ? `正在把 ${n} 張照片合起來判讀…` : "正在判讀…";

    const text = await askModels(prepared.map((p) => p.data), effort);
    const parsed = parseJson(text);
    if (!parsed) {
      renderError("回來的結果格式不對，再辨識一次通常就好了。");
    } else {
      renderResult(parsed);
      if (parsed.is_vehicle !== false) {
        if (n > 1) setTag(`已辨識・${n} 張一起看`, true);
        saveHistory(parsed, prepared.map((p) => p.canvas)).catch(() => { /* 存不進去不影響結果 */ });
      }
    }
  } catch (err) {
    const msg = messageFor(err);
    if (msg === null) {
      setTag("已停止", false);
      resultBody.innerHTML = '<p class="headline">已停止</p>';
      resultNotes.innerHTML = '<p class="caveat">按「再辨識一次」可以重來。</p>';
    } else {
      const detail = err?.status ? (err.detail || err.message || "") : (err?.message || "");
      renderError(msg, detail, err?.status, titleFor(err));
      // 網路類的錯誤再跑一次診斷，把結果補在下面
      if (!err?.status) {
        diagnose().then((line) => {
          const box = document.createElement("p");
          box.className = "caveat";
          box.textContent = line;
          resultNotes.appendChild(box);
        });
      }
    }
  } finally {
    setBusy(false);
    controller = null;
  }
}

goBtn.addEventListener("click", run);
redoBtn.addEventListener("click", run);

/* ================= 分頁 ================= */
// 底部分頁是 汽車／麥塊（麥塊是另一頁 mc.html）。
// 汽車裡面用網址的 # 切換：#car、#history、#history/<id>、#news、#news/<id>，
// 登入頁是 #login（算在紀錄底下）

const views = {
  history: $("screenHistory"),
  histitem: $("screenHistItem"),
  login: $("screenLogin"),
  news: $("screenNews"),
  article: $("screenArticle"),
};

/* 記住汽車裡上次看的是辨車、紀錄還是車訊，從麥塊切回來時回到同一頁 */
const CAR_TAB = "carid.tab";
function lastCarTab() {
  let t = null;
  try { t = sessionStorage.getItem(CAR_TAB); } catch { /* 不給用就算了 */ }
  return t === "history" || t === "news" ? t : "car";
}

function route() {
  let [tab, id] = decodeURIComponent(location.hash.replace(/^#/, "")).split("/");
  // 麥塊頁的齒輪連到 #settings：停在上次看的那一頁，把設定打開
  const wantPrefs = tab === "settings";
  if (wantPrefs) {
    tab = lastCarTab();
    id = undefined;
    history.replaceState(null, "", "#" + tab);
  }
  let view = "car";
  if (tab === "history") view = id ? "histitem" : "history";
  else if (tab === "news") view = id ? "article" : "news";
  else if (tab === "login") view = "login";

  // 「登入好了」只在剛登入後的紀錄頁出現一次，離開就收起來
  if (view !== "history" && view !== "login" && acctSnap.sync.phase === "idle") justIn = false;

  document.body.dataset.view = view;
  for (const k in views) views[k].hidden = k !== view;
  const seg = view === "histitem" || view === "login" ? "history" : view === "article" ? "news" : view;
  document.querySelectorAll(".segs a[data-seg]").forEach((a) => {
    if (a.dataset.seg === seg) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  try { sessionStorage.setItem(CAR_TAB, seg); } catch { /* 不給用就算了 */ }
  setPrefs(wantPrefs);
  window.scrollTo(0, 0);

  if (view === "history") { paintHistory(); paintAccount(); }
  else if (view === "histitem") paintHistItem(id);
  else if (view === "login") paintLogin();
  else if (view === "news") paintNews();
  else if (view === "article") paintArticle(id);
}
window.addEventListener("hashchange", route);

// 已經在辨車頁時再點底部的「汽車」，就捲回最上面
$("carTab").addEventListener("click", (e) => {
  if (document.body.dataset.view !== "car") return;
  e.preventDefault();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

/* ---------- 共用的小工具 ---------- */

const pad2 = (n) => String(n).padStart(2, "0");
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
function confOf(d) {
  const c = Math.max(0, Math.min(100, Math.round(Number(d?.confidence) || 0)));
  return c >= 70 ? ["高", " good"] : c >= 40 ? ["普通", ""] : ["偏低", " weak"];
}
const CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
const STACK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/></svg>';
const PHOTO_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 16.2l4.6-4.4 3.8 3.6 2.8-2.6 6.8 6"/><circle cx="8.8" cy="9.6" r="1.3"/></svg>';

/* ================= 紀錄 ================= */
// 存在這支手機的 IndexedDB：辨識結果、這次的照片（再辨一次用）、一張小縮圖。
// 內容 25 以前一筆只有一張照片，存在 photo；之後存在 photos 陣列。
// 內容 28 起可以登入：登入時辨的紀錄記著 owner（誰的）和 dirty（還沒傳上雲端）；
// 從雲端拿回來的紀錄先只有縮圖，照片（n 張）第一次點開才下載。

const HIST_MAX = 300;
let dbPromise = null;

function histDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open("carid", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("history", { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
async function histTx(mode, fn) {
  const db = await histDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("history", mode);
    const r = fn(t.objectStore("history"));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const histAll = () => histTx("readonly", (st) => st.getAll());
const histGet = (id) => histTx("readonly", (st) => st.get(id));
const histPut = (rec) => histTx("readwrite", (st) => st.put(rec));
const histDelete = (id) => histTx("readwrite", (st) => st.delete(id));

/* 在同一個交易裡讀出來、改一改、存回去；紀錄已經被刪掉就不動，回傳 false */
function histPatch(id, fn) {
  return histTx("readwrite", (st) => {
    const out = { result: false };
    const req = st.get(id);
    req.onsuccess = () => {
      if (!req.result) return;
      fn(req.result);
      st.put(req.result);
      out.result = true;
    };
    return out;
  });
}

function canvasBlob(src, max, quality, square) {
  let w = src.width, h = src.height, sx = 0, sy = 0, sw = w, sh = h;
  if (square) {                       // 縮圖裁成正方形，列表比較整齊
    const m = Math.min(w, h);
    sx = (w - m) / 2; sy = (h - m) / 2; sw = sh = m; w = h = m;
  }
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  c.getContext("2d").drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return new Promise((resolve) => c.toBlob(resolve, "image/jpeg", quality));
}

/* 一筆紀錄的所有照片，舊的紀錄只有一張 */
function recPhotos(r) {
  if (Array.isArray(r?.photos) && r.photos.length) return r.photos;
  return r?.photo ? [r.photo] : [];
}

async function saveHistory(data, canvases) {
  // 第 1 張存 1024px，其他張存 800px 省一點空間
  const [thumb, ...photos] = await Promise.all([
    canvasBlob(canvases[0], 176, 0.78, true),
    ...canvases.map((c, i) => canvasBlob(c, i ? 800 : 1024, 0.8)),
  ]);
  const t = Date.now();
  const rec = { id: t.toString(36), t, data, photos, thumb };
  // 登入中辨的算這個人的，等一下傳上雲端；沒登入的沒有主人，登入時再一起傳
  if (who) { rec.owner = who.uid; rec.dirty = true; }
  await histPut(rec);
  // 最多留 300 筆，只算畫面上看得到的這一份（別的帳號藏起來的不動）；太舊的連雲端一起刪
  const mine = (await histAll()).filter(visibleRec);
  if (mine.length > HIST_MAX) {
    mine.sort((a, b) => a.t - b.t);
    for (const old of mine.slice(0, mine.length - HIST_MAX)) {
      await histDelete(old.id);
      acctDeleted(old);
    }
  }
  acctSync();
  refreshCounts();
}

let histUrls = [];
function blobUrl(b) {
  if (!b) return "";
  const u = URL.createObjectURL(b);
  histUrls.push(u);
  return u;
}
function freeUrls() {
  histUrls.forEach((u) => URL.revokeObjectURL(u));
  histUrls = [];
}

async function paintHistory() {
  let all = [];
  try { all = await histAll(); } catch { /* 瀏覽器不給用 IndexedDB 就當沒有 */ }
  all = all.filter(visibleRec);
  freeUrls();
  all.sort((a, b) => b.t - a.t);

  $("histEmpty").hidden = all.length > 0;
  const stats = $("histStats");
  stats.hidden = all.length === 0;
  if (all.length) {
    const makes = new Map();
    for (const r of all) {
      const m = r.data?.make || r.data?.make_zh;
      if (m) makes.set(m.toLowerCase(), { name: m, n: (makes.get(m.toLowerCase())?.n || 0) + 1 });
    }
    const top = [...makes.values()].sort((a, b) => b.n - a.n)[0];
    stats.innerHTML =
      `<div class="stat"><b>${all.length}</b><span>辨過幾台</span></div>` +
      `<div class="stat"><b>${makes.size}</b><span>幾個廠牌</span></div>` +
      `<div class="stat"><b class="accent">${esc(top?.name || "—")}</b><span>最常遇到</span></div>`;
  }

  let html = "", last = "";
  for (const r of all) {
    const g = dayLabel(r.t);
    if (g !== last) { html += `<div class="hgroup">${esc(g)}</div>`; last = g; }
    const d = r.data || {};
    const [word, cls] = confOf(d);
    const n = recPhotos(r).length || r.n || 0;
    const thumb = `<img class="hthumb" src="${blobUrl(r.thumb)}" alt="">`;
    html +=
      `<a class="hrow" href="#history/${encodeURIComponent(r.id)}">` +
      (n > 1 ? `<span class="hthumbwrap">${thumb}<span class="hcount" aria-label="${n} 張照片">${STACK_ICON}${n}</span></span>` : thumb) +
      '<span class="hinfo">' +
      `<span class="hmake">${esc(d.make || d.make_zh || "")}</span>` +
      `<span class="hmodel">${esc(d.model || "沒認出車型")}</span>` +
      `<span class="hmeta"><span class="chip${cls}">把握度　${word}</span>${esc(clockText(r.t))}</span>` +
      "</span>" + CHEV + "</a>";
  }
  $("histList").innerHTML = html;
}

/* 紀錄裡的照片：好幾張就左右滑，角落是「2 / 3」，下面是小圓點 */
const histPhotos = $("histPhotos");
const histCount = $("histCount");
const histDots = $("histDots");

function paintHistPhotos(r) {
  let list = recPhotos(r);
  if (!list.length) list = [r.thumb].filter(Boolean);   // 萬一沒有照片，至少放縮圖
  const n = list.length;
  histPhotos.innerHTML = list
    .map((b, i) => `<img src="${blobUrl(b)}" alt="${n > 1 ? `第 ${i + 1} 張照片` : "紀錄裡的照片"}">`).join("");
  histPhotos.scrollLeft = 0;
  histCount.hidden = n < 2;
  histDots.hidden = n < 2;
  histDots.innerHTML = n > 1 ? list.map((_, i) => `<i${i ? "" : ' class="on"'}></i>`).join("") : "";
  markHistPhoto();
}

function markHistPhoto() {
  const n = histPhotos.children.length;
  if (n < 2) return;
  const w = histPhotos.clientWidth || 1;
  const i = Math.max(0, Math.min(n - 1, Math.round(histPhotos.scrollLeft / w)));
  histCount.textContent = `${i + 1} / ${n}`;
  [...histDots.children].forEach((dot, k) => dot.classList.toggle("on", k === i));
}
histPhotos.addEventListener("scroll", markHistPhoto, { passive: true });

let histCurrent = null;
async function paintHistItem(id) {
  freeUrls();
  let r = null;
  try { r = await histGet(id); } catch { /* 找不到就回列表 */ }
  // 找不到，或是別的帳號的（登出後按返回鍵回到這裡）
  if (!r || !visibleRec(r)) { location.replace("#history"); return; }
  histCurrent = r;
  paintHistPhotos(r);
  renderResult(r.data, {
    body: $("histBody"),
    notes: $("histNotes"),
    when: dayLabel(r.t) + " " + clockText(r.t) + " 辨的",
  });
  // 從雲端拿回來的紀錄第一次點開：先放縮圖，照片下載好再換上去
  if (!recPhotos(r).length && r.n) {
    cloudPhotos(r).then((list) => {
      if (histCurrent !== r || document.body.dataset.view !== "histitem" || !list.length) return;
      r.photos = list;
      paintHistPhotos(r);
    });
  }
}

$("histDel").addEventListener("click", async () => {
  if (!histCurrent || !confirm("刪掉這筆紀錄？刪了就找不回來。")) return;
  const gone = histCurrent;
  await histDelete(gone.id);
  acctDeleted(gone);
  histCurrent = null;
  refreshCounts();
  location.hash = "#history";
});

$("histRedo").addEventListener("click", async () => {
  const rec = histCurrent;
  let list = recPhotos(rec);
  if (!list.length && rec?.n) list = await cloudPhotos(rec);
  if (!list.length) {
    if (rec?.n) alert("照片還沒從雲端拿回來，連上網路再試一次。");
    return;
  }
  if (histCurrent !== rec || document.body.dataset.view !== "histitem") return;
  location.hash = "#car";
  if (busy) return;           // 正在辨別台，回辨車頁看那一台就好
  // 把這筆的照片全部放回去，一起再辨一次
  clearShots();
  for (const b of list.slice(0, MAX_SHOTS)) addShot(b, "紀錄裡的照片");
  sel = 0;
  showScreen("capture");
  paintShots();
  run();
});

/* ================= 帳號 ================= */
// 用 email 連結登入，不用密碼（account.js 負責登入和跟雲端對齊）。
// 紀錄一律從手機的 IndexedDB 讀：沒登入只看沒主人的；登入後看自己的，加上還沒傳上去的。
// 登入信的連結：App 裡由外殼從 carid://login?… 交給 window.caridLink()；
// 網頁版則是 login.html 轉回來，網址上帶著 oobCode。

const ACCT_KEY = "carid.acct";   // 上次登入的是誰 { uid, email }：一打開就知道要顯示誰的紀錄，不用等 Firebase
const APK_LATEST = "https://github.com/nkuo-git/carid-pwa/releases/latest";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readWho() {
  try {
    const v = JSON.parse(load(ACCT_KEY) || "null");
    return v && v.uid ? { uid: String(v.uid), email: String(v.email || "") } : null;
  } catch {
    return null;
  }
}
let who = readWho();
const visibleRec = (r) => (who ? !r.owner || r.owner === who.uid : !r.owner);

/* 跑在 App 裡、而且外殼接得到登入連結（App 8 起有 window.CaridApp） */
const inApp = () => !!window.CaridApp?.ready;
/* App 7 以前的外殼接不到登入信的連結，要先裝新版 */
const oldShell = () => appBuild() !== null && !window.CaridApp;

let acctMod = null;
let acctSnap = { user: null, sync: { phase: "idle", done: 0, total: 0, pulled: 0, pushed: 0, rounds: 0, error: null } };
let signing = false;      // 點了信裡的連結回來，正在登入
let justIn = false;       // 剛登入：登入後第一次對齊完，在紀錄頁說一次「登入好了」
let justInAt = 0;         // 登入那一刻已經對齊過幾次
let logoutErr = "";
let counts = { mine: 0, loose: 0, dirty: 0 };
let lastPhase = "idle";

/* account.js 第一次要用才載；Firebase 的登入和資料庫要等 start() 才載 */
function account() {
  if (!acctMod) {
    acctMod = import("./account.js?v=" + WEB_BUILD).then((m) => {
      m.init({
        firebaseApp,
        hist: { all: histAll, get: histGet, put: histPut, del: histDelete, patch: histPatch },
        inApp,
      });
      m.onChange(onAccount);
      return m;
    });
    acctMod.catch(() => { acctMod = null; });
  }
  return acctMod;
}
/* 開始看登入狀態（會載 Firebase），第一次知道有沒有登入才 resolve */
const acctStart = () => account().then((m) => m.start().then(() => m));

/* 紀錄有變動就跟雲端對齊一次（沒登入什麼都不做） */
function acctSync(delay) {
  if (who) acctStart().then((m) => m.syncSoon(delay)).catch(() => { /* 沒網路：等有網路再說 */ });
}
function acctDeleted(rec) {
  if (rec?.owner) account().then((m) => m.recordDeleted(rec)).catch(() => { /* 載不到就算了 */ });
}
/* 從雲端拿回來的紀錄，照片第一次要用才下載；拿不到就回空的 */
function cloudPhotos(rec) {
  return acctStart().then((m) => m.photosFor(rec)).catch(() => []);
}

function onAccount(snap) {
  acctSnap = snap;
  const u = snap.user;
  const changed = (u?.uid || null) !== (who?.uid || null);
  if (changed || (u && u.email !== who.email)) {
    who = u ? { uid: u.uid, email: u.email } : null;
    store(ACCT_KEY, who ? JSON.stringify(who) : null);
  }
  if (u) signing = false;
  if (!u) justIn = false;
  const phase = snap.sync.phase;
  // 換了人、同步完：紀錄重畫；拿雲端紀錄的時候最多一秒畫一次
  if (changed || (phase === "idle" && lastPhase !== "idle")) refreshHistory();
  else if (phase === "down") refreshHistory(true);
  lastPhase = phase;
  paintAccount();
}

let histTimer = 0;
let histPaintAt = 0;
function refreshHistory(throttle) {
  clearTimeout(histTimer);
  const wait = throttle ? Math.max(0, histPaintAt + 1000 - Date.now()) : 0;
  histTimer = setTimeout(() => {
    histPaintAt = Date.now();
    refreshCounts();
    if (document.body.dataset.view === "history") paintHistory();
  }, wait);
}

/* 幾筆是自己的（設定裡顯示）、幾筆還沒有主人（登入頁說會一起存上去）、幾筆還沒傳 */
async function refreshCounts() {
  let all = [];
  try { all = await histAll(); } catch { /* 沒有 IndexedDB 就當沒有 */ }
  counts = {
    mine: who ? all.filter((r) => r.owner === who.uid).length : 0,
    loose: all.filter((r) => !r.owner).length,
    dirty: who ? all.filter((r) => r.owner === who.uid && r.dirty).length : 0,
  };
  paintAccount();
}

const SVG = (paths, w = 1.8) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const CLOUD = '<path d="M7 18.5h10.3a4.2 4.2 0 0 0 .5-8.4 6 6 0 0 0-11.5-.9A4.7 4.7 0 0 0 7 18.5z"/>';
const ICONS = {
  cloud: SVG(CLOUD, 1.9),
  cloudOk: SVG(CLOUD + '<path d="M9.4 13.6l1.9 1.9 3.5-3.7"/>', 1.9),
  sync: SVG('<path d="M20 12a8 8 0 0 1-13.7 5.6"/><path d="M4 12a8 8 0 0 1 13.7-5.6"/><path d="M17.7 3v3.6h-3.6"/><path d="M6.3 21v-3.6h3.6"/>', 1.9),
  check: SVG('<path d="M5 12.5l4.2 4.2L19 7"/>', 2.2),
  alert: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7.4v5.4"/><path d="M12 16.1v.3"/>'),
  person: SVG('<circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 19.5a7.2 7.2 0 0 1 14.4 0"/>'),
};

/* 新版 APK 的下載網址：查到過就直接給 .apk，不然給 Releases 頁 */
function apkHref() {
  const a = $("appUpdateLink");
  return a && !$("appUpdateBar").hidden && /\.apk$/i.test(a.href) ? a.href : APK_LATEST;
}

function syncErrorText(err) {
  if (err?.code === "permission-denied") return "雲端還不讓這個帳號存紀錄，紀錄先留在這支手機";
  return "雲端同步沒成功，有網路時會再試一次";
}

function doneText(s) {
  if (s.pulled) return `登入好了，雲端的 ${s.pulled} 筆紀錄都拿回來了`;
  if (s.pushed) return `登入好了，這支手機的 ${s.pushed} 筆紀錄都存到雲端了`;
  return "登入好了，之後辨的車都會存到雲端";
}

function paintAccount() {
  const s = acctSnap.sync;
  const syncing = !!who && (s.phase === "up" || s.phase === "down");
  const synced = !!who && !!acctSnap.user && s.phase === "idle" && !s.error && counts.dirty === 0;

  // 紀錄頁：沒登入是一張卡片；登入後是一行字，加上同步進度
  const card = $("acctCard");
  card.hidden = !!who || signing;
  if (!card.hidden) {
    const old = oldShell();
    $("acctCardText").textContent = old
      ? "要用 email 登入，得先裝新版的 App。直接蓋過去裝就好，手機上的紀錄不會不見。"
      : "用 email 登入，紀錄會存到雲端。換手機的時候用同一個 email 登入，紀錄就拿得回來。";
    const btn = $("acctCardBtn");
    btn.textContent = old ? "下載新版 App" : "用 email 登入";
    btn.href = old ? apkHref() : "#login";
  }

  const line = $("acctLine");
  line.hidden = !who;
  if (who) {
    line.innerHTML = synced
      ? `<span class="ok">${ICONS.cloudOk}</span><span>已存到雲端・${esc(who.email)}</span>`
      : `${ICONS.cloud}<span>已登入・${esc(who.email)}</span>`;
  }

  // [樣式, 圖示, 文字, 數字, 進度 0–1]
  let st = null;
  if (signing) st = ["busy", ICONS.sync, "正在登入…"];
  else if (syncing) {
    st = ["busy", ICONS.sync,
      s.phase === "up" ? "正在把這支手機的紀錄存上去…" : "正在把雲端的紀錄拿回來…",
      s.total ? `${Math.min(s.done, s.total)} / ${s.total}` : "",
      s.total ? Math.min(1, s.done / s.total) : null];
  } else if (who && s.error) st = ["bad", ICONS.alert, syncErrorText(s.error)];
  else if (who && justIn && acctSnap.user && s.phase === "idle" && s.rounds > justInAt) st = ["ok", ICONS.check, doneText(s)];
  const box = $("acctStatus");
  box.hidden = !st;
  if (st) {
    box.className = "acct-status " + st[0];
    $("acctStatusIc").innerHTML = st[1];
    $("acctStatusText").textContent = st[2];
    $("acctStatusNum").textContent = st[3] || "";
    $("acctStatusNum").hidden = !st[3];
    $("acctBar").hidden = st[4] == null;
    // 從「存上去」換到「拿回來」時進度條直接歸零，不要倒著滑回去
    const fill = $("acctBarFill");
    const width = st[4] == null ? "0%" : (st[4] * 100).toFixed(1) + "%";
    if (fill.dataset.k !== st[2]) {
      fill.dataset.k = st[2];
      fill.style.transition = "none";
      fill.style.width = width;
      void fill.offsetWidth;
      fill.style.transition = "";
    } else {
      fill.style.width = width;
    }
  }

  // 設定面板最上面那一列
  const av = $("acctAvatar");
  av.classList.toggle("on", !!who);
  if (who) av.textContent = (who.email.trim().charAt(0) || "?").toUpperCase();
  else av.innerHTML = ICONS.person;
  $("acctWho").textContent = who ? who.email : "還沒登入";
  const sub = $("acctSub");
  if (!who) sub.textContent = "紀錄只存在這支手機";
  else if (logoutErr) sub.textContent = logoutErr;
  else if (s.error) sub.textContent = "雲端同步沒成功";
  else if (syncing || signing) sub.textContent = "正在同步…";
  else if (synced) sub.innerHTML = `${ICONS.cloudOk}紀錄已存到雲端・${counts.mine} 筆`;
  else sub.textContent = "已登入";
  const inBtn = $("acctIn");
  inBtn.hidden = !!who;
  inBtn.textContent = oldShell() ? "更新 App" : "登入";
  inBtn.href = oldShell() ? apkHref() : "#login";
  $("acctOut").hidden = !who;

  // 辨車頁最下面那段話：登入後照片也會存到雲端，要照實說
  $("privacyLine").textContent = who
    ? "照片會送去判讀，另外存一份在「紀錄」裡，也會存到你登入的雲端帳號，只有你自己看得到。車牌號碼不會被讀出來。"
    : "照片會送去判讀，另外存一份在這支手機的「紀錄」裡，不會傳去別的地方。車牌號碼不會被讀出來。";
}

// 點了設定裡的「登入」就把設定收起來
$("acctIn").addEventListener("click", () => setPrefs(false));

$("acctOut").addEventListener("click", async () => {
  const btn = $("acctOut");
  btn.disabled = true;
  logoutErr = "";
  try {
    await (await acctStart()).logout();
  } catch {
    logoutErr = "要連上網路才能登出";
  }
  btn.disabled = false;
  paintAccount();
});

/* ---------- 登入頁 ---------- */

const loginForm = $("loginForm");
const loginEmail = $("loginEmail");
const loginSend = $("loginSend");
const loginErr = $("loginErr");
const sentErr = $("sentErr");
const resendBtn = $("resend");
let linkWaiting = null;   // 點了連結回來，但這支手機不知道是哪個 email：等使用者再輸入一次
let loginError = "";      // 登入頁上要顯示的錯誤（例如連結過期了）
let sent = null;          // 剛寄出的登入信 { email, at }
let resendTimer = 0;

function showErr(el, msg) {
  el.textContent = msg || "";
  el.hidden = !msg;
  if (el === loginErr) loginEmail.setAttribute("aria-invalid", msg ? "true" : "false");
}

function paintLogin() {
  // 已經登入就不用再登入；舊版 App 在紀錄頁有說要先更新
  if (who || oldShell()) { location.replace("#history"); return; }
  acctStart().catch(() => { /* 按寄信時會再試 */ });
  const confirming = !!linkWaiting;
  const showSent = !confirming && !!sent && Date.now() - sent.at < 30 * 60e3;
  loginForm.hidden = showSent;
  $("loginSent").hidden = !showSent;
  if (showSent) { paintSent(); return; }

  $("loginTitle").textContent = confirming ? "再輸入一次 email" : "用 email 登入";
  $("loginText").textContent = confirming
    ? "為了確認是你本人，請輸入剛剛收到登入信的 email。"
    : "不用密碼。輸入 email 之後會收到一封登入信，點信裡的連結就登入了。";
  loginSend.textContent = confirming ? "登入" : "寄登入信";
  loginSend.disabled = false;
  $("loginNote").hidden = confirming || counts.loose === 0;
  $("loginNoteText").textContent = `這支手機上已經有的 ${counts.loose} 筆紀錄，登入後會一起存上去。`;
  showErr(loginErr, loginError);
  if (!loginEmail.value) account().then((m) => { if (!loginEmail.value) loginEmail.value = m.savedEmail(); }).catch(() => {});
}

function paintSent() {
  $("sentTo").textContent = sent.email;
  $("sentHow").textContent = inApp()
    ? "在這支手機上打開信，點信裡的連結，就會回到 App 登入。"
    : "打開信，點信裡的連結，就會回到這裡登入。";
  $("openMail").hidden = typeof window.CaridApp?.openMail !== "function";
  resendCountdown();
}

/* 重寄要等 60 秒，免得連按好幾次把今天能寄的信用光 */
function resendCountdown() {
  clearInterval(resendTimer);
  const tick = () => {
    const left = sent ? Math.ceil((sent.at + 60e3 - Date.now()) / 1000) : 0;
    resendBtn.disabled = left > 0;
    resendBtn.textContent = left > 0 ? `重寄一次（${left} 秒後）` : "重寄一次";
    if (left <= 0) clearInterval(resendTimer);
  };
  tick();
  resendTimer = setInterval(tick, 1000);
}

function sendErrorText(err) {
  const code = err?.code || "";
  if (code === "auth/invalid-email" || code === "auth/missing-email") return "這個 email 看起來不太對，再檢查一下。";
  if (code === "auth/network-request-failed" || err instanceof TypeError) return "連不到網路。確認手機有網路之後再按一次。";
  if (code === "auth/too-many-requests") return "寄太多次了，等幾分鐘再試。";
  if (code === "auth/quota-exceeded") return "今天能寄的登入信用完了，明天再試。";
  if (/operation-not-allowed|continue-uri|unauthorized-domain|admin-restricted/.test(code)) {
    return `登入功能還沒開好，晚一點再試。（${code}）`;
  }
  return "登入信沒寄出去，再按一次看看。" + (code ? `（${code}）` : "");
}

function linkErrorText(err) {
  const code = err?.code || "";
  if (code === "auth/invalid-action-code" || code === "auth/expired-action-code") {
    return "這封登入信的連結已經用過或過期了，請再寄一次登入信。";
  }
  if (code === "auth/invalid-email") return "這個 email 跟收到登入信的不一樣，再檢查一下。";
  if (code === "auth/argument-error") return "這個連結不完整，請再寄一次登入信。";
  if (code === "auth/user-disabled") return "這個帳號被停用了。";
  if (code === "auth/network-request-failed" || err instanceof TypeError) {
    return "連不到網路，連上之後再點一次信裡的連結。";
  }
  return "沒有登入成功，請再寄一次登入信。" + (code ? `（${code}）` : "");
}

loginEmail.addEventListener("input", () => {
  if (loginError) { loginError = ""; showErr(loginErr, ""); }
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = loginEmail.value.trim();
  if (!EMAIL_RE.test(email)) {
    loginError = "這個 email 看起來不太對，再檢查一下。";
    showErr(loginErr, loginError);
    loginEmail.focus();
    return;
  }
  loginError = "";
  showErr(loginErr, "");
  if (linkWaiting) {                   // 再輸入一次 email：直接完成登入
    finishSignIn(linkWaiting, email);
    return;
  }
  loginSend.disabled = true;
  loginSend.textContent = "寄送中…";
  try {
    await (await account()).sendLink(email);
    sent = { email, at: Date.now() };
    showErr(sentErr, "");
    paintLogin();
  } catch (err) {
    loginError = sendErrorText(err);
    showErr(loginErr, loginError);
  }
  loginSend.disabled = false;
  loginSend.textContent = "寄登入信";
});

$("openMail").addEventListener("click", () => {
  let ok = false;
  try { ok = !!window.CaridApp?.openMail?.(); } catch { ok = false; }
  showErr(sentErr, ok ? "" : "找不到信箱 App，請自己打開收信的 App。");
});

resendBtn.addEventListener("click", async () => {
  if (!sent) return;
  clearInterval(resendTimer);
  resendBtn.disabled = true;
  resendBtn.textContent = "寄送中…";
  showErr(sentErr, "");
  try {
    await (await account()).sendLink(sent.email);
    sent.at = Date.now();
  } catch (err) {
    showErr(sentErr, sendErrorText(err));
  }
  resendCountdown();
});

$("changeEmail").addEventListener("click", () => {
  sent = null;
  clearInterval(resendTimer);
  showErr(sentErr, "");
  paintLogin();
  loginEmail.focus();
  loginEmail.select?.();
});

/* 點了信裡的連結回來：這支手機記得 email 就直接登入，不記得就請他再輸入一次 */
function handleLink(link) {
  account().then((m) => {
    if (!m.looksLikeLink(link)) return;
    const email = m.savedEmail();
    if (email) { finishSignIn(link, email); return; }
    linkWaiting = link;
    loginError = "";
    loginEmail.value = "";
    if (location.hash === "#login") paintLogin();
    else location.hash = "#login";
  }).catch(() => {
    loginError = "連不到網路，連上之後再點一次信裡的連結。";
    if (location.hash === "#login") paintLogin();
    else location.hash = "#login";
  });
}

async function finishSignIn(link, email) {
  signing = true;
  linkWaiting = null;
  loginError = "";
  if (location.hash === "#history") paintAccount();
  else location.hash = "#history";
  try {
    const m = await acctStart();
    await m.finishLink(link, email);
    sent = null;
    justIn = true;
    justInAt = acctSnap.sync.rounds;
    m.syncSoon(0);
  } catch (err) {
    // 已經是登入的狀態（例如同一封信點了兩次），就不用吵他
    if (!who) {
      if (err?.code === "auth/invalid-email") linkWaiting = link;   // email 打錯了，讓他再輸入一次
      loginError = linkErrorText(err);
      signing = false;
      location.hash = "#login";
    }
  }
  signing = false;
  paintAccount();
}

/* App（新版外殼）把 carid://login?… 交過來；網址後面那串就是信裡連結帶的參數 */
window.caridLink = (url) => {
  const q = String(url || "").replace(/^[^?]*/, "");
  if (q) handleLink(new URL("login.html" + q, location.href).href);
};

// 有網路了、從背景切回來（最多一分鐘一次），就跟雲端對齊一次
window.addEventListener("online", () => acctSync(0));
let acctKickAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden || Date.now() - acctKickAt < 60e3) return;
  acctKickAt = Date.now();
  acctSync(0);
});

/* ================= 車訊 ================= */
// 內容是 GitHub 上的排程每週三、六、日產生的 news/index.json，這裡只負責讀和顯示

const NEWS_URL = "./news/index.json";
const NEWS_SEEN = "carid.newsSeen";
const KINDS = {
  lux: { tag: "週三汽車介紹", short: "汽車介紹", wd: 3 },
  new: { tag: "週六新車快訊", short: "新車快訊", wd: 6 },
  how: { tag: "週日汽車原理", short: "汽車原理", wd: 0 },
};
let newsData = null;

async function loadNews() {
  const res = await fetch(NEWS_URL, { cache: "no-store" });
  // 還沒出過任何一篇時檔案不存在，那不是網路問題
  if (res.status === 404) { newsData = []; return newsData; }
  if (!res.ok) throw new Error("HTTP " + res.status);
  const j = await res.json();
  newsData = Array.isArray(j?.items) ? j.items : [];
  newsData.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return newsData;
}

/* 台北時間的日期字串與星期 */
function taipeiToday() {
  const d = new Date(Date.now() + 8 * 3600e3);
  return { key: d.toISOString().slice(0, 10), wd: d.getUTCDay(), ms: d.getTime() };
}
function shortDate(key) {
  const [, m, d] = key.split("-").map(Number);
  return m + "/" + d;
}
function longDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  const wd = "日一二三四五六"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return m + "月" + d + "日　週" + wd;
}
const ktag = (k) => `<span class="ktag ${esc(k)}">${esc(KINDS[k]?.tag || "車訊")}</span>`;

/* 有沒看過的車訊時，「車訊」旁邊和底部的「汽車」各亮一個小點 */
function paintNewsDots(on) {
  $("segNewsDot").hidden = !on;
  $("carDot").hidden = !on;
}

async function checkNewsDot() {
  try {
    const items = newsData || await loadNews();
    paintNewsDots(items.length > 0 && load(NEWS_SEEN) !== items[0].id);
  } catch { /* 沒網路就不亮 */ }
}

async function paintNews() {
  const body = $("newsBody");
  const today = taipeiToday();
  let items = newsData || [];
  if (!newsData) body.innerHTML = '<p class="empty">讀取中…</p>';
  try { items = await loadNews(); } catch {
    if (!newsData) { body.innerHTML = '<p class="empty">連不上網路，車訊讀不到。</p>'; }
  }

  // 本週（週一開始）的三、六、日
  const monday = today.ms - ((today.wd + 6) % 7) * 864e5;
  $("newsWeek").innerHTML = ["lux", "new", "how"].map((k) => {
    const offset = { lux: 2, new: 5, how: 6 }[k];
    const key = new Date(monday + offset * 864e5).toISOString().slice(0, 10);
    const it = items.find((x) => x.date === key && x.kind === k);
    const state = it ? "已出刊" : key > today.key ? "還沒到" : key === today.key ? "準備中" : "這次沒出刊";
    const tagName = it ? "a" : "div";
    const href = it ? ` href="#news/${encodeURIComponent(it.id)}"` : "";
    return `<${tagName} class="wcell ${k}${it ? " done" : ""}"${href}>` +
      `<span class="wd"><b>週${"日一二三四五六"[KINDS[k].wd]}</b><span class="kdate">${shortDate(key)}</span></span>` +
      `<span class="wn">${KINDS[k].short}</span><span class="ws">${state}</span></${tagName}>`;
  }).join("");

  if (!items.length) {
    if (newsData) body.innerHTML = '<p class="empty">第一篇還在路上。每週三、六、日早上六點多會出刊。</p>';
    return;
  }
  store(NEWS_SEEN, items[0].id);
  paintNewsDots(false);

  const [first, ...rest] = items;
  const img = first.img
    ? `<img class="fimg" src="${esc(first.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="fimg none">${PHOTO_ICON}</span>`;
  let html =
    '<div class="nlabel">最新一篇</div>' +
    `<a class="feature" href="#news/${encodeURIComponent(first.id)}">${img}` +
    '<span class="fbody">' +
    `<span class="kline">${ktag(first.kind)}<span class="kdate">${shortDate(first.date)}</span></span>` +
    `<span class="ftitle">${esc(first.title)}</span>` +
    (first.lede ? `<span class="flede">${esc(first.lede)}</span>` : "") +
    "</span></a>";
  if (rest.length) {
    html += '<div class="nlabel">之前的</div>';
    html += rest.map((it) =>
      `<a class="nrow" href="#news/${encodeURIComponent(it.id)}"><span class="ninfo">` +
      `<span class="kline">${ktag(it.kind)}<span class="kdate">${shortDate(it.date)}</span></span>` +
      `<span class="nt">${esc(it.title)}</span></span>${CHEV}</a>`).join("");
  }
  body.innerHTML = html;
}

function safeUrl(u) {
  return /^https:\/\//i.test(String(u || "")) ? String(u) : "";
}

async function paintArticle(id) {
  const box = $("articleBody");
  let items = newsData;
  if (!items) {
    box.innerHTML = '<p class="empty">讀取中…</p>';
    try { items = await loadNews(); } catch { box.innerHTML = '<p class="empty">連不上網路，文章讀不到。</p>'; return; }
  }
  const a = items.find((x) => x.id === id);
  if (!a) { location.hash = "#news"; return; }

  let html = "";
  if (safeUrl(a.img)) {
    html += `<div class="aimg"><img src="${esc(a.img)}" alt="" referrerpolicy="no-referrer"></div>`;
    if (a.imgCredit) html += `<p class="acredit">照片：${esc(a.imgCredit)}</p>`;
  }
  html += `<div class="ahead"><span class="kline">${ktag(a.kind)}<span class="hero-sub">${esc(longDate(a.date))}</span></span>`;
  if (a.make) html += `<span class="amake">${esc(a.make)}</span>`;
  html += `<h1 class="atitle${a.title.length > 14 ? " long" : ""}">${esc(a.title)}</h1></div>`;
  if (a.lede) html += `<p class="alede">${esc(a.lede)}</p>`;

  const specs = Array.isArray(a.specs) ? a.specs.filter((r) => Array.isArray(r) && r[0] && r[1]) : [];
  if (specs.length) {
    html += '<div class="alabel">重點規格</div><div class="card"><table class="spec"><tbody>' +
      specs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("") +
      "</tbody></table></div>";
  }
  for (const sec of Array.isArray(a.sections) ? a.sections : []) {
    if (sec?.h) html += `<h2>${esc(sec.h)}</h2>`;
    for (const para of Array.isArray(sec?.p) ? sec.p : [sec?.p]) {
      if (para) html += `<p class="ap">${esc(para)}</p>`;
    }
  }
  const srcs = (Array.isArray(a.sources) ? a.sources : []).filter((x) => safeUrl(x?.url));
  if (srcs.length) {
    html += '<p class="asrc">資料來源：' + srcs.map((x) =>
      `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name || x.url)}</a>`).join("　") + "</p>";
  }
  box.innerHTML = html;
}

/* ================= 啟動 ================= */

store(OLD_KEY_STORE, null);
paintVersion();
showScreen("capture");
// 趁使用者還在選照片，先在背景把 Firebase 和 App Check 準備好
setTimeout(() => firebaseAI().catch(() => { /* 按辨識時會再試 */ }), 0);
// 網頁版點了登入信的連結：網址上帶著 oobCode。拿下來之後把網址清乾淨，重新整理才不會再用一次
const webLink = /oobCode(=|%3D)/i.test(location.search) ? location.href : null;
if (webLink) history.replaceState(null, "", location.pathname + "#history");
// 從麥塊按「汽車」回來時網址沒有 #，回到上次看的那一頁
if (!location.hash && lastCarTab() !== "car") history.replaceState(null, "", "#" + lastCarTab());
route();
checkNewsDot();
paintAccount();
refreshCounts();
if (webLink) handleLink(webLink);
else if (who) acctStart().catch(() => { /* 沒網路：先照上次登入的人顯示，有網路再同步 */ });
// 告訴 App 的外殼可以把登入連結交過來了（舊版外殼沒有這個）
window.CaridApp?.ready?.();

/* ---------- 外殼（APK）有沒有新版 ----------
   跑在 App 裡時 User-Agent 會帶 CaridApp/<版號>，拿它跟 GitHub 上最新的
   Release（tag 是 apk-<版號>）比一比，有新的就跳一條橫幅讓使用者下載。
   在一般瀏覽器裡不會有那段 UA，整段直接跳過。 */
const APK_API = "https://api.github.com/repos/nkuo-git/carid-pwa/releases/latest";
const APK_SEEN = "carid.apkcheck";

async function checkAppUpdate() {
  const m = /CaridApp\/(\d+)/.exec(navigator.userAgent || "");
  if (!m) return;                      // 不是在 App 裡，不用查
  const mine = Number(m[1]);

  // 一小時查一次就夠了，GitHub 的匿名 API 有次數限制
  const last = Number(load(APK_SEEN) || 0);
  if (Date.now() - last < 60 * 60 * 1000) return;

  let latest;
  try {
    const res = await fetch(APK_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return;
    latest = await res.json();
  } catch {
    return;                            // 沒網路就算了
  }
  store(APK_SEEN, String(Date.now()));

  const tag = /^apk-(\d+)$/.exec(latest?.tag_name || "");
  if (!tag || Number(tag[1]) <= mine) return;

  const apk = (latest.assets || []).find((a) => /\.apk$/i.test(a.name || ""));
  if (!apk?.browser_download_url) return;

  const bar = $("appUpdateBar");
  const link = $("appUpdateLink");
  if (!bar || !link) return;
  link.href = apk.browser_download_url;
  bar.hidden = false;
}

/* ---------- 自動更新 ----------
   新版的 Service Worker 裝好之後會在旁邊待命。閒著沒事（沒選照片、沒在辨識）
   就直接換過去並重新載入；正在用就先跳一條橫幅，讓使用者自己決定什麼時候更新。 */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    let reg;
    try {
      reg = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
    } catch {
      return; // 沒註冊成功就當一般網頁用
    }

    const bar = $("updateBar");
    const btn = $("updateBtn");
    // 第一次安裝時 SW 接管這一頁也會觸發 controllerchange，那次不算換版，不要重載
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    let applied = false;

    const apply = () => {
      if (!reg.waiting) return;
      applied = true;
      if (btn) { btn.disabled = true; btn.textContent = "更新中…"; }
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    };

    const offer = () => {
      // 第一次安裝沒有舊版可換，不用打擾使用者
      if (!reg.waiting || !navigator.serviceWorker.controller) return;
      // 不自動換版，只通知；換不換由使用者自己按
      if (bar) bar.hidden = false;
    };

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading || !(applied || hadController)) return;
      reloading = true;
      location.reload();
    });

    if (btn) btn.addEventListener("click", apply);

    offer();
    reg.addEventListener("updatefound", () => {
      const fresh = reg.installing;
      if (!fresh) return;
      fresh.addEventListener("statechange", () => {
        if (fresh.state === "installed") offer();
      });
    });

    // 開起來時、每次從背景切回來時都去問一次有沒有新版，最多一分鐘一次
    let checkedAt = 0;
    const check = () => {
      const now = Date.now();
      if (now - checkedAt < 60000) return;
      checkedAt = now;
      reg.update().catch(() => { /* 離線就算了 */ });
    };
    const manual = $("checkUpdateBtn");
    if (manual) {
      manual.addEventListener("click", async () => {
        manual.disabled = true;
        manual.textContent = "檢查中…";
        checkedAt = 0;
        store(APK_SEEN, "0");
        try { await reg.update(); } catch { /* 離線就算了 */ }
        await checkAppUpdate();
        // 換版的通知要一點時間才冒出來，等一下再看結論
        setTimeout(() => {
          const pending = (bar && !bar.hidden) || !$("appUpdateBar").hidden;
          manual.textContent = pending ? "有新版" : "已經是最新";
          setTimeout(() => { manual.textContent = "檢查更新"; manual.disabled = false; }, 2500);
        }, 1200);
      });
    }

    check();
    checkAppUpdate();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
    window.addEventListener("focus", check);
    // App 一直開著沒關也要會更新，所以固定每五分鐘問一次
    setInterval(() => { if (!document.hidden) check(); }, 5 * 60 * 1000);
  });
}
