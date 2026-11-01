/* 行車錄影：開後鏡頭錄影，同時把時速、路線小地圖、速度曲線、距離／平均／最快、日期時間畫在影片上一起錄進去。
   做法：相機畫面 + 疊上去的資訊，每一格都畫在一張 canvas 上，再用 MediaRecorder 錄這張 canvas。
   在 App 裡（外殼有 CaridApp.videoBegin）：每秒把錄好的一段丟給外殼，直接寫進相簿（Movies/大便龍行車）。
   在瀏覽器裡：錄完給一個下載連結。
   trip.js 按「錄影＋記錄」時才載入這個檔（import("./tripcam.js")），用 openCam(api) 打開。 */

const OPT_KEY = "carid.cam.opts";
const DEF_OPTS = { speed: true, map: true, curve: true, stats: true, clock: true, audio: false, q: "1080" };
const ACC = "#FF6A1F";
const FONT = '"Barlow Condensed", "Noto Sans TC", sans-serif';
const TC = '"Noto Sans TC", "Barlow Condensed", sans-serif';

function loadOpts() {
  try { return { ...DEF_OPTS, ...(JSON.parse(localStorage.getItem(OPT_KEY) || "{}") || {}) }; } catch { return { ...DEF_OPTS }; }
}
function saveOpts(o) { try { localStorage.setItem(OPT_KEY, JSON.stringify(o)); } catch { /* 存不住就算了 */ } }

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const mmss = (ms) => { const s = Math.floor(ms / 1000); return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

const IC = {
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 3 8l9 4.5L21 8z"/><path d="M3 12.5 12 17l9-4.5"/><path d="M3 16.5 12 21l9-4.5"/></svg>',
  flip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9a8 8 0 0 1 14.5-3.5L20 7"/><path d="M20 3v4h-4"/><path d="M20 15a8 8 0 0 1-14.5 3.5L4 17"/><path d="M4 21v-4h4"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.8v14.4a1 1 0 0 0 1.5.9l11.5-7.2a1 1 0 0 0 0-1.8L8.5 3.9A1 1 0 0 0 7 4.8z"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
};

let cam = null;   // 打開中的錄影畫面（同時只有一個）

export function camOpen() { return !!cam; }

/* ================= 打開 ================= */

export async function openCam(api) {
  if (cam) return;
  const opts = loadOpts();
  const land = innerWidth > innerHeight;
  const long = opts.q === "720" ? 1280 : 1920, short = opts.q === "720" ? 720 : 1080;
  const W = land ? long : short, H = land ? short : long;

  const el = document.createElement("div");
  el.className = "tcam";
  el.id = "tripCam";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "行車錄影");
  el.innerHTML = `
<div class="tcam-stage"><canvas width="${W}" height="${H}" aria-label="錄影畫面"></canvas><video playsinline muted autoplay></video></div>
<div class="tcam-bar">
  <div class="tcam-side"><button type="button" class="tcam-b" data-act="opts" aria-label="影片上要放什麼">${IC.layers}</button><span>放什麼</span></div>
  <button type="button" class="tcam-stop" data-act="stop" aria-label="停止錄影"><span></span></button>
  <div class="tcam-side"><button type="button" class="tcam-b" data-act="flip" aria-label="換鏡頭">${IC.flip}</button><span>換鏡頭</span></div>
</div>
<div class="tcam-msg" hidden><p></p><div class="btnrow"></div></div>
<div class="sharewrap tcam-sheet" data-sheet="opts" hidden><div class="sharedim" data-act="optsClose"></div><div class="sharesheet" role="dialog" aria-modal="true" aria-label="影片上要放什麼"></div></div>
<div class="sharewrap tcam-sheet" data-sheet="saved" hidden><div class="sharedim" data-act="savedClose"></div><div class="sharesheet" role="dialog" aria-modal="true" aria-label="影片存好了"></div></div>`;
  document.body.appendChild(el);
  document.body.classList.add("tcamopen");
  document.documentElement.classList.add("tcamopen");
  // 錄影畫面不能滑：除了「放什麼」那張可以上下捲，其他地方的拖動都擋掉
  el.addEventListener("touchmove", (e) => { if (!e.target.closest(".sharesheet")) e.preventDefault(); }, { passive: false });
  el.addEventListener("wheel", (e) => { if (!e.target.closest(".sharesheet")) e.preventDefault(); }, { passive: false });

  const canvas = el.querySelector("canvas");
  const video = el.querySelector("video");
  cam = {
    api, el, canvas, video, ctx: canvas.getContext("2d"), W, H, land, opts,
    facing: "environment", stream: null, mic: null, rec: null, mime: "", chunks: [], bytes: 0, queue: Promise.resolve(),
    startAt: 0, raf: 0, timer: 0, overlay: document.createElement("canvas"), gaugeImg: null, gaugeKey: "", stopping: false,
    shell: api.shell(), failed: false, tripId: null, endedTrip: false, parts: [], firstStart: 0, rotP: null, rotT: 0,
  };
  cam.overlay.width = W;
  cam.overlay.height = H;

  try { cam.shell?.keepScreenOn?.(true); } catch { /* 舊外殼沒有 */ }
  try { window.CaridApp?.setFullscreen?.(true); } catch { /* 沒有就算了 */ }

  el.addEventListener("click", onClick);
  document.addEventListener("visibilitychange", onVis);
  addEventListener("resize", onResize);

  const ok = await startCamera();
  if (!ok || !cam) return;
  startDraw();
  startRecording();
}

