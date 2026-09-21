// 大便龍的萬能軟體 — Android App 裡跑的網頁
// 直接在瀏覽器裡呼叫 Google Gemini API，金鑰存在使用者自己的瀏覽器。

/* 依序試：先用便宜、額度寬的 lite，不行再換一般的 flash。
   兩個都失敗才算失敗。使用者不用選，也不會知道用的是哪一個。 */
const MODEL_CHAIN = ["gemini-flash-lite-latest", "gemini-flash-latest"];
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const KEY_STORE = "carid.apikey";

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
$("prefsBtn").addEventListener("click", () => {
  const open = prefsSheetEl.hidden;
  prefsSheetEl.hidden = !open;
  $("prefsBtn").setAttribute("aria-expanded", open ? "true" : "false");
});

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

/* 網頁內容的版號，跟 sw.js 的 CACHE 一起加 */
const WEB_BUILD = 21;

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

/* ================= 金鑰 ================= */

let apiKey = load(KEY_STORE) || "";

function paintKeyState() {
  const el = $("keyState");
  const row = $("keyRow");
  if (apiKey) {
    el.textContent = "已設定 …" + apiKey.slice(-4);
    el.classList.add("set");
    // 設好之後就用不到了，整列收起來；金鑰有問題時會自己冒出來
    if (row) row.hidden = true;
  } else {
    el.textContent = "尚未設定";
    el.classList.remove("set");
    if (row) row.hidden = false;
  }
}

$("keyForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("keyInput").value.trim();
  if (!v) return;
  apiKey = v;
  store(KEY_STORE, v);
  $("keyInput").value = "";
  paintKeyState();
  showScreen("capture");
});

$("keyEdit").addEventListener("click", () => {
  prefsSheetEl.hidden = true;
  $("prefsBtn").setAttribute("aria-expanded", "false");
  showScreen("key");
});

$("keyClear").addEventListener("click", () => {
  apiKey = "";
  store(KEY_STORE, null);
  paintKeyState();
  showScreen("key");
});

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
const fileMeta = $("filemeta");
const screenKey = $("screenKey");
const screenCapture = $("screenCapture");
const screenResult = $("screenResult");
const resultBody = $("resultBody");
const resultNotes = $("resultNotes");
const stateTag = $("stateTag");
const thumb = $("thumb");
const actionbar = $("actionbar");

let currentBlob = null;
let previewUrl = null;
let controller = null;
let busy = false;
let screen = "capture";

const hasCamera = window.matchMedia?.("(pointer: coarse)").matches ?? false;
if (hasCamera) pickBtn.textContent = "相簿";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

function setTag(text, live) {
  stateTag.textContent = text;
  stateTag.className = "tag" + (live ? " live" : "");
}

const kb = (n) => (n < 1024 * 1024 ? Math.round(n / 1024) + " KB" : (n / 1024 / 1024).toFixed(1) + " MB");

function showScreen(name) {
  screen = name;
  screenKey.hidden = name !== "key";
  screenCapture.hidden = name !== "capture";
  screenResult.hidden = name !== "result";
  updateBar();
  window.scrollTo(0, 0);
}

function updateBar() {
  const onResult = screen === "result";
  const onKey = screen === "key";
  camBtn.hidden = busy || onResult || onKey || !hasCamera;
  pickBtn.hidden = busy || onResult || onKey;
  goBtn.hidden = busy || onResult || onKey || !currentBlob;
  stopBtn.hidden = !busy;
  redoBtn.hidden = busy || !onResult;
  againBtn.hidden = busy || !onResult;
  actionbar.classList.toggle("is-empty", onKey && !busy);
}

/* ---------- 選擇照片 ---------- */

