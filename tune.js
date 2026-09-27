// 大便龍的萬能軟體 — 改車（3D 車庫＋400 公尺直線加速）
// 這個檔是產生出來的，不要直接改：原始碼和指令在專案檔案 tune-game/supra3d/（build-app.mjs）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// ---- masks.js ----
// 3D Supra 的表面細節：從側面、正面、後面、上面四個方向「投影」到車身上的貼圖。
// 車窗、黑色飾條、車門縫、車燈、水箱罩、引擎蓋通風口、拉花都畫在這些平面圖上，
// shader 再依照車身每一點的位置去查，所以邊緣很銳利，也不用管網格怎麼切。

// 各視圖的範圍（公尺）
const BOX = {
  side: { x0: -2.35, x1: 2.35, y0: 0, y1: 1.4, w: 2048 },
  front: { x0: -1, x1: 1, y0: 0, y1: 1.3, w: 1024 },   // 從車頭看：x 是 -z（車的右邊在左手邊）
  rear: { x0: -1, x1: 1, y0: 0, y1: 1.3, w: 1024 },    // 從車尾看：x 是 z
  top: { x0: -2.35, x1: 2.35, y0: -1, y1: 1, w: 2048 },
};
function canvas(b) {
  const c = document.createElement('canvas');
  c.width = b.w; c.height = Math.round((b.w * (b.y1 - b.y0)) / (b.x1 - b.x0));
  const g = c.getContext('2d');
  const k = c.width / (b.x1 - b.x0);
  g.setTransform(k, 0, 0, -k, -b.x0 * k, b.y1 * k); // 用公尺畫，y 往上
  return { c, g, k };
}
// 四張黑白圖合成一張 RGBA 貼圖（每個通道是一種材質的遮罩）
function layers(b, fns) {
  const cs = fns.map((fn) => {
    const { c, g } = canvas(b);
    g.fillStyle = '#000'; g.fillRect(b.x0 - 1, b.y0 - 1, b.x1 - b.x0 + 2, b.y1 - b.y0 + 2);
    g.fillStyle = g.strokeStyle = '#fff';
    if (fn) fn(g);
    return c;
  });
  const w = cs[0].width, h = cs[0].height, out = new Uint8Array(w * h * 4);
  cs.forEach((c, ch) => {
    const d = c.getContext('2d').getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++) {
      const src = y * w * 4, dst = (h - 1 - y) * w * 4; // 上下翻過來，讓 v=0 在下面
      for (let x = 0; x < w; x++) out[dst + x * 4 + ch] = d[src + x * 4];
    }
  });
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
const poly = (g, pts) => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]); g.closePath(); };
function smooth(g, pts, closed = true) {
  const n = pts.length; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  const P = (i) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    g.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
  }
  if (closed) g.closePath();
}
const line = (g, pts, w) => { g.lineWidth = w; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); g.stroke(); };
// 在 y 往上的座標裡寫字（字是正的）
function text(g, s, x, y, size, { font = 'Arial Black, Arial, sans-serif', weight = 900, italic = false, mirror = false, align = 'center', skew = 0 } = {}) {
  g.save(); g.translate(x, y); g.scale(mirror ? -1 : 1, -1);
  if (skew) g.transform(1, 0, -skew, 1, 0, 0);
  g.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${font}`; g.textAlign = align; g.textBaseline = 'middle';
  g.fillText(s, 0, 0); g.restore();
}
const mirrorU = (pts) => pts.map(([u, y]) => [-u, y]);

// ---- 側面：R 側窗、G 黑色、B 縫（只用在朝側面的地方，前擋、後擋改看俯視圖）----
// 側窗上緣沿著車艙轉角（法線 |nz|≈0.66 的位置，從車身量出來的）
const LINES = {
  dlo: [[0.58, 0.9635], [0.55, 0.982], [0.5, 1.01], [0.45, 1.036], [0.4, 1.063], [0.35, 1.088], [0.3, 1.112], [0.25, 1.134], [0.2, 1.153],
    [0.15, 1.168], [0.1, 1.18], [0.05, 1.188], [0, 1.193], [-0.1, 1.198], [-0.2, 1.198], [-0.3, 1.197], [-0.4, 1.194], [-0.5, 1.186],
    [-0.6, 1.173], [-0.7, 1.152], [-0.8, 1.125], [-0.9, 1.094], [-1.0, 1.059], [-1.045, 1.036], [-0.92, 1.0]],
  bPillar: [[-0.5575, 1.26], [-0.4775, 1.26], [-0.5175, 0.95], [-0.5975, 0.95]],
  doorFront: [[0.765, 0.94], [0.795, 0.62], [0.795, 0.30], [0.745, 0.17]],
  doorRear: [[-0.4575, 0.99], [-0.4975, 0.62], [-0.5575, 0.36], [-0.6375, 0.17]],
};
function sideTex() {
  const L = LINES;
  return layers(BOX.side, [
    (g) => { smooth(g, L.dlo); g.fill(); }, // 側窗
    (g) => { // 黑色
      poly(g, L.bPillar); g.fill();
      g.lineWidth = 0.02; g.lineJoin = 'round'; smooth(g, L.dlo); g.stroke();    // 窗框
      line(g, [[0.58, 0.956], [-0.92, 0.996]], 0.02);                             // 腰線飾條
      g.beginPath(); g.ellipse(-0.84, 0.43, 0.035, 0.06, 0.2, 0, Math.PI * 2); g.fill(); // 後葉子板前面的進氣口
    },
    (g) => { // 縫
      line(g, L.doorFront, 0.005); line(g, L.doorRear, 0.005);
      line(g, [[-0.62, 0.195], [0.74, 0.19]], 0.004);
      g.beginPath(); g.ellipse(-0.33, 0.885, 0.055, 0.011, 0, 0, Math.PI * 2); g.fill();
      line(g, [[1.62, 0.56], [1.66, 0.42], [1.70, 0.20]], 0.004);
      line(g, [[-1.78, 0.62], [-1.80, 0.45], [-1.84, 0.22]], 0.004);
    },
    null,
  ]);
}

// ---- 正面：R 車燈（鍍鉻反射罩）、G 黑色、B 橘色方向燈、A 暗色細節（燈裡是投射鏡、燈外是網子）----
const HEAD = [[0.33, 0.612], [0.42, 0.655], [0.56, 0.688], [0.70, 0.70], [0.80, 0.688], [0.835, 0.64], [0.80, 0.592], [0.66, 0.570], [0.50, 0.570], [0.39, 0.582]];
const GRILLE = [[-0.50, 0.425], [0.50, 0.425], [0.575, 0.37], [0.52, 0.27], [0.30, 0.245], [-0.30, 0.245], [-0.52, 0.27], [-0.575, 0.37]];
const AMBER = [[0.72, 0.495], [0.845, 0.50], [0.862, 0.462], [0.73, 0.456]];
// 原廠保桿：一個寬的進氣口（橫的格柵）、兩邊方形霧燈
const MOUTH = [[-0.50, 0.322], [0.50, 0.322], [0.535, 0.29], [0.50, 0.203], [-0.50, 0.203], [-0.535, 0.29]];
const FOG = [[0.585, 0.29], [0.755, 0.293], [0.765, 0.262], [0.75, 0.238], [0.59, 0.236], [0.578, 0.262]];
function headDetails(g, s) { // 大燈裡面：燈殼下緣暗一條、兩個反射碗的外圈、投射鏡是淺灰玻璃
  const S = (p) => p.map(([u, y]) => [u * s, y]);
  g.save(); smooth(g, S(HEAD)); g.clip();
  g.fillStyle = 'rgb(200,200,200)'; smooth(g, S([[0.30, 0.55], [0.95, 0.55], [0.95, 0.588], [0.70, 0.584], [0.48, 0.585], [0.30, 0.595]])); g.fill();
  g.strokeStyle = 'rgb(170,170,170)'; g.lineWidth = 0.007;
  for (const [u, y, r] of [[0.51, 0.628, 0.044], [0.675, 0.64, 0.05]]) { g.beginPath(); g.arc(u * s, y, r, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = 'rgb(95,95,95)';
  for (const [u, y, r] of [[0.51, 0.628, 0.023], [0.675, 0.64, 0.027]]) { g.beginPath(); g.arc(u * s, y, r, 0, Math.PI * 2); g.fill(); }
  g.restore();
  g.fillStyle = g.strokeStyle = '#fff';
}
function frontTex(kit = 'bomex') {
  if (kit === 'stock') return layers(BOX.front, [
    (g) => { for (const s of [1, -1]) { smooth(g, HEAD.map(([u, y]) => [u * s, y])); g.fill(); smooth(g, FOG.map(([u, y]) => [u * s, y])); g.fill(); } },
    (g) => {
      smooth(g, MOUTH); g.fill();
      for (const s of [1, -1]) {
        g.lineWidth = 0.005; smooth(g, HEAD.map(([u, y]) => [u * s, y])); g.stroke();
        g.lineWidth = 0.008; smooth(g, FOG.map(([u, y]) => [u * s, y])); g.stroke();
      }
    },
    (g) => { for (const s of [1, -1]) { smooth(g, AMBER.map(([u, y]) => [u * s, y])); g.fill(); } },
    (g) => {
      for (const s of [1, -1]) {
        headDetails(g, s);
        g.save(); smooth(g, FOG.map(([u, y]) => [u * s, y])); g.clip(); g.fillStyle = 'rgb(120,120,120)';
        g.fillRect(0.60 * s - 0.05, 0.245, 0.10, 0.04); g.restore(); g.fillStyle = '#fff';
      }
      g.save(); smooth(g, MOUTH); g.clip(); // 橫的格柵
      for (let y = 0.212; y < 0.32; y += 0.021) line(g, [[-0.6, y], [0.6, y]], 0.007);
      for (let u = -0.45; u <= 0.46; u += 0.15) line(g, [[u, 0.2], [u, 0.33]], 0.006);
      g.restore();
    },
  ]);
  return layers(BOX.front, [
    (g) => { // 車燈
      for (const s of [1, -1]) {
        smooth(g, HEAD.map(([u, y]) => [u * s, y])); g.fill();
        g.beginPath(); g.arc(0.60 * s, 0.345, 0.042, 0, Math.PI * 2); g.fill(); // 霧燈
      }
    },
    (g) => { // 黑色
      smooth(g, GRILLE); g.fill();
      for (const s of [1, -1]) {
        g.lineWidth = 0.005; smooth(g, HEAD.map(([u, y]) => [u * s, y])); g.stroke(); // 大燈外框
        const S = (p) => p.map(([u, y]) => [u * s, y]);
        smooth(g, S([[0.755, 0.425], [0.84, 0.425], [0.855, 0.36], [0.835, 0.318], [0.755, 0.322], [0.745, 0.37]])); g.fill(); // 轉角進氣口
        smooth(g, S([[0.44, 0.255], [0.70, 0.262], [0.72, 0.225], [0.66, 0.205], [0.46, 0.205], [0.42, 0.228]])); g.fill(); // 下面的進氣口
        g.lineWidth = 0.014; g.beginPath(); g.arc(0.60 * s, 0.345, 0.05, 0, Math.PI * 2); g.stroke(); // 霧燈框
      }
    },
    (g) => { // 橘色方向燈
      for (const s of [1, -1]) { smooth(g, AMBER.map(([u, y]) => [u * s, y])); g.fill(); }
    },
    (g) => { // 暗色細節
      for (const s of [1, -1]) {
        headDetails(g, s);
        g.beginPath(); g.arc(0.60 * s, 0.345, 0.03, 0, Math.PI * 2); g.fill();
      }
      // 水箱罩的網子（斜的格子）
      g.save(); smooth(g, GRILLE); g.clip();
      g.lineWidth = 0.0035;
      for (let k = -1.2; k < 1.2; k += 0.014) {
        g.beginPath(); g.moveTo(k, 0.2); g.lineTo(k + 0.25, 0.45); g.stroke();
        g.beginPath(); g.moveTo(k, 0.45); g.lineTo(k + 0.25, 0.2); g.stroke();
      }
      g.restore();
    },
  ]);
}

// 正面的貼紙（彩色，可以整組拿掉）
function drawFrontLivery(style = 'ff', kit = 'bomex') {
  const { c, g } = canvas(BOX.front);
  g.clearRect(-2, -1, 4, 3);
  if (style !== 'ff') return c;
  g.fillStyle = g.strokeStyle = '#0d0e0d';
  if (kit === 'stock') { emblem(g); return c; } // 原廠保桿上沒有 NOS、STILLEN 那些，只留車頭的圖騰
  for (const s of [1, -1]) {
    text(g, 'NOS', 0.765 * s, 0.285, 0.034, { italic: true });
    text(g, 'STILLEN', 0.64 * s, 0.155, 0.03, { italic: true, weight: 900 });
  }
  text(g, '12', -0.21, 0.198, 0.125, { italic: true, skew: 0.25 });
  emblem(g);
  return c;
}
function emblem(g) { // 車頭中間的圖騰
  g.lineWidth = 0.006; g.lineCap = 'round';
  for (const [a, b2] of [[[-0.06, 0.50], [0.05, 0.58]], [[-0.03, 0.49], [0.02, 0.59]], [[-0.07, 0.54], [0.07, 0.54]], [[0.0, 0.47], [0.06, 0.56]]]) { g.beginPath(); g.moveTo(...a); g.lineTo(...b2); g.stroke(); }
}

// ---- 後面：R 紅燈、G 黑色、B 白色倒車燈 ----
// 尾燈、車牌位置照 Nick 2026-09-27 傳的紅色 Supra 車尾照片量的（rear3d/hit-supra.mjs）：橢圓燈殼、兩顆圓燈（內側那顆中間是倒車燈）
const TAIL = [[0.17, 0.775], [0.185, 0.808], [0.23, 0.825], [0.40, 0.829], [0.60, 0.826], [0.70, 0.815], [0.745, 0.785], [0.735, 0.745],
  [0.69, 0.727], [0.50, 0.722], [0.30, 0.722], [0.21, 0.73], [0.18, 0.748]];
const TAIL_RINGS = [0.33, 0.56];
function rearTex() {
  return layers(BOX.rear, [
    (g) => { for (const s of [1, -1]) { smooth(g, TAIL.map(([u, y]) => [u * s, y])); g.fill(); } },
    (g) => {
      for (const s of [1, -1]) {
        g.lineWidth = 0.008; smooth(g, TAIL.map(([u, y]) => [u * s, y])); g.stroke();
        g.lineWidth = 0.011; for (const u of TAIL_RINGS) { g.beginPath(); g.arc(u * s, 0.776, 0.046, 0, Math.PI * 2); g.stroke(); }
      }
      g.beginPath(); g.roundRect(-0.18, 0.47, 0.36, 0.145, 0.01); g.fill(); // 車牌
      poly(g, [[-0.75, 0.16], [0.75, 0.16], [0.70, 0.25], [-0.70, 0.25]]); g.fill();
    },
    (g) => { for (const s of [1, -1]) { g.beginPath(); g.arc(TAIL_RINGS[0] * s, 0.776, 0.02, 0, Math.PI * 2); g.fill(); } },
    null,
  ]);
}

// ---- 上面：R 通風口、G 黑色（前擋黑邊、雨刷飾板、後擋黑邊）、B 縫、A 前擋和後擋玻璃 ----
// 玻璃外框（含黑邊）＝車艙轉角開始彎的地方（法線 |nz|≈0.2，從車身量出來的），右半邊，畫的時候鏡射
const WS = [[0.80, 0], [0.795, 0.30], [0.78, 0.48], [0.755, 0.56], [0.715, 0.598], [0.65, 0.602], [0.6, 0.595], [0.55, 0.586], [0.5, 0.576],
  [0.45, 0.566], [0.4, 0.554], [0.35, 0.543], [0.3, 0.533], [0.25, 0.524], [0.2, 0.513], [0.172, 0.49], [0.16, 0.35], [0.155, 0]];
const BL = [[-0.66, 0], [-0.662, 0.30], [-0.672, 0.44], [-0.70, 0.50], [-0.8, 0.513], [-0.9, 0.521], [-1.0, 0.527], [-1.1, 0.528],
  [-1.2, 0.524], [-1.3, 0.51], [-1.38, 0.48], [-1.46, 0.40], [-1.51, 0.25], [-1.53, 0]];
const COWL = [[0.848, 0], [0.843, 0.30], [0.828, 0.46], [0.80, 0.54], [0.765, 0.575], [0.745, 0.57], [0.77, 0.535], [0.785, 0.46], [0.795, 0.30], [0.797, 0]];
const both = (h) => [...h, ...h.slice(1, -1).reverse().map(([x, z]) => [x, -z])];
// 玻璃周圍的黑邊：側邊 side 寬，前後兩端另外加寬
function frit(g, outline, side, [xa, xb], [xc, xd]) {
  g.save(); smooth(g, outline); g.clip();
  g.lineWidth = side * 2; smooth(g, outline); g.stroke();
  g.fillRect(xa, -1, xb - xa, 2); g.fillRect(xc, -1, xd - xc, 2);
  g.restore();
}
function topTex() {
  return layers(BOX.top, [
    (g) => {
      for (const s of [1, -1]) {
        const S = (p) => p.map(([x, z]) => [x, z * s]);
        poly(g, S([[1.80, 0.06], [1.77, 0.36], [1.63, 0.33], [1.67, 0.08]])); g.fill();
        poly(g, S([[1.76, 0.40], [1.72, 0.61], [1.60, 0.585], [1.64, 0.385]])); g.fill();
      }
    },
    (g) => {
      frit(g, both(WS), 0.03, [0.10, 0.205], [0.765, 0.9]);       // 前擋：上緣黑帶寬一點
      frit(g, both(BL), 0.03, [-0.70, -0.6], [-1.6, -1.48]);      // 後擋
      smooth(g, both(COWL)); g.fill();                             // 雨刷飾板
    },
    (g) => {
      line(g, [[0.87, 0.66], [1.40, 0.70], [1.90, 0.66], [2.06, 0.50], [2.10, 0], [2.06, -0.50], [1.90, -0.66], [1.40, -0.70], [0.87, -0.66]], 0.005);
      line(g, [[-1.55, 0.64], [-1.85, 0.66], [-2.08, 0.58], [-2.12, 0], [-2.08, -0.58], [-1.85, -0.66], [-1.55, -0.64]], 0.005);
    },
    (g) => { smooth(g, both(WS)); g.fill(); smooth(g, both(BL)); g.fill(); },
  ]);
}

// ---- 拉花（側面，左右各一張，RGBA 顏色）----
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function drawLivery(side, style = 'ff') {
  const { c, g } = canvas(BOX.side);
  g.clearRect(-3, -1, 6, 3);
  if (style !== 'ff') return c;
  const GREEN = '#8fe13a', GREEN2 = '#5fb52c', INK = '#0d0e0d';
  // 後葉子板的綠色圖騰：很多往前伸的火舌＋碎塊
  const r = rng(7);
  g.save();
  // 限制在後葉子板範圍（車門後緣之後、輪拱上面）
  g.beginPath(); g.moveTo(-0.50, 0.95); g.lineTo(-2.3, 0.95); g.lineTo(-2.3, 0.38); g.lineTo(-1.80, 0.40);
  g.arc(-1.3375, 0.325, 0.40, 0.2, Math.PI - 0.2, false); g.lineTo(-0.60, 0.38); g.closePath(); g.clip();
  for (let i = 0; i < 26; i++) {
    const y = 0.44 + r() * 0.48, x0 = -2.2 + r() * 0.3, len = 0.5 + r() * 0.9, th = 0.02 + r() * 0.05;
    const tip = x0 + len, bend = (r() - 0.5) * 0.12;
    g.fillStyle = r() < 0.8 ? GREEN : GREEN2;
    smooth(g, [[x0, y - th], [x0 + len * 0.5, y + bend - th * 0.6], [tip, y + bend * 1.6], [x0 + len * 0.5, y + bend + th * 0.6], [x0, y + th]]);
    g.fill();
  }
  for (let i = 0; i < 40; i++) { // 碎點
    g.fillStyle = r() < 0.7 ? GREEN : GREEN2;
    const x = -0.6 - r() * 1.6, y = 0.45 + r() * 0.47, s = 0.01 + r() * 0.035;
    g.beginPath(); g.ellipse(x, y, s * (1 + r()), s, r() * 3, 0, Math.PI * 2); g.fill();
  }
  // 橘色的空隙（讓圖騰看起來像噴漆的破碎感）
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 18; i++) {
    const x = -0.7 - r() * 1.5, y = 0.46 + r() * 0.44, s = 0.015 + r() * 0.04;
    g.beginPath(); g.ellipse(x, y, s * 2.2, s * 0.7, (r() - 0.5) * 0.6, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  // 車門上的人物圖
  g.save();
  const fig = side > 0 ? 1 : 1;
  // 綠色速度線（在人物後面）
  g.fillStyle = GREEN;
  for (let i = 0; i < 7; i++) { const y = 0.60 + i * 0.022; poly(g, [[-0.45, y], [0.05 + i * 0.03, y + 0.004], [0.05 + i * 0.03, y + 0.012], [-0.45, y + 0.011]]); g.fill(); }
  // 黑色細線
  g.strokeStyle = INK; line(g, [[0.66, 0.535], [-0.52, 0.545]], 0.008);
  // 渦輪（鍍鉻、有條紋）
  const tx = -0.12, ty = 0.705;
  const gr = g.createLinearGradient(0, ty - 0.09, 0, ty + 0.09); gr.addColorStop(0, '#f4f6f8'); gr.addColorStop(0.5, '#9aa2ab'); gr.addColorStop(1, '#e2e6ea');
  g.fillStyle = INK; smooth(g, [[tx - 0.25, ty - 0.07], [tx + 0.10, ty - 0.10], [tx + 0.26, ty - 0.06], [tx + 0.28, ty + 0.06], [tx + 0.10, ty + 0.11], [tx - 0.24, ty + 0.08]]); g.fill();
  g.fillStyle = gr; smooth(g, [[tx - 0.23, ty - 0.055], [tx + 0.10, ty - 0.085], [tx + 0.24, ty - 0.05], [tx + 0.26, ty + 0.05], [tx + 0.10, ty + 0.095], [tx - 0.22, ty + 0.065]]); g.fill();
  g.strokeStyle = INK; for (let i = -3; i <= 3; i++) line(g, [[tx - 0.20, ty + i * 0.02], [tx + 0.22, ty + i * 0.024]], 0.006);
  // 人：手往前伸、身體在後面（灰色、黑框）
  const body = [[0.62, 0.575], [0.56, 0.60], [0.44, 0.585], [0.30, 0.60], [0.14, 0.64], [0.02, 0.64], [-0.02, 0.60], [0.06, 0.56], [0.20, 0.535], [0.36, 0.545], [0.50, 0.555], [0.60, 0.55]];
  g.fillStyle = INK; smooth(g, body.map(([x, y]) => [x + 0.008, y - 0.008])); g.fill();
  const gb = g.createLinearGradient(0, 0.53, 0, 0.65); gb.addColorStop(0, '#6d747c'); gb.addColorStop(0.5, '#c4c9ce'); gb.addColorStop(1, '#8a9199');
  g.fillStyle = gb; smooth(g, body); g.fill();
  g.strokeStyle = INK; g.lineWidth = 0.006; smooth(g, body); g.stroke();
  g.beginPath(); g.arc(0.15, 0.625, 0.035, 0, Math.PI * 2); g.fillStyle = '#b7bdc3'; g.fill(); g.stroke(); // 頭
  line(g, [[0.46, 0.575], [0.30, 0.575]], 0.004); line(g, [[0.08, 0.60], [0.26, 0.585]], 0.004);
  g.fillStyle = '#e9ecef'; g.beginPath(); g.arc(0.61, 0.565, 0.025, 0, Math.PI * 2); g.fill(); g.stroke(); // 拳頭
  g.restore();
  // 下面一排贊助商貼紙（黑字、斜體）
  g.fillStyle = INK;
  const names = ['NOS', 'SPARCO', 'DAZZ', 'HKS', 'TRD', 'GREDDY'];
  names.forEach((t, i) => text(g, t, 0.55 - i * 0.24, 0.31, 0.036, { italic: true, mirror: side < 0 }));
  return c;
}

// Supra 的外觀：各視圖的貼圖、拉花、套件換哪個車頭，還有 shader 用的位置（前後輪、車頭車尾從哪裡開始、輪拱多大）
const SUPRA_LOOK = {
  side: sideTex, rear: rearTex, top: topTex,
  fronts: { bomex: () => frontTex('bomex'), stock: () => frontTex('stock') },
  livery: (side, style) => drawLivery(side, style), frontLivery: (style, nose) => drawFrontLivery(style, nose),
  nose: (kit) => (kit === 'stock' ? 'stock' : 'bomex'),
  U: { uXr: -1.3375, uXf: 1.2125, uFx: [1.72, 1.80], uRx: [-1.88, -1.96], uWell: [0.325, 0.385, 0.875], uGlassY: 0.9 },
};

// ---- 通用拉花（每台車都能選，車子自己的拉花照舊）：flames 火焰、stripes 賽車條紋、team 大便龍車隊貼紙 ----
// 位置照每台車自己的前後輪軸（uXf、uXr）、輪子半徑＝輪心高度和輪拱半徑（uWell、uWellR）、車窗下緣（uGlassY）算；
// 再看側面投影圖（R 玻璃、G 黑、B 縫）：火焰、條紋、貼紙都在門檻黑色側裙上面，貼紙找一塊沒有黑色、玻璃、縫的地方。正面不畫。
const LIV_GENERIC = [['flames', '火焰'], ['stripes', '賽車條紋'], ['team', '大便龍車隊']];
// 車庫的拉花選項：車子自己的＋通用的（'none' 放最後；名字撞到車子自己的，例如 918 的 stripes，通用的改用 'gen:stripes'）
const livOptions = (own) => {
  const has = new Set(own.map((o) => o[0]));
  return [...own.filter((o) => o[0] !== 'none'), ...LIV_GENERIC.map(([k, l]) => [has.has(k) ? 'gen:' + k : k, l]), ...own.filter((o) => o[0] === 'none')];
};
function genericLivery(look, sideTex) {
  const u = look.U, wf = u.uWell, wr = u.uWellR ?? u.uWell, G = u.uGlassY, b = BOX.side;
  const F = { x: u.uXf, y: wf[0], r: wf[1] + 0.04 }, R = { x: u.uXr, y: wr[0], r: wr[1] + 0.04 }; // r：輪拱外面再留 4 公分
  const xs = F.x - F.r, xe = R.x + R.r, len = xs - xe; // 門那段：前輪拱後緣到後輪拱前緣
  // 側面投影圖：擋住的地方（黑、玻璃、縫）做成累加表，一個方塊裡有沒有東西一次查完；側裙＝最下面那塊黑的上緣
  const img = sideTex && sideTex.image, W = img ? img.width : 0, H = img ? img.height : 0;
  const at = (x, y, ch) => { const i = Math.floor(((x - b.x0) / (b.x1 - b.x0)) * W), j = Math.floor(((y - b.y0) / (b.y1 - b.y0)) * H); return i < 0 || j < 0 || i >= W || j >= H ? 0 : img.data[(j * W + i) * 4 + ch]; };
  let sum = null, skirtY = null;
  const busy = (x0, y0, x1, y1) => {
    if (!W) return 0;
    if (!sum) {
      sum = new Int32Array((W + 1) * (H + 1));
      for (let j = 0; j < H; j++) for (let i = 0, run = 0; i < W; i++) {
        const o = (j * W + i) * 4; run += img.data[o] > 80 || img.data[o + 1] > 80 || img.data[o + 2] > 60 ? 1 : 0;
        sum[(j + 1) * (W + 1) + i + 1] = sum[j * (W + 1) + i + 1] + run;
      }
    }
    const I = (x) => Math.max(0, Math.min(W, Math.round(((x - b.x0) / (b.x1 - b.x0)) * W))), J = (y) => Math.max(0, Math.min(H, Math.round(((y - b.y0) / (b.y1 - b.y0)) * H)));
    const i0 = I(x0), i1 = I(x1), j0 = J(y0), j1 = J(y1), s = (i, j) => sum[j * (W + 1) + i];
    return s(i1, j1) - s(i0, j1) - s(i1, j0) + s(i0, j0);
  };
  const skirt = () => {
    if (skirtY !== null) return skirtY;
    const tops = [];
    for (let x = xe + 0.05; x < xs - 0.05; x += 0.01) { // 每一欄從下往上：第一段黑色從 0.2 公尺以下開始才算側裙
      let y = 0.06; while (y < 0.2 && at(x, y, 1) <= 80) y += 0.005;
      if (y >= 0.2) { tops.push(0); continue; }
      while (y < F.y + 0.1 && at(x, y, 1) > 80) y += 0.005;
      tops.push(y);
    }
    tops.sort((p, q) => p - q);
    return (skirtY = tops.length ? tops[Math.floor(tops.length * 0.9)] : 0);
  };

  // 一圈點畫成平滑的路徑：第三個數字是 1 的點是尖角（火舌尖端、轉角），其他點平滑通過
  function curvy(g, pts) {
    const n = pts.length, s0 = Math.max(0, pts.findIndex((p) => p[2])), P = (i) => pts[(s0 + i) % n];
    g.beginPath(); g.moveTo(P(0)[0], P(0)[1]);
    for (let a = 0; a < n;) {
      let e = a + 1; while (e < n && !P(e)[2]) e++;
      const run = []; for (let i = a; i <= e; i++) run.push(P(i));
      const m = run.length - 1, Q = (i) => run[Math.max(0, Math.min(m, i))];
      for (let i = 0; i < m; i++) {
        const p0 = Q(i - 1), p1 = Q(i), p2 = Q(i + 1), p3 = Q(i + 2);
        g.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
      }
      a = e;
    }
    g.closePath();
  }
  // 火焰：前緣貼著前輪拱後半圈，五條火舌往後舔到門的下半部；黃→橘→紅，外面一圈深色邊
  // 樣板座標：u＝往後（0 前緣～1 最長那條的尖端），v＝往上（0 下緣～1 上緣）；[u, v, 1] 是尖角
  const FLAME = [[0, 1, 1], [0.1, 1], [0.2, 0.99], [0.3, 0.975], [0.4, 0.95], [0.48, 0.92], [0.54, 0.9], [0.6, 0.93, 1],
    [0.56, 0.87], [0.49, 0.845], [0.4, 0.83], [0.32, 0.815], [0.26, 0.8], [0.225, 0.78], [0.215, 0.76], [0.235, 0.74],
    [0.31, 0.735], [0.42, 0.73], [0.54, 0.72], [0.64, 0.7], [0.73, 0.67], [0.8, 0.64], [0.85, 0.63], [0.9, 0.66, 1],
    [0.86, 0.605], [0.79, 0.58], [0.69, 0.56], [0.58, 0.545], [0.47, 0.535], [0.38, 0.525], [0.325, 0.51], [0.31, 0.49], [0.33, 0.47],
    [0.4, 0.465], [0.49, 0.455], [0.57, 0.44], [0.63, 0.42], [0.67, 0.405], [0.72, 0.43, 1],
    [0.68, 0.375], [0.61, 0.35], [0.52, 0.335], [0.43, 0.325], [0.37, 0.315], [0.335, 0.3], [0.325, 0.28], [0.345, 0.262],
    [0.43, 0.258], [0.55, 0.252], [0.67, 0.24], [0.78, 0.22], [0.87, 0.2], [0.93, 0.195], [1, 0.23, 1],
    [0.95, 0.165], [0.87, 0.14], [0.76, 0.128], [0.64, 0.12], [0.54, 0.112], [0.47, 0.105], [0.43, 0.09], [0.425, 0.07], [0.445, 0.055],
    [0.52, 0.052], [0.6, 0.048], [0.67, 0.045], [0.76, 0.072, 1],
    [0.7, 0.015], [0.58, -0.005], [0.4, -0.01], [0.2, -0.005], [0, 0, 1], [0, 0.25], [0, 0.5], [0, 0.75]];
  function flames(g) {
    const yb = Math.max(0.2, 0.9 * F.y, skirt() + 0.03), yt = Math.min(F.y + 0.94 * F.r, G - 0.07), h = yt - yb; // 上緣從輪拱頂端後面一點開始
    const x0 = (y) => F.x - Math.sqrt(Math.max(0, F.r * F.r - (y - F.y) * (y - F.y))); // 輪拱後半圈（前緣貼著它）
    let reach = xs - 0.7 * len; // 最長那條舔到門的 70%，前面有大塊黑的（進氣口）就停在它前面
    for (let x = xs - 0.15; x > reach; x -= 0.01) { let n = 0; for (let v = 0.05; v < 0.85; v += 0.05) n += at(x, yb + v * h, 1) > 80 ? 1 : 0; if (n >= 5) { reach = x + 0.08; break; } }
    const Lm = x0(yb + 0.235 * h) - reach;
    const pts = FLAME.map(([u, v, s]) => { const y = yb + v * h; return [x0(y) - u * Lm, y, s]; });
    g.lineJoin = 'round'; g.lineWidth = 0.024; g.strokeStyle = '#1c0b06'; curvy(g, pts); g.stroke(); // 先描邊再填色：只剩外面一圈深色邊
    const gr = g.createLinearGradient(F.x, 0, reach, 0);
    for (const [k, col] of [[0, '#fff6a8'], [0.14, '#ffe236'], [0.36, '#ffac18'], [0.6, '#ff6512'], [0.84, '#e2300f'], [1, '#c01610']]) gr.addColorStop(k, col);
    g.fillStyle = gr; g.fill();
  }

  // 賽車條紋：兩條平行的深色條紋＋白色細邊，高度在側裙和車窗中間，從車頭到車尾，經過輪拱照輪拱的圓讓開（留白邊）
  // 前後兩頭斜切，停在車頭、車尾轉角前面（輪拱前後各多 22 公分、不超過正面／後面投影開始的地方；不到 12 公分就不畫那段）
  function band(g, y0, hh, grow, col, x0, x1, yc) {
    const X = (x, y) => x + (y - yc) * 0.35;
    g.save(); poly(g, [[X(x0 + grow, y0), y0], [X(x1 - grow, y0), y0], [X(x1 - grow, y0 + hh), y0 + hh], [X(x0 + grow, y0 + hh), y0 + hh]]); g.clip();
    g.beginPath(); g.rect(b.x0 - 1, y0 - 1, b.x1 - b.x0 + 2, hh + 2);
    for (const A of [F, R]) { g.moveTo(A.x + A.r + grow, A.y); g.arc(A.x, A.y, A.r + grow, 0, Math.PI * 2); }
    g.fillStyle = col; g.fill('evenodd'); g.restore();
  }
  function stripes(g) {
    const yc = (Math.max(0.14, skirt()) + G) / 2, w = 0.042, k = 0.007, gap = 0.02;
    const fx = Math.min(F.x + F.r + 0.22, u.uFx[1] + 0.05), rx = Math.max(R.x - R.r - 0.22, u.uRx[1] - 0.05);
    const x1 = fx - (F.x + F.r) < 0.12 ? F.x : fx, x0 = R.x - R.r - rx < 0.12 ? R.x : rx;
    for (const y0 of [yc + gap / 2, yc - gap / 2 - w - 2 * k]) { band(g, y0, w + 2 * k, 0, '#f4f5f6', x0, x1, yc); band(g, y0 + k, w, k, '#16171a', x0, x1, yc); }
  }

  // 車隊貼紙：「大便龍 RACING」粗斜體，深色斜牌子＋白邊；兩邊的字都是正的（左邊整塊左右翻過來畫）
  const FONT = '"Arial Black", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC", sans-serif';
  function spot(w, h) { // 門的下半部找一塊乾淨的地方（沒有黑色、玻璃、縫，也不碰輪拱），越低越好、越靠門中間越好
    const y0 = Math.max(0.2, 0.95 * F.y, skirt() + 0.02), m = 0.015, cx = (xs + xe) / 2;
    for (let y = y0 + h / 2; y + h / 2 < G - 0.08; y += 0.01) {
      for (let k = 0; k <= 80; k++) {
        const x = cx + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.02;
        if (x - w / 2 - m < xe || x + w / 2 + m > xs) continue;
        if (!busy(x - w / 2 - m, y - h / 2 - m, x + w / 2 + m, y + h / 2 + m)) return [x, y];
      }
    }
    return [cx, y0 + h / 2];
  }
  let where = null; // 貼紙位置（兩邊一樣，算一次就記住；累加表用完就丟，手機記憶體比較夠）
  function team(g, sd) {
    const fs = 0.085, sk = 0.22, t1 = '大便龍', t2 = 'RACING';
    g.save(); g.font = `900 100px ${FONT}`;
    const w1 = (g.measureText(t1).width * fs) / 100, w2 = (g.measureText(t2).width * fs) / 100, sp = fs * 0.32, tw = w1 + sp + w2;
    const pw = tw + fs * 0.9, ph = fs * 1.5, key = `${pw.toFixed(4)},${ph.toFixed(4)}`;
    if (!where || where.key !== key) { where = { key, at: spot(pw + ph * sk, ph) }; sum = null; }
    const [cx, cy] = where.at;
    g.translate(cx, cy); g.scale(sd < 0 ? -1 : 1, 1);
    const P = (x, y) => [x + y * sk, y]; // 往前斜的平行四邊形
    poly(g, [P(-pw / 2, -ph / 2), P(pw / 2, -ph / 2), P(pw / 2, ph / 2), P(-pw / 2, ph / 2)]);
    g.fillStyle = '#141518'; g.fill(); g.lineJoin = 'miter'; g.lineWidth = 0.007; g.strokeStyle = '#f4f5f6'; g.stroke();
    g.scale(1, -1); g.transform(1, 0, -sk, 1, 0, 0); g.scale(fs / 100, fs / 100);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
    const x0 = (-tw / 2 / fs) * 100, base = 36;
    g.fillStyle = g.strokeStyle = '#ffd21f'; g.lineWidth = 3; g.fillText(t1, x0, base); g.strokeText(t1, x0, base); // 中文字描一圈，加粗
    g.fillStyle = '#f4f5f6'; g.fillText(t2, x0 + ((w1 + sp) / fs) * 100, base);
    g.restore();
  }

  return (sd, style) => {
    const { c, g } = canvas(b);
    g.clearRect(b.x0 - 1, b.y0 - 1, b.x1 - b.x0 + 2, b.y1 - b.y0 + 2);
    if (style === 'flames') flames(g); else if (style === 'stripes') stripes(g); else if (style === 'team') team(g, sd);
    return c;
  };
}
// 包一層 look 的拉花：通用的名字畫通用的（正面空白），其他名字照車子自己的。
// 車子自己也有同名的拉花（918 的 stripes）就用車子自己的，通用的改用 'gen:stripes'（'gen:' 開頭一定是通用的）
function withGenericLivery(look, sideTex) {
  const draw = genericLivery(look, sideTex), own = {}, keys = LIV_GENERIC.map((o) => o[0]);
  let last = 'ff'; // 最後畫的車子自己的拉花（探測完再畫一次，車子自己記的狀態才不會亂掉，例如 Jesko 的點綴色）
  const sig = (c) => { const s = document.createElement('canvas'); s.width = 256; s.height = 80; const g = s.getContext('2d'); g.drawImage(c, 0, 0, 256, 80); return g.getImageData(0, 0, 256, 80).data; };
  const mine = (k) => (own[k] ??= (() => { const p = sig(look.livery(1, k)), q = sig(look.livery(1, '?')); look.livery(1, last); return p.some((v, i) => Math.abs(v - q[i]) > 16); })());
  const gen = (s) => { const k = String(s).replace(/^gen:/, ''); return keys.includes(k) && (k !== s || !mine(k)) ? k : null; };
  const blank = () => { const { c, g } = canvas(BOX.front); g.clearRect(-2, -1, 4, 3); return c; };
  return {
    livery: (sd, s) => { const k = gen(s); if (k) return draw(sd, k); last = s; return look.livery(sd, s); },
    frontLivery: (s, nose) => (gen(s) ? blank() : look.frontLivery(s, nose)),
  };
}

function makeMaskTextures(look = SUPRA_LOOK) {
  const cv = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const noses = Object.keys(look.fronts), side = look.side(), L = withGenericLivery(look, side); // L：拉花（含通用的）
  const t = {
    side, rear: look.rear(), top: look.top(), livR: cv(L.livery(1, 'ff')), livL: cv(L.livery(-1, 'ff')),
    fronts: Object.fromEntries(noses.map((k) => [k, look.fronts[k]()])),
    livFs: Object.fromEntries(noses.map((k) => [k, cv(L.frontLivery('ff', k))])),
  };
  // 所有車身材質共用這組 uniform：換套件只要換 tFront、tLivF 的 value
  const V2 = (a) => new THREE.Vector2(...a), V3 = (a) => new THREE.Vector3(...a), u = look.U;
  t.U = {
    tSide: { value: t.side }, tFront: { value: t.fronts[noses[0]] }, tRear: { value: t.rear }, tTop: { value: t.top },
    tLivR: { value: t.livR }, tLivL: { value: t.livL }, tLivF: { value: t.livFs[noses[0]] },
    uXr: { value: u.uXr }, uXf: { value: u.uXf }, uLiv: { value: look.livDefault ?? 1 },
    uFx: { value: V2(u.uFx) }, uRx: { value: V2(u.uRx) }, uWell: { value: V3(u.uWell) }, uWellR: { value: V3(u.uWellR ?? u.uWell) }, uGlassY: { value: u.uGlassY },
  };
  t.uLiv = t.U.uLiv;
  t.setNose = (k) => { t.nose = k; t.U.tFront.value = t.fronts[k]; t.U.tLivF.value = t.livFs[k]; };
  // 換拉花：'none' 關掉，其他名字就重畫三張拉花貼圖（L.livery(side, 名字)、L.frontLivery(名字, 車頭)；通用的名字見 LIV_GENERIC）
  t.livStyle = 'ff';
  t.setLivery = (style) => {
    t.U.uLiv.value = style === 'none' ? 0 : 1;
    if (style === 'none' || style === t.livStyle) return;
    t.livStyle = style;
    t.livR.image = L.livery(1, style); t.livR.needsUpdate = true;
    t.livL.image = L.livery(-1, style); t.livL.needsUpdate = true;
    for (const k of noses) { t.livFs[k].image = L.frontLivery(style, k); t.livFs[k].needsUpdate = true; }
  };
  return t;
}

// ---- shader ----
const VERT_DECL = 'varying vec3 vP; varying vec3 vN;\n';
const MASK_FN = `
uniform sampler2D tSide, tFront, tRear, tTop, tLivR, tLivL, tLivF;
uniform float uXr, uXf, uLiv, uGlassY;
uniform vec2 uFx, uRx; uniform vec3 uWell, uWellR;
varying vec3 vP; varying vec3 vN;
vec2 uvSide(vec3 p) { return vec2((p.x + 2.35) / 4.7, p.y / 1.4); }
vec2 uvTop(vec3 p) { return vec2((p.x + 2.35) / 4.7, (p.z + 1.0) / 2.0); }
// 玻璃在哪裡：朝側面的地方看側視圖（側窗），朝上的地方看俯視圖（前擋、後擋）
// glass＝玻璃範圍（含黑邊），blk＝黑邊；glass 而且不是 blk 才是透明的玻璃
float sideF(vec3 n) { return smoothstep(0.35, 0.55, abs(n.z)); }
void glassMask(vec4 S, vec4 Tp, out float glass, out float blk) {
  float sf = sideF(vN), hi = step(uGlassY, vP.y);
  glass = max(S.r * sf, Tp.a * (1.0 - sf) * hi);
  blk = max(S.g * sf, Tp.g * (1.0 - sf) * hi);
}
`;
function inject(shader, tex) {
  Object.assign(shader.uniforms, tex.U);
  shader.vertexShader = VERT_DECL + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vP = position; vN = normal;');
  shader.fragmentShader = MASK_FN + shader.fragmentShader;
}

// 車漆那一層：玻璃的地方挖掉，其他依照投影圖改顏色、粗糙度、金屬感
function patchPaint(mat, tex) {
  mat.onBeforeCompile = (shader) => {
    inject(shader, tex);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
  vec4 S = texture2D(tSide, uvSide(vP));
  vec4 Tp = texture2D(tTop, uvTop(vP));
  float glass, blk; glassMask(S, Tp, glass, blk);
  if (glass > 0.5 && blk < 0.5) discard;
  float sf = sideF(vN);
  float sideW = smoothstep(0.2, 0.45, abs(vN.z));
  vec4 LV = vP.z > 0.0 ? texture2D(tLivR, uvSide(vP)) : texture2D(tLivL, uvSide(vP));
  diffuseColor.rgb = mix(diffuseColor.rgb, LV.rgb, LV.a * sideW * uLiv);
  float blackG = S.g * sf, gap = S.b * sideW, lamp = 0.0, lens = 0.0, wire = 0.0, amber = 0.0, red = 0.0, rev = 0.0, matte = 0.0;
  float fW = smoothstep(uFx.x, uFx.y, vP.x) * smoothstep(-0.35, 0.1, vN.x) * (1.0 - smoothstep(0.82, 0.95, vN.y));
  if (fW > 0.0) {
    vec2 uvF = vec2((1.0 - vP.z) / 2.0, vP.y / 1.3);
    vec4 LF = texture2D(tLivF, uvF);
    diffuseColor.rgb = mix(diffuseColor.rgb, LF.rgb, LF.a * fW * uLiv);
    vec4 F = texture2D(tFront, uvF);
    lamp = F.r * fW; lens = F.a * F.r * fW; wire = F.a * (1.0 - F.r) * fW * smoothstep(0.3, 0.7, vN.x); // 網子只在朝前的面（開口的內壁是黑的）
    amber = F.b * fW; blackG = max(blackG, F.g * fW * (1.0 - F.r));
  }
  float rW = (1.0 - smoothstep(uRx.y, uRx.x, vP.x)) * (1.0 - smoothstep(-0.1, 0.35, vN.x));
  if (rW > 0.0) {
    vec4 Rr = texture2D(tRear, vec2((vP.z + 1.0) / 2.0, vP.y / 1.3));
    red = Rr.r * rW * (1.0 - Rr.g); rev = Rr.b * rW; blackG = max(blackG, Rr.g * rW); gap = max(gap, Rr.a * rW);
  }
  float tW = smoothstep(0.25, 0.5, vN.y);
  matte = max(matte, Tp.r * tW); blackG = max(blackG, Tp.g * tW * (1.0 - sf)); gap = max(gap, Tp.b * tW);
  // 輪拱內側、底盤：黑
  float well = max(step(length(vP.xy - vec2(uXr, uWellR.x)), uWellR.y) * step(abs(vP.z), uWellR.z), step(length(vP.xy - vec2(uXf, uWell.x)), uWell.y) * step(abs(vP.z), uWell.z));
  well *= step(vN.y, 0.35); // 朝上的面（引擎蓋很低的車，蓋子會落在輪拱半徑裡）不算輪拱內側
  float under = step(vN.y, -0.6) * step(vP.y, 0.3);
  matte = max(matte, max(well, under));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012), blackG);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02), matte);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.88, 0.9), lamp);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.10, 0.11, 0.13), lens);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.23, 0.24), wire);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.45, 0.05), amber);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.38, 0.0, 0.01), red);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85), rev);
  diffuseColor.rgb *= 1.0 - 0.85 * gap;
`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.2, blackG);
  roughnessFactor = mix(roughnessFactor, 0.8, matte);
  roughnessFactor = mix(roughnessFactor, 0.14, lamp);
  roughnessFactor = mix(roughnessFactor, 0.05, lens);
  roughnessFactor = mix(roughnessFactor, 0.4, wire);
  roughnessFactor = mix(roughnessFactor, 0.12, max(amber, red));
`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
  metalnessFactor = mix(metalnessFactor, 0.0, max(blackG, matte));
  metalnessFactor = mix(metalnessFactor, 1.0, lamp * (1.0 - lens));
  metalnessFactor = mix(metalnessFactor, 0.0, lens);
  metalnessFactor = mix(metalnessFactor, 0.8, wire);
`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
  material.clearcoat *= 1.0 - max(max(matte, wire), blackG * 0.8);
`);
  };
  mat.customProgramCacheKey = () => 'paint';
}
// 玻璃那一層：只留玻璃的地方
function patchGlass(mat, tex) {
  mat.onBeforeCompile = (shader) => {
    inject(shader, tex);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  float glass, blk; glassMask(texture2D(tSide, uvSide(vP)), texture2D(tTop, uvTop(vP)), glass, blk);
  if (glass < 0.5 || blk > 0.5) discard;
`).replace('#include <opaque_fragment>', `#include <opaque_fragment>
  float refl = max(max(outgoingLight.r, outgoingLight.g), outgoingLight.b);
  gl_FragColor.a = clamp(diffuseColor.a + refl * 0.9, 0.0, 1.0);
`);
  };
  mat.customProgramCacheKey = () => 'glass';
}
// 車內那一層（車殼背面）：玻璃的地方也挖掉，才看得穿兩邊車窗
function patchInside(mat, tex) {
  mat.onBeforeCompile = (shader) => {
    inject(shader, tex);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  float glass, blk; glassMask(texture2D(tSide, uvSide(vP)), texture2D(tTop, uvTop(vP)), glass, blk);
  if (glass > 0.5 && blk < 0.5) discard;
`);
  };
  mat.customProgramCacheKey = () => 'inside';
}

// ---- gtr-look.js ----
// 3D R34 GT-R 的表面細節（投影貼圖），做法跟 masks.js 的 Supra 一樣。
// 位置都是照 Nick 那張藍色 R34 照片量的：照片上的點從相機打光線到車身，得到車身上的 (x, y, z)。

const GTR_LOOK = (() => {
  const M = (pts) => pts.map(([u, y]) => [-u, y]); // 左右鏡射
  const rrect = (g, x0, y0, x1, y1, r) => { g.beginPath(); g.roundRect(x0, y0, x1 - x0, y1 - y0, r); };
  const circle = (g, x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); };

  // ---- 側面（x, y）----
  // 側窗：車門窗＋後面的小三角窗，上緣比車頂邊低 5 公分（車頂飾條）
  const DLO = [[-1.10, 1.004], [-0.96, 1.083], [-0.834, 1.16], [-0.72, 1.212], [-0.658, 1.23], [-0.566, 1.246], [-0.466, 1.253],
    [-0.269, 1.254], [-0.079, 1.249], [0.05, 1.244], [0.106, 1.24], [0.165, 1.232], [0.217, 1.216], [0.265, 1.19], [0.306, 1.163],
    [0.399, 1.084], [0.493, 1.007], [0.54, 0.965], [0.555, 0.945], [0.50, 0.937], [0.30, 0.933], [0.06, 0.932], [-0.45, 0.942],
    [-0.80, 0.962], [-1.0, 0.985], [-1.06, 0.994]];
  const BPILLAR = [[-0.395, 1.265], [-0.335, 1.265], [-0.40, 0.925], [-0.462, 0.925]];
  // 前擋包到側面的那一塊（A 柱前面）
  const WS_SIDE = [[0.29, 1.40], [0.316, 1.258], [0.37, 1.20], [0.431, 1.135], [0.497, 1.032], [0.548, 0.958], [0.60, 0.95], [0.95, 0.95], [0.95, 1.40]];
  const APILLAR = [[0.316, 1.258], [0.37, 1.20], [0.431, 1.135], [0.497, 1.032], [0.548, 0.958], [0.62, 0.95]];
  const BELT = [[0.57, 0.936], [0.30, 0.931], [0.06, 0.93], [-0.45, 0.94], [-0.80, 0.96], [-1.07, 0.992]];
  function side() {
    return layers(BOX.side, [
      (g) => { poly(g, DLO); g.fill(); poly(g, WS_SIDE); g.fill(); },
      (g) => { // 黑色
        poly(g, BPILLAR); g.fill();
        g.lineJoin = 'round'; g.lineWidth = 0.02; poly(g, DLO); g.stroke();
        line(g, BELT, 0.022);
        line(g, APILLAR, 0.03); line(g, [[0.55, 0.962], [0.95, 0.962]], 0.03); // 前擋邊上的黑邊
        poly(g, [[1.765, 0.49], [1.92, 0.49], [1.92, 0.275], [1.78, 0.27]]); g.fill(); // 保桿角的導風口
        rrect(g, -0.475, 0.797, -0.315, 0.812, 0.006); g.fill(); // 門把凹槽
        g.beginPath(); g.ellipse(0.82, 0.45, 0.022, 0.011, 0, 0, Math.PI * 2); g.fill(); // 側方向燈
      },
      (g) => { // 縫
        line(g, [[0.562, 0.925], [0.66, 0.88], [0.731, 0.817], [0.76, 0.70], [0.767, 0.636], [0.769, 0.415], [0.765, 0.30]], 0.005); // 車門前緣
        line(g, [[-0.627, 0.925], [-0.621, 0.777], [-0.620, 0.591], [-0.569, 0.428], [-0.46, 0.324], [-0.40, 0.30]], 0.005); // 車門後緣
        line(g, [[-0.40, 0.30], [0.765, 0.30]], 0.004); // 車門下緣
        g.lineWidth = 0.004; rrect(g, -0.50, 0.785, -0.29, 0.83, 0.02); g.stroke(); // 門把
        rrect(g, -1.62, 0.78, -1.47, 0.87, 0.025); g.stroke(); // 油箱蓋
        line(g, [[-1.76, 0.585], [-2.0, 0.595], [-2.32, 0.60]], 0.004); // 後保桿
        line(g, [[1.64, 0.645], [1.80, 0.652], [2.0, 0.656]], 0.004); // 前保桿
      },
      null,
    ]);
  }

  // ---- 正面（u＝|z|，畫的時候左右鏡射；y）----
  const HEAD = [[0.36, 0.726], [0.46, 0.737], [0.58, 0.743], [0.70, 0.743], [0.79, 0.737], [0.822, 0.71], [0.832, 0.672], [0.828, 0.632],
    [0.80, 0.623], [0.68, 0.618], [0.56, 0.614], [0.41, 0.611], [0.385, 0.64]];
  const GRILLE = [[-0.30, 0.693], [0.30, 0.693], [0.34, 0.64], [0.346, 0.613], [-0.346, 0.613], [-0.34, 0.64]];
  const LOWER = [[0.466, 0.395], [0.735, 0.395], [0.745, 0.36], [0.715, 0.302], [0.466, 0.302]];   // 霧燈下面的進氣口
  const SMALL = [[0.516, 0.522], [0.632, 0.522], [0.632, 0.454], [0.519, 0.454]];                  // 霧燈旁邊的小進氣口
  const FOG = [[0.641, 0.518], [0.735, 0.518], [0.735, 0.457], [0.641, 0.457]];
  const SLOT = [[0.36, 0.258], [0.754, 0.258], [0.754, 0.198], [0.36, 0.195]];                     // 最下面一條
  const both2 = (g, pts, fn) => { for (const P of [pts, M(pts)]) { fn(P); } };
  function front() {
    return layers(BOX.front, [
      (g) => { // R：燈（鍍鉻反射罩）、中冷器（鋁）、車頭徽章
        both2(g, HEAD, (P) => { smooth(g, P); g.fill(); });
        both2(g, FOG, (P) => { poly(g, P); g.fill(); });
        rrect(g, -0.285, 0.30, 0.285, 0.47, 0.01); g.fill();
        rrect(g, -0.036, 0.637, 0.036, 0.667, 0.01); g.fill();
      },
      (g) => { // G：黑色
        smooth(g, GRILLE); g.fill();
        rrect(g, -0.315, 0.282, 0.315, 0.488, 0.02); g.fill(); // 中冷器開口（邊是黑的）
        for (const P of [LOWER, M(LOWER), SMALL, M(SMALL), SLOT, M(SLOT)]) { poly(g, P); g.fill(); }
        g.lineWidth = 0.006; both2(g, HEAD, (P) => { smooth(g, P); g.stroke(); });
        g.lineWidth = 0.008; both2(g, FOG, (P) => { poly(g, P); g.stroke(); });
      },
      null, // B：橘色方向燈（R34 的在大燈裡，看不到）
      (g) => { // A：暗色細節
        for (const s of [1, -1]) {
          g.save(); smooth(g, HEAD.map(([u, y]) => [u * s, y])); g.clip();
          g.fillStyle = 'rgb(190,190,190)'; poly(g, [[0.30 * s, 0.60], [0.90 * s, 0.60], [0.90 * s, 0.632], [0.30 * s, 0.628]]); g.fill(); // 燈殼下緣
          g.strokeStyle = 'rgb(160,160,160)'; g.lineWidth = 0.007;
          circle(g, 0.745 * s, 0.677, 0.043); g.stroke(); circle(g, 0.47 * s, 0.674, 0.046); g.stroke();
          g.fillStyle = 'rgb(90,90,90)'; circle(g, 0.745 * s, 0.677, 0.024); g.fill(); circle(g, 0.47 * s, 0.674, 0.026); g.fill();
          g.restore(); g.fillStyle = g.strokeStyle = '#fff';
        }
        // 中冷器的鰭片（中間那段），兩邊是水箱
        g.save(); rrect(g, -0.255, 0.305, 0.255, 0.465, 0.004); g.clip();
        for (let y = 0.31; y < 0.47; y += 0.011) line(g, [[-0.3, y], [0.3, y]], 0.0045);
        g.restore();
        rrect(g, -0.024, 0.643, 0.024, 0.661, 0.006); g.fill(); // 徽章中間暗的
        // 下面進氣口的網子
        for (const P of [LOWER, M(LOWER), SLOT, M(SLOT)]) {
          g.save(); poly(g, P); g.clip(); g.lineWidth = 0.003;
          for (let k = -1.2; k < 1.2; k += 0.016) { line(g, [[k, 0.15], [k + 0.3, 0.45]], 0.003); line(g, [[k, 0.45], [k + 0.3, 0.15]], 0.003); }
          g.restore();
        }
      },
    ]);
  }

  // ---- 後面（u＝z，y）：四顆圓尾燈（外側大、內側小、底部對齊；內側燈中間的橘色方向燈是零件，supra.js GTR_SPEC）----
  // 位置照 Nick 2026-09-27 傳的 R34 車尾照片量的（rear3d/hit-r34.mjs）
  const LAMPS = [[0.64, 0.805, 0.088], [0.45, 0.787, 0.071]];
  const REV = [0.175, 0.487, 0.33, 0.54]; // 車牌兩邊的倒車燈（u0, y0, u1, y1）
  const revRect = (g, s) => rrect(g, s > 0 ? REV[0] : -REV[2], REV[1], s > 0 ? REV[2] : -REV[0], REV[3], 0.008);
  function rear() {
    return layers(BOX.rear, [
      (g) => {
        for (const s of [1, -1]) for (const [u, y, r] of LAMPS) { circle(g, u * s, y, r); g.fill(); }
        rrect(g, -0.08, 0.912, 0.08, 0.938, 0.008); g.fill(); // 第三煞車燈
      },
      (g) => {
        g.lineWidth = 0.012;
        for (const s of [1, -1]) for (const [u, y, r] of LAMPS) { circle(g, u * s, y, r + 0.006); g.stroke(); }
        g.lineWidth = 0.004;
        for (const s of [1, -1]) { const [u, y, r] = LAMPS[0]; circle(g, u * s, y, r * 0.52); g.stroke(); } // 外側燈裡面的一圈
        rrect(g, -0.17, 0.36, 0.17, 0.515, 0.01); g.fill(); // 車牌
        g.lineWidth = 0.008; for (const s of [1, -1]) { revRect(g, s); g.stroke(); } // 倒車燈的框
        poly(g, [[-0.82, 0.15], [0.82, 0.15], [0.80, 0.325], [-0.80, 0.325]]); g.fill(); // 下面黑色
      },
      (g) => { for (const s of [1, -1]) { revRect(g, s); g.fill(); } }, // 倒車燈
      (g) => {
        line(g, [[-0.66, 0.893], [0.66, 0.893]], 0.004); line(g, [[-0.86, 0.632], [0.86, 0.632]], 0.004); // 行李箱上緣、保桿上緣
        line(g, [[-0.43, 0.893], [-0.36, 0.86], [-0.355, 0.715], [0.355, 0.715], [0.36, 0.86], [0.43, 0.893]], 0.004); // 行李箱蓋
      },
    ]);
  }

  // ---- 上面（x, z）：前擋、後擋、雨刷飾板、引擎蓋和行李箱的縫 ----
  const WS = [[0.85, 0], [0.846, 0.30], [0.832, 0.46], [0.805, 0.555], [0.76, 0.615], [0.70, 0.648], [0.62, 0.664], [0.52, 0.668], [0.44, 0.663],
    [0.38, 0.652], [0.33, 0.632], [0.28, 0.598], [0.235, 0.545], [0.20, 0.46], [0.178, 0.33], [0.168, 0.16], [0.165, 0]];
  const BL = [[-0.705, 0], [-0.707, 0.30], [-0.715, 0.44], [-0.745, 0.505], [-0.85, 0.52], [-1.0, 0.53], [-1.15, 0.535], [-1.30, 0.525],
    [-1.40, 0.51], [-1.48, 0.48], [-1.54, 0.43], [-1.57, 0.30], [-1.585, 0]];
  const COWL = [[0.915, 0], [0.912, 0.30], [0.90, 0.48], [0.87, 0.60], [0.83, 0.66], [0.80, 0.64], [0.83, 0.56], [0.845, 0.45], [0.85, 0.30], [0.852, 0]];
  function top() {
    return layers(BOX.top, [
      null,
      (g) => {
        frit(g, both(WS), 0.03, [0.10, 0.215], [0.79, 0.90]);
        frit(g, both(BL), 0.03, [-0.78, -0.70], [-1.62, -1.49]);
        smooth(g, both(COWL)); g.fill();
      },
      (g) => {
        line(g, [[0.905, 0.70], [1.30, 0.735], [1.75, 0.745], [1.98, 0.72], [2.08, 0.62], [2.12, 0.40], [2.135, 0], [2.12, -0.40], [2.08, -0.62], [1.98, -0.72], [1.75, -0.745], [1.30, -0.735], [0.905, -0.70]], 0.005);
        line(g, [[-1.63, 0.645], [-1.90, 0.665], [-2.14, 0.66], [-2.235, 0.60], [-2.265, 0.40], [-2.275, 0], [-2.265, -0.40], [-2.235, -0.60], [-2.14, -0.66], [-1.90, -0.665], [-1.63, -0.645]], 0.005);
      },
      (g) => { smooth(g, both(WS)); g.fill(); smooth(g, both(BL)); g.fill(); },
    ]);
  }

  // ---- 拉花：白色側條＋後葉子板的 GT-R 字（照片那台沒有拉花，所以預設關掉）----
  function livery(sd, style = 'ff') {
    const { c, g } = canvas(BOX.side);
    g.clearRect(-3, -1, 6, 3);
    if (style !== 'ff') return c;
    g.fillStyle = '#f4f5f6';
    poly(g, [[-2.32, 0.365], [2.0, 0.335], [2.0, 0.375], [-2.32, 0.405]]); g.fill();
    poly(g, [[-2.32, 0.42], [2.0, 0.39], [2.0, 0.40], [-2.32, 0.43]]); g.fill();
    text(g, 'GT-R', -1.10, 0.80, 0.095, { italic: true, mirror: sd < 0, skew: 0.2 });
    return c;
  }
  function frontLivery() { const { c, g } = canvas(BOX.front); g.clearRect(-2, -1, 4, 3); return c; }

  return {
    side, rear, top,
    fronts: { base: front },
    livery, frontLivery,
    livDefault: 0,
    nose: () => 'base',
    U: { uXr: -1.375, uXf: 1.29, uFx: [1.92, 1.97], uRx: [-2.05, -2.15], uWell: [0.327, 0.374, 0.87], uGlassY: 0.93 },
  };
})();

// ---- parts.js ----
// 3D Supra 的零件：輪子（輪胎＋五輻輪框＋碟盤＋卡鉗）、尾翼、後照鏡、車內

const MAT = {
  rubber: () => new THREE.MeshPhysicalMaterial({ color: 0x0c0c0d, roughness: 0.82, metalness: 0 }),
  chrome: () => new THREE.MeshPhysicalMaterial({ color: 0xe8eaec, roughness: 0.07, metalness: 1 }),
  alu: () => new THREE.MeshPhysicalMaterial({ color: 0xc9ccd0, roughness: 0.28, metalness: 1 }),
  disc: () => new THREE.MeshPhysicalMaterial({ color: 0x6d6f72, roughness: 0.45, metalness: 0.9 }),
  caliper: () => new THREE.MeshPhysicalMaterial({ color: 0x9da1a6, roughness: 0.3, metalness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.1 }),
  black: () => new THREE.MeshPhysicalMaterial({ color: 0x0a0a0b, roughness: 0.5, metalness: 0 }),
  gloss: () => new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.15, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 }),
  carbon: () => new THREE.MeshPhysicalMaterial({ color: 0x17181b, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide }),
};

// 多輻輪框（照片那台 GT-R）：12 組 V 形雙輻，從中間往外、往內凹
function multiSpoke(rim, w, mats) {
  const g = new THREE.Group();
  const ro = rim - 0.014, rh = 0.078, zo = w / 2 - 0.03, zi = w / 2 - 0.085;
  for (let j = 0; j < 12; j++) {
    const a = (j * 2 * Math.PI) / 12;
    for (const s of [-1, 1]) {
      const ai = a + s * 0.07, ao = a + s * 0.155; // 中間靠近、外面分開
      const P = (r, ang, z, off) => [Math.cos(ang) * r - Math.sin(ang) * off, Math.sin(ang) * r + Math.cos(ang) * off, z];
      const wi = 0.0068, wo = 0.0052;
      const geo = slab([P(rh, ai, zi, -wi), P(ro, ao, zo, -wo), P(ro, ao, zo, wo), P(rh, ai, zi, wi)], 0.016);
      g.add(new THREE.Mesh(geo, mats.chrome));
    }
  }
  // 中間的輪轂（深色）＋外圈一道亮邊
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.1, 0.04, 48), mats.chrome);
  hub.geometry.rotateX(Math.PI / 2); hub.position.z = zi + 0.006; g.add(hub);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ro + 0.002, 0.006, 8, 96), mats.chrome);
  ring.position.z = zo + 0.004; g.add(ring);
  return g;
}

// ---- 輪子：輪軸沿著 z，外側朝 +z ----
function wheel({ R = 0.325, width = 0.235, rim = 0.2413, mats, style = 'five' } = {}) {
  const g = new THREE.Group();
  const w = width;
  // 輪胎剖面（r, 軸向）：內側胎唇 → 胎壁 → 胎肩 → 胎面 → 外側
  const tp = [
    [rim + 0.004, -w / 2 + 0.012], [rim + 0.02, -w / 2 + 0.002], [R - 0.045, -w / 2], [R - 0.016, -w / 2 + 0.008], [R - 0.003, -w / 2 + 0.028],
    [R, -w / 2 + 0.05], [R, w / 2 - 0.05], [R - 0.003, w / 2 - 0.028], [R - 0.016, w / 2 - 0.008], [R - 0.045, w / 2], [rim + 0.02, w / 2 - 0.002], [rim + 0.004, w / 2 - 0.012],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const tire = new THREE.Mesh(new THREE.LatheGeometry(tp, 96), mats.rubber);
  tire.geometry.rotateX(Math.PI / 2);
  g.add(tire);
  // 輪框筒＋外緣亮邊
  const bp = [
    [rim - 0.012, -w / 2 + 0.01], [rim + 0.006, -w / 2 + 0.006], [rim + 0.006, -w / 2 + 0.02], [rim - 0.01, -w / 2 + 0.03],
    [rim - 0.01, w / 2 - 0.035], [rim + 0.004, w / 2 - 0.022], [rim + 0.012, w / 2 - 0.012], [rim + 0.012, w / 2 - 0.004], [rim + 0.002, w / 2 + 0.002], [rim - 0.012, w / 2 - 0.004],
    [rim - 0.018, w / 2 - 0.02],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const barrel = new THREE.Mesh(new THREE.LatheGeometry(bp, 96), mats.chrome);
  barrel.geometry.rotateX(Math.PI / 2);
  g.add(barrel);
  // 輪框內側暗一點（看得到的筒內）
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(rim - 0.018, rim - 0.018, w * 0.8, 64, 1, true), mats.disc);
  inner.geometry.rotateX(Math.PI / 2); inner.material = mats.barrelIn; inner.position.z = -0.01;
  g.add(inner);
  if (typeof style === 'function') g.add(style(rim, w, mats)); // 各台車自己的輪框：style(rim, w, mats) 回傳輻條（外側朝 +z）
  else if (style === 'multi') g.add(multiSpoke(rim, w, mats));
  else {
    // 五根輻條：圓盤挖掉五個洞
    const ro = rim - 0.012, ri = 0.062;
    const disc = new THREE.Shape(); disc.absarc(0, 0, ro, 0, Math.PI * 2, false);
    const hw = (r) => 0.021 + (r - ri) / (ro - ri) * 0.013;
    for (let j = 0; j < 5; j++) {
      const a0 = (j * 2 * Math.PI) / 5, a1 = ((j + 1) * 2 * Math.PI) / 5;
      const pts = [];
      const rA = ri + 0.018, rB = ro - 0.02, n = 10;
      for (let i = 0; i <= n; i++) { const r = rA + ((rB - rA) * i) / n; const a = a0 + Math.asin(hw(r) / r); pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
      const aO0 = a0 + Math.asin(hw(rB) / rB), aO1 = a1 - Math.asin(hw(rB) / rB);
      for (let i = 1; i < 12; i++) { const a = aO0 + ((aO1 - aO0) * i) / 12; pts.push([Math.cos(a) * rB, Math.sin(a) * rB]); }
      for (let i = n; i >= 0; i--) { const r = rA + ((rB - rA) * i) / n; const a = a1 - Math.asin(hw(r) / r); pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
      const aI0 = a1 - Math.asin(hw(rA) / rA), aI1 = a0 + Math.asin(hw(rA) / rA);
      for (let i = 1; i < 6; i++) { const a = aI0 + ((aI1 - aI0) * i) / 6; pts.push([Math.cos(a) * rA, Math.sin(a) * rA]); }
      const hole = new THREE.Path(); hole.moveTo(...pts[0]); for (const p of pts.slice(1)) hole.lineTo(...p); hole.closePath();
      disc.holes.push(hole);
    }
    const face = new THREE.Mesh(new THREE.ExtrudeGeometry(disc, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 2, curveSegments: 64 }), mats.chrome);
    face.position.z = w / 2 - 0.045;
    g.add(face);
  }
  // 中心蓋＋螺帽
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.03, 40), mats.chrome);
  const capZ = typeof style === 'function' ? w / 2 - (style.capInset ?? 0.03) : style === 'multi' ? w / 2 - 0.058 : w / 2 - 0.012;
  cap.geometry.rotateX(Math.PI / 2); cap.position.z = capZ; g.add(cap);
  for (let j = 0; j < 5; j++) {
    const a = (j * 2 * Math.PI) / 5 + Math.PI / 5;
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.02, 6), mats.chrome);
    nut.geometry.rotateX(Math.PI / 2); nut.position.set(Math.cos(a) * 0.062, Math.sin(a) * 0.062, capZ - 0.004); g.add(nut);
  }
  // 碟盤＋卡鉗（不跟著輪子轉，放在另一個 group）
  const brake = new THREE.Group();
  const d = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.028, 64), mats.disc);
  d.geometry.rotateX(Math.PI / 2); d.position.z = w / 2 - 0.11; brake.add(d);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 40), mats.disc);
  hat.geometry.rotateX(Math.PI / 2); hat.position.z = w / 2 - 0.085; brake.add(hat);
  // 卡鉗：包住碟盤外緣的一塊（弧形、四角修圓），在碟盤後上方
  const ca = new THREE.Shape(), r0 = 0.118, r1 = 0.198, A = 0.62;
  ca.absarc(0, 0, r1, -A / 2, A / 2, false); ca.absarc(0, 0, r0, A / 2, -A / 2, true); ca.closePath();
  const cal = new THREE.Mesh(new THREE.ExtrudeGeometry(ca, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3, curveSegments: 20 }), mats.caliper);
  cal.rotation.z = Math.PI * 0.64; cal.position.z = w / 2 - 0.135; brake.add(cal);
  return { wheel: g, brake };
}

// ---- 尾翼（GT 大尾翼）：鋁的翼片、黑色端板、兩根鋁支架 ----
function gtWing({ span = 1.74, chord = 0.32, x = -1.74, y = 1.30, deck = 0.93, mats } = {}) {
  const g = new THREE.Group();
  // 翼剖面（倒過來的機翼：下面彎、上面平）
  const s = new THREE.Shape();
  const N = 24, top = [], bot = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, xc = (1 - Math.cos(Math.PI * t)) / 2;
    const th = 0.12 * 5 * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);
    const camber = -0.06 * Math.sin(Math.PI * xc) * (1 - 0.3 * xc);
    top.push([xc, camber + th]); bot.push([xc, camber - th]);
  }
  const P = (p) => [(-p[0] + 0.5) * chord, p[1] * chord];
  s.moveTo(...P(top[0]));
  for (const p of top.slice(1)) s.lineTo(...P(p));
  for (const p of bot.slice().reverse().slice(1)) s.lineTo(...P(p));
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: span, bevelEnabled: false, curveSegments: 4 }), mats.alu);
  blade.geometry.translate(0, 0, -span / 2);
  blade.rotation.z = 0.10; // 前緣稍微朝下
  blade.position.set(x, y, 0);
  g.add(blade);
  // 端板
  const ep = new THREE.Shape();
  const ew = 0.40, eh = 0.30, r = 0.03;
  ep.moveTo(-ew / 2 + r, -eh * 0.62); ep.lineTo(ew / 2 - r, -eh * 0.62); ep.quadraticCurveTo(ew / 2, -eh * 0.62, ew / 2, -eh * 0.62 + r);
  ep.lineTo(ew / 2, eh * 0.38 - r); ep.quadraticCurveTo(ew / 2, eh * 0.38, ew / 2 - r, eh * 0.38); ep.lineTo(-ew / 2 + 0.06, eh * 0.38);
  ep.lineTo(-ew / 2, eh * 0.2); ep.lineTo(-ew / 2, -eh * 0.62 + r); ep.quadraticCurveTo(-ew / 2, -eh * 0.62, -ew / 2 + r, -eh * 0.62);
  for (const sz of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.ExtrudeGeometry(ep, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 }), mats.gloss);
    e.position.set(x - 0.01, y + 0.01, sz * (span / 2) - (sz > 0 ? 0 : 0.008));
    g.add(e);
  }
  // 支架：從行李箱蓋往上，稍微往後傾
  for (const sz of [-1, 1]) {
    const st = new THREE.Shape();
    const hh = y - deck - 0.02;
    st.moveTo(-0.08, 0); st.lineTo(0.08, 0); st.lineTo(0.04, hh); st.lineTo(-0.05, hh); st.closePath();
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(st, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 }), mats.alu);
    m.position.set(x + 0.04, deck, sz * 0.55 - 0.006);
    g.add(m);
  }
  return g;
}

// ---- 賽道套件：碳纖維前下巴（含兩根拉桿）、保桿角的風刀、側裙下的刀片、後擴散器 ----
// 一片有厚度的板子：給四個角（依序），往板子法線兩邊各長 th/2
function slab(pts, th) {
  const v = pts.map((p) => new THREE.Vector3(...p));
  const n = new THREE.Vector3().crossVectors(v[1].clone().sub(v[0]), v[3].clone().sub(v[0])).normalize().multiplyScalar(th / 2);
  const T = v.map((p) => p.clone().add(n)), B = v.map((p) => p.clone().sub(n));
  const quads = [[T[0], T[1], T[2], T[3]], [B[3], B[2], B[1], B[0]]];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quads.push([B[i], B[j], T[j], T[i]]); }
  const a = [];
  for (const [p, q, r, w] of quads) a.push(...p.toArray(), ...q.toArray(), ...r.toArray(), ...p.toArray(), ...r.toArray(), ...w.toArray());
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); g.computeVertexNormals();
  return g;
}
// 賽道套件的位置（Supra 預設）；GT-R 另外給一組
const AERO_SUPRA = {
  front: [[2.357, 0], [2.345, 0.30], [2.30, 0.52], [2.22, 0.68], [2.10, 0.79], [1.99, 0.83]], back: 1.93, y: 0.112, rods: [2.29, 0.16],
  canard: { S: [2.105, 0.735], t: [-0.737, 0.676], ys: [0.30, 0.225] },
  skirt: { y: 0.132, x0: -0.90, x1: 0.78, z0: 0.80, z1: 0.925 },
  diff: { x0: -1.76, x1: -2.06, x2: -2.225, y0: 0.150, y1: 0.174, y2: 0.258, w: 0.64, fin0: -1.84 },
};
function aeroKit(mats, A = AERO_SUPRA) {
  const g = new THREE.Group(), m = mats.carbon;
  // 前下巴：沿著保桿下緣再往前伸，後緣收在保桿底下
  const front = A.front, zb = front[front.length - 1][1];
  const sh = new THREE.Shape();
  sh.moveTo(A.back, -zb); sh.lineTo(front[front.length - 1][0], -zb);
  sh.splineThru(front.slice(0, -1).reverse().map(([x, z]) => new THREE.Vector2(x, -z)));
  sh.splineThru(front.slice(1).map(([x, z]) => new THREE.Vector2(x, z)));
  sh.lineTo(A.back, zb); sh.closePath();
  const sp = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: false, curveSegments: 24 }), m);
  sp.rotation.x = Math.PI / 2; sp.position.y = A.y; g.add(sp);
  if (A.rods) for (const z of [-0.36, 0.36]) { // 拉桿
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.13, 8), mats.alu);
    rod.position.set(A.rods[0], A.rods[1], z); rod.rotation.z = -0.55; g.add(rod);
  }
  for (const s of [-1, 1]) {
    // 保桿角上的兩片風刀（後緣翹起來）
    if (A.canard) {
      const S = A.canard.S, t = A.canard.t, n = [t[1], -t[0]]; // n：朝外
      for (const y of A.canard.ys) {
        const P = (a, b, dy) => [S[0] + t[0] * a + n[0] * b, y + dy, s * (S[1] + t[1] * a + n[1] * b)];
        const pts = [P(-0.075, -0.015, 0), P(0.075, -0.015, 0.03), P(0.05, 0.075, 0.03), P(-0.035, 0.055, 0)];
        g.add(new THREE.Mesh(slab(s > 0 ? pts : pts.reverse(), 0.006), m));
      }
    }
    // 側裙下的刀片
    const k = A.skirt;
    g.add(new THREE.Mesh(slab([[k.x0, k.y, s * k.z0], [k.x1, k.y, s * k.z0], [k.x1 - 0.04, k.y, s * k.z1], [k.x0 + 0.04, k.y, s * k.z1]], 0.01), m));
  }
  // 後擴散器：一片往後上翹的板子＋五片直的導流片
  const D = A.diff;
  if (D) {
    g.add(new THREE.Mesh(slab([[D.x0, D.y0, -D.w], [D.x0, D.y0, D.w], [D.x1, D.y1, D.w - 0.01], [D.x1, D.y1, -D.w + 0.01]], 0.01), m));
    g.add(new THREE.Mesh(slab([[D.x1, D.y1, -D.w + 0.01], [D.x1, D.y1, D.w - 0.01], [D.x2, D.y2, D.w - 0.04], [D.x2, D.y2, -D.w + 0.04]], 0.01), m));
    for (const z of [-0.52, -0.26, 0, 0.26, 0.52]) {
      const f = new THREE.Shape(); f.moveTo(D.fin0, D.y0 + 0.005); f.lineTo(D.x1, D.y1 - 0.002); f.lineTo(D.x2, D.y2 - 0.003); f.lineTo(D.x2, D.y0 - 0.02); f.lineTo(D.x1 + 0.06, D.y0 - 0.02); f.closePath();
      const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(f, { depth: 0.008, bevelEnabled: false }), m);
      fin.position.z = z - 0.004; g.add(fin);
    }
  }
  return g;
}

// GT-R「玩命關頭」套件：照片那台的碳纖維前下巴（一片薄板＋前緣往下折一點）
function lip(mats, front, back, y) {
  const g = new THREE.Group();
  const zb = front[front.length - 1][1];
  const sh = new THREE.Shape();
  sh.moveTo(back, -zb); sh.lineTo(front[front.length - 1][0], -zb);
  sh.splineThru(front.slice(0, -1).reverse().map(([x, z]) => new THREE.Vector2(x, -z)));
  sh.splineThru(front.slice(1).map(([x, z]) => new THREE.Vector2(x, z)));
  sh.lineTo(back, zb); sh.closePath();
  const plate = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 24 }), mats.carbon);
  plate.rotation.x = Math.PI / 2; plate.position.y = y; g.add(plate);
  return g;
}

// R34 原廠尾翼：跟車身同色的翼片（兩端往下彎）、黑色可調尾緣、兩根支柱
function r34Wing(paintMat, mats, { x = -2.05, y = 1.105, deck = 0.99, span = 1.36, chord = 0.25, post = 0.42 } = {}) {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  const N = 20, top = [], bot = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, xc = (1 - Math.cos(Math.PI * t)) / 2;
    const th = 0.13 * 5 * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);
    const camber = 0.03 * Math.sin(Math.PI * xc);
    top.push([xc, camber + th]); bot.push([xc, camber - th]);
  }
  const P = (p) => [(-p[0] + 0.5) * chord, p[1] * chord];
  s.moveTo(...P(top[0])); for (const p of top.slice(1)) s.lineTo(...P(p)); for (const p of bot.slice().reverse().slice(1)) s.lineTo(...P(p));
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: span, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.008, bevelSegments: 3, curveSegments: 4 }), paintMat);
  blade.geometry.translate(0, 0, -span / 2); blade.rotation.z = -0.06; blade.position.set(x, y, 0); g.add(blade);
  // 兩端往下彎的翼端
  for (const sz of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), paintMat);
    tip.scale.set(chord * 0.5, 0.05, 0.035); tip.position.set(x, y - 0.018, sz * (span / 2 + 0.012)); g.add(tip);
  }
  // 尾緣的黑色可調片
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.012, span * 0.96), mats.gloss);
  flap.position.set(x - chord * 0.5 - 0.006, y + 0.012, 0); flap.rotation.z = 0.5; g.add(flap);
  // 支柱：下寬上窄、往後傾
  for (const sz of [-1, 1]) {
    const st = new THREE.Shape(), hh = y - deck - 0.01;
    st.moveTo(-0.075, 0); st.lineTo(0.075, 0); st.lineTo(0.035, hh); st.lineTo(-0.055, hh); st.closePath();
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(st, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2 }), paintMat);
    m.position.set(x + 0.03, deck - 0.01, sz * post - 0.015); g.add(m);
  }
  return g;
}

// 排氣管尾端：鈦色的橢圓管口（外面亮、裡面黑）
function exhaust(mats, x, y, z, size = 1, oval = 0.72) { // size：放大倍數，oval：高／寬
  const g = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.16, 32, 1, true), mats.alu);
  tube.geometry.rotateZ(Math.PI / 2); tube.material.side = THREE.DoubleSide; g.add(tube);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(0.046, 32), mats.black);
  inner.rotation.y = -Math.PI / 2; inner.position.x = -0.05; g.add(inner);
  g.scale.set(1, oval * size, size); g.position.set(x, y, z);
  return g;
}

// Supra 原廠拱形尾翼（照 Nick 2026-09-27 傳的紅色 Supra 車尾照片量的，rear3d/hit-supra.mjs）：
// 兩邊支柱從行李箱蓋往上、前緣往後斜，上面圓角彎過來接成一片翼，整支跟車身同色
function mk4Wing(paintMat, { z = 0.635, top = 1.128, te = -2.11, th = 0.034, bend = 0.10 } = {}) {
  const LE = [[0.80, -1.68], [0.925, -1.74], [1.03, -1.93], [1.08, -1.95]]; // 前緣 x 隨高度（腳插進行李箱蓋裡）
  const le = (y) => { if (y <= LE[0][0]) return LE[0][1]; for (let i = 1; i < LE.length; i++) if (y <= LE[i][0]) { const [y0, x0] = LE[i - 1], [y1, x1] = LE[i], t = (y - y0) / (y1 - y0); return x0 + (x1 - x0) * t; } return LE[LE.length - 1][1]; };
  // 路徑（z, y）：左腳 → 左支柱 → 圓角 → 翼 → 圓角 → 右支柱 → 右腳
  const yb = 0.80, yc = top - bend, path = [];
  for (let i = 0; i <= 12; i++) path.push([-z, yb + ((yc - yb) * i) / 12]);
  for (let i = 1; i <= 10; i++) { const a = Math.PI - (Math.PI / 2) * (i / 10); path.push([-z + bend + bend * Math.cos(a), yc + bend * Math.sin(a)]); }
  for (let i = 1; i < 16; i++) path.push([-z + bend + (2 * (z - bend) * i) / 16, top]);
  for (let i = 0; i <= 10; i++) { const a = Math.PI / 2 - (Math.PI / 2) * (i / 10); path.push([z - bend + bend * Math.cos(a), yc + bend * Math.sin(a)]); }
  for (let i = 1; i <= 12; i++) path.push([z, yc - ((yc - yb) * i) / 12]);
  // 翼剖面：對稱的 NACA 厚度，前緣到尾緣（上面）再回來（下面）
  const K = 14, us = [], ring = [];
  for (let k = 0; k <= K; k++) us.push((1 - Math.cos((Math.PI * k) / K)) / 2);
  const tk = (u) => 5 * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4) / 0.6;
  for (const u of us) ring.push([u, 1]);
  for (const u of us.slice(1, -1).reverse()) ring.push([u, -1]);
  const pos = [], idx = [], cols = ring.length + 1;
  path.forEach(([pz, py], i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    let tz = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tz, ty); tz /= l; ty /= l;
    const nz = -ty, ny = tz; // 厚度方向＝(-x) × 路徑方向（在 zy 平面上）
    const x0 = le(py), ch = te - x0;
    for (let j = 0; j <= ring.length; j++) {
      const [u, sg] = ring[j % ring.length], t = (th / 2) * tk(u) * sg;
      pos.push(x0 + ch * u, py + ny * t, pz + nz * t);
    }
  });
  for (let i = 0; i < path.length - 1; i++) for (let j = 0; j < cols - 1; j++) { const a = i * cols + j, b = a + cols; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const g = new THREE.Group(); g.add(new THREE.Mesh(geo, paintMat));
  return g;
}

// R34 後照鏡：方中帶圓的殼（同車色）、黑色底座、鏡面朝後
function mirrorR34(paintMat, mats, side = 1) {
  const g = new THREE.Group();
  const sh = new THREE.Shape(), w = 0.17, h = 0.10, r = 0.035;
  sh.moveTo(-w / 2 + r, -h / 2); sh.lineTo(w / 2 - r, -h / 2); sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r); sh.lineTo(w / 2, h / 2 - r);
  sh.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); sh.lineTo(-w / 2 + 0.01, h / 2); sh.lineTo(-w / 2, -h / 2 + r); sh.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const shell = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 4, curveSegments: 12 }), paintMat);
  // 形狀在 xy（x 往前、y 往上），往 z 拉厚；殼的前面圓、後面平一點
  shell.geometry.translate(0, 0, -0.03); shell.geometry.rotateY(side > 0 ? 0 : Math.PI); shell.position.set(0.01, 0, side * 0.11);
  shell.rotation.y = side * -0.12;
  g.add(shell);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.075), mats.mirrorGlass);
  glass.rotation.y = -Math.PI / 2; glass.position.set(-0.098, 0, side * 0.108); g.add(glass);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.08), mats.black);
  foot.position.set(0.02, -0.035, side * 0.04); g.add(foot);
  return g;
}

// ---- 後照鏡（流線型，跟車身同色）----
function mirror(paintMat, mats, side = 1) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), paintMat);
  head.scale.set(0.105, 0.048, 0.07);
  head.position.set(0, 0, side * 0.1);
  g.add(head);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(1, 32), mats.mirrorGlass);
  glass.scale.set(0.043, 0.085, 1); glass.rotation.y = -Math.PI / 2; glass.rotation.z = Math.PI / 2;
  glass.position.set(-0.055, 0, side * 0.1);
  g.add(glass);
  const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.09), paintMat);
  stalk.position.set(0.01, -0.02, side * 0.045);
  g.add(stalk);
  return g;
}

// ---- 車內：看得到的座椅、儀表板、方向盤 ----
function interior(mats, o = {}) {
  const dx = o.dx ?? 0, cage = o.cage ?? true, swZ = o.wheelZ ?? -0.36, sy = o.seatDy ?? 0; // seatDy：座椅整組往下（車頂很低的跑車）
  const g = new THREE.Group();
  const box = (w, h, d, m, x, y, z, rz = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.z = rz; g.add(b); return b; };
  // 儀表板
  box(0.40, 0.14, 1.20, mats.black, (o.dashX ?? 0.40), (o.dashY ?? 0.85), 0, 0.15);
  // 座椅（藍色桶椅）
  for (const z of [-0.36, 0.36]) {
    box(0.5, 0.12, 0.46, mats.seat, -0.18 + dx, 0.40 + sy, z);
    box(0.13, 0.62, 0.46, mats.seat, -0.46 + dx, 0.70 + sy, z, -0.22);
    box(0.08, 0.14, 0.24, mats.seat, -0.56 + dx, 1.06 + sy, z, -0.22);
  }
  // 方向盤（左駕）
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 10, 36), mats.black);
  sw.rotation.y = Math.PI / 2; sw.rotation.x = 0; sw.rotation.z = 0; sw.position.set(0.25 + dx, 0.86, swZ);
  sw.rotateOnAxis(new THREE.Vector3(0, 0, 1), 0.35);
  g.add(sw);
  // 防滾籠（白色的管子）
  const tube = (pts, r = 0.018) => { const c = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q))); const m = new THREE.Mesh(new THREE.TubeGeometry(c, 32, r, 8), mats.cage); g.add(m); };
  if (cage) {
    tube([[-0.66, 0.30, -0.62], [-0.66, 0.95, -0.60], [-0.64, 1.14, -0.42], [-0.63, 1.17, 0], [-0.64, 1.14, 0.42], [-0.66, 0.95, 0.60], [-0.66, 0.30, 0.62]]);
    tube([[-0.64, 1.15, 0.30], [-0.66, 0.40, -0.55]]);
    tube([[-0.63, 1.16, -0.52], [0.10, 1.17, -0.55], [0.55, 0.92, -0.62]]);
    tube([[-0.63, 1.16, 0.52], [0.10, 1.17, 0.55], [0.55, 0.92, 0.62]]);
  }
  // 中央通道
  box(1.0, 0.2, 0.22, mats.black, 0.0, 0.35, 0);
  // 後座上方的置物板、後面的隔板（擋住看進行李箱）
  if (o.bench) { // 四人座（GT-R）：後座椅墊、椅背、後擋下面的置物板
    const b = o.bench;
    box(0.45, 0.12, 1.2, mats.seat, b.x, 0.42, 0);
    box(0.12, 0.55, 1.2, mats.seat, b.x - 0.26, 0.70, 0, -0.3);
    box(0.42, 0.03, 1.3, mats.black, b.shelfX, b.shelfY, 0);
    box(2.8, 0.04, 1.5, mats.black, -0.3, 0.24, 0);
  } else {
    if (o.shelf !== false) { // shelf: false → 沒有後面的置物板（中置引擎車，座椅後面就是引擎蓋）
      box(0.75, 0.03, 1.36, mats.black, -1.18, 0.93, 0);
      box(0.04, 0.62, 1.4, mats.black, -0.86, 0.62, 0);
    }
    // 地板與後面的隔板
    box(2.0, 0.04, 1.5, mats.black, -0.1, 0.24, 0);
    box(0.04, 0.5, 1.4, mats.black, -0.85, 0.55, 0);
  }
  return g;
}

// ---- 寬體：四個輪拱外面加一片外掛的寬葉子板（跟車身同一個材質，所以車色、拉花、縫都會跟著），輪子往外推 ----
// W＝WIDE[key]（make-wide.mjs 從車身 SDF 量的）：每個輪拱每個角度 th，從輪拱邊緣 ra 往外每 dr 公尺車身側面的 z
// 葉子板邊緣凸到輪胎外推後再往外 1.2 公分，往外 15 公分慢慢收回車身；外緣比車身高 8 公釐、一圈鉚釘，兩端和最下面切平
const WIDE_PUSH = { f: 0.05, r: 0.065 };
function wideKit(paint, W, mats) {
  const g = new THREE.Group(); g.name = 'wide';
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const T0 = 0.008;
  const bolt = new THREE.CylinderGeometry(0.0072, 0.0085, 0.008, 10);
  const boltMat = mats?.barrelIn || new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 1 });
  const up = new THREE.Vector3(0, 1, 0), nv = new THREE.Vector3(), q = new THREE.Quaternion(), m4 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
  const sub = (p, r) => [p[0] - r[0], p[1] - r[1], p[2] - r[2]];
  for (const ax of ['f', 'r']) {
    const A = W[ax], n = A.th.length, NK = A.z[0].length, zT = A.zt + WIDE_PUSH[ax] + 0.012;
    const th0 = A.th[0], th1 = A.th[n - 1];
    for (const sd of [1, -1]) {
      // 一列＝一個角度：[往裡折回的唇邊, 唇邊圓角, 葉子板面 0..NK-1]
      const grid = [];
      for (let i = 0; i < n; i++) {
        const t = (A.th[i] * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), r0 = A.ra[i];
        const e = 0.4 + 0.6 * ss(th0, th0 + 30, A.th[i]) * (1 - ss(th1 - 30, th1, A.th[i])); // 兩端比較不凸
        const z0 = A.z[i][0], D = Math.min(0.1, Math.max(0.04, zT - z0)) * e;
        const P = (r, z) => [A.x + c * r, Math.max(A.yCut, A.y + s * r), sd * z];
        const row = [P(r0 - 0.012, z0 - 0.04), P(r0 - 0.016, z0 + T0 + D - 0.012)];
        const kn = A.kn ? A.kn[i] : NK; // 超出車身輪廓的點停在輪廓上
        for (let k = 0; k < NK; k++) { const r = r0 + Math.min(k, kn - 1) * W.dr; row.push(P(r, A.z[i][k] + T0 + D * (1 - ss(0.02, 0.15, r - r0)))); }
        grid.push(row);
      }
      const inset = (p, i, k) => [p[0], p[1], sd * (A.z[i][Math.max(0, Math.min(NK - 1, k))] - 0.02)]; // 同一點往車身裡面收
      const pos = [], idx = [];
      const strip = (rows) => { // 一片網格（自己的頂點，這樣摺角是利的）
        const o = pos.length / 3, cols = rows[0].length;
        for (const r of rows) for (const p of r) pos.push(p[0], p[1], p[2]);
        for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < cols - 1; j++) {
          const a = o + i * cols + j, b = a + cols;
          if (sd > 0) idx.push(a, a + 1, b, a + 1, b + 1, b); else idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      };
      strip(grid);
      strip(grid.map((r, i) => [r[r.length - 1], inset(r[r.length - 1], i, NK - 1)])); // 外緣的牆
      strip([grid[0].map((p, j) => inset(p, 0, j - 2)), grid[0]]); // 兩端的牆
      strip([grid[n - 1], grid[n - 1].map((p, j) => inset(p, n - 1, j - 2))]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, paint));
      // 鉚釘：外緣往裡 2 公分，每 12 度一顆
      const kb = NK; // 葉子板面倒數第二欄（前面有兩欄唇邊）
      const spots = [];
      for (let i = 1; i < n - 1; i += 2) {
        const p = grid[i][kb];
        if (p[1] < A.yCut + 0.03 || (A.kn && A.kn[i] < NK)) continue;
        const t1 = sub(grid[i + 1][kb], grid[i - 1][kb]), t2 = sub(grid[i][kb + 1], grid[i][kb - 1]);
        nv.set(t1[1] * t2[2] - t1[2] * t2[1], t1[2] * t2[0] - t1[0] * t2[2], t1[0] * t2[1] - t1[1] * t2[0]).normalize();
        if (nv.z * sd < 0) nv.negate();
        spots.push([p, nv.clone()]);
      }
      const bolts = new THREE.InstancedMesh(bolt, boltMat, spots.length);
      spots.forEach(([p, nn], k) => { q.setFromUnitVectors(up, nn); m4.compose(new THREE.Vector3(p[0], p[1], p[2]).addScaledVector(nn, 0.002), q, one); bolts.setMatrixAt(k, m4); });
      g.add(bolts);
    }
  }
  return g;
}

// ---- supra.js ----
// 組一台 3D 車：車身（三層：車漆、車內、玻璃）＋輪子＋尾翼＋後照鏡＋車內＋套件
// 每台車的不同都寫在 SPEC 裡（Supra、GT-R）

const SUPRA_SPEC = {
  look: SUPRA_LOOK, paint: '#ff7414', metal: 0.12,
  wheels: { xf: 1.2125, xr: -1.3375, R: 0.325, rim: 0.254, trackF: 0.76, trackR: 0.765, wF: 0.235, wR: 0.265, style: 'five' },
  mirror: (paint, mats, s) => { const m = mirror(paint, mats, s); m.position.set(0.60, 0.975, s * 0.745); m.scale.setScalar(1.3); return m; },
  wings: { stock: (paint) => mk4Wing(paint), gt: (paint, mats) => gtWing({ mats }) }, wing: 'gt',
  interior: {},
  build(body, paint, mats) { // 套件：原廠（原廠保桿）、bomex（玩命關頭那台）、track（Bomex＋碳纖維空力件）
    const aero = aeroKit(mats, AERO_SUPRA); aero.visible = false; body.add(aero);
    body.add(exhaust(mats, -2.21, 0.266, -0.572, 1, 0.95)); // 排氣管在左後（照車尾照片）
    return (kit, ctx) => { ctx.setNose(kit === 'stock' ? 'stock' : 'bomex'); aero.visible = kit === 'track'; };
  },
  kit: 'bomex',
};
const AERO_GTR = {
  front: [[2.335, 0], [2.325, 0.30], [2.285, 0.50], [2.21, 0.65], [2.10, 0.76], [1.98, 0.815]], back: 1.95, y: 0.118, rods: [2.26, 0.165],
  canard: { S: [2.175, 0.69], t: [-0.57, 0.82], ys: [0.28, 0.20] },
  skirt: { y: 0.125, x0: -0.95, x1: 0.80, z0: 0.86, z1: 0.95 },
  diff: { x0: -1.85, x1: -2.10, x2: -2.285, y0: 0.128, y1: 0.146, y2: 0.19, w: 0.62, fin0: -1.95 },
};
const GTR_SPEC = {
  look: GTR_LOOK, paint: '#1d4fc9', metal: 0.32, seat: 0x2a2b2f,
  wheels: { xf: 1.29, xr: -1.375, R: 0.327, rim: 0.2286, trackF: 0.74, trackR: 0.745, wF: 0.245, wR: 0.245, style: 'multi' },
  mirror: (paint, mats, s) => { const m = mirrorR34(paint, mats, s); m.position.set(0.46, 0.975, s * 0.77); return m; },
  wings: {
    stock: (paint, mats) => r34Wing(paint, mats),
    gt: (paint, mats) => gtWing({ mats, x: -1.90, y: 1.25, deck: 0.995, span: 1.62, chord: 0.30 }),
  },
  wing: 'stock',
  interior: { dx: 0.06, cage: false, wheelZ: 0.36, dashX: 0.55, dashY: 0.87, bench: { x: -0.98, shelfX: -1.43, shelfY: 0.975 } },
  build(body, paint, mats) { // 套件：原廠（什麼都不加）、玩命關頭（照片那台的碳纖維前下巴）、賽道（大下巴＋風刀＋側裙刀片＋擴散器）
    body.add(exhaust(mats, -2.27, 0.28, -0.437, 1.2, 0.85)); // 排氣管在左後（照 Nick 的 R34 車尾照片）
    const amber = new THREE.MeshStandardMaterial({ color: 0xff7a14, roughness: 0.2, emissive: 0x5a2200, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const s of [1, -1]) { // 內側圓尾燈中間的橘色方向燈
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.038, 28), amber); d.rotation.y = -Math.PI / 2; d.position.set(-2.289, 0.787, s * 0.45); body.add(d);
    }
    const lp = lip(mats, [[2.29, 0], [2.28, 0.30], [2.245, 0.49], [2.175, 0.635], [2.07, 0.745], [1.97, 0.80]], 2.0, 0.138);
    const aero = aeroKit(mats, AERO_GTR);
    lp.visible = false; aero.visible = false; body.add(lp, aero);
    return (kit) => { lp.visible = kit === 'bomex'; aero.visible = kit === 'track'; };
  },
  kit: 'bomex',
};

// geos：{ body, noses: { 名字: 車頭網格 } }（Supra 的車頭依套件換；GT-R 沒有分開的車頭）
function buildCar(spec, geos, opt = {}) {
  const car = new THREE.Group();
  const tex = makeMaskTextures(spec.look);
  const paint = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(opt.paint || spec.paint), metalness: spec.metal, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 });
  patchPaint(paint, tex);
  const inside = new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.9, metalness: 0, side: THREE.BackSide });
  patchInside(inside, tex);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b0d10, roughness: 0.04, metalness: 0, transparent: true, opacity: opt.tint ?? 0.34, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.8 });
  patchGlass(glass, tex);

  const body = new THREE.Group(); body.name = 'body';
  const shell = new THREE.Mesh(geos.body, paint); shell.name = 'paint';
  const inner = new THREE.Mesh(geos.body, inside); inner.name = 'inside';
  const glz = new THREE.Mesh(geos.body, glass); glz.name = 'glass'; glz.renderOrder = 2;
  body.add(shell, inner, glz);
  const noses = {};
  for (const [k, g] of Object.entries(geos.noses || {})) {
    const m = new THREE.Mesh(g, paint); m.name = 'nose-' + k;
    body.add(m); noses[k] = m;
  }

  const mats = {
    rubber: MAT.rubber(), chrome: MAT.chrome(), alu: MAT.alu(), disc: MAT.disc(), caliper: MAT.caliper(), black: MAT.black(), gloss: MAT.gloss(),
    barrelIn: new THREE.MeshPhysicalMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 1 }),
    mirrorGlass: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, metalness: 1 }),
    seat: new THREE.MeshStandardMaterial({ color: spec.seat ?? 0x1b3f8f, roughness: 0.8 }),
    cage: new THREE.MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.45, metalness: 0.2 }),
    carbon: MAT.carbon(),
  };
  body.add(interior(mats, spec.interior));
  for (const s of [-1, 1]) body.add(spec.mirror(paint, mats, s));
  const wings = {};
  for (const [k, fn] of Object.entries(spec.wings)) { const w = fn(paint, mats); w.name = 'wing-' + k; w.visible = k === spec.wing; body.add(w); wings[k] = w; }
  const setWing = (k) => { for (const [n, w] of Object.entries(wings)) w.visible = n === k; };
  const applyKit = spec.build(body, paint, mats);
  const setNose = (k) => { for (const [n, m] of Object.entries(noses)) m.visible = n === k; tex.setNose(k); };
  const setKit = (kit) => applyKit(kit, { setNose });
  setKit(spec.kit);
  car.add(body);
  // 寬體（opt.wide＝WIDE[key]，沒有就不能選）：加寬的葉子板＋輪子往外推
  const wide = opt.wide ? wideKit(paint, opt.wide, mats) : null;
  if (wide) { wide.visible = false; body.add(wide); }
  const hubs = [];

  // 前後輪可以不同大小（RF／RR、rimF／rimR，沒寫就用 R、rim）
  const W = spec.wheels, wheels = [];
  for (const [x, track, w, R, rim] of [[W.xf, W.trackF, W.wF, W.RF ?? W.R, W.rimF ?? W.rim], [W.xr, W.trackR, W.wR, W.RR ?? W.R, W.rimR ?? W.rim]]) {
    for (const s of [-1, 1]) {
      const { wheel: wh, brake } = wheel({ R, width: w, rim, mats, style: W.style });
      const hub = new THREE.Group();
      hub.position.set(x, R, s * track);
      if (s < 0) { hub.rotation.y = Math.PI; brake.scale.x = -1; } // 左邊的卡鉗也要在碟盤後面
      hub.add(wh, brake);
      car.add(hub);
      wheels.push(wh); hubs.push({ hub, s, track, ax: x > 0 ? 'f' : 'r' });
    }
  }
  const setWide = (on) => {
    if (!wide) return;
    wide.visible = on;
    for (const h of hubs) h.hub.position.z = h.s * (h.track + (on ? WIDE_PUSH[h.ax] : 0));
  };
  return { car, body, paint, glass, wheels, wings, setWing, noses, setKit, setWide, mats, tex, spec };
}
const buildSupra = (geos, opt = {}) => buildCar(SUPRA_SPEC, geos, opt);

// 載入右半邊的車身，還原成公尺並鏡射成整台
function fullBody(gltfScene, name) {
  gltfScene.updateMatrixWorld(true);
  let src = null; gltfScene.traverse((o) => { if (o.isMesh && !src && (!name || o.name === name)) src = o; });
  if (!src) throw new Error('no mesh ' + name);
  const g0 = src.geometry, m = src.matrixWorld, nm = new THREE.Matrix3().getNormalMatrix(m);
  const p = g0.attributes.position, n = g0.attributes.normal, c = p.count;
  const P = new Float32Array(c * 6), N = new Float32Array(c * 6), v = new THREE.Vector3();
  for (let i = 0; i < c; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m);
    P.set([v.x, v.y, v.z], i * 3); P.set([v.x, v.y, -v.z], (i + c) * 3);
    v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
    N.set([v.x, v.y, v.z], i * 3); N.set([v.x, v.y, -v.z], (i + c) * 3);
  }
  const I0 = g0.index.array, I = new Uint32Array(I0.length * 2);
  I.set(I0);
  for (let t = 0; t < I0.length; t += 3) { I[I0.length + t] = I0[t] + c; I[I0.length + t + 1] = I0[t + 2] + c; I[I0.length + t + 2] = I0[t + 1] + c; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geo.setIndex(new THREE.BufferAttribute(I, 1));
  return geo;
}
// 載入的 glb（Body、Nose_bomex、Nose_stock）→ buildSupra 要的 geos
function carGeos(gltfScene) {
  const names = []; gltfScene.traverse((o) => { if (o.isMesh && o.name.startsWith('Nose_')) names.push(o.name.slice(5)); });
  return { body: fullBody(gltfScene, 'Body'), noses: Object.fromEntries(names.map((k) => [k, fullBody(gltfScene, 'Nose_' + k)])) };
}

// ---- wide.js ----
// 寬體套件的資料（node make-wide.mjs 從車身 SDF 量的，不要手改）：每台車前後輪拱，每個角度 th 從輪拱邊緣 ra 往外每 dr 公尺車身側面的 z（低於 yCut 的點切平在 yCut）
const WIDE = {"supra":{"f":{"x":1.2125,"y":0.325,"th":[-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204],"ra":[0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365],"z":[[0.8213,0.8982,0.896,0.8905,0.8892,0.8882,0.8871,0.8861,0.8849],[0.8298,0.8984,0.896,0.8905,0.8888,0.8878,0.8868,0.8857,0.8845],[0.8472,0.8987,0.8958,0.8903,0.8883,0.8872,0.8861,0.8849,0.8836],[0.8564,0.899,0.8959,0.8903,0.8878,0.8866,0.8854,0.884,0.8825],[0.8647,0.9002,0.8971,0.8917,0.8892,0.8879,0.8865,0.8849,0.8832],[0.8695,0.9026,0.8998,0.895,0.8927,0.8912,0.8895,0.8877,0.8857],[0.8743,0.9056,0.9032,0.8991,0.897,0.8952,0.8933,0.8911,0.8887],[0.877,0.908,0.9057,0.9019,0.8998,0.8978,0.8955,0.8931,0.8905],[0.8798,0.9092,0.9068,0.903,0.9007,0.8985,0.8962,0.8936,0.8908],[0.7698,0.9096,0.907,0.9031,0.9006,0.8982,0.8956,0.8928,0.8898],[0.7688,0.9094,0.9066,0.9023,0.8994,0.8965,0.8934,0.8902,0.8868],[0.7678,0.9085,0.9053,0.9002,0.8964,0.8928,0.889,0.8849,0.8804],[0.8767,0.9068,0.9029,0.8965,0.8915,0.887,0.8821,0.8764,0.8699],[0.8756,0.9043,0.8997,0.8917,0.8852,0.8794,0.8727,0.8647,0.8546],[0.8721,0.9017,0.8963,0.8863,0.8776,0.87,0.8609,0.8493,0.8333],[0.8687,0.8992,0.8931,0.8806,0.8692,0.8595,0.8473,0.8305,0.8046],[0.8652,0.8971,0.8903,0.875,0.8608,0.8488,0.833,0.8093,0.772],[0.863,0.8955,0.8881,0.8698,0.8533,0.8393,0.82,0.7908,0.7458],[0.8601,0.8943,0.8865,0.8661,0.8488,0.8343,0.8145,0.785,0.7409],[0.8587,0.8938,0.8859,0.8653,0.8485,0.835,0.8172,0.7926,0.7565],[0.8591,0.894,0.8863,0.8671,0.8521,0.8407,0.8269,0.8087,0.7831],[0.8612,0.8948,0.8875,0.8707,0.8577,0.8483,0.8374,0.8241,0.8069],[0.8639,0.8959,0.8892,0.8747,0.8636,0.8561,0.8476,0.8377,0.8261],[0.8668,0.8975,0.8913,0.8788,0.8695,0.8634,0.8568,0.8495,0.8412],[0.8697,0.8993,0.8938,0.8832,0.8753,0.8702,0.8649,0.8592,0.8532],[0.8723,0.9013,0.8964,0.8876,0.8811,0.8766,0.872,0.8675,0.8628],[0.8739,0.903,0.8988,0.8915,0.8863,0.8824,0.8785,0.8746,0.8707],[0.8746,0.9042,0.9006,0.8946,0.8905,0.8873,0.884,0.8806,0.8773],[0.8745,0.9048,0.9016,0.8962,0.893,0.8904,0.8877,0.885,0.8822],[0.8744,0.9049,0.9019,0.8968,0.894,0.8918,0.8896,0.8872,0.8849],[0.8744,0.9046,0.9017,0.8968,0.8941,0.8921,0.8901,0.888,0.8858],[0.8734,0.9037,0.9008,0.8959,0.8933,0.8915,0.8896,0.8877,0.8857],[0.8711,0.9018,0.8989,0.8936,0.8911,0.8895,0.8879,0.8862,0.8844],[0.867,0.8993,0.8959,0.8897,0.8868,0.8856,0.8842,0.8829,0.8815],[0.8614,0.8966,0.8925,0.8846,0.8811,0.8827,0.8824,0.8818,0.881],[0.8542,0.894,0.8889,0.8786,0.8763,0.8812,0.8821,0.8819,0.8817],[0.8464,0.892,0.886,0.8738,0.8736,0.8816,0.8837,0.8839,0.884],[0.838,0.8906,0.8835,0.8678,0.8719,0.8815,0.884,0.884,0.884],[0.834,0.89,0.8826,0.8657,0.8714,0.8815,0.884,0.884,0.884]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1765,"zt":0.8775},"r":{"x":-1.3375,"y":0.325,"th":[-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204],"ra":[0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365],"z":[[0.8386,0.9028,0.8945,0.8723,0.876,0.8826,0.884,0.884,0.884],[0.8443,0.9033,0.8955,0.8758,0.8766,0.8826,0.884,0.884,0.884],[0.8564,0.9048,0.8985,0.8846,0.8812,0.8841,0.8846,0.8842,0.884],[0.8675,0.9075,0.9025,0.8923,0.8882,0.8891,0.8888,0.8881,0.8875],[0.8775,0.9114,0.9078,0.9012,0.8983,0.8973,0.8963,0.8952,0.8943],[0.8854,0.9159,0.9135,0.9094,0.9077,0.9068,0.9059,0.9048,0.9036],[0.8918,0.9207,0.9192,0.9166,0.9156,0.9146,0.9136,0.9124,0.9111],[0.8958,0.9251,0.924,0.9224,0.9213,0.9202,0.9188,0.9172,0.9155],[0.8976,0.9286,0.9276,0.926,0.9246,0.923,0.9213,0.9195,0.9174],[0.7818,0.9307,0.9294,0.9277,0.9259,0.9239,0.9221,0.92,0.9177],[0.7844,0.9316,0.93,0.9282,0.9262,0.9239,0.9218,0.9195,0.9169],[0.7871,0.9318,0.9299,0.9279,0.9256,0.9231,0.9204,0.9175,0.9142],[0.9057,0.9315,0.9294,0.9268,0.9239,0.9207,0.9172,0.9133,0.909],[0.9053,0.9307,0.928,0.9244,0.9207,0.9165,0.9119,0.9069,0.9014],[0.9035,0.9291,0.9257,0.9209,0.9162,0.911,0.9053,0.899,0.8922],[0.9018,0.927,0.9228,0.9168,0.911,0.9047,0.8978,0.8903,0.882],[0.8997,0.9248,0.9199,0.9127,0.9057,0.8984,0.8904,0.8814,0.8715],[0.8985,0.9227,0.9173,0.909,0.9008,0.8926,0.8834,0.8731,0.8617],[0.8969,0.9211,0.9153,0.906,0.8968,0.8879,0.8777,0.8663,0.8536],[0.8961,0.9204,0.9145,0.9048,0.8952,0.886,0.8754,0.8635,0.8502],[0.8964,0.9207,0.9149,0.9055,0.8963,0.8873,0.877,0.8653,0.8523],[0.8976,0.922,0.9166,0.9081,0.8998,0.8915,0.8822,0.8716,0.8597],[0.8993,0.9238,0.9189,0.9114,0.9043,0.897,0.8889,0.8797,0.8694],[0.901,0.9257,0.9214,0.9152,0.9093,0.903,0.8961,0.8884,0.8798],[0.9025,0.9275,0.9239,0.9189,0.9141,0.9088,0.903,0.8967,0.8898],[0.9033,0.9288,0.926,0.922,0.9182,0.9139,0.9092,0.9041,0.8986],[0.9037,0.9295,0.9271,0.924,0.921,0.9177,0.9139,0.9099,0.9055],[0.9036,0.9296,0.9275,0.9249,0.9224,0.9196,0.9166,0.9135,0.91],[0.9008,0.9294,0.9274,0.925,0.9228,0.9203,0.9177,0.9151,0.9122],[0.898,0.9284,0.9267,0.9245,0.9225,0.9202,0.9178,0.9155,0.9128],[0.8952,0.9263,0.9248,0.9226,0.9209,0.919,0.9169,0.9147,0.9123],[0.8913,0.9229,0.9213,0.9188,0.9174,0.9159,0.9142,0.9122,0.9101],[0.8874,0.9187,0.9166,0.9131,0.9115,0.9102,0.9087,0.907,0.9051],[0.881,0.9142,0.9113,0.9061,0.9037,0.9024,0.9009,0.8992,0.8974],[0.8751,0.9101,0.9061,0.8982,0.8945,0.8931,0.8915,0.8897,0.8877],[0.8652,0.9067,0.9012,0.8896,0.8844,0.8828,0.8811,0.8792,0.8771],[0.8544,0.9044,0.8972,0.8802,0.8739,0.8721,0.8702,0.8681,0.8659],[0.8318,0.9031,0.8943,0.868,0.8611,0.8582,0.8557,0.8539,0.852],[0.8209,0.9027,0.8931,0.8618,0.8548,0.8513,0.8484,0.8467,0.8449]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1765,"zt":0.8975},"dr":0.02},"gtr":{"f":{"x":1.29,"y":0.327,"th":[-30,-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204,210],"ra":[0.377,0.3758,0.375,0.374,0.373,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372],"z":[[0.8534,0.8628,0.848,0.8404,0.8351,0.8321,0.831,0.8296,0.8279],[0.8595,0.8699,0.8539,0.8451,0.8411,0.8387,0.8375,0.8362,0.8347],[0.8718,0.8854,0.8679,0.8584,0.8569,0.855,0.8481,0.8466,0.8451],[0.8709,0.89,0.8802,0.8733,0.8722,0.8699,0.8506,0.8495,0.849],[0.87,0.8951,0.8908,0.8874,0.8868,0.8843,0.8483,0.8485,0.8493],[0.8707,0.8988,0.8967,0.8957,0.8956,0.8937,0.847,0.8453,0.8462],[0.8723,0.8997,0.8979,0.8971,0.897,0.896,0.8619,0.843,0.8459],[0.8739,0.8997,0.898,0.8972,0.8971,0.8968,0.8796,0.8592,0.8594],[0.874,0.8998,0.8981,0.8973,0.8972,0.8971,0.8964,0.8782,0.8781],[0.874,0.8998,0.8981,0.8973,0.8972,0.8971,0.897,0.8963,0.8943],[0.874,0.8998,0.8981,0.8973,0.8972,0.8971,0.897,0.8969,0.8965],[0.874,0.8998,0.8981,0.8973,0.8972,0.8971,0.897,0.8968,0.8966],[0.874,0.8997,0.898,0.8972,0.8972,0.897,0.8967,0.8958,0.8942],[0.8739,0.8997,0.8979,0.8971,0.8965,0.8951,0.8928,0.8894,0.8851],[0.8738,0.8996,0.8974,0.8953,0.8925,0.8884,0.8832,0.8768,0.8695],[0.871,0.8989,0.8952,0.8899,0.884,0.8769,0.8691,0.8606,0.851],[0.8682,0.8972,0.8908,0.8809,0.8724,0.8639,0.8552,0.8457,0.8318],[0.8655,0.8944,0.885,0.8709,0.8617,0.8534,0.8446,0.8325,0.79],[0.8636,0.8916,0.8796,0.8627,0.8542,0.8464,0.8368,0.8198,0.7248],[0.8598,0.8894,0.8757,0.8574,0.8499,0.8429,0.8329,0.8137,0.6985],[0.8577,0.8887,0.8743,0.8554,0.8487,0.8426,0.8333,0.8158,0.725],[0.8595,0.8893,0.8754,0.8566,0.8499,0.8446,0.8375,0.8255,0.7869],[0.8647,0.8913,0.879,0.8614,0.8535,0.848,0.8426,0.8349,0.8216],[0.8683,0.8941,0.8843,0.8695,0.8602,0.8531,0.8477,0.8423,0.8353],[0.871,0.8967,0.8901,0.8796,0.8706,0.8622,0.8551,0.8494,0.8441],[0.872,0.8983,0.8944,0.8888,0.8825,0.875,0.8672,0.8601,0.854],[0.873,0.8989,0.8966,0.8942,0.8913,0.8869,0.8813,0.8749,0.8683],[0.873,0.8989,0.897,0.896,0.8954,0.8939,0.8915,0.8878,0.8825],[0.873,0.8989,0.897,0.8961,0.896,0.8959,0.8956,0.8946,0.8916],[0.873,0.8989,0.897,0.8961,0.896,0.896,0.8958,0.8957,0.8935],[0.873,0.8989,0.897,0.8961,0.8961,0.896,0.8954,0.8938,0.8898],[0.873,0.8989,0.897,0.8961,0.8961,0.8952,0.8928,0.8883,0.8817],[0.873,0.8989,0.897,0.8961,0.8954,0.8926,0.8872,0.8793,0.8707],[0.8729,0.8989,0.897,0.8958,0.8935,0.888,0.8796,0.8701,0.8618],[0.8712,0.8989,0.8969,0.8951,0.8908,0.8829,0.8728,0.8633,0.8568],[0.8695,0.8979,0.8957,0.8928,0.887,0.8779,0.8676,0.8636,0.8607],[0.8538,0.8944,0.8897,0.8839,0.8779,0.8697,0.8631,0.866,0.8661],[0.8398,0.8896,0.8793,0.8695,0.865,0.8601,0.8602,0.8696,0.872],[0.8247,0.8856,0.8675,0.8548,0.8521,0.8499,0.8545,0.8675,0.8716],[0.8207,0.8693,0.8533,0.8423,0.8388,0.8365,0.8408,0.8511,0.8607],[0.8181,0.8618,0.8471,0.8381,0.8336,0.83,0.8319,0.8418,0.8551]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1385,"zt":0.8625},"r":{"x":-1.375,"y":0.327,"th":[-30,-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204,210],"ra":[0.377,0.3758,0.375,0.374,0.373,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372],"z":[[0.852,0.8615,0.8456,0.8403,0.8455,0.8591,0.8679,0.8687,0.8687],[0.8586,0.8693,0.8537,0.8476,0.8533,0.8633,0.8693,0.8698,0.8698],[0.8718,0.8863,0.8698,0.8636,0.8697,0.8725,0.872,0.872,0.872],[0.8718,0.8921,0.8842,0.8793,0.8811,0.8813,0.8793,0.8771,0.8743],[0.8718,0.8988,0.8957,0.8934,0.8929,0.892,0.8888,0.8846,0.8788],[0.8745,0.9036,0.9026,0.9023,0.9022,0.9018,0.8989,0.893,0.8847],[0.8773,0.9052,0.9045,0.9044,0.9043,0.9041,0.9023,0.8976,0.8903],[0.8801,0.9053,0.9046,0.9045,0.9044,0.9043,0.9036,0.9009,0.8955],[0.8802,0.9053,0.9047,0.9045,0.9044,0.9044,0.9042,0.9031,0.9003],[0.8802,0.9054,0.9047,0.9045,0.9045,0.9044,0.9043,0.9041,0.9031],[0.8803,0.9054,0.9047,0.9046,0.9045,0.9044,0.9043,0.9041,0.904],[0.8803,0.9054,0.9047,0.9045,0.9044,0.9043,0.9042,0.9041,0.904],[0.8803,0.9054,0.9047,0.9045,0.9044,0.9042,0.9041,0.904,0.9038],[0.8803,0.9053,0.9046,0.9044,0.9043,0.9041,0.9039,0.9035,0.9025],[0.8803,0.9053,0.9046,0.9043,0.9041,0.9037,0.9024,0.9002,0.8967],[0.8802,0.9052,0.9045,0.9041,0.9032,0.9011,0.8974,0.8921,0.885],[0.8801,0.9052,0.9043,0.903,0.9002,0.8953,0.8882,0.8794,0.8696],[0.8801,0.9051,0.9034,0.9003,0.8947,0.8866,0.8766,0.8659,0.8555],[0.8801,0.9047,0.9018,0.8961,0.8878,0.8774,0.866,0.855,0.8452],[0.8801,0.9042,0.8996,0.8918,0.8817,0.8701,0.8584,0.8479,0.839],[0.8801,0.904,0.8989,0.8903,0.8797,0.8677,0.856,0.8458,0.8371],[0.8802,0.9044,0.8998,0.892,0.882,0.8704,0.8588,0.8484,0.8394],[0.8803,0.905,0.9021,0.8965,0.8883,0.878,0.8668,0.8558,0.8461],[0.8804,0.9054,0.9038,0.9008,0.8953,0.8873,0.8775,0.8669,0.8566],[0.8806,0.9056,0.9048,0.9036,0.9008,0.8961,0.8891,0.8804,0.8708],[0.8807,0.9058,0.9051,0.9048,0.9039,0.9019,0.8983,0.8931,0.8861],[0.8809,0.9059,0.9053,0.9051,0.9049,0.9045,0.9033,0.9011,0.8976],[0.881,0.9061,0.9055,0.9053,0.9051,0.905,0.9048,0.9044,0.9033],[0.8811,0.9061,0.9056,0.9054,0.9053,0.9051,0.905,0.9048,0.9046],[0.8811,0.9062,0.9056,0.9055,0.9054,0.9052,0.9051,0.9049,0.9047],[0.8812,0.9062,0.9056,0.9055,0.9054,0.9053,0.9051,0.9049,0.9048],[0.8811,0.9062,0.9056,0.9055,0.9054,0.9052,0.9051,0.9049,0.9048],[0.881,0.9061,0.9056,0.9055,0.9053,0.9052,0.9051,0.9049,0.9047],[0.881,0.9061,0.9055,0.9054,0.9053,0.9051,0.905,0.9048,0.9047],[0.7973,0.906,0.9054,0.9053,0.9052,0.905,0.9049,0.9047,0.9044],[0.7813,0.9044,0.9035,0.9032,0.9031,0.9029,0.9027,0.9026,0.9021],[0.7654,0.8996,0.8968,0.8946,0.894,0.8934,0.8928,0.8922,0.8913],[0.833,0.8928,0.8858,0.8793,0.878,0.8769,0.8759,0.8748,0.8735],[0.7654,0.8872,0.8734,0.8622,0.8605,0.8589,0.8572,0.8554,0.8533],[0.6977,0.8704,0.8573,0.8458,0.8409,0.8373,0.8358,0.8342,0.8325],[0.63,0.8628,0.8498,0.839,0.8328,0.8282,0.8267,0.8251,0.8233]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1385,"zt":0.8675},"dr":0.02},"sp3":{"f":{"x":1.21,"y":0.3335,"th":[-30,-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204,210],"ra":[0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985],"z":[[0.9743,0.9808,0.5704,0.5628,0.5548,0.5488,0.5458,0.5431,0.5407],[0.9762,0.9818,0.7044,0.6975,0.6911,0.6858,0.6824,0.6788,0.6751],[0.9817,0.9868,0.8523,0.8477,0.8438,0.8396,0.8352,0.8306,0.8253],[0.9899,0.9948,0.9892,0.9863,0.9839,0.9813,0.9783,0.9747,0.9705],[0.9963,1.0018,0.9996,0.9981,0.9964,0.9945,0.9923,0.9898,0.9868],[0.9991,1.0049,1.0036,1.0025,1.0011,0.9996,0.9977,0.9956,0.993],[0.9993,1.0053,1.0041,1.003,1.0017,1.0003,0.9986,0.9966,0.9943],[0.9997,1.0057,1.0046,1.0037,1.0026,1.0013,0.9997,0.9978,0.9953],[1,1.0062,1.0053,1.0042,1.0032,1.0021,1.0006,0.9986,0.996],[1.0003,1.0065,1.0057,1.0045,1.0036,1.0025,1.001,0.9989,0.996],[1.0004,1.0067,1.0059,1.0045,1.003,1.001,0.9985,0.9952,0.9911],[1.0003,1.006,1.0041,1.0014,0.9982,0.9942,0.9894,0.9838,0.9776],[0.9983,1.0026,0.9981,0.993,0.9869,0.9799,0.9721,0.9634,0.9541],[0.9938,0.9963,0.9872,0.9783,0.9693,0.9594,0.9488,0.9375,0.9254],[0.9872,0.9883,0.9724,0.9604,0.949,0.9368,0.9239,0.91,0.8949],[0.981,0.9818,0.9562,0.9423,0.929,0.9148,0.8995,0.8826,0.8631],[0.9768,0.9783,0.9405,0.9258,0.9108,0.8946,0.8767,0.8556,0.8471],[0.9748,0.977,0.9272,0.9119,0.8954,0.8772,0.8561,0.8289,0.8289],[0.9742,0.9769,0.9175,0.9012,0.8835,0.8635,0.8395,0.8156,0.8156],[0.9742,0.9769,0.9136,0.8971,0.879,0.8587,0.8341,0.8341,0.8341],[0.9742,0.9769,0.9157,0.8997,0.8824,0.863,0.8401,0.8197,0.8197],[0.9743,0.9769,0.9237,0.9089,0.8931,0.8758,0.8563,0.832,0.832],[0.9753,0.9774,0.9349,0.9212,0.907,0.8917,0.8751,0.8564,0.8496],[0.9774,0.9791,0.9483,0.9354,0.9229,0.9097,0.8956,0.8803,0.8634],[0.9808,0.9825,0.962,0.9504,0.9398,0.9286,0.9167,0.9041,0.8906],[0.9843,0.9869,0.9739,0.9646,0.9562,0.9471,0.9373,0.9269,0.9157],[0.987,0.9906,0.9822,0.9758,0.9698,0.963,0.9556,0.9473,0.9382],[0.9883,0.9928,0.987,0.983,0.979,0.9744,0.969,0.963,0.9562],[0.9888,0.9938,0.989,0.9862,0.9836,0.9806,0.977,0.9729,0.9683],[0.9888,0.994,0.9897,0.9872,0.9852,0.9829,0.9802,0.9772,0.9739],[0.9885,0.9937,0.9894,0.9872,0.9855,0.9835,0.9811,0.9785,0.9756],[0.988,0.9931,0.9887,0.9865,0.9848,0.9829,0.9806,0.9782,0.9756],[0.9872,0.9923,0.9875,0.9853,0.9836,0.9816,0.9795,0.9772,0.9748],[0.9865,0.9915,0.9862,0.9837,0.9818,0.9798,0.9777,0.9756,0.9735],[0.986,0.9908,0.9852,0.9825,0.9805,0.9784,0.9762,0.974,0.9717],[0.9856,0.9904,0.9845,0.9817,0.9796,0.9774,0.9752,0.9729,0.9706],[0.9837,0.9882,0.9807,0.9772,0.9748,0.9722,0.9697,0.9671,0.9645],[0.9801,0.984,0.9699,0.9654,0.9623,0.9591,0.9558,0.9525,0.9492],[0.9764,0.9809,0.8434,0.8394,0.8367,0.8341,0.8316,0.8292,0.8269],[0.9743,0.9797,0.7022,0.6972,0.6925,0.6894,0.6889,0.6888,0.6892],[0.9742,0.9808,0.5773,0.5727,0.5677,0.5651,0.5667,0.5687,0.5714]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,8,8,7,8,8,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1342,"zt":0.978},"r":{"x":-1.441,"y":0.37,"th":[-30,-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204,210],"ra":[0.4333,0.4325,0.432,0.431,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.431,0.432,0.433,0.434,0.435,0.435,0.435,0.435,0.435,0.435,0.435],"z":[[0.9737,0.9807,0.8988,0.8928,0.8864,0.8796,0.8784,0.8775,0.8762],[0.9728,0.9802,0.9117,0.9064,0.901,0.8954,0.8933,0.8915,0.8893],[0.971,0.9801,0.9358,0.9314,0.9283,0.925,0.9216,0.9182,0.9146],[0.9586,0.9799,0.951,0.9464,0.9442,0.9419,0.9395,0.9369,0.9341],[0.9476,0.9803,0.9584,0.9534,0.9518,0.9503,0.9486,0.9467,0.9446],[0.939,0.9807,0.9612,0.9563,0.9552,0.954,0.9528,0.9514,0.9498],[0.9409,0.9819,0.9664,0.9622,0.9616,0.9609,0.9602,0.9594,0.9585],[0.9425,0.9847,0.9747,0.9719,0.972,0.9721,0.9721,0.9721,0.9719],[0.953,0.9897,0.9847,0.9838,0.9846,0.9854,0.986,0.9866,0.987],[0.9663,0.9965,0.9952,0.996,0.9972,0.9983,0.9993,1,1.0006],[0.9824,1.0045,1.0052,1.0067,1.008,1.0091,1.0098,1.0103,1.0104],[0.9902,1.0122,1.0137,1.015,1.0159,1.0164,1.0165,1.0161,1.0154],[0.9968,1.0184,1.0196,1.0203,1.0204,1.02,1.0195,1.0184,1.017],[1.0005,1.0224,1.0229,1.0227,1.0222,1.0212,1.0202,1.0188,1.0169],[1.0021,1.0243,1.0241,1.0234,1.0226,1.0212,1.0198,1.018,1.0155],[1.003,1.0248,1.0244,1.0234,1.0222,1.0204,1.0183,1.0152,1.0107],[1.004,1.0248,1.0241,1.0227,1.0209,1.0183,1.0145,1.009,1.0013],[1.0049,1.0245,1.0232,1.0212,1.0184,1.0143,1.0083,0.9998,0.9885],[1.0046,1.0236,1.0217,1.0189,1.0149,1.0088,1.0002,0.9888,0.9744],[1.0033,1.0222,1.0197,1.0163,1.0109,1.003,0.9923,0.9795,0.9641],[1.0021,1.0206,1.0178,1.0138,1.0075,0.9989,0.988,0.9753,0.9604],[0.9999,1.019,1.0159,1.0118,1.0053,0.9973,0.9877,0.9764,0.9635],[0.9986,1.0172,1.0142,1.0102,1.0043,0.9973,0.9896,0.9805,0.9696],[0.9965,1.0152,1.0124,1.0087,1.0037,0.9976,0.9909,0.9833,0.9744],[0.9927,1.0127,1.0102,1.0069,1.0026,0.9972,0.9912,0.9845,0.9769],[0.9889,1.0094,1.0071,1.0042,1.0005,0.996,0.9905,0.9842,0.9774],[0.9838,1.0049,1.0026,1.0001,0.9969,0.9929,0.9881,0.9824,0.976],[0.979,0.9993,0.9962,0.9937,0.9908,0.9872,0.9829,0.9778,0.9721],[0.9701,0.9928,0.9875,0.9842,0.9816,0.9783,0.9743,0.9697,0.9645],[0.9664,0.9866,0.9759,0.9712,0.9687,0.9656,0.962,0.9578,0.953],[0.9668,0.9821,0.9603,0.9553,0.9525,0.9494,0.9458,0.9418,0.9374],[0.9721,0.9796,0.9421,0.9374,0.934,0.9303,0.9264,0.9223,0.9178],[0.975,0.9784,0.9231,0.9188,0.9145,0.9101,0.9055,0.9007,0.8956],[0.9764,0.9774,0.9066,0.9015,0.8962,0.8908,0.8852,0.8794,0.8732],[0.977,0.9762,0.8936,0.8875,0.8813,0.8749,0.8683,0.8614,0.8542],[0.977,0.9754,0.8858,0.8791,0.8722,0.8652,0.8578,0.8501,0.842],[0.977,0.9749,0.8822,0.8749,0.8673,0.8594,0.851,0.842,0.8329],[0.977,0.9749,0.8209,0.814,0.8067,0.7987,0.7898,0.7799,0.8301],[0.977,0.9766,0.7292,0.7222,0.7146,0.7679,0.7585,0.7478,0.7478],[0.977,0.9783,0.6156,0.6065,0.5911,0.5911,0.5911,0.5911,0.5911],[0.977,0.9799,0.5736,0.5627,0.5428,0.5428,0.5428,0.5428,0.5428]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,8,5,5],"yCut":0.1525,"zt":0.988},"dr":0.02},"jesko":{"f":{"x":1.35,"y":0.347,"th":[-30,-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204,210],"ra":[0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377],"z":[[0.9317,0.9411,0.9366,0.9313,0.9267,0.9222,0.9179,0.9138,0.9091],[0.9333,0.9426,0.938,0.9327,0.9276,0.9224,0.9173,0.9121,0.9063],[0.9361,0.9451,0.9404,0.9351,0.9293,0.9229,0.9167,0.9103,0.9033],[0.9374,0.9461,0.941,0.9355,0.9294,0.9228,0.9157,0.9078,0.899],[0.9383,0.9468,0.9415,0.9356,0.9291,0.922,0.9142,0.9056,0.896],[0.9395,0.9479,0.9426,0.9365,0.9297,0.9222,0.9139,0.9048,0.8947],[0.9412,0.9498,0.9447,0.9387,0.9319,0.9243,0.916,0.907,0.8972],[0.9434,0.9524,0.9478,0.9424,0.9362,0.9293,0.9217,0.9135,0.9045],[0.946,0.9554,0.9515,0.9468,0.9415,0.9356,0.929,0.9217,0.9136],[0.9486,0.9586,0.9553,0.9515,0.947,0.9416,0.9353,0.928,0.9202],[0.9509,0.9614,0.9583,0.9545,0.9505,0.9454,0.9391,0.9315,0.9236],[0.9524,0.9631,0.96,0.956,0.9521,0.9469,0.9402,0.9318,0.9229],[0.9531,0.9638,0.9606,0.9559,0.9512,0.9448,0.9367,0.9265,0.9143],[0.9529,0.9632,0.9591,0.9533,0.9462,0.9368,0.9243,0.9238,0.9097],[0.9513,0.9606,0.9544,0.9457,0.9338,0.9167,0.9163,0.9163,0.9163],[0.9471,0.9547,0.9446,0.9303,0.9091,0.9047,0.9047,0.9047,0.9047],[0.9399,0.9448,0.9291,0.9053,0.8951,0.8951,0.8951,0.8951,0.8951],[0.9303,0.9316,0.9074,0.8913,0.8913,0.8913,0.8913,0.8913,0.8913],[0.9192,0.9157,0.8817,0.8817,0.8817,0.8817,0.8817,0.8817,0.8817],[0.9078,0.899,0.8553,0.8553,0.8553,0.8553,0.8553,0.8553,0.8553],[0.9014,0.889,0.8394,0.8394,0.8394,0.8394,0.8394,0.8394,0.8394],[0.9029,0.8912,0.841,0.841,0.841,0.841,0.841,0.841,0.841],[0.9124,0.9052,0.8611,0.8611,0.8611,0.8611,0.8611,0.8611,0.8611],[0.9247,0.9236,0.8909,0.8909,0.8909,0.8909,0.8909,0.8909,0.8909],[0.9362,0.9401,0.919,0.9078,0.9078,0.9078,0.9078,0.9078,0.9078],[0.9455,0.9529,0.941,0.9214,0.9184,0.9184,0.9184,0.9184,0.9184],[0.9515,0.9612,0.9547,0.9452,0.9303,0.9329,0.9329,0.9329,0.9329],[0.9544,0.9651,0.9616,0.957,0.9505,0.9412,0.9449,0.9347,0.9191],[0.9551,0.9663,0.9641,0.9617,0.9585,0.9543,0.9489,0.9416,0.9304],[0.9549,0.9661,0.9644,0.9628,0.9607,0.9583,0.9558,0.9527,0.9487],[0.9543,0.9656,0.964,0.9624,0.9605,0.9586,0.957,0.9552,0.9529],[0.9534,0.9648,0.9633,0.9617,0.96,0.9582,0.9566,0.9549,0.9529],[0.9524,0.9637,0.9622,0.9606,0.959,0.9574,0.9559,0.9543,0.9526],[0.9513,0.9626,0.9611,0.9595,0.9579,0.9563,0.9548,0.9533,0.9519],[0.9502,0.9615,0.96,0.9584,0.9568,0.9552,0.9538,0.9523,0.951],[0.9492,0.9604,0.9589,0.9573,0.9558,0.9543,0.9528,0.9514,0.9502],[0.948,0.9593,0.9578,0.9562,0.9546,0.9531,0.9517,0.9504,0.9492],[0.9464,0.9577,0.9561,0.9545,0.9529,0.9513,0.9498,0.9484,0.9471],[0.9438,0.955,0.9533,0.9514,0.9496,0.9478,0.946,0.9442,0.9425],[0.9394,0.9503,0.948,0.9455,0.9426,0.9409,0.9393,0.9377,0.9362],[0.9369,0.9477,0.9451,0.9421,0.9387,0.9369,0.9354,0.9338,0.9322]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,7,6,5,4,3,3,3,3,3,3,4,5,6,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1585,"zt":0.9825},"r":{"x":-1.35,"y":0.364,"th":[-30,-24,-18,-12,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204,210],"ra":[0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399],"z":[[0.9513,0.9581,0.9548,0.951,0.9502,0.9495,0.949,0.948,0.9466],[0.9513,0.9581,0.9548,0.951,0.9514,0.9513,0.9508,0.9496,0.9479],[0.9414,0.9518,0.9511,0.9509,0.9538,0.9548,0.9544,0.9529,0.9507],[0.928,0.9337,0.9298,0.9311,0.9339,0.9357,0.9365,0.937,0.9371],[0.932,0.9352,0.9201,0.9187,0.9202,0.924,0.9325,0.9388,0.9405],[0.9496,0.9493,0.9318,0.9274,0.9268,0.9291,0.9359,0.9407,0.944],[0.9705,0.975,0.9613,0.9557,0.9533,0.9533,0.9571,0.9585,0.9611],[0.9741,0.9812,0.979,0.9765,0.9738,0.97,0.9646,0.9582,0.9566],[0.9735,0.9805,0.9781,0.9752,0.9716,0.9668,0.9601,0.9513,0.9424],[0.972,0.9786,0.9755,0.9714,0.9662,0.959,0.949,0.9344,0.9128],[0.9694,0.9752,0.9707,0.9647,0.9564,0.9451,0.929,0.9055,0.8668],[0.966,0.9708,0.9644,0.9558,0.9441,0.9277,0.9044,0.8699,0.7655],[0.9623,0.9658,0.9575,0.9462,0.9309,0.9094,0.8794,0.8273,0.6614],[0.9587,0.9611,0.9509,0.9374,0.919,0.8935,0.8584,0.7844,0.5625],[0.9561,0.9577,0.9465,0.9318,0.9125,0.8861,0.8501,0.7706,0.5134],[0.9557,0.9572,0.946,0.9315,0.913,0.8883,0.8549,0.787,0.4695],[0.9574,0.9595,0.9493,0.9364,0.9202,0.8993,0.8715,0.827,0.5705],[0.9605,0.9637,0.9554,0.9445,0.9309,0.9138,0.8916,0.8611,0.7027],[0.9638,0.9683,0.9619,0.9534,0.9427,0.9293,0.9125,0.8908,0.86],[0.967,0.9724,0.9677,0.9617,0.9539,0.9442,0.932,0.9167,0.8974],[0.9697,0.9758,0.9723,0.9681,0.9629,0.9563,0.9482,0.9381,0.9256],[0.9719,0.9784,0.9756,0.9724,0.9688,0.9645,0.9593,0.953,0.9453],[0.9732,0.9801,0.9776,0.9749,0.972,0.9689,0.9653,0.9611,0.9563],[0.9738,0.9808,0.9786,0.9761,0.9735,0.9706,0.9675,0.964,0.9604],[0.9739,0.981,0.9788,0.9765,0.9739,0.9711,0.968,0.9646,0.961],[0.9738,0.9808,0.9787,0.9763,0.9737,0.9708,0.9676,0.9641,0.9603],[0.9733,0.9803,0.9781,0.9756,0.9728,0.9697,0.9662,0.9624,0.9581],[0.9725,0.9794,0.9769,0.9742,0.971,0.9675,0.9635,0.959,0.9539],[0.9713,0.978,0.9753,0.9722,0.9687,0.9646,0.96,0.9547,0.9486],[0.9699,0.9765,0.9736,0.9702,0.9663,0.9618,0.9565,0.9505,0.9437],[0.9684,0.9749,0.9719,0.9683,0.9642,0.9594,0.9539,0.9475,0.9405],[0.9669,0.9733,0.9703,0.9667,0.9626,0.9578,0.9523,0.946,0.9391],[0.9649,0.9714,0.9684,0.9649,0.961,0.9564,0.9512,0.9452,0.9388],[0.9618,0.9684,0.9654,0.962,0.9582,0.9539,0.9491,0.9436,0.9377],[0.9568,0.9632,0.9599,0.9562,0.9521,0.9488,0.9452,0.9411,0.9366],[0.9539,0.9602,0.9567,0.9529,0.9486,0.9458,0.9427,0.9392,0.9355]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1645,"zt":0.9875},"dr":0.02},"gc8":{"f":{"x":1.28,"y":0.307,"th":[-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198],"ra":[0.362,0.3608,0.36,0.359,0.358,0.356,0.355,0.354,0.353,0.352,0.352,0.351,0.35,0.349,0.348,0.347,0.347,0.347,0.347,0.347,0.347,0.347,0.348,0.349,0.35,0.351,0.352,0.352,0.353,0.354,0.355,0.356,0.358,0.359,0.36,0.3608,0.362],"z":[[0.8479,0.8507,0.8244,0.8197,0.8182,0.8164,0.8141,0.8114,0.8081],[0.8484,0.8506,0.826,0.8213,0.82,0.8183,0.8162,0.8136,0.8104],[0.8494,0.8506,0.8289,0.8243,0.8232,0.8218,0.82,0.8178,0.8149],[0.8499,0.8509,0.8308,0.8261,0.8251,0.8238,0.822,0.8199,0.8171],[0.8501,0.8513,0.8321,0.8273,0.8264,0.8252,0.8237,0.8217,0.8193],[0.8499,0.8517,0.833,0.8281,0.8274,0.8264,0.8251,0.8235,0.8214],[0.8498,0.8517,0.8335,0.8288,0.8282,0.8274,0.8263,0.825,0.8234],[0.8497,0.8518,0.8338,0.8292,0.8287,0.828,0.8272,0.8262,0.8249],[0.8505,0.8518,0.834,0.8294,0.8289,0.8283,0.8276,0.8267,0.8257],[0.8511,0.8518,0.834,0.8294,0.829,0.8284,0.8277,0.8269,0.826],[0.8517,0.8516,0.8338,0.8294,0.8289,0.8283,0.8277,0.8269,0.826],[0.8516,0.8515,0.8337,0.8293,0.8287,0.8281,0.8274,0.8266,0.8253],[0.8514,0.8515,0.8334,0.8291,0.8284,0.8277,0.8267,0.8252,0.8229],[0.851,0.8518,0.8334,0.8288,0.828,0.8269,0.8251,0.8223,0.8179],[0.8503,0.852,0.8332,0.8285,0.8274,0.8256,0.8225,0.8177,0.8105],[0.8497,0.8521,0.8331,0.828,0.8264,0.8236,0.819,0.8122,0.8015],[0.8493,0.852,0.8328,0.8274,0.8251,0.8213,0.8155,0.8066,0.7921],[0.8493,0.8518,0.8325,0.8268,0.8242,0.8199,0.8134,0.8036,0.7875],[0.8493,0.8516,0.8322,0.8266,0.8241,0.82,0.8138,0.8045,0.7896],[0.8493,0.8517,0.8323,0.8269,0.8249,0.8216,0.8166,0.8091,0.7978],[0.8493,0.8519,0.8326,0.8274,0.826,0.8237,0.8201,0.8147,0.8069],[0.8497,0.852,0.8329,0.8279,0.8268,0.8254,0.8231,0.8197,0.8147],[0.8503,0.8519,0.8331,0.8284,0.8275,0.8265,0.8252,0.8232,0.8203],[0.851,0.8517,0.8333,0.8288,0.8281,0.8274,0.8265,0.8254,0.8239],[0.8514,0.8514,0.8336,0.8293,0.8287,0.8281,0.8274,0.8267,0.8258],[0.8516,0.8515,0.834,0.8297,0.8292,0.8287,0.8282,0.8276,0.827],[0.8517,0.8517,0.8343,0.83,0.8296,0.8292,0.8288,0.8284,0.828],[0.8511,0.852,0.8345,0.8301,0.8298,0.8295,0.8293,0.829,0.8287],[0.8505,0.852,0.8345,0.8301,0.8299,0.8297,0.8295,0.8293,0.8291],[0.8498,0.852,0.8345,0.8301,0.8299,0.8297,0.8295,0.8294,0.8293],[0.8499,0.852,0.8344,0.83,0.8298,0.8296,0.8295,0.8294,0.8293],[0.85,0.852,0.8341,0.8297,0.8296,0.8305,0.8311,0.8311,0.831],[0.8502,0.8516,0.8335,0.8292,0.8332,0.8392,0.8417,0.8419,0.8419],[0.85,0.8512,0.8324,0.8283,0.837,0.848,0.8523,0.8528,0.8528],[0.8495,0.8508,0.8306,0.8276,0.8408,0.8557,0.8613,0.862,0.862],[0.8485,0.8508,0.8276,0.8249,0.8373,0.8537,0.8605,0.8615,0.861],[0.848,0.8508,0.826,0.8238,0.8355,0.8527,0.8602,0.8612,0.8604]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1951,"zt":0.875},"r":{"x":-1.24,"y":0.307,"th":[-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198],"ra":[0.362,0.3608,0.36,0.359,0.358,0.356,0.355,0.354,0.353,0.352,0.352,0.351,0.35,0.349,0.348,0.347,0.347,0.347,0.347,0.347,0.347,0.347,0.348,0.349,0.35,0.351,0.352,0.352,0.353,0.354,0.355,0.356,0.358,0.359,0.36,0.3608,0.362],"z":[[0.8509,0.8633,0.8611,0.8618,0.862,0.8619,0.8617,0.8612,0.8604],[0.8512,0.8635,0.8613,0.8619,0.862,0.862,0.8618,0.8615,0.861],[0.852,0.8639,0.8617,0.862,0.862,0.862,0.862,0.862,0.862],[0.8517,0.8621,0.8555,0.8529,0.8529,0.8528,0.8528,0.8528,0.8528],[0.8511,0.8581,0.8462,0.842,0.842,0.8419,0.8419,0.8419,0.8418],[0.8503,0.8541,0.837,0.8312,0.8311,0.8311,0.831,0.8309,0.8309],[0.8498,0.8518,0.8339,0.8296,0.8295,0.8294,0.8293,0.8292,0.8291],[0.8497,0.8518,0.8341,0.8297,0.8295,0.8294,0.8293,0.8292,0.8291],[0.8504,0.8518,0.8341,0.8297,0.8295,0.8294,0.8292,0.8291,0.829],[0.8511,0.8518,0.8341,0.8297,0.8294,0.8292,0.829,0.8288,0.8285],[0.8516,0.8515,0.8338,0.8295,0.8292,0.8289,0.8285,0.8281,0.8277],[0.8516,0.8514,0.8335,0.8292,0.8288,0.8283,0.8278,0.8273,0.8267],[0.8514,0.8513,0.8331,0.8288,0.8283,0.8277,0.827,0.8263,0.8254],[0.8509,0.8516,0.8328,0.8284,0.8277,0.8269,0.8261,0.8251,0.8239],[0.8502,0.8518,0.8326,0.8279,0.8271,0.8261,0.825,0.8236,0.822],[0.8496,0.8519,0.8325,0.8275,0.8265,0.8253,0.8238,0.822,0.8199],[0.8493,0.8518,0.8323,0.8271,0.8259,0.8244,0.8227,0.8205,0.8178],[0.8493,0.8517,0.8321,0.8267,0.8254,0.8237,0.8216,0.8191,0.816],[0.8493,0.8516,0.832,0.8266,0.8252,0.8235,0.8213,0.8186,0.8154],[0.8493,0.8517,0.8322,0.8268,0.8255,0.8238,0.8217,0.8192,0.8161],[0.8493,0.8519,0.8325,0.8273,0.8261,0.8246,0.8228,0.8207,0.818],[0.8496,0.852,0.8328,0.8278,0.8267,0.8255,0.824,0.8222,0.8201],[0.8503,0.8519,0.8329,0.8282,0.8273,0.8263,0.8251,0.8237,0.822],[0.851,0.8517,0.833,0.8285,0.8277,0.8269,0.8259,0.8248,0.8234],[0.8514,0.8514,0.8331,0.8287,0.828,0.8272,0.8263,0.8254,0.8243],[0.8516,0.8514,0.8332,0.8288,0.8281,0.8273,0.8265,0.8256,0.8246],[0.8517,0.8515,0.8333,0.8288,0.8281,0.8273,0.8265,0.8256,0.8247],[0.8511,0.8516,0.8333,0.8287,0.828,0.8273,0.8265,0.8256,0.8246],[0.8504,0.8516,0.8332,0.8285,0.8278,0.8271,0.8262,0.8254,0.8244],[0.8497,0.8515,0.8328,0.8281,0.8274,0.8266,0.8258,0.8249,0.8239],[0.8497,0.8514,0.8322,0.8275,0.8267,0.8259,0.825,0.8241,0.823],[0.8498,0.8513,0.8315,0.8267,0.8259,0.8251,0.8241,0.823,0.8218],[0.85,0.8509,0.8305,0.8258,0.825,0.8241,0.823,0.8218,0.8205],[0.8497,0.8504,0.8293,0.8247,0.8238,0.8228,0.8217,0.8204,0.819],[0.8493,0.8502,0.8273,0.8228,0.8217,0.8205,0.8191,0.8175,0.8156],[0.8483,0.8503,0.8233,0.8183,0.8163,0.8138,0.8108,0.807,0.8015],[0.8478,0.8505,0.8211,0.8158,0.8132,0.8101,0.8062,0.8011,0.7936]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1951,"zt":0.87},"dr":0.02},"p918":{"f":{"x":1.3135,"y":0.347,"th":[-30,-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204,210],"ra":[0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387],"z":[[0.9202,0.951,0.9188,0.9127,0.9085,0.9058,0.9034,0.9007,0.8976],[0.9261,0.9512,0.923,0.9167,0.9129,0.91,0.9071,0.9039,0.9002],[0.9375,0.9517,0.9305,0.9238,0.9206,0.9171,0.9131,0.9086,0.9034],[0.9389,0.9523,0.9339,0.927,0.9237,0.92,0.9158,0.9109,0.9054],[0.9397,0.9526,0.9357,0.9287,0.9253,0.9214,0.9168,0.9115,0.9056],[0.9402,0.953,0.9369,0.9299,0.9265,0.9226,0.918,0.9127,0.9067],[0.9407,0.9533,0.9382,0.9314,0.9282,0.9245,0.9202,0.9152,0.9093],[0.9413,0.9538,0.9398,0.9333,0.9304,0.927,0.9232,0.9187,0.9136],[0.9419,0.9542,0.9413,0.9353,0.9327,0.9298,0.9265,0.9228,0.9185],[0.9424,0.9547,0.9427,0.9371,0.9349,0.9323,0.9292,0.9256,0.9218],[0.9428,0.955,0.9437,0.9384,0.9362,0.9338,0.9307,0.9269,0.9234],[0.943,0.9553,0.9442,0.939,0.9367,0.9344,0.9311,0.9267,0.9221],[0.9431,0.9553,0.9444,0.9391,0.9365,0.9334,0.9289,0.9229,0.9152],[0.9431,0.9554,0.9442,0.9382,0.9344,0.9294,0.9222,0.9122,0.8975],[0.943,0.9552,0.943,0.9352,0.9292,0.9207,0.9086,0.891,0.8865],[0.9427,0.9547,0.9401,0.9296,0.9203,0.9071,0.8881,0.8608,0.8608],[0.9419,0.9539,0.9354,0.9219,0.9089,0.8903,0.8636,0.8437,0.8437],[0.9409,0.953,0.9295,0.9137,0.8969,0.8733,0.8383,0.8383,0.8383],[0.9399,0.9522,0.9237,0.907,0.8881,0.8621,0.8228,0.8228,0.8228],[0.9394,0.9519,0.9214,0.905,0.8863,0.8612,0.8234,0.8234,0.8234],[0.9394,0.9519,0.9231,0.9078,0.8916,0.8699,0.839,0.839,0.839],[0.94,0.9524,0.9281,0.9144,0.9013,0.8839,0.8608,0.8445,0.8445],[0.9407,0.953,0.9333,0.9215,0.9115,0.8984,0.8813,0.8583,0.8583],[0.9414,0.9537,0.9377,0.9282,0.9209,0.9116,0.8995,0.884,0.8799],[0.9419,0.9542,0.9408,0.9334,0.9287,0.9224,0.9143,0.904,0.8906],[0.9423,0.9547,0.9427,0.9369,0.9339,0.9301,0.9251,0.9185,0.9102],[0.9425,0.955,0.9438,0.9387,0.9369,0.9345,0.9316,0.9278,0.9229],[0.9427,0.9551,0.9443,0.9396,0.9381,0.9365,0.9346,0.9324,0.9296],[0.9428,0.9552,0.9446,0.94,0.9386,0.9371,0.9355,0.9338,0.932],[0.9428,0.9552,0.9446,0.94,0.9386,0.9372,0.9357,0.934,0.9324],[0.9428,0.9552,0.9445,0.9399,0.9385,0.9371,0.9355,0.9339,0.9323],[0.9426,0.9551,0.9443,0.9396,0.9382,0.9367,0.9352,0.9335,0.9319],[0.9424,0.9549,0.9437,0.9389,0.9375,0.936,0.9344,0.9328,0.9311],[0.942,0.9545,0.9429,0.9379,0.9365,0.9349,0.9333,0.9316,0.9299],[0.9416,0.9542,0.942,0.9369,0.9354,0.9338,0.9321,0.9305,0.9287],[0.9412,0.9539,0.941,0.9358,0.9343,0.9327,0.931,0.9294,0.9276],[0.9407,0.9535,0.9399,0.9345,0.933,0.9314,0.9297,0.9281,0.9266],[0.9398,0.953,0.9378,0.9323,0.9308,0.9295,0.9282,0.9269,0.9259],[0.9383,0.9522,0.9338,0.9281,0.9275,0.9275,0.927,0.926,0.9255],[0.9269,0.9515,0.9255,0.9197,0.9187,0.922,0.925,0.9255,0.9253],[0.921,0.9511,0.9208,0.915,0.9142,0.9196,0.9244,0.9254,0.9252]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,8,8,7,7,7,7,8,8,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1535,"zt":0.9645},"r":{"x":-1.4165,"y":0.364,"th":[-30,-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204,210],"ra":[0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404],"z":[[0.9451,0.9524,0.9295,0.9267,0.9279,0.9284,0.9279,0.9274,0.9269],[0.9459,0.953,0.934,0.9309,0.9314,0.9314,0.9308,0.9301,0.9295],[0.9474,0.9541,0.9422,0.939,0.9383,0.9374,0.9365,0.9355,0.9347],[0.9487,0.9556,0.9464,0.9435,0.9428,0.9421,0.9413,0.9406,0.9398],[0.9496,0.9567,0.9487,0.9462,0.9456,0.9451,0.9445,0.9439,0.9433],[0.9501,0.9572,0.9498,0.9475,0.947,0.9465,0.946,0.9454,0.9448],[0.9504,0.9576,0.9504,0.9482,0.9477,0.9472,0.9466,0.946,0.9454],[0.9506,0.9578,0.9508,0.9486,0.9481,0.9475,0.9468,0.9463,0.9457],[0.9507,0.9579,0.9509,0.9487,0.9482,0.9476,0.9467,0.9455,0.9443],[0.9507,0.9579,0.9508,0.9486,0.948,0.9474,0.9465,0.9447,0.9429],[0.9506,0.9578,0.9506,0.9482,0.9475,0.9468,0.9458,0.9439,0.9415],[0.9504,0.9575,0.9499,0.9473,0.9464,0.9456,0.9446,0.9431,0.9409],[0.95,0.9569,0.9487,0.9458,0.9446,0.9434,0.942,0.9402,0.9376],[0.9494,0.9562,0.9471,0.9434,0.9415,0.9392,0.9361,0.932,0.9262],[0.9488,0.9553,0.9444,0.9391,0.9353,0.93,0.9221,0.9061,0.8706],[0.948,0.9541,0.9395,0.9309,0.9224,0.9058,0.8695,0.8188,0.7766],[0.947,0.9525,0.9301,0.9149,0.8872,0.8387,0.7799,0.7272,0.6871],[0.9459,0.951,0.9132,0.8787,0.8201,0.7523,0.6943,0.6518,0.6388],[0.9449,0.9499,0.8836,0.8233,0.7404,0.6783,0.6466,0.6364,0.6215],[0.9444,0.9494,0.8457,0.7606,0.6809,0.6481,0.6376,0.6252,0.5876],[0.9442,0.9493,0.8183,0.7275,0.6591,0.6435,0.6325,0.6117,0.5533],[0.9442,0.9493,0.8184,0.7344,0.6674,0.6458,0.6325,0.6086,0.5289],[0.9445,0.9494,0.8462,0.777,0.7046,0.6604,0.6396,0.617,0.5545],[0.9451,0.95,0.8825,0.832,0.7653,0.7068,0.6676,0.6384,0.5937],[0.9462,0.9513,0.9127,0.881,0.8372,0.78,0.7293,0.6878,0.6523],[0.9477,0.9533,0.9317,0.9157,0.892,0.8583,0.8137,0.7689,0.7268],[0.9489,0.9552,0.9421,0.9336,0.9251,0.91,0.887,0.8574,0.8183],[0.9498,0.9565,0.9471,0.9422,0.9387,0.9339,0.927,0.9154,0.8973],[0.9504,0.9574,0.9494,0.9462,0.9446,0.9426,0.94,0.9367,0.9323],[0.9508,0.9579,0.9505,0.9479,0.9469,0.9458,0.9445,0.943,0.9411],[0.951,0.9582,0.9511,0.9486,0.9478,0.9468,0.9457,0.9445,0.9432],[0.9511,0.9582,0.9513,0.9489,0.9481,0.9472,0.9461,0.9449,0.9435],[0.951,0.9582,0.9513,0.949,0.9482,0.9472,0.9462,0.945,0.9435],[0.9509,0.9581,0.9511,0.9488,0.948,0.947,0.946,0.9447,0.9433],[0.9507,0.9579,0.9507,0.9483,0.9475,0.9465,0.9454,0.9441,0.9426],[0.9503,0.9575,0.95,0.9475,0.9466,0.9456,0.9445,0.9431,0.9415],[0.9498,0.9569,0.9488,0.9461,0.9452,0.9442,0.943,0.9416,0.9399],[0.9489,0.9558,0.9466,0.9435,0.9424,0.9413,0.94,0.9385,0.9368],[0.9476,0.9542,0.9423,0.9384,0.937,0.9355,0.9339,0.932,0.93],[0.946,0.953,0.934,0.929,0.9265,0.9243,0.923,0.9216,0.9201],[0.9452,0.9524,0.9293,0.9237,0.9205,0.918,0.9168,0.9155,0.914]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.162,"zt":0.9685},"dr":0.02},"yaris":{"f":{"x":1.17,"y":0.319,"th":[-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204],"ra":[0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364],"z":[[0.8379,0.8462,0.8452,0.8439,0.8424,0.8405,0.8385,0.8378,0.837],[0.8392,0.8476,0.8468,0.8459,0.8447,0.8432,0.8417,0.841,0.8401],[0.8419,0.8505,0.8501,0.8496,0.8491,0.8485,0.8478,0.847,0.8459],[0.8442,0.8529,0.8524,0.8519,0.8513,0.8507,0.8501,0.8494,0.8484],[0.8471,0.8557,0.855,0.8542,0.8535,0.8527,0.852,0.8511,0.8501],[0.8508,0.8592,0.8582,0.8571,0.856,0.855,0.8539,0.8529,0.8517],[0.855,0.8634,0.8621,0.8607,0.8593,0.8579,0.8565,0.855,0.8536],[0.8594,0.8677,0.8662,0.8645,0.8628,0.8611,0.8593,0.8575,0.8557],[0.8638,0.8718,0.87,0.8681,0.8661,0.864,0.8618,0.8596,0.8575],[0.8676,0.8754,0.8733,0.871,0.8686,0.8661,0.8635,0.8609,0.8584],[0.8708,0.8783,0.8758,0.8731,0.8703,0.8673,0.8644,0.8615,0.8587],[0.8733,0.8804,0.8775,0.8744,0.8711,0.8678,0.8646,0.8616,0.8587],[0.8751,0.8817,0.8784,0.8749,0.8713,0.8679,0.8646,0.8614,0.8583],[0.8763,0.8825,0.8788,0.875,0.8713,0.8677,0.8641,0.8606,0.8572],[0.877,0.8829,0.8789,0.875,0.8711,0.8671,0.8631,0.8591,0.8552],[0.8775,0.8831,0.8789,0.8748,0.8705,0.8661,0.8616,0.8571,0.8527],[0.8778,0.8831,0.8788,0.8743,0.8696,0.8647,0.8598,0.8548,0.8499],[0.8781,0.8832,0.8786,0.8738,0.8687,0.8634,0.858,0.8527,0.8474],[0.8783,0.8834,0.8786,0.8734,0.868,0.8624,0.8567,0.851,0.8454],[0.8786,0.8838,0.8789,0.8736,0.8681,0.8623,0.8565,0.8506,0.8447],[0.879,0.8843,0.8795,0.8743,0.8688,0.8631,0.8573,0.8514,0.8456],[0.8792,0.8847,0.8802,0.8753,0.87,0.8646,0.859,0.8534,0.8478],[0.8794,0.8851,0.8809,0.8763,0.8714,0.8663,0.8611,0.8558,0.8505],[0.8794,0.8853,0.8813,0.8771,0.8727,0.868,0.8631,0.8582,0.8534],[0.8793,0.8854,0.8815,0.8776,0.8735,0.8692,0.8649,0.8604,0.856],[0.879,0.8852,0.8815,0.8778,0.8739,0.8699,0.866,0.862,0.8581],[0.8781,0.8847,0.8813,0.8777,0.8739,0.8702,0.8664,0.8628,0.8592],[0.8765,0.8835,0.8805,0.8772,0.8737,0.8701,0.8665,0.8631,0.8596],[0.874,0.8814,0.8788,0.8759,0.8728,0.8695,0.8662,0.8629,0.8596],[0.8705,0.8782,0.876,0.8735,0.8708,0.868,0.8651,0.8622,0.8592],[0.8661,0.8741,0.8721,0.87,0.8677,0.8654,0.8629,0.8605,0.858],[0.861,0.8691,0.8674,0.8656,0.8637,0.8617,0.8597,0.8577,0.8557],[0.8555,0.8638,0.8623,0.8607,0.8591,0.8575,0.8559,0.8543,0.8528],[0.8501,0.8585,0.8572,0.8558,0.8545,0.8533,0.8521,0.851,0.8501],[0.8453,0.8537,0.8526,0.8516,0.8507,0.8498,0.8491,0.8484,0.8479],[0.8413,0.8498,0.849,0.8483,0.8477,0.8472,0.8467,0.8463,0.846],[0.8384,0.8469,0.8463,0.8458,0.8453,0.8448,0.8444,0.844,0.8435],[0.8356,0.8439,0.8431,0.8422,0.8411,0.8398,0.8385,0.8381,0.8377],[0.8344,0.8426,0.8416,0.8404,0.839,0.8373,0.8355,0.8351,0.8346]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1709,"zt":0.88},"r":{"x":-1.39,"y":0.319,"th":[-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198],"ra":[0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379],"z":[[0.8378,0.8458,0.8441,0.8423,0.8402,0.8375,0.8343,0.8336,0.833],[0.8408,0.849,0.8475,0.8459,0.8441,0.842,0.8395,0.8387,0.838],[0.8472,0.8557,0.8546,0.8534,0.8523,0.8512,0.8502,0.8491,0.8481],[0.8536,0.8622,0.8612,0.8601,0.859,0.8579,0.8568,0.8557,0.8546],[0.8602,0.869,0.8681,0.8671,0.866,0.8649,0.8638,0.8626,0.8614],[0.8668,0.8757,0.8749,0.874,0.873,0.8719,0.8708,0.8696,0.8683],[0.8732,0.8821,0.8814,0.8806,0.8797,0.8786,0.8775,0.8762,0.8749],[0.879,0.8879,0.8873,0.8866,0.8857,0.8846,0.8834,0.882,0.8806],[0.8842,0.893,0.8924,0.8916,0.8906,0.8895,0.8881,0.8866,0.8849],[0.8884,0.8972,0.8965,0.8956,0.8944,0.8931,0.8915,0.8898,0.8878],[0.8917,0.9003,0.8994,0.8983,0.897,0.8954,0.8935,0.8914,0.8892],[0.8941,0.9024,0.9014,0.9,0.8983,0.8964,0.8944,0.892,0.8896],[0.8956,0.9036,0.9023,0.9007,0.8989,0.8968,0.8946,0.8921,0.8895],[0.8963,0.9042,0.9027,0.9009,0.899,0.8968,0.8944,0.8918,0.889],[0.8965,0.9043,0.9027,0.9009,0.8988,0.8964,0.8938,0.8908,0.8876],[0.8965,0.9042,0.9025,0.9005,0.8982,0.8955,0.8925,0.8891,0.8853],[0.8963,0.9039,0.902,0.8997,0.8971,0.894,0.8905,0.8867,0.8824],[0.8959,0.9032,0.9011,0.8985,0.8955,0.8921,0.8883,0.884,0.8793],[0.8951,0.9022,0.8999,0.8971,0.8938,0.8901,0.8859,0.8813,0.8763],[0.894,0.901,0.8984,0.8955,0.892,0.8881,0.8838,0.879,0.8736],[0.8926,0.8996,0.897,0.8939,0.8904,0.8864,0.8819,0.877,0.8716],[0.8911,0.8981,0.8955,0.8924,0.8889,0.8849,0.8805,0.8756,0.8703],[0.8895,0.8965,0.8939,0.8909,0.8875,0.8837,0.8794,0.8747,0.8696],[0.8877,0.8948,0.8923,0.8894,0.886,0.8822,0.8779,0.8733,0.8682],[0.8854,0.8924,0.8898,0.8867,0.8831,0.8791,0.8747,0.8699,0.8647],[0.8817,0.8885,0.8855,0.882,0.878,0.8737,0.8689,0.8638,0.8584],[0.8763,0.8825,0.879,0.875,0.8706,0.8659,0.8609,0.8558,0.8505],[0.8692,0.875,0.8709,0.8666,0.8619,0.8571,0.8521,0.847,0.8419],[0.8612,0.8666,0.8622,0.8577,0.8529,0.8481,0.8431,0.8379,0.8323],[0.8529,0.8581,0.8536,0.849,0.8442,0.8392,0.8338,0.8276,0.8191],[0.8451,0.8503,0.8458,0.8411,0.8361,0.8304,0.8237,0.8151,0.803],[0.8385,0.8438,0.8394,0.8345,0.8287,0.8215,0.8122,0.8,0.7836],[0.8338,0.8392,0.8346,0.8291,0.822,0.8127,0.8002,0.7844,0.7646],[0.8309,0.8362,0.8313,0.8249,0.8165,0.8049,0.7897,0.7707,0.7465],[0.8292,0.8343,0.829,0.822,0.8127,0.7996,0.7826,0.7616,0.7326],[0.828,0.833,0.8276,0.8205,0.8109,0.797,0.7796,0.7577,0.7264],[0.8258,0.8312,0.8271,0.82,0.8105,0.7965,0.7965,0.7965,0.7965],[0.8248,0.8304,0.8304,0.8304,0.8304,0.8304,0.8304,0.8304,0.8304]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,6,2],"yCut":0.1648,"zt":0.895},"dr":0.02}};

// ---- sp3-look.js ----
// 3D 法拉利 Daytona SP3 的表面細節（投影貼圖），做法跟 GT-R 一樣。
// 位置是照 Nick 那兩張紅色 SP3 照片量的：照片上的點從相機打光線到車身（sp3d/hit.mjs）。

const SP3_LOOK = (() => {
  const M = (pts) => pts.map(([u, y]) => [-u, y]); // 左右鏡射
  const rrect = (g, x0, y0, x1, y1, r) => { g.beginPath(); g.roundRect(x0, y0, x1 - x0, y1 - y0, r); };

  // ---- 側面（x, y）：車窗一片（前面沿 A 柱斜、後面幾乎垂直），上面黑色車頂邊，下面黑色碳纖維側裙 ----
  const DLO = [[0.80, 0.866], [0.70, 0.905], [0.58, 0.965], [0.47, 1.025], [0.40, 1.058], [0.25, 1.068], [0.10, 1.066], [0.03, 1.05],
    [0.005, 0.98], [0.0, 0.88], [0.20, 0.862], [0.50, 0.862]];
  const CABIN = [[0.95, 0.84], [0.80, 0.866], [0.40, 1.06], [0.0, 1.075], [-0.50, 1.07], [-0.95, 1.04], [-1.05, 1.02], [-1.05, 1.30], [0.95, 1.30]];
  function side() {
    return layers(BOX.side, [
      (g) => { smooth(g, DLO); g.fill(); },
      (g) => { // 黑色
        poly(g, CABIN.map(([x, y]) => [x, Math.max(y, y > 1.0 ? y : y)])); g.save(); g.clip();
        g.fillRect(-1.2, 1.052, 2.4, 0.3); g.restore(); // 車頂（碳纖維）的側邊
        g.lineJoin = 'round'; g.lineWidth = 0.022; smooth(g, DLO); g.stroke(); // 車窗黑邊、A 柱
        line(g, [[0.84, 0.855], [0.62, 0.95], [0.42, 1.06]], 0.03);
        poly(g, [[0.84, 0.30], [0.84, 0.13], [-1.02, 0.13], [-1.02, 0.30], [-0.80, 0.34], [-0.30, 0.285], [0.40, 0.268]]); g.fill(); // 碳纖維側裙
        poly(g, [[-0.60, 0.33], [-0.66, 0.62], [-0.74, 0.66], [-0.82, 0.60], [-0.80, 0.33]]); g.fill(); // 側面大進氣口（後輪前）
      },
      (g) => { // 縫
        line(g, [[0.82, 0.86], [0.66, 0.80], [0.62, 0.62], [0.63, 0.40], [0.66, 0.31]], 0.005); // 車門前緣
        line(g, [[0.01, 0.875], [-0.12, 0.80], [-0.30, 0.66], [-0.40, 0.45], [-0.38, 0.31]], 0.005); // 車門後緣
        line(g, [[-0.38, 0.31], [0.66, 0.31]], 0.004);
      },
      null,
    ]);
  }

  // ---- 正面（u＝|z|，y）：細長大燈（眼皮下）、下面黑色燈殼＋一條白色日行燈、整片黑色水箱罩網、角落紅色橫鰭之間的黑縫、碳纖維下巴 ----
  const HEAD = [[0.862, 0.588], [0.885, 0.632], [0.915, 0.660], [0.945, 0.667], [0.964, 0.652], [0.976, 0.612], [0.957, 0.574], [0.92, 0.553], [0.885, 0.549]];
  const HOUSING = [[0.72, 0.532], [0.76, 0.556], [0.84, 0.572], [0.875, 0.556], [0.93, 0.556], [0.975, 0.575], [0.99, 0.60], [0.995, 0.50], [0.935, 0.482], [0.85, 0.472], [0.79, 0.484], [0.73, 0.50]];
  const DRL = [[0.735, 0.505], [0.79, 0.49], [0.847, 0.478], [0.90, 0.479], [0.94, 0.488]];
  const FVENT = [[0.66, 0.625], [0.70, 0.655], [0.76, 0.705], [0.81, 0.75], [0.835, 0.785], [0.83, 0.81], [0.80, 0.80], [0.75, 0.765], [0.70, 0.715], [0.665, 0.672], [0.65, 0.64]];
  const GRILLE = [[-0.66, 0.428], [0.66, 0.428], [0.70, 0.40], [0.66, 0.15], [-0.66, 0.15], [-0.70, 0.40]];
  function front() {
    return layers(BOX.front, [
      (g) => { // R：燈
        for (const P of [HEAD, M(HEAD)]) { smooth(g, P); g.fill(); }
        for (const P of [DRL, M(DRL)]) line(g, P, 0.011);
      },
      (g) => { // G：黑色
        for (const P of [HOUSING, M(HOUSING)]) { smooth(g, P); g.fill(); }
        smooth(g, GRILLE); g.fill();
        for (const P of [FVENT, M(FVENT)]) { smooth(g, P); g.fill(); } // 引擎蓋通風口（在葉子板內側斜坡上，從正面看得到）
        g.fillRect(-1.1, -0.1, 2.2, 0.245); // 下巴
        for (const s of [1, -1]) for (let k = 0; k < 6; k++) { // 角落橫鰭之間的縫
          const y = 0.262 + k * 0.034;
          poly(g, [[0.64 * s, y], [1.0 * s, y + 0.006], [1.0 * s, y + 0.019], [0.64 * s, y + 0.014]]); g.fill();
        }
        g.lineWidth = 0.006; for (const P of [HEAD, M(HEAD)]) { smooth(g, P); g.stroke(); }
      },
      null,
      (g) => { // A：燈裡面暗的部分、水箱罩的網
        for (const s of [1, -1]) { // 燈殼裡面暗，上緣留一條亮的 LED，中間兩顆投射燈
          g.save(); smooth(g, HEAD.map(([u, y]) => [u * s, y])); g.clip();
          g.fillStyle = '#fff'; g.fillRect(0.84 * s - (s < 0 ? 0.16 : 0), 0.53, 0.16, 0.105);
          g.fillStyle = '#000'; for (const u of [0.905, 0.945]) { g.beginPath(); g.ellipse(u * s, 0.598, 0.017, 0.016, 0, 0, Math.PI * 2); g.fill(); }
          g.restore(); g.fillStyle = '#fff';
        }
        g.save(); smooth(g, GRILLE); g.clip(); g.globalAlpha = 0.38;
        for (let k = -1.4; k < 1.4; k += 0.016) { line(g, [[k, 0.1], [k + 0.36, 0.46]], 0.003); line(g, [[k, 0.46], [k + 0.36, 0.1]], 0.003); }
        g.restore();
      },
    ]);
  }

  // ---- 後面（u＝z，y）：百葉那一片的底是黑的（橫鰭、尾燈、排氣管、倒車燈是另外的零件）、下面黑色保桿和擴散器、兩邊角落紅色反光片 ----
  function rear() {
    return layers(BOX.rear, [
      (g) => { for (const s of [1, -1]) { rrect(g, s > 0 ? 0.62 : -0.84, 0.478, s > 0 ? 0.84 : -0.62, 0.494, 0.006); g.fill(); } }, // 反光片
      (g) => {
        rrect(g, -0.88, 0.56, 0.88, 0.95, 0.03); g.fill();
        poly(g, [[-0.96, 0.10], [0.96, 0.10], [0.96, 0.59], [-0.96, 0.59]]); g.fill();
      },
      null,
      (g) => { line(g, [[-0.9, 0.36], [0.9, 0.36]], 0.004); },
    ]);
  }

  // ---- 上面（x, z）：前擋（包到兩邊）、黑色車頂、引擎蓋兩道通風口、後面引擎蓋的黑色百葉 ----
  const WS = [[0.812, 0], [0.815, 0.40], [0.835, 0.64], [0.86, 0.79], [0.78, 0.80], [0.62, 0.72], [0.50, 0.62], [0.42, 0.53], [0.37, 0.40], [0.346, 0.20], [0.342, 0]];
  const ROOF = [[0.342, 0], [0.346, 0.20], [0.37, 0.40], [0.42, 0.53], [0.30, 0.64], [0.0, 0.68], [-0.50, 0.66], [-0.88, 0.58], [-0.98, 0.40], [-1.0, 0]];
  const ENGINE = [[-1.08, -0.37], [-1.08, 0.37], [-1.55, 0.31], [-1.55, -0.31]];
  const VENT = [[2.09, 0.66], [2.076, 0.717], [2.03, 0.79], [1.943, 0.839], [1.832, 0.852], [1.755, 0.84], [1.745, 0.815], [1.83, 0.788], [1.923, 0.779], [1.985, 0.735], [2.032, 0.671], [2.07, 0.645]];
  function top() {
    return layers(BOX.top, [
      null,
      (g) => {
        smooth(g, both(ROOF)); g.fill();
        frit(g, both(WS), 0.035, [0.72, 0.80], [0.78, 0.86]);
        for (const P of [VENT, VENT.map(([x, z]) => [x, -z])]) { smooth(g, P); g.fill(); }
        for (let k = 0; k < 5; k++) { const x = -1.14 - k * 0.085, w = 0.34 - k * 0.012; rrect(g, x - 0.016, -w, x + 0.016, w, 0.01); g.fill(); } // 引擎蓋玻璃上的黑色橫條
      },
      (g) => { line(g, [[0.90, 0.55], [1.30, 0.58], [1.80, 0.52], [2.10, 0.40], [2.22, 0.20], [2.24, 0]], 0.004); line(g, [[0.90, -0.55], [1.30, -0.58], [1.80, -0.52], [2.10, -0.40], [2.22, -0.20], [2.24, 0]], 0.004); },
      (g) => { smooth(g, both(WS)); g.fill(); poly(g, ENGINE); g.fill(); }, // 前擋＋引擎蓋那片玻璃（看得到裡面）
    ]);
  }

  // ---- 拉花：1967 年 Daytona 24 小時的白色號碼圓圈（3 號）＋一條白線；預設不要 ----
  function livery(sd, style = 'daytona') {
    const { c, g } = canvas(BOX.side);
    g.clearRect(-3, -1, 6, 3);
    if (style !== 'daytona') return c;
    g.fillStyle = '#f4f5f6';
    g.beginPath(); g.arc(0.20, 0.56, 0.17, 0, Math.PI * 2); g.fill();
    poly(g, [[-2.3, 0.40], [2.3, 0.44], [2.3, 0.47], [-2.3, 0.43]]); g.fill();
    g.fillStyle = '#111'; text(g, '3', 0.20, 0.55, 0.24, { mirror: sd < 0 });
    return c;
  }
  function frontLivery() { const { c, g } = canvas(BOX.front); g.clearRect(-2, -1, 4, 3); return c; }

  return {
    side, rear, top, fronts: { base: front }, livery, frontLivery, livDefault: 0, nose: () => 'base',
    U: { uXr: -1.441, uXf: 1.21, uFx: [1.55, 1.65], uRx: [-2.12, -2.2], uWell: [0.3335, 0.39, 0.93], uWellR: [0.37, 0.425, 0.93], uGlassY: 0.74 },
  };
})();

// ---- sp3-spec.js ----
// 3D 法拉利 Daytona SP3：輪子、後照鏡、車尾百葉、排氣管、套件、車庫選項（照 Nick 2026-09-27 的兩張紅色 SP3 照片）

// 車尾一條條橫鰭貼的曲線（右半邊）：[高度 y, 從哪個 z 開始, [[z, 車尾表面 x], ...]]，由 sp3d/tail2.mjs 從車身 SDF 算出來
// 最上面那條是尾燈；下面 9 條整排；再下面 5 條只在兩邊角落（中間是排氣管那條黑帶）
const SP3_TAIL = [[0.908,0,[[0,-2.263],[0.071,-2.263],[0.141,-2.263],[0.21,-2.263],[0.277,-2.262],[0.342,-2.261],[0.405,-2.26],[0.465,-2.258],[0.521,-2.256],[0.573,-2.259],[0.62,-2.26],[0.664,-2.257],[0.701,-2.249],[0.734,-2.235],[0.761,-2.215],[0.782,-2.19],[0.798,-2.168],[0.807,-2.154],[0.81,-2.149]]],[0.887,0,[[0,-2.27],[0.071,-2.27],[0.141,-2.27],[0.21,-2.271],[0.277,-2.27],[0.342,-2.27],[0.405,-2.269],[0.465,-2.267],[0.521,-2.266],[0.573,-2.266],[0.62,-2.265],[0.664,-2.261],[0.701,-2.253],[0.734,-2.24],[0.761,-2.221],[0.782,-2.198],[0.798,-2.177],[0.807,-2.163],[0.81,-2.159]]],[0.8655,0,[[0,-2.274],[0.071,-2.274],[0.141,-2.274],[0.21,-2.275],[0.277,-2.275],[0.342,-2.274],[0.405,-2.273],[0.465,-2.272],[0.521,-2.271],[0.573,-2.27],[0.62,-2.268],[0.664,-2.263],[0.701,-2.256],[0.734,-2.243],[0.761,-2.226],[0.782,-2.205],[0.798,-2.185],[0.807,-2.172],[0.81,-2.167]]],[0.844,0,[[0,-2.275],[0.071,-2.276],[0.141,-2.276],[0.21,-2.276],[0.277,-2.277],[0.342,-2.276],[0.405,-2.276],[0.465,-2.274],[0.521,-2.273],[0.573,-2.272],[0.62,-2.269],[0.664,-2.265],[0.701,-2.258],[0.734,-2.246],[0.761,-2.23],[0.782,-2.211],[0.798,-2.191],[0.807,-2.178],[0.81,-2.174]]],[0.8225,0,[[0,-2.276],[0.071,-2.277],[0.141,-2.277],[0.21,-2.277],[0.277,-2.278],[0.342,-2.277],[0.405,-2.277],[0.465,-2.276],[0.521,-2.274],[0.573,-2.273],[0.62,-2.27],[0.664,-2.266],[0.701,-2.259],[0.734,-2.248],[0.761,-2.233],[0.782,-2.214],[0.798,-2.196],[0.807,-2.183],[0.81,-2.179]]],[0.801,0,[[0,-2.277],[0.071,-2.277],[0.141,-2.277],[0.21,-2.278],[0.277,-2.278],[0.342,-2.278],[0.405,-2.277],[0.465,-2.276],[0.521,-2.275],[0.573,-2.273],[0.62,-2.271],[0.664,-2.266],[0.701,-2.259],[0.734,-2.249],[0.761,-2.235],[0.782,-2.217],[0.798,-2.199],[0.807,-2.187],[0.81,-2.182]]],[0.7795,0,[[0,-2.277],[0.071,-2.277],[0.141,-2.278],[0.21,-2.278],[0.277,-2.278],[0.342,-2.278],[0.405,-2.278],[0.465,-2.276],[0.521,-2.275],[0.573,-2.274],[0.62,-2.271],[0.664,-2.266],[0.701,-2.26],[0.734,-2.25],[0.761,-2.236],[0.782,-2.218],[0.798,-2.201],[0.807,-2.189],[0.81,-2.184]]],[0.758,0,[[0,-2.277],[0.071,-2.277],[0.141,-2.277],[0.21,-2.278],[0.277,-2.278],[0.342,-2.278],[0.405,-2.278],[0.465,-2.276],[0.521,-2.275],[0.573,-2.274],[0.62,-2.271],[0.664,-2.266],[0.701,-2.26],[0.734,-2.25],[0.761,-2.236],[0.782,-2.219],[0.798,-2.202],[0.807,-2.189],[0.81,-2.185]]],[0.7365,0,[[0,-2.276],[0.071,-2.277],[0.141,-2.277],[0.21,-2.278],[0.277,-2.278],[0.342,-2.278],[0.405,-2.277],[0.465,-2.276],[0.521,-2.275],[0.573,-2.273],[0.62,-2.271],[0.664,-2.266],[0.701,-2.26],[0.734,-2.251],[0.761,-2.236],[0.782,-2.218],[0.798,-2.201],[0.807,-2.188],[0.81,-2.184]]],[0.715,0,[[0,-2.276],[0.071,-2.277],[0.141,-2.277],[0.21,-2.277],[0.277,-2.278],[0.342,-2.278],[0.405,-2.277],[0.465,-2.276],[0.521,-2.275],[0.573,-2.273],[0.62,-2.271],[0.664,-2.266],[0.701,-2.26],[0.734,-2.25],[0.761,-2.235],[0.782,-2.217],[0.798,-2.198],[0.807,-2.186],[0.81,-2.181]]],[0.6935,0.575,[[0.575,-2.273],[0.598,-2.272],[0.622,-2.271],[0.645,-2.268],[0.669,-2.266],[0.693,-2.262],[0.716,-2.256],[0.74,-2.247],[0.763,-2.232],[0.787,-2.209],[0.81,-2.177]]],[0.672,0.575,[[0.575,-2.273],[0.598,-2.272],[0.622,-2.271],[0.645,-2.268],[0.669,-2.265],[0.693,-2.261],[0.716,-2.255],[0.74,-2.245],[0.763,-2.229],[0.787,-2.204],[0.81,-2.172]]],[0.6505,0.575,[[0.575,-2.273],[0.598,-2.272],[0.622,-2.27],[0.645,-2.268],[0.669,-2.265],[0.693,-2.261],[0.716,-2.254],[0.74,-2.243],[0.763,-2.226],[0.787,-2.199],[0.81,-2.165]]],[0.629,0.575,[[0.575,-2.273],[0.598,-2.272],[0.622,-2.27],[0.645,-2.268],[0.669,-2.264],[0.693,-2.26],[0.716,-2.253],[0.74,-2.24],[0.763,-2.221],[0.787,-2.192],[0.81,-2.158]]],[0.6075,0.575,[[0.575,-2.273],[0.598,-2.272],[0.622,-2.27],[0.645,-2.267],[0.669,-2.264],[0.693,-2.259],[0.716,-2.251],[0.74,-2.237],[0.763,-2.216],[0.787,-2.185],[0.81,-2.15]]]];

// 沿著一條曲線（xz 平面）做一片有厚度的薄板：前緣貼著原本的車尾表面、往裡 depth 深、厚 th，前緣比後緣低一點（往下斜）
function SP3_blade(pts, y, th, depth) {
  const n = pts.length, secs = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[1] - a[1], tz = b[0] - a[0]; const l = Math.hypot(tx, tz); tx /= l; tz /= l;
    const nx = -tz, nz = tx; // 朝外
    const [z, x] = pts[i];
    const F = [x - nx * 0.003, z - nz * 0.003], B = [x - nx * depth, z - nz * depth];
    secs.push([[F[0], y + th / 2 - 0.003, F[1]], [F[0], y - th / 2 - 0.003, F[1]], [B[0], y - th / 2 + 0.003, B[1]], [B[0], y + th / 2 + 0.003, B[1]]]);
  }
  const P = [], I = [];
  for (let k = 0; k < 4; k++) { // 四個面各自一條帶子（邊是尖的、面上是平滑的）
    const base = P.length / 3;
    for (const s of secs) P.push(...s[k], ...s[(k + 1) % 4]);
    for (let i = 0; i < n - 1; i++) { const q = base + i * 2; I.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
  }
  for (const s of [secs[0], secs[n - 1]]) { const base = P.length / 3; for (const c of s) P.push(...c); I.push(base, base + 1, base + 2, base, base + 2, base + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals();
  return g;
}
// 圓角長方形（給排氣管口、倒車燈）
function SP3_rrect(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r); s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}
// 車尾：橫鰭（車身同色，換車色會跟著變）、尾燈、中間黑帶上的兩個方形排氣管和兩個倒車燈
function SP3_tail(paint, mats) {
  const g = new THREE.Group();
  const fin = new THREE.MeshPhysicalMaterial({ metalness: paint.metalness, roughness: 0.42, clearcoat: 0.4, clearcoatRoughness: 0.15, envMapIntensity: 0.45, side: THREE.DoubleSide });
  fin.color = paint.color; // 同一個顏色物件：車庫換車色時橫鰭一起變
  const lamp = new THREE.MeshPhysicalMaterial({ color: 0x6d0208, emissive: 0x2a0000, roughness: 0.12, clearcoat: 1, side: THREE.DoubleSide });
  for (const [y, z0, half] of SP3_TAIL) {
    const top = y > 0.9;
    if (z0 === 0) { // 整排：左右接起來
      const pts = [...half.slice(1).reverse().map(([z, x]) => [-z, x]), ...half];
      g.add(new THREE.Mesh(SP3_blade(pts, y, top ? 0.016 : 0.0115, 0.055), top ? lamp : fin));
    } else for (const s of [1, -1]) {
      const pts = s > 0 ? half : half.map(([z, x]) => [-z, x]).reverse();
      g.add(new THREE.Mesh(SP3_blade(pts, y, 0.0115, 0.055), fin));
    }
  }
  // 中間黑帶（排氣管、倒車燈裝在上面）
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.112, 1.15), mats.gloss);
  band.position.set(-2.247, 0.652, 0); g.add(band);
  const tip = new THREE.MeshPhysicalMaterial({ color: 0xb09070, metalness: 1, roughness: 0.28 });
  for (const s of [1, -1]) {
    const ring = SP3_rrect(0.19, 0.086, 0.028); ring.holes.push(SP3_rrect(0.166, 0.062, 0.02));
    const ex = new THREE.Mesh(new THREE.ExtrudeGeometry(ring, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 8 }), tip);
    ex.geometry.rotateY(-Math.PI / 2); ex.position.set(-2.243, 0.657, s * 0.175); g.add(ex);
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.066), mats.black);
    hole.rotation.y = -Math.PI / 2; hole.position.set(-2.262, 0.657, s * 0.175); g.add(hole);
    const rev = new THREE.Mesh(new THREE.ExtrudeGeometry(SP3_rrect(0.15, 0.048, 0.012), { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 }),
      new THREE.MeshPhysicalMaterial({ color: 0xc9d0d8, roughness: 0.06, metalness: 0.2, clearcoat: 1 }));
    rev.geometry.rotateY(-Math.PI / 2); rev.position.set(-2.268, 0.648, s * 0.395); g.add(rev);
  }
  return g;
}

// 車尾下面擴散器的直立導流片（碳纖維），貼著往上斜的通道
function SP3_diffuser(mats) {
  const g = new THREE.Group();
  for (const z of [-0.60, -0.36, -0.12, 0.12, 0.36, 0.60]) {
    const f = new THREE.Shape(); f.moveTo(-1.86, 0.134); f.lineTo(-2.285, 0.302); f.lineTo(-2.29, 0.175); f.lineTo(-2.02, 0.128); f.closePath();
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(f, { depth: 0.008, bevelEnabled: false }), mats.carbon);
    m.position.z = z - 0.004; g.add(m);
  }
  return g;
}

// 前葉子板後面的黃色盾牌（只畫形狀和上面三色條，不畫圖案）
function SP3_shields() {
  const g = new THREE.Group();
  const sh = new THREE.Shape();
  sh.moveTo(-0.034, 0.046); sh.lineTo(0.034, 0.046); sh.lineTo(0.034, -0.008); sh.quadraticCurveTo(0.032, -0.03, 0, -0.047); sh.quadraticCurveTo(-0.032, -0.03, -0.034, -0.008); sh.closePath();
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf5c400, roughness: 0.35 });
  const bands = [[0x159a3c, -0.0227], [0xf4f4f4, 0], [0xd01c24, 0.0227]];
  for (const s of [1, -1]) {
    const d = new THREE.Group();
    d.add(new THREE.Mesh(new THREE.ShapeGeometry(sh, 12), yellow));
    for (const [c, x] of bands) { const b = new THREE.Mesh(new THREE.PlaneGeometry(0.0227, 0.009), new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 })); b.position.set(x, 0.0395, 0.0005); d.add(b); }
    d.position.set(0.737, 0.561, s * 0.986); d.rotation.y = Math.atan2(-0.11, s * 0.99);
    g.add(d);
  }
  return g;
}

// 後照鏡：長長的黑色支架從前葉子板上面伸出來，鏡頭上半紅（車色）下半黑，鏡面朝後
function SP3_mirror(paint, mats, s) {
  const g = new THREE.Group();
  const up = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), paint);
  up.scale.set(0.125, 0.05, 0.062); g.add(up);
  const lo = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mats.black);
  lo.scale.set(0.12, 0.034, 0.06); g.add(lo);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(1, 32), mats.mirrorGlass);
  glass.scale.set(0.048, 0.03, 1); glass.rotation.y = -Math.PI / 2; glass.position.x = -0.103; g.add(glass);
  g.position.set(0.955, 0.815, s * 0.985);
  const root = new THREE.Group(); root.add(g);
  const c = new THREE.CatmullRomCurve3([[1.285, 0.728, 0.952], [1.17, 0.772, 0.975], [1.05, 0.79, 0.985], [0.99, 0.795, 0.985]].map(([x, y, z]) => new THREE.Vector3(x, y, s * z)));
  root.add(new THREE.Mesh(new THREE.TubeGeometry(c, 24, 0.011, 8), mats.black));
  return root;
}

// 輪框：五組雙輻（銀色），中間黃色中心蓋（不畫圖案）
const SP3_capMat = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.35 });
function SP3_spokes(rim, w, mats) {
  const g = new THREE.Group();
  const ro = rim - 0.013, rh = 0.078, zo = w / 2 - 0.03, zi = w / 2 - 0.078;
  const P = (r, ang, z, off) => [Math.cos(ang) * r - Math.sin(ang) * off, Math.sin(ang) * r + Math.cos(ang) * off, z];
  for (let j = 0; j < 5; j++) {
    const a = (j * 2 * Math.PI) / 5;
    for (const s of [-1, 1]) {
      const ai = a + s * 0.075, ao = a + s * 0.105, wi = 0.011, wo = 0.009;
      g.add(new THREE.Mesh(slab([P(rh, ai, zi, -wi), P(ro, ao, zo, -wo), P(ro, ao, zo, wo), P(rh, ai, zi, wi)], 0.024), mats.chrome));
    }
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.1, 0.036, 48), mats.chrome);
  hub.geometry.rotateX(Math.PI / 2); hub.position.z = zi + 0.004; g.add(hub);
  const cap = new THREE.Mesh(new THREE.CircleGeometry(0.034, 32), SP3_capMat);
  cap.position.z = w / 2 - SP3_spokes.capInset + 0.0158; g.add(cap);
  return g;
}
SP3_spokes.capInset = 0.062;

// 賽道套件的位置（碳纖維前下巴、風刀、側裙刀片、後擴散器）
const SP3_AERO = {
  front: [[2.43, 0], [2.42, 0.30], [2.36, 0.52], [2.26, 0.70], [2.13, 0.85], [2.0, 0.93]], back: 1.95, y: 0.088, rods: [2.33, 0.13],
  canard: { S: [2.135, 0.76], t: [-0.567, 0.824], ys: [0.33, 0.26] },
  skirt: { y: 0.118, x0: -0.95, x1: 0.78, z0: 0.84, z1: 0.95 },
  diff: { x0: -1.80, x1: -2.12, x2: -2.30, y0: 0.125, y1: 0.15, y2: 0.24, w: 0.66, fin0: -1.9 },
};

const SP3_SPEC = {
  look: SP3_LOOK, paint: '#c3141c', metal: 0.35, seat: 0x1b3f8f,
  wheels: { xf: 1.21, xr: -1.441, RF: 0.3335, RR: 0.370, rimF: 0.262, rimR: 0.275, trackF: 0.8455, trackR: 0.8155, wF: 0.265, wR: 0.345, style: SP3_spokes },
  mirror: SP3_mirror,
  wings: { gt: (paint, mats) => gtWing({ mats, x: -1.95, y: 1.17, deck: 0.95, span: 1.62, chord: 0.30 }) }, wing: 'none',
  interior: { dx: -0.1, cage: false, dashX: 0.40, dashY: 0.72, seatDy: -0.09, shelf: false },
  build(body, paint, mats) { // 套件：原廠、賽道（碳纖維前下巴＋風刀＋側裙刀片＋擴散器）
    body.add(SP3_tail(paint, mats), SP3_shields(), SP3_diffuser(mats));
    // 原廠碳纖維下巴：厚厚一塊（約 6 公分），霧一點，不要反光成白色
    const chin = lip(mats, [[2.345, 0], [2.335, 0.30], [2.28, 0.49], [2.185, 0.63], [2.065, 0.74], [1.955, 0.80]], 1.95, 0.142);
    const cm = new THREE.MeshPhysicalMaterial({ color: 0x0e0f11, roughness: 0.5, metalness: 0.1, clearcoat: 0.25, clearcoatRoughness: 0.3 });
    chin.traverse((o) => { if (o.isMesh) { o.material = cm; o.scale.z = 3.5; } });
    body.add(chin);
    const aero = aeroKit(mats, SP3_AERO); aero.visible = false; body.add(aero);
    return (kit) => { aero.visible = kit === 'track'; };
  },
  kit: 'stock',
};
const SP3_CAMS = {
  photo1: { a: 35.7133, d: 5.899, h: 1.1528, tx: 0.6508, ty: 0.4215, fov: 25.9325, rl: 0.123 },
  photo2: { a: -152.417, d: 6.7108, h: 1.1264, tx: -0.6628, ty: 0.5682, fov: 22.9076, rl: 0.3138 },
};
const SP3_GARAGE = {
  name: 'Ferrari Daytona SP3', sub: '照片那台紅色 SP3 · 3D 試做版',
  paints: [['#c3141c', '賽車紅'], ['#f4c21b', '摩德納黃'], ['#141518', '黑'], ['#f2f3f5', '白'], ['#1c3f94', '藍'], ['#8a9098', '銀灰'], ['#123f2c', '英國綠'], ['#ff7414', '橘']],
  opts: {
    wing: [['none', '不要'], ['gt', 'GT 大尾翼']],
    kit: [['stock', '原廠'], ['track', '賽道']],
    height: [['0', '原廠'], ['-0.025', '降低'], ['-0.045', '貼地']],
    livery: [['none', '不要'], ['daytona', '3 號賽車']],
  },
  state: { paint: '#c3141c', rim: 'chrome', caliper: '#f2b705', wing: 'none', kit: 'stock', height: '0', livery: 'none', tint: 'light' },
};

// ---- jesko-look.js ----
// 3D Koenigsegg Jesko Attack 的表面細節（投影貼圖），做法跟 gtr-look.js 一樣。
// 位置都是照 Nick 那兩張照片量的：照片上的點從相機打光線到車身（camfit.hit），得到車身上的 (x, y, z)。
// 拉花（紅／綠）除了畫在車身上，也決定尾翼端板、下巴翼片、擴散器邊條那些零件的顏色（JESKO_LOOK.accent()）。

const JESKO_LOOK = (() => {
  const M = (pts) => pts.map(([u, y]) => [-u, y]); // 左右鏡射
  const rrect = (g, x0, y0, x1, y1, r) => { g.beginPath(); g.roundRect(x0, y0, x1 - x0, y1 - y0, r); };
  const ACCENT = { red: '#d3142a', green: '#5fd12a' };
  let style = 'red'; // 最後畫的拉花（'ff' 是 cview 的預設名字，當成紅色）

  // ---- 側面（x, y）----
  // 側窗：A 柱底 → 車頂邊 → 往後收成水滴尖，下緣沿著腰線
  const DLO = [[0.99, 0.742], [0.80, 0.822], [0.55, 0.935], [0.25, 1.03], [-0.10, 1.07], [-0.50, 1.04], [-0.85, 0.965], [-1.12, 0.875],
    [-1.24, 0.822], [-1.00, 0.772], [-0.70, 0.738], [-0.30, 0.716], [0.20, 0.714], [0.70, 0.724]];
  // 後輪前面的大進氣口
  const INTAKE = [[-0.22, 0.60], [-0.40, 0.63], [-0.65, 0.635], [-0.90, 0.61], [-0.98, 0.54], [-0.99, 0.32], [-0.93, 0.25], [-0.62, 0.24],
    [-0.36, 0.25], [-0.20, 0.29], [-0.16, 0.42]];
  function side() {
    return layers(BOX.side, [
      (g) => { smooth(g, DLO); g.fill(); },
      (g) => { // 黑色：窗框、B 柱、進氣口、門檻、前葉子板後面的導風口
        g.lineJoin = 'round'; g.lineWidth = 0.022; smooth(g, DLO); g.stroke();
        poly(g, [[-0.50, 1.05], [-0.44, 1.05], [-0.52, 0.72], [-0.58, 0.72]]); g.fill();
        smooth(g, INTAKE); g.fill();
        g.lineWidth = 0.075; line(g, [[1.02, 0.735], [0.82, 0.83], [0.56, 0.945], [0.26, 1.045], [-0.10, 1.09], [-0.50, 1.06], [-0.86, 0.985], [-1.14, 0.89], [-1.28, 0.83]], 0.075); // A 柱、車頂邊（碳纖維）
        poly(g, [[0.30, 1.06], [-0.10, 1.10], [-0.55, 1.07], [-0.9, 0.99], [-0.9, 1.4], [0.30, 1.4]]); g.fill();
        poly(g, [[-1.0, 0.105], [1.0, 0.105], [0.96, 0.19], [-0.96, 0.195]]); g.fill(); // 碳纖維門檻
        smooth(g, [[1.02, 0.60], [1.10, 0.66], [1.16, 0.58], [1.12, 0.36], [1.04, 0.30], [1.00, 0.40]]); g.fill(); // 前輪後面的出風口
      },
      (g) => { // 縫：車門（前緣沿著前輪拱後面、下緣在門檻上、後緣在進氣口前面）、前後蓋
        line(g, [[0.985, 0.745], [0.99, 0.62], [0.96, 0.42], [0.90, 0.26], [0.80, 0.205]], 0.005);
        line(g, [[0.80, 0.205], [-0.02, 0.21]], 0.004);
        line(g, [[-0.02, 0.21], [-0.03, 0.45], [-0.08, 0.64], [-0.30, 0.70], [-0.62, 0.72]], 0.005);
        line(g, [[1.70, 0.73], [1.95, 0.64], [2.12, 0.52]], 0.004); // 前蓋側邊
        line(g, [[-1.60, 0.86], [-1.95, 0.80], [-2.22, 0.74]], 0.004); // 後蓋側邊
      },
      null,
    ]);
  }

  // ---- 正面（u＝|z|，畫的時候左右鏡射；y）----
  // 大燈：葉子板前緣一條斜斜的細長眼睛
  const HEAD = [[0.90, 0.738], [0.945, 0.718], [0.93, 0.645], [0.885, 0.568], [0.83, 0.505], [0.785, 0.508], [0.80, 0.56], [0.845, 0.645]];
  const MOUTH = [[0, 0.285], [0.30, 0.30], [0.57, 0.325], [0.80, 0.345], [0.875, 0.31], [0.895, 0.20], [0.86, 0.13], [0.40, 0.118], [0, 0.115]];
  const CORNER = [[0.905, 0.52], [0.96, 0.50], [0.985, 0.36], [0.975, 0.24], [0.93, 0.24], [0.915, 0.36]]; // 保桿角的直立導風口
  const both2 = (g, pts, fn) => { for (const P of [pts, M(pts)]) fn(P); };
  function front() {
    return layers(BOX.front, [
      (g) => { // R：燈、中間的徽章
        both2(g, HEAD, (P) => { smooth(g, P); g.fill(); });
        g.beginPath(); g.ellipse(0, 0.445, 0.024, 0.03, 0, 0, Math.PI * 2); g.fill();
      },
      (g) => { // G：黑色（下面整片大進氣口、保桿角的導風口、燈的外框）
        smooth(g, [...MOUTH, ...M(MOUTH).reverse()]); g.fill();
        both2(g, CORNER, (P) => { smooth(g, P); g.fill(); });
        g.lineWidth = 0.008; both2(g, HEAD, (P) => { smooth(g, P); g.stroke(); });
      },
      null,
      (g) => { // A：燈裡面的暗色投射鏡、進氣口裡的橫條網子
        for (const s of [1, -1]) {
          g.save(); smooth(g, HEAD.map(([u, y]) => [u * s, y])); g.clip();
          g.fillStyle = 'rgb(120,120,120)'; line(g, [[0.83 * s, 0.56], [0.905 * s, 0.68]], 0.03); g.restore();
          g.fillStyle = g.strokeStyle = '#fff';
        }
        g.save(); smooth(g, [...MOUTH, ...M(MOUTH).reverse()]); g.clip();
        for (const y of [0.17, 0.235]) line(g, [[-1, y], [1, y]], 0.01);
        g.restore();
        g.beginPath(); g.ellipse(0, 0.445, 0.014, 0.019, 0, 0, Math.PI * 2); g.fill();
      },
    ]);
  }

  // ---- 後面（u＝z，y）：鴨尾下面一整片黑色大開口、上角細長的尾燈 ----
  const TAIL = [[0.50, 0.70], [0.72, 0.725], [0.90, 0.765], [0.985, 0.80], [0.985, 0.835], [0.90, 0.83], [0.72, 0.79], [0.50, 0.75]];
  const OPEN = [[0, 0.648], [0.40, 0.648], [0.62, 0.636], [0.735, 0.60], [0.78, 0.50], [0.80, 0.34], [0.84, 0.16], [0.80, 0.10], [0, 0.10]];
  function rear() {
    return layers(BOX.rear, [
      (g) => { for (const s of [1, -1]) { smooth(g, TAIL.map(([u, y]) => [u * s, y])); g.fill(); } },
      (g) => {
        smooth(g, [...OPEN, ...M(OPEN).reverse()]); g.fill();
        g.lineWidth = 0.008; for (const s of [1, -1]) { smooth(g, TAIL.map(([u, y]) => [u * s, y])); g.stroke(); }
      },
      (g) => { for (const s of [1, -1]) { rrect(g, 0.52 * s - 0.05, 0.47, 0.52 * s + 0.05, 0.50, 0.012); g.fill(); } }, // 倒車燈
      (g) => { line(g, [[-0.70, 0.672], [0.70, 0.672]], 0.004); },
    ]);
  }

  // ---- 上面（x, z）：前擋、碳纖維車頂、引擎蓋百葉、前蓋的大出風口 ----
  const WS = [[1.13, 0], [1.12, 0.40], [1.07, 0.64], [0.95, 0.76], [0.72, 0.745], [0.48, 0.66], [0.32, 0.56], [0.27, 0.32], [0.26, 0]];
  const ROOF = [[0.30, 0], [0.30, 0.50], [0.20, 0.61], [-0.30, 0.64], [-0.70, 0.60], [-0.86, 0.45], [-0.90, 0]];
  const VENT = [[1.97, 0], [1.955, 0.30], [1.90, 0.44], [1.80, 0.49], [1.13, 0.50], [1.13, 0]];
  function top() {
    return layers(BOX.top, [
      (g) => { // R：霧面黑（前蓋出風口、葉子板上的小百葉）
        for (const s of [1, -1]) poly(g, [[1.30, 0.80 * s], [1.62, 0.76 * s], [1.62, 0.70 * s], [1.30, 0.74 * s]]), g.fill();
        poly(g, both(VENT)); g.fill(); // 前蓋中間的大出風口（霧黑）
      },
      (g) => { // G：黑色（前擋黑邊、碳纖維車頂、引擎蓋百葉）
        frit(g, both(WS), 0.03, [0.20, 0.34], [1.06, 1.20]);
        smooth(g, both(ROOF)); g.fill();
        smooth(g, both([[-0.86, 0], [-0.86, 0.40], [-1.10, 0.46], [-1.60, 0.44], [-1.95, 0.36], [-2.05, 0]])); g.fill(); // 深色引擎蓋
      },
      (g) => { // B：縫
        line(g, [[1.18, 0.78], [1.55, 0.80], [1.95, 0.70], [2.12, 0.50], [2.18, 0], [2.12, -0.50], [1.95, -0.70], [1.55, -0.80], [1.18, -0.78]], 0.005);
        line(g, [[-0.95, 0.56], [-1.50, 0.62], [-2.00, 0.64], [-2.20, 0.40], [-2.24, 0], [-2.20, -0.40], [-2.00, -0.64], [-1.50, -0.62], [-0.95, -0.56]], 0.005);
      },
      (g) => { smooth(g, both(WS)); g.fill(); },
    ]);
  }

  // ---- 拉花：紅（照片 1）／綠（照片 2）的細條，畫在門檻上緣、進氣口前緣、前保桿下緣 ----
  const pick = (s) => { if (s && s !== 'none') style = s === 'ff' ? 'red' : s; return ACCENT[style] || ACCENT.red; };
  function livery(sd, s = 'red') {
    const { c, g } = canvas(BOX.side);
    g.clearRect(-3, -1, 6, 3);
    if (s === 'none') return c;
    g.fillStyle = g.strokeStyle = pick(s);
    poly(g, [[-0.96, 0.195], [0.96, 0.19], [0.93, 0.215], [-0.93, 0.22]]); g.fill();      // 門檻上緣
    line(g, [[-0.22, 0.58], [-0.17, 0.42], [-0.20, 0.30]], 0.018);                      // 進氣口前緣
    poly(g, [[1.70, 0.12], [2.05, 0.13], [2.02, 0.16], [1.72, 0.15]]); g.fill();         // 前保桿下角
    return c;
  }
  function frontLivery(s = 'red') {
    const { c, g } = canvas(BOX.front);
    g.clearRect(-2, -1, 4, 3);
    if (s === 'none') return c;
    g.fillStyle = g.strokeStyle = pick(s);
    for (const k of [1, -1]) { poly(g, [[0.84 * k, 0.12], [0.90 * k, 0.13], [0.90 * k, 0.20], [0.86 * k, 0.19]]); g.fill(); }
    return c;
  }

  return {
    side, rear, top,
    fronts: { base: front },
    livery, frontLivery,
    livDefault: 1,
    nose: () => 'base',
    accent: () => ACCENT[style] || ACCENT.red,
    U: { uXr: -1.35, uXf: 1.35, uFx: [1.58, 1.66], uRx: [-1.70, -1.78], uWell: [0.347, 0.372, 0.95], uWellR: [0.364, 0.392, 0.97], uGlassY: 0.74 },
  };
})();

// ---- jesko-spec.js ----
// 3D Koenigsegg Jesko Attack：輪子（五根 Y 字輻條）、迴力鏢大尾翼（鵝頸支架）、後照鏡、下巴、側裙、擴散器、排氣管、相機、車庫選項
// 拉花顏色（紅／綠／不要）同時決定尾翼端板、下巴翼片、側裙尖端、擴散器邊條、支架飾條的顏色

// 一片有厚度的板子：給四個角（依序），往板子法線兩邊各長 th/2
function JESKO_slab(pts, th) {
  const v = pts.map((p) => new THREE.Vector3(...p));
  const n = new THREE.Vector3().crossVectors(v[1].clone().sub(v[0]), v[3].clone().sub(v[0])).normalize().multiplyScalar(th / 2);
  const T = v.map((p) => p.clone().add(n)), B = v.map((p) => p.clone().sub(n));
  const quads = [[T[0], T[1], T[2], T[3]], [B[3], B[2], B[1], B[0]]];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quads.push([B[i], B[j], T[j], T[i]]); }
  const a = [];
  for (const [p, q, r, w] of quads) a.push(...p.toArray(), ...q.toArray(), ...r.toArray(), ...p.toArray(), ...r.toArray(), ...w.toArray());
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); g.computeVertexNormals();
  return g;
}
// 側面輪廓（x, y）往 z 拉厚 th，放在 z0
function JESKO_plate(pts, th, z0, mat, bevel = 0.004) {
  const s = new THREE.Shape(); s.moveTo(...pts[0]); for (const p of pts.slice(1)) s.lineTo(...p); s.closePath();
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: th, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 12 }), mat);
  m.position.z = z0 - th / 2; return m;
}
// 拉花點綴色：材質跟著拉花換（車漆材質編譯時抓 uLiv；'none' 時變回碳纖維黑）
function JESKO_accent(mats) {
  if (mats.jeskoAcc) return mats.jeskoAcc;
  const m = new THREE.MeshPhysicalMaterial({ color: JESKO_LOOK.accent(), roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06, side: THREE.DoubleSide });
  const liv = { u: null };
  m.userData.liv = liv;
  m.userData.update = () => { const on = liv.u ? liv.u.value > 0.5 : true; m.color.set(on ? JESKO_LOOK.accent() : 0x17181b); };
  mats.jeskoAcc = m;
  return m;
}
const JESKO_tag = (mesh, mats) => { mesh.onBeforeRender = () => mats.jeskoAcc.userData.update(); return mesh; };

// ---- 輪框：五根 Y 字輻條（中間一根、快到輪緣分成兩叉），往中間凹 ----
function JESKO_rim(rim, w, mats) {
  const g = new THREE.Group();
  const ro = rim - 0.012, rs = rim * 0.55, rh = 0.075, zo = w / 2 - 0.03, zi = w / 2 - 0.075;
  const P = (r, ang, z, off) => [Math.cos(ang) * r - Math.sin(ang) * off, Math.sin(ang) * r + Math.cos(ang) * off, z];
  const zAt = (r) => zi + (zo - zi) * Math.min(1, (r - rh) / (ro - rh));
  for (let j = 0; j < 5; j++) {
    const a = (j * 2 * Math.PI) / 5 + Math.PI / 2;
    g.add(new THREE.Mesh(JESKO_slab([P(rh, a, zi, -0.032), P(rs, a, zAt(rs), -0.028), P(rs, a, zAt(rs), 0.028), P(rh, a, zi, 0.032)], 0.024), mats.chrome));
    for (const s of [-1, 1]) {
      const ao = a + s * 0.20;
      g.add(new THREE.Mesh(JESKO_slab([P(rs - 0.015, a + s * 0.02, zAt(rs), -0.016), P(ro, ao, zo, -0.013), P(ro, ao, zo, 0.013), P(rs - 0.015, a + s * 0.02, zAt(rs), 0.016)], 0.02), mats.chrome));
    }
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.045, 40), mats.chrome);
  hub.geometry.rotateX(Math.PI / 2); hub.position.z = zi + 0.004; g.add(hub);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ro + 0.002, 0.005, 8, 96), mats.chrome);
  ring.position.z = zo + 0.004; g.add(ring);
  return g;
}
JESKO_rim.capInset = 0.07;

// ---- 迴力鏢大尾翼：翼片兩端往前掠、中間往後；兩根鵝頸支架從上面勾住翼片；小端板 ----
const JESKO_WING = { x0: -1.60, sweep: 0.12, y0: 1.13, rise: 0.03, c0: 0.31, c1: 0.25, span: 1.0, pylonZ: 0.37 };
function JESKO_wingMesh(mats, W) {
  const g = new THREE.Group();
  const N = 18, sec = [], pos = [], idx = [];
  const foil = [];
  for (let i = 0; i <= N; i++) { const t = i / N, xc = (1 - Math.cos(Math.PI * t)) / 2; foil.push(xc); }
  const secPts = (z) => {
    const u = Math.abs(z) / W.span, le = W.x0 + W.sweep * u ** 1.6, c = W.c0 + (W.c1 - W.c0) * u, y = W.y0 + W.rise * u * u, aoa = 0.16;
    const up = [], lo = [];
    for (const xc of foil) {
      const th = 0.11 * 5 * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);
      const cam = -0.05 * Math.sin(Math.PI * xc);
      const X = (yy) => [le - xc * c * Math.cos(aoa) - yy * c * Math.sin(aoa), y + xc * c * Math.sin(aoa) + yy * c * Math.cos(aoa)];
      up.push(X(cam + th)); lo.push(X(cam - th));
    }
    return [...up, ...lo.slice(1, -1).reverse()];
  };
  const S = 24;
  for (let i = 0; i <= S; i++) { const z = -W.span + (2 * W.span * i) / S; sec.push({ z, pts: secPts(z) }); }
  const n = sec[0].pts.length;
  sec.forEach((s) => s.pts.forEach(([x, y]) => pos.push(x, y, s.z)));
  for (let i = 0; i < S; i++) for (let j = 0; j < n; j++) {
    const a = i * n + j, b = i * n + ((j + 1) % n), c = (i + 1) * n + j, d = (i + 1) * n + ((j + 1) % n);
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, mats.carbon));
  // 端板（拉花色）
  const acc = JESKO_accent(mats);
  for (const s of [-1, 1]) {
    const u = 1, le = W.x0 + W.sweep, c = W.c1, y = W.y0 + W.rise;
    g.add(JESKO_plate([[le + 0.03, y + 0.03], [le - c - 0.03, y + 0.05], [le - c - 0.05, y - 0.03], [le - c * 0.5, y - 0.12], [le + 0.02, y - 0.08]], 0.012, s * (W.span + 0.008), mats.carbon, 0.003));
    g.add(JESKO_tag(JESKO_plate([[le + 0.03, y + 0.03], [le - c - 0.03, y + 0.05], [le - c - 0.036, y + 0.0], [le + 0.026, y - 0.012]], 0.018, s * (W.span + 0.008), acc, 0.002), mats));
  }
  // 尾緣的小擾流片（賽道套件才看得到）
  const fl = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 2 * W.span - 0.06), mats.carbon);
  fl.name = 'flap'; fl.visible = false; fl.position.set(W.x0 - W.c0 * 0.97, W.y0 + 0.085, 0); g.add(fl);
  // 鵝頸支架：從引擎蓋往上、往後彎，勾在翼片上面；前緣一條拉花色飾條
  for (const s of [-1, 1]) {
    const z = s * W.pylonZ, u = W.pylonZ / W.span, le = W.x0 + W.sweep * u ** 1.6, yT = W.y0 + W.rise * u * u + 0.035;
    const neck = [[-1.26, 0.88], [-1.31, 1.00], [-1.39, 1.11], [-1.49, 1.18], [le - 0.04, yT + 0.035], [le - 0.19, yT + 0.03], [le - 0.21, yT - 0.012],
      [le - 0.08, yT - 0.012], [-1.53, 1.12], [-1.48, 1.02], [-1.46, 0.88]];
    g.add(JESKO_plate(neck, 0.024, z, mats.carbon, 0.004));
    const strip = [[-1.26, 0.90], [-1.31, 1.00], [-1.39, 1.11], [-1.49, 1.18], [-1.53, 1.165], [-1.43, 1.095], [-1.355, 0.99], [-1.305, 0.90]];
    g.add(JESKO_tag(JESKO_plate(strip, 0.028, z, acc, 0.002), mats));
  }
  return g;
}

// ---- 後照鏡：細支架從車門上緣伸出去，水滴形鏡殼（同車色），鏡面朝後 ----
function JESKO_mirror(paint, mats, s) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 16), mats.carbon);
  head.scale.set(0.10, 0.045, 0.056); head.rotation.y = s * 0.12; head.position.set(0.50, 0.915, s * 1.0); g.add(head);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(1, 28), mats.mirrorGlass);
  glass.scale.set(0.045, 0.058, 1); glass.rotation.y = -Math.PI / 2; glass.position.set(0.44, 0.915, s * 1.0); g.add(glass);
  const stalk = new THREE.Mesh(JESKO_slab([[0.62, 0.74, s * 0.87], [0.55, 0.90, s * 0.99], [0.50, 0.90, s * 0.99], [0.57, 0.74, s * 0.87]], 0.016), mats.carbon);
  g.add(stalk);
  return g;
}

// ---- 下巴、側裙、擴散器、排氣管（原廠就有）；賽道套件多風刀、側裙小翼、尾翼擾流片 ----
function JESKO_splitter(mats) {
  const g = new THREE.Group(), acc = JESKO_accent(mats), k = 0;
  const front = [[2.335 + k, 0], [2.32 + k, 0.30], [2.26 + k, 0.52], [2.15 + k, 0.72], [2.02, 0.88], [1.92, 0.955]];
  const sh = new THREE.Shape(), zb = front[front.length - 1][1];
  sh.moveTo(1.80, -zb); sh.lineTo(front[front.length - 1][0], -zb);
  sh.splineThru(front.slice(0, -1).reverse().map(([x, z]) => new THREE.Vector2(x, -z)));
  sh.splineThru(front.slice(1).map(([x, z]) => new THREE.Vector2(x, z)));
  sh.lineTo(1.80, zb); sh.closePath();
  const sp = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 24 }), mats.carbon);
  sp.rotation.x = Math.PI / 2; sp.position.y = 0.092; g.add(sp);
  for (const s of [-1, 1]) {
    // 下巴兩端的小翼（拉花色），往後上翹
    g.add(JESKO_tag(new THREE.Mesh(JESKO_slab([[2.06, 0.09, s * 0.90], [1.95, 0.09, s * 0.965], [1.95, 0.16, s * 0.97], [2.01, 0.14, s * 0.92]], 0.012), acc), mats));
    // 中間的直立導流片（拉花色）
    g.add(JESKO_tag(new THREE.Mesh(JESKO_slab([[2.28, 0.09, s * 0.055], [2.14, 0.09, s * 0.065], [2.14, 0.20, s * 0.065], [2.22, 0.18, s * 0.057]], 0.012), acc), mats));
    // 側裙：碳纖維刀片，前端拉花色
    g.add(new THREE.Mesh(JESKO_slab([[-0.98, 0.108, s * 0.93], [0.84, 0.108, s * 0.93], [0.80, 0.108, s * 1.005], [-0.94, 0.108, s * 1.0]], 0.012), mats.carbon));
    g.add(JESKO_tag(new THREE.Mesh(JESKO_slab([[0.84, 0.112, s * 0.93], [0.96, 0.112, s * 0.93], [0.92, 0.112, s * 1.0], [0.80, 0.112, s * 1.005]], 0.014), acc), mats));
  }
  return g;
}
function JESKO_diffuser(mats) {
  const g = new THREE.Group(), acc = JESKO_accent(mats);
  // 底板往後上翹
  g.add(new THREE.Mesh(JESKO_slab([[-1.90, 0.115, -0.78], [-1.90, 0.115, 0.78], [-2.34, 0.30, 0.78], [-2.34, 0.30, -0.78]], 0.012), mats.carbon));
  for (const z of [-0.62, -0.38, -0.13, 0.13, 0.38, 0.62]) {
    const f = [[-1.92, 0.118], [-2.34, 0.30], [-2.36, 0.40], [-2.27, 0.40], [-2.08, 0.28]];
    g.add(JESKO_plate(f, 0.012, z, mats.carbon, 0.002));
  }
  // 最外側兩片（拉花色的下緣）
  for (const s of [-1, 1]) g.add(JESKO_tag(new THREE.Mesh(JESKO_slab([[-2.00, 0.13, s * 0.80], [-2.30, 0.13, s * 0.80], [-2.30, 0.20, s * 0.84], [-2.05, 0.19, s * 0.84]], 0.014), acc), mats));
  return g;
}
function JESKO_exhaust(mats) {
  const g = new THREE.Group();
  const bez = new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 10, 48), mats.alu);
  bez.scale.set(0.13, 0.036, 0.3); bez.rotation.y = Math.PI / 2; bez.position.set(-2.225, 0.575, 0); g.add(bez);
  const back = new THREE.Mesh(new THREE.CircleGeometry(1, 40), mats.black);
  back.scale.set(0.12, 0.034, 1); back.rotation.y = -Math.PI / 2; back.position.set(-2.215, 0.575, 0); g.add(back);
  for (const z of [-0.075, 0, 0.075]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.07, 24, 1, true), mats.alu);
    p.material = mats.alu; p.geometry.rotateZ(Math.PI / 2); p.position.set(-2.235, 0.575, z); g.add(p);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.022, 24), mats.black);
    hole.rotation.y = -Math.PI / 2; hole.position.set(-2.262, 0.575, z); g.add(hole);
  }
  return g;
}
function JESKO_pinstripe(mats) {
  const half = [[1.25, 0.752, 0.495], [1.60, 0.752, 0.498], [1.80, 0.724, 0.49], [1.90, 0.70, 0.44], [1.955, 0.678, 0.32], [1.968, 0.674, 0.15], [1.97, 0.674, 0]];
  const pts = [...half, ...half.slice(0, -1).reverse().map(([x, y, z]) => [x, y, -z])].map(([x, y, z]) => new THREE.Vector3(x, y + 0.004, z));
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.006, 6, false), JESKO_accent(mats));
  return JESKO_tag(m, mats);
}
function JESKO_canards(mats) {
  const g = new THREE.Group(), acc = JESKO_accent(mats);
  for (const s of [-1, 1]) for (const [y, dx] of [[0.30, 0], [0.40, -0.03]]) {
    g.add(JESKO_tag(new THREE.Mesh(JESKO_slab([[2.08 + dx, y, s * 0.86], [1.94 + dx, y + 0.04, s * 0.96], [1.90 + dx, y + 0.04, s * 1.03], [2.02 + dx, y, s * 0.97]], 0.008), acc), mats));
  }
  // 側裙往外多一片小翼
  for (const s of [-1, 1]) g.add(new THREE.Mesh(JESKO_slab([[-0.90, 0.14, s * 1.0], [0.70, 0.14, s * 1.0], [0.66, 0.16, s * 1.04], [-0.86, 0.16, s * 1.04]], 0.008), mats.carbon));
  return g;
}

const JESKO_SPEC = {
  look: JESKO_LOOK, paint: '#f1f2f3', metal: 0.12, seat: 0xc4c7cc,
  wheels: { xf: 1.35, xr: -1.35, RF: 0.347, RR: 0.364, rimF: 0.254, rimR: 0.2667, trackF: 0.85, trackR: 0.825, wF: 0.265, wR: 0.325, style: JESKO_rim },
  mirror: (paint, mats, s) => JESKO_mirror(paint, mats, s),
  wings: { stock: (paint, mats) => JESKO_wingMesh(mats, JESKO_WING) },
  wing: 'stock',
  interior: { dx: 0.02, cage: false, wheelZ: -0.36, dashX: 0.62, dashY: 0.74 },
  build(body, paint, mats) {
    // 拉花點綴色：車漆編譯時把 uLiv 抓出來，零件每次畫之前照它換色
    const acc = JESKO_accent(mats), ob = paint.onBeforeCompile;
    paint.onBeforeCompile = (sh, r) => { ob(sh, r); acc.userData.liv.u = sh.uniforms.uLiv; };
    // 車內的後置物板會穿出引擎蓋兩側，拿掉
    body.traverse((o) => { if (o.isMesh && o.geometry.type === 'BoxGeometry' && o.position.y > 0.9 && o.position.x < -1.0) o.visible = false; });
    body.add(JESKO_splitter(mats), JESKO_diffuser(mats), JESKO_exhaust(mats), JESKO_pinstripe(mats));
    const can = JESKO_canards(mats), flap = body.getObjectByName('wing-stock')?.getObjectByName('flap');
    can.visible = false; body.add(can);
    return (kit) => { can.visible = kit === 'track'; if (flap) flap.visible = kit === 'track'; };
  },
  kit: 'stock',
};
const JESKO_CAMS = {
  photo1: { a: -29.79, d: 7.58, h: 0.8, tx: 0.605, ty: 0.519, fov: 17.58, rl: -0.775 },
  photo2: { a: 147.25, d: 8.22, h: 0.25, tx: -0.284, ty: 0.733, fov: 19.24, rl: 0.5 },
};
const JESKO_GARAGE = {
  name: 'Koenigsegg Jesko Attack', sub: '白色紅點綴那台 · 3D 試做版',
  paints: [['#f1f2f3', '白（照片 1）'], ['#c5c9ce', '月光銀（照片 2）'], ['#ff6a13', '柑橘橘'], ['#16171a', '碳黑'], ['#1c3f9e', '藍'], ['#0e6b4b', '翡翠綠'], ['#c8141e', '紅'], ['#d6b25c', '金']],
  opts: {
    wing: [['stock', '原廠大尾翼'], ['none', '不要']],
    kit: [['stock', '原廠'], ['track', '賽道']],
    height: [['0', '原廠'], ['-0.03', '降低'], ['-0.05', '貼地']],
    livery: [['red', '紅色點綴'], ['green', '綠色點綴'], ['none', '不要']],
  },
  state: { paint: '#f1f2f3', rim: 'black', caliper: '#c8141e', wing: 'stock', kit: 'stock', height: '0', livery: 'red', tint: 'light' },
};

// ---- yaris-look.js ----
// 3D GR Yaris 的表面細節（投影貼圖），做法跟 gtr-look.js 一樣。
// 位置都是照 Nick 那兩張白色 GR Yaris 照片量的：照片上的點從相機打光線到車身（yaris3d/probe.mjs），得到車身上的 (x, y, z)。
// 車頭照 2020 年那張（有霧燈、GR YARIS 車牌），車尾照 2024 年那張（燻黑尾燈中間一條燈條連起來）。

const YARIS_LOOK = (() => {
  const M = (pts) => pts.map(([u, y]) => [-u, y]); // 左右鏡射
  const rrect = (g, x0, y0, x1, y1, r) => { g.beginPath(); g.roundRect(x0, y0, x1 - x0, y1 - y0, r); };
  const circle = (g, x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); };
  const ellipse = (g, x, y, rx, ry, a = 0) => { g.beginPath(); g.ellipse(x, y, rx, ry, a, 0, Math.PI * 2); };
  const both2 = (pts, fn) => { fn(pts); fn(M(pts)); };

  // ---- 側面（x, y）----
  // 側窗：車門窗＋後面的三角窗（一整塊，中間黑色的分隔條），後端圓的、往上翹
  const DLO = [[0.60, 1.012], [0.40, 1.024], [0.24, 1.033], [-0.09, 1.053], [-0.395, 1.075], [-0.668, 1.103], [-0.864, 1.134],
    [-0.995, 1.172], [-1.055, 1.20], [-1.075, 1.24], [-1.05, 1.279], [-0.99, 1.302], [-0.93, 1.325], [-0.82, 1.35], [-0.53, 1.382],
    [-0.215, 1.392], [0.0, 1.373], [0.13, 1.338], [0.27, 1.278], [0.42, 1.205], [0.53, 1.14], [0.57, 1.08]];
  const DIVIDER = [[-0.405, 1.39], [-0.36, 1.24], [-0.315, 1.10], [-0.29, 1.06]];
  const SAIL = [[0.60, 1.012], [0.57, 1.08], [0.53, 1.14], [0.47, 1.10], [0.46, 1.03]]; // 後照鏡底座那塊黑色三角
  const APILLAR = [[0.58, 1.10], [0.53, 1.14], [0.42, 1.205], [0.27, 1.278], [0.13, 1.338], [0.0, 1.373]];
  // 前葉子板後面的通風口（三片橫的鰭片）
  const VENT = [[0.905, 0.815], [1.06, 0.83], [1.04, 0.79], [0.935, 0.62], [0.88, 0.605], [0.87, 0.65]];
  // 尾燈包到側面、沿著後葉子板上緣往前伸的那段（燻黑）
  const TAIL = [[-1.25, 1.075], [-1.37, 1.118], [-1.56, 1.135], [-1.73, 1.12], [-1.84, 1.09], [-1.87, 1.00], [-1.84, 0.965], [-1.69, 0.99], [-1.46, 1.02], [-1.33, 1.048]];
  function side() {
    return layers(BOX.side, [
      (g) => { smooth(g, DLO); g.fill(); },
      (g) => { // 黑色
        g.lineJoin = 'round'; g.lineWidth = 0.028; smooth(g, DLO); g.stroke(); // 窗框
        line(g, DIVIDER, 0.03);
        poly(g, SAIL); g.fill();
        line(g, APILLAR, 0.012);
        poly(g, VENT); g.fill();
        smooth(g, TAIL); g.fill();
        line(g, [[-1.60, 0.235], [-1.80, 0.25], [-2.0, 0.27]], 0.09); // 後保桿下緣黑色那段包到側面
        line(g, [[1.60, 0.19], [1.85, 0.19], [2.05, 0.19]], 0.05); // 前下巴底下黑邊
        line(g, [[-0.95, 0.21], [0.78, 0.21]], 0.03); // 側裙底下
      },
      (g) => { // 縫
        line(g, [[0.855, 0.99], [0.80, 0.80], [0.788, 0.62], [0.79, 0.44], [0.80, 0.40]], 0.005); // 車門前緣
        line(g, [[-0.34, 1.07], [-0.40, 0.95], [-0.42, 0.80], [-0.41, 0.62], [-0.39, 0.48], [-0.37, 0.42]], 0.005); // 車門後緣
        line(g, [[-0.37, 0.42], [0.80, 0.40]], 0.004); // 車門下緣
        g.lineWidth = 0.004; rrect(g, -0.18, 0.975, -0.02, 1.012, 0.018); g.stroke(); // 門把
        g.lineWidth = 0.004; ellipse(g, -1.285, 0.935, 0.095, 0.085); g.stroke(); // 油箱蓋
        line(g, [[1.40, 0.87], [1.20, 0.935], [0.95, 1.00], [0.86, 1.03]], 0.004); // 引擎蓋和葉子板的縫
        line(g, [[1.62, 0.78], [1.60, 0.60], [1.62, 0.40], [1.66, 0.22]], 0.004); // 前保桿和葉子板
        line(g, [[-1.75, 0.80], [-1.80, 0.60], [-1.84, 0.40], [-1.86, 0.25]], 0.004); // 後保桿
        for (const y of [0.765, 0.72, 0.675]) line(g, [[0.90 + (y - 0.62) * 0.3, y], [1.04 - (0.83 - y) * 0.6, y]], 0.006); // 通風口的鰭片（深色縫）
      },
      null,
    ]);
  }

  // ---- 正面（u＝|z|，畫的時候左右鏡射；y）----
  // 大燈：細長、往後掃到葉子板上
  const HEAD = [[0.50, 0.762], [0.525, 0.772], [0.58, 0.788], [0.64, 0.808], [0.69, 0.826], [0.73, 0.843], [0.77, 0.858], [0.80, 0.872],
    [0.83, 0.878], [0.845, 0.86], [0.845, 0.80], [0.83, 0.755], [0.79, 0.724], [0.735, 0.71], [0.64, 0.698], [0.615, 0.716], [0.55, 0.742]];
  const GRILLE = [[0.0, 0.632], [0.47, 0.632], [0.52, 0.60], [0.575, 0.46], [0.615, 0.33], [0.63, 0.25], [0.59, 0.215], [0.30, 0.20], [0.0, 0.195]];
  const INTAKE = [[0.672, 0.60], [0.80, 0.606], [0.815, 0.54], [0.815, 0.30], [0.80, 0.262], [0.76, 0.252], [0.70, 0.28], [0.675, 0.40]];
  const FOG = [0.745, 0.325, 0.034];
  const BAR = [[0.0, 0.742], [0.25, 0.745], [0.45, 0.752], [0.50, 0.76], [0.52, 0.74], [0.45, 0.728], [0.25, 0.722], [0.0, 0.72]]; // 引擎蓋下緣的黑條（徽章接到大燈）
  const LIP = [[0.0, 0.17], [0.60, 0.172], [0.78, 0.186], [0.815, 0.20], [0.815, 0.17], [0.78, 0.15], [0.0, 0.148]];
  const FPLATE = [-0.26, 0.42, 0.26, 0.53];
  function front() {
    const G = GRILLE.concat(M(GRILLE).slice(1, -1).reverse());
    return layers(BOX.front, [
      (g) => { // R：燈（鍍鉻反射罩）、霧燈、徽章
        both2(HEAD, (P) => { smooth(g, P); g.fill(); });
        for (const s of [1, -1]) { circle(g, FOG[0] * s, FOG[1], FOG[2]); g.fill(); }
        g.lineWidth = 0.009; ellipse(g, 0, 0.704, 0.058, 0.04); g.stroke(); // 徽章（只畫一圈橢圓）
        ellipse(g, 0, 0.704, 0.02, 0.034); g.stroke();
      },
      (g) => { // G：黑色
        smooth(g, G); g.fill();
        both2(BAR, (P) => { poly(g, P); g.fill(); });
        both2(INTAKE, (P) => { smooth(g, P); g.fill(); });
        both2(LIP, (P) => { poly(g, P); g.fill(); });
        g.lineWidth = 0.008; both2(HEAD, (P) => { smooth(g, P); g.stroke(); });
        rrect(g, ...FPLATE.slice(0, 2), ...FPLATE.slice(2), 0.01); g.fill();
        for (const s of [1, -1]) { g.lineWidth = 0.014; circle(g, FOG[0] * s, FOG[1], FOG[2] + 0.008); g.stroke(); }
        g.fillStyle = '#000'; // 進氣口中間白色的橫鰭片（挖掉黑色）
        for (const s of [1, -1]) { poly(g, [[0.69 * s, 0.445], [0.815 * s, 0.465], [0.815 * s, 0.435], [0.70 * s, 0.422]]); g.fill(); }
        g.fillStyle = '#fff';
      },
      null, // B：橘色方向燈（GR Yaris 的在大燈裡，看不到）
      (g) => { // A：燈裡的投射鏡（暗）＋水箱罩、進氣口的網子
        for (const s of [1, -1]) {
          g.save(); smooth(g, HEAD.map(([u, y]) => [u * s, y])); g.clip();
          for (const [u, y, r] of [[0.60, 0.742, 0.019], [0.655, 0.752, 0.019], [0.71, 0.765, 0.019]]) { circle(g, u * s, y, r); g.fill(); }
          g.fillStyle = 'rgb(150,150,150)'; poly(g, [[0.52 * s, 0.70], [0.85 * s, 0.70], [0.85 * s, 0.722], [0.52 * s, 0.745]]); g.fill(); // 燈殼下緣
          g.restore(); g.fillStyle = '#fff';
          circle(g, FOG[0] * s, FOG[1], FOG[2] * 0.55); g.fill();
        }
        // 蜂巢網（斜格子）
        const mesh = (clip) => {
          g.save(); clip(); g.clip(); g.strokeStyle = 'rgba(255,255,255,0.55)'; // 網子淡一點（照片上水箱罩是黑的）
          for (let k = -1.5; k < 1.5; k += 0.032) { line(g, [[k, 0.1], [k + 0.55, 0.75]], 0.003); line(g, [[k, 0.75], [k + 0.55, 0.1]], 0.003); }
          g.restore();
        };
        mesh(() => smooth(g, G));
        for (const s of [1, -1]) mesh(() => smooth(g, INTAKE.map(([u, y]) => [u * s, y])));
        g.fillStyle = '#000'; rrect(g, ...FPLATE.slice(0, 2), ...FPLATE.slice(2), 0.01); g.fill(); g.fillStyle = '#fff'; // 車牌上沒有網子
      },
    ]);
  }

  // ---- 後面（u＝z，y）：燻黑尾燈＋中間燈條；紅色是一個「C」包住黑色的「眼睛」（裡面倒車燈），下緣接一條導光條連到中間 ----
  // 位置：照片上左右對稱的兩點一起三角定位（yaris3d/mtri.mjs），再用 probe.mjs 投回車身
  const LAMP = [[0.36, 1.10], [0.60, 1.10], [0.72, 1.085], [0.77, 1.05], [0.785, 1.00], [0.775, 0.94], [0.74, 0.905], [0.67, 0.886],
    [0.53, 0.891], [0.46, 0.903], [0.40, 0.928], [0.36, 0.95]];
  const BARR = [[0.0, 1.09], [0.40, 1.09], [0.40, 0.935], [0.36, 0.958], [0.30, 0.972], [0.0, 0.976]];
  const CRED = [[0.36, 1.058], [0.60, 1.060], [0.69, 1.056], [0.732, 1.037], [0.748, 0.99], [0.738, 0.945], [0.71, 0.918], [0.66, 0.906], [0.60, 0.906]]; // 紅色 C（上緣＋外側＋下緣）
  const GUIDE = [[0.66, 0.906], [0.53, 0.912], [0.46, 0.924], [0.41, 0.943], [0.37, 0.962], [0.32, 0.979], [0.20, 0.988], [0.0, 0.99]]; // 下緣往內、爬上去沿著燈條下緣到中間
  const VENTR = [0.58, 0.40, 0.78, 0.515]; // 外側不要超過 0.78，不然會沿著保桿側面拉長
  function rear() {
    const B = BARR.concat(M(BARR).slice(1, -1).reverse());
    const S = (P, s) => P.map(([u, y]) => [u * s, y]);
    return layers(BOX.rear, [
      (g) => { // R：紅色 C、導光條、下面的紅色反光片
        for (const s of [1, -1]) {
          line(g, S(CRED, s), 0.032); line(g, S(GUIDE, s), 0.03);
          poly(g, [[0.62 * s, 0.37], [0.76 * s, 0.37], [0.755 * s, 0.35], [0.625 * s, 0.35]]); g.fill();
        }
      },
      (g) => { // G：燻黑燈殼、燈條、車牌、下面的擴散器、排氣管開口、後擋四周
        both2(LAMP, (P) => { smooth(g, P); g.fill(); });
        poly(g, B); g.fill();
        rrect(g, -0.165, 0.76, 0.165, 0.92, 0.012); g.fill(); // 車牌
        poly(g, [[-0.60, 0.49], [0.60, 0.49], [0.66, 0.42], [0.80, 0.34], [0.78, 0.28], [-0.78, 0.28], [-0.80, 0.34], [-0.66, 0.42]]); g.fill(); // 擴散器
        poly(g, [[-0.66, 1.08], [0.66, 1.08], [0.58, 1.30], [0.44, 1.42], [-0.44, 1.42], [-0.58, 1.30]]); g.fill(); // 後擋、擾流下面（黑色）
        for (const s of [1, -1]) { // 通風口的黑色橫條
          g.save(); rrect(g, ...(s > 0 ? VENTR : [-VENTR[2], VENTR[1], -VENTR[0], VENTR[3]]), 0.02); g.clip();
          for (const y of [0.425, 0.455, 0.485]) line(g, [[-1, y], [1, y]], 0.016);
          g.restore();
        }
        g.strokeStyle = '#000'; // 紅色的地方不要黑
        for (const s of [1, -1]) { line(g, S(CRED, s), 0.032); line(g, S(GUIDE, s), 0.03); }
        g.strokeStyle = '#fff';
        for (const s of [1, -1]) { // C 在內側斷開的兩條細縫
          line(g, [[0.525 * s, 1.08], [0.525 * s, 1.04]], 0.006);
          line(g, [[0.525 * s, 0.93], [0.525 * s, 0.89]], 0.006);
        }
      },
      (g) => { for (const s of [1, -1]) { rrect(g, 0.585 * s - 0.03, 0.972, 0.585 * s + 0.03, 0.998, 0.006); g.fill(); } }, // 倒車燈（眼睛裡一小塊白的）
      (g) => { // 縫：尾門下緣、保桿
        line(g, [[-0.47, 0.905], [-0.455, 0.76], [-0.44, 0.70], [-0.40, 0.668], [0.40, 0.668], [0.44, 0.70], [0.455, 0.76], [0.47, 0.905]], 0.004);
        g.lineWidth = 0.003; rrect(g, -0.63, 0.60, 0.63, 0.66, 0.03); g.stroke();
      },
    ]);
  }

  // ---- 上面（x, z）：前擋、後擋、黑色車頂、雨刷飾板、引擎蓋的縫 ----
  const WS = [[0.87, 0], [0.865, 0.30], [0.84, 0.52], [0.79, 0.64], [0.72, 0.70], [0.60, 0.705], [0.40, 0.69], [0.20, 0.665],
    [0.02, 0.64], [-0.08, 0.62], [-0.12, 0.55], [-0.13, 0.30], [-0.13, 0]];
  const BL = [[-1.705, 0], [-1.705, 0.30], [-1.712, 0.44], [-1.73, 0.50], [-1.80, 0.52], [-1.84, 0.50], [-1.85, 0.30], [-1.85, 0]];
  const ROOF = [[-0.10, 0], [-0.10, 0.50], [-0.18, 0.575], [-0.60, 0.585], [-1.10, 0.57], [-1.45, 0.53], [-1.70, 0.47], [-1.75, 0.30], [-1.75, 0]];
  const COWL = [[0.93, 0], [0.925, 0.30], [0.90, 0.52], [0.85, 0.63], [0.80, 0.66], [0.79, 0.62], [0.835, 0.52], [0.855, 0.30], [0.86, 0]];
  function top() {
    return layers(BOX.top, [
      null,
      (g) => {
        frit(g, both(WS), 0.025, [-0.2, -0.04], [0.80, 0.95]);
        smooth(g, both(ROOF)); g.fill();
        smooth(g, both(COWL)); g.fill();
        frit(g, both(BL), 0.02, [-1.74, -1.70], [-1.86, -1.82]);
      },
      (g) => {
        line(g, [[0.93, 0.68], [1.30, 0.76], [1.60, 0.74], [1.80, 0.66], [1.92, 0.50], [1.95, 0], [1.92, -0.50], [1.80, -0.66], [1.60, -0.74], [1.30, -0.76], [0.93, -0.68]], 0.005);
      },
      (g) => { smooth(g, both(WS)); g.fill(); smooth(g, both(BL)); g.fill(); },
    ]);
  }

  // ---- 拉花：Gazoo Racing 風格的紅、黑、白斜條（沒有字、沒有標誌）----
  function livery(sd, style = 'gr') {
    const { c, g } = canvas(BOX.side);
    g.clearRect(-3, -1, 6, 3);
    if (style !== 'gr') return c;
    const band = (col, off, w) => { // 從前輪後面沿著車身下半部往後，到後葉子板往上翹
      g.fillStyle = col;
      poly(g, [[0.95, 0.30 + off], [-0.55, 0.36 + off], [-1.25, 0.62 + off], [-1.95, 0.80 + off], [-1.95, 0.80 + off + w], [-1.25, 0.62 + off + w], [-0.55, 0.36 + off + w], [0.95, 0.30 + off + w]]);
      g.fill();
    };
    band('#111214', 0.0, 0.07);
    band('#d0101c', 0.085, 0.05);
    band('#f4f5f6', 0.15, 0.022);
    g.fillStyle = '#d0101c'; // 車門上三條斜的短條
    for (let i = 0; i < 3; i++) { const x = 0.55 - i * 0.09; poly(g, [[x, 0.52], [x + 0.05, 0.52], [x - 0.07, 0.78], [x - 0.12, 0.78]]); g.fill(); }
    return c;
  }
  function frontLivery(style = 'gr') {
    const { c, g } = canvas(BOX.front);
    g.clearRect(-2, -1, 4, 3);
    if (style !== 'gr') return c;
    g.fillStyle = '#d0101c'; // 下巴上一條紅線
    poly(g, [[-0.86, 0.212], [0.86, 0.212], [0.86, 0.19], [-0.86, 0.19]]); g.fill();
    return c;
  }

  return {
    side, rear, top,
    fronts: { base: front },
    livery, frontLivery,
    livDefault: 0,
    nose: () => 'base',
    // 輪拱內側變黑的半徑比挖洞的半徑大一點點，不然洞壁剛好在邊界上會一條黑一條白
    U: { uXr: -1.39, uXf: 1.17, uFx: [1.40, 1.50], uRx: [-1.72, -1.80], uWell: [0.319, 0.373, 0.87], uWellR: [0.319, 0.388, 0.885], uGlassY: 0.98 },
  };
})();

// ---- yaris-spec.js ----
// 3D Toyota GR Yaris：輪子（BBS 鍛造 10 輻，五組 V 形）、黑色後照鏡、GR 大尾翼（鵝頸支架）、原廠車頂擾流、雙邊排氣、賽道套件
// 車身是 yaris-body.mjs 切出來的 body-yaris(-q).glb，表面細節在 yaris-look.js。

// 一片有厚度的四邊形板子（四個角依序），往法線兩邊各長 th/2
function YARIS_slab(pts, th) {
  const v = pts.map((p) => new THREE.Vector3(...p));
  const n = new THREE.Vector3().crossVectors(v[1].clone().sub(v[0]), v[3].clone().sub(v[0])).normalize().multiplyScalar(th / 2);
  const T = v.map((p) => p.clone().add(n)), B = v.map((p) => p.clone().sub(n));
  const quads = [[T[0], T[1], T[2], T[3]], [B[3], B[2], B[1], B[0]]];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quads.push([B[i], B[j], T[j], T[i]]); }
  const a = [];
  for (const [p, q, r, w] of quads) a.push(...p.toArray(), ...q.toArray(), ...r.toArray(), ...p.toArray(), ...r.toArray(), ...w.toArray());
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); g.computeVertexNormals();
  return g;
}

// 輪框：BBS 鍛造 18 吋，十根細輻條兩兩一組（五組 V 形），在輪轂那邊靠在一起、到輪框外緣平均分開
function YARIS_wheel(rim, w, mats) {
  const g = new THREE.Group();
  const ro = rim - 0.012, rh = 0.07, zo = w / 2 - 0.028, zi = w / 2 - 0.075;
  for (let j = 0; j < 5; j++) {
    const a = (j * 2 * Math.PI) / 5 + Math.PI / 10;
    for (const s of [-1, 1]) {
      const ai = a + s * 0.075, ao = a + s * (Math.PI / 10); // 輪轂那邊靠近、外緣平均分開（十個尖端每 36 度一個）
      const P = (r, ang, z, off) => [Math.cos(ang) * r - Math.sin(ang) * off, Math.sin(ang) * r + Math.cos(ang) * off, z];
      const wi = 0.0095, wo = 0.0065;
      g.add(new THREE.Mesh(YARIS_slab([P(rh, ai, zi, -wi), P(ro, ao, zo, -wo), P(ro, ao, zo, wo), P(rh, ai, zi, wi)], 0.02), mats.chrome));
    }
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.045, 40), mats.chrome);
  hub.geometry.rotateX(Math.PI / 2); hub.position.z = zi + 0.004; g.add(hub);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ro + 0.003, 0.006, 8, 96), mats.chrome);
  ring.position.z = zo + 0.004; g.add(ring);
  return g;
}
YARIS_wheel.capInset = 0.06;

// GR 大尾翼：黑色主翼、兩片大端板、兩支從尾門上緣彎上去勾在翼面上的鵝頸支架；底下留原廠擾流
function YARIS_spoiler(mats) {
  const g = new THREE.Group();
  const sh = new THREE.Shape(); // 側面形狀（x, y），往 z 拉
  sh.moveTo(-1.575, 1.345); sh.lineTo(-1.66, 1.338); sh.lineTo(-1.775, 1.305); sh.lineTo(-1.79, 1.285); sh.lineTo(-1.70, 1.282); sh.lineTo(-1.60, 1.305); sh.closePath();
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.94, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.008, bevelSegments: 2 }), mats.gloss);
  m.geometry.translate(0, 0, -0.47); g.add(m);
  return g;
}
function YARIS_grWing(mats) {
  const g = new THREE.Group();
  g.add(YARIS_spoiler(mats));
  // 位置從車尾照片量的（左右對稱的點一起三角定位，yaris3d/mtri.mjs、epplane.mjs）：
  // 端板尖角 (-1.784, 1.451, ±0.441)、前下角 (-1.466, 1.205, ±0.609)，端板是直立的、往後收（跟著尾門兩側變窄）
  // 主翼後緣 (-1.74, 1.432)、弦長 0.23、前緣低 17 度，貼著端板上緣
  const TIP = [-1.784, 1.451, 0.441], K = 0.168 / 0.318; // 端板往前每 1 公尺往外 0.528
  const zAt = (x) => TIP[2] + (x - TIP[0]) * K; // 端板（右邊）在 x 的位置
  const chord = 0.23, ang = -0.297, te = [-1.74, 1.432];
  const cx = te[0] + (chord / 2) * Math.cos(ang), cy = te[1] + (chord / 2) * Math.sin(ang);
  // 翼剖面（倒過來的機翼：下面彎、上面平），翼展跟著兩邊端板：前緣寬、後緣窄
  const s = new THREE.Shape(), N = 20, top = [], bot = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, xc = (1 - Math.cos(Math.PI * t)) / 2;
    const th = 0.12 * 5 * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);
    const camber = -0.05 * Math.sin(Math.PI * xc);
    top.push([xc, camber + th]); bot.push([xc, camber - th]);
  }
  const P = (p) => [(-p[0] + 0.5) * chord, p[1] * chord];
  s.moveTo(...P(top[0])); for (const p of top.slice(1)) s.lineTo(...P(p)); for (const p of bot.slice().reverse().slice(1)) s.lineTo(...P(p));
  const bg = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 4 });
  bg.translate(0, 0, -0.5);
  const pos = bg.attributes.position, c = Math.cos(ang), sn = Math.sin(ang);
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i), ly = pos.getY(i), lz = pos.getZ(i);
    pos.setXYZ(i, cx + lx * c - ly * sn, cy + lx * sn + ly * c, lz * 2 * (zAt(cx + lx * c - ly * sn) + 0.004));
  }
  bg.computeVertexNormals();
  g.add(new THREE.Mesh(bg, mats.gloss));
  // 後緣往上的小翼片（格尼片）
  const fl = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 2 * zAt(te[0])), mats.gloss);
  fl.position.set(te[0] + 0.004, te[1] + 0.006, 0); fl.rotation.z = ang; g.add(fl);
  // 端板：直立的鰭，尖角在後上，前下角靠在 C 柱外面；座標是（沿著端板往前 s、比尖角低多少 dy）
  const ep = new THREE.Shape();
  ep.moveTo(0, 0); ep.lineTo(0.40, -0.124); ep.lineTo(0.405, -0.16); ep.lineTo(0.36, -0.246); ep.lineTo(0.294, -0.203);
  ep.lineTo(0.146, -0.143); ep.lineTo(0.02, -0.105); ep.lineTo(-0.008, -0.07); ep.closePath();
  for (const sz of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.ExtrudeGeometry(ep, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.004, bevelSegments: 1 }), mats.gloss);
    e.geometry.translate(0, 0, -0.004);
    const f = new THREE.Vector3(1, 0, sz * K).normalize(), up = new THREE.Vector3(0, 1, 0), n = f.clone().cross(up);
    e.matrixAutoUpdate = false;
    e.matrix.makeBasis(f, up, n).setPosition(TIP[0], TIP[1], sz * TIP[2]);
    g.add(e);
  }
  // 鵝頸支架：從尾門上的擾流往上、繞到主翼後緣後面，再從上面勾住翼面
  const st = new THREE.Shape();
  st.moveTo(-1.640, 1.336); st.lineTo(-1.688, 1.328);
  st.bezierCurveTo(-1.745, 1.345, -1.792, 1.39, -1.785, 1.438);
  st.bezierCurveTo(-1.78, 1.462, -1.72, 1.462, -1.665, 1.408);
  st.lineTo(-1.685, 1.412);
  st.bezierCurveTo(-1.71, 1.438, -1.745, 1.448, -1.758, 1.432);
  st.bezierCurveTo(-1.768, 1.40, -1.72, 1.35, -1.640, 1.336);
  for (const sz of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(st, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 8 }), mats.gloss);
    m.position.z = sz * 0.20 - 0.007; g.add(m);
  }
  return g;
}

// 排氣管尾端：圓的鈦色管口（外面亮、裡面黑），在後保桿兩個角下面
function YARIS_exhaust(mats, x, y, z) {
  const g = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.14, 32, 1, true), mats.pipe);
  tube.geometry.rotateZ(Math.PI / 2); g.add(tube);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.047, 0.004, 8, 32), mats.pipe);
  lip.rotation.y = Math.PI / 2; lip.position.x = -0.07; g.add(lip);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(0.044, 32), mats.black);
  inner.rotation.y = -Math.PI / 2; inner.position.x = -0.03; g.add(inner);
  g.position.set(x, y, z);
  return g;
}

const YARIS_AERO = {
  front: [[2.025, 0], [2.02, 0.30], [2.005, 0.50], [1.98, 0.62], [1.94, 0.72], [1.87, 0.79]], back: 1.80, y: 0.132, rods: [1.97, 0.165],
  canard: { S: [1.905, 0.765], t: [-0.59, 0.81], ys: [0.33, 0.25] },
  skirt: { y: 0.16, x0: -0.95, x1: 0.78, z0: 0.82, z1: 0.915 },
  diff: { x0: -1.70, x1: -1.96, x2: -2.07, y0: 0.235, y1: 0.255, y2: 0.31, w: 0.56, fin0: -1.78 },
};

const YARIS_SPEC = {
  look: YARIS_LOOK, paint: '#eceeef', metal: 0.12, seat: 0x1c1d20,
  wheels: { xf: 1.17, xr: -1.39, R: 0.319, rim: 0.2286, trackF: 0.7675, trackR: 0.7825, wF: 0.225, wR: 0.225, style: YARIS_wheel },
  mirror: (paint, mats, s) => { const m = mirror(mats.gloss, mats, s); m.position.set(0.60, 1.10, s * 0.79); m.scale.setScalar(1.25); return m; },
  wings: {
    gr: (paint, mats) => YARIS_grWing(mats),
    stock: (paint, mats) => YARIS_spoiler(mats),
    none: () => new THREE.Group(),
  },
  wing: 'gr',
  interior: { dx: 0.05, cage: false, wheelZ: 0.36, dashX: 0.55, dashY: 0.93, bench: { x: -0.88, shelfX: -1.45, shelfY: 1.03 } },
  build(body, paint, mats) { // 套件：原廠（什麼都不加）、賽道（碳纖維前下巴＋風刀＋側裙刀片＋擴散器）
    mats.pipe = new THREE.MeshPhysicalMaterial({ color: 0xb9b4ad, roughness: 0.25, metalness: 1, side: THREE.DoubleSide });
    for (const s of [-1, 1]) body.add(YARIS_exhaust(mats, -1.975, 0.27, s * 0.528));
    const aero = aeroKit(mats, YARIS_AERO); aero.visible = false; body.add(aero);
    return (kit) => { aero.visible = kit === 'track'; };
  },
  kit: 'stock',
};

// 照片相機（yaris3d/fit3.mjs、fit-front4.mjs 擬合）：photo1＝車尾那張（2048×1152），photo2＝車頭那張（738×399）
const YARIS_CAMS = {
  photo1: { a: 141.615, d: 8.693, h: 0.78, tx: -0.371, ty: 0.749, fov: 14.094, rl: -0.152 },
  photo2: { a: 38.933, d: 5.932, h: 0.854, tx: 0.35, ty: 0.685, fov: 20.034, rl: -0.309 },
};

const YARIS_GARAGE = {
  name: 'Toyota GR Yaris', sub: '白色 GR Yaris · 3D 試做版',
  paints: [['#eceeef', '珍珠白'], ['#b30f1f', '情熱紅'], ['#0e0f11', '寶石黑'], ['#5d6166', '金屬灰'], ['#c3c7cc', '銀'], ['#1f4fb8', '藍'], ['#f2c21a', '黃'], ['#1e7f4a', '綠']],
  opts: {
    wing: [['gr', 'GR 大尾翼'], ['stock', '原廠'], ['none', '不要']],
    kit: [['stock', '原廠'], ['track', '賽道']],
    height: [['0', '原廠'], ['-0.03', '降低'], ['-0.05', '貼地']],
    livery: [['gr', 'GR 條紋'], ['none', '不要']],
  },
  state: { paint: '#eceeef', rim: 'black', caliper: '#c8141e', wing: 'gr', kit: 'stock', height: '0', livery: 'none', tint: 'light' },
};

// ---- gc8-look.js ----
// 3D GC8 Impreza WRX STI coupe 的表面細節（投影貼圖），做法跟 gtr-look.js 一樣。
// 位置都是照 Nick 那兩張藍色 GC8 照片量的：照片上的點從相機打光線到車身，得到車身上的 (x, y, z)。

const GC8_LOOK = (() => {
  const M = (pts) => pts.map(([u, y]) => [-u, y]); // 左右鏡射
  const S = (pts, s) => pts.map(([u, y]) => [u * s, y]);
  const rrect = (g, x0, y0, x1, y1, r) => { g.beginPath(); g.roundRect(x0, y0, x1 - x0, y1 - y0, r); };
  const circle = (g, x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); };
  const ell = (g, x, y, rx, ry, a = 0) => { g.beginPath(); g.ellipse(x, y, rx, ry, a, 0, Math.PI * 2); };

  // ---- 側面（x, y）----
  // 側窗：無框車門玻璃＋後面的小窗，上緣就在車頂邊下面（量出來的）
  const DLO = [[-1.10, 0.931], [-1.132, 0.965], [-1.139, 1.042], [-1.064, 1.138], [-0.954, 1.224], [-0.783, 1.301], [-0.60, 1.318],
    [-0.385, 1.321], [-0.097, 1.322], [0.082, 1.318], [0.15, 1.30], [0.216, 1.272], [0.383, 1.157], [0.526, 1.044], [0.655, 0.93],
    [0.60, 0.918], [0.124, 0.922], [-0.414, 0.923], [-1.012, 0.927]];
  const BLINE = [[-0.372, 1.325], [-0.394, 1.325], [-0.43, 0.92], [-0.408, 0.92]]; // 車門玻璃和後窗中間的黑條
  const BELT = [[0.64, 0.921], [0.124, 0.918], [-0.414, 0.919], [-1.012, 0.925], [-1.10, 0.928]];
  function side() {
    return layers(BOX.side, [
      (g) => { poly(g, DLO); g.fill(); },
      (g) => { // 黑色
        poly(g, BLINE); g.fill();
        g.lineJoin = 'round'; g.lineWidth = 0.016; poly(g, DLO); g.stroke(); // 窗框膠條
        line(g, BELT, 0.02);
        ell(g, 0.892, 0.685, 0.024, 0.012); g.fill(); // 側方向燈
        rrect(g, -0.40, 0.772, -0.24, 0.79, 0.008); g.fill(); // 門把凹槽
      },
      (g) => { // 縫
        line(g, [[0.70, 0.91], [0.80, 0.84], [0.832, 0.78], [0.83, 0.64], [0.824, 0.53], [0.834, 0.40], [0.84, 0.30]], 0.005); // 車門前緣
        line(g, [[-0.418, 0.915], [-0.43, 0.84], [-0.471, 0.728], [-0.495, 0.558], [-0.487, 0.38], [-0.47, 0.30]], 0.005); // 車門後緣
        line(g, [[-0.47, 0.30], [0.84, 0.29]], 0.004); // 車門下緣（側裙上面）
        g.lineWidth = 0.004; rrect(g, -0.42, 0.762, -0.22, 0.80, 0.015); g.stroke(); // 門把
        rrect(g, -1.60, 0.71, -1.42, 0.84, 0.03); g.stroke(); // 油箱蓋
        line(g, [[-1.72, 0.60], [-1.95, 0.60], [-2.2, 0.60]], 0.004); // 後保桿上緣
        line(g, [[-1.70, 0.60], [-1.72, 0.45], [-1.66, 0.30]], 0.004); // 後保桿前緣（輪拱後面）
        line(g, [[1.64, 0.56], [1.66, 0.40], [1.62, 0.24]], 0.004); // 前保桿後緣（輪拱前面）
        line(g, [[1.64, 0.555], [1.80, 0.555], [2.1, 0.55]], 0.004); // 前保桿上緣
      },
      null,
    ]);
  }

  // ---- 正面（u＝|z|，左右鏡射畫；y）----
  const HEAD = [[0.386, 0.64], [0.41, 0.652], [0.57, 0.668], [0.72, 0.678], [0.795, 0.668], [0.812, 0.625], [0.806, 0.575],
    [0.77, 0.559], [0.58, 0.562], [0.40, 0.563], [0.385, 0.59]];
  const GRILLE = [[-0.30, 0.65], [0.30, 0.65], [0.335, 0.635], [0.345, 0.575], [0.325, 0.553], [-0.325, 0.553], [-0.345, 0.575], [-0.335, 0.635]];
  const AMBER = [[0.585, 0.452], [0.70, 0.455], [0.79, 0.452], [0.80, 0.40], [0.70, 0.397], [0.58, 0.398], [0.572, 0.425]];
  const MOUTH = [[-0.36, 0.488], [0.36, 0.488], [0.395, 0.46], [0.40, 0.29], [0.36, 0.245], [-0.36, 0.245], [-0.40, 0.29], [-0.395, 0.46]];
  const DUCT = [[0.62, 0.385], [0.785, 0.385], [0.79, 0.30], [0.74, 0.27], [0.64, 0.27], [0.61, 0.32]]; // 方向燈下面的導風口
  const FOG = [0.505, 0.335, 0.105]; // STI 霧燈蓋（圓的）
  function front() {
    return layers(BOX.front, [
      (g) => { // R：大燈（鍍鉻反射罩）、車頭徽章
        for (const s of [1, -1]) { smooth(g, S(HEAD, s)); g.fill(); }
        ell(g, 0, 0.603, 0.052, 0.034); g.fill();
      },
      (g) => { // G：黑色
        smooth(g, GRILLE); g.fill();
        smooth(g, MOUTH); g.fill();
        for (const s of [1, -1]) {
          smooth(g, S(DUCT, s)); g.fill();
          circle(g, FOG[0] * s, FOG[1], FOG[2]); g.fill(); // 煙燻色的霧燈蓋
          g.lineWidth = 0.006; smooth(g, S(HEAD, s)); g.stroke();
          g.lineWidth = 0.004; smooth(g, S(AMBER, s)); g.stroke();
        }
        line(g, [[-0.86, 0.548], [-0.40, 0.552], [0.40, 0.552], [0.86, 0.548]], 0.004); // 保桿上緣的縫
        rrect(g, -0.16, 0.335, 0.16, 0.44, 0.01); g.fill(); // 車牌（黑底）
      },
      (g) => { for (const s of [1, -1]) { smooth(g, S(AMBER, s)); g.fill(); } }, // B：橘色方向燈
      (g) => { // A：燈裡面的暗色細節、開口裡的網子
        for (const s of [1, -1]) {
          g.save(); smooth(g, S(HEAD, s)); g.clip();
          g.fillStyle = 'rgb(200,200,200)'; poly(g, S([[0.30, 0.54], [0.90, 0.54], [0.90, 0.575], [0.30, 0.578]], s)); g.fill();
          g.strokeStyle = 'rgb(160,160,160)'; g.lineWidth = 0.006;
          circle(g, 0.70 * s, 0.618, 0.042); g.stroke(); circle(g, 0.49 * s, 0.61, 0.036); g.stroke();
          g.fillStyle = 'rgb(90,90,90)'; circle(g, 0.70 * s, 0.618, 0.022); g.fill(); circle(g, 0.49 * s, 0.61, 0.02); g.fill();
          line(g, [[0.60 * s, 0.56], [0.60 * s, 0.675]], 0.004); // 大燈中間的分隔
          g.restore(); g.fillStyle = g.strokeStyle = '#fff';
        }
        rrect(g, -0.035, 0.583, 0.035, 0.623, 0.018); g.fill(); // 徽章中間
        for (const P of [GRILLE, MOUTH, DUCT, M(DUCT)]) { // 網子
          g.save(); smooth(g, P); g.clip(); g.lineWidth = 0.003;
          for (let k = -1.4; k < 1.4; k += 0.016) { line(g, [[k, 0.2], [k + 0.5, 0.7]], 0.003); line(g, [[k, 0.7], [k + 0.5, 0.2]], 0.003); }
          g.restore();
        }
        for (const s of [1, -1]) { g.lineWidth = 0.008; circle(g, FOG[0] * s, FOG[1], FOG[2] - 0.01); g.stroke(); } // 霧燈蓋的邊
      },
    ]);
  }

  // ---- 後面（u＝z，y）：寬的尾燈（上紅下白）、行李箱、保桿 ----
  const TAIL = [[0.36, 0.80], [0.53, 0.803], [0.70, 0.785], [0.79, 0.745], [0.81, 0.69], [0.80, 0.642], [0.66, 0.638], [0.40, 0.652], [0.355, 0.67]];
  function rear() {
    return layers(BOX.rear, [
      (g) => { for (const s of [1, -1]) { g.save(); smooth(g, S(TAIL, s)); g.clip(); g.fillRect(-1, 0.70, 2, 0.2); g.restore(); } },
      (g) => {
        g.lineWidth = 0.012; for (const s of [1, -1]) { smooth(g, S(TAIL, s)); g.stroke(); }
        rrect(g, -0.16, 0.34, 0.15, 0.51, 0.01); g.fill(); // 車牌
        poly(g, [[-0.80, 0.20], [0.80, 0.20], [0.76, 0.315], [-0.76, 0.315]]); g.fill(); // 下面黑色
      },
      (g) => { for (const s of [1, -1]) { g.save(); smooth(g, S(TAIL, s)); g.clip(); g.fillRect(-1, 0.63, 2, 0.068); g.restore(); } }, // 倒車燈（白）
      (g) => {
        line(g, [[-0.36, 0.83], [-0.36, 0.626], [0.36, 0.626], [0.36, 0.83]], 0.004); // 行李箱蓋
        line(g, [[-0.88, 0.598], [0.88, 0.598]], 0.004); // 保桿上緣
        line(g, [[-0.19, 0.325], [-0.19, 0.525], [0.18, 0.525], [0.18, 0.325]], 0.004); // 車牌凹槽
      },
    ]);
  }

  // ---- 上面（x, z）：前擋、後擋、雨刷飾板、引擎蓋和行李箱的縫、進氣口 ----
  const WS = [[0.835, 0], [0.832, 0.25], [0.815, 0.46], [0.77, 0.60], [0.70, 0.665], [0.55, 0.61], [0.405, 0.555], [0.30, 0.505],
    [0.235, 0.44], [0.215, 0.35], [0.24, 0.22], [0.268, 0.10], [0.276, 0]];
  const BL = [[-1.02, 0], [-1.02, 0.30], [-1.03, 0.50], [-1.05, 0.555], [-1.19, 0.59], [-1.31, 0.605], [-1.40, 0.60], [-1.43, 0.52],
    [-1.455, 0.30], [-1.465, 0]];
  const COWL = [[0.905, 0], [0.90, 0.30], [0.89, 0.50], [0.86, 0.66], [0.80, 0.70], [0.78, 0.64], [0.815, 0.50], [0.83, 0.30], [0.835, 0]];
  function top() {
    return layers(BOX.top, [
      null,
      (g) => {
        frit(g, both(WS), 0.03, [0.20, 0.33], [0.79, 0.90]);
        frit(g, both(BL), 0.03, [-1.07, -0.98], [-1.50, -1.43]);
        smooth(g, both(COWL)); g.fill();
        for (const s of [1, -1]) { rrect(g, 1.66, 0.43 * s - 0.05, 1.735, 0.43 * s + 0.05, 0.01); g.fill(); } // 小導風口
      },
      (g) => {
        line(g, [[0.92, 0.705], [1.30, 0.735], [1.70, 0.75], [1.93, 0.735], [2.03, 0.66], [2.07, 0.45], [2.08, 0], [2.07, -0.45], [2.03, -0.66], [1.93, -0.735], [1.70, -0.75], [1.30, -0.735], [0.92, -0.705]], 0.005);
        line(g, [[-1.48, 0.63], [-1.80, 0.66], [-2.02, 0.62], [-2.09, 0.50], [-2.10, 0], [-2.09, -0.50], [-2.02, -0.62], [-1.80, -0.66], [-1.48, -0.63]], 0.005);
      },
      (g) => { smooth(g, both(WS)); g.fill(); smooth(g, both(BL)); g.fill(); },
    ]);
  }

  // ---- 拉花：照片那台的 STI 貼紙（後葉子板的爪痕＋WRX 字、車門的細線）----
  function livery(sd, style = 'wrx') {
    const { c, g } = canvas(BOX.side);
    g.clearRect(-3, -1, 6, 3);
    if (style === 'none') return c;
    // 車身側面的白色細線（從後葉子板到車門前緣）
    g.fillStyle = '#eef0f2';
    poly(g, [[-0.955, 0.584], [0.83, 0.564], [0.83, 0.554], [-0.955, 0.574]]); g.fill();
    g.fillStyle = 'rgba(40,52,90,0.55)';
    poly(g, [[-0.94, 0.594], [0.83, 0.574], [0.83, 0.570], [-0.94, 0.590]]); g.fill();
    // 爪痕：一排往後上方翹的尖刺，越前面越小
    g.fillStyle = '#c9c8bd';
    poly(g, [[-0.955, 0.548], [-0.93, 0.548], [-0.80, 0.395], [-0.83, 0.395]]); g.fill();
    for (let i = 0; i < 7; i++) {
      const x0 = -0.905 + i * 0.047, h = 0.10 - i * 0.008, w = 0.02 - i * 0.0012;
      poly(g, [[x0, 0.548], [x0 + w * 0.7, 0.548], [x0 + 0.055 + w, 0.548 - h], [x0 + 0.05, 0.548 - h + 0.012]]); g.fill();
    }
    // WRX 字：白字＋薄荷綠的邊
    g.fillStyle = '#7fc9b0';
    text(g, 'WRX', -0.706, 0.452, 0.058, { italic: true, mirror: sd < 0, skew: 0.25 });
    g.fillStyle = '#f4f5f6';
    text(g, 'WRX', -0.709, 0.455, 0.056, { italic: true, mirror: sd < 0, skew: 0.25 });
    // 下面的粉紅細線＋小方塊
    g.fillStyle = '#e8246e';
    poly(g, [[-0.83, 0.424], [-0.62, 0.424], [-0.62, 0.419], [-0.83, 0.419]]); g.fill();
    rrect(g, -0.64, 0.414, -0.595, 0.434, 0.004); g.fill();
    // 車門前面的小字（只畫成一條灰線）＋粉紅方塊
    g.fillStyle = 'rgba(210,214,220,0.8)';
    poly(g, [[0.38, 0.527], [0.74, 0.517], [0.74, 0.511], [0.38, 0.521]]); g.fill();
    g.fillStyle = '#e8246e'; rrect(g, 0.75, 0.506, 0.785, 0.522, 0.003); g.fill();
    return c;
  }
  function frontLivery() { const { c, g } = canvas(BOX.front); g.clearRect(-2, -1, 4, 3); return c; }

  return {
    side, rear, top,
    fronts: { base: front },
    livery, frontLivery,
    livDefault: 1,
    nose: () => 'base',
    U: { uXr: -1.24, uXf: 1.28, uFx: [1.80, 1.86], uRx: [-1.84, -1.90], uWell: [0.295, 0.359, 0.86], uGlassY: 0.93 },
  };
})();

// ---- gc8-spec.js ----
// 3D Subaru Impreza WRX STI coupe（GC8）的設定：輪子（金色六輻）、STI 高尾翼、後照鏡、排氣管、引擎蓋進氣口、賽道套件、車庫選項

// 照片那台的輪框：六根寬寬的直輻條（Speedline 拉力賽風格），從中間往外微微凸出來
function GC8_spokes(rim, w, mats) {
  const g = new THREE.Group();
  const ri = 0.068, ro = rim - 0.006, zi = w / 2 - 0.062, zo = w / 2 - 0.022;
  const len = ro - ri, tilt = Math.atan2(zo - zi, len);
  const sh = new THREE.Shape(); // 輻條（徑向長度 len，中間寬、外面稍窄）
  sh.moveTo(0, -0.036); sh.lineTo(len, -0.03); sh.lineTo(len, 0.03); sh.lineTo(0, 0.036); sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 2 });
  geo.translate(0, 0, -0.02);
  for (let j = 0; j < 6; j++) {
    const arm = new THREE.Group(); arm.rotation.z = (j * Math.PI) / 3 + Math.PI / 2;
    const m = new THREE.Mesh(geo, mats.chrome); m.position.set(ri, 0, zi); m.rotation.y = -tilt;
    arm.add(m); g.add(arm);
  }
  // 中間的輪轂（跟輪框同色）＋外圈薄薄的一圈
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.1, 0.045, 48), mats.chrome);
  hub.geometry.rotateX(Math.PI / 2); hub.position.z = zi - 0.004; g.add(hub);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ro + 0.004, 0.005, 8, 96), mats.chrome);
  ring.position.z = zo + 0.008; g.add(ring);
  return g;
}
GC8_spokes.capInset = 0.055;

// STI 高尾翼：兩片大的側板（也是支柱）從行李箱斜斜往上，中間一片厚的翼片，全部車身色
function GC8_stiWing(paint, mats, { x = -2.03, y = 1.205, span = 1.20, chord = 0.25, zp = 0.60 } = {}) {
  const g = new THREE.Group();
  const s = new THREE.Shape(), N = 20, top = [], bot = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, xc = (1 - Math.cos(Math.PI * t)) / 2;
    const th = 0.16 * 5 * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);
    const camber = 0.03 * Math.sin(Math.PI * xc);
    top.push([xc, camber + th]); bot.push([xc, camber - th]);
  }
  const P = (p) => [(-p[0] + 0.5) * chord, p[1] * chord];
  s.moveTo(...P(top[0])); for (const p of top.slice(1)) s.lineTo(...P(p)); for (const p of bot.slice().reverse().slice(1)) s.lineTo(...P(p));
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: span, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 3, curveSegments: 4 }), paint);
  blade.geometry.translate(0, 0, -span / 2); blade.rotation.z = -0.07; blade.position.set(x, y, 0); g.add(blade);
  // 側板：前緣從行李箱往後上方斜，後緣幾乎垂直（照片 1 量的）
  const ep = new THREE.Shape();
  ep.moveTo(-1.76, 0.99); ep.lineTo(-1.84, 1.03); ep.quadraticCurveTo(-1.95, 1.20, -1.975, 1.255); ep.quadraticCurveTo(-1.99, 1.275, -2.03, 1.272);
  ep.lineTo(-2.12, 1.255); ep.quadraticCurveTo(-2.145, 1.25, -2.14, 1.22); ep.lineTo(-2.10, 1.05); ep.quadraticCurveTo(-2.09, 1.0, -2.05, 0.985); ep.closePath();
  const epGeo = new THREE.ExtrudeGeometry(ep, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 3, curveSegments: 10 });
  for (const sz of [-1, 1]) { const e = new THREE.Mesh(epGeo, paint); e.position.z = sz * zp - 0.011; g.add(e); }
  return g;
}

// 圓的排氣管尾端（左後）
function GC8_tip(mats, x, y, z) {
  const g = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.16, 32, 1, true), mats.alu);
  tube.geometry.rotateZ(Math.PI / 2); tube.material.side = THREE.DoubleSide; g.add(tube);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(0.041, 32), mats.black);
  inner.rotation.y = -Math.PI / 2; inner.position.x = -0.04; g.add(inner);
  g.position.set(x, y, z);
  return g;
}

const GC8_AERO = {
  front: [[2.19, 0], [2.18, 0.30], [2.14, 0.50], [2.07, 0.66], [1.97, 0.765], [1.86, 0.82]], back: 1.90, y: 0.19, rods: [2.12, 0.245],
  canard: { S: [2.0, 0.70], t: [-0.67, 0.74], ys: [0.32, 0.245] },
  skirt: { y: 0.18, x0: -0.86, x1: 0.84, z0: 0.84, z1: 0.935 },
  diff: { x0: -1.80, x1: -2.02, x2: -2.19, y0: 0.255, y1: 0.27, y2: 0.315, w: 0.62, fin0: -1.90 },
};

const GC8_SPEC = {
  look: GC8_LOOK, paint: '#1a4cc0', metal: 0.4, seat: 0x1c1d20,
  wheels: { xf: 1.28, xr: -1.24, R: 0.307, rim: 0.2286, trackF: 0.7625, trackR: 0.7575, wF: 0.225, wR: 0.225, style: GC8_spokes },
  mirror: (paint, mats, s) => { const m = mirrorR34(paint, mats, s); m.position.set(0.60, 0.95, s * 0.755); m.scale.set(1.05, 1.0, 1.0); return m; },
  wings: { sti: (paint, mats) => GC8_stiWing(paint, mats) },
  wing: 'sti',
  interior: { dx: 0.03, cage: false, wheelZ: 0.37, dashX: 0.52, dashY: 0.86, bench: { x: -0.92, shelfX: -1.30, shelfY: 0.975 } },
  build(body, paint, mats) { // 套件：原廠（照片那台）、賽道（前下巴＋風刀＋側裙刀片＋擴散器）
    body.add(GC8_tip(mats, -2.10, 0.27, -0.40));
    // 引擎蓋進氣口、兩個小導風口裡面是黑的
    const ins = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.034, 0.48), mats.black);
    ins.position.set(1.345, 0.882, 0); body.add(ins);
    for (const s of [-1, 1]) { const v = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.016, 0.11), mats.black); v.position.set(1.68, 0.812, s * 0.485); body.add(v); }
    const aero = aeroKit(mats, GC8_AERO); aero.visible = false; body.add(aero);
    return (kit) => { aero.visible = kit === 'track'; };
  },
  kit: 'stock',
};

// 照片相機（疊圖用）：照片 1＝前 3/4（3840×2559），照片 2＝後 3/4（499×374，另一台同型車）
const GC8_CAMS = {
  photo1: { a: -35.0198, d: 9.9785, h: 1.7371, tx: 0.3663, ty: 0.7262, fov: 15.7783, rl: 0.4842 },
  photo2: { a: -145.2113, d: 5.6906, h: 0.2816, tx: -0.638, ty: 0.7136, fov: 25.3017, rl: -1.5171 },
};

const GC8_GARAGE = {
  name: 'Subaru Impreza WRX STI', sub: 'GC8 雙門 · 金色輪框那台 · 3D 試做版',
  paints: [['#1a4cc0', 'WR 藍'], ['#f2f3f5', '白'], ['#141518', '黑'], ['#c3c8ce', '銀'], ['#c8141e', '紅'], ['#f2c200', '音速黃'], ['#1e5b35', '綠']],
  opts: {
    wing: [['sti', 'STI 尾翼'], ['none', '不要']],
    kit: [['stock', '原廠'], ['track', '賽道']],
    height: [['0', '原廠'], ['-0.03', '降低'], ['-0.05', '貼地']],
    livery: [['wrx', 'WRX 貼紙'], ['none', '不要']],
  },
  state: { paint: '#1a4cc0', rim: 'gold', caliper: '#c8141e', wing: 'sti', kit: 'stock', height: '0', livery: 'wrx', tint: 'light' },
};

// ---- p918-look.js ----
// 3D Porsche 918 Spyder 的表面細節（投影貼圖），做法跟 gtr-look.js 一樣。
// 位置照 Nick 那兩張 918 照片量的（兩張照片的相機反推後，把照片上的點交會或打到車身上）。
// 拉花：stripes＝照片 1 的紅、深藍、淺藍條紋＋6 號；salzburg＝照片 2 的紅白＋白色圓牌 25 號（不畫品牌字樣和標誌）。

const P918_LOOK = (() => {
  const M = (pts) => pts.map(([u, y]) => [-u, y]); // 左右鏡射
  const rrect = (g, x0, y0, x1, y1, r) => { g.beginPath(); g.roundRect(x0, y0, x1 - x0, y1 - y0, r); };
  const circle = (g, x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); };

  // ---- 側面（x, y）----
  // 側窗：A 柱後面、車頂下緣、防滾架前面、腰線上面
  const DLO = [[0.575, 0.868], [0.50, 0.925], [0.40, 1.00], [0.30, 1.07], [0.225, 1.112], [0.12, 1.128], [0.0, 1.132], [-0.10, 1.128],
    [-0.15, 1.115], [-0.17, 1.06], [-0.19, 0.95], [-0.20, 0.872], [0.10, 0.862], [0.40, 0.862]];
  const APILLAR = [[0.62, 0.845], [0.52, 0.915], [0.41, 1.00], [0.30, 1.08], [0.20, 1.135]];
  const INTAKE = [[-0.655, 0.80], [-0.66, 0.60], [-0.70, 0.535], [-0.80, 0.51], [-0.905, 0.52], [-0.915, 0.62], [-0.90, 0.78], [-0.84, 0.81]];
  const VENT = [[0.76, 0.805], [0.86, 0.835], [0.97, 0.845], [0.99, 0.82], [0.88, 0.80], [0.78, 0.785]]; // 前葉子板後面的出風口
  function side() {
    return layers(BOX.side, [
      (g) => { smooth(g, DLO); g.fill(); },
      (g) => { // 黑色
        g.lineJoin = 'round'; g.lineWidth = 0.018; smooth(g, DLO); g.stroke();
        line(g, [[0.60, 0.852], [0.10, 0.858], [-0.21, 0.866]], 0.02); // 腰線的黑邊
        smooth(g, INTAKE); g.fill();
        smooth(g, VENT); g.fill();
        poly(g, [[0.86, 0.20], [-0.98, 0.21], [-0.98, 0.10], [0.86, 0.10]]); g.fill(); // 碳纖維側裙
        rrect(g, -0.38, 0.775, -0.26, 0.79, 0.006); g.fill(); // 門把
      },
      (g) => { // 縫
        line(g, [[0.64, 0.842], [0.74, 0.74], [0.785, 0.60], [0.80, 0.42], [0.79, 0.23]], 0.005); // 車門前緣
        line(g, [[0.79, 0.23], [-0.50, 0.24]], 0.004); // 車門下緣
        line(g, [[-0.50, 0.24], [-0.56, 0.36], [-0.62, 0.50], [-0.64, 0.66], [-0.62, 0.84]], 0.005); // 車門後緣（進氣口前面）
        line(g, [[1.92, 0.40], [2.02, 0.50], [2.12, 0.58]], 0.004); // 前保桿接縫
        line(g, [[-1.93, 0.40], [-2.03, 0.52], [-2.15, 0.64]], 0.004); // 後保桿接縫
      },
      null,
    ]);
  }

  // ---- 正面（u＝|z|，畫的時候左右鏡射；y）----
  // 大燈：立在前葉子板鼓包上的水滴形，裡面四顆 LED 排成十字
  const HEAD = [[0.44, 0.612], [0.52, 0.655], [0.64, 0.70], [0.76, 0.726], [0.855, 0.716], [0.895, 0.672], [0.875, 0.625], [0.76, 0.598],
    [0.60, 0.588], [0.49, 0.592]];
  const LEDS = [[0.70, 0.665], [0.775, 0.69], [0.775, 0.638], [0.85, 0.665]];
  const SIDE_IN = [[0.36, 0.40], [0.72, 0.40], [0.755, 0.36], [0.74, 0.25], [0.70, 0.21], [0.40, 0.21], [0.36, 0.25]]; // 兩側大進氣口
  const CENTER_IN = [[-0.28, 0.24], [0.28, 0.24], [0.30, 0.20], [0.28, 0.135], [-0.28, 0.135], [-0.30, 0.20]];   // 中間下面
  function front() {
    return layers(BOX.front, [
      (g) => { for (const P of [HEAD, M(HEAD)]) { smooth(g, P); g.fill(); } }, // R：燈
      (g) => { // G：黑色
        for (const P of [SIDE_IN, M(SIDE_IN)]) { smooth(g, P); g.fill(); }
        smooth(g, CENTER_IN); g.fill();
        poly(g, [[-0.95, 0.125], [0.95, 0.125], [0.95, 0.0], [-0.95, 0.0]]); g.fill(); // 下巴
        g.lineWidth = 0.008; for (const P of [HEAD, M(HEAD)]) { smooth(g, P); g.stroke(); }
      },
      null,
      (g) => { // A：燈裡的 LED（暗色鏡片）、進氣口的橫條
        for (const s of [1, -1]) {
          g.save(); smooth(g, HEAD.map(([u, y]) => [u * s, y])); g.clip();
          g.fillStyle = 'rgb(215,215,215)'; g.fillRect(-1, 0.5, 2, 0.3);
          g.fillStyle = '#000'; for (const [u, y] of LEDS) { circle(g, u * s, y, 0.021); g.fill(); }
          g.strokeStyle = '#000'; g.lineWidth = 0.006; line(g, [[0.50 * s, 0.622], [0.66 * s, 0.655]], 0.006);
          g.restore(); g.fillStyle = g.strokeStyle = '#fff';
        }
        for (const P of [SIDE_IN, M(SIDE_IN)]) {
          g.save(); smooth(g, P); g.clip();
          for (let y = 0.225; y < 0.40; y += 0.03) line(g, [[-0.8, y], [0.8, y]], 0.008);
          g.restore();
        }
        g.save(); smooth(g, CENTER_IN); g.clip();
        for (let k = -1.2; k < 1.2; k += 0.02) { line(g, [[k, 0.10], [k + 0.2, 0.30]], 0.004); line(g, [[k, 0.30], [k + 0.2, 0.10]], 0.004); }
        g.restore();
      },
    ]);
  }

  // ---- 後面（u＝z，y）：細長的尾燈、中間的黑格柵、車牌、擴散器 ----
  const TAIL = [[0.37, 0.838], [0.60, 0.842], [0.80, 0.838], [0.905, 0.815], [0.91, 0.775], [0.86, 0.758], [0.62, 0.768], [0.38, 0.782], [0.355, 0.81]];
  function rear() {
    return layers(BOX.rear, [
      (g) => { for (const P of [TAIL, M(TAIL)]) { smooth(g, P); g.fill(); } },
      (g) => {
        g.lineWidth = 0.008; for (const P of [TAIL, M(TAIL)]) { smooth(g, P); g.stroke(); }
        for (const s of [1, -1]) line(g, [[0.42 * s, 0.808], [0.84 * s, 0.797]], 0.012); // 尾燈中間的暗線
        rrect(g, -0.33, 0.835, 0.33, 0.895, 0.02); g.fill(); // 尾翼下面的格柵
        rrect(g, -0.27, 0.485, 0.27, 0.598, 0.01); g.fill(); // 車牌
        poly(g, [[-0.66, 0.12], [0.66, 0.12], [0.62, 0.33], [-0.62, 0.33]]); g.fill(); // 擴散器
        for (const s of [1, -1]) { smooth(g, [[0.66 * s, 0.34], [0.86 * s, 0.36], [0.90 * s, 0.46], [0.70 * s, 0.44]]); g.fill(); } // 下面兩角的出風口
        for (const s of [1, -1]) { rrect(g, Math.min(0.56 * s, 0.84 * s), 0.715, Math.max(0.56 * s, 0.84 * s), 0.728, 0.004); g.fill(); } // 反光片
      },
      (g) => { rrect(g, -0.13, 0.30, 0.13, 0.318, 0.006); g.fill(); }, // 倒車燈
      (g) => { line(g, [[-0.90, 0.47], [-0.40, 0.46], [0.40, 0.46], [0.90, 0.47]], 0.004); line(g, [[-0.35, 0.90], [0.35, 0.90]], 0.004); },
    ]);
  }

  // ---- 上面（x, z）：前擋、後窗、碳纖維車頂、引擎蓋格柵、排氣管、前車蓋的縫 ----
  const WS = [[0.80, 0], [0.795, 0.30], [0.77, 0.50], [0.72, 0.63], [0.64, 0.715], [0.56, 0.70], [0.46, 0.66], [0.36, 0.60], [0.28, 0.53],
    [0.26, 0.40], [0.25, 0.20], [0.25, 0]];
  const ROOF = [[0.25, 0], [0.25, 0.30], [0.24, 0.50], [0.20, 0.585], [0.0, 0.60], [-0.14, 0.585], [-0.20, 0.50], [-0.22, 0]];
  const RW = [[-0.40, 0], [-0.40, 0.26], [-0.43, 0.30], [-0.52, 0.30], [-0.53, 0]]; // 車頂後面直立的小後窗
  const DECK = [[-0.60, 0], [-0.60, 0.28], [-0.80, 0.33], [-1.40, 0.33], [-1.90, 0.31], [-2.08, 0.27], [-2.10, 0]]; // 兩條扶壁中間
  function top() {
    return layers(BOX.top, [
      (g) => { // R：霧黑（引擎蓋格柵、排氣管口）
        smooth(g, both(DECK)); g.fill();
      },
      (g) => { // G：黑色（前擋黑邊、雨刷飾板、碳纖維車頂、引擎蓋）
        frit(g, both(WS), 0.025, [0.23, 0.30], [0.77, 0.82]);
        smooth(g, both(ROOF)); g.fill();
      },
      (g) => { // B：縫（前車蓋、引擎蓋）
        line(g, [[0.84, 0.46], [1.30, 0.50], [1.80, 0.44], [2.12, 0.36], [2.24, 0.20], [2.26, 0], [2.24, -0.20], [2.12, -0.36], [1.80, -0.44], [1.30, -0.50], [0.84, -0.46]], 0.005);
        g.lineWidth = 0.005; smooth(g, both(ROOF)); g.stroke();
        g.save(); smooth(g, both(DECK)); g.clip(); // 引擎蓋上的百葉
        for (let x = -1.22; x > -2.05; x -= 0.04) line(g, [[x, -0.30], [x, 0.30]], 0.01);
        g.restore();
      },
      (g) => { smooth(g, both(WS)); g.fill(); smooth(g, both(RW)); g.fill(); }, // A：玻璃
    ]);
  }

  // ---- 拉花 ----
  const LB = '#48aee6', DB = '#123a85', RED = '#d4202c', WHITE = '#f4f5f6', INK = '#111214';
  // 條紋：[寬度, 顏色]，從外（下面／後面）往內
  const MARTINI = [[0.028, LB], [0.01, DB], [0.028, LB], [0.012, null], [0.11, RED], [0.012, null], [0.028, LB], [0.01, DB], [0.028, LB]];
  // 沿著一條中心線畫一束條紋（中心線：水平一段 → 圓弧往上 → 直的往上）
  function band(g, stripes, draw) {
    const W = stripes.reduce((s, [w]) => s + w, 0);
    let off = -W / 2;
    for (const [w, col] of stripes) {
      if (col) { g.strokeStyle = col; g.lineWidth = w + 0.002; g.lineCap = 'butt'; g.lineJoin = 'round'; g.beginPath(); draw(off + w / 2); g.stroke(); }
      off += w;
    }
  }
  function livery(sd, style = 'stripes') {
    const { c, g } = canvas(BOX.side);
    g.clearRect(-3, -1, 6, 3);
    if (style === 'ff') style = 'stripes'; // 截圖頁建貼圖時用的預設名字
    if (style === 'stripes') {
      // 車門下面一束橫的，到後輪前面往上彎、沿著後葉子板前緣往上到頂
      const cx = -0.74, cy = 0.70, r = 0.365;
      band(g, MARTINI, (o) => { // o：離中心線的距離（正的往外＝下面／後面）
        const rr = r + o;
        g.moveTo(0.84, cy - rr); g.lineTo(cx, cy - rr);
        g.arc(cx, cy, rr, -Math.PI / 2, -Math.PI, true);
        g.lineTo(cx - rr - 0.08, 0.97);
      });
      g.fillStyle = WHITE;
      text(g, '6', 0.46, 0.585, 0.34, { mirror: sd < 0, weight: 700, font: 'Arial, sans-serif' });
      // 前車蓋條紋在上面這條沒有車身的地方（y＞1.2），給車蓋上的貼片用（x, z 對到 y＝1.2＋(z＋0.2)／3）
      const Y = (z) => 1.2 + (z + 0.2) / 3;
      const lid = [[0.028, LB], [0.01, DB], [0.028, LB], [0.012, null], [0.11, RED], [0.012, null], [0.05, WHITE], [0.012, null], [0.028, LB], [0.01, DB], [0.028, LB]];
      let z = 0.13 - lid.reduce((s, [w]) => s + w, 0) / 2;
      for (const [w, col] of lid) { if (col) { g.fillStyle = col; g.fillRect(0.70, Y(z), 1.70, (w + 0.002) / 3); } z += w; }
    } else if (style === 'salzburg') {
      g.fillStyle = RED;
      // 前葉子板上緣整片紅、輪子後面往下掃到側裙
      smooth(g, [[2.25, 0.60], [1.90, 0.745], [1.50, 0.80], [1.10, 0.815], [0.80, 0.80], [0.66, 0.78], [0.62, 0.62], [0.66, 0.40], [0.72, 0.24],
        [0.86, 0.24], [0.90, 0.40], [0.90, 0.62], [1.00, 0.70], [1.30, 0.74], [1.70, 0.72], [2.05, 0.66], [2.30, 0.54], [2.36, 0.62], [2.36, 1.0], [2.25, 1.0]]);
      g.fill();
      // 車門上三條橫的（越往後越細），側裙一條
      for (const [y, h, x1] of [[0.815, 0.04, -0.45], [0.66, 0.05, -0.50], [0.50, 0.045, -0.55]]) {
        poly(g, [[0.70, y + h / 2], [x1 + 0.12, y + h / 2 - 0.004], [x1, y], [x1 + 0.12, y - h / 2 + 0.004], [0.70, y - h / 2]]); g.fill();
      }
      poly(g, [[0.86, 0.255], [-0.92, 0.255], [-0.98, 0.20], [-0.92, 0.175], [0.86, 0.175]]); g.fill();
      // 白色圓牌＋黑色 25
      g.fillStyle = WHITE; circle(g, 0.06, 0.60, 0.19); g.fill();
      g.fillStyle = INK; text(g, '25', 0.06, 0.60, 0.23, { mirror: sd < 0, weight: 700, font: 'Arial, sans-serif' });
    }
    return c;
  }
  // 正面：stripes 那組條紋從車頭往車蓋爬（只有斜的車頭那段看得到）
  function frontLivery(style = 'stripes') {
    const { c, g } = canvas(BOX.front);
    g.clearRect(-2, -1, 4, 3);
    if (style === 'ff') style = 'stripes';
    if (style === 'stripes') {
      const lid = [[0.028, LB], [0.01, DB], [0.028, LB], [0.012, null], [0.11, RED], [0.012, null], [0.05, WHITE], [0.012, null], [0.028, LB], [0.01, DB], [0.028, LB]];
      let z = 0.13 - lid.reduce((s, [w]) => s + w, 0) / 2;
      for (const [w, col] of lid) { if (col) { g.fillStyle = col; g.fillRect(-z - w - 0.001, 0.40, w + 0.002, 0.60); } z += w; }
    }
    return c;
  }

  return {
    side, rear, top,
    fronts: { base: front },
    livery, frontLivery,
    livDefault: 1,
    nose: () => 'base',
    U: { uXr: -1.4165, uXf: 1.3135, uFx: [1.80, 1.90], uRx: [-2.0, -2.1], uWell: [0.347, 0.385, 0.95], uWellR: [0.364, 0.40, 0.95], uGlassY: 0.80 },
  };
})();

// ---- p918-spec.js ----
// 3D Porsche 918 Spyder：車身以外的零件（輪框、後照鏡、主動尾翼、頂出排氣管、賽道套件）和車庫選項
// 車漆：照片兩台都是消光（霧面）的，車庫只會換顏色，所以這裡每一幀照顏色去查該用消光還是亮面（P918_FINISH）。

// 各車色的漆面：[粗糙度, 金屬感, 清漆]（清漆不能是 0，patchPaint 的 shader 要用到 clearcoat）
const P918_FINISH = {
  '5a5e63': [0.55, 0.35, 0.02], '1c1d20': [0.6, 0.1, 0.02], 'c5c9ce': [0.1, 1.0, 1], 'a9acb0': [0.28, 0.75, 1],
  'f1f1ee': [0.3, 0.0, 1], 'c30f24': [0.3, 0.05, 1], 'a4cc1e': [0.3, 0.1, 1],
};
function P918_sync(paint, parts) { // 照目前的顏色套漆面，零件跟著車身同色同漆面
  const f = P918_FINISH[paint.color.getHexString()] || [0.3, 0.12, 1];
  paint.roughness = f[0]; paint.metalness = f[1]; paint.clearcoat = f[2]; paint.clearcoatRoughness = f[2] < 0.5 ? 0.6 : 0.03;
  for (const m of parts) { m.color.copy(paint.color); m.roughness = paint.roughness; m.metalness = paint.metalness; m.clearcoat = paint.clearcoat; m.clearcoatRoughness = paint.clearcoatRoughness; }
}
const P918_parts = []; // 跟車身同色的零件材質（尾翼、後照鏡殼）
function P918_partMat(paint) {
  const m = new THREE.MeshPhysicalMaterial({ color: paint.color.clone(), roughness: 0.55, metalness: 0.35, clearcoat: 0.02 });
  P918_parts.push(m); return m;
}
// 一片有厚度的板子（四個角，往法線兩邊長 th/2）
function P918_slab(pts, th) {
  const v = pts.map((p) => new THREE.Vector3(...p));
  const n = new THREE.Vector3().crossVectors(v[1].clone().sub(v[0]), v[3].clone().sub(v[0])).normalize().multiplyScalar(th / 2);
  const T = v.map((p) => p.clone().add(n)), B = v.map((p) => p.clone().sub(n));
  const quads = [[T[0], T[1], T[2], T[3]], [B[3], B[2], B[1], B[0]]];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quads.push([B[i], B[j], T[j], T[i]]); }
  const a = [];
  for (const [p, q, r, w] of quads) a.push(...p.toArray(), ...q.toArray(), ...r.toArray(), ...p.toArray(), ...r.toArray(), ...w.toArray());
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); g.computeVertexNormals();
  return g;
}

const P918_red = new THREE.MeshPhysicalMaterial({ color: 0xc8141e, roughness: 0.3, metalness: 0.4, clearcoat: 1 });
// 輪框：10 組 V 形雙輻（照片兩台都是細的多輻），中間紅色中央螺帽
function P918_spokes(rim, w, mats) {
  const g = new THREE.Group();
  const ro = rim - 0.014, rh = 0.075, zo = w / 2 - 0.025, zi = w / 2 - 0.09 - (w - 0.265) * 0.5;
  for (let j = 0; j < 10; j++) {
    const a = (j * 2 * Math.PI) / 10;
    for (const s of [-1, 1]) {
      const ai = a + s * 0.075, ao = a + s * 0.15;
      const P = (r, ang, z, off) => [Math.cos(ang) * r - Math.sin(ang) * off, Math.sin(ang) * r + Math.cos(ang) * off, z];
      g.add(new THREE.Mesh(P918_slab([P(rh, ai, zi, -0.0085), P(ro, ao, zo, -0.006), P(ro, ao, zo, 0.006), P(rh, ai, zi, 0.0085)], 0.018), mats.chrome));
    }
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.096, 0.045, 40), mats.chrome);
  hub.geometry.rotateX(Math.PI / 2); hub.position.z = zi + 0.004; g.add(hub);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ro + 0.002, 0.006, 8, 96), mats.chrome);
  ring.position.z = zo + 0.004; g.add(ring);
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.05, 0.03, 6), P918_red);
  nut.geometry.rotateX(Math.PI / 2); nut.position.z = zi + 0.03; g.add(nut);
  return g;
}
P918_spokes.capInset = 0.06;

// 後照鏡：碳纖維的水滴形殼，細支架從車門上緣伸出去
function P918_mirror(paint, mats, s) {
  const g = new THREE.Group(), head = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14, Math.PI / 2, Math.PI), mats.carbon); // 前半個橢球，後面開口放鏡子
  shell.scale.set(0.12, 0.052, 0.075); head.add(shell);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(1, 28), mats.mirrorGlass);
  glass.scale.set(0.068, 0.047, 1); glass.rotation.y = -Math.PI / 2; glass.position.x = 0.004; head.add(glass);
  head.position.set(0.40, 0.845, s * 0.965); head.rotation.y = s * 0.10; g.add(head);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.17, 10), mats.carbon);
  arm.rotation.x = s * -1.25; arm.rotation.z = 0.25; arm.position.set(0.50, 0.825, s * 0.885); g.add(arm);
  return g;
}

// 主動尾翼（升起來）：車尾上面一片寬翼片，兩根支架
function P918_wing(paint, mats) {
  const g = new THREE.Group(), m = P918_partMat(paint);
  const chord = 0.27, span = 1.52, x = -2.12, y = 1.03;
  const s = new THREE.Shape(), N = 20, top = [], bot = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, xc = (1 - Math.cos(Math.PI * t)) / 2;
    const th = 0.10 * 5 * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);
    const cam = -0.04 * Math.sin(Math.PI * xc);
    top.push([xc, cam + th]); bot.push([xc, cam - th]);
  }
  const P = (p) => [(-p[0] + 0.5) * chord, p[1] * chord];
  s.moveTo(...P(top[0])); for (const p of top.slice(1)) s.lineTo(...P(p)); for (const p of bot.slice().reverse().slice(1)) s.lineTo(...P(p));
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: span, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.006, bevelSegments: 2, curveSegments: 4 }), m);
  blade.geometry.translate(0, 0, -span / 2); blade.rotation.z = 0.07; blade.position.set(x, y, 0); g.add(blade);
  for (const sz of [-1, 1]) {
    const st = new THREE.Shape(), hh = y - 0.87;
    st.moveTo(-0.07, 0); st.lineTo(0.09, 0); st.lineTo(0.05, hh); st.lineTo(-0.06, hh); st.closePath();
    const p = new THREE.Mesh(new THREE.ExtrudeGeometry(st, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 }), mats.black);
    p.position.set(x, 0.87, sz * 0.38 - 0.011); g.add(p);
  }
  return g;
}

// 頂出排氣管：引擎蓋上兩根往上的管口（外面鈦色、裡面黑）
function P918_pipes(mats) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.062, 0.12, 32, 1, true), mats.alu);
    t.position.set(-1.02, 0.935, s * 0.285); t.rotation.z = 0.25; g.add(t);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.052, 32), mats.black);
    inner.rotation.x = -Math.PI / 2; inner.rotation.y = 0.25; inner.position.set(-1.03, 0.975, s * 0.285); g.add(inner);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.006, 8, 32), mats.alu);
    lip.rotation.x = Math.PI / 2; lip.rotation.y = 0.25; lip.position.set(-1.005, 0.992, s * 0.285); g.add(lip);
  }
  return g;
}

// 前車蓋上的條紋：從車身網格挑出車蓋那幾塊三角形，貼一層薄片，顏色從側面拉花貼圖 y＞1.2 那條讀（換拉花會一起換）
function P918_lidDecal(body, paint) {
  const shell = body.getObjectByName('paint');
  const fake = { uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <lights_physical_fragment>' };
  paint.onBeforeCompile(fake); // 借車漆 shader 的 uniform（拉花貼圖、uLiv）
  const U = fake.uniforms;
  if (!shell || !U.tLivR) return null;
  const G = shell.geometry, P = G.attributes.position, N = G.attributes.normal, I = G.index.array;
  const pos = [], nor = [];
  const ok = (i) => { const x = P.getX(i), y = P.getY(i), z = P.getZ(i); return x > 0.68 && y > 0.45 && N.getY(i) > 0.3 && z > -0.10 && z < 0.36; };
  for (let t = 0; t < I.length; t += 3) {
    if (!ok(I[t]) || !ok(I[t + 1]) || !ok(I[t + 2])) continue;
    for (let k = 0; k < 3; k++) { const i = I[t + k]; pos.push(P.getX(i) + N.getX(i) * 0.002, P.getY(i) + N.getY(i) * 0.002, P.getZ(i) + N.getZ(i) * 0.002); nor.push(N.getX(i), N.getY(i), N.getZ(i)); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  const m = new THREE.MeshPhysicalMaterial({ roughness: 0.5, metalness: 0.1, clearcoat: 0.02, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tLivR = U.tLivR; sh.uniforms.uLiv = U.uLiv;
    sh.vertexShader = 'varying vec3 vPd;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vPd = position;');
    sh.fragmentShader = 'uniform sampler2D tLivR; uniform float uLiv; varying vec3 vPd;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  vec4 L = texture2D(tLivR, vec2((vPd.x + 2.35) / 4.7, (1.2 + (vPd.z + 0.2) / 3.0) / 1.4));
  if (L.a * uLiv < 0.03) discard;
  diffuseColor = vec4(L.rgb, L.a);`);
  };
  m.customProgramCacheKey = () => 'p918-lid';
  const mesh = new THREE.Mesh(geo, m); mesh.name = 'p918-lid'; mesh.renderOrder = 1;
  return mesh;
}

// 賽道套件的位置（前下巴、風刀、側裙刀片、後擴散器）
const P918_AERO = {
  front: [[2.35, 0], [2.34, 0.30], [2.285, 0.50], [2.19, 0.67], [2.06, 0.80], [1.94, 0.87]], back: 1.90, y: 0.098, rods: [2.27, 0.15],
  canard: { S: [2.16, 0.69], t: [-0.62, 0.78], ys: [0.30, 0.22] },
  skirt: { y: 0.105, x0: -0.95, x1: 0.82, z0: 0.90, z1: 0.99 },
  diff: { x0: -1.85, x1: -2.10, x2: -2.34, y0: 0.13, y1: 0.15, y2: 0.225, w: 0.62, fin0: -1.95 },
};

const P918_SPEC = {
  look: P918_LOOK, paint: '#5a5e63', metal: 0.35, seat: 0x1c1d20,
  wheels: { xf: 1.3135, xr: -1.4165, RF: 0.347, RR: 0.364, rimF: 0.254, rimR: 0.2667, trackF: 0.832, trackR: 0.806, wF: 0.265, wR: 0.325, style: P918_spokes },
  mirror: (paint, mats, s) => P918_mirror(paint, mats, s),
  wings: { stock: (paint, mats) => P918_wing(paint, mats) },
  wing: 'stock',
  interior: { dx: 0.02, cage: false, wheelZ: -0.37, dashX: 0.44, dashY: 0.80 },
  build(body, paint, mats) { // 套件：原廠（什麼都不加）、賽道（碳纖維前下巴＋風刀＋側裙刀片＋擴散器）
    body.add(P918_pipes(mats));
    const lid = P918_lidDecal(body, paint); if (lid) body.add(lid);
    const aero = aeroKit(mats, P918_AERO); aero.visible = false; body.add(aero);
    const parts = P918_parts.splice(0); // 這台車的同色零件
    const shell = body.getObjectByName('paint');
    if (shell) shell.onBeforeRender = () => P918_sync(paint, parts);
    P918_sync(paint, parts);
    return (kit) => { aero.visible = kit === 'track'; };
  },
  kit: 'stock',
};

// 照片相機（camfit：照片 1 從左前方很低的地方拍、照片 2 從左後方用長鏡頭拍）
const P918_CAMS = {
  photo1: { a: 44.5258, d: 5.4243, h: 0.0759, tx: 0.853, ty: 1.0959, fov: 31.8075, rl: -0.8837 },
  photo2: { a: 151.0019, d: 23.3041, h: 2.711, tx: -0.2796, ty: 0.619, fov: 5.4432, rl: 0.8802 },
};

const P918_GARAGE = {
  name: 'Porsche 918 Spyder', sub: '照片那台消光灰 Weissach · 3D 試做版',
  paints: [['#5a5e63', '消光灰'], ['#1c1d20', '消光黑'], ['#c5c9ce', '液態金屬銀'], ['#a9acb0', 'GT 銀'], ['#f1f1ee', '白'], ['#c30f24', '紅'], ['#a4cc1e', '螢光綠']],
  opts: {
    wing: [['stock', '原廠（升起）'], ['none', '不要']],
    kit: [['stock', '原廠'], ['track', '賽道']],
    height: [['0', '原廠'], ['-0.03', '降低'], ['-0.05', '貼地']],
    livery: [['stripes', '紅藍條紋 6 號'], ['salzburg', '紅白 25 號'], ['none', '不要']],
  },
  state: { paint: '#5a5e63', rim: 'gunmetal', caliper: '#9bd400', wing: 'stock', kit: 'stock', height: '0', livery: 'stripes', tint: 'light' },
};


const stage = document.getElementById('stage');
const msg = document.getElementById('msg'), prog = document.getElementById('prog'), status = document.getElementById('status'), hint = document.getElementById('hint');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (e) {
  msg.textContent = '這支手機不支援 3D 畫面（WebGL）'; prog.parentElement.hidden = true;
  throw e;
}
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.prepend(renderer.domElement);

// 攝影棚：亮的像你給的照片（白色背景），暗的像夜晚的車庫
function studioEnv(kind) {
  const s = new THREE.Scene(), light = kind === 'light';
  const room = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 30), new THREE.MeshBasicMaterial({ color: light ? 0x9a9a9a : 0x0b0c0f, side: THREE.BackSide }));
  room.position.y = 5; s.add(room);
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: light ? 0x6a6a6a : 0x151619 }));
  fl.rotation.x = -Math.PI / 2; fl.position.y = -0.99; s.add(fl);
  const panel = (w, h, x, y, z, ry, rx, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0); s.add(m);
  };
  panel(8, 5, 0, 7, 0, 0, Math.PI / 2, light ? 5 : 6);
  panel(16, 0.6, 0, 1.6, 9, Math.PI, 0, light ? 3 : 4);
  panel(16, 0.6, 0, 1.6, -9, 0, 0, 3);
  panel(0.6, 5, 9, 2.4, 0, -Math.PI / 2, 0, 3);
  panel(0.6, 5, -9, 2.4, 0, Math.PI / 2, 0, 2.5);
  return s;
}
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
const ENV = { light: pmrem.fromScene(studioEnv('light'), 0.02).texture, dark: pmrem.fromScene(studioEnv('dark'), 0.02).texture };
const floorMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0 });
const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 72), floorMat);
floor.rotation.x = -Math.PI / 2; scene.add(floor);
function setStudio(kind) {
  const light = kind === 'light';
  scene.environment = ENV[kind];
  const bg = new THREE.Color(light ? 0xdcdcdc : 0x0f1013);
  scene.background = bg; scene.fog = new THREE.Fog(bg, 11, 26);
  floorMat.color.set(light ? 0xe2e2e2 : 0x121316);
  stage.style.background = light ? '#dcdcdc' : '#0f1013';
  status.style.color = light ? '#3a3d42' : '#9AA1AC';
}
setStudio('light');

function shadowTex() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.filter = 'blur(18px)'; g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath(); g.roundRect(40, 40, 432, 176, 60); g.fill();
  g.filter = 'blur(6px)'; g.fillStyle = 'rgba(0,0,0,0.7)';
  for (const [x, y] of [[118, 58], [118, 198], [382, 58], [382, 198]]) { g.beginPath(); g.ellipse(x, y, 40, 16, 0, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const sh = new THREE.Mesh(new THREE.PlaneGeometry(4.9, 2.3), new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false }));
sh.rotation.x = -Math.PI / 2; sh.position.y = 0.002; scene.add(sh);

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minPolarAngle = Math.PI * 0.18; controls.maxPolarAngle = Math.PI * 0.49;
controls.autoRotate = true; controls.autoRotateSpeed = 1.0;
controls.target.set(0, 0.55, 0);

let fitD = 7;
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const hfov = 2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
  fitD = Math.max(2.45 / Math.tan(hfov / 2) * 0.86, 5.2);
  controls.minDistance = fitD * 0.55; controls.maxDistance = fitD * 1.4;
}
new ResizeObserver(resize).observe(stage);
resize();
function view(deg) {
  const a = (deg * Math.PI) / 180;
  const d = fitD * (1 + 0.28 * Math.abs(Math.sin(a)));
  camera.position.set(Math.cos(a) * d, 1.2, -Math.sin(a) * d);
  controls.update();
}
view(38);

// 兩台車：各自的模型檔、名字、選項、預設值；改過的選項各自記住，切回來還是一樣
const PAINT_COMMON = [['#f2f3f5', '白'], ['#141518', '黑'], ['#c3c8ce', '銀'], ['#d0202a', '紅'], ['#f4c21b', '黃'], ['#5b2d9e', '紫'], ['#1e8f4e', '綠']];
const SIZES = {"supra":1304976,"gtr":1707668,"sp3":1379416,"jesko":1696900,"yaris":1544848,"gc8":1532924,"p918":1745044};
const CARS = {
  supra: {
    file: 'tune/supra.glb?h=f69628b4', size: SIZES.supra, spec: SUPRA_SPEC, btn: ['SUPRA', '橘 · 玩命關頭'], name: 'Toyota Supra', sub: '玩命關頭那台 · 3D 試做版',
    paints: [['#ff7414', '玩命關頭橘'], ...PAINT_COMMON, ['#1d4fb8', '藍']],
    opts: {
      wing: [['stock', '原廠'], ['gt', 'GT 大尾翼'], ['none', '不要']],
      kit: [['stock', '原廠'], ['bomex', '玩命關頭'], ['track', '賽道']],
      height: [['0.035', '原廠'], ['0', '降低'], ['-0.022', '貼地']],
      livery: [['ff', '玩命關頭'], ['none', '不要']],
    },
    state: { paint: '#ff7414', rim: 'chrome', caliper: '#9da1a6', wing: 'gt', kit: 'bomex', height: '0', livery: 'ff', tint: 'light' },
  },
  gtr: {
    file: 'tune/gtr.glb?h=4f4f4a5c', size: SIZES.gtr, spec: GTR_SPEC, btn: ['GT-R R34', '藍 · 玩命關頭 4'], name: 'Nissan Skyline GT-R', sub: '玩命關頭 4 那台 R34 · 3D 試做版',
    paints: [['#1d4fc9', '灣岸藍'], ...PAINT_COMMON, ['#ff7414', '橘']],
    opts: {
      wing: [['stock', '原廠'], ['gt', 'GT 大尾翼'], ['none', '不要']],
      kit: [['stock', '原廠'], ['bomex', '玩命關頭'], ['track', '賽道']],
      height: [['0', '原廠'], ['-0.03', '降低'], ['-0.052', '貼地']],
      livery: [['ff', '白色條紋'], ['none', '不要']],
    },
    state: { paint: '#1d4fc9', rim: 'gunmetal', caliper: '#c8141e', wing: 'stock', kit: 'bomex', height: '-0.03', livery: 'none', tint: 'light' },
  },
  // 之後加的車：車子的名字、車色、選項、預設值寫在各自的 <KEY>_GARAGE（sp3-spec.js 等）
  sp3: { file: 'tune/sp3.glb?h=dc0369f5', size: SIZES.sp3, spec: SP3_SPEC, btn: ['SP3', '法拉利 · 紅'], ...SP3_GARAGE },
  jesko: { file: 'tune/jesko.glb?h=218ad737', size: SIZES.jesko, spec: JESKO_SPEC, btn: ['JESKO', '柯尼賽格 · 白'], ...JESKO_GARAGE },
  yaris: { file: 'tune/yaris.glb?h=97cc1c84', size: SIZES.yaris, spec: YARIS_SPEC, btn: ['YARIS', '豐田 GR · 白'], ...YARIS_GARAGE },
  gc8: { file: 'tune/gc8.glb?h=054e4976', size: SIZES.gc8, spec: GC8_SPEC, btn: ['GC8', '速霸陸 · 藍'], ...GC8_GARAGE },
  p918: { file: 'tune/p918.glb?h=67c1216a', size: SIZES.p918, spec: P918_SPEC, btn: ['918', '保時捷 · 灰'], ...P918_GARAGE },
};
// 性能（約略照真車）：馬力、重量、四驅、紅線、極速、風阻；drive＝後驅的車起步時後輪壓到多少重量（引擎在中間的比較會起步）
// price＝大概的行情價（新台幣「萬」，二手車看車況差很多）；tyres＝半熱熔胎、直線加速胎的價錢（萬）
// parts：引擎零件 [代號, 名字, 做什麼, 加幾匹, 多少錢（萬）]，每台車不一樣，便宜的在前面；買了就一直裝著
const PERF = {
  gc8: { price: 150, hp: 280, kg: 1260, awd: 1, red: 8000, vmax: 250, cda: 0.62, eng: 'EJ20 水平對臥四缸渦輪', tyres: [3, 6], parts: [
    ['intake', '高流量進氣', '空濾換成香菇頭', 10, 2], ['ecu', 'ECU 調校', '重寫點火和增壓', 30, 4], ['exhaust', '不鏽鋼排氣', '中尾段換大口徑', 15, 4],
    ['ic', '上置大中冷', '進氣溫度降下來', 15, 5], ['fuel', '大噴油嘴＋汽油泵', '大馬力要更多油', 10, 5], ['header', '等長排氣頭段', '水平對臥的咕嚕聲會變順', 20, 8],
    ['turbo', 'TD05 大渦輪', '換更大顆的渦輪', 100, 20], ['forged', '鍛造活塞連桿', '引擎撐得住高增壓', 40, 35]] },
  yaris: { price: 260, hp: 300, kg: 1280, awd: 1, red: 7000, vmax: 230, cda: 0.66, eng: 'G16E 1.6 三缸渦輪', tyres: [3, 6], parts: [
    ['intake', '高流量進氣', '空濾換成高流量的', 10, 2], ['ecu', 'ECU 調校', '重寫點火和增壓', 40, 4], ['exhaust', '中尾段排氣', '排氣更順', 10, 5],
    ['fuel', '大噴油嘴＋汽油泵', '大馬力要更多油', 10, 5], ['ic', '大中冷', '進氣溫度降下來', 15, 6], ['cams', '賽車凸輪軸', '高轉更有力', 25, 15],
    ['turbo', '混合式大渦輪', '渦輪換大一號', 80, 22], ['forged', '鍛造活塞連桿', '三缸也撐得住高增壓', 40, 38]] },
  supra: { price: 400, hp: 550, kg: 1520, awd: 0, drive: 0.7, red: 7200, vmax: 300, cda: 0.62, eng: '2JZ 直六雙渦輪', tyres: [4, 8], parts: [
    ['intake', '高流量進氣', '空濾換成香菇頭', 15, 2], ['ecu', 'ECU 調校', '重寫點火和增壓', 40, 5], ['exhaust', '3 吋全段排氣', '整條換大口徑', 25, 6],
    ['ic', '前置大中冷', '進氣溫度降下來', 20, 6], ['fuel', '1000cc 噴油嘴＋雙汽油泵', '大馬力要很多油', 30, 8], ['cams', '高角度凸輪軸', '高轉更有力', 60, 18],
    ['turbo', '單顆大渦輪', '兩顆渦輪換成一顆大的', 180, 35], ['forged', '鍛造活塞連桿', '2JZ 撐到 1000 匹', 80, 60]] },
  gtr: { price: 800, hp: 500, kg: 1560, awd: 1, red: 8000, vmax: 290, cda: 0.66, eng: 'RB26 直六雙渦輪', tyres: [4, 8], parts: [
    ['intake', '高流量進氣', '空濾換成香菇頭', 10, 2], ['ecu', 'ECU 調校', '重寫點火和增壓', 40, 6], ['ic', '前置大中冷', '進氣溫度降下來', 20, 7],
    ['exhaust', '鈦合金排氣', '又輕又大口徑', 20, 8], ['fuel', '大噴油嘴＋汽油泵', '大馬力要更多油', 20, 8], ['cams', '高角度凸輪軸', '高轉更有力', 60, 20],
    ['turbo', '雙大渦輪', '兩顆渦輪都換大', 150, 45], ['stroker', 'RB28 鍛造曲軸', '排氣量加到 2.8 升', 80, 80]] },
  p918: { price: 6000, hp: 887, kg: 1675, awd: 1, red: 9150, vmax: 345, cda: 0.62, eng: '4.6 V8＋兩顆電動馬達', tyres: [12, 20], parts: [
    ['filter', '賽車空濾', '吸氣更順', 8, 5], ['flywheel', '輕量化飛輪', '轉速拉得更快', 10, 25], ['exhaust', '鈦合金排氣', '頂出式排氣換鈦合金', 20, 30],
    ['ecu', 'ECU 調校', '引擎和馬達一起重調', 30, 40], ['battery', '電池放電升級', '電池一次放更多電', 40, 120], ['motorF', '前馬達升級', '前輪的電動馬達換大', 40, 150],
    ['motorR', '後馬達升級', '後面的電動馬達換大', 45, 180], ['turbo', 'V8 加裝雙渦輪', '自然進氣改成渦輪', 70, 450]] },
  sp3: { price: 12000, hp: 829, kg: 1485, awd: 0, drive: 0.8, red: 9500, vmax: 340, cda: 0.62, eng: '6.5 V12 自然進氣', tyres: [12, 20], parts: [
    ['filter', '賽車空濾', '吸氣更順', 8, 5], ['flywheel', '輕量化飛輪', '轉速拉得更快', 10, 30], ['ecu', 'ECU 調校', '重寫點火和汽門正時', 20, 35],
    ['exhaust', '鈦合金排氣', 'V12 叫得更大聲', 25, 45], ['intake', '可變長度進氣歧管', '高轉低轉都有力', 15, 60], ['cams', '高角度凸輪軸', '高轉更有力', 30, 90],
    ['forged', '鍛造活塞', '撐得住機械增壓', 20, 150], ['sc', '機械增壓', 'V12 加一顆機械增壓器', 250, 600]] },
  jesko: { price: 15000, hp: 1280, kg: 1420, awd: 0, drive: 0.8, red: 8500, vmax: 330, cda: 0.72, eng: '5.0 V8 雙渦輪', tyres: [12, 20], parts: [
    ['filter', '賽車空濾', '吸氣更順', 10, 8], ['e85', 'E85 生質燃料', '改加 E85，1280 匹變 1600 匹', 320, 30], ['fuel', '大噴油嘴', 'E85 要更多油', 20, 50],
    ['exhaust', '鈦合金排氣', '又輕又大聲', 30, 60], ['ecu', 'ECU 調校', '重寫點火和增壓', 50, 80], ['cams', '賽車凸輪軸', '高轉更有力', 20, 150],
    ['forged', '鍛造內部', '曲軸、活塞都換鍛造', 40, 300], ['turbo', '大渦輪', '兩顆渦輪都換大', 150, 400]] },
};
const TYRES = [[0, '原廠胎', '原本的輪胎'], [1, '半熱熔胎', '起步抓地 +8%'], [2, '直線加速胎', '起步抓地 +16%']];
// 遊戲進度：錢（萬）、有哪些車、每台裝了哪些零件、輪胎（買過哪些、現在用哪個）、每個對手贏過幾次
const GAME = { money: 0, owned: new Set(['gc8']), parts: {}, tyres: {}, wins: {} };
const partsOf = (k) => (GAME.parts[k] ||= []);
const tyresOf = (k) => (GAME.tyres[k] ||= { own: [], use: 0 });
const tyreOf = (k) => GAME.tyres[k]?.use ?? 0;
const hpOf = (k) => PERF[k].hp + PERF[k].parts.reduce((a, p) => a + (partsOf(k).includes(p[0]) ? p[3] : 0), 0);
const money = (w) => (w >= 10000 ? `${+(w / 10000).toFixed(2)} 億` : `${w.toLocaleString('en-US')} 萬`);
const byPrice = (keys) => [...keys].sort((a, b) => PERF[a].price - PERF[b].price); // 照價錢排（便宜的在前面）
const COMMON_OPTS = { wide: [['off', '原廠'], ['on', '寬體']], tint: [['light', '淺'], ['dark', '深']], studio: [['light', '亮'], ['dark', '暗']] };
for (const C of Object.values(CARS)) C.state.wide ??= 'off'; // 寬體每台都有，預設不要
// 每台車都多幾個顏色（那台車本來就有很像的顏色、或同名的就不重複加）
const EXTRA_PAINTS = [['#ff5fa2', '粉紅'], ['#39a7ff', '天空藍'], ['#9bea1a', '螢光綠'], ['#c8a45d', '香檳金'], ['#ff7414', '橘'], ['#5b2d9e', '紫']];
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const alike = (a, b) => { const x = rgbOf(a), y = rgbOf(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 48; };
for (const C of Object.values(CARS)) C.paints = [...C.paints, ...EXTRA_PAINTS.filter(([hex, name]) => !C.paints.some((p) => alike(p[0], hex) || p[1] === name))];
for (const C of Object.values(CARS)) C.opts.livery = livOptions(C.opts.livery); // 通用拉花：火焰、賽車條紋、大便龍車隊（名字撞到車子自己的，用 'gen:' 開頭）
const DEFAULT_LOOK = Object.fromEntries(Object.entries(CARS).map(([k, C]) => [k, { ...C.state }])); // 每台車原本的樣子（對手的車從這個改）
const CALIPERS = [['#9da1a6', '銀'], ['#c8141e', '紅'], ['#f2b705', '黃'], ['#1f54c9', '藍'], ['#ff6a1f', '橘'], ['#9bd400', '螢光綠'], ['#17181b', '黑']];
const RIMS = [['chrome', '鍍鉻', 'conic-gradient(#8a9099, #f4f6f8, #8a9099, #f4f6f8, #8a9099)'], ['gunmetal', '槍灰', '#4b4f55'], ['black', '黑', '#1a1c20'], ['gold', '金', '#c9a043'], ['white', '白', '#f2f3f5']];
const RIM_LOOK = { chrome: [0xe8eaec, 1, 0.07], gunmetal: [0x4b4f55, 1, 0.3], black: [0x16171a, 0.5, 0.35], gold: [0xd2a646, 1, 0.18], white: [0xf0f0f0, 0, 0.3] };
let studioKind = 'light', cur = 'gc8', rideY = 0;
const SAVE_KEY = 'carid.tune';
// 存在這支手機：v2 起多了錢、車、零件、輪胎、贏過誰（now＝馬上存，錢有變的時候用）
function save(now) {
  clearTimeout(save.t);
  const write = () => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 2, cur, studio: studioKind, money: GAME.money, owned: [...GAME.owned], parts: GAME.parts, tyres: GAME.tyres, wins: GAME.wins,
        cars: Object.fromEntries(Object.entries(CARS).map(([k, C]) => [k, C.state])) }));
    } catch { /* 不給存就算了 */ }
  };
  if (now) write(); else save.t = setTimeout(write, 300);
}
function okValue(k, o, v) { // 存的值還是現在有的選項才用（改版後選項可能不一樣）
  const C = CARS[k], has = (list) => !!list && list.some((it) => it[0] === v);
  if (o === 'paint') return has(C.paints);
  if (o === 'rim') return has(RIMS);
  if (o === 'caliper') return has(CALIPERS);
  return has(C.opts[o] || COMMON_OPTS[o]);
}
(function restore() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { d = null; }
  if (!d || typeof d !== 'object') return;
  for (const [k, st] of Object.entries(d.cars || {})) { // 外觀
    if (!CARS[k] || !st) continue;
    for (const [o, v] of Object.entries(st)) if (o in CARS[k].state && okValue(k, o, v)) CARS[k].state[o] = v;
  }
  if (d.v !== 2) return; // 舊版（內容 30）只存了外觀：錢、車、零件從頭開始，開局只有 GC8
  GAME.money = Math.max(0, Math.floor(+d.money || 0));
  for (const k of d.owned || []) if (CARS[k]) GAME.owned.add(k);
  for (const [k, list] of Object.entries(d.parts || {})) if (PERF[k] && Array.isArray(list)) GAME.parts[k] = PERF[k].parts.map((p) => p[0]).filter((id) => list.includes(id));
  for (const [k, t] of Object.entries(d.tyres || {})) {
    if (!PERF[k] || !t) continue;
    const own = [1, 2].filter((n) => (t.own || []).includes(n));
    GAME.tyres[k] = { own, use: own.includes(t.use) ? t.use : 0 };
  }
  for (const [id, n] of Object.entries(d.wins || {})) GAME.wins[id] = Math.max(0, Math.floor(+n || 0));
  if (CARS[d.cur]) cur = d.cur;
  if (d.studio === 'light' || d.studio === 'dark') { studioKind = d.studio; setStudio(studioKind); }
})();
const built = {}; // 已經組好的車：{ supra: S, ... }（最多留 3 台，太多手機記憶體會不夠）
const glbs = {}; // 下載過的車身檔（切回來不用再下載）
const recent = [];
let S = null;

// 把一個選項套到車上
function apply(S, key, v) {
  if (key === 'paint') S.paint.color.set(v);
  if (key === 'rim') { const c = S.mats.chrome, l = RIM_LOOK[v]; c.color.set(l[0]); c.metalness = l[1]; c.roughness = l[2]; }
  if (key === 'caliper') S.mats.caliper.color.set(v);
  if (key === 'wing') S.setWing(v);
  if (key === 'livery') S.tex.setLivery(v);
  if (key === 'tint') S.glass.opacity = v === 'dark' ? 0.66 : 0.34;
  if (key === 'kit') S.setKit(v);
  if (key === 'wide') S.setWide(v === 'on');
}

// 把一台車從畫面拿掉並釋放記憶體（網格、材質、貼圖）
function dispose(key) {
  if (!built[key]) return;
  disposeCar(built[key]);
  delete built[key];
}
function disposeCar(S) {
  S.car.removeFromParent();
  S.car.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    for (const m of o.material ? [].concat(o.material) : []) { for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.dispose(); }
  });
  const T = S.tex;
  for (const t of [T.side, T.rear, T.top, T.livR, T.livL, ...Object.values(T.fronts), ...Object.values(T.livFs)]) if (t && t.dispose) t.dispose();
}
// 車身模型：右半邊的 glb，用 base64 文字存（artifact 只能放這種檔），載入後鏡射成整台
async function fetchCar(C) {
  const res = await fetch(C.file);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const total = +res.headers.get('content-length') || C.size;
  const reader = res.body.getReader(), parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    prog.style.width = Math.min(100, Math.round((got / total) * 100)) + '%';
  }
  if (!/\.txt(\?|$)/.test(C.file)) return new Blob(parts).arrayBuffer(); // App 裡直接放 glb
  const b64 = new TextDecoder().decode(await new Blob(parts).arrayBuffer()).trim();
  const bin = atob(b64), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
// look：這台車要長什麼樣子（預設是你改的；對手的車用它自己的）
async function loadCar(key, look = CARS[key].state) {
  const C = CARS[key];
  if (!glbs[key]) glbs[key] = await fetchCar(C);
  const gltf = await new GLTFLoader().parseAsync(glbs[key].slice(0), '');
  const car = buildCar(C.spec, carGeos(gltf.scene), { wide: WIDE[key] });
  for (const [k, v] of Object.entries(look)) if (k !== 'height') apply(car, k, v);
  car.body.position.y = +look.height;
  return car;
}

const carsEl = document.getElementById('cars');
async function showCar(key) {
  cur = key; save();
  carsEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.car === key)));
  document.getElementById('carName').textContent = CARS[key].name;
  document.getElementById('carSub').textContent = CARS[key].sub;
  renderOptions();
  for (const [k, c] of Object.entries(built)) c.car.visible = k === key;
  const ri = recent.indexOf(key); if (ri >= 0) recent.splice(ri, 1); recent.push(key);
  while (recent.length > 3) dispose(recent.shift());
  S = built[key] || null;
  if (!S) {
    status.hidden = false; msg.textContent = `${CARS[key].btn[0]} 開進車庫中⋯`; prog.parentElement.hidden = false; prog.style.width = glbs[key] ? '100%' : '0%';
    try {
      const car = await loadCar(key);
      if (built[key]) dispose(key);
      built[key] = car; scene.add(car.car);
      if (!recent.includes(key)) { dispose(key); return; } // 載入中已經被換掉很多台了
      car.car.visible = cur === key;
      if (cur === key) S = car;
    } catch (err) {
      msg.textContent = '車子沒載入成功，重新整理再試一次'; prog.parentElement.hidden = true; console.error(err);
      return;
    }
  }
  if (cur !== key) return;
  rideY = +CARS[key].state.height;
  status.hidden = true;
}
for (const k of byPrice(Object.keys(CARS))) {
  const C = CARS[k], b = document.createElement('button');
  b.type = 'button'; b.dataset.car = k; b.setAttribute('aria-pressed', 'false');
  const t = document.createElement('b'), s2 = document.createElement('span'); t.textContent = C.btn[0];
  b.append(t, s2); b.addEventListener('click', () => { if (k !== cur) showCar(k); });
  carsEl.append(b);
}
// 車子按鈕：你的車寫「你的車」，還沒買的寫價錢（鎖起來）
function refreshCarBtns() {
  carsEl.querySelectorAll('button').forEach((b) => {
    const k = b.dataset.car, own = GAME.owned.has(k);
    b.classList.toggle('locked', !own);
    b.querySelector('span').textContent = own ? '你的車' : money(PERF[k].price);
  });
}
refreshCarBtns();

// 手指一碰就停止自動轉
const spinBtn = document.getElementById('spin');
const stopSpin = () => { controls.autoRotate = false; spinBtn.setAttribute('aria-pressed', 'false'); hint.style.opacity = '0'; };
renderer.domElement.addEventListener('pointerdown', stopSpin);
spinBtn.addEventListener('click', () => { controls.autoRotate = !controls.autoRotate; spinBtn.setAttribute('aria-pressed', String(controls.autoRotate)); });
document.querySelectorAll('#views button[data-a]').forEach((b) => b.addEventListener('click', () => { stopSpin(); view(+b.dataset.a); }));

// 選項：依照現在這台車重畫（圓點、分段按鈕）
function chips(el, list, key) {
  el.replaceChildren();
  const st = CARS[cur].state;
  for (const it of list) {
    const b = document.createElement('button');
    b.className = 'chip'; b.type = 'button'; b.title = it[1]; b.setAttribute('aria-label', it[1]);
    b.style.background = it[2] || it[0];
    b.setAttribute('aria-pressed', String(st[key] === it[0]));
    b.addEventListener('click', () => {
      el.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true');
      st[key] = it[0]; save();
      if (S) apply(S, key, it[0]);
    });
    el.append(b);
  }
}
function seg(el) {
  const key = el.dataset.opt, list = CARS[cur].opts[key] || COMMON_OPTS[key];
  const val = key === 'studio' ? studioKind : CARS[cur].state[key];
  el.replaceChildren(); el.classList.toggle('pills', list.length > 4);
  for (const [v, label] of list) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.v = v; b.textContent = label; b.setAttribute('aria-pressed', String(v === val));
    b.addEventListener('click', () => {
      el.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true');
      if (key === 'studio') { studioKind = v; setStudio(v); save(); return; }
      CARS[cur].state[key] = v; save();
      if (key === 'height') { rideY = +v; return; }
      if (S) apply(S, key, v);
    });
    el.append(b);
  }
}
// 規格：價錢、馬力（含裝好的零件）、重量、驅動
function specLine() {
  const P = PERF[cur], el = document.getElementById('carSpec'), em = document.createElement('em');
  em.textContent = `約 NT$ ${money(P.price)}`;
  el.replaceChildren(em, ` · ${hpOf(cur).toLocaleString('en-US')} 匹 · ${P.kg.toLocaleString('en-US')} 公斤 · ${P.awd ? '四驅' : '後驅'}`);
}
// 錢
const cashEl = document.getElementById('cash');
function renderWallet() { cashEl.textContent = `NT$ ${money(GAME.money)}`; }
// 車庫裡的提示（買了什麼、錢不夠）
const gtoastEl = document.getElementById('gtoast');
function gtoast(text, ms = 1400) {
  gtoastEl.textContent = text; gtoastEl.classList.add('show');
  clearTimeout(gtoast.t); gtoast.t = setTimeout(() => gtoastEl.classList.remove('show'), ms);
}
const short = (cost) => `還差 ${money(cost - GAME.money)}，去比賽贏錢`;
// 引擎零件：每台車不一樣，買了就裝上（馬力加上去），比賽照這個算
function partsOpts() {
  const el = document.getElementById('parts'), P = PERF[cur], have = partsOf(cur);
  document.getElementById('engName').textContent = `${P.eng} · 現在 ${hpOf(cur).toLocaleString('en-US')} 匹`;
  el.replaceChildren();
  for (const [id, name, what, hp, cost] of P.parts) {
    const on = have.includes(id), b = document.createElement('button');
    b.type = 'button'; b.className = 'part ' + (on ? 'on' : GAME.money >= cost ? 'can' : 'cant'); b.setAttribute('aria-pressed', String(on));
    const t = document.createElement('b'), d = document.createElement('span'), h = document.createElement('span'), p = document.createElement('span');
    t.textContent = name; d.className = 'd'; d.textContent = what; h.className = 'hp'; h.textContent = `+${hp} 匹`;
    p.className = 'p'; p.textContent = on ? '已裝' : money(cost);
    b.append(t, h, d, p);
    b.addEventListener('click', () => {
      if (have.includes(id)) { gtoast('這個已經裝好了'); return; }
      if (GAME.money < cost) { gtoast(short(cost)); return; }
      GAME.money -= cost; have.push(id); save(true);
      renderWallet(); renderOptions(); gtoast(`裝好${name}，+${hp} 匹`);
    });
    el.append(b);
  }
}
// 輪胎：原廠胎／半熱熔胎／直線加速胎，買過的可以隨時換
function tyreOpts() {
  const el = document.getElementById('tyres'), T = tyresOf(cur), prices = PERF[cur].tyres;
  el.replaceChildren();
  for (const [n, name, what] of TYRES) {
    const own = n === 0 || T.own.includes(n), cost = n ? prices[n - 1] : 0, b = document.createElement('button');
    b.type = 'button'; b.setAttribute('aria-pressed', String(T.use === n)); if (!own && GAME.money < cost) b.className = 'cant';
    const t = document.createElement('b'), d = document.createElement('span'), p = document.createElement('span');
    t.textContent = name; d.className = 'd'; d.textContent = what; p.className = 'p';
    p.textContent = T.use === n ? '用這個' : own ? '換上' : money(cost);
    b.append(t, d, p);
    b.addEventListener('click', () => {
      if (T.use === n) return;
      if (!own) {
        if (GAME.money < cost) { gtoast(short(cost)); return; }
        GAME.money -= cost; T.own.push(n); renderWallet(); gtoast(`換上${name}`);
      }
      T.use = n; save(true); renderOptions();
    });
    el.append(b);
  }
}
// 還沒買的車：看得到、可以轉，下面是「買這台」（按兩次才買，免得按錯）
const buyBtn = document.getElementById('buyCar'), buyHead = document.getElementById('buyHead'), buyNote = document.getElementById('buyNote');
function buyCta() {
  const P = PERF[cur], lack = P.price - GAME.money;
  clearTimeout(buyCta.t); buyBtn.classList.remove('armed');
  buyBtn.disabled = lack > 0;
  buyHead.textContent = lack > 0 ? `還差 ${money(lack)}` : `買這台 · NT$ ${money(P.price)}`;
  buyNote.textContent = lack > 0 ? `這台要 NT$ ${money(P.price)}，去比賽贏錢` : `買了還剩 NT$ ${money(GAME.money - P.price)}`;
}
buyBtn.addEventListener('click', () => {
  const P = PERF[cur];
  if (GAME.owned.has(cur) || GAME.money < P.price) return;
  if (!buyBtn.classList.contains('armed')) {
    buyBtn.classList.add('armed'); buyHead.textContent = `確定要買 ${CARS[cur].btn[0]}？再按一次`;
    clearTimeout(buyCta.t); buyCta.t = setTimeout(buyCta, 3500); return;
  }
  clearTimeout(buyCta.t);
  GAME.money -= P.price; GAME.owned.add(cur); save(true);
  renderWallet(); refreshCarBtns(); renderOptions(); gtoast(`買到 ${CARS[cur].btn[0]} 了！`, 1800);
});
function renderOptions() {
  const own = GAME.owned.has(cur);
  specLine();
  document.getElementById('opts').hidden = !own; document.getElementById('lockNote').hidden = own;
  document.getElementById('toRace').hidden = !own; buyBtn.hidden = own;
  if (!own) { buyCta(); return; }
  partsOpts(); tyreOpts();
  chips(document.getElementById('paints'), CARS[cur].paints, 'paint');
  chips(document.getElementById('rims'), RIMS, 'rim');
  chips(document.getElementById('calipers'), CALIPERS, 'caliper');
  document.querySelectorAll('.seg[data-opt]').forEach(seg);
}
// 重新開始：錢、車、零件、贏過的對手都歸零（按兩次）
const restartBtn = document.getElementById('restart');
restartBtn.addEventListener('click', () => {
  if (!restartBtn.classList.contains('armed')) {
    restartBtn.classList.add('armed'); restartBtn.textContent = '確定？再按一次';
    clearTimeout(restartBtn.t); restartBtn.t = setTimeout(() => { restartBtn.classList.remove('armed'); restartBtn.textContent = '重新開始'; }, 3500); return;
  }
  clearTimeout(restartBtn.t); restartBtn.classList.remove('armed'); restartBtn.textContent = '重新開始';
  Object.assign(GAME, { money: 0, owned: new Set(['gc8']), parts: {}, tyres: {}, wins: {} });
  save(true); renderWallet(); refreshCarBtns();
  if (cur === 'gc8') renderOptions(); else showCar('gc8');
  carsEl.querySelector('[data-car="gc8"]').scrollIntoView({ inline: 'center', block: 'nearest' });
  gtoast('重新開始：你有一台 GC8', 1800);
});
renderWallet();
showCar(cur);
carsEl.querySelector(`[data-car="${cur}"]`).scrollIntoView({ inline: 'center', block: 'nearest' });

// ---- race.src.js ----
// ---- 賽道：400 公尺直線加速賽（你開車庫裡現在這台，對手是一個一個的人，各開各的車）----
// 物理：每台車的馬力、重量、驅動方式、紅線、極速大約照真車（PERF，在車庫那段；裝了引擎零件馬力會加），六速變速箱，
// 起步的抓地力有上限（四驅最好起步，引擎在中間的後驅次之），輪胎可以買更抓地的；外觀不影響速度
// 贏了拿對手的獎金（GAME.money），第一次贏過一個對手，下一個才會出現
// build-art.mjs 把這個檔案接在車庫頁的程式裡（用得到 renderer、scene、CARS、PERF、GAME、loadCar⋯）
const RACE_M = 400, LANE = 2.4;
const GEARS = [3.3, 2.2, 1.62, 1.28, 1.05, 0.86];
const GREEN = [0.88, 0.985]; // 換檔的綠色區（轉速÷紅線）
const torqueAt = (x) => 0.8 + 0.4 * x - 0.4 * x * x;
const $ = (id) => document.getElementById(id);
const hudEl = $('hud'), raceEl = $('race'), oppsEl = $('opps'), resultEl = $('result'), goBtn = $('goBtn'), nitroBtn = $('nitroBtn');
const toastEl = $('toast'), clockEl = $('clock'), spdEl = $('spd'), tachEl = $('tach'), treeEls = [...document.querySelectorAll('#tree i')];
const pMe = $('pMe'), pOpp = $('pOpp');
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

const TYRE_GRIP = [0, 0.08, 0.16]; // 原廠胎、半熱熔胎、直線加速胎
// s：{ key, hp, tyre }（你的車照車庫裝的零件和輪胎，對手的車寫在 OPPS）
function racer(s) {
  const P = PERF[s.key], W = CARS[s.key].spec.wheels;
  const r = W.RR ?? W.R, m = P.kg + 75, wr = (P.red * 2 * Math.PI) / 60, grip = 1.35 * (1 + TYRE_GRIP[s.tyre || 0]);
  return {
    key: s.key, P, m, r, wr, fd: (wr * r) / (GEARS[5] * (P.vmax / 3.6)), Tpk: (s.hp * 745.7) / (wr * 0.95 * torqueAt(0.95)),
    tract: grip * m * 9.81 * (P.awd ? 0.9 : P.drive ?? 0.74), cda: P.cda,
    x: 0, v: 0, gear: 0, shiftT: 0, cut: 0, nitro: 0, nitroUsed: false, go: null, react: null, fin: null, trap: 0, rpm: 0.12, spin: 0,
  };
}
const mySetup = () => ({ key: cur, hp: hpOf(cur), tyre: tyreOf(cur) });
const statLine = (key) => { const P = PERF[key]; return `${hpOf(key).toLocaleString('en-US')} 匹 · ${P.kg.toLocaleString('en-US')} 公斤 · ${P.awd ? '四驅' : '後驅'}`; };

// ---- 對手：從隔壁同學到大魔王，越後面越快、獎金越多（萬）----
// drv：開車的功力（反應秒數、幾轉換檔、幾秒放氮氣）；look：車子的樣子（沒寫的用那台車原本的）
const DRIVERS = {
  rookie: { react: [0.45, 0.7], shift: [0.78, 0.93], nitro: null },
  ok: { react: [0.3, 0.5], shift: [0.84, 0.97], nitro: [2.5, 5] },
  good: { react: [0.22, 0.38], shift: [0.87, 0.98], nitro: [1.5, 4] },
  pro: { react: [0.17, 0.28], shift: [0.89, 0.975], nitro: [1.2, 2.5] },
};
const OPPS = [
  { id: 'classmate', name: '隔壁同學', sub: '剛拿到駕照', key: 'gc8', hp: 280, tyre: 0, drv: 'rookie', prize: 5, look: { paint: '#f2f3f5', rim: 'chrome', wing: 'none', livery: 'none' } },
  { id: 'uncle', name: '巷口阿伯', sub: '開 Yaris 去買菜', key: 'yaris', hp: 300, tyre: 0, drv: 'ok', prize: 12, look: { paint: '#0e0f11', rim: 'black', wing: 'stock', livery: 'none' } },
  { id: 'courier', name: '送貨小哥', sub: '趕著送貨', key: 'gc8', hp: 400, tyre: 1, drv: 'good', prize: 25, look: { paint: '#c3c8ce', rim: 'gunmetal', livery: 'none' } },
  { id: 'nightmarket', name: '夜市小霸王', sub: '車子整台都是紫的', key: 'supra', hp: 650, tyre: 1, drv: 'good', prize: 60, look: { paint: '#5b2d9e', rim: 'chrome', wing: 'gt', kit: 'bomex', livery: 'flames' } },
  { id: 'shop', name: '修車廠老闆', sub: '自己改的 R34', key: 'gtr', hp: 750, tyre: 1, drv: 'good', prize: 150, look: { paint: '#141518', rim: 'gunmetal', wing: 'stock', kit: 'stock', livery: 'none' } },
  { id: 'club', name: '超跑俱樂部會長', sub: '車庫停滿超跑', key: 'p918', hp: 887, tyre: 1, drv: 'good', prize: 800, look: { paint: '#c5c9ce', livery: 'none' } },
  { id: 'touge', name: '山道之王', sub: '山路沒輸過', key: 'gtr', hp: 900, tyre: 2, drv: 'pro', prize: 1200, look: { paint: '#1d4fc9', wing: 'gt', kit: 'track', livery: 'ff' } },
  { id: 'racer', name: '職業賽車手', sub: '每個週末都在比賽', key: 'sp3', hp: 1100, tyre: 2, drv: 'pro', prize: 2000, look: { livery: 'daytona' } },
  { id: 'boss', name: '大魔王', sub: '最後一關', key: 'jesko', hp: 1920, tyre: 2, drv: 'good', prize: 3000, look: { paint: '#16171a', livery: 'red' } },
];
const unlocked = (i) => i === 0 || (GAME.wins[OPPS[i - 1].id] || 0) > 0;
const oppById = (id) => OPPS.find((o) => o.id === id);
// 對手的車長什麼樣子：那台車原本的樣子＋對手自己的（不合的選項不用）
function oppLook(o) {
  const look = { ...DEFAULT_LOOK[o.key] };
  for (const [k, v] of Object.entries(o.look || {})) if (k in look && okValue(o.key, k, v)) look[k] = v;
  return look;
}
const mean = (r) => (r[0] + r[1]) / 2;
const PLAYER_SIM = { react: 0.3, shift: 0.93, nitro: 2 }; // 試算你的秒數：普通玩家大概這樣開

// ---- 賽道場景（第一次上賽道才做）----
function canvasTex(w, h, draw, rep) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
  return t;
}
function buildTrack() {
  const T = new THREE.Scene();
  const sky = new THREE.Color(0xb4cde2);
  T.background = sky; T.fog = new THREE.Fog(sky, 80, 560);
  // 反射用的天空：上面藍、地平線亮、下面灰綠，加一顆太陽
  const E = new THREE.Scene();
  E.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, map: canvasTex(4, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#3f78bd'); gr.addColorStop(0.47, '#e4ecf2'); gr.addColorStop(0.53, '#72786a'); gr.addColorStop(1, '#3a3e36');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }) })));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 13, 11) }));
  sun.position.set(-18, 30, 24); E.add(sun);
  T.environment = pmrem.fromScene(E, 0.03).texture;
  T.add(new THREE.HemisphereLight(0xdfeeff, 0x4d5a3c, 0.6));
  const dl = new THREE.DirectionalLight(0xfff4e0, 1.4); dl.position.set(-18, 30, 24); T.add(dl);

  const L0 = -60, L1 = 760, LEN = L1 - L0, MID = (L0 + L1) / 2;
  const mat = (o) => new THREE.MeshStandardMaterial(o);
  const plane = (w, h, m, x, y, z) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); p.rotation.x = -Math.PI / 2; p.position.set(x, y, z); T.add(p); return p; };
  // 草地
  plane(1800, 900, mat({ color: 0x62704a, roughness: 1, map: canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#7d8c5d'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${40 + Math.random() * 40},${60 + Math.random() * 50},${25 + Math.random() * 25},0.35)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  }, [260, 130]) }), MID, -0.02, 0);
  // 柏油：兩條車道、中間白線、兩邊白線（貼圖 16 公尺 × 12 公尺一格）
  plane(LEN, 12, mat({ roughness: 0.92, map: canvasTex(512, 384, (g, w, h) => {
    g.fillStyle = '#3a3c40'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) { const k = 40 + Math.random() * 60; g.fillStyle = `rgba(${k},${k},${k + 4},0.5)`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
    g.fillStyle = '#e9ebee';
    for (const zz of [-5.6, 5.6]) g.fillRect(0, (zz + 6) * 32 - 2.5, w, 5);
    g.fillRect(0, 6 * 32 - 2, w, 4);
  }, [LEN / 16, 1]) }), MID, 0, 0);
  // 起跑那段輪胎印（黑色，越往前越淡）
  const rub = plane(90, 12, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, map: canvasTex(512, 128, (g, w, h) => {
    for (const zz of [LANE - 0.78, LANE + 0.78, -LANE - 0.78, -LANE + 0.78]) {
      const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(8,8,9,0.85)'); gr.addColorStop(0.35, 'rgba(8,8,9,0.45)'); gr.addColorStop(1, 'rgba(8,8,9,0)');
      g.fillStyle = gr; g.fillRect(0, ((zz + 6) / 12) * h - 5, w, 10);
    }
  }) }), 40, 0.003, 0);
  rub.renderOrder = 1;
  // 起跑線、終點線（黑白格）
  plane(0.3, 11.2, new THREE.MeshBasicMaterial({ color: 0xf2f3f5 }), 0, 0.004, 0);
  plane(1.6, 11.2, new THREE.MeshBasicMaterial({ map: canvasTex(64, 448, (g, w, h) => {
    const s = 32; for (let i = 0; i < w / s; i++) for (let j = 0; j < h / s; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#f2f3f5'; g.fillRect(i * s, j * s, s, s); }
  }) }), RACE_M, 0.004, 0);
  // 兩邊水泥護欄（上面紅白）
  const wallMat = mat({ roughness: 0.85, map: canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#c9ccd0'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#f2f3f5' : '#d0342c'; g.fillRect((i * w) / 4, 0, w / 4, h * 0.28); }
    for (let i = 0; i < 600; i++) { g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(Math.random() * w, h * 0.3 + Math.random() * h * 0.7, 2, 2); }
  }, [LEN / 8, 1]) });
  for (const s of [1, -1]) { const wl = new THREE.Mesh(new THREE.BoxGeometry(LEN, 0.9, 0.4), wallMat); wl.position.set(MID, 0.45, s * 6.3); T.add(wl); }
  // 距離牌：100、200、300 公尺
  for (const d of [100, 200, 300]) for (const s of [1, -1]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.9), new THREE.MeshBasicMaterial({ map: canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#16181c'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffb31a'; g.fillRect(0, 0, w, 10);
      g.fillStyle = '#f2f3f5'; g.font = '700 64px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(`${d} M`, w / 2, h / 2 + 6);
    }) }));
    sign.rotation.y = -Math.PI / 2; sign.position.set(d, 1.75, s * 6.6); T.add(sign);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.08), mat({ color: 0x2a2c30 })); post.position.set(d + 0.02, 0.7, s * 6.6); T.add(post);
  }
  // 看台（起跑那邊，左邊）：一階一階，上面是觀眾（彩色點）
  const crowd = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#5b5f66'; g.fillRect(0, 0, w, h);
    const cs = ['#d0342c', '#f2f3f5', '#2f6fd6', '#ffb31a', '#1d1f23', '#3ddc84', '#ff6a1f', '#8a5cd6'];
    for (let i = 0; i < 700; i++) { g.fillStyle = cs[(Math.random() * cs.length) | 0]; g.beginPath(); g.arc(Math.random() * w, 8 + Math.random() * (h - 16), 2.2, 0, Math.PI * 2); g.fill(); }
  }, [12, 1]);
  const standMat = mat({ roughness: 0.9, map: crowd }), concrete = mat({ color: 0xb9bcc1, roughness: 0.9 });
  for (let k = 0; k < 6; k++) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(130, 0.7, 1.3), [concrete, concrete, standMat, concrete, standMat, concrete]);
    st.position.set(30, 0.35 + k * 0.7, -(9.5 + k * 1.3)); T.add(st);
    const back = new THREE.Mesh(new THREE.BoxGeometry(130, 0.7 * (k + 1), 1.3), concrete); back.position.set(30, 0.35 * (k + 1) - 0.36, -(9.5 + k * 1.3)); T.add(back);
  }
  // 起跑燈樹（兩條車道中間）：三個黃燈、綠燈、紅燈
  const tree = new THREE.Group(); tree.position.set(3.2, 0, 0); T.add(tree);
  const dark = mat({ color: 0x1b1d21, roughness: 0.5 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.2, 12), dark); pole.position.y = 0.6; tree.add(pole);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.45, 0.62), dark); box.position.y = 1.85; tree.add(box);
  const bulbs = { amber: [], green: [], red: [] }, bulbGeo = new THREE.SphereGeometry(0.075, 16, 10);
  const bulb = (kind, y) => {
    for (const s of [1, -1]) {
      const m = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0x222222 })); m.position.set(-0.16, y, s * 0.16); tree.add(m);
      (bulbs[kind][s > 0 ? 0 : 1] ||= []).push(m);
    }
  };
  bulb('amber', 2.35); bulb('amber', 2.1); bulb('amber', 1.85); bulb('green', 1.55); bulb('red', 1.3);
  // 終點門：兩根柱子、上面黑白格橫幅
  const gantry = new THREE.Group(); gantry.position.x = RACE_M; T.add(gantry);
  for (const s of [1, -1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.45, 6.4, 0.45), dark); p.position.set(0, 3.2, s * 6.9); gantry.add(p); }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.3, 14.2), [dark, new THREE.MeshBasicMaterial({ map: canvasTex(1024, 96, (g, w, h) => {
    const s = 24; for (let i = 0; i < w / s; i++) for (let j = 0; j < h / s; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#f2f3f5'; g.fillRect(i * s, j * s, s, s); }
    g.fillStyle = '#16181c'; g.fillRect(w * 0.32, 8, w * 0.36, h - 16);
    g.fillStyle = '#ffb31a'; g.font = '700 58px "Noto Sans TC", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('終點 400 M', w / 2, h / 2 + 3);
  }) }), dark, dark, dark, dark]); // 有字的那面朝起點（-x）
  banner.position.set(0, 6.2, 0); gantry.add(banner);
  // 路燈（兩邊，每 60 公尺一支）
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.14, 9, 8); poleGeo.translate(0, 4.5, 0);
  const lampGeo = new THREE.BoxGeometry(1.4, 0.25, 0.5); lampGeo.translate(0, 9, 0);
  const n = Math.ceil(LEN / 60) * 2, poles = new THREE.InstancedMesh(poleGeo, mat({ color: 0x8d9197, roughness: 0.5, metalness: 0.5 }), n), lamps = new THREE.InstancedMesh(lampGeo, dark, n);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) { const x = L0 + 30 + 60 * (i >> 1), z = i % 2 ? 8 : -8; m4.makeTranslation(x, 0, z); poles.setMatrixAt(i, m4); lamps.setMatrixAt(i, m4); }
  T.add(poles, lamps);
  // 樹（遠一點，兩邊）＋遠山
  const NT = 170, cone = new THREE.ConeGeometry(1.6, 5, 7); cone.translate(0, 4.2, 0);
  const trunk = new THREE.CylinderGeometry(0.18, 0.25, 1.8, 6); trunk.translate(0, 0.9, 0);
  const trees = new THREE.InstancedMesh(cone, mat({ color: 0x3f5a32, roughness: 1 }), NT), trunks = new THREE.InstancedMesh(trunk, mat({ color: 0x5a4332, roughness: 1 }), NT);
  const q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
  for (let i = 0; i < NT; i++) {
    const s = i % 2 ? 1 : -1, x = L0 - 40 + Math.random() * (LEN + 120), z = s * (20 + Math.random() * 50), k = 0.7 + Math.random() * 0.8;
    m4.compose(pv.set(x, 0, z), q, sc.set(k, k * (0.8 + Math.random() * 0.5), k)); trees.setMatrixAt(i, m4); trunks.setMatrixAt(i, m4);
  }
  T.add(trees, trunks);
  const hillMat = mat({ color: 0x7c8a78, roughness: 1 });
  for (const [x, z, r] of [[80, -300, 120], [420, -330, 160], [760, -280, 130], [200, 320, 150], [600, 300, 170], [950, 60, 140]]) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12), hillMat); h.scale.y = 0.28; h.position.set(x, -r * 0.05, z); T.add(h);
  }
  // 車子底下的影子（兩台）
  const shadows = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.PlaneGeometry(4.9, 2.3), new THREE.MeshBasicMaterial({ map: sh.material.map, transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = 0.006; T.add(m); return m; });
  // 氮氣的藍色火焰（車尾中間下面）
  const fm = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const outerGeo = new THREE.ConeGeometry(0.15, 1.1, 16, 1, true), coreGeo = new THREE.ConeGeometry(0.07, 0.6, 12, 1, true), outerMat = fm(0x3f7dff, 0.75), coreMat = fm(0xe6efff, 0.9);
  const flames = [0, 1].map(() => {
    const f = new THREE.Group();
    const o = new THREE.Mesh(outerGeo, outerMat), k = new THREE.Mesh(coreGeo, coreMat);
    o.rotation.z = k.rotation.z = Math.PI / 2; o.position.x = -0.55; k.position.x = -0.3; // 尖端朝後
    f.add(o, k); f.visible = false; T.add(f); return f;
  });
  return { scene: T, bulbs, shadows, flames };
}

// ---- 比賽狀態 ----
let TR = null, race = null, rcam = null, raceOpp = null, oppFor = null, lastT = 0, orbitA = 0, oppCar = null;
const RACE = { on: false, frame: raceFrame };
function carSize(Sx) { const b = new THREE.Box3().setFromObject(Sx.body); return { nose: b.max.x, len: b.max.x - b.min.x, tail: b.min.x }; }
function putCar(Sx, c, z, info) {
  Sx.car.position.set(c.x - info.nose, 0, z);
}
function setWheels(Sx, c) {
  const W = Sx.spec.wheels;
  Sx.wheels.forEach((wh, i) => { const R = i < 2 ? W.RF ?? W.R : W.RR ?? W.R; wh.rotation.z = (i % 2 === 0 ? 1 : -1) * (c.spin / R); });
}
// 對手的車：另外組一台（跟你開同一款也沒關係），換對手或離開賽道就釋放
// 載入要一點時間：等的時候又換了對手，舊的那台做好就直接丟掉（'stale'）
let oppLoading = null;
function getOppCar(o) {
  if (oppCar && oppCar.id === o.id) return Promise.resolve(oppCar.S);
  if (oppLoading && oppLoading.id === o.id) return oppLoading.p;
  dropOppCar();
  status.hidden = false; msg.textContent = `${o.name}開著 ${CARS[o.key].btn[0]} 來了⋯`; prog.parentElement.hidden = false; prog.style.width = glbs[o.key] ? '100%' : '0%';
  const job = { id: o.id };
  job.p = loadCar(o.key, oppLook(o)).then((S2) => {
    if (oppLoading !== job) { disposeCar(S2); throw new Error('stale'); }
    oppLoading = null; oppCar = { id: o.id, S: S2 }; status.hidden = true;
    return S2;
  }, (e) => { if (oppLoading === job) oppLoading = null; throw e; });
  oppLoading = job;
  return job.p;
}
function dropOppCar() {
  oppLoading = null;
  if (!oppCar) return;
  disposeCar(oppCar.S); oppCar = null;
}
// 挑好的對手先開到旁邊車道等你（比完換對手就兩台都回起跑線）
async function showOpp() {
  if (!race) return;
  if (race.phase === 'done') lineUp();
  if (race.phase !== 'idle') return;
  const o = oppById(raceOpp), p = getOppCar(o);
  if (race.oppS && race.oppS !== oppCar?.S) race.oppS = null; // 換了對手：上一台已經釋放了
  let O;
  try { O = await p; } catch (e) {
    if (e.message !== 'stale') { status.hidden = false; msg.textContent = '對手沒載入成功，按「開始比賽」再試一次'; prog.parentElement.hidden = true; }
    return;
  }
  if (!RACE.on || !race || race.phase !== 'idle' || raceOpp !== o.id) return;
  race.oppS = O; race.oppInfo = carSize(O); race.park = { x: 0, spin: 0, nitro: 0, fin: null };
  TR.scene.add(O.car); O.car.visible = true; O.body.position.y = +oppLook(o).height;
  putCar(O, race.park, -LANE, race.oppInfo); setWheels(O, race.park);
}
// 回到起跑線等下一場
function lineUp() {
  Object.assign(race, { phase: 'idle', t: 0, me: racer(mySetup()), opp: null, green: null, snap: true });
  race.me.spin = 0; putCar(S, race.me, LANE, race.meInfo); setWheels(S, race.me);
  lights(0, false, false); hudIdle(); for (const f of TR.flames) f.visible = false;
  $('raceGo').textContent = '開始比賽'; resultEl.hidden = true; // 上一場的結果收起來（換了對手）
}
function toast(text, ms = 900) {
  toastEl.textContent = text; toastEl.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove('show'), ms);
}
function oppChoices() {
  oppsEl.replaceChildren();
  const sig = `${cur}|${hpOf(cur)}|${tyreOf(cur)}|${OPPS.filter((o, i) => unlocked(i)).length}`;
  if (oppFor !== sig || !raceOpp) { // 換車、裝了零件、多了對手就重選預設：你開得普通就贏得了的裡面，獎金最多的那個；都贏不了就選最慢的
    const mine = simET(mySetup(), PLAYER_SIM), open = OPPS.filter((o, i) => unlocked(i)), et = new Map(open.map((o) => [o, oppET(o)]));
    const can = open.filter((o) => et.get(o) >= mine + 0.05);
    raceOpp = (can.length ? can.reduce((a, b) => (b.prize > a.prize ? b : a)) : open.reduce((a, b) => (et.get(b) > et.get(a) ? b : a))).id;
    oppFor = sig;
  }
  OPPS.forEach((o, i) => {
    const open = unlocked(i), b = document.createElement('button');
    b.type = 'button'; b.disabled = !open; b.setAttribute('aria-pressed', String(o.id === raceOpp));
    if (GAME.wins[o.id]) b.classList.add('beaten');
    const t = document.createElement('b'), s2 = document.createElement('span'), s3 = document.createElement('small');
    if (open) { t.textContent = o.name; s2.textContent = `${CARS[o.key].btn[0]} · ${o.hp.toLocaleString('en-US')} 匹`; s3.textContent = `獎金 ${money(o.prize)}`; }
    else { t.textContent = '？？？'; s2.textContent = unlocked(i - 1) ? `先贏${OPPS[i - 1].name}` : '還沒出現'; }
    b.append(t, s2, s3);
    b.addEventListener('click', () => {
      if (race && ['intro', 'stage', 'run'].includes(race.phase)) return;
      raceOpp = o.id; oppsEl.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      showOpp();
    });
    oppsEl.append(b);
    if (o.id === raceOpp) requestAnimationFrame(() => { oppsEl.scrollLeft = b.offsetLeft - (oppsEl.clientWidth - b.offsetWidth) / 2; }); // 預設的對手捲到看得到
  });
  $('meStat').textContent = `你開 ${CARS[cur].btn[0]}（${statLine(cur)}${tyreOf(cur) ? ` · ${TYRES[tyreOf(cur)][1]}` : ''}）`;
}
async function enterRace() {
  if (!S || RACE.on || enterRace.busy) return;
  if (!TR) {
    enterRace.busy = true;
    await Promise.race([document.fonts.load('700 58px "Noto Sans TC"', '終點').catch(() => {}), new Promise((r) => setTimeout(r, 600))]);
    enterRace.busy = false;
    if (!S) return;
    TR = buildTrack();
  }
  if (!rcam) rcam = new THREE.PerspectiveCamera(55, 1, 0.1, 1200);
  RACE.on = true; controls.enabled = false;
  document.body.classList.add('racing');
  raceEl.hidden = false; hudEl.hidden = false; resultEl.hidden = true;
  $('raceGo').textContent = '開始比賽';
  oppChoices();
  race = { phase: 'idle', t: 0, me: racer(mySetup()), opp: null, meS: S, oppS: null, green: null, snap: true };
  race.meInfo = carSize(S);
  TR.scene.add(S.car); S.car.visible = true; S.body.position.y = +CARS[cur].state.height;
  putCar(S, race.me, LANE, race.meInfo);
  hudIdle();
  showOpp();
  lastT = performance.now();
  stage.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
}
function exitRace() {
  if (!RACE.on) return;
  RACE.on = false; controls.enabled = true;
  document.body.classList.remove('racing');
  raceEl.hidden = true; hudEl.hidden = true;
  for (const Sx of [race.meS]) {
    if (!Sx || !Object.values(built).includes(Sx)) continue;
    scene.add(Sx.car); Sx.car.position.set(0, 0, 0); Sx.car.visible = Sx === S; Sx.wheels.forEach((w) => (w.rotation.z = 0));
  }
  dropOppCar();
  for (const f of TR.flames) f.visible = false;
  race = null;
  renderOptions(); refreshCarBtns(); // 錢可能變多了：零件、車子買不買得起要重畫
}
async function startRace() {
  if (!race || ['intro', 'stage', 'run'].includes(race.phase)) return;
  const o = oppById(raceOpp);
  if (race.oppS && (!oppCar || race.oppS !== oppCar.S || oppCar.id !== o.id)) race.oppS = null; // 換了對手：舊的那台 getOppCar 會釋放
  $('raceGo').disabled = true;
  let O;
  try { O = await getOppCar(o); } catch (e) {
    $('raceGo').disabled = false;
    if (e.message !== 'stale') { status.hidden = false; msg.textContent = '對手沒載入成功，再按一次'; prog.parentElement.hidden = true; }
    return;
  }
  $('raceGo').disabled = false;
  if (!RACE.on || !race) { dropOppCar(); return; }
  race.me = racer(mySetup()); race.opp = racer(o); race.oppDef = o; race.oppS = O; race.oppInfo = carSize(O);
  race.phase = 'intro'; race.t = 0; race.green = null; race.greenAt = null; race.foul = false; race.doneT = null; race.paid = false;
  const d = DRIVERS[o.drv], U = (r) => r[0] + Math.random() * (r[1] - r[0]);
  race.ai = { d, react: U(d.react), shiftAt: U(d.shift), nitroAt: d.nitro ? U(d.nitro) : null };
  TR.scene.add(O.car); O.car.visible = true; O.body.position.y = +oppLook(o).height;
  putCar(S, race.me, LANE, race.meInfo); putCar(O, race.opp, -LANE, race.oppInfo);
  race.me.spin = 0; race.opp.spin = 0; setWheels(S, race.me); setWheels(O, race.opp);
  resultEl.hidden = true; nitroBtn.disabled = false; goBtn.textContent = '起步'; goBtn.disabled = false;
  for (const e of treeEls) e.className = e.dataset.k;
}
// 按鈕：起步／換檔、氮氣
function pressGo() {
  if (!race) return;
  const c = race.me;
  if (race.phase === 'stage' || race.phase === 'intro') { // 綠燈前按＝偷跑
    if (race.phase === 'intro') return;
    race.foul = true; finishRace(); toast('偷跑！', 1500); return;
  }
  if (race.phase !== 'run') return;
  if (c.go == null) { launch(c); toast(c.react < 0.2 ? '起步超快！' : '起步！', 700); goBtn.textContent = '換檔'; return; }
  const q = shift(c);
  if (q) toast(q === 'good' ? '完美換檔' : q === 'early' ? '太早換檔' : '太晚換檔', 650);
}
function pressNitro() {
  if (!race || race.phase !== 'run' || race.me.go == null || race.me.nitroUsed || race.me.fin != null) return;
  useNitro(race.me); nitroBtn.disabled = true; toast('氮氣！', 700);
}
function launch(c) { c.go = race.t; c.react = race.t - race.green; }
function shift(c) {
  if (c.gear >= 5 || c.shiftT > 0 || c.go == null || c.fin != null) return null;
  const x = c.rpm, q = c.cut > 0 || x > GREEN[1] ? 'late' : x < GREEN[0] ? 'early' : 'good';
  c.gear++; c.shiftT = q === 'good' ? 0.1 : 0.2;
  return q;
}
function useNitro(c) { c.nitroUsed = true; c.nitro = 3; }
function stepRacer(c, dt, R) {
  const gr = GEARS[c.gear] * c.fd, xw = ((c.v / c.r) * gr) / c.wr;
  if (c.go == null) { // 還沒起步：怠速；燈樹亮了就踩油門等
    const want = R.phase === 'stage' || R.phase === 'run' ? 0.6 + Math.sin(R.t * 29) * 0.025 : 0.14;
    c.rpm += (want - c.rpm) * Math.min(1, dt * 7); return;
  }
  let F = 0;
  if (c.shiftT > 0) c.shiftT -= dt;
  else if (c.cut > 0) c.cut -= dt;
  else if (xw >= 1) c.cut = 0.08; // 撞到紅線斷油
  else F = Math.min((c.Tpk * torqueAt(Math.max(xw, c.gear === 0 ? 0.6 : 0.2)) * (c.nitro > 0 ? 1.35 : 1) * gr * 0.88) / c.r, c.tract * (c.nitro > 0 ? 1.06 : 1));
  if (c.fin != null) F = 0;
  const drag = 0.5 * 1.2 * c.cda * c.v * c.v + 0.015 * c.m * 9.81 + (c.fin != null ? c.m * 8.5 : 0); // 過終點就煞車
  c.v = Math.max(0, c.v + ((F - drag) / c.m) * dt);
  c.x += c.v * dt; c.spin += c.v * dt;
  if (c.nitro > 0) c.nitro -= dt;
  const target = c.cut > 0 ? 0.99 + Math.random() * 0.02 : c.gear === 0 ? Math.max(0.6, xw) : Math.max(0.2, xw);
  c.rpm += (Math.min(1.03, target) - c.rpm) * Math.min(1, dt * (c.shiftT > 0 ? 14 : 30));
  if (c.fin == null && c.x >= RACE_M) { c.fin = R.ts - R.green - (c.x - RACE_M) / Math.max(c.v, 1); c.trap = c.v; }
}
// 試算一場（不隨機）：d＝{ react, shift, nitro }（秒、轉速、起步後幾秒放氮氣，null＝不放），回傳從綠燈到過終點幾秒
function simET(s, d) {
  const R = { phase: 'run', t: 0, ts: 0, green: 0 }, c = racer(s), h = 1 / 240;
  c.rpm = 0.6;
  while (c.fin == null && R.t < 40) {
    R.t += h; R.ts = R.t;
    if (c.go == null && R.t >= d.react) { c.go = R.t; c.react = d.react; }
    if (c.go != null) {
      if (c.rpm >= d.shift && c.shiftT <= 0 && c.gear < 5) shift(c);
      if (d.nitro != null && !c.nitroUsed && R.t - c.go > d.nitro) useNitro(c);
    }
    stepRacer(c, h, R);
  }
  return c.fin ?? 99;
}
const oppET = (o) => { const d = DRIVERS[o.drv]; return simET(o, { react: mean(d.react), shift: mean(d.shift), nitro: d.nitro && mean(d.nitro) }); };
function finishRace() {
  race.phase = 'done'; race.doneT = race.t;
  const me = race.me, op = race.opp;
  const win = !race.foul && me.fin != null && (op.fin == null || me.fin < op.fin);
  const gap = me.fin != null && op.fin != null ? Math.abs(me.fin - op.fin) : null;
  if (!race.foul) toast(win ? '你贏了！' : '輸了', 1800);
  const f = (v, d = 3) => (v == null ? '—' : v.toFixed(d));
  const head = race.foul ? '偷跑，這場算輸' : win ? (gap == null ? '你贏了！' : `你贏了！快 ${f(gap, 2)} 秒`)
    : gap == null ? '輸了' : gap < 0.3 ? `差一點，慢 ${f(gap, 2)} 秒` : `輸了，慢 ${f(gap, 2)} 秒`;
  const et = (c) => (c.fin == null || c.react == null ? null : c.fin - c.react);
  resultEl.replaceChildren();
  const h = document.createElement('p'); h.className = 'res-head' + (win ? ' win' : ''); h.textContent = head; resultEl.append(h);
  $('raceGo').textContent = '再比一次'; goBtn.disabled = true; nitroBtn.disabled = true;
  // 獎金：贏了才有；第一次贏過這個對手，下一個就出現
  const o = race.oppDef, i = OPPS.indexOf(o), note = document.createElement('p');
  if (win && !race.paid) {
    race.paid = true;
    const first = !GAME.wins[o.id];
    GAME.wins[o.id] = (GAME.wins[o.id] || 0) + 1; GAME.money += o.prize; save(true); renderWallet();
    note.className = 'res-prize';
    const a = document.createElement('b'); a.textContent = `獎金 +${money(o.prize)}`;
    note.append(a, `　你現在有 NT$ ${money(GAME.money)}`);
    resultEl.append(note);
    if (first) {
      const nx = document.createElement('p'); nx.className = 'res-note';
      nx.textContent = OPPS[i + 1] ? `新對手出現了：${OPPS[i + 1].name}（開 ${CARS[OPPS[i + 1].key].btn[0]}，獎金 ${money(OPPS[i + 1].prize)}）` : '你打敗大魔王了！所有對手都贏過了。';
      resultEl.append(nx);
    }
    oppChoices();
  } else if (!win) {
    note.className = 'res-note';
    note.textContent = race.foul ? '綠燈還沒亮就按了起步。等三個黃燈亮完、綠燈一亮再按。' : '沒拿到獎金。回車庫裝零件、換輪胎，或先挑一個慢一點的對手賺錢。';
    resultEl.append(note);
  }
  if (race.foul) { resultEl.hidden = false; lights(0, false, true); showResult(); return; }
  const tb = document.createElement('table');
  const rows = [['', `你 · ${CARS[me.key].btn[0]}`, `${o.name} · ${CARS[op.key].btn[0]}`],
    ['反應時間', `${f(me.react)} 秒`, `${f(op.react)} 秒`], ['400 公尺', `${f(et(me), 2)} 秒`, `${f(et(op), 2)} 秒`],
    ['過終點（含反應）', `${f(me.fin, 2)} 秒`, `${f(op.fin, 2)} 秒`], ['尾速', `${me.fin == null ? '—' : Math.round(me.trap * 3.6)} km/h`, `${op.fin == null ? '—' : Math.round(op.trap * 3.6)} km/h`]];
  rows.forEach((r, i) => { const tr = document.createElement('tr'); r.forEach((v, j) => { const td = document.createElement(i === 0 || j === 0 ? 'th' : 'td'); td.textContent = v; tr.append(td); }); tb.append(tr); });
  resultEl.append(tb); resultEl.hidden = false;
  showResult();
}
// 結果在賽道下面：手機上捲一下讓它看得到（賽道還留在畫面上方）
function showResult() { setTimeout(() => { if (!resultEl.hidden) resultEl.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' }); }, 1300); }

// ---- 每一幀 ----
function hudIdle() { clockEl.textContent = '0.000'; spdEl.textContent = '0'; for (const e of treeEls) e.className = e.dataset.k; drawTach(0.14, 'N'); pMe.style.left = '0%'; pOpp.style.left = '0%'; goBtn.disabled = true; nitroBtn.disabled = true; goBtn.textContent = '起步'; }
function lights(n, green, red) { // 燈樹：HUD＋賽道上那棵
  treeEls.forEach((e, i) => { e.className = e.dataset.k + ((i < 3 && i < n) || (i === 3 && green) || (i === 4 && red) ? ' on' : ''); });
  const B = TR.bulbs, set = (m, on, col) => m.material.color.set(on ? col : 0x222222);
  for (const lane of [0, 1]) {
    B.amber[lane].forEach((m, i) => set(m, i < n && !green, new THREE.Color(3, 1.9, 0.2)));
    B.green[lane].forEach((m) => set(m, green, new THREE.Color(0.3, 3, 0.9)));
    B.red[lane].forEach((m) => set(m, red && lane === 0, new THREE.Color(3, 0.25, 0.2)));
  }
}
function drawTach(x, gear) {
  const d = Math.min(2, devicePixelRatio || 1), W = tachEl.clientWidth || 120, H = tachEl.clientHeight || 72;
  if (tachEl.width !== Math.round(W * d)) { tachEl.width = Math.round(W * d); tachEl.height = Math.round(H * d); }
  const g = tachEl.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H - 8, R = Math.min(W / 2 - 6, H - 14), A0 = Math.PI, A1 = Math.PI * 2, MAX = 1.05;
  const ang = (v) => A0 + ((A1 - A0) * Math.min(MAX, Math.max(0, v))) / MAX;
  const arc = (a, b, col, w) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(cx, cy, R, ang(a), ang(b)); g.stroke(); };
  arc(0, MAX, 'rgba(255,255,255,0.16)', 7); arc(GREEN[0], GREEN[1], '#3ddc84', 7); arc(GREEN[1], MAX, '#ff3b30', 7);
  g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.5;
  for (let i = 0; i <= 10; i++) { const a = ang(i / 10); g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 9), cy + Math.sin(a) * (R - 9)); g.lineTo(cx + Math.cos(a) * (R - 14), cy + Math.sin(a) * (R - 14)); g.stroke(); }
  const a = ang(x);
  // 指針用主色
  g.strokeStyle = drawTach.ac ||= getComputedStyle(hudEl).getPropertyValue('--accent').trim() || '#FF6A1F'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (R - 4), cy + Math.sin(a) * (R - 4)); g.stroke();
  g.fillStyle = '#F2F3F5'; g.font = '700 24px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(String(gear), cx, cy - 6);
}
function raceFrame(now) {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (rcam.userData.w !== w || rcam.userData.h !== h) { rcam.aspect = w / h; rcam.updateProjectionMatrix(); rcam.userData.w = w; rcam.userData.h = h; }
  const dt = Math.min(0.05, (now - lastT) / 1000 || 0); lastT = now;
  const R = race, me = R.me, op = R.opp;
  R.t += dt;
  // 燈樹：進場 1.6 秒 → 隨機等一下 → 三個黃燈每 0.5 秒亮一個 → 綠燈
  if (R.phase === 'intro' && R.t > 1.6) { R.phase = 'stage'; R.stageT = R.t; R.greenAt = R.t + 1.0 + Math.random() * 0.9 + 1.5; toast('準備', 800); }
  if (R.phase === 'stage') {
    const n = Math.max(0, Math.min(3, Math.floor((R.t - (R.greenAt - 1.5)) / 0.5) + 1));
    lights(R.t >= R.greenAt - 1.5 ? n : 0, false, false);
    goBtn.disabled = false;
    if (R.t >= R.greenAt) { R.phase = 'run'; R.green = R.t; lights(3, true, false); }
  }
  if (R.phase === 'run' || R.phase === 'done' || R.phase === 'stage' || R.phase === 'intro') {
    if (op && (R.phase === 'run' || (R.phase === 'done' && !R.foul))) { // 對手：反應時間、換檔點、氮氣時機有點隨機
      const ai = R.ai;
      if (op.go == null && R.t - R.green >= ai.react) launch(op);
      if (op.go != null && op.fin == null) {
        if (op.shiftT <= 0 && op.gear < 5 && op.rpm >= ai.shiftAt) { shift(op); ai.shiftAt = ai.d.shift[0] + Math.random() * (ai.d.shift[1] - ai.d.shift[0]); }
        if (ai.nitroAt != null && !op.nitroUsed && R.t - op.go > ai.nitroAt) useNitro(op);
      }
    }
    const steps = Math.max(1, Math.ceil(dt / (1 / 240))), hs = dt / steps;
    for (let i = 0; i < steps; i++) { R.ts = R.t - dt + (i + 1) * hs; stepRacer(me, hs, R); if (op) stepRacer(op, hs, R); }
    if (R.phase === 'run' && me.fin != null && (op.fin != null || R.t - R.green - me.fin > 4)) finishRace();
    if (R.phase === 'run' && me.go == null && op.fin != null && R.t - R.green > op.fin + 2) finishRace();
  }
  // 車子位置、輪子、影子、氮氣火焰
  const pairs = [[R.meS, me, LANE, R.meInfo], [R.oppS, op || R.park, -LANE, R.oppInfo]];
  pairs.forEach(([Sx, c, z, info], k) => {
    if (!Sx || !c) { TR.shadows[k].visible = false; TR.flames[k].visible = false; return; }
    putCar(Sx, c, z, info); setWheels(Sx, c);
    const shd = TR.shadows[k]; shd.visible = true; shd.position.set(c.x - info.nose + (info.nose + info.tail) / 2, 0.006, z); shd.scale.set(info.len / 4.6, 1, 1);
    const fl = TR.flames[k]; fl.visible = c.nitro > 0 && c.fin == null;
    if (fl.visible) { const j = 0.75 + Math.random() * 0.5; fl.position.set(c.x - info.nose + info.tail + 0.04, 0.34, z); fl.scale.set(j, 0.85 + j * 0.2, 0.85 + j * 0.2); }
  });
  // 鏡頭：位置用「相對你的車」的偏移，車子再快也不會落後；等待和比完時在車子外側來回擺（不會被燈樹擋住）
  const base = new THREE.Vector3(me.x - R.meInfo.nose, 0, LANE);
  const orbit = (r, y) => { const a = Math.PI / 2 + 1.15 * Math.sin(orbitA); return [new THREE.Vector3(1.2 + Math.cos(a) * r, y, Math.sin(a) * r), new THREE.Vector3(1.2, 0.5, 0)]; };
  let off, aim, fov = 55;
  if (R.phase === 'idle') { orbitA += dt * 0.3; [off, aim] = orbit(7.5, 2.6); } // 高一點，從護欄上面看得到整台車
  else if (R.phase === 'done' && R.t - R.doneT > 1.2) { orbitA += dt * 0.22; [off, aim] = orbit(8, 2.8); }
  else {
    const v = me.v, back = 6.4 + Math.max(0, 1.4 - rcam.aspect) * 4; // 畫面窄（手機）就退後一點，兩台車都看得到
    off = new THREE.Vector3(-back - v * 0.03, 1.75 + v * 0.004, -1.1); aim = new THREE.Vector3(8, 0.75, LANE * 0.3 - LANE);
    fov = 55 + Math.min(12, v * 0.12) + (me.nitro > 0 ? 5 : 0);
    if (R.phase === 'intro') { // 從起跑線前面旁邊看兩台車，再滑到車後面
      const k = Math.min(1, R.t / 1.6), e = k * k * (3 - 2 * k);
      off = new THREE.Vector3(9, 1.5, 5.1).lerp(off, e); aim = new THREE.Vector3(1.2, 0.6, -LANE).lerp(aim, e);
    }
  }
  const follow = R.phase === 'run' || R.snap ? 1 : Math.min(1, dt * 3);
  if (R.snap || !R.off) { R.off = off.clone(); R.aim = aim.clone(); rcam.fov = fov; R.snap = false; }
  R.off.lerp(off, follow); R.aim.lerp(aim, follow);
  rcam.position.copy(base).add(R.off);
  if (R.phase === 'run' && !calm) rcam.position.y += Math.sin(R.t * 40) * Math.min(0.012, me.v * 0.0002); // 高速有點抖
  rcam.fov += (fov - rcam.fov) * Math.min(1, dt * 4); rcam.updateProjectionMatrix();
  rcam.lookAt(base.add(R.aim));
  // HUD
  const tt = R.green == null ? 0 : me.fin != null ? me.fin : Math.max(0, (R.phase === 'done' ? R.doneT : R.t) - R.green);
  clockEl.textContent = tt.toFixed(3);
  spdEl.textContent = String(Math.round(me.v * 3.6));
  pMe.style.left = `${Math.min(100, (me.x / RACE_M) * 100)}%`; if (op) pOpp.style.left = `${Math.min(100, (op.x / RACE_M) * 100)}%`;
  drawTach(me.rpm, me.go == null ? 'N' : me.gear + 1);
  renderer.render(TR.scene, rcam);
}
goBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); pressGo(); });
nitroBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); pressNitro(); });
document.addEventListener('keydown', (e) => {
  if (!RACE.on) return;
  if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); pressGo(); }
  if (e.code === 'KeyN') pressNitro();
});
$('toRace').addEventListener('click', enterRace);
$('raceBack').addEventListener('click', exitRace);
$('raceGo').addEventListener('click', startRace);


renderer.setAnimationLoop((now) => {
  if (RACE.on) { RACE.frame(now); return; }
  if (S && Math.abs(S.body.position.y - rideY) > 1e-4) S.body.position.y += (rideY - S.body.position.y) * 0.12;
  controls.update(); renderer.render(scene, camera);
});

// ---- App 的改車頁才有的 ----
// 標題旁的版本號：0.外殼.內容，跟汽車、麥塊那兩頁一樣
(function paintVersion() {
  const el = document.getElementById('brandVer'), web = new URL(import.meta.url).searchParams.get('v');
  if (!el || !web) return;
  const app = /CaridApp\/(\d+)/.exec(navigator.userAgent || '');
  el.textContent = '0.' + (app ? app[1] : 0) + '.' + web;
})();
// 記住汽車裡最後看的是改車：從麥塊按「汽車」回來會回到這頁
try { sessionStorage.setItem('carid.tab', 'tune'); } catch { /* 不給用就算了 */ }
// 已經在改車頁再點底部的「汽車」：捲回最上面
document.getElementById('carTab').addEventListener('click', (e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