/* ================= 相機 ================= */

async function startCamera() {
  const c = cam;
  try {
    c.stream?.getTracks().forEach((t) => t.stop());
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: c.facing }, width: { ideal: c.land ? 1920 : 1080 }, height: { ideal: c.land ? 1080 : 1920 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    if (cam !== c) { s.getTracks().forEach((t) => t.stop()); return false; }
    c.stream = s;
    c.video.srcObject = s;
    await c.video.play().catch(() => {});
    return true;
  } catch (e) {
    if (cam !== c) return false;
    const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
    showMsg(denied ? "手機不准這個 App 用相機。到手機設定裡打開「相機」權限再試一次。" : "相機打不開（" + esc(e?.name || "不知道為什麼") + "）。",
      denied && c.shell ? [["去設定", () => { try { window.CaridApp.openLocationSettings(); } catch { /* 算了 */ } }], ["關掉", () => closeCam()]] : [["關掉", () => closeCam()]]);
    c.failed = true;
    return false;
  }
}

async function getMic() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false }, video: false });
    return s;
  } catch { return null; }
}

/* ================= 每一格：相機 + 疊圖 ================= */

function startDraw() {
  const c = cam;
  const frame = () => {
    if (cam !== c) return;
    drawFrame(c);
    c.raf = requestAnimationFrame(frame);
  };
  c.raf = requestAnimationFrame(frame);
  paintOverlay(c);
  c.timer = setInterval(() => { if (cam === c) { paintOverlay(c); syncOptsLabel(c); } }, 500);
  // 時速（指針）一秒更新約 12 次，影片裡的指針才會順順地走
  c.gTimer = setInterval(() => {
    if (cam !== c) return;
    if (c.api.isSvgGauge()) refreshGauge(c);
    else if (c.opts.speed) { const k = speedNow(c); if (k !== c.lastK) { c.lastK = k; paintOverlay(c); } }
  }, 80);
  refreshGauge(c);
}