function showPhoto(blob, name) {
  currentBlob = blob;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);

  let img = drop.querySelector("img");
  if (!img) {
    img = document.createElement("img");
    img.alt = "已選擇的汽車照片";
    drop.appendChild(img);
  }
  // 預覽框的長寬跟著照片走，橫的就是橫的，直的就是直的，不要硬裁成 3:4
  img.onload = () => {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return;
    // 太極端的全景或長截圖還是夾住，不然版面會被拉爆
    const ratio = Math.min(2.2, Math.max(0.5, w / h));
    drop.style.aspectRatio = String(ratio);
  };
  img.src = previewUrl;
  thumb.src = previewUrl;
  dropInner.hidden = true;

  fileMeta.hidden = false;
  fileMeta.textContent = (name || "photo") + " · " + kb(blob.size);
  updateBar();
}

function acceptFile(f) {
  if (!f) return;
  if (!/^image\//.test(f.type)) {
    showScreen("result");
    renderError("這個檔案不是圖片。請選 JPG、PNG 或 WebP 格式的照片。");
    return;
  }
  if (screen !== "capture") showScreen("capture");
  showPhoto(f, f.name);
}

camBtn.addEventListener("click", () => camInput.click());
pickBtn.addEventListener("click", () => fileInput.click());
againBtn.addEventListener("click", () => {
  showScreen("capture");
  (hasCamera ? camInput : fileInput).click();
});
drop.addEventListener("click", () => (hasCamera ? camInput : fileInput).click());
drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener("change", () => acceptFile(fileInput.files?.[0]));
camInput.addEventListener("change", () => acceptFile(camInput.files?.[0]));

for (const ev of ["dragenter", "dragover"]) {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); });
}
for (const ev of ["dragleave", "drop"]) {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("is-over"); });
}
drop.addEventListener("drop", (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) acceptFile(f);
});
document.addEventListener("paste", (e) => {
  const f = e.clipboardData?.files?.[0];
  if (f) acceptFile(f);
});

/* ---------- 照片轉成 API 要的 base64 ---------- */

async function toBase64Jpeg(blob) {
  const max = 1600;
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
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
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

function renderError(msg, detail, keyProblem, status, title) {
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
    (keyProblem ? '<p class="fail-actions"><button type="button" id="keyFix" class="small">重新輸入金鑰</button></p>' : "") +
    '</div>';
  resultNotes.innerHTML = "";

  if (keyProblem) {
    // 金鑰出問題時才讓設定裡的金鑰那一列重新出現
    const row = $("keyRow");
    if (row) row.hidden = false;
    $("keyFix")?.addEventListener("click", () => showScreen("key"));
  }
}

/* 連不到的時候多做兩個小測試，直接把結論寫在畫面上，
   不然「Failed to fetch」看不出是手機沒網路還是被瀏覽器擋下來 */
async function diagnose() {
  const bits = [navigator.onLine ? "系統：有網路" : "系統：沒網路"];
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", { method: "GET" });
    bits.push("連得到 Google（HTTP " + res.status + "）→ 問題出在送照片那一次的請求");
  } catch (e) {
    bits.push("連不到 Google：" + (e?.message || "不明原因"));
  }
  return bits.join("　·　");
}

function messageFor(err) {
  const status = err?.status;
  if (err?.name === "AbortError") return null;
  if (status === 401 || status === 403) return "金鑰不對或沒有權限。到設定裡換一把金鑰再試一次。";
  if (status === 429) return "不是網路的問題，照片也沒事。明天額度會重來，或是去 Google 把方案升上去就能繼續辨。";
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
  if (status === 401 || status === 403) return "金鑰用不了";
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

function renderResult(d) {
  setTag("已辨識", true);
  resultNotes.innerHTML = "";

  if (d && d.is_vehicle === false) {
    resultBody.innerHTML = '<p class="headline">照片裡沒有看到汽車</p>';
    resultNotes.innerHTML = `<p class="note warn">${esc(d.note || "請換一張拍到整台車的照片，側面或四分之三角度最好認。")}</p>`;
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
    '</div></div>';

  resultBody.innerHTML = hero + `<table class="spec"><tbody>${rows}</tbody></table>`;

  let notes = "";
  if (hasEngine) notes += '<p class="caveat">動力規格為該車型年份的常見配置，實際依等級與販售市場而異。</p>';
  if (hasMarket) notes += '<p class="caveat">價格與數量是模型依既有知識的粗估，沒有連接任何行情或掛牌資料庫，請以實際報價與官方統計為準。</p>';
  if (conf < 50) notes += '<p class="note warn">把握程度偏低。換一個角度（車頭或四分之三角度）、離近一點、避免逆光，通常會準很多。</p>';
  resultNotes.innerHTML = notes;

  const fill = resultBody.querySelector(".fill");
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

/* 從 Gemini 回應裡把文字挖出來。實測的回應沒有 output_text，文字在
   steps 裡 type="model_output" 那一段的 content[].text；thought 步驟要跳過。 */
function outputTextOf(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text;

  const chunks = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.type === "text" && typeof node.text === "string") chunks.push(node.text);
    else if (typeof node.text === "string" && !node.type) chunks.push(node.text);
    for (const v of Object.values(node)) if (v && typeof v === "object") walk(v);
  };
  const outs = Array.isArray(payload?.steps) ? payload.steps.filter((s) => s?.type === "model_output") : [];
  walk(outs.length ? outs : (payload?.steps ?? payload));
  return chunks.join("\n");
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

/* 對單一模型送一次請求，失敗就丟出帶 status 的錯誤 */
async function askModel(model, data, effort) {
  const body = {
    model,
    input: [
      { type: "text", text: PROMPT },
      { type: "image", data, mime_type: "image/jpeg" },
    ],
  };
  // 深入模式才特別要求多想；標準模式用模型自己的預設值，
  // 免得某些模型不收 thinking_level 直接回 400
  if (effort === "deep") body.generation_config = { thinking_level: "high" };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch { /* 沒有 JSON 就算了 */ }
    const err = new Error(detail || res.statusText);
    err.status = res.status;
    err.detail = detail;           // Google 的原文，錯誤畫面要顯示出來才查得到原因
    throw err;
  }
  return res.json();
}

/* 依序試 MODEL_CHAIN 裡的模型，全部失敗才把最後一個錯誤丟出去 */
async function askModels(data, effort) {
  let last;
  for (const model of MODEL_CHAIN) {
    try {
      return await askModel(model, data, effort);
    } catch (err) {
      if (err?.name === "AbortError") throw err;   // 使用者自己按停止
      last = err;
    }
  }
  throw last;
}

async function run() {
  if (busy || !currentBlob) return;

  if (!apiKey) { showScreen("key"); return; }

  showScreen("result");
  controller = new AbortController();
  setBusy(true);
  renderThinking("正在看這張照片…");

  try {
    const data = await toBase64Jpeg(currentBlob);
    const effort = document.querySelector('input[name="tier"]:checked').value;

    const label = $("thinkLabel");
    if (label) label.textContent = "正在判讀…";

    const payload = await askModels(data, effort);
    const text = outputTextOf(payload);
    const parsed = parseJson(text);
    if (!parsed) {
      renderError("回來的結果格式不對，再辨識一次通常就好了。");
    } else {
      renderResult(parsed);
    }
  } catch (err) {
    const msg = messageFor(err);
    if (msg === null) {
      setTag("已停止", false);
      resultBody.innerHTML = '<p class="headline">已停止</p>';
      resultNotes.innerHTML = '<p class="caveat">按「再辨識一次」可以重來。</p>';
    } else {
      const keyProblem = err?.status === 401 || err?.status === 403;
      const detail = err?.status ? (err.detail || err.message || "") : (err?.message || "");
      renderError(msg, detail, keyProblem, err?.status, titleFor(err));
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

/* ================= 啟動 ================= */

paintKeyState();
paintVersion();
showScreen(apiKey ? "capture" : "key");

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