function drawFrame(c) {
  const { ctx, W, H, video } = c;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const vw = video.videoWidth, vh = video.videoHeight;
  if (vw && vh) {
    const s = Math.max(W / vw, H / vh);   // 塞滿（cover），多的裁掉
    const dw = vw * s, dh = vh * s;
    ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  ctx.drawImage(c.overlay, 0, 0);
}

function speedNow(c) {
  const r = c.api.rec;
  const v = c.api.vNow ? c.api.vNow() : (r && !r.paused ? r.vShow : 0);
  return Math.round(v * 3.6);
}

// 選的面板是 SVG 的（圓錶、弧形、科幻…）：把那張 SVG 轉成圖，疊在影片上
function refreshGauge(c) {
  const api = c.api;
  if (!c.opts.speed || !api.isSvgGauge()) { c.gaugeImg = null; c.gaugeKey = ""; return; }
 const r = api.rec, v = api.vNow ? api.vNow() : (r && !r.paused ? r.vShow : 0);
  const key = api.gauge + "|" + (v * 3.6).toFixed(1) + "|" + Math.round((r?.maxV || 0) * 3.6) + "|" + Math.round((r?.dist || 0) / 100);
  if (key === c.gaugeKey) return;
  c.gaugeKey = key;
  let svg = api.gaugeSvg(v, r);
  const end = svg.indexOf("</svg>");
  if (end < 0) return;
  svg = svg.slice(0, end + 6).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
  svg = svg.replace(/(<svg[^>]*>)/, "$1<style>" + gaugeCss() + "</style>");
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const seq = (c.gSeq = (c.gSeq || 0) + 1);
  // 轉圖要一點時間：比現在顯示的新就換上去（不用等最新那張，不然一直在變的時候會卡住）
  img.onload = () => { URL.revokeObjectURL(url); if (cam === c && seq > (c.gShown || 0)) { c.gShown = seq; c.gaugeImg = img; paintOverlay(c); } };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

// SVG 變成圖之後吃不到網頁的 CSS：把圓錶、弧形會用到的顏色和字型直接寫進去
let gCss = "";
function gaugeCss() {
  if (gCss) return gCss;
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => (cs.getPropertyValue(n).trim() || d);
  const ground = v("--ground", "#0E0F12"), lineMid = v("--line-mid", "#2A2E36"), acc = v("--accent", ACC), inkMid = v("--ink-mid", "#C9CDD3"),
    ink = v("--ink", "#F2F3F5"), faint = v("--ink-faint", "#6E7682"), soft = v("--ink-soft", "#9AA1AC"), line = v("--line", "#23262D"), strong = v("--line-strong", "#3A3F48");
  gCss = `text{font-family:${FONT}}
.dial .face{fill:${ground};fill-opacity:.82;stroke:${lineMid};stroke-width:2}.dial .redarc{fill:none;stroke:${acc};stroke-width:6;opacity:.35}
.dial .tick{fill:none;stroke:${inkMid};stroke-width:2}.dial .tick.hot{stroke:${acc};stroke-width:2.5}
.dial .lab text{fill:${inkMid};font-size:17px;font-weight:600;text-anchor:middle}.dial .lab text.hot{fill:${acc}}
.dial .maxmark{stroke:${ink};stroke-width:2;opacity:.55}.dial .needle{stroke:${faint};stroke-width:5;stroke-linecap:round}.dial .needle.on{stroke:${acc}}
.dial .hub{fill:${lineMid};stroke:${acc};stroke-width:3}.dial .num{fill:${ink};font-size:46px;font-weight:700;text-anchor:middle}
.dial .unit,.arcg .unit{fill:${soft};font-size:13px;font-weight:600;text-anchor:middle;letter-spacing:2px}
.arcg .tick{stroke:${strong};stroke-width:2;stroke-linecap:round}.arcg .track{fill:none;stroke:${line};stroke-width:20;stroke-linecap:round;stroke-opacity:.85}
.arcg .fill{fill:none;stroke:${faint};stroke-width:20;stroke-linecap:round}.arcg .fill.on{stroke:${acc}}.arcg .maxmark{stroke:${ink};stroke-width:3;stroke-linecap:round}
.arcg .lab{fill:${faint};font-size:15px;font-weight:600;text-anchor:middle}.arcg .num{fill:${ink};font-size:120px;font-weight:700;text-anchor:middle;paint-order:stroke;stroke:rgba(0,0,0,.5);stroke-width:4px}
.arcg .unit{font-size:16px;letter-spacing:3px}.arcg .cap{fill:${soft};font-size:13px;text-anchor:middle}
.gx .orb{font-family:Orbitron,${FONT}}.gx .mono,.gx .lab{font-family:"Share Tech Mono",monospace}.gx .osw{font-family:Oswald,${FONT}}
.gx .serif{font-family:Georgia,serif}.gx .bcl{font-weight:300}.gx .bci{font-style:italic;font-weight:800}.gx .script{font-family:"Kaushan Script",cursive}`;
  return gCss;
}

/* ================= 疊在影片上的東西（每半秒畫一次，存在 overlay） ================= */

function paintOverlay(c) {
  const o = c.overlay.getContext("2d");
  const { W, H, opts, api } = c;
  o.clearRect(0, 0, W, H);
  const r = api.rec;
  const land = c.land;
  const u = land ? H / 390 : W / 390;   // 版面照設計稿的大小（直的 390 寬、橫的 390 高）
  const m = 14 * u;
  const shadow = (on) => { o.shadowColor = on ? "rgba(0,0,0,.75)" : "transparent"; o.shadowBlur = on ? 6 * u : 0; o.shadowOffsetY = on ? 1 * u : 0; };

  // 左上：REC 和錄了多久
  const recMs = c.firstStart ? Date.now() - c.firstStart : 0;
  o.font = `700 ${17 * u}px ${FONT}`;
  const recTxt = (c.rec ? "REC " : "") + mmss(recMs);
  const pillW = o.measureText(recTxt).width + 38 * u, pillH = 30 * u;
  shadow(false);
  rr(o, m, m, pillW, pillH, pillH / 2); o.fillStyle = "rgba(0,0,0,.45)"; o.fill();
  o.beginPath(); o.arc(m + 15 * u, m + pillH / 2, 5 * u, 0, Math.PI * 2);
  o.fillStyle = c.rec && Math.floor(recMs / 700) % 2 === 0 ? "#FF3B2F" : "rgba(255,59,47,.45)"; o.fill();
  o.fillStyle = "#fff"; o.textBaseline = "middle"; o.textAlign = "left";
  o.fillText(recTxt, m + 27 * u, m + pillH / 2 + 1 * u);

  if (opts.clock) {
    const d = new Date();
    const t = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    shadow(true);
    o.font = `600 ${14 * u}px ${FONT}`;
    o.fillStyle = "rgba(255,255,255,.92)";
    if (land) o.fillText(t, m + pillW + 10 * u, m + pillH / 2 + 1 * u);
    else o.fillText(t, m, m + pillH + 16 * u);
  }

  // 右上：路線小地圖
  if (opts.map) {
    const s = (land ? 120 : 112) * u;
    drawMiniMap(o, W - m - s, m, s, u, r);
  }

  // 下面：時速、數字、曲線
  const speed = speedNow(c);
  const avg = r ? api.avgV(r) : 0;
  const stats = [[api.km(r ? r.dist : 0), "km 距離"], [avg ? api.kmh1(avg) : "0", "平均"], [String(api.kmh(r ? r.maxV : 0)), "最快"]];
  shadow(true);
  if (!land) {
    let bottom = H - m;
    o.font = `500 ${10 * u}px ${TC}`; o.textAlign = "right"; o.textBaseline = "alphabetic"; o.fillStyle = "rgba(255,255,255,.75)";
    o.fillText("大便龍的萬能軟體・行車紀錄", W - m, bottom);
    bottom -= 16 * u;
    if (opts.curve) {
      const ch = 42 * u;
      shadow(false);
      drawCurve(o, m, bottom - ch, W - 2 * m, ch, u, r, api);
      bottom -= ch + 10 * u;
      shadow(true);
    }
    if (opts.stats) {
      o.textAlign = "right"; o.textBaseline = "alphabetic";
      let y = bottom - 6 * u;
      for (let i = stats.length - 1; i >= 0; i--) {
        const [v, k] = stats[i];
        o.font = `500 ${12 * u}px ${TC}`; o.fillStyle = "#fff";
        const kw = o.measureText(" " + k).width;
        o.fillText(" " + k, W - m, y);
        o.font = `700 ${20 * u}px ${FONT}`;
        o.fillText(v, W - m - kw, y);
        y -= 26 * u;
      }
    }
    if (opts.speed) drawSpeed(o, c, m, bottom, u, speed, false);
  } else {
    if (opts.speed) drawSpeed(o, c, m, H - m, u, speed, true);
    const left = m + 266 * u;
    let bottom = H - m;
    if (opts.curve) {
      const ch = 38 * u;
      shadow(false);
      drawCurve(o, left, bottom - ch, W - m - left, ch, u, r, api);
      bottom -= ch + 8 * u;
      shadow(true);
    }
    if (opts.stats) {
      o.textAlign = "left"; o.textBaseline = "alphabetic";
      let x = left;
      for (const [v, k] of stats) {
        o.font = `700 ${22 * u}px ${FONT}`; o.fillStyle = "#fff";
        o.fillText(v, x, bottom - 4 * u);
        x += o.measureText(v).width;
        o.font = `500 ${12 * u}px ${TC}`;
        o.fillText(" " + k, x, bottom - 4 * u);
        x += o.measureText(" " + k).width + 18 * u;
      }
    }
    o.font = `500 ${10 * u}px ${TC}`; o.textAlign = "right"; o.fillStyle = "rgba(255,255,255,.75)";
    o.fillText("大便龍的萬能軟體・行車紀錄", W - m, (opts.map ? m + 120 * u + 16 * u : m + 10 * u));
  }
  shadow(false);
}

// 時速：SVG 面板用轉好的圖；數字、賽車、簡潔直接畫
function drawSpeed(o, c, x, bottom, u, speed, land) {
  const api = c.api;
  if (api.isSvgGauge()) {
    const img = c.gaugeImg;
    if (!img || !img.naturalWidth) return;
    const h = (land ? 200 : 210) * u;
    const w = h * img.naturalWidth / img.naturalHeight;
    o.shadowColor = "transparent";
    o.drawImage(img, x - (land ? 0 : 4 * u), bottom - h, w, h);
    return;
  }
  const race = api.gauge === "race";
  if (race) {
    const bw = (land ? 250 : 230) * u, bh = (land ? 128 : 136) * u;
    o.shadowColor = "transparent";
    rr(o, x, bottom - bh, bw, bh, 14 * u); o.fillStyle = "rgba(0,0,0,.42)"; o.fill();
    const M = api.mode(), n = 20, lit = Math.round(n * Math.min(1, speed / M.max));
    const gw = (bw - 24 * u - 19 * 2 * u) / n;
    for (let i = 0; i < n; i++) {
      const col = i < 8 ? "#6FCF8E" : i < 11 ? "#E0B341" : i < 15 ? ACC : "#FF4D3D";
      rr(o, x + 12 * u + i * (gw + 2 * u), bottom - bh + 10 * u, gw, 12 * u, 2 * u);
      o.fillStyle = i < lit ? col : "rgba(255,255,255,.18)"; o.fill();
    }
    o.textBaseline = "alphabetic"; o.textAlign = "left";
    o.font = `italic 800 ${92 * u}px ${FONT}`; o.fillStyle = "#fff";
    o.fillText(String(speed), x + 12 * u, bottom - 14 * u);
    const nw = o.measureText(String(speed)).width;
    o.font = `italic 700 ${18 * u}px ${FONT}`; o.fillStyle = ACC;
    o.fillText("KM/H", x + 20 * u + nw, bottom - 20 * u);
    return;
  }
  const size = (land ? 104 : 118) * u;
  o.textBaseline = "alphabetic"; o.textAlign = "left";
  o.font = `700 ${size}px ${FONT}`; o.fillStyle = "#fff";
  o.fillText(String(speed), x, bottom - 6 * u);
  const nw = o.measureText(String(speed)).width;
  o.font = `700 ${20 * u}px ${FONT}`; o.fillStyle = ACC;
  o.fillText("KM/H", x + nw + 10 * u, bottom - 12 * u);
}

function drawMiniMap(o, x, y, s, u, r) {
  o.save();
  rr(o, x, y, s, s, 14 * u);
  o.fillStyle = "rgba(26,29,35,.86)"; o.fill();
  o.lineWidth = 1.5 * u; o.strokeStyle = "rgba(255,255,255,.35)"; o.stroke();
  o.clip();
  o.strokeStyle = "rgba(255,255,255,.06)"; o.lineWidth = 1 * u;
  for (let i = 1; i < 4; i++) { o.beginPath(); o.moveTo(x + s * i / 4, y); o.lineTo(x + s * i / 4, y + s); o.moveTo(x, y + s * i / 4); o.lineTo(x + s, y + s * i / 4); o.stroke(); }
  const pts = r ? r.pts : [];
  if (pts.length) {
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180, vmax = 0.1;
    for (const p of pts) { if (p[1] < minLat) minLat = p[1]; if (p[1] > maxLat) maxLat = p[1]; if (p[2] < minLon) minLon = p[2]; if (p[2] > maxLon) maxLon = p[2]; if (p[3] > vmax) vmax = p[3]; }
    const cos = Math.cos((minLat + maxLat) / 2 * Math.PI / 180);
    const spanX = Math.max((maxLon - minLon) * cos, 0.0004), spanY = Math.max(maxLat - minLat, 0.0004);
    const pad = 14 * u, k = (s - 2 * pad) / Math.max(spanX, spanY);
    const ox = x + (s - spanX * k) / 2, oy = y + (s - spanY * k) / 2;
    const cx = (lon) => ox + (lon - minLon) * cos * k + ((spanX - (maxLon - minLon) * cos) * k) / 2;
    const cy = (lat) => oy + (maxLat - lat) * k + ((spanY - (maxLat - minLat)) * k) / 2;
    o.lineCap = "round"; o.lineJoin = "round"; o.lineWidth = 4 * u;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      o.strokeStyle = speedCol(b[3] / vmax);
      o.beginPath(); o.moveTo(cx(a[2]), cy(a[1])); o.lineTo(cx(b[2]), cy(b[1])); o.stroke();
    }
    const f = pts[0], l = pts[pts.length - 1];
    o.beginPath(); o.arc(cx(f[2]), cy(f[1]), 4 * u, 0, Math.PI * 2); o.fillStyle = "#0E0F12"; o.fill(); o.lineWidth = 2 * u; o.strokeStyle = "#fff"; o.stroke();
    o.beginPath(); o.arc(cx(l[2]), cy(l[1]), 9 * u, 0, Math.PI * 2); o.fillStyle = "rgba(255,106,31,.28)"; o.fill();
    o.beginPath(); o.arc(cx(l[2]), cy(l[1]), 4.5 * u, 0, Math.PI * 2); o.fillStyle = ACC; o.fill(); o.lineWidth = 2 * u; o.strokeStyle = "#fff"; o.stroke();
  } else {
    o.font = `500 ${11 * u}px ${TC}`; o.fillStyle = "rgba(255,255,255,.6)"; o.textAlign = "center"; o.textBaseline = "middle";
    o.fillText("等 GPS…", x + s / 2, y + s / 2);
  }
  o.restore();
}
function speedCol(f) {
  f = Math.max(0, Math.min(1, f));
  const stops = [[76, 154, 255], [224, 179, 65], [255, 106, 31]];
  const i = f < 0.5 ? 0 : 1, t = f < 0.5 ? f * 2 : (f - 0.5) * 2;
  const c = stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function drawCurve(o, x, y, w, h, u, r, api) {
  o.save();
  rr(o, x, y, w, h, 10 * u);
  o.fillStyle = "rgba(0,0,0,.35)"; o.fill();
  o.clip();
  if (r && r.pts.length > 1) {
    const now = r.paused ? r.pausedAt : Date.now();
    const from = Math.max(r.start, now - 10 * 60000), to = Math.max(now, from + 60000);
    const ymax = Math.max(10, r.maxV * 3.6, api.mode().max * 0.3) * 1.1;
    const X = (t) => x + (t - from) / (to - from) * w, Y = (v) => y + h - (v * 3.6) / ymax * (h - 4 * u);
    o.beginPath();
    let started = false, lx = x;
    for (const p of r.pts) {
      if (p[0] < from) continue;
      const px = X(p[0]), py = Y(p[3]);
      if (!started) { o.moveTo(px, y + h); o.lineTo(px, py); started = true; } else o.lineTo(px, py);
      lx = px;
    }
    if (started) {
      o.lineTo(lx, y + h); o.closePath();
      o.fillStyle = "rgba(255,106,31,.25)"; o.fill();
      o.beginPath(); started = false;
      for (const p of r.pts) {
        if (p[0] < from) continue;
        const px = X(p[0]), py = Y(p[3]);
        if (!started) { o.moveTo(px, py); started = true; } else o.lineTo(px, py);
      }
      o.strokeStyle = ACC; o.lineWidth = 2 * u; o.stroke();
    }
  }
  o.restore();
}

function rr(o, x, y, w, h, r) {
  o.beginPath();
  o.moveTo(x + r, y); o.arcTo(x + w, y, x + w, y + h, r); o.arcTo(x + w, y + h, x, y + h, r); o.arcTo(x, y + h, x, y, r); o.arcTo(x, y, x + w, y, r);
  o.closePath();
}

/* ================= 錄影 ================= */

function pickMime() {
  const list = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  for (const t of list) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch { /* 下一個 */ } }
  return "";
}

async function startRecording() {
  const c = cam;
  if (!c || c.rec) return;
  const stream = c.canvas.captureStream(30);
  if (c.opts.audio) {
    c.mic = await getMic();
    if (cam !== c) { c.mic?.getTracks().forEach((t) => t.stop()); return; }
    c.mic?.getAudioTracks().forEach((t) => stream.addTrack(t));
  }
  const mime = pickMime();
  let mr;
  try {
    mr = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: c.opts.q === "720" ? 4_000_000 : 8_000_000 });
  } catch (e) {
    showMsg("這支手機不能錄影（" + esc(e?.name || "錄影功能打不開") + "）。", [["關掉", () => closeCam()]]);
    return;
  }
  c.mime = mr.mimeType || mime || "video/webm";
  c.bytes = 0;
  c.chunks = [];
  c.queue = Promise.resolve();
  if (c.shell) {
    let ok = false;
    try { ok = !!c.shell.videoBegin(c.mime); } catch { ok = false; }
    if (!ok) { showMsg("影片存不進相簿（手機不給寫）。", [["關掉", () => closeCam()]]); return; }
  }
  mr.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    c.bytes += e.data.size;
    if (c.shell) c.queue = c.queue.then(() => sendChunk(c, e.data));
    else c.chunks.push(e.data);
  };
  c.rec = mr;
  c.startAt = Date.now();
  if (!c.firstStart) c.firstStart = c.startAt;
  mr.start(1000);
  paintOverlay(c);
}

function sendChunk(c, blob) {
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || "");
      const b64 = s.slice(s.indexOf(",") + 1);
      let ok = false;
      try { ok = !!c.shell.videoChunk(b64); } catch { ok = false; }
      if (!ok && !c.failed) {
        c.failed = true;
        // 寫不進去（多半是手機空間滿了）：先停下來，已經錄的存起來
        setTimeout(() => stopAll({ reason: "full" }), 0);
      }
      res();
    };
    fr.onerror = () => res();
    fr.readAsDataURL(blob);
  });
}

// 停止錄影；endTrip＝也把行車紀錄結束、存起來（按停止的時候）
async function stopVideo() {
  const c = cam;
  if (!c || !c.rec) return null;
  const mr = c.rec;
  c.rec = null;
  let thumb = "";
  try { thumb = c.canvas.toDataURL("image/jpeg", 0.6); } catch { thumb = ""; }
  const done = new Promise((res) => { mr.onstop = res; });
  try { mr.stop(); } catch { /* 已經停了 */ }
  await Promise.race([done, new Promise((r) => setTimeout(r, 4000))]);
  await c.queue;
  const part = { ms: Date.now() - c.startAt, bytes: c.bytes, start: c.startAt, land: c.land, mime: c.mime, thumb, uri: "", blob: null, blobUrl: "" };
  if (c.shell) {
    try { part.uri = String(c.shell.videoEnd(c.bytes > 0) || ""); } catch { part.uri = ""; }
  } else if (c.chunks.length) {
    part.blob = new Blob(c.chunks, { type: c.mime.split(";")[0] });
    part.blobUrl = URL.createObjectURL(part.blob);
  }
  c.chunks = [];
  c.mic?.getTracks().forEach((t) => t.stop());
  c.mic = null;
  if (part.uri || part.blobUrl) c.parts.push(part);
  return part;
}

/* ================= 轉手機：直的變橫的（或反過來） =================
   一支影片中途不能換成另一個方向（會被拉長或裁掉），所以轉的時候這一段先存起來，
   換成新方向的畫面再接著錄下一段；按停止時一起列出來。 */

function onResize() {
  const c = cam;
  if (!c) return;
  clearTimeout(c.rotT);
  c.rotT = setTimeout(() => { if (cam === c && !c.rotP) c.rotP = relayout(c).finally(() => { c.rotP = null; }); }, 350);
}

async function relayout(c) {
  const land = innerWidth > innerHeight;
  if (land === c.land || c.stopping || c.failed) return;
  const wasRec = !!c.rec;
  if (wasRec) await stopVideo();
  if (cam !== c || c.stopping) return;
  const long = c.opts.q === "720" ? 1280 : 1920, short = c.opts.q === "720" ? 720 : 1080;
  c.land = land;
  c.W = land ? long : short;
  c.H = land ? short : long;
  c.canvas.width = c.overlay.width = c.W;
  c.canvas.height = c.overlay.height = c.H;
  c.gaugeKey = "";
  refreshGauge(c);
  paintOverlay(c);
  drawFrame(c);
  if (wasRec) await startRecording();
}

async function stopAll({ reason } = {}) {
  const c = cam;
  if (!c || c.stopping) return;
  c.stopping = true;
  el$(c, ".tcam-stop").disabled = true;
  clearTimeout(c.rotT);
  if (c.rotP) await c.rotP;
  await stopVideo();
  // 按停止：行車紀錄也一起結束、存起來；螢幕關掉或空間滿了：行車紀錄繼續記
  let trip = null, tripNote = "";
  if (reason === "stop") {
    trip = await c.api.endTrip();
    c.endedTrip = true;
    c.tripId = trip?.id || null;
    tripNote = trip ? "這趟的行車紀錄（路線、速度曲線）也一起存起來了。" : "這趟太短，行車紀錄沒有存（影片有存）。";
  } else {
    tripNote = reason === "full" ? "手機空間不夠，影片先停了，已經錄的有存。行車紀錄還在繼續記。" : "螢幕關掉了，影片先存起來。行車紀錄還在繼續記。";
  }
  stopCamera(c);
  showSaved(c, tripNote);
}

function stopCamera(c) {
  cancelAnimationFrame(c.raf);
  clearInterval(c.timer);
  clearInterval(c.gTimer);
  c.stream?.getTracks().forEach((t) => t.stop());
  c.stream = null;
  try { c.video.srcObject = null; } catch { /* 算了 */ }
}

/* ================= 按鈕、面板 ================= */

function el$(c, sel) { return c.el.querySelector(sel); }

function onClick(e) {
  const c = cam;
  if (!c) return;
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const act = b.dataset.act;
  if (act === "stop") stopAll({ reason: "stop" });
  else if (act === "flip") flip();
  else if (act === "opts") openOpts();
  else if (act === "optsClose") closeSheet("opts");
  else if (act === "savedClose" || act === "done") closeCam();
  else if (act === "toggle") toggleOpt(b.dataset.k);
  else if (act === "q") { c.opts.q = b.dataset.q; saveOpts(c.opts); openOpts(); }
  else if (act === "gauge") c.api.openGaugePick();
  else if (act === "view") { try { c.shell?.videoOpen(c.parts[+b.dataset.i || 0]?.uri || ""); } catch { /* 算了 */ } }
  else if (act === "share") share(+b.dataset.i || 0);
}

async function flip() {
  const c = cam;
  if (!c || c.stopping) return;
  c.facing = c.facing === "environment" ? "user" : "environment";
  await startCamera();
}

function openOpts() {
  const c = cam;
  const o = c.opts;
  const row = (k, name, sub, extra = "") => `<div class="tco-row"><div class="tco-t"><b>${name}</b>${sub ? `<span>${sub}</span>` : ""}</div>${extra}<button type="button" class="tco-sw" role="switch" aria-checked="${!!o[k]}" aria-label="${name}" data-act="toggle" data-k="${k}"><i></i></button></div>`;
  const sheet = c.el.querySelector('[data-sheet="opts"] .sharesheet');
  sheet.innerHTML = `<div class="grab"></div>
<div class="sharehead"><h2>影片上要放什麼</h2><button type="button" class="icon-btn" data-act="optsClose" aria-label="關掉">${IC.x}</button></div>
<div class="tco">
${row("speed", "時速", "用你選的面板", `<button type="button" class="tco-g" data-act="gauge">${esc(c.api.gaugeName())} ▾</button>`)}
${row("map", "路線小地圖", "右上角，越快越橘")}
${row("curve", "速度曲線", "最近 10 分鐘")}
${row("stats", "距離／平均／最快", "")}
${row("clock", "日期、時間", "")}
${row("audio", "錄聲音", "車裡的聲音也錄進去（下一段影片開始）")}
<div class="tco-row"><div class="tco-t"><b>畫質</b><span>下一段影片開始</span></div><div class="tco-q">
<button type="button" data-act="q" data-q="1080" aria-pressed="${o.q !== "720"}">1080p</button><button type="button" data-act="q" data-q="720" aria-pressed="${o.q === "720"}">720p（檔案小）</button></div></div>
</div>
<p class="tco-note">時速、地圖這些改了馬上生效，錄到一半也可以改。設定會記住。</p>`;
  c.el.querySelector('[data-sheet="opts"]').hidden = false;
}
function syncOptsLabel(c) {
  const g = c.el.querySelector(".tco-g");
  if (g) g.textContent = c.api.gaugeName() + " ▾";
}
function toggleOpt(k) {
  const c = cam;
  c.opts[k] = !c.opts[k];
  saveOpts(c.opts);
  const sw = c.el.querySelector(`.tco-sw[data-k="${k}"]`);
  if (sw) sw.setAttribute("aria-checked", String(!!c.opts[k]));
  c.gaugeKey = "";
  refreshGauge(c);
  paintOverlay(c);
}
function closeSheet(name) {
  const s = cam?.el.querySelector(`[data-sheet="${name}"]`);
  if (s) s.hidden = true;
}

function showMsg(text, btns) {
  const c = cam;
  if (!c) return;
  const box = el$(c, ".tcam-msg");
  box.querySelector("p").textContent = text;
  const row = box.querySelector(".btnrow");
  row.innerHTML = "";
  btns.forEach(([t, fn], i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = t;
    if (i === btns.length - 1) b.className = "primary";
    b.addEventListener("click", fn);
    row.appendChild(b);
  });
  box.hidden = false;
}

const fileName = (p) => {
  const d = new Date(p.start);
  return `大便龍行車_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${p.mime.startsWith("video/mp4") ? "mp4" : "webm"}`;
};
const sizeText = (b) => { const mb = b / 1048576; return mb >= 1 ? mb.toFixed(0) + " MB" : Math.max(1, Math.round(mb * 1024)) + " KB"; };
const lenText = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)} 分 ${s % 60} 秒`; };

// 這一段的按鈕：App 裡「分享／在相簿看」，瀏覽器裡「分享／下載」
function partBtns(c, p, i, small) {
  const cls = small ? "small" : "";
  if (c.shell) return `<button type="button" class="${cls}" data-act="share" data-i="${i}">${IC.share}分享</button><button type="button" class="primary ${cls}" data-act="view" data-i="${i}">${IC.play}${small ? "看" : "在相簿看"}</button>`;
  return `${navigator.canShare ? `<button type="button" class="${cls}" data-act="share" data-i="${i}">${IC.share}分享</button>` : ""}<a class="btnlike primary ${cls}" href="${p.blobUrl}" download="${fileName(p)}">${IC.down}下載</a>`;
}

function showSaved(c, tripNote) {
  const sheet = c.el.querySelector('[data-sheet="saved"] .sharesheet');
  const M = c.api.mode();
  const parts = c.parts;
  const n = parts.length;
  const d = new Date(c.firstStart || Date.now());
  const ms = parts.reduce((a, p) => a + p.ms, 0), bytes = parts.reduce((a, p) => a + p.bytes, 0);
  const last = parts[n - 1];
  const where = c.shell ? "存在 相簿 › Movies › 大便龍行車" : "還沒下載，按下面「下載」";
  let body;
  if (!n) body = `<p class="tco-note">影片太短或存不進去，這次沒有存到。</p><div class="btnrow tcs-btns"><button type="button" class="primary" data-act="done">好</button></div>`;
  else {
    const list = n > 1 ? `<p class="tco-note">中途轉了手機，所以分成 ${n} 段（每段一個方向）。</p><div class="tcs-list">${parts.map((p, i) => `<div class="tcs-row"><div class="tcs-rt"><b>第 ${i + 1} 段・${p.land ? "橫的" : "直的"}</b><span>${lenText(p.ms)}・${sizeText(p.bytes)}</span></div><div class="tcs-rb">${partBtns(c, p, i, true)}</div></div>`).join("")}</div>` : "";
    body = `<div class="tcs">
  <div class="tcs-thumb${last.land ? " land" : ""}">${last.thumb ? `<img src="${last.thumb}" alt="">` : ""}<span>${IC.play}</span></div>
  <div class="tcs-info"><b>今天 ${pad(d.getHours())}:${pad(d.getMinutes())} ${esc(M.name)}</b>
    <div>長度 <em>${lenText(ms)}</em></div>
    <div>大小 <em>${sizeText(bytes)}</em>（${c.opts.q === "720" ? "720p" : "1080p"}）</div>
    <div>${where}</div></div>
</div>${list}
${n === 1 ? `<div class="btnrow tcs-btns">${partBtns(c, last, 0, false)}</div>` : ""}`;
  }
  sheet.innerHTML = `<div class="grab"></div>
<div class="sharehead"><h2>${n ? "影片存好了" : "影片沒存到"}</h2><button type="button" class="icon-btn" data-act="savedClose" aria-label="關掉">${IC.x}</button></div>
${body}
<p class="tco-note tcs-note">${esc(tripNote)}</p>`;
  c.el.querySelector('[data-sheet="saved"]').hidden = false;
}

async function share(i) {
  const c = cam;
  const p = c?.parts[i];
  if (!p) return;
  if (c.shell) { try { c.shell.videoShare(p.uri); } catch { /* 算了 */ } return; }
  if (!p.blob) return;
  const f = new File([p.blob], fileName(p), { type: p.blob.type });
  try { if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f] }); } catch { /* 取消就算了 */ }
}

/* ================= 螢幕關掉 / 關掉錄影 ================= */

function onVis() {
  const c = cam;
  if (!c) return;
  if (document.visibilityState === "hidden" && c.rec && !c.stopping) stopAll({ reason: "hidden" });
}

export function closeCam() {
  const c = cam;
  if (!c) return;
  if (c.rec) { stopAll({ reason: "stop" }); return; }
  stopCamera(c);
  cam = null;
  document.removeEventListener("visibilitychange", onVis);
  removeEventListener("resize", onResize);
  clearTimeout(c.rotT);
  try { c.shell?.keepScreenOn?.(false); } catch { /* 算了 */ }
  try { window.CaridApp?.setFullscreen?.(false); } catch { /* 算了 */ }
  c.parts.forEach((p) => { if (p.blobUrl) setTimeout(() => URL.revokeObjectURL(p.blobUrl), 60000); });
  c.el.remove();
  document.body.classList.remove("tcamopen");
  document.documentElement.classList.remove("tcamopen");
  c.api.closed?.(c.tripId);
}
