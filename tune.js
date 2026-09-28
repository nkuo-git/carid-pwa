// 大便龍的萬能軟體 — 改車（3D 車庫＋開車出門的小村莊＋400 公尺直線加速）
// 這個檔是產生出來的，不要直接改：原始碼和指令在專案檔案 tune-game/supra3d/（build-app.mjs）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
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
  polish: () => new THREE.MeshPhysicalMaterial({ color: 0xdadde2, roughness: 0.1, metalness: 1 }), // 拋光輪唇（不跟輪框顏色）
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
  const tire = new THREE.Mesh(new THREE.LatheGeometry(tp, 96), mats.rubber); tire.name = 'tire';
  tire.geometry.rotateX(Math.PI / 2);
  g.add(tire);
  // 輪框筒＋外緣亮邊
  const bp = [
    [rim - 0.012, -w / 2 + 0.01], [rim + 0.006, -w / 2 + 0.006], [rim + 0.006, -w / 2 + 0.02], [rim - 0.01, -w / 2 + 0.03],
    [rim - 0.01, w / 2 - 0.035], [rim + 0.004, w / 2 - 0.022], [rim + 0.012, w / 2 - 0.012], [rim + 0.012, w / 2 - 0.004], [rim + 0.002, w / 2 + 0.002], [rim - 0.012, w / 2 - 0.004],
    [rim - 0.018, w / 2 - 0.02],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const barrel = new THREE.Mesh(new THREE.LatheGeometry(bp, 96), mats.chrome); barrel.name = 'barrel'; // 換輪框時有拋光輪唇的樣式會換成 mats.polish
  barrel.geometry.rotateX(Math.PI / 2);
  g.add(barrel);
  // 輪框內側暗一點（看得到的筒內）
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(rim - 0.018, rim - 0.018, w * 0.8, 64, 1, true), mats.disc);
  inner.geometry.rotateX(Math.PI / 2); inner.material = mats.barrelIn; inner.position.z = -0.01;
  g.add(inner);
  g.add(rimFace(style, rim, w, mats)); // 輪框面（輻條＋中心蓋＋螺帽），換輪框時整組換掉
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

// ---- 輪框面：輻條＋中心蓋＋螺帽（放在輪子 group 裡一起轉；setRim 換樣式時只換這一組）----
// style：車自己的函式 style(rim, w, mats)、'five'（預設）、'multi'，或 RIM_FACES 裡的 'mesh'、'six'、'fan'、'dish'；hand：右輪 1、左輪 -1（有方向的樣式左右相反）
function rimFace(style, rim, w, mats, hand = 1) {
  const g = new THREE.Group(); g.name = 'rimface';
  if (RIM_FACES[style]) { g.add(RIM_FACES[style](rim, w, mats, hand)); return g; } // 新樣式自己有中心蓋和螺帽
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
  return g;
}

// ---- 換裝的輪框樣式（任何車都能用，照這個輪子的輪框半徑 rim、寬度 w 縮放）----
// 後面的碟盤、卡鉗不轉：卡鉗 r 0.106–0.21、z 到 w/2−0.073，碟盤帽 r＜0.085、z 到 w/2−0.06
// → 輻條背面最深 w/2−0.058；最外面不超過胎壁（w/2）。零件先做成幾何，同材質的合成一個網格（draw call 少）
function rimMerge(list) { // 幾何合成一個（只留 position、normal）
  const P = [], N = []; let n = 0;
  for (let g of list) { if (g.index) g = g.toNonIndexed(); P.push(g.attributes.position.array); N.push(g.attributes.normal.array); n += g.attributes.position.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
  for (let i = 0; i < P.length; i++) { pos.set(P[i], o); nor.set(N[i], o); o += P[i].length; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return geo;
}
function rimMeshes(parts) { const g = new THREE.Group(); for (const [list, m] of parts) if (list.length) g.add(new THREE.Mesh(rimMerge(list), m)); return g; }
// 一段一段的剖面接成實心條（輻條、葉片）：secs＝幾個點數一樣的剖面，頭尾封起來；每一面順著長度平滑、稜角是利的
function rimLoft(secs) {
  const ctr = (s) => s.reduce((a, p) => a.map((v, i) => v + p[i] / s.length), [0, 0, 0]);
  const s0 = secs[0], nn = [0, 0, 0], c0 = ctr(secs[0]), c1 = ctr(secs[1]);
  s0.forEach((p, i) => { const q = s0[(i + 1) % s0.length]; nn[0] += (p[1] - q[1]) * (p[2] + q[2]); nn[1] += (p[2] - q[2]) * (p[0] + q[0]); nn[2] += (p[0] - q[0]) * (p[1] + q[1]); });
  if (nn[0] * (c1[0] - c0[0]) + nn[1] * (c1[1] - c0[1]) + nn[2] * (c1[2] - c0[2]) < 0) secs = secs.map((s) => s.slice().reverse()); // 剖面要繞著前進方向逆時針，法線才朝外
  const m = s0.length, out = [], F = secs[0], L = secs[secs.length - 1], cap = [];
  for (let k = 0; k < m; k++) { // 每一面一條：順著長度共用頂點（平滑），跟旁邊的面不共用（稜角利）
    const k1 = (k + 1) % m, pos = [], idx = [];
    secs.forEach((S, i) => { pos.push(...S[k], ...S[k1]); if (i) { const a = 2 * (i - 1); idx.push(a, a + 1, a + 3, a, a + 3, a + 2); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); out.push(g);
  }
  for (let k = 1; k < m - 1; k++) cap.push(...F[0], ...F[k + 1], ...F[k], ...L[0], ...L[k], ...L[k + 1]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(cap, 3)); g.computeVertexNormals(); out.push(g);
  return rimMerge(out);
}
// 直的輻條：A→B（[x, y, 背面 z]），寬 wa→wb、厚 ta→tb，上面比下面窄（兩邊斜的倒角）
function rimBar(A, B, wa, wb, ta, tb, top = 0.62) {
  const dx = B[0] - A[0], dy = B[1] - A[1], l = Math.hypot(dx, dy), px = -dy / l, py = dx / l;
  const sec = (P, w, t) => [[P[0] - (px * w) / 2, P[1] - (py * w) / 2, P[2]], [P[0] + (px * w) / 2, P[1] + (py * w) / 2, P[2]],
    [P[0] + (px * w * top) / 2, P[1] + (py * w * top) / 2, P[2] + t], [P[0] - (px * w * top) / 2, P[1] - (py * w * top) / 2, P[2] + t]];
  return rimLoft([sec(A, wa, ta), sec(B, wb, tb)]);
}
const rimLathe = (pts, n = 96) => new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), n).rotateX(Math.PI / 2); // 剖面 [r, z]，往裡走的面朝外
const rimCyl = (rF, rB, h, n, z, x = 0, y = 0) => new THREE.CylinderGeometry(rF, rB, h, n).rotateX(Math.PI / 2).translate(x, y, z); // 軸沿 z，rF＝前面的半徑
function rimNuts(list, n, r, z, a0 = Math.PI / 5, s = 0.009, h = 0.014) { for (let j = 0; j < n; j++) { const a = a0 + (j * 2 * Math.PI) / n; list.push(rimCyl(s, s, h, 6, z, Math.cos(a) * r, Math.sin(a) * r)); } }

// 'six'：六根直輻（TE37 那種）：粗、直、往中間凹，平的輪轂上五顆螺帽＋小中心蓋
function rimSix(rim, w, mats) {
  const zf = w / 2, k = rim / 0.254, ro = rim - 0.011, rh = 0.07, C = [];
  for (let j = 0; j < 6; j++) {
    const a = (j * Math.PI) / 3 + Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
    C.push(rimBar([c * rh, s * rh, zf - 0.058], [c * ro, s * ro, zf - 0.034], 0.06 * k, 0.042 * k, 0.026, 0.02, 0.8));
  }
  C.push(rimCyl(0.086, 0.09, 0.024, 48, zf - 0.046)); // 輪轂（前面跟輻條根部一樣高）
  C.push(rimCyl(0.026, 0.03, 0.012, 32, zf - 0.028)); // 中心蓋
  rimNuts(C, 5, 0.058, zf - 0.03, Math.PI / 2 + Math.PI / 5, 0.009, 0.012);
  return rimMeshes([[C, mats.chrome]]);
}
// 'mesh'：BBS RS 那種交叉網狀輻條＋外圈一圈小螺絲，外面是有階梯的拋光輪唇
function rimMesh(rim, w, mats) {
  const zf = w / 2, k = rim / 0.254, C = [], Pl = [];
  Pl.push(rimLathe([[rim - 0.018, zf - 0.02], [rim - 0.026, zf - 0.0215], [rim - 0.0275, zf - 0.029], [rim - 0.036, zf - 0.0305], [rim - 0.037, zf - 0.04]])); // 階梯輪唇（接在輪框筒內緣後面）
  const r1 = rim - 0.0375, r0 = rim - 0.053, rm = (r0 + r1) / 2;
  C.push(rimLathe([[r1, zf - 0.05], [r1, zf - 0.036], [r0, zf - 0.036], [r0, zf - 0.05]])); // 網子外圈
  for (let j = 0; j < 20; j++) { const a = (j * Math.PI * 2) / 20; Pl.push(rimCyl(0.0042, 0.0048, 0.008, 6, zf - 0.034, Math.cos(a) * rm, Math.sin(a) * rm)); } // 一圈螺絲
  // 交叉輻條：每根從輪轂往外轉 1.5 格，兩個方向交叉成兩圈菱形；其中一個方向高 2 公釐（交叉的地方才不會閃）
  const N = 12, rh = 0.08, re = r0 + 0.004, dA = (Math.PI * 2) / N;
  for (let j = 0; j < N; j++) for (const s of [1, -1]) {
    const a = j * dA + Math.PI / 2, b = a + s * dA * 1.5, up = s > 0 ? 0.002 : 0;
    C.push(rimBar([Math.cos(a) * rh, Math.sin(a) * rh, zf - 0.058 + up], [Math.cos(b) * re, Math.sin(b) * re, zf - 0.048 + up], 0.018 * k, 0.015 * k, 0.012, 0.011, 0.72));
  }
  C.push(rimCyl(0.086, 0.09, 0.012, 48, zf - 0.052)); // 輪轂
  C.push(rimCyl(0.05, 0.052, 0.01, 40, zf - 0.041), rimCyl(0.036, 0.04, 0.004, 40, zf - 0.034)); // 中心蓋（兩層）
  rimNuts(C, 5, 0.068, zf - 0.04, Math.PI / 2 + Math.PI / 5, 0.009, 0.012);
  return rimMeshes([[C, mats.chrome], [Pl, mats.polish]]);
}
// 'fan'：渦輪扇（turbofan）：平的圓盤上很多片彎的葉片（葉片之間是暗的），中間一顆大的中央螺帽；hand：左右輪葉片方向相反
function rimFan(rim, w, mats, hand = 1) {
  const zf = w / 2, ro = rim - 0.012, C = [], B = [];
  const N = 18, r1 = 0.092, r2 = ro - 0.018, zt = zf - 0.024, hw = (Math.PI / N) * 0.6;
  B.push(rimCyl(r2 + 0.006, r2 + 0.006, 0.004, 96, zf - 0.046)); // 葉片後面的暗色平盤
  C.push(rimLathe([[ro + 0.004, zf - 0.046], [ro + 0.004, zt], [r2, zt], [r2, zf - 0.046]])); // 外圈
  C.push(rimLathe([[r1 + 0.004, zf - 0.046], [r1 + 0.004, zt + 0.002], [0, zt + 0.002]], 64)); // 中間的平盤
  for (let j = 0; j < N; j++) { // 葉片：往外越彎越多，前緣高、後緣低（像風扇）
    const secs = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14, r = r1 + (r2 - r1) * t, th = (j * 2 * Math.PI) / N + hand * 0.95 * Math.pow(t, 1.3), a0 = th - hand * hw, a1 = th + hand * hw;
      const P = (a, z) => [Math.cos(a) * r, Math.sin(a) * r, z];
      secs.push([P(a0, zt - 0.008), P(a1, zt - 0.017), P(a1, zt - 0.009), P(a0, zt)]);
    }
    C.push(rimLoft(secs));
  }
  C.push(rimCyl(0.036, 0.036, 0.016, 6, zf - 0.014), rimCyl(0.018, 0.022, 0.004, 24, zf - 0.004)); // 中央螺帽＋小蓋
  return rimMeshes([[C, mats.chrome], [B, mats.black]]);
}
// 'dish'：深盤：很寬的拋光輪唇斜斜往裡凹下去，細輻條放在很深的盤底；盤底一圈鉚釘（三片式）
function rimDish(rim, w, mats) {
  const zf = w / 2, k = rim / 0.254, D = Math.min(0.054, Math.max(0.04, 0.17 * w)), rb = rim - 0.018 - 0.034 * k, C = [], Pl = [];
  Pl.push(rimLathe([[rim - 0.018, zf - 0.02], [rim - 0.022, zf - 0.0215], [rb, zf - D + 0.002], [rb - 0.003, zf - D], [rb - 0.015, zf - D]])); // 輪唇＋盤底一小圈平的
  for (let j = 0; j < 24; j++) { const a = (j * Math.PI * 2) / 24; Pl.push(new THREE.SphereGeometry(0.0042, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(Math.cos(a) * (rb - 0.009), Math.sin(a) * (rb - 0.009), zf - D)); } // 鉚釘
  const rh = 0.066, re = rb - 0.01;
  for (let j = 0; j < 8; j++) { // 八根細輻條
    const a = (j * Math.PI) / 4 + Math.PI / 8, c = Math.cos(a), s = Math.sin(a);
    C.push(rimBar([c * rh, s * rh, zf - 0.058], [c * re, s * re, zf - D - 0.004], 0.02 * k, 0.013 * k, 0.012, 0.01));
  }
  C.push(rimCyl(0.072, 0.076, 0.012, 40, zf - 0.052), rimCyl(0.03, 0.032, 0.012, 32, zf - 0.04)); // 輪轂＋中心蓋
  rimNuts(C, 5, 0.052, zf - 0.041, Math.PI / 2 + Math.PI / 5, 0.0085, 0.012);
  return rimMeshes([[C, mats.chrome], [Pl, mats.polish]]);
}
const RIM_FACES = { mesh: rimMesh, six: rimSix, fan: rimFan, dish: rimDish };
const RIM_POLISH = { mesh: true, dish: true }; // 這些樣式的輪框筒（外緣）換成拋光的輪唇

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

// ---- 底盤霓虹燈（setGlow）：地上一片柔柔的光，加色、不寫深度，比車身大一圈、邊緣慢慢淡掉 ----
// x0、x1：車身前後，hz：車身半寬。光的形狀在 shader 裡算（到車身外框＝圓角長方形的距離），不用貼圖
// 混色：光是直接加上去的（src×1），alpha 只把底下的地板壓暗一點（dst×(1−k·f)）：暗的地方（暗攝影棚、柏油）跟純加色一樣是霓虹，
// 亮的地板才看得出顏色（純加色會變成白白的）；k＝0 就是純加色。顏色用畫面上的 sRGB 直接輸出（不經過色調對應，才會飽和）
// 要畫在車底影子（y 0.002–0.006、renderOrder 0）上面：y 0.012＋renderOrder 3＋polygonOffset；f 加一點點抖動，暗的地方才不會一圈一圈（shader 裡只放英文）
// 有霧（車庫 Fog 11–26、賽道 80–560）就跟著淡掉：加色的光不能混霧的顏色，直接乘 (1−霧)
function neonPad(x0, x1, hz, k = 0.7) {
  const m = 0.75, PX = x1 - x0 + 2 * m, PZ = 2 * hz + 2 * m;
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uColor: { value: new THREE.Color(1, 1, 1) }, uK: { value: k }, uBox: { value: new THREE.Vector4((x1 - x0) / 2 - 0.1, hz - 0.08, 0.45, m) } },
    vertexShader: `#include <fog_pars_vertex>
varying vec2 vP;
void main() { vP = position.xy; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`,
    fragmentShader: `#include <fog_pars_fragment>
uniform vec3 uColor; uniform float uK; uniform vec4 uBox; varying vec2 vP;
void main() {
  vec2 q = abs(vP) - uBox.xy + uBox.z;
  float d = max(0.0, length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uBox.z);
  float f = (0.45 * exp(-d / 0.12) + 0.55 * exp(-d * d / 0.1444)) * (1.0 - smoothstep(0.4, uBox.w + 0.08, d));
  f += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.55) - 0.5) / 255.0;
  f = clamp(f, 0.0, 1.0);
#ifdef USE_FOG
#ifdef FOG_EXP2
  f *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
#else
  f *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
#endif
#endif
  gl_FragColor = vec4(uColor * f, uK * f);
}`,
    fog: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(PX, PZ), mat);
  pad.rotation.x = -Math.PI / 2; pad.position.set((x0 + x1) / 2, 0.012, 0); pad.renderOrder = 3; pad.name = 'glow';
  pad.setColor = (c) => mat.uniforms.uColor.value.setStyle(c, THREE.LinearSRGBColorSpace); // 照字面的 sRGB 值（不轉線性）
  return pad;
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
    gt: (paint, mats) => gtWing({ mats, x: -1.90, y: 1.25, deck: 0.962, span: 1.62, chord: 0.30 }), // 支架插進行李箱一點（原本浮 1.7 公分）
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
  const finU = { uFlake: { value: 0 } };
  { // 漆面的 shader 補丁（包在 patchPaint 外面）：珍珠（iridescence）、金屬漆的亮片只上在車漆（黑飾條、燈、網子、消光的地方不要）
    const pb = paint.onBeforeCompile; // masks.js 會改，所以只用 shader 裡找得到的遮罩變數
    paint.onBeforeCompile = (sh, r) => {
      pb(sh, r);
      const fs = sh.fragmentShader, ms = ['blackG', 'matte', 'lamp', 'lens', 'wire', 'amber', 'red', 'rev'].filter((n) => new RegExp(`\\b${n}\\s*=`).test(fs));
      const w = `(1.0 - ${ms.reduce((a, n) => `max(${a}, ${n})`, '0.0')})`;
      Object.assign(sh.uniforms, finU);
      sh.fragmentShader = 'uniform float uFlake;\n' + fs.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
#ifdef USE_IRIDESCENCE
  material.iridescence *= ${w};
#endif`);
      // 亮片：3 mm 一格，每格法線亂偏一點；格子比一個像素小（遠看）就淡掉，不然是雜訊、自動轉的時候一直閃（白色、銀色在暗攝影棚最明顯）
      if (/varying vec3 vP;/.test(fs)) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  if (uFlake > 0.0) { vec3 fp = vP * 320.0, fc = floor(fp);
    normal = normalize(normal + uFlake * ${w} * smoothstep(2.0, 0.7, length(fwidth(fp))) * (fract(sin(vec3(dot(fc, vec3(12.99, 78.23, 37.72)), dot(fc, vec3(39.35, 11.14, 83.16)), dot(fc, vec3(73.16, 52.48, 19.73)))) * 43758.55) - 0.5)); }`);
    };
    paint.customProgramCacheKey = () => 'paint+';
  }
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
    carbon: MAT.carbon(), polish: MAT.polish(),
  };
  const cab = interior(mats, spec.interior); cab.name = 'interior'; body.add(cab);
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
  const W = spec.wheels, wheels = [], rims = [];
  for (const [x, track, w, R, rim] of [[W.xf, W.trackF, W.wF, W.RF ?? W.R, W.rimF ?? W.rim], [W.xr, W.trackR, W.wR, W.RR ?? W.R, W.rimR ?? W.rim]]) {
    for (const s of [-1, 1]) {
      const { wheel: wh, brake } = wheel({ R, width: w, rim, mats, style: W.style });
      rims.push({ wh, rim, w, s });
      const hub = new THREE.Group();
      hub.position.set(x, R, s * track);
      if (s < 0) { hub.rotation.y = Math.PI; brake.scale.x = -1; } // 左邊的卡鉗也要在碟盤後面
      hub.add(wh, brake);
      car.add(hub);
      wheels.push(wh); hubs.push({ hub, s, track, ax: x > 0 ? 'f' : 'r' });
    }
  }
  let wideOn = false;
  const setWide = (on) => {
    if (!wide) return;
    wide.visible = wideOn = on;
    for (const h of hubs) h.hub.position.z = h.s * (h.track + (on ? WIDE_PUSH[h.ax] : 0));
    fitGlow();
  };

  // 輪框樣式：'stock'（這台車自己的）、'five'、'multi'、'mesh'、'six'、'fan'、'dish'；只換輪框面（輻條＋中心蓋＋螺帽），輪胎、輪框筒、煞車不動
  // 顏色一樣從 mats.chrome 來（車庫換輪框色改的是它）；mesh、dish 的輪框筒外緣換成拋光輪唇（mats.polish）
  let rimNow = 'stock';
  const setRim = (k = 'stock') => {
    const style = k === 'stock' ? W.style : k;
    if (k === rimNow) return;
    rimNow = k;
    for (const r of rims) {
      const old = r.wh.getObjectByName('rimface');
      if (old) { r.wh.remove(old); old.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
      r.wh.add(rimFace(style, r.rim, r.w, mats, r.s));
      r.wh.getObjectByName('barrel').material = RIM_POLISH[style] ? mats.polish : mats.chrome;
    }
    if (!RIM_POLISH[style]) mats.polish.dispose(); // 沒用到拋光輪唇就放掉（車庫 disposeCar 只放得到場景裡的材質；之後再用會自己重建）
  };

  // 底盤霓虹燈：地上一片柔柔的光，掛在 car 底下（跟著車子跑，不跟車身高度）；'none'＝關
  const bb = new THREE.Box3();
  for (const g of [geos.body, ...Object.values(geos.noses || {})]) { if (!g.boundingBox) g.computeBoundingBox(); bb.union(g.boundingBox); }
  let glow = null;
  const halfW = Math.max(bb.max.z, -bb.min.z);
  function fitGlow() { if (glow) glow.scale.y = wideOn ? 1 + Math.max(WIDE_PUSH.f, WIDE_PUSH.r) / (halfW + 0.5) : 1; } // 寬體：光也寬一點
  const setGlow = (c) => {
    if (!c || c === 'none') { if (glow) glow.visible = false; return; }
    if (!glow) { glow = neonPad(bb.min.x, bb.max.x, halfW); car.add(glow); fitGlow(); }
    glow.setColor(c); glow.visible = true;
  };

  // 漆面：'stock'（原本的；918 是照顏色自動消光／亮面）、'gloss' 亮面、'metal' 金屬漆、'matte' 消光、'pearl' 珍珠（iridescence）
  // [粗糙度, 金屬感, 清漆, 清漆粗糙度, 珍珠, 亮片]；清漆不能是 0（patchPaint 的 shader 要用到），消光用 0.001
  const FIN = { gloss: [0.16, 0.02, 1, 0.012, 0, 0], metal: [0.3, 0.6, 1, 0.03, 0, 0.14], matte: [0.62, 0.12, 0.001, 0.6, 0, 0], pearl: [0.22, 0.3, 1, 0.02, 1, 0] };
  const stockFin = [paint.roughness, paint.metalness, paint.clearcoat, paint.clearcoatRoughness, 0, 0];
  const setFinish = (k = 'stock') => {
    const f = FIN[k] || stockFin;
    paint.userData.finish = FIN[k] ? k : 'stock'; // 918 的 P918_sync 看這個：不是 stock 就不照顏色改漆面
    [paint.roughness, paint.metalness, paint.clearcoat, paint.clearcoatRoughness, paint.iridescence, finU.uFlake.value] = f;
    paint.iridescenceIOR = 2; paint.iridescenceThicknessRange = [100, 380]; // 沒有厚度貼圖時膜厚＝最大值 380nm：白車偏淡紫、彩色車有粉色光澤
  };
  return { car, body, paint, glass, wheels, wings, setWing, noses, setKit, setWide, setRim, setGlow, setFinish, mats, tex, spec };
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

// ---- cabin.js ----
// 3D 車內（坐進去）：七台車各自照車艙量出來的座艙，取代 parts.js interior() 的方塊車內
// 有：沿著前擋下緣的儀表板、儀表（指針式或數位螢幕，canvas 畫數字，指針會動）、方向盤（輻條、中間、撥片）、中控面板（出風口、音響、空調）、
//     排檔桿（手排 H 檔／按鍵）、手煞車、踏板、門板（扶手、門把、喇叭）、桶椅（兩側包覆、安全帶孔）、車內後照鏡、遮陽板、
//     後座＋置物板／中置引擎的隔板、Supra 的防滾籠、灰色車頂內襯（Supra、R34、GC8）
// buildCabin(key, spec, mats) → THREE.Group（name 'cabin'），加在 S.body 底下、拿掉 'interior'（車身座標：x 往前、y 往上、z 往右）
//   cabin.userData.setGauges(轉速比例 0～1（1＝紅線）, 時速 km/h)：轉速表、時速表指針（數位儀表換數字）
//   cabin.userData.view＝CABIN_VIEW[key]；mats 沒用到（留著以後用）
// CABIN_VIEW[key]＝{ eye, look, fov }：駕駛的眼睛、預設往前看的點（車身座標）、建議視角（度）；cabinCamera(camera, S.body, key, yaw, pitch) 幫你擺相機
// 輕：全部併成 5～6 個 mesh（車內頂點色、亮面頂點色、金屬頂點色、儀表貼圖、指針、數位時速），每台 8 千～1 萬 2 千個三角形
// 打包（build-art.mjs 拿掉 import／export）：最上層只有 CABIN3D、CABIN_VIEW、buildCabin、cabinCamera、cabinFov，其他都在 IIFE 裡
// 車艙尺寸（FIT）：node cabin-fit.mjs --write（車身 SDF＋車窗遮罩 cabin-masks.json 量的）

const CABIN3D = (() => {
  // __CABIN_FIT__（node cabin-fit.mjs --write 量的，不要手改）x：-1.9～1.2 每 0.1；S 的 y：0.2～1.3；T 的 z：0～1.0；單位公釐
  const FIT = {
    supra: {S: '846 852 904 520 520 520 520 520 520 532 882 884 884 884 884 884 884 884 884 884 884 884 884 884 884 884 884 864 522 520 520 520 868 878 538 520 520 520 520 520 520 522 884 878 874 868 866 864 864 862 862 862 862 862 862 862 864 866 868 882 520 520 520 520 886 900 906 520 520 520 520 520 520 522 906 898 890 882 876 870 868 866 866 866 866 866 866 868 870 874 880 892 520 520 520 520 898 912 924 520 520 520 520 520 520 928 920 910 900 890 882 874 870 868 866 866 866 866 866 868 870 876 886 894 530 520 520 520 898 912 922 930 520 520 520 520 538 928 920 910 898 888 878 872 866 864 864 862 862 864 864 864 866 870 878 886 896 522 520 520 882 894 904 912 918 922 920 920 914 908 900 892 882 874 866 860 856 856 854 854 854 854 856 856 856 858 862 866 870 876 894 892 846 856 864 870 874 878 878 878 874 870 864 856 850 844 838 836 834 834 834 834 834 834 834 834 834 834 834 834 832 832 828 822 690 738 764 778 788 796 800 802 800 798 794 790 786 782 782 782 782 780 780 778 776 774 772 768 762 752 730 670 558 326 180 0 0 0 0 0 0 86 558 628 668 692 704 712 718 724 726 728 730 730 732 732 730 728 726 720 700 644 0 0 0 0 0 0 0 0 0 0 0 0 0 0 346 582 626 650 664 670 674 676 678 678 680 680 678 672 656 614 118 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 276 536 574 590 598 602 604 604 600 588 548 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0', T: '922 930 940 946 970 1002 1040 1076 1112 1146 1178 1208 1234 1252 1264 1272 1276 1276 1276 1272 1260 1234 1198 1152 1102 1050 994 952 930 922 908 892 920 930 938 946 970 1000 1038 1076 1110 1144 1176 1206 1232 1252 1264 1270 1274 1276 1276 1272 1258 1234 1196 1150 1102 1050 994 950 928 920 906 890 920 928 938 946 968 998 1036 1072 1108 1142 1174 1204 1230 1248 1262 1268 1272 1272 1272 1268 1256 1232 1194 1148 1098 1046 992 948 926 914 900 882 922 934 944 952 970 996 1032 1068 1104 1138 1170 1200 1226 1244 1256 1264 1268 1268 1268 1264 1252 1226 1190 1144 1094 1042 986 944 920 904 888 872 926 936 948 956 968 992 1024 1062 1098 1130 1164 1194 1218 1238 1250 1258 1262 1262 1262 1258 1246 1220 1184 1138 1088 1036 980 938 914 892 876 862 924 934 944 952 960 982 1016 1054 1090 1122 1156 1186 1210 1228 1240 1248 1250 1252 1252 1248 1236 1212 1176 1130 1080 1028 972 930 906 886 872 860 914 924 934 942 950 958 984 1020 1058 1090 1120 1146 1166 1182 1192 1198 1202 1202 1204 1200 1192 1174 1144 1108 1064 1016 962 916 898 886 872 860 900 910 920 926 934 940 944 952 968 988 1008 1024 1036 1044 1050 1054 1056 1058 1060 1060 1058 1054 1044 1026 1000 964 918 896 888 886 874 860 858 870 880 886 892 898 900 902 900 898 894 888 884 878 874 872 870 870 868 866 866 864 862 860 860 858 854 850 846 838 828 818 0 672 710 732 746 754 756 750 742 726 700 660 556 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 584 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0', belt: '0 0 0 0 0 0 0 0 0 1016 1012 1008 1004 1000 996 996 992 992 988 984 984 980 980 980 976 0 0 0 0 0 0 0', st: '0 0 0 0 0 0 0 0 0 1048 1084 1116 1144 1164 1092 1184 1188 1188 1188 1184 1168 1140 1100 1052 996 0 0 0 0 0 0 0', ws: '765 765 765 765 760 745 0 0 0 0 0', wf: '800 800 800 800 790 775 0 0 0 0 0', wt: '205 205 205 205 205 295 0 0 0 0 0', rg: '-1480 -1480 -1480 -1465 -1420 0 0 0 0 0 0', rt: '-655 -660 -660 -660 -665 0 0 0 0 0 0', fa: '852 692', ra: '-976 692', bot: 0.136},
    gtr: {S: '848 850 602 600 600 600 600 600 600 884 872 872 872 872 872 872 872 872 872 872 872 872 872 872 872 872 872 866 864 600 600 600 888 890 600 600 600 600 600 600 600 886 888 858 852 852 850 850 850 850 850 850 850 850 850 850 850 852 852 860 892 600 600 600 906 906 600 600 600 600 600 600 600 904 904 864 854 852 852 852 852 850 850 850 850 850 852 852 852 852 854 868 900 600 600 600 906 906 614 600 600 600 600 600 600 906 904 866 854 854 852 852 852 852 850 850 850 852 852 852 852 854 854 868 898 600 600 600 906 906 906 602 600 600 600 600 906 906 904 864 852 852 852 852 850 850 850 850 850 850 850 852 852 852 852 868 896 900 600 600 904 904 906 906 906 892 902 906 904 904 904 862 850 850 850 848 848 848 848 848 848 848 848 848 850 850 850 858 880 880 884 890 860 862 864 864 864 864 864 862 862 862 860 844 842 842 842 842 840 840 840 840 840 840 840 842 842 842 842 842 842 842 842 842 814 814 814 814 814 814 814 812 812 810 808 808 806 804 802 800 800 798 796 794 790 788 784 778 768 752 716 646 538 424 300 158 0 0 0 310 554 632 672 690 702 712 718 720 724 724 726 728 728 728 726 726 724 724 722 718 710 684 574 0 0 0 0 0 0 0 0 0 0 0 550 638 666 678 684 686 690 690 692 694 694 694 692 692 690 690 688 684 658 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 346 610 640 652 656 656 658 660 660 660 658 658 656 656 650 618 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 494 582 598 604 606 606 606 602 596 584 552 78 0 0 0 0 0 0 0 0 0', T: '984 986 988 1012 1046 1084 1126 1170 1210 1250 1288 1320 1342 1354 1360 1360 1360 1360 1358 1352 1344 1328 1302 1254 1180 1100 1030 960 924 914 912 904 984 986 988 1012 1046 1084 1126 1168 1210 1248 1286 1320 1342 1354 1358 1360 1360 1360 1358 1352 1342 1328 1300 1252 1180 1100 1028 960 922 914 910 904 984 986 986 1008 1044 1080 1122 1166 1208 1246 1284 1318 1340 1350 1356 1358 1358 1358 1356 1350 1340 1324 1298 1250 1178 1098 1026 958 920 912 906 898 982 984 986 1002 1040 1076 1118 1162 1204 1242 1280 1314 1336 1346 1352 1354 1354 1354 1352 1346 1336 1320 1294 1246 1174 1094 1022 954 916 908 900 892 980 982 984 992 1034 1072 1114 1156 1198 1236 1274 1308 1330 1342 1346 1348 1348 1348 1346 1340 1330 1316 1288 1240 1168 1088 1016 948 910 902 894 886 976 978 980 982 1022 1064 1106 1150 1190 1230 1268 1300 1322 1334 1340 1340 1340 1340 1338 1332 1324 1308 1282 1234 1160 1080 1010 940 904 896 884 874 972 974 976 976 982 1030 1084 1128 1170 1206 1240 1270 1288 1298 1304 1306 1306 1306 1302 1298 1290 1278 1254 1212 1144 1068 992 914 896 888 880 872 966 968 970 970 970 968 970 980 1004 1032 1048 1060 1066 1072 1076 1080 1080 1080 1076 1072 1068 1068 1064 1052 1024 968 908 894 886 878 872 864 918 918 918 918 918 918 916 914 914 912 910 908 906 904 902 900 900 898 896 894 892 890 888 886 884 880 876 872 866 862 856 848 722 726 728 728 728 732 730 726 724 724 718 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0', belt: '0 0 0 0 0 0 0 0 0 996 984 972 968 964 956 0 952 948 948 944 944 944 944 948 948 980 980 980 980 0 0 0', st: '0 0 0 0 0 0 0 0 0 1048 1108 1164 1208 1232 1240 0 1244 1244 1240 1236 1232 1212 1400 1400 1400 1400 1400 1400 1400 0 0 0', ws: '790 790 790 790 790 790 730 0 0 0 0', wf: '850 850 850 850 840 825 775 0 0 0 0', wt: '215 215 215 215 220 250 340 0 0 0 0', rg: '-1490 -1490 -1490 -1490 -1490 -1225 0 0 0 0 0', rt: '-705 -705 -705 -705 -710 -740 0 0 0 0 0', fa: '920 700', ra: '-1004 700', bot: 0.122},
    sp3: {S: '576 574 584 594 596 600 600 600 600 902 896 886 878 888 902 896 890 886 882 882 882 884 888 894 902 910 670 606 592 592 594 594 876 600 600 600 600 600 600 600 600 982 944 934 924 936 950 944 938 932 930 928 928 930 936 942 948 958 970 988 620 620 620 620 888 600 600 600 600 600 600 600 600 984 950 940 932 944 956 950 944 940 938 936 936 938 942 948 956 966 976 992 620 620 620 620 900 600 600 600 600 600 600 600 600 978 962 952 944 954 960 950 944 940 938 936 936 938 942 948 956 966 976 988 620 620 620 620 924 614 600 600 600 600 600 600 602 992 986 976 966 970 960 950 942 938 936 934 934 936 940 948 954 964 974 986 996 620 620 620 944 974 606 600 600 600 600 602 1018 1014 1006 996 986 972 944 930 922 918 916 914 914 916 918 922 928 940 952 964 968 980 624 0 946 978 1000 1012 1014 1014 1024 1024 1020 1016 1010 998 980 944 892 866 848 834 824 816 810 806 802 796 786 788 876 0 0 0 0 0 928 958 978 990 996 996 998 996 988 978 942 714 714 720 726 732 736 738 740 740 738 740 738 734 712 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 466 594 630 648 658 664 670 674 676 678 678 676 678 676 658 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 458 536 560 572 582 588 590 592 590 584 576 540 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0', T: '946 946 946 946 946 948 950 952 952 1038 1090 1110 1122 1130 1138 1140 1142 1144 1144 1142 1136 1130 1116 1070 984 900 820 758 734 722 710 698 946 946 946 946 946 948 950 952 952 1038 1090 1110 1122 1130 1136 1140 1142 1142 1142 1140 1136 1130 1116 1068 982 900 820 758 734 722 708 696 944 944 944 944 944 946 950 952 952 1034 1090 1108 1120 1130 1136 1138 1140 1142 1142 1140 1134 1128 1114 1068 982 898 820 756 732 720 708 696 942 942 942 942 942 944 948 950 950 1030 1086 1106 1118 1126 1132 1136 1138 1140 1138 1136 1132 1126 1112 1064 980 896 816 754 732 718 706 694 940 940 940 940 940 942 946 948 948 1018 1084 1104 1116 1124 1130 1134 1136 1136 1136 1134 1128 1124 1108 1062 976 892 814 752 728 716 704 692 954 956 954 954 954 952 954 954 950 984 1070 1096 1110 1118 1124 1128 1130 1132 1132 1130 1124 1118 1104 1058 972 888 810 754 738 726 712 700 1018 1026 1022 1018 1014 1004 998 988 970 960 992 1038 1060 1072 1080 1088 1092 1094 1094 1092 1090 1086 1076 1040 966 882 818 822 824 812 798 786 1072 1084 1078 1072 1066 1046 1034 1016 986 970 932 908 918 932 942 952 958 962 962 962 962 962 962 952 912 854 846 890 902 888 876 864 1068 1088 1086 1078 1072 1050 1036 1018 986 968 928 890 870 854 842 832 826 820 816 812 808 806 802 784 768 794 846 890 902 892 880 868 964 1004 1016 1018 1018 1006 998 986 964 950 914 882 864 838 792 766 752 742 734 730 726 726 726 726 728 748 778 802 808 802 794 784 0 0 764 868 888 894 894 892 882 868 838 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0', belt: '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 892 876 876 872 872 876 872 872 0 0 0 0 0', st: '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 932 1056 1060 1056 1048 996 940 892 0 0 0 0 0', ws: '720 720 720 720 720 720 720 720 0 0 0', wf: '815 815 815 815 815 825 830 850 0 0 0', wt: '380 380 380 390 410 445 535 660 0 0 0', rg: '-1550 -1550 -1550 -1550 0 0 0 0 0 0 0', rt: '-1080 -1080 -1080 -1080 0 0 0 0 0 0 0', fa: '820 728', ra: '-1020 796', bot: 0.118},
    jesko: {S: '934 952 628 620 620 620 620 620 620 628 958 952 948 942 938 932 928 926 924 924 924 924 926 926 928 932 936 940 944 940 620 620 942 966 620 620 620 620 620 620 620 620 882 882 882 882 882 888 936 932 930 930 930 930 930 932 936 940 944 948 954 622 620 620 942 970 620 620 620 620 620 620 620 620 880 880 880 880 880 886 936 932 930 930 930 930 930 934 936 940 946 950 958 622 620 620 942 970 622 620 620 620 620 620 620 622 880 880 880 880 880 886 936 932 930 930 930 930 932 934 936 940 946 950 958 960 620 620 942 968 982 620 620 620 620 620 620 924 882 882 882 882 882 888 936 932 930 930 930 930 932 932 936 940 944 950 956 964 622 620 940 962 972 978 622 620 620 622 978 972 962 950 936 918 900 892 890 890 892 892 894 896 898 898 898 892 882 878 900 918 930 930 916 932 940 944 946 946 944 938 926 896 782 764 776 788 800 806 812 818 820 824 828 830 832 832 822 792 734 582 346 0 0 0 0 180 272 348 408 460 504 546 584 620 652 680 702 718 730 740 748 754 758 762 764 766 764 748 704 562 306 0 0 0 0 0 0 0 0 0 0 0 138 268 358 438 510 560 594 620 634 646 658 670 676 680 682 676 650 544 280 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 114 280 370 426 458 478 500 518 526 516 488 412 170 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0', T: '898 914 930 950 968 988 1008 1030 1052 1078 1106 1132 1156 1174 1186 1192 1196 1196 1192 1180 1164 1142 1108 1064 1018 968 920 874 826 778 740 726 894 910 926 946 964 984 1004 1026 1048 1074 1102 1128 1152 1170 1182 1188 1192 1194 1188 1176 1162 1140 1106 1062 1016 966 918 872 824 776 738 726 882 898 914 934 952 972 992 1014 1036 1062 1090 1116 1140 1158 1170 1176 1180 1182 1178 1168 1154 1132 1098 1056 1010 960 912 866 818 770 736 726 862 878 894 914 932 952 972 994 1016 1042 1070 1096 1120 1138 1148 1156 1162 1164 1162 1152 1140 1120 1088 1046 998 950 902 854 808 760 730 726 832 848 866 884 904 924 944 966 988 1014 1042 1068 1092 1110 1120 1128 1134 1140 1140 1132 1122 1104 1072 1030 984 934 886 840 792 750 728 730 838 850 860 868 876 886 902 926 950 978 1004 1032 1054 1072 1084 1092 1100 1108 1110 1106 1098 1082 1052 1010 964 914 866 820 772 740 734 740 866 878 888 894 896 892 882 876 888 916 944 972 996 1016 1028 1038 1048 1058 1062 1064 1060 1050 1026 988 940 892 844 796 754 738 744 752 886 896 904 908 910 908 900 882 860 840 848 876 902 922 936 946 958 968 976 980 982 978 966 940 902 860 814 768 740 740 750 760 880 888 896 900 900 898 892 878 858 830 798 778 774 782 798 810 820 828 834 838 844 848 850 844 824 794 760 732 728 738 748 758 822 838 846 850 852 850 846 834 820 798 772 748 730 714 700 692 686 684 682 682 686 688 692 694 690 686 684 688 700 712 720 726 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0', belt: '0 0 0 0 0 0 0 820 800 784 768 760 748 744 736 732 728 728 728 728 728 728 728 728 732 732 736 736 744 0 0 0', st: '0 0 0 0 0 0 0 824 868 900 932 960 980 1000 808 1032 1040 1044 1052 1040 1028 1016 992 956 924 888 840 796 752 0 0 0', ws: '1060 1060 1060 1060 1060 1060 1055 995 0 0 0', wf: '1130 1130 1130 1130 1120 1110 1085 1035 0 0 0', wt: '340 340 340 340 340 340 420 670 0 0 0', rg: '0 0 0 0 0 0 0 0 0 0 0', rt: '0 0 0 0 0 0 0 0 0 0 0', fa: '980 724', ra: '-964 760', bot: 0.124},
    yaris: {S: '0 0 0 620 620 620 620 620 620 844 842 840 840 838 838 838 838 838 836 836 836 838 838 838 838 840 840 842 600 600 600 600 768 830 620 620 620 620 620 620 620 860 856 850 848 846 844 844 844 844 844 844 844 844 844 844 846 846 848 846 600 600 600 600 768 832 620 620 620 620 620 620 620 876 868 860 854 848 848 846 846 846 846 846 846 846 846 846 848 848 852 860 600 600 600 600 768 832 624 620 620 620 620 620 620 890 880 870 860 852 848 846 846 846 846 846 846 846 846 846 848 850 858 870 600 600 600 600 730 834 864 622 620 620 620 620 902 894 884 872 862 852 846 846 844 844 844 844 844 844 846 846 846 848 856 870 884 600 600 600 0 830 860 886 896 896 904 902 898 890 880 868 858 848 844 842 842 842 842 842 842 842 842 842 844 844 848 858 870 878 884 884 0 820 846 872 882 886 888 888 882 876 866 856 846 840 836 836 836 836 834 834 834 836 836 836 836 838 838 842 848 854 856 856 0 798 826 846 854 858 860 860 856 848 842 832 826 822 820 820 820 820 820 820 820 820 820 820 822 822 822 824 824 824 824 822 0 756 774 792 800 802 802 798 790 778 772 768 770 772 774 776 778 778 778 778 780 780 780 782 782 782 782 768 750 718 590 256 0 332 544 586 614 636 654 670 686 700 710 718 726 730 734 738 740 740 740 740 740 740 740 740 738 734 714 0 0 0 0 0 0 0 500 546 574 598 616 634 650 664 674 682 690 694 698 702 704 704 704 704 704 704 704 702 674 0 0 0 0 0 0 0 0 0 0 486 530 560 580 598 614 628 638 646 654 658 662 666 668 668 668 668 668 666 640 0 0 0 0 0 0 0 0 0', T: '654 1112 1282 1330 1356 1376 1394 1410 1422 1434 1442 1448 1452 1456 1458 1456 1456 1452 1444 1432 1412 1378 1334 1284 1236 1190 1146 1098 1062 1044 1026 1006 652 1110 1282 1330 1356 1376 1394 1410 1422 1434 1442 1448 1452 1456 1456 1456 1454 1452 1444 1432 1410 1376 1334 1284 1236 1190 1146 1098 1060 1042 1026 1006 650 1108 1280 1330 1354 1374 1392 1408 1422 1432 1440 1446 1452 1454 1456 1456 1454 1450 1442 1430 1410 1376 1332 1284 1234 1190 1144 1096 1058 1040 1022 1002 650 1104 1278 1328 1352 1372 1390 1406 1420 1430 1438 1444 1450 1452 1454 1454 1452 1448 1440 1428 1408 1374 1330 1282 1232 1188 1142 1094 1056 1036 1020 1000 646 1092 1274 1324 1350 1370 1388 1404 1416 1428 1436 1442 1446 1450 1450 1450 1450 1446 1438 1426 1404 1372 1328 1278 1230 1184 1140 1092 1052 1032 1014 996 640 1064 1198 1288 1328 1358 1380 1398 1412 1424 1432 1438 1442 1446 1448 1446 1446 1442 1434 1422 1402 1368 1324 1276 1226 1182 1136 1088 1046 1026 1008 992 632 1054 1062 1086 1126 1192 1246 1292 1336 1364 1384 1398 1408 1416 1420 1422 1422 1420 1414 1404 1386 1358 1318 1270 1222 1176 1132 1084 1036 1018 1000 984 614 1042 1042 1054 1056 1052 1050 1054 1066 1096 1126 1150 1168 1184 1196 1202 1206 1208 1210 1210 1210 1212 1212 1202 1176 1146 1110 1056 1016 1004 988 970 0 884 964 990 1000 1002 1002 998 992 984 972 960 950 946 946 946 946 948 948 948 950 952 954 956 958 958 960 956 956 950 942 932 0 0 0 0 0 0 730 718 658 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0', belt: '0 0 0 0 0 0 0 0 0 1188 1156 1136 1124 1108 1100 1092 1104 1076 1068 1064 1056 1048 1044 1040 1124 0 0 0 0 0 0 0', st: '0 0 0 0 0 0 0 0 0 1288 1320 1340 1352 1360 1372 1316 1376 1376 1372 1360 1336 1296 1248 1200 1144 0 0 0 0 0 0 0', ws: '800 800 800 800 800 800 785 0 0 0 0', wf: '870 870 870 865 860 845 815 0 0 0 0', wt: '-40 -40 -40 -40 -40 -40 -40 0 0 0 0', rg: '-1820 -1820 -1820 -1820 -1820 -1815 0 0 0 0 0', rt: '-1705 -1705 -1705 -1705 -1705 -1730 0 0 0 0 0', fa: '812 680', ra: '-1016 696', bot: 0.144},
    gc8: {S: '0 0 0 856 600 600 600 600 600 600 614 860 860 860 860 860 860 860 860 860 860 860 860 860 860 860 860 860 822 600 600 600 796 814 822 852 600 600 600 600 600 600 602 846 846 846 846 846 846 846 846 846 846 846 846 846 846 846 846 846 850 600 600 600 800 816 824 856 600 600 600 600 600 600 620 830 830 830 830 828 828 828 828 828 828 828 828 828 830 830 830 830 838 600 600 600 800 816 824 830 602 600 600 600 600 600 836 830 830 830 830 830 830 830 830 830 830 830 830 830 830 830 830 830 830 606 600 600 798 816 824 828 834 604 600 600 602 844 830 828 828 828 828 828 828 828 828 828 828 828 828 828 828 828 828 828 830 830 616 600 796 812 820 824 826 828 828 830 828 826 826 826 826 824 824 824 824 824 824 824 824 824 824 824 824 824 826 826 826 826 828 828 790 804 812 814 816 818 818 818 818 816 816 814 814 814 814 814 814 814 814 814 814 812 812 812 812 812 810 810 808 806 804 800 762 772 776 778 778 778 776 774 776 776 778 776 776 776 776 774 774 774 774 772 772 770 768 764 760 748 688 464 0 0 0 272 0 0 0 0 0 526 664 706 720 726 728 730 730 730 730 730 730 730 730 730 730 730 730 726 714 652 0 0 0 0 0 0 0 0 0 0 0 0 2 634 672 682 684 686 686 686 686 686 686 686 686 686 686 686 686 670 574 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 584 630 640 642 642 642 642 642 642 642 642 642 642 642 626 402 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 442 568 582 586 588 590 592 592 592 590 588 582 562 0 0 0 0 0 0 0 0 0 0', T: '982 984 984 984 982 1034 1100 1176 1250 1318 1362 1380 1388 1394 1398 1400 1400 1398 1396 1390 1380 1354 1296 1216 1130 1052 976 920 900 890 896 904 982 982 984 982 982 1034 1100 1176 1250 1318 1360 1378 1386 1394 1396 1398 1398 1398 1396 1390 1378 1354 1296 1214 1130 1052 974 918 898 888 896 904 980 982 982 982 980 1030 1098 1174 1248 1314 1358 1376 1384 1390 1394 1396 1396 1394 1392 1388 1376 1350 1294 1212 1128 1050 972 916 896 886 896 904 978 980 980 980 978 1026 1092 1168 1242 1310 1354 1372 1380 1386 1390 1392 1392 1390 1388 1382 1372 1346 1288 1208 1122 1044 968 912 894 884 882 878 976 976 978 976 976 1018 1086 1162 1236 1304 1348 1366 1374 1380 1384 1384 1384 1384 1382 1376 1366 1340 1282 1202 1116 1038 962 906 890 880 870 860 972 972 974 972 972 1006 1078 1154 1228 1294 1336 1352 1360 1364 1368 1370 1370 1368 1368 1362 1352 1330 1274 1194 1108 1030 954 898 884 874 864 856 966 968 968 968 966 982 1052 1126 1188 1238 1268 1278 1282 1284 1286 1288 1288 1286 1286 1284 1278 1264 1226 1164 1094 1020 936 886 878 868 858 850 950 954 954 954 952 950 966 1010 1042 1056 1064 1068 1068 1068 1068 1068 1070 1068 1068 1068 1068 1068 1066 1052 1018 964 896 878 870 860 850 842 0 826 850 856 860 860 860 858 854 852 850 848 846 844 844 844 842 842 840 840 838 836 834 832 830 828 824 820 816 810 804 800 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0', belt: '0 0 0 0 0 0 0 0 940 936 936 936 936 932 932 932 932 932 932 932 932 932 932 932 932 932 0 0 0 0 0 0', st: '0 0 0 0 0 0 0 0 1080 1180 1240 1288 1304 1312 1312 1312 1312 1312 1312 1312 1304 1272 1204 1132 1056 968 0 0 0 0 0 0', ws: '790 790 790 790 790 775 735 0 0 0 0', wf: '835 835 835 830 825 805 770 0 0 0 0', wt: '330 330 330 330 330 355 610 0 0 0 0', rg: '-1430 -1430 -1430 -1425 -1415 -1400 0 0 0 0 0', rt: '-1020 -1020 -1020 -1020 -1020 -1030 0 0 0 0 0', fa: '924 652', ra: '-884 652', bot: 0.17},
    p918: {S: '926 954 620 620 620 620 620 620 620 930 930 930 930 928 928 926 926 926 926 926 926 926 926 926 926 926 926 928 922 620 620 620 944 626 620 620 620 620 620 620 620 958 942 940 936 932 928 924 918 914 910 908 906 906 906 908 910 914 922 928 948 620 620 620 948 624 620 620 620 620 620 620 620 960 946 944 940 934 930 924 920 916 912 908 906 906 906 908 912 916 922 932 950 620 620 620 948 956 620 620 620 620 620 620 620 954 948 938 934 936 930 926 920 916 912 908 906 906 906 908 912 916 922 932 940 620 620 620 946 950 620 620 620 620 620 620 632 948 880 860 860 934 928 924 920 916 912 908 906 906 906 908 912 916 922 930 938 958 620 620 936 938 946 622 620 620 620 646 942 942 880 860 860 930 926 922 918 914 910 906 906 904 906 908 910 914 920 926 934 938 952 624 786 782 784 790 804 822 844 866 878 882 874 858 850 838 826 818 814 812 814 816 818 818 838 860 872 882 890 896 902 908 908 906 172 298 504 524 592 614 626 632 636 638 640 640 640 640 642 700 704 702 710 712 714 712 712 712 704 648 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 592 630 628 624 632 634 636 634 634 630 428 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 590 590 586 550 552 552 546 530 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0', T: '904 908 914 922 930 940 948 956 964 972 980 988 994 1000 1026 1138 1162 1168 1168 1168 1162 1152 1134 1086 1012 936 862 808 806 812 810 804 902 906 914 922 930 938 948 956 964 972 980 986 992 1000 1026 1138 1162 1166 1168 1168 1162 1152 1134 1086 1012 936 862 808 806 812 810 804 900 904 912 918 928 936 944 952 960 968 976 984 990 996 1022 1136 1160 1166 1166 1166 1160 1150 1132 1084 1010 934 860 806 806 812 810 804 896 900 908 914 924 932 940 948 956 964 972 980 986 992 1016 1134 1156 1162 1162 1162 1158 1148 1128 1080 1006 930 856 806 806 812 810 804 914 922 932 942 954 966 980 994 1008 1024 1042 1062 1086 1110 1132 1150 1162 1160 1158 1158 1152 1142 1124 1076 1002 926 852 804 806 812 810 804 884 892 904 922 944 962 978 992 1008 1024 1042 1062 1086 1110 1132 1150 1156 1146 1136 1138 1136 1128 1114 1070 996 922 846 802 806 812 812 804 872 876 882 890 898 908 916 924 932 940 948 956 964 974 988 1034 1040 1038 1040 1044 1044 1044 1044 1028 982 914 846 834 838 844 844 838 822 822 822 822 824 826 828 830 832 830 828 826 822 820 818 898 906 904 912 916 916 916 916 914 904 874 864 870 876 884 884 878 796 796 796 798 802 806 810 814 816 818 816 812 810 806 804 804 806 804 806 808 808 808 812 820 832 846 858 866 872 880 882 874 760 758 760 764 0 0 782 786 790 790 532 512 512 778 772 768 764 758 752 746 740 740 742 748 758 768 782 794 804 812 812 808 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0', belt: '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 884 876 872 872 872 872 872 872 0 0 0 0 0 0 0', st: '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 916 1120 1124 1120 1108 1060 988 916 0 0 0 0 0 0 0', ws: '770 770 770 770 765 745 710 0 0 0 0', wf: '800 800 800 800 790 770 740 0 0 0 0', wt: '300 300 300 300 300 300 410 0 0 0 0', rg: '-530 -530 -530 -520 0 0 0 0 0 0 0', rt: '-400 -400 -395 -430 0 0 0 0 0 0 0', fa: '932 732', ra: '-1024 764', bot: 0.114},
  };
  // __CABIN_FIT_END__

  const X0 = -1.9, NX = 32, Y0 = 0.2, NY = 12, NZ = 11;
  const cl = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
  const ss = (a, b, x) => { const t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const D2R = Math.PI / 180, V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

  // ---- 儀表（u、v：在儀表面上的位置，公尺，右、上為正；r：半徑）----
  const TACH = (u, v, r, max = 9, red = 7, o = {}) => ({ k: 'tach', u, v, r, max, step: 1, sub: 5, red, label: '×1000r/min', ...o });
  const SPEED = (u, v, r, max = 260, o = {}) => ({ k: 'speed', u, v, r, max, step: 20, sub: 2, every: max > 200 ? 2 : 1, label: 'km/h', ...o });
  const SMALL = (u, v, r, lo, hi, val, o = {}) => ({ k: 'small', u, v, r, lo, hi, val, ...o });
  const BOOST = (u, v, r, o = {}) => ({ k: 'static', u, v, r, min: -1, max: 1, step: 0.5, sub: 5, every: 2, label: '×100kPa', val: -0.55, ...o });

  // ---- 每台車的樣子 ----
  // eye：駕駛眼睛 [x, y]（z＝駕駛側 × zD）；H 點（屁股）＝眼睛往前 0.16、往下 0.64
  // c：顏色（dash 儀表板、top 上面、low 下面、acc 飾條、carpet 地毯、door／doorIn 門板／門板中間那片、sb／si／sp／ss 座椅包覆／中間／車縫線／椅背殼、
  //    rim／rimTop／spoke／hub 方向盤、hl 遮陽板、cage 防滾籠、metal 金屬、knob 排檔頭、needle 指針）
  // dash：xr 後緣 x、yt 上緣高、yl 下緣高（膝蓋）、slant 面板往前斜、wrap 兩端往後包、bulge 中間往後凸
  // cl：儀表（w×h、depth 遮光罩深、rise 遮光罩比儀表高、type analog|digital、bend 曲面螢幕半徑、col 裝在轉向柱上）
  // stack：中控面板（w 寬、x1、y1 下緣、turn 轉向駕駛幾度、kind 面板畫法）；wheel：方向盤（r、reach 眼睛往前、drop 往下、col 轉向柱角度、spokes 輻條角度、
  //    fb／ft 下面／上面切平、hub pad|round、paddles 撥片、top 上半圈亮面、start 紅色啟動鈕、screens 輻條上的螢幕）
  // shift：manual|bridge|toggle；hand 手煞車拉桿；pedals 踏板數；rear：shelf|bench|bulk（bulk／bench.x 位置）；cage 防滾籠
  const STYLE = {
    supra: {
      lhd: true, zD: 0.36, eye: [-0.30, 1.12], fov: 72,
      c: { dash: 0x1c1d20, top: 0x151618, low: 0x19191b, acc: 0x55585e, carpet: 0x141416, door: 0x1b1c1f, doorIn: 0x2b2d32, sb: 0x15161a, si: 0x2152b8, ss: 0x101113,
        rim: 0x151517, spoke: 0x8e939a, hub: 0x18191b, roof: 0x5a5c60, hl: 0x505256, cage: 0xd6d8da, metal: 0xc4c8cd, knob: 0xc4c8cd, needle: 0xff5a1a, marker: 0xd01818 },
      dash: { xr: 0.40, yt: 0.925, yl: 0.60, slant: 0.05, wrap: 0.10, bulge: 0.03 },
      cl: { w: 0.40, h: 0.14, depth: 0.095, rise: 0.035, type: 'analog', face: '#0b0b0d', ink: '#f2f2f2',
        dials: [SPEED(-0.128, -0.004, 0.057, 260), TACH(0, 0.002, 0.066, 9, 7), SMALL(0.13, 0.028, 0.03, 'E', 'F', 0.72), SMALL(0.13, -0.036, 0.03, 'C', 'H', 0.45)] },
      stack: { w: 0.27, x1: 0.50, y1: 0.40, turn: 12, kind: 'radio' },
      wheel: { r: 0.185, reach: 0.43, drop: 0.29, col: 23, spokes: [90, 270, 180], hub: 'pad' },
      shift: 'manual', hand: true, pedals: 3, rear: 'shelf', bulk: -0.88, cage: true,
    },
    gtr: {
      lhd: false, zD: 0.36, eye: [-0.27, 1.17], fov: 72,
      c: { dash: 0x222327, top: 0x1a1b1e, low: 0x1c1d20, acc: 0x3b3d42, carpet: 0x18181a, door: 0x202125, doorIn: 0x35373c, sb: 0x17181b, si: 0x3c3f46, ss: 0x141517,
        rim: 0x151517, spoke: 0x1d1e21, hub: 0x1d1e21, roof: 0x5e6065, hl: 0x54565b, metal: 0xb4b8be, knob: 0x1b1b1d, needle: 0xff4a18 },
      dash: { xr: 0.42, yt: 0.935, yl: 0.62, slant: 0.06, wrap: 0.05 },
      cl: { w: 0.44, h: 0.15, depth: 0.10, rise: 0.04, type: 'analog', face: '#0a0a0c', ink: '#f0f0f0',
        dials: [SPEED(-0.148, -0.004, 0.058, 180), TACH(0, 0.002, 0.068, 9, 8), BOOST(0.148, -0.004, 0.05), SMALL(-0.2, -0.052, 0.02, 'E', 'F', 0.7), SMALL(0.2, -0.052, 0.02, 'C', 'H', 0.45)] },
      mfd: { w: 0.16, h: 0.08 },
      stack: { w: 0.26, x1: 0.50, y1: 0.42, kind: 'radio' },
      wheel: { r: 0.185, reach: 0.43, drop: 0.30, col: 22, spokes: [90, 270, 180], hub: 'pad' },
      shift: 'manual', hand: true, pedals: 3, rear: 'bench', bench: { x: -0.98 },
    },
    gc8: {
      lhd: false, zD: 0.37, eye: [-0.25, 1.17], fov: 72,
      c: { dash: 0x2a2b2f, top: 0x202125, low: 0x232427, acc: 0x3c3e43, carpet: 0x1a1a1c, door: 0x27282c, doorIn: 0x24407e, sb: 0x17181b, si: 0x1f48ac, ss: 0x141517,
        rim: 0x141416, spoke: 0x1b1c1e, hub: 0x1b1c1e, roof: 0x77797d, hl: 0x6a6c70, metal: 0xc0c4c9, knob: 0xc0c4c9, needle: 0xff4a18 },
      dash: { xr: 0.42, yt: 0.915, yl: 0.62, slant: 0.05, wrap: 0.04 },
      cl: { w: 0.40, h: 0.145, depth: 0.09, rise: 0.035, type: 'analog', face: '#0b0b0d', ink: '#f0f0f0',
        dials: [SMALL(-0.135, 0.03, 0.03, 'C', 'H', 0.45), SMALL(-0.135, -0.035, 0.03, 'E', 'F', 0.8), TACH(0, 0, 0.068, 9, 8, { face: '#e8e8e4', ink: '#111111' }), SPEED(0.135, 0, 0.058, 180)] },
      stack: { w: 0.25, x1: 0.50, y1: 0.40, kind: 'knobs' },
      wheel: { r: 0.18, reach: 0.42, drop: 0.30, col: 22, spokes: [90, 270, 180], sw: 0.03, hub: 'round' },
      shift: 'manual', hand: true, pedals: 3, rear: 'bench', bench: { x: -0.92, L: 0.56 },
    },
    yaris: {
      lhd: false, zD: 0.36, eye: [-0.20, 1.26], fov: 72,
      c: { dash: 0x19191b, top: 0x141416, low: 0x17171a, acc: 0x6b6e73, carpet: 0x151517, door: 0x1a1a1c, doorIn: 0x2b2c30, sb: 0x161618, si: 0x2a2b2f, sp: 0xc01818, ss: 0x121214,
        rim: 0x141416, spoke: 0x6e7278, hub: 0x18181a, hl: 0x2e2f33, metal: 0xb8bcc2, knob: 0x1c1c1e, needle: 0xff3a1a },
      dash: { xr: 0.45, yt: 1.035, yl: 0.72, slant: 0.05, wrap: 0.03 },
      cl: { w: 0.40, h: 0.14, depth: 0.09, rise: 0.035, type: 'analog', face: '#0b0b0d', ink: '#f0f0f0',
        dials: [TACH(-0.118, 0, 0.062, 8, 7), SPEED(0.118, 0, 0.062, 260), { k: 'tft', u: 0, v: 0, w: 0.085, h: 0.1 }] },
      scr: { w: 0.21, h: 0.12 },
      stack: { w: 0.25, x1: 0.53, y1: 0.46, kind: 'knobs' },
      wheel: { r: 0.18, reach: 0.42, drop: 0.30, col: 24, spokes: [90, 270, 180], hub: 'pad' },
      shift: 'manual', hand: true, pedals: 3, rear: 'bench', bench: { x: -0.88 },
    },
    sp3: {
      lhd: true, zD: 0.37, eye: [-0.28, 1.01], fov: 72, floor: 0.06,
      c: { dash: 0x151618, top: 0x111214, low: 0x131416, acc: 0x1c1d20, carpet: 0x1a1a1b, door: 0xa4643a, doorIn: 0x8e5430, sb: 0xa8683a, si: 0x93582f, sp: 0x5e3419, ss: 0x16171a,
        rim: 0x151517, rimTop: 0x1b1c1f, spoke: 0x1b1c1f, hub: 0x151517, hl: 0x1c1c1e, metal: 0xb8bcc2, knob: 0xb8bcc2, needle: 0xff2a1a },
      dash: { xr: 0.40, yt: 0.77, yl: 0.64, slant: 0.03 },
      cl: { w: 0.40, h: 0.11, depth: 0.07, rise: 0.03, type: 'digital', bend: 0.45 },
      stack: { w: 0.20, x1: 0.46, y1: 0.50, kind: 'ferrari' },
      wheel: { r: 0.175, reach: 0.42, drop: 0.28, col: 20, spokes: [90, 270, 180], fb: 0.78, hub: 'pad', paddles: true, top: true, start: true },
      shift: 'bridge', hand: false, pedals: 2, rear: 'bulk', bulk: -0.80,
    },
    jesko: {
      lhd: true, zD: 0.36, eye: [-0.22, 1.03], fov: 72, floor: 0.06,
      c: { dash: 0x18191c, top: 0x141518, low: 0x16171a, acc: 0x1e1f23, carpet: 0x151517, door: 0x1a1b1e, doorIn: 0x222327, sb: 0x141416, si: 0x1e1f22, sp: 0xc8141e, ss: 0x18191c,
        rim: 0x141416, rimTop: 0x1b1c1f, spoke: 0x1b1c1f, hub: 0x141416, hl: 0x1a1a1c, metal: 0xb8bcc2, knob: 0xb8bcc2, needle: 0xff2a1a },
      dash: { xr: 0.46, yt: 0.80, yl: 0.63, slant: 0.04 },
      cl: { w: 0.22, h: 0.085, depth: 0.05, rise: 0.02, type: 'digital', col: true },
      stack: { w: 0.20, x1: 0.52, y1: 0.46, kind: 'tablet' },
      wheel: { r: 0.17, reach: 0.42, drop: 0.28, col: 20, spokes: [90, 270], ft: 0.78, fb: 0.74, hub: 'pad', paddles: true, top: true, screens: true },
      shift: 'toggle', hand: false, pedals: 2, rear: 'bulk', bulk: -0.78,
    },
    p918: {
      lhd: true, zD: 0.37, eye: [-0.24, 1.03], fov: 72, floor: 0.06,
      c: { dash: 0x17181a, top: 0x131416, low: 0x151618, acc: 0x484b50, carpet: 0x151517, door: 0x19191b, doorIn: 0x222326, sb: 0x151517, si: 0x1c1d20, sp: 0x9bd400, ss: 0x141416,
        rim: 0x151517, spoke: 0x2a2b2e, hub: 0x151517, hl: 0x1c1c1e, metal: 0xb8bcc2, knob: 0x1c1c1e, needle: 0xff3a1a },
      dash: { xr: 0.40, yt: 0.83, yl: 0.63, slant: 0.04 },
      cl: { w: 0.40, h: 0.13, depth: 0.09, rise: 0.03, type: 'digital' },
      stack: { w: 0.22, x1: 0.12, y1: 0.47, kind: 'glass' },
      wheel: { r: 0.18, reach: 0.42, drop: 0.29, col: 21, spokes: [90, 270, 180], hub: 'pad', paddles: true },
      shift: 'toggle', hand: false, pedals: 2, rear: 'bulk', bulk: -0.60,
    },
  };

  // ---- 量表：side(x,y)＝車艙中線往外到車身的半寬、top(x,z)＝頭上車身的高度、belt／st(x)＝側窗下緣／上緣、ws／wf／wt(z)＝前擋玻璃下緣／黑邊下緣／上緣、rg／rt(z)＝後擋下緣／上緣 ----
  function fitOf(key) {
    const F = FIT[key]; if (!F) return null; if (F._) return F._;
    const t = (s) => s.split(' ').map((v) => +v / 1000);
    const fill = (A) => { const nz = A.map((v, i) => [v, i]).filter(([v]) => v); return A.map((v, i) => v || (nz.length ? nz.reduce((b, c) => (Math.abs(c[1] - i) < Math.abs(b[1] - i) ? c : b))[0] : 0)); };
    const S = t(F.S), T = t(F.T), belt = fill(t(F.belt)), ws = fill(t(F.ws)), wf = fill(t(F.wf)), wt = fill(t(F.wt)), rg = t(F.rg), rt = fill(t(F.rt)), st = fill(t(F.st));
    // 雙線性內插；0＝量不到（不算）；四個角差很多（輪拱邊、車窗邊）就取最小的（保守，不會穿出去）
    const bil = (A, nx, ny, fx, fy, smooth = false) => {
      fx = cl(fx, 0, nx - 1.0001); fy = cl(fy, 0, ny - 1.0001);
      const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, q = [[A[j * nx + i], (1 - u) * (1 - v)], [A[j * nx + i + 1], u * (1 - v)], [A[(j + 1) * nx + i], (1 - u) * v], [A[(j + 1) * nx + i + 1], u * v]].filter((e) => e[0]);
      if (!q.length) return 0;
      const lo = Math.min(...q.map((e) => e[0])), hi = Math.max(...q.map((e) => e[0]));
      if (hi - lo > 0.04 && !smooth) return lo;
      const wsum = q.reduce((s, e) => s + e[1], 0);
      return wsum > 1e-6 ? q.reduce((s, e) => s + e[0] * e[1], 0) / wsum : lo;
    };
    const lin = (A, f) => { f = cl(f, 0, A.length - 1.0001); const i = f | 0, u = f - i; return A[i] * (1 - u) + A[i + 1] * u; };
    return (F._ = {
      side: (x, y) => bil(S, NX, NY, (x - X0) / 0.1, (y - Y0) / 0.1),
      top: (x, z) => bil(T, NX, NZ, (x - X0) / 0.1, Math.abs(z) / 0.1),
      roof: (x, z) => bil(T, NX, NZ, (x - X0) / 0.1, Math.abs(z) / 0.1, true), // 車頂（凸的）直接內插：直線在曲面下面，不會穿出去
      belt: (x) => lin(belt, (x - X0) / 0.1),
      ws: (z) => lin(ws, Math.abs(z) / 0.1), wf: (z) => lin(wf, Math.abs(z) / 0.1), wt: (z) => lin(wt, Math.abs(z) / 0.1),
      rg: (z) => rg[cl(Math.round(Math.abs(z) / 0.1), 0, NZ - 1)] || rg[0], rt: (z) => lin(rt, Math.abs(z) / 0.1),
      st: (x) => Math.max(lin(st, (x - X0) / 0.1 - 1), lin(st, (x - X0) / 0.1), lin(st, (x - X0) / 0.1 + 1)), // 側窗上緣（前後 10 公分取最高的）
      fa: t(F.fa), ra: t(F.ra), bot: F.bot, // fa／ra＝前輪拱後緣／後輪拱前緣 [x, 輪拱頂 y]
    });
  }
  // 把點推回車身裡面（頭上、兩側各留 m）
  const inside = (F, [x, y, z], m = 0.02) => {
    const T = F.top(x, z); if (T > 0.3) y = Math.min(y, T - m);
    const w = F.side(x, y); if (w > 0.05) z = Math.sign(z) * Math.min(Math.abs(z), w - m);
    return [x, y, z];
  };

  const insideSec = (F, sec, m = 0.02) => {
    const q = sec.map((p) => inside(F, p, m)), w = Math.min(...q.map((p, i) => (Math.abs(sec[i][2]) > 1e-6 ? Math.abs(p[2]) / Math.abs(sec[i][2]) : 1)));
    return q.map(([x, y], i) => [x, y, sec[i][2] * w]);
  };
  // ---- 幾何小工具（全部帶頂點色，最後照材質併成一個 mesh）----
  const LCM = new Map();
  const LC = (hex) => { let c = LCM.get(hex); if (!c) LCM.set(hex, (c = new THREE.Color(hex))); return c; };
  function mk(pos, idx, col) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  // 斷面接成的曲面：secs[j][i]＝[x,y,z]；col＝hex 或 (j, i) → hex；closed：斷面頭尾相接；caps：兩端封口
  function loft(secs, col, { closed = true, caps = true } = {}) {
    const nj = secs.length, ni = secs[0].length, pos = [], cs = [], idx = [];
    const cf = typeof col === 'function' ? col : () => col;
    const push = (p, c) => { pos.push(p[0], p[1], p[2]); const k = LC(c); cs.push(k.r, k.g, k.b); };
    for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) push(secs[j][i], cf(j, i));
    const n = closed ? ni : ni - 1;
    for (let j = 0; j < nj - 1; j++) for (let i = 0; i < n; i++) {
      const a = j * ni + i, b = j * ni + ((i + 1) % ni), c = (j + 1) * ni + ((i + 1) % ni), d = (j + 1) * ni + i;
      idx.push(a, b, c, a, c, d);
    }
    if (caps) for (const j of [0, nj - 1]) {
      const b0 = pos.length / 3, cen = [0, 0, 0];
      for (let i = 0; i < ni; i++) { push(secs[j][i], cf(j, i)); for (let k = 0; k < 3; k++) cen[k] += secs[j][i][k] / ni; }
      push(cen, cf(j, 0));
      for (let i = 0; i < n; i++) idx.push(b0 + ni, b0 + i, b0 + ((i + 1) % ni));
    }
    return mk(pos, idx, cs);
  }
  function tint(g, hex) {
    const n = g.attributes.position.count, k = LC(hex), a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = k.r; a[i * 3 + 1] = k.g; a[i * 3 + 2] = k.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g;
  }
  const lift = (g, k) => { const c = g.attributes.color.array; for (let i = 0; i < c.length; i++) c[i] *= k; return g; }; // 頂點色加亮（可以超過 1）
  const basis = (o, ex, ey, ez) => new THREE.Matrix4().makeBasis(ex, ey, ez).setPosition(o);
  // 圓角方塊：xy 是 w×h 的圓角矩形（r），往 z 拉 d（置中）
  function rbox(w, h, d, r, seg = 3) {
    r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4);
    const s = new THREE.Shape(), x = w / 2 - r, y = h / 2 - r;
    s.absarc(x, y, r, 0, Math.PI / 2); s.absarc(-x, y, r, Math.PI / 2, Math.PI); s.absarc(-x, -y, r, Math.PI, 1.5 * Math.PI); s.absarc(x, -y, r, 1.5 * Math.PI, 2 * Math.PI);
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: seg });
    g.translate(0, 0, -d / 2); g.deleteAttribute('uv'); return g;
  }
  const tube = (pts, r, seg = 24, rad = 8, closed = false) => { const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => (p.isVector3 ? p : V3(...p))), closed), seg, r, rad, closed); g.deleteAttribute('uv'); return g; };
  const cyl = (r0, r1, h, seg = 16) => { const g = new THREE.CylinderGeometry(r1, r0, h, seg); g.deleteAttribute('uv'); return g; }; // 沿 y，r0 下、r1 上
  // 貼圖的一片（o 中心、U 右、V 上、w×h、r＝[u0,v0,u1,v1]；bend：往觀看者彎的半徑，N 朝觀看者）
  function quadUV(o, U, V, w, h, r, bend = 0, N = null) {
    const nu = bend ? 12 : 1, pos = [], uv = [], idx = [];
    for (let i = 0; i <= nu; i++) {
      const t = i / nu, u = (t - 0.5) * w, a = bend ? u / bend : 0;
      const off = bend ? U.clone().multiplyScalar(bend * Math.sin(a)).addScaledVector(N, bend * (1 - Math.cos(a))) : U.clone().multiplyScalar(u);
      for (const j of [0, 1]) { const p = o.clone().add(off).addScaledVector(V, j ? h / 2 : -h / 2); pos.push(p.x, p.y, p.z); uv.push(lerp(r[0], r[2], t), j ? r[3] : r[1]); }
    }
    for (let i = 0; i < nu; i++) { const a = i * 2; idx.push(a, a + 2, a + 3, a, a + 3, a + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  // 同一種材質的零件併成一個 geometry（keep：'color' 或 'uv'）；暗角 ao(x,y,z) 乘在頂點色上
  function merge(list, keep, ao) {
    let nv = 0, ni = 0;
    for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const k = keep === 'uv' ? 2 : 3, P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), A = new Float32Array(nv * k), I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let ov = 0, oi = 0;
    for (const g of list) {
      const p = g.attributes.position, n = g.attributes.normal, a = g.attributes[keep], c = p.count;
      for (let i = 0; i < c; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), s = ao ? ao(x, y, z) : 1, o = (ov + i) * 3;
        P[o] = x; P[o + 1] = y; P[o + 2] = z; N[o] = n.getX(i); N[o + 1] = n.getY(i); N[o + 2] = n.getZ(i);
        if (k === 3) { A[o] = a.getX(i) * s; A[o + 1] = a.getY(i) * s; A[o + 2] = a.getZ(i) * s; } else { A[(ov + i) * 2] = a.getX(i); A[(ov + i) * 2 + 1] = a.getY(i); }
      }
      if (g.index) for (let j = 0; j < g.index.count; j++) I[oi + j] = g.index.getX(j) + ov; else for (let j = 0; j < c; j++) I[oi + j] = ov + j;
      ov += c; oi += g.index ? g.index.count : c; g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    out.setAttribute(keep, new THREE.BufferAttribute(A, k)); out.setIndex(new THREE.BufferAttribute(I, 1)); out.computeBoundingSphere();
    return out;
  }

  // ---- 儀表貼圖（1024×512 canvas，一台車一張）----
  const REG = { cl: [0, 0, 640, 256], st: [640, 0, 256, 256], vent: [896, 0, 128, 48], knob: [896, 48, 64, 64], spk: [960, 48, 64, 64], btn: [896, 112, 128, 48],
    mir: [896, 160, 128, 48], mfd: [0, 256, 256, 160], scr: [256, 256, 256, 160], spoke: [512, 256, 128, 64], dig: [640, 256, 256, 128] };
  const uvOf = (r) => [r[0] / 1024, 1 - (r[1] + r[3]) / 512, (r[0] + r[2]) / 1024, 1 - r[1] / 512];
  const clReg = (K) => [0, 0, 640, Math.min(256, Math.round((640 * K.h) / K.w))];
  // 指針式錶：a0～a1 是角度（0＝正上、順時針），數字從 min 到 max
  function dial(g, cx, cy, R, o) {
    const a0 = o.a0 ?? -135, a1 = o.a1 ?? 135, min = o.min ?? 0, max = o.max, face = o.face || '#0b0b0d', ink = o.ink || '#f2f2f2', red = '#e8201a';
    const ang = (v) => (a0 + ((a1 - a0) * (v - min)) / (max - min)) * D2R, P = (a, r) => [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
    g.save();
    const gr = g.createRadialGradient(cx, cy - R * 0.4, R * 0.1, cx, cy, R); gr.addColorStop(0, o.face2 || face); gr.addColorStop(1, face);
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R, 0, 2 * Math.PI); g.fill();
    g.lineWidth = R * 0.07; g.strokeStyle = o.ring || '#8a8e94'; g.beginPath(); g.arc(cx, cy, R * 0.965, 0, 2 * Math.PI); g.stroke();
    if (o.red != null) { g.strokeStyle = red; g.lineWidth = R * 0.1; g.beginPath(); g.arc(cx, cy, R * 0.81, ang(o.red) - Math.PI / 2, ang(max) - Math.PI / 2); g.stroke(); }
    const n = Math.round((max - min) / o.step) * o.sub;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i <= n; i++) {
      const v = min + (i / o.sub) * o.step, a = ang(v), major = i % o.sub === 0, hot = o.red != null && v >= o.red - 1e-6;
      const [x0, y0] = P(a, R * (major ? 0.72 : 0.79)), [x1, y1] = P(a, R * 0.88);
      g.strokeStyle = hot ? red : ink; g.lineWidth = major ? R * 0.045 : R * 0.022; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      if (major && (i / o.sub) % (o.every || 1) === 0) {
        const [tx, ty] = P(a, R * 0.54); g.fillStyle = hot ? red : ink; g.font = `bold ${Math.round(R * (max >= 100 ? ((max - min) / o.step / (o.every || 1) > 8 ? 0.155 : 0.19) : 0.25))}px Arial, sans-serif`;
        g.fillText(String(Math.round(v * 10) / 10), tx, ty);
      }
    }
    if (o.label) { g.fillStyle = ink; g.globalAlpha = 0.8; g.font = `${Math.round(R * 0.12)}px Arial, sans-serif`; g.fillText(o.label, cx, cy + R * 0.42); g.globalAlpha = 1; }
    if (o.val != null) { // 不會動的指針直接畫
      const [tx, ty] = P(ang(o.val), R * 0.8); g.strokeStyle = o.needle || '#ff5a1a'; g.lineWidth = R * 0.045; g.beginPath(); g.moveTo(cx, cy); g.lineTo(tx, ty); g.stroke();
    }
    g.fillStyle = '#1a1a1c'; g.beginPath(); g.arc(cx, cy, R * 0.1, 0, 2 * Math.PI); g.fill();
    g.restore();
  }
  function small(g, cx, cy, R, o) { // 小錶（油量、水溫）：上面 90 度的弧
    const ink = o.ink || '#f2f2f2', a0 = -50 * D2R, a1 = 50 * D2R;
    g.save(); g.fillStyle = o.face || '#0b0b0d'; g.beginPath(); g.arc(cx, cy, R, 0, 2 * Math.PI); g.fill();
    g.lineWidth = R * 0.08; g.strokeStyle = '#6a6e74'; g.beginPath(); g.arc(cx, cy, R * 0.95, 0, 2 * Math.PI); g.stroke();
    g.strokeStyle = ink; g.lineWidth = R * 0.06; g.beginPath(); g.arc(cx, cy + R * 0.25, R * 0.72, a0 - Math.PI / 2, a1 - Math.PI / 2); g.stroke();
    for (let i = 0; i <= 4; i++) { const a = lerp(a0, a1, i / 4); g.beginPath(); g.moveTo(cx + Math.sin(a) * R * 0.6, cy + R * 0.25 - Math.cos(a) * R * 0.6); g.lineTo(cx + Math.sin(a) * R * 0.8, cy + R * 0.25 - Math.cos(a) * R * 0.8); g.stroke(); }
    g.fillStyle = ink; g.font = `bold ${Math.round(R * 0.36)}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(o.lo, cx - R * 0.62, cy + R * 0.55); g.fillText(o.hi, cx + R * 0.62, cy + R * 0.55);
    const a = lerp(a0, a1, o.val); g.strokeStyle = '#ff5a1a'; g.lineWidth = R * 0.08; g.beginPath(); g.moveTo(cx, cy + R * 0.25); g.lineTo(cx + Math.sin(a) * R * 0.78, cy + R * 0.25 - Math.cos(a) * R * 0.78); g.stroke();
    g.restore();
  }
  function vents(g, x, y, w, h, n = 5) { // 出風口：黑框＋橫葉片
    g.fillStyle = '#060607'; g.beginPath(); g.roundRect(x, y, w, h, h * 0.18); g.fill();
    g.fillStyle = '#2a2c30'; for (let i = 1; i < n; i++) g.fillRect(x + w * 0.05, y + (h * i) / n - h * 0.05, w * 0.9, h * 0.1);
    g.strokeStyle = '#4a4d52'; g.lineWidth = Math.max(1, h * 0.05); g.beginPath(); g.roundRect(x, y, w, h, h * 0.18); g.stroke();
  }
  function knob(g, x, y, r, ring = '#8a8e94') {
    const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r); gr.addColorStop(0, '#4a4c50'); gr.addColorStop(1, '#141416');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fill(); g.strokeStyle = ring; g.lineWidth = r * 0.12; g.stroke();
    g.fillStyle = '#e8e8e8'; g.fillRect(x - r * 0.06, y - r * 0.85, r * 0.12, r * 0.4);
  }
  function buttons(g, x, y, w, h, n, col = '#26282c', led = '#ff8a2a') {
    for (let i = 0; i < n; i++) { const bx = x + (w * i) / n + 2; g.fillStyle = col; g.beginPath(); g.roundRect(bx, y, w / n - 4, h, 3); g.fill(); g.fillStyle = led; g.fillRect(bx + (w / n - 4) / 2 - 3, y + 3, 6, 2); }
  }
  // 數位儀表：中間圓形轉速表（指針另外做），兩邊資訊；時速數字在 dig 那塊另外一張小貼圖
  function digital(g, x, y, w, h, key) {
    const bg = g.createLinearGradient(0, y, 0, y + h); bg.addColorStop(0, '#07090d'); bg.addColorStop(1, '#101521');
    g.fillStyle = bg; g.fillRect(x, y, w, h);
    const cx = x + w / 2, cy = y + h * 0.52, R = h * 0.46, acc = key === 'p918' ? '#b9f02a' : key === 'jesko' ? '#ff3a2a' : '#ffcf2a';
    const a0 = -130 * D2R, a1 = 130 * D2R, max = key === 'p918' ? 9 : key === 'jesko' ? 9 : 10, red = key === 'p918' ? 8.5 : key === 'jesko' ? 8.5 : 9;
    g.fillStyle = '#05070a'; g.beginPath(); g.arc(cx, cy, R, 0, 2 * Math.PI); g.fill();
    g.lineWidth = R * 0.07; g.strokeStyle = '#3a4150'; g.beginPath(); g.arc(cx, cy, R * 0.97, 0, 2 * Math.PI); g.stroke();
    g.lineWidth = R * 0.08; g.strokeStyle = acc; g.globalAlpha = 0.35; g.beginPath(); g.arc(cx, cy, R * 0.86, a0 - Math.PI / 2, a1 - Math.PI / 2); g.stroke(); g.globalAlpha = 1;
    g.strokeStyle = '#ff2a1a'; g.beginPath(); g.arc(cx, cy, R * 0.86, lerp(a0, a1, red / max) - Math.PI / 2, a1 - Math.PI / 2); g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#e8eef8'; g.font = `bold ${Math.round(R * 0.17)}px Arial, sans-serif`;
    for (let i = 0; i <= max; i++) { const a = lerp(a0, a1, i / max); g.fillStyle = i >= red ? '#ff4a3a' : '#e8eef8'; g.fillText(String(i), cx + Math.sin(a) * R * 0.64, cy - Math.cos(a) * R * 0.64); }
    // 兩邊：左邊檔位＋條、右邊地圖或能量
    g.fillStyle = '#e8eef8'; g.font = `bold ${Math.round(h * 0.28)}px Arial, sans-serif`; g.fillText('D', x + w * 0.16, y + h * 0.42);
    g.font = `${Math.round(h * 0.09)}px Arial, sans-serif`; g.fillStyle = acc; g.fillText(key === 'p918' ? 'E-POWER' : 'RACE', x + w * 0.16, y + h * 0.72);
    for (let i = 0; i < 6; i++) { g.fillStyle = i < 4 ? acc : '#2a3140'; g.fillRect(x + w * 0.8 - w * 0.07 + i * w * 0.025, y + h * 0.66 - i * h * 0.05, w * 0.018, h * 0.08 + i * h * 0.05); }
    g.strokeStyle = '#4a6a9a'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + w * 0.74, y + h * 0.3); g.bezierCurveTo(x + w * 0.8, y + h * 0.2, x + w * 0.86, y + h * 0.42, x + w * 0.93, y + h * 0.26); g.stroke();
    return { cx, cy, R, a0: -130, a1: 130, max, red };
  }
  function makeAtlas(key, st) {
    if (typeof document === 'undefined') return null;
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512;
    const g = cv.getContext('2d'), K = st.cl, c = st.c;
    g.fillStyle = '#121214'; g.fillRect(0, 0, 1024, 512);
    // 儀表
    const [rx, ry, rw, rh] = clReg(K), k = rw / K.w, PX = (u, v) => [rx + (u + K.w / 2) * k, ry + (K.h / 2 - v) * k];
    if (K.type === 'analog') {
      g.fillStyle = '#050506'; g.fillRect(rx, ry, rw, rh);
      for (const d of K.dials) {
        const [x, y] = PX(d.u, d.v);
        if (d.k === 'small') small(g, x, y, d.r * k, { ...d, face: K.face, ink: K.ink });
        else if (d.k === 'tft') { g.fillStyle = '#0a1018'; g.beginPath(); g.roundRect(x - (d.w * k) / 2, y - (d.h * k) / 2, d.w * k, d.h * k, 6); g.fill(); g.fillStyle = '#e8eef8'; g.font = `bold ${Math.round(d.h * k * 0.22)}px Arial`; g.textAlign = 'center'; g.fillText('4WD', x, y - d.h * k * 0.12); g.fillStyle = '#ff3a2a'; g.fillRect(x - d.w * k * 0.35, y + d.h * k * 0.12, d.w * k * 0.35, d.h * k * 0.08); g.fillStyle = '#3a8aff'; g.fillRect(x, y + d.h * k * 0.12, d.w * k * 0.35, d.h * k * 0.08); }
        else dial(g, x, y, d.r * k, { face: K.face, ink: K.ink, ...d });
      }
    } else st._dg = digital(g, rx, ry, rw, rh, key);
    // 中控面板
    const [sx, sy, sw, sh] = REG.st, kind = st.stack.kind;
    g.fillStyle = kind === 'glass' || kind === 'tablet' ? '#07080a' : '#18191c'; g.fillRect(sx, sy, sw, sh);
    if (kind === 'radio' || kind === 'knobs') {
      vents(g, sx + 14, sy + 10, 104, 58); vents(g, sx + 138, sy + 10, 104, 58);
      g.fillStyle = '#0c0d0f'; g.fillRect(sx + 14, sy + 84, 228, 70); g.fillStyle = '#ff9a3a'; g.fillRect(sx + 70, sy + 96, 116, 20); g.fillStyle = '#2a1206'; g.font = 'bold 16px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('88.5 FM', sx + 128, sy + 107);
      buttons(g, sx + 20, sy + 126, 216, 20, 6);
      if (kind === 'knobs') { knob(g, sx + 50, sy + 205, 30); knob(g, sx + 128, sy + 205, 30); knob(g, sx + 206, sy + 205, 30); }
      else { g.fillStyle = '#0c0d0f'; g.fillRect(sx + 14, sy + 170, 228, 76); g.fillStyle = '#3ad0ff'; g.font = 'bold 22px Arial'; g.fillText('AUTO  22.0', sx + 128, sy + 192); buttons(g, sx + 20, sy + 218, 216, 22, 5, '#26282c', '#3ad0ff'); }
    } else if (kind === 'ferrari') {
      vents(g, sx + 14, sy + 14, 228, 44, 4); g.fillStyle = '#0c0d0f'; g.fillRect(sx + 14, sy + 76, 228, 160);
      buttons(g, sx + 26, sy + 96, 204, 34, 4, '#2a2c30', '#ffcf2a'); buttons(g, sx + 26, sy + 150, 204, 34, 3, '#2a2c30', '#ff3a2a'); knob(g, sx + 128, sy + 212, 18);
    } else if (kind === 'tablet') {
      g.fillStyle = '#0d1420'; g.fillRect(sx + 26, sy + 16, 204, 150);
      g.strokeStyle = '#3a6ab0'; g.lineWidth = 3; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(sx + 30, sy + 40 + i * 28); g.bezierCurveTo(sx + 90, sy + 20 + i * 30, sx + 150, sy + 70 + i * 20, sx + 226, sy + 36 + i * 26); g.stroke(); }
      g.fillStyle = '#ff3a2a'; g.beginPath(); g.arc(sx + 128, sy + 90, 7, 0, 2 * Math.PI); g.fill();
      buttons(g, sx + 26, sy + 190, 204, 40, 4, '#1c1e22', '#ff3a2a');
    } else if (kind === 'glass') {
      g.fillStyle = '#05060a'; g.fillRect(sx, sy, sw, sh);
      g.strokeStyle = '#3a3d44'; g.lineWidth = 2; for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { g.beginPath(); g.roundRect(sx + 22 + j * 74, sy + 110 + i * 34, 64, 26, 4); g.stroke(); }
      g.fillStyle = '#0d1420'; g.fillRect(sx + 22, sy + 14, 212, 84); g.fillStyle = '#9bd400'; g.fillRect(sx + 32, sy + 76, 120, 6);
      g.fillStyle = '#c8d4e8'; g.font = 'bold 20px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('E  H  S  R', sx + 128, sy + 44);
    }
    // 出風口（兩邊）、排檔頭、喇叭、按鍵
    vents(g, REG.vent[0] + 4, REG.vent[1] + 4, REG.vent[2] - 8, REG.vent[3] - 8, 4);
    { const [x, y, w] = REG.knob, cx = x + w / 2, cy = y + w / 2; g.fillStyle = st.c.knob === st.c.metal ? '#b8bcc2' : '#1c1c1e'; g.fillRect(x, y, w, w);
      g.strokeStyle = st.c.knob === st.c.metal ? '#202124' : '#e8e8e8'; g.lineWidth = 2.5; const d = 12;
      g.beginPath(); for (const i of [-1, 0, 1]) { g.moveTo(cx + i * d, cy - 14); g.lineTo(cx + i * d, cy + 14); } g.moveTo(cx - d, cy); g.lineTo(cx + d * (st.shift === 'manual' ? 1.8 : 1), cy); g.stroke(); }
    { const [x, y, w] = REG.spk; g.fillStyle = '#0c0c0e'; g.beginPath(); g.arc(x + w / 2, y + w / 2, w / 2 - 1, 0, 2 * Math.PI); g.fill(); g.fillStyle = '#2c2e32';
      for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) if (i * i + j * j < 11) { g.beginPath(); g.arc(x + w / 2 + i * 8, y + w / 2 + j * 8, 2.2, 0, 2 * Math.PI); g.fill(); } }
    { const [x, y, w, h] = REG.btn; g.fillStyle = '#141517'; g.fillRect(x, y, w, h); buttons(g, x + 4, y + 8, w - 8, h - 16, 4, '#2a2c30', '#7ad0ff'); }
    // R34 的多功能螢幕（MFD）、Yaris 的中控螢幕、Jesko 方向盤輻條上的小螢幕
    { const [x, y, w, h] = REG.mfd; g.fillStyle = '#04060c'; g.fillRect(x, y, w, h); g.textAlign = 'left'; g.textBaseline = 'middle';
      const rows = [['BOOST', 0.55, '#ffcf2a'], ['OIL', 0.62, '#5ad0ff'], ['WATER', 0.48, '#5ad0ff'], ['EXH', 0.4, '#ff6a3a']];
      rows.forEach(([n, v, c2], i) => { const yy = y + 22 + i * 36; g.fillStyle = '#9aa6c0'; g.font = 'bold 15px Arial'; g.fillText(n, x + 10, yy); g.fillStyle = '#1a2233'; g.fillRect(x + 80, yy - 8, 160, 16); g.fillStyle = c2; g.fillRect(x + 80, yy - 8, 160 * v, 16); }); }
    { const [x, y, w, h] = REG.scr; g.fillStyle = '#0c1422'; g.fillRect(x, y, w, h); g.strokeStyle = '#3a5a8a'; g.lineWidth = 3;
      for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(x, y + 20 + i * 26); g.bezierCurveTo(x + 80, y + i * 30, x + 160, y + 60 + i * 12, x + w, y + 30 + i * 22); g.stroke(); }
      g.fillStyle = '#ff3a2a'; g.beginPath(); g.moveTo(x + w / 2, y + h / 2 - 12); g.lineTo(x + w / 2 + 8, y + h / 2 + 8); g.lineTo(x + w / 2 - 8, y + h / 2 + 8); g.fill();
      g.fillStyle = '#1c2230'; g.fillRect(x, y + h - 26, w, 26); g.fillStyle = '#d8e0ee'; g.font = 'bold 15px Arial'; g.textAlign = 'center'; g.fillText('12:30   22°C', x + w / 2, y + h - 13); }
    { const [x, y, w, h] = REG.spoke; g.fillStyle = '#05070a'; g.fillRect(x, y, w, h); g.fillStyle = '#ff3a2a'; g.fillRect(x + 8, y + 10, w - 16, 6); g.fillStyle = '#c8d4e8'; g.font = 'bold 18px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TC 3', x + w / 2, y + 40); }
    { const [x, y, w, h] = REG.mir, gr = g.createLinearGradient(0, y, 0, y + h); // 後照鏡：上面車頂、中間後擋（亮）、下面椅背
      gr.addColorStop(0, '#2a2c31'); gr.addColorStop(0.2, '#9ea5ae'); gr.addColorStop(0.55, '#c4cad2'); gr.addColorStop(0.62, '#34373d'); gr.addColorStop(1, '#1c1d21');
      g.fillStyle = gr; g.fillRect(x, y, w, h); g.fillStyle = '#18191c';
      for (const cx of [x + w * 0.27, x + w * 0.73]) { g.beginPath(); g.roundRect(cx - 15, y + h * 0.4, 30, h * 0.7, 9); g.fill(); } }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  // 數位儀表的時速（小貼圖，時速變了才重畫）
  function makeDigits(bg) {
    if (typeof document === 'undefined') return null;
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
    const g = cv.getContext('2d'), t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    let last = null;
    t.userData.set = (kmh) => {
      const v = Math.max(0, Math.round(kmh)); if (v === last) return; last = v;
      g.fillStyle = bg; g.fillRect(0, 0, 128, 64); g.fillStyle = '#f2f6ff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 44px Arial, sans-serif'; g.fillText(String(v), 64, 26); g.font = '14px Arial, sans-serif'; g.fillStyle = '#9aa6c0'; g.fillText('km/h', 64, 55);
      t.needsUpdate = true;
    };
    t.userData.set(0);
    return t;
  }

  // ---- 組一台車的座艙 ----
  function build(key, spec = {}, mats = null) {
    const st = STYLE[key], F = fitOf(key);
    const cab = new THREE.Group(); cab.name = 'cabin';
    if (!st || !F) return cab;
    const C = st.c, sd = Math.sign(spec.interior?.wheelZ ?? (st.lhd ? -1 : 1)) || -1, zd = sd * st.zD;
    const [xE, yE] = st.eye, xH = xE + 0.16, yH = yE - 0.64, yF = Math.max(F.bot + (st.floor ?? 0.065), 0.2);
    const eye = V3(xE, yE, zd), xfw = Math.min((spec.wheels?.xf ?? 1.25) - 0.43, F.fa[0] - 0.04); // 腳踏板前面的防火牆
    const bag = { trim: [], gloss: [], metal: [], face: [] };
    const put = (m, g) => (bag[m].push(g), g);
    const D = st.dash, topS = (x, z) => { for (let q = Math.abs(z); q >= 0; q -= 0.1) { const t = F.top(x, q); if (t > 0.3) return t; } return 2; };
    // 儀表板：每個 z 一個斷面（前擋黑邊底下 → 上面 → 後緣圓角 → 面板 → 下緣 → 底下），兩端貼著車門
    const xr0 = (z) => D.xr - (D.wrap || 0) * (Math.abs(z) / 0.75) ** 2 - (D.bulge || 0) * Math.exp(-((z / 0.2) ** 2));
    // 儀表那一段的儀表板後緣往前退到儀表面（上緣）前面，不然往後包的儀表板會擋住儀表（Jesko 的儀表在轉向柱上，不用）
    const cw = st.cl.w / 2, xcl = xr0(zd) + 0.03;
    const xr = (z) => { const b = xr0(z); return st.cl.col ? b : Math.max(b, lerp(b, xcl, 1 - ss(cw + 0.03, cw + 0.09, Math.abs(z - zd)))); };
    const prof = (z) => {
      const xa = (F.ws(z) + F.wf(z)) / 2 + 0.01, ya = topS(xa, z) - 0.03, x0 = xr(z), yt = D.yt, yl = D.yl, xl = x0 + (D.slant ?? 0.05), p = [];
      for (let k = 0; k <= 5; k++) { const t = k / 5, x = lerp(xa, x0 + 0.03, t); p.push([x, Math.min(lerp(ya, yt, ss(0, 0.7, t)), topS(x, z) - 0.03)]); }
      p.push([x0 + 0.008, yt - 0.012], [x0, yt - 0.035], [lerp(x0, xl, 0.5), lerp(yt - 0.035, yl + 0.02, 0.5)], [xl, yl + 0.02], [xl + 0.025, yl], [xl + 0.2, yl + 0.02], [xa - 0.05, Math.max(yl + 0.05, ya - 0.13)]);
      return p;
    };
    const faceX = (z, y) => { const p = prof(z); for (let i = 7; i < 10; i++) { const a = p[i], b = p[i + 1]; if (y <= a[1] && y >= b[1]) return lerp(a[0], b[0], (a[1] - y) / (a[1] - b[1])); } return p[7][0]; };
    {
      const secs = [];
      for (let k = 0; k <= 30; k++) { const z = -Math.cos((k / 30) * Math.PI) * 0.95; secs.push(prof(z).map(([x, y]) => inside(F, [x, y, z], 0.015))); }
      put('trim', loft(secs, (j, i) => (i <= 5 ? C.top : i <= 9 ? C.dash : C.low)));
    }
    const ao = (x, y, z) => {
      let k = 0.45 + 0.55 * ss(yF, yF + 0.55, y);
      if (x > xr(z) + 0.04 && y < D.yt - 0.02) k *= 0.5 + 0.5 * ss(D.yl - 0.25, D.yt, y);
      return k;
    };

    // ---- 儀表：遮光罩（一個斷面沿著橫向拉）＋儀表面（貼圖）＋會動的指針 ----
    const K = st.cl, needles = [];
    {
      let Cg, W = null;
      if (K.col) { // Jesko：裝在轉向柱上、方向盤後面
        const Wc = st.wheel, c = Wc.col * D2R, N0 = V3(-Math.cos(c), Math.sin(c), 0), V0 = V3(Math.sin(c), Math.cos(c), 0);
        Cg = V3(xE + Wc.reach, yE - Wc.drop, zd).addScaledVector(V0, 0.07).addScaledVector(N0, -0.11); W = true;
      } else Cg = V3(xr0(zd) - 0.005, D.yt - K.h / 2 + 0.006, zd);
      const N = eye.clone().sub(Cg).normalize(), V = V3(0, 1, 0).addScaledVector(N, -N.y).normalize(), U = V.clone().cross(N);
      const P = (u, v, n) => Cg.clone().addScaledVector(U, u).addScaledVector(V, v).addScaledVector(N, n);
      const w2 = K.w / 2 + 0.022, h2 = K.h / 2, secs = [], back = W ? 0.05 : 0.14;
      for (let k = 0; k <= 12; k++) {
        const u = -w2 + (2 * w2 * k) / 12, e = 1 - Math.pow(Math.abs(u) / w2, 4) * 0.55, dep = K.depth * e, ri = K.rise * (0.6 + 0.4 * e);
        const pr = [[-back, -h2 - 0.03], [0.012, -h2 - 0.03], [0.012, -h2 - 0.008], [0, -h2], [0, h2], [dep * 0.85, h2 + 0.01], [dep, h2 + 0.02], [dep - 0.02, h2 + ri], [-back, h2 + ri + 0.012]];
        secs.push(pr.map(([n, v]) => P(u, v, n).toArray()));
      }
      put('trim', loft(secs, (j, i) => (i >= 5 ? C.top : i >= 3 && i <= 4 ? 0x060607 : C.dash)));
      const [rx, ry, rw, rh] = clReg(K), r = uvOf([rx, ry, rw, rh]);
      put('face', quadUV(P(0, 0, 0.002), U, V, K.w, K.h, r, K.bend || 0, N));
      const frame = (u, v, R) => ({ o: P(u, v, 0.005), U: U.clone().multiplyScalar(R), V: V.clone().multiplyScalar(R) });
      if (K.type === 'analog') { for (const d of K.dials) if (d.k === 'tach' || d.k === 'speed') needles.push({ ...frame(d.u, d.v, d.r * 0.86), k: d.k, a0: -135, a1: 135, max: d.max, red: d.red, w: 1 }); }
      else { // 數位：中間轉速表的指針（細一點）＋時速數字
        const R = K.h * 0.46, dg = { a0: -130, a1: 130, max: 10, red: 9 }; if (key === 'p918' || key === 'jesko') Object.assign(dg, { max: 9, red: 8.5 });
        needles.push({ ...frame(0, -K.h * 0.02, R * 0.78), k: 'tach', ...dg, w: 0.7 });
        cab.userData._dig = { o: P(0, -K.h * 0.18, 0.004), U, V, w: K.h * 0.34, h: K.h * 0.17 };
      }
    }

    // ---- 方向盤 ----
    {
      const Wc = st.wheel, c = Wc.col * D2R, N = V3(-Math.cos(c), Math.sin(c), 0), V = V3(Math.sin(c), Math.cos(c), 0), U = V3(0, 0, 1);
      const Cw = V3(xE + Wc.reach, yE - Wc.drop, zd), r = Wc.r, dish = 0.035;
      const P = (u, v, n = 0) => Cw.clone().addScaledVector(U, u).addScaledVector(V, v).addScaledVector(N, n);
      let ring = [];
      for (let k = 0; k < 96; k++) { const a = (k / 96) * 2 * Math.PI; ring.push([r * Math.sin(a), cl(r * Math.cos(a), -r * (Wc.fb ?? 2), r * (Wc.ft ?? 2)), a]); }
      for (let it = 0; it < 4; it++) ring = ring.map((p, i) => { const a = ring[(i + 95) % 96], b = ring[(i + 1) % 96]; return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4, p[2]]; });
      const rt = Wc.t ?? 0.0165, top = (a) => a < 60 * D2R || a > 300 * D2R;
      if (Wc.top) { // 上半圈碳纖維（亮面）
        const up = ring.filter((p) => top(p[2])), lo = ring.filter((p) => !top(p[2]));
        const upS = [...up.filter((p) => p[2] > Math.PI), ...up.filter((p) => p[2] < Math.PI)];
        put('gloss', tint(tube(upS.map(([u, v]) => P(u, v)), rt, 40, 8), C.rimTop));
        put('trim', tint(tube([upS[upS.length - 1], ...lo, upS[0]].map(([u, v]) => P(u, v)), rt, 64, 8), C.rim));
      } else put('trim', tint(tube(ring.map(([u, v]) => P(u, v)), rt, 96, 8, true), C.rim));
      if (C.marker) put('trim', tint(tube([-5, 0, 5].map((a) => P(r * Math.sin(a * D2R), r * Math.cos(a * D2R))), rt + 0.0012, 6, 8), C.marker));
      // 輻條：從中間往外、往前凹（dish）
      const sw = Wc.sw ?? 0.05;
      for (const a0 of Wc.spokes) {
        const a = a0 * D2R, d = V3().addScaledVector(U, Math.sin(a)).addScaledVector(V, Math.cos(a)), sideV = V3().addScaledVector(U, Math.cos(a)).addScaledVector(V, -Math.sin(a));
        const secs = [0.05, r * 0.72, r - 0.004].map((rr, i) => {
          const o = Cw.clone().addScaledVector(d, rr).addScaledVector(N, -dish * (1 - rr / r)), w = (i === 0 ? sw * 1.25 : sw) / 2, th = i === 2 ? 0.007 : 0.009;
          return [[-w, -th], [w, -th], [w, th], [-w, th]].map(([s, t]) => o.clone().addScaledVector(sideV, s).addScaledVector(N, t).toArray());
        });
        put(Wc.top ? 'gloss' : 'trim', loft(secs, C.spoke));
      }
      // 中間：安全氣囊（圓角方塊或圓）、轉向柱、柱套
      const hub = Wc.hub === 'round' ? cyl(0.048, 0.044, 0.03, 24).rotateX(Math.PI / 2) : rbox(0.15, 0.105, 0.045, 0.035, 4);
      put('trim', tint(hub.applyMatrix4(basis(P(0, -0.005, -dish), U, V, N)), C.hub));
      if (Wc.hub === 'round') put('gloss', tint(cyl(0.03, 0.03, 0.004, 20).rotateX(Math.PI / 2).applyMatrix4(basis(P(0, 0, -dish + 0.017), U, V, N)), 0x2e3034));
      put('trim', tint(cyl(0.032, 0.032, 0.34, 12).rotateX(Math.PI / 2).applyMatrix4(basis(P(0, 0, -dish - 0.2), U, V, N)), 0x0e0e10));
      put('trim', tint(rbox(0.11, 0.1, 0.2, 0.035).applyMatrix4(basis(P(0, -0.01, -dish - 0.16), U, V, N)), C.dash));
      if (Wc.paddles) for (const s of [-1, 1]) put('metal', tint(rbox(0.04, 0.12, 0.006, 0.015).applyMatrix4(basis(P(s * (r - 0.02), 0.01, -dish - 0.012), U, V, N)), C.metal));
      if (Wc.start) put('trim', tint(cyl(0.013, 0.013, 0.012, 16).rotateX(Math.PI / 2).applyMatrix4(basis(P(-0.075, -0.07, -dish + 0.018), U, V, N)), 0xd0141c));
      if (Wc.screens) for (const s of [-1, 1]) put('face', quadUV(P(s * 0.1, 0.005, -dish * 0.45 + 0.012), U, V, 0.06, 0.035, uvOf(REG.spoke)));
      // 指針（數位的轉速表也用），Jesko 的儀表跟著方向盤
    }

    // ---- 中控面板（出風口、音響、空調）＋中央扶手台 ----
    {
      const S = st.stack, x0 = xr(0) + 0.005, y0 = D.yt - 0.03, phi = sd * (S.turn || 0) * D2R, R = new THREE.Matrix4().makeRotationY(phi);
      const piv = V3(x0, 0, 0), rot = (p) => V3(...p).sub(piv).applyMatrix4(R).add(piv).toArray();
      const pr = [[x0, y0], [S.x1, S.y1], [S.x1 + 0.22, S.y1 - 0.02], [x0 + 0.22, y0 - 0.05]];
      put('trim', loft([-S.w / 2, S.w / 2].map((z) => pr.map(([x, y]) => rot([x, y, z]))), C.dash, { closed: true }));
      const top = V3(...rot([x0 - 0.002, y0, 0])), bot = V3(...rot([S.x1 - 0.002, S.y1, 0])), Vv = top.clone().sub(bot), hgt = Vv.length(); Vv.normalize();
      const Uu = V3(0, 0, 1).applyMatrix4(R), mid = top.clone().add(bot).multiplyScalar(0.5);
      put('face', quadUV(mid, Uu, Vv, S.w - 0.03, hgt - 0.02, uvOf(REG.st)));
      // 扶手台：從面板下面往後到扶手
      const xa = S.x1 + 0.12, xb = xH - 0.22, ya = S.y1, yb = yH + 0.11, wc = S.kind === 'glass' ? 0.2 : 0.24, secs = [];
      for (let k = 0; k <= 8; k++) {
        const t = k / 8, x = lerp(xa, xb, t), y = lerp(ya, yb, ss(0.1, 0.75, t)) - (S.kind === 'glass' ? 0 : 0.03 * Math.sin(t * Math.PI));
        secs.push([[-wc / 2, yF + 0.02], [wc / 2, yF + 0.02], [wc / 2, y - 0.02], [wc / 2 - 0.02, y], [-wc / 2 + 0.02, y], [-wc / 2, y - 0.02]].map(([z, yy]) => [x, yy, z]));
      }
      put('trim', loft(secs, (j, i) => (i >= 3 && i <= 4 ? (j >= 6 ? C.sb : C.acc) : C.dash)));
      cab.userData._con = { y: (x) => lerp(ya, yb, ss(0.1, 0.75, (x - xa) / (xb - xa))) - (S.kind === 'glass' ? 0 : 0.03 * Math.sin(((x - xa) / (xb - xa)) * Math.PI)), xa, xb };
    }
    // ---- 排檔、手煞車 ----
    {
      const con = cab.userData._con, xs = xH + 0.32, ys = con.y(xs), zs = sd * 0.02;
      if (st.shift === 'manual') {
        put('metal', tint(cyl(0.05, 0.05, 0.008, 24).translate(0, 0.004, 0).translate(xs, ys, zs), C.metal));
        put('trim', tint(cyl(0.045, 0.016, 0.07, 16).translate(xs, ys + 0.04, zs), 0x111113));
        put('metal', tint(cyl(0.008, 0.008, 0.07, 8).translate(xs - 0.008, ys + 0.1, zs), 0x2a2b2e));
        const kn = new THREE.SphereGeometry(0.028, 18, 12); kn.deleteAttribute('uv'); kn.scale(1, 0.8, 1).translate(xs - 0.012, ys + 0.155, zs);
        put(C.knob === C.metal ? 'metal' : 'trim', tint(kn, C.knob));
        put('face', quadUV(V3(xs - 0.012, ys + 0.1785, zs), V3(0, 0, 1), V3(1, 0, 0), 0.022, 0.022, uvOf(REG.knob)));
      } else if (st.shift === 'bridge') { // SP3：金屬拱橋，上面三顆鍵
        for (const s of [-1, 1]) put('metal', tint(new THREE.BoxGeometry(0.02, 0.05, 0.02).translate(xs + s * 0.07, ys + 0.025, zs), C.metal));
        put('metal', tint(rbox(0.19, 0.11, 0.012, 0.03).rotateX(Math.PI / 2).translate(xs, ys + 0.055, zs), C.metal));
        for (const [i, col] of [[-1, 0xd0141c], [0, 0x2a2b2e], [1, 0x2a2b2e]]) put('trim', tint(cyl(0.014, 0.014, 0.012, 16).translate(xs + i * 0.05, ys + 0.066, zs), col));
      } else { // 按鍵＋小撥桿
        put('trim', tint(rbox(0.13, 0.09, 0.012, 0.015).rotateX(Math.PI / 2).translate(xs, ys + 0.005, zs), 0x0e0f11));
        put('face', quadUV(V3(xs, ys + 0.012, zs), V3(0, 0, 1), V3(1, 0, 0), 0.12, 0.045, uvOf(REG.btn)));
        put('metal', tint(new THREE.BoxGeometry(0.016, 0.05, 0.012).translate(xs - 0.07, ys + 0.03, zs), C.metal));
        put('metal', tint(rbox(0.045, 0.022, 0.03, 0.01).translate(xs - 0.07, ys + 0.06, zs), C.metal));
      }
      if (st.hand) { // 手煞車拉桿（往後翹）
        const xp = xH + 0.2, yp = con.y(xp) + 0.012, a = 14 * D2R, L = 0.24, z = -sd * 0.035, d = V3(-Math.cos(a), Math.sin(a), 0), o = V3(xp, yp, z);
        put('trim', tint(new THREE.BoxGeometry(0.07, 0.02, 0.05).translate(xp, yp - 0.005, z), 0x111113));
        const lev = rbox(0.03, 0.028, L, 0.012).applyMatrix4(basis(o.clone().addScaledVector(d, L / 2), V3(0, 0, 1), V3(Math.sin(a), Math.cos(a), 0), d.clone().negate()));
        put('trim', tint(lev, 0x1a1a1c));
        put('metal', tint(cyl(0.008, 0.008, 0.02, 10).rotateZ(Math.PI / 2 - a).translate(...o.clone().addScaledVector(d, L + 0.006).toArray()), C.metal));
      }
    }

    // ---- 踏板（掛在儀表板下面，油門在最右邊）----
    const bar = (m, a, b, t, col) => { // 兩點之間的方棒
      const d = b.clone().sub(a), L = d.length(); d.normalize();
      const n = (Math.abs(d.z) > 0.9 ? V3(1, 0, 0) : V3(0, 0, 1)).cross(d).normalize(), e = d.clone().cross(n);
      put(m, tint(new THREE.BoxGeometry(t, L, t).applyMatrix4(basis(a.clone().add(b).multiplyScalar(0.5), e, d, n)), col));
    };
    {
      const xp = xfw - 0.1, list = st.pedals === 3 ? [[-0.13, 0.07, 0.09], [-0.02, 0.07, 0.09], [0.1, 0.05, 0.14]] : [[-0.03, 0.1, 0.075], [0.1, 0.05, 0.14]];
      for (const [dz, w, h] of list) {
        const z = zd + dz, thr = dz > 0.05, th = (thr ? 35 : 22) * D2R, o = V3(xp + (thr ? 0.05 : 0), yF + (thr ? 0.13 : 0.2), z);
        const Vp = V3(Math.sin(th), Math.cos(th), 0), Np = V3(-Math.cos(th), Math.sin(th), 0);
        put('metal', tint(rbox(w, h, 0.012, 0.012).applyMatrix4(basis(o, V3(0, 0, 1), Vp, Np)), C.metal));
        bar('trim', o.clone().addScaledVector(Vp, h * 0.3).addScaledVector(Np, -0.012), V3(xp + 0.16, D.yl - 0.05, z), 0.014, 0x2a2b2e);
      }
    }

    // ---- 地板、中央通道、腳踏區的斜板 ----
    const xRear = st.rear === 'bench' ? st.bench.x - 0.3 : st.bulk;
    {
      const secs = [], xs = [];
      for (let k = 0; k <= 8; k++) xs.push(lerp(xRear - 0.02, xfw, k / 8));
      if (F.ra[0] > xRear) xs.push(F.ra[0] - 0.012, F.ra[0] + 0.012);
      const fw = (x) => Math.min(F.side(x - 0.1, yF), F.side(x, yF), F.side(x + 0.1, yF)) - 0.03; // 前後 10 公分內最窄的（車身下面有凹槽的車）
      xs.sort((a, b) => a - b).forEach((x) => secs.push([-0.95, -0.6, -0.3, 0, 0.3, 0.6, 0.95].map((z) => [x, yF, Math.sign(z) * Math.min(Math.abs(z), fw(x))])));
      put('trim', loft(secs, C.carpet, { closed: false, caps: false }));
      const toe = [0, 0.5, 1].map((t) => { const x = lerp(xfw, xfw + 0.2, t), y = lerp(yF, D.yl - 0.02, t); return [-0.95, -0.6, -0.3, 0, 0.3, 0.6, 0.95].map((z) => [x, y, z]); });
      const tw = Math.min(...toe.map((r) => Math.abs(insideSec(F, r, 0.03)[0][2]) / 0.95));
      put('trim', loft(toe.map((r) => r.map(([x, y, z]) => [x, y, z * tw])), C.carpet, { closed: false, caps: false }));
      const tun = [];
      for (let k = 0; k <= 6; k++) { const x = lerp(xRear, xfw + 0.05, k / 6), h = lerp(0.1, 0.2, ss(0.4, 1, k / 6)); tun.push([[-0.17, 0], [-0.13, h], [0.13, h], [0.17, 0]].map(([z, y]) => [x, yF + y, z])); }
      put('trim', loft(tun, C.carpet, { closed: false, caps: false }));
    }

    // ---- 門板：貼著車門內側，從地板到側窗下緣；扶手、門把、喇叭 ----
    {
      const x0 = xr(0.8) + 0.06, x1 = xRear + 0.02, yAr = yH + 0.19;
      for (const s of [-1, 1]) {
        const secs = [], xs = [];
        for (let i = 0; i < 18; i++) xs.push(lerp(x0, x1, i / 17));
        if (F.ra[0] > x1 && F.ra[0] < x0) xs.push(F.ra[0] + 0.012, F.ra[0] - 0.012);
        xs.sort((a, b) => b - a).forEach((x) => {
          const yb = F.belt(x) - 0.012, y0 = x < F.ra[0] ? Math.min(F.ra[1] + 0.03, yb - 0.1) : yF - 0.005;
          const ys = [y0, yF + 0.14, yF + 0.14, yAr - 0.12, yAr - 0.12, yAr + 0.1, yAr + 0.1, yb - 0.06, yb - 0.06, yb].map((y) => Math.min(Math.max(y, y0), yb));
          secs.push(ys.map((y) => [x, y, s * (F.side(x, y) - 0.016 - 0.02 * ss(yb - 0.08, yb, y) - 0.014 * (1 - ss(yF, yF + 0.06, y)))])); // 上緣（窗台）往內收一點、下緣（門檻）也是
        });
        const bands = [C.low, C.low, C.door, C.door, C.doorIn, C.doorIn, C.door, C.door, C.top, C.top];
        put('trim', loft(secs, (j, i) => bands[i], { closed: false, caps: false }));
        // 扶手
        const xa0 = Math.min(x0 - 0.02, xH + 0.42), xa1 = xH - 0.08, arm = [];
        for (let k = 0; k <= 6; k++) {
          const x = lerp(xa0, xa1, k / 6), w = F.side(x, yAr) - 0.016, e = k === 0 || k === 6 ? 0.6 : 1;
          arm.push([[0, -0.03], [0.06 * e, -0.02], [0.065 * e, 0.012], [0.05 * e, 0.025], [0, 0.028]].map(([q, y]) => [x, yAr + y, s * (w - q)]));
        }
        put('trim', loft(arm, (j, i) => (i >= 2 ? C.sb : C.door)));
        // 開門把手（金屬）＋凹槽、喇叭
        const xh = Math.min(x0 - 0.04, xH + 0.5), yh = Math.min(yAr + 0.11, F.belt(xh) - 0.05), wh = F.side(xh, yh) - 0.016;
        put('trim', tint(rbox(0.12, 0.04, 0.008, 0.015).translate(xh, yh, s * (wh - 0.004)), 0x0a0a0b));
        put('metal', tint(rbox(0.1, 0.018, 0.01, 0.008).translate(xh - 0.005, yh, s * (wh - 0.013)), C.metal));
        const xk = Math.min(x0 - 0.06, xH + 0.44), ysp = yF + 0.17, wsp = F.side(xk, ysp) - 0.018;
        put('face', quadUV(V3(xk, ysp, s * wsp), V3(1, 0, 0), V3(0, 1, 0), 0.13, 0.13, uvOf(REG.spk)));
      }
    }

    // ---- 座椅（桶椅）----
    {
      // 斷面一圈：q 橫向、h 往乘客那面（坐墊往上、椅背往前），i 中間、p 車縫線、b 包覆、s 背殼
      const uProf = (W, wi, hb, T) => {
        const W2 = W / 2, w2 = wi / 2, bw = Math.max(0.02, W2 - w2), R = [[w2 * 0.5, 0.004, 'i']];
        if (C.sp) R.push([w2 - 0.006, 0.011, 'i'], [w2 - 0.004, 0.012, 'p'], [w2 + 0.004, 0.015, 'p'], [w2 + 0.006, 0.016, 'b']); else R.push([w2, 0.012, 'i'], [w2 + 0.001, 0.013, 'b']);
        R.push([w2 + bw * 0.4, hb * 0.72, 'b'], [w2 + bw * 0.8, hb, 'b'], [W2, hb * 0.8, 'b'], [W2 + 0.004, hb * 0.3 - T * 0.3, 's'], [W2 - 0.004, -T + 0.015, 's'], [W2 - 0.03, -T, 's']);
        const L = R.map(([q, h, c]) => [-q, h, c]).reverse();
        return [[0, 0, 'i'], ...R, [0, -T - 0.002, 's'], ...L];
      };
      const colOf = { i: C.si, p: C.sp ?? C.si, b: C.sb, s: C.ss };
      const seatAt = (zs) => {
        const beta = (st.seat?.recline ?? 21) * D2R, cush = [], bk = [];
        const xs = [0.4, 0.392, 0.37, 0.3, 0.18, 0.06, -0.06, -0.14], pc = uProf(0.52, 0.3, 0.07, 0.09);
        xs.forEach((x, j) => { // 前緣兩圈縮小、往下捲
          const t = (x + 0.14) / 0.54, yc = -0.1 + 0.065 * t, hb = 0.05 + 0.03 * Math.sin(t * Math.PI), pr = uProf(0.52, 0.3, hb, 0.09);
          const sq = j === 0 ? 0.82 : j === 1 ? 0.95 : 1, sh = j === 0 ? 0.35 : j === 1 ? 0.8 : 1;
          cush.push(pr.map(([q, h]) => [xH + x, yH + yc - 0.05 + (h + 0.05) * sh, zs + q * sq]));
        });
        const by = yH - 0.09, dx = -Math.sin(beta), dy = Math.cos(beta), nx = Math.cos(beta), ny = Math.sin(beta);
        let Lb = st.seat?.back ?? 0.8; // 頭枕頂（兩側）要在車頂下面 3 公分
        while (Lb > 0.66 && [-0.15, 0.15].some((q) => by + dy * Lb + 0.02 > F.top(xH - 0.13 + dx * Lb, zs + q) - 0.03)) Lb -= 0.01;
        const sv = [0, 0.06, 0.16, 0.28, 0.4, 0.49, 0.55, 0.59, 0.64, 0.7, 0.75, 0.785, 0.8].map((v) => (v * Lb) / 0.8);
        const Wf = (s) => (s < 0.3 ? 0.5 : s < 0.5 ? lerp(0.5, 0.56, (s - 0.3) / 0.2) : s < 0.59 ? lerp(0.56, 0.36, (s - 0.5) / 0.09) : s < 0.64 ? lerp(0.36, 0.3, (s - 0.59) / 0.05) : 0.3);
        const Hb = (s) => (s < 0.15 ? 0.08 : s < 0.45 ? lerp(0.08, 0.13, (s - 0.15) / 0.3) : s < 0.6 ? lerp(0.13, 0.03, (s - 0.45) / 0.15) : 0.025);
        for (const s of sv) {
          const r = (s * 0.8) / Lb, top = r >= 0.785 ? (r >= 0.799 ? 0.4 : 0.85) : 1, pr = uProf(Wf(r) * (r >= 0.799 ? 0.85 : 1), r > 0.6 ? 0.2 : 0.28, Hb(r) * top, 0.065 * (r >= 0.799 ? 0.6 : 1));
          bk.push(pr.map(([q, h]) => [xH - 0.13 + dx * s + nx * h, by + dy * s + ny * h, zs + q]));
        }
        put('trim', loft(cush, (j, i) => colOf[pc[i][2]]));
        const pb = uProf(0.5, 0.28, 0.08, 0.065);
        put('trim', loft(bk, (j, i) => colOf[pb[i][2]]));
        // 安全帶孔（肩膀兩個、坐墊前面一個）
        for (const q of [-0.075, 0.075]) { const s = (0.635 * Lb) / 0.8, o = V3(xH - 0.13 + dx * s + nx * 0.011, by + dy * s + ny * 0.011, zs + q); put('trim', tint(rbox(0.026, 0.07, 0.006, 0.012).applyMatrix4(basis(o, V3(0, 0, 1), V3(dx, dy, 0), V3(nx, ny, 0))), 0x050506)); }
        put('trim', tint(rbox(0.05, 0.028, 0.006, 0.012).rotateX(-Math.PI / 2).translate(xH + 0.3, yH - 0.1 + 0.065 * 0.8 + 0.006, zs), 0x050506));
        // 椅座底下的滑軌
        const hb0 = yH - 0.1 - 0.09 - yF;
        if (hb0 > 0.02) put('trim', tint(new THREE.BoxGeometry(0.44, hb0, 0.38).translate(xH + 0.1, yF + hb0 / 2, zs), 0x1a1b1d));
      };
      seatAt(zd); seatAt(-zd);
    }

    // ---- 後座＋置物板／隔板 ----
    {
      if (st.rear === 'bench') {
        const bx = st.bench.x, yc = yF + 0.24, yb = yF, zs = [], zc = 0.95;
        for (let k = 0; k <= 16; k++) zs.push(-zc + (2 * zc * k) / 16);
        const cushion = zs.map((z) => { const q = Math.abs(z), dip = 0.02 * Math.exp(-(((q - 0.3) / 0.12) ** 2)); return insideSec(F, [[bx + 0.25, yb], [bx + 0.27, yc - 0.04], [bx + 0.2, yc - dip], [bx - 0.1, yc - 0.02 - dip], [bx - 0.22, yc - 0.05], [bx - 0.22, yb]].map(([x, y]) => [x, y, z]), 0.03); });
        put('trim', loft(cushion, (j, i) => (Math.abs(zs[j]) > 0.12 && Math.abs(zs[j]) < 0.5 && i >= 1 && i <= 3 ? C.si : C.sb), { closed: true }));
        const a = 24 * D2R, L = st.bench.L ?? 0.62, x0 = bx - 0.24, y0 = yc - 0.06, dx = -Math.sin(a), dy = Math.cos(a);
        const back = zs.map((z) => insideSec(F, [[0, 0.02], [0.03, 0.03], [L * 0.6, 0.05], [L, 0.03], [L + 0.02, -0.02], [L, -0.1], [0, -0.1]].map(([s, h]) => [x0 + dx * s + dy * h, y0 + dy * s - dx * h, z]), 0.03));
        put('trim', loft(back, (j, i) => (Math.abs(zs[j]) > 0.12 && Math.abs(zs[j]) < 0.5 && i >= 1 && i <= 2 ? C.si : C.sb), { closed: true }));
        const xt = x0 + dx * L - 0.03, ys = y0 + dy * L - 0.01, xg = F.rg(0) + 0.03, shelf = [];
        for (let k = 0; k <= 4; k++) { const x = lerp(xt, xg, k / 4), y = Math.min(ys, F.top(x, 0) - 0.03); shelf.push([-0.95, -0.5, 0, 0.5, 0.95].map((z) => inside(F, [x, y, z], 0.04))); }
        put('trim', loft(shelf, C.top, { closed: false, caps: false }));
      } else if (st.rear === 'shelf') { // Supra：後座拿掉，鋪地毯的隔板＋後擋下面的置物板
        const xb = st.bulk, yt2 = Math.min(0.95, F.top(xb, 0.5) - 0.05), wall = [];
        for (const y of [yF, lerp(yF, yt2, 0.5), yt2]) wall.push([-0.95, -0.5, 0, 0.5, 0.95].map((z) => inside(F, [xb, y, z], 0.02)));
        put('trim', loft(wall, C.carpet, { closed: false, caps: false }));
        const xg = F.rg(0) + 0.03, shelf = [];
        for (let k = 0; k <= 4; k++) { const x = lerp(xb, xg, k / 4), y = Math.min(yt2, F.top(x, 0) - 0.03); shelf.push([-0.95, -0.5, 0, 0.5, 0.95].map((z) => inside(F, [x, y, z], 0.02))); }
        put('trim', loft(shelf, C.top, { closed: false, caps: false }));
      } else { // 中置引擎：座椅後面一片隔板，上緣照車頂
        const xb = st.bulk, secs = [];
        const zs = [-0.95, -0.8, -0.7, -0.6, -0.5, -0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.95];
        for (let k = 0; k <= 6; k++) { const t = k / 6, y = lerp(yF, 1.5, t); secs.push(zs.map((z) => inside(F, [xb, Math.min(y, F.top(xb, z) - 0.03, F.top(xb + 0.05, z) - 0.03), z], 0.05))); }
        put('trim', loft(secs, (j) => (j >= 3 ? C.dash : C.carpet), { closed: false, caps: false }));
      }
    }

    // ---- 車頂內襯（灰色的車才做）、車內後照鏡、遮陽板 ----
    {
      // zEdge(x)：車頂往兩邊到哪裡還高過側窗上緣（再外面就是側窗）
      const zEdge = (x) => { const yS = F.st(x) + 0.02; let z = 0; while (z < 0.9 && F.roof(x, z + 0.01) > yS) z += 0.01; return z; };
      if (C.roof) { // 內襯：前擋上緣到後擋上緣（轉角圓的地方不跟過去）、兩邊到側窗上緣，貼著車頂下面 1.2 公分；朝下的面環境光照不到，顏色加亮（假的車內反光）
        const xF = (z) => Math.min(F.wt(z), F.wt(0) + 0.02) - 0.006, xR = (z) => Math.max(F.rt(z), F.rt(0) - 0.02) + 0.012, secs = [];
        for (let j = 0; j <= 10; j++) {
          const u = j / 10, row = [], e0 = zEdge(lerp(xR(0), xF(0), u));
          for (let i = 0; i <= 14; i++) {
            const v = -1 + (2 * i) / 14; let z = v * e0, x = lerp(xR(z), xF(z), u);
            z = v * Math.min(e0, zEdge(x)) * 0.98; x = cl(x, xR(z), xF(z));
            row.push([x, F.roof(x, z) - 0.012, z]);
          }
          secs.push(row);
        }
        put('trim', lift(loft(secs, C.roof, { closed: false, caps: false }), 2.2));
        // 前面中間的閱讀燈
        const xl = F.wt(0) - 0.14; put('trim', tint(rbox(0.16, 0.07, 0.016, 0.02).rotateX(Math.PI / 2).rotateY(Math.PI / 2).translate(xl, Math.min(F.roof(xl - 0.04, 0), F.roof(xl + 0.04, 0)) - 0.03, 0), C.hl));
      }
      // 車內後照鏡：掛在前擋上緣前面一點（玻璃上），支架往上往後接到車頂；稍微轉向駕駛
      const xm = F.wt(0) + 0.02, ym = F.roof(xm + 0.016, 0) - 0.075, R = new THREE.Matrix4().makeRotationY(-sd * 8 * D2R);
      put('gloss', tint(rbox(0.24, 0.065, 0.032, 0.03).rotateY(Math.PI / 2).applyMatrix4(R).translate(xm, ym, 0), 0x0c0c0e));
      put('face', quadUV(V3(-0.0165, 0, 0).applyMatrix4(R).add(V3(xm, ym, 0)), V3(0, 0, 1).applyMatrix4(R), V3(0, 1, 0), 0.222, 0.05, uvOf(REG.mir))); // 鏡子：畫的後面景色
      const xs = F.wt(0) - 0.012, ys = F.roof(xs, 0) - 0.012;
      put('gloss', tint(tube([[xm + 0.004, ym + 0.025, 0], [lerp(xm, xs, 0.5), lerp(ym + 0.025, ys, 0.65), 0], [xs, ys, 0]], 0.008, 6, 8), 0x0c0c0e));
      // 遮陽板：收起來貼著車頂（四個角照車頂高度，中間拉直線；車頂是凸的所以不會穿出去），前緣在前擋上緣後面 3 公分；外端只到車頂還平的地方
      for (const s of [-1, 1]) {
        const za = 0.1, xf = Math.min(F.wt(0.1), F.wt(0.3), F.wt(0.45)) - 0.03, xb = xf - 0.14, t0 = Math.min(F.roof(xf, za), F.roof(xb, za));
        let zb = za + 0.2; while (zb < 0.44 && Math.min(F.roof(xf, zb + 0.01), F.roof(xb, zb + 0.01)) > t0 - 0.035) zb += 0.01;
        const yAt = (x, z) => lerp(F.roof(x, za), F.roof(x, zb), (z - za) / (zb - za)) - 0.018;
        const sec = (z, e) => [[xf - e, yAt(xf, z)], [xb + e, yAt(xb, z)], [xb + e + 0.003, yAt(xb, z) - 0.015], [xf - e - 0.003, yAt(xf, z) - 0.015]].map(([x, y]) => [x, y, s * z]);
        put('trim', lift(loft([sec(za, 0.012), sec(za + 0.012, 0), sec(zb - 0.012, 0), sec(zb, 0.012)], C.hl), C.roof ? 2.2 : 1.4));
      }
    }

    // ---- 防滾籠（Supra）----
    if (st.cage) {
      const xh = xH - 0.55, r = 0.02, m = 0.05, hoop = [];
      for (const y of [yF + 0.02, 0.5, 0.8, 0.95, 1.05]) hoop.push(inside(F, [xh, y, -1], m));
      for (const z of [-0.45, -0.2, 0.2, 0.45]) hoop.push(inside(F, [xh, 2, z], m));
      for (const y of [1.05, 0.95, 0.8, 0.5, yF + 0.02]) hoop.push(inside(F, [xh, y, 1], m));
      put('gloss', tint(tube(hoop, r, 48, 8), C.cage));
      const ht = (s) => inside(F, [xh, 2, s * 0.45], m);
      for (const s of [-1, 1]) {
        const pts = [ht(s)]; for (const x of [xh + 0.3, xh + 0.6, F.wt(0.5) - 0.02]) pts.push(inside(F, [x, 2, s * 0.5], m));
        const xw = (F.ws(0.6) + F.wf(0.6)) / 2 - 0.12; pts.push(inside(F, [lerp(pts[3][0], xw, 0.5), 2, s * 0.62], m), inside(F, [xw, D.yt - 0.02, s], m + 0.02));
        put('gloss', tint(tube(pts, r, 32, 8), C.cage));
        put('gloss', tint(tube([inside(F, [xh, 0.45, s], m + 0.03), inside(F, [lerp(xh, xw, 0.5), 0.48, s], m + 0.03), inside(F, [xw - 0.05, 0.5, s], m + 0.03)], r, 16, 8), C.cage));
        put('gloss', tint(tube([ht(s), inside(F, [xh - 0.35, 2, s * 0.5], m), inside(F, [F.rg(0) + 0.1, 0.94, s * 0.55], m)], r, 16, 8), C.cage));
      }
      put('gloss', tint(tube([ht(sd), inside(F, [xh, 0.3, -sd], m)], r, 12, 8), C.cage));
    }

    // ---- R34 的多功能螢幕、Yaris 的中控螢幕 ----
    if (st.mfd || st.scr) {
      const M = st.mfd || st.scr, xm = xr(0) + (st.mfd ? 0.05 : 0.08), ym = D.yt + M.h / 2 + (st.mfd ? -0.012 : 0.01), tilt = (st.mfd ? 18 : 14) * D2R;
      const N = V3(-Math.cos(tilt), Math.sin(tilt), 0), V = V3(Math.sin(tilt), Math.cos(tilt), 0), U = V3(0, 0, 1), o = V3(xm, Math.min(ym, F.top(xm, 0) - M.h / 2 - 0.03), 0);
      put(st.mfd ? 'trim' : 'gloss', tint(rbox(M.w + 0.02, M.h + 0.02, st.mfd ? 0.09 : 0.012, 0.012).applyMatrix4(basis(o.clone().addScaledVector(N, st.mfd ? -0.04 : 0), U, V, N)), st.mfd ? C.dash : 0x0a0a0b));
      put('face', quadUV(o.clone().addScaledVector(N, st.mfd ? 0.0065 : 0.0075), U, V, M.w, M.h, uvOf(st.mfd ? REG.mfd : REG.scr)));
    }
    // ---- 兩邊出風口 ----
    for (const s of [-1, 1]) { const z = s * 0.66, y = D.yt - 0.05; put('face', quadUV(V3(faceX(z, y) - 0.004, y, z), V3(0, 0, 1), V3(0, 1, 0), 0.1, 0.04, uvOf(REG.vent))); }

    // ---- 材質＋併成 mesh ----
    const atlas = makeAtlas(key, st);
    const mat = {
      trim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.85 }),
      gloss: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.15, side: THREE.DoubleSide }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.9, side: THREE.DoubleSide }),
      face: new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: atlas ? 0xffffff : 0x000000, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0, side: THREE.DoubleSide, color: atlas ? 0xffffff : 0x333333 }),
    };
    for (const k of ['trim', 'gloss', 'metal', 'face']) {
      if (!bag[k].length) continue;
      const m = new THREE.Mesh(merge(bag[k], k === 'face' ? 'uv' : 'color', k === 'face' ? null : ao), mat[k]); m.name = 'cabin-' + k; cab.add(m);
    }
    // 指針：一個 mesh，每根 4 個點，setGauges 時重算位置
    const npos = new Float32Array(needles.length * 12), nidx = [];
    needles.forEach((n, i) => nidx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3));
    const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.BufferAttribute(npos, 3)); ng.setIndex(nidx);
    ng.boundingSphere = new THREE.Sphere(V3(xE + 0.6, yE - 0.2, zd), 0.8);
    const nm = new THREE.Mesh(ng, new THREE.MeshBasicMaterial({ color: C.needle, side: THREE.DoubleSide })); nm.name = 'cabin-needles'; cab.add(nm);
    // 數位儀表的時速
    let digits = null;
    if (cab.userData._dig) {
      const d = cab.userData._dig, t = makeDigits('#05070a');
      if (t) { digits = t; const m = new THREE.Mesh(quadUV(d.o, d.U, d.V, d.w, d.h, [0, 0, 1, 1]), new THREE.MeshBasicMaterial({ map: t })); m.name = 'cabin-digits'; cab.add(m); }
    }
    delete cab.userData._dig; delete cab.userData._con;
    const _d = V3(), _s = V3(), _p = V3(), NQ = [[-0.18, -0.035], [-0.18, 0.035], [1, 0.012], [1, -0.012]]; // 指針四個角（長度比例、寬度比例）
    let lr = NaN, lk = NaN;
    const setGauges = (rpm = 0, kmh = 0) => { // 每一格叫也可以：沒變就不做事、不產生新物件
      if (rpm === lr && kmh === lk) return; lr = rpm; lk = kmh;
      needles.forEach((n, i) => {
        const f = n.k === 'tach' ? (cl(rpm, 0, 1.08) * n.red) / n.max : cl(kmh / n.max, 0, 1.02), a = (n.a0 + (n.a1 - n.a0) * f) * D2R;
        _d.copy(n.U).multiplyScalar(Math.sin(a)).addScaledVector(n.V, Math.cos(a)); _s.copy(n.U).multiplyScalar(Math.cos(a)).addScaledVector(n.V, -Math.sin(a));
        NQ.forEach(([l, w], j) => { _p.copy(n.o).addScaledVector(_d, l).addScaledVector(_s, w * n.w); const o = (i * 4 + j) * 3; npos[o] = _p.x; npos[o + 1] = _p.y; npos[o + 2] = _p.z; });
      });
      ng.attributes.position.needsUpdate = true;
      if (digits) digits.userData.set(kmh);
    };
    setGauges(0, 0);
    Object.assign(cab.userData, { setGauges, view: VIEW[key], mats: mat });
    void mats;
    return cab;
  }
  const VIEW = Object.fromEntries(Object.entries(STYLE).map(([k, s]) => {
    const z = (s.lhd ? -1 : 1) * s.zD;
    return [k, { eye: [s.eye[0], s.eye[1], z], look: [s.eye[0] + 3, s.eye[1] - 0.3, z], fov: s.fov }];
  }));
  // 坐進去的相機：放在眼睛、往前看再轉 yaw／pitch（在車身座標裡轉，車身歪了頭也跟著歪）
  function aim(camera, body, key, yaw = 0, pitch = 0) {
    const v = VIEW[key]; if (!v || !body) return false;
    body.updateWorldMatrix(true, false);
    const d = V3(v.look[0] - v.eye[0], v.look[1] - v.eye[1], v.look[2] - v.eye[2]).normalize();
    const ya = Math.atan2(d.z, d.x) + yaw * D2R, pa = cl(Math.asin(d.y) + pitch * D2R, -1.45, 1.45);
    const e = V3(...v.eye), t = e.clone().add(V3(Math.cos(pa) * Math.cos(ya), Math.sin(pa), Math.cos(pa) * Math.sin(ya)));
    camera.position.copy(body.localToWorld(e)); camera.up.set(0, 1, 0).transformDirection(body.matrixWorld); camera.lookAt(body.localToWorld(t));
    return true;
  }
  return { build, aim, VIEW, STYLE, fitOf };
})();
const CABIN_VIEW = CABIN3D.VIEW;
function buildCabin(key, spec, mats) { return CABIN3D.build(key, spec, mats); }
// cabinCamera(camera, S.body, key, yaw, pitch)：把相機放到駕駛眼睛；yaw＝往右轉幾度（負的往左）、pitch＝往上看幾度
//   車身會動（懸吊、轉速抖動）就每一格叫一次；fov、near 頁面自己設（CABIN_VIEW[key].fov、near 0.02），出來的時候改回去
function cabinCamera(camera, body, key, yaw = 0, pitch = 0) { return CABIN3D.aim(camera, body, key, yaw, pitch); }
// cabinFov(key, aspect)：坐進去的垂直視角（度）：橫的畫面用 CABIN_VIEW 的 72 度；手機直拿（窄）放大到左右至少 60 度（最多 100 度）、很寬的畫面左右最多 110 度
function cabinFov(key, aspect = 1.5) {
  const f = CABIN3D.VIEW[key]?.fov ?? 72, r = Math.PI / 180, h = (v) => (2 * Math.atan(Math.tan((v * r) / 2) * aspect)) / r, v = (hh) => (2 * Math.atan(Math.tan((hh * r) / 2) / aspect)) / r;
  return h(f) < 60 ? Math.min(100, v(60)) : h(f) > 110 ? v(110) : f;
}

// ---- wings.js ----
// 每台車多加的尾翼樣式：gt GT 大尾翼（還沒有的車：jesko、p918、gc8、yaris）、duck 鴨尾、swan 鵝頸尾翼、double 雙層尾翼、lip 碳纖維小尾翼
// Yaris 是掀背（沒有行李箱蓋）不做鴨尾；它的 gt／swan／double 裝在車頂後緣、底下留著原廠車頂擾流，lip 是車頂後緣的碳纖維小擾流
// 車庫用法：在 buildCar 之前 spec.wings = { ...spec.wings, ...extraWings(key) }；每個樣式是 (paint, mats) => Object3D，跟原本的一樣
// 每台車的車尾（行李箱蓋／引擎蓋／車頂後緣）高度、長度、寬度、斜度是從車身 SDF 量的（WINGS_DECK，wings-measure.mjs 產生）：
// 支架腳、鴨尾、小尾翼都照著這張表貼在車身上（往車身裡多插幾公釐，不會浮空）

// ---- 車尾頂面高度表（wings-measure.mjs 從各車身 SDF 量的，公釐；重做車身後要重跑 node wings-measure.mjs --write，不要手改）----
// WINGS_DECK[key] = [x0, z 間距, [[z=0 那列：從 x0 往後每 2 公分的高度, ...], [z=0.05 那列], ...]]，0＝那裡沒有車身
const WINGS_DECK = {
supra: [-1.50, 0.05, [
  [969,963,958,952,947,945,944,943,941,940,938,937,935,933,931,929,927,925,923,922,920,918,916,914,911,908,904,898,892,884,873,861,845,827,801,756,650,0,0],
  [969,963,957,952,947,945,944,942,941,940,938,936,935,933,931,929,927,925,923,921,920,918,916,914,911,908,903,898,892,884,873,860,845,827,801,756,650,0,0],
  [969,962,957,952,947,945,943,942,940,939,937,936,934,932,930,928,926,924,922,921,919,918,916,913,911,907,903,898,891,883,873,860,845,826,800,755,662,0,0],
  [968,962,956,951,946,944,943,941,940,938,937,935,933,931,929,927,925,923,922,920,918,917,915,912,910,906,902,897,890,882,872,859,844,825,801,760,688,0,0],
  [968,962,957,952,947,946,944,943,941,940,938,936,934,932,930,928,926,924,922,920,918,917,914,912,909,906,901,896,890,882,871,859,845,827,804,770,715,626,0],
  [968,963,958,953,950,948,947,945,944,942,940,938,936,934,932,930,928,926,924,922,920,918,915,913,910,906,902,897,891,883,873,861,847,831,810,782,739,673,0],
  [968,963,959,956,953,951,950,948,947,945,943,941,939,937,935,933,930,928,926,924,922,920,917,915,911,908,903,898,892,884,875,864,850,835,816,791,755,700,608],
  [968,964,960,957,955,954,952,951,949,947,945,944,941,939,937,935,932,930,928,926,924,922,919,916,913,909,905,900,894,886,877,866,854,839,821,798,765,716,635],
  [966,962,959,957,956,954,953,951,950,948,946,944,942,940,938,936,933,931,929,927,925,922,920,917,914,910,906,901,895,887,878,868,855,841,824,802,771,724,646],
  [963,960,958,956,955,954,952,951,949,947,945,944,942,940,937,935,933,930,928,926,924,922,919,916,913,909,905,900,894,887,878,868,855,841,824,803,772,726,649],
  [958,956,955,954,952,951,950,948,947,945,943,941,939,937,935,933,930,928,926,924,922,920,917,914,911,907,903,898,892,885,876,866,854,840,823,801,770,723,644],
  [954,952,951,950,948,947,946,944,943,941,939,937,936,934,931,929,927,925,923,921,918,916,914,911,908,904,899,894,888,881,873,862,850,836,819,796,763,714,630],
  [948,947,946,944,943,942,940,939,937,936,934,932,930,928,926,924,922,919,917,915,913,911,908,906,902,899,894,889,883,876,867,857,845,830,811,787,752,697,602],
  [941,940,938,937,936,935,933,932,930,929,927,925,923,921,919,917,915,913,911,909,906,904,902,899,896,892,887,882,876,869,860,850,837,820,799,771,730,664,0],
  [932,931,930,929,927,926,925,923,922,920,918,917,915,913,911,909,906,904,902,900,898,896,893,891,887,884,879,874,868,861,851,839,823,803,776,739,684,578,0],
  [918,917,916,915,913,912,911,909,908,906,905,903,901,900,898,896,893,891,890,888,886,884,881,879,875,872,868,863,856,847,834,818,795,765,722,657,0,0,0],
  [891,890,889,888,887,886,884,883,882,880,878,877,875,873,871,869,867,865,862,860,858,855,852,849,845,840,834,827,817,804,785,758,709,604,0,0,0,0,0],
  [837,836,835,834,832,831,829,827,825,823,821,819,817,814,811,809,806,802,799,795,791,786,780,772,763,751,733,709,674,604,0,0,0,0,0,0,0,0,0]]],
gtr: [-1.60, 0.05, [
  [1011,1002,989,987,987,987,987,986,986,986,986,985,985,985,984,984,984,983,983,982,982,982,982,981,981,980,979,977,976,974,971,967,960,947,905,0],
  [1011,1002,989,987,987,987,986,986,986,986,985,985,985,985,984,984,983,983,983,982,982,982,982,981,981,980,979,977,976,974,971,967,960,947,905,0],
  [1010,1001,989,987,987,986,986,986,986,986,985,985,985,984,984,984,983,983,983,982,982,982,981,981,980,980,978,977,976,974,971,967,960,947,905,0],
  [1009,999,988,986,986,986,986,986,985,985,985,985,984,984,984,983,983,983,982,982,982,981,981,981,980,979,978,977,975,973,970,966,959,946,904,0],
  [1007,997,987,986,986,986,985,985,985,985,984,984,984,983,983,983,982,982,982,981,981,981,980,980,980,979,977,976,974,972,970,965,959,945,903,0],
  [1004,995,986,985,985,985,985,985,984,984,984,983,983,983,982,982,982,981,981,981,980,980,980,979,979,978,977,975,974,972,969,964,958,944,901,0],
  [1001,992,985,985,984,984,984,984,984,983,983,983,982,982,982,981,981,980,980,980,979,979,979,979,978,977,976,974,973,971,968,963,957,943,899,0],
  [996,988,984,984,983,983,983,983,983,982,982,982,981,981,981,980,980,979,979,979,978,978,978,977,977,976,975,973,972,969,966,962,955,941,895,0],
  [991,985,983,982,982,982,982,982,981,981,981,980,980,980,979,979,979,978,978,977,977,977,977,976,976,975,973,972,970,968,965,961,953,939,889,0],
  [986,982,981,981,981,981,981,980,980,980,979,979,979,978,978,978,977,977,976,976,976,975,975,975,974,973,972,970,969,966,963,959,952,937,881,0],
  [981,980,980,980,979,979,979,979,978,978,978,977,977,977,976,976,976,975,975,974,974,974,973,973,972,972,970,969,967,965,961,957,949,934,868,0],
  [978,978,978,978,978,977,977,977,977,976,976,976,975,975,974,974,974,973,973,972,972,972,972,971,971,970,968,967,965,962,959,954,947,930,830,0],
  [976,976,976,976,976,975,975,975,975,974,974,974,973,973,972,972,972,971,971,970,970,970,969,969,968,967,966,964,962,960,957,952,944,923,0,0],
  [974,974,973,973,973,973,973,973,972,972,972,971,971,970,970,970,969,969,968,968,968,967,967,967,966,965,963,962,960,957,954,949,940,910,0,0],
  [969,969,969,969,969,969,968,968,968,967,967,967,966,966,965,965,965,964,964,963,963,963,962,962,961,960,959,957,955,953,949,943,927,0,0,0],
  [952,952,952,952,951,951,951,951,951,950,950,950,950,949,949,949,948,948,948,947,947,947,947,946,946,945,944,943,941,938,931,914,0,0,0,0],
  [918,918,918,918,918,918,918,917,917,917,917,917,917,917,917,917,917,917,917,917,917,916,916,915,913,911,907,900,883,814,0,0,0,0,0,0],
  [822,822,822,822,822,822,822,821,821,821,820,820,819,819,818,817,815,810,802,790,771,740,0,0,0,0,0,0,0,0,0,0,0,0,0,0]]],
sp3: [-1.70, 0.05, [
  [945,945,945,945,945,945,945,945,945,945,945,885,885,885,886,886,886,886,887,887,887,886,886,885,883,877,580,580,580],
  [945,945,945,945,945,945,945,945,945,945,945,885,885,885,886,886,886,886,887,887,886,886,886,885,883,877,580,580,580],
  [944,944,944,944,945,945,945,945,945,945,945,885,885,885,885,886,886,886,886,886,886,886,885,885,883,877,580,580,580],
  [944,944,944,944,944,944,944,944,944,944,944,884,884,885,885,885,885,886,886,886,886,885,885,884,882,877,580,580,580],
  [943,943,943,943,943,943,944,944,944,944,944,884,884,884,884,885,885,885,885,885,885,885,884,884,882,876,580,580,580],
  [943,943,943,943,943,943,943,943,943,943,943,883,883,883,884,884,884,884,884,884,884,884,884,883,881,876,580,580,580],
  [942,942,942,942,942,942,942,942,942,942,942,882,882,882,883,883,883,883,883,883,883,883,883,882,880,875,580,580,580],
  [940,940,940,941,941,941,941,941,941,941,941,881,881,881,881,882,882,882,882,882,882,882,881,881,879,874,580,580,580],
  [939,939,939,939,939,939,939,939,939,939,939,879,880,880,880,880,881,881,881,881,881,881,880,879,878,872,580,580,580],
  [938,938,938,938,938,938,938,938,938,938,938,879,879,879,879,879,880,880,880,880,880,879,879,878,876,870,580,580,580],
  [954,954,954,955,955,955,955,954,954,954,953,952,952,952,952,952,952,952,951,949,890,889,888,886,883,876,580,580,580],
  [985,986,986,986,987,987,987,986,985,984,983,982,981,980,980,980,980,979,976,974,971,968,965,963,961,958,949,580,580],
  [1021,1022,1023,1023,1024,1024,1024,1023,1021,1019,1017,1015,1014,1013,1012,1012,1011,1008,1005,1000,995,990,985,982,980,976,965,580,579],
  [1054,1055,1056,1057,1058,1058,1058,1056,1054,1052,1049,1046,1044,1042,1041,1040,1039,1036,1030,1024,1017,1010,1004,999,997,990,974,580,576],
  [1078,1079,1081,1082,1082,1083,1082,1080,1078,1075,1071,1068,1065,1063,1061,1061,1060,1055,1049,1040,1031,1022,1013,1006,999,988,967,579,0],
  [1089,1090,1092,1093,1094,1094,1093,1091,1089,1085,1081,1077,1074,1070,1068,1066,1062,1055,1047,1036,1024,1012,1000,987,975,955,0,0,0],
  [1084,1086,1087,1087,1087,1086,1085,1082,1078,1073,1068,1063,1057,1052,1047,1043,1036,1027,1016,1002,987,969,577,0,0,0,0,0,0],
  [1060,1060,1060,1059,1057,1055,1052,1048,1042,1036,1030,1023,1015,1007,999,989,976,959,595,0,0,0,0,0,0,0,0,0,0],
  [1016,1015,1013,1011,1007,1003,998,991,983,974,964,951,935,915,891,860,809,0,0,0,0,0,0,0,0,0,0,0,0],
  [953,949,944,938,930,919,904,884,859,823,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]]],
jesko: [-1.54, 0.05, [
  [960,956,952,949,945,941,937,934,930,926,923,919,916,913,910,907,904,901,897,894,891,888,885,882,879,876,872,869,865,862,859,857,855,852,847,841,831,802,0],
  [959,955,951,948,944,940,936,933,929,925,922,918,915,912,909,906,903,900,896,893,890,887,884,881,878,875,871,868,864,861,858,856,854,851,846,840,830,802,0],
  [956,952,948,945,941,937,933,930,926,922,919,915,912,909,906,903,900,896,893,890,887,884,881,878,875,871,868,865,861,858,855,853,851,848,843,837,827,800,0],
  [951,947,943,939,936,932,928,925,921,917,914,910,907,904,901,898,894,891,888,885,882,879,876,873,870,866,863,859,856,853,850,848,846,842,838,832,822,795,0],
  [944,940,936,932,929,925,921,917,914,910,907,903,900,897,894,890,887,884,881,878,875,872,869,866,863,859,856,852,849,846,843,841,838,835,831,825,814,788,0],
  [935,931,927,923,919,916,912,908,905,901,898,894,891,888,884,881,878,875,872,869,866,863,860,857,853,850,847,843,840,836,834,832,829,826,822,816,804,778,0],
  [923,920,916,912,908,905,901,897,893,890,886,883,880,876,873,870,867,864,861,858,855,852,849,846,842,839,835,832,828,825,823,820,818,814,810,803,792,765,0],
  [910,906,903,899,895,891,888,884,880,877,873,870,866,863,860,857,853,850,847,843,840,837,833,830,826,822,819,816,813,810,808,805,803,799,794,787,775,747,0],
  [895,891,887,883,879,876,872,868,865,861,858,854,851,847,844,841,837,834,830,827,824,820,817,814,811,809,806,804,802,800,798,796,793,790,785,775,757,714,0],
  [877,874,871,868,865,862,859,857,854,851,848,845,842,839,836,833,830,827,824,822,819,817,814,812,811,809,808,807,806,805,804,802,800,796,790,775,740,0,0],
  [871,869,868,866,865,863,862,860,858,856,854,852,850,848,846,843,841,838,836,834,831,829,827,826,824,823,822,821,819,818,816,814,812,807,798,778,0,0,0],
  [882,881,881,880,879,878,876,875,873,872,870,868,866,863,861,859,856,854,851,849,847,844,842,840,839,837,836,834,833,831,829,827,824,816,803,769,0,0,0],
  [894,894,893,893,892,891,890,888,887,885,883,882,880,877,875,873,871,868,866,863,861,859,856,854,852,851,849,847,846,844,842,839,832,821,796,0,0,0,0],
  [904,903,903,902,901,900,899,898,897,895,894,892,890,888,886,884,882,880,877,875,872,870,868,866,864,862,860,858,856,854,851,845,833,810,0,0,0,0,0],
  [909,909,908,908,907,906,905,904,903,901,900,898,897,895,893,891,889,887,884,882,880,878,875,873,871,869,867,865,863,859,852,839,812,0,0,0,0,0,0],
  [908,907,907,906,906,905,904,903,902,901,899,898,896,894,893,891,889,887,885,883,881,878,876,874,872,870,868,865,860,851,833,0,0,0,0,0,0,0,0],
  [900,899,899,898,898,897,896,895,894,893,892,891,889,888,886,884,882,881,879,877,875,873,871,869,866,863,857,848,831,0,0,0,0,0,0,0,0,0,0],
  [883,883,882,882,881,880,879,878,877,876,875,874,872,871,869,868,866,864,862,860,857,854,850,844,836,823,786,0,0,0,0,0,0,0,0,0,0,0,0],
  [851,850,850,849,848,848,847,846,845,844,842,841,839,837,835,833,829,826,821,816,808,797,775,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]]],
yaris: [-1.30, 0.05, [
  [1393,1389,1386,1382,1379,1375,1371,1367,1363,1359,1355,1351,1346,1341,1336,1330,1324,1316,1306,1295,1281,1263,1234,1197,1155,1110,1077,896],
  [1393,1389,1386,1382,1379,1375,1371,1367,1363,1359,1355,1350,1346,1341,1335,1330,1323,1316,1306,1295,1281,1263,1234,1197,1155,1110,1076,896],
  [1392,1389,1385,1382,1378,1375,1371,1367,1363,1359,1355,1350,1345,1340,1335,1330,1323,1315,1306,1295,1281,1262,1233,1197,1155,1110,1076,895],
  [1392,1388,1385,1381,1378,1374,1370,1367,1363,1358,1354,1350,1345,1340,1335,1329,1323,1315,1305,1294,1280,1262,1233,1196,1154,1109,1075,894],
  [1391,1388,1384,1381,1377,1373,1370,1366,1362,1358,1353,1349,1344,1339,1334,1328,1322,1314,1305,1293,1280,1261,1232,1196,1154,1108,1074,892],
  [1390,1387,1383,1380,1376,1373,1369,1365,1361,1357,1353,1348,1343,1338,1333,1328,1321,1313,1304,1293,1279,1260,1231,1195,1153,1106,1072,890],
  [1389,1386,1382,1379,1375,1371,1368,1364,1360,1356,1351,1347,1342,1337,1332,1326,1320,1312,1303,1291,1278,1259,1230,1194,1151,1103,1069,893],
  [1388,1384,1381,1377,1374,1370,1366,1363,1359,1355,1350,1346,1341,1336,1331,1325,1319,1311,1301,1290,1276,1258,1229,1192,1147,1098,1065,897],
  [1386,1383,1380,1376,1372,1369,1365,1361,1357,1353,1349,1344,1340,1335,1329,1324,1317,1309,1300,1288,1274,1253,1222,1182,1135,1090,1059,897],
  [1385,1381,1378,1374,1371,1367,1363,1359,1355,1351,1346,1341,1336,1330,1324,1317,1309,1300,1288,1274,1255,1228,1191,1149,1102,1076,1047,891],
  [1379,1374,1370,1366,1361,1356,1351,1346,1341,1334,1328,1321,1314,1306,1297,1287,1276,1262,1246,1225,1197,1162,1123,1089,1072,1063,1027,882],
  [1348,1342,1336,1329,1322,1315,1306,1297,1287,1276,1263,1249,1234,1219,1203,1186,1168,1149,1127,1106,1090,1077,1068,1061,1058,1056,1011,878],
  [1244,1234,1224,1214,1202,1191,1179,1167,1153,1140,1125,1113,1104,1097,1091,1085,1079,1074,1069,1064,1060,1057,1056,1055,1055,1054,1005,871],
  [1106,1097,1091,1086,1082,1079,1076,1074,1072,1070,1069,1068,1068,1067,1066,1065,1063,1060,1058,1056,1054,1052,1052,1052,1052,1051,1000,862],
  [1049,1049,1049,1050,1051,1051,1052,1053,1054,1054,1055,1055,1055,1055,1054,1053,1050,1048,1045,1043,1041,1041,1041,1042,1042,1040,991,849],
  [1030,1031,1032,1033,1033,1034,1034,1035,1035,1035,1035,1035,1035,1035,1033,1031,1028,1025,1022,1020,1019,1019,1019,1019,1019,1005,947,830],
  [1001,1001,1001,1002,1002,1002,1002,1001,1001,1000,999,998,997,995,992,988,984,978,973,967,963,960,958,950,931,883,819,749]]],
gc8: [-1.54, 0.05, [
  [982,982,982,982,982,982,982,982,982,982,982,982,982,982,982,982,981,981,981,980,980,979,978,977,975,971,964,948,874,630,0],
  [982,982,982,982,982,982,982,982,982,982,982,982,982,982,982,982,981,981,980,980,980,979,978,977,975,971,964,948,874,630,0],
  [981,982,982,982,982,982,982,982,982,982,982,982,982,982,981,981,981,981,980,980,979,979,978,977,975,971,964,948,874,630,0],
  [981,981,981,981,981,981,981,982,982,982,981,981,981,981,981,981,980,980,980,979,979,978,978,976,974,971,963,947,872,628,0],
  [980,980,981,981,981,981,981,981,981,981,981,981,981,981,980,980,980,979,979,979,978,978,977,976,974,970,962,946,866,623,0],
  [979,980,980,980,980,980,980,980,980,980,980,980,980,980,979,979,979,979,978,978,977,977,976,975,973,969,961,944,858,615,0],
  [978,979,979,979,979,979,979,979,979,979,979,979,979,979,978,978,978,977,977,977,976,976,975,974,972,967,959,942,850,606,0],
  [977,977,977,977,977,978,978,978,978,978,978,978,977,977,977,977,977,976,976,975,975,974,974,972,970,966,958,939,838,593,0],
  [975,976,976,976,976,976,976,976,976,976,976,976,976,976,976,975,975,975,974,974,973,973,972,971,968,964,955,935,817,570,0],
  [974,974,974,974,974,974,974,974,974,974,974,974,974,974,974,974,973,973,972,972,972,971,970,969,966,961,952,930,771,524,0],
  [972,972,972,972,972,972,972,972,972,972,972,972,972,972,972,971,971,971,970,970,969,969,968,967,963,957,947,920,698,0,0],
  [969,969,970,970,970,970,970,970,970,970,970,970,970,970,969,969,969,968,968,968,967,967,966,964,959,952,939,901,628,0,0],
  [966,967,967,967,967,967,967,967,967,967,967,967,967,967,967,967,966,966,965,965,964,964,963,959,953,944,926,817,0,0,0],
  [963,964,964,964,964,964,964,964,964,964,964,964,964,964,964,964,963,963,962,962,961,960,956,950,941,927,889,564,0,0,0],
  [952,952,952,952,952,952,952,952,952,952,952,952,952,952,952,952,952,951,950,948,945,940,933,922,907,870,0,0,0,0,0],
  [927,928,928,927,927,927,927,927,927,926,926,925,925,924,923,922,920,918,914,908,901,890,873,838,0,0,0,0,0,0,0],
  [858,858,857,856,855,854,852,851,849,846,843,839,833,825,813,796,767,703,0,0,0,0,0,0,0,0,0,0,0,0,0]]],
p918: [-1.70, 0.05, [
  [913,912,910,909,908,907,906,905,904,903,902,901,901,900,899,899,899,898,898,897,897,896,895,894,893,892,891,889,886,881,873,847,0],
  [913,912,910,909,908,907,905,904,903,903,902,901,900,900,899,899,898,898,898,897,897,896,895,894,893,892,891,889,886,881,873,847,0],
  [912,911,910,908,907,906,905,904,903,902,901,901,900,899,899,898,898,898,897,897,896,896,895,894,893,892,890,888,885,880,872,847,0],
  [911,910,909,907,906,905,904,903,902,901,900,900,899,899,898,898,897,897,896,896,895,895,894,893,892,891,890,888,884,879,872,846,0],
  [910,909,907,906,905,904,903,902,901,900,899,899,898,897,897,896,896,896,895,895,894,894,893,892,891,890,889,887,883,878,870,844,0],
  [908,907,906,904,903,902,901,900,899,898,898,897,896,896,895,895,894,894,894,893,893,892,891,890,889,888,887,885,882,876,869,843,0],
  [906,905,903,902,901,900,899,898,897,896,895,895,894,894,893,893,892,892,892,891,891,890,889,888,887,886,885,883,880,874,866,841,0],
  [918,917,915,914,912,911,910,908,907,906,905,904,902,901,900,899,898,896,895,893,891,889,887,886,885,884,882,880,877,872,864,838,0],
  [930,928,926,924,922,921,919,917,916,914,913,911,909,908,906,904,902,900,897,894,891,887,885,883,882,881,879,877,874,869,860,834,0],
  [930,928,926,924,922,920,918,916,915,913,911,909,907,905,904,902,899,897,895,892,888,885,882,879,878,877,875,873,870,865,857,831,0],
  [903,900,898,895,893,891,889,888,886,885,884,883,882,881,880,880,879,879,878,878,877,876,875,874,873,872,871,869,866,860,853,826,0],
  [888,887,885,884,883,881,880,879,878,878,877,876,875,875,874,874,873,873,872,872,871,871,870,869,868,867,866,864,860,855,848,822,0],
  [881,880,878,877,876,875,874,873,872,871,870,869,869,868,868,867,867,866,866,866,865,864,864,863,862,861,859,857,854,849,841,812,0],
  [845,844,844,844,844,844,844,844,844,844,844,844,844,844,844,844,844,845,845,845,846,846,845,844,844,842,841,838,833,822,784,0,0],
  [820,820,820,820,821,821,821,821,821,822,822,822,822,823,823,824,824,825,826,826,827,827,827,826,825,824,822,818,809,785,0,0,0],
  [809,808,808,808,808,809,809,809,809,809,810,810,810,810,811,812,812,813,814,814,815,815,815,814,813,812,810,805,792,744,0,0,0],
  [795,795,795,795,795,795,795,795,795,796,796,796,796,797,797,798,798,799,800,800,801,801,801,800,799,798,793,783,758,0,0,0,0],
  [780,779,779,779,779,779,779,780,780,780,780,780,781,781,781,782,783,784,784,785,785,785,785,783,780,773,759,0,0,0,0,0,0],
  [759,758,758,758,758,758,758,758,758,758,758,758,758,758,758,757,757,756,755,753,750,746,738,723,0,0,0,0,0,0,0,0,0]]],
};

// 車尾頂面：y(x, z)（公尺，表裡雙三次內插，斜率是連續的）；sl：往前的斜率（往後往下＝正）；edge(z, xs, s)：從 xs 往後走，斜率第一次到 s 的 x（行李箱蓋後緣）
function WINGS_deck(key) {
  const [x0, dz, rows] = WINGS_DECK[key], nx = rows[0].length, nz = rows.length, xEnd = x0 - 0.02 * (nx - 1);
  const at = (i, j) => rows[Math.min(nz - 1, Math.abs(j))][Math.max(0, Math.min(nx - 1, i))]; // z 對稱：第 -1 列就是第 1 列
  const cr = (a, b, c, d, u) => b + 0.5 * u * (c - a + u * (2 * a - 5 * b + 4 * c - d + u * (3 * (b - c) + d - a)));
  const y = (x, z) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x0 - x) / 0.02)), fz = Math.min(nz - 1.001, Math.abs(z) / dz);
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, c = [];
    for (let k = -1; k <= 2; k++) { const a = at(i - 1, j + k), b = at(i, j + k), cc = at(i + 1, j + k), d = at(i + 2, j + k); c.push(a && b && cc && d ? cr(a, b, cc, d, u) : b + (cc - b) * u); }
    return (c[0] && c[1] && c[2] && c[3] ? cr(c[0], c[1], c[2], c[3], v) : c[1] + (c[2] - c[1]) * v) / 1000;
  };
  const sl = (x, z) => (y(x + 0.003, z) - y(x - 0.003, z)) / 0.006;
  const edge = (z, xs, s = 0.45) => {
    let pv = sl(xs, z);
    if (pv >= s) return xs; // 一開始就比 s 陡：後緣就在 xs
    for (let x = xs - 0.004; x > xEnd + 0.01; x -= 0.004) { const v = sl(x, z); if (v >= s) return x + (0.004 * (v - s)) / (v - pv); pv = v; }
    return xEnd + 0.01;
  };
  return { y, sl, edge };
}
// 左右對稱的平順曲線：用 a + b·z² + c·z⁴ + d·z⁶ 最小平方擬合每站的值 vs（後緣量出來會一格一格地跳），回傳每個 z 的值
function WINGS_even(zs, vs) {
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], r = [0, 0, 0, 0];
  zs.forEach((z, k) => { const p = [1, z * z, z ** 4, z ** 6]; for (let i = 0; i < 4; i++) { r[i] += p[i] * vs[k]; for (let j = 0; j < 4; j++) A[i][j] += p[i] * p[j]; } });
  for (let i = 0; i < 4; i++) for (let k = i + 1; k < 4; k++) { const q = A[k][i] / A[i][i]; for (let j = i; j < 4; j++) A[k][j] -= q * A[i][j]; r[k] -= q * r[i]; }
  const c = [0, 0, 0, 0]; for (let i = 3; i >= 0; i--) { let t = r[i]; for (let j = i + 1; j < 4; j++) t -= A[i][j] * c[j]; c[i] = t / A[i][i]; }
  return zs.map((z) => c[0] + c[1] * z * z + c[2] * z ** 4 + c[3] * z ** 6);
}
const WINGS_ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 跟車漆長得一樣的材質（鴨尾用）：同一個顏色物件，每次畫之前照車漆的粗糙度、金屬感、清漆、珍珠（setFinish 換漆面、918 換色會換消光／亮面）
// 不用車漆本身：車漆的 shader 會照位置套車窗、縫、黑色、消光的投影貼圖，零件放在車尾會被塗到
function WINGS_paintLike(paint) {
  const m = new THREE.MeshPhysicalMaterial();
  m.color = paint.color;
  m.userData.sync = () => {
    m.roughness = paint.roughness; m.metalness = paint.metalness; m.clearcoat = paint.clearcoat; m.clearcoatRoughness = paint.clearcoatRoughness; m.envMapIntensity = paint.envMapIntensity;
    m.iridescence = paint.iridescence; m.iridescenceIOR = paint.iridescenceIOR; m.iridescenceThicknessRange = paint.iridescenceThicknessRange;
  };
  m.userData.sync(); return m;
}

// 翼剖面：倒過來的機翼（下面彎、上面平），弦長 c、前緣在 +x、中心在原點；t 厚度、cam 彎度（gtWing 是 0.12、0.06）
function WINGS_foil(c, t = 0.12, cam = 0.06) {
  const N = 24, top = [], bot = [];
  for (let i = 0; i <= N; i++) {
    const xc = (1 - Math.cos((Math.PI * i) / N)) / 2;
    const th = t * 5 * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);
    const cb = -cam * Math.sin(Math.PI * xc) * (1 - 0.3 * xc);
    top.push([(0.5 - xc) * c, (cb + th) * c]); bot.push([(0.5 - xc) * c, (cb - th) * c]);
  }
  const s = new THREE.Shape(); s.moveTo(...top[0]);
  for (const p of top.slice(1)) s.lineTo(...p); for (const p of bot.slice().reverse().slice(1)) s.lineTo(...p);
  return { s, top, bot };
}
// 一片翼片：弦長 c、翼展 span、中心 (x, y)、轉 rot（正＝前緣往上）；回傳 mesh 和 topAt(x)：翼片上面在世界 x 的高度
function WINGS_blade(mat, { c, span, x, y, rot = 0, t, cam, bevel = 0 }) {
  const F = WINGS_foil(c, t, cam);
  const geo = new THREE.ExtrudeGeometry(F.s, bevel ? { depth: span, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelSegments: 2, curveSegments: 4 } : { depth: span, bevelEnabled: false, curveSegments: 4 });
  geo.translate(0, 0, -span / 2);
  const m = new THREE.Mesh(geo, mat); m.rotation.z = rot; m.position.set(x, y, 0);
  const cs = Math.cos(rot), sn = Math.sin(rot), P = F.top.map(([a, b]) => [x + a * cs - b * sn, y + a * sn + b * cs]);
  const topAt = (wx) => { for (let i = 1; i < P.length; i++) { const [xa, ya] = P[i - 1], [xb, yb] = P[i]; if ((wx - xa) * (wx - xb) <= 0) return ya + ((yb - ya) * (wx - xa)) / (xb - xa || 1); } return y; };
  const le = [x + (c / 2) * cs, y + (c / 2) * sn], te = [x - (c / 2) * cs, y - (c / 2) * sn];
  return { m, topAt, le, te };
}
// 側面形狀（x, y 點列）往 z 拉厚 th，放在 z 中間
function WINGS_plate(pts, th, z, mat, bev = 0.002) {
  const s = new THREE.Shape(); s.moveTo(...pts[0]); for (const p of pts.slice(1)) s.lineTo(...p); s.closePath();
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: th, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 1, curveSegments: 12 }), mat);
  m.position.z = z - th / 2; return m;
}
// GT 端板（跟 gtWing 同一個形狀：40×30 公分、後上角切一刀），中心 (x, y)，外側貼在 z
function WINGS_endGT(mat, x, y, z) {
  const ep = new THREE.Shape(), ew = 0.40, eh = 0.30, r = 0.03;
  ep.moveTo(-ew / 2 + r, -eh * 0.62); ep.lineTo(ew / 2 - r, -eh * 0.62); ep.quadraticCurveTo(ew / 2, -eh * 0.62, ew / 2, -eh * 0.62 + r);
  ep.lineTo(ew / 2, eh * 0.38 - r); ep.quadraticCurveTo(ew / 2, eh * 0.38, ew / 2 - r, eh * 0.38); ep.lineTo(-ew / 2 + 0.06, eh * 0.38);
  ep.lineTo(-ew / 2, eh * 0.2); ep.lineTo(-ew / 2, -eh * 0.62 + r); ep.quadraticCurveTo(-ew / 2, -eh * 0.62, -ew / 2 + r, -eh * 0.62);
  const e = new THREE.Mesh(new THREE.ExtrudeGeometry(ep, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 }), mat);
  e.position.set(x, y, z > 0 ? z : z - 0.008); return e;
}
// 支架（從車尾頂面往上，下寬上窄、稍微往後傾，跟 gtWing 一樣）：底邊兩個角照著頂面再往下插 sink，上面到 yTop
function WINGS_post(D, mat, x, yTop, z, { b0 = -0.08, b1 = 0.08, t0 = -0.05, t1 = 0.04, th = 0.012, sink = 0.008 } = {}) {
  return WINGS_plate([[x + b0, D.y(x + b0, z) - sink], [x + b1, D.y(x + b1, z) - sink], [x + t1, yTop], [x + t0, yTop]], th, z, mat);
}

// ---- GT 大尾翼（跟 parts.js 的 gtWing 同一個樣子：鋁翼片、黑色端板、兩根鋁支架），支架腳照著車尾頂面 ----
function WINGS_gt(D, mats, { span, chord = 0.30, x, y, zs = 0.55 }) {
  const g = new THREE.Group();
  g.add(WINGS_blade(mats.alu, { c: chord, span, x, y, rot: 0.10 }).m);
  for (const s of [-1, 1]) {
    g.add(WINGS_endGT(mats.gloss, x - 0.01, y + 0.01, s * span / 2));
    const post = WINGS_post(D, mats.alu, x + 0.04, y - 0.02, s * zs); post.name = 'mount'; g.add(post);
  }
  return g;
}

// ---- 鵝頸尾翼：碳纖維翼片（後緣往上），兩支鋁的鵝頸支架從前面的車尾頂面長上來、繞過翼片前緣，從上面鎖在翼面上；碳纖維端板 ----
function WINGS_swan(D, mats, { span, chord = 0.30, x, y, rot = -0.10, zs = 0.40, xf, rise = 0.085, nw = 0.036 }) {
  const g = new THREE.Group();
  const B = WINGS_blade(mats.carbon, { c: chord, span, x, y, rot, t: 0.11, cam: 0.05, bevel: 0.004 }); g.add(B.m);
  // 端板：翼片兩端，直立、前低後高
  for (const s of [-1, 1]) {
    const [lx, ly] = B.le, [tx, ty] = B.te;
    const pts = [[lx + 0.035, ly - 0.03], [lx + 0.02, ly + 0.035], [tx - 0.02, ty + 0.075], [tx - 0.045, ty + 0.06], [tx - 0.05, ty - 0.07], [x - 0.02, y - 0.1], [lx - 0.02, ly - 0.075]];
    g.add(WINGS_plate(pts, 0.008, s * (span / 2 + 0.004), mats.carbon));
  }
  // 鵝頸：腳在 xf（車尾頂面上，前後 13 公分長），往上到翼片前緣上方 rise，再彎下來用一段「手」貼在翼面上（翼弦中間）
  const xa1 = x + chord * 0.12, xa0 = x - chord * 0.2; // 手貼在翼面上的前後
  for (const s of [-1, 1]) {
    const z = s * zs, wf = 0.13, f0 = xf - wf / 2, f1 = xf + wf / 2, y0 = D.y(f0, z) - 0.008, y1 = D.y(f1, z) - 0.008;
    const yd = Math.min(y0, y1) + 0.008, yap = B.topAt(B.le[0] - 0.005) + rise, xap = B.le[0] + 0.01, yH0 = B.topAt(xa0) - 0.003, yH1 = B.topAt(xa1) - 0.003;
    const xn = xf - 0.03; // 脖子直的那段的中心（稍微往後傾）
    const sh = new THREE.Shape();
    sh.moveTo(f0, y0); sh.lineTo(f1, y1);
    sh.bezierCurveTo(f1 - 0.03, yd + 0.02, xn + nw / 2, yd + 0.05, xn + nw / 2, yd + 0.11); // 腳往上收成脖子
    sh.bezierCurveTo(xn + nw / 2, yap - 0.03, xap + 0.07, yap, xap, yap); // 往上、往後彎到最高
    sh.bezierCurveTo(xap - 0.06, yap, xa0 + 0.015, yH0 + 0.05, xa0, yH0); // 往下到手的後端
    sh.lineTo(xa1, yH1); // 手貼著翼面
    sh.bezierCurveTo(xa1 + 0.012, yH1 + 0.03, xap + 0.02, yap - nw, xap + 0.035, yap - nw); // 手的前端往上（脖子裡面那條）
    sh.bezierCurveTo(xn - nw / 2 + 0.02, yap - nw, xn - nw / 2, yap - nw - 0.04, xn - nw / 2, yd + 0.11);
    sh.bezierCurveTo(xn - nw / 2, yd + 0.05, f0 + 0.03, yd + 0.02, f0, y0);
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 16 }), mats.alu);
    m.position.z = z - 0.008; m.name = 'mount'; g.add(m);
  }
  return g;
}

// ---- 雙層尾翼：兩片碳纖維翼片上下疊（中間留一道看得到的縫，上面那片短一點、往後一點、角度大一點），黑色端板夾住兩片，兩根鋁支架從車尾頂面撐下面那片 ----
function WINGS_double(D, mats, { span, chord = 0.28, x, y, zs = 0.55, c2 = 0.8, dx2 = -0.03, dy2 = 0.105 }) {
  const g = new THREE.Group();
  const M = WINGS_blade(mats.carbon, { c: chord, span, x, y, rot: -0.05, t: 0.11, cam: 0.05, bevel: 0.003 }); g.add(M.m);
  const U = WINGS_blade(mats.carbon, { c: chord * c2, span, x: x + dx2, y: y + dy2, rot: -0.17, t: 0.11, cam: 0.05, bevel: 0.003 }); g.add(U.m);
  // 端板：前緣直、上緣往後升（跟著上面那片）、前上角和後上角各切一刀，下緣從前往後翹；兩片上下各留 4～7 公分
  const xF = M.le[0] + 0.035, xR = Math.min(M.te[0], U.te[0]) - 0.035, yB = M.le[1] - 0.065, yT0 = U.le[1] + 0.045, yT1 = U.te[1] + 0.05;
  for (const s of [-1, 1]) {
    const pts = [[xF, yB], [xF, yT0 - 0.02], [xF - 0.03, yT0], [xR + 0.04, yT1], [xR, yT1 - 0.025], [xR, M.te[1] - 0.035], [xR + 0.06, M.te[1] - 0.07], [x, yB - 0.01]];
    g.add(WINGS_plate(pts, 0.008, s * (span / 2 + 0.004), mats.gloss));
  }
  for (const s of [-1, 1]) { const p = WINGS_post(D, mats.alu, x + 0.03, y - 0.02, s * zs); p.name = 'mount'; g.add(p); }
  return g;
}

// ---- 沿著車尾後緣的一條：鴨尾（車漆，從車尾頂面整片長出來、後緣往上翹）、小尾翼（碳纖維薄片貼在後緣，尾端翹起來）----
// 每個 z 一個截面（1.2 公分一個）：後緣 xe＝頂面往後往下斜率到 s 的地方（各站量完去掉跳一下的、再順一下），後緣高度 ye 取後緣前 1 公分（利的邊往後一點點就掉下去了）
// 鴨尾：從 xe＋L 貼著頂面（往下埋 e）用一條平順的曲線升到翹邊 (xe－over, ye＋h)、翹邊往上 kick 弧度，後面那面往下插進車身；兩端 fade 那段變矮埋回車身
// 小尾翼：前段 L 是一片貼著頂面的薄板（厚 th0），在 xe＋fl 開始往上翹到 (xe－over, ye＋h)，下面留一道縫；兩端切平
// 用到的頂面斜率都在後緣前面量、限制在 ±0.6（後緣後面是車尾那面，斜率很大，曲線會衝出去變成角）
function WINGS_edge(D, mat, o) {
  const { xs, s = 0.45, zEnd, fade = 0.14, L, over, h, kick = 0.35, lip = false, fl = 0.035, th0 = 0.004, thTip = 0.005, e = 0.004 } = o;
  const n = Math.max(8, Math.round((2 * zEnd) / 0.012)), N1 = 6, N2 = 16, R = 6, Z = Array.from({ length: n + 1 }, (_, i) => -zEnd + (2 * zEnd * i) / n);
  const raw = Z.map((z) => D.edge(z, xs, s)), med = raw.map((_, i) => { const w = raw.slice(Math.max(0, i - 3), i + 4).sort((a, b) => a - b); return w[w.length >> 1]; });
  const XE = WINGS_even(Z, med), YE = WINGS_even(Z, XE.map((x, i) => D.y(x + 0.01, Z[i])));
  const sl = (x, z) => Math.max(-0.6, Math.min(0.6, D.sl(x, z)));
  const herm = (y0, m0, y1, m1, t) => { const t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (3 * t2 - 2 * t3) * y1 + (t3 - t2) * m1; };
  const secs = [];
  for (let i = 0; i <= n; i++) {
    const z = Z[i], xe = XE[i], ye = YE[i], top = [];
    if (!lip) {
      const f = WINGS_ss(zEnd, zEnd - fade, Math.abs(z)), xa = xe + L, xb = xe + 0.02, xc = xe - over * f + 0.02 * (1 - f), Dx = xc - xa;
      const yc = f * (ye + h) + (1 - f) * (D.y(xb, z) - e), mc = -Math.tan(kick) * f + (1 - f) * sl(xb, z);
      for (let j = 0; j <= N2; j++) { const t = j / N2; top.push([xa + Dx * t, herm(D.y(xa, z) - e, sl(xa, z) * Dx, yc, mc * Dx, t), z]); }
      const C = top[N2], bx = xe + 0.005, B = [bx, Math.min(D.y(bx, z), ye) - 0.025, z], qx = Math.min(C[0], bx) - 0.003 * f, qy = B[1] + 0.01, back = [];
      for (let j = 0; j <= R; j++) { const t = j / R, a = (1 - t) ** 2, b = 2 * t * (1 - t), c = t * t; back.push([a * C[0] + b * qx + c * B[0], a * C[1] + b * qy + c * B[1], z]); }
      secs.push([top, back, [B, [xa, B[1], z], top[0]]]);
    } else {
      const f = WINGS_ss(zEnd, zEnd - 0.012, Math.abs(z)), xf = xe + fl, xa = xf + L, xc = xe - over, Dx = xc - xf;
      const yf = D.y(xf, z), mf = sl(xf, z), yc = ye + th0 + h * (0.35 + 0.65 * f), mc = -Math.tan(kick), und = [];
      for (let j = 0; j <= N1; j++) { const x = xa + ((xf - xa) * j) / N1, y = D.y(x, z); top.push([x, y + th0, z]); und.push([x, y - e, z]); }
      for (let j = 1; j <= N2; j++) { const t = j / N2, x = xf + Dx * t; top.push([x, herm(yf + th0, mf * Dx, yc, mc * Dx, t), z]); und.push([x + 0.003 * t, herm(yf - e, mf * Dx, yc - thTip, mc * Dx, t), z]); }
      const C = top[top.length - 1], U = und[und.length - 1];
      secs.push([top, [C, U], und.slice().reverse(), [und[0], top[0]]]);
    }
  }
  // 每一條（上面、後面、下面、前緣）各自一組頂點，摺角才會是利的
  const pos = [], idx = [];
  secs[0].forEach((_, k) => {
    const o0 = pos.length / 3, cols = secs[0][k].length;
    for (const sc of secs) for (const p of sc[k]) pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < n; i++) for (let j = 0; j < cols - 1; j++) { const a = o0 + i * cols + j, b = a + cols; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  });
  for (const [sc, flip] of [[secs[0], false], [secs[n], true]]) { // 兩端封起來
    const ring = sc.flatMap((st) => st.slice(0, -1)), o0 = pos.length / 3;
    const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    pos.push(cx, cy, ring[0][2]); for (const p of ring) pos.push(p[0], p[1], p[2]);
    for (let j = 0; j < ring.length; j++) { const a = o0 + 1 + j, b = o0 + 1 + ((j + 1) % ring.length); if (flip) idx.push(o0, a, b); else idx.push(o0, b, a); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  if (mat.userData.sync) m.onBeforeRender = mat.userData.sync;
  return m;
}

// ---- GR Yaris 原廠車頂擾流（跟 yaris-spec.js 的 YARIS_spoiler 一樣）：Yaris 的尾翼都裝在車頂後緣，底下留著它 ----
function WINGS_yarisRoof(mats) {
  const sh = new THREE.Shape();
  sh.moveTo(-1.575, 1.345); sh.lineTo(-1.66, 1.338); sh.lineTo(-1.775, 1.305); sh.lineTo(-1.79, 1.285); sh.lineTo(-1.70, 1.282); sh.lineTo(-1.60, 1.305); sh.closePath();
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.94, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.008, bevelSegments: 2 }), mats.gloss);
  m.geometry.translate(0, 0, -0.47); return m;
}

// ---- 每台車的尺寸（公尺）：gt／swan／double 的翼片中心 x、y、翼展、弦長、支架 z；duck／lip 的後緣找法、半寬、翹多高 ----
const WINGS_CARS = {
  supra: {
    duck: { xs: -1.95, zEnd: 0.74, L: 0.30, over: 0.025, h: 0.07 },
    lip: { xs: -1.95, zEnd: 0.70, L: 0.07, over: 0.03, h: 0.04 },
    swan: { x: -1.97, y: 1.25, span: 1.62, zs: 0.40, xf: -1.70 },
    double: { x: -1.80, y: 1.22, span: 1.70, zs: 0.55 },
  },
  gtr: {
    duck: { xs: -2.00, zEnd: 0.74, L: 0.30, over: 0.025, h: 0.07 },
    lip: { xs: -2.00, zEnd: 0.70, L: 0.07, over: 0.03, h: 0.04 },
    swan: { x: -2.08, y: 1.24, span: 1.60, zs: 0.40, xf: -1.84 },
    double: { x: -1.98, y: 1.22, span: 1.62, zs: 0.55 },
  },
  sp3: {
    duck: { xs: -1.95, zEnd: 0.44, fade: 0.08, L: 0.28, over: 0.05, h: 0.095 }, // 夾在兩邊高起來的葉子板中間；車尾那條尾燈比後緣高、往後凸 7 公分：翹邊要再往後、再高一點才看得到
    lip: { xs: -1.95, zEnd: 0.42, L: 0.07, over: 0.05, h: 0.06 },
    swan: { x: -2.06, y: 1.16, span: 1.60, zs: 0.42, xf: -1.95 },
    double: { x: -1.97, y: 1.17, span: 1.62, zs: 0.55 },
  },
  jesko: {
    gt: { x: -1.98, y: 1.12, span: 1.60, zs: 0.50 },
    duck: { xs: -1.95, zEnd: 0.72, L: 0.26, over: 0.025, h: 0.07 },
    lip: { xs: -1.95, zEnd: 0.68, L: 0.07, over: 0.03, h: 0.04 },
    swan: { x: -2.02, y: 1.14, span: 1.60, zs: 0.36, xf: -1.74 },
    double: { x: -1.95, y: 1.10, span: 1.60, zs: 0.50 },
  },
  p918: {
    gt: { x: -2.06, y: 1.16, span: 1.62, zs: 0.50 },
    duck: { xs: -2.05, zEnd: 0.78, L: 0.26, over: 0.025, h: 0.07 },
    lip: { xs: -2.05, zEnd: 0.74, L: 0.07, over: 0.03, h: 0.04 },
    swan: { x: -2.12, y: 1.16, span: 1.62, zs: 0.40, xf: -1.86 },
    double: { x: -2.04, y: 1.14, span: 1.62, zs: 0.50 },
  },
  gc8: {
    gt: { x: -1.91, y: 1.23, span: 1.46, chord: 0.28, zs: 0.50 },
    duck: { xs: -1.85, zEnd: 0.66, L: 0.26, over: 0.025, h: 0.07 },
    lip: { xs: -1.85, zEnd: 0.62, L: 0.07, over: 0.03, h: 0.04 },
    swan: { x: -1.98, y: 1.22, span: 1.44, chord: 0.28, zs: 0.36, xf: -1.72 },
    double: { x: -1.89, y: 1.21, span: 1.46, chord: 0.26, zs: 0.50 },
  },
  yaris: { // 掀背：沒有行李箱蓋，尾翼裝在車頂後緣（底下留原廠車頂擾流）；小尾翼＝碳纖維車頂擾流；鴨尾不做
    gt: { x: -1.60, y: 1.53, span: 1.36, chord: 0.28, zs: 0.40 },
    lip: { xs: -1.50, zEnd: 0.46, L: 0.07, over: 0.06, h: 0.04 },
    swan: { x: -1.70, y: 1.50, span: 1.36, chord: 0.28, zs: 0.30, xf: -1.46 },
    double: { x: -1.60, y: 1.50, span: 1.36, chord: 0.26, zs: 0.40 },
  },
};

// 回傳這台車多加的尾翼：{ 樣式名: (paint, mats) => Object3D }，併進 spec.wings 就能 setWing(名字)
function extraWings(key) {
  const C = WINGS_CARS[key];
  if (!C || !WINGS_DECK[key]) return {};
  const D = WINGS_deck(key), yaris = key === 'yaris', out = {};
  const wrap = (fn) => (paint, mats) => { const g = fn(paint, mats); if (yaris) g.add(WINGS_yarisRoof(mats)); return g; };
  if (C.gt) out.gt = wrap((paint, mats) => WINGS_gt(D, mats, C.gt));
  if (C.duck) out.duck = (paint) => { const g = new THREE.Group(); g.add(WINGS_edge(D, WINGS_paintLike(paint), C.duck)); return g; };
  if (C.swan) out.swan = wrap((paint, mats) => WINGS_swan(D, mats, C.swan));
  if (C.double) out.double = wrap((paint, mats) => WINGS_double(D, mats, C.double));
  if (C.lip) out.lip = (paint, mats) => { const g = new THREE.Group(); g.add(WINGS_edge(D, mats.carbon, { ...C.lip, lip: true })); return g; };
  return out;
}

// ---- wide.js ----
// 寬體套件的資料（node make-wide.mjs 從車身 SDF 量的，不要手改）：每台車前後輪拱，每個角度 th 從輪拱邊緣 ra 往外每 dr 公尺車身側面的 z（低於 yCut 的點切平在 yCut）
const WIDE = {"supra":{"f":{"x":1.2125,"y":0.325,"th":[-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204],"ra":[0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365],"z":[[0.8213,0.8982,0.896,0.8905,0.8892,0.8882,0.8871,0.8861,0.8849],[0.8298,0.8984,0.896,0.8905,0.8888,0.8878,0.8868,0.8857,0.8845],[0.8472,0.8987,0.8958,0.8903,0.8883,0.8872,0.8861,0.8849,0.8836],[0.8564,0.899,0.8959,0.8903,0.8878,0.8866,0.8854,0.884,0.8825],[0.8647,0.9002,0.8971,0.8917,0.8892,0.8879,0.8865,0.8849,0.8832],[0.8695,0.9026,0.8998,0.895,0.8927,0.8912,0.8895,0.8877,0.8857],[0.8743,0.9056,0.9032,0.8991,0.897,0.8952,0.8933,0.8911,0.8887],[0.877,0.908,0.9057,0.9019,0.8998,0.8978,0.8955,0.8931,0.8905],[0.8798,0.9092,0.9068,0.903,0.9007,0.8985,0.8962,0.8936,0.8908],[0.7698,0.9096,0.907,0.9031,0.9006,0.8982,0.8956,0.8928,0.8898],[0.7688,0.9094,0.9066,0.9023,0.8994,0.8965,0.8934,0.8902,0.8868],[0.7678,0.9085,0.9053,0.9002,0.8964,0.8928,0.889,0.8849,0.8804],[0.8767,0.9068,0.9029,0.8965,0.8915,0.887,0.8821,0.8764,0.8699],[0.8756,0.9043,0.8997,0.8917,0.8852,0.8794,0.8727,0.8647,0.8546],[0.8721,0.9017,0.8963,0.8863,0.8776,0.87,0.8609,0.8493,0.8333],[0.8687,0.8992,0.8931,0.8806,0.8692,0.8595,0.8473,0.8305,0.8046],[0.8652,0.8971,0.8903,0.875,0.8608,0.8488,0.833,0.8093,0.772],[0.863,0.8955,0.8881,0.8698,0.8533,0.8393,0.82,0.7908,0.7458],[0.8601,0.8943,0.8865,0.8661,0.8488,0.8343,0.8145,0.785,0.7409],[0.8587,0.8938,0.8859,0.8653,0.8485,0.835,0.8172,0.7926,0.7565],[0.8591,0.894,0.8863,0.8671,0.8521,0.8407,0.8269,0.8087,0.7831],[0.8612,0.8948,0.8875,0.8707,0.8577,0.8483,0.8374,0.8241,0.8069],[0.8639,0.8959,0.8892,0.8747,0.8636,0.8561,0.8476,0.8377,0.8261],[0.8668,0.8975,0.8913,0.8788,0.8695,0.8634,0.8568,0.8495,0.8412],[0.8697,0.8993,0.8938,0.8832,0.8753,0.8702,0.8649,0.8592,0.8532],[0.8723,0.9013,0.8964,0.8876,0.8811,0.8766,0.872,0.8675,0.8628],[0.8739,0.903,0.8988,0.8915,0.8863,0.8824,0.8785,0.8746,0.8707],[0.8746,0.9042,0.9006,0.8946,0.8905,0.8873,0.884,0.8806,0.8773],[0.8745,0.9048,0.9016,0.8962,0.893,0.8904,0.8877,0.885,0.8822],[0.8744,0.9049,0.9019,0.8968,0.894,0.8918,0.8896,0.8872,0.8849],[0.8744,0.9046,0.9017,0.8968,0.8941,0.8921,0.8901,0.888,0.8858],[0.8734,0.9037,0.9008,0.8959,0.8933,0.8915,0.8896,0.8877,0.8857],[0.8711,0.9018,0.8989,0.8936,0.8911,0.8895,0.8879,0.8862,0.8844],[0.867,0.8993,0.8959,0.8897,0.8868,0.8856,0.8842,0.8829,0.8815],[0.8614,0.8966,0.8925,0.8846,0.8811,0.8827,0.8824,0.8818,0.881],[0.8542,0.894,0.8889,0.8786,0.8763,0.8812,0.8821,0.8819,0.8817],[0.8464,0.892,0.886,0.8738,0.8736,0.8816,0.8837,0.8839,0.884],[0.838,0.8906,0.8835,0.8678,0.8719,0.8815,0.884,0.884,0.884],[0.834,0.89,0.8826,0.8657,0.8714,0.8815,0.884,0.884,0.884]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1765,"zt":0.8775},"r":{"x":-1.3375,"y":0.325,"th":[-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204],"ra":[0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365,0.365],"z":[[0.8386,0.9028,0.8945,0.8723,0.876,0.8826,0.884,0.884,0.884],[0.8443,0.9033,0.8955,0.8758,0.8766,0.8826,0.884,0.884,0.884],[0.8564,0.9048,0.8985,0.8846,0.8812,0.8841,0.8846,0.8842,0.884],[0.8675,0.9075,0.9025,0.8923,0.8882,0.8891,0.8888,0.8881,0.8875],[0.8775,0.9114,0.9078,0.9012,0.8983,0.8973,0.8963,0.8952,0.8943],[0.8854,0.9159,0.9135,0.9094,0.9077,0.9068,0.9059,0.9048,0.9036],[0.8918,0.9207,0.9192,0.9166,0.9156,0.9146,0.9136,0.9124,0.9111],[0.8958,0.9251,0.924,0.9224,0.9213,0.9202,0.9188,0.9172,0.9155],[0.8976,0.9286,0.9276,0.926,0.9246,0.923,0.9213,0.9195,0.9174],[0.7818,0.9307,0.9294,0.9277,0.9259,0.9239,0.9221,0.92,0.9177],[0.7844,0.9316,0.93,0.9282,0.9262,0.9239,0.9218,0.9195,0.9169],[0.7871,0.9318,0.9299,0.9279,0.9256,0.9231,0.9204,0.9175,0.9142],[0.9057,0.9315,0.9294,0.9268,0.9239,0.9207,0.9172,0.9133,0.909],[0.9053,0.9307,0.928,0.9244,0.9207,0.9165,0.9119,0.9069,0.9014],[0.9035,0.9291,0.9257,0.9209,0.9162,0.911,0.9053,0.899,0.8922],[0.9018,0.927,0.9228,0.9168,0.911,0.9047,0.8978,0.8903,0.882],[0.8997,0.9248,0.9199,0.9127,0.9057,0.8984,0.8904,0.8814,0.8715],[0.8985,0.9227,0.9173,0.909,0.9008,0.8926,0.8834,0.8731,0.8617],[0.8969,0.9211,0.9153,0.906,0.8968,0.8879,0.8777,0.8663,0.8536],[0.8961,0.9204,0.9145,0.9048,0.8952,0.886,0.8754,0.8635,0.8502],[0.8964,0.9207,0.9149,0.9055,0.8963,0.8873,0.877,0.8653,0.8523],[0.8976,0.922,0.9166,0.9081,0.8998,0.8915,0.8822,0.8716,0.8597],[0.8993,0.9238,0.9189,0.9114,0.9043,0.897,0.8889,0.8797,0.8694],[0.901,0.9257,0.9214,0.9152,0.9093,0.903,0.8961,0.8884,0.8798],[0.9025,0.9275,0.9239,0.9189,0.9141,0.9088,0.903,0.8967,0.8898],[0.9033,0.9288,0.926,0.922,0.9182,0.9139,0.9092,0.9041,0.8986],[0.9037,0.9295,0.9271,0.924,0.921,0.9177,0.9139,0.9099,0.9055],[0.9036,0.9296,0.9275,0.9249,0.9224,0.9196,0.9166,0.9135,0.91],[0.9008,0.9294,0.9274,0.925,0.9228,0.9203,0.9177,0.9151,0.9122],[0.898,0.9284,0.9267,0.9245,0.9225,0.9202,0.9178,0.9155,0.9128],[0.8952,0.9263,0.9248,0.9226,0.9209,0.919,0.9169,0.9147,0.9123],[0.8913,0.9229,0.9213,0.9188,0.9174,0.9159,0.9142,0.9122,0.9101],[0.8874,0.9187,0.9166,0.9131,0.9115,0.9102,0.9087,0.907,0.9051],[0.881,0.9142,0.9113,0.9061,0.9037,0.9024,0.9009,0.8992,0.8974],[0.8751,0.9101,0.9061,0.8982,0.8945,0.8931,0.8915,0.8897,0.8877],[0.8652,0.9067,0.9012,0.8896,0.8844,0.8828,0.8811,0.8792,0.8771],[0.8544,0.9044,0.8972,0.8802,0.8739,0.8721,0.8702,0.8681,0.8659],[0.8318,0.9031,0.8943,0.868,0.8611,0.8582,0.8557,0.8539,0.852],[0.8209,0.9027,0.8931,0.8618,0.8548,0.8513,0.8484,0.8467,0.8449]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1765,"zt":0.8975},"dr":0.02},"gtr":{"f":{"x":1.29,"y":0.327,"th":[-30,-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204,210],"ra":[0.377,0.3758,0.375,0.374,0.373,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372],"z":[[0.8534,0.8628,0.848,0.8404,0.8351,0.8321,0.831,0.8296,0.8279],[0.8595,0.8699,0.8539,0.8451,0.8411,0.8387,0.8375,0.8362,0.8347],[0.8718,0.8854,0.8679,0.8584,0.8569,0.855,0.8481,0.8466,0.8451],[0.8709,0.89,0.8802,0.8733,0.8722,0.8699,0.8506,0.8495,0.849],[0.87,0.8951,0.8908,0.8874,0.8868,0.8843,0.8483,0.8485,0.8493],[0.8707,0.8988,0.8967,0.8957,0.8956,0.8937,0.847,0.8453,0.8462],[0.8723,0.8997,0.8979,0.8971,0.897,0.896,0.8619,0.843,0.8459],[0.8739,0.8997,0.898,0.8972,0.8971,0.8968,0.8796,0.8592,0.8594],[0.874,0.8998,0.8981,0.8973,0.8972,0.8971,0.8964,0.8782,0.8781],[0.874,0.8998,0.8981,0.8973,0.8972,0.8971,0.897,0.8963,0.8943],[0.874,0.8998,0.8981,0.8973,0.8972,0.8971,0.897,0.8969,0.8965],[0.874,0.8998,0.8981,0.8973,0.8972,0.8971,0.897,0.8968,0.8966],[0.874,0.8997,0.898,0.8972,0.8972,0.897,0.8967,0.8958,0.8942],[0.8739,0.8997,0.8979,0.8971,0.8965,0.8951,0.8928,0.8894,0.8851],[0.8738,0.8996,0.8974,0.8953,0.8925,0.8884,0.8832,0.8768,0.8695],[0.871,0.8989,0.8952,0.8899,0.884,0.8769,0.8691,0.8606,0.851],[0.8682,0.8972,0.8908,0.8809,0.8724,0.8639,0.8552,0.8457,0.8318],[0.8655,0.8944,0.885,0.8709,0.8617,0.8534,0.8446,0.8325,0.79],[0.8636,0.8916,0.8796,0.8627,0.8542,0.8464,0.8368,0.8198,0.7248],[0.8598,0.8894,0.8757,0.8574,0.8499,0.8429,0.8329,0.8137,0.6985],[0.8577,0.8887,0.8743,0.8554,0.8487,0.8426,0.8333,0.8158,0.725],[0.8595,0.8893,0.8754,0.8566,0.8499,0.8446,0.8375,0.8255,0.7869],[0.8647,0.8913,0.879,0.8614,0.8535,0.848,0.8426,0.8349,0.8216],[0.8683,0.8941,0.8843,0.8695,0.8602,0.8531,0.8477,0.8423,0.8353],[0.871,0.8967,0.8901,0.8796,0.8706,0.8622,0.8551,0.8494,0.8441],[0.872,0.8983,0.8944,0.8888,0.8825,0.875,0.8672,0.8601,0.854],[0.873,0.8989,0.8966,0.8942,0.8913,0.8869,0.8813,0.8749,0.8683],[0.873,0.8989,0.897,0.896,0.8954,0.8939,0.8915,0.8878,0.8825],[0.873,0.8989,0.897,0.8961,0.896,0.8959,0.8956,0.8946,0.8916],[0.873,0.8989,0.897,0.8961,0.896,0.896,0.8958,0.8957,0.8935],[0.873,0.8989,0.897,0.8961,0.8961,0.896,0.8954,0.8938,0.8898],[0.873,0.8989,0.897,0.8961,0.8961,0.8952,0.8928,0.8883,0.8817],[0.873,0.8989,0.897,0.8961,0.8954,0.8926,0.8872,0.8793,0.8707],[0.8729,0.8989,0.897,0.8958,0.8935,0.888,0.8796,0.8701,0.8618],[0.8712,0.8989,0.8969,0.8951,0.8908,0.8829,0.8728,0.8633,0.8568],[0.8695,0.8979,0.8957,0.8928,0.887,0.8779,0.8676,0.8636,0.8607],[0.8538,0.8944,0.8897,0.8839,0.8779,0.8697,0.8631,0.866,0.8661],[0.8398,0.8896,0.8793,0.8695,0.865,0.8601,0.8602,0.8696,0.872],[0.8247,0.8856,0.8675,0.8548,0.8521,0.8499,0.8545,0.8675,0.8716],[0.8207,0.8693,0.8533,0.8423,0.8388,0.8365,0.8408,0.8511,0.8607],[0.8181,0.8618,0.8471,0.8381,0.8336,0.83,0.8319,0.8418,0.8551]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1385,"zt":0.8625},"r":{"x":-1.375,"y":0.327,"th":[-30,-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204,210],"ra":[0.377,0.3758,0.375,0.374,0.373,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372,0.372],"z":[[0.852,0.8615,0.8456,0.8403,0.8455,0.8591,0.8679,0.8687,0.8687],[0.8586,0.8693,0.8537,0.8476,0.8533,0.8633,0.8693,0.8698,0.8698],[0.8718,0.8863,0.8698,0.8636,0.8697,0.8725,0.872,0.872,0.872],[0.8718,0.8921,0.8842,0.8793,0.8811,0.8813,0.8793,0.8771,0.8743],[0.8718,0.8988,0.8957,0.8934,0.8929,0.892,0.8888,0.8846,0.8788],[0.8745,0.9036,0.9026,0.9023,0.9022,0.9018,0.8989,0.893,0.8847],[0.8773,0.9052,0.9045,0.9044,0.9043,0.9041,0.9023,0.8976,0.8903],[0.8801,0.9053,0.9046,0.9045,0.9044,0.9043,0.9036,0.9009,0.8955],[0.8802,0.9053,0.9047,0.9045,0.9044,0.9044,0.9042,0.9031,0.9003],[0.8802,0.9054,0.9047,0.9045,0.9045,0.9044,0.9043,0.9041,0.9031],[0.8803,0.9054,0.9047,0.9046,0.9045,0.9044,0.9043,0.9041,0.904],[0.8803,0.9054,0.9047,0.9045,0.9044,0.9043,0.9042,0.9041,0.904],[0.8803,0.9054,0.9047,0.9045,0.9044,0.9042,0.9041,0.904,0.9038],[0.8803,0.9053,0.9046,0.9044,0.9043,0.9041,0.9039,0.9035,0.9025],[0.8803,0.9053,0.9046,0.9043,0.9041,0.9037,0.9024,0.9002,0.8967],[0.8802,0.9052,0.9045,0.9041,0.9032,0.9011,0.8974,0.8921,0.885],[0.8801,0.9052,0.9043,0.903,0.9002,0.8953,0.8882,0.8794,0.8696],[0.8801,0.9051,0.9034,0.9003,0.8947,0.8866,0.8766,0.8659,0.8555],[0.8801,0.9047,0.9018,0.8961,0.8878,0.8774,0.866,0.855,0.8452],[0.8801,0.9042,0.8996,0.8918,0.8817,0.8701,0.8584,0.8479,0.839],[0.8801,0.904,0.8989,0.8903,0.8797,0.8677,0.856,0.8458,0.8371],[0.8802,0.9044,0.8998,0.892,0.882,0.8704,0.8588,0.8484,0.8394],[0.8803,0.905,0.9021,0.8965,0.8883,0.878,0.8668,0.8558,0.8461],[0.8804,0.9054,0.9038,0.9008,0.8953,0.8873,0.8775,0.8669,0.8566],[0.8806,0.9056,0.9048,0.9036,0.9008,0.8961,0.8891,0.8804,0.8708],[0.8807,0.9058,0.9051,0.9048,0.9039,0.9019,0.8983,0.8931,0.8861],[0.8809,0.9059,0.9053,0.9051,0.9049,0.9045,0.9033,0.9011,0.8976],[0.881,0.9061,0.9055,0.9053,0.9051,0.905,0.9048,0.9044,0.9033],[0.8811,0.9061,0.9056,0.9054,0.9053,0.9051,0.905,0.9048,0.9046],[0.8811,0.9062,0.9056,0.9055,0.9054,0.9052,0.9051,0.9049,0.9047],[0.8812,0.9062,0.9056,0.9055,0.9054,0.9053,0.9051,0.9049,0.9048],[0.8811,0.9062,0.9056,0.9055,0.9054,0.9052,0.9051,0.9049,0.9048],[0.881,0.9061,0.9056,0.9055,0.9053,0.9052,0.9051,0.9049,0.9047],[0.881,0.9061,0.9055,0.9054,0.9053,0.9051,0.905,0.9048,0.9047],[0.7973,0.906,0.9054,0.9053,0.9052,0.905,0.9049,0.9047,0.9044],[0.7813,0.9044,0.9035,0.9032,0.9031,0.9029,0.9027,0.9026,0.9021],[0.7654,0.8996,0.8968,0.8946,0.894,0.8934,0.8928,0.8922,0.8913],[0.833,0.8928,0.8858,0.8793,0.878,0.8769,0.8759,0.8748,0.8735],[0.7654,0.8872,0.8734,0.8622,0.8605,0.8589,0.8572,0.8554,0.8533],[0.6977,0.8704,0.8573,0.8458,0.8409,0.8373,0.8358,0.8342,0.8325],[0.63,0.8628,0.8498,0.839,0.8328,0.8282,0.8267,0.8251,0.8233]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1385,"zt":0.8675},"dr":0.02},"sp3":{"f":{"x":1.21,"y":0.3335,"th":[-30,-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204,210],"ra":[0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985,0.3985],"z":[[0.9743,0.9808,0.5704,0.5628,0.5548,0.5488,0.5458,0.5431,0.5407],[0.9762,0.9818,0.7044,0.6975,0.6911,0.6858,0.6824,0.6788,0.6751],[0.9817,0.9868,0.8523,0.8477,0.8438,0.8396,0.8352,0.8306,0.8253],[0.9899,0.9948,0.9892,0.9863,0.9839,0.9813,0.9783,0.9747,0.9705],[0.9963,1.0018,0.9996,0.9981,0.9964,0.9945,0.9923,0.9898,0.9868],[0.9991,1.0049,1.0036,1.0025,1.0011,0.9996,0.9977,0.9956,0.993],[0.9993,1.0053,1.0041,1.003,1.0017,1.0003,0.9986,0.9966,0.9943],[0.9997,1.0057,1.0046,1.0037,1.0026,1.0013,0.9997,0.9978,0.9953],[1,1.0062,1.0053,1.0042,1.0032,1.0021,1.0006,0.9986,0.996],[1.0003,1.0065,1.0057,1.0045,1.0036,1.0025,1.001,0.9989,0.996],[1.0004,1.0067,1.0059,1.0045,1.003,1.001,0.9985,0.9952,0.9911],[1.0003,1.006,1.0041,1.0014,0.9982,0.9942,0.9894,0.9838,0.9776],[0.9983,1.0026,0.9981,0.993,0.9869,0.9799,0.9721,0.9634,0.9541],[0.9938,0.9963,0.9872,0.9783,0.9693,0.9594,0.9488,0.9375,0.9254],[0.9872,0.9883,0.9724,0.9604,0.949,0.9368,0.9239,0.91,0.8949],[0.981,0.9818,0.9562,0.9423,0.929,0.9148,0.8995,0.8826,0.8631],[0.9768,0.9783,0.9405,0.9258,0.9108,0.8946,0.8767,0.8556,0.8471],[0.9748,0.977,0.9272,0.9119,0.8954,0.8772,0.8561,0.8289,0.8289],[0.9742,0.9769,0.9175,0.9012,0.8835,0.8635,0.8395,0.8156,0.8156],[0.9742,0.9769,0.9136,0.8971,0.879,0.8587,0.8341,0.8341,0.8341],[0.9742,0.9769,0.9157,0.8997,0.8824,0.863,0.8401,0.8197,0.8197],[0.9743,0.9769,0.9237,0.9089,0.8931,0.8758,0.8563,0.832,0.832],[0.9753,0.9774,0.9349,0.9212,0.907,0.8917,0.8751,0.8564,0.8496],[0.9774,0.9791,0.9483,0.9354,0.9229,0.9097,0.8956,0.8803,0.8634],[0.9808,0.9825,0.962,0.9504,0.9398,0.9286,0.9167,0.9041,0.8906],[0.9843,0.9869,0.9739,0.9646,0.9562,0.9471,0.9373,0.9269,0.9157],[0.987,0.9906,0.9822,0.9758,0.9698,0.963,0.9556,0.9473,0.9382],[0.9883,0.9928,0.987,0.983,0.979,0.9744,0.969,0.963,0.9562],[0.9888,0.9938,0.989,0.9862,0.9836,0.9806,0.977,0.9729,0.9683],[0.9888,0.994,0.9897,0.9872,0.9852,0.9829,0.9802,0.9772,0.9739],[0.9885,0.9937,0.9894,0.9872,0.9855,0.9835,0.9811,0.9785,0.9756],[0.988,0.9931,0.9887,0.9865,0.9848,0.9829,0.9806,0.9782,0.9756],[0.9872,0.9923,0.9875,0.9853,0.9836,0.9816,0.9795,0.9772,0.9748],[0.9865,0.9915,0.9862,0.9837,0.9818,0.9798,0.9777,0.9756,0.9735],[0.986,0.9908,0.9852,0.9825,0.9805,0.9784,0.9762,0.974,0.9717],[0.9856,0.9904,0.9845,0.9817,0.9796,0.9774,0.9752,0.9729,0.9706],[0.9837,0.9882,0.9807,0.9772,0.9748,0.9722,0.9697,0.9671,0.9645],[0.9801,0.984,0.9699,0.9654,0.9623,0.9591,0.9558,0.9525,0.9492],[0.9764,0.9809,0.8434,0.8394,0.8367,0.8341,0.8316,0.8292,0.8269],[0.9743,0.9797,0.7022,0.6972,0.6925,0.6894,0.6889,0.6888,0.6892],[0.9742,0.9808,0.5773,0.5727,0.5677,0.5651,0.5667,0.5687,0.5714]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,8,8,7,8,8,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1342,"zt":0.978},"r":{"x":-1.441,"y":0.37,"th":[-30,-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204,210],"ra":[0.4333,0.4325,0.432,0.431,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.43,0.431,0.432,0.433,0.434,0.435,0.435,0.435,0.435,0.435,0.435,0.435],"z":[[0.9737,0.9807,0.8988,0.8928,0.8864,0.8796,0.8784,0.8775,0.8762],[0.9728,0.9802,0.9117,0.9064,0.901,0.8954,0.8933,0.8915,0.8893],[0.971,0.9801,0.9358,0.9314,0.9283,0.925,0.9216,0.9182,0.9146],[0.9586,0.9799,0.951,0.9464,0.9442,0.9419,0.9395,0.9369,0.9341],[0.9476,0.9803,0.9584,0.9534,0.9518,0.9503,0.9486,0.9467,0.9446],[0.939,0.9807,0.9612,0.9563,0.9552,0.954,0.9528,0.9514,0.9498],[0.9409,0.9819,0.9664,0.9622,0.9616,0.9609,0.9602,0.9594,0.9585],[0.9425,0.9847,0.9747,0.9719,0.972,0.9721,0.9721,0.9721,0.9719],[0.953,0.9897,0.9847,0.9838,0.9846,0.9854,0.986,0.9866,0.987],[0.9663,0.9965,0.9952,0.996,0.9972,0.9983,0.9993,1,1.0006],[0.9824,1.0045,1.0052,1.0067,1.008,1.0091,1.0098,1.0103,1.0104],[0.9902,1.0122,1.0137,1.015,1.0159,1.0164,1.0165,1.0161,1.0154],[0.9968,1.0184,1.0196,1.0203,1.0204,1.02,1.0195,1.0184,1.017],[1.0005,1.0224,1.0229,1.0227,1.0222,1.0212,1.0202,1.0188,1.0169],[1.0021,1.0243,1.0241,1.0234,1.0226,1.0212,1.0198,1.018,1.0155],[1.003,1.0248,1.0244,1.0234,1.0222,1.0204,1.0183,1.0152,1.0107],[1.004,1.0248,1.0241,1.0227,1.0209,1.0183,1.0145,1.009,1.0013],[1.0049,1.0245,1.0232,1.0212,1.0184,1.0143,1.0083,0.9998,0.9885],[1.0046,1.0236,1.0217,1.0189,1.0149,1.0088,1.0002,0.9888,0.9744],[1.0033,1.0222,1.0197,1.0163,1.0109,1.003,0.9923,0.9795,0.9641],[1.0021,1.0206,1.0178,1.0138,1.0075,0.9989,0.988,0.9753,0.9604],[0.9999,1.019,1.0159,1.0118,1.0053,0.9973,0.9877,0.9764,0.9635],[0.9986,1.0172,1.0142,1.0102,1.0043,0.9973,0.9896,0.9805,0.9696],[0.9965,1.0152,1.0124,1.0087,1.0037,0.9976,0.9909,0.9833,0.9744],[0.9927,1.0127,1.0102,1.0069,1.0026,0.9972,0.9912,0.9845,0.9769],[0.9889,1.0094,1.0071,1.0042,1.0005,0.996,0.9905,0.9842,0.9774],[0.9838,1.0049,1.0026,1.0001,0.9969,0.9929,0.9881,0.9824,0.976],[0.979,0.9993,0.9962,0.9937,0.9908,0.9872,0.9829,0.9778,0.9721],[0.9701,0.9928,0.9875,0.9842,0.9816,0.9783,0.9743,0.9697,0.9645],[0.9664,0.9866,0.9759,0.9712,0.9687,0.9656,0.962,0.9578,0.953],[0.9668,0.9821,0.9603,0.9553,0.9525,0.9494,0.9458,0.9418,0.9374],[0.9721,0.9796,0.9421,0.9374,0.934,0.9303,0.9264,0.9223,0.9178],[0.975,0.9784,0.9231,0.9188,0.9145,0.9101,0.9055,0.9007,0.8956],[0.9764,0.9774,0.9066,0.9015,0.8962,0.8908,0.8852,0.8794,0.8732],[0.977,0.9762,0.8936,0.8875,0.8813,0.8749,0.8683,0.8614,0.8542],[0.977,0.9754,0.8858,0.8791,0.8722,0.8652,0.8578,0.8501,0.842],[0.977,0.9749,0.8822,0.8749,0.8673,0.8594,0.851,0.842,0.8329],[0.977,0.9749,0.8209,0.814,0.8067,0.7987,0.7898,0.7799,0.8301],[0.977,0.9766,0.7292,0.7222,0.7146,0.7679,0.7585,0.7478,0.7478],[0.977,0.9783,0.6156,0.6065,0.5911,0.5911,0.5911,0.5911,0.5911],[0.977,0.9799,0.5736,0.5627,0.5428,0.5428,0.5428,0.5428,0.5428]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,8,5,5],"yCut":0.1525,"zt":0.988},"dr":0.02},"jesko":{"f":{"x":1.35,"y":0.347,"th":[-30,-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204,210],"ra":[0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377,0.377],"z":[[0.9317,0.9411,0.9366,0.9313,0.9267,0.9222,0.9179,0.9138,0.9091],[0.9333,0.9426,0.938,0.9327,0.9276,0.9224,0.9173,0.9121,0.9063],[0.9361,0.9451,0.9404,0.9351,0.9293,0.9229,0.9167,0.9103,0.9033],[0.9374,0.9461,0.941,0.9355,0.9294,0.9228,0.9157,0.9078,0.899],[0.9383,0.9468,0.9415,0.9356,0.9291,0.922,0.9142,0.9056,0.896],[0.9395,0.9479,0.9426,0.9365,0.9297,0.9222,0.9139,0.9048,0.8947],[0.9412,0.9498,0.9447,0.9387,0.9319,0.9243,0.916,0.907,0.8972],[0.9434,0.9524,0.9478,0.9424,0.9362,0.9293,0.9217,0.9135,0.9045],[0.946,0.9554,0.9515,0.9468,0.9415,0.9356,0.929,0.9217,0.9136],[0.9486,0.9586,0.9553,0.9515,0.947,0.9416,0.9353,0.928,0.9202],[0.9509,0.9614,0.9583,0.9545,0.9505,0.9454,0.9391,0.9315,0.9236],[0.9524,0.9631,0.96,0.956,0.9521,0.9469,0.9402,0.9318,0.9229],[0.9531,0.9638,0.9606,0.9559,0.9512,0.9448,0.9367,0.9265,0.9143],[0.9529,0.9632,0.9591,0.9533,0.9462,0.9368,0.9243,0.9238,0.9097],[0.9513,0.9606,0.9544,0.9457,0.9338,0.9167,0.9163,0.9163,0.9163],[0.9471,0.9547,0.9446,0.9303,0.9091,0.9047,0.9047,0.9047,0.9047],[0.9399,0.9448,0.9291,0.9053,0.8951,0.8951,0.8951,0.8951,0.8951],[0.9303,0.9316,0.9074,0.8913,0.8913,0.8913,0.8913,0.8913,0.8913],[0.9192,0.9157,0.8817,0.8817,0.8817,0.8817,0.8817,0.8817,0.8817],[0.9078,0.899,0.8553,0.8553,0.8553,0.8553,0.8553,0.8553,0.8553],[0.9014,0.889,0.8394,0.8394,0.8394,0.8394,0.8394,0.8394,0.8394],[0.9029,0.8912,0.841,0.841,0.841,0.841,0.841,0.841,0.841],[0.9124,0.9052,0.8611,0.8611,0.8611,0.8611,0.8611,0.8611,0.8611],[0.9247,0.9236,0.8909,0.8909,0.8909,0.8909,0.8909,0.8909,0.8909],[0.9362,0.9401,0.919,0.9078,0.9078,0.9078,0.9078,0.9078,0.9078],[0.9455,0.9529,0.941,0.9214,0.9184,0.9184,0.9184,0.9184,0.9184],[0.9515,0.9612,0.9547,0.9452,0.9303,0.9329,0.9329,0.9329,0.9329],[0.9544,0.9651,0.9616,0.957,0.9505,0.9412,0.9449,0.9347,0.9191],[0.9551,0.9663,0.9641,0.9617,0.9585,0.9543,0.9489,0.9416,0.9304],[0.9549,0.9661,0.9644,0.9628,0.9607,0.9583,0.9558,0.9527,0.9487],[0.9543,0.9656,0.964,0.9624,0.9605,0.9586,0.957,0.9552,0.9529],[0.9534,0.9648,0.9633,0.9617,0.96,0.9582,0.9566,0.9549,0.9529],[0.9524,0.9637,0.9622,0.9606,0.959,0.9574,0.9559,0.9543,0.9526],[0.9513,0.9626,0.9611,0.9595,0.9579,0.9563,0.9548,0.9533,0.9519],[0.9502,0.9615,0.96,0.9584,0.9568,0.9552,0.9538,0.9523,0.951],[0.9492,0.9604,0.9589,0.9573,0.9558,0.9543,0.9528,0.9514,0.9502],[0.948,0.9593,0.9578,0.9562,0.9546,0.9531,0.9517,0.9504,0.9492],[0.9464,0.9577,0.9561,0.9545,0.9529,0.9513,0.9498,0.9484,0.9471],[0.9438,0.955,0.9533,0.9514,0.9496,0.9478,0.946,0.9442,0.9425],[0.9394,0.9503,0.948,0.9455,0.9426,0.9409,0.9393,0.9377,0.9362],[0.9369,0.9477,0.9451,0.9421,0.9387,0.9369,0.9354,0.9338,0.9322]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,7,6,5,4,3,3,3,3,3,3,4,5,6,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1585,"zt":0.9825},"r":{"x":-1.35,"y":0.364,"th":[-30,-24,-18,-12,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204,210],"ra":[0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399,0.399],"z":[[0.9513,0.9581,0.9548,0.951,0.9502,0.9495,0.949,0.948,0.9466],[0.9513,0.9581,0.9548,0.951,0.9514,0.9513,0.9508,0.9496,0.9479],[0.9414,0.9518,0.9511,0.9509,0.9538,0.9548,0.9544,0.9529,0.9507],[0.928,0.9337,0.9298,0.9311,0.9339,0.9357,0.9365,0.937,0.9371],[0.932,0.9352,0.9201,0.9187,0.9202,0.924,0.9325,0.9388,0.9405],[0.9496,0.9493,0.9318,0.9274,0.9268,0.9291,0.9359,0.9407,0.944],[0.9705,0.975,0.9613,0.9557,0.9533,0.9533,0.9571,0.9585,0.9611],[0.9741,0.9812,0.979,0.9765,0.9738,0.97,0.9646,0.9582,0.9566],[0.9735,0.9805,0.9781,0.9752,0.9716,0.9668,0.9601,0.9513,0.9424],[0.972,0.9786,0.9755,0.9714,0.9662,0.959,0.949,0.9344,0.9128],[0.9694,0.9752,0.9707,0.9647,0.9564,0.9451,0.929,0.9055,0.8668],[0.966,0.9708,0.9644,0.9558,0.9441,0.9277,0.9044,0.8699,0.7655],[0.9623,0.9658,0.9575,0.9462,0.9309,0.9094,0.8794,0.8273,0.6614],[0.9587,0.9611,0.9509,0.9374,0.919,0.8935,0.8584,0.7844,0.5625],[0.9561,0.9577,0.9465,0.9318,0.9125,0.8861,0.8501,0.7706,0.5134],[0.9557,0.9572,0.946,0.9315,0.913,0.8883,0.8549,0.787,0.4695],[0.9574,0.9595,0.9493,0.9364,0.9202,0.8993,0.8715,0.827,0.5705],[0.9605,0.9637,0.9554,0.9445,0.9309,0.9138,0.8916,0.8611,0.7027],[0.9638,0.9683,0.9619,0.9534,0.9427,0.9293,0.9125,0.8908,0.86],[0.967,0.9724,0.9677,0.9617,0.9539,0.9442,0.932,0.9167,0.8974],[0.9697,0.9758,0.9723,0.9681,0.9629,0.9563,0.9482,0.9381,0.9256],[0.9719,0.9784,0.9756,0.9724,0.9688,0.9645,0.9593,0.953,0.9453],[0.9732,0.9801,0.9776,0.9749,0.972,0.9689,0.9653,0.9611,0.9563],[0.9738,0.9808,0.9786,0.9761,0.9735,0.9706,0.9675,0.964,0.9604],[0.9739,0.981,0.9788,0.9765,0.9739,0.9711,0.968,0.9646,0.961],[0.9738,0.9808,0.9787,0.9763,0.9737,0.9708,0.9676,0.9641,0.9603],[0.9733,0.9803,0.9781,0.9756,0.9728,0.9697,0.9662,0.9624,0.9581],[0.9725,0.9794,0.9769,0.9742,0.971,0.9675,0.9635,0.959,0.9539],[0.9713,0.978,0.9753,0.9722,0.9687,0.9646,0.96,0.9547,0.9486],[0.9699,0.9765,0.9736,0.9702,0.9663,0.9618,0.9565,0.9505,0.9437],[0.9684,0.9749,0.9719,0.9683,0.9642,0.9594,0.9539,0.9475,0.9405],[0.9669,0.9733,0.9703,0.9667,0.9626,0.9578,0.9523,0.946,0.9391],[0.9649,0.9714,0.9684,0.9649,0.961,0.9564,0.9512,0.9452,0.9388],[0.9618,0.9684,0.9654,0.962,0.9582,0.9539,0.9491,0.9436,0.9377],[0.9568,0.9632,0.9599,0.9562,0.9521,0.9488,0.9452,0.9411,0.9366],[0.9539,0.9602,0.9567,0.9529,0.9486,0.9458,0.9427,0.9392,0.9355]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1645,"zt":0.9875},"dr":0.02},"gc8":{"f":{"x":1.28,"y":0.307,"th":[-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198],"ra":[0.362,0.3608,0.36,0.359,0.358,0.356,0.355,0.354,0.353,0.352,0.352,0.351,0.35,0.349,0.348,0.347,0.347,0.347,0.347,0.347,0.347,0.347,0.348,0.349,0.35,0.351,0.352,0.352,0.353,0.354,0.355,0.356,0.358,0.359,0.36,0.3608,0.362],"z":[[0.8479,0.8507,0.8244,0.8197,0.8182,0.8164,0.8141,0.8114,0.8081],[0.8484,0.8506,0.826,0.8213,0.82,0.8183,0.8162,0.8136,0.8104],[0.8494,0.8506,0.8289,0.8243,0.8232,0.8218,0.82,0.8178,0.8149],[0.8499,0.8509,0.8308,0.8261,0.8251,0.8238,0.822,0.8199,0.8171],[0.8501,0.8513,0.8321,0.8273,0.8264,0.8252,0.8237,0.8217,0.8193],[0.8499,0.8517,0.833,0.8281,0.8274,0.8264,0.8251,0.8235,0.8214],[0.8498,0.8517,0.8335,0.8288,0.8282,0.8274,0.8263,0.825,0.8234],[0.8497,0.8518,0.8338,0.8292,0.8287,0.828,0.8272,0.8262,0.8249],[0.8505,0.8518,0.834,0.8294,0.8289,0.8283,0.8276,0.8267,0.8257],[0.8511,0.8518,0.834,0.8294,0.829,0.8284,0.8277,0.8269,0.826],[0.8517,0.8516,0.8338,0.8294,0.8289,0.8283,0.8277,0.8269,0.826],[0.8516,0.8515,0.8337,0.8293,0.8287,0.8281,0.8274,0.8266,0.8253],[0.8514,0.8515,0.8334,0.8291,0.8284,0.8277,0.8267,0.8252,0.8229],[0.851,0.8518,0.8334,0.8288,0.828,0.8269,0.8251,0.8223,0.8179],[0.8503,0.852,0.8332,0.8285,0.8274,0.8256,0.8225,0.8177,0.8105],[0.8497,0.8521,0.8331,0.828,0.8264,0.8236,0.819,0.8122,0.8015],[0.8493,0.852,0.8328,0.8274,0.8251,0.8213,0.8155,0.8066,0.7921],[0.8493,0.8518,0.8325,0.8268,0.8242,0.8199,0.8134,0.8036,0.7875],[0.8493,0.8516,0.8322,0.8266,0.8241,0.82,0.8138,0.8045,0.7896],[0.8493,0.8517,0.8323,0.8269,0.8249,0.8216,0.8166,0.8091,0.7978],[0.8493,0.8519,0.8326,0.8274,0.826,0.8237,0.8201,0.8147,0.8069],[0.8497,0.852,0.8329,0.8279,0.8268,0.8254,0.8231,0.8197,0.8147],[0.8503,0.8519,0.8331,0.8284,0.8275,0.8265,0.8252,0.8232,0.8203],[0.851,0.8517,0.8333,0.8288,0.8281,0.8274,0.8265,0.8254,0.8239],[0.8514,0.8514,0.8336,0.8293,0.8287,0.8281,0.8274,0.8267,0.8258],[0.8516,0.8515,0.834,0.8297,0.8292,0.8287,0.8282,0.8276,0.827],[0.8517,0.8517,0.8343,0.83,0.8296,0.8292,0.8288,0.8284,0.828],[0.8511,0.852,0.8345,0.8301,0.8298,0.8295,0.8293,0.829,0.8287],[0.8505,0.852,0.8345,0.8301,0.8299,0.8297,0.8295,0.8293,0.8291],[0.8498,0.852,0.8345,0.8301,0.8299,0.8297,0.8295,0.8294,0.8293],[0.8499,0.852,0.8344,0.83,0.8298,0.8296,0.8295,0.8294,0.8293],[0.85,0.852,0.8341,0.8297,0.8296,0.8305,0.8311,0.8311,0.831],[0.8502,0.8516,0.8335,0.8292,0.8332,0.8392,0.8417,0.8419,0.8419],[0.85,0.8512,0.8324,0.8283,0.837,0.848,0.8523,0.8528,0.8528],[0.8495,0.8508,0.8306,0.8276,0.8408,0.8557,0.8613,0.862,0.862],[0.8485,0.8508,0.8276,0.8249,0.8373,0.8537,0.8605,0.8615,0.861],[0.848,0.8508,0.826,0.8238,0.8355,0.8527,0.8602,0.8612,0.8604]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1951,"zt":0.875},"r":{"x":-1.24,"y":0.307,"th":[-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198],"ra":[0.362,0.3608,0.36,0.359,0.358,0.356,0.355,0.354,0.353,0.352,0.352,0.351,0.35,0.349,0.348,0.347,0.347,0.347,0.347,0.347,0.347,0.347,0.348,0.349,0.35,0.351,0.352,0.352,0.353,0.354,0.355,0.356,0.358,0.359,0.36,0.3608,0.362],"z":[[0.8509,0.8633,0.8611,0.8618,0.862,0.8619,0.8617,0.8612,0.8604],[0.8512,0.8635,0.8613,0.8619,0.862,0.862,0.8618,0.8615,0.861],[0.852,0.8639,0.8617,0.862,0.862,0.862,0.862,0.862,0.862],[0.8517,0.8621,0.8555,0.8529,0.8529,0.8528,0.8528,0.8528,0.8528],[0.8511,0.8581,0.8462,0.842,0.842,0.8419,0.8419,0.8419,0.8418],[0.8503,0.8541,0.837,0.8312,0.8311,0.8311,0.831,0.8309,0.8309],[0.8498,0.8518,0.8339,0.8296,0.8295,0.8294,0.8293,0.8292,0.8291],[0.8497,0.8518,0.8341,0.8297,0.8295,0.8294,0.8293,0.8292,0.8291],[0.8504,0.8518,0.8341,0.8297,0.8295,0.8294,0.8292,0.8291,0.829],[0.8511,0.8518,0.8341,0.8297,0.8294,0.8292,0.829,0.8288,0.8285],[0.8516,0.8515,0.8338,0.8295,0.8292,0.8289,0.8285,0.8281,0.8277],[0.8516,0.8514,0.8335,0.8292,0.8288,0.8283,0.8278,0.8273,0.8267],[0.8514,0.8513,0.8331,0.8288,0.8283,0.8277,0.827,0.8263,0.8254],[0.8509,0.8516,0.8328,0.8284,0.8277,0.8269,0.8261,0.8251,0.8239],[0.8502,0.8518,0.8326,0.8279,0.8271,0.8261,0.825,0.8236,0.822],[0.8496,0.8519,0.8325,0.8275,0.8265,0.8253,0.8238,0.822,0.8199],[0.8493,0.8518,0.8323,0.8271,0.8259,0.8244,0.8227,0.8205,0.8178],[0.8493,0.8517,0.8321,0.8267,0.8254,0.8237,0.8216,0.8191,0.816],[0.8493,0.8516,0.832,0.8266,0.8252,0.8235,0.8213,0.8186,0.8154],[0.8493,0.8517,0.8322,0.8268,0.8255,0.8238,0.8217,0.8192,0.8161],[0.8493,0.8519,0.8325,0.8273,0.8261,0.8246,0.8228,0.8207,0.818],[0.8496,0.852,0.8328,0.8278,0.8267,0.8255,0.824,0.8222,0.8201],[0.8503,0.8519,0.8329,0.8282,0.8273,0.8263,0.8251,0.8237,0.822],[0.851,0.8517,0.833,0.8285,0.8277,0.8269,0.8259,0.8248,0.8234],[0.8514,0.8514,0.8331,0.8287,0.828,0.8272,0.8263,0.8254,0.8243],[0.8516,0.8514,0.8332,0.8288,0.8281,0.8273,0.8265,0.8256,0.8246],[0.8517,0.8515,0.8333,0.8288,0.8281,0.8273,0.8265,0.8256,0.8247],[0.8511,0.8516,0.8333,0.8287,0.828,0.8273,0.8265,0.8256,0.8246],[0.8504,0.8516,0.8332,0.8285,0.8278,0.8271,0.8262,0.8254,0.8244],[0.8497,0.8515,0.8328,0.8281,0.8274,0.8266,0.8258,0.8249,0.8239],[0.8497,0.8514,0.8322,0.8275,0.8267,0.8259,0.825,0.8241,0.823],[0.8498,0.8513,0.8315,0.8267,0.8259,0.8251,0.8241,0.823,0.8218],[0.85,0.8509,0.8305,0.8258,0.825,0.8241,0.823,0.8218,0.8205],[0.8497,0.8504,0.8293,0.8247,0.8238,0.8228,0.8217,0.8204,0.819],[0.8493,0.8502,0.8273,0.8228,0.8217,0.8205,0.8191,0.8175,0.8156],[0.8483,0.8503,0.8233,0.8183,0.8163,0.8138,0.8108,0.807,0.8015],[0.8478,0.8505,0.8211,0.8158,0.8132,0.8101,0.8062,0.8011,0.7936]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1951,"zt":0.87},"dr":0.02},"p918":{"f":{"x":1.3135,"y":0.347,"th":[-30,-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204,210],"ra":[0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387,0.387],"z":[[0.9202,0.951,0.9188,0.9127,0.9085,0.9058,0.9034,0.9007,0.8976],[0.9261,0.9512,0.923,0.9167,0.9129,0.91,0.9071,0.9039,0.9002],[0.9375,0.9517,0.9305,0.9238,0.9206,0.9171,0.9131,0.9086,0.9034],[0.9389,0.9523,0.9339,0.927,0.9237,0.92,0.9158,0.9109,0.9054],[0.9397,0.9526,0.9357,0.9287,0.9253,0.9214,0.9168,0.9115,0.9056],[0.9402,0.953,0.9369,0.9299,0.9265,0.9226,0.918,0.9127,0.9067],[0.9407,0.9533,0.9382,0.9314,0.9282,0.9245,0.9202,0.9152,0.9093],[0.9413,0.9538,0.9398,0.9333,0.9304,0.927,0.9232,0.9187,0.9136],[0.9419,0.9542,0.9413,0.9353,0.9327,0.9298,0.9265,0.9228,0.9185],[0.9424,0.9547,0.9427,0.9371,0.9349,0.9323,0.9292,0.9256,0.9218],[0.9428,0.955,0.9437,0.9384,0.9362,0.9338,0.9307,0.9269,0.9234],[0.943,0.9553,0.9442,0.939,0.9367,0.9344,0.9311,0.9267,0.9221],[0.9431,0.9553,0.9444,0.9391,0.9365,0.9334,0.9289,0.9229,0.9152],[0.9431,0.9554,0.9442,0.9382,0.9344,0.9294,0.9222,0.9122,0.8975],[0.943,0.9552,0.943,0.9352,0.9292,0.9207,0.9086,0.891,0.8865],[0.9427,0.9547,0.9401,0.9296,0.9203,0.9071,0.8881,0.8608,0.8608],[0.9419,0.9539,0.9354,0.9219,0.9089,0.8903,0.8636,0.8437,0.8437],[0.9409,0.953,0.9295,0.9137,0.8969,0.8733,0.8383,0.8383,0.8383],[0.9399,0.9522,0.9237,0.907,0.8881,0.8621,0.8228,0.8228,0.8228],[0.9394,0.9519,0.9214,0.905,0.8863,0.8612,0.8234,0.8234,0.8234],[0.9394,0.9519,0.9231,0.9078,0.8916,0.8699,0.839,0.839,0.839],[0.94,0.9524,0.9281,0.9144,0.9013,0.8839,0.8608,0.8445,0.8445],[0.9407,0.953,0.9333,0.9215,0.9115,0.8984,0.8813,0.8583,0.8583],[0.9414,0.9537,0.9377,0.9282,0.9209,0.9116,0.8995,0.884,0.8799],[0.9419,0.9542,0.9408,0.9334,0.9287,0.9224,0.9143,0.904,0.8906],[0.9423,0.9547,0.9427,0.9369,0.9339,0.9301,0.9251,0.9185,0.9102],[0.9425,0.955,0.9438,0.9387,0.9369,0.9345,0.9316,0.9278,0.9229],[0.9427,0.9551,0.9443,0.9396,0.9381,0.9365,0.9346,0.9324,0.9296],[0.9428,0.9552,0.9446,0.94,0.9386,0.9371,0.9355,0.9338,0.932],[0.9428,0.9552,0.9446,0.94,0.9386,0.9372,0.9357,0.934,0.9324],[0.9428,0.9552,0.9445,0.9399,0.9385,0.9371,0.9355,0.9339,0.9323],[0.9426,0.9551,0.9443,0.9396,0.9382,0.9367,0.9352,0.9335,0.9319],[0.9424,0.9549,0.9437,0.9389,0.9375,0.936,0.9344,0.9328,0.9311],[0.942,0.9545,0.9429,0.9379,0.9365,0.9349,0.9333,0.9316,0.9299],[0.9416,0.9542,0.942,0.9369,0.9354,0.9338,0.9321,0.9305,0.9287],[0.9412,0.9539,0.941,0.9358,0.9343,0.9327,0.931,0.9294,0.9276],[0.9407,0.9535,0.9399,0.9345,0.933,0.9314,0.9297,0.9281,0.9266],[0.9398,0.953,0.9378,0.9323,0.9308,0.9295,0.9282,0.9269,0.9259],[0.9383,0.9522,0.9338,0.9281,0.9275,0.9275,0.927,0.926,0.9255],[0.9269,0.9515,0.9255,0.9197,0.9187,0.922,0.925,0.9255,0.9253],[0.921,0.9511,0.9208,0.915,0.9142,0.9196,0.9244,0.9254,0.9252]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,8,8,7,7,7,7,8,8,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1535,"zt":0.9645},"r":{"x":-1.4165,"y":0.364,"th":[-30,-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204,210],"ra":[0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404,0.404],"z":[[0.9451,0.9524,0.9295,0.9267,0.9279,0.9284,0.9279,0.9274,0.9269],[0.9459,0.953,0.934,0.9309,0.9314,0.9314,0.9308,0.9301,0.9295],[0.9474,0.9541,0.9422,0.939,0.9383,0.9374,0.9365,0.9355,0.9347],[0.9487,0.9556,0.9464,0.9435,0.9428,0.9421,0.9413,0.9406,0.9398],[0.9496,0.9567,0.9487,0.9462,0.9456,0.9451,0.9445,0.9439,0.9433],[0.9501,0.9572,0.9498,0.9475,0.947,0.9465,0.946,0.9454,0.9448],[0.9504,0.9576,0.9504,0.9482,0.9477,0.9472,0.9466,0.946,0.9454],[0.9506,0.9578,0.9508,0.9486,0.9481,0.9475,0.9468,0.9463,0.9457],[0.9507,0.9579,0.9509,0.9487,0.9482,0.9476,0.9467,0.9455,0.9443],[0.9507,0.9579,0.9508,0.9486,0.948,0.9474,0.9465,0.9447,0.9429],[0.9506,0.9578,0.9506,0.9482,0.9475,0.9468,0.9458,0.9439,0.9415],[0.9504,0.9575,0.9499,0.9473,0.9464,0.9456,0.9446,0.9431,0.9409],[0.95,0.9569,0.9487,0.9458,0.9446,0.9434,0.942,0.9402,0.9376],[0.9494,0.9562,0.9471,0.9434,0.9415,0.9392,0.9361,0.932,0.9262],[0.9488,0.9553,0.9444,0.9391,0.9353,0.93,0.9221,0.9061,0.8706],[0.948,0.9541,0.9395,0.9309,0.9224,0.9058,0.8695,0.8188,0.7766],[0.947,0.9525,0.9301,0.9149,0.8872,0.8387,0.7799,0.7272,0.6871],[0.9459,0.951,0.9132,0.8787,0.8201,0.7523,0.6943,0.6518,0.6388],[0.9449,0.9499,0.8836,0.8233,0.7404,0.6783,0.6466,0.6364,0.6215],[0.9444,0.9494,0.8457,0.7606,0.6809,0.6481,0.6376,0.6252,0.5876],[0.9442,0.9493,0.8183,0.7275,0.6591,0.6435,0.6325,0.6117,0.5533],[0.9442,0.9493,0.8184,0.7344,0.6674,0.6458,0.6325,0.6086,0.5289],[0.9445,0.9494,0.8462,0.777,0.7046,0.6604,0.6396,0.617,0.5545],[0.9451,0.95,0.8825,0.832,0.7653,0.7068,0.6676,0.6384,0.5937],[0.9462,0.9513,0.9127,0.881,0.8372,0.78,0.7293,0.6878,0.6523],[0.9477,0.9533,0.9317,0.9157,0.892,0.8583,0.8137,0.7689,0.7268],[0.9489,0.9552,0.9421,0.9336,0.9251,0.91,0.887,0.8574,0.8183],[0.9498,0.9565,0.9471,0.9422,0.9387,0.9339,0.927,0.9154,0.8973],[0.9504,0.9574,0.9494,0.9462,0.9446,0.9426,0.94,0.9367,0.9323],[0.9508,0.9579,0.9505,0.9479,0.9469,0.9458,0.9445,0.943,0.9411],[0.951,0.9582,0.9511,0.9486,0.9478,0.9468,0.9457,0.9445,0.9432],[0.9511,0.9582,0.9513,0.9489,0.9481,0.9472,0.9461,0.9449,0.9435],[0.951,0.9582,0.9513,0.949,0.9482,0.9472,0.9462,0.945,0.9435],[0.9509,0.9581,0.9511,0.9488,0.948,0.947,0.946,0.9447,0.9433],[0.9507,0.9579,0.9507,0.9483,0.9475,0.9465,0.9454,0.9441,0.9426],[0.9503,0.9575,0.95,0.9475,0.9466,0.9456,0.9445,0.9431,0.9415],[0.9498,0.9569,0.9488,0.9461,0.9452,0.9442,0.943,0.9416,0.9399],[0.9489,0.9558,0.9466,0.9435,0.9424,0.9413,0.94,0.9385,0.9368],[0.9476,0.9542,0.9423,0.9384,0.937,0.9355,0.9339,0.932,0.93],[0.946,0.953,0.934,0.929,0.9265,0.9243,0.923,0.9216,0.9201],[0.9452,0.9524,0.9293,0.9237,0.9205,0.918,0.9168,0.9155,0.914]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.162,"zt":0.9685},"dr":0.02},"yaris":{"f":{"x":1.17,"y":0.319,"th":[-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198,204],"ra":[0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364,0.364],"z":[[0.8379,0.8462,0.8452,0.8439,0.8424,0.8405,0.8385,0.8378,0.837],[0.8392,0.8476,0.8468,0.8459,0.8447,0.8432,0.8417,0.841,0.8401],[0.8419,0.8505,0.8501,0.8496,0.8491,0.8485,0.8478,0.847,0.8459],[0.8442,0.8529,0.8524,0.8519,0.8513,0.8507,0.8501,0.8494,0.8484],[0.8471,0.8557,0.855,0.8542,0.8535,0.8527,0.852,0.8511,0.8501],[0.8508,0.8592,0.8582,0.8571,0.856,0.855,0.8539,0.8529,0.8517],[0.855,0.8634,0.8621,0.8607,0.8593,0.8579,0.8565,0.855,0.8536],[0.8594,0.8677,0.8662,0.8645,0.8628,0.8611,0.8593,0.8575,0.8557],[0.8638,0.8718,0.87,0.8681,0.8661,0.864,0.8618,0.8596,0.8575],[0.8676,0.8754,0.8733,0.871,0.8686,0.8661,0.8635,0.8609,0.8584],[0.8708,0.8783,0.8758,0.8731,0.8703,0.8673,0.8644,0.8615,0.8587],[0.8733,0.8804,0.8775,0.8744,0.8711,0.8678,0.8646,0.8616,0.8587],[0.8751,0.8817,0.8784,0.8749,0.8713,0.8679,0.8646,0.8614,0.8583],[0.8763,0.8825,0.8788,0.875,0.8713,0.8677,0.8641,0.8606,0.8572],[0.877,0.8829,0.8789,0.875,0.8711,0.8671,0.8631,0.8591,0.8552],[0.8775,0.8831,0.8789,0.8748,0.8705,0.8661,0.8616,0.8571,0.8527],[0.8778,0.8831,0.8788,0.8743,0.8696,0.8647,0.8598,0.8548,0.8499],[0.8781,0.8832,0.8786,0.8738,0.8687,0.8634,0.858,0.8527,0.8474],[0.8783,0.8834,0.8786,0.8734,0.868,0.8624,0.8567,0.851,0.8454],[0.8786,0.8838,0.8789,0.8736,0.8681,0.8623,0.8565,0.8506,0.8447],[0.879,0.8843,0.8795,0.8743,0.8688,0.8631,0.8573,0.8514,0.8456],[0.8792,0.8847,0.8802,0.8753,0.87,0.8646,0.859,0.8534,0.8478],[0.8794,0.8851,0.8809,0.8763,0.8714,0.8663,0.8611,0.8558,0.8505],[0.8794,0.8853,0.8813,0.8771,0.8727,0.868,0.8631,0.8582,0.8534],[0.8793,0.8854,0.8815,0.8776,0.8735,0.8692,0.8649,0.8604,0.856],[0.879,0.8852,0.8815,0.8778,0.8739,0.8699,0.866,0.862,0.8581],[0.8781,0.8847,0.8813,0.8777,0.8739,0.8702,0.8664,0.8628,0.8592],[0.8765,0.8835,0.8805,0.8772,0.8737,0.8701,0.8665,0.8631,0.8596],[0.874,0.8814,0.8788,0.8759,0.8728,0.8695,0.8662,0.8629,0.8596],[0.8705,0.8782,0.876,0.8735,0.8708,0.868,0.8651,0.8622,0.8592],[0.8661,0.8741,0.8721,0.87,0.8677,0.8654,0.8629,0.8605,0.858],[0.861,0.8691,0.8674,0.8656,0.8637,0.8617,0.8597,0.8577,0.8557],[0.8555,0.8638,0.8623,0.8607,0.8591,0.8575,0.8559,0.8543,0.8528],[0.8501,0.8585,0.8572,0.8558,0.8545,0.8533,0.8521,0.851,0.8501],[0.8453,0.8537,0.8526,0.8516,0.8507,0.8498,0.8491,0.8484,0.8479],[0.8413,0.8498,0.849,0.8483,0.8477,0.8472,0.8467,0.8463,0.846],[0.8384,0.8469,0.8463,0.8458,0.8453,0.8448,0.8444,0.844,0.8435],[0.8356,0.8439,0.8431,0.8422,0.8411,0.8398,0.8385,0.8381,0.8377],[0.8344,0.8426,0.8416,0.8404,0.839,0.8373,0.8355,0.8351,0.8346]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9],"yCut":0.1709,"zt":0.88},"r":{"x":-1.39,"y":0.319,"th":[-24,-18,-12,-6,0,6,12,18,24,30,36,42,48,54,60,66,72,78,84,90,96,102,108,114,120,126,132,138,144,150,156,162,168,174,180,186,192,198],"ra":[0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379,0.379],"z":[[0.8378,0.8458,0.8441,0.8423,0.8402,0.8375,0.8343,0.8336,0.833],[0.8408,0.849,0.8475,0.8459,0.8441,0.842,0.8395,0.8387,0.838],[0.8472,0.8557,0.8546,0.8534,0.8523,0.8512,0.8502,0.8491,0.8481],[0.8536,0.8622,0.8612,0.8601,0.859,0.8579,0.8568,0.8557,0.8546],[0.8602,0.869,0.8681,0.8671,0.866,0.8649,0.8638,0.8626,0.8614],[0.8668,0.8757,0.8749,0.874,0.873,0.8719,0.8708,0.8696,0.8683],[0.8732,0.8821,0.8814,0.8806,0.8797,0.8786,0.8775,0.8762,0.8749],[0.879,0.8879,0.8873,0.8866,0.8857,0.8846,0.8834,0.882,0.8806],[0.8842,0.893,0.8924,0.8916,0.8906,0.8895,0.8881,0.8866,0.8849],[0.8884,0.8972,0.8965,0.8956,0.8944,0.8931,0.8915,0.8898,0.8878],[0.8917,0.9003,0.8994,0.8983,0.897,0.8954,0.8935,0.8914,0.8892],[0.8941,0.9024,0.9014,0.9,0.8983,0.8964,0.8944,0.892,0.8896],[0.8956,0.9036,0.9023,0.9007,0.8989,0.8968,0.8946,0.8921,0.8895],[0.8963,0.9042,0.9027,0.9009,0.899,0.8968,0.8944,0.8918,0.889],[0.8965,0.9043,0.9027,0.9009,0.8988,0.8964,0.8938,0.8908,0.8876],[0.8965,0.9042,0.9025,0.9005,0.8982,0.8955,0.8925,0.8891,0.8853],[0.8963,0.9039,0.902,0.8997,0.8971,0.894,0.8905,0.8867,0.8824],[0.8959,0.9032,0.9011,0.8985,0.8955,0.8921,0.8883,0.884,0.8793],[0.8951,0.9022,0.8999,0.8971,0.8938,0.8901,0.8859,0.8813,0.8763],[0.894,0.901,0.8984,0.8955,0.892,0.8881,0.8838,0.879,0.8736],[0.8926,0.8996,0.897,0.8939,0.8904,0.8864,0.8819,0.877,0.8716],[0.8911,0.8981,0.8955,0.8924,0.8889,0.8849,0.8805,0.8756,0.8703],[0.8895,0.8965,0.8939,0.8909,0.8875,0.8837,0.8794,0.8747,0.8696],[0.8877,0.8948,0.8923,0.8894,0.886,0.8822,0.8779,0.8733,0.8682],[0.8854,0.8924,0.8898,0.8867,0.8831,0.8791,0.8747,0.8699,0.8647],[0.8817,0.8885,0.8855,0.882,0.878,0.8737,0.8689,0.8638,0.8584],[0.8763,0.8825,0.879,0.875,0.8706,0.8659,0.8609,0.8558,0.8505],[0.8692,0.875,0.8709,0.8666,0.8619,0.8571,0.8521,0.847,0.8419],[0.8612,0.8666,0.8622,0.8577,0.8529,0.8481,0.8431,0.8379,0.8323],[0.8529,0.8581,0.8536,0.849,0.8442,0.8392,0.8338,0.8276,0.8191],[0.8451,0.8503,0.8458,0.8411,0.8361,0.8304,0.8237,0.8151,0.803],[0.8385,0.8438,0.8394,0.8345,0.8287,0.8215,0.8122,0.8,0.7836],[0.8338,0.8392,0.8346,0.8291,0.822,0.8127,0.8002,0.7844,0.7646],[0.8309,0.8362,0.8313,0.8249,0.8165,0.8049,0.7897,0.7707,0.7465],[0.8292,0.8343,0.829,0.822,0.8127,0.7996,0.7826,0.7616,0.7326],[0.828,0.833,0.8276,0.8205,0.8109,0.797,0.7796,0.7577,0.7264],[0.8258,0.8312,0.8271,0.82,0.8105,0.7965,0.7965,0.7965,0.7965],[0.8248,0.8304,0.8304,0.8304,0.8304,0.8304,0.8304,0.8304,0.8304]],"kn":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,6,2],"yCut":0.1648,"zt":0.895},"dr":0.02}};

// ---- room.js ----
// 白色大理石車庫（Nick 2026-09-28：「車庫要真的可以停車然後要可以開鐵捲門自己開出去 車庫要是白色大理石的色系⋯買完自己開回去然後打開鐵捲門然後就可以把它開進去自己的車庫」）
// 同一棟房子兩個地方用：車庫頁（軌道鏡頭繞著停在原點的車，exterior 關）、村子裡你家那棟（exterior 開，放在世界座標的某個位置，鐵捲門真的會開）
// buildRoom(renderer, { quality = 'high', exterior = false }) → {
//   group, env, setTrophies(n), resize(w, h), dispose(), ready, size      ← 車庫頁原本就在用的（用法一樣）
//   door, spots, colliders(doorOpen), zones, setExterior(on)             ← 村子要的
//   setBays(list), cull(camera), toWorld(p), toLocal(x, z), interior, exterior, envRotation   ← 多給的（可以不用）
// }
//   group：整棟（村子裡設 group.position、group.rotation.y 放到空地上；車庫頁放原點不要動）
//   env：房間的 PMREM（從主車位中間拍的），車庫頁給 scene.environment：車漆映出白色大理石、線燈、圓環燈
//   quality 'high'：地板是 Reflector（畫布一半的解析度，真的映出車），大理石紋疊在上面；'low'：地板只吃環境貼圖的亮面（村子、慢的手機）
//   setTrophies(n)：獎盃櫃擺前 n 個（0–9，贏過幾個不同的對手；越後面越大越華麗，第 9 個金色最大）
//   resize(w, h)：畫布的像素大小（drawing buffer）變了要叫（不給就自己問 renderer）；ready：Promise，招牌等到字型（最多 1.5 秒）重畫好
//   door：鐵捲門 { t（0 關 … 1 開，可以直接設）, open(sec = 2.2), close(sec = 1.8), update(dt) → 還在動就 true, moving }
//     一片一片的鋁門片沿著兩邊的導軌捲進門上面的捲筒（盒子裡）；在動的時候門邊的黃色警示燈會閃；村子要每一格叫 door.update(dt)
//   spots：{ main: { x: 0, z: 0, heading: 0 }, bays: [6 個 { x, z, heading }], outside: { x, z, heading } }
//     本地座標、車子原點（跟 buildCar 一樣：車子中心、地板上，車頭朝本地 +x）；heading＝rotation.y
//     main＝你開的那台停的地方（門前面、車頭朝外，在轉盤上）；bays＝後牆一排六個展示車位（照車庫頁一開始的鏡頭看得到的順序排）
//     outside＝門外面車道上（車頭朝外），開出去的時候可以從這裡開始
//   colliders(doorOpen = door.t >= 0.9, world = false)：[{ t: 'box', x, z, hx, hz, rot, h } | { t: 'circle', x, z, r, h }]（盆栽是圓的，跟 village.js 一樣）
//     牆、壁柱、家具；門沒全開就多一塊門（x 4.85 … 5.3、z −3 … 3、h 3.8）；停著的車自己加；world＝true 直接給世界座標（rot 加上整棟轉的角度）
//   zones：{ inside: { x, z, hx, hz }, door: { x, z0, z1, x1, h }, apron: { x, z, hx, hz } }（apron＝門外面等開門的那一塊）
//   setExterior(on)：外殼（外牆、屋頂、女兒牆、門面招牌、門外面那面鐵捲門、車道燈）開／關；開的時候不做「鏡頭在牆外就把牆丟掉」
//   setBays(list)：六個車位的名牌（字串或 null＝空的）；有名字的車位地上多一塊車子的影子（車子自己由頁面擺）
//   cull(camera)：村子可以每一格叫：門關著、鏡頭在外面就不畫裡面；鏡頭在裡面就不畫外殼（省 draw call）
//   toWorld({ x, z, heading })：本地 → 世界（照 group 現在的位置、轉角）；toLocal(x, z)：世界 → 本地（判斷在不在 zones 裡）
//   interior／exterior：裡面、外殼兩個 Group；envRotation：環境貼圖要轉幾度（村子裡整棟轉了，停在裡面的車要映房間就用這個）
// 本地座標：x 往門（+x 出去）、y 上、z＝車頭朝門的時候車子的右邊；地板 y = 0
//   裡面 x −12.7 … 5、z −12.7 … 12.7、天花板 4.5（四周燈槽到 4.64）；牆厚 0.3：外面 x −13 … 5.3、z −13 … 13、女兒牆頂 5.7
//   鐵捲門：x = 5 那面牆的中間，門洞 z −3 … 3、高 3.8；門片在牆裡面 7 公分（x = 4.93），捲筒盒在門洞上面（x 4.52 … 5、y 3.86 … 4.5）
// 燈光：房間自己的東西不吃場景的燈（村子的太陽照不進來）：牆、家具的亮度＝照「上／水平／下」算的環境光＋角落暗一點＋燈槽洗牆，
//   反射吃自己的環境貼圖；燈都是自己發光的面（沒有即時光源、沒有即時陰影）；外殼吃場景的燈（跟村子其他房子一樣）
// 車庫頁的鏡頭會繞到門那面牆外面（x > 5）、天花板上面：牆只有朝內那面（背面剔除），靠那面牆的東西在 shader 裡丟掉；天花板用抖動淡掉
// 效能：房間本身一次 7 個 draw call（地板、房子、燈、獎盃、玻璃、招牌、門片；車庫頁的鏡面地板再畫一次、少地板 → 13 個）；村子外殼 +4（門關著、鏡頭在外面只畫外殼 4 個）
//   同材質合成一個網格（輪胎輪框也合進去）、門片用 InstancedMesh；三角形：房間 ~25k（車庫頁連反射 ~50k）；canvas 貼圖最大 1024；沒有後製、沒有即時陰影、沒有即時光源
// 內嵌進車庫頁時（build-art.mjs 會拿掉 import）：頁面要自己 import Reflector；這個檔頂層只有 ROOM_SIZE、buildRoom 兩個名字

const ROOM_SIZE = { X: 5, XB: -12.7, Z: 12.7, H: 4.5, T: 0.3, TOP: 5.7, DZ: 3, DH: 3.8 };

function buildRoom(renderer, { quality = 'high', exterior = false } = {}) {
  const { X: XD, XB, Z: ZS, H, T: WT, TOP, DZ, DH } = ROOM_SIZE, hi = quality !== 'low';
  const XO = XD + WT, XBO = XB - WT, ZO = ZS + WT, HC = H + 0.14; // 外牆面、燈槽頂
  const group = new THREE.Group(); group.name = 'room';
  const inner = new THREE.Group(); inner.name = 'roomInterior';
  const outer = new THREE.Group(); outer.name = 'roomExterior';
  group.add(inner, outer);
  const trash = [], keep = (o) => (trash.push(o), o);
  const V = (x, y, z) => new THREE.Vector3(x, y, z), M4 = () => new THREE.Matrix4(), f3 = (v) => v.toFixed(3);
  let seed = 20260928; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // 固定亂數：每次長得一樣
  let dead = false;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // ---- 顏色（線性）：燈超過 1（HDR），色調對應之後才會白亮 ----
  const W1 = [1, 1, 1], BLK = [0.011, 0.011, 0.012], CEIL = [0.84, 0.83, 0.8], LACQ = [0.84, 0.84, 0.83], BRASS = [0.8, 0.56, 0.26], ALU = [0.8, 0.81, 0.83];
  const STEEL = [0.6, 0.61, 0.63], LEATHER = [0.022, 0.02, 0.019], RUBBER = [0.02, 0.02, 0.021], GUN = [0.05, 0.05, 0.055];
  const LED = [3.4, 2.5, 1.62], LINE = [6.2, 5.3, 4.2], SPOT = [9, 7.6, 6], AMBER = [2.8, 1.0, 0.07];
  // 每個頂點的材質：[粗糙度, 金屬度, 大理石（0 用貼圖集、1 白大理石、2 黑大理石）, 燈槽洗牆（0–1）]；燈的網格第一個數＝會閃（警示燈）
  const MM = {
    marble: [0.13, 0, 1, 1], honed: [0.34, 0, 1, 1], nero: [0.1, 0, 2, 1], paint: [0.92, 0, 0, 1], lacq: [0.2, 0, 0, 1], brass: [0.26, 1, 0, 0.4], alu: [0.3, 1, 0, 0.4],
    chrome: [0.05, 1, 0, 0.3], gloss: [0.07, 0, 0, 0.5], satin: [0.42, 0.5, 0, 0.5], leather: [0.48, 0, 0, 0.2], fabric: [0.96, 0, 0, 0], rubber: [0.82, 0, 0, 0], lamp: [0, 0, 0, 0], blink: [1, 0, 0, 0],
  };

  // ---- 大理石（卡拉拉白）：canvas 一個像素一個像素算，一張＝3.2 公尺見方；兩個畫質、兩個房子（車庫頁、村子）共用（存在 buildRoom 身上）----
  //   紋路＝斜 35 度的正弦帶子被 fbm 扭過（|sin| 接近 0 的地方就是一條紋）：主紋少、粗、有灰色的暈；次紋細；最細的髮絲紋；底色有淡淡的灰雲
  //   快：雜訊表 256²（六層值雜訊、可以接起來），低頻的場（扭曲、雲、遮罩）每 4 像素算一次再內插；sin 用 Bhaskara 近似、exp 查表（1024² 桌機 ~130 毫秒）
  const MS = hi ? 1024 : 512, MT = 3.2;
  const marbleC = (() => {
    const cache = buildRoom.marbleCache || (buildRoom.marbleCache = {});
    if (cache[MS]) return cache[MS];
    const cv = document.createElement('canvas'); cv.width = cv.height = MS;
    const g = cv.getContext('2d');
    if (cache[MS * 2]) { g.imageSmoothingQuality = 'high'; g.drawImage(cache[MS * 2], 0, 0, MS, MS); return (cache[MS] = cv); } // 已經有大張的：縮小就好
    const GN = 256, NZ = new Float32Array(GN * GN);
    let s0 = 777; const r0 = () => (s0 = (s0 * 16807) % 2147483647) / 2147483647;
    for (let cells = 4, amp = 1; cells <= 128; cells *= 2, amp *= 0.52) { // 六層，格子 4 → 128
      const gr = new Float32Array(cells * cells), cm = cells - 1, st = GN / cells; for (let i = 0; i < gr.length; i++) gr[i] = r0() * 2 - 1;
      const SX = new Float32Array(GN), XA = new Int32Array(GN), XB = new Int32Array(GN);
      for (let x = 0; x < GN; x++) { const fx = x / st, ix = fx | 0, tx = fx - ix; SX[x] = tx * tx * (3 - 2 * tx); XA[x] = ix & cm; XB[x] = (ix + 1) & cm; }
      for (let y = 0; y < GN; y++) {
        const fy = y / st, iy = fy | 0, ty = fy - iy, sy = ty * ty * (3 - 2 * ty), ra = (iy & cm) * cells, rb = ((iy + 1) & cm) * cells;
        for (let x = 0, o = y * GN; x < GN; x++, o++) {
          const sx = SX[x], xa = XA[x], xb = XB[x], ga = gr[ra + xa], gb = gr[rb + xa], a = ga + (gr[ra + xb] - ga) * sx, b = gb + (gr[rb + xb] - gb) * sx;
          NZ[o] += amp * (a + (b - a) * sy);
        }
      }
    }
    const nz = (u, v) => { // 雙線性取樣（繞回來）
      let fx = u * GN, fy = v * GN; fx -= Math.floor(fx / GN) * GN; fy -= Math.floor(fy / GN) * GN;
      const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, x1 = (ix + 1) & (GN - 1), y1 = (iy + 1) & (GN - 1);
      const a = NZ[iy * GN + ix], b = NZ[iy * GN + x1], c = NZ[y1 * GN + ix], d = NZ[y1 * GN + x1];
      return a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * ty;
    };
    const LR = MS / 4 + 1, NF = 6, F = new Float32Array(LR * LR * NF), ca = Math.cos(0.6), sa = Math.sin(0.6);
    for (let j = 0; j < LR; j++) for (let i = 0; i < LR; i++) { // 低頻的場：主紋扭曲、次紋扭曲、雲、主紋遮罩、次紋／髮絲紋遮罩、髮絲紋扭曲
      const u = (i * 4) / MS, v = (j * 4) / MS, o = (j * LR + i) * NF;
      F[o] = nz(u * 0.7 + 0.13, v * 0.7 + 0.71); F[o + 1] = nz(u * 1.5 + 0.52, v * 1.5 + 0.29); F[o + 2] = nz(u * 0.55 + 0.37, v * 0.55 + 0.83);
      F[o + 3] = nz(u * 0.8 + 0.61, v * 0.8 + 0.07); F[o + 4] = nz(u * 1.2 + 0.91, v * 1.2 + 0.44); F[o + 5] = nz(u * 2.6 + 0.23, v * 2.6 + 0.66);
    }
    const TN = 2048, T1 = new Float32Array(TN + 1), T2 = new Float32Array(TN + 1), T3 = new Float32Array(TN + 1); // 紋路的剖面（離紋多遠 → 多深）：主紋有一層寬的暈
    for (let i = 0; i <= TN; i++) { const x = i / TN; T1[i] = Math.exp(-x * 30) * 0.7 + Math.exp(-x * 5) * 0.22; T2[i] = Math.exp(-x * 55) * 0.45; T3[i] = Math.exp(-x * 90) * 0.18; }
    const img = g.createImageData(MS, MS), d = img.data, RWF = new Float32Array(LR * NF);
    for (let y = 0, o = 0; y < MS; y++) {
      const jy = y >> 2, ty = (y & 3) / 4, v = y / MS;
      for (let i = 0, a = jy * LR * NF, c = a + LR * NF; i < LR * NF; i++) RWF[i] = F[a + i] + (F[c + i] - F[a + i]) * ty; // 這一列：先沿 y 內插
      for (let x = 0; x < MS; x++, o += 4) {
        const i0 = (x >> 2) * NF, tx = (x & 3) / 4, u = x / MS, p = u * ca + v * sa, q = v * ca - u * sa;
        const f0 = RWF[i0] + (RWF[i0 + NF] - RWF[i0]) * tx, f1 = RWF[i0 + 1] + (RWF[i0 + NF + 1] - RWF[i0 + 1]) * tx, f2 = RWF[i0 + 2] + (RWF[i0 + NF + 2] - RWF[i0 + 2]) * tx;
        const f3 = RWF[i0 + 3] + (RWF[i0 + NF + 3] - RWF[i0 + 3]) * tx, f4 = RWF[i0 + 4] + (RWF[i0 + NF + 4] - RWF[i0 + 4]) * tx, f5 = RWF[i0 + 5] + (RWF[i0 + NF + 5] - RWF[i0 + 5]) * tx;
        const fine = nz(u * 4.7 + 0.4, v * 4.7 + 0.9);
        let t = q * 2.2 + f0 * 0.35 + fine * 0.04; t -= Math.floor(t); let h = t * (1 - t); const s1 = (16 * h) / (5 - 4 * h); // |sin(πt)|
        t = q * 4.6 - p * 0.6 + f1 * 0.6 + fine * 0.08; t -= Math.floor(t); h = t * (1 - t); const s2 = (16 * h) / (5 - 4 * h);
        t = q * 9 + p * 1.3 + f5 * 1.2 + fine * 0.16; t -= Math.floor(t); h = t * (1 - t); const s3 = (16 * h) / (5 - 4 * h);
        let m1 = f3 * 1.2 + 0.55, m2 = f4 * 1.5 + 0.2, m3 = 0.1 - f4 * 1.4;
        m1 = m1 < 0 ? 0 : m1 > 1 ? 1 : m1; m2 = m2 < 0 ? 0 : m2 > 1 ? 1 : m2; m3 = m3 < 0 ? 0 : m3 > 1 ? 1 : m3;
        let vein = T1[(s1 * TN) | 0] * m1 + T2[(s2 * TN) | 0] * m2 + T3[(s3 * TN) | 0] * m3; if (vein > 1) vein = 1;
        const c1 = f2 + 0.2, L = 247 - (c1 > 0 ? c1 * 13 : 0) - (fine > 0 ? fine * 2.5 : 0);
        d[o] = L - vein * 105; d[o + 1] = L - 1 - vein * 100; d[o + 2] = L - 3 - vein * 90; d[o + 3] = 255; // 紋路偏一點點冷灰
      }
    }
    g.putImageData(img, 0, 0);
    return (cache[MS] = cv);
  })();
  const marbleTex = keep(new THREE.CanvasTexture(marbleC)); marbleTex.colorSpace = THREE.SRGBColorSpace; marbleTex.anisotropy = aniso;

  // ---- 貼圖集（1024²）：一張底色、一張自己發光的（燈照在工具牆、畫、獎盃櫃背板上的光）；同一個材質的東西共用 ----
  const AT = 1024, atlas = document.createElement('canvas'), glowC = document.createElement('canvas');
  atlas.width = atlas.height = glowC.width = glowC.height = AT;
  const A = atlas.getContext('2d'), G = glowC.getContext('2d');
  A.fillStyle = '#fff'; A.fillRect(0, 0, AT, AT); G.fillStyle = '#000'; G.fillRect(0, 0, AT, AT);
  const reg = (x, y, w, h, p = 3) => [(x + p) / AT, 1 - (y + h - p) / AT, (x + w - p) / AT, 1 - (y + p) / AT]; // [u0, v0, u1, v1]
  const R = { W: reg(960, 960, 64, 64, 20), TOOLS: reg(0, 0, 640, 192), CHEST: reg(0, 192, 512, 96), CTRL: reg(512, 192, 64, 96), KEYP: reg(576, 192, 64, 96),
    RUG: reg(0, 288, 384, 272), ART: reg(384, 288, 384, 224), TBACK: reg(768, 288, 256, 96), BRUSH: reg(0, 576, 512, 32, 1), MODELS: reg(640, 0, 384, 192) };
  const RW = R.W;
  const inR = (x, y, w, h, fn) => { for (const c of [A, G]) { c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); } fn(); A.restore(); G.restore(); };
  const lin = (c, x0, y0, x1, y1, stops) => { const gr = c.createLinearGradient(x0, y0, x1, y1); for (const [t, s] of stops) gr.addColorStop(t, s); return gr; };
  inR(0, 0, 640, 192, () => { // 工具牆：白色烤漆洞洞板，工具是鍍鉻、黑、金（上面燈條照下來）
    A.fillStyle = '#ecebe7'; A.fillRect(0, 0, 640, 192);
    A.fillStyle = '#c9c8c4'; for (let y = 6; y < 192; y += 9) for (let x = 5; x < 640; x += 9) A.fillRect(x, y, 2, 2);
    for (let i = 0; i < 11; i++) { // 一排梅花扳手（由小到大）
      const x = 20 + i * 16, L = 58 + i * 6, y = 22;
      A.fillStyle = '#b9bdc3'; A.fillRect(x - 2.5, y + 8, 5, L - 16);
      A.beginPath(); A.arc(x, y + 6, 7, 0, Math.PI * 2); A.fill(); A.beginPath(); A.arc(x, y + L - 6, 6, 0, Math.PI * 2); A.fill();
      A.fillStyle = 'rgba(255,255,255,0.7)'; A.fillRect(x - 2.5, y + 8, 1.5, L - 16);
      A.fillStyle = '#ecebe7'; A.fillRect(x - 2.5, y - 3, 5, 8); A.beginPath(); A.arc(x, y + L - 6, 3, 0, Math.PI * 2); A.fill();
    }
    ['#141416', '#c9a24f', '#141416', '#c9a24f', '#141416', '#c9a24f', '#141416'].forEach((c, i) => { // 起子：黑、金握把
      const x = 212 + i * 14; A.fillStyle = '#b5b9bf'; A.fillRect(x - 1.5, 62, 3, 56); A.fillStyle = c; A.beginPath(); A.roundRect(x - 5, 24, 10, 40, 4); A.fill();
    });
    A.fillStyle = '#141416'; A.fillRect(328, 40, 8, 104); A.fillStyle = '#9aa0a8'; A.fillRect(310, 26, 44, 18); // 鎚子
    A.strokeStyle = '#141416'; A.lineWidth = 7; A.lineCap = 'round'; A.beginPath(); A.moveTo(382, 56); A.lineTo(370, 138); A.moveTo(392, 56); A.lineTo(406, 138); A.stroke(); // 鉗子
    A.fillStyle = '#9aa0a8'; A.beginPath(); A.ellipse(387, 42, 8, 17, 0, 0, Math.PI * 2); A.fill();
    A.fillStyle = '#16171a'; A.fillRect(428, 150, 120, 8); for (let i = 0; i < 11; i++) { A.fillStyle = '#c3c8cf'; A.fillRect(430 + i * 10.5, 128 - i * 2, 8, 22 + i * 2); } // 套筒
    A.fillStyle = '#b9bdc3'; A.fillRect(560, 24, 10, 120); A.fillStyle = '#141416'; A.fillRect(559, 100, 12, 44); A.fillStyle = '#c9a24f'; A.fillRect(559, 96, 12, 5); // 扭力扳手
    A.fillStyle = '#c9a24f'; A.fillRect(592, 30, 26, 70); A.fillStyle = '#141416'; A.fillRect(594, 100, 22, 22); // 金色的量規盒
    G.fillStyle = lin(G, 0, 0, 0, 192, [[0, 'rgba(255,214,168,0.55)'], [0.35, 'rgba(255,214,168,0.2)'], [1, 'rgba(255,214,168,0.02)']]); G.fillRect(0, 0, 640, 192);
  });
  inR(0, 192, 512, 96, () => { // 工具櫃正面：白色烤漆抽屜、黃銅把手（兩欄四層）
    A.fillStyle = lin(A, 0, 192, 0, 288, [[0, '#f1f0ec'], [1, '#dcdad5']]); A.fillRect(0, 192, 512, 96);
    for (const [x0, x1] of [[4, 254], [258, 508]]) {
      let y = 196;
      for (const h of [16, 18, 24, 32]) {
        A.fillStyle = '#b8b6b1'; A.fillRect(x0, y + h - 1.5, x1 - x0, 1.5);
        A.fillStyle = '#b08a3e'; A.fillRect(x0 + 30, y + 4, x1 - x0 - 60, 3.5); A.fillStyle = 'rgba(255,240,200,0.8)'; A.fillRect(x0 + 30, y + 4, x1 - x0 - 60, 1);
        y += h;
      }
    }
    A.fillStyle = '#b8b6b1'; A.fillRect(255, 192, 2, 96);
  });
  inR(512, 192, 64, 96, () => { // 門邊的開關盒（拉絲鋁、上／下兩顆鍵、鑰匙孔）
    A.fillStyle = lin(A, 512, 192, 576, 288, [[0, '#d7d9dc'], [1, '#aeb1b6']]); A.fillRect(512, 192, 64, 96);
    for (const [y, c] of [[222, '#1c6b3a'], [252, '#7b1d1d']]) { A.fillStyle = '#2a2c30'; A.beginPath(); A.arc(544, y, 11, 0, Math.PI * 2); A.fill(); A.fillStyle = c; A.beginPath(); A.arc(544, y, 8, 0, Math.PI * 2); A.fill(); }
    A.fillStyle = '#141416'; A.beginPath(); A.arc(544, 276, 5, 0, Math.PI * 2); A.fill();
    for (const [y, c] of [[222, 'rgba(60,255,140,0.9)'], [252, 'rgba(255,80,60,0.8)']]) { G.strokeStyle = c; G.lineWidth = 2; G.beginPath(); G.arc(544, y, 9.5, 0, Math.PI * 2); G.stroke(); }
    G.fillStyle = 'rgba(80,170,255,1)'; G.fillRect(541, 200, 6, 3);
  });
  inR(576, 192, 64, 96, () => { // 門外面的密碼盤（黑玻璃、發光的數字鍵）
    A.fillStyle = '#0c0d0f'; A.fillRect(576, 192, 64, 96);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) { A.fillStyle = '#1d1f23'; A.fillRect(584 + c * 17, 214 + r * 17, 13, 13); G.fillStyle = 'rgba(255,196,120,0.55)'; G.fillRect(588 + c * 17, 218 + r * 17, 5, 5); }
    G.fillStyle = 'rgba(80,220,140,0.9)'; G.fillRect(600, 200, 16, 3);
  });
  inR(0, 288, 384, 272, () => { // 地毯：炭灰、細細的混紡雜點、內圈一條淺灰線一條金線
    A.fillStyle = '#34353a'; A.fillRect(0, 288, 384, 272);
    for (let i = 0; i < 9000; i++) { const k = 30 + rnd() * 40; A.fillStyle = `rgba(${k},${k},${k + 4},0.5)`; A.fillRect(rnd() * 384, 288 + rnd() * 272, 1.5, 1.5); }
    A.strokeStyle = '#8b8d92'; A.lineWidth = 2; A.strokeRect(16, 304, 352, 240); A.strokeStyle = '#a88a4a'; A.lineWidth = 1.5; A.strokeRect(24, 312, 336, 224);
  });
  inR(384, 288, 384, 224, () => { // 掛畫：米白畫布、一筆很大的黑色筆刷、金箔碎片（抽象畫）
    A.fillStyle = lin(A, 384, 288, 768, 512, [[0, '#efe9df'], [1, '#e2d9ca']]); A.fillRect(384, 288, 384, 224);
    for (let i = 0; i < 900; i++) { A.fillStyle = `rgba(120,100,80,${f3(rnd() * 0.05)})`; A.fillRect(384 + rnd() * 384, 288 + rnd() * 224, 2, 2); }
    A.strokeStyle = '#141416'; A.lineCap = 'round';
    for (let k = 0; k < 14; k++) { A.lineWidth = 3 + rnd() * 5; A.globalAlpha = 0.5 + rnd() * 0.5; A.beginPath(); A.moveTo(420 + rnd() * 14, 470 + rnd() * 16 + k); A.bezierCurveTo(500, 280 + k * 3, 640, 520 - k * 2, 740 + rnd() * 10, 330 + k * 3); A.stroke(); }
    A.globalAlpha = 1;
    for (let i = 0; i < 22; i++) { A.fillStyle = rnd() < 0.5 ? '#c9a14e' : '#dcbd72'; A.save(); A.translate(560 + (rnd() - 0.5) * 220, 400 + (rnd() - 0.5) * 120); A.rotate(rnd() * 3); A.fillRect(-6 - rnd() * 8, -4 - rnd() * 6, 10 + rnd() * 16, 6 + rnd() * 10); A.restore(); }
    G.fillStyle = lin(G, 0, 288, 0, 512, [[0, 'rgba(255,220,180,0.45)'], [0.4, 'rgba(255,220,180,0.12)'], [1, 'rgba(0,0,0,0)']]); G.fillRect(384, 288, 384, 224);
  });
  inR(768, 288, 256, 96, () => { // 獎盃櫃的背板：香檳金直紋，後面藏燈（上面比較亮）
    A.fillStyle = '#c9b48c'; A.fillRect(768, 288, 256, 96);
    for (let x = 768; x < 1024; x += 6) { A.fillStyle = 'rgba(255,248,230,0.35)'; A.fillRect(x, 288, 2, 96); A.fillStyle = 'rgba(60,40,10,0.25)'; A.fillRect(x + 4, 288, 1.5, 96); }
    G.fillStyle = lin(G, 0, 288, 0, 384, [[0, 'rgba(255,200,130,0.95)'], [0.5, 'rgba(255,190,120,0.55)'], [1, 'rgba(255,180,110,0.3)']]); G.fillRect(768, 288, 256, 96);
  });
  inR(0, 576, 512, 32, () => { // 拉絲金屬：一條一條橫的細紋（鐵捲門片、捲筒盒）
    A.fillStyle = '#c4c7cb'; A.fillRect(0, 576, 512, 32);
    for (let i = 0; i < 700; i++) { A.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${f3(0.05 + rnd() * 0.12)})` : `rgba(0,0,0,${f3(0.03 + rnd() * 0.08)})`; A.fillRect(rnd() * 512 - 40, 576 + rnd() * 32, 40 + rnd() * 160, 1); }
  });
  inR(640, 0, 384, 192, () => { // 模型車展示櫃的背板：黑色、每層上面一條暖燈照下來
    A.fillStyle = '#16171a'; A.fillRect(640, 0, 384, 192);
    for (let r = 0; r < 3; r++) G.fillStyle = lin(G, 0, r * 64, 0, r * 64 + 64, [[0, 'rgba(255,205,150,0.5)'], [0.6, 'rgba(255,205,150,0.08)'], [1, 'rgba(0,0,0,0)']]), G.fillRect(640, r * 64, 384, 64);
  });
  const atlasTex = keep(new THREE.CanvasTexture(atlas)), glowTex = keep(new THREE.CanvasTexture(glowC));
  for (const t of [atlasTex, glowTex]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; }

  // ---- 招牌、名牌（1024×512，預先乘好 alpha：字＝不透明的金色，光暈＝alpha 0 的光，一次畫完）----
  const SIGN_TEXT = '大便龍的車庫', SIGN_FONT = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif', COND = '"Barlow Condensed", "Arial Narrow", sans-serif';
  const SW = 1024, SH = 512, signData = new Uint8Array(SW * SH * 4);
  const SR = { TEXT: [0, 0, 1024, 224], EMB: [0, 232, 224, 224], PLQ: (i) => [240 + (i % 3) * 260, 240 + Math.floor(i / 3) * 76, 256, 72] };
  const sreg = ([x, y, w, h]) => [x / SW, 1 - (y + h) / SH, (x + w) / SW, 1 - y / SH];
  const bayNames = Array(6).fill(null);
  const drawSign = (only) => { // 字：金色（上亮下暗、上緣一條亮線、底下一層深色當厚度），光暈：暖白模糊
    const lc = document.createElement('canvas'), gc = document.createElement('canvas'); lc.width = gc.width = SW; lc.height = gc.height = SH;
    const L = lc.getContext('2d'), Gl = gc.getContext('2d');
    Gl.fillStyle = '#000'; Gl.fillRect(0, 0, SW, SH);
    const gold = (c, y0, y1) => lin(c, 0, y0, 0, y1, [[0, '#fff3cf'], [0.18, '#e9c77d'], [0.55, '#b98a3c'], [0.8, '#d9b366'], [1, '#8a6427']]);
    const letters = (txt, font, cx, cy, h, glow = 1) => {
      for (const c of [L, Gl]) { c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle'; }
      Gl.globalCompositeOperation = 'lighter'; Gl.fillStyle = `rgba(255,190,120,${f3(0.5 * glow)})`; Gl.shadowColor = 'rgba(255,180,100,1)';
      for (const b of [30, 12]) { Gl.shadowBlur = b; Gl.fillText(txt, cx, cy); }
      Gl.shadowBlur = 0; Gl.globalCompositeOperation = 'source-over';
      L.fillStyle = '#5a3f14'; L.fillText(txt, cx + h * 0.012, cy + h * 0.02);
      L.fillStyle = gold(L, cy - h / 2, cy + h / 2); L.fillText(txt, cx, cy);
      L.save(); L.globalCompositeOperation = 'source-atop'; L.fillStyle = 'rgba(255,250,235,0.55)'; L.fillRect(0, cy - h * 0.5, SW, h * 0.06); L.restore();
    };
    if (!only) {
      { const [x, y, w, h] = SR.TEXT; let px = 150; L.font = `700 ${px}px ${SIGN_FONT}`; const tw = L.measureText(SIGN_TEXT).width; if (tw > w - 70) px = Math.floor((px * (w - 70)) / tw);
        letters(SIGN_TEXT, `700 ${px}px ${SIGN_FONT}`, x + w / 2, y + h / 2 + 4, px); }
      { const [x, y, w, h] = SR.EMB, cx = x + w / 2, cy = y + h / 2; // 圓形徽章：金圈＋「龍」
        Gl.globalCompositeOperation = 'lighter'; Gl.strokeStyle = 'rgba(255,190,120,0.5)'; Gl.shadowColor = 'rgba(255,180,100,1)'; Gl.shadowBlur = 24; Gl.lineWidth = 10; Gl.beginPath(); Gl.arc(cx, cy, 96, 0, Math.PI * 2); Gl.stroke(); Gl.shadowBlur = 0; Gl.globalCompositeOperation = 'source-over';
        L.strokeStyle = gold(L, cy - 100, cy + 100); L.lineWidth = 9; L.beginPath(); L.arc(cx, cy, 96, 0, Math.PI * 2); L.stroke(); L.lineWidth = 2.5; L.beginPath(); L.arc(cx, cy, 84, 0, Math.PI * 2); L.stroke();
        letters('龍', `700 118px ${SIGN_FONT}`, cx, cy + 4, 118, 0.8); }
    }
    for (let i = 0; i < 6; i++) { // 名牌：黑玻璃上的字（車子的名字，沒有就只有車位號碼）
      const [x, y, w, h] = SR.PLQ(i), nm = bayNames[i];
      L.clearRect(x, y, w, h); Gl.fillStyle = '#000'; Gl.fillRect(x, y, w, h);
      L.fillStyle = '#d9b366'; L.fillRect(x + 12, y + h - 13, w - 24, 1.5);
      L.font = `600 15px ${COND}`; L.textAlign = 'left'; L.textBaseline = 'middle'; L.fillStyle = '#c9a458'; L.fillText(`No. 0${i + 1}`, x + 14, y + 16);
      if (nm) {
        let px = 34; L.font = `700 ${px}px ${COND}, ${SIGN_FONT}`; const tw = L.measureText(nm).width; if (tw > w - 30) { px = Math.floor((px * (w - 30)) / tw); L.font = `700 ${px}px ${COND}, ${SIGN_FONT}`; }
        L.textAlign = 'center'; L.fillStyle = '#f6efe2'; L.fillText(nm, x + w / 2, y + h / 2 + 5);
        Gl.font = L.font; Gl.textAlign = 'center'; Gl.textBaseline = 'middle'; Gl.fillStyle = 'rgba(255,230,190,0.35)'; Gl.shadowColor = 'rgba(255,220,170,1)'; Gl.shadowBlur = 8; Gl.fillText(nm, x + w / 2, y + h / 2 + 5); Gl.shadowBlur = 0;
      }
    }
    // 合起來：rgb＝字 × α＋光暈 ×（1−α），α＝字（預先乘好 alpha，混色用 ONE, ONE_MINUS_SRC_ALPHA）
    const ld = L.getImageData(0, 0, SW, SH).data, gd = Gl.getImageData(0, 0, SW, SH).data;
    const [x0, y0, x1, y1] = only === 'plaques' ? [240, 240, SW, 240 + 2 * 76] : [0, 0, SW, SH]; // 只換名牌那一塊（旁邊的徽章不能蓋掉）
    for (let y = y0; y < y1; y++) {
      for (let x = x0, o = (y * SW + x0) * 4; x < x1; x++, o += 4) {
        const a = ld[o + 3] / 255, k = 1 - a, oy = (SH - 1 - y) * SW * 4 + x * 4; // DataTexture 第一列在最下面
        signData[oy] = ld[o] * a + gd[o] * k; signData[oy + 1] = ld[o + 1] * a + gd[o + 1] * k; signData[oy + 2] = ld[o + 2] * a + gd[o + 2] * k; signData[oy + 3] = ld[o + 3];
      }
    }
  };
  drawSign();
  const signTex = keep(new THREE.DataTexture(signData, SW, SH, THREE.RGBAFormat));
  signTex.colorSpace = THREE.SRGBColorSpace; signTex.generateMipmaps = true; signTex.minFilter = THREE.LinearMipmapLinearFilter; signTex.magFilter = THREE.LinearFilter; signTex.anisotropy = aniso; signTex.needsUpdate = true;
  const ready = Promise.race([document.fonts?.load ? Promise.all([document.fonts.load(`700 150px ${SIGN_FONT}`, SIGN_TEXT + '龍'), document.fonts.load(`700 34px ${COND}`, 'GC8 SUPRA No. 0123456789')]) : Promise.resolve(), new Promise((r) => setTimeout(r, 1500))])
    .catch(() => {}).then(() => { if (!dead) { drawSign(); signTex.needsUpdate = true; } });

  // ---- 共用的 uniform、shader 片段 ----
  const U = {
    uW2L: { value: new THREE.Matrix4() }, // 世界 → 房間本地（鏡頭的本地座標，切牆用）
    uCut: { value: exterior ? 0 : 1 }, uApron: { value: exterior ? XO : 14 }, uBlink: { value: 0 }, uMarble: { value: marbleTex },
    uBayOcc: { value: [0, 0, 0, 0, 0, 0] },
  };
  const BX = XB + 2.9, BAYZ = [1.85, 5.55, -1.85, 9.25, -5.55, -9.25], RT = 2.85; // 車位中心 x、車位 z（照車庫頁一開始的鏡頭看得到的順序）、轉盤半徑
  const LAMP = [XD - 0.49, 4.2, 3.1]; // 裡面的警示燈（捲筒盒正面右邊）
  const FB0 = 2.4, FB1 = 3.2; // 後牆黑大理石橫帶（招牌）上下：車庫頁一開始的鏡頭（手機）招牌要在上面那排按鈕下面
  const v3 = (a) => `vec3(${a.map(f3).join(', ')})`;
  const G_DEF = `#define R_XD ${f3(XD)}
#define R_XB ${f3(XB)}
#define R_ZS ${f3(ZS)}
#define R_H ${f3(H)}
#define R_DZ ${f3(DZ)}
float rHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sdb(vec2 p, vec2 c, vec2 h) { vec2 d = abs(p - c) - h; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
`;
  // 環境光：朝上（天花板、燈）＞水平（牆）＞朝下（地板反上來）；牆腳、天花板邊、牆角暗一點
  const G_AMB = `uniform float uBlink;
vec3 roomAmb(vec3 n, vec3 p) {
  vec3 e = n.y >= 0.0 ? mix(${v3([0.76, 0.735, 0.7])}, ${v3([1.05, 0.99, 0.91])}, n.y) : mix(${v3([0.76, 0.735, 0.7])}, ${v3([0.62, 0.6, 0.57])}, -n.y);
  float dx = min(p.x - R_XB, R_XD - p.x), dz = R_ZS - abs(p.z), dw = min(dx, dz), dw2 = max(dx, dz), v = 1.0 - abs(n.y);
  float ao = 1.0 - v * 0.3 * exp(-max(p.y, 0.0) / 0.32);
  ao *= 1.0 - v * 0.1 * exp(-max(R_H - p.y, 0.0) / 0.2);
  ao *= 1.0 - 0.28 * exp(-max(dw2, 0.0) / 0.5) * exp(-max(dw, 0.0) / 0.3);
  ao *= 1.0 - max(-n.y, 0.0) * 0.18 * exp(-max(dw, 0.0) / 0.7);
  return e * ao;
}
// 燈打在表面上的光（乘上顏色）：四周燈槽往下洗牆、後牆橫帶下面的燈、警示燈（閃）
vec3 roomWash(vec3 n, vec3 p, float k) {
  float dx = min(p.x - R_XB, R_XD - p.x), dz = R_ZS - abs(p.z), dw = min(dx, dz), v = 1.0 - abs(n.y);
  vec3 w = ${v3([1.0, 0.74, 0.5])} * (v * k * 1.1 * exp(-max(${f3(HC)} - p.y, 0.0) / 0.62) * exp(-max(dw, 0.0) / 0.3));
  if (p.x < R_XB + 0.35 && p.y < ${f3(FB0)}) w += ${v3([0.9, 0.66, 0.44])} * (v * k * 0.9 * exp(-(${f3(FB0)} - p.y) / 0.5));
  w += ${v3([2.2, 0.8, 0.06])} * (uBlink * exp(-distance(p, ${v3(LAMP)}) / 0.32));
  return w;
}
`;
  const G_CUT = `uniform float uCut;
void roomCut(vec3 c, vec3 q) { // 鏡頭跑到牆外（或天花板上面）：靠那面牆的東西丟掉、天花板抖動淡掉
  if (uCut < 0.5) return;
  if ((c.x > R_XD - 0.9 && q.x > R_XD - 1.3) || (c.x < R_XB + 0.9 && q.x < R_XB + 1.3) || (c.z > R_ZS - 0.9 && q.z > R_ZS - 1.3) || (c.z < 0.9 - R_ZS && q.z < 1.3 - R_ZS)) discard;
  float k = smoothstep(R_H - 0.3, R_H + 0.4, c.y) * step(R_H - 0.16, q.y);
  if (k > 0.0 && k >= fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))) discard;
}
`;
  // 地板：1.2 公尺的大理石大塊磚（每塊從大理石貼圖挑一塊、轉個方向）、灰色細縫；轉盤＝一整塊黑大理石＋不鏽鋼圈＋暖白 LED；
  // 車位＝黃銅嵌線＋投射燈的光；牆腳藏的 LED；家具底下、有車的車位底下暗一點；門口不鏽鋼門檻＋鐵捲門的黑膠條
  const AO_BOX = [];
  const G_FLOOR = `uniform sampler2D uMarble; uniform float uBayOcc[6];
float gTile; // 這一點是不是一塊一塊的磚（反射每塊歪一點點；轉盤、門檻是一整塊，不歪）
vec3 marbleAt(vec2 q, out float seam) {
  vec2 tp = q / 1.2, ti = floor(tp), f = tp - ti;
  float h1 = rHash(ti), h2 = rHash(ti + 19.19), h3 = rHash(ti + 7.77);
  vec2 g = h3 > 0.5 ? f.yx : f;
  if (fract(h3 * 13.0) > 0.5) g.x = 1.0 - g.x;
  vec2 uv = vec2(h1, h2) * 0.62 + g * 0.375, gx = dFdx(tp) * 0.375, gy = dFdy(tp) * 0.375;
  vec3 c = textureGrad(uMarble, uv, gx, gy).rgb * (0.975 + 0.04 * h2);
  vec2 e2 = min(f, 1.0 - f) * 1.2; float e = min(e2.x, e2.y);
  seam = 1.0 - smoothstep(0.0014, 0.0014 + fwidth(e) * 1.3, e);
  return c;
}
void roomFloor(vec2 q, out vec3 alb, out float rough, out float metal, out vec3 emit, out float ao) {
  float seam; alb = marbleAt(q, seam); rough = 0.08; metal = 0.0; emit = vec3(0.0); ao = 1.0; gTile = 1.0;
  vec3 light = vec3(0.0);
  float r = length(q), fr = fwidth(r);
  if (r < ${f3(RT)}) { alb = (vec3(1.0) - texture2D(uMarble, q / ${f3(2 * RT)} * 0.95 + 0.5).rgb) * 0.11 + 0.007; rough = 0.04; seam = 0.0; gTile = 0.0; }
  else if (r < ${f3(RT + 0.05)}) { alb = ${v3(STEEL)}; metal = 1.0; rough = 0.26; seam = 0.0; gTile = 0.0; }
  alb *= 1.0 - 0.42 * seam; rough = mix(rough, 0.45, seam);
  float dl = abs(r - ${f3(RT + 0.075)});
  emit += ${v3(LED)} * (0.8 * (1.0 - smoothstep(0.007, 0.007 + fr * 1.5, dl)));
  light += ${v3([1.0, 0.74, 0.48])} * (0.3 * exp(-dl / 0.1));
  // 車位：黃銅線（後牆到走道、車位中間）＋前緣一條橫線
  float lz = clamp(floor(q.y / 3.7 + 0.5), -3.0, 3.0) * 3.7, bl = (q.x < ${f3(BX + 2.75)} && q.x > R_XB) ? abs(q.y - lz) : 1e3;
  if (abs(q.y) < 11.11) bl = min(bl, abs(q.x - ${f3(BX + 2.75)}));
  float fb = fwidth(q.x) + fwidth(q.y), brass = 1.0 - smoothstep(0.011, 0.011 + fb, bl);
  alb = mix(alb, ${v3(BRASS)}, brass); metal = mix(metal, 1.0, brass); rough = mix(rough, 0.24, brass);
  float kb = clamp(floor((q.y - 1.85) / 3.7 + 0.5), -3.0, 2.0), bz = 1.85 + 3.7 * kb;
  vec2 db = vec2((q.x - ${f3(BX)}) / 2.1, (q.y - bz) / 1.35);
  light += ${v3([1.0, 0.86, 0.7])} * (0.42 * exp(-dot(db, db)));
  int bi = int(kb + 3.0); float occ = bi == 0 ? uBayOcc[5] : bi == 1 ? uBayOcc[4] : bi == 2 ? uBayOcc[2] : bi == 3 ? uBayOcc[0] : bi == 4 ? uBayOcc[1] : uBayOcc[3];
  ao *= 1.0 - 0.55 * occ * (1.0 - smoothstep(-0.35, 0.3, sdb(q, vec2(${f3(BX)}, bz), vec2(2.05, 0.78))));
  light += ${v3([1.0, 0.9, 0.78])} * (0.1 * exp(-r * r / 10.0));
  // 牆腳：踢腳板縫裡的 LED 照地板（門那一段沒有）
  float dx = min(q.x - R_XB, R_XD - q.x), dzw = R_ZS - abs(q.y), dw = min(dx, dzw);
  float gap = (R_XD - q.x < 0.6 && abs(q.y) < R_DZ + 0.4) || q.x > R_XD ? 0.0 : 1.0; // 門口、門外（車庫頁地板鋪到門外）沒有
  light += ${v3([1.0, 0.72, 0.45])} * (0.55 * gap * exp(-max(dw, 0.0) / 0.1));
  ao *= 1.0 - 0.3 * step(q.x, R_XD) * exp(-max(dw, 0.0) / 0.4);
  __AO__
  // 門口：不鏽鋼門檻、鐵捲門落下的地方一條黑膠條
  if (q.x > R_XD - 0.1 && q.x < R_XD + 0.3 && abs(q.y) < R_DZ) { alb = ${v3(STEEL)}; metal = 1.0; rough = 0.34; gTile = 0.0; }
  if (abs(q.x - (R_XD - 0.07)) < 0.014 && abs(q.y) < R_DZ) { alb = vec3(0.012); metal = 0.0; rough = 0.8; }
  emit += alb * light * (1.0 - metal);
}
`;

  // ---- 材質補丁：本地座標、切牆、自己的環境光（不吃場景的燈）、大理石／貼圖集二選一、每個頂點的粗糙度金屬度、石板縫 ----
  const VH = 'uniform mat4 uW2L; varying vec3 vLoc; varying vec3 vLocN; varying vec3 vCam;\n';
  const VA = 'attribute vec4 aMat; attribute vec4 aSeam; varying vec4 vMat; varying vec4 vSeam;\n';
  const vBody = (n, a) => `{ vec4 lp = vec4(transformed, 1.0);${n ? ' vec3 ln = objectNormal;' : ''}
#ifdef USE_INSTANCING
  lp = instanceMatrix * lp;${n ? ' ln = mat3(instanceMatrix) * ln;' : ''}
#endif
  vLoc = lp.xyz; vLocN = ${n ? 'normalize(ln)' : 'vec3(0.0, 1.0, 0.0)'}; vCam = (uW2L * vec4(cameraPosition, 1.0)).xyz;${a ? ' vMat = aMat; vSeam = aSeam;' : ''} }`;
  const FH = 'varying vec3 vLoc; varying vec3 vLocN; varying vec3 vCam;\n', FA = 'varying vec4 vMat; varying vec4 vSeam;\n';
  // lit：'room'＝房間裡面的光、'world'＝吃場景的燈（外殼）、'none'＝不打光（燈、招牌）；amat：幾何有每個頂點的材質；cut：切牆；more(sh)：再改
  function patch(m, key, { lit = 'room', amat = false, cut = true, wash = true, more } = {}) {
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      const std = lit !== 'none';
      sh.vertexShader = VH + (amat ? VA : '') + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${vBody(std, amat)}`);
      let f = G_DEF + FH + (amat ? FA : '') + G_AMB + G_CUT + 'uniform sampler2D uMarble;\n' + sh.fragmentShader;
      if (cut) f = f.replace('void main() {', 'void main() {\n  roomCut(vCam, vLoc);');
      // 先插洗牆、後插「大理石不吃發光貼圖」：插在同一行後面，後插的在前面 → include、step、wash
      if (lit === 'room') {
        f = f.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * roomWash(vLocN, vLoc, ${amat ? 'vMat.w' : wash ? '1.0' : '0.0'}) * (1.0 - metalnessFactor);`)
          .replace('#include <lights_fragment_begin>', '#undef RE_Direct\n#undef RE_Direct_RectArea\n#include <lights_fragment_begin>\n  irradiance = vec3(0.0);')
          .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n  iblIrradiance = PI * roomAmb(vLocN, vLoc);');
      }
      if (amat && std) {
        f = f.replace('#include <map_fragment>', `#ifdef USE_MAP
  { vec3 at = texture2D(map, vMapUv).rgb, mb = texture2D(uMarble, vMapUv).rgb;
    diffuseColor.rgb *= vMat.z < 0.5 ? at : vMat.z < 1.5 ? mb : (vec3(1.0) - mb) * 0.12 + 0.008; }
#endif
  { float se = min(min(vSeam.x, vSeam.z - vSeam.x), min(vSeam.y, vSeam.w - vSeam.y)); // 石板的縫
    diffuseColor.rgb *= 1.0 - 0.5 * (1.0 - smoothstep(0.0012, 0.0012 + fwidth(se) * 1.3, se)); }`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = vMat.x;')
          .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = vMat.y;')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= step(vMat.z, 0.5);');
      }
      f = f.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = clamp(diffuseColor.rgb, 0.0, 12.0); // 很細的面：MSAA 外插的頂點色可能是負的');
      if (lit === 'none' && amat) f = f.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= mix(1.0, 0.03 + 0.97 * uBlink, vMat.x);');
      sh.fragmentShader = f;
      if (more) more(sh);
    };
    m.customProgramCacheKey = () => `room3-${key}`;
    return keep(m);
  }

  // ---- 合併網格：同一個材質的東西全部塞進一個 BufferGeometry（位置、法線、貼圖座標、頂點色、每個頂點的材質、石板縫座標） ----
  const FACES = { px: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], nx: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], py: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]],
    ny: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], pz: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], nz: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] };
  const mwin = (w, h, flip) => { const sw = Math.min(1, w / MT), sh = Math.min(1, h / MT), u0 = rnd() * (1 - sw), v0 = rnd() * (1 - sh); return flip ? [u0 + sw, v0, u0, v0 + sh] : [u0, v0, u0 + sw, v0 + sh]; };
  const NOSEAM = [1e4, 1e4, 2e4, 2e4];
  function batch() {
    const P = [], N = [], Uv = [], C = [], Ma = [], Se = [], I = [], t = new THREE.Vector3(), nm = new THREE.Matrix3();
    const b = {
      get count() { return I.length; },
      // 四邊形 a b c d：從正面看逆時針（左下、右下、右上、左上）；r＝貼圖範圍（'M'＝隨便挑一塊大理石）；col＝一個顏色或四個角各一個；mat＝MM 的一個；seam＝畫石板縫
      quad(a, bb, c, d, r = RW, col = W1, mat = MM.paint, seam = false) {
        const k = P.length / 3, ab = bb.clone().sub(a), ad = d.clone().sub(a), n = ab.clone().cross(ad).normalize(), w = ab.length(), h = ad.length();
        if (r === 'M') r = mwin(w, h, rnd() < 0.5);
        const cs = Array.isArray(col[0]) ? col : [col, col, col, col], sm = [[0, 0], [w, 0], [w, h], [0, h]];
        [[a, r[0], r[1]], [bb, r[2], r[1]], [c, r[2], r[3]], [d, r[0], r[3]]].forEach(([p, u, v], i) => {
          P.push(p.x, p.y, p.z); N.push(n.x, n.y, n.z); Uv.push(u, v); C.push(...cs[i]); Ma.push(...mat); Se.push(...(seam ? [sm[i][0], sm[i][1], w, h] : NOSEAM));
        });
        I.push(k, k + 1, k + 2, k, k + 2, k + 3);
      },
      // 盒子：m＝位置方向，s＝[寬, 高, 深]，f＝{ px: [r, col, mat, seam], ..., all: [...], skip: 'nz ny' }（沒有的面不畫）
      box(m, s, f) {
        for (const [k, cs] of Object.entries(FACES)) {
          const o = f[k] || (f.all && !(f.skip || '').includes(k) ? f.all : null); if (!o) continue;
          const q = cs.map(([x, y, z]) => V((x * s[0]) / 2, (y * s[1]) / 2, (z * s[2]) / 2).applyMatrix4(m));
          b.quad(q[0], q[1], q[2], q[3], o[0], o[1], o[2], o[3]);
        }
      },
      // 任何 BufferGeometry（旋轉體、圓柱⋯）：套 m、貼圖座標壓進 r、顏色 col（null＝用它自己的頂點色）
      geo(g, m, r = RW, col = W1, mat = MM.paint) {
        const k = P.length / 3, p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, c = g.attributes.color;
        nm.getNormalMatrix(m);
        for (let i = 0; i < p.count; i++) {
          t.fromBufferAttribute(p, i).applyMatrix4(m); P.push(t.x, t.y, t.z);
          t.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); N.push(t.x, t.y, t.z);
          const u = uv ? uv.getX(i) : 0.5, v = uv ? uv.getY(i) : 0.5; Uv.push(r[0] + u * (r[2] - r[0]), r[1] + v * (r[3] - r[1]));
          if (col) C.push(...col); else C.push(c.getX(i), c.getY(i), c.getZ(i));
          Ma.push(...mat); Se.push(...NOSEAM);
        }
        if (g.index) for (let i = 0; i < g.index.count; i++) I.push(k + g.index.getX(i)); else for (let i = 0; i < p.count; i++) I.push(k + i);
        g.dispose();
      },
      build() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(Uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
        g.setAttribute('aMat', new THREE.Float32BufferAttribute(Ma, 4)); g.setAttribute('aSeam', new THREE.Float32BufferAttribute(Se, 4));
        g.setIndex(I); g.computeBoundingSphere();
        return keep(g);
      },
    };
    return b;
  }
  const S = batch(), L = batch(), T = batch(), E = batch(), EL = batch(), GL = batch(); // 房子＋家具（大理石＋貼圖集）、燈、獎盃、外殼、外面的燈、玻璃

  // 四面牆的座標系（裡面）：u 往右（從房間裡面看）、y 往上、n 往房間裡面
  const WALL = {
    A: M4().makeBasis(V(0, 0, -1), V(0, 1, 0), V(1, 0, 0)).setPosition(XB, 0, 0), B: M4().makeBasis(V(0, 0, 1), V(0, 1, 0), V(-1, 0, 0)).setPosition(XD, 0, 0),
    C: M4().makeBasis(V(-1, 0, 0), V(0, 1, 0), V(0, 0, -1)).setPosition(0, 0, ZS), D: M4().makeBasis(V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)).setPosition(0, 0, -ZS),
    // 外牆（n 往外）
    EA: M4().makeBasis(V(0, 0, 1), V(0, 1, 0), V(-1, 0, 0)).setPosition(XBO, 0, 0), EB: M4().makeBasis(V(0, 0, -1), V(0, 1, 0), V(1, 0, 0)).setPosition(XO, 0, 0),
    EC: M4().makeBasis(V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)).setPosition(0, 0, ZO), ED: M4().makeBasis(V(-1, 0, 0), V(0, 1, 0), V(0, 0, -1)).setPosition(0, 0, -ZO),
  };
  const at = (w, u, y, n, ry = 0, rx = 0) => WALL[w].clone().multiply(M4().makeRotationFromEuler(new THREE.Euler(rx, ry, 0)).setPosition(u, y, n));
  const wq = (bt, w, u0, u1, y0, y1, n, r, col, mat, seam) => { const m = WALL[w]; bt.quad(V(u0, y0, n).applyMatrix4(m), V(u1, y0, n).applyMatrix4(m), V(u1, y1, n).applyMatrix4(m), V(u0, y1, n).applyMatrix4(m), r, col, mat, seam); };
  const wqDown = (bt, w, u0, u1, y, n0, n1, r, col, mat) => { const m = WALL[w]; bt.quad(V(u0, y, n0).applyMatrix4(m), V(u1, y, n0).applyMatrix4(m), V(u1, y, n1).applyMatrix4(m), V(u0, y, n1).applyMatrix4(m), r, col, mat); }; // 朝下
  const wqUp = (bt, w, u0, u1, y, n0, n1, r, col, mat) => { const m = WALL[w]; bt.quad(V(u0, y, n1).applyMatrix4(m), V(u1, y, n1).applyMatrix4(m), V(u1, y, n0).applyMatrix4(m), V(u0, y, n0).applyMatrix4(m), r, col, mat); }; // 朝上
  const wb = (bt, w, u0, u1, y0, y1, n0, n1, f) => bt.box(at(w, (u0 + u1) / 2, (y0 + y1) / 2, (n0 + n1) / 2), [u1 - u0, y1 - y0, n1 - n0], f);
  const COLS = []; // 家具的碰撞盒（本地）
  const colW = (w, u0, u1, n0, n1, h) => { // 牆座標的長方形 → 本地的碰撞盒
    const a = V(u0, 0, n0).applyMatrix4(WALL[w]), b = V(u1, 0, n1).applyMatrix4(WALL[w]);
    COLS.push({ t: 'box', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, hx: Math.abs(a.x - b.x) / 2, hz: Math.abs(a.z - b.z) / 2, rot: 0, h });
    AO_BOX.push([(a.x + b.x) / 2, (a.z + b.z) / 2, Math.abs(a.x - b.x) / 2, Math.abs(a.z - b.z) / 2]);
  };

  // ---- 大理石板：一格一格（寬 ~1.6 公尺、兩排），左右兩塊一對（書本對花），每對從大理石貼圖裡挑一塊 ----
  const ROWS = [0.12, 2.36, HC];
  function slabs(w, u0, u1, rows = ROWS, { cw = 1.6, n = 0, mat = MM.marble, col = W1, bt = S } = {}) {
    const nc = Math.max(1, Math.round((u1 - u0) / cw)), sw = (u1 - u0) / nc;
    for (let r = 0; r < rows.length - 1; r++) {
      let win = null;
      for (let i = 0; i < nc; i++) {
        if (i % 2 === 0) win = mwin(sw, rows[r + 1] - rows[r], false);
        wq(bt, w, u0 + i * sw, u0 + (i + 1) * sw, rows[r], rows[r + 1], n, i % 2 ? [win[2], win[1], win[0], win[3]] : win, col, mat, true);
      }
    }
  }
  // 踢腳：黑大理石往牆裡縮 2 公分（下面藏 LED，照亮地板：地板 shader 的 light）
  const skirt = (w, u0, u1) => { wq(S, w, u0, u1, 0, ROWS[0], -0.02, 'M', W1, MM.nero, true); wqDown(S, w, u0, u1, ROWS[0], -0.02, 0, RW, BLK, MM.satin); };

  // ---- 天花板：白色、四周退 0.22 公尺是燈槽（暖白燈往下洗牆），中間主車位上面一圈圓環燈，走道四條長線燈，每個車位一顆投射燈 ----
  const CV = 0.22;
  S.quad(V(XB + CV, H, -ZS + CV), V(XD - CV, H, -ZS + CV), V(XD - CV, H, ZS - CV), V(XB + CV, H, ZS - CV), RW, CEIL, MM.paint); // 朝下
  for (const [w, u0, u1] of [['A', -ZS, ZS], ['B', -ZS, ZS], ['C', -XD, -XB], ['D', XB, XD]]) {
    const m = WALL[w];
    const a = V(u0, HC, 0).applyMatrix4(m), b = V(u1, HC, 0).applyMatrix4(m), c = V(u1, HC, CV).applyMatrix4(m), d = V(u0, HC, CV).applyMatrix4(m);
    L.quad(a, b, c, d, RW, [[2.2, 1.6, 1.05], [2.2, 1.6, 1.05], [0.9, 0.62, 0.38], [0.9, 0.62, 0.38]], MM.lamp); // 燈槽頂（朝下）：靠牆亮
    wqDown(S, w, u0 + CV, u1 - CV, H, CV, CV + 0.012, RW, CEIL, MM.paint);
  }
  { // 圓環燈（主車位上面，平的嵌在天花板）
    const ring = new THREE.RingGeometry(2.3, 2.38, 96, 1).rotateX(Math.PI / 2).translate(0, H - 0.004, 0);
    L.geo(ring, M4(), RW, [5.4, 4.6, 3.6], MM.lamp);
    S.geo(new THREE.RingGeometry(2.25, 2.43, 96, 1).rotateX(Math.PI / 2).translate(0, H - 0.002, 0), M4(), RW, [0.5, 0.5, 0.5], MM.satin);
  }
  for (const z of [-7.1, -3.5, 3.5, 7.1]) { // 走道的長線燈（沿著 x）
    S.quad(V(-6.4, H - 0.002, z - 0.05), V(3.9, H - 0.002, z - 0.05), V(3.9, H - 0.002, z + 0.05), V(-6.4, H - 0.002, z + 0.05), RW, [0.4, 0.4, 0.4], MM.satin);
    L.quad(V(-6.35, H - 0.004, z - 0.028), V(3.85, H - 0.004, z - 0.028), V(3.85, H - 0.004, z + 0.028), V(-6.35, H - 0.004, z + 0.028), RW, LINE, MM.lamp);
  }
  { // 車位前面一條橫的線燈（照車頭）
    const x = BX + 2.3;
    S.quad(V(x - 0.05, H - 0.002, -11.1), V(x + 0.05, H - 0.002, -11.1), V(x + 0.05, H - 0.002, 11.1), V(x - 0.05, H - 0.002, 11.1), RW, [0.4, 0.4, 0.4], MM.satin);
    L.quad(V(x - 0.028, H - 0.004, -11.05), V(x + 0.028, H - 0.004, -11.05), V(x + 0.028, H - 0.004, 11.05), V(x - 0.028, H - 0.004, 11.05), RW, LINE, MM.lamp);
  }
  const downlight = (x, z, r = 0.075, c = SPOT) => { // 嵌燈：黑框＋亮的圓
    S.geo(new THREE.CircleGeometry(r + 0.035, 20).rotateX(Math.PI / 2).translate(x, H - 0.002, z), M4(), RW, [0.02, 0.02, 0.022], MM.satin);
    L.geo(new THREE.CircleGeometry(r, 20).rotateX(Math.PI / 2).translate(x, H - 0.004, z), M4(), RW, c, MM.lamp);
  };
  for (const z of BAYZ) { downlight(BX - 0.9, z); downlight(BX + 0.9, z); }
  for (const [x, z] of [[-5.1, -10.6], [-2.9, -10.6], [-6.0, 11.4], [-4.0, 11.4], [4.1, 6.2], [4.1, 9.0], [4.1, -6.4], [4.1, -9.2], [-11.4, 11.6], [-11.4, -11.6]]) downlight(x, z, 0.06);

  // ---- 牆 A（x = XB，後牆）：六個展示車位；白大理石＋壁柱（兩邊黃銅條）、上面黑大理石橫帶（招牌、徽章），每個車位一塊黑玻璃名牌 ----
  const PIL = [-11.1, -7.4, -3.7, 0, 3.7, 7.4, 11.1]; // 壁柱（u）
  slabs('A', -ZS, ZS, [0.12, FB0 + 0.02]); slabs('A', -ZS, ZS, [FB1 - 0.02, HC]); skirt('A', -ZS, ZS);
  for (const u of PIL) {
    wb(S, 'A', u - 0.23, u + 0.23, 0, FB0, 0, 0.13, { pz: ['M', W1, MM.marble, true], px: ['M', W1, MM.marble, true], nx: ['M', W1, MM.marble, true] });
    for (const s of [-1, 1]) wb(S, 'A', u + s * 0.23 - 0.012, u + s * 0.23 + 0.012, 0.12, FB0, 0.13, 0.142, { all: [RW, BRASS, MM.brass], skip: 'nz ny py' });
    wb(S, 'A', u - 0.24, u + 0.24, 0, 0.12, 0.13, 0.135, { pz: [RW, BLK, MM.gloss] });
    colW('A', u - 0.23, u + 0.23, 0, 0.14, FB0);
  }
  wb(S, 'A', -ZS, ZS, FB0, FB1, 0, 0.2, { py: [RW, BLK, MM.gloss], ny: [RW, BLK, MM.gloss] }); slabs('A', -ZS, ZS, [FB0, FB1], { cw: 2.1, n: 0.2, mat: MM.nero }); // 黑大理石橫帶
  for (const y of [FB0 + 0.01, FB1 - 0.01]) wb(S, 'A', -ZS, ZS, y - 0.012, y + 0.012, 0.2, 0.207, { pz: [RW, BRASS, MM.brass], py: [RW, BRASS, MM.brass], ny: [RW, BRASS, MM.brass] });
  wqDown(L, 'A', -ZS, ZS, FB0 - 0.001, 0.13, 0.18, RW, [3.2, 2.3, 1.45], MM.lamp); // 橫帶下緣的燈
  for (const z of BAYZ) { // 名牌：黑玻璃＋黃銅框
    const u = -z;
    wb(S, 'A', u - 0.48, u + 0.48, 1.56, 1.86, 0, 0.025, { pz: [RW, [0.008, 0.008, 0.009], MM.gloss], px: [RW, BRASS, MM.brass], nx: [RW, BRASS, MM.brass], py: [RW, BRASS, MM.brass], ny: [RW, BRASS, MM.brass] });
  }

  // ---- 牆 B（x = XD，門那面）：鐵捲門（兩邊黑色導軌、上面白色捲筒盒＋警示燈、門邊開關盒）；右邊輪胎架、左邊模型車展示櫃 ----
  const RL = 0.13, BOXN = 0.48, BOXY = 3.86; // 導軌深、捲筒盒深、盒底
  slabs('B', -ZS, -DZ - 0.36); slabs('B', DZ + 0.36, ZS); skirt('B', -ZS, -DZ - 0.36); skirt('B', DZ + 0.36, ZS);
  wq(S, 'B', -DZ - 0.36, DZ + 0.36, DH, HC, 0, RW, CEIL, MM.paint); // 門洞上面（被盒子擋住）
  S.quad(V(XD, 0, -DZ), V(XO, 0, -DZ), V(XO, DH, -DZ), V(XD, DH, -DZ), RW, [0.02, 0.02, 0.022], MM.satin); // 門洞的內側（牆的厚度）：兩邊、上面，黑色
  S.quad(V(XO, 0, DZ), V(XD, 0, DZ), V(XD, DH, DZ), V(XO, DH, DZ), RW, [0.02, 0.02, 0.022], MM.satin);
  S.quad(V(XD, DH, -DZ), V(XO, DH, -DZ), V(XO, DH, DZ), V(XD, DH, DZ), RW, [0.02, 0.02, 0.022], MM.satin);
  { const e = 0.003; // 外殼也放一份（村子裡門關著、鏡頭在外面的時候裡面整組不畫，斜斜看會看穿），往門洞裡面挪 3 公釐不會打架
    E.quad(V(XD - 0.08, 0, -DZ + e), V(XO, 0, -DZ + e), V(XO, DH - e, -DZ + e), V(XD - 0.08, DH - e, -DZ + e), RW, [0.02, 0.02, 0.022], MM.satin);
    E.quad(V(XO, 0, DZ - e), V(XD - 0.08, 0, DZ - e), V(XD - 0.08, DH - e, DZ - e), V(XO, DH - e, DZ - e), RW, [0.02, 0.02, 0.022], MM.satin);
    E.quad(V(XD - 0.08, DH - e, -DZ), V(XO, DH - e, -DZ), V(XO, DH - e, DZ), V(XD - 0.08, DH - e, DZ), RW, [0.02, 0.02, 0.022], MM.satin); }
  for (const s of [-1, 1]) {
    wb(S, 'B', s > 0 ? DZ : -DZ - 0.36, s > 0 ? DZ + 0.36 : -DZ, 0, BOXY, 0, 0.012, { pz: [RW, [0.02, 0.02, 0.022], MM.satin] }); // 門框（黑）
    const u0 = s > 0 ? DZ - 0.02 : -DZ - 0.12, u1 = s > 0 ? DZ + 0.12 : -DZ + 0.02;
    wb(S, 'B', u0, u1, 0, BOXY, 0.012, RL, { all: [RW, GUN, MM.satin], skip: 'nz ny py' }); // 導軌（U 型槽，黑色陽極）
    wb(S, 'B', s > 0 ? DZ - 0.02 : -DZ + 0.005, s > 0 ? DZ - 0.005 : -DZ + 0.02, 0, BOXY, 0.03, RL - 0.02, { [s > 0 ? 'nx' : 'px']: [RW, [0.005, 0.005, 0.005], MM.rubber] });
    COLS.push({ t: 'box', x: XD - RL / 2, z: s * (DZ + 0.05), hx: RL / 2, hz: 0.07, rot: 0, h: BOXY });
  }
  // 捲筒盒：白色烤漆，下面有一條縫讓門片進去，正面下緣一條黃銅線
  wb(S, 'B', -DZ - 0.36, DZ + 0.36, BOXY, H, 0.0, BOXN, { pz: [RW, LACQ, MM.lacq], px: [RW, LACQ, MM.lacq], nx: [RW, LACQ, MM.lacq] });
  wqDown(S, 'B', -DZ - 0.36, DZ + 0.36, BOXY, 0.1, BOXN, RW, [0.7, 0.7, 0.69], MM.lacq);
  wqDown(S, 'B', -DZ - 0.36, DZ + 0.36, BOXY, 0, 0.04, RW, [0.7, 0.7, 0.69], MM.lacq);
  wqDown(S, 'B', -DZ, DZ, BOXY + 0.12, 0.04, 0.1, RW, [0.02, 0.02, 0.02], MM.satin); // 縫裡面（暗）
  wb(S, 'B', -DZ - 0.36, DZ + 0.36, BOXY, BOXY + 0.02, BOXN, BOXN + 0.006, { pz: [RW, BRASS, MM.brass], ny: [RW, BRASS, MM.brass] });
  { // 警示燈（黃色，門在動的時候閃）＋黑底座
    const u = LAMP[2], y = LAMP[1];
    wb(S, 'B', u - 0.075, u + 0.075, y - 0.06, y + 0.06, BOXN, BOXN + 0.02, { all: [RW, GUN, MM.satin], skip: 'nz' });
    L.geo(new THREE.SphereGeometry(0.045, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.8), at('B', u, y, BOXN + 0.02), RW, AMBER, MM.blink);
  }
  wb(S, 'B', DZ + 0.62, DZ + 0.78, 1.18, 1.42, 0, 0.035, { pz: [R.CTRL, W1, MM.alu], all: [RW, ALU, MM.alu], skip: 'nz' }); // 開關盒
  { // 輪胎架（黑鐵＋黃銅頂蓋，兩層、每層四顆，輪胎側面朝房間斜一點）
    const u0 = 5.05, u1 = 10.15, lv = [0.32, 1.22];
    for (const u of [u0, (u0 + u1) / 2, u1]) for (const n of [0.08, 0.52]) {
      wb(S, 'B', u - 0.022, u + 0.022, 0, 2.1, n - 0.022, n + 0.022, { all: [RW, GUN, MM.satin], skip: 'ny' });
      wb(S, 'B', u - 0.03, u + 0.03, 2.1, 2.13, n - 0.03, n + 0.03, { all: [RW, BRASS, MM.brass], skip: 'ny' });
    }
    for (const y of [...lv, 2.1]) for (const n of [0.08, 0.52]) wb(S, 'B', u0, u1, y - 0.035, y, n - 0.02, n + 0.02, { all: [RW, GUN, MM.satin] });
    colW('B', u0 - 0.03, u1 + 0.03, 0, 0.56, 2.15);
  }
  { // 模型車展示櫃（黑色、三層玻璃層板、每層一條燈；1:18 的小車）
    const u0 = -10.3, u1 = -5.0, y0 = 0.9, y1 = 2.5;
    wb(S, 'B', u0, u1, 0.0, y0, 0, 0.42, { pz: [RW, LACQ, MM.lacq], py: ['M', W1, MM.marble, true], px: [RW, LACQ, MM.lacq], nx: [RW, LACQ, MM.lacq] });
    wb(S, 'B', u0 + 0.02, u1 - 0.02, 0, 0.08, 0.38, 0.4, { pz: [RW, BLK, MM.satin] });
    wq(S, 'B', u0, u1, y0, y1, 0.005, R.MODELS, W1, MM.gloss);
    for (const s of [u0, u1 - 0.04]) wb(S, 'B', s, s + 0.04, y0, y1 + 0.04, 0, 0.36, { all: [RW, BLK, MM.satin], skip: 'nz ny' });
    wb(S, 'B', u0, u1, y1, y1 + 0.04, 0, 0.36, { all: [RW, BLK, MM.satin], skip: 'nz' });
    const cols = [[0.9, 0.09, 0.02], [0.02, 0.1, 0.5], [0.85, 0.85, 0.86], [0.02, 0.02, 0.022], [0.9, 0.5, 0.02], [0.7, 0.55, 0.05], [0.06, 0.3, 0.12], [0.5, 0.52, 0.55]];
    for (let r = 0; r < 3; r++) {
      const y = y0 + 0.02 + r * 0.53;
      if (r) GL.box(at('B', (u0 + u1) / 2, y - 0.01, 0.19), [u1 - u0 - 0.08, 0.012, 0.34], { all: [RW, W1, MM.gloss] });
      wqDown(L, 'B', u0 + 0.05, u1 - 0.05, y + 0.5, 0.25, 0.27, RW, [2.6, 2.0, 1.4], MM.lamp);
      for (let i = 0; i < 6; i++) { // 小車：車身＋車頂＋四個輪子（很小，形狀大概就好）
        const u = u0 + 0.5 + i * 0.86, c = cols[(r * 6 + i * 5) % cols.length], m = at('B', u, y, 0.2, (rnd() - 0.5) * 0.5);
        S.box(m.clone().multiply(M4().makeTranslation(0, 0.045, 0)), [0.26, 0.05, 0.11], { all: [RW, c, MM.gloss], skip: 'ny' });
        S.box(m.clone().multiply(M4().makeTranslation(-0.015, 0.085, 0)), [0.13, 0.035, 0.095], { all: [RW, [0.02, 0.02, 0.025], MM.gloss], skip: 'ny' });
        for (const [dx, dz] of [[-0.08, -0.052], [0.08, -0.052], [-0.08, 0.052], [0.08, 0.052]]) S.box(m.clone().multiply(M4().makeTranslation(dx, 0.022, dz)), [0.045, 0.045, 0.02], { all: [RW, RUBBER, MM.rubber], skip: 'ny' });
      }
    }
    colW('B', u0, u1, 0, 0.42, y1);
  }

  // ---- 牆 C（z = ZS，車的右邊）：獎盃櫃（白色烤漆矮櫃＋黑框玻璃展示櫃，背板香檳金、藏燈）、工具牆＋工具櫃（白、金、黑）----
  const TC0 = 3.0, TC1 = 7.0, TCY = 1.3, TCY1 = 2.7, TCN = 0.46; // 獎盃櫃（u = −x）
  const TOOL0 = -2.8, TOOL1 = 2.4;
  slabs('C', -XD, TOOL0 - 0.1); slabs('C', TC1 + 0.1, -XB); slabs('C', TOOL1 + 0.1, TC0 - 0.1);
  slabs('C', TOOL0 - 0.1, TOOL1 + 0.1, [0.12, 1.05]); slabs('C', TOOL0 - 0.1, TOOL1 + 0.1, [2.75, HC]); slabs('C', TC0 - 0.1, TC1 + 0.1, [TCY1 + 0.05, HC]);
  skirt('C', -XD, TOOL0); skirt('C', TC1, -XB); skirt('C', TOOL1, TC0);
  { // 獎盃櫃
    wb(S, 'C', TC0, TC1, 0.08, TCY, 0, 0.5, { pz: [RW, LACQ, MM.lacq], px: [RW, LACQ, MM.lacq], nx: [RW, LACQ, MM.lacq], py: ['M', W1, MM.marble, true] });
    for (let i = 1; i < 4; i++) wq(S, 'C', TC0 + i * 1.0 - 0.003, TC0 + i * 1.0 + 0.003, 0.1, TCY - 0.02, 0.501, RW, [0.5, 0.5, 0.5], MM.lacq);
    for (let i = 0; i < 4; i++) wb(S, 'C', TC0 + i + 0.35, TC0 + i + 0.65, TCY - 0.14, TCY - 0.125, 0.5, 0.515, { all: [RW, BRASS, MM.brass], skip: 'nz' });
    wb(S, 'C', TC0 + 0.02, TC1 - 0.02, 0, 0.08, 0, 0.46, { pz: [RW, BLK, MM.satin] });
    wq(S, 'C', TC0 + 0.05, TC1 - 0.05, TCY, TCY1, 0.02, R.TBACK, W1, MM.satin);
    for (const u of [TC0 + 0.02, TC1 - 0.02]) wb(S, 'C', u - 0.025, u + 0.025, TCY, TCY1, 0, TCN, { all: [RW, BLK, MM.satin], skip: 'nz ny py' });
    wb(S, 'C', TC0 - 0.005, TC1 + 0.005, TCY1, TCY1 + 0.05, 0, TCN, { all: [RW, BLK, MM.satin], skip: 'nz' });
    wqDown(L, 'C', TC0 + 0.1, TC1 - 0.1, TCY1 - 0.002, 0.3, 0.33, RW, [3.6, 2.8, 1.9], MM.lamp);
    GL.quad(V(-TC0 + 0.0, TCY, ZS - TCN).clone(), V(-TC1, TCY, ZS - TCN), V(-TC1, TCY1, ZS - TCN), V(-TC0, TCY1, ZS - TCN), RW, W1, MM.gloss); // 玻璃（朝外 −z）
    colW('C', TC0, TC1, 0, 0.5, TCY1 + 0.05);
  }
  { // 工具牆（白色洞洞板＋工具）、上面黑色燈條、下面白色工具櫃（黑色不鏽鋼檯面、黃銅把手）
    wb(S, 'C', TOOL0, TOOL1, 1.12, 2.55, 0, 0.03, { pz: [R.TOOLS, W1, MM.lacq], px: [RW, LACQ, MM.lacq], nx: [RW, LACQ, MM.lacq], py: [RW, LACQ, MM.lacq], ny: [RW, LACQ, MM.lacq] });
    wb(S, 'C', TOOL0 - 0.05, TOOL1 + 0.05, 2.62, 2.7, 0, 0.2, { all: [RW, [0.02, 0.02, 0.022], MM.satin], skip: 'nz' });
    wqDown(L, 'C', TOOL0, TOOL1, 2.619, 0.12, 0.16, RW, [3.8, 3.2, 2.5], MM.lamp);
    wb(S, 'C', TOOL0 + 0.1, TOOL1 - 0.1, 0.1, 0.95, 0, 0.55, { pz: [R.CHEST, W1, MM.lacq], px: [RW, LACQ, MM.lacq], nx: [RW, LACQ, MM.lacq] });
    wb(S, 'C', TOOL0 + 0.08, TOOL1 - 0.08, 0.95, 0.99, 0, 0.57, { all: [RW, [0.1, 0.1, 0.105], MM.satin], skip: 'nz' });
    wb(S, 'C', TOOL0 + 0.15, TOOL1 - 0.15, 0, 0.1, 0, 0.5, { pz: [RW, BLK, MM.satin] });
    colW('C', TOOL0 + 0.08, TOOL1 - 0.08, 0, 0.57, 1.0);
  }

  // ---- 牆 D（z = −ZS，車的左邊）：休息區（地毯、黑皮沙發、兩張單人椅、大理石茶几黃銅腳、落地燈、掛畫＋畫燈）----
  const LX0 = -7.0, LX1 = -1.0; // 沙發那段（u = x）
  slabs('D', XB, LX0); slabs('D', LX1, XD); slabs('D', LX0, LX1, [0.12, 1.25]); slabs('D', LX0, LX1, [2.95, HC]);
  skirt('D', XB, XD);
  { // 掛畫那一段：牆面板（白大理石）＋畫＋黃銅畫框＋畫燈
    slabs('D', LX0, LX1, [1.25, 2.95], { cw: 3 });
    wb(S, 'D', -5.25, -2.75, 1.4, 2.8, 0, 0.04, { pz: [R.ART, W1, MM.satin], all: [RW, BRASS, MM.brass], skip: 'nz' });
    wb(S, 'D', -4.4, -3.6, 2.92, 2.96, 0, 0.16, { all: [RW, BRASS, MM.brass], skip: 'nz' });
    wqDown(L, 'D', -4.35, -3.65, 2.919, 0.1, 0.14, RW, [3, 2.3, 1.5], MM.lamp);
  }
  { // 地毯（地板上一片）
    const x0 = -6.5, x1 = -1.5, z0 = -12.35, z1 = -8.85, y = 0.008;
    S.quad(V(x0, y, z1), V(x1, y, z1), V(x1, y, z0), V(x0, y, z0), R.RUG, W1, MM.fabric);
    for (const [a, b] of [[V(x0, 0, z1), V(x1, 0, z1)], [V(x1, 0, z0), V(x0, 0, z0)]]) S.quad(a, b, b.clone().setY(y), a.clone().setY(y), RW, [0.05, 0.05, 0.055], MM.fabric);
  }
  const lf = { all: [RW, LEATHER, MM.leather], skip: 'ny' };
  { // 沙發（靠牆、面向車子）
    const x0 = -5.5, x1 = -2.5, zb = -ZS + 0.05, zf = -ZS + 0.98;
    const bx = (a, b, y0, y1, c, d, f = lf) => S.box(M4().makeTranslation((a + b) / 2, (y0 + y1) / 2, (c + d) / 2), [b - a, y1 - y0, d - c], f);
    bx(x0 + 0.2, x1 - 0.2, 0.1, 0.44, zb + 0.2, zf, lf); bx(x0, x1, 0.1, 0.82, zb, zb + 0.22, lf); bx(x0, x0 + 0.2, 0.1, 0.62, zb, zf, lf); bx(x1 - 0.2, x1, 0.1, 0.62, zb, zf, lf);
    for (const x of [x0 + 0.2 + 0.87, x0 + 0.2 + 1.73]) S.quad(V(x - 0.004, 0.441, zf), V(x + 0.004, 0.441, zf), V(x + 0.004, 0.441, zb + 0.22), V(x - 0.004, 0.441, zb + 0.22), RW, [0.005, 0.005, 0.005], MM.leather);
    bx(x0 + 0.05, x1 - 0.05, 0.0, 0.1, zb + 0.05, zf - 0.05, { all: [RW, BRASS, MM.brass], skip: 'ny' });
  }
  const chair = (cx, cz, ry) => { // 單人椅
    const m0 = M4().makeRotationY(ry).setPosition(cx, 0, cz), b = (x, y, z, w, h, d, f = lf) => S.box(m0.clone().multiply(M4().makeTranslation(x, y, z)), [w, h, d], f);
    b(0, 0.27, 0.04, 0.72, 0.18, 0.66); b(0, 0.55, -0.34, 0.8, 0.56, 0.14); b(-0.36, 0.44, 0, 0.1, 0.36, 0.78); b(0.36, 0.44, 0, 0.1, 0.36, 0.78);
    for (const [x, z] of [[-0.34, -0.34], [0.34, -0.34], [-0.34, 0.34], [0.34, 0.34]]) b(x, 0.09, z, 0.035, 0.18, 0.035, { all: [RW, BRASS, MM.brass], skip: 'ny' });
  };
  chair(-6.05, -10.35, -Math.PI / 2 + 0.35); chair(-1.95, -10.35, Math.PI / 2 - 0.35);
  { // 茶几：白大理石檯面＋黃銅框
    const cx = -4.0, cz = -10.35;
    S.box(M4().makeTranslation(cx, 0.4, cz), [1.3, 0.04, 0.72], { py: ['M', W1, MM.marble, true], all: [RW, [0.8, 0.8, 0.79], MM.marble], skip: 'py' });
    for (const [x, z] of [[-0.6, -0.31], [0.6, -0.31], [-0.6, 0.31], [0.6, 0.31]]) S.box(M4().makeTranslation(cx + x, 0.19, cz + z), [0.03, 0.38, 0.03], { all: [RW, BRASS, MM.brass], skip: 'ny' });
    for (const z of [-0.31, 0.31]) S.box(M4().makeTranslation(cx, 0.05, cz + z), [1.23, 0.02, 0.02], { all: [RW, BRASS, MM.brass] });
  }
  { // 落地燈：黃銅桿、白色燈罩（裡面亮）
    const x = -6.75, z = -12.15;
    S.geo(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 24).translate(x, 0.015, z), M4(), RW, BRASS, MM.brass);
    S.geo(new THREE.CylinderGeometry(0.014, 0.014, 1.5, 8).translate(x, 0.78, z), M4(), RW, BRASS, MM.brass);
    S.geo(new THREE.CylinderGeometry(0.2, 0.26, 0.32, 24, 1, true).translate(x, 1.62, z), M4(), RW, [1.7, 1.45, 1.15], MM.fabric);
    L.geo(new THREE.CircleGeometry(0.25, 24).rotateX(Math.PI / 2).translate(x, 1.465, z), M4(), RW, [4, 3.1, 2.1], MM.lamp);
  }
  { // 盆栽（黑色高盆＋一叢長葉子）
    for (const [x, z] of [[-0.55, -12.1], [-11.9, 11.9], [-11.9, -11.9]]) {
      S.geo(new THREE.CylinderGeometry(0.26, 0.2, 0.62, 20).translate(x, 0.31, z), M4(), RW, [0.015, 0.015, 0.016], MM.gloss);
      for (let i = 0; i < 26; i++) {
        const a = rnd() * Math.PI * 2, tilt = 0.12 + rnd() * 0.42, len = 0.7 + rnd() * 0.75, g = new THREE.PlaneGeometry(0.075, len, 1, 3);
        const p = g.attributes.position; for (let k = 0; k < p.count; k++) { const t = (p.getY(k) + len / 2) / len; p.setX(k, p.getX(k) * (1 - t * 0.85)); p.setZ(k, t * t * 0.18); }
        g.translate(0, len / 2, 0); g.computeVertexNormals();
        const m = M4().makeTranslation(x, 0.6, z).multiply(M4().makeRotationY(a)).multiply(M4().makeRotationX(tilt));
        const gc = 0.5 + rnd() * 0.5; S.geo(g, m, RW, [0.03 * gc, 0.1 * gc, 0.035 * gc], MM.leather);
        const g2 = g.clone(); g2.index && g2.setIndex([...g2.index.array].reverse()); // 背面也要（葉子兩面都看得到）
        const nn = g2.attributes.normal; for (let k = 0; k < nn.count; k++) nn.setXYZ(k, -nn.getX(k), -nn.getY(k), -nn.getZ(k));
        S.geo(g2, m, RW, [0.025 * gc, 0.08 * gc, 0.03 * gc], MM.leather);
      }
      COLS.push({ t: 'circle', x, z, r: 0.35, h: 1.4 });
    }
  }
  COLS.push({ t: 'box', x: -4.0, z: -10.9, hx: 2.6, hz: 1.85, rot: 0, h: 0.9 }); // 休息區整塊
  AO_BOX.push([-4.0, -12.2, 1.55, 0.5], [-6.05, -10.35, 0.42, 0.42], [-1.95, -10.35, 0.42, 0.42], [-4.0, -10.35, 0.65, 0.36]);

  // ---- 獎盃（九個，越後面越大越華麗；按順序合進一個網格，setTrophies 用 drawRange 只畫前 n 個；第一個在最看得到的那頭）----
  const BRONZE = [0.78, 0.44, 0.2], SILVER = [0.9, 0.91, 0.93], GOLD = [1.0, 0.72, 0.26], BASE = [0.02, 0.02, 0.022];
  const TROPHY_U = Array.from({ length: 9 }, (_, k) => TC1 - 0.38 - k * 0.405);
  const ends = [0];
  const star = (r0, r1, dd) => { const s = new THREE.Shape(); for (let i = 0; i < 10; i++) { const r = i & 1 ? r1 : r0, t = Math.PI / 2 + (i * Math.PI) / 5; s[i ? 'lineTo' : 'moveTo'](Math.cos(t) * r, Math.sin(t) * r); } return new THREE.ExtrudeGeometry(s, { depth: dd, bevelEnabled: false }).translate(0, 0, -dd / 2); };
  TROPHY_U.forEach((u, k) => {
    const s = [0.96, 1.03, 1.1, 1.2, 1.27, 1.34, 1.44, 1.56, 1.8][k], mc = k < 3 ? BRONZE : k < 6 ? SILVER : GOLD, big = k === 8;
    const m0 = at('C', u, TCY, 0.25), P = (x, y, z, rz = 0) => m0.clone().multiply(M4().makeRotationZ(rz).setPosition(x, y, z));
    let y = 0;
    const bw = 0.11 * s, bh = 0.045 * s;
    T.box(P(0, bh / 2, 0), [bw, bh, bw], { all: [RW, BASE], skip: 'ny' }); y = bh;
    if (k >= 4) { T.box(P(0, y + 0.018 * s, 0), [bw * 0.72, 0.036 * s, bw * 0.72], { all: [RW, BASE], skip: 'ny' }); y += 0.036 * s; }
    if (k >= 6) T.box(P(0, bh * 0.55, 0), [bw + 0.006, 0.012 * s, bw + 0.006], { all: [RW, mc], skip: 'ny py' }); // 金色腰帶
    const hs = (k === 2 || k === 5 ? 0.1 : 0.055) * s;
    T.geo(new THREE.CylinderGeometry(0.009 * s, 0.017 * s, hs, 10), P(0, y + hs / 2, 0), RW, mc); y += hs;
    if (k === 2 || k === 5) { T.geo(star(0.075 * s, 0.032 * s, 0.018 * s), P(0, y + 0.07 * s, 0), RW, mc); ends.push(T.count); return; } // 星星獎盃
    const cup = [[0.012, 0], [0.024, 0.006], [0.036, 0.022], [0.05, 0.055], [0.06, 0.095], [0.066, 0.135], [0.07, 0.165], [0.074, 0.172], [0.066, 0.172], [0.058, 0.14]].map(([r, h]) => new THREE.Vector2(r * s, h * s));
    T.geo(new THREE.LatheGeometry(cup, 20), P(0, y, 0), RW, mc);
    if (k === 1 || k >= 4) for (const sd of [-1, 1]) T.geo(new THREE.TorusGeometry((big ? 0.045 : 0.034) * s, 0.0065 * s, 6, 14, Math.PI), P(sd * 0.066 * s, y + 0.105 * s, 0, -sd * Math.PI / 2), RW, mc);
    if (big) { // 第 9 個：蓋子＋星星
      T.geo(new THREE.CylinderGeometry(0.02 * s, 0.07 * s, 0.03 * s, 20), P(0, y + 0.187 * s, 0), RW, mc);
      T.geo(new THREE.SphereGeometry(0.014 * s, 10, 8), P(0, y + 0.21 * s, 0), RW, mc);
      T.geo(star(0.045 * s, 0.02 * s, 0.012 * s), P(0, y + 0.255 * s, 0), RW, mc);
    }
    ends.push(T.count);
  });

  // ---- 輪胎＋輪框（八組，輪胎架上）：不會動，直接合進房子的網格（省兩個 draw call）；斜著擺（看得到胎面才像輪胎）、胎壁一圈細金字條；五輻輪框、每組顏色不一樣 ----
  {
    const pr = [[0.236, -0.1], [0.236, -0.112], [0.26, -0.121], [0.3, -0.121], [0.32, -0.11], [0.33, -0.085], [0.333, -0.04], [0.333, 0.04], [0.33, 0.085], [0.32, 0.11], [0.3, 0.121],
      [0.2945, 0.1212], [0.294, 0.1212], [0.285, 0.1213], [0.2845, 0.1212], [0.26, 0.121], [0.236, 0.112], [0.236, 0.1]].map(([r, y]) => new THREE.Vector2(r, y));
    const lip = [[0.237, 0.098], [0.229, 0.104], [0.214, 0.1], [0.21, 0.09]].map(([r, y]) => new THREE.Vector2(r, y));
    const tyreG = () => { // 輪胎：黑橡膠，外側胎壁一圈金色細字條（頂點色）
      const g = new THREE.LatheGeometry(pr, 40), c = [], p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getZ(i)), y = p.getY(i); c.push(...(y > 0.119 && r > 0.2843 && r < 0.2947 ? [0.75, 0.55, 0.12] : [0.026, 0.026, 0.028])); }
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); return g;
    };
    const TYRE = [0.78, 0, 0, 0.2], RIM = [0.2, 1, 0, 0.3];
    const RIMC = [[0.92, 0.92, 0.94], [0.08, 0.08, 0.09], [0.9, 0.64, 0.26], [0.42, 0.43, 0.46], [0.92, 0.92, 0.94], [0.62, 0.36, 0.18], [0.08, 0.08, 0.09], [0.9, 0.64, 0.26]];
    RIMC.forEach((rc, i) => {
      const lv = [0.32, 1.22][Math.floor(i / 4)], u = 5.7 + (i % 4) * 1.25;
      const m = at('B', u, lv + 0.335, 0.3).multiply(M4().makeRotationY(-0.45)).multiply(M4().makeRotationX(Math.PI / 2)), mm = (t) => m.clone().multiply(t);
      S.geo(tyreG(), m, RW, null, TYRE);
      S.geo(new THREE.LatheGeometry(lip, 40), m, RW, rc, RIM); // 輪框外緣
      S.geo(new THREE.CircleGeometry(0.215, 32).rotateX(-Math.PI / 2).translate(0, 0.03, 0), m, RW, rc.map((v) => v * 0.08), RIM); // 輪框裡面（暗）
      for (let k = 0; k < 5; k++) S.box(mm(M4().makeRotationY((k * 2 * Math.PI) / 5).multiply(M4().makeTranslation(0.135, 0.075, 0))), [0.17, 0.03, 0.062], { all: [RW, rc, RIM], skip: 'ny' }); // 五根輻條
      S.geo(new THREE.CylinderGeometry(0.058, 0.062, 0.03, 20), mm(M4().makeTranslation(0, 0.08, 0)), RW, rc, RIM); // 中心蓋
    });
  }

  // ---- 鐵捲門：41 片鋁門片（最下面那片是底條），InstancedMesh；裡面那面拉絲鋁、外面那面白色烤漆 ----
  const SLAT = 0.1, NS = 41, XC = XD - 0.07, YT = 4.12, R0 = 0.14; // 片高、片數、門片平面、捲筒切點高、捲筒外半徑
  const slatGeo = (side) => { // 本地：x＝往外（門外）、y＝沿著門往上、z＝沿著門片；side −1＝裡面那面、+1＝外面那面
    const b = batch(), prof = [[0.004, -0.05, 0.3], [0.004, -0.044, 0.3], [0.008, -0.042, 0.8], [0.011, -0.02, 1], [0.012, 0, 1], [0.011, 0.024, 1], [0.008, 0.043, 0.85], [0.004, 0.045, 0.35], [0.004, 0.05, 0.35]];
    const z0 = -DZ - 0.06, z1 = DZ + 0.06;
    for (let i = 0; i < prof.length - 1; i++) {
      const [x0, y0, c0] = prof[i], [x1, y1, c1] = prof[i + 1], a = V(side * x0, y0, z0), bb = V(side * x0, y0, z1), c = V(side * x1, y1, z1), d = V(side * x1, y1, z0);
      const r = [R.BRUSH[0], R.BRUSH[1] + (R.BRUSH[3] - R.BRUSH[1]) * (i / prof.length), R.BRUSH[2], R.BRUSH[1] + (R.BRUSH[3] - R.BRUSH[1]) * ((i + 1) / prof.length)];
      const k = (c0 + c1) / 2, cc = [k, k, k]; // 每一條一個顏色（很細的面顏色有漸層的話，MSAA 在三角形外面取樣會外插出負的顏色 → 反射裡一顆一顆的亮點）
      const mt = [k, 0, 0, 0]; // 裡面那面的材質用 aMat.x 當溝的深淺（反射的時候換成平均值）；外面那面用頂點色
      if (side > 0) b.quad(bb, a, d, c, [r[2], r[1], r[0], r[3]], cc, mt); else b.quad(a, bb, c, d, r, cc, mt); // 裡面那面朝 −x、外面那面朝 +x
    }
    return b.build();
  };
  // 裡面那面：鏡面地板的反射那一次（鏡頭在地板下面）門片畫成平的（溝用平均的亮度、法線朝房間）：半解析度的反射畫一條一條的溝會變成摩爾紋
  const doorInMat = patch(new THREE.MeshStandardMaterial({ map: atlasTex, color: new THREE.Color(...ALU), metalness: 0.85, roughness: 0.34 }), 'doorIn', { wash: true, more: (sh) => {
    sh.vertexShader = 'attribute vec4 aMat; varying float vGroove; varying vec3 vFlatN;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vGroove = aMat.x; vFlatN = (viewMatrix * modelMatrix * vec4(-1.0, 0.0, 0.0, 0.0)).xyz;');
    sh.fragmentShader = 'varying float vGroove; varying vec3 vFlatN;\n' + sh.fragmentShader
      .replace('void main() {', 'void main() {\n  vec3 dN = vCam.y < 0.0 ? vec3(-1.0, 0.0, 0.0) : normalize(vLocN);')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= vCam.y < 0.0 ? 0.7 : vGroove;')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  if (vCam.y < 0.0) normal = normalize(vFlatN);')
      .replaceAll('roomAmb(vLocN, vLoc)', 'roomAmb(dN, vLoc)').replaceAll('roomWash(vLocN, vLoc,', 'roomWash(dN, vLoc,');
  } });
  const doorOutMat = keep(new THREE.MeshStandardMaterial({ map: atlasTex, vertexColors: true, color: 0xf1f1ee, metalness: 0.15, roughness: 0.42 }));
  const slatsIn = keep(new THREE.InstancedMesh(slatGeo(-1), doorInMat, NS)), slatsOut = keep(new THREE.InstancedMesh(slatGeo(1), doorOutMat, NS));
  slatsIn.frustumCulled = slatsOut.frustumCulled = false;
  slatsIn.name = 'roomDoor'; slatsOut.name = 'roomDoorOut';
  { const c = new THREE.Color(0.55, 0.56, 0.58); slatsIn.setColorAt(0, c); slatsOut.setColorAt(0, c); for (let i = 1; i < NS; i++) { slatsIn.setColorAt(i, new THREE.Color(1, 1, 1)); slatsOut.setColorAt(i, new THREE.Color(1, 1, 1)); } }
  const DS = { t: 0, target: 0, speed: 1, clock: 0 };
  const _m = M4(), _q = new THREE.Quaternion(), _p = V(0, 0, 0), _s = V(1, 1, 1), ZAX = V(0, 0, 1);
  function layoutDoor() { // 最下面那片的底在 t × 門高；掛著的直直沿導軌，超過切點的捲在捲筒上（往裡面一圈比一圈小）
    const yb = DS.t * DH, Lh = YT - yb;
    for (let i = 0; i < NS; i++) {
      const u = (i + 0.5) * SLAT;
      if (u <= Lh) { _p.set(XC, yb + u, 0); _q.identity(); }
      else { const w = u - Lh, r = Math.max(0.07, R0 - (0.016 * w) / (2 * Math.PI * R0)), ph = w / r; _p.set(XC - R0 + r * Math.cos(ph), YT + r * Math.sin(ph), 0); _q.setFromAxisAngle(ZAX, ph); }
      _m.compose(_p, _q, i === 0 ? _s.set(1.25, 1, 1) : _s.set(1, 1, 1));
      slatsIn.setMatrixAt(i, _m); slatsOut.setMatrixAt(i, _m);
    }
    slatsIn.instanceMatrix.needsUpdate = slatsOut.instanceMatrix.needsUpdate = true;
  }
  layoutDoor();

  // ---- 外殼（村子才有）：外牆白大理石板＋黑大理石牆腳、女兒牆、屋頂；門面：黑色門框、招牌、兩邊直的壁燈、牆腳的車道燈、警示燈、密碼盤 ----
  const EROWS = [0.4, 2.0, 3.6, 5.25], PAR = 5.25; // 外牆石板的排（牆腳黑的到 0.4）
  const EFY0 = DH + 0.5, EFY1 = PAR - 0.1, EFU = DZ + 1.45; // 門上面的黑大理石橫帶（招牌）
  const eslabs = (w, u0, u1, rows = EROWS) => slabs(w, u0, u1, rows, { cw: 1.5, mat: MM.honed, bt: E });
  const eplinth = (w, u0, u1) => { wq(E, w, u0, u1, 0, EROWS[0], 0.02, 'M', W1, MM.nero, true); wqUp(E, w, u0, u1, EROWS[0], 0, 0.02, RW, BLK, MM.gloss); };
  const ecap = (w, u0, u1) => { // 女兒牆頂：白石＋一條古銅線＋金屬蓋
    slabs(w, u0, u1, [PAR, TOP - 0.06], { cw: 1.5, n: 0.03, mat: MM.honed, bt: E });
    wqDown(E, w, u0, u1, PAR, 0, 0.03, RW, [0.3, 0.29, 0.28], MM.satin);
    wb(E, w, u0, u1, PAR + 0.03, PAR + 0.05, 0.03, 0.036, { pz: [RW, [0.45, 0.33, 0.18], MM.brass] });
    wb(E, w, u0 - 0.04, u1 + 0.04, TOP - 0.06, TOP, -WT - 0.02, 0.06, { py: [RW, [0.62, 0.62, 0.6], MM.alu], pz: [RW, [0.62, 0.62, 0.6], MM.alu], ny: [RW, [0.3, 0.3, 0.3], MM.alu] });
  };
  for (const [w, u0, u1] of [['EA', -ZO, ZO], ['EC', XBO, XO], ['ED', -XO, -XBO]]) { eslabs(w, u0, u1); eplinth(w, u0, u1); ecap(w, u0, u1); }
  { // 門面（EB：u = −z）：門洞四周一圈黑色門框（凸出 6 公分）；上面一條黑大理石橫帶（上下黃銅線）放金色招牌；兩邊直條壁燈、牆腳車道燈、警示燈、密碼盤
    const P0 = DZ + 0.34, PY = DH + 0.34;
    eslabs('EB', -ZO, -P0); eslabs('EB', P0, ZO); eplinth('EB', -ZO, -P0); eplinth('EB', P0, ZO); ecap('EB', -ZO, ZO);
    eslabs('EB', -P0, P0, [PY, PAR]);
    const pf = { pz: [RW, [0.012, 0.012, 0.013], MM.satin], px: [RW, BLK, MM.satin], nx: [RW, BLK, MM.satin], py: [RW, BLK, MM.satin], ny: [RW, BLK, MM.satin] };
    wb(E, 'EB', -P0, -DZ, 0, PY, 0, 0.06, pf); wb(E, 'EB', DZ, P0, 0, PY, 0, 0.06, pf); wb(E, 'EB', -DZ, DZ, DH, PY, 0, 0.06, pf);
    wb(E, 'EB', -EFU, EFU, EFY0, EFY1, 0, 0.05, { px: [RW, BLK, MM.gloss], nx: [RW, BLK, MM.gloss], py: [RW, BLK, MM.gloss], ny: [RW, BLK, MM.gloss] });
    slabs('EB', -EFU, EFU, [EFY0, EFY1], { cw: 2.2, n: 0.05, mat: MM.nero, bt: E });
    for (const y of [EFY0 + 0.035, EFY1 - 0.035]) wb(E, 'EB', -EFU + 0.06, EFU - 0.06, y - 0.008, y + 0.008, 0.05, 0.055, { pz: [RW, BRASS, MM.brass], py: [RW, BRASS, MM.brass], ny: [RW, BRASS, MM.brass] });
    for (const s of [-1, 1]) { // 壁燈：黑色直條、中間一條暖白燈
      const u = s * (P0 + 0.45);
      wb(E, 'EB', u - 0.06, u + 0.06, 0.9, 3.4, 0, 0.05, { all: [RW, [0.015, 0.015, 0.016], MM.satin], skip: 'nz' });
      wq(EL, 'EB', u - 0.02, u + 0.02, 0.95, 3.35, 0.052, RW, [4.2, 3.2, 2.1], MM.lamp);
    }
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) { const u = s * (P0 + 1.2 + k * 2.3); wq(EL, 'EB', u - 0.14, u + 0.14, 0.14, 0.2, 0.021, RW, [3.6, 2.7, 1.8], MM.lamp); } // 牆腳的車道燈
    wb(E, 'EB', P0 + 0.1, P0 + 0.26, 1.15, 1.4, 0, 0.02, { pz: [R.KEYP, W1, MM.gloss], all: [RW, BLK, MM.satin], skip: 'nz' }); // 密碼盤（從外面看門的右邊）
    { const u = P0 - 0.17, y = DH + 0.17; wb(E, 'EB', u - 0.07, u + 0.07, y - 0.06, y + 0.06, 0.06, 0.08, { all: [RW, GUN, MM.satin], skip: 'nz' }); // 警示燈（門框右上角）
      EL.geo(new THREE.SphereGeometry(0.042, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.8), at('EB', u, y, 0.08), RW, AMBER, MM.blink); }
  }
  { // 屋頂＋女兒牆內側
    const y = 5.1;
    E.quad(V(XBO + WT, y, ZO - WT), V(XO - WT, y, ZO - WT), V(XO - WT, y, -ZO + WT), V(XBO + WT, y, -ZO + WT), RW, [0.42, 0.42, 0.41], MM.paint);
    const pin = (a, b) => E.quad(a, b, b.clone().setY(TOP - 0.06), a.clone().setY(TOP - 0.06), RW, [0.5, 0.5, 0.49], MM.paint);
    const x0 = XBO + WT, x1 = XO - WT, z0 = -ZO + WT, z1 = ZO - WT;
    pin(V(x0, y, z0), V(x1, y, z0)); pin(V(x1, y, z0), V(x1, y, z1)); pin(V(x1, y, z1), V(x0, y, z1)); pin(V(x0, y, z1), V(x0, y, z0));
    for (const z of [-8.9, -7.3]) { // 冷氣室外機（淺灰、上面黑色風扇），最高 5.9（整棟不超過 6 公尺）
      E.box(M4().makeTranslation(-10.2, y + 0.4, z), [1.2, 0.8, 1.0], { all: [RW, [0.62, 0.63, 0.64], MM.satin], skip: 'ny' });
      E.geo(new THREE.CircleGeometry(0.34, 20).rotateX(-Math.PI / 2).translate(-10.2, y + 0.803, z), M4(), RW, [0.03, 0.03, 0.035], MM.satin);
    }
    E.box(M4().makeTranslation(-3.5, y + 0.3, 9.6), [1.1, 0.6, 1.1], { all: [RW, [0.55, 0.55, 0.56], MM.satin], skip: 'ny' }); // 屋頂出入口
  }

  // ---- 地板：Reflector（高畫質）或亮面（低畫質），大理石、轉盤、車位、門檻全部在 shader 裡算 ----
  const G_AOF = AO_BOX.map(([x, z, hx, hz]) => `  ao *= 1.0 - 0.42 * exp(-max(sdb(q, vec2(${f3(x)}, ${f3(z)}), vec2(${f3(hx)}, ${f3(hz)})), 0.0) / 0.13);`).join('\n');
  const FLOOR_GLSL = G_FLOOR.replace('__AO__', G_AOF);
  const FLOOR_REF = 1.7, FLOOR_DIF = 0.86; // 地板：反射加強（拋光石材比 F0 0.04 亮）、漫射暗一點（看得到車的倒影）
  const FW = 14 - XB, FD = 2 * ZS; // 車庫頁：地板鋪到門外 x = 14（鏡頭會繞到門外）；村子：牆外面就收起來（uApron）
  const floorGeo = keep(new THREE.PlaneGeometry(FW, FD).translate((14 + XB) / 2, 0, 0));
  let floor, refl = null;
  const floorMat = keep(new THREE.MeshStandardMaterial({ roughness: 0.08, metalness: 0 }));
  if (hi) {
    const rs = renderer.getDrawingBufferSize(new THREE.Vector2());
    refl = new Reflector(floorGeo, { textureWidth: Math.max(2, Math.round(rs.x / 2)), textureHeight: Math.max(2, Math.round(rs.y / 2)), clipBias: 0.002, multisample: 0,
      shader: { name: 'RoomFloorStub', uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null } }, vertexShader: 'void main() { gl_Position = vec4(0.0); }', fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }' } });
    const stub = refl.material;
    floorMat.userData.refl = { tRefl: { value: refl.getRenderTarget().texture }, uReflM: { value: stub.uniforms.textureMatrix.value }, uTexel: { value: new THREE.Vector2(2 / rs.x, 2 / rs.y) } };
    stub.dispose(); refl.material = floorMat;
    const ob = refl.onBeforeRender; // 反射只畫 layer 0：頁面想省的東西（例如車內）放到別的 layer 就不會被反射
    refl.onBeforeRender = function (r, s, cam) { refl.getReflectionCamera(cam).layers.set(0); ob.call(this, r, s, cam); };
    floor = refl;
  } else floor = new THREE.Mesh(floorGeo, floorMat);
  floorMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, floorMat.userData.refl || {});
    sh.vertexShader = VH + 'uniform float uApron;\n' + (hi ? 'uniform mat4 uReflM; varying vec4 vReflUv;\n' : '') + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed.x = min(transformed.x, uApron);')
      .replace('#include <project_vertex>', `#include <project_vertex>\n  vLoc = vec3(transformed.x, 0.0, -transformed.y); vLocN = vec3(0.0, 1.0, 0.0); vCam = (uW2L * vec4(cameraPosition, 1.0)).xyz;${hi ? '\n  vReflUv = uReflM * vec4(transformed, 1.0);' : ''}`);
    sh.fragmentShader = G_DEF + FH + G_AMB + FLOOR_GLSL + (hi ? 'uniform sampler2D tRefl; uniform vec2 uTexel; varying vec4 vReflUv;\nvec3 rTap(vec2 uv) { return clamp(texture2D(tRefl, uv).rgb, 0.0, 40.0); }\n' : '') + sh.fragmentShader
      .replace('void main() {', 'void main() {\n  vec3 fAlb, fEmit; float fRough, fMetal, fAo;\n  roomFloor(vLoc.xz, fAlb, fRough, fMetal, fEmit, fAo);')
      .replace('#include <map_fragment>', '  diffuseColor.rgb = fAlb;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = fRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = fMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += fEmit;')
      .replace('#include <lights_fragment_begin>', '#undef RE_Direct\n#undef RE_Direct_RectArea\n#include <lights_fragment_begin>\n  irradiance = vec3(0.0);')
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
  iblIrradiance = PI * roomAmb(vec3(0.0, 1.0, 0.0), vLoc) * fAo * ${f3(FLOOR_DIF)};${hi ? `
  { // 反射（半解析度）：模糊一點（九點），每塊磚歪一點點（真的石頭地板不會完全平）
    vec2 tI = floor(vLoc.xz / 1.2), uv = vReflUv.xy / vReflUv.w + (vec2(rHash(tI + 3.1), rHash(tI + 5.3)) - 0.5) * 0.0012 * gTile;
    vec2 o = uTexel * 0.9, e = uTexel * 1.8;
    vec3 rc = rTap(uv) * 0.2 + (rTap(uv + o) + rTap(uv - o) + rTap(uv + vec2(o.x, -o.y)) + rTap(uv + vec2(-o.x, o.y))) * 0.12
      + (rTap(uv + vec2(e.x, 0.0)) + rTap(uv - vec2(e.x, 0.0)) + rTap(uv + vec2(0.0, e.y)) + rTap(uv - vec2(0.0, e.y))) * 0.08;
    radiance = rc / (1.0 + 0.1 * max(rc.r, max(rc.g, rc.b))) * mix(0.55, 1.0, fAo) * ${f3(FLOOR_REF)};
  }` : `\n  radiance *= mix(0.55, 1.0, fAo) * (gTile > 0.5 ? ${f3(FLOOR_REF)} : 0.75); // 沒有即時反射：轉盤（黑）反射環境少一點，才不會整片灰白`}`);
  };
  floorMat.customProgramCacheKey = () => `room3-floor-${hi ? 'hi' : 'lo'}`;
  floor.rotation.x = -Math.PI / 2; floor.name = 'roomFloor';

  // ---- 組起來 ----
  const shellMat = patch(new THREE.MeshStandardMaterial({ map: atlasTex, emissiveMap: glowTex, emissive: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0 }), 'shell', { amat: true });
  const lightMat = patch(new THREE.MeshBasicMaterial({ vertexColors: true }), 'light', { lit: 'none', amat: true });
  const trophyMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 1 }), 'trophy', { more: (sh) => { // 金屬獎盃多一點假的頂燈反光（櫃子上面的燈）
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  { vec3 vW = normalize(vCam - vLoc), rW = reflect(-vW, normalize(vLocN));
    totalEmissiveRadiance += diffuseColor.rgb * (0.08 + 0.2 * max(vLocN.y, 0.0) + 1.3 * pow(max(dot(rW, vec3(0.0, 0.95, -0.3)), 0.0), 12.0)); }`);
  } });
  const glassMat = patch(new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.04, metalness: 0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true }), 'glass', { wash: false }); // 加色混合跟順序無關：雙面一次畫完
  const signMat = patch(new THREE.MeshBasicMaterial({ map: signTex, color: new THREE.Color(1.45, 1.45, 1.45), transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }), 'sign', { lit: 'none' });
  const extMat = patch(new THREE.MeshStandardMaterial({ map: atlasTex, vertexColors: true, roughness: 0.5, metalness: 0 }), 'ext', { lit: 'world', amat: true, cut: false });
  const signGeo = (() => { // 裡面：後牆橫帶上的招牌＋徽章、六塊名牌的字
    const b = batch(), [, , w, h] = SR.TEXT, sh = (FB1 - FB0) * 0.86, sw = (sh * w) / h, zc = 5.55, er = (FB1 - FB0) * 0.44;
    wq(b, 'A', -zc - sw / 2, -zc + sw / 2, FB0 + (FB1 - FB0 - sh) / 2, FB0 + (FB1 - FB0 + sh) / 2, 0.206, sreg(SR.TEXT));
    wq(b, 'A', zc - er, zc + er, (FB0 + FB1) / 2 - er, (FB0 + FB1) / 2 + er, 0.206, sreg(SR.EMB));
    BAYZ.forEach((z, i) => { const [, , pw, ph] = SR.PLQ(i), H2 = 0.26, W2 = (H2 * pw) / ph; wq(b, 'A', -z - W2 / 2, -z + W2 / 2, 1.71 - H2 / 2, 1.71 + H2 / 2, 0.027, sreg(SR.PLQ(i))); });
    return b.build();
  })();
  const extSignGeo = (() => { const b = batch(), [, , w, h] = SR.TEXT, sh = 0.74, sw = (sh * w) / h, yc = (EFY0 + EFY1) / 2; wq(b, 'EB', -sw / 2, sw / 2, yc - sh / 2, yc + sh / 2, 0.056, sreg(SR.TEXT)); return b.build(); })();
  const shellGeo = S.build(), lightGeo = L.build();
  const shell = new THREE.Mesh(shellGeo, shellMat), lights = new THREE.Mesh(lightGeo, lightMat), tro = new THREE.Mesh(T.build(), trophyMat), glass = new THREE.Mesh(GL.build(), glassMat);
  const sign = new THREE.Mesh(signGeo, signMat), extShell = new THREE.Mesh(E.build(), extMat), extLights = new THREE.Mesh(EL.build(), lightMat), extSign = new THREE.Mesh(extSignGeo, signMat);
  shell.name = 'roomShell'; lights.name = 'roomLights'; tro.name = 'roomTrophies'; glass.name = 'roomGlass'; sign.name = 'roomSign'; extShell.name = 'roomExtShell'; extLights.name = 'roomExtLights'; extSign.name = 'roomExtSign';
  sign.renderOrder = 2; extSign.renderOrder = 2; glass.renderOrder = 3;
  inner.add(floor, shell, lights, tro, glass, sign, slatsIn);
  outer.add(extShell, extLights, extSign, slatsOut);
  outer.visible = !!exterior;
  const setTrophies = (n) => { n = Math.max(0, Math.min(9, Math.floor(+n || 0))); tro.geometry.setDrawRange(0, ends[n]); tro.visible = n > 0; };
  setTrophies(0);
  // 每一格：世界 → 本地（切牆用）、環境貼圖跟著整棟轉（村子裡轉了角度，反射的方向要轉回房間的座標）
  const envRotation = new THREE.Euler();
  const ROOM_MATS = [shellMat, trophyMat, glassMat, doorInMat, floorMat];
  const syncRY = () => { const e = group.matrixWorld.elements, ry = Math.atan2(e[8], e[10]); if (ry !== envRotation.y) { envRotation.y = ry; for (const m of ROOM_MATS) m.envMapRotation.y = ry; } };
  shell.onBeforeRender = () => { U.uW2L.value.copy(group.matrixWorld).invert(); syncRY(); };
  floor.onBeforeRender = ((ob) => function (r, s, cam, ...rest) { U.uW2L.value.copy(group.matrixWorld).invert(); if (ob) ob.call(this, r, s, cam, ...rest); })(floor.onBeforeRender);

  // ---- 環境貼圖：同一個房間用不打光的材質畫（顏色＝底色 ×（環境光＋洗牆）＋發光），從主車位中間拍一個 PMREM ----
  const envScene = new THREE.Scene(); envScene.background = new THREE.Color(0.3, 0.29, 0.28);
  const envShellMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: atlasTex }, glow: { value: glowTex }, uMarble: { value: marbleTex }, uBlink: { value: 0 } }, vertexColors: true,
    vertexShader: 'attribute vec4 aMat; varying vec4 vMat; varying vec3 vLoc; varying vec3 vLocN; varying vec2 vUv2; varying vec3 vC;\nvoid main() { vUv2 = uv; vC = color; vMat = aMat; vLoc = position; vLocN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${G_DEF}${G_AMB}uniform sampler2D map, glow, uMarble; varying vec4 vMat; varying vec3 vLoc; varying vec3 vLocN; varying vec2 vUv2; varying vec3 vC;
void main() {
  vec3 mb = texture2D(uMarble, vUv2).rgb, alb = (vMat.z < 0.5 ? texture2D(map, vUv2).rgb : vMat.z < 1.5 ? mb : (vec3(1.0) - mb) * 0.12 + 0.008) * vC;
  vec3 c = alb * (roomAmb(vLocN, vLoc) * (1.0 - 0.55 * vMat.y) + roomWash(vLocN, vLoc, vMat.w)) + texture2D(glow, vUv2).rgb * step(vMat.z, 0.5);
  gl_FragColor = vec4(c, 1.0);
}`,
  });
  const envFloorMat = new THREE.ShaderMaterial({
    uniforms: { uMarble: { value: marbleTex }, uBayOcc: { value: [0, 0, 0, 0, 0, 0] }, uBlink: { value: 0 } },
    vertexShader: 'varying vec3 vLoc;\nvoid main() { vLoc = vec3(position.x, 0.0, -position.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${G_DEF}${G_AMB}${FLOOR_GLSL}varying vec3 vLoc;
void main() { vec3 a, e; float r, m, ao; roomFloor(vLoc.xz, a, r, m, e, ao); gl_FragColor = vec4(a * roomAmb(vec3(0.0, 1.0, 0.0), vLoc) * ao * (1.0 - 0.6 * m) + e, 1.0); }`,
  });
  const envLightMat = new THREE.ShaderMaterial({ vertexColors: true, // 燈：頂點色；會閃的（警示燈）在環境貼圖裡是關的
    vertexShader: 'attribute vec4 aMat; varying vec3 vC;\nvoid main() { vC = color * (1.0 - 0.97 * aMat.x); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vC;\nvoid main() { gl_FragColor = vec4(vC, 1.0); }' });
  const envFloor = new THREE.Mesh(new THREE.PlaneGeometry(XD - XB, 2 * ZS).translate((XD + XB) / 2, 0, 0), envFloorMat); envFloor.rotation.x = -Math.PI / 2;
  const envDoorMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.51, 0.52), vertexColors: true });
  const envDoor = new THREE.InstancedMesh(slatsIn.geometry, envDoorMat, NS); envDoor.instanceMatrix.copy(slatsIn.instanceMatrix); envDoor.frustumCulled = false;
  envScene.add(new THREE.Mesh(shellGeo, envShellMat), new THREE.Mesh(lightGeo, envLightMat), new THREE.Mesh(signGeo, signMat), envFloor, envDoor);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(envScene, 0.01, 0.05, 50, { size: 256, position: V(0, 1.0, 0) });
  for (const m of ROOM_MATS) if (m !== floorMat || !hi) { m.envMap = envRT.texture; m.envMapIntensity = 1; }
  pmrem.dispose(); envShellMat.dispose(); envFloorMat.dispose(); envLightMat.dispose(); envDoorMat.dispose(); envFloor.geometry.dispose(); envDoor.dispose();

  // ---- 鐵捲門 ----
  const door = {
    get t() { return DS.t; }, set t(v) { DS.t = DS.target = Math.max(0, Math.min(1, +v || 0)); U.uBlink.value = 0; layoutDoor(); },
    get moving() { return DS.t !== DS.target; },
    open(sec = 2.2) { DS.target = 1; DS.speed = 1 / Math.max(0.05, sec); },
    close(sec = 1.8) { DS.target = 0; DS.speed = 1 / Math.max(0.05, sec); },
    update(dt) {
      if (DS.t === DS.target) { if (U.uBlink.value) U.uBlink.value = 0; return false; }
      dt = Math.max(0, Math.min(0.1, +dt || 0)); DS.clock += dt;
      const st = DS.speed * dt;
      DS.t = DS.t < DS.target ? Math.min(DS.target, DS.t + st) : Math.max(DS.target, DS.t - st);
      const moving = DS.t !== DS.target;
      U.uBlink.value = moving && (DS.clock * 1.7) % 1 < 0.55 ? 1 : 0;
      layoutDoor();
      return moving;
    },
  };

  // ---- 停車位、碰撞、區域 ----
  const spots = { main: { x: 0, z: 0, heading: 0 }, bays: BAYZ.map((z) => ({ x: BX, z, heading: 0 })), outside: { x: XO + 4.2, z: 0, heading: 0 } };
  const WALLS = [
    { t: 'box', x: XD + WT / 2, z: -(ZO + DZ) / 2, hx: WT / 2, hz: (ZO - DZ) / 2, rot: 0, h: TOP },
    { t: 'box', x: XD + WT / 2, z: (ZO + DZ) / 2, hx: WT / 2, hz: (ZO - DZ) / 2, rot: 0, h: TOP },
    { t: 'box', x: XB - WT / 2, z: 0, hx: WT / 2, hz: ZO, rot: 0, h: TOP },
    { t: 'box', x: (XBO + XO) / 2, z: ZS + WT / 2, hx: (XO - XBO) / 2, hz: WT / 2, rot: 0, h: TOP },
    { t: 'box', x: (XBO + XO) / 2, z: -ZS - WT / 2, hx: (XO - XBO) / 2, hz: WT / 2, rot: 0, h: TOP },
  ];
  const DOOR_COL = { t: 'box', x: (XC - 0.08 + XO) / 2, z: 0, hx: (XO - XC + 0.08) / 2, hz: DZ, rot: 0, h: DH };
  // 本地 ↔ 世界（照 group 現在的位置、rotation.y）：toWorld({ x, z, heading }) → { x, z, heading }；toLocal(x, z) → { x, z }（判斷在不在 zones 裡用）
  const _w = V(0, 0, 0);
  const groupRY = () => { group.updateMatrixWorld(); const e = group.matrixWorld.elements; return Math.atan2(e[8], e[10]); };
  const toWorld = (p) => { const ry = groupRY(); _w.set(p.x, 0, p.z).applyMatrix4(group.matrixWorld); return { x: _w.x, z: _w.z, heading: (p.heading || 0) + ry }; };
  const toLocal = (x, z) => { group.updateMatrixWorld(); _w.set(x, group.matrixWorld.elements[13], z); group.worldToLocal(_w); return { x: _w.x, z: _w.z }; };
  // colliders(doorOpen, world)：world＝true 直接給世界座標（盒子的 rot 加上整棟轉的角度；跟 drive.js 一樣 rot＝rotation.y 的方向）
  const colliders = (doorOpen = DS.t >= 0.9, world = false) => {
    const out = [...WALLS, ...COLS, ...(doorOpen ? [] : [DOOR_COL])].map((c) => ({ ...c }));
    if (!world) return out;
    const ry = groupRY();
    for (const c of out) { _w.set(c.x, 0, c.z).applyMatrix4(group.matrixWorld); c.x = _w.x; c.z = _w.z; if (c.t === 'box') c.rot = (c.rot || 0) + ry; }
    return out;
  };
  const zones = { inside: { x: (XB + XD) / 2, z: 0, hx: (XD - XB) / 2, hz: ZS }, door: { x: XD, z0: -DZ, z1: DZ, x1: XO, h: DH }, apron: { x: XO + 3, z: 0, hx: 3, hz: DZ + 1 } };

  const setExterior = (on) => { on = !!on; outer.visible = on; U.uCut.value = on ? 0 : 1; U.uApron.value = on ? XO : 14; };
  setExterior(exterior);
  const setBays = (list = []) => {
    for (let i = 0; i < 6; i++) { const v = list[i]; bayNames[i] = v == null || v === false ? null : typeof v === 'string' ? v : v.name || ''; U.uBayOcc.value[i] = bayNames[i] == null ? 0 : 1; }
    drawSign('plaques'); signTex.needsUpdate = true;
  };
  const _c = V(0, 0, 0);
  const cull = (camera) => { // 村子用：門關著、鏡頭在外面 → 不畫裡面；鏡頭在裡面 → 不畫外殼
    if (!outer.parent) return;
    group.updateMatrixWorld(); syncRY(); _c.setFromMatrixPosition(camera.matrixWorld); group.worldToLocal(_c); // envRotation 在畫之前就對（停在裡面的車要用）
    const inside = _c.x > XB && _c.x < XD && Math.abs(_c.z) < ZS && _c.y < H;
    const out = _c.x > XO || _c.x < XBO || Math.abs(_c.z) > ZO || _c.y > TOP;
    inner.visible = !(out && DS.t === 0 && !door.moving);
    outer.visible = U.uCut.value === 0 && !inside;
  };

  const resize = (w, h) => {
    if (!refl) return;
    if (!w || !h) { const v = renderer.getDrawingBufferSize(new THREE.Vector2()); w = v.x; h = v.y; }
    const rw = Math.max(2, Math.round(w / 2)), rh = Math.max(2, Math.round(h / 2));
    refl.getRenderTarget().setSize(rw, rh); floorMat.userData.refl.uTexel.value.set(1 / rw, 1 / rh);
  };
  const dispose = () => {
    dead = true; group.removeFromParent();
    for (const o of trash) o.dispose();
    if (refl) refl.getRenderTarget().dispose();
    envRT.dispose();
  };
  return { group, env: envRT.texture, setTrophies, resize, dispose, ready, size: ROOM_SIZE, door, spots, colliders, zones, setExterior, setBays, cull, toWorld, toLocal, interior: inner, exterior: outer, envRotation };
}

// ---- sound.js ----
// ---- 引擎聲音：七台車各自的引擎聲，用 Web Audio 即時合成（沒有錄音檔）----
//
// 【API】
//   const audio = createEngineAudio({ volume: 0.9, muted: false });
//     建好也不會出聲：AudioContext 要等 resume() 才建（瀏覽器規定要有使用者手勢）
//   audio.resume()        在點擊／觸控的處理函式裡、任何 await 之前叫（例如「開始比賽」按鈕）：建立或喚醒 AudioContext、
//                         載入合成器。可以叫很多次，回傳 Promise<boolean>（true＝有聲音）
//   audio.setMuted(bool)  靜音；audio.muted 讀現在的狀態；audio.setVolume(0–1) 總音量；audio.mode：'worklet'｜'script'｜'off'
//   const v = audio.voice(key, { gain: 1, pan: 0, parts: [] })
//                         一台車一個聲音。key：gc8 yaris supra gtr p918 sp3 jesko（其他的用 supra）
//                         parts：裝了哪些引擎零件（車庫的 partsOf(key)）：exhaust、intake／filter、turbo、ecu、cams、
//                         header（GC8 等長頭段）、sc（SP3 機械增壓）、motorF／motorR／battery（918）會改變聲音
//                         同時最多兩個（你＋對手），第三個會把最舊的收掉；resume() 之前建也可以（有聲音以後才開始響）
//   v.set({ rpm, throttle, speed, limit })   每一幀叫（沒變的不用管，只送有變的）
//       rpm      轉速÷紅線 0–1.05（怠速約 0.1–0.14）
//       throttle 油門 0–1（放掉＝引擎煞車：渦輪車洩壓、會放炮的車啪啪響）
//       speed    車速 m/s（可省略；918 前輪電動馬達的聲音跟車速走）
//       limit    斷油轉速÷紅線（預設 1；起跑線上兩段式起步控制給 0.6，轉速頂在那裡「啪啪啪」）
//   v.shift()             升檔那一下：斷油、洩壓閥（渦輪車）、GT-R 的渦輪回流「嘟嘟嘟」、放炮、雙離合的「啵」
//   v.setGain(0–1)  v.setPan(−1–1)  v.dispose()（0.1 秒淡出）  v.alive
//   audio.dispose()       全部收掉
//   沒有聲音可用（舊瀏覽器、被擋、沒權限）時每個函式照樣能叫，只是不出聲；不會丟錯誤。
//
// 【接到賽道（race.src.js）】
//   最上面建一次：const engineAudio = createEngineAudio(); let snd = null;
//   startRace() 的第一行（點擊裡、await 之前）：engineAudio.resume();
//   startRace() 設好 race.me、race.opp 之後：
//     snd?.me.dispose(); snd?.op.dispose();
//     snd = { me: engineAudio.voice(race.me.key, { parts: partsOf(race.me.key) }),
//             op: engineAudio.voice(race.opp.key, { gain: 0.55, pan: -0.25 }) };
//   raceFrame() 裡 stepRacer 算完之後：
//     const feed = (v, c) => v.set({ rpm: c.rpm, speed: c.v, limit: c.go == null ? 0.6 : 1,                   // 起步控制
//       throttle: c.go == null ? (R.phase === 'stage' || R.phase === 'run' ? 1 : 0) : c.fin != null || c.shiftT > 0 ? 0 : 1 });
//     if (snd) { feed(snd.me, me); if (op) feed(snd.op, op); }
//   換檔：shift(c) 回傳不是 null 才是真的換了 → pressGo 裡 if (q) snd?.me.shift()；對手那行改成 if (shift(op)) snd?.op.shift()
//   exitRace()：snd?.me.dispose(); snd?.op.dispose(); snd = null;
//   靜音按鈕：engineAudio.setMuted(!engineAudio.muted)
//   打包：build-app.mjs、build-art.mjs 的檔案清單加上 'sound.js'（只有 export const／export function，其他名字都是 SND_ 開頭）
//
// 【怎麼做的】每一缸照點火順序、在正確的曲軸角度噴一個排氣脈衝（水平對臥四缸不等長頭段兩邊慢一點、聲音不一樣，
// 所以會「咕嚕咕嚕」；直三、直六、平面曲軸 V8、V12 各自的間隔），每次燃燒大小有一點隨機，
// 再經過頭段、排氣管（固定長度的管子＝固定的共鳴，轉速掃過去音色會變）、消音器、管口；
// 加上進氣聲、燃燒的沙沙聲、渦輪（增壓跟著油門和轉速慢慢建立，有遲滯）的哨音和進氣聲、洩壓閥、放炮、918 的馬達聲。
// 合成器在 AudioWorklet 裡跑（用 Blob 網址載入）；不能用的話改用 ScriptProcessor 跑同一份程式。
// 總輸出經過高通、壓縮器、軟削波，不會爆音。

// ---- 合成器本體：一台車一個（這個函式整個被轉成字串放進 AudioWorklet，裡面不能用到外面的東西）----
function SND_core(P, sr, seed) {
  const TAU = 6.283185307179586, K = 32, dtc = K / sr, isr = 1 / sr, OUT = 0.25;
  let rs = seed >>> 0 || 0x2545f491;
  const nz = () => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return (rs | 0) * 4.656612873077393e-10; }; // −1..1（控制率用）
  const rnd = () => 0.5 + 0.5 * nz();
  const gs = () => nz() + nz() + nz(); // 約常態，標準差 1
  const cl = (x, a, b) => (x < a ? a : x > b ? b : x);
  const kc = (tau) => 1 - Math.exp(-dtc / tau); // 控制率（每 32 個取樣）的平滑係數
  const op = (hz) => 1 - Math.exp((-TAU * Math.min(hz, sr * 0.45)) / sr); // 一階低通係數
  // 二階濾波器：t＝0 低通、1 高通、2 帶通、3 峰值
  function sbq(o, t, f, q, db) {
    const w = (TAU * Math.min(f, sr * 0.45)) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2, a0 = 1 + al, a2 = 1 - al;
    const a1 = -2 * cs;
    if (t === 0) { b1 = 1 - cs; b0 = b2 = b1 / 2; }
    else if (t === 1) { b1 = -1 - cs; b0 = b2 = -b1 / 2; }
    else if (t === 2) { b0 = al; b1 = 0; b2 = -al; }
    else { const A = Math.pow(10, db / 40); b0 = 1 + al * A; b1 = a1; b2 = 1 - al * A; a0 = 1 + al / A; a2 = 1 - al / A; }
    o.b0 = b0 / a0; o.b1 = b1 / a0; o.b2 = b2 / a0; o.a1 = a1 / a0; o.a2 = a2 / a0;
    return o;
  }
  const bq = (t, f, q, db) => sbq({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 }, t, f, q, db);
  // 管子：延遲 ms、回授（開口端反射是負的）、回授裡的低通（管壁吸掉高頻）
  const cb = (g) => { const D = Math.max(2, Math.round((g.ms * sr) / 1000)); return { b: new Float32Array(D), i: 0, D, fb: g.fb, c: op(g.lp), s: 0 }; };
  const dly = (ms) => ({ b: new Float32Array(Math.max(1, Math.round((ms * sr) / 1000))), i: 0 });

  // ---- 每一缸（照點火順序）----
  const N = P.fire.length, W = P.width, iW = 1 / W;
  const fire = new Float64Array(N), st = new Float64Array(N), amp = new Float64Array(N), rr = new Float64Array(N);
  const rI = new Float64Array(N), dI = new Float64Array(N), sh = new Float64Array(N), ca = new Float64Array(N);
  const bank = new Uint8Array(N), on = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    bank[i] = P.bank[i] ? 1 : 0; fire[i] = P.fire[i] + (bank[i] ? P.uel || 0 : 0); st[i] = fire[i];
    ca[i] = (P.cylAmp && P.cylAmp[i]) || 1; rr[i] = 0.3; rI[i] = 1 / 0.3; dI[i] = 1 / 0.7;
  }
  // ---- 排氣：頭段（一邊或兩邊）→ 集合 → 排氣管兩段 → 渦輪 → 消音器 → 管口 ----
  const G = P.grp, H0 = cb(G[0]), H1 = G[1] ? cb(G[1]) : null, D1 = G[1] && G[1].pre > 0 ? dly(G[1].pre) : null;
  const g0 = G[0].gain, uHi = P.uelHi ?? P.uel ?? 0, g1Lo = G[1] ? G[1].gain : 0, g1Hi = G[1] ? G[1].gainHi ?? G[1].gain : 0;
  let g1 = g1Lo;
  const P1 = cb(P.pipe[0]), P2 = P.pipe[1] ? cb(P.pipe[1]) : null;
  const mLP = bq(0, P.lp, 0.75), eq = (P.eq || []).map((e) => bq(3, e[0], e[1], e[2]));
  const Q0 = eq[0] || null, Q1 = eq[1] || null, Q2 = eq[2] || null;
  const hpC = op(P.hp), rHP = bq(1, P.raspHz, 0.7), drive = P.drive, exh = P.exh;
  const fhC = op(220), flC = op(P.flowLP); // 排氣流動噪音：高通＋低通
  // 進氣
  const I = P.intake, iBP1 = bq(2, I.f, I.q), iBP2 = bq(2, I.f2, I.q2), ihC = op(2500), iPh = N / 720, iTone = I.tone, iMix = I.mix2;
  // 渦輪、洩壓閥、回流（flutter）
  const T = P.turbo, tw = !!(T && T.n > 1), bvHiss = T ? T.hiss : 0;
  const wBP = bq(2, 3000, 5), whBP = bq(2, 1200, 0.7), bvBP = bq(2, 2500, 1.2), flBP = bq(2, 1100, 1.3), flLP = bq(0, 500, 0.8);
  // 放炮、馬達、機械增壓
  const PP = P.pops, pHP = bq(1, 1500, 0.7), M = P.motor, SC = P.sc;
  const MX = P.mix || {}, mxE = MX.exh ?? 1, mxI = MX.intake ?? 1, mxT = MX.turbo ?? 1, mxB = MX.bov ?? 1, mxM = MX.motor ?? 1, mxP = MX.pops ?? 1;
  const crackL = PP.crack * mxP;

  // ---- 每個取樣都會改的狀態放在 Float64Array：閉包裡的小數每寫一次就要配置記憶體（V8），慢十倍 ----
  const Z = new Float64Array(32), NB = new Float32Array(K * 8);
  const PH = 0, DP = 1, IP = 2, RH = 3, CX = 4, CY = 5, DX = 6, DY = 7, TD = 8, IH = 9, BS = 10, WC = 11, WS = 12, WC2 = 13, WS2 = 14;
  const MC = 15, MS = 16, RC = 17, RS = 18, SCC = 19, SCS = 20, PE = 21, BT = 22, BE = 23, FP = 24, FE = 25, FL = 26, FH = 27;
  Z[WC] = Z[WC2] = Z[MC] = Z[RC] = Z[SCC] = 1; Z[DP] = (6 * P.idle * P.red) / sr;
  let rq = (seed ^ 0x5bd1e995) | 0 || 1;
  // ---- 控制率的狀態 ----
  let tR = P.idle, tT = 0, tS = -1, tL = 1, tG = 1, dead = false, t = 0, ctlN = 0;
  let r1 = P.idle, r2 = P.idle, rn = P.idle, thr = 0, spd = 0, gE = 0, wn = 0, aw = 0, ddph = 0, ld = 0, fuelCut = false, cutT = 0, limOn = false, limP = 0;
  let aF = 0, aM = 0, vr = 0, rF = 0.3, sF = 0.3, jit = 0, raspA = 0, flowA = 0, iA = 0, hsA = 0, gI = 1;
  let sp = 0, bst = 0, wA = 0, wNz = 0, whA = 0, tdC = 1, wcw = 1, wsw = 0, wcw2 = 1, wsw2 = 0;
  let bvA = 0, bvK = 0, bvAt = -9, flA = 0, flT = 0, flK = 0, flInc = 0, pK = 0;
  let popSeq = 0, popRate = 0, thrPk = 0, liftArm = false, pqN = 0;
  const pq = new Float64Array(3 * 12); // 排好的放炮：[幾秒後, 大小, 長度]
  let mcw = 1, msw = 0, mA = 0, mrcw = 1, mrsw = 0, mrA = 0, sccw = 1, scsw = 0, scA = 0;
  const sm = P.smooth || 0.01, kR = kc(sm), kTu = kc(0.025), kTd = kc(0.04), kSp = kc(0.06), kG = kc(0.012), kWn = kc(0.3), kAw = kc(0.15);
  const kBu = kc(0.12), kBd = kc(0.045);

  function qpop(dt, lvl, dur) {
    if (pqN >= 12) return;
    pq[pqN * 3] = dt; pq[pqN * 3 + 1] = lvl; pq[pqN * 3 + 2] = dur; pqN++;
  }
  function pop(lvl, dur) { // 碰：一小段雜訊灌進排氣管，讓管子的共鳴決定聲音
    const a = lvl * 2 * (0.5 + 0.5 * Math.min(rn, 1));
    if (a > Z[PE]) { Z[PE] = a; pK = Math.exp(-isr / dur); }
  }
  function blow(b) { // 放油門：洩壓閥（大氣式「噗嘶」、回流式「呼」）或渦輪回流「嘟嘟嘟」
    if (!T || b < 0.06 || t - bvAt < 0.3) return;
    bvAt = t;
    if (T.bov === 'flutter') { flA = 1; Z[FE] = b * T.bovLvl; flT = 0; Z[FP] = 0; flK = Math.exp(-isr / T.bovDur); flInc = 20 * isr; }
    else { bvA = b * T.bovLvl; Z[BT] = 0; Z[BE] = 0; bvK = Math.exp(-isr / T.bovDur); sbq(bvBP, 2, T.bovF[0], T.bovQ); }
  }
  function doShift() {
    cutT = P.cut;
    blow(bst);
    if (PP.shift > 0 && rn > 0.45 && rnd() < PP.shift) {
      let n = 1 + ((rnd() * 2.2 * PP.shift) | 0);
      while (n-- > 0) qpop(0.008 + rnd() * (P.cut + 0.05), PP.lvl * (0.6 + 0.5 * rnd()), 0.0025);
    }
    if (P.dct && rn > 0.4) qpop(0.006, PP.burp, 0.009); // 雙離合升檔的「啵」
  }
  // 一缸開始排氣：這次有沒有燒、燒多大
  function ev(i) {
    let f = !(cutT > 0 || fuelCut);
    if (f && limOn && rnd() < limP) {
      f = false;
      if (PP.als > 0 && rnd() < PP.als * 0.3) qpop(0.004 + 0.012 * rnd(), PP.lvl * 0.7 * (0.5 + 0.5 * rnd()), 0.0025);
    }
    if (f) { amp[i] = aF * ca[i] * (1 + vr * gs()); rr[i] = rF; sh[i] = sF; }
    else {
      amp[i] = aM * ca[i] * (1 + 0.2 * gs()); rr[i] = 0.4; sh[i] = 0;
      if (cutT > 0 && PP.shift > 0 && rnd() < 0.1 * PP.shift) qpop(0.003 + 0.01 * rnd(), PP.lvl * 0.45 * (0.5 + rnd()), 0.002);
    }
    if (amp[i] < 0) amp[i] = 0;
    rI[i] = 1 / rr[i]; dI[i] = 1 / (1 - rr[i]);
  }
  // 控制率（每 32 個取樣）：平滑、負載、渦輪、放炮、濾波器
  function ctl() {
    t += dtc;
    gE += (tG - gE) * kG;
    if (tG < 0.5 && gE < 1e-4) dead = true;
    r1 += (tR - r1) * kR; r2 += (r1 - r2) * kR;
    thr += (tT - thr) * (tT > thr ? kTu : kTd);
    if (tS >= 0) spd += (tS - spd) * kSp;
    const idl = cl((0.26 - r2) * 10, 0, 1); // 1＝怠速附近
    wn += (1.7 * nz() - wn) * kWn;
    aw += (1.7 * nz() - aw) * kAw;
    rn = r2 * (1 + P.wob * idl * (0.6 * Math.sin(TAU * 0.83 * t) + 0.4 * wn)); // 怠速會游動一點
    ddph = ((6 * rn * P.red) / sr - Z[DP]) / K; // 每個取樣走幾度曲軸
    ld = Math.max(thr, 0.3 * cl((0.24 - rn) * 10, 0, 1)); // 怠速也要一點油
    if (uHi !== (P.uel || 0) || g1Hi !== g1Lo) { // 不等長頭段：怠速「咕嚕」最明顯，高轉重負載兩邊比較接近
      const k = cl((rn - 0.18) * 2, 0, 1) * (0.4 + 0.6 * ld), u = (P.uel || 0) + (uHi - (P.uel || 0)) * k;
      g1 = g1Lo + (g1Hi - g1Lo) * k;
      for (let i = 0; i < N; i++) if (bank[i]) fire[i] = P.fire[i] + u;
    }
    fuelCut = tT < 0.04 && thr < 0.08 && rn > 0.22; // 引擎煞車：斷油
    if (cutT > 0) cutT -= dtc;
    limOn = tT > 0.5 && rn >= tL - 0.004;
    limP = 0.15 + 0.75 * cl((rn - tL + 0.004) * 50, 0, 1);
    const aR = 0.28 + 0.72 * Math.min(rn, 1.05);
    aF = aR * (0.18 + 0.82 * Math.pow(ld, 0.7)) * (1 + P.wander * aw); aM = aR * 0.09;
    const shp = Math.max(ld, 0.6 * idl); // 怠速的排氣脈衝也滿尖的（汽缸裡還有壓力），聽得到「噗噗」
    rF = 0.32 + (P.rise - 0.32) * shp; sF = 0.1 + (P.decay - 0.1) * shp;
    gI = 1 + (P.idleGain - 1) * idl;
    vr = P.vari * (1 + 1.2 * idl); jit = P.jit * (1 + idl);
    raspA = P.rasp * (0.2 + 0.8 * ld) * (fuelCut ? 0.35 : 1);
    flowA = P.flow * (0.12 + 0.88 * ld) * (0.15 + 0.85 * Math.min(rn, 1)) * (fuelCut ? 0.5 : 1);
    iA = I.lvl * (0.12 + 0.88 * thr) * (0.25 + 0.75 * rn) * (fuelCut ? 0.6 : 1);
    hsA = I.hiss * (0.1 + 0.9 * thr) * rn;
    // 放油門
    thrPk = Math.max(thrPk - dtc * 2.5, tT);
    if (tT > 0.5) liftArm = true;
    else if (liftArm && tT < 0.15) {
      liftArm = false;
      if (thrPk > 0.45) { blow(bst); if (PP.lift > 0 && rn > 0.4) { popSeq = PP.dur; popRate = PP.rate * PP.lift; } }
    }
    if (popSeq > 0) {
      popSeq -= dtc;
      if (tT < 0.15 && rn > 0.3 && rnd() < popRate * dtc * Math.min(1, (2 * popSeq) / PP.dur)) pop(PP.lvl * (0.35 + 0.75 * rnd()), 0.0015 + 0.003 * rnd());
    }
    for (let q = 0; q < pqN;) {
      if ((pq[q * 3] -= dtc) <= 0) {
        pop(pq[q * 3 + 1], pq[q * 3 + 2]); pqN--;
        pq[q * 3] = pq[pqN * 3]; pq[q * 3 + 1] = pq[pqN * 3 + 1]; pq[q * 3 + 2] = pq[pqN * 3 + 2];
      } else q++;
    }
    // 渦輪：增壓跟著油門、轉速慢慢上來（遲滯），放油門慢慢轉慢；哨音高低跟著渦輪轉速（增壓×流量）
    if (T) {
      const u = cl((rn - T.on[0]) / (T.on[1] - T.on[0]), 0, 1), tg = tT > 0.1 ? u * u * (3 - 2 * u) * (0.2 + 0.8 * thr) : 0.03 * rn;
      sp += (tg - sp) * (tg > sp ? dtc / T.up : dtc / T.down);
      const pb = thr > 0.3 ? sp : 0;
      bst += (pb - bst) * (pb > bst ? kBu : kBd);
      const fw = T.w[0] + (T.w[1] - T.w[0]) * sp * (0.45 + 0.55 * Math.min(rn, 1)), w = (TAU * fw) / sr;
      wcw = Math.cos(w); wsw = Math.sin(w);
      let m = 1.5 - 0.5 * (Z[WC] * Z[WC] + Z[WS] * Z[WS]); Z[WC] *= m; Z[WS] *= m;
      if (tw) { wcw2 = Math.cos(w * 1.0065); wsw2 = Math.sin(w * 1.0065); m = 1.5 - 0.5 * (Z[WC2] * Z[WC2] + Z[WS2] * Z[WS2]); Z[WC2] *= m; Z[WS2] *= m; }
      const lv = sp * Math.sqrt(sp) * (0.25 + 0.75 * thr) * T.whistle;
      wA = 0.16 * lv; wNz = 1.1 * lv;
      sbq(wBP, 2, fw, 6);
      whA = T.whoosh * 0.9 * sp * (0.15 + 0.85 * thr) * (0.3 + 0.7 * rn);
      sbq(whBP, 2, 600 + 1700 * sp, 0.7);
      tdC = op(9000 * (1 - T.damp * (0.3 + 0.7 * bst)));
      if (bvA > 0) sbq(bvBP, 2, T.bovF[1] + (T.bovF[0] - T.bovF[1]) * Math.exp(-Z[BT] / 0.12), T.bovQ);
      if (flA > 0) { flT += dtc; flInc = (9 + 11 * Math.exp(-flT / 0.25)) * isr; }
    }
    if (M) { // 918：前馬達跟車速、後馬達（接在引擎上）跟轉速
      const v = tS >= 0 ? spd : 0, w = (TAU * (M.f0 + M.k * v)) / sr, w2 = (TAU * rn * P.red * M.order) / 60 / sr;
      mcw = Math.cos(w); msw = Math.sin(w);
      let m = 1.5 - 0.5 * (Z[MC] * Z[MC] + Z[MS] * Z[MS]); Z[MC] *= m; Z[MS] *= m;
      mA = M.lvl * cl(v / 3, 0, 1) * (thr > 0.1 ? 0.35 + 0.65 * thr : 0.3);
      mrcw = Math.cos(w2); mrsw = Math.sin(w2);
      m = 1.5 - 0.5 * (Z[RC] * Z[RC] + Z[RS] * Z[RS]); Z[RC] *= m; Z[RS] *= m;
      mrA = M.lvlR * thr * cl(rn * 3, 0, 1);
    }
    if (SC) { // 機械增壓器的齒輪聲
      const w = (TAU * rn * P.red * SC.order) / 60 / sr;
      sccw = Math.cos(w); scsw = Math.sin(w);
      const m = 1.5 - 0.5 * (Z[SCC] * Z[SCC] + Z[SCS] * Z[SCS]); Z[SCC] *= m; Z[SCS] *= m;
      scA = SC.lvl * rn * (0.3 + 0.7 * thr);
    }
  }

  // ---- 一段一段算（每段最多 32 個取樣）：每一級是一個緊湊的迴圈，狀態放區域變數，不在每個取樣呼叫函式 ----
  const A0 = new Float64Array(K), A1 = new Float64Array(K), E0 = new Float64Array(K), E1 = new Float64Array(K), PS = new Float64Array(K);
  const DPS = new Float64Array(K), C = new Float64Array(K), Y = new Float64Array(K), U = new Float64Array(K), V = new Float64Array(K);
  function bqb(o, x, y, m) { // 二階濾波器，一整段
    const b0 = o.b0, b1 = o.b1, b2 = o.b2, a1 = o.a1, a2 = o.a2;
    let z1 = o.z1, z2 = o.z2;
    for (let j = 0; j < m; j++) { const v = x[j], w = b0 * v + z1; z1 = b1 * v - a1 * w + z2; z2 = b2 * v - a2 * w; y[j] = w; }
    o.z1 = z1; o.z2 = z2;
  }
  function cbb(o, x, m) { // 管子（梳狀），一整段，就地
    const b = o.b, D = o.D, fb = o.fb, c = o.c;
    let i = o.i, s = o.s;
    for (let j = 0; j < m; j++) { s += c * (b[i] - s); const v = x[j] + fb * s; b[i] = v; x[j] = v; if (++i >= D) i = 0; }
    o.i = i; o.s = s;
  }
  function dlb(o, x, m) { // 純延遲，就地
    const b = o.b, D = b.length;
    let i = o.i;
    for (let j = 0; j < m; j++) { const v = b[i]; b[i] = x[j]; x[j] = v; if (++i >= D) i = 0; }
    o.i = i;
  }
  const clr = (o) => { o.z1 = o.z2 = 0; };
  function render(out, n) {
    let s = 0;
    while (s < n) {
      if (ctlN <= 0) { ctl(); ctlN = K; }
      const m = Math.min(ctlN, n - s);
      // 雜訊（xorshift），這一段先算好
      let q = rq;
      for (let j = 0, e = m * 8; j < e; j++) { q ^= q << 13; q ^= q >>> 17; q ^= q << 5; NB[j] = q * 4.656612873077393e-10; }
      rq = q;
      // 1. 排氣脈衝：每一缸在自己的點火角度開始，寬度照曲軸角度（轉越快越短）
      {
        let ph = Z[PH], dp = Z[DP];
        const dd = ddph, jt = jit;
        for (let j = 0; j < m; j++) {
          dp += dd; ph += dp; if (ph >= 720) ph -= 720;
          let a0 = 0, a1 = 0, e0 = 0, e1 = 0;
          for (let i = 0; i < N; i++) {
            let a = ph - st[i]; if (a < 0) a += 720;
            if (a < W) {
              if (on[i] === 0) { if (a > 45) continue; on[i] = 1; ev(i); }
              const x = a * iW, r = rr[i];
              let y;
              if (x < r) { const u = x * rI[i]; y = u * u * (3 - 2 * u); }
              else { const d = 1 - (x - r) * dI[i], d2 = d * d; y = d2 * (1 - sh[i] + sh[i] * d2); }
              const v = amp[i] * y;
              if (bank[i] === 0) { a0 += v; e0 += v * y; } else { a1 += v; e1 += v * y; }
            } else if (on[i] === 1) { on[i] = 0; st[i] = fire[i] + jt * NB[j * 8 + 7]; }
          }
          A0[j] = a0; A1[j] = a1; E0[j] = e0; E1[j] = e1; PS[j] = a0 + a1; DPS[j] = dp;
        }
        Z[PH] = ph; Z[DP] = dp;
      }
      // 2. 燃燒的沙沙聲（高通雜訊，跟著脈衝）
      for (let j = 0; j < m; j++) U[j] = NB[j * 8];
      bqb(rHP, U, U, m);
      { const ra = raspA; for (let j = 0; j < m; j++) { const r = U[j] * ra; A0[j] += r * E0[j]; A1[j] += r * E1[j]; } }
      // 3. 頭段
      cbb(H0, A0, m);
      if (H1) { if (D1) dlb(D1, A1, m); cbb(H1, A1, m); }
      // 4. 集合：兩邊加起來＋排氣流動的噪音＋放炮，去直流
      let pop1 = false;
      {
        let fh = Z[FH], fl = Z[FL], pe = Z[PE], cx = Z[CX], cy = Z[CY];
        const fa = flowA, pk = pK;
        for (let j = 0; j < m; j++) {
          let c = A0[j] * g0 + A1[j] * g1;
          const fx = NB[j * 8 + 1] * (0.25 + PS[j]) * fa;
          fh += fhC * (fx - fh); fl += flC * (fx - fh - fl); c += fl;
          if (pe > 1e-5) { const x = pe * (0.55 * NB[j * 8 + 2] + 0.45); pe *= pk; c += x * mxP; V[j] = x; pop1 = true; } else V[j] = 0;
          cy = c - cx + 0.997 * cy; cx = c; C[j] = cy;
        }
        Z[FH] = fh; Z[FL] = fl; Z[PE] = pe; Z[CX] = cx; Z[CY] = cy;
      }
      if (pop1) { bqb(pHP, V, V, m); for (let j = 0; j < m; j++) Y[j] = V[j] * crackL; }
      else { clr(pHP); for (let j = 0; j < m; j++) Y[j] = 0; }
      // 5. 排氣管、渦輪、消音器、共鳴、管口（高通）、失真
      cbb(P1, C, m); if (P2) cbb(P2, C, m);
      if (T) { let td = Z[TD]; const k = tdC; for (let j = 0; j < m; j++) { td += k * (C[j] - td); C[j] = td; } Z[TD] = td; }
      bqb(mLP, C, C, m);
      if (Q0) bqb(Q0, C, C, m);
      if (Q1) bqb(Q1, C, C, m);
      if (Q2) bqb(Q2, C, C, m);
      {
        let rh = Z[RH];
        for (let j = 0; j < m; j++) {
          const c = C[j]; rh += hpC * (c - rh);
          let x = (c - rh) * drive;
          x = x < -3 ? -1 : x > 3 ? 1 : (x * (27 + x * x)) / (27 + 9 * x * x);
          Y[j] += x * exh * mxE;
        }
        Z[RH] = rh;
      }
      // 6. 進氣：跟著每一缸吸氣起伏的雜訊＋一點點音調；嘶嘶聲
      {
        let ip = Z[IP];
        const ia = iA;
        for (let j = 0; j < m; j++) {
          ip += DPS[j] * iPh; if (ip >= 1) ip -= 1;
          const e = 4 * ip * (1 - ip), e2 = e * e, n2 = NB[j * 8 + 3];
          U[j] = n2 * (0.3 + 0.7 * e2) + iTone * (e - 0.667); V[j] = n2 * e2;
        }
        Z[IP] = ip;
        if (ia > 1e-5) {
          bqb(iBP1, U, U, m); bqb(iBP2, V, V, m);
          for (let j = 0; j < m; j++) Y[j] += (U[j] + iMix * V[j]) * ia * mxI;
        }
        if (hsA > 1e-5) {
          let ih = Z[IH];
          const ha = hsA;
          for (let j = 0; j < m; j++) { const n3 = NB[j * 8 + 4]; ih += ihC * (n3 - ih); Y[j] += (n3 - ih) * ha * mxI; }
          Z[IH] = ih;
        }
      }
      // 7. 渦輪：哨音（兩顆的話差一點點頻率）、進氣的呼呼聲、洩壓閥、回流
      if (T) {
        let wc = Z[WC], ws = Z[WS], wc2 = Z[WC2], ws2 = Z[WS2];
        const a = wcw, b = wsw, a2 = wcw2, b2 = wsw2, wa = wA * mxT;
        for (let j = 0; j < m; j++) {
          let x = wc * a - ws * b; ws = ws * a + wc * b; wc = x;
          let wv = ws;
          if (tw) { x = wc2 * a2 - ws2 * b2; ws2 = ws2 * a2 + wc2 * b2; wc2 = x; wv = 0.6 * (ws + 0.8 * ws2); }
          Y[j] += wv * wa;
          U[j] = NB[j * 8 + 5]; V[j] = NB[j * 8 + 6];
        }
        Z[WC] = wc; Z[WS] = ws; Z[WC2] = wc2; Z[WS2] = ws2;
        bqb(wBP, U, U, m); bqb(whBP, V, V, m);
        { const wz = wNz * mxT, wh = whA * mxT; for (let j = 0; j < m; j++) Y[j] += U[j] * wz + V[j] * wh; }
        if (bvA > 0) {
          for (let j = 0; j < m; j++) U[j] = NB[j * 8 + 7];
          bqb(bvBP, U, U, m);
          let bt = Z[BT], be = Z[BE], bs = Z[BS];
          const ba = bvA * mxB, k = bvK;
          for (let j = 0; j < m; j++) {
            bt += isr;
            if (bt < 0.005) be = ba * bt * 200; else be *= k;
            const n4 = NB[j * 8 + 7]; bs += 0.3 * (n4 - bs);
            Y[j] += (U[j] + bvHiss * (n4 - bs)) * be;
          }
          Z[BT] = bt; Z[BE] = be; Z[BS] = bs;
          if (bt > 0.005 && be < 1e-4) { bvA = 0; clr(bvBP); }
        }
        if (flA > 0) {
          for (let j = 0; j < m; j++) U[j] = NB[j * 8 + 4];
          bqb(flBP, U, V, m); bqb(flLP, U, U, m);
          let fp = Z[FP], fe = Z[FE];
          const inc = flInc, k = flK;
          for (let j = 0; j < m; j++) {
            fp += inc; if (fp >= 1) fp -= 1;
            let e = 0;
            if (fp < 0.06) e = fp / 0.06; else if (fp < 0.5) { e = 1 - (fp - 0.06) / 0.44; e *= e; }
            fe *= k;
            Y[j] += (V[j] + 0.9 * U[j]) * e * fe * mxB * 5;
          }
          Z[FP] = fp; Z[FE] = fe;
          if (fe < 1e-4) { flA = 0; clr(flBP); clr(flLP); }
        }
      }
      // 8. 918 的馬達、機械增壓
      if (mA > 1e-5) {
        let c = Z[MC], d = Z[MS];
        const a = mcw, b = msw, h2 = M.h2 * 2, h3 = M.h3, g = mA * mxM;
        for (let j = 0; j < m; j++) { const x = c * a - d * b; d = d * a + c * b; c = x; Y[j] += (d + h2 * d * c + h3 * d * (3 - 4 * d * d)) * g; }
        Z[MC] = c; Z[MS] = d;
      }
      if (mrA > 1e-5) {
        let c = Z[RC], d = Z[RS];
        const a = mrcw, b = mrsw, g = mrA * mxM;
        for (let j = 0; j < m; j++) { const x = c * a - d * b; d = d * a + c * b; c = x; Y[j] += d * g; }
        Z[RC] = c; Z[RS] = d;
      }
      if (scA > 1e-5) {
        let c = Z[SCC], d = Z[SCS];
        const a = sccw, b = scsw, g = scA * mxM;
        for (let j = 0; j < m; j++) { const x = c * a - d * b; d = d * a + c * b; c = x; Y[j] += (d + 0.6 * d * c) * g; }
        Z[SCC] = c; Z[SCS] = d;
      }
      // 9. 音量、去直流、輸出
      {
        let dx = Z[DX], dy = Z[DY];
        const g = gE * gI * P.gain * OUT;
        for (let j = 0; j < m; j++) { const y = Y[j] * g; dy = y - dx + 0.9985 * dy; dx = y; out[s + j] = dy; }
        Z[DX] = dx; Z[DY] = dy;
      }
      s += m; ctlN -= m;
    }
  }
  return {
    set(r, th, s, l, g) {
      if (r === r && r != null) tR = cl(r, 0, 1.2);
      if (th === th && th != null) tT = cl(th, 0, 1);
      if (s === s && s != null) tS = s < 0 ? -1 : Math.min(s, 150);
      if (l === l && l != null) tL = cl(l || 1, 0.2, 1.2);
      if (g === g && g != null) tG = g > 0.5 ? 1 : 0;
    },
    shift: doShift,
    render,
    dead: () => dead,
    info: () => ({ rpm: rn, throttle: thr, load: ld, spool: sp, boost: bst, cut: cutT > 0, pops: pqN }),
  };
}

// ---- 七台車 ----
// fire：點火角度（720 度一個循環，照點火順序）；bank：那一缸排到哪一邊的頭段；uel：不等長頭段那一邊晚幾度
// width：排氣脈衝多寬（曲軸角度）；rise／decay：全油門時脈衝多尖；vari：每次燃燒大小的隨機；jit：時間的隨機（度）
// grp：頭段（ms＝來回的延遲、fb＝反射、lp＝管壁吸掉的高頻、gain、pre＝多繞的管子晚到幾 ms）；pipe：排氣管兩段
// lp／eq／hp：消音器低通、共鳴峰 [Hz, Q, dB]、管口高通；drive：失真（顆粒感）；rasp：燃燒沙沙聲
// turbo：on＝增壓從幾轉開始到幾轉滿（轉速÷紅線）、up／down＝渦輪轉起來／轉慢的秒數、w＝哨音頻率範圍、bov＝洩壓閥種類
// pops：lift＝放油門放炮、shift＝換檔放炮、als＝撞斷油的時候放炮（起步控制「啪啪啪」）、burp＝雙離合升檔的「啵」
// gain：音量校正（七台車用 K 加權響度對齊，見 sound-analyze.mjs）
const SND_BASE = {
  idle: 0.12, width: 120, rise: 0.08, decay: 0.8, vari: 0.05, jit: 0.8, wob: 0.012, uel: 0, cylAmp: null,
  rasp: 0.3, raspHz: 2500, flow: 0.45, flowLP: 3500, wander: 0.05, drive: 1.4, exh: 1, gain: 1, idleGain: 1, hp: 110, lp: 4000, eq: [], cut: 0.1, dct: false, smooth: 0.01,
  intake: { lvl: 0.1, f: 450, q: 1.5, f2: 1500, q2: 2, mix2: 0.5, tone: 0.3, hiss: 0.04 },
  pops: { lift: 0, shift: 0, lvl: 0.8, rate: 10, dur: 1.0, als: 0, crack: 0.25, burp: 0.6 },
  turbo: null, motor: null, sc: null,
};
const SND_I6 = [0, 120, 240, 360, 480, 600], SND_V8 = [0, 90, 180, 270, 360, 450, 540, 630];
const SND_CARS = {
  gc8: {
    name: 'EJ20 水平對臥四缸渦輪', red: 8000, idle: 0.11, gain: 0.94, idleGain: 2.7,
    fire: [0, 180, 360, 540], bank: [0, 0, 1, 1], cylAmp: [1, 0.96, 1.02, 0.97], uel: 14, uelHi: 5,
    width: 165, rise: 0.09, decay: 0.75, vari: 0.07, jit: 1.2, wob: 0.016,
    grp: [{ ms: 1.3, fb: -0.45, lp: 4200, gain: 1, pre: 0 }, { ms: 2.5, fb: -0.5, lp: 2800, gain: 0.78, gainHi: 0.94, pre: 0.45 }],
    pipe: [{ ms: 10.2, fb: -0.35, lp: 2200 }, { ms: 6.0, fb: -0.25, lp: 3000 }],
    lp: 3000, eq: [[160, 1.1, 4], [640, 1.4, 3], [1700, 2, 2]], hp: 100, drive: 1.6, rasp: 0.28, raspHz: 2200,
    intake: { lvl: 0.1, f: 420, q: 1.6, f2: 1300 },
    turbo: { n: 1, on: [0.33, 0.6], up: 0.45, down: 1.2, w: [2100, 5600], whistle: 0.35, whoosh: 0.4, damp: 0.35, bov: 'atmo', bovLvl: 0.9, bovDur: 0.13, bovF: [3400, 1900], bovQ: 1.3, hiss: 0.5 },
    pops: { lift: 0.6, shift: 0.5, lvl: 0.9, rate: 9, dur: 0.9, als: 0.6, crack: 0.3 },
    cut: 0.12,
  },
  yaris: {
    name: 'G16E 1.6 直列三缸渦輪', red: 7000, idle: 0.13, gain: 1.26, idleGain: 3.05,
    fire: [0, 240, 480], bank: [0, 0, 0], cylAmp: [1, 0.93, 0.97],
    width: 175, rise: 0.08, decay: 0.8, vari: 0.07, jit: 1.2, wob: 0.015,
    grp: [{ ms: 1.1, fb: -0.42, lp: 4000, gain: 1 }],
    pipe: [{ ms: 11.4, fb: -0.35, lp: 2200 }, { ms: 7.1, fb: -0.28, lp: 3000 }],
    lp: 3400, eq: [[230, 1.2, 3], [900, 1.5, 3.5], [2300, 2, 2]], hp: 110, drive: 1.7, rasp: 0.32, raspHz: 2400,
    intake: { lvl: 0.1, f: 480, q: 1.5, f2: 1500 },
    turbo: { n: 1, on: [0.28, 0.5], up: 0.35, down: 1.0, w: [2600, 6800], whistle: 0.25, whoosh: 0.45, damp: 0.3, bov: 'recirc', bovLvl: 0.45, bovDur: 0.12, bovF: [1900, 1100], bovQ: 0.9, hiss: 0.2 },
    pops: { lift: 0.55, shift: 0.35, lvl: 0.7, rate: 16, dur: 0.9, crack: 0.35 },
    cut: 0.12,
  },
  supra: {
    name: '2JZ 直列六缸單顆大渦輪', red: 7200, idle: 0.12, gain: 0.92, idleGain: 1.75,
    fire: SND_I6, bank: [0, 1, 0, 1, 0, 1], cylAmp: [1, 0.99, 1, 0.985, 0.995, 1],
    width: 135, rise: 0.1, decay: 0.7, vari: 0.045, jit: 0.7, wob: 0.01,
    grp: [{ ms: 2.0, fb: -0.4, lp: 3500, gain: 1 }, { ms: 2.15, fb: -0.4, lp: 3300, gain: 0.96 }],
    pipe: [{ ms: 13.2, fb: -0.42, lp: 1600 }, { ms: 8.3, fb: -0.3, lp: 2200 }],
    lp: 2400, eq: [[120, 1, 5], [480, 1.3, 3], [1400, 2, 1.5]], hp: 80, drive: 1.3, rasp: 0.18, raspHz: 2000,
    intake: { lvl: 0.08 },
    turbo: { n: 1, on: [0.45, 0.78], up: 0.85, down: 1.8, w: [1400, 4200], whistle: 0.9, whoosh: 0.55, damp: 0.3, bov: 'atmo', bovLvl: 1.3, bovDur: 0.2, bovF: [2600, 1300], bovQ: 1.1, hiss: 0.6 },
    pops: { lift: 0.2, shift: 0.1, lvl: 0.6, rate: 5 },
    cut: 0.14,
  },
  gtr: {
    name: 'RB26 直列六缸雙渦輪', red: 8000, idle: 0.12, gain: 0.98, idleGain: 2.1,
    fire: SND_I6, bank: [0, 1, 0, 1, 0, 1], cylAmp: [1, 0.985, 1, 0.99, 0.99, 1],
    width: 118, rise: 0.07, decay: 0.85, vari: 0.05, jit: 0.7, wob: 0.01,
    grp: [{ ms: 1.6, fb: -0.42, lp: 4500, gain: 1 }, { ms: 1.75, fb: -0.42, lp: 4300, gain: 0.9 }],
    pipe: [{ ms: 11.0, fb: -0.33, lp: 2600 }, { ms: 5.4, fb: -0.25, lp: 3500 }],
    lp: 4200, eq: [[260, 1.2, 2], [1500, 1.6, 4], [3200, 2, 2]], hp: 110, drive: 1.5, rasp: 0.35, raspHz: 2800,
    intake: { lvl: 0.09 },
    turbo: { n: 2, on: [0.36, 0.62], up: 0.5, down: 1.3, w: [2300, 6200], whistle: 0.4, whoosh: 0.4, damp: 0.3, bov: 'flutter', bovLvl: 1.0, bovDur: 0.3, hiss: 0.3 },
    pops: { lift: 0.25, shift: 0.2, lvl: 0.6, rate: 7 },
    cut: 0.12,
  },
  p918: {
    name: '4.6 V8 平面曲軸＋兩顆電動馬達', red: 9150, idle: 0.11, gain: 1.17, idleGain: 1.16,
    fire: SND_V8, bank: [0, 1, 0, 1, 0, 1, 0, 1],
    width: 92, rise: 0.06, decay: 0.9, vari: 0.04, jit: 0.5, wob: 0.008,
    grp: [{ ms: 1.7, fb: -0.45, lp: 5500, gain: 1 }, { ms: 1.82, fb: -0.45, lp: 5300, gain: 0.93 }],
    pipe: [{ ms: 3.4, fb: -0.3, lp: 5000 }, { ms: 2.3, fb: -0.25, lp: 6000 }],
    lp: 7500, eq: [[700, 1.2, 2], [1900, 1.5, 4], [4200, 2, 3]], hp: 140, drive: 1.4, rasp: 0.5, raspHz: 3000,
    intake: { lvl: 0.35, f: 520, q: 1.4, f2: 2100, mix2: 0.6, tone: 0.4, hiss: 0.12 },
    motor: { f0: 40, k: 55, lvl: 0.12, h2: 0.35, h3: 0.15, order: 12, lvlR: 0.05 },
    pops: { lift: 0.35, shift: 0.3, lvl: 0.6, rate: 20, dur: 0.8, crack: 0.35, burp: 0.55 },
    cut: 0.06, dct: true,
  },
  sp3: {
    name: '6.5 V12 自然進氣', red: 9500, idle: 0.1, gain: 1.08, idleGain: 1.43,
    fire: [0, 62.5, 120, 182.5, 240, 302.5, 360, 422.5, 480, 542.5, 600, 662.5], bank: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
    width: 86, rise: 0.07, decay: 0.85, vari: 0.035, jit: 0.4, wob: 0.006,
    grp: [{ ms: 2.3, fb: -0.4, lp: 6000, gain: 1 }, { ms: 2.42, fb: -0.4, lp: 5800, gain: 0.95 }],
    pipe: [{ ms: 8.8, fb: -0.3, lp: 4000 }, { ms: 4.7, fb: -0.22, lp: 5000 }],
    lp: 8000, eq: [[850, 1.2, 2], [2400, 1.4, 5], [5200, 2, 2]], hp: 150, drive: 1.3, rasp: 0.3, raspHz: 3500,
    intake: { lvl: 0.45, f: 600, q: 1.3, f2: 2400, mix2: 0.6, tone: 0.5, hiss: 0.15 },
    pops: { lift: 0.4, shift: 0.3, lvl: 0.55, rate: 24, dur: 0.9, crack: 0.4, burp: 0.5 },
    cut: 0.05, dct: true,
  },
  jesko: {
    name: '5.0 V8 平面曲軸雙渦輪', red: 8500, idle: 0.11, gain: 0.99, idleGain: 1,
    fire: SND_V8, bank: [0, 1, 0, 1, 0, 1, 0, 1],
    width: 98, rise: 0.06, decay: 0.9, vari: 0.05, jit: 0.6, wob: 0.01,
    grp: [{ ms: 2.0, fb: -0.45, lp: 4500, gain: 1 }, { ms: 2.15, fb: -0.45, lp: 4300, gain: 0.88 }],
    pipe: [{ ms: 8.2, fb: -0.35, lp: 2500 }, { ms: 5.0, fb: -0.28, lp: 3200 }],
    lp: 4800, eq: [[200, 1.1, 3], [1100, 1.4, 4], [2600, 1.8, 3]], hp: 100, drive: 1.8, rasp: 0.55, raspHz: 2400,
    intake: { lvl: 0.12 },
    turbo: { n: 2, on: [0.35, 0.6], up: 0.55, down: 1.5, w: [1800, 5200], whistle: 0.35, whoosh: 0.8, damp: 0.35, bov: 'recirc', bovLvl: 1.0, bovDur: 0.16, bovF: [1800, 900], bovQ: 0.8, hiss: 0.35 },
    pops: { lift: 0.5, shift: 0.8, lvl: 1.1, rate: 8, dur: 0.8, als: 0.3, crack: 0.3, burp: 0.9 },
    cut: 0.06, dct: true,
  },
};
// 車庫的引擎零件會改變聲音
function SND_profile(key, parts) {
  const B = SND_CARS[key] || SND_CARS.supra;
  const P = JSON.parse(JSON.stringify({ ...SND_BASE, ...B, intake: { ...SND_BASE.intake, ...B.intake }, pops: { ...SND_BASE.pops, ...B.pops } }));
  const has = (id) => Array.isArray(parts) && parts.includes(id);
  if (has('exhaust')) { P.lp *= 1.3; P.gain *= 1.19; P.rasp *= 1.25; P.drive *= 1.1; P.pops.lift += 0.2; } // 大口徑排氣：大聲、亮
  if (has('intake') || has('filter')) { P.intake.lvl *= 1.6; P.intake.hiss *= 1.5; if (P.turbo) { P.turbo.whoosh *= 1.3; P.turbo.whistle *= 1.15; } }
  if (has('ecu')) { P.pops.lift += 0.3; P.pops.shift += 0.3; P.pops.als += 0.3; } // 調過的電腦：放炮
  if (has('cams')) { P.vari *= 1.4; P.wob *= 2; P.rasp *= 1.1; } // 高角度凸輪軸：怠速抖
  if (has('header') && P.uel) { P.uel = 0; P.uelHi = 0; P.grp[1] = { ...P.grp[0] }; P.cylAmp = null; } // 等長頭段：咕嚕聲變順
  if (has('turbo')) {
    if (P.turbo) { // 大渦輪：哨音低一點、大聲、比較晚才來
      const T = P.turbo;
      T.w = T.w.map((f) => f * 0.82); T.whistle *= 1.35; T.whoosh *= 1.3; T.up *= 1.35; T.on = T.on.map((x) => Math.min(0.9, x + 0.05)); T.bovLvl *= 1.25; T.bovDur *= 1.2;
    } else P.turbo = { n: 2, on: [0.4, 0.66], up: 0.6, down: 1.4, w: [2000, 5600], whistle: 0.5, whoosh: 0.55, damp: 0.3, bov: 'atmo', bovLvl: 0.8, bovDur: 0.14, bovF: [3000, 1600], bovQ: 1.2, hiss: 0.4 };
  }
  if (has('sc')) P.sc = { order: 16, lvl: 0.12 }; // SP3 加機械增壓
  if (P.motor) P.motor.lvl *= 1 + 0.25 * ['motorF', 'motorR', 'battery'].filter(has).length;
  return P;
}

// ---- AudioWorklet（用 Blob 網址載入；同一個 AudioContext 只載一次，名字帶雜湊，不同版本不會打架）----
const SND_PARAMS = [['rpm', 0.12, 0, 1.2], ['throttle', 0, 0, 1], ['speed', -1, -1, 200], ['limit', 1, 0.2, 1.2], ['shift', 0, 0, 1e9], ['gate', 1, 0, 1]];
let SND_src = null, SND_name = '';
function SND_worklet() {
  if (SND_src) return SND_src;
  const desc = SND_PARAMS.map(([name, defaultValue, minValue, maxValue]) => ({ name, defaultValue, minValue, maxValue, automationRate: 'k-rate' }));
  const body = `const SND_core = ${SND_core.toString()};
class SND_Proc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return ${JSON.stringify(desc)}; }
  constructor(o) { super(); const q = (o && o.processorOptions) || {}; this.c = SND_core(q.P, sampleRate, q.seed); this.n = 0; }
  process(inputs, outputs, p) {
    const c = this.c, o = outputs[0];
    try {
      c.set(p.rpm[0], p.throttle[0], p.speed[0], p.limit[0], p.gate[0]);
      const s = p.shift[0]; if (s !== this.n) { this.n = s; c.shift(); }
      if (o && o[0]) { c.render(o[0], o[0].length); for (let k = 1; k < o.length; k++) o[k].set(o[0]); }
    } catch (e) { return false; }
    return !c.dead();
  }
}`;
  let h = 5381;
  for (let i = 0; i < body.length; i++) h = ((h * 33) ^ body.charCodeAt(i)) >>> 0;
  SND_name = 'carid-engine-' + h.toString(36);
  SND_src = `${body}\ntry { registerProcessor('${SND_name}', SND_Proc); } catch (e) { /* 已經登記過 */ }\n`;
  return SND_src;
}
function SND_load(ctx) {
  const src = SND_worklet(), k = Symbol.for('carid.engine.' + SND_name);
  if (!ctx[k]) {
    ctx[k] = new Promise((res, rej) => {
      let url = null;
      const to = setTimeout(() => rej(new Error('worklet timeout')), 5000);
      const done = (e) => { clearTimeout(to); try { if (url) URL.revokeObjectURL(url); } catch { /* 算了 */ } if (e) rej(e); else res(); };
      try {
        url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        ctx.audioWorklet.addModule(url).then(() => done(), (e) => done(e || new Error('addModule')));
      } catch (e) { done(e); }
    });
  }
  return ctx[k];
}
// 軟削波：|x|≤0.8 完全不動，再上去慢慢壓到 0.98（前面先 ×0.5，所以 ±2 都還是軟的）
function SND_curve() {
  const n = 4096, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = ((i / (n - 1)) * 2 - 1) * 2, a = Math.abs(v);
    c[i] = Math.sign(v) * (a <= 0.8 ? a : 0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18));
  }
  return c;
}

// ---- 給頁面用的 ----
const ENGINE_CARS = Object.fromEntries(Object.entries(SND_CARS).map(([k, c]) => [k, { name: c.name, red: c.red, cyl: c.fire.length, idle: c.idle, turbo: !!c.turbo }]));

function createEngineAudio(opt = {}) {
  const num = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
  const S = { ctx: null, rec: null, inp: null, nodes: [], mode: 'off', vol: num(opt.volume, 0.9), muted: !!opt.muted, voices: [], ready: null, gone: false, warned: false, idleT: 0 };
  const maxV = Math.max(1, num(opt.maxVoices, 2));
  const warn = (e) => { if (!S.warned) { S.warned = true; try { console.warn('[engine audio]', (e && e.message) || e); } catch { /* 算了 */ } } };
  const REC = Symbol.for('carid.engineAudio.shared');

  function ensureCtx() {
    if (S.ctx || S.gone) return S.ctx;
    let ctx = opt.context || null;
    if (!ctx) {
      // 同一頁載入好幾次（或好幾個 createEngineAudio）也只用一個 AudioContext；rec.n＝全部還在響的聲音數
      const g = globalThis, rec = g[REC] || (g[REC] = { ctx: null, hid: false, n: 0 });
      if (typeof rec.n !== 'number') rec.n = 0;
      S.rec = rec;
      if (rec.ctx && rec.ctx.state !== 'closed') ctx = rec.ctx;
      else {
        const AC = g.AudioContext || g.webkitAudioContext;
        if (!AC) return null;
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch { ctx = new AC(); }
        rec.ctx = ctx; rec.n = 0;
        // 切到背景就暫停，回來再繼續（手機省電，也不會在背景一直響）
        try {
          document.addEventListener('visibilitychange', () => {
            try {
              if (document.hidden) { if (rec.ctx.state === 'running') { rec.hid = true; rec.ctx.suspend(); } }
              else if (rec.hid) { rec.hid = false; rec.ctx.resume(); }
            } catch { /* 算了 */ }
          });
        } catch { /* 沒有 document */ }
      }
    }
    // 總輸出：音量／靜音 → 高通 → 壓縮器 → 軟削波
    const inp = ctx.createGain(), hp = ctx.createBiquadFilter(), comp = ctx.createDynamicsCompressor(), pre = ctx.createGain(), ws = ctx.createWaveShaper();
    inp.gain.value = S.muted ? 0 : S.vol;
    hp.type = 'highpass'; hp.frequency.value = 28; hp.Q.value = 0.6;
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.2;
    pre.gain.value = 0.5; ws.curve = SND_curve(); ws.oversample = 'none';
    inp.connect(hp); hp.connect(comp); comp.connect(pre); pre.connect(ws); ws.connect(opt.output || ctx.destination);
    S.ctx = ctx; S.inp = inp; S.nodes = [inp, hp, comp, pre, ws];
    if (S.rec) for (const v of S.voices) if (!v.live) { v.live = true; S.rec.n++; } // resume() 之前就建好的聲音
    return ctx;
  }
  async function init() {
    const ctx = S.ctx;
    let mode = 'off';
    if (opt.worklet !== false && ctx.audioWorklet && typeof AudioWorkletNode === 'function') {
      try { await SND_load(ctx); mode = 'worklet'; } catch (e) { warn(e); }
    }
    if (mode === 'off' && opt.script !== false && typeof ctx.createScriptProcessor === 'function') mode = 'script';
    S.mode = mode;
    for (const v of S.voices) if (!v.src) build(v);
    return mode !== 'off';
  }
  function build(v) {
    if (S.gone || v.dead || v.src || !S.ctx) return;
    const ctx = S.ctx;
    try {
      let src = null;
      const seed = (Math.random() * 4294967296) >>> 0;
      if (S.mode === 'worklet') {
        try {
          src = new AudioWorkletNode(ctx, SND_name, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { P: v.P, seed } });
          v.prm = {};
          for (const [n] of SND_PARAMS) v.prm[n] = src.parameters.get(n);
          src.onprocessorerror = () => warn('processor error');
        } catch (e) { warn(e); src = null; v.prm = null; if (opt.script !== false && typeof ctx.createScriptProcessor === 'function') S.mode = 'script'; }
      }
      if (!src && S.mode === 'script') {
        const core = SND_core({ ...v.P, smooth: 0.035 }, ctx.sampleRate, seed);
        src = ctx.createScriptProcessor(4096, 1, 1);
        src.onaudioprocess = (e) => {
          const b = e.outputBuffer, d = b.getChannelData(0);
          try { core.render(d, d.length); } catch { d.fill(0); }
          for (let k = 1; k < b.numberOfChannels; k++) b.getChannelData(k).set(d);
        };
        v.core = core;
      }
      if (!src) return;
      v.src = src; v.g = ctx.createGain(); v.g.gain.value = v.gain;
      try { v.pn = ctx.createStereoPanner(); v.pn.pan.value = v.pan; } catch { v.pn = null; }
      src.connect(v.g);
      if (v.pn) { v.g.connect(v.pn); v.pn.connect(S.inp); } else v.g.connect(S.inp);
      v.sent = {}; push(v);
    } catch (e) { warn(e); }
  }
  // 把最新的狀態送給合成器
  function push(v) {
    const s = v.st;
    if (v.prm) {
      for (const n of ['rpm', 'throttle', 'speed', 'limit']) if (v.sent[n] !== s[n]) { v.sent[n] = s[n]; v.prm[n].value = s[n]; }
    } else if (v.core) v.core.set(s.rpm, s.throttle, s.speed, s.limit, 1);
  }
  // 收掉一個聲音：先淡出（合成器自己 0.1 秒內收到 0），再拔線
  function kill(v) {
    if (v.dead) return;
    v.dead = true;
    S.voices = S.voices.filter((x) => x !== v);
    if (S.rec && v.live) { v.live = false; S.rec.n = Math.max(0, S.rec.n - 1); }
    try {
      if (v.prm) v.prm.gate.value = 0; else if (v.core) v.core.set(NaN, NaN, NaN, NaN, 0);
      const src = v.src, nodes = [v.src, v.g, v.pn].filter(Boolean);
      const off = () => { try { if (v.core && src) src.onaudioprocess = null; } catch { /* 算了 */ } nodes.forEach((n) => { try { n.disconnect(); } catch { /* 算了 */ } }); };
      if (!src) off(); else setTimeout(off, v.core ? 450 : 200); // ScriptProcessor 有兩格（約 0.2 秒）的延遲
    } catch (e) { warn(e); }
    idleCheck();
  }
  // 沒有聲音在用就讓 AudioContext 睡覺（共用的那個才管；同一頁別的 createEngineAudio 還在響就不睡）
  function idleCheck() {
    clearTimeout(S.idleT);
    const rec = S.rec;
    if (opt.context || !S.ctx || !rec || rec.n > 0) return;
    S.idleT = setTimeout(() => { try { if (rec.n <= 0 && rec.ctx === S.ctx && S.ctx.state === 'running') S.ctx.suspend(); } catch { /* 算了 */ } }, 2500);
  }
  function wake() {
    try { if (!opt.context && S.ctx && S.ctx.state === 'suspended' && !(typeof document !== 'undefined' && document.hidden)) S.ctx.resume().catch(() => {}); } catch { /* 算了 */ }
  }
  function resume() {
    try {
      if (S.gone) return Promise.resolve(false);
      const ctx = ensureCtx();
      if (!ctx) return Promise.resolve(false);
      let r = Promise.resolve();
      const offline = typeof OfflineAudioContext === 'function' && ctx instanceof OfflineAudioContext;
      if (!offline && ctx.state !== 'running') {
        try { // iOS：在手勢裡放一小段靜音才解鎖
          const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource();
          s.buffer = b; s.connect(ctx.destination); s.start(0);
        } catch { /* 算了 */ }
        try { r = ctx.resume() || r; } catch (e) { warn(e); }
      }
      if (!S.ready) S.ready = init().catch((e) => { warn(e); return false; });
      return Promise.all([Promise.resolve(r).catch(() => {}), S.ready]).then(([, ok]) => !!ok && (offline || ctx.state === 'running'), () => false);
    } catch (e) { warn(e); return Promise.resolve(false); }
  }
  function voice(key, o = {}) {
    let P;
    try { P = SND_profile(key, o && o.parts); } catch (e) { warn(e); P = SND_profile('supra', []); }
    const v = { key, P, gain: num(o && o.gain, 1), pan: num(o && o.pan, 0), st: null, src: null, g: null, pn: null, prm: null, core: null, dead: false, live: false, sh: 0 };
    v.st = { rpm: v.P.idle, throttle: 0, speed: -1, limit: 1 };
    const api = {
      key,
      set(s) {
        try {
          if (v.dead || !s) return;
          const st = v.st;
          if (typeof s.rpm === 'number' && isFinite(s.rpm)) st.rpm = Math.max(0, Math.min(1.2, s.rpm));
          if (typeof s.throttle === 'number' && isFinite(s.throttle)) st.throttle = Math.max(0, Math.min(1, s.throttle));
          if (typeof s.speed === 'number' && isFinite(s.speed)) st.speed = Math.max(-1, Math.min(200, s.speed));
          if (typeof s.limit === 'number' && isFinite(s.limit)) st.limit = Math.max(0.2, Math.min(1.2, s.limit));
          if (v.src) push(v);
        } catch (e) { warn(e); }
      },
      shift() {
        try {
          if (v.dead) return;
          v.sh++;
          if (v.prm) v.prm.shift.value = v.sh; else if (v.core) v.core.shift();
        } catch (e) { warn(e); }
      },
      setGain(g) {
        try {
          v.gain = Math.max(0, num(g, v.gain));
          if (v.g) { const t = S.ctx.currentTime; v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(v.gain, t, 0.03); }
        } catch (e) { warn(e); }
      },
      setPan(p) {
        try {
          v.pan = Math.max(-1, Math.min(1, num(p, v.pan)));
          if (v.pn) { const t = S.ctx.currentTime; v.pn.pan.cancelScheduledValues(t); v.pn.pan.setTargetAtTime(v.pan, t, 0.03); }
        } catch (e) { warn(e); }
      },
      dispose() { kill(v); },
      get alive() { return !v.dead; },
    };
    try {
      if (S.gone) { v.dead = true; return api; }
      while (S.voices.length >= maxV) kill(S.voices[0]); // 同時最多兩個
      S.voices.push(v);
      if (S.rec) { v.live = true; S.rec.n++; }
      clearTimeout(S.idleT);
      if (S.mode === 'worklet' || S.mode === 'script') { build(v); wake(); }
    } catch (e) { warn(e); }
    return api;
  }
  function setMuted(m) {
    try {
      S.muted = !!m;
      if (S.inp) { const t = S.ctx.currentTime; S.inp.gain.cancelScheduledValues(t); S.inp.gain.setTargetAtTime(S.muted ? 0 : S.vol, t, 0.04); }
      if (!S.muted) wake();
    } catch (e) { warn(e); }
  }
  function setVolume(x) {
    try {
      S.vol = Math.max(0, Math.min(1, num(x, S.vol)));
      if (S.inp && !S.muted) { const t = S.ctx.currentTime; S.inp.gain.cancelScheduledValues(t); S.inp.gain.setTargetAtTime(S.vol, t, 0.04); }
    } catch (e) { warn(e); }
  }
  function dispose() {
    try {
      if (S.gone) return;
      for (const v of [...S.voices]) kill(v);
      S.gone = true;
      const nodes = S.nodes;
      S.nodes = [];
      setTimeout(() => { for (const n of nodes) try { n.disconnect(); } catch { /* 算了 */ } }, 500); // 等聲音淡出
    } catch (e) { warn(e); }
  }
  return {
    resume, voice, setMuted, setVolume, dispose,
    get muted() { return S.muted; },
    get volume() { return S.vol; },
    get mode() { return S.mode; }, // 'worklet'｜'script'｜'off'
    get context() { return S.ctx; },
  };
}
// 測試用（離線渲染、分析）
createEngineAudio.core = SND_core;
createEngineAudio.profile = SND_profile;
createEngineAudio.cars = SND_CARS;

// ---- village.js ----
// ---- 小村莊（改車遊戲）：台灣鄉下的小村子＋快速道路，自己開車從你的車庫去改車廠、車店、賽道、上快速道路 ----
// Nick 2026-09-27：「有小村莊有改車廠要比賽要自己開去小村莊裡的賽道」
// Nick 2026-09-28：車庫要真的可以停車、開鐵捲門開出去；買車要開去車店；修車廠要自己開進去；路上可以開到極速（快速道路）
// 低多邊形、全部用程式做（貼圖都是 canvas 畫的，沒有下載任何東西）
// 世界座標跟賽道（race.src.js 的 buildTrack）一樣，兩個可以放在同一個場景：
//   x 往東（賽道的前進方向）、y 往上、z 往南（朝東開時車子的右邊）；公尺
//   賽道柏油 x −60…760（寬 12、兩邊水泥護欄 z = ±6.3）、起跑線 x = 0、起跑區 x −14…0、|z| ≤ 6
//   村子在賽道西邊（x −395…−60）：大路（z = 0）往東開到賽道西邊的開口（x = −60），直接接上賽道的柏油；
//   大路往西穿過村子、經過車店（阿財車行），到快速道路的路口（x = −518）
//   快速道路：村子西邊一整圈（東邊那段直線 x = −530、z −625…625，1250 公尺；北、南兩個半徑 350 的半圓；西邊半徑 900 的大 S 彎），一圈 4.7 公里
//     雙向各兩線＋內路肩 1 公尺＋外路肩 3 公尺，中間紐澤西護欄、兩邊鋼板護欄；路口是平面的 T 字路口（中間護欄開口，可以左轉）
// 【API】
//   await villageFonts();                  招牌上的中文要等字型（最多等 1.5 秒，沒有就用系統字）
//   const V = buildVillage({ renderer });  renderer 可省略（只拿來設貼圖的 anisotropy）；chunk：合併網格的格子大小（公尺，預設 200）
//                                          garagePlaceholder: true：蓋一個簡單的車庫殼（牆＋6 公尺的門洞＋碰撞），測試用；真的車庫模組由別人放在 places.garage.lot
//   scene.add(V.group)
//   V.places.garage | shop | dealer | track | highway：{ name, pos: [x, z], spawn: { x, z, heading }, zone: { x, z, hx, hz, rot } … }
//       heading＝車子的 rotation.y（0 朝東 +x、π/2 朝北 −z、π 朝西、−π/2 朝南 +z）
//       長方形（zone、apron、bay⋯）：中心、半寬 hx（沿 rot 那個方向）、半深 hz、rot＝rotation.y
//     garage：lot＝車庫模組原點的世界位置（模組本地：原點＝裡面停車位的車子中心、地板 y 0、車頭朝本地 +x＝朝鐵捲門外；
//               牆含在內 x −13…+5.3、z −13…+13、高 ≤ 6；鐵捲門在 +x 那面牆（x = +5、厚 0.3）中間、寬 6、高 3.8）
//             spawn＝lot；door＝門口中間（heading 朝外）；apron＝門前的水泥地（本地 x 5.3…22、z ±7：停在這裡 HUD 給「開鐵捲門」）；
//             inside＝車庫裡面的地板（本地 x −12.7…5、z ±12.7）；zone＝apron＋inside 的外框（本地 x −12.7…22、z ±12.7）
//             車庫的牆、碰撞這裡都沒有（模組自己有）；別的碰撞都在外框外面；門口直直出去 90 公尺是一條路（沒有東西擋）
//     shop（阿輝改車廠）：開得進去的改車區（前門進、後門出）：bay＝改車區地板（停在這裡打開改車廠）、park＝改車區中間（朝出口）、
//             exit＝後門外面（朝前，從院子、東邊的小路開回大路）、spawn＝exit、zone＝改車區＋門口前面、view＝改車時的鏡頭 { pos, look, fov }
//     dealer（阿財車行）：display＝6 台展示車的位置 [{ x, z, y, heading }]（轉盤中心、y＝轉盤面 0.06；玻璃展示間裡，從大路看得到；車 4.2–4.8 × 2 公尺，四周都有 1 公尺以上）、bay＝買車區（車棚下面，停在這裡打開車店）、
//             park＝買車區中間（朝前）、exit＝買完新車出現的地方（朝大路、前面沒東西）、spawn＝exit、zone＝買車區＋前面那段、view＝展示間裡看車的鏡頭
//     track：spawn、zone＝起跑區 x −14…0、|z| ≤ 6；start＝{ noseX: 0, z: 2.4, heading: 0 }：起跑線上（車頭對齊 x = 0、右邊車道，跟 race.src.js 的 putCar 一樣）
//     highway（快速道路）：zone＝路口（上快速道路的地方）、spawn＝外側車道、路口北邊一點、朝北
//   V.colliders：[{ t: 'box', x, z, hx, hz, rot, h } | { t: 'circle', x, z, r, h }]（xz 平面；h＝高度，鏡頭避開房子用）
//   V.roads：[{ pts: [[x, z], ...], w, kind }]（小地圖畫路；kind：main 大路、street 村子的路、farm 水泥農路、drive 車道／前庭、strip 賽道、highway 快速道路（中線、w 是整條路寬））
//   V.route(x, z, dest) → { pts: [[x, z], ...], len }：從 (x, z) 沿著路開到 dest（'garage' | 'shop' | 'track' | 'dealer' | 'highway'）
//       單行道：改車廠、車店都是前面進、另一邊出；快速道路兩個方向分開算（在哪一邊就只能往前開，到路口才出得去）
//       garage 開到車庫門口再進去停車位；shop 開到改車區；dealer 開到買車區；highway 開到路口（上外側車道）
//   V.surfaceAt(x, z) → 0 大路（賽道、往賽道的路、往快速道路的路）、3 村子的小路、水泥地、4 快速道路、1 草地、2 稻田
//   V.areas：{ paddy: [長方形], pave: [長方形] }（小地圖畫稻田用）
//   V.buildings：[{ kind: house | shop | temple | store | farmhouse | dealer | garage, name?, x, z, hx, hz, rot, h, floors?, door: { x, z, ry } }]
//       房子的外框（長方形，跟碰撞一樣）；door＝大門外面一點、ry＝房子正面朝的方向（以後走進去、放居民用）
//   V.highway：{ len, center: [[x, z], ...]（中線，一圈，從路口往北）, out / in: [[x, z], ...]（外圈往北、內圈往南那一邊的中間（離中線 5.05），照開的方向）,
//               half: 11.9（中線到路肩邊）, lanes: [3.175, 6.925]（兩個車道中間離中線幾公尺，往右） }（直線 25 公尺、彎道 1.5 度一點；以後的車流用）
//   V.bounds：{ x0, x1, z0, z1 }（小地圖範圍：−1320…12、−1000…1000）
//   V.info：{ meshes, tris, village: { meshes, tris }, highway: { meshes, tris }, ground }（group 裡：村子的網格、名字 hwy- 開頭的 highway 子 group、ground、wires）
//   V.dispose()
// stripColliders()：賽道那邊的護欄、看台、路燈、燈樹（村子沒有做，開車碰撞用；buildTrack() 的東西）
// 效能：同一種材質、同一格（200 公尺）的東西全部併成一個網格（快速道路的路燈也併進去，不另外多 draw call）；沒有即時陰影；貼圖都是 canvas，最大 1024
//       地面：草地往後推一點（polygonOffset）、切成 50 公尺的格子；路 y 0.03、水泥地 0.02、稻田 0.012、路口 0.04

// 打包（build-art.mjs、build-app.mjs）會拿掉 import、把 export 變成一般宣告、所有檔接在同一個 script 裡：
// 這個檔全部包在一個函式裡，只露出下面三個名字，不會跟別的檔撞名（跟 cabin.js 的 CABIN 一樣）
const { buildVillage, stripColliders, villageFonts } = (() => {
const TAU = Math.PI * 2, FH = 3.3; // 透天厝一層樓高
const SANS = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", "Heiti TC", "WenQuanYi Zen Hei", sans-serif';
const COND = '"Barlow Condensed", "Arial Narrow", sans-serif';
const SIGN_TEXT = '一三下乘你便保個停光入冰出利到前加勿北區南口可吃合商回圈國在大好嬤子宮就局店庫廠引往德快慢持擎改新早有末村榔機檳歡每減渦漆烤牛率理的直福線肉肩胎臨藥行裝裡試財貨買賽超距路車輝輪迎這速週道開阿院雜零面餐駛髮麵龍';

// 招牌的字型：等 Google Fonts 的 Noto Sans TC、Barlow Condensed（最多 ms 毫秒）
function villageFonts(ms = 1500) {
  const f = typeof document !== 'undefined' && document.fonts;
  if (!f || !f.load) return Promise.resolve();
  const all = Promise.all([f.load(`700 64px ${SANS}`, SIGN_TEXT), f.load(`700 64px ${COND}`, 'RACEWAY 0123456789 M TUNING 24H km')]).catch(() => {});
  return Promise.race([all, new Promise((r) => setTimeout(r, ms))]);
}

// ---- 小工具 ----
function rng(seed) { // 固定種子的亂數：每次蓋出來都一樣（碰撞、測試、截圖才對得起來）
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash2 = (a, b) => { let h = Math.imul(a | 0, 374761393) ^ Math.imul((b | 0) + 7, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const CC = new Map();
const C = (hex) => { let v = CC.get(hex); if (!v) { const c = new THREE.Color(hex); v = [c.r, c.g, c.b]; CC.set(hex, v); } return v; }; // 線性顏色
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const pick = (r, list) => list[(r() * list.length) | 0];
// 本地座標框：原點 (x, y, z)、繞 y 轉 ry（跟 three.js rotation.y 一樣：本地 +x → (cos, 0, −sin)）
function frame(x, y, z, ry = 0, s = 1) {
  const c = Math.cos(ry) * s, n = Math.sin(ry) * s;
  const f = { x, y, z, ry, s, p: (lx, ly, lz) => [x + lx * c + lz * n, y + ly * s, z - lx * n + lz * c] };
  f.sub = (lx, ly, lz, dry = 0, ds = 1) => { const q = f.p(lx, ly, lz); return frame(q[0], q[1], q[2], ry + dry, s * ds); };
  return f;
}

// ---- canvas 貼圖 ----
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function toTex(c, aniso, wrap) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  if (wrap === 'both') t.wrapS = t.wrapT = THREE.RepeatWrapping; else if (wrap === 't') t.wrapT = THREE.RepeatWrapping;
  return t;
}
function speck(g, R, w, h, n, style, s = 2) { for (let i = 0; i < n; i++) { g.fillStyle = typeof style === 'function' ? style() : style; g.fillRect(R() * w, R() * h, 1 + R() * s, 1 + R() * s); } }
function fitFont(g, text, maxW, px, weight = 700, fam = SANS) { let s = px; for (; s > 8; s -= 2) { g.font = `${weight} ${s}px ${fam}`; if (g.measureText(text).width <= maxW) break; } return s; }
function rrect(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
// 一張貼圖集：reg(名字, x, y, w, h, 畫) → uv [u0, v0, u1, v1]（canvas 上面＝v 大）；pack(名字, w, h, 畫)：自己一排一排排（要先放高的）
function sheet(W, H) {
  const [c, g] = cv(W, H), uv = {};
  const reg = (name, x, y, w, h, draw) => {
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.translate(x, y); draw(g, w, h); g.restore();
    return (uv[name] = [(x + 0.5) / W, 1 - (y + h - 0.5) / H, (x + w - 0.5) / W, 1 - (y + 0.5) / H]);
  };
  let px = 0, py = 0, rowH = 0;
  const pack = (name, w, h, draw) => {
    if (px + w > W) { px = 0; py += rowH; rowH = 0; }
    if (py + h > H) throw new Error(`atlas full: ${name}`);
    const r = reg(name, px, py, w, h, draw); px += w; rowH = Math.max(rowH, h); return r;
  };
  return { c, g, uv, reg, pack };
}
const dotUV = (r) => { const u = (r[0] + r[2]) / 2, v = (r[1] + r[3]) / 2; return [u, v, u, v]; }; // 單色的面：整面取區塊中間一點
const subUV = (r, a, b, c, d) => [r[0] + (r[2] - r[0]) * a, r[1] + (r[3] - r[1]) * b, r[0] + (r[2] - r[0]) * c, r[1] + (r[3] - r[1]) * d];
const flipU = (r) => [r[2], r[1], r[0], r[3]]; // 左右相反（箭頭朝另一邊）
function arrowGlyph(g, cx, cy, s, dir, col) { // 粗箭頭：U 往前、L 左轉、R 右轉、UR 右前、UL 左前、D 往下
  g.save(); g.translate(cx, cy); g.rotate({ U: 0, R: Math.PI / 2, L: -Math.PI / 2, D: Math.PI, UR: Math.PI / 4, UL: -Math.PI / 4 }[dir]); g.fillStyle = col; g.beginPath();
  g.moveTo(0, -s); g.lineTo(s * 0.85, -s * 0.05); g.lineTo(s * 0.32, -s * 0.05); g.lineTo(s * 0.32, s); g.lineTo(-s * 0.32, s); g.lineTo(-s * 0.32, -s * 0.05); g.lineTo(-s * 0.85, -s * 0.05);
  g.closePath(); g.fill(); g.restore();
}
function turnGlyph(g, cx, cy, s, right, col) { // 轉彎箭頭（↱ ↰）：往上一段再轉過去
  g.save(); g.translate(cx, cy); if (!right) g.scale(-1, 1); g.fillStyle = col; g.beginPath();
  g.moveTo(-s * 0.55, s); g.lineTo(-s * 0.55, -s * 0.25); g.quadraticCurveTo(-s * 0.55, -s * 0.62, -s * 0.18, -s * 0.62); g.lineTo(s * 0.25, -s * 0.62); g.lineTo(s * 0.25, -s * 0.98);
  g.lineTo(s, -s * 0.44); g.lineTo(s * 0.25, s * 0.1); g.lineTo(s * 0.25, -s * 0.26); g.lineTo(-s * 0.12, -s * 0.26); g.quadraticCurveTo(-s * 0.2, -s * 0.26, -s * 0.2, -s * 0.12); g.lineTo(-s * 0.2, s);
  g.closePath(); g.fill(); g.restore();
}
function iconGlyph(g, kind, cx, cy, s, col, bg = '#000') { // 小圖示：flag 格子旗、wrench 扳手、house 房子、car 汽車、road 快速道路；bg＝挖空的地方的顏色（null＝真的挖空：地上的字）
  g.save(); g.translate(cx, cy); g.fillStyle = col; g.strokeStyle = col;
  const cut = (f) => { g.save(); if (bg) g.fillStyle = bg; else { g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; } f(); g.restore(); };
  if (kind === 'flag') {
    g.fillRect(-s * 0.55, -s * 0.8, s * 0.12, s * 1.6);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2 === 0) g.fillRect(-s * 0.43 + i * s * 0.26, -s * 0.8 + j * s * 0.26, s * 0.26, s * 0.26);
    g.lineWidth = s * 0.06; g.strokeRect(-s * 0.43, -s * 0.8, s * 1.04, s * 0.78);
  } else if (kind === 'wrench') {
    g.rotate(-Math.PI / 4); g.fillRect(-s * 0.13, -s * 0.35, s * 0.26, s * 1.15);
    g.lineWidth = s * 0.26; g.beginPath(); g.arc(0, -s * 0.52, s * 0.3, Math.PI * 0.72, Math.PI * 2.28); g.stroke();
  } else if (kind === 'car') {
    g.beginPath(); g.moveTo(-s * 0.98, s * 0.3); g.lineTo(-s * 0.98, -s * 0.06); g.lineTo(-s * 0.6, -s * 0.14); g.lineTo(-s * 0.32, -s * 0.52); g.lineTo(s * 0.34, -s * 0.52); g.lineTo(s * 0.62, -s * 0.14);
    g.lineTo(s * 0.98, -s * 0.04); g.lineTo(s * 0.98, s * 0.3); g.closePath(); g.fill();
    cut(() => { g.fillRect(-s * 0.26, -s * 0.44, s * 0.24, s * 0.26); g.fillRect(s * 0.04, -s * 0.44, s * 0.26, s * 0.26); });
    for (const x of [-0.55, 0.56]) { g.beginPath(); g.arc(x * s, s * 0.34, s * 0.23, 0, TAU); g.fill(); }
  } else if (kind === 'road') {
    g.beginPath(); g.moveTo(-s, s * 0.85); g.lineTo(-s * 0.2, -s * 0.85); g.lineTo(s * 0.2, -s * 0.85); g.lineTo(s, s * 0.85); g.closePath(); g.fill();
    cut(() => { for (const [y, h2, w2] of [[-0.7, 0.22, 0.05], [-0.25, 0.3, 0.07], [0.3, 0.4, 0.09]]) g.fillRect(-w2 * s, y * s, w2 * 2 * s, h2 * s); });
  } else {
    g.beginPath(); g.moveTo(0, -s * 0.85); g.lineTo(s * 0.85, -s * 0.05); g.lineTo(s * 0.62, -s * 0.05); g.lineTo(s * 0.62, s * 0.75); g.lineTo(-s * 0.62, s * 0.75); g.lineTo(-s * 0.62, -s * 0.05); g.lineTo(-s * 0.85, -s * 0.05); g.closePath(); g.fill();
  }
  g.restore();
}
const HG = '#00783C'; // 快速道路指示牌的綠
function vText(g, t, cx, y0, step, px, col) { g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 ${px}px ${SANS}`; [...t].forEach((ch, k) => g.fillText(ch, cx, y0 + k * step)); } // 直的字（從上往下）

// 牆壁、窗戶、屋瓦⋯（有光照；白底的區塊用頂點色上色）
function mainAtlas(R) {
  const S = sheet(1024, 1024), reg = S.reg;
  reg('white', 0, 0, 64, 64, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); });
  reg('conc', 0, 64, 64, 64, (g, w, h) => { g.fillStyle = '#ecebe7'; g.fillRect(0, 0, w, h); speck(g, R, w, h, 140, () => `rgba(0,0,0,${0.03 + R() * 0.05})`); });
  reg('ac', 64, 0, 32, 32, (g, w, h) => { // 冷氣室外機
    g.fillStyle = '#efefeb'; g.fillRect(0, 0, w, h); g.strokeStyle = '#8f949a'; g.lineWidth = 1.3;
    for (const r of [11, 7.5, 4]) { g.beginPath(); g.arc(20, 16, r, 0, TAU); g.stroke(); }
    g.beginPath(); g.moveTo(9, 16); g.lineTo(31, 16); g.moveTo(20, 5); g.lineTo(20, 27); g.stroke();
    g.fillStyle = '#b3b8be'; for (let y = 5; y < 28; y += 4) g.fillRect(2, y, 5, 1.5);
  });
  reg('tank', 64, 32, 32, 64, (g, w, h) => { // 不鏽鋼水塔
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#9aa0a7'); gr.addColorStop(0.3, '#f4f6f8'); gr.addColorStop(0.55, '#c4c9cf'); gr.addColorStop(1, '#8e949b');
    g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,0.2)'; for (let y = 6; y < h; y += 11) g.fillRect(0, y, w, 1.5);
  });
  reg('bark', 96, 0, 32, 128, (g, w, h) => { g.fillStyle = '#8f9585'; g.fillRect(0, 0, w, h); g.fillStyle = '#c9ccbb'; for (let y = 3; y < h; y += 7) g.fillRect(0, y, w, 2); speck(g, R, w, h, 50, 'rgba(60,60,50,0.2)'); });
  reg('shutter', 128, 0, 128, 128, (g, w, h) => { // 鐵捲門
    g.fillStyle = '#d5d8dc'; g.fillRect(0, 0, w, h);
    for (let y = 2; y < h - 10; y += 5) { g.fillStyle = '#a4a9b0'; g.fillRect(0, y, w, 1.2); g.fillStyle = '#f2f3f5'; g.fillRect(0, y + 1.2, w, 1); }
    g.fillStyle = '#878c93'; g.fillRect(0, h - 10, w, 10); g.fillStyle = '#4f545a'; g.fillRect(w / 2 - 9, h - 8, 18, 3);
    for (let i = 0; i < 7; i++) { g.fillStyle = `rgba(120,95,60,${0.04 + R() * 0.06})`; g.fillRect(R() * w, 0, 2 + R() * 6, h); }
  });
  const glass = (g, w, h, curtain) => { // 玻璃窗：天空倒影、窗簾、鋁框
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#8aa2b6'); gr.addColorStop(0.45, '#3d5367'); gr.addColorStop(1, '#27323e');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    if (curtain) { g.fillStyle = curtain; g.fillRect(w * 0.06, h * 0.08, w * 0.34, h * 0.86); g.fillStyle = 'rgba(0,0,0,0.13)'; for (let x = w * 0.08; x < w * 0.4; x += 7) g.fillRect(x, h * 0.08, 2, h * 0.86); }
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.moveTo(w * 0.55, 0); g.lineTo(w * 0.78, 0); g.lineTo(w * 0.38, h); g.lineTo(w * 0.15, h); g.fill();
    g.strokeStyle = '#c3c7cc'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6); g.lineWidth = 4; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
  };
  reg('win1', 256, 0, 128, 128, (g, w, h) => { // 白色鐵窗（上面一排捲捲的花）
    glass(g, w, h, '#f3d9a4'); g.fillStyle = '#f7f7f4';
    for (let x = 5; x < w; x += 12) g.fillRect(x, 0, 3.5, h);
    for (const y of [0, h * 0.3, h * 0.64, h - 5]) g.fillRect(0, y, w, 4);
    g.strokeStyle = '#f7f7f4'; g.lineWidth = 3; for (let x = 11; x < w; x += 24) { g.beginPath(); g.arc(x, h * 0.3 - 11, 9, Math.PI, 0); g.stroke(); g.beginPath(); g.arc(x, h * 0.3 - 11, 4, 0, TAU); g.stroke(); }
  });
  reg('win2', 384, 0, 128, 128, (g, w, h) => { glass(g, w, h, '#f2b8c6'); g.fillStyle = '#3f7c59'; for (let x = 3; x < w; x += 16) g.fillRect(x, 0, 4, h); for (let y = 3; y < h; y += 16) g.fillRect(0, y, w, 4); }); // 綠色方格鐵窗
  reg('win3', 512, 0, 128, 128, (g, w, h) => { // 咖啡色菱形鐵窗
    glass(g, w, h, '#bcd7ea'); g.strokeStyle = '#6a4a36'; g.lineWidth = 3.5;
    for (let x = -h; x < w; x += 20) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h, h); g.moveTo(x + h, 0); g.lineTo(x, h); g.stroke(); }
    g.fillStyle = '#6a4a36'; for (let x = 0; x <= w; x += 32) g.fillRect(x - 2, 0, 5, h); g.fillRect(0, 0, w, 5); g.fillRect(0, h - 5, w, 5);
  });
  reg('slide', 640, 0, 128, 128, (g, w, h) => { glass(g, w, h, '#ebe6da'); g.fillStyle = '#b3b7bc'; g.fillRect(w * 0.49, 0, 5, h); }); // 陽台落地窗
  reg('winP', 768, 0, 128, 128, (g, w, h) => { glass(g, w, h, null); g.fillStyle = 'rgba(236,236,230,0.55)'; for (let y = 8; y < h * 0.55; y += 5) g.fillRect(7, y, w - 14, 2.2); }); // 鋁窗＋百葉
  reg('gpanel', 896, 0, 128, 128, (g, w, h) => { // 深炭灰直條金屬板
    g.fillStyle = '#25272b'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { g.fillStyle = '#33363b'; g.fillRect(x + 4, 0, 7, h); g.fillStyle = '#4a4d53'; g.fillRect(x + 4, 0, 1.2, h); g.fillStyle = '#161719'; g.fillRect(x + 11, 0, 1.5, h); }
  });
  reg('shop1', 0, 128, 128, 128, (g, w, h) => { // 雜貨店：架子上五顏六色、冰箱
    g.fillStyle = '#4c3d2e'; g.fillRect(0, 0, w, h);
    const cs = ['#e0453a', '#f2c230', '#3b8fd9', '#43b36b', '#f07aa8', '#ffffff', '#ff8a2a'];
    for (const y of [36, 64, 92]) { g.fillStyle = '#7a634a'; g.fillRect(4, y, w * 0.62, 4); for (let x = 6; x < w * 0.62; x += 7) { g.fillStyle = pick(R, cs); const hh = 8 + R() * 15; g.fillRect(x, y - hh, 5.5, hh); } }
    g.fillStyle = '#e8eef3'; g.fillRect(w * 0.7, 12, w * 0.27, h - 26); g.fillStyle = '#a6dcff'; g.fillRect(w * 0.73, 18, w * 0.21, h - 40);
    for (let y = 24; y < h - 28; y += 12) for (let x = w * 0.74; x < w * 0.93; x += 6) { g.fillStyle = pick(R, cs); g.fillRect(x, y, 4, 9); }
    g.fillStyle = '#8b8f94'; g.fillRect(0, h - 12, w, 12); g.strokeStyle = '#c3c7cc'; g.lineWidth = 5; g.strokeRect(2.5, 2.5, w - 5, h - 5);
  });
  reg('shop2', 128, 128, 128, 128, (g, w, h) => { // 麵店：菜單、大鍋子冒煙、紅色圓凳
    g.fillStyle = '#efe2c4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c62f25'; g.fillRect(10, 10, w - 20, 34); g.fillStyle = '#fff3c4'; for (let i = 0; i < 4; i++) g.fillRect(16 + i * 26, 16, 18, 22);
    g.fillStyle = '#c9ccd0'; g.fillRect(6, h * 0.62, w * 0.55, h * 0.38); g.fillStyle = '#2d2f33'; g.beginPath(); g.ellipse(34, h * 0.6, 20, 8, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.8)'; for (const [x, y, r] of [[30, 62, 9], [40, 52, 8], [28, 44, 7]]) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
    g.fillStyle = '#d33b2c'; for (const x of [86, 108]) { g.fillRect(x - 7, h * 0.78, 14, 5); g.fillRect(x - 2, h * 0.78, 4, h * 0.22); }
    g.strokeStyle = '#c3c7cc'; g.lineWidth = 5; g.strokeRect(2.5, 2.5, w - 5, h - 5);
  });
  reg('shop3', 256, 128, 128, 128, (g, w, h) => { // 機車行：牆上掛輪胎、一台機車
    g.fillStyle = '#34353a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#111'; g.lineWidth = 7; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(18 + i * 30, 30, 11, 0, TAU); g.stroke(); }
    g.fillStyle = '#d8d1c0'; g.fillRect(0, h - 16, w, 16);
    g.fillStyle = '#e04a3c'; rrect(g, 30, h - 56, 64, 26, 10); g.fill(); g.fillStyle = '#16171a'; for (const x of [40, 86]) { g.beginPath(); g.arc(x, h - 22, 11, 0, TAU); g.fill(); }
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(70, h - 8, 26, 4, 0, 0, TAU); g.fill();
    g.strokeStyle = '#c3c7cc'; g.lineWidth = 5; g.strokeRect(2.5, 2.5, w - 5, h - 5);
  });
  reg('twall', 384, 128, 128, 128, (g, w, h) => { // 廟的紅牆＋下面花崗石
    g.fillStyle = '#b3261e'; g.fillRect(0, 0, w, h * 0.66); g.strokeStyle = '#86170f'; g.lineWidth = 3; g.strokeRect(8, 8, w - 16, h * 0.66 - 14);
    g.fillStyle = '#d9a63a'; g.fillRect(0, h * 0.66 - 5, w, 4);
    g.fillStyle = '#a29d93'; g.fillRect(0, h * 0.66, w, h * 0.34); g.fillStyle = '#827d74';
    for (let y = h * 0.66 + 14; y < h; y += 14) g.fillRect(0, y, w, 1.5); for (let x = 0; x < w; x += 32) g.fillRect(x, h * 0.66, 1.5, h);
  });
  reg('tdoor', 512, 128, 128, 128, (g, w, h) => { // 廟門：金框、兩扇紅門、門神
    g.fillStyle = '#d4a93c'; g.fillRect(0, 0, w, h); g.fillStyle = '#a81e17'; g.fillRect(6, 6, w / 2 - 8, h - 6); g.fillRect(w / 2 + 2, 6, w / 2 - 8, h - 6);
    for (const cx of [w * 0.27, w * 0.73]) {
      g.fillStyle = '#2e7d4f'; g.beginPath(); g.moveTo(cx - 20, h - 12); g.lineTo(cx - 14, 50); g.lineTo(cx + 14, 50); g.lineTo(cx + 20, h - 12); g.fill();
      g.fillStyle = '#e0b040'; g.fillRect(cx - 16, 70, 32, 6); g.fillStyle = '#2657a8'; g.fillRect(cx - 12, 54, 24, 14);
      g.fillStyle = '#f0c49a'; g.beginPath(); g.arc(cx, 40, 11, 0, TAU); g.fill(); g.fillStyle = '#1b1b1b'; g.fillRect(cx - 13, 22, 26, 9); g.beginPath(); g.moveTo(cx - 8, 44); g.lineTo(cx + 8, 44); g.lineTo(cx, 60); g.fill();
      g.fillStyle = '#e0b040'; g.fillRect(cx + 16, 34, 3, 70);
    }
    g.fillStyle = '#e8c25a'; g.fillRect(w / 2 - 3, 6, 6, h);
  });
  reg('par1', 640, 128, 128, 64, (g, w, h) => { // 陽台花磚（圓洞）
    g.fillStyle = '#f0efeb'; g.fillRect(0, 0, w, h); g.fillStyle = '#6f6d68';
    for (let x = 0; x < w; x += 16) for (let y = 8; y < h - 8; y += 16) { g.beginPath(); g.arc(x + 8, y + 8, 5.5, 0, TAU); g.fill(); }
    g.fillStyle = '#f0efeb'; for (let x = 0; x < w; x += 16) for (let y = 8; y < h - 8; y += 16) { g.beginPath(); g.arc(x + 8, y + 8, 2.2, 0, TAU); g.fill(); }
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, w, 6);
  });
  reg('par2', 640, 192, 128, 64, (g, w, h) => { // 花瓶柱欄杆
    g.fillStyle = '#50565c'; g.fillRect(0, 0, w, h); g.fillStyle = '#f2f1ed'; g.fillRect(0, 0, w, 10); g.fillRect(0, h - 8, w, 8);
    for (let x = 4; x < w; x += 12) { g.beginPath(); g.moveTo(x + 2, 10); g.lineTo(x + 6, 10); g.quadraticCurveTo(x + 11, 30, x + 7, h - 8); g.lineTo(x + 1, h - 8); g.quadraticCurveTo(x - 3, 30, x + 2, 10); g.fill(); }
  });
  reg('par3', 768, 128, 128, 64, (g, w, h) => { // 實心女兒牆＋一條彩色磁磚
    g.fillStyle = '#f2f1ec'; g.fillRect(0, 0, w, h); g.fillStyle = '#9dbfcf'; g.fillRect(0, h * 0.42, w, 12);
    g.fillStyle = 'rgba(0,0,0,0.12)'; for (let x = 0; x < w; x += 8) g.fillRect(x, h * 0.42, 1, 12); g.fillRect(0, 0, w, 5);
  });
  reg('twin', 768, 192, 64, 64, (g, w, h) => { // 廟的圓形石窗
    g.fillStyle = '#b3261e'; g.fillRect(0, 0, w, h); g.fillStyle = '#9d988f'; g.beginPath(); g.arc(32, 32, 28, 0, TAU); g.fill();
    g.fillStyle = '#3a2a22'; g.beginPath(); g.arc(32, 32, 22, 0, TAU); g.fill(); g.fillStyle = '#9d988f';
    for (let i = -2; i <= 2; i++) { g.fillRect(29 + i * 9, 10, 5, 44); g.fillRect(10, 29 + i * 9, 44, 5); }
  });
  reg('mesh', 832, 192, 64, 64, (g, w, h) => { g.fillStyle = '#7d8288'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c4c8cd'; g.lineWidth = 1.2; for (let i = -h; i < w; i += 6) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke(); } });
  reg('brick', 896, 128, 128, 96, (g, w, h) => { g.fillStyle = '#d6cfc2'; g.fillRect(0, 0, w, h); for (let y = 0, r = 0; y < h; y += 7, r++) for (let x = (r % 2) * -8; x < w; x += 16) { g.fillStyle = `rgb(${160 + R() * 30},${68 + R() * 20},${46 + R() * 14})`; g.fillRect(x + 1, y + 1, 14, 5); } });
  reg('tile', 0, 256, 128, 256, (g, w, h) => { // 透天厝正面的小磁磚（白底，頂點色上色）
    g.fillStyle = '#f7f7f5'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) for (let y = 0; y < h; y += 8) if (R() < 0.12) { g.fillStyle = `rgba(0,0,0,${0.02 + R() * 0.04})`; g.fillRect(x, y, 8, 8); }
    g.fillStyle = 'rgba(120,120,112,0.28)'; for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 1, h); for (let y = 0; y < h; y += 8) g.fillRect(0, y, w, 1);
    g.fillStyle = 'rgba(80,70,50,0.07)'; for (let i = 0; i < 6; i++) g.fillRect(R() * w, R() * h * 0.5, 2 + R() * 3, h * (0.2 + R() * 0.5));
  });
  reg('door', 128, 256, 96, 160, (g, w, h) => { // 大門：鋁門＋兩邊紅色春聯＋上面橫批
    g.fillStyle = '#f7f7f5'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c8281e'; g.fillRect(3, 20, 13, 118); g.fillRect(w - 16, 20, 13, 118); g.fillRect(20, 4, w - 40, 12);
    g.fillStyle = '#1d1a18'; for (let y = 26; y < 132; y += 16) { g.fillRect(6, y, 7, 9); g.fillRect(w - 13, y, 7, 9); } for (let x = 26; x < w - 26; x += 12) g.fillRect(x, 6, 8, 8);
    g.fillStyle = '#b9bdc2'; g.fillRect(19, 19, w - 38, h - 19); g.fillStyle = '#3d5063'; g.fillRect(24, 24, w - 48, 58); g.fillRect(24, 88, w - 48, h - 94);
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(28, 26, 8, 54); g.fillStyle = '#e8e8e8'; g.fillRect(w - 34, 92, 4, 16);
  });
  reg('ac2', 224, 448, 32, 32, (g, w, h) => { g.fillStyle = '#5e6268'; g.fillRect(0, 0, w, h); g.fillStyle = '#3a3d42'; g.fillRect(4, 4, w - 8, h - 8); }); // 樓梯間的鐵門
  reg('corr', 224, 256, 256, 128, (g, w, h) => { // 浪板（白底，頂點色上色）
    g.fillStyle = '#e6e8ea'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) { g.fillStyle = '#fbfcfc'; g.fillRect(x, 0, 2.5, h); g.fillStyle = '#b8bdc3'; g.fillRect(x + 5, 0, 2, h); }
    g.fillStyle = 'rgba(120,90,60,0.08)'; for (let i = 0; i < 10; i++) g.fillRect(R() * w, 0, 3, h);
  });
  reg('troof', 480, 256, 256, 128, (g, w, h) => { // 廟的屋瓦：一條一條筒瓦，屋簷那邊一排綠色瓦當
    g.fillStyle = '#d98a2b'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 42) { const gr = g.createLinearGradient(x, 0, x + 21, 0); gr.addColorStop(0, '#a85f14'); gr.addColorStop(0.5, '#f6b54c'); gr.addColorStop(1, '#a85f14'); g.fillStyle = gr; g.fillRect(x + 21, 0, 21, h - 12); }
    g.fillStyle = 'rgba(90,40,0,0.25)'; for (let y = 10; y < h - 12; y += 14) g.fillRect(0, y, w, 2);
    g.fillStyle = '#2f8a5a'; g.fillRect(0, h - 12, w, 12); g.fillStyle = '#6cc48f'; for (let x = 21; x < w; x += 42) { g.beginPath(); g.arc(x + 10.5, h - 6, 5, 0, TAU); g.fill(); }
  });
  reg('rdoor', 736, 256, 256, 128, (g, w, h) => { // 改車廠的大鐵捲門（下面黃黑斜紋）
    g.fillStyle = '#a3aab2'; g.fillRect(0, 0, w, h);
    for (let y = 10; y < h - 14; y += 6) { g.fillStyle = '#7f868e'; g.fillRect(0, y, w, 1.5); g.fillStyle = '#c5cad0'; g.fillRect(0, y + 1.5, w, 1); }
    g.fillStyle = '#50555c'; g.fillRect(0, 0, w, 10); g.fillStyle = '#f2c230'; g.fillRect(0, h - 14, w, 14);
    g.fillStyle = '#16171a'; for (let x = -14; x < w; x += 20) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 10, h); g.lineTo(x + 24, h - 14); g.lineTo(x + 14, h - 14); g.fill(); }
  });
  reg('ridge', 224, 384, 256, 32, (g, w, h) => { // 屋脊上的剪黏（彩色花）
    g.fillStyle = '#b8261c'; g.fillRect(0, 0, w, h); g.fillStyle = '#2f8a5a'; g.fillRect(0, h - 7, w, 7);
    const cs = ['#f6d046', '#5fc1e8', '#ffffff', '#6cc48f', '#ff8a3d'];
    for (let x = 6; x < w; x += 13) { g.fillStyle = pick(R, cs); g.beginPath(); g.arc(x, 11, 4.5, 0, TAU); g.fill(); g.fillStyle = '#f6d046'; g.beginPath(); g.arc(x, 11, 1.8, 0, TAU); g.fill(); }
  });
  reg('band', 224, 416, 256, 32, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#12a39a'; g.fillRect(0, 3, w, 9); g.fillStyle = '#ffcf33'; g.fillRect(0, 13, w, 6); g.fillStyle = '#ff5a4a'; g.fillRect(0, 20, w, 9); }); // 超商的三色條
  reg('froof', 480, 384, 256, 128, (g, w, h) => { // 三合院的紅瓦
    g.fillStyle = '#9c3f2b'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { const gr = g.createLinearGradient(x, 0, x + 16, 0); gr.addColorStop(0, '#7a2c1d'); gr.addColorStop(0.5, '#c0583c'); gr.addColorStop(1, '#7a2c1d'); g.fillStyle = gr; g.fillRect(x + 8, 0, 8, h); }
    g.fillStyle = 'rgba(40,10,0,0.25)'; for (let y = 8; y < h; y += 12) g.fillRect(0, y, w, 1.5);
  });
  reg('gwin', 736, 384, 128, 128, (g, w, h) => { // 深色玻璃
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#46566a'); gr.addColorStop(0.5, '#1d2630'); gr.addColorStop(1, '#12171d'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.moveTo(w * 0.2, 0); g.lineTo(w * 0.45, 0); g.lineTo(w * 0.15, h); g.lineTo(0, h); g.fill();
    g.fillStyle = '#0c0d0f'; for (let x = 0; x <= w; x += 32) g.fillRect(x - 2, 0, 4, h); g.fillRect(0, 0, w, 4); g.fillRect(0, h - 4, w, 4);
  });
  reg('barrier', 864, 384, 160, 64, (g, w, h) => { // 紅白水泥護欄（跟賽道的一樣）
    g.fillStyle = '#c9ccd0'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#f2f3f5' : '#d0342c'; g.fillRect((i * w) / 4, 0, w / 4, h * 0.3); }
    speck(g, R, w, h, 200, 'rgba(0,0,0,0.05)');
  });
  reg('fence', 864, 448, 160, 64, (g, w, h) => { g.fillStyle = '#e8e9eb'; g.fillRect(0, 0, w, h); g.fillStyle = '#d0342c'; for (let x = 0; x < w; x += 40) g.fillRect(x, 0, 20, h); });
  // ---- 下面一半：快速道路、改車廠裡面、車行 ----
  reg('wbeam', 0, 512, 128, 32, (g, w, h) => { // 鋼板護欄（W 形斷面）：亮暗亮暗亮的橫條（只有上下變化：沿著路拉長也沒關係）
    const gr = g.createLinearGradient(0, 0, 0, h);
    [[0, '#f1f3f5'], [0.16, '#c3c8cd'], [0.3, '#80878e'], [0.5, '#e6e9ec'], [0.7, '#80878e'], [0.84, '#c3c8cd'], [1, '#eef0f2']].forEach(([t, c]) => gr.addColorStop(t, c));
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  reg('crash', 128, 512, 64, 32, (g, w, h) => { g.fillStyle = '#ffcf33'; g.fillRect(0, 0, w, h); g.fillStyle = '#16171a'; for (let x = -h; x < w + h; x += 16) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 8, h); g.lineTo(x + 8 + h, 0); g.lineTo(x + h, 0); g.fill(); } }); // 黃黑斜紋（護欄頭、防撞桶）
  reg('peg', 0, 544, 256, 128, (g, w, h) => { // 工具牆：洞洞板上掛起子、扳手
    g.fillStyle = '#c9b27c'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(60,40,20,0.45)';
    for (let x = 4; x < w; x += 8) for (let y = 4; y < h; y += 8) g.fillRect(x, y, 1.6, 1.6);
    const cs = ['#d0342c', '#2f6fd6', '#f2c230', '#1d1f23', '#8f949b'];
    for (let i = 0; i < 16; i++) { const x = 10 + i * 15, c = pick(R, cs); g.fillStyle = '#9aa0a6'; g.fillRect(x, 14, 3, 30 + (i % 3) * 8); g.fillStyle = c; g.fillRect(x - 1, 44 + (i % 3) * 8, 5, 10); }
    for (let i = 0; i < 7; i++) { const x = 14 + i * 34; g.strokeStyle = '#7d848b'; g.lineWidth = 3; g.beginPath(); g.arc(x, 86, 7, 0, TAU); g.stroke(); g.fillStyle = '#7d848b'; g.fillRect(x - 2, 88, 4, 30); }
    g.fillStyle = '#5a3b22'; g.fillRect(0, h - 6, w, 6);
  });
  reg('rack', 256, 544, 256, 128, (g, w, h) => { // 輪胎架：紅色鐵架三層，一排一排輪胎
    g.fillStyle = '#2a2b2f'; g.fillRect(0, 0, w, h);
    for (const y of [4, 46, 88]) { for (let x = 6; x < w - 18; x += 21) { g.fillStyle = '#141517'; rrect(g, x, y, 19, 36, 5); g.fill(); g.fillStyle = '#3a3c40'; g.fillRect(x + 3, y + 4, 2, 28); g.fillRect(x + 14, y + 4, 2, 28); } g.fillStyle = '#c8322a'; g.fillRect(0, y + 36, w, 5); }
    g.fillStyle = '#c8322a'; g.fillRect(0, 0, 5, h); g.fillRect(w - 5, 0, 5, h);
  });
  reg('shelf', 512, 544, 256, 128, (g, w, h) => { // 零件架：機油、零件盒
    g.fillStyle = '#5c6167'; g.fillRect(0, 0, w, h);
    const cs = ['#e0453a', '#f2c230', '#3b8fd9', '#43b36b', '#ff8a2a', '#1d1f23', '#f2f3f5'];
    for (const y of [36, 78, 120]) { g.fillStyle = '#8a9096'; g.fillRect(0, y, w, 5); for (let x = 3; x < w - 16;) { const hh = 14 + R() * 18, ww = 7 + R() * 8; g.fillStyle = pick(R, cs); g.fillRect(x, y - hh, ww, hh); x += ww + 2; } }
    g.fillStyle = '#8a9096'; g.fillRect(0, 0, 4, h); g.fillRect(w - 4, 0, 4, h);
  });
  reg('carSide', 768, 544, 256, 80, (g, w, h) => { // 車子側面（白底，頂點色上色）：窗戶、門縫、輪拱
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#26303a'; g.beginPath(); g.moveTo(w * 0.22, h * 0.42); g.lineTo(w * 0.34, h * 0.08); g.lineTo(w * 0.7, h * 0.08); g.lineTo(w * 0.8, h * 0.42); g.closePath(); g.fill();
    g.fillStyle = '#ffffff'; g.fillRect(w * 0.52, h * 0.06, 5, h * 0.38);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(w * 0.52, h * 0.44); g.lineTo(w * 0.52, h * 0.92); g.moveTo(w * 0.34, h * 0.44); g.lineTo(w * 0.34, h * 0.9); g.stroke();
    g.fillStyle = '#17181b'; for (const x of [w * 0.18, w * 0.82]) { g.beginPath(); g.arc(x, h, h * 0.42, Math.PI, 0); g.fill(); }
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(w * 0.42, h * 0.52, 12, 3); g.fillRect(w * 0.6, h * 0.52, 12, 3);
  });
  reg('carFront', 768, 624, 128, 48, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d1f23'; g.fillRect(w * 0.3, h * 0.45, w * 0.4, h * 0.3); g.fillStyle = '#f4f6f8'; g.fillRect(6, h * 0.3, 26, 10); g.fillRect(w - 32, h * 0.3, 26, 10); g.fillStyle = '#3a3c40'; g.fillRect(0, h - 8, w, 8); });
  reg('carBack', 896, 624, 128, 48, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#d0342c'; g.fillRect(6, h * 0.25, 28, 10); g.fillRect(w - 34, h * 0.25, 28, 10); g.fillStyle = '#e8e8e8'; g.fillRect(w / 2 - 16, h * 0.5, 32, 10); g.fillStyle = '#3a3c40'; g.fillRect(0, h - 8, w, 8); });
  reg('panel', 0, 672, 128, 128, (g, w, h) => { g.fillStyle = '#eef0f2'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(80,90,100,0.28)'; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 1.5, h); for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 1.5); }); // 車行外牆的鋁板
  reg('rust', 128, 672, 128, 128, (g, w, h) => { g.fillStyle = '#9a6a48'; g.fillRect(0, 0, w, h); speck(g, R, w, h, 900, () => `rgba(${R() < 0.5 ? '60,30,15' : '190,120,70'},${0.2 + R() * 0.3})`, 4); }); // 廢車的鏽
  reg('floorT', 256, 672, 128, 128, (g, w, h) => { // 車行的亮面地磚：4 × 4 格（一格 1.2 公尺，一片貼 4.8 公尺）
    g.fillStyle = '#f1f1ee'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${0.02 + R() * 0.03})`; g.fillRect(i * 32, j * 32, 32, 32); }
    g.fillStyle = 'rgba(110,110,105,0.4)'; for (let k = 0; k < 4; k++) { g.fillRect(k * 32, 0, 1, h); g.fillRect(0, k * 32, w, 1); }
  });
  return S;
}

// 招牌、路標（有光照＋一點自發光，背光也看得清楚）
function signAtlas(R) {
  const S = sheet(1024, 1024), reg = S.reg;
  reg('white', 992, 992, 32, 32, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); });
  reg('shop', 0, 0, 640, 160, (g, w, h) => { // 改車廠大招牌：阿輝改車廠
    g.fillStyle = '#121316'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#FF6A1F'; g.beginPath(); g.moveTo(0, 0); g.lineTo(150, 0); g.lineTo(96, h - 22); g.lineTo(0, h - 22); g.fill();
    g.fillStyle = '#d0342c'; g.beginPath(); g.moveTo(160, 0); g.lineTo(186, 0); g.lineTo(132, h - 22); g.lineTo(106, h - 22); g.fill();
    g.strokeStyle = '#121316'; g.lineWidth = 12; g.beginPath(); g.arc(62, 66, 34, 0, TAU); g.stroke(); g.lineWidth = 6; g.strokeStyle = '#121316'; g.beginPath(); g.arc(62, 66, 16, 0, TAU); g.stroke();
    for (let i = 0; i < 64; i++) { g.fillStyle = (i + ((i / 32) | 0)) % 2 ? '#f2f3f5' : '#121316'; g.fillRect((i % 32) * 20, h - 22 + ((i / 32) | 0) * 11, 20, 11); }
    g.fillStyle = '#f2f3f5'; g.textBaseline = 'middle'; g.textAlign = 'center'; fitFont(g, '阿輝改車廠', 420, 96); g.shadowColor = '#FF6A1F'; g.shadowOffsetX = 5; g.shadowOffsetY = 5; g.fillText('阿輝改車廠', 408, 62); g.shadowColor = 'transparent';
    g.fillStyle = '#FF6A1F'; g.font = `700 30px ${COND}`; g.textAlign = 'right'; g.fillText('TUNING · 引擎 · 輪胎', w - 14, 124);
  });
  const VS = [['雜貨店', '#d33b2c', '#fff'], ['麵店', '#f2c230', '#b3261e'], ['機車行', '#2f6fd6', '#fff'], ['理髮', '#ffffff', '#1f5fae'], ['冰店', '#5bc0eb', '#fff'], ['早餐', '#ff8a2a', '#fff'], ['藥局', '#2e9a5c', '#fff'], ['檳榔', '#ff5fa2', '#fff']];
  VS.forEach(([t, bg, fg], i) => reg('v' + i, 640 + i * 48, 0, 48, 160, (g, w, h) => { // 直立招牌（字從上往下）
    g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; const n = t.length, s = Math.min(38, (h - 20) / n); g.font = `700 ${s}px ${SANS}`;
    [...t].forEach((ch, k) => g.fillText(ch, w / 2, 10 + s * (k + 0.5) + (h - 20 - s * n) / 2));
  }));
  reg('arch', 0, 160, 1024, 96, (g, w, h) => { // 賽道入口的拱門：正面
    g.fillStyle = '#121316'; g.fillRect(0, 0, w, h);
    for (const x0 of [0, w - 132]) for (let i = 0; i < 11; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2 === 0) { g.fillStyle = '#f2f3f5'; g.fillRect(x0 + i * 12, j * 12, 12, 12); }
    g.fillStyle = '#FF6A1F'; g.fillRect(132, 0, w - 264, 6); g.fillRect(132, h - 6, w - 264, 6);
    g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillStyle = '#FF6A1F'; g.font = `700 70px ${SANS}`; g.fillText('賽道', 420, h / 2 + 2);
    g.fillStyle = '#f2f3f5'; g.font = `700 36px ${COND}`; g.textAlign = 'left'; g.fillText('400 M', 520, h / 2 + 2); g.font = `700 32px ${SANS}`; g.fillText('直線加速', 610, h / 2 + 2);
    iconGlyph(g, 'flag', 300, h / 2 + 2, 30, '#f2f3f5');
  });
  reg('archB', 0, 256, 384, 96, (g, w, h) => { g.fillStyle = '#121316'; g.fillRect(0, 0, w, h); g.fillStyle = '#FF6A1F'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6); iconGlyph(g, 'house', 80, h / 2, 28, '#FF6A1F'); g.fillStyle = '#f2f3f5'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = `700 58px ${SANS}`; g.fillText('回村子', 130, h / 2 + 2); });
  reg('temple', 384, 256, 256, 96, (g, w, h) => { g.fillStyle = '#1c2c4c'; g.fillRect(0, 0, w, h); g.strokeStyle = '#e8c25a'; g.lineWidth = 6; g.strokeRect(5, 5, w - 10, h - 10); g.fillStyle = '#f0cd62'; g.textBaseline = 'middle'; g.textAlign = 'center'; g.font = `700 60px ${SANS}`; g.fillText('福德宮', w / 2, h / 2 + 3); });
  reg('slow', 640, 256, 96, 96, (g, w, h) => { g.fillStyle = '#d0342c'; g.beginPath(); g.moveTo(4, 6); g.lineTo(w - 4, 6); g.lineTo(w / 2, h - 4); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(17, 14); g.lineTo(w - 17, 14); g.lineTo(w / 2, h - 20); g.fill(); g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 34px ${SANS}`; g.fillText('慢', w / 2, 38); });
  reg('limit', 736, 256, 96, 96, (g, w, h) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(48, 48, 44, 0, TAU); g.fill(); g.strokeStyle = '#d0342c'; g.lineWidth = 11; g.beginPath(); g.arc(48, 48, 38, 0, TAU); g.stroke(); g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 40px ${COND}`; g.fillText('30', 48, 50); });
  reg('mirror', 832, 256, 96, 96, (g, w, h) => { // 路口的反光鏡
    g.fillStyle = '#ff7a1a'; g.beginPath(); g.arc(48, 48, 46, 0, TAU); g.fill();
    const gr = g.createRadialGradient(38, 36, 4, 48, 48, 40); gr.addColorStop(0, '#f4f9ff'); gr.addColorStop(0.35, '#9fb8cc'); gr.addColorStop(0.75, '#5d7385'); gr.addColorStop(1, '#3c4a57');
    g.fillStyle = gr; g.beginPath(); g.arc(48, 48, 38, 0, TAU); g.fill();
  });
  ['改裝', '輪胎', '烤漆'].forEach((t, i) => reg('flag' + i, i * 64, 352, 64, 256, (g, w, h) => { // 旗幟
    g.fillStyle = ['#FF6A1F', '#d0342c', '#2f6fd6'][i]; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(0, 0, 9, h);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 44px ${SANS}`; [...t].forEach((ch, k) => g.fillText(ch, w / 2 + 4, 60 + k * 64));
  }));
  // 路標：五個地方 × 三種箭頭（一列 256×48，一面路標疊好幾列）；前三個在上面，車店、快速道路在最下面
  const DEST = { track: ['賽道', '#FF6A1F', '#1A0F07', 'flag'], shop: ['改車廠', '#2F6FD6', '#FFFFFF', 'wrench'], garage: ['車庫', '#1d1f23', '#FF6A1F', 'house'], dealer: ['車店', '#C8281E', '#FFFFFF', 'car'], highway: ['快速道路', HG, '#FFFFFF', 'road'] };
  Object.entries(DEST).forEach(([k, [name, bg, fg, icon]], di) => ['L', 'U', 'R'].forEach((a, ai) => reg(`g_${k}_${a}`, di < 3 ? 192 + ai * 256 : ai * 256, di < 3 ? 352 + di * 48 : 896 + (di - 3) * 48, 256, 48, (g, w, h) => {
    g.fillStyle = '#e9ecef'; g.fillRect(0, 0, w, h); g.fillStyle = bg; rrect(g, 3, 3, w - 6, h - 6, 9); g.fill();
    iconGlyph(g, icon, 28, h / 2, 15, fg, bg); g.fillStyle = fg; g.textAlign = 'left'; g.textBaseline = 'middle'; fitFont(g, name, 130, 34); g.fillText(name, 52, h / 2 + 2);
    arrowGlyph(g, a === 'L' ? 206 : 214, h / 2, 17, a, fg);
  })));
  [['阿嬤雜貨店', '#d33b2c', '#fff'], ['好吃牛肉麵', '#f2c230', '#b3261e'], ['阿國機車行', '#2f6fd6', '#fff']].forEach(([t, bg, fg], i) => reg('h' + i, 192 + i * 256, 496, 256, 48, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; fitFont(g, t, w - 20, 36); g.fillText(t, w / 2, h / 2 + 2);
  }));
  reg('bill', 192, 544, 512, 192, (g, w, h) => { // 看板：週末直線加速賽
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#16181c'); gr.addColorStop(1, '#2b1b12'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = '#FF6A1F'; g.beginPath(); g.moveTo(0, h * 0.62); g.lineTo(w, h * 0.42); g.lineTo(w, h * 0.5); g.lineTo(0, h * 0.7); g.fill();
    g.fillStyle = '#ff7414'; g.beginPath(); g.moveTo(40, 150); g.lineTo(60, 120); g.lineTo(120, 108); g.lineTo(170, 92); g.lineTo(250, 92); g.lineTo(300, 110); g.lineTo(330, 118); g.lineTo(336, 150); g.closePath(); g.fill();
    g.fillStyle = '#1b2733'; g.beginPath(); g.moveTo(140, 104); g.lineTo(178, 96); g.lineTo(240, 96); g.lineTo(276, 110); g.closePath(); g.fill();
    g.fillStyle = '#111'; for (const x of [96, 282]) { g.beginPath(); g.arc(x, 150, 22, 0, TAU); g.fill(); g.fillStyle = '#c9ccd0'; g.beginPath(); g.arc(x, 150, 11, 0, TAU); g.fill(); g.fillStyle = '#111'; }
    g.fillStyle = '#f2f3f5'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.font = `700 52px ${SANS}`; g.fillText('直線加速賽', 20, 64);
    g.fillStyle = '#FF6A1F'; g.font = `700 40px ${COND}`; g.fillText('400 M', 360, 150); g.fillStyle = '#f2f3f5'; g.font = `700 28px ${SANS}`; g.fillText('就在前面', 360, 184);
  });
  reg('mural', 0, 736, 512, 160, (g, w, h) => { // 改車廠側牆的大字
    g.fillStyle = '#e9ecef'; g.fillRect(0, 0, w, h); g.fillStyle = '#FF6A1F'; g.fillRect(0, h - 26, w, 26);
    g.strokeStyle = '#16181c'; g.lineWidth = 22; g.beginPath(); g.arc(80, 70, 46, 0, TAU); g.stroke(); g.lineWidth = 6; g.strokeStyle = '#9aa1ac'; g.beginPath(); g.arc(80, 70, 22, 0, TAU); g.stroke();
    g.fillStyle = '#16181c'; g.textAlign = 'left'; g.textBaseline = 'middle'; fitFont(g, '輪胎 · 改裝 · 烤漆', w - 170, 60); g.fillText('輪胎 · 改裝 · 烤漆', 150, 72);
  });
  return S;
}

// 自己會亮的（霓虹招牌、店裡的燈、展示間）：MeshBasicMaterial
function glowAtlas(R) {
  const S = sheet(1024, 1024), reg = S.reg;
  reg('neon', 0, 0, 1024, 128, (g, w, h) => { // 「大便龍的車庫」橘色霓虹（車庫模組要用可以拿去；村子這邊沒有用到）
    g.fillStyle = '#141519'; g.fillRect(0, 0, w, h); g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 88px ${SANS}`;
    g.strokeStyle = '#ff6a1f'; g.lineJoin = 'round'; g.shadowColor = '#ff6a1f';
    for (const [lw, b] of [[12, 28], [7, 14]]) { g.lineWidth = lw; g.shadowBlur = b; g.strokeText('大便龍的車庫', w / 2, h / 2 + 4); }
    g.shadowBlur = 6; g.lineWidth = 2.5; g.strokeStyle = '#ffe2cc'; g.strokeText('大便龍的車庫', w / 2, h / 2 + 4);
    g.shadowBlur = 16; g.strokeStyle = '#ff6a1f'; g.lineWidth = 4; rrect(g, 14, 12, w - 28, h - 24, 18); g.stroke();
  });
  reg('gglass', 0, 128, 384, 256, (g, w, h) => { // 車庫大玻璃門：裡面的六角形燈、炭灰牆、橘色燈條、亮亮的地板（假車庫殼用）
    g.fillStyle = '#16171b'; g.fillRect(0, 0, w, h);
    const hz = h * 0.5, bx0 = w * 0.18, bx1 = w * 0.82;
    g.fillStyle = '#1f2125'; g.beginPath(); g.moveTo(0, 0); g.lineTo(bx0, h * 0.2); g.lineTo(bx0, hz + h * 0.14); g.lineTo(0, h); g.fill();
    g.beginPath(); g.moveTo(w, 0); g.lineTo(bx1, h * 0.2); g.lineTo(bx1, hz + h * 0.14); g.lineTo(w, h); g.fill();
    g.fillStyle = '#2a2c31'; g.fillRect(bx0, h * 0.2, bx1 - bx0, hz - h * 0.06);
    g.save(); g.strokeStyle = '#f2f8ff'; g.shadowColor = '#cfe6ff'; g.shadowBlur = 10; // 天花板六角燈（越遠越小）
    for (let r = 0; r < 4; r++) { const y = 10 + r * 13, s = 17 - r * 3.2, dx = s * 1.9; g.lineWidth = 3 - r * 0.5; for (let x = w / 2 - dx * 6 + (r % 2) * dx / 2; x < w; x += dx) { g.beginPath(); for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; g.lineTo(x + Math.cos(a) * s * 0.55, y + Math.sin(a) * s * 0.32); } g.closePath(); g.stroke(); } }
    g.restore();
    g.fillStyle = '#ff6a1f'; g.shadowColor = '#ff6a1f'; g.shadowBlur = 12; g.fillRect(bx0, hz + h * 0.08, bx1 - bx0, 4); g.fillRect(bx0 + 6, h * 0.24, 3, hz - h * 0.12); g.fillRect(bx1 - 9, h * 0.24, 3, hz - h * 0.12); g.shadowBlur = 0;
    g.fillStyle = '#3b2415'; g.fillRect(bx0 + 20, hz - 6, 56, 44); g.fillStyle = '#ff6a1f'; for (let y = hz; y < hz + 36; y += 10) g.fillRect(bx0 + 24, y, 48, 2); // 工具車
    const fl = g.createLinearGradient(0, hz + h * 0.14, 0, h); fl.addColorStop(0, '#34363c'); fl.addColorStop(1, '#101114'); g.fillStyle = fl; g.fillRect(0, hz + h * 0.14, w, h);
    g.globalAlpha = 0.35; g.strokeStyle = '#dbeaff'; g.lineWidth = 2; for (let x = 40; x < w; x += 46) { g.beginPath(); g.moveTo(x, hz + h * 0.2); g.lineTo(x + (x - w / 2) * 0.3, h); g.stroke(); } g.globalAlpha = 1;
    g.strokeStyle = '#ff6a1f'; g.lineWidth = 3; g.strokeRect(w * 0.32, h * 0.76, w * 0.36, h * 0.2);
    g.fillStyle = '#0b0c0e'; for (const x of [0, w / 3, (2 * w) / 3, w]) g.fillRect(x - 3, 0, 6, h); g.fillRect(0, 0, w, 5); // 玻璃的框
  });
  reg('store', 384, 128, 256, 128, (g, w, h) => { // 超商：亮亮的店裡、貨架、櫃台、自動門
    g.fillStyle = '#f4f7f8'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff'; for (let x = 20; x < w; x += 60) g.fillRect(x, 6, 40, 5);
    const cs = ['#e0453a', '#f2c230', '#3b8fd9', '#43b36b', '#f07aa8', '#ff8a2a', '#8a5cd6'];
    for (const x0 of [16, 150]) for (const y of [48, 70, 92]) { g.fillStyle = '#c9ced3'; g.fillRect(x0, y, 88, 3); for (let x = x0 + 2; x < x0 + 86; x += 6) { g.fillStyle = pick(R, cs); const hh = 7 + R() * 10; g.fillRect(x, y - hh, 4.5, hh); } }
    g.fillStyle = '#12a39a'; g.fillRect(104, 60, 44, 40); g.fillStyle = '#dfe4e8'; g.fillRect(0, h - 14, w, 14);
    g.fillStyle = 'rgba(80,120,140,0.18)'; g.fillRect(0, 0, w, h); g.fillStyle = '#6d757d'; for (const x of [0, 104, 150, w]) g.fillRect(x - 3, 0, 6, h); g.fillRect(0, 0, w, 5);
    g.fillStyle = '#ff5a4a'; g.fillRect(20, 16, 50, 26); g.fillStyle = '#ffcf33'; g.fillRect(186, 16, 50, 26);
  });
  reg('storeSign', 384, 256, 256, 64, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#12a39a'; g.textAlign = 'left'; g.textBaseline = 'middle'; fitFont(g, '村口超商', 160, 42); g.fillText('村口超商', 14, h / 2 + 2); g.fillStyle = '#ff5a4a'; rrect(g, 182, 12, 62, 40, 8); g.fill(); g.fillStyle = '#fff'; g.font = `700 30px ${COND}`; g.textAlign = 'center'; g.fillText('24H', 213, h / 2 + 2); });
  reg('work', 640, 128, 256, 128, (g, w, h) => { // （舊的）改車廠門裡面的樣子：舉升機、工具牆、日光燈
    g.fillStyle = '#2b2d31'; g.fillRect(0, 0, w, h); g.fillStyle = '#8e969e'; for (let y = 0; y < 14; y += 4) g.fillRect(0, y, w, 2);
    g.fillStyle = '#f5fbff'; g.shadowColor = '#e8f4ff'; g.shadowBlur = 8; for (const x of [40, 110, 180]) g.fillRect(x, 20, 46, 4); g.shadowBlur = 0;
    g.fillStyle = '#3b4148'; g.fillRect(20, 30, 90, 44); g.fillStyle = '#c9ccd0'; for (let i = 0; i < 26; i++) g.fillRect(24 + R() * 80, 34 + R() * 36, 3, 8 + R() * 6);
    g.fillStyle = '#f2c230'; g.fillRect(130, 34, 8, h - 50); g.fillRect(228, 34, 8, h - 50); g.fillStyle = '#e04a3c'; rrect(g, 126, 50, 116, 30, 12); g.fill();
    g.fillStyle = '#1a1b1e'; g.fillRect(150, 44, 64, 10); for (const x of [146, 222]) { g.beginPath(); g.arc(x, 82, 11, 0, TAU); g.fill(); }
    const fl = g.createLinearGradient(0, h - 26, 0, h); fl.addColorStop(0, '#5d6a64'); fl.addColorStop(1, '#3c4541'); g.fillStyle = fl; g.fillRect(0, h - 26, w, 26); g.fillStyle = '#f2c230'; g.fillRect(0, h - 22, w, 2);
  });
  reg('halo', 640, 256, 128, 64, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,120,40,0.9)'); gr.addColorStop(0.5, 'rgba(255,100,30,0.25)'); gr.addColorStop(1, 'rgba(255,90,20,0)'); g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  reg('warm', 896, 128, 32, 32, (g, w, h) => { g.fillStyle = '#fff1d6'; g.fillRect(0, 0, w, h); });
  reg('led', 928, 128, 32, 32, (g, w, h) => { g.fillStyle = '#ff7a2e'; g.fillRect(0, 0, w, h); });
  reg('red', 960, 128, 32, 32, (g, w, h) => { g.fillStyle = '#ff3b2a'; g.fillRect(0, 0, w, h); });
  reg('white', 992, 128, 32, 32, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); });
  reg('cool', 896, 160, 32, 32, (g, w, h) => { g.fillStyle = '#eef6ff'; g.fillRect(0, 0, w, h); }); // 日光燈、LED
  reg('amber', 928, 160, 32, 32, (g, w, h) => { g.fillStyle = '#ffd9a0'; g.fillRect(0, 0, w, h); }); // 快速道路的路燈
  reg('blue', 960, 160, 32, 32, (g, w, h) => { g.fillStyle = '#5ab4ff'; g.fillRect(0, 0, w, h); });
  reg('green', 992, 160, 32, 32, (g, w, h) => { g.fillStyle = '#3fdc8a'; g.fillRect(0, 0, w, h); });
  // ---- 車行、改車廠裡面 ----
  reg('dealer', 0, 512, 768, 144, (g, w, h) => { // 車行正面的燈箱：阿財車行＋新車
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#dc3a2e'); gr.addColorStop(1, '#a81e17'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(0, h - 12, w, 4);
    iconGlyph(g, 'car', 92, h / 2 - 4, 58, '#ffffff', '#c8281e');
    g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'middle'; fitFont(g, '阿財車行', 360, 100); g.fillText('阿財車行', 176, h / 2 - 2);
    g.fillStyle = '#ffffff'; rrect(g, w - 214, 22, 192, h - 44, 14); g.fill(); g.fillStyle = '#c8281e'; g.textAlign = 'center'; fitFont(g, '新車', 150, 80); g.fillText('新車', w - 118, h / 2 + 2);
  });
  reg('pylon', 768, 512, 112, 448, (g, w, h) => { // 路邊的直立燈箱：上面紅底「阿財車行」、下面白底「新車」
    g.fillStyle = '#c8281e'; g.fillRect(0, 0, w, 300); vText(g, '阿財車行', w / 2, 44, 70, 60, '#ffffff');
    g.fillStyle = '#ffffff'; g.fillRect(0, 300, w, 148); vText(g, '新車', w / 2, 340, 70, 58, '#c8281e');
    g.strokeStyle = '#8a1510'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  });
  reg('buy', 0, 656, 448, 112, (g, w, h) => { // 車棚的招牌：買車區、停這裡
    g.fillStyle = '#16181c'; g.fillRect(0, 0, w, h); g.fillStyle = '#c8281e'; g.fillRect(0, 0, 112, h); iconGlyph(g, 'car', 56, h / 2 + 4, 36, '#ffffff', '#c8281e');
    g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'middle'; fitFont(g, '買車區', 190, 66); g.fillText('買車區', 128, h / 2 + 2);
    g.fillStyle = '#ffcf33'; fitFont(g, '停這裡', 88, 30); g.fillText('停這裡', 330, h / 2 - 16); arrowGlyph(g, 374, h / 2 + 24, 16, 'D', '#ffcf33');
  });
  reg('shopHdr', 448, 656, 320, 88, (g, w, h) => { // 改車廠裡面（後門上面）的燈箱
    g.fillStyle = '#141519'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ff6a1f'; g.lineWidth = 4; rrect(g, 4, 4, w - 8, h - 8, 10); g.stroke();
    iconGlyph(g, 'wrench', 44, h / 2, 22, '#ff6a1f'); g.fillStyle = '#ffe2cc'; g.shadowColor = '#ff6a1f'; g.shadowBlur = 10; g.textAlign = 'left'; g.textBaseline = 'middle'; fitFont(g, '阿輝改車廠', 222, 52); g.fillText('阿輝改車廠', 80, h / 2 + 2); g.shadowBlur = 0;
  });
  reg('welcome', 0, 768, 256, 48, (g, w, h) => { // 紅色跑馬燈：歡迎光臨
    g.fillStyle = '#0c0c0e'; g.fillRect(0, 0, w, h); g.fillStyle = '#ff3b2a'; g.shadowColor = '#ff3b2a'; g.shadowBlur = 6; g.textAlign = 'center'; g.textBaseline = 'middle'; fitFont(g, '歡迎光臨', 220, 38); g.fillText('歡迎光臨', w / 2, h / 2 + 2); g.shadowBlur = 0;
    g.fillStyle = 'rgba(0,0,0,0.45)'; for (let x = 0; x < w; x += 3) g.fillRect(x, 0, 1, h); for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  });
  reg('tv', 256, 768, 160, 96, (g, w, h) => { // 展示間的電視：新車廣告
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#1d4f8a'); gr.addColorStop(1, '#0d1b33'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, h * 0.7, w, 3); iconGlyph(g, 'car', 56, h * 0.56, 40, '#e8eef6', '#1d4f8a');
    g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = '#ffcf33'; g.font = `700 24px ${SANS}`; g.fillText('新車', 104, 30); g.fillStyle = '#ffffff'; g.font = `700 18px ${SANS}`; g.fillText('試乘', 106, 58);
    g.fillStyle = '#0a0a0c'; g.fillRect(0, 0, w, 4); g.fillRect(0, h - 4, w, 4); g.fillRect(0, 0, 4, h); g.fillRect(w - 4, 0, 4, h);
  });
  reg('dlight', 416, 768, 64, 64, (g, w, h) => { g.fillStyle = '#b9bdc2'; g.fillRect(0, 0, w, h); const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w * 0.6); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#e6eef8'); g.fillStyle = gr; g.fillRect(4, 4, w - 8, h - 8); }); // 天花板的方形燈
  reg('exitG', 480, 768, 96, 48, (g, w, h) => { g.fillStyle = '#128a4a'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'middle'; fitFont(g, '出口', 52, 30); g.fillText('出口', 8, h / 2 + 1); arrowGlyph(g, 76, h / 2, 13, 'U', '#ffffff'); }); // 綠色「出口」燈
  return S;
}

// 地上的字、斑馬線、輪胎印（透明）
function decalAtlas(R) {
  const S = sheet(512, 512), reg = S.reg;
  reg('slow', 0, 0, 128, 256, (g, w, h) => { g.fillStyle = '#f2f3f5'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.save(); g.translate(w / 2, h / 2); g.scale(1, 2.2); g.font = `700 104px ${SANS}`; g.fillText('慢', 0, 4); g.restore(); });
  reg('zebra', 128, 0, 128, 128, (g, w, h) => { g.fillStyle = 'rgba(242,243,245,0.95)'; for (let x = 4; x < w; x += 21) g.fillRect(x, 2, 12, h - 4); });
  reg('zone', 256, 0, 256, 128, (g, w, h) => { // 改車區（黃色虛線框）
    g.strokeStyle = '#ffcf33'; g.lineWidth = 7; g.setLineDash([18, 10]); g.strokeRect(6, 6, w - 12, h - 12); g.setLineDash([]);
    g.fillStyle = '#ffcf33'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 46px ${SANS}`; g.fillText('改車區', w / 2 + 16, h / 2 + 2); iconGlyph(g, 'wrench', 58, h / 2 + 2, 22, '#ffcf33');
  });
  reg('skid', 128, 128, 128, 128, (g, w, h) => { g.lineCap = 'round'; for (let i = 0; i < 4; i++) { g.strokeStyle = `rgba(10,10,12,${0.35 + R() * 0.3})`; g.lineWidth = 7 + R() * 4; g.beginPath(); const x = 20 + i * 26 + R() * 8; g.moveTo(x, h); g.bezierCurveTo(x + 10, h * 0.6, x - 12, h * 0.35, x + 6 + R() * 10, 0); g.stroke(); } });
  reg('oil', 0, 256, 128, 128, (g, w, h) => { for (let i = 0; i < 7; i++) { const gr = g.createRadialGradient(0, 0, 1, 0, 0, 30); gr.addColorStop(0, 'rgba(20,18,16,0.55)'); gr.addColorStop(1, 'rgba(20,18,16,0)'); g.save(); g.translate(20 + R() * 88, 20 + R() * 88); g.scale(1, 0.4 + R() * 0.6); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 30, 0, TAU); g.fill(); g.restore(); } });
  reg('rice', 256, 128, 256, 128, (g, w, h) => { // 廟埕曬穀
    g.fillStyle = 'rgba(214,170,64,0.97)'; rrect(g, 6, 6, w - 12, h - 12, 18); g.fill(); g.strokeStyle = 'rgba(160,118,30,0.8)'; g.lineWidth = 3;
    for (let y = 16; y < h - 10; y += 9) { g.beginPath(); g.moveTo(12, y); for (let x = 12; x < w - 12; x += 16) g.lineTo(x + 8, y + (x % 32 ? 2 : -2)); g.stroke(); }
    speck(g, R, w, h, 300, 'rgba(250,215,120,0.5)');
  });
  reg('park', 256, 256, 256, 128, (g, w, h) => { g.fillStyle = 'rgba(242,243,245,0.92)'; g.fillRect(4, 4, w - 8, 6); for (const x of [4, 86, 168, w - 10]) g.fillRect(x, 4, 6, h - 8); });
  reg('manhole', 128, 256, 64, 64, (g, w, h) => { g.fillStyle = 'rgba(40,42,46,0.9)'; g.beginPath(); g.arc(32, 32, 29, 0, TAU); g.fill(); g.strokeStyle = 'rgba(120,122,126,0.8)'; g.lineWidth = 2; for (const r of [24, 16, 8]) { g.beginPath(); g.arc(32, 32, r, 0, TAU); g.stroke(); } });
  reg('start', 192, 256, 64, 64, (g, w, h) => { g.fillStyle = 'rgba(242,243,245,0.95)'; g.fillRect(0, 0, w, h); });
  reg('buyzone', 0, 384, 256, 128, (g, w, h) => { // 買車區（白色虛線框）
    g.strokeStyle = '#f2f3f5'; g.lineWidth = 7; g.setLineDash([18, 10]); g.strokeRect(6, 6, w - 12, h - 12); g.setLineDash([]);
    g.fillStyle = '#f2f3f5'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 46px ${SANS}`; g.fillText('買車區', w / 2 + 18, h / 2 + 2); iconGlyph(g, 'car', 52, h / 2 + 4, 24, '#f2f3f5', null);
  });
  reg('arrLR', 256, 384, 64, 128, (g, w, h) => { g.save(); g.scale(1, 2); turnGlyph(g, w / 2 + 6, h / 4 + 6, 22, true, '#f2f3f5'); turnGlyph(g, w / 2 - 6, h / 4 + 6, 22, false, '#f2f3f5'); g.restore(); }); // 路面箭頭：左轉、右轉（長長的）
  reg('arrU', 320, 384, 64, 128, (g, w, h) => { g.save(); g.scale(1, 2); arrowGlyph(g, w / 2, h / 4, 26, 'U', '#f2f3f5'); g.restore(); }); // 路面箭頭：直走
  return S;
}

// 快速道路、車行的牌子（綠底白字的指示牌、看板、旗子⋯）：跟 signAtlas 一樣的材質，自己排位置（先放高的）
function sign2Atlas(R) {
  const S = sheet(1024, 1024), P = S.pack;
  const hw = (g, w, h, r = 12) => { g.fillStyle = '#f2f3f5'; rrect(g, 0, 0, w, h, r); g.fill(); g.fillStyle = HG; rrect(g, 5, 5, w - 10, h - 10, r - 4); g.fill(); }; // 綠底白邊
  const T = (g, t, x, y, px, col = '#ffffff', al = 'left', max = 999, fam = SANS) => { g.fillStyle = col; g.textAlign = al; g.textBaseline = 'middle'; fitFont(g, t, max, px, 700, fam); g.fillText(t, x, y); };
  const tag = (g, x, y, w, h, t) => { g.fillStyle = '#ffcf33'; rrect(g, x, y, w, h, 8); g.fill(); T(g, t, x + w / 2, y + h / 2 + 1, h * 0.72, '#16181c', 'center', w - 10); }; // 黃底黑字的小牌（出口）
  P('entry', 448, 208, (g, w, h) => { // 大路開到快速道路的路口：快速道路（左轉往南、右轉往北）
    hw(g, w, h); iconGlyph(g, 'road', 54, 56, 30, '#ffffff', HG); T(g, '快速道路', 98, 58, 66, '#ffffff', 'left', 310);
    g.fillStyle = '#ffffff'; g.fillRect(18, 104, w - 36, 3);
    turnGlyph(g, 52, 156, 30, false, '#ffffff'); T(g, '往南', 88, 158, 40); turnGlyph(g, w - 52, 156, 30, true, '#ffffff'); T(g, '往北', w - 88, 158, 40, '#ffffff', 'right');
    T(g, '一圈 4.7 km', w / 2, 158, 26, '#cfe8d8', 'center', 130);
  });
  const gantry = (name, dir) => P(name, 448, 192, (g, w, h) => { // 門架上的大牌子：前面 300 公尺出口（往村子）
    hw(g, w, h); tag(g, 18, 16, 112, 44, '出口'); T(g, '300 m', w - 22, 39, 38, '#ffffff', 'right', 150, COND);
    T(g, '村子', 24, 104, 68, '#ffffff', 'left', 180); T(g, '車店 · 改車廠 · 賽道', 24, 160, 34, '#ffffff', 'left', 318);
    arrowGlyph(g, w - 62, 128, 40, dir, '#ffffff');
  });
  P('fl0', 48, 192, (g, w, h) => { g.fillStyle = '#c8281e'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 6, h); vText(g, '新車到', w / 2 + 3, 36, 56, 38, '#ffffff'); }); // 車行門口的旗子
  P('fl1', 48, 192, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#c8281e'; g.fillRect(0, 0, 6, h); vText(g, '可試乘', w / 2 + 3, 36, 56, 38, '#c8281e'); });
  gantry('gantryN', 'UR'); gantry('gantryS', 'UL');
  P('fl2', 48, 192, (g, w, h) => { g.fillStyle = '#ffcf33'; g.fillRect(0, 0, w, h); g.fillStyle = '#c8281e'; g.fillRect(0, 0, 6, h); vText(g, '零利率', w / 2 + 3, 36, 56, 38, '#c8281e'); });
  P('ad1', 448, 192, (g, w, h) => { // 看板：阿財車行
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#d0342c'); gr.addColorStop(1, '#8a1510'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    T(g, '阿財車行', 24, 54, 64, '#ffffff', 'left', 270); T(g, '新車 · 好開 · 好停', 24, 112, 32, '#ffe1dc', 'left', 260);
    g.fillStyle = '#ffffff'; rrect(g, 24, 140, 196, 38, 8); g.fill(); T(g, '下一個出口', 122, 160, 26, '#c8281e', 'center', 176);
    iconGlyph(g, 'car', 352, 104, 72, '#ffffff', '#a01c15');
  });
  P('ad2', 448, 192, (g, w, h) => { // 看板：阿輝改車廠
    g.fillStyle = '#16181c'; g.fillRect(0, 0, w, h); g.fillStyle = '#FF6A1F'; g.beginPath(); g.moveTo(0, h); g.lineTo(0, h * 0.8); g.lineTo(w, h * 0.56); g.lineTo(w, h * 0.68); g.lineTo(w * 0.35, h); g.closePath(); g.fill();
    T(g, '阿輝改車廠', 24, 56, 60, '#ffffff', 'left', 300); T(g, '引擎 · 渦輪 · 輪胎 · 烤漆', 24, 112, 30, '#FF6A1F', 'left', 330);
    iconGlyph(g, 'wrench', 396, 64, 40, '#FF6A1F');
  });
  P('ad3', 448, 192, (g, w, h) => { // 看板：直線加速賽
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#1b2733'); gr.addColorStop(1, '#0f151c'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 22; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#f2f3f5' : '#16181c'; g.fillRect(i * 21, h - 28 + j * 14, 21, 14); }
    T(g, '直線加速賽', 24, 58, 62, '#ffffff', 'left', 320); T(g, '每個週末 · 400 M', 24, 116, 32, '#FF6A1F', 'left', 300);
    iconGlyph(g, 'flag', 392, 70, 42, '#ffffff');
  });
  const exitS = (name, right) => P(name, 320, 160, (g, w, h) => { // 路口前的出口牌（箭頭往出口那邊）
    hw(g, w, h); tag(g, right ? 16 : w - 124, 14, 108, 42, '出口');
    T(g, '村子 · 車店', right ? 20 : w - 20, 104, 44, '#ffffff', right ? 'left' : 'right', 196); arrowGlyph(g, right ? w - 50 : 50, 100, 34, right ? 'R' : 'L', '#ffffff');
  });
  exitS('exitR', true); exitS('exitL', false);
  P('post1', 192, 128, (g, w, h) => { hw(g, w, h, 10); T(g, '保持', w / 2, 40, 44, '#ffffff', 'center'); T(g, '車距', w / 2, 90, 44, '#ffffff', 'center'); }); // 路邊的小牌
  P('post2', 192, 128, (g, w, h) => { g.fillStyle = '#f2f3f5'; rrect(g, 0, 0, w, h, 10); g.fill(); g.fillStyle = '#1f5fae'; rrect(g, 5, 5, w - 10, h - 10, 6); g.fill(); T(g, '勿行駛', w / 2, 40, 40, '#ffffff', 'center'); T(g, '路肩', w / 2, 90, 40, '#ffffff', 'center'); });
  P('dist', 320, 112, (g, w, h) => { hw(g, w, h, 10); T(g, '村子出口', 22, 36, 36, '#ffffff', 'left', 190); T(g, '500 m', w - 22, 36, 34, '#ffffff', 'right', 110, COND); T(g, '賽道', 22, 80, 32); T(g, '1 km', w - 22, 80, 32, '#ffffff', 'right', 110, COND); }); // 距離牌
  P('lim110', 96, 96, (g, w, h) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(48, 48, 44, 0, TAU); g.fill(); g.strokeStyle = '#d0342c'; g.lineWidth = 10; g.beginPath(); g.arc(48, 48, 38, 0, TAU); g.stroke(); T(g, '110', 48, 50, 36, '#111111', 'center', 58, COND); });
  P('stop', 96, 96, (g, w, h) => { // 停（紅色八角形）
    const oct = (r) => { g.beginPath(); for (let i = 0; i < 8; i++) { const a = ((i + 0.5) / 8) * TAU; g.lineTo(48 + Math.cos(a) * r, 48 + Math.sin(a) * r); } g.closePath(); g.fill(); };
    g.fillStyle = '#ffffff'; oct(46); g.fillStyle = '#d0342c'; oct(41); T(g, '停', 48, 50, 46, '#ffffff', 'center');
  });
  P('chev', 64, 96, (g, w, h) => { g.fillStyle = '#ffcf33'; g.fillRect(0, 0, w, h); g.fillStyle = '#16181c'; g.beginPath(); g.moveTo(12, 14); g.lineTo(32, 14); g.lineTo(52, 48); g.lineTo(32, 82); g.lineTo(12, 82); g.lineTo(32, 48); g.closePath(); g.fill(); g.strokeStyle = '#16181c'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3); }); // 彎道的箭頭牌（往右）
  P('white', 32, 32, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); });
  P('warn', 256, 64, (g, w, h) => { g.fillStyle = '#ffcf33'; g.fillRect(0, 0, w, h); g.strokeStyle = '#16181c'; g.lineWidth = 5; g.strokeRect(4, 4, w - 8, h - 8); T(g, '前有路口 · 減速', w / 2, h / 2 + 2, 34, '#16181c', 'center', 228); }); // 快速道路路口前的警告
  P('in', 96, 48, (g, w, h) => { g.fillStyle = '#1e7b45'; g.fillRect(0, 0, w, h); T(g, '入口', 34, h / 2 + 1, 28, '#ffffff', 'center'); arrowGlyph(g, 76, h / 2, 13, 'U', '#ffffff'); }); // 車行的入口、出口
  P('out', 96, 48, (g, w, h) => { g.fillStyle = '#c8281e'; g.fillRect(0, 0, w, h); T(g, '出口', 34, h / 2 + 1, 28, '#ffffff', 'center'); arrowGlyph(g, 76, h / 2, 13, 'U', '#ffffff'); });
  return S;
}

// 路面：大路（白邊線＋雙黃線）、村子的路（紅線＋白虛線）、水泥農路；v 方向一格 10 公尺
function roadTex(R) {
  const [c, g] = cv(512, 512), P = 512 / 10;
  g.fillStyle = '#3c3e42'; g.fillRect(0, 0, 400, 512);
  speck(g, R, 400, 512, 7000, () => { const k = 40 + R() * 60; return `rgba(${k},${k},${k + 4},0.5)`; }, 1.5);
  g.fillStyle = 'rgba(20,20,22,0.18)'; for (const x of [40, 72, 136, 168, 250, 276, 330, 356]) g.fillRect(x, 0, 16, 512); // 輪胎壓過的地方暗一點
  g.fillStyle = '#e9ebee'; g.fillRect(7, 0, 4, 512); g.fillRect(197, 0, 4, 512); // 大路：兩邊白線
  g.fillStyle = '#f2c230'; g.fillRect(98, 0, 4, 512); g.fillRect(106, 0, 4, 512); // 雙黃線
  g.fillStyle = '#c8322a'; g.fillRect(219, 0, 4, 512); g.fillRect(385, 0, 4, 512); // 村子的路：紅線
  g.fillStyle = '#e9ebee'; g.fillRect(302, 0, 4, P * 4); // 白虛線（4 公尺、空 6 公尺）
  g.fillStyle = '#bdbeb9'; g.fillRect(400, 0, 112, 512); speck(g, R, 112, 512, 1500, () => `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${0.05 + R() * 0.07})`, 2); // 水泥
  g.fillStyle = 'rgba(60,60,58,0.45)'; g.fillRect(400, 0, 112, 2); g.fillRect(400, 256, 112, 2);
  g.fillStyle = 'rgba(0,0,0,0.06)'; for (let i = 0; i < 30; i++) g.fillRect(400 + R() * 112, R() * 512, 1, 20 + R() * 60);
  return c;
}
const RU = { main: [4 / 512, 204 / 512], street: [216 / 512, 392 / 512], farm: [404 / 512, 508 / 512] };
// 快速道路（一邊）：u 0 → 1＝中間護欄邊（0.3 公尺）→ 外側（11.9 公尺）：內路肩 1、黃線、兩線道（中間白虛線 4 公尺空 6 公尺）、白邊線、外路肩 3；v 一格 10 公尺
function hwyTex(R) {
  const [c, g] = cv(512, 512), k = 512 / 11.6, X = (o) => (o - 0.3) * k, P = 512 / 10;
  g.fillStyle = '#46484c'; g.fillRect(0, 0, 512, 512);
  speck(g, R, 512, 512, 9000, () => { const q = 42 + R() * 60; return `rgba(${q},${q},${q + 4},0.45)`; }, 1.5);
  g.fillStyle = 'rgba(255,255,255,0.035)'; g.fillRect(0, 0, X(1.3), 512); g.fillRect(X(8.8), 0, 512 - X(8.8), 512); // 路肩淺一點（比較少車壓）
  g.fillStyle = 'rgba(18,18,20,0.2)'; for (const o of [2.25, 4.1, 6.0, 7.85]) g.fillRect(X(o) - 13, 0, 26, 512); // 輪胎壓過的地方
  g.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i < 6; i++) g.fillRect(X(1.4) + R() * (X(8.7) - X(1.4)), R() * 512, 2, 30 + R() * 90); // 補過的裂縫
  g.fillStyle = '#f2c230'; g.fillRect(X(1.22), 0, 0.15 * k, 512); // 內側黃線
  g.fillStyle = '#eceef0'; g.fillRect(X(4.97), 0, 0.15 * k, P * 4); // 車道線
  g.fillRect(X(8.73), 0, 0.15 * k, 512); // 外側白邊線
  return c;
}
function paveTex(R) { // 水泥地（4 公尺一格，頂點色上色：柏油、花崗石⋯）
  const [c, g] = cv(256, 256);
  g.fillStyle = '#dcdcd8'; g.fillRect(0, 0, 256, 256); speck(g, R, 256, 256, 2400, () => `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${0.04 + R() * 0.07})`, 2);
  g.fillStyle = 'rgba(0,0,0,0.1)'; g.fillRect(0, 0, 256, 1.5); g.fillRect(0, 128, 256, 1); g.fillRect(0, 0, 1.5, 256); g.fillRect(128, 0, 1, 256);
  return c;
}
function paddyTex(R) { // 稻田：水面映天空、一排一排秧苗（3.2 公尺一格）
  const [c, g] = cv(256, 256);
  const gr = g.createLinearGradient(0, 0, 256, 256); gr.addColorStop(0, '#9ab9bd'); gr.addColorStop(1, '#86a9ae'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(255,255,255,0.12)'; for (let i = 0; i < 40; i++) g.fillRect(R() * 256, R() * 256, 10 + R() * 30, 1);
  const cs = ['#4f9a34', '#62ad3c', '#78bf45', '#3f8a2c'];
  for (let y = 8; y < 256; y += 24) for (let x = 6; x < 256; x += 20) {
    const cx = x + R() * 3, cy = y + R() * 3;
    g.fillStyle = 'rgba(40,70,40,0.35)'; g.beginPath(); g.ellipse(cx + 2, cy + 3, 7, 4, 0, 0, TAU); g.fill();
    for (let k = 0; k < 7; k++) { g.strokeStyle = pick(R, cs); g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy); const a = R() * TAU; g.lineTo(cx + Math.cos(a) * (5 + R() * 5), cy + Math.sin(a) * (4 + R() * 4)); g.stroke(); }
  }
  return c;
}
function grassTex(R) { // 草地（6 公尺一格；跟賽道的草地差不多顏色）
  const [c, g] = cv(256, 256);
  g.fillStyle = '#809358'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i++) { const gr = g.createRadialGradient(0, 0, 1, 0, 0, 40); gr.addColorStop(0, `rgba(${R() < 0.5 ? '60,90,40' : '150,160,90'},0.18)`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.save(); g.translate(R() * 256, R() * 256); g.fillStyle = gr; g.fillRect(-40, -40, 80, 80); g.restore(); }
  speck(g, R, 256, 256, 3000, () => `rgba(${40 + R() * 60},${70 + R() * 60},${25 + R() * 30},0.4)`, 2);
  return c;
}

// ---- 合併網格：同材質、同一格（ch 公尺）的三角形放一起，最後每一組變成一個 Mesh ----
class Builder {
  constructor(ch) { this.ch = ch; this.bins = new Map(); this.k = '0,0'; this.tris = 0; }
  at(x, z) { this.k = Math.floor(x / this.ch) + ',' + Math.floor(z / this.ch); return this; }
  tri(m, a, b, c, ta, tb, tc, ca, cb = ca, cc = ca) {
    const key = m + '|' + this.k; let g = this.bins.get(key);
    if (!g) this.bins.set(key, (g = { m, p: [], n: [], u: [], c: [] }));
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz); if (l < 1e-12) return;
    nx /= l; ny /= l; nz /= l;
    g.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); g.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    g.u.push(ta[0], ta[1], tb[0], tb[1], tc[0], tc[1]); g.c.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
    this.tris++;
  }
  // a b c d：左下、右下、右上、左上（從正面看）；uv＝[u0, v0, u1, v1]
  quad(m, a, b, c, d, uv, col) { const [u0, v0, u1, v1] = uv; this.tri(m, a, b, c, [u0, v0], [u1, v0], [u1, v1], col); this.tri(m, a, c, d, [u0, v0], [u1, v1], [u0, v1], col); }
  build(mats, order = {}, tag = '') {
    const group = new THREE.Group(); let n = 0;
    for (const g of this.bins.values()) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.n, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.u, 2));
      if (mats[g.m].vertexColors) geo.setAttribute('color', new THREE.Float32BufferAttribute(g.c, 3));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mats[g.m]); mesh.matrixAutoUpdate = false; mesh.renderOrder = order[g.m] || 0; mesh.name = tag + g.m;
      group.add(mesh); n++;
    }
    return { group, meshes: n };
  }
}
const ICO = (() => { // 二十面體（樹冠、燈籠）；細分一次＝80 面
  const t = (1 + Math.sqrt(5)) / 2, v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(...p); return p.map((q) => q / l); });
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const v1 = v.map((p) => p.slice()), f1 = [], mid = new Map();
  const m = (a, b) => { const k = a < b ? a + '_' + b : b + '_' + a; if (mid.has(k)) return mid.get(k); const p = [(v1[a][0] + v1[b][0]) / 2, (v1[a][1] + v1[b][1]) / 2, (v1[a][2] + v1[b][2]) / 2], l = Math.hypot(...p); v1.push(p.map((q) => q / l)); mid.set(k, v1.length - 1); return v1.length - 1; };
  for (const [a, b, c] of f) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); f1.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
  return [{ v, f }, { v: v1, f: f1 }];
})();

// ---- 快速道路：一圈。從路口 (−530, 0) 朝北出發：東邊直線 → 北邊半圓（R 350）→ 西邊直線＋大 S 彎（R 900，往外鼓 61 公尺）→ 南邊半圓 → 回到路口 ----
// S 直線、A 彎（半徑、角度：正的左轉）；頭尾 14、2.5 公尺分開是為了剛好在中間護欄開口（±14）、東邊護欄開口（±16.5）的地方有點
const HWY_PLAN = [['S', 14], ['S', 2.5], ['S', 608.5], ['A', 350, 180], ['S', 159.126], ['A', 900, -15], ['A', 900, 30], ['A', 900, -15], ['S', 159.126], ['A', 350, 180], ['S', 608.5], ['S', 2.5], ['S', 14]];
const HW = { x: -530, z: 0, half: 11.9, rail: 12.0, mid: 5.05, lanes: [3.175, 6.925], gapM: 14, gapE: 16.5 }; // 半寬（到外路肩邊）、護欄、車道中間⋯（離中線幾公尺，右邊＝往前開的右手邊）
// 沿著中線取點：直線每段最長 stS 公尺、彎道每段最多 stA 度；{ x, z, th（朝向＝rotation.y）, s（從路口算的距離）, k（曲率，左轉正）}
function hwyPath(stS, stA) {
  let x = HW.x, z = HW.z, th = Math.PI / 2, s = 0; const out = [{ x, z, th, s, k: 0 }];
  for (const [t, a, b] of HWY_PLAN) {
    if (t === 'S') {
      const n = Math.max(1, Math.ceil(a / stS));
      for (let i = 1; i <= n; i++) { const d = (a * i) / n; out.push({ x: x + Math.cos(th) * d, z: z - Math.sin(th) * d, th, s: s + d, k: 0 }); }
      x += Math.cos(th) * a; z -= Math.sin(th) * a; s += a;
    } else {
      const ang = (b * Math.PI) / 180, sg = Math.sign(ang), n = Math.max(1, Math.ceil(Math.abs(b) / stA), Math.ceil((a * Math.abs(ang)) / stS)); // 大半徑的彎：一段也不要超過 stS 公尺
      const cx = x - sg * Math.sin(th) * a, cz = z - sg * Math.cos(th) * a; // 圓心：左轉在左手邊、右轉在右手邊
      for (let i = 1; i <= n; i++) { const t2 = th + (ang * i) / n; out.push({ x: cx + sg * a * Math.sin(t2), z: cz + sg * a * Math.cos(t2), th: t2, s: s + (a * Math.abs(ang) * i) / n, k: sg / a }); }
      th += ang; x = cx + sg * a * Math.sin(th); z = cz + sg * a * Math.cos(th); s += a * Math.abs(ang);
    }
  }
  return out;
}
const hwyOff = (p, o) => [p.x + o * Math.sin(p.th), p.z + o * Math.cos(p.th)]; // 中線往右 o 公尺（負的往左）
const HWY_LEN = HWY_PLAN.reduce((L, [t, a, b]) => L + (t === 'S' ? a : (a * Math.abs(b) * Math.PI) / 180), 0); // 一圈 4709.8 公尺
function hwyAt(s) { // 中線上距離 s（從路口往北算）的 { x, z, th }
  s = ((s % HWY_LEN) + HWY_LEN) % HWY_LEN; let x = HW.x, z = HW.z, th = Math.PI / 2;
  for (const [t, a, b] of HWY_PLAN) {
    if (t === 'S') { if (s <= a) return { x: x + Math.cos(th) * s, z: z - Math.sin(th) * s, th }; x += Math.cos(th) * a; z -= Math.sin(th) * a; s -= a; continue; }
    const ang = (b * Math.PI) / 180, sg = Math.sign(ang), len = a * Math.abs(ang), cx = x - sg * Math.sin(th) * a, cz = z - sg * Math.cos(th) * a;
    if (s <= len) { const t2 = th + (sg * s) / a; return { x: cx + sg * a * Math.sin(t2), z: cz + sg * a * Math.cos(t2), th: t2 }; }
    th += ang; x = cx + sg * a * Math.sin(th); z = cz + sg * a * Math.cos(th); s -= len;
  }
  return { x, z, th };
}

// ---- 路網（節點＝路口、端點）----
const NODES = {
  T: [-7, 0], E0: [-60, 0], E1: [-112, 0], SHX: [-136, 0], SH: [-160, 0], C: [-250, 0], X: [-300, 0], W: [-345, 0], DEN: [-410, 0], DEX: [-497, 0], HJ: [-518, 0],
  HO: [HW.x + HW.mid, 0], HI: [HW.x - HW.mid, 0], // 快速道路：往北（外圈）、往南（內圈）那一邊的路口
  G: [-300, -72], GD: [-300, -92.5], GAR: [-300, -97.5], SHB: [-160, -35], DEB: [-484, -17],
};
const ROADS = [
  { a: 'T', b: 'E0', kind: 'strip', w: 12, pts: [[-7, 0], [-60, 0]] }, // 賽道（buildTrack 畫的，這裡只算路線）
  { a: 'E0', b: 'E1', kind: 'main', w: [12, 12, 9, 9], pts: [[-60, 0], [-88, 0], [-100, 0], [-112, 0]] }, // 賽道入口：12 公尺寬，慢慢縮成 9
  { a: 'E1', b: 'SHX', kind: 'main', w: 9, pts: [[-112, 0], [-136, 0]] },
  { a: 'SHX', b: 'SH', kind: 'main', w: 9, pts: [[-136, 0], [-160, 0]] },
  { a: 'SH', b: 'C', kind: 'main', w: 9, pts: [[-160, 0], [-250, 0]] },
  { a: 'C', b: 'X', kind: 'street', w: 8, pts: [[-250, 0], [-300, 0]] },
  { a: 'X', b: 'W', kind: 'street', w: 8, pts: [[-300, 0], [-345, 0]] },
  { a: 'W', b: 'DEN', kind: 'main', w: 9, pts: [[-345, 0], [-410, 0]] }, // 出村子往西：車店、快速道路
  { a: 'DEN', b: 'DEX', kind: 'main', w: 9, pts: [[-410, 0], [-497, 0]] },
  { a: 'DEX', b: 'HJ', kind: 'main', w: 9, pts: [[-497, 0], [-518, 0]] },
  { a: 'HJ', b: 'HO', kind: 'link', w: 8, pts: [[-518, 0], [HW.x + HW.mid, 0]] }, // 路口右轉上外圈（往北）、左轉過中間護欄開口上內圈（往南）
  { a: 'HJ', b: 'HI', kind: 'link', w: 8, pts: [[-518, 0], [HW.x - HW.mid, 0]] },
  { a: 'W', b: 'G', kind: 'street', w: 7, pts: [[-345, 0], [-345, -72], [-300, -72]], round: 10 },
  { a: 'G', b: 'C', kind: 'street', w: 7, pts: [[-300, -72], [-250, -72], [-250, 0]], round: 10 },
  { a: 'G', b: 'X', kind: 'street', w: 7, pts: [[-300, -72], [-300, 0]] }, // 車庫門口直直往南到大路
  { a: 'G', b: 'GD', kind: 'drive', w: 6, pts: [[-300, -72], [-300, -92.5]] }, // 車庫前的水泥地 → 鐵捲門
  { a: 'GD', b: 'GAR', kind: 'drive', w: 6, pts: [[-300, -92.5], [-300, -97.5]] }, // 鐵捲門 → 車庫裡的停車位
  { a: 'SH', b: 'SHB', kind: 'drive', w: 7, oneway: true, pts: [[-160, 0], [-160, -35]] }, // 改車廠：前門開進改車區
  { a: 'SHB', b: 'SHX', kind: 'drive', w: 7, oneway: true, pts: [[-160, -35], [-160, -57], [-136, -57], [-136, 0]], round: 9 }, // 後門出去、後院、東邊的小路回大路
  { a: 'DEN', b: 'DEB', kind: 'drive', w: 7, oneway: true, pts: [[-410, 0], [-410, -17], [-484, -17]], round: 8 }, // 車店：東邊進來、經過展示間前面、開進車棚（買車區）
  { a: 'DEB', b: 'DEX', kind: 'drive', w: 7, oneway: true, pts: [[-484, -17], [-497, -17], [-497, 0]], round: 7 }, // 西邊出去
  { a: 'C', b: 'E1', kind: 'farm', w: 6, pts: [[-250, 0], [-250, 58], [-112, 58], [-112, 0]], round: 13 },
];
const DEST_NODE = { garage: 'GAR', shop: 'SHB', track: 'T', dealer: 'DEB', highway: 'HO' };
const HWK = new Set(['hwyO', 'hwyI']); // 快速道路的兩條（一圈）：路線圖用
function roundPoly(pts, r, n = 6) { // 轉角改成圓弧（二次貝茲）
  if (!r || pts.length < 3) return pts.map((p) => p.slice());
  const out = [pts[0].slice()];
  for (let i = 1; i < pts.length - 1; i++) {
    const [p, q, s] = [pts[i - 1], pts[i], pts[i + 1]], l1 = Math.hypot(q[0] - p[0], q[1] - p[1]), l2 = Math.hypot(s[0] - q[0], s[1] - q[1]), rr = Math.min(r, l1 / 2, l2 / 2);
    const a = [q[0] + ((p[0] - q[0]) * rr) / l1, q[1] + ((p[1] - q[1]) * rr) / l1], b = [q[0] + ((s[0] - q[0]) * rr) / l2, q[1] + ((s[1] - q[1]) * rr) / l2];
    for (let k = 0; k <= n; k++) { const t = k / n, u = 1 - t; out.push([u * u * a[0] + 2 * u * t * q[0] + t * t * b[0], u * u * a[1] + 2 * u * t * q[1] + t * t * b[1]]); }
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}
const plen = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };
function segDist(px, pz, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)); const qx = ax + dx * t, qz = az + dz * t; return [Math.hypot(px - qx, pz - qz), t, qx, qz]; }
const inRect = (r, x, z) => { const dx = x - r.x, dz = z - r.z, c = Math.cos(r.rot || 0), s = Math.sin(r.rot || 0); return Math.abs(dx * c - dz * s) <= r.hx && Math.abs(dx * s + dz * c) <= r.hz; };

// 賽道（buildTrack）那邊的碰撞：兩邊護欄、看台、路燈、燈樹、終點門柱
function stripColliders() {
  const out = [];
  for (const s of [1, -1]) out.push({ t: 'box', x: 350, z: s * 6.3, hx: 410, hz: 0.2, rot: 0, h: 0.9 });
  out.push({ t: 'box', x: 30, z: -13.4, hx: 65, hz: 3.3, rot: 0, h: 4.2 });
  for (let k = 0; k < 14; k++) for (const s of [1, -1]) out.push({ t: 'circle', x: -30 + 60 * k, z: s * 8, r: 0.22, h: 9 });
  out.push({ t: 'circle', x: 3.2, z: 0, r: 0.35, h: 2.6 });
  for (const s of [1, -1]) out.push({ t: 'box', x: 400, z: s * 6.9, hx: 0.23, hz: 0.23, rot: 0, h: 6.4 });
  out.push({ t: 'box', x: 761, z: 0, hx: 1, hz: 7, rot: 0, h: 1 }); // 柏油東邊的盡頭（看不到的牆，不要開出去）
  return out;
}

function buildVillage(opts = {}) {
  const R = rng(opts.seed ?? 20260927), TR = rng(7);
  const aniso = opts.renderer ? Math.min(8, opts.renderer.capabilities.getMaxAnisotropy()) : 4;
  const MA = mainAtlas(TR), SA = signAtlas(TR), GA = glowAtlas(TR), DA = decalAtlas(TR), S2A = sign2Atlas(TR);
  const U = MA.uv, SU = SA.uv, GU = GA.uv, DU = DA.uv, S2 = S2A.uv, WD = dotUV(U.white), SW = dotUV(SU.white), GW = dotUV(GU.white), S2W = dotUV(S2.white);
  const texs = [toTex(MA.c, aniso), toTex(SA.c, aniso), toTex(GA.c, aniso), toTex(DA.c, aniso), toTex(S2A.c, aniso), toTex(roadTex(TR), aniso, 't'), toTex(hwyTex(TR), aniso, 't'), toTex(paveTex(TR), aniso, 'both'), toTex(paddyTex(TR), aniso, 'both'), toTex(grassTex(TR), aniso, 'both')];
  const [tMain, tSign, tGlow, tDecal, tSign2, tRoad, tHwy, tPave, tPaddy, tGrass] = texs;
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
  const mats = {
    main: std({ map: tMain, vertexColors: true }),
    sign: std({ map: tSign, vertexColors: true, emissive: 0xffffff, emissiveMap: tSign, emissiveIntensity: 0.3, roughness: 0.6 }),
    sign2: std({ map: tSign2, vertexColors: true, emissive: 0xffffff, emissiveMap: tSign2, emissiveIntensity: 0.3, roughness: 0.6 }),
    glow: new THREE.MeshBasicMaterial({ map: tGlow, vertexColors: true }),
    halo: new THREE.MeshBasicMaterial({ map: tGlow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: true }),
    road: std({ map: tRoad, roughness: 0.93 }),
    hwy: std({ map: tHwy, roughness: 0.93 }),
    pave: std({ map: tPave, vertexColors: true }),
    paddy: std({ map: tPaddy, vertexColors: true, roughness: 0.55 }),
    decal: std({ map: tDecal, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xc4dbe8, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false, forceSinglePass: true }), // 車行、改車廠辦公室的玻璃（兩面一次畫完）
    ground: std({ map: tGrass, roughness: 1, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 6 }), // 往後推一點：斜斜看過去時水泥地、路不會被草地蓋掉
    wire: new THREE.LineBasicMaterial({ color: 0x26272a }),
  };
  // 村子：200 公尺一格；快速道路那一大圈：500 公尺一格（HB）。下面的小工具都畫到 B：蓋快速道路的時候把 B 換成 HB
  let B = new Builder(opts.chunk ?? 200); const VB = B, HB = new Builder(500);
  const colliders = [], paved = [], paddies = [], wires = [], buildings = [];
  const WHITE = [1, 1, 1];
  const dfl = (m) => (m === 'sign' ? SW : m === 'sign2' ? S2W : m === 'glow' || m === 'halo' ? GW : WD);

  // ---- 基本形狀 ----
  // 方塊：b＝[x0, y0, z0, x1, y1, z1]（本地）；col：顏色或 { pz, px, nx, nz, py, ny, _ }；uv：同樣（false＝不要那一面；ny 要寫才有）
  const box = (m, T, b, col, uv = {}) => {
    const [x0, y0, z0, x1, y1, z1] = b, P = T.p, dflt = dfl(m);
    const f = (k, a, bb, c, d) => {
      const u = uv[k] !== undefined ? uv[k] : uv._; if (u === false) return;
      const cc = Array.isArray(col) ? col : col[k] || col._ || WHITE;
      B.quad(m, P(...a), P(...bb), P(...c), P(...d), u || dflt, cc);
    };
    f('pz', [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); f('nz', [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    f('px', [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]); f('nx', [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    f('py', [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    if (uv.ny !== undefined && uv.ny !== false) f('ny', [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  };
  // 直立的面：從本地 (ax, az) 到 (bx, bz)（正面看左到右），y0–y1
  const vquad = (m, T, a, b, y0, y1, uv, col = WHITE, both = false) => {
    B.quad(m, T.p(a[0], y0, a[1]), T.p(b[0], y0, b[1]), T.p(b[0], y1, b[1]), T.p(a[0], y1, a[1]), uv, col);
    if (both) B.quad(m, T.p(b[0], y0, b[1]), T.p(a[0], y0, a[1]), T.p(a[0], y1, a[1]), T.p(b[0], y1, b[1]), [uv[2], uv[1], uv[0], uv[3]], col);
  };
  // 本地 z 往前的正面貼一片（x0–x1、y0–y1、在 z）
  const face = (m, T, x0, x1, y0, y1, z, uv, col = WHITE) => vquad(m, T, [x0, z], [x1, z], y0, y1, uv, col);
  // 天花板（從下面看）／地板（從上面看）：本地 x0–x1、z0–z1、高 y
  const ceil = (m, T, x0, z0, x1, z1, y, uv, col = WHITE) => B.quad(m, T.p(x0, y, z0), T.p(x1, y, z0), T.p(x1, y, z1), T.p(x0, y, z1), uv, col);
  const floor = (m, T, x0, z0, x1, z1, y, uv, col = WHITE) => B.quad(m, T.p(x0, y, z1), T.p(x1, y, z1), T.p(x1, y, z0), T.p(x0, y, z0), uv, col);
  // 形狀招牌（圓形、倒三角）：poly＝貼圖區塊裡的像素點（凸多邊形），貼在本地 z、中心 (cx, cy)、一像素 k 公尺；背面灰色
  const circ = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * TAU) * r, cy - Math.sin((i / n) * TAU) * r]);
  const signPoly = (T, reg, rw, rh, poly, k, cx, cy, z, back = C('#9aa0a6'), m = 'sign') => {
    let L = poly.map(([px, py]) => [cx + (px - rw / 2) * k, cy - (py - rh / 2) * k, reg[0] + ((reg[2] - reg[0]) * px) / rw, reg[3] - ((reg[3] - reg[1]) * py) / rh]);
    let area = 0; for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; area += a[0] * b[1] - b[0] * a[1]; }
    if (area < 0) L = L.reverse(); // 逆時針＝正面朝本地 +z
    const n = L.length, mm = [0, 1, 2, 3].map((q) => L.reduce((s, p) => s + p[q], 0) / n);
    for (let i = 0; i < n; i++) {
      const a = L[i], b = L[(i + 1) % n];
      B.tri(m, T.p(mm[0], mm[1], z), T.p(a[0], a[1], z), T.p(b[0], b[1], z), [mm[2], mm[3]], [a[2], a[3]], [b[2], b[3]], WHITE);
      B.tri('main', T.p(mm[0], mm[1], z - 0.025), T.p(b[0], b[1], z - 0.025), T.p(a[0], a[1], z - 0.025), WD, WD, WD, back);
    }
  };
  // 地上平平的一片：中心 (cx, cz)、dir＝貼圖上方朝向（單位向量）、len 沿 dir、wid 橫向
  const flat = (m, cx, cz, dx, dz, len, wid, y, uv, col = WHITE) => {
    const rx = -dz, rz = dx, hl = len / 2, hw = wid / 2;
    B.at(cx, cz).quad(m, [cx - dx * hl - rx * hw, y, cz - dz * hl - rz * hw], [cx - dx * hl + rx * hw, y, cz - dz * hl + rz * hw], [cx + dx * hl + rx * hw, y, cz + dz * hl + rz * hw], [cx + dx * hl - rx * hw, y, cz + dz * hl - rz * hw], uv, col);
  };
  // 直的圓柱（本地）：底 (x, y0, z)、高到 y1、半徑 r0→r1、n 邊；uv 包一圈
  const cyl = (m, T, x, z, y0, y1, r0, r1, n, col, uv = null, cap = true, a0 = 0) => {
    const P = (a, r, y) => T.p(x + Math.cos(a) * r, y, z - Math.sin(a) * r), dflt = dfl(m);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * TAU, b = a0 + ((i + 1) / n) * TAU, u = uv || dflt;
      const ua = u[0] + ((u[2] - u[0]) * i) / n, ub = u[0] + ((u[2] - u[0]) * (i + 1)) / n;
      if (r1 > 0) B.quad(m, P(a, r0, y0), P(b, r0, y0), P(b, r1, y1), P(a, r1, y1), [ua, u[1], ub, u[3]], col);
      else B.tri(m, P(a, r0, y0), P(b, r0, y0), T.p(x, y1, z), [ua, u[1]], [ub, u[1]], [(ua + ub) / 2, u[3]], col);
      if (cap && r1 > 0) B.tri(m, T.p(x, y1, z), P(a, r1, y1), P(b, r1, y1), dflt.slice(0, 2), dflt.slice(0, 2), dflt.slice(0, 2), col);
    }
  };
  // 兩點之間的管子（樹幹、支架、燕尾）：世界座標 a→b
  const tube = (m, a, b, r0, r1, n, col, uv = null, cap = false) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d); d[0] /= L; d[1] /= L; d[2] /= L;
    const up = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let e1 = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]]; const l1 = Math.hypot(...e1); e1 = e1.map((v) => v / l1);
    const e2 = [d[1] * e1[2] - d[2] * e1[1], d[2] * e1[0] - d[0] * e1[2], d[0] * e1[1] - d[1] * e1[0]];
    const P = (o, t, r) => { const c = Math.cos(t) * r, s = Math.sin(t) * r; return [o[0] + e1[0] * c + e2[0] * s, o[1] + e1[1] * c + e2[1] * s, o[2] + e1[2] * c + e2[2] * s]; };
    const u = uv || dfl(m), u0 = dfl(m);
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * TAU, t1 = ((i + 1) / n) * TAU, ua = u[0] + ((u[2] - u[0]) * i) / n, ub = u[0] + ((u[2] - u[0]) * (i + 1)) / n;
      if (r1 > 0) B.quad(m, P(a, t0, r0), P(a, t1, r0), P(b, t1, r1), P(b, t0, r1), [ua, u[1], ub, u[3]], col);
      else B.tri(m, P(a, t0, r0), P(a, t1, r0), b, [ua, u[1]], [ub, u[1]], [ua, u[3]], col);
      if (cap && r1 > 0) B.tri(m, b, P(b, t0, r1), P(b, t1, r1), u0, u0, u0, col);
    }
  };
  // 一團（樹冠、灌木、燈籠）：二十面體，每個頂點抖一點、每面顏色深淺不同
  const blob = (m, cx, cy, cz, rx, ry, rz, col, jit = 0.18, detail = 0, seed = 0, shade = 0.16) => {
    const { v, f } = ICO[detail], P = v.map((p, i) => { const k = 1 + (hash2(seed, i) - 0.5) * 2 * jit; return [cx + p[0] * rx * k, cy + p[1] * ry * k, cz + p[2] * rz * k]; });
    f.forEach(([a, b, c], i) => { const nyy = (v[a][1] + v[b][1] + v[c][1]) / 3, k = 0.88 + nyy * 0.14 + (hash2(seed + 9, i) - 0.5) * shade; B.tri(m, P[a], P[b], P[c], WD, WD, WD, mul(col, k)); });
  };
  const addBox = (x, z, hx, hz, rot, h) => colliders.push({ t: 'box', x, z, hx, hz, rot, h });
  const addCircle = (x, z, r, h) => colliders.push({ t: 'circle', x, z, r, h });
  const lbox = (T, x0, z0, x1, z1, h) => { const c = T.p((x0 + x1) / 2, 0, (z0 + z1) / 2); addBox(c[0], c[2], Math.abs(x1 - x0) / 2, Math.abs(z1 - z0) / 2, T.ry, h); }; // 本地長方形的碰撞
  const wall = (m, T, b, col, uv, h) => { box(m, T, b, col, uv); lbox(T, b[0], b[2], b[3], b[5], h ?? b[4]); }; // 方塊＋碰撞
  const addPave = (x, z, hx, hz, rot, col, y = 0.02, draw = true) => { // 水泥／柏油地（算路面）；draw false：只算路面不畫（車庫模組自己有地板）
    if (draw) {
      const T = frame(x, y, z, rot); B.at(x, z).quad('pave', T.p(-hx, 0, hz), T.p(hx, 0, hz), T.p(hx, 0, -hz), T.p(-hx, 0, -hz), [0, 0, 0, 0], col);
      const g = B.bins.get('pave|' + B.k), n = g.u.length; // 貼圖用世界座標（4 公尺一格）
      for (let i = n - 12; i < n; i += 2) { const j = ((i - (n - 12)) / 2) | 0, p = g.p.length - 18 + j * 3; g.u[i] = g.p[p] / 4; g.u[i + 1] = g.p[p + 2] / 4; }
    }
    paved.push({ x, z, hx, hz, rot });
  };

  // ---- 路 ----
  const hc = hwyPath(50, 4); // 快速道路（路線圖、小地圖用：直線 50 公尺、彎道 4 度一段）
  const roads = ROADS.concat([
    { a: 'HO', b: 'HO', kind: 'hwyO', w: 7.5, oneway: true, pts: hc.map((p) => hwyOff(p, HW.mid)) }, // 外圈：從路口往北、一圈回到路口（中線右邊）
    { a: 'HI', b: 'HI', kind: 'hwyI', w: 7.5, oneway: true, pts: hc.map((p) => hwyOff(p, -HW.mid)).reverse() }, // 內圈：從路口往南、反方向一圈
  ]).map((r) => ({ ...r, pts: roundPoly(r.pts, r.round) }));
  for (const r of roads) r.len = plen(r.pts);
  const roadSegs = []; // 村子的路（算路面、人孔蓋）：賽道、快速道路另外算
  for (const r of roads) if (r.kind !== 'strip' && r.kind !== 'link' && !HWK.has(r.kind)) for (let i = 0; i < r.pts.length - 1; i++) {
    const w = Array.isArray(r.w) ? Math.max(r.w[Math.min(i, r.w.length - 1)], r.w[Math.min(i + 1, r.w.length - 1)]) : r.w;
    roadSegs.push({ ax: r.pts[i][0], az: r.pts[i][1], bx: r.pts[i + 1][0], bz: r.pts[i + 1][1], hw: w / 2, r });
  }
  const ribbon = (r) => { // 路面：沿著折線的帶子（轉角斜接），u 橫向、v 沿路
    const pts = r.kind === 'main' && r.a === 'E0' ? [[-59.4, 0], ...r.pts.slice(1)] : r.kind === 'main' && r.b === 'HJ' ? [...r.pts.slice(0, -1), [-518.3, 0]] : r.pts; // 蓋過賽道柏油的邊一點點（接縫看不出來）；快速道路那頭接到路口的柏油
    const n = pts.length, [u0, u1] = RU[r.kind], ws = pts.map((p, i) => (Array.isArray(r.w) ? r.w[Math.min(i, r.w.length - 1)] : r.w));
    let v = 0; const L = [], Rt = [], V = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
      let k = 1; if (i > 0 && i < n - 1) { const sx = pts[i][0] - pts[i - 1][0], sz = pts[i][1] - pts[i - 1][1], sl = Math.hypot(sx, sz); k = 1 / Math.max(0.5, (sx * tx + sz * tz) / sl); }
      const lx = tz, lz = -tx, hw = (ws[i] / 2) * k; // 左邊＝(tz, −tx)
      if (i > 0) v += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      L.push([p[0] + lx * hw, 0.03, p[1] + lz * hw]); Rt.push([p[0] - lx * hw, 0.03, p[1] - lz * hw]); V.push(v / 10);
    }
    const um = (u0 + u1) / 2, M = pts.map((p) => [p[0], 0.03, p[1]]);
    for (let i = 0; i < n - 1; i++) { // 左右兩半各一條（路變寬的地方，中線才不會彎來彎去）
      B.at((pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
      B.tri('road', Rt[i], Rt[i + 1], M[i + 1], [u1, V[i]], [u1, V[i + 1]], [um, V[i + 1]], WHITE); B.tri('road', Rt[i], M[i + 1], M[i], [u1, V[i]], [um, V[i + 1]], [um, V[i]], WHITE);
      B.tri('road', M[i], M[i + 1], L[i + 1], [um, V[i]], [um, V[i + 1]], [u0, V[i + 1]], WHITE); B.tri('road', M[i], L[i + 1], L[i], [um, V[i]], [u0, V[i + 1]], [u0, V[i]], WHITE);
    }
  };
  for (const r of roads) if (RU[r.kind]) ribbon(r);
  const deg = {}; for (const r of roads) if (r.kind !== 'strip' && r.kind !== 'link' && !HWK.has(r.kind)) { deg[r.a] = (deg[r.a] || 0) + 1; deg[r.b] = (deg[r.b] || 0) + 1; }
  const ASPH = C('#55575b'), CONC = C('#e6e6e2');
  for (const [k, p] of Object.entries(NODES)) { // 路口：一塊沒有標線的柏油，剛好蓋住兩條路交叉的那一格（路都是東西向或南北向）
    if ((deg[k] || 0) < 3) continue;
    let hx = 0, hz = 0;
    for (const r of roads) {
      if (r.kind === 'strip' || r.kind === 'link' || HWK.has(r.kind) || (r.a !== k && r.b !== k)) continue;
      const q = r.a === k ? r.pts : r.pts.slice().reverse(), w = Array.isArray(r.w) ? r.w[r.a === k ? 0 : r.w.length - 1] : r.w;
      if (Math.abs(q[1][0] - q[0][0]) > Math.abs(q[1][1] - q[0][1])) hz = Math.max(hz, w / 2); else hx = Math.max(hx, w / 2);
    }
    const x0 = p[0] - hx, x1 = p[0] + hx, z0 = p[1] - hz, z1 = p[1] + hz, uv = (x, z) => [x / 4, z / 4]; B.at(p[0], p[1]);
    B.tri('pave', [x0, 0.04, z1], [x1, 0.04, z1], [x1, 0.04, z0], uv(x0, z1), uv(x1, z1), uv(x1, z0), ASPH); B.tri('pave', [x0, 0.04, z1], [x1, 0.04, z0], [x0, 0.04, z0], uv(x0, z1), uv(x1, z0), uv(x0, z0), ASPH);
  }
  // 路線圖（Dijkstra；有方向：改車廠、車店是前面進、另一邊出；快速道路兩個方向各一條，一圈接回自己）
  const adjOut = {}, adjIn = {};
  for (const r of roads) {
    if (r.a === r.b) continue; // 快速道路一圈：車子在上面才用（route 從目前位置往前開到路口）
    const e = { r, from: r.a, to: r.b }; (adjOut[r.a] ||= []).push(e); (adjIn[r.b] ||= []).push(e);
    if (!r.oneway) { const e2 = { r, from: r.b, to: r.a }; (adjOut[r.b] ||= []).push(e2); (adjIn[r.a] ||= []).push(e2); }
  }
  let surfaceAt = null; // 下面蓋完才有（路面種類要等水泥地、稻田都登記好）
  function nearestRoad(x, z) { // 最近的路：在快速道路上就只找快速道路（還有路口），不在上面就不找快速道路
    const onH = surfaceAt(x, z) === 4; let best = null;
    for (const r of roads) {
      if (HWK.has(r.kind) ? !onH : onH && r.kind !== 'link') continue;
      let along = 0;
      for (let i = 0; i < r.pts.length - 1; i++) { const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], sl = Math.hypot(bx - ax, bz - az), [d, t, qx, qz] = segDist(x, z, ax, az, bx, bz); if (!best || d < best.d) best = { d, r, i, t, qx, qz, along: along + sl * t }; along += sl; }
    }
    return best;
  }
  function dijkstra(start) { // start：{ 節點: 距離 }
    const dist = { ...start }, prev = {}, done = new Set();
    for (;;) {
      let u = null; for (const k in dist) if (!done.has(k) && (u == null || dist[k] < dist[u])) u = k;
      if (u == null) break; done.add(u);
      for (const e of adjOut[u] || []) { const nd = dist[u] + e.r.len; if (dist[e.to] == null || nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = e; } }
    }
    return { dist, prev };
  }
  const walk = (r, from) => (r.a === from ? r.pts : r.pts.slice().reverse()); // 從節點 from 沿著路 r 走的點
  function route(x, z, dest) {
    const tgt = DEST_NODE[dest] || dest, nr = nearestRoad(x, z); if (!nr || !NODES[tgt]) return { pts: [[x, z]], len: 0 };
    const r = nr.r, start = r.oneway ? { [r.b]: r.len - nr.along } : { [r.a]: nr.along, [r.b]: r.len - nr.along }; // 單行道只能往前
    const { dist, prev } = dijkstra(start);
    if (dist[tgt] == null) return { pts: [[x, z]], len: 0 };
    let first = tgt; const chain = [];
    while (prev[first]) { chain.unshift(prev[first]); first = prev[first].from; }
    const toA = !r.oneway && first === r.a, mid = toA ? r.pts.slice(0, nr.i + 1).reverse() : r.pts.slice(nr.i + 1); // 從投影點走到第一個節點（a 或 b）
    const pts = [[x, z], [nr.qx, nr.qz]].concat(mid).filter((p, i, a) => !i || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.05);
    for (const e of chain) pts.push(...walk(e.r, e.from).slice(1));
    return { pts, len: Math.hypot(x - nr.qx, z - nr.qz) + dist[tgt] };
  }
  // 所有節點之間的最短距離（路標的箭頭用；有方向）
  const APSP = {}; for (const k of Object.keys(NODES)) APSP[k] = dijkstra({ [k]: 0 }).dist;

  // ---- 地面、稻田 ----
  { // 草地：村子、快速道路那一大片；賽道那邊（x −62…1250、|z| ≤ 450）是 buildTrack 的草地，這裡只補它南北兩邊；切成 50 公尺的格子（太大的三角形在手機／SwiftShader 上深度會不準）
    const P = [], N = [], UV = [];
    const rect = (x0, z0, x1, z1) => {
      const nx = Math.max(1, Math.round((x1 - x0) / 50)), nz = Math.max(1, Math.round((z1 - z0) / 50));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const a = x0 + ((x1 - x0) * i) / nx, b = x0 + ((x1 - x0) * (i + 1)) / nx, c = z0 + ((z1 - z0) * j) / nz, d = z0 + ((z1 - z0) * (j + 1)) / nz;
        for (const [x, z] of [[a, d], [b, d], [b, c], [a, d], [b, c], [a, c]]) { P.push(x, 0, z); N.push(0, 1, 0); UV.push(x / 6, -z / 6); }
      }
    };
    rect(-1500, -1150, -62, 1150); rect(-62, -1150, 1300, -450); rect(-62, 450, 1300, 1150);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.computeBoundingSphere();
    var ground = new THREE.Mesh(g, mats.ground); ground.name = 'ground'; ground.matrixAutoUpdate = false;
  }
  const RICE = [C('#ffffff'), C('#eef6e4'), C('#ffffff'), C('#b3e869'), C('#a2dc5c'), C('#c8ef78'), C('#e8f07a')]; // 白＝剛插秧（水面映天空）；綠、黃綠＝長高了的稻子（乘在同一張貼圖上）
  const paddyArea = (x0, z0, x1, z1, nx, nz, rnd) => { // 一塊稻田：切成 nx × nz 格，中間田埂
    paddies.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, rot: 0 });
    const dx = (x1 - x0) / nx, dz = (z1 - z0) / nz, EMB = C('#8a9a58');
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const a = x0 + i * dx + 0.2, b = x0 + (i + 1) * dx - 0.2, c = z0 + j * dz + 0.2, d = z0 + (j + 1) * dz - 0.2, col = pick(rnd, RICE), rot = rnd() < 0.5;
      B.at((a + b) / 2, (c + d) / 2);
      const uv = (x, z) => (rot ? [z / 3.2, x / 3.2] : [x / 3.2, z / 3.2]);
      B.tri('paddy', [a, 0.012, d], [b, 0.012, d], [b, 0.012, c], uv(a, d), uv(b, d), uv(b, c), col); B.tri('paddy', [a, 0.012, d], [b, 0.012, c], [a, 0.012, c], uv(a, d), uv(b, c), uv(a, c), col);
    }
    const T0 = frame(0, 0, 0);
    for (let i = 0; i <= nx; i++) { const x = x0 + i * dx; B.at(x, (z0 + z1) / 2); box('main', T0, [x - 0.22, 0, z0, x + 0.22, 0.14, z1], EMB, { nz: false, pz: false }); }
    for (let j = 0; j <= nz; j++) { const z = z0 + j * dz; B.at((x0 + x1) / 2, z); box('main', T0, [x0, 0, z - 0.22, x1, 0.14, z + 0.22], EMB, { px: false, nx: false }); }
  };

  // ---- 樹 ----
  const GREENS = ['#4f8a3c', '#5e9a44', '#3f7a35', '#6aa84f', '#77ad4c'].map(C), TRUNK = C('#6b5140');
  const tree = (x, z, s, rnd, col = true) => { // 圓圓的樹
    B.at(x, z); const T = frame(x, 0, z), h = 2 * s;
    cyl('main', T, 0, 0, 0, h + 0.4, 0.2 * s, 0.14 * s, 6, TRUNK, null, false);
    const g = pick(rnd, GREENS), seed = (rnd() * 1e6) | 0;
    blob('main', x, h + 1.3 * s, z, 1.8 * s, 1.5 * s, 1.8 * s, g, 0.22, 1, seed);
    blob('main', x + 0.7 * s, h + 2.1 * s, z - 0.4 * s, 1.1 * s, 1.0 * s, 1.1 * s, mul(g, 1.1), 0.2, 0, seed + 1);
    if (col) addCircle(x, z, 0.35 * s, h + 3 * s);
  };
  const lowTree = (x, z, s, rnd) => { // 遠遠的樹（快速道路旁邊）：面少一點
    B.at(x, z); cyl('main', frame(x, 0, z), 0, 0, 0, 2.2 * s, 0.22 * s, 0.15 * s, 4, TRUNK, null, false);
    blob('main', x, 3.4 * s, z, 2.2 * s, 1.8 * s, 2.2 * s, mul(pick(rnd, GREENS), 0.92 + rnd() * 0.16), 0.25, 0, (rnd() * 1e6) | 0, 0.2);
  };
  const cone = (x, y, z, s, rnd) => { B.at(x, z); const T = frame(x, y, z, rnd() * TAU); cyl('main', T, 0, 0, -0.5, 1.2 * s, 0.18 * s, 0.12 * s, 5, TRUNK, null, false); cyl('main', T, 0, 0, 1.0 * s, 5.2 * s, 1.5 * s, 0, 7, mul(pick(rnd, GREENS), 0.8 + rnd() * 0.25), null, false); };
  const FROND = [C('#4c7d32'), C('#5b8f3a'), C('#6b9c3f')];
  const palm = (x, z, h, rnd, col = true) => { // 檳榔樹：細細直直的樹幹、上面一小叢葉子
    B.at(x, z); const lean = (rnd() - 0.5) * 0.06, la = rnd() * TAU, top = [x + Math.cos(la) * lean * h, h, z + Math.sin(la) * lean * h];
    tube('main', [x, 0, z], top, 0.13, 0.1, 5, C('#b9bca9'), U.bark);
    const sh = [top[0], top[1] + 1.1, top[2]]; tube('main', top, sh, 0.12, 0.1, 5, C('#6f9a3e'));
    blob('main', top[0] + 0.12, top[1] - 0.1, top[2], 0.2, 0.28, 0.2, C('#c9a13a'), 0.2, 0, (rnd() * 1e6) | 0); // 檳榔
    const n = 7 + ((rnd() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd() * 0.4, cx = Math.cos(a), cz = Math.sin(a), Lf = 2.3 + rnd() * 0.8, up = 0.9 + rnd() * 0.5, W = 0.34, fc = pick(rnd, FROND);
      const at = (t) => [sh[0] + cx * Lf * t, sh[1] - 0.2 + up * t - (up + 1.3) * t * t, sh[2] + cz * Lf * t];
      for (let k = 0; k < 4; k++) {
        const t0 = k / 4, t1 = (k + 1) / 4, w0 = W * Math.sin(Math.PI * Math.min(0.95, t0 + 0.08)), w1 = W * Math.sin(Math.PI * Math.min(0.95, t1 + 0.04)) * (k === 3 ? 0.2 : 1);
        const p0 = at(t0), p1 = at(t1), rx = -cz, rz = cx;
        const a0 = [p0[0] - rx * w0, p0[1], p0[2] - rz * w0], b0 = [p0[0] + rx * w0, p0[1], p0[2] + rz * w0], a1 = [p1[0] - rx * w1, p1[1], p1[2] - rz * w1], b1 = [p1[0] + rx * w1, p1[1], p1[2] + rz * w1];
        B.quad('main', a0, b0, b1, a1, WD, fc); B.quad('main', b0, a0, a1, b1, WD, mul(fc, 0.8));
      }
    }
    if (col) addCircle(x, z, 0.25, h);
  };
  const bamboo = (x, z, rnd) => { // 竹叢
    B.at(x, z);
    for (let i = 0; i < 9; i++) {
      const a = rnd() * TAU, r = rnd() * 1.2, bx = x + Math.cos(a) * r, bz = z + Math.sin(a) * r, h = 7 + rnd() * 4, lx = Math.cos(a) * (0.6 + rnd()), lz = Math.sin(a) * (0.6 + rnd());
      tube('main', [bx, 0, bz], [bx + lx, h, bz + lz], 0.07, 0.04, 4, C('#8fae4a'));
      blob('main', bx + lx * 1.05, h - 0.6, bz + lz * 1.05, 1.1, 1.6, 1.1, mul(C('#6f9e3a'), 0.85 + rnd() * 0.3), 0.3, 0, (rnd() * 1e6) | 0);
    }
    addCircle(x, z, 1.4, 9);
  };
  const banyan = (x, z) => { // 廟口的大榕樹
    B.at(x, z); const T = frame(x, 0, z);
    cyl('main', T, 0, 0, 0, 3.6, 1.0, 0.75, 8, C('#6e5a4a'), null, false);
    for (const [a, l] of [[0.3, 3.2], [2.1, 3.6], [4.0, 3.0], [5.3, 2.8]]) tube('main', [x, 3.2, z], [x + Math.cos(a) * l, 5.2, z + Math.sin(a) * l], 0.42, 0.25, 6, C('#6e5a4a'));
    for (const [dx, dy, dz, r] of [[0, 7.2, 0, 5.2], [3.2, 6.4, 1.8, 3.6], [-3.4, 6.2, -1.2, 3.8], [0.8, 6.0, -3.4, 3.4], [-1.2, 6.3, 3.4, 3.4], [0, 8.8, 0.5, 3.2]]) blob('main', x + dx, dy, z + dz, r, r * 0.62, r, C('#3f6e33'), 0.2, 1, (dx * 100 + dz) | 0);
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU + 0.3, r = 2.4 + (i % 3) * 1.1; tube('main', [x + Math.cos(a) * r, 5.4, z + Math.sin(a) * r], [x + Math.cos(a) * r, 0, z + Math.sin(a) * r], 0.05, 0.06, 3, C('#7a6655')); }
    addCircle(x, z, 1.1, 10);
  };
  const shrub = (x, z, s, rnd) => { B.at(x, z); blob('main', x, 0.45 * s, z, 0.9 * s, 0.6 * s, 0.9 * s, mul(pick(rnd, GREENS), 0.9 + rnd() * 0.2), 0.25, 0, (rnd() * 1e6) | 0); }; // 花台裡的矮樹

  // ---- 電線桿、路燈、電線 ----
  const pole = (x, z, fx, fz, lamp, trans) => { // (fx, fz)：朝路中間的方向（路燈的手臂伸過去）
    B.at(x, z); const T = frame(x, 0, z, Math.atan2(fx, fz)); // 本地 +z 朝路
    cyl('main', T, 0, 0, 0, 10.4, 0.17, 0.12, 6, C('#b9b8b2'), null, true);
    box('main', T, [-1.05, 9.5, -0.06, 1.05, 9.64, 0.06], C('#5f6166'));
    const ins = [-0.9, 0, 0.9].map((dx) => { box('main', T, [dx - 0.05, 9.64, -0.05, dx + 0.05, 9.84, 0.05], C('#e8e8e4')); return T.p(dx, 9.82, 0); });
    if (trans) { cyl('main', T, 0, -0.42, 6.8, 8.0, 0.32, 0.32, 8, C('#8f9398'), null, true); box('main', T, [-0.06, 7.0, -0.25, 0.06, 7.8, -0.12], C('#5f6166')); }
    if (lamp) { // 路燈手臂＋燈頭
      const a = T.p(0, 7.4, 0.1), b = T.p(0, 7.9, 1.9); tube('main', a, b, 0.05, 0.05, 4, C('#8d9197'));
      const H = T.sub(0, 7.8, 2.2); box('main', H, [-0.18, -0.08, -0.45, 0.18, 0.06, 0.45], C('#6f7378'), { ny: dotUV(U.white) }); box('glow', H, [-0.14, -0.1, -0.38, 0.14, -0.08, 0.38], [1.1, 1.05, 0.95], { _: dotUV(GU.warm), ny: dotUV(GU.warm) });
    }
    addCircle(x, z, 0.24, 10.4);
    return ins;
  };
  const poleLine = (pts) => { // pts：[[x, z, fx, fz], ...]
    let prev = null;
    pts.forEach(([x, z, fx, fz], i) => {
      const ins = pole(x, z, fx, fz, i % 2 === 0, i % 3 === 1);
      if (prev) for (let k = 0; k < 3; k++) { const a = prev[k], b = ins[k], sag = 0.35 + Math.hypot(b[0] - a[0], b[2] - a[2]) * 0.012; let p0 = a; for (let s = 1; s <= 8; s++) { const t = s / 8, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]; wires.push(p0, p); p0 = p; } }
      prev = ins;
    });
  };
  const mirrorPole = (x, z, tx, tz) => { // 路口反光鏡（橘色桿子），鏡子朝 (tx, tz)
    B.at(x, z); const T = frame(x, 0, z, Math.atan2(tx - x, tz - z)); cyl('main', T, 0, 0, 0, 2.75, 0.05, 0.05, 5, C('#ff7a1a'), null, true);
    signPoly(T, SU.mirror, 96, 96, circ(48, 48, 46, 14), 0.44 / 46, 0, 3.05, 0.09, C('#ff7a1a'));
    addCircle(x, z, 0.12, 3);
  };

  // ---- 透天厝 ----
  const HOUSE = ['#f6e9d7', '#f5c9c1', '#cfe9d9', '#fbe6a3', '#cfe2f2', '#ffd5b0', '#e5dcf0', '#f3f3ef', '#dcd5c7', '#d99a78', '#b9dccd', '#f7cfe0', '#ece3a8', '#a9cbe8'].map(C);
  const AWN = ['#3f8f6a', '#2f6fb0', '#c9ccd0', '#d9573b', '#e2b53a'].map(C), ROOFADD = ['#3b78c4', '#e07a3a', '#e8eaec', '#4c9a6a', '#8fb7e0'].map(C);
  const SCOOT = ['#f2f3f5', '#d0342c', '#2f6fd6', '#c3c8ce', '#ff8fb5', '#f2c230', '#1d1f23'].map(C);
  const scooter = (x, z, ry, rnd) => { // 機車（停在騎樓前）
    B.at(x, z); const T = frame(x, 0, z, ry), pc = pick(rnd, SCOOT), dk = C('#2a2b2e');
    box('main', T, [-0.75, 0.28, -0.19, 0.5, 0.62, 0.19], pc); box('main', T, [-0.2, 0.2, -0.2, 0.36, 0.3, 0.2], dk);
    box('main', T, [-0.66, 0.62, -0.17, 0.05, 0.73, 0.17], C('#1b1c1f')); box('main', T, [0.46, 0.26, -0.22, 0.62, 0.98, 0.22], pc);
    box('main', T, [0.52, 0.96, -0.33, 0.58, 1.01, 0.33], dk); box('main', T, [0.62, 0.72, -0.08, 0.66, 0.84, 0.08], C('#f4f1e6'));
    for (const wx of [-0.55, 0.6]) tube('main', T.p(wx, 0.2, -0.07), T.p(wx, 0.2, 0.07), 0.2, 0.2, 7, dk, null, true);
    const c = T.p(-0.05, 0, 0); addBox(c[0], c[2], 0.72, 0.24, ry, 1);
  };
  const house = (x, z, ry, w, D, fl, rnd, o = {}) => {
    B.at(x, z); const T = frame(x, 0, z, ry), H = fl * FH;
    const cw = pick(rnd, HOUSE), cs = mix(cw, C('#c9c5bd'), 0.55), band = mul(cw, 0.8), roof = C('#a39f97');
    box('main', T, [-w / 2, 0, -D, w / 2, H, 0], { pz: cw, py: roof, _: cs }, { pz: subUV(U.tile, 0, 0, Math.min(1, w / 6.2), Math.min(1, H / 13.2)), _: U.conc });
    const pw = 0.18, ph = 0.95; // 女兒牆
    box('main', T, [-w / 2, H, -pw, w / 2, H + ph, 0], { pz: cw, _: cs }, { pz: subUV(U.tile, 0, 0, Math.min(1, w / 6.2), 0.07), _: U.conc });
    box('main', T, [-w / 2, H, -D, w / 2, H + ph, -D + pw], cs, { _: U.conc }); box('main', T, [-w / 2, H, -D + pw, -w / 2 + pw, H + ph, -pw], cs, { _: U.conc }); box('main', T, [w / 2 - pw, H, -D + pw, w / 2, H + ph, -pw], cs, { _: U.conc });
    // 頂樓：樓梯間、水塔、加蓋的鐵皮屋
    const sx = (rnd() - 0.5) * Math.max(0, w - 3.2), stair = [sx - 1.3, H, -D + 0.6, sx + 1.3, H + 2.6, -D + 3.9];
    box('main', T, stair, cs, { _: U.conc, pz: U.conc }); face('main', T, sx - 0.45, sx + 0.45, H, H + 2.1, -D + 3.92, U.ac2);
    if (rnd() < 0.55) { cyl('main', T, sx, -D + 2.2, H + 2.6, H + 2.8, 0.5, 0.5, 6, C('#7d8288'), null, true); cyl('main', T, sx, -D + 2.2, H + 2.8, H + 4.1, 0.58, 0.58, 10, WHITE, U.tank, false); cyl('main', T, sx, -D + 2.2, H + 4.1, H + 4.4, 0.58, 0, 10, C('#d9dde1'), null, false); }
    else { const bl = C('#2f78c8'); cyl('main', T, sx, -D + 2.2, H + 2.6, H + 3.8, 0.62, 0.62, 10, bl, null, false); cyl('main', T, sx, -D + 2.2, H + 3.8, H + 4.05, 0.62, 0.2, 10, mul(bl, 0.9), null, true); }
    if (fl >= 3 && rnd() < 0.35) { // 頂樓加蓋（浪板）
      const rc = pick(rnd, ROOFADD), z1 = -D * 0.42;
      box('main', T, [-w / 2 + 0.25, H, -D + 4.3, w / 2 - 0.25, H + 2.7, z1], rc, { _: U.corr, py: false });
      B.quad('main', T.p(-w / 2 + 0.05, H + 2.62, z1 + 0.4), T.p(w / 2 - 0.05, H + 2.62, z1 + 0.4), T.p(w / 2 - 0.05, H + 3.2, -D + 4.0), T.p(-w / 2 + 0.05, H + 3.2, -D + 4.0), U.corr, mul(rc, 0.85));
      B.quad('main', T.p(-w / 2 + 0.05, H + 3.2, -D + 4.0), T.p(w / 2 - 0.05, H + 3.2, -D + 4.0), T.p(w / 2 - 0.05, H + 2.62, z1 + 0.4), T.p(-w / 2 + 0.05, H + 2.62, z1 + 0.4), WD, mul(rc, 0.5));
    }
    for (let f = 1; f < fl; f++) box('main', T, [-w / 2, f * FH - 0.14, 0, w / 2, f * FH + 0.06, 0.12], band, { _: U.conc }); // 每層的線腳
    // 一樓：鐵捲門＋大門、店面、或門＋窗
    const kind = o.shop != null ? 'shop' : rnd() < 0.62 ? 'shutter' : 'door';
    let door = 0; // 門在本地 x 哪裡（以後走進去用）
    if (kind === 'shop') {
      const sp = o.shop;
      face('main', T, -w / 2 + 0.2, w / 2 - 0.2, 0, 2.75, 0.02, U['shop' + (sp % 3 + 1)]);
      box('sign', T, [-w / 2 + 0.1, 2.78, 0, w / 2 - 0.1, 3.22, 0.2], C('#f2f3f5'), { pz: SU['h' + (sp % 3)], _: SW });
      if (fl >= 3) box('sign', T, [w / 2 - 0.34, 3.7, 0.08, w / 2 - 0.1, 7.6, 1.0], C('#f2f3f5'), { px: SU['v' + (sp % 8)], nx: SU['v' + (sp % 8)], _: SW }); // 直立招牌
    } else if (kind === 'shutter') {
      const sw = w >= 5 ? Math.min(3.4, w - 1.7) : w - 0.5, x0 = -w / 2 + 0.25;
      face('main', T, x0, x0 + sw, 0, 2.7, 0.02, U.shutter, pick(rnd, [WHITE, WHITE, C('#d9efe9'), C('#dde8f6'), C('#f5ecd9')]));
      box('main', T, [x0 - 0.05, 2.7, 0, x0 + sw + 0.05, 3.0, 0.24], C('#9aa0a6'));
      if (w >= 5) { face('main', T, w / 2 - 1.45, w / 2 - 0.15, 0, 2.6, 0.02, U.door); door = w / 2 - 0.8; } else door = x0 + sw / 2;
      if (o.vsign != null && fl >= 3) box('sign', T, [w / 2 - 0.34, 3.7, 0.08, w / 2 - 0.1, 7.6, 1.0], C('#f2f3f5'), { px: SU['v' + o.vsign], nx: SU['v' + o.vsign], _: SW });
    } else {
      face('main', T, -0.8, 0.8, 0, 2.6, 0.02, U.door);
      if (w >= 4.6) { face('main', T, -w / 2 + 0.35, -1.05, 0.9, 2.4, 0.02, U.winP); face('main', T, 1.05, w / 2 - 0.35, 0.9, 2.4, 0.02, U.winP); }
    }
    if (rnd() < 0.45) { // 一樓的雨遮（浪板）
      const ac = pick(rnd, AWN);
      B.quad('main', T.p(-w / 2, 2.95, 1.1), T.p(w / 2, 2.95, 1.1), T.p(w / 2, 3.25, 0), T.p(-w / 2, 3.25, 0), U.corr, ac);
      B.quad('main', T.p(-w / 2, 3.25, 0), T.p(w / 2, 3.25, 0), T.p(w / 2, 2.95, 1.1), T.p(-w / 2, 2.95, 1.1), WD, mul(ac, 0.55));
    }
    const pc = rnd() < 0.3 ? WHITE : cw, parU = pick(rnd, [U.par1, U.par2, U.par3]);
    for (let f = 1; f < fl; f++) { // 樓上：陽台或鐵窗
      const y = f * FH;
      if (rnd() < 0.5) {
        box('main', T, [-w / 2 + 0.1, y - 0.16, 0, w / 2 - 0.1, y, 1.05], band, { _: U.conc, ny: U.conc });
        box('main', T, [-w / 2 + 0.1, y, 0.93, w / 2 - 0.1, y + 1.0, 1.05], pc, { pz: parU, nz: parU, _: U.conc });
        box('main', T, [-w / 2 + 0.1, y, 0, -w / 2 + 0.22, y + 1.0, 0.93], pc, { _: U.conc }); box('main', T, [w / 2 - 0.22, y, 0, w / 2 - 0.1, y + 1.0, 0.93], pc, { _: U.conc });
        const dw = Math.min(3.2, w - 1.2); face('main', T, -dw / 2, dw / 2, y, y + 2.35, 0.02, U.slide);
        if (rnd() < 0.35) { // 曬衣服
          box('main', T, [-w / 2 + 0.3, y + 1.9, 0.55, w / 2 - 0.3, y + 1.94, 0.59], C('#c9ccd0'));
          for (let k = 0; k < 4; k++) { const cx = -w / 2 + 0.7 + k * (w - 1.4) / 4 + rnd() * 0.3; vquad('main', T, [cx - 0.25, 0.57], [cx + 0.25, 0.57], y + 1.2, y + 1.9, WD, pick(rnd, SCOOT.concat(HOUSE)), true); }
        }
        if (rnd() < 0.5) box('main', T, [w / 2 - 1.1, y, 0.25, w / 2 - 0.3, y + 0.55, 0.6], C('#efefeb'), { pz: U.ac, _: WD });
      } else {
        const gw = Math.min(2.6, w - 1.3), wu = pick(rnd, [U.win1, U.win1, U.win2, U.win3]);
        box('main', T, [-gw / 2, y + 0.85, 0, gw / 2, y + 2.45, 0.34], C('#6a6f76'), { pz: wu, py: WD, _: WD });
        box('main', T, [-gw / 2 - 0.1, y + 2.45, 0, gw / 2 + 0.1, y + 2.53, 0.46], C('#9aa0a6'));
        if (rnd() < 0.55) box('main', T, [gw / 2 - 0.85, y + 0.25, 0, gw / 2 - 0.05, y + 0.78, 0.32], C('#efefeb'), { pz: U.ac, _: WD });
      }
    }
    if (o.scooter || rnd() < 0.22) scooter(...(() => { const p = T.p((rnd() - 0.5) * (w - 2), 0, 0.8); return [p[0], p[2], ry + (rnd() < 0.5 ? 0 : Math.PI), rnd]; })());
    const c = T.p(0, 0, -D / 2), dp = T.p(door, 0, 0.6); addBox(c[0], c[2], w / 2, D / 2, ry, H);
    buildings.push({ kind: kind === 'shop' ? 'shop' : 'house', x: c[0], z: c[2], hx: w / 2, hz: D / 2, rot: ry, h: H, floors: fl, door: { x: dp[0], z: dp[2], ry } }); // door：大門外面一點（ry＝房子正面朝的方向）
    return H;
  };
  // 一排透天厝：沿著建築線從 a 到 b，面向 (nx, nz)（朝路）；前面 1.5 公尺水泥地（騎樓前）
  const row = (ax, az, bx, bz, nx, nz, seed, o = {}) => {
    const rnd = rng(seed), L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, ry = Math.atan2(nx, nz);
    let t = 0, i = 0;
    while (L - t >= 4) {
      let w = 4.3 + rnd() * 1.7; if (L - t - w < 4) w = L - t;
      if (w > 7) w = 5 + rnd();
      const cx = ax + ux * (t + w / 2), cz = az + uz * (t + w / 2), fl = rnd() < 0.2 ? 2 : rnd() < 0.62 ? 3 : 4;
      house(cx, cz, ry, w, o.D ?? 12.5, fl, rnd, { shop: o.shops && o.shops[i] != null ? o.shops[i] : null, vsign: o.vsigns && o.vsigns[i] != null ? o.vsigns[i] : null });
      t += w; i++;
      if (o.gaps && rnd() < 0.13 && L - t > 12) { const gw = 3 + rnd() * 2.5, gx = ax + ux * (t + gw / 2), gz = az + uz * (t + gw / 2); tree(gx - nx * 3, gz - nz * 3, 0.9 + rnd() * 0.3, rnd); t += gw; }
    }
    const ap = o.apron ?? 1.5; addPave(ax + ux * L / 2 + nx * ap / 2, az + uz * L / 2 + nz * ap / 2, L / 2, ap / 2, ry, C('#d9d9d4'));
  };

  // 停著的車（改車廠裡、後院的廢車）：本地 +x＝車頭；y0＝輪子底下的高度（舉升機上就高一點）
  const carProp = (x, y0, z, ry, col, o = {}) => {
    B.at(x, z); const T = frame(x, y0, z, ry), L = o.L ?? 4.4, W = o.W ?? 1.8, rust = o.rust, dk = C('#17181b');
    const body = rust ? mul(col, 0.9) : col, side = rust ? U.rust : U.carSide;
    box('main', T, [-L / 2, 0.32, -W / 2, L / 2, 1.0, W / 2], { py: body, _: body }, { pz: side, nz: flipU(side), px: rust ? U.rust : U.carFront, nx: rust ? U.rust : U.carBack, py: WD });
    box('main', T, [-L / 2 + 0.95, 1.0, -W / 2 + 0.1, L / 2 - 1.25, 1.42, W / 2 - 0.1], { py: body, _: rust ? C('#3a3530') : C('#26303a') }, { py: WD, _: WD });
    if (!o.noWheels) for (const wx of [-L / 2 + 0.78, L / 2 - 0.82]) for (const s of [1, -1]) tube('main', T.p(wx, 0.33, s * (W / 2 - 0.18)), T.p(wx, 0.33, s * (W / 2 + 0.02)), 0.33, 0.33, 8, dk, null, true);
    return T;
  };

  // ---- 村子中間那塊：四邊都是透天厝；中間一條往北的路（車庫門口直直出來到大路）----
  row(-268, -5.5, -295.5, -5.5, 0, 1, 101, { shops: [null, 0, null, null, 1], gaps: false }); // 大路西段北側（面向南）：新路東邊
  row(-304.5, -5.5, -327, -5.5, 0, 1, 112, { shops: [null, 2], gaps: false });              // 新路西邊
  row(-268, -67, -295.5, -67, 0, -1, 102, { gaps: false });                                 // 北邊的路南側（面向北）
  row(-304.5, -67, -327, -67, 0, -1, 113, { gaps: false });
  row(-295, -52, -295, -21, -1, 0, 114, { D: 11, apron: 1.0, vsigns: [null, 2], gaps: false }); // 車庫那條路（x −300）東側（面向西）
  row(-305, -37, -305, -52, 1, 0, 115, { D: 11, apron: 1.0, gaps: false });                 // 西側（面向東）
  row(-255, -15, -255, -66, 1, 0, 103, { shops: [2, null, null, null, 0], vsigns: [null, 3, null, 5], gaps: false }); // 廟口街西側（面向東）；路口那塊空著（樹）
  row(-340, -66, -340, -6, -1, 0, 104, { gaps: false });                                    // 西邊的路東側（面向西）
  tree(-263, -9.5, 1.05, rng(31)); tree(-244, 12.5, 1.1, rng(32)); // 廟口路口的兩個角
  // 外圍
  row(-245, -22, -245, -66, -1, 0, 105, { shops: [null, null, 1], vsigns: [4, null, null, 7], gaps: true }); // 廟口街東側（面向西）
  row(-340, -77, -316, -77, 0, 1, 106, { gaps: false });            // 車庫西邊（面向南）
  row(-284, -77, -256, -77, 0, 1, 107, { gaps: false });            // 車庫東邊
  row(-302, 5.5, -340, 5.5, 0, -1, 108, { vsigns: [6, null, null, 1], gaps: true }); // 大路西段南側（面向北）
  row(-220, -6, -184, -6, 0, 1, 109, { shops: [null, null, 0, null, null, 1], vsigns: [3], gaps: true }); // 大路北側（超商到改車廠）
  row(-237, 6, -196, 6, 0, -1, 110, { shops: [null, 2, null, null], vsigns: [null, null, null, 5, null, 7], gaps: true }); // 大路南側
  { // 中間的院子：菜園、幾棵樹、一小塊田
    const rnd = rng(111);
    for (const [x, z] of [[-282, -44], [-276, -28], [-272, -48]]) tree(x, z, 1.1 + rnd() * 0.3, rnd, false);
    addPave(-321.5, -45, 4.5, 6, 0, C('#8a7556')); // 菜園（土）
    for (let i = 0; i < 4; i++) { const z = -49.5 + i * 3; B.at(-321.5, z); box('main', frame(-321.5, 0, z), [-3.8, 0, -0.7, 3.8, 0.28, 0.7], C('#6b5a40')); for (let k = 0; k < 7; k++) blob('main', -325 + k * 1.1, 0.42, z, 0.42, 0.26, 0.42, mul(C('#6aa84f'), 0.85 + rnd() * 0.3), 0.3, 0, i * 10 + k); }
    paddyArea(-327, -35, -306, -21, 3, 1, rnd);
  }

  // ---- 你的車庫：這裡只有空地（白色大理石、鐵捲門的車庫是另外的模組，放在 places.garage.lot）；前面水泥地、兩邊花台，門口直直往南一條路到大路 ----
  const LOT = { x: -300, z: -97.5, heading: -Math.PI / 2 }; // 模組原點＝裡面停車位的車子中心；本地 +x 朝鐵捲門外（南）、本地 +z 朝西
  {
    const T = frame(LOT.x, 0, LOT.z, LOT.heading), T0 = frame(0, 0, 0); B.at(-300, -84);
    addPave(-300, -83.85, 14, 8.35, 0, C('#d2d2cd'));            // 前庭 x −314…−286、z −92.2…−75.5
    addPave(-300, -83.85, 7, 8.35, 0, C('#bcbdb9'), 0.024);       // 門前的車道（apron）深一點
    addPave(-300, -101.35, 13, 9.15, 0, null, 0, false);          // 車庫裡面（模組的地板）：算水泥地，不畫
    for (const x of [-306.8, -293.2]) { B.at(x, -84); box('main', T0, [x - 0.12, 0.024, -91.8, x + 0.12, 0.03, -76], C('#8e8f8c')); } // 車道兩邊的排水溝蓋
    const rnd = rng(919);
    for (const s of [1, -1]) { // 兩邊花台（低低的，不擋視線）
      const x0 = s > 0 ? -291 : -313.5, x1 = s > 0 ? -286.5 : -309; B.at((x0 + x1) / 2, -85.5);
      box('main', T0, [x0, 0, -91, x1, 0.55, -80], C('#eceae4'), { _: U.conc }); box('main', T0, [x0 + 0.2, 0.55, -90.8, x1 - 0.2, 0.62, -80.2], C('#5d4a38'));
      for (let k = 0; k < 5; k++) shrub((x0 + x1) / 2 + (rnd() - 0.5) * 1.6, -89.6 + k * 2.3, 1.1, rnd);
      const t = (x0 + x1) / 2; tree(t, -84.5, 0.8, rnd, false); addBox(t, -85.5, (x1 - x0) / 2, 5.5, 0, 0.62);
    }
    for (const x of [-308.2, -291.8]) { B.at(x, -77.2); const t = frame(x, 0, -77.2); cyl('main', t, 0, 0, 0, 0.8, 0.1, 0.1, 6, C('#2a2c30'), null, false); cyl('glow', t, 0, 0, 0.8, 0.95, 0.1, 0.1, 6, [1.5, 1.5, 1.5], dotUV(GU.warm), true); addCircle(x, -77.2, 0.12, 1); } // 車道口的矮燈柱
    if (opts.garagePlaceholder) { // 測試用的假車庫殼：牆、6 公尺寬 3.8 公尺高的門洞、屋頂；碰撞跟真的模組差不多
      const wc = C('#f4f3ef'), trim = C('#9a9b9d'); B.at(-300, -101);
      floor('main', T, -12.7, -12.7, 5, 12.7, 0.03, dotUV(U.conc), C('#f7f6f2'));
      wall('main', T, [-13, 0, -13, -12.7, 5.5, 13], wc, { _: U.conc }); // 後牆
      for (const s of [1, -1]) wall('main', T, [-12.7, 0, s > 0 ? 12.7 : -13, 5.15, 5.5, s > 0 ? 13 : -12.7], wc, { _: U.conc });
      for (const s of [1, -1]) wall('main', T, [4.85, 0, s > 0 ? 3 : -12.7, 5.15, 5.5, s > 0 ? 12.7 : -3], wc, { _: U.conc }); // 前牆（門兩邊）
      box('main', T, [4.85, 3.8, -3, 5.15, 5.5, 3], wc, { _: U.conc }); box('main', T, [5.1, 3.55, -3.1, 5.35, 3.85, 3.1], trim); // 門上面、捲起來的鐵捲門
      box('main', T, [-13.1, 5.5, -13.1, 5.35, 5.8, 13.1], C('#dcdcd6'), { _: U.conc, ny: U.conc });
      for (const [x, z] of [[-8, -8], [-8, 8], [0, -8], [0, 8]]) ceil('glow', T, x - 1, z - 0.2, x + 1, z + 0.2, 5.48, dotUV(GU.cool), [1.2, 1.2, 1.2]);
    }
    buildings.push({ kind: 'garage', name: '你的車庫', x: -300, z: -101.35, hx: 9.15, hz: 13, rot: LOT.heading, h: 6, door: { x: -300, z: -91.6, ry: 0 } }); // 車庫模組的地（本地 x −13…5.3、z ±13）：以後走進去、小地圖用
  }

  // ---- 阿輝改車廠：鐵皮工廠。前門開進去（中間的改車區），後門出去，從後院、東邊的小路回大路；裡面舉升機、工具牆、輪胎架、零件架、辦公室、日光燈 ----
  {
    const T = frame(-160, 0, -26, 0); B.at(-160, -35); // 本地＝世界 −(−160, −26)：牆 x −18…18、z −18…0（正面在 z 0 朝南）
    const wall1 = C('#9fb0c2'), wall2 = C('#dfe3e8'), inner = C('#e4e7ea'), steel = C('#3b4148'), yel = C('#f2c230');
    const IN = { pz: 'nz', nz: 'pz', px: 'nx', nx: 'px' };
    const wp = (x0, z0, x1, z1, y0, y1, out, col = true) => { // 一段牆：外面浪板（下半藍灰、上半淺灰）、裡面白色浪板
      for (const [a, b, c] of [[y0, Math.min(y1, 5), wall1], [Math.max(y0, 5), y1, wall2]]) if (b - a > 0.01) box('main', T, [x0, a, z0, x1, b, z1], { [out]: c, [IN[out]]: inner, _: mix(c, inner, 0.5) }, { _: U.corr });
      if (col) lbox(T, x0, z0, x1, z1, y1);
    };
    wp(-18, -0.25, -14.5, 0, 0, 7.4, 'pz'); wp(-8.5, -0.25, -3, 0, 0, 7.4, 'pz'); wp(3, -0.25, 18, 0, 0, 7.4, 'pz'); // 前牆：西邊的門（開著，展示舉升機）、中間的門（開進去）
    wp(-14.5, -0.25, -8.5, 0, 4.6, 7.4, 'pz', false); wp(-3, -0.25, 3, 0, 4.6, 7.4, 'pz', false);
    wp(-18, -18, -3, -17.75, 0, 7.4, 'nz'); wp(3, -18, 18, -17.75, 0, 7.4, 'nz'); wp(-3, -18, 3, -17.75, 4.6, 7.4, 'nz', false); // 後牆：中間後門
    wp(-18, -17.75, -17.75, -0.25, 0, 7.4, 'nx'); wp(17.75, -17.75, 18, -0.25, 0, 7.4, 'px'); // 兩邊
    for (const s of [1, -1]) { // 山牆（三角形）：外面、裡面
      const xo = s * 18, xi = s * 17.75, a = s > 0 ? 0 : -18, b = s > 0 ? -18 : 0;
      B.tri('main', T.p(xo, 7.4, a), T.p(xo, 7.4, b), T.p(xo, 8.8, -9), [U.corr[0], U.corr[1]], [U.corr[2], U.corr[1]], [(U.corr[0] + U.corr[2]) / 2, U.corr[3]], wall2);
      B.tri('main', T.p(xi, 7.4, b), T.p(xi, 7.4, a), T.p(xi, 8.8, -9), [U.corr[0], U.corr[1]], [U.corr[2], U.corr[1]], [(U.corr[0] + U.corr[2]) / 2, U.corr[3]], inner);
    }
    for (const [zA, zB, zr] of [[0.6, -9, 1], [-18.6, -9, -1]]) { // 屋頂（上面、下面）
      const a = T.p(zr > 0 ? -18.5 : 18.5, 7.3, zA), b = T.p(zr > 0 ? 18.5 : -18.5, 7.3, zA), c = T.p(zr > 0 ? 18.5 : -18.5, 8.8, zB), d = T.p(zr > 0 ? -18.5 : 18.5, 8.8, zB);
      B.quad('main', a, b, c, d, U.corr, C('#8d9aa8')); B.quad('main', b, a, d, c, U.corr, C('#6c7580'));
    }
    for (const x of [-12, -6, 0, 6, 12]) box('main', T, [x - 0.1, 6.95, -17.75, x + 0.1, 7.2, -0.25], steel, { ny: WD }); // 鋼樑
    for (const [x, open] of [[-11.5, true], [0, true], [11.5, false]]) { // 三個鐵捲門：兩個開著（捲在上面），東邊那個關著
      if (!open) face('main', T, x - 3, x + 3, 0, 4.6, 0.03, U.rdoor);
      box('main', T, [x - 3.25, 4.6, 0, x + 3.25, 4.9, 0.3], C('#50555c'));
      if (open) box('main', T, [x - 3.1, 4.62, -0.75, x + 3.1, 5.0, -0.28], C('#8f969e'), { ny: WD }); // 捲起來的門
    }
    box('main', T, [-3.1, 4.62, -17.7, 3.1, 5.0, -17.25], C('#8f969e'), { ny: WD }); // 後門上面（捲起來的門）
    box('sign', T, [-7.2, 5.15, 0, 7.2, 7.25, 0.2], { pz: WHITE, _: C('#121316') }, { pz: SU.shop, _: SW }); // 大招牌：阿輝改車廠
    box('main', T, [-18, 0, 0, -14.5, 0.25, 0.3], C('#50555c')); box('main', T, [-8.5, 0, 0, -3, 0.25, 0.3], C('#50555c')); box('main', T, [3, 0, 0, 18, 0.25, 0.3], C('#50555c'));
    B.quad('sign', T.p(-18.02, 1.3, -2), T.p(-18.02, 1.3, -14), T.p(-18.02, 4.6, -14), T.p(-18.02, 4.6, -2), SU.mural, WHITE); // 西邊牆上的大字（從村子開過來看得到）
    // 地板：綠灰色 Epoxy、黃線（中間開過去的車道、西邊的舉升機位）
    floor('main', T, -17.75, -17.75, 17.75, -0.25, 0.03, dotUV(U.conc), C('#8aa196')); addPave(-160, -35, 17.75, 8.75, 0, null, 0, false);
    for (const x of [-3.05, 3.05]) floor('main', T, x - 0.06, -17.6, x + 0.06, -0.4, 0.036, WD, yel);
    for (const [x0, z0, x1, z1] of [[-14.3, -15, -8.7, -14.88], [-14.3, -3.12, -8.7, -3], [-14.3, -15, -14.18, -3], [-8.82, -15, -8.7, -3]]) floor('main', T, x0, z0, x1, z1, 0.036, WD, yel);
    flat('decal', -160, -35, 0, -1, 11, 5.4, 0.05, DU.zone); // 改車區（停在這裡就打開改車廠）
    flat('decal', -171.5, -35, 0, -1, 4, 4, 0.052, DU.oil); flat('decal', -159, -31, 0, -1, 3, 3, 0.052, DU.oil);
    // 舉升機：中間（空的，手臂收在旁邊，上面一根橫樑：車子、鏡頭都過得去）、西邊（上面一台車舉起來）
    const LIFT = C('#c8322a');
    for (const [x0, x1, top] of [[-3.55, 3.55, true], [-14.15, -8.85, false]]) {
      for (const x of [x0, x1]) { box('main', T, [x - 0.18, 0, -9.3, x + 0.18, 3.95, -8.7], LIFT); box('main', T, [x - 0.3, 0, -9.45, x + 0.3, 0.12, -8.55], C('#2a2b2e')); const c = T.p(x, 0, -9); addBox(c[0], c[2], 0.3, 0.45, 0, 3.95); }
      if (top) box('main', T, [x0 - 0.18, 3.95, -9.25, x1 + 0.18, 4.25, -8.75], LIFT, { ny: WD });
      for (const x of [x0, x1]) for (const dz of [-1.1, 1.1]) { const s = x < (x0 + x1) / 2 ? 1 : -1; box('main', T, [Math.min(x, x + s * 0.9), top ? 0.08 : 1.62, -9 + dz - 0.08, Math.max(x, x + s * 0.9), top ? 0.16 : 1.72, -9 + dz + 0.08], C('#50555c')); }
    }
    carProp(-171.5, 1.72, -35, Math.PI / 2, C('#2f6fd6')); // 舉起來的藍色車（車頭朝北）
    carProp(-148.5, 0, -32, -Math.PI / 2, C('#f2f3f5')); const cc = T.p(11.5, 0, -6); addBox(cc[0], cc[2], 1, 2.3, 0, 1.5); // 東邊鐵捲門後面等著修的白車
    for (const [x, z] of [[-6.3, -6], [-6.3, -12], [6.3, -6], [6.3, -12]]) { box('main', T, [x - 0.18, 0, z - 0.18, x + 0.18, 6.95, z + 0.18], steel); const c = T.p(x, 0, z); addBox(c[0], c[2], 0.2, 0.2, 0, 7); } // 柱子
    // 西邊：工作台、洞洞板工具牆、空壓機
    box('main', T, [-17.75, 0, -15, -16.9, 0.88, -3], { py: C('#8a6a4a'), _: C('#5a5f66') }); lbox(T, -17.75, -15, -16.9, -3, 1);
    vquad('main', T, [-17.72, -3], [-17.72, -15], 1.1, 2.7, U.peg);
    box('main', T, [-17.2, 0, -1.6, -15.9, 0.6, -0.6], C('#2f6fd6')); cyl('main', frame(-176.5, 0.6, -27.1), 0, 0, 0, 0.9, 0.3, 0.3, 8, C('#2f6fd6'), null, true); lbox(T, -17.2, -1.6, -15.9, -0.6, 1.5);
    box('main', T, [-16.4, 0, -17.3, -15.2, 1.0, -16.3], C('#d0342c')); lbox(T, -16.4, -17.3, -15.2, -16.3, 1); // 紅色工具車
    // 東邊：輪胎架（後牆）、零件架（東牆）、辦公室（玻璃）、換胎機、平衡機
    box('main', T, [4, 0, -17.75, 11, 3.0, -16.95], { pz: WHITE, _: C('#2a2b2f') }, { pz: U.rack, _: WD }); lbox(T, 4, -17.75, 11, -16.95, 3);
    box('main', T, [16.95, 0, -11, 17.75, 2.6, -1.5], { nx: WHITE, _: C('#5c6167') }, { nx: U.shelf, _: WD }); lbox(T, 16.95, -11, 17.75, -1.5, 2.6);
    { const g0 = C('#3a3d42'); // 辦公室：x 12…17.75、z −17.75…−12，玻璃牆
      for (const [x, z] of [[12, -12], [12, -17.7], [15.6, -12], [17.7, -12]]) box('main', T, [x - 0.06, 0, z - 0.06, x + 0.06, 2.8, z + 0.06], g0);
      box('main', T, [12, 2.8, -17.75, 17.75, 3.0, -12], C('#f2f3f5'), { ny: WD });
      box('main', T, [12, 0, -12.06, 15.6, 0.9, -11.94], C('#d9dce0')); // 下面一截是板子
      vquad('glass', T, [12, -12], [15.5, -12], 0.9, 2.8, WD); vquad('glass', T, [12, -17.7], [12, -12], 0.9, 2.8, WD); box('main', T, [11.94, 0, -17.7, 12.06, 0.9, -12], C('#d9dce0'));
      box('main', T, [13.2, 0, -16.8, 15.8, 0.76, -15.6], { py: C('#8a6a4a'), _: C('#6b5a48') }); face('glow', T, 13.9, 14.9, 0.8, 1.4, -16.3, GU.tv); // 桌子、電腦
      lbox(T, 12, -17.75, 17.75, -12, 3);
    }
    box('main', T, [4.2, 0, -4.6, 5.3, 1.0, -3.4], C('#c8322a')); cyl('main', frame(-155.25, 1.0, -30), 0, 0, 0, 0.1, 0.45, 0.45, 10, C('#2a2b2e'), null, true); lbox(T, 4.2, -4.6, 5.3, -3.4, 1.1); // 換胎機
    box('main', T, [4.3, 0, -15.8, 5.2, 1.1, -14.9], C('#3b78c4')); lbox(T, 4.3, -15.8, 5.2, -14.9, 1.1); // 平衡機
    for (const [x, z, n] of [[8.6, -15.8, 5], [9.4, -15, 4], [-13.2, -16.5, 3]]) { const t = T.sub(x, 0, z); for (let k = 0; k < n; k++) cyl('main', t, 0, 0, k * 0.25, k * 0.25 + 0.23, 0.33, 0.33, 9, C('#1b1c1f'), null, true); const c = t.p(0, 0, 0); addCircle(c[0], c[2], 0.36, n * 0.25); } // 地上一疊輪胎
    // 燈：日光燈（三排），後牆上面的燈箱（阿輝改車廠）、出口燈
    for (const x of [-11.5, 0, 11.5]) for (const z of [-4, -9, -14]) { box('main', T, [x - 0.2, 5.55, z - 0.95, x + 0.2, 5.68, z + 0.95], C('#c9ccd0')); ceil('glow', T, x - 0.14, z - 0.9, x + 0.14, z + 0.9, 5.54, dotUV(GU.cool), [1.3, 1.3, 1.3]); }
    face('glow', T, -2.2, 2.2, 5.15, 6.35, -17.72, GU.shopHdr, [1.15, 1.15, 1.15]);
    face('glow', T, 3.4, 4.4, 3.7, 4.2, -17.72, GU.exitG);
    // 前庭：輪胎堆、油桶、旗子、輪胎招牌
    addPave(-156.5, -15.2, 24.5, 10.8, 0, C('#cfd0cc')); // x −181…−132、z −26…−4.4
    const rnd = rng(212);
    const tyres = (x, z, n) => { const t = frame(x, 0, z); for (let k = 0; k < n; k++) cyl('main', t, 0, 0, k * 0.25, k * 0.25 + 0.23, 0.33, 0.33, 9, C('#1b1c1f'), null, true); addCircle(x, z, 0.36, n * 0.25); };
    for (const [x, z, n] of [[-176, -22.5, 5], [-176.8, -21.6, 4], [-175.2, -21.4, 6], [-144, -22.6, 5], [-143.2, -21.7, 3], [-179.5, -24.5, 4]]) { B.at(x, z); tyres(x, z, n); }
    for (const [x, z, col] of [[-177.2, -12, '#d0342c'], [-176.4, -11.4, '#2f6fd6'], [-177.4, -10.6, '#f2c230']]) { B.at(x, z); const t = frame(x, 0, z); cyl('main', t, 0, 0, 0, 0.9, 0.3, 0.3, 10, C(col), null, true); cyl('main', t, 0, 0, 0.3, 0.36, 0.305, 0.305, 10, WHITE, null, false); addCircle(x, z, 0.32, 0.9); }
    ['flag0', 'flag1', 'flag2'].forEach((f, i) => { const x = -153 + i * 5.5, z = -5.5, t = frame(x, 0, z); B.at(x, z); cyl('main', t, 0, 0, 0, 3.8, 0.04, 0.04, 5, C('#c9ccd0'), null, true); vquad('sign', t, [0.05, 0], [0.75, 0], 0.9, 3.7, SU[f], WHITE, true); addCircle(x, z, 0.1, 3.8); });
    flat('decal', -166, -9, 0.6, -0.8, 5, 5, 0.052, DU.skid); flat('decal', -150, -21, 0, -1, 4, 4, 0.052, DU.oil);
    for (let i = 0; i < 3; i++) flat('decal', -150 + i * 3.5, -12 + rnd(), 0, 1, 3, 3, 0.051, DU.oil);
    flat('decal', -160, -19, 0, -1, 4.6, 1.3, 0.05, DU.arrU); flat('decal', -136, -16, 0, 1, 4.6, 1.3, 0.05, DU.arrU); // 前門進去、東邊小路出來（地上的箭頭）
    const lb = frame(-181.5, 0, -12, Math.PI / 2); B.at(-181.5, -12); // 輪胎招牌柱
    cyl('main', lb, 0, 0, 0, 4, 0.1, 0.1, 6, C('#50555c'), null, true); tube('main', lb.p(0, 4.4, -0.2), lb.p(0, 4.4, 0.2), 0.75, 0.75, 14, C('#16171a'), null, true); addCircle(-181.5, -12, 0.15, 4);
    // 後院（x −174…−128、z −72…−44）：出口的路（後門往北、往東、再沿著東邊的小路往南回大路）；兩邊擺廢車、輪胎、油桶；鐵絲網圍起來
    addPave(-151, -58, 23, 14, 0, C('#b4b4ae')); addPave(-136, -35, 4, 9, 0, C('#b4b4ae'));
    const fence = (x0, z0, x1, z1) => { // 鐵皮圍籬（藍色浪板，兩面都看得到）＋柱子，3 公尺一片
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 3)), ry = Math.atan2(-(z1 - z0), x1 - x0), t = frame((x0 + x1) / 2, 0, (z0 + z1) / 2, ry); B.at(t.x, t.z);
      for (let i = 0; i < n; i++) vquad('main', t, [-L / 2 + (L * i) / n, 0], [-L / 2 + (L * (i + 1)) / n, 0], 0.05, 2.2, U.corr, C('#5f86b8'), true);
      for (let i = 0; i <= n; i++) box('main', t, [-L / 2 + (L * i) / n - 0.05, 0, -0.08, -L / 2 + (L * i) / n + 0.05, 2.3, 0.08], C('#7d8288'));
      addBox((x0 + x1) / 2, (z0 + z1) / 2, L / 2, 0.1, ry, 2.2);
    };
    fence(-174, -72, -129, -72); fence(-174, -72, -174, -44.2); fence(-129, -72, -129, -27);
    const junk = rng(313);
    const jc = (x, z, ry, col, nw) => { const t = carProp(x, 0, z, ry, col, { rust: true, noWheels: nw }); const c = t.p(0, 0, 0); addBox(c[0], c[2], 2.25, 0.95, ry, 1.45); };
    jc(-169, -67.5, 0.25, C('#8d6a52'), true); jc(-168.5, -50, Math.PI / 2 + 0.1, C('#6f8a9a'), false); jc(-144, -68, -0.15, C('#a5a8a0'), true);
    for (const [x, z, n] of [[-172, -61, 4], [-171.2, -60.2, 5], [-133, -70, 6], [-132.2, -69.1, 3], [-131.4, -70.3, 5], [-151.5, -46.5, 4]]) { B.at(x, z); tyres(x, z, n); }
    for (const [x, z, col] of [[-156.5, -70.5, '#2f6fd6'], [-155.8, -69.9, '#2f6fd6'], [-146.5, -46.3, '#d0342c'], [-147.3, -47, '#3a3d42']]) { B.at(x, z); const t = frame(x, 0, z); cyl('main', t, 0, 0, 0, 0.9, 0.3, 0.3, 10, C(col), null, true); addCircle(x, z, 0.32, 0.9); }
    { B.at(-162, -70.4); const t = frame(-162, 0, -70.4, 0.08); box('main', t, [-1.2, 0, -0.55, 1.2, 0.72, 0.55], C('#8a6a4a')); box('main', t, [-1.1, 0.72, -0.5, 1.1, 1.3, 0.5], C('#4a4d52')); addBox(-162, -70.4, 1.2, 0.55, 0.08, 1.3); } // 棧板上的舊引擎
    flat('decal', -160, -50, 0, -1, 4.6, 1.3, 0.05, DU.arrU); flat('decal', -146, -57, 1, 0, 4.6, 1.3, 0.05, DU.arrU); flat('decal', -136, -44, 0, 1, 4.6, 1.3, 0.05, DU.arrU);
    flat('decal', -150, -62, 0, 1, 5, 5, 0.052, DU.oil); flat('decal', -165, -56, 1, 0, 4, 4, 0.052, DU.oil);
    buildings.push({ kind: 'shop', name: '阿輝改車廠', x: -160, z: -35, hx: 18, hz: 9, rot: 0, h: 8.8, door: { x: -160, z: -25, ry: 0 } });
  }

  // ---- 福德宮（廟）：紅牆、燕尾曲線屋頂、廟埕、大榕樹、香爐、金爐 ----
  const curvedRoof = (T, L, Dp, Dn, yE, yR, lift, colU, uvTop, nS = 10) => { // 屋脊沿本地 x，兩邊斜面往 ±z，屋簷和兩端往上翹
    const P = (s, t, side) => { const e = Math.abs(s) ** 4, D = side > 0 ? Dp : Dn; return T.p(s * (L / 2 + 0.7 * t * t), yE + (yR - yE) * Math.pow(1 - t, 1.5) + lift * e * (0.5 + 0.5 * t * t), side * D * t); };
    for (const side of [1, -1]) for (let i = 0; i < nS; i++) for (let j = 0; j < 4; j++) {
      const s0 = -1 + (2 * i) / nS, s1 = -1 + (2 * (i + 1)) / nS, t0 = j / 4, t1 = (j + 1) / 4, uv = [uvTop[0], uvTop[1] + (uvTop[3] - uvTop[1]) * (1 - t1), uvTop[2], uvTop[1] + (uvTop[3] - uvTop[1]) * (1 - t0)];
      const a = P(side > 0 ? s0 : s1, t1, side), b = P(side > 0 ? s1 : s0, t1, side), c = P(side > 0 ? s1 : s0, t0, side), d = P(side > 0 ? s0 : s1, t0, side);
      B.quad('main', a, b, c, d, uv, WHITE); B.quad('main', b, a, d, c, WD, colU);
    }
    for (const s of [1, -1]) B.tri('main', P(s, 0, 1), s > 0 ? P(s, 1, 1) : P(s, 1, -1), s > 0 ? P(s, 1, -1) : P(s, 1, 1), WD, WD, WD, C('#9a2019'));
    return P;
  };
  {
    const cx = -277, cz = 32, T = frame(cx, 0, cz, Math.PI); B.at(cx, cz); // 面向北（大路）
    const gran = C('#aaa498'), red = C('#b8241c'), gold = C('#d9a63a');
    box('main', T, [-8, 0, -6, 8, 0.45, 7.5], gran); box('main', T, [-2.6, 0, 7.5, 2.6, 0.28, 8.4], mul(gran, 1.05));
    box('main', T, [-6.2, 0.45, -4.8, 6.2, 4.7, 2.6], WHITE, { _: U.twall, py: WD });
    face('main', T, -1.9, 1.9, 0.45, 3.9, 2.62, U.tdoor); for (const x of [-3.9, 3.9]) face('main', T, x - 0.75, x + 0.75, 1.7, 3.2, 2.62, U.twin);
    box('sign', T, [-1.55, 3.98, 2.6, 1.55, 4.56, 2.75], { pz: WHITE, _: C('#1c2c4c') }, { pz: SU.temple, _: SW });
    for (const x of [-5.6, -2.9, 2.9, 5.6]) { cyl('main', T, x, 6.4, 0.45, 0.75, 0.36, 0.3, 8, gran, null, true); cyl('main', T, x, 6.4, 0.75, 4.75, 0.24, 0.24, 10, red, null, false); }
    box('main', T, [-6.7, 4.5, 6.05, 6.7, 4.78, 6.75], gold); box('main', T, [-6.7, 4.78, 6.05, 6.7, 4.98, 6.75], C('#2e8b57'));
    box('main', T, [-6.2, 4.7, 2.6, 6.2, 4.98, 6.05], C('#7d1812')); // 前廊天花板
    const RT = T.sub(0, 0, 0.9), P = curvedRoof(RT, 14.6, 6.5, 6.4, 4.8, 7.6, 1.15, C('#5a1a12'), U.troof, 12);
    let prev = null; for (let i = 0; i <= 12; i++) { const s = -1 + (2 * i) / 12, p = P(s, 0, 1); const q = [p[0], p[1] + 0.2, p[2]]; if (prev) tube('main', prev, q, 0.24, 0.24, 4, WHITE, U.ridge); prev = q; }
    for (const s of [1, -1]) { // 燕尾
      const e = P(s, 0, 1), base = [e[0], e[1] + 0.2, e[2]], ox = RT.p(s * 9.4, 0, 0), dir = [ox[0] - RT.x, 0, ox[2] - RT.z], dl = Math.hypot(dir[0], dir[2]), ux = dir[0] / dl, uz = dir[2] / dl;
      const mid = [base[0] + ux * 0.9, base[1] + 0.75, base[2] + uz * 0.9]; tube('main', base, mid, 0.22, 0.17, 4, C('#b8261c'));
      for (const zz of [0.38, -0.38]) { const side = RT.p(0, 0, zz), sx = side[0] - RT.x, sz = side[2] - RT.z; tube('main', mid, [mid[0] + ux * 0.8 + sx, mid[1] + 0.9, mid[2] + uz * 0.8 + sz], 0.16, 0.03, 4, C('#b8261c')); }
    }
    const top = P(0, 0, 1); blob('main', top[0], top[1] + 0.95, top[2], 0.38, 0.38, 0.38, C('#ff5a2a'), 0.05, 0, 3); cyl('main', frame(top[0], top[1] + 0.2, top[2]), 0, 0, 0, 0.6, 0.22, 0.15, 6, gold, null, true); // 屋脊中間的寶珠
    for (const s of [1, -1]) { const a = RT.p(s * 0.6, 0, 0), b = RT.p(s * 2.6, 0, 0); tube('main', [a[0], top[1] + 0.45, a[2]], [b[0], top[1] + 1.25, b[2]], 0.2, 0.07, 5, C('#2e9a5c')); }
    for (const x of [-4.25, -2.2, 2.2, 4.25]) { const p = T.p(x, 3.35, 6.4); blob('main', p[0], p[1], p[2], 0.34, 0.44, 0.34, C('#e0261a'), 0.02, 1, x | 0, 0.05); cyl('main', frame(p[0], p[1] + 0.4, p[2]), 0, 0, 0, 0.3, 0.14, 0.14, 6, gold, null, true); cyl('main', frame(p[0], p[1] - 0.58, p[2]), 0, 0, 0, 0.16, 0.12, 0.12, 6, gold, null, true); cyl('main', frame(p[0], p[1] + 0.7, p[2]), 0, 0, 0, 4.5 - p[1] - 0.7, 0.025, 0.025, 3, C('#3a2a1a'), null, false); }
    for (const x of [-2.3, 2.3]) { const L0 = T.sub(x, 0, 9.0); box('main', L0, [-0.45, 0, -0.45, 0.45, 0.7, 0.45], gran); box('main', L0, [-0.32, 0.7, -0.4, 0.32, 1.35, 0.36], C('#9d988e')); box('main', L0, [-0.3, 1.2, 0.05, 0.3, 1.7, 0.55], C('#a6a196')); const c = L0.p(0, 0, 0); addCircle(c[0], c[2], 0.55, 1.7); }
    { const I = T.sub(0, 0, 13.5), bronze = C('#8d6a36'); box('main', I, [-0.6, 0, -0.6, 0.6, 0.55, 0.6], gran); cyl('main', I, 0, 0, 0.55, 1.35, 0.55, 0.72, 12, bronze, null, true); cyl('main', I, 0, 0, 1.35, 1.9, 0.5, 0.08, 8, mul(bronze, 1.15), null, false); for (const s of [1, -1]) box('main', I, [s * 0.75 - 0.06, 1.1, -0.08, s * 0.75 + 0.06, 1.55, 0.08], gold); const c = I.p(0, 0, 0); addCircle(c[0], c[2], 0.8, 2); }
    { const F = T.sub(9.8, 0, 4.2); box('main', F, [-0.8, 0, -0.8, 0.8, 1.7, 0.8], C('#b8241c')); face('main', F, -0.35, 0.35, 0.5, 1.2, 0.81, WD, C('#241a16')); box('main', F, [-0.6, 1.7, -0.6, 0.6, 2.5, 0.6], C('#c7362a')); curvedRoof(F.sub(0, 0, 0), 1.6, 0.95, 0.95, 2.55, 3.15, 0.25, C('#5a1a12'), U.troof, 4); cyl('main', F, 0, 0, 3.0, 3.8, 0.14, 0.08, 6, gold, null, true); const c = F.p(0, 0, 0); addBox(c[0], c[2], 0.8, 0.8, Math.PI, 3); }
    const c = T.p(0, 0, 0.75), dp = T.p(0, 0, 3.3); addBox(c[0], c[2], 8, 6.75, Math.PI, 8); buildings.push({ kind: 'temple', name: '福德宮', x: c[0], z: c[2], hx: 8, hz: 6.75, rot: Math.PI, h: 8, door: { x: dp[0], z: dp[2], ry: Math.PI } });
    addPave(-277, 14.6, 21, 9.3, 0, C('#e3dccf')); // 廟埕
    flat('decal', -290, 12.5, 1, 0, 9, 5.5, 0.05, DU.rice); // 曬穀
    banyan(-265, 19);
    const rnd = rng(313); for (const [x, z] of [[-292, 45], [-280, 47], [-266, 44], [-296, 30], [-258, 33]]) tree(x, z, 1.2 + rnd() * 0.3, rnd);
  }

  // ---- 村口超商 ----
  {
    const T = frame(-231.5, 0, -6, 0); B.at(-231.5, -6);
    box('main', T, [-9, 0, -13, 9, 4.2, 0], C('#f4f4f2'), { _: U.conc });
    face('glow', T, -8.4, 8.4, 0, 3.0, 0.03, GU.store, [1.05, 1.05, 1.05]);
    face('main', T, -9, 9, 3.05, 3.6, 0.03, U.band);
    box('glow', T, [-9.1, 4.2, -0.4, 9.1, 5.2, 0.15], [1.05, 1.05, 1.05], { pz: GU.storeSign, _: dotUV(GU.white) });
    B.quad('main', T.p(-9.02, 3.05, 0), T.p(-9.02, 3.05, -13), T.p(-9.02, 3.6, -13), T.p(-9.02, 3.6, 0), U.band, WHITE);
    for (const [x, z, cl] of [[-7.5, 1.0, '#2f78c8'], [-6.8, 1.0, '#43b36b']]) { cyl('main', T, x, z, 0, 0.95, 0.28, 0.28, 8, C(cl), null, true); const c = T.p(x, 0, z); addCircle(c[0], c[2], 0.3, 1); }
    box('main', T, [5.2, 0, 0.6, 7.6, 0.45, 1.1], C('#8a6a4a')); const bc = T.p(6.4, 0, 0.85); addBox(bc[0], bc[2], 1.2, 0.25, 0, 0.5); // 長椅
    const rnd = rng(414); scooter(...T.p(3.6, 0, 1.1).filter((_, i) => i !== 1), 0, rnd); scooter(...T.p(2.5, 0, 1.2).filter((_, i) => i !== 1), 0.1, rnd);
    for (const [x, cl] of [[-3.4, '#1e7b45'], [-2.7, '#c8281e']]) { const p = T.p(x, 0, 1.1); B.at(p[0], p[2]); const t = frame(p[0], 0, p[2]); box('main', t, [-0.28, 0, -0.25, 0.28, 1.05, 0.25], C(cl)); cyl('main', t, 0, 0, 1.05, 1.2, 0.3, 0.2, 8, C(cl), null, true); addCircle(p[0], p[2], 0.32, 1.2); } // 郵筒（綠、紅）
    const c = T.p(0, 0, -6.5); addBox(c[0], c[2], 9, 6.5, 0, 5); buildings.push({ kind: 'store', name: '村口超商', x: c[0], z: c[2], hx: 9, hz: 6.5, rot: 0, h: 5.2, door: { x: -231.5, z: -5.4, ry: 0 } });
  }

  // ---- 三合院（農家，紅磚紅瓦）----
  {
    const T = frame(-330, 0, 58, Math.PI); B.at(-330, 58); const brick = C('#ffffff');
    box('main', T, [-9, 0, -3, 9, 3.4, 3], brick, { _: U.brick, py: WD });
    for (const s of [1, -1]) box('main', T, [s > 0 ? 6 : -9, 0, 3, s > 0 ? 9 : -6, 3.0, 13], brick, { _: U.brick, py: WD });
    face('main', T, -1, 1, 0, 2.5, 3.02, U.door); for (const x of [-5, 5]) face('main', T, x - 0.8, x + 0.8, 1.0, 2.3, 3.02, U.win3);
    curvedRoof(T.sub(0, 0, 0), 19, 3.8, 3.8, 3.3, 5.0, 0.25, C('#4a1c12'), U.froof, 8);
    for (const s of [1, -1]) curvedRoof(T.sub(s * 7.5, 0, 8, Math.PI / 2), 11, 2.4, 2.4, 2.95, 4.2, 0.15, C('#4a1c12'), U.froof, 6);
    addBox(-330, 58, 9, 3, Math.PI, 5); for (const s of [1, -1]) { const c = T.p(s * 7.5, 0, 8); addBox(c[0], c[2], 1.5, 5, Math.PI, 4); }
    buildings.push({ kind: 'farmhouse', name: '三合院', x: -330, z: 58, hx: 9, hz: 3, rot: Math.PI, h: 5, door: { x: -330, z: 54.4, ry: Math.PI } });
    addPave(-330, 50, 6, 5, 0, C('#cbb8a0'));
    const rnd = rng(515); for (const [x, z] of [[-346, 62], [-316, 66], [-338, 72]]) tree(x, z, 1.1 + rnd() * 0.3, rnd);
  }

  // ---- 賽道入口：拱門、紅白護欄、旗子、看板 ----
  {
    const T = frame(-70, 0, 0, 0); B.at(-70, 0);
    for (const s of [1, -1]) { box('main', T, [-0.45, 0, s * 7.5 - 0.45, 0.45, 7.2, s * 7.5 + 0.45], C('#1b1d21')); box('glow', T, [-0.47, 1.0, s * 7.5 - 0.47, 0.47, 1.25, s * 7.5 + 0.47], [1.6, 1.6, 1.6], { _: dotUV(GU.led) }); addBox(-70, s * 7.5, 0.45, 0.45, 0, 7.2); }
    box('sign', T, [-0.3, 5.3, -8, 0.3, 6.8, 8], { nx: WHITE, _: C('#121316') }, { nx: SU.arch, px: false, _: SW });
    B.quad('sign', T.p(0.31, 5.3, 8), T.p(0.31, 5.3, -8), T.p(0.31, 6.8, -8), T.p(0.31, 6.8, 8), subUV(SU.white, 0, 0, 1, 1), C('#121316'));
    vquad('sign', T, [0.33, 3], [0.33, -3], 5.4, 6.7, SU.archB); // 背面（從賽道回村子看到）：回村子（從 +x 看，左邊是 +z）
    for (const s of [1, -1]) { const t = T.sub(0, 7.2, s * 7.5); cyl('main', t, 0, 0, 0, 2.4, 0.04, 0.04, 5, C('#c9ccd0'), null, true); for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) vquad('main', t, [-0.05 - i * 0.3 - 0.3, 0], [-0.05 - i * 0.3, 0], 1.4 + j * 0.3, 1.7 + j * 0.3, WD, (i + j) % 2 ? C('#141414') : C('#f2f3f5'), true); }
    const bar = (x0, z0, x1, z1) => { // 紅白水泥護欄（一段一段，4 公尺一節）
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 4)), ry = Math.atan2(-(z1 - z0), x1 - x0);
      for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n, t = frame(x0 + (x1 - x0) * (t0 + t1) / 2, 0, z0 + (z1 - z0) * (t0 + t1) / 2, ry); B.at(t.x, t.z); box('main', t, [-L / n / 2, 0, -0.2, L / n / 2, 0.9, 0.2], WHITE, { _: U.barrier }); }
      addBox((x0 + x1) / 2, (z0 + z1) / 2, L / 2, 0.2, ry, 0.9);
    };
    for (const s of [1, -1]) { bar(-60.3, s * 6.3, -88, s * 6.5); bar(-88, s * 6.5, -99, s * 9.6); }
    const fence = (x, z0, z1) => { // 賽道外面的圍籬（紅白欄杆）
      const n = Math.round(Math.abs(z1 - z0) / 3);
      for (let i = 0; i <= n; i++) { const z = z0 + ((z1 - z0) * i) / n; B.at(x, z); cyl('main', frame(x, 0, z), 0, 0, 0, 1.3, 0.05, 0.05, 4, C('#e8e9eb'), null, true); }
      for (let i = 0; i < n; i++) { const za = z0 + ((z1 - z0) * i) / n, zb = z0 + ((z1 - z0) * (i + 1)) / n, t = frame(x, 0, (za + zb) / 2, Math.PI / 2); B.at(x, (za + zb) / 2); for (const y of [0.55, 1.1]) box('main', t, [-Math.abs(zb - za) / 2, y, -0.03, Math.abs(zb - za) / 2, y + 0.12, 0.03], WHITE, { _: U.fence }); }
      addBox(x, (z0 + z1) / 2, 0.2, Math.abs(z1 - z0) / 2, 0, 1.3);
    };
    fence(-61.8, 6.6, 92); fence(-61.8, -6.6, -110);
    const rnd = rng(616);
    for (let i = 0; i < 6; i++) for (const s of [1, -1]) { // 三角旗
      const x = -100 + i * 6, z = s * (s > 0 ? 11.5 : 11.5), t = frame(x, 0, z, Math.PI / 2); B.at(x, z); cyl('main', t, 0, 0, 0, 5.2, 0.045, 0.045, 5, C('#dfe2e6'), null, true);
      B.tri('main', t.p(0.05, 5.1, 0), t.p(1.3, 4.75, 0), t.p(0.05, 4.4, 0), WD, WD, WD, pick(rnd, [C('#FF6A1F'), C('#f2f3f5'), C('#16181c')])); B.tri('main', t.p(0.05, 4.4, 0), t.p(1.3, 4.75, 0), t.p(0.05, 5.1, 0), WD, WD, WD, C('#c9582a')); addCircle(x, z, 0.1, 5);
    }
    { const t = frame(-96, 0, -21, -0.45); B.at(-96, -21); for (const x of [-3.2, 3.2]) cyl('main', t, x, 0, 0, 3.2, 0.12, 0.12, 6, C('#50555c'), null, true); box('sign', t, [-4.2, 3.0, -0.12, 4.2, 6.2, 0.12], { pz: WHITE, _: C('#16181c') }, { pz: SU.bill, _: SW }); const c = t.p(0, 0, 0); addBox(c[0], c[2], 3.4, 0.2, -0.45, 6.2); }
    flat('decal', -80, -2.4, 1, 0, 14, 3, 0.05, DU.skid); flat('decal', -72, 2.3, 1, 0, 10, 3, 0.05, DU.skid);
    for (let i = 0; i < 5; i++) { const x = -94 + i * 1.3; B.at(x, 9.9); const t = frame(x, 0, 9.9); for (let k = 0; k < 3; k++) cyl('main', t, 0, 0, k * 0.25, k * 0.25 + 0.23, 0.33, 0.33, 9, (i + k) % 2 ? C('#d0342c') : C('#f2f3f5'), null, true); } addBox(-91.4, 9.9, 3.2, 0.35, 0, 0.75);
  }

  // ---- 稻田 ----
  { const rnd = rng(717);
    paddyArea(-126, -104, -68, -9, 3, 4, rnd);    // 大路北邊（往賽道那段）：改車廠出口的小路東邊
    paddyArea(-106, 9, -68, 31, 2, 1, rnd);       // 大路南邊、農路東邊（中間 z 31–58 是檳榔園）
    paddyArea(-106, 59, -68, 88, 2, 1, rnd);
    paddyArea(-194, 9, -118, 52, 3, 2, rnd);      // 農路圍起來那塊
    paddyArea(-244, 22, -196, 52, 2, 1, rnd);
    paddyArea(-244, 64, -118, 88, 5, 1, rnd);     // 農路南邊
    paddyArea(-386, -92, -352, -8, 2, 3, rnd);    // 村子西邊（大路北側）
    paddyArea(-386, 8, -352, 24, 2, 1, rnd);      // 西邊（大路南側）
    paddyArea(-296, 64, -250, 88, 2, 1, rnd);
    paddyArea(-386, 34, -352, 88, 2, 2, rnd);
    paddyArea(-282, -108, -232, -92, 2, 1, rnd);  // 車庫東北邊
    paddyArea(-386, -110, -344, -94, 2, 1, rnd);
    paddyArea(-176, -106, -130, -76, 2, 1, rnd);  // 改車廠後院北邊
    paddyArea(-512, -108, -398, -56, 5, 2, rnd);  // 車店後面
    paddyArea(-512, 24, -395, 88, 4, 2, rnd);     // 往快速道路那段的南邊
  }

  // ---- 樹、竹子、檳榔樹 ----
  { const rnd = rng(818);
    for (let x = -229.5; x <= -198; x += 6.5) for (let z = -100; z <= -30; z += 7) tree(x + (rnd() - 0.5) * 1.5, z + (rnd() - 0.5) * 1.5, 0.75 + rnd() * 0.2, rnd); // 果園
    for (let x = -236; x <= -126; x += 7 + rnd() * 3) palm(x, 63.5 + rnd() * 1.5, 7.5 + rnd() * 3, rnd);     // 農路南邊一排檳榔樹
    for (let z = 10; z <= 50; z += 6.5 + rnd() * 2) palm(-105.5 - rnd() * 1.5, z, 7 + rnd() * 3, rnd);        // 農路東邊
    for (let i = 0; i < 22; i++) palm(-90 + (i % 5) * 4.2 + rnd(), 36 + ((i / 5) | 0) * 4.5 + rnd(), 7 + rnd() * 4, rnd); // 檳榔園
    for (let i = 0; i < 16; i++) palm(-214 + (i % 4) * 4 + rnd(), 72 + ((i / 4) | 0) * 4 + rnd(), 7 + rnd() * 3, rnd);
    for (let x = -124; x <= -80; x += 9 + rnd() * 3) palm(x, -10.5 - rnd() * 1.5, 7 + rnd() * 3, rnd);         // 往賽道的路邊（改車廠出口的東邊開始）
    for (let x = -186; x <= -120; x += 10 + rnd() * 4) palm(x, 8.5 + rnd(), 6.5 + rnd() * 3, rnd);
    for (let z = -100; z <= 84; z += 9 + rnd() * 3) { if (Math.abs(z) < 14) continue; bamboo(-389 + rnd() * 2, z, rnd); } // 西邊竹林（大路穿過去）
    for (let x = -505; x <= -66; x += 6 + rnd() * 3) { if (x > -320 && x < -280) continue; tree(x, -112 + rnd() * 2, 1.2 + rnd() * 0.4, rnd); } // 北邊一排樹（車庫後面空著）
    for (let x = -505; x <= -66; x += 6 + rnd() * 3) tree(x, 91 + rnd() * 2, 1.2 + rnd() * 0.4, rnd);          // 南邊一排樹
    for (const [x, z] of [[-352, -8], [-351, 12], [-248.5, 30], [-228, 30], [-192, -20], [-196, 40], [-244, 60], [-192, -48], [-186, -62], [-194, -80]]) tree(x, z, 1 + rnd() * 0.3, rnd);
    for (const [x, z] of [[-396, -12], [-396, -30], [-395, -46], [-418, -52], [-426, -46], [-424, -34], [-406, 14], [-398, 18], [-476, 14], [-488, 16], [-500, 12], [-510, 18], [-509, -40], [-510, -22]]) tree(x, z, 1 + rnd() * 0.35, rnd); // 車店、往快速道路那段的空地
  }

  // ---- 電線桿（每條路一排）、路口反光鏡 ----
  poleLine([[-235, 5.2, 0, -1], [-212, 5.2, 0, -1], [-184, 5.2, 0, -1], [-156, 5.4, 0, -1], [-128, 5.6, 0, -1], [-100, 7.5, 0, -1], [-78, 7.5, 0, -1]]);
  poleLine([[-262, -4.8, 0, 1], [-290, -4.8, 0, 1], [-318, -4.8, 0, 1], [-338, -4.8, 0, 1]]);
  poleLine([[-245.8, -64, -1, 0], [-245.8, -44, -1, 0], [-245.8, -24, -1, 0]]);
  poleLine([[-338, -76.4, 0, 1], [-318, -76.4, 0, 1], [-280, -76.4, 0, 1], [-258, -76.4, 0, 1]]);
  poleLine([[-349.5, -52, 1, 0], [-349.5, -26, 1, 0], [-349.5, -4.5, 1, 0]]);
  poleLine([[-254, 22, 1, 0], [-254, 46, 1, 0], [-236, 62, 0, -1], [-208, 62, 0, -1], [-180, 62, 0, -1], [-152, 62, 0, -1], [-124, 62, 0, -1], [-108, 44, -1, 0], [-108, 20, -1, 0]]);
  poleLine([[-358, 5.3, 0, -1], [-386, 5.3, 0, -1], [-414, 5.3, 0, -1], [-442, 5.3, 0, -1], [-470, 5.3, 0, -1], [-500, 5.3, 0, -1]]); // 往快速道路那段（南側）
  mirrorPole(-243.6, -5.5, -250, 0); mirrorPole(-254.5, -76.2, -252, -70); mirrorPole(-341, -76, -343, -70); mirrorPole(-288.6, -76.3, -300, -72); mirrorPole(-295.6, -5.1, -300, 0);

  // ---- 地上的字：路口前的「慢」、廟口的斑馬線 ----
  const approach = (node, r) => { // 從路 r 開向 node：最後一段的方向、在 node 前 d 公尺的點
    const pts = walk(r, r.a === node ? r.b : r.a), n = pts.length;
    const at = (d) => { let rest = d; for (let i = n - 1; i > 0; i--) { const [bx, bz] = pts[i], [ax, az] = pts[i - 1], l = Math.hypot(bx - ax, bz - az); if (rest <= l) { const t = rest / l; return { x: bx + (ax - bx) * t, z: bz + (az - bz) * t, dx: (bx - ax) / l, dz: (bz - az) / l }; } rest -= l; } const [bx, bz] = pts[1], [ax, az] = pts[0], l = Math.hypot(bx - ax, bz - az); return { x: ax, z: az, dx: (bx - ax) / l, dz: (bz - az) / l }; };
    return at;
  };
  const NOSLOW = new Set(['DEN', 'DEX', 'SHX', 'HJ', 'HO', 'HI']); // 車店、改車廠的出入口不畫「慢」
  for (const k of Object.keys(NODES)) {
    if ((deg[k] || 0) < 3 || NOSLOW.has(k)) continue;
    for (const e of adjIn[k] || []) {
      const r = e.r; if (r.kind === 'strip' || r.kind === 'drive' || r.kind === 'link' || r.len < 30) continue;
      const at = approach(k, r), p = at(17), hw = (Array.isArray(r.w) ? 9 : r.w) / 2;
      flat('decal', p.x - p.dz * hw * 0.5, p.z + p.dx * hw * 0.5, p.dx, p.dz, 3.4, 1.6, 0.05, DU.slow);
      if (k === 'C') { const q = at(8.4); flat('decal', q.x, q.z, p.dx, p.dz, 3, hw * 2 - 0.6, 0.05, DU.zebra); }
    }
  }
  { const rnd = rng(919); for (let i = 0; i < 16; i++) { const s = roadSegs[(rnd() * roadSegs.length) | 0]; if (s.r.kind === 'drive') continue; const t = 0.2 + rnd() * 0.6; flat('decal', s.ax + (s.bx - s.ax) * t, s.az + (s.bz - s.az) * t, 1, 0, 0.9, 0.9, 0.05, DU.manhole); } }

  // ---- 路標：每個路口前面（右手邊），五個地方各往哪邊；一根柱子、牌子伸到路上面（台灣鄉下常見的懸臂式）----
  const guide = (x, z, dx, dz, rows) => { // (x, z)＝柱子（路邊）；(dx, dz)＝車子開過來的方向；牌子面向車子、往左邊（路中間）伸出去
    const ry = Math.atan2(-dx, -dz), T = frame(x, 0, z, ry), h = rows.length * 0.56 + 0.16, y0 = 2.9; B.at(x, z);
    cyl('main', T, 0, -0.25, 0, y0 + h + 0.1, 0.09, 0.08, 6, C('#9aa0a6'), null, true);
    box('main', T, [-2.2, y0 + h - 0.12, -0.2, 0.05, y0 + h - 0.04, -0.13], C('#8d9197')); box('main', T, [-2.2, y0 + 0.1, -0.2, 0.05, y0 + 0.18, -0.13], C('#8d9197')); // 兩根橫桿
    box('sign', T, [-2.75, y0, -0.12, 0.15, y0 + h, -0.02], C('#e9ecef'), { pz: SW, _: SW });
    rows.forEach((k, i) => face('sign', T, -2.68, 0.08, y0 + h - 0.08 - (i + 1) * 0.56 + 0.04, y0 + h - 0.08 - i * 0.56, -0.015, SU['g_' + k]));
    addCircle(x, z, 0.15, y0 + h);
  };
  const GUIDE = new Set(['C', 'X', 'W', 'G', 'E1', 'SH']);
  const DRIVE_SIGN = { G: [-308.6, -79.6], SHX: [-140.3, -10], DEX: [-501.4, -9] }; // 從車庫、改車廠、車店開出來：前面右手邊的路標
  const SIGN_AT = { 'X<C': 16, 'G<C': 14 }; // 這幾個路標往後挪（前面有電線桿、反光鏡）
  const dirOf = (fx, fz, hx, hz) => { const dot = fx * hx + fz * hz, cr = fx * hz - fz * hx; return dot > 0.72 ? 'U' : cr > 0 ? 'R' : 'L'; };
  const DESTS = ['track', 'shop', 'garage', 'dealer', 'highway'];
  for (const k of Object.keys(NODES)) {
    const own = DRIVE_SIGN[k]; if (!GUIDE.has(k) && !own) continue;
    for (const eIn of adjIn[k] || []) {
      const rIn = eIn.r; if (rIn.kind === 'strip' || rIn.kind === 'link') continue;
      if (rIn.kind === 'drive' ? !own : !GUIDE.has(k)) continue;
      const at = approach(k, rIn), d = SIGN_AT[k + '<' + eIn.from] ?? Math.min(11, rIn.len * 0.55), p = at(d), fin = at(0.01);
      const rows = [];
      for (const dest of DESTS) {
        const t = DEST_NODE[dest]; if (t === k) { rows.push(dest + '_U'); continue; }
        if (rIn.kind === 'drive' && (APSP[eIn.from][t] ?? 1e9) < 10) continue; // 剛從那裡開出來（車庫、改車廠、車店）：不用再指回去
        let best = null; for (const e of adjOut[k] || []) { const cost = e.r.len + (APSP[e.to][t] ?? 1e9); if (!best || cost < best.cost) best = { e, cost }; }
        if (!best || best.cost >= 1e9 || best.e.r === rIn) continue;
        const w = walk(best.e.r, k), hx = w[1][0] - w[0][0], hz = w[1][1] - w[0][1], hl = Math.hypot(hx, hz);
        rows.push(dest + '_' + dirOf(fin.dx, fin.dz, hx / hl, hz / hl));
      }
      if (!rows.length) continue;
      const off = (Array.isArray(rIn.w) ? 9 : rIn.w) / 2 + 0.6;
      if (rIn.kind === 'drive') guide(own[0], own[1], p.dx, p.dz, rows); else guide(p.x - p.dz * off, p.z + p.dx * off, p.dx, p.dz, rows);
    }
  }
  { // 慢、限速牌（村子入口）
    for (const [x, z, ry, u] of [[-190, 5.6, -Math.PI / 2, 'limit'], [-254.2, -26, Math.PI, 'slow']]) { const T = frame(x, 0, z, ry); B.at(x, z); cyl('main', T, 0, -0.06, 0, 2.6, 0.045, 0.045, 5, C('#9aa0a6'), null, true); signPoly(T, SU[u], 96, 96, u === 'limit' ? circ(48, 48, 44, 16) : [[4, 6], [92, 6], [48, 92]], 0.9 / 96, 0, 2.62, 0.02); addCircle(x, z, 0.08, 3); }
  }

  // ---- 往快速道路那段：南邊一排透天厝（小聚落）、路口前的「停」、左右轉的箭頭、快速道路的入口牌 ----
  row(-418, 7.5, -466, 7.5, 0, -1, 120, { shops: [null, 1, null, null, null, 0], vsigns: [7, null, 4, null, 6], gaps: true });
  {
    const oct = Array.from({ length: 8 }, (_, i) => { const a = ((i + 0.5) / 8) * TAU; return [48 + Math.cos(a) * 46, 48 + Math.sin(a) * 46]; });
    const T = frame(-513.6, 0, -6.2, Math.PI / 2); B.at(-513.6, -6.2); cyl('main', T, 0, -0.06, 0, 2.5, 0.05, 0.05, 5, C('#9aa0a6'), null, true); signPoly(T, S2.stop, 96, 96, oct, 0.8 / 96, 0, 2.55, 0.02, C('#9aa0a6'), 'sign2'); addCircle(-513.6, -6.2, 0.08, 3);
    flat('decal', -516.1, -2.25, -1, 0, 0.45, 4.2, 0.05, DU.start); // 停止線
    flat('decal', -508, -2.25, -1, 0, 5, 1.7, 0.05, DU.arrLR); flat('decal', -480, -2.25, -1, 0, 5, 1.7, 0.05, DU.arrU);
    const G = frame(-485, 0, 6.6, Math.PI / 2); B.at(-485, 0); // 懸臂的大牌子：路南邊一根柱子（本地 +x 朝北），牌子在往西那一線上面、對著開過來的車
    cyl('main', G, 0, -0.3, 0, 7.9, 0.22, 0.2, 8, C('#8d9197'), null, true);
    for (const y of [7.35, 6.0]) box('main', G, [-0.2, y, -0.42, 11.2, y + 0.18, -0.2], C('#8d9197'));
    box('sign2', G, [6.2, 5.2, -0.18, 10.6, 7.3, -0.06], C('#7d8288'), { pz: S2.entry, _: S2W });
    addCircle(-485, 6.3, 0.25, 8);
  }

  // ---- 阿財車行：玻璃展示間（6 台車在轉盤上，大路看得到）、旁邊的車棚（買車區：開進去停好就打開車店）、後面的庫存車、路邊的立牌、旗子 ----
  const DISPLAY = [[-463, -33, 0.45], [-450, -33, 0.8], [-437, -33, -0.45], [-463, -43, 0.6], [-450, -43, 0], [-437, -43, -0.6]].map(([x, z, a]) => ({ x, z, y: 0.06, heading: -Math.PI / 2 + a })); // 車頭大概朝大路（南），斜一點
  {
    const T = frame(-450, 0, -26, 0); B.at(-450, -38); // 本地＝世界 −(−450, −26)：展示間 x −22…22、z −24…0（玻璃正面在 z 0 朝南），高 8
    const wc = C('#f4f5f6'), red = C('#c8281e'), dk = C('#2a2c30'), frameC = C('#3a3d42');
    for (let x = -22; x < 21.9; x += 4.4) for (let z = -24; z < -0.1; z += 4.8) floor('main', T, x, z, x + 4.4, z + 4.8, 0.04, U.floorT); // 亮面地磚
    addPave(-450, -38, 22, 12, 0, null, 0, false);
    wall('main', T, [-22, 0, -24, 22, 8, -23.7], { nz: WHITE, pz: wc, _: wc }, { nz: U.panel, _: dotUV(U.conc) }); // 後牆
    wall('main', T, [-22, 0, -23.7, -21.7, 8, 0], { nx: WHITE, px: wc, _: wc }, { nx: U.panel, _: dotUV(U.conc) }); // 西牆
    wall('main', T, [21.7, 0, -23.7, 22, 8, -12], { px: WHITE, nx: wc, _: wc }, { px: U.panel, _: dotUV(U.conc) }); // 東牆（後半）
    box('main', T, [21.7, 5.2, -12, 22, 8, 0], { px: WHITE, _: wc }, { px: U.panel, _: dotUV(U.conc) });
    box('main', T, [-22, 5.2, -0.3, 22, 8, 0], { pz: WHITE, _: wc }, { pz: U.panel, _: dotUV(U.conc) }); // 正面上面的招牌牆
    box('main', T, [-22.2, 8, -24.2, 22.2, 8.35, 0.25], C('#e9eaec'), { _: dotUV(U.conc), ny: dotUV(U.conc) }); // 屋頂
    box('main', T, [-22.2, 4.95, 0, 22.2, 5.25, 1.1], C('#e9eaec'), { ny: dotUV(U.conc) }); // 玻璃上面的雨遮
    face('main', T, -22, 22, 5.25, 5.55, 0.02, WD, red); // 紅色的一條
    face('glow', T, -6.3, 6.3, 5.62, 7.98, 0.03, GU.dealer, [1.1, 1.1, 1.1]); // 燈箱：阿財車行、新車
    // 玻璃：正面整片（每 4.4 公尺一根框）、東牆前半；門在 x 11…14
    vquad('glass', T, [-22, -0.05], [22, -0.05], 0, 5.2, WD); vquad('glass', T, [21.85, -0.05], [21.85, -12], 0, 5.2, WD);
    for (let x = -22; x <= 22.01; x += 4.4) box('main', T, [x - 0.07, 0, -0.14, x + 0.07, 5.2, 0.04], frameC);
    box('main', T, [-22, 0, -0.14, 22, 0.12, 0.04], frameC); box('main', T, [-22, 5.08, -0.14, 22, 5.2, 0.04], frameC);
    for (const z of [-12, -8, -4]) box('main', T, [21.78, 0, z - 0.07, 21.96, 5.2, z + 0.07], frameC);
    box('main', T, [11.1, 0, -0.16, 11.25, 2.7, 0.06], frameC); box('main', T, [13.95, 0, -0.16, 14.1, 2.7, 0.06], frameC); box('main', T, [11.1, 2.62, -0.16, 14.1, 2.76, 0.06], frameC); // 自動門的框
    face('glow', T, 11.35, 13.85, 2.82, 3.3, 0.06, GU.welcome); // 歡迎光臨
    lbox(T, -22, -0.3, 22, 0.05, 5.2); lbox(T, 21.7, -12, 22, 0, 5.2);
    // 裡面：天花板（方形燈）、轉盤（6 個，LED 光圈）、櫃台、沙發、電視、盆栽、牆上的大海報
    ceil('glow', T, -21.7, -23.7, 21.7, -0.3, 5.2, GW, [0.86, 0.86, 0.84]); // 天花板：燈照得很亮（不吃光：不然只有半球光的地面色，暗暗的）
    for (let x = -18.7; x < 21; x += 6.2) for (let z = -21; z < -1; z += 5) ceil('glow', T, x - 0.6, z - 0.6, x + 0.6, z + 0.6, 5.19, GU.dlight, [1.1, 1.1, 1.1]);
    for (const d of DISPLAY) { const t = frame(d.x, 0, d.z); cyl('main', t, 0, 0, 0.04, 0.06, 2.9, 2.9, 28, C('#3a3d42'), null, true); cyl('glow', t, 0, 0, 0.04, 0.07, 3.02, 3.02, 28, [1.3, 1.3, 1.3], dotUV(GU.cool), false); }
    box('main', T, [-17.5, 0, -22.9, -12.5, 1.05, -21.9], { pz: red, _: wc }); box('main', T, [-17.5, 1.05, -23.0, -12.5, 1.12, -21.75], C('#dcdcd8')); lbox(T, -17.5, -23.0, -12.5, -21.75, 1.1); // 櫃台（靠後牆，後面留 0.7 公尺給業務站）
    face('sign2', T, -3.85, 3.85, 1.6, 4.9, -23.68, S2.ad1); // 後牆的大海報
    box('main', T, [-21.6, 0, -13, -20.3, 0.45, -7], C('#3a3d42')); box('main', T, [-21.6, 0.45, -13, -21.2, 0.95, -7], C('#3a3d42')); lbox(T, -21.6, -13, -20.3, -7, 1); // 沙發
    vquad('glow', T, [-21.68, -8.2], [-21.68, -11.8], 1.6, 3.6, GU.tv);
    const rnd = rng(1212);
    for (const [x, z] of [[-20.6, -22.6], [20.6, -22.6], [-20.6, -1.6], [9.6, -1.4], [20.6, -13.2]]) { const t = T.sub(x, 0, z); cyl('main', t, 0, 0, 0, 0.55, 0.32, 0.26, 8, C('#e8e6e0'), null, true); const q = t.p(0, 0, 0); blob('main', q[0], 1.25, q[2], 0.6, 0.8, 0.6, mul(pick(rnd, GREENS), 0.95), 0.25, 0, (rnd() * 1e6) | 0); addCircle(q[0], q[2], 0.35, 1.8); }
    // 車棚（買車區）：x −492…−476、z −25…−9，四根柱子、屋頂下面的燈、東邊和南邊的燈箱「買車區」
    const K = frame(-484, 0, -17, 0); B.at(-484, -17);
    for (const [x, z] of [[-7.2, -7.2], [-7.2, 7.2], [7.2, -7.2], [7.2, 7.2]]) { box('main', K, [x - 0.2, 0, z - 0.2, x + 0.2, 5.0, z + 0.2], wc); const c = K.p(x, 0, z); addBox(c[0], c[2], 0.22, 0.22, 0, 5); }
    box('main', K, [-8.5, 5.0, -8.5, 8.5, 6.2, 8.5], { py: C('#d9dadc'), _: red }, { ny: false, _: WD });
    ceil('glow', K, -8.5, -8.5, 8.5, 8.5, 5.0, GW, [0.8, 0.8, 0.78]);
    for (const [x, z] of [[-4, -4], [-4, 4], [4, -4], [4, 4], [0, 0]]) ceil('glow', K, x - 0.6, z - 0.6, x + 0.6, z + 0.6, 4.99, GU.dlight, [1.15, 1.15, 1.15]);
    vquad('glow', K, [8.52, 2.2], [8.52, -2.2], 5.05, 6.15, GU.buy, [1.1, 1.1, 1.1]); face('glow', K, -2.2, 2.2, 5.05, 6.15, 8.52, GU.buy, [1.1, 1.1, 1.1]); // 東邊（開過來的車看得到）、南邊（大路看得到）
    addPave(-484, -17, 8, 8, 0, C('#5d5f63'), 0.03); flat('decal', -484, -17, -1, 0, 10, 7, 0.05, DU.buyzone);
    // 前庭（x −502…−400、z −26…−4.5）、東邊入口 x −414…−406、西邊出口 x −501…−493；中間一排矮花台＋旗子
    addPave(-451, -15.25, 51, 10.75, 0, C('#dedfdb'));
    for (const [x0, x1] of [[-493, -414], [-406, -401]]) { B.at((x0 + x1) / 2, -5.3); box('main', frame(0, 0, 0), [x0, 0, -6, x1, 0.45, -4.7], C('#e8e7e2'), { _: dotUV(U.conc) }); box('main', frame(0, 0, 0), [x0 + 0.15, 0.45, -5.85, x1 - 0.15, 0.5, -4.85], C('#5d4a38')); for (let x = x0 + 1.2; x < x1 - 0.5; x += 2.2) shrub(x, -5.35, 0.75, rnd); addBox((x0 + x1) / 2, -5.35, (x1 - x0) / 2, 0.65, 0, 0.5); }
    for (let i = 0; i < 8; i++) { const x = -487 + i * 9.5, t = frame(x, 0, -5.35, 0); B.at(x, -5.35); cyl('main', t, 0, 0, 0.45, 4.6, 0.035, 0.035, 5, C('#dfe2e6'), null, true); vquad('sign2', t, [0.05, 0], [0.62, 0], 1.9, 4.5, S2['fl' + (i % 3)], WHITE, true); }
    for (const [x, z, a] of [[-410, -9, [0, -1]], [-440, -17, [-1, 0]], [-470, -17, [-1, 0]], [-497, -8, [0, 1]]]) flat('decal', x, z, a[0], a[1], 4.6, 1.3, 0.05, DU.arrU); // 地上的箭頭：進來、往西、出去
    { const t = frame(-415.2, 0, -6.4, 0); B.at(-415.2, -6.4); cyl('main', t, 0, 0, 0, 1.9, 0.04, 0.04, 5, C('#9aa0a6'), null, true); box('sign2', t, [-0.5, 1.4, -0.03, 0.5, 1.9, 0.02], C('#7d8288'), { pz: S2.in, _: S2W }); addCircle(-415.2, -6.4, 0.06, 2); } // 入口
    { const t = frame(-491.8, 0, -6.4, Math.PI); B.at(-491.8, -6.4); cyl('main', t, 0, 0, 0, 1.9, 0.04, 0.04, 5, C('#9aa0a6'), null, true); box('sign2', t, [-0.5, 1.4, -0.03, 0.5, 1.9, 0.02], C('#7d8288'), { pz: S2.out, _: S2W }); addCircle(-491.8, -6.4, 0.06, 2); } // 出口（對著開出來的車）
    { const t = frame(-403.5, 0, -7.2, 0); B.at(-403.5, -7.2); box('main', t, [-0.9, 0, -0.35, 0.9, 0.5, 0.35], C('#c9ccd0')); box('glow', t, [-0.8, 0.5, -0.25, 0.8, 7.3, 0.25], [1.05, 1.05, 1.05], { px: GU.pylon, nx: GU.pylon, _: dotUV(GU.white) }); box('main', t, [-0.85, 7.3, -0.3, 0.85, 7.45, 0.3], C('#c8281e')); addBox(-403.5, -7.2, 0.9, 0.35, 0, 7.5); } // 路邊的立牌（東西兩面）
    // 後面：庫存車（x −500…−474、z −48…−28）、客人停車
    addPave(-487, -38, 13, 10, 0, C('#b9bab6'));
    for (let i = 0; i < 5; i++) { const x = -497.5 + i * 5, t = carProp(x, 0, -34, -Math.PI / 2, pick(rnd, [C('#f2f3f5'), C('#1d1f23'), C('#9aa0a6'), C('#c8281e'), C('#2f6fd6'), C('#e8e4da')])); void t; addBox(x, -34, 1, 2.3, 0, 1.5); }
    for (let i = 0; i < 4; i++) { const x = -496.5 + i * 5.5, t = carProp(x, 0, -44.5, Math.PI / 2, pick(rnd, [C('#f2f3f5'), C('#3a3d42'), C('#b3261e'), C('#cfd3d8')])); void t; addBox(x, -44.5, 1, 2.3, 0, 1.5); }
    for (let i = 0; i < 6; i++) flat('decal', -499.8 + i * 5, -34, 0, 1, 5.2, 0.12, 0.05, DU.start); // 白線
    buildings.push({ kind: 'dealer', name: '阿財車行', x: -450, z: -38, hx: 22, hz: 12, rot: 0, h: 8.3, door: { x: -437.4, z: -25.2, ry: 0 } });
  }

  // ---- 山：近的綠色小山（碰不到）、遠的藍綠色大山（霧裡）----
  const hill = (cx, cz, R0, H, col, seed, trees = 0) => {
    B.at(cx, cz); const nr = 7, ns = 20, rnd = rng(seed);
    const pt = (i, j) => { const r = i / nr, a = (j / ns) * TAU + (i % 2) * (Math.PI / ns), k = 1 + (hash2(seed + i, j % ns) - 0.5) * 0.18 * r; const h = H * Math.pow(Math.max(0, 1 - r * r), 1.5) * (1 + (hash2(seed + 31, i * 7 + (j % ns)) - 0.5) * 0.12) - 0.6 * r; return [cx + Math.cos(a) * R0 * r * k, h, cz - Math.sin(a) * R0 * r * k]; };
    for (let i = 0; i < nr; i++) for (let j = 0; j < ns; j++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1), k1 = 0.9 + hash2(seed + 3, i * 40 + j) * 0.2, k2 = 0.9 + hash2(seed + 5, i * 40 + j) * 0.2;
      const cc = mix(col, C('#8fa860'), i / nr * 0.5);
      if (i === 0) { B.tri('main', a, b, c, WD, WD, WD, mul(cc, k1)); continue; }
      B.tri('main', a, b, c, WD, WD, WD, mul(cc, k1)); B.tri('main', a, c, d, WD, WD, WD, mul(cc, k2));
    }
    for (let t = 0; t < trees; t++) { const r = 0.15 + rnd() * 0.6, a = rnd() * TAU, x = cx + Math.cos(a) * R0 * r, z = cz - Math.sin(a) * R0 * r, h = H * Math.pow(1 - r * r, 1.5) - 0.8; cone(x, h, z, 1.6 + rnd() * 1.2, rnd); }
  };
  hill(-300, -212, 98, 34, C('#5c8a45'), 11, 24); hill(-165, -205, 88, 26, C('#648f4a'), 12, 18); hill(-420, -205, 80, 32, C('#56843f'), 13, 16); // 村子北邊
  hill(-430, 178, 76, 28, C('#618d48'), 15, 14); hill(-330, 184, 90, 28, C('#5f8b46'), 16, 18); hill(-190, 182, 90, 30, C('#648f4a'), 17, 16); // 南邊

  // ---- 快速道路：路面（兩邊各兩線＋路肩）、中間紐澤西護欄、兩邊鋼板護欄、路燈、門架指示牌、彎道箭頭牌、看板；碰撞（護欄）----
  B = HB; // 這一段畫到快速道路的網格（500 公尺一格）
  const HL = HWY_LEN, hp = hwyPath(25, 1.5), hsegs = [], GREY = C('#8d9197');
  const HP = (p, o, y) => [p.x + o * Math.sin(p.th), y, p.z + o * Math.cos(p.th)]; // 中線往右 o 公尺、高 y
  const NJ = [[0.305, 0], [0.29, 0.076], [0.12, 0.33], [0.08, 0.82]], NJC = C('#d2d0c9'), NJS = [0.8, 0.9, 1.0], CU = dotUV(U.conc), WB = subUV(U.wbeam, 0.3, 0, 0.7, 1), WBK = C('#9ba1a8');
  const inGap = (a, b, g) => b.s <= g + 1e-6 || a.s >= HL - g - 1e-6; // 這一段在路口的開口裡面
  for (let i = 0; i < hp.length - 1; i++) {
    const a = hp[i], b = hp[i + 1], va = a.s / 10, vb = b.s / 10; B.at((a.x + b.x) / 2, (a.z + b.z) / 2); hsegs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
    B.quad('hwy', HP(a, 0.3, 0.03), HP(a, HW.half, 0.03), HP(b, HW.half, 0.03), HP(b, 0.3, 0.03), [0, va, 1, vb], WHITE); // 右邊（往前開那一邊）
    B.quad('hwy', HP(a, -HW.half, 0.03), HP(a, -0.3, 0.03), HP(b, -0.3, 0.03), HP(b, -HW.half, 0.03), [1, va, 0, vb], WHITE); // 左邊（反方向）
    B.quad('hwy', HP(a, -0.3, 0.028), HP(a, 0.3, 0.028), HP(b, 0.3, 0.028), HP(b, -0.3, 0.028), [0, va, 0.02, vb], WHITE); // 護欄底下
    if (!inGap(a, b, HW.gapM)) { // 紐澤西護欄（斷面三段斜面＋上面）
      for (let k = 0; k < 3; k++) {
        const [o0, y0] = NJ[k], [o1, y1] = NJ[k + 1];
        B.quad('main', HP(a, o0, y0), HP(b, o0, y0), HP(b, o1, y1), HP(a, o1, y1), CU, mul(NJC, NJS[k]));
        B.quad('main', HP(b, -o0, y0), HP(a, -o0, y0), HP(a, -o1, y1), HP(b, -o1, y1), CU, mul(NJC, NJS[k]));
      }
      B.quad('main', HP(a, -0.08, 0.82), HP(a, 0.08, 0.82), HP(b, 0.08, 0.82), HP(b, -0.08, 0.82), CU, mul(NJC, 1.06));
    }
    for (const sd of [1, -1]) { // 鋼板護欄：前面（對著路）、後面；東邊路口那段沒有
      if (sd > 0 && inGap(a, b, HW.gapE)) continue;
      const o = sd * HW.rail, ob = sd * (HW.rail + 0.06);
      if (sd > 0) { B.quad('main', HP(b, o, 0.5), HP(a, o, 0.5), HP(a, o, 0.82), HP(b, o, 0.82), WB, WHITE); B.quad('main', HP(a, ob, 0.5), HP(b, ob, 0.5), HP(b, ob, 0.82), HP(a, ob, 0.82), WD, WBK); }
      else { B.quad('main', HP(a, o, 0.5), HP(b, o, 0.5), HP(b, o, 0.82), HP(a, o, 0.82), WB, WHITE); B.quad('main', HP(b, ob, 0.5), HP(a, ob, 0.5), HP(a, ob, 0.82), HP(b, ob, 0.82), WD, WBK); }
      for (let s = Math.ceil(a.s / 6) * 6; s < b.s; s += 6) { // 柱子（6 公尺一根，只畫對著路那一面）
        if (sd > 0 && (s < HW.gapE || s > HL - HW.gapE)) continue;
        const t = (s - a.s) / (b.s - a.s), p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, th: a.th + (b.th - a.th) * t }, fo = sd * 12.12, hs = 0.08 * sd;
        const f = [Math.cos(p.th), -Math.sin(p.th)], P0 = HP(p, fo, 0), q = (d, y) => [P0[0] + f[0] * d, y, P0[2] + f[1] * d];
        B.quad('main', q(hs, 0), q(-hs, 0), q(-hs, 0.52), q(hs, 0.52), WD, C('#7d838a'));
      }
    }
  }
  // 路口：兩邊車道＋中間開口鋪一塊沒有標線的柏油、東邊兩個圓角（接大路）；開口兩頭的防撞墊、護欄頭
  B.at(-530, 0);
  { const uv = (x, z) => [x / 4, z / 4], y = 0.04, x0 = HW.x - HW.half, x1 = HW.x + HW.half; B.tri('pave', [x0, y, 14], [x1, y, 14], [x1, y, -14], uv(x0, 14), uv(x1, 14), uv(x1, -14), ASPH); B.tri('pave', [x0, y, 14], [x1, y, -14], [x0, y, -14], uv(x0, 14), uv(x1, -14), uv(x0, -14), ASPH);
    for (const sz of [1, -1]) { // 圓角（半徑 12）：從路口角落 (−518.1, ±4.5) 扇形接到圓弧
      const cx = x1 + 12, cz = sz * 16.5, c0 = [x1, y, sz * 4.5];
      for (let k = 0; k < 8; k++) {
        const a0 = Math.PI + (k / 8) * (Math.PI / 2), a1 = Math.PI + ((k + 1) / 8) * (Math.PI / 2), p0 = [cx + Math.cos(a0) * 12, y, cz - sz * Math.sin(a0 - Math.PI) * 12], p1 = [cx + Math.cos(a1) * 12, y, cz - sz * Math.sin(a1 - Math.PI) * 12]; // 從 (x1, cz) 繞到 (cx, ±4.5)
        if (sz > 0) B.tri('pave', c0, p0, p1, uv(c0[0], c0[2]), uv(p0[0], p0[2]), uv(p1[0], p1[2]), ASPH); else B.tri('pave', c0, p1, p0, uv(c0[0], c0[2]), uv(p1[0], p1[2]), uv(p0[0], p0[2]), ASPH);
      }
      paved.push({ x: x1 + 4, z: sz * 8.5, hx: 4, hz: 4, rot: 0, main: true }); // main：算大路（不限 40）
    }
    for (const s of [HW.gapM, HL - HW.gapM]) { // 中間護欄頭的防撞墊（黃黑斜紋）
      const p = hwyAt(s), sg = s < HL / 2 ? -1 : 1, T = frame(p.x, 0, p.z, p.th); // 本地 +x 沿路
      box('main', T, sg < 0 ? [-2.4, 0, -0.42, 0, 0.9, 0.42] : [0, 0, -0.42, 2.4, 0.9, 0.42], WHITE, { _: U.crash, py: WD });
      const c = T.p(sg * 1.2, 0, 0); addBox(c[0], c[2], 1.2, 0.42, p.th, 0.9);
    }
    for (const s of [HW.gapE, HL - HW.gapE]) { const p = hwyAt(s), sg = s < HL / 2 ? -1 : 1, T = frame(p.x, 0, p.z, p.th); box('main', T, sg < 0 ? [-0.9, 0.35, 12, 0, 0.95, 12.35] : [0, 0.35, 12, 0.9, 0.95, 12.35], WHITE, { _: U.crash }); } // 護欄頭
  }
  // 碰撞：兩邊護欄（內面在 ±12）、中間護欄（±0.3）；直線併成一個長方塊，彎道 3 度（最多 20 公尺）一段
  { const hc3 = hwyPath(20, 3);
    const rb = (a, b, o, hz) => { const A = hwyOff(a, o), Bq = hwyOff(b, o), L2 = Math.hypot(Bq[0] - A[0], Bq[1] - A[1]); addBox((A[0] + Bq[0]) / 2, (A[1] + Bq[1]) / 2, L2 / 2 + 0.3, hz, Math.atan2(-(Bq[1] - A[1]), Bq[0] - A[0]), 0.9); };
    for (const [o, hz, g] of [[HW.rail + 0.6, 0.6, HW.gapE], [-(HW.rail + 0.6), 0.6, 0], [0, 0.3, HW.gapM]]) {
      let run = null; const flush = () => { if (run) rb(run.a, run.b, o, hz); run = null; };
      for (let i = 0; i < hc3.length - 1; i++) {
        const a = hc3[i], b = hc3[i + 1];
        if (g && inGap(a, b, g)) { flush(); continue; }
        if (run && run.b === a && a.k === 0 && b.k === 0 && Math.abs(run.a.th - b.th) < 1e-9) run.b = b; else { flush(); run = { a, b }; }
      }
      flush();
    }
  }
  // 路燈：中間護欄上，60 公尺一支，兩邊各一個燈頭（路口前後 25 公尺不要）；跟別的東西併在同一個網格（不多 draw call）
  for (let s = 30; s <= HL - 25; s += 60) {
    const p = hwyAt(s), T = frame(p.x, 0, p.z, p.th); B.at(p.x, p.z); // 本地 +x 沿路、+z 往右
    cyl('main', T, 0, 0, 0.82, 11.2, 0.13, 0.09, 6, GREY, null, true);
    for (const sd of [1, -1]) {
      tube('main', T.p(0, 10.75, 0), T.p(0, 11.2, sd * 2.35), 0.06, 0.05, 4, GREY);
      const H = T.sub(0, 11.2, sd * 2.65); box('main', H, [-0.5, -0.07, -0.22, 0.5, 0.08, 0.22], C('#6f7378'), { ny: false });
      ceil('glow', H, -0.42, -0.16, 0.42, 0.16, -0.075, dotUV(GU.amber), [1.2, 1.2, 1.2]);
    }
  }
  // 指示牌：hpose(s, 往右幾公尺, dir)：dir 1＝給往前開（s 變大）的車看、-1＝給反方向的車看；本地 +x＝開車的人的右手邊、+z＝朝開過來的車
  const hpose = (s, o, dir) => { const p = hwyAt(s), q = hwyOff(p, o); return frame(q[0], 0, q[1], p.th - (dir * Math.PI) / 2); };
  const gantry = (s, dir, reg) => { // 門架：路邊一根柱子（右手邊 14 公尺），桁架伸到車道上面，牌子在車道中間上面
    const T = hpose(s, dir * 14, dir); B.at(T.x, T.z);
    cyl('main', T, 0, 0, 0, 9.9, 0.3, 0.26, 8, GREY, null, true);
    for (const y of [9.35, 8.25]) box('main', T, [-13.3, y, -0.14, 0.2, y + 0.22, 0.14], GREY);
    for (let x = -12.6; x < 0; x += 1.8) box('main', T, [x - 0.05, 8.47, -0.05, x + 0.05, 9.35, 0.05], GREY);
    box('sign2', T, [-12.75, 5.0, 0.16, -5.15, 8.25, 0.28], C('#7d8288'), { pz: reg, _: S2W });
  };
  const rsign = (s, dir, o, reg, w, h, y0) => { // 路邊的牌子（兩根柱子）
    const T = hpose(s, dir * o, dir); B.at(T.x, T.z);
    for (const x of [-w * 0.3, w * 0.3]) cyl('main', T, x, -0.1, 0, y0 + h, 0.06, 0.06, 5, C('#9aa0a6'), null, true);
    box('sign2', T, [-w / 2, y0, -0.04, w / 2, y0 + h, 0.04], C('#7d8288'), { pz: reg, _: S2W });
  };
  gantry(HL - 300, 1, S2.gantryN); gantry(300, -1, S2.gantryS); // 出口前 300 公尺
  rsign(HL - 40, 1, 14, S2.exitR, 3.2, 1.6, 2.2); rsign(40, -1, 14, S2.exitL, 3.2, 1.6, 2.2); // 出口
  rsign(HL - 500, 1, 14, S2.dist, 3.2, 1.12, 2.2); rsign(500, -1, 14, S2.dist, 3.2, 1.12, 2.2);
  rsign(HL - 150, 1, 13.6, S2.warn, 2.4, 0.6, 2.0); rsign(150, -1, 13.6, S2.warn, 2.4, 0.6, 2.0);
  for (const [s, dir, reg] of [[900, 1, S2.post1], [1500, -1, S2.post1], [2600, 1, S2.post2], [3400, -1, S2.post2], [3900, 1, S2.post1], [2100, -1, S2.post2]]) rsign(s, dir, 13, reg, 1.2, 0.8, 1.6);
  for (const [s, dir] of [[120, 1], [HL - 120, -1], [2400, 1], [2400, -1]]) { // 速限 110
    const T = hpose(s, dir * 13, dir); B.at(T.x, T.z); cyl('main', T, 0, -0.06, 0, 2.6, 0.05, 0.05, 5, C('#9aa0a6'), null, true);
    signPoly(T, S2.lim110, 96, 96, circ(48, 48, 44, 16), 1.0 / 96, 0, 2.7, 0.02, C('#9aa0a6'), 'sign2');
  }
  for (const [s0, s1] of [[625, 625 + 350 * Math.PI], [HL - 625 - 350 * Math.PI, HL - 625]]) for (let s = s0 + 20; s < s1 - 10; s += 40) { // 半圓彎道的箭頭牌：外側給往前開的車（往左）、中間護欄上給反方向的車（往右）
    { const T = hpose(s, 12.95, 1); B.at(T.x, T.z); cyl('main', T, 0, -0.05, 0, 2.2, 0.035, 0.035, 4, C('#9aa0a6'), null, true); box('sign2', T, [-0.3, 1.25, -0.02, 0.3, 2.15, 0.02], C('#9aa0a6'), { pz: flipU(S2.chev), _: S2W }); }
    { const T = hpose(s, 0, -1); box('main', T, [-0.035, 0.82, -0.05, 0.035, 1.3, -0.02], C('#9aa0a6')); box('sign2', T, [-0.3, 1.3, -0.02, 0.3, 2.2, 0.02], C('#9aa0a6'), { pz: S2.chev, _: S2W }); }
  }
  for (const [s, dir, reg] of [[1300, 1, S2.ad1], [2750, -1, S2.ad2], [3900, 1, S2.ad3], [2200, -1, S2.ad1], [4350, -1, S2.ad3]]) { // 路邊的大看板
    const T = hpose(s, dir * 34, dir); B.at(T.x, T.z);
    for (const x of [-3, 3]) cyl('main', T, x, -0.3, 0, 7.3, 0.28, 0.24, 8, GREY, null, true);
    box('main', T, [-5.2, 7.0, -0.45, 5.2, 7.2, 0.2], GREY); box('sign2', T, [-5, 7.2, -0.18, 5, 11.5, 0.12], C('#7d8288'), { pz: reg, _: S2W });
  }
  // 兩邊的風景：樹、稻田、鐵皮工廠、檳榔園、幾間透天厝、山
  { const rnd = rng(4242);
    for (let s = 40; s < HL - 40; s += 24 + rnd() * 28) for (const sd of [1, -1]) {
      if (rnd() < 0.3) continue;
      const p = hwyAt(s), q = hwyOff(p, sd * (17 + rnd() * 30));
      if (q[0] > -560 && Math.abs(q[1]) < 150) continue; // 路口、村子那邊不要
      if (rnd() < 0.55) lowTree(q[0], q[1], 0.9 + rnd() * 0.5, rnd); else cone(q[0], 0, q[1], 1.3 + rnd() * 0.9, rnd);
    }
    paddyArea(-650, -580, -566, -150, 3, 8, rnd); paddyArea(-650, 150, -566, 580, 3, 8, rnd); // 快速道路裡面：東邊直線旁邊
    paddyArea(-1200, -440, -1112, 440, 3, 12, rnd); paddyArea(-1420, -380, -1322, 380, 3, 10, rnd); // 西邊：裡面、外面
    paddyArea(-1100, -900, -960, -800, 3, 2, rnd); paddyArea(-800, 800, -660, 900, 3, 2, rnd); // 半圓裡面
    paddyArea(-490, -560, -400, -300, 2, 4, rnd); paddyArea(-490, 300, -400, 560, 2, 4, rnd); // 東邊直線外面（村子北、南）
    const shed = (x, z, ry, w, d, h, wc, rc) => { // 鐵皮工廠：浪板牆、斜屋頂
      B.at(x, z); const T = frame(x, 0, z, ry); box('main', T, [-w / 2, 0, -d / 2, w / 2, h, d / 2], wc, { _: U.corr, py: false });
      for (const s of [1, -1]) { B.quad('main', T.p(-w / 2 - 0.3, h - 0.1, s * (d / 2 + 0.4)), T.p(w / 2 + 0.3, h - 0.1, s * (d / 2 + 0.4)), T.p(w / 2 + 0.3, h + d * 0.18, 0), T.p(-w / 2 - 0.3, h + d * 0.18, 0), U.corr, rc); }
      for (const s of [1, -1]) B.tri('main', T.p(s * w / 2, h, s > 0 ? d / 2 : -d / 2), T.p(s * w / 2, h, s > 0 ? -d / 2 : d / 2), T.p(s * w / 2, h + d * 0.18, 0), WD, WD, WD, wc);
      addBox(x, z, w / 2, d / 2, ry, h);
    };
    for (const [x, z, ry, w, d, h, wc, rc] of [[-610, -95, 0.05, 30, 18, 7, '#dfe3e8', '#3b78c4'], [-612, 70, -0.04, 24, 16, 6, '#c9d6e2', '#e8eaec'], [-1360, -520, 0.2, 36, 20, 8, '#e8eaec', '#3b78c4'], [-1350, 520, -0.15, 28, 18, 7, '#dfe3e8', '#4c9a6a'], [-470, -330, 0.1, 26, 16, 6.5, '#e6e2d8', '#3b78c4'], [-472, 360, -0.1, 30, 18, 7, '#dfe3e8', '#8fb7e0'], [-515, -905, 0.4, 32, 18, 7, '#e8eaec', '#3b78c4'], [-1180, 860, -0.3, 26, 16, 6, '#dfe3e8', '#e07a3a']]) shed(x, z, ry, w, d, h, C(wc), C(rc));
    for (let i = 0; i < 14; i++) palm(-612 + (i % 4) * 4.5 + rnd(), 598 + ((i / 4) | 0) * 4.5 + rnd(), 7 + rnd() * 3, rnd, false); // 檳榔園
    for (let i = 0; i < 10; i++) palm(-1372 + (i % 3) * 4.5 + rnd(), -80 + ((i / 3) | 0) * 4.5 + rnd(), 7 + rnd() * 3, rnd, false);
    row(-1352, -30, -1352, 30, 1, 0, 131, { gaps: true }); row(-455, 440, -455, 470, -1, 0, 132, { gaps: false }); // 快速道路旁邊的透天厝
  }
  hill(-880, -330, 200, 105, C('#5f8a50'), 21, 26); hill(-880, 210, 220, 120, C('#5c874c'), 22, 28); hill(-880, -700, 150, 70, C('#648f52'), 23, 14); hill(-880, 720, 140, 65, C('#628c50'), 24, 14); // 快速道路一圈裡面
  hill(-250, -430, 230, 125, C('#5f7f6e'), 25, 0); hill(-60, -430, 180, 78, C('#5f7f6e'), 26, 0); hill(-260, 430, 230, 110, C('#5f7f6e'), 27, 0); hill(-90, 390, 190, 80, C('#5f7f6e'), 28, 0); // 遠的
  hill(-880, -1300, 260, 140, C('#5f7f6e'), 29, 0); hill(-880, 1300, 260, 140, C('#5f7f6e'), 30, 0); hill(-1580, -420, 230, 130, C('#5f7f6e'), 31, 0); hill(-1580, 400, 250, 140, C('#5f7f6e'), 32, 0);
  B = VB;

  // ---- 地方：你的車庫、改車廠、車店、賽道、快速道路 ----
  const R2 = Math.PI / 2;
  const places = {
    garage: { // 車庫模組（白色大理石、鐵捲門）放在 lot；這裡只有門前的水泥地、花台、往南的路
      name: '你的車庫', pos: [LOT.x, LOT.z], lot: { ...LOT }, spawn: { ...LOT },
      door: { x: -300, z: -92.5, heading: -R2 },                                // 鐵捲門中間（本地 x = +5），朝外（南）
      apron: { x: -300, z: -83.85, hx: 8.35, hz: 7, rot: -R2 },                 // 門前（本地 x 5.3…22、z ±7）：停在這裡 HUD 給「開鐵捲門」
      inside: { x: -300, z: -101.35, hx: 8.85, hz: 12.7, rot: -R2 },            // 車庫裡面（本地 x −12.7…5、z ±12.7）
      zone: { x: -300, z: -92.85, hx: 17.35, hz: 12.7, rot: -R2 },              // apron＋inside
    },
    shop: { // 阿輝改車廠：前門（南）開進改車區、後門（北）出去
      name: '阿輝改車廠', pos: [-160, -35],
      bay: { x: -160, z: -35, hx: 2.5, hz: 6.5, rot: 0 },                        // 改車區的地板（中間那格，黃線裡面）：停在這裡打開改車廠
      park: { x: -160, z: -35, heading: R2 },                                    // 改車區中間，車頭朝後門
      exit: { x: -160, z: -50.5, heading: R2 }, spawn: { x: -160, z: -50.5, heading: R2 }, // 後門外面的院子：往前、右轉、東邊的小路回大路
      zone: { x: -160, z: -30, hx: 7, hz: 14, rot: 0 },                          // 改車區＋前門口
      view: { pos: [-164.6, 2.2, -27.6], look: [-159.2, 0.9, -36.5], fov: 52 },  // 改車的時候：前門裡面左邊，看改車區的車（左後方）、後門、輪胎架
    },
    dealer: { // 阿財車行：大路東邊開進前庭、經過展示間前面、開進車棚（買車區）、西邊出去
      name: '阿財車行', pos: [-450, -38],
      display: DISPLAY.map((d) => ({ ...d })),                                    // 6 台展示車（轉盤上，y＝轉盤的高度）
      bay: { x: -484, z: -17, hx: 5, hz: 3.5, rot: 0 },                          // 買車區（車棚下面）：停在這裡打開車店
      park: { x: -484, z: -17, heading: Math.PI },                               // 買車區中間，車頭朝西（出口）
      exit: { x: -497, z: -11, heading: -R2 }, spawn: { x: -497, z: -11, heading: -R2 }, // 新車出現的地方：出口車道上，朝大路
      zone: { x: -480, z: -17, hx: 14, hz: 8, rot: 0 },
      view: { pos: [-428.7, 3.7, -26.5], look: [-453, 0.2, -39.5], fov: 60 },    // 展示間裡面（東南角，高一點）看 6 台車
    },
    track: { name: '賽道', pos: [-7, 0], spawn: { x: -9, z: 0, heading: Math.PI }, zone: { x: -7, z: 0, hx: 7, hz: 6, rot: 0 }, start: { noseX: 0, z: 2.4, heading: 0 } },
    highway: { // 快速道路的路口（上快速道路的地方）；spawn：外側車道（往北）的慢車道上
      name: '快速道路', pos: [HW.x, 0],
      spawn: { x: HW.x + HW.lanes[1], z: -40, heading: R2 },
      zone: { x: -526, z: 0, hx: 20, hz: 16, rot: 0 },
    },
  };

  // ---- 邊界：村子北邊、南邊的山腳（西邊是快速道路的護欄、東邊是賽道外面的圍籬）----
  addBox(-286, -114.5, 232, 1.5, 0, 3); addBox(-286, 94, 232, 1.5, 0, 3);

  // ---- 路面種類：25 公尺一格，先把每格附近的路、快速道路、水泥地、稻田找好（開車每一格只查那幾個）----
  const SG = { x0: -1345, z0: -1005, c: 25, nx: 55, nz: 81 }, cells = new Array(SG.nx * SG.nz);
  const put = (x0, z0, x1, z1, k, o) => {
    const i0 = Math.max(0, Math.floor((x0 - SG.x0) / SG.c)), i1 = Math.min(SG.nx - 1, Math.floor((x1 - SG.x0) / SG.c));
    const j0 = Math.max(0, Math.floor((z0 - SG.z0) / SG.c)), j1 = Math.min(SG.nz - 1, Math.floor((z1 - SG.z0) / SG.c));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) (cells[j * SG.nx + i] ||= { h: [], r: [], p: [], d: [] })[k].push(o);
  };
  const ext = (p) => { const c = Math.abs(Math.cos(p.rot || 0)), s = Math.abs(Math.sin(p.rot || 0)), ex = p.hx * c + p.hz * s, ez = p.hx * s + p.hz * c; return [p.x - ex, p.z - ez, p.x + ex, p.z + ez]; };
  for (const s of hsegs) put(Math.min(s.ax, s.bx) - HW.half, Math.min(s.az, s.bz) - HW.half, Math.max(s.ax, s.bx) + HW.half, Math.max(s.az, s.bz) + HW.half, 'h', s);
  for (const s of roadSegs) { const m = s.hw + 0.4; put(Math.min(s.ax, s.bx) - m, Math.min(s.az, s.bz) - m, Math.max(s.ax, s.bx) + m, Math.max(s.az, s.bz) + m, 'r', s); }
  for (const p of paved) put(...ext(p), 'p', p);
  for (const p of paddies) put(...ext(p), 'd', p);
  surfaceAt = (x, z) => {
    if (x >= -60 && x <= 760 && Math.abs(z) <= 6.3) return 0; // 賽道
    const i = Math.floor((x - SG.x0) / SG.c), j = Math.floor((z - SG.z0) / SG.c);
    const c = i >= 0 && j >= 0 && i < SG.nx && j < SG.nz ? cells[j * SG.nx + i] : null; if (!c) return 1;
    for (const s of c.h) if (segDist(x, z, s.ax, s.az, s.bx, s.bz)[0] <= HW.half) return 4; // 快速道路（路肩也算）
    for (const s of c.r) if (segDist(x, z, s.ax, s.az, s.bx, s.bz)[0] <= s.hw + 0.4) return s.r.kind === 'main' ? 0 : 3;
    for (const p of c.p) if (inRect(p, x, z)) return p.main ? 0 : 3;
    for (const p of c.d) if (inRect(p, x, z)) return 2;
    return 1;
  };

  // ---- 組起來：村子（200 公尺一格）、快速道路（500 公尺一格，另外一個 group，名字前面加 hwy-）----
  const ORDER = { decal: 2, halo: 3, glass: 4 };
  const bv = VB.build(mats, ORDER), bh = HB.build(mats, ORDER, 'hwy-');
  const group = bv.group; group.name = 'village'; group.add(ground);
  bh.group.name = 'highway'; group.add(bh.group);
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wires.flat(), 3));
  const wl = new THREE.LineSegments(wg, mats.wire); wl.name = 'wires'; wl.matrixAutoUpdate = false; group.add(wl);
  group.updateMatrixWorld(true);
  const gTris = ground.geometry.attributes.position.count / 3;
  return {
    group, places, colliders, surfaceAt, route,
    roads: roads.filter((r) => !HWK.has(r.kind) && r.kind !== 'link').map((r) => ({ pts: r.pts, w: Array.isArray(r.w) ? Math.max(...r.w) : r.w, kind: r.kind }))
      .concat([{ pts: hc.map((p) => [p.x, p.z]), w: HW.half * 2, kind: 'highway' }]),
    bounds: { x0: -1320, x1: 12, z0: -1000, z1: 1000 }, areas: { paddy: paddies, pave: paved }, buildings,
    highway: { len: HL, center: hp.map((p) => [p.x, p.z]), out: hp.map((p) => hwyOff(p, HW.mid)), in: hp.map((p) => hwyOff(p, -HW.mid)).reverse(), half: HW.half, lanes: HW.lanes.slice() }, // 細的（直線 25 公尺、彎道 1.5 度一點）：以後的車流、AI 用
    info: { meshes: bv.meshes + bh.meshes + 2, tris: VB.tris + HB.tris + gTris, village: { meshes: bv.meshes, tris: VB.tris }, highway: { meshes: bh.meshes, tris: HB.tris }, ground: gTris },
    dispose() { group.removeFromParent(); group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); for (const m of Object.values(mats)) m.dispose(); for (const t of texs) t.dispose(); },
  };
}
return { buildVillage, stripColliders, villageFonts };
})();

// ---- drive.js ----
// ---- 開車：在小村莊裡自己開（街機式）：從你的車庫開去改車廠、開去賽道、上快速道路開到極速 ----
// Nick 2026-09-28：「汽車他只有轉彎跟啟動才會有聲浪要一直都有聲浪還有在路上開車速度可以到極速可以很快」
// 世界座標跟 village.js、賽道一樣：x 往東、y 往上、z 往南（朝東開時車子的右邊）；heading＝car.rotation.y（0 朝 +x、π/2 朝北 −z）
// 【API】
//   const drive = createDrive({
//     car: S,                 buildCar() 回傳的車（S.car 會移動、轉向；S.body 會側傾、點頭；前輪會轉、四輪會滾）
//     scene, camera,          影子、目的地光柱加在 scene；鏡頭由開車控制（'none' 模式就不動它）；camera.far 呼叫的人設（世界幾公里大：2000 左右）
//     perf: PERF[key],        { hp, kg, awd, drive, red, vmax, cda }（跟 race.src.js 一樣算加速；hp 可以換成裝了零件的 hpOf(key)）
//     world: V,               buildVillage() 回傳的（places、colliders、surfaceAt、route、roads、bounds、areas）
//     colliders: stripColliders(),   另外要擋的東西（賽道的護欄、看台、路燈⋯）；會變的用 addColliders／removeColliders
//     hudParent: stage,       HUD 放在這個元素裡（要 position: relative）；沒給就沒有 HUD（測試用）
//     onZone(name, inside, place)   開進／開出任何一個 places.<name>.zone（這一幀算完才叫；開出去要離開範圍 2.5 公尺才算，在邊上晃不會一直叫）
//     onShift(gear), onBump(strength)   升檔（接引擎聲 voice.shift()）、撞到東西（撞進去的速度 m/s，可以拿來震動）
//     eye: CABIN_VIEW[key],   駕駛座視角 { eye: [x, y, z], look: [x, y, z], fov }（車身座標）；沒給就用估的
//     maxKmh,                 限速（可省略：省略＝這台車的極速 perf.vmax）；草地 50、稻田 16 另外限
//     keyboard: true（方向鍵／WASD、空白鍵煞車、C 換視角、E 按 HUD 的大按鈕）；camButton: true（HUD 上的換視角鈕）
//   });
//   每一幀 drive.update(dt 秒)，再 renderer.render(scene, camera)
//   drive.telemetry() → { x, z, heading, v（m/s，倒車是負的）, kmh, rpm（轉速÷紅線 0–1.02，怠速 0.13）, gear（1–6，倒車 −1）,
//                         throttle（引擎真的出力 0–1，換檔那一下 0）, load（給引擎聲的負載：踩著油門 0.65–1、放開 0、停著怠速 0）,
//                         brake, steer（−1 左～1 右）, surface（0 大路、1 草地、2 稻田、3 小路、4 快速道路）, cap（現在的限速 km/h）, reversing,
//                         bumps, shifts, zone, dest, destDist（沿著路線還有幾公尺，每一幀跟著車子算）, auto（自動停車中）, paused }
//     引擎聲（sound.js）：voice.set({ rpm: t.rpm, throttle: t.load, speed: Math.abs(t.v) })；onShift 裡 voice.shift()
//   drive.setDestination(name | null)   world.places 裡的任何一個（garage 回車庫、shop 去改車廠、track 去賽道、dealer 去車店、highway 去快速道路⋯）：
//                          左上角「去賽道 230 m」＋箭頭、小地圖的橘色路線、那裡一根光柱；world.route 不認得的地方就指直線
//   drive.setAction({ label, onClick, icon } | null)   HUD 上一顆大按鈕（目的地下面，例如「開鐵捲門」）；按下去或鍵盤 E 叫 onClick(drive)；
//                          icon：'door' | 'key' | 'hand'（預設）；null＝收掉；每一幀叫也沒關係（字一樣就不動畫面）；drive.action＝現在的字（沒有＝null）
//   drive.addColliders(list, tag) / drive.removeColliders(tag)   會變的碰撞物（鐵捲門關著才擋、停著的車），格式跟 world.colliders 一樣；
//                          同一個 tag 可以加很多次，removeColliders(tag) 一次全部拿掉；回傳加了／拿掉幾個
//   drive.setCameraMode('chase' | 'eye' | 'none', view?)   追車／駕駛座／不管鏡頭；drive.cameraMode 是現在的
//   drive.teleport({ x, z, heading }, { intro })   把車放到那裡停好（不叫 onZone）；intro：鏡頭從車前面繞到後面（出門的時候）
//   drive.parkAt(pose, onDone)   自己開到 pose（{ x, z, heading }，或 { noseX, z, heading }＝車頭對齊 noseX）停好再叫 onDone
//   drive.pause() / resume()     暫停（不吃按鍵、藏 HUD／影子／光柱、車身擺正、前輪回正）／繼續
//   drive.release()              把車交給別人（賽道、車庫）：pause＋車子放回原點、不轉、輪子歸零（race.src.js 的 carSize 用世界座標量車頭，一定要）
//   drive.setInput({ throttle, brake, steer, handbrake } | null)   程式開車（測試）；null＝回到手指、鍵盤
//   drive.toast(text, ms)；drive.carInfo：{ nose, tail, len, halfW, wheelbase, vmax（km/h） }；drive.dispose()（拿掉 HUD、按鍵、影子、光柱，車子交回）
// 開法：油門、煞車（停住還按著煞車＝倒車，倒車時按油門＝煞車）；方向盤越慢轉越多；自排六速（轉速照 race.src.js 的齒比，極速剛好在紅線）
//   加速：照 race.src.js（馬力、扭力曲線、重量、四驅／後驅的起步抓地、傳動 0.88）；風阻 ×0.55（街機：1.2 公里左右的直線就到得了極速）
//   限速：柏油（大路、小路、快速道路）＝極速（或 maxKmh）；草地 50、稻田 16 km/h；快到限速油門自己收（定速），聲音照樣大聲（load）
//   自排：踩越多越晚升檔（全油門 0.98 紅線才升）、定速的時候轉速留在 0.45–0.7（聽得到）、放油門不升檔（引擎煞車聽得到）、大腳油門降檔
//   轉彎：方向盤打滿＝抓地的 1.35 倍（200 km/h 1.25 倍、320 km/h 0.95 倍：300 km/h 很穩）；超過抓地就推頭（輕微轉向不足），多的那份把速度吃掉
//         （抱著方向盤自己會慢下來，一直推頭超過 0.35 秒再多慢一點；250 公尺的彎 200 km/h 過得去）
//   撞到：每一步最多走 0.25 公尺（300 km/h 也不會穿過細柱子、護欄）；撞進去的速度吃掉（最多彈回 2 m/s），沿著牆的速度照摩擦掉一些，
//         車頭往沿著牆的方向轉一點（一次最多 20°，擦過去就貼著牆滑），正面撞照撞到的點轉一點點；頂住了還踩油門＋轉方向＝原地轉出來（不會卡住）
//   鏡頭：越快越往後拉、放低一點、視角變廣（有速度感，有上限）；200 km/h 以上、撞到東西會晃（減少動態效果的設定：晃小一點）

// 打包時全部接在同一個 script 裡：只露出 createDrive
const { createDrive } = (() => {
const TAU = Math.PI * 2, GEARS = [3.3, 2.2, 1.62, 1.28, 1.05, 0.86];
const AERO = 0.55, STEP = 0.25, HZ = 120; // 風阻（街機）、一步最多走幾公尺（碰撞）、物理每秒最少幾步
const torqueAt = (x) => 0.8 + 0.4 * x - 0.4 * x * x;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapA = (a) => { a = (a + Math.PI) % TAU; return a < 0 ? a + Math.PI : a - Math.PI; };
const toward = (a, b, r) => (a < b ? Math.min(b, a + r) : Math.max(b, a - r));
const ease = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const smooth01 = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const inRect = (r, x, z, m = 0) => { const dx = x - r.x, dz = z - r.z, c = Math.cos(r.rot || 0), s = Math.sin(r.rot || 0); return Math.abs(dx * c - dz * s) <= r.hx + m && Math.abs(dx * s + dz * c) <= r.hz + m; };
// 路面（world.surfaceAt）：0 大路、1 草地、2 稻田、3 村子的小路、4 快速道路；cap＝限速 m/s、drag＝多的阻力 m/s²、over＝比限速快的時候怎麼慢下來 [每 m/s, 最多 m/s²]
const SURF = [{ cap: Infinity, drag: 0 }, { cap: 50 / 3.6, drag: 1, over: [1.6, 6] }, { cap: 16 / 3.6, drag: 2.2, over: [3, 9] }, { cap: Infinity, drag: 0 }, { cap: Infinity, drag: 0 }];
const DEST = {
  garage: { label: '回車庫', icon: '家', bg: '#1d1f23', fg: '#FF6A1F' }, shop: { label: '去改車廠', icon: '改', bg: '#2F6FD6', fg: '#FFFFFF' },
  track: { label: '去賽道', icon: '賽', bg: '#FF6A1F', fg: '#1A0F07' }, dealer: { label: '去車店', icon: '車', bg: '#F2C230', fg: '#1A0F07' },
  highway: { label: '去快速道路', icon: '快', bg: '#1F8A4C', fg: '#FFFFFF' }, // 台灣國道、快速道路的綠牌子
};
const COND = '"Barlow Condensed", "Arial Narrow", sans-serif', SANS = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
const CSS = `
.dv{position:absolute;inset:0;pointer-events:none;color:#F2F3F5;font-family:${SANS};-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;z-index:3;overflow:hidden}
.dv[hidden],.dv [hidden]{display:none!important}
.dv>*{position:absolute}
.dv-chip{top:10px;left:10px;max-width:calc(100% - 158px);display:flex;align-items:center;gap:7px;height:40px;padding:0 13px 0 5px;border-radius:999px;background:rgba(14,15,18,0.62);white-space:nowrap;overflow:hidden}
.dv-chip i{flex:none;width:30px;height:30px;border-radius:50%;background:#FF6A1F;display:grid;place-items:center}
.dv-chip svg{width:18px;height:18px;fill:#1A0F07;transition:transform .12s linear}
.dv-chip b{font-size:17px;font-weight:700;letter-spacing:.02em}
.dv-chip small{font:600 17px/1 ${COND};color:#C6CAD1;letter-spacing:.03em}
.dv-chip.here i{background:#3DDC84}
.dv-act{top:58px;left:10px;max-width:calc(100% - 158px);min-height:54px;box-sizing:border-box;display:flex;align-items:center;gap:9px;margin:0;padding:0 18px 0 8px;border:0;border-radius:999px;background:#FF6A1F;color:#1A0F07;font:700 19px/1.15 ${SANS};letter-spacing:.03em;box-shadow:0 5px 0 #9E4213;pointer-events:auto;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.dv-chip[hidden]~.dv-act{top:10px}
.dv-act i{flex:none;width:38px;height:38px;border-radius:50%;background:#1A0F07;display:grid;place-items:center}
.dv-act svg{width:22px;height:22px;fill:none;stroke:#FF6A1F;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.dv-act span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dv-act kbd{display:none;flex:none;min-width:22px;height:22px;border-radius:6px;background:rgba(26,15,7,.2);font:700 14px/22px ${COND};text-align:center}
.dv-act.on{transform:translateY(4px);box-shadow:0 1px 0 #9E4213}
.dv-act:focus-visible{outline:3px solid #F2F3F5;outline-offset:3px}
.dv-act::after{content:"";position:absolute;inset:-5px;border-radius:inherit;border:3px solid #FF6A1F;opacity:0;animation:dv-ring 1.6s ease-out infinite;pointer-events:none}
@keyframes dv-ring{0%{opacity:.8;transform:scale(1)}100%{opacity:0;transform:scale(1.1,1.35)}}
@media (hover:hover) and (pointer:fine){.dv-act kbd{display:block}}
.dv-map{top:10px;right:10px;width:124px;height:124px;border-radius:18px;background:rgba(14,15,18,0.62);overflow:hidden}
.dv-map canvas{display:block;width:100%;height:100%}
.dv-cam{top:142px;right:10px;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:rgba(14,15,18,0.62);pointer-events:auto;cursor:pointer;touch-action:manipulation}
.dv-cam svg{width:24px;height:24px;fill:none;stroke:#F2F3F5;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.dv-cam[aria-pressed="true"]{background:#FF6A1F}
.dv-cam[aria-pressed="true"] svg{stroke:#1A0F07}
.dv-spd{bottom:14px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;min-width:58px;padding:6px 8px 5px;border-radius:14px;background:rgba(14,15,18,0.62);font-family:${COND};font-variant-numeric:tabular-nums;line-height:1}
.dv-spd b{font-size:28px;font-weight:700}
.dv-spd span{font-size:11px;font-weight:600;letter-spacing:.06em;color:#C6CAD1;margin-top:2px}
.dv-spd em{position:absolute;top:-9px;right:-9px;width:22px;height:22px;border-radius:50%;background:#F2F3F5;color:#0E0F12;font:700 15px/22px ${COND};font-style:normal;text-align:center}
.dv-spd em.r{background:#FF3B30;color:#fff}
.dv-steer{bottom:12px;left:10px;display:flex;gap:8px;pointer-events:auto;touch-action:none}
.dv-steer b,.dv-ped b{display:grid;place-items:center;touch-action:none;cursor:pointer}
.dv-steer b{width:70px;height:74px;border-radius:18px;background:rgba(14,15,18,0.62);box-shadow:0 4px 0 rgba(0,0,0,0.35)}
.dv-steer svg{width:30px;height:30px;fill:#F2F3F5}
.dv-steer b.on{background:#FF6A1F;transform:translateY(3px);box-shadow:none}
.dv-steer b.on svg{fill:#1A0F07}
.dv-ped{bottom:12px;right:10px;display:flex;align-items:flex-end;gap:10px;pointer-events:auto;touch-action:none}
.dv-ped b{font-weight:700;border-radius:18px;letter-spacing:.04em}
.dv-gas{width:74px;height:100px;background:#FF6A1F;color:#1A0F07;font-size:21px;box-shadow:0 5px 0 #9E4213}
.dv-brk{width:62px;height:70px;background:#2B2E35;color:#F2F3F5;font-size:18px;box-shadow:0 5px 0 #111216}
.dv-brk.rev{background:#F2F3F5;color:#0E0F12;box-shadow:0 5px 0 #8F949B}
.dv-ped b.on{transform:translateY(4px);box-shadow:none}
.dv-toast{top:34%;left:50%;width:max-content;max-width:calc(100% - 32px);box-sizing:border-box;padding:9px 20px;border-radius:22px;background:rgba(14,15,18,0.78);font-size:20px;font-weight:700;line-height:1.3;text-align:center;text-wrap:balance;opacity:0;transform:translate(-50%,-50%) scale(.92);transition:opacity .15s,transform .15s}
.dv-toast.show{opacity:1;transform:translate(-50%,-50%) scale(1)}
@media (prefers-reduced-motion:reduce){.dv-toast,.dv-chip svg{transition:none}.dv-act::after{animation:none}}
`;
const ICON = {
  up: '<svg viewBox="0 0 24 24"><path d="M12 2.5l7.5 9.5h-4.6v9.5H9.1V12H4.5z"/></svg>',
  L: '<svg viewBox="0 0 24 24"><path d="M3 12l11-8v16z"/><rect x="15.5" y="8.5" width="5" height="7" rx="1"/></svg>',
  R: '<svg viewBox="0 0 24 24"><path d="M21 12L10 4v16z"/><rect x="3.5" y="8.5" width="5" height="7" rx="1"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><path d="M4 16.5a8 8 0 0 1 16 0"/><circle cx="12" cy="16.5" r="2.3"/><path d="M12 14.2V9.5M7.2 17.8l-2.6 1.4M16.8 17.8l2.6 1.4"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V3.5h13l-2.5 4.5L18 12.5H7V21z"/></svg>',
  // HUD 大按鈕的圖：鐵捲門（往上拉）、鑰匙、手指點一下
  door: '<svg viewBox="0 0 24 24"><path d="M3.5 20.5v-16h17v16"/><path d="M3.5 8.5h17M3.5 12h17"/><path d="M12 20.5v-5.8M9.2 17.2l2.8-2.8 2.8 2.8"/></svg>',
  key: '<svg viewBox="0 0 24 24"><circle cx="8" cy="15.5" r="4.2"/><path d="M11 12.5l8.5-8.5M16.2 7.3l2.6 2.6M13.8 9.7l2 2"/></svg>',
  hand: '<svg viewBox="0 0 24 24"><path d="M10.2 21l-3.6-4.6a1.5 1.5 0 0 1 2.3-1.9l1.3 1.5V9.2a1.6 1.6 0 0 1 3.2 0v4.6l3.8.8a1.9 1.9 0 0 1 1.5 2.1l-.6 4.3"/><path d="M7.6 6.6a5 5 0 0 1 8.3 0"/></svg>',
};

// ---- 碰撞物的格子（8 公尺一格）：加、照 tag 拿掉、找附近的（之後的交通、警察、走路也用得到）----
// 碰撞物：{ t: 'box', x, z, hx, hz, rot, h } | { t: 'circle', x, z, r, h }（xz 平面；h＝高度，鏡頭避開房子用）
function colGrid() {
  const CELL = 8, grid = new Map(), tags = new Map(), found = []; let stamp = 0;
  const key = (gx, gz) => gx * 65536 + gz;
  function add(list, tag = null) {
    let n = 0;
    for (const c of list || []) {
      if (!c || !isFinite(c.x) || !isFinite(c.z) || !(c.t === 'box' ? c.hx > 0 && c.hz > 0 : c.r > 0)) continue;
      const q = c.t === 'box' ? { ...c, u: [Math.cos(c.rot || 0), -Math.sin(c.rot || 0)], w: [Math.sin(c.rot || 0), Math.cos(c.rot || 0)] } : { ...c, t: 'circle' };
      const ex = q.t === 'box' ? Math.abs(q.u[0]) * q.hx + Math.abs(q.w[0]) * q.hz : q.r, ez = q.t === 'box' ? Math.abs(q.u[1]) * q.hx + Math.abs(q.w[1]) * q.hz : q.r;
      q.tag = tag; q.cells = []; q._s = 0;
      for (let gx = Math.floor((q.x - ex) / CELL); gx <= Math.floor((q.x + ex) / CELL); gx++) for (let gz = Math.floor((q.z - ez) / CELL); gz <= Math.floor((q.z + ez) / CELL); gz++) {
        if (q.t === 'box') { // 斜的長方形（斜的護欄）只放真的碰到的格子
          const dx = (gx + 0.5) * CELL - q.x, dz = (gz + 0.5) * CELL - q.z, hc = CELL / 2;
          if (Math.abs(dx * q.u[0] + dz * q.u[1]) > q.hx + hc * (Math.abs(q.u[0]) + Math.abs(q.u[1])) || Math.abs(dx * q.w[0] + dz * q.w[1]) > q.hz + hc * (Math.abs(q.w[0]) + Math.abs(q.w[1]))) continue;
        }
        const k = key(gx, gz); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(q); q.cells.push(k);
      }
      if (tag != null) { let t = tags.get(tag); if (!t) tags.set(tag, (t = [])); t.push(q); }
      n++;
    }
    return n;
  }
  function remove(tag) {
    const t = tag != null && tags.get(tag); if (!t) return 0;
    for (const q of t) for (const k of q.cells) { const a = grid.get(k); if (!a) continue; const i = a.indexOf(q); if (i >= 0) a.splice(i, 1); if (!a.length) grid.delete(k); }
    tags.delete(tag); return t.length;
  }
  const near = (x0, z0, x1, z1, test) => { // 這個範圍裡的碰撞物（放在 found，下一次呼叫會蓋掉）
    stamp++; found.length = 0;
    for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) for (let gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++) {
      const a = grid.get(key(gx, gz)); if (!a) continue;
      for (const c of a) if (c._s !== stamp) { c._s = stamp; if (!test || test(c)) found.push(c); }
    }
    return found;
  };
  return { add, remove, near, clear: () => { for (const t of [...tags.keys()]) remove(t); } };
}

function createDrive(o) {
  const S = o.car, car = S.car, body = S.body, W = S.spec.wheels, P = o.perf || { hp: 250, kg: 1300, red: 7500, vmax: 240, cda: 0.65 };
  const world = o.world || {}, places = world.places || {}, scene = o.scene, camera = o.camera;
  const vmx = P.vmax / 3.6, vtop = Math.min(vmx, +o.maxKmh > 0 ? o.maxKmh / 3.6 : Infinity), hasDoc = typeof document !== 'undefined' && !!o.hudParent;
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; // 減少動態效果：鏡頭晃小一點

  // 車子的大小（車身座標）：先放回原點量（Box3 量的是世界座標），量完放回去
  const info = (() => {
    const p = car.position.clone(), q = car.quaternion.clone(), bx = body.position.x, bz = body.position.z, br = body.rotation.clone();
    car.position.set(0, 0, 0); car.quaternion.identity(); body.position.x = 0; body.position.z = 0; body.rotation.set(0, 0, 0); car.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(body);
    car.position.copy(p); car.quaternion.copy(q); body.position.x = bx; body.position.z = bz; body.rotation.copy(br); car.updateMatrixWorld(true);
    return { nose: b.max.x, tail: b.min.x, len: b.max.x - b.min.x, halfW: Math.max(b.max.z, -b.min.z), wheelbase: W.xf - W.xr, xr: W.xr };
  })();
  const HL = info.len / 2 - 0.04, HW = info.halfW - 0.04, CX = (info.nose + info.tail) / 2, L = info.wheelbase;
  const hubs = S.wheels.map((w) => w.parent), hub0 = hubs.map((h) => h.rotation.y), RF = W.RF ?? W.R, RR = W.RR ?? W.R;
  const base = { bx: body.position.x, bz: body.position.z };
  // 引擎、齒比、起步抓地：跟 race.src.js 的 racer() 一樣；尾速長一點點（六檔紅線＝極速 ×1.012）：跑極速的時候轉速 0.99，不會一直撞斷油
  const m = P.kg + 75, wr = (P.red * TAU) / 60, vrl = vmx * 1.012;
  const fd = (wr * RR) / (GEARS[5] * vrl), Tpk = (P.hp * 745.7) / (wr * 0.95 * torqueAt(0.95)), tract = 1.35 * m * 9.81 * (P.awd ? 0.9 : P.drive ?? 0.74);
  const xOf = (u, g) => (Math.abs(u) * GEARS[g]) / (GEARS[5] * vrl), kGeo = Math.tan(0.6) / L; // 轉速÷紅線；方向盤打死的曲率

  const st = { x: car.position.x, z: car.position.z, th: car.rotation.y, v: 0, steer: 0, thr: 0, brk: 0, hb: 0, thrEff: 0, load: 0, cutLoad: 0, gear: 0, rev: false, hold: 0, cut: 0, rpm: 0.13, spin: 0,
    surf: 0, cap: vtop, bumps: 0, shifts: 0, touch: 0, blocked: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0, alat: 0, along: 0, kap: 0, scrub: 0, push: 0, jit: 0, jitT: 0, hitW: 0, hitT: -9 };
  const human = { thr: 0, brk: 0, steer: 0, kb: {} };
  let forced = null, paused = false, auto = null, alive = true, dest = null, mode = 'chase', view = null, intro = null, now = 0, action = null;
  const zoneIn = {}, events = []; let zoneNow = null, routeData = null, routeT = 0, routeS = 0;

  // ---- 碰撞：車子＝有方向的長方形（OBB），碰到長方形（SAT）、圓（最近點）就推出去 ----
  const cw = colGrid(); cw.add(world.colliders); cw.add(o.colliders);
  const hitBox = (cx, cz, f, r, c) => { // 回傳 [推 x, 推 z, 法線 x, 法線 z, 碰到的點 x, z（相對車子中心）]（把車推出去）或 null
    const dx = cx - c.x, dz = cz - c.z; let best = Infinity, nx = 0, nz = 0, ax = 0, k = 0;
    for (const a of [f, r, c.u, c.w]) {
      const d = dx * a[0] + dz * a[1];
      const o1 = HL * Math.abs(f[0] * a[0] + f[1] * a[1]) + HW * Math.abs(r[0] * a[0] + r[1] * a[1]) + c.hx * Math.abs(c.u[0] * a[0] + c.u[1] * a[1]) + c.hz * Math.abs(c.w[0] * a[0] + c.w[1] * a[1]) - Math.abs(d);
      if (o1 <= 0) return null;
      if (o1 < best) { best = o1; const s = d < 0 ? -1 : 1; nx = a[0] * s; nz = a[1] * s; ax = k; }
      k++;
    }
    // 碰到的點（相對車子中心）：軸是碰撞物的＝車子最深的角；軸是車子的＝碰撞物最深的角（夾在車子裡面）
    let px = 0, pz = 0, n = 0;
    if (ax >= 2) { let lo = Infinity; for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const qx = f[0] * sx * HL + r[0] * sz * HW, qz = f[1] * sx * HL + r[1] * sz * HW, d = qx * nx + qz * nz; if (d < lo - 0.03) { lo = d; px = qx; pz = qz; n = 1; } else if (d < lo + 0.03) { px += qx; pz += qz; n++; } } }
    else {
      let hi = -Infinity;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const qx = c.x - cx + c.u[0] * sx * c.hx + c.w[0] * sz * c.hz, qz = c.z - cz + c.u[1] * sx * c.hx + c.w[1] * sz * c.hz, d = qx * nx + qz * nz; if (d > hi + 0.03) { hi = d; px = qx; pz = qz; n = 1; } else if (d > hi - 0.03) { px += qx; pz += qz; n++; } }
      px /= n; pz /= n; n = 1; const lx = clamp(px * f[0] + pz * f[1], -HL, HL), lz = clamp(px * r[0] + pz * r[1], -HW, HW); px = f[0] * lx + r[0] * lz; pz = f[1] * lx + r[1] * lz;
    }
    return [nx * best, nz * best, nx, nz, px / n, pz / n];
  };
  const hitCircle = (cx, cz, f, r, c) => {
    const dx = c.x - cx, dz = c.z - cz, lx = dx * f[0] + dz * f[1], lz = dx * r[0] + dz * r[1];
    const ex = lx - clamp(lx, -HL, HL), ez = lz - clamp(lz, -HW, HW), d2 = ex * ex + ez * ez;
    if (d2 >= c.r * c.r) return null;
    let nx, nz, pen;
    if (d2 > 1e-10) { const d = Math.sqrt(d2); nx = ex / d; nz = ez / d; pen = c.r - d; }
    // 圓心跑進車子裡了（細柱子、很快）：從車頭（倒車＝車尾）那面進來的就從那面推回去，不然找最近的一面
    else if (HL - Math.abs(lx) < HW - Math.abs(lz) || (Math.abs(st.v) > 2 && lx * st.v > 0 && Math.abs(lx) > HL * 0.5)) { nx = Math.sign(lx) || 1; nz = 0; pen = HL - Math.abs(lx) + c.r; }
    else { nx = 0; nz = Math.sign(lz) || 1; pen = HW - Math.abs(lz) + c.r; }
    const wx = f[0] * nx + r[0] * nz, wz = f[1] * nx + r[1] * nz, qx = clamp(lx, -HL, HL), qz = clamp(lz, -HW, HW); // 車子往圓的方向；車要往反方向推
    return [-wx * pen, -wz * pen, -wx, -wz, f[0] * qx + r[0] * qz, f[1] * qx + r[1] * qz];
  };
  // 撞進去（w＝撞進去的速度 m/s）：法向吃掉、彈回一點；沿著牆的速度照摩擦（0.35）掉一些；車頭往沿著牆的方向轉一點
  function impact(w, fn, nx, nz, px, pz, f) {
    const e = Math.min(0.25 * w, 2), ft2 = Math.max(0, 1 - fn * fn), vt = Math.abs(st.v) * Math.sqrt(ft2), mu = vt > 1e-3 ? Math.min(1, (0.35 * (w + e)) / vt) : 1;
    st.v = st.v * ft2 * (1 - mu) + e * fn;
    const tx = -nz, tz = nx, ft = f[0] * tx + f[1] * tz;
    // 擦到：轉成沿著牆；正面：照撞到的點（力矩），慢慢頂著（10 km/h 以下）就不轉（方向盤轉得出來）；一次最多轉 20°（不會打轉）
    const dth = Math.abs(ft) > 0.2 ? wrapA(Math.atan2(-tz * Math.sign(ft), tx * Math.sign(ft)) - st.th) : clamp(pz * nx - px * nz, -1, 1) * 0.2 * clamp((w - 0.3) / 2, 0, 1);
    st.th = wrapA(st.th + Math.sign(dth) * Math.min(Math.abs(dth), 0.05 + 0.01 * w, 0.35));
    // 車身抖一下（撞到那邊）、記下最大的一下（這一幀算完才叫 onBump）
    const nr = -f[1] * nx + f[0] * nz; // 法線在車子右邊的分量（r＝(−f.z, f.x)）
    st.pitchV = clamp(st.pitchV + fn * w * 0.012, -0.9, 0.9); st.rollV = clamp(st.rollV - nr * w * 0.012, -0.9, 0.9);
    st.hitW = Math.max(st.hitW, w);
  }
  function collide() {
    let hit = 0;
    for (let it = 0; it < 3; it++) {
      const f = [Math.cos(st.th), -Math.sin(st.th)], r = [Math.sin(st.th), Math.cos(st.th)];
      let cx = st.x + f[0] * CX, cz = st.z + f[1] * CX, moved = false;
      const list = cw.near(cx - 3, cz - 3, cx + 3, cz + 3).slice();
      for (const c of list) {
        const p = c.t === 'box' ? hitBox(cx, cz, f, r, c) : hitCircle(cx, cz, f, r, c);
        if (!p) continue;
        st.x += p[0]; st.z += p[1]; cx += p[0]; cz += p[1]; moved = true; hit++; st.touch = 0.2;
        const fn = f[0] * p[2] + f[1] * p[3], w = -st.v * fn;
        if (w > 0.05) impact(w, fn, p[2], p[3], p[4], p[5], f);
        else { const pen = Math.hypot(p[0], p[1]), cr = p[5] * p[2] - p[4] * p[3]; st.th = wrapA(st.th + clamp((2 * cr * pen) / (p[4] * p[4] + p[5] * p[5] + 0.5), -0.04, 0.04)); } // 慢慢頂著：照碰到的點轉一點（滑開）
      }
      if (!moved) break;
    }
    return hit;
  }
  // 鏡頭到車子中間有沒有被房子擋住：回傳 0–1（1＝沒擋到）
  const tall = (c) => (c.h ?? 9) >= 2.4 && (c.t === 'box' || c.r >= 0.6);
  function rayHit(x0, z0, x1, z1) {
    let best = 1; const dx = x1 - x0, dz = z1 - z0;
    for (const c of cw.near(Math.min(x0, x1) - 1, Math.min(z0, z1) - 1, Math.max(x0, x1) + 1, Math.max(z0, z1) + 1, tall)) {
      let t;
      if (c.t === 'box') {
        const ox = x0 - c.x, oz = z0 - c.z, pp = [ox * c.u[0] + oz * c.u[1], ox * c.w[0] + oz * c.w[1]], dd = [dx * c.u[0] + dz * c.u[1], dx * c.w[0] + dz * c.w[1]], ee = [c.hx, c.hz];
        let t0 = 0, t1 = 1, ok = true;
        for (let k = 0; k < 2 && ok; k++) {
          if (Math.abs(dd[k]) < 1e-9) { if (Math.abs(pp[k]) > ee[k]) ok = false; continue; }
          let ta = (-ee[k] - pp[k]) / dd[k], tb = (ee[k] - pp[k]) / dd[k]; if (ta > tb) [ta, tb] = [tb, ta];
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) ok = false;
        }
        if (!ok) continue; t = t0;
      } else {
        const ox = x0 - c.x, oz = z0 - c.z, A = dx * dx + dz * dz, B2 = ox * dx + oz * dz, C2 = ox * ox + oz * oz - c.r * c.r, disc = B2 * B2 - A * C2;
        if (disc < 0 || A < 1e-9) continue; t = (-B2 - Math.sqrt(disc)) / A; if (t < 0) { if (C2 < 0) t = 0; else continue; } if (t > 1) continue;
      }
      if (t < best) best = t;
    }
    return best;
  }

  // ---- 物理（每步 h 秒）----
  function physics(h, inp) {
    // 停住了還按著煞車＝換倒車；倒車停住了按油門＝換前進
    const go0 = st.rev ? inp.brk : inp.thr, stop0 = st.rev ? inp.thr : inp.brk, u0 = st.v * (st.rev ? -1 : 1);
    if (stop0 > 0.5 && go0 < 0.05 && u0 < 0.3 && !inp.hb) { st.hold += h; if (st.hold > 0.25) { st.rev = !st.rev; st.hold = 0; st.gear = 0; st.thr = st.brk = 0; } } else st.hold = 0;
    // 方向盤：放開回正快、轉過去慢一點，越快越慢（300 km/h 點一下只換一點點車道）；油門慢慢踩下去
    const vab0 = Math.abs(st.v), back = Math.abs(inp.steer) < Math.abs(st.steer) || inp.steer * st.steer < 0;
    st.steer = toward(st.steer, inp.steer, h * (back ? 6 : 4 - 2 * Math.min(1, vab0 / 70)));
    st.thr = toward(st.thr, inp.thr, h * (inp.thr > st.thr ? 3.2 : 8)); st.brk = toward(st.brk, inp.brk, h * (inp.brk > st.brk ? 7 : 10)); st.hb = inp.hb || 0;
    const sg = st.rev ? -1 : 1, go = st.rev ? st.brk : st.thr, stop = Math.max(st.rev ? st.thr : st.brk, st.hb), u = st.v * sg, v0 = st.v;
    const sf = SURF[st.surf] || SURF[0], capS = st.rev ? 4.5 : Math.min(vtop, sf.cap), soft = !st.rev && sf.cap < vtop; st.cap = capS;
    // 轉彎：方向盤→想要的曲率（低速＝打死 tan 0.6，快的時候＝打滿要側向 aF）；快到抓地 aG 就推頭：實際轉得少一點、多的那份（scrub）把速度吃掉
    // aF：100 km/h 以下＝抓地 ×1.35、200 km/h ×1.25、320 km/h ×0.95（很穩）；推頭吃掉速度的比例 kS：100 km/h 以下 1.3（村子的彎抱著方向盤自己慢下來）、
    //     200 km/h 以上 0.8（快速道路按住鍵過彎不會掉太多速）
    const v2 = Math.max(vab0 * vab0, 1e-4), aG = 13 + 2 * clamp((vab0 - 20) / 50, 0, 1), aF = aG * (1.35 - 0.1 * clamp((vab0 - 28) / 28, 0, 1) - 0.3 * clamp((vab0 - 56) / 33, 0, 1));
    // 一直按著推頭（過彎太快、抱著方向盤）超過 0.35 秒：像腳鬆開油門，慢得更多（點一點方向過得去的彎不會掉速）
    const kc = st.steer * Math.min(kGeo, aF / v2), ac = Math.abs(kc) * v2, aa = ac / Math.pow(1 + Math.pow(ac / aG, 6), 1 / 6);
    st.push = ac - aa > 1.2 ? Math.min(2, st.push + h) : Math.max(0, st.push - 2 * h);
    const pk = clamp((st.push - 0.35) / 0.8, 0, 1), kS = 1.3 - 0.5 * clamp((vab0 - 28) / 28, 0, 1) + 0.8 * pk;
    st.kap = ac > 1e-9 ? kc * (aa / ac) : kc; st.scrub = (ac - aa) * kS;
    // 引擎：快到限速油門自己收（定速）；推頭的時候也收（像循跡控制）；load＝給引擎聲的（踩著就大聲）
    const gov = clamp((capS + (capS >= vmx ? 0.3 : 0) - u) / 0.5, 0, 1), lim = gov * (1 - Math.min(0.95, st.scrub / 7 + 0.7 * pk)); // 定速在限速上（極速多 0.3 m/s：錶上看得到 250）
    st.thrEff = go * lim;
    let a = 0;
    if (st.rev) a = 2.8 * st.thrEff;
    else if (st.cut <= 0) { const x = xOf(u, st.gear); if (x < 1) a = Math.min(tract, (st.thrEff * Tpk * torqueAt(clamp(x, st.gear === 0 ? 0.6 : 0.2, 1)) * GEARS[st.gear] * fd * 0.88) / RR) / m; } // 撞到紅線斷油
    const ov = u - capS - 0.5, over = ov > 0 ? (soft ? Math.min(sf.over[1], ov * sf.over[0]) : Math.min(8, ov * 2.5)) : 0; // 比限速快（開進草地、限速變低）：慢下來
    const res = stop * (9.5 + 2.5 * Math.min(1, (u * u) / 4900)) + (go < 0.05 ? (st.rev ? 1.2 : 1.4) : 0) + sf.drag + 0.147 + (AERO * 0.6 * P.cda * u * u) / m + over + (st.rev ? 0 : Math.min(9, st.scrub));
    let un;
    if (u > 1e-4) { un = u + (a - res) * h; if (un < 0) un = 0; }
    else if (u < -1e-4) { un = u + (a + res) * h; if (un > 0) un = a > 0 ? Math.min(un, a * h) : 0; }
    else un = Math.max(0, (a - res) * h);
    st.v = un * sg;
    // 自排：踩越多越晚升檔（全油門 0.98 才升），定速轉速留在 0.45–0.7；放油門、正在慢下來（煞車、推頭、開進草地）不升檔（除非撞紅線）；大腳油門降檔
    if (!st.rev) {
      st.cut = Math.max(0, st.cut - h);
      const x = xOf(un, st.gear), dem = go * gov, pedal = inp.thr > 0.05 && (un - u) / h > -1.5; // dem：腳踩多少（循跡收掉的不算：彎裡面檔位留低、轉速高）
      if (st.cut <= 0 && st.gear < 5 && x > (pedal ? 0.64 + 0.34 * dem : 0.98)) {
        st.gear++; st.cut = 0.08 + 0.1 * dem; st.cutLoad = st.load > 0.9 ? 0 : st.load * 0.35; st.shifts++; events.push(['shift', st.gear + 1]); // 全油門換檔：油門放掉一下（洩壓、放炮，跟賽道一樣）
      } else if (st.gear > 0 && (x < (go > 0.05 ? 0.36 : 0.4) || (dem > 0.9 && xOf(un, st.gear - 1) < 0.8))) st.gear--;
    } else st.cut = 0;
    const xr = st.rev ? 0.14 + Math.min(1, Math.abs(un) / 4.5) * 0.3 : Math.max(0.13, xOf(un, st.gear));
    const slip = st.rev ? 0.1 * go : st.gear === 0 ? 0.34 * go * clamp(1 - xr / 0.5, 0, 1) : 0; // 起步半離合：一踩轉速就起來（聲音馬上出來）
    st.rpm += (Math.min(1.02, xr + slip) - st.rpm) * (1 - Math.exp(-h * 12));
    st.load = st.cut > 0 ? st.cutLoad : go > 0.02 ? go * (0.65 + 0.35 * lim) : 0;
    // 走：後軸沿著車頭方向走、繞後軸轉（腳踏車模型）
    const vab = Math.abs(st.v);
    // 頂住東西了還踩油門：方向盤照「想走的速度」轉（原地轉出來，不會一直卡著）
    st.touch = Math.max(0, st.touch - h); // 最近 0.2 秒碰過東西（頂著牆的時候不是每一步都碰到）
    st.blocked = st.touch > 0 && vab < 1 && go > 0.3 ? Math.min(1, st.blocked + h) : Math.max(0, st.blocked - 2 * h);
    const vT = st.blocked > 0.3 ? sg * Math.max(vab, 1.5 * go) : st.v, kT = st.blocked > 0.3 ? st.steer * kGeo : st.kap;
    const f0x = Math.cos(st.th), f0z = -Math.sin(st.th), rx = st.x + f0x * info.xr + f0x * st.v * h, rz = st.z + f0z * info.xr + f0z * st.v * h;
    st.th = wrapA(st.th - vT * kT * h);
    st.x = rx - Math.cos(st.th) * info.xr; st.z = rz + Math.sin(st.th) * info.xr;
    st.spin += st.v * h; st.alat = st.v * st.v * st.kap; st.along = (st.v - v0) / h;
  }
  function springs(h) { // 車身：轉彎往外傾、加速抬頭、煞車點頭（彈簧）；草地、稻田抖一抖
    st.jitT -= h; if (st.jitT <= 0) { st.jitT = 0.09 + Math.random() * 0.06; st.jit = st.surf === 1 || st.surf === 2 ? (Math.random() - 0.5) * 0.014 * Math.min(1, Math.abs(st.v) / 3) : 0; }
    const rT = clamp(-0.0053 * st.alat, -0.06, 0.06) + st.jit * 0.6, pT = clamp(0.0042 * st.along, -0.045, 0.035) + st.jit;
    st.rollV += (90 * (rT - st.roll) - 11 * st.rollV) * h; st.roll += st.rollV * h;
    st.pitchV += (90 * (pT - st.pitch) - 11 * st.pitchV) * h; st.pitch += st.pitchV * h;
  }

  // ---- 自動停車（到了起跑線、改車廠）：沿著一條平滑的曲線開過去 ----
  function stepAuto(dt) {
    const A = auto; A.t = Math.min(A.T, A.t + dt); const s = ease(A.t / A.T);
    let x, z, th;
    if (A.curve) {
      const s2 = s * s, s3 = s2 * s, h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
      const d00 = 6 * s2 - 6 * s, d10 = 3 * s2 - 4 * s + 1, d01 = -6 * s2 + 6 * s, d11 = 3 * s2 - 2 * s;
      x = h00 * A.x0 + h10 * A.k * A.f0[0] + h01 * A.x1 + h11 * A.k * A.f1[0]; z = h00 * A.z0 + h10 * A.k * A.f0[1] + h01 * A.z1 + h11 * A.k * A.f1[1];
      const tx = d00 * A.x0 + d10 * A.k * A.f0[0] + d01 * A.x1 + d11 * A.k * A.f1[0], tz = d00 * A.z0 + d10 * A.k * A.f0[1] + d01 * A.z1 + d11 * A.k * A.f1[1];
      th = s >= 1 ? A.th1 : Math.hypot(tx, tz) > 1e-6 ? Math.atan2(-tz, tx) : A.th1;
    } else { x = A.x0 + (A.x1 - A.x0) * s; z = A.z0 + (A.z1 - A.z0) * s; th = A.th0 + wrapA(A.th1 - A.th0) * s; }
    const mx = x - st.x, mz = z - st.z, ds = Math.hypot(mx, mz) * (mx * Math.cos(th) - mz * Math.sin(th) >= 0 ? 1 : -1);
    const dth = wrapA(th - st.th);
    st.kap = Math.abs(ds) > 1e-4 ? clamp(-dth / ds, -0.3, 0.3) : 0; st.steer = clamp(st.kap * 3, -1, 1);
    st.v = ds / dt; st.spin += ds; st.x = x; st.z = z; st.th = wrapA(th); st.rev = false; st.gear = 0; st.thrEff = 0.25; st.load = 0.3;
    st.rpm += (0.13 + Math.min(0.2, Math.abs(st.v) * 0.04) - st.rpm) * 0.2; st.alat = st.v * st.v * st.kap; st.along = 0;
    for (let i = 0, n = Math.ceil(dt * HZ); i < n; i++) springs(dt / n);
    if (A.t >= A.T) { st.v = 0; st.kap = 0; st.steer = 0; st.thrEff = 0; st.load = 0; auto = null; if (A.onDone) events.push(['done', A.onDone]); }
  }

  // ---- 車子擺到畫面上 ----
  function pose() {
    car.position.set(st.x, 0, st.z); car.rotation.set(0, st.th, 0);
    S.wheels.forEach((wh, i) => { wh.rotation.z = (i % 2 === 0 ? 1 : -1) * (st.spin / (i < 2 ? RF : RR)); });
    const d = Math.atan(st.kap * L), vis = (st.steer < 0 ? -1 : 1) * Math.max(Math.abs(d), Math.abs(st.steer) * (0.2 - 0.12 * Math.min(1, Math.abs(st.v) / 60))); // 右轉（steer > 0）前輪朝 +z；快的時候看起來轉少一點
    hubs[0].rotation.y = hub0[0] - vis; hubs[1].rotation.y = hub0[1] - vis;
    body.rotation.x = st.roll; body.rotation.z = st.pitch;
    body.position.z = base.bz - 0.45 * Math.sin(st.roll); body.position.x = base.bx + 0.45 * Math.sin(st.pitch); // 繞離地 0.45 公尺那點轉（不動 y：y 是車高）
    const cx = st.x + Math.cos(st.th) * CX, cz = st.z - Math.sin(st.th) * CX;
    fx.shadow.position.set(cx, 0.06, cz); fx.shadow.rotation.y = st.th;
  }
  function zones(silent) { // 每一步都算（300 km/h 一幀走 1.4 公尺，窄的範圍也不會跳過去）
    const cx = st.x + Math.cos(st.th) * CX, cz = st.z - Math.sin(st.th) * CX; let cur = null;
    for (const k in places) {
      const p = places[k]; if (!p || !p.zone) continue;
      const inside = inRect(p.zone, cx, cz, zoneIn[k] ? 2.5 : 0); if (inside && !cur) cur = k; // 出去要多出 2.5 公尺才算（在邊上晃不會一直進進出出）
      if (inside !== !!zoneIn[k]) { zoneIn[k] = inside; if (!silent) events.push(['zone', k, inside]); }
    }
    zoneNow = cur;
  }
  const placeAt = (p) => (p.zone ? [p.zone.x, p.zone.z] : p.pos ? [p.pos[0], p.pos[1]] : p.spawn ? [p.spawn.x, p.spawn.z] : null);
  function routeTick(dt, force) {
    routeT -= dt;
    const p = dest && places[dest];
    if (!p) { routeData = null; routeS = 0; return; }
    const cx = st.x + Math.cos(st.th) * CX, cz = st.z - Math.sin(st.th) * CX;
    if (routeT > 0 && !force) { if (routeData) routeS = walked(routeData.pts, cx, cz); return; }
    routeT = clamp(8 / Math.max(1, Math.abs(st.v)), 0.08, 0.3); // 快的時候常算（一次最多走 8 公尺）
    let r = null;
    try { r = world.route ? world.route(cx, cz, dest) : null; } catch { r = null; }
    if (!r || !Array.isArray(r.pts) || r.pts.length < 2 || !(r.len >= 0)) { // 路線不認得這個地方：直直指過去
      const q = placeAt(p); r = q ? { pts: [[cx, cz], q], len: Math.hypot(q[0] - cx, q[1] - cz), straight: true } : null;
    }
    routeData = r; routeS = 0;
  }
  // 路線是剛剛從那時候的位置算的：車子現在走到路線上的哪裡（公尺；只找前面 40 公尺，繞回來的路線不會跳過去）
  const walked = (pts, x, z) => {
    let best = Infinity, s = 0, acc = 0;
    for (let i = 1; i < pts.length && acc < 40; i++) {
      const ax = pts[i - 1][0], az = pts[i - 1][1], dx = pts[i][0] - ax, dz = pts[i][1] - az, l2 = dx * dx + dz * dz, l = Math.sqrt(l2);
      const t = l2 > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1) : 0, ex = ax + dx * t - x, ez = az + dz * t - z;
      if (ex * ex + ez * ez < best) { best = ex * ex + ez * ez; s = acc + l * t; }
      acc += l;
    }
    return s;
  };
  const along = (pts, d) => { // 路線上往前 d 公尺的點
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (d <= l && l > 0) return [pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * d) / l, pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * d) / l]; d -= l; }
    return pts[pts.length - 1];
  };
  const destStyle = (k) => DEST[k] || (places[k] ? { label: '去' + (places[k].name || k), icon: String(places[k].name || k).slice(0, 1), bg: '#3A3D44', fg: '#F2F3F5' } : null); // 沒寫的地方：「去＋名字」

  // ---- 影子、目的地光柱 ----
  const fx = (() => {
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
    const [c1, g1] = mk(128, 64); g1.shadowColor = 'rgba(0,0,0,0.9)'; g1.shadowBlur = 12; g1.shadowOffsetX = 400; g1.fillStyle = '#000'; g1.beginPath(); g1.roundRect ? g1.roundRect(18 - 400, 13, 92, 38, 16) : g1.rect(18 - 400, 13, 92, 38); g1.fill();
    const t1 = new THREE.CanvasTexture(c1); t1.colorSpace = THREE.SRGBColorSpace;
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(info.len + 0.8, info.halfW * 2 + 0.8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: t1, transparent: true, depthWrite: false, opacity: 0.62 }));
    shadow.renderOrder = 1; shadow.name = 'drive-shadow';
    const [c2, g2] = mk(4, 128), gr = g2.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0.95)');
    g2.fillStyle = gr; g2.fillRect(0, 0, 4, 128);
    const t2 = new THREE.CanvasTexture(c2); t2.colorSpace = THREE.SRGBColorSpace;
    const add = (map) => new THREE.MeshBasicMaterial({ map, color: 0xff7a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, fog: false }); // 加法混色：正反面一次畫完（少一個 draw call）
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 34, 24, 1, true).translate(0, 17, 0), add(t2));
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.3, 3.0, 48).rotateX(-Math.PI / 2), add(null)); ring.position.y = 0.08;
    pillar.renderOrder = ring.renderOrder = 4;
    const beacon = new THREE.Group(); beacon.name = 'drive-beacon'; beacon.add(pillar, ring); beacon.visible = false;
    if (scene) scene.add(shadow, beacon);
    return { shadow, beacon, ring, pillar, texs: [t1, t2] };
  })();
  function beaconTick() {
    const p = dest && places[dest], q = p && placeAt(p), show = !!q && !paused && zoneNow !== dest;
    fx.beacon.visible = show; if (!show) return;
    fx.beacon.position.set(q[0], 0, q[1]);
    const k = (now * 0.7) % 1; fx.ring.scale.setScalar(1 + k * 0.7); fx.ring.material.opacity = 1 - k; fx.pillar.material.opacity = 0.75 + 0.25 * Math.sin(now * 3);
  }

  // ---- 鏡頭 ----
  // 追車：越快越往後拉、放低一點、看遠一點、視角變廣（速度感，最多 +12°）；位置跟著車子「相對」平滑（不然 300 km/h 鏡頭會落後 8 公尺）
  // 晃：撞到（shake，照撞的力道）＋200 km/h 以上路面的小震動（幾個不同頻率的正弦，不是每幀亂跳）
  const cam = { yaw: st.th, ox: 0, oy: 0, oz: 0, d: 6.5, ok: false, shake: 0, spd: 0, acc: 0, t: 0 }, V1 = new THREE.Vector3(), V2 = new THREE.Vector3();
  const defEye = { eye: [CX - 0.3, 1.12, S.spec.interior?.wheelZ ?? 0.37], look: [CX + 9, 0.95, S.spec.interior?.wheelZ ?? 0.37], fov: 72 };
  const wob = (t, a) => Math.sin(t * 71 + a) * 0.5 + Math.sin(t * 113 + 2 * a + 1.7) * 0.3 + Math.sin(t * 163 + 3 * a + 4.1) * 0.2;
  const setFov = (f) => { if (Math.abs(f - camera.fov) > 0.05) { camera.fov = f; camera.updateProjectionMatrix(); } };
  function camTick(dt) {
    if (!camera || mode === 'none') return;
    const sp = Math.abs(st.v);
    cam.spd += (sp - cam.spd) * (1 - Math.exp(-dt * 1.6)); cam.acc += (clamp(st.along, -12, 12) - cam.acc) * (1 - Math.exp(-dt * 3)); cam.t += dt;
    const q = smooth01((cam.spd - 8) / 72); // 0（30 km/h 以下）→ 1（290 km/h）
    cam.shake *= Math.exp(-dt * 7);
    const shA = (cam.shake + 0.035 * clamp((cam.spd * 3.6 - 200) / 140, 0, 1)) * (calm ? 0.3 : 1), sx = shA * wob(cam.t, 0), sy = shA * wob(cam.t, 2.1), sz = shA * wob(cam.t, 4.3);
    if (mode === 'eye') {
      const v = view || o.eye || defEye; car.updateMatrixWorld(true); // 車子這一幀的位置（不是上一次畫的：300 km/h 一幀差 1.4 公尺）
      camera.position.copy(V1.fromArray(v.eye).applyMatrix4(body.matrixWorld)); camera.lookAt(V2.fromArray(v.look).applyMatrix4(body.matrixWorld));
      camera.position.x += sx * 0.25; camera.position.y += sy * 0.25; camera.position.z += sz * 0.25; // 車裡晃小一點
      setFov((v.fov || 72) + 7 * q);
      return;
    }
    cam.yaw += wrapA(st.th - cam.yaw) * (1 - Math.exp(-dt * (2.4 + sp * 0.1)));
    let D = 6.4 + 1.8 * q + clamp(cam.acc * 0.05, -0.3, 0.45), H = 2.35 - 0.4 * q, yaw = cam.yaw; // 用力加速鏡頭落後一點、煞車靠近一點
    if (intro) { // 出門：鏡頭從車前面繞到後面
      intro.t += dt; if (Math.abs(st.v) > 1.5) intro.t += dt * 2; // 開始開了就快一點繞完
      const k = ease(Math.min(1, intro.t / intro.T)); yaw += intro.a0 * (1 - k); D += (intro.d0 - D) * (1 - k); H += (intro.h0 - H) * (1 - k);
      if (intro.t >= intro.T) intro = null;
    }
    const fx2 = Math.cos(yaw), fz2 = -Math.sin(yaw), px = st.x + Math.cos(st.th) * CX, pz = st.z - Math.sin(st.th) * CX;
    const t = rayHit(px, pz, px - fx2 * D, pz - fz2 * D), d = t < 1 ? Math.max(2.4, D * t - 0.45) : D; // 被房子擋到就拉近一點、抬高一點
    cam.d += (d - cam.d) * (1 - Math.exp(-dt * (d < cam.d ? 14 : 2.5)));
    const ox = -fx2 * cam.d, oz = -fz2 * cam.d, oy = H + (D - cam.d) * 0.35;
    if (!cam.ok) { cam.ox = ox; cam.oy = oy; cam.oz = oz; cam.ok = true; }
    const k2 = 1 - Math.exp(-dt * 10); cam.ox += (ox - cam.ox) * k2; cam.oy += (oy - cam.oy) * k2; cam.oz += (oz - cam.oz) * k2;
    camera.position.set(px + cam.ox + sx, cam.oy + sy * 0.7, pz + cam.oz + sz);
    const la = 3 + 5 * q; camera.lookAt(px + fx2 * la, 1.0 - 0.1 * q, pz + fz2 * la);
    const base = clamp((2 * Math.atan(Math.tan((56 * Math.PI) / 360) / (camera.aspect || 1)) * 180) / Math.PI, 50, 72);
    setFov(Math.min(86, base + 12 * q));
  }
  function setCameraMode(m, v) {
    mode = m; if (v) view = v;
    if (camera && m !== 'none') {
      camera.near = m === 'eye' ? 0.05 : 0.2; // 追車的鏡頭離車子至少 2.4 公尺：near 大一點，遠的路面比較不會閃（world 幾公里大）
      if (m === 'eye') camera.fov = (view || o.eye || defEye).fov || 72;
      camera.updateProjectionMatrix(); cam.ok = false; cam.yaw = st.th; cam.d = 6.5;
    }
    if (hud) hud.cam.setAttribute('aria-pressed', String(m === 'eye'));
  }

  // ---- HUD：左上目的地（下面一顆大按鈕）、右上小地圖、下面方向鍵、速度、油門煞車 ----
  const hud = hasDoc ? buildHud() : null;
  function buildHud() {
    if (!document.getElementById('dv-style')) { const s = document.createElement('style'); s.id = 'dv-style'; s.textContent = CSS; document.head.append(s); }
    const root = document.createElement('div'); root.className = 'dv';
    root.innerHTML = `<div class="dv-chip" hidden><i>${ICON.up}</i><b></b><small></small></div><button type="button" class="dv-act" hidden><i></i><span></span><kbd>E</kbd></button><div class="dv-map"><canvas></canvas></div>`
      + `<b class="dv-cam" role="button" aria-label="換視角" aria-pressed="false">${ICON.cam}</b><div class="dv-spd"><b>0</b><span>KM/H</span><em>1</em></div>`
      + `<div class="dv-steer"><b role="button" aria-label="左轉">${ICON.L}</b><b role="button" aria-label="右轉">${ICON.R}</b></div>`
      + `<div class="dv-ped"><b class="dv-brk" role="button" aria-label="煞車">煞車</b><b class="dv-gas" role="button" aria-label="油門">油門</b></div><div class="dv-toast" role="status"></div>`;
    o.hudParent.append(root);
    const q = (s) => root.querySelector(s), H = { root, chip: q('.dv-chip'), arrow: q('.dv-chip svg'), name: q('.dv-chip b'), dist: q('.dv-chip small'), map: q('.dv-map canvas'), cam: q('.dv-cam'),
      act: q('.dv-act'), actIcon: q('.dv-act i'), actText: q('.dv-act span'),
      spd: q('.dv-spd b'), gear: q('.dv-spd em'), steer: q('.dv-steer'), steerB: [...root.querySelectorAll('.dv-steer b')], gas: q('.dv-gas'), brk: q('.dv-brk'), toast: q('.dv-toast'), off: [] };
    if (o.camButton === false) H.cam.hidden = true;
    const on = (el, t, f, opt) => { el.addEventListener(t, f, opt); H.off.push(() => el.removeEventListener(t, f, opt)); };
    on(root, 'contextmenu', (e) => e.preventDefault());
    // 按住：手指按下去就抓住（滑出去也算按著），放開才放
    const hold = (el, down, up) => {
      on(el, 'pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* 沒有就算了 */ } down(e); });
      on(el, 'pointermove', (e) => { if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) down(e, true); });
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) on(el, t, (e) => up(e));
    };
    hold(H.gas, () => { human.thr = 1; H.gas.classList.add('on'); }, () => { human.thr = 0; H.gas.classList.remove('on'); });
    hold(H.brk, () => { human.brk = 1; H.brk.classList.add('on'); }, () => { human.brk = 0; H.brk.classList.remove('on'); });
    const fingers = new Map(), steerNow = () => { let s = 0; for (const v of fingers.values()) s = v; human.steer = s; H.steerB[0].classList.toggle('on', s < 0); H.steerB[1].classList.toggle('on', s > 0); };
    hold(H.steer, (e) => { const r = H.steer.getBoundingClientRect(); fingers.delete(e.pointerId); fingers.set(e.pointerId, e.clientX < r.left + r.width / 2 ? -1 : 1); steerNow(); }, (e) => { fingers.delete(e.pointerId); steerNow(); });
    on(H.cam, 'click', () => setCameraMode(mode === 'eye' ? 'chase' : 'eye'));
    // 大按鈕：按下去縮一下，放開（click）才做；另一隻手指按著油門也按得到
    on(H.act, 'pointerdown', () => H.act.classList.add('on'));
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) on(H.act, t, () => H.act.classList.remove('on'));
    on(H.act, 'click', (e) => { e.preventDefault(); doAction(); });
    // 小地圖：路、稻田、房子先畫在一張大圖上，每幀轉一下貼上去；越快看越遠（150 → 450 公尺）
    const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1), px = Math.round(124 * dpr);
    H.map.width = H.map.height = px; H.mapPx = px; H.dpr = dpr; H.mctx = H.map.getContext('2d'); H.layer = mapLayer(); H.mapT = 0; H.span = 150; H.last = {};
    return H;
  }
  function mapLayer() { // 世界幾公里大：一公尺最多 2 個像素、邊長最多 4096、全部最多 400 萬像素（16 MB：手機的記憶體、canvas 有上限）
    const b = world.bounds || { x0: -400, x1: 20, z0: -120, z1: 100 }, pad = 50, x0 = b.x0 - pad, z0 = b.z0 - pad, x1 = b.x1 + 150, z1 = b.z1 + pad;
    const ms = Math.min(2, 4096 / Math.max(x1 - x0, z1 - z0), Math.sqrt(4e6 / ((x1 - x0) * (z1 - z0))));
    const c = document.createElement('canvas'); c.width = Math.ceil((x1 - x0) * ms); c.height = Math.ceil((z1 - z0) * ms);
    const g = c.getContext('2d'); g.scale(ms, ms); g.translate(-x0, -z0);
    const rect = (r) => { g.save(); g.translate(r.x, r.z); g.rotate(-(r.rot || 0)); g.fillRect(-r.hx, -r.hz, r.hx * 2, r.hz * 2); g.restore(); };
    g.fillStyle = 'rgba(122,178,96,0.4)'; for (const p of world.areas?.paddy || []) rect(p);
    g.fillStyle = 'rgba(206,210,218,0.26)'; for (const c2 of world.colliders || []) if (c2.t === 'box' && (c2.h ?? 0) >= 4 && c2.hx < 30 && c2.hz < 30) rect(c2);
    g.fillStyle = 'rgba(233,235,238,0.5)'; g.fillRect(-60, -6, 820, 12); // 賽道
    const col = { main: '#e9ebee', strip: '#e9ebee', highway: '#f4f5f7', street: '#c9cdd4', drive: '#c9cdd4', farm: '#b5b9ac' };
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const r of world.roads || []) { g.strokeStyle = col[r.kind] || '#c9cdd4'; g.lineWidth = Math.max(5, r.w * 0.95); g.beginPath(); r.pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z))); g.stroke(); }
    g.fillStyle = '#f2f3f5'; g.fillRect(-0.6, -6, 1.2, 12); // 起跑線
    return { c, ms, x0, z0 };
  }
  function drawMap(dt) {
    const H = hud, g = H.mctx, s = H.mapPx, cx = st.x + Math.cos(st.th) * CX, cz = st.z - Math.sin(st.th) * CX, oy = s * 0.13, rot = st.th - Math.PI / 2;
    H.span += (150 + 300 * smooth01((Math.abs(st.v) * 3.6 - 60) / 190) - H.span) * (1 - Math.exp(-dt * 1.5));
    const k = s / H.span;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, s, s);
    g.save(); g.translate(s / 2, s / 2 + oy); g.rotate(rot); g.scale(k, k); g.translate(-cx, -cz);
    g.drawImage(H.layer.c, H.layer.x0, H.layer.z0, H.layer.c.width / H.layer.ms, H.layer.c.height / H.layer.ms);
    if (routeData && routeData.pts.length > 1) {
      g.strokeStyle = '#FF6A1F'; g.lineWidth = (3.4 * H.dpr) / k; g.lineCap = 'round'; g.lineJoin = 'round'; g.setLineDash(routeData.straight ? [(6 * H.dpr) / k, (5 * H.dpr) / k] : []); g.beginPath();
      routeData.pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z))); g.stroke(); g.setLineDash([]);
    }
    g.restore();
    // 地方（字是正的；地圖外面的就貼在邊上）：有自己顏色的都畫，其他的只畫目的地
    const cs = Math.cos(rot), sn = Math.sin(rot), R = s / 2 - 13 * H.dpr, ic = [];
    for (const key in places) {
      const p = places[key], d = DEST[key] || (key === dest ? destStyle(key) : null), q = d && placeAt(p); if (!q) continue;
      const wx = q[0] - cx, wz = q[1] - cz;
      let sx = (wx * cs - wz * sn) * k, sy = (wx * sn + wz * cs) * k + oy; const l = Math.max(Math.abs(sx), Math.abs(sy));
      if (l > R) { sx *= R / l; sy *= R / l; }
      ic.push({ key, d, sx, sy, r: (key === dest ? 11 : 9) * H.dpr });
    }
    ic.sort((a, b) => (a.key === dest) - (b.key === dest)); // 目的地最後畫（在最上面）
    for (let i = 0; i < ic.length; i++) for (let j = i + 1; j < ic.length; j++) { // 兩個貼在同一個地方：先畫的那個沿著邊挪開
      const a = ic[i], b = ic[j], need = a.r + b.r + 2 * H.dpr; if (Math.hypot(a.sx - b.sx, a.sy - b.sy) >= need) continue;
      const ax = Math.abs(a.sx) >= Math.abs(a.sy) ? 'sy' : 'sx', sg = Math.sign(a[ax] - b[ax]) || 1;
      a[ax] = b[ax] + sg * need; if (Math.abs(a[ax]) > R) a[ax] = b[ax] - sg * need;
    }
    for (const { key, d, sx, sy, r } of ic) {
      g.beginPath(); g.arc(s / 2 + sx, s / 2 + sy, r, 0, TAU); g.fillStyle = d.bg; g.fill(); g.lineWidth = 2 * H.dpr; g.strokeStyle = key === dest ? '#FF6A1F' : 'rgba(242,243,245,0.85)'; g.stroke();
      g.fillStyle = d.fg; g.font = `700 ${Math.round(r * 1.15)}px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(d.icon, s / 2 + sx, s / 2 + sy + 0.5 * H.dpr);
    }
    // 你：中間偏下的箭頭（永遠朝上）
    const u = H.dpr; g.translate(s / 2, s / 2 + oy); g.beginPath(); g.moveTo(0, -9 * u); g.lineTo(7 * u, 7 * u); g.lineTo(0, 3.5 * u); g.lineTo(-7 * u, 7 * u); g.closePath();
    g.fillStyle = '#F2F3F5'; g.fill(); g.lineWidth = 2 * u; g.strokeStyle = '#FF6A1F'; g.stroke(); g.setTransform(1, 0, 0, 1, 0, 0);
  }
  function hudTick(dt) {
    const H = hud; if (!H) return;
    const kmh = Math.round(Math.abs(st.v) * 3.6), gear = st.rev ? 'R' : String(st.gear + 1), set = (k, v, f) => { if (H.last[k] !== v) { H.last[k] = v; f(v); } };
    set('spd', kmh, (v) => (H.spd.textContent = v)); set('gear', gear, (v) => { H.gear.textContent = v; H.gear.classList.toggle('r', v === 'R'); });
    set('rev', st.rev, (v) => { H.brk.textContent = v ? '倒車' : '煞車'; H.brk.classList.toggle('rev', v); });
    const dd = dest && destStyle(dest); set('dest', dest, () => { H.chip.hidden = !dd; if (dd) H.name.textContent = dd.label; });
    if (dd && routeData) {
      const here = zoneNow === dest; set('here', here, (v) => { H.chip.classList.toggle('here', v); H.arrow.innerHTML = v ? '<path d="M5 12.5l4.5 4.5L19.5 7" fill="none" stroke="#0E0F12" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>' : ICON.up.replace(/<\/?svg[^>]*>/g, ''); });
      const cx = st.x + Math.cos(st.th) * CX, cz = st.z - Math.sin(st.th) * CX, la = along(routeData.pts, routeS + 14), rel = wrapA(Math.atan2(-(la[1] - cz), la[0] - cx) - st.th), left = Math.max(0, routeData.len - routeS);
      H.arrow.style.transform = here ? '' : `rotate(${Math.round((-rel * 180) / Math.PI)}deg)`;
      set('dist', here ? '到了！' : left < 25 ? '就在前面' : left >= 995 ? `${(left / 1000).toFixed(1)} km` : `${Math.round(left / 10) * 10} m`, (v) => (H.dist.textContent = v));
    }
    H.mapT -= dt; if (H.mapT <= 0) { drawMap(1 / 30 - H.mapT); H.mapT = 1 / 30; }
  }
  let toastT = 0;
  function toast(text, ms = 1600) { if (!hud) return; hud.toast.textContent = text; hud.toast.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => hud && hud.toast.classList.remove('show'), ms); }
  // HUD 的大按鈕（開鐵捲門⋯）：字、圖一樣就不動畫面，onClick 永遠換成最新的
  function setAction(a) {
    const next = a && a.label ? { label: String(a.label), onClick: a.onClick, icon: ICON[a.icon] ? a.icon : 'hand' } : null;
    const same = !!action && !!next && action.label === next.label && action.icon === next.icon;
    action = next;
    if (!hud || same) return;
    hud.act.hidden = !next; hud.act.classList.remove('on');
    if (next) { hud.actText.textContent = next.label; hud.actIcon.innerHTML = ICON[next.icon]; hud.act.setAttribute('aria-label', next.label); }
  }
  function doAction() {
    if (!action || paused || !alive) return;
    const f = action.onClick; if (typeof f === 'function') f(api);
  }

  // ---- 鍵盤 ----
  const KEYS = { ArrowUp: 'U', KeyW: 'U', ArrowDown: 'D', KeyS: 'D', ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R', Space: 'B' };
  const onKey = (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const k = KEYS[e.code], down = e.type === 'keydown';
    if (k) { if (!paused) e.preventDefault(); human.kb[k] = down; }
    else if (down && e.code === 'KeyC' && !e.repeat && !paused) setCameraMode(mode === 'eye' ? 'chase' : 'eye');
    else if (down && e.code === 'KeyE' && !e.repeat && !paused && action) { e.preventDefault(); doAction(); }
  };
  const onBlur = () => { human.kb = {}; };
  const useKeys = o.keyboard !== false && typeof window !== 'undefined' && window.addEventListener;
  if (useKeys) { window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey); window.addEventListener('blur', onBlur); }
  const input = () => {
    if (forced) return forced;
    const k = human.kb; return { thr: Math.max(k.U ? 1 : 0, human.thr), brk: Math.max(k.D ? 1 : 0, human.brk), hb: k.B ? 1 : 0, steer: clamp((k.R ? 1 : 0) - (k.L ? 1 : 0) + human.steer, -1, 1) };
  };

  // ---- 每一幀 ----
  function update(dt) {
    if (!alive || paused) return;
    dt = Math.min(0.1, Math.max(0, +dt || 0)); if (!dt) return;
    now += dt;
    if (auto) { stepAuto(dt); zones(false); }
    else {
      st.surf = world.surfaceAt ? world.surfaceAt(st.x + Math.cos(st.th) * CX, st.z - Math.sin(st.th) * CX) : 0;
      // 每步最少 1/120 秒、最多走 STEP 公尺（碰撞不會穿過去）
      const inp = input(), n = Math.max(1, Math.ceil(dt * HZ - 1e-6), Math.ceil(((Math.abs(st.v) + 15 * dt) * dt) / STEP)), h = dt / n;
      for (let i = 0; i < n; i++) { physics(h, inp); collide(); springs(h); zones(false); }
    }
    // 撞到：這一幀最大的一下（0.25 秒內只算一次）→ 鏡頭晃、onBump
    if (st.hitW > 1.2 && now - st.hitT > 0.25) { st.bumps++; st.hitT = now; cam.shake = Math.max(cam.shake, Math.min(0.32, st.hitW * 0.012)); events.push(['bump', st.hitW]); }
    st.hitW = 0;
    pose(); routeTick(dt); beaconTick(); camTick(dt); hudTick(dt);
    // 事件最後才叫（叫的時候車子、鏡頭都已經是這一幀的樣子）
    const ev = events.splice(0);
    for (const e of ev) {
      if (e[0] === 'zone' && o.onZone) o.onZone(e[1], e[2], places[e[1]]);
      else if (e[0] === 'shift' && o.onShift) o.onShift(e[1]);
      else if (e[0] === 'bump' && o.onBump) o.onBump(e[1]);
      else if (e[0] === 'done') e[1]();
    }
  }
  function neutral() {
    st.roll = st.rollV = st.pitch = st.pitchV = st.kap = st.steer = st.v = st.scrub = st.push = 0; st.thr = st.brk = st.thrEff = st.load = 0; st.rpm = 0.13; st.hitW = st.touch = st.blocked = 0;
    body.rotation.x = 0; body.rotation.z = 0; body.position.x = base.bx; body.position.z = base.bz; hubs.forEach((hb, i) => (hb.rotation.y = hub0[i]));
  }
  function setHidden(h) { if (hud) hud.root.hidden = h; fx.shadow.visible = !h; if (h) fx.beacon.visible = false; }
  function teleport(p, op = {}) {
    auto = null; events.length = 0;
    st.x = p.x; st.z = p.z; st.th = p.heading ?? 0; st.gear = 0; st.rev = false; st.hold = 0; st.cut = 0; neutral();
    pose(); zones(true); routeTick(0, true); cam.ok = false; cam.yaw = st.th; cam.d = 6.5; cam.spd = 0; cam.acc = 0; cam.shake = 0;
    intro = op.intro ? { t: 0, T: 3.4, a0: 2.8, d0: 8.5, h0: 1.45 } : null;
    if (camera && mode !== 'none') camTick(1 / 60);
  }
  function parkAt(p, onDone) {
    const th1 = p.heading ?? 0, f1 = [Math.cos(th1), -Math.sin(th1)], f0 = [Math.cos(st.th), -Math.sin(st.th)];
    const x1 = p.noseX != null ? p.noseX - f1[0] * info.nose : p.x, z1 = p.noseX != null ? p.z - f1[1] * info.nose : p.z;
    const dx = x1 - st.x, dz = z1 - st.z, dist = Math.hypot(dx, dz);
    auto = { t: 0, T: clamp(dist / 4.5 + 0.5, 0.6, 3.2), x0: st.x, z0: st.z, th0: st.th, x1, z1, th1, k: dist, f0, f1, onDone, curve: dist > 0.5 && dx * f0[0] + dz * f0[1] > 0 && f0[0] * f1[0] + f0[1] * f1[1] > 0.3 };
    st.rev = false; st.gear = 0; st.hold = 0;
  }
  function pause() { paused = true; auto = null; events.length = 0; neutral(); setHidden(true); human.thr = human.brk = human.steer = 0; human.kb = {}; if (hud) hud.act.classList.remove('on'); }
  function resume() { if (!alive) return; paused = false; setHidden(false); cam.ok = false; }
  function release() { pause(); st.spin = 0; car.position.set(0, 0, 0); car.rotation.set(0, 0, 0); S.wheels.forEach((w) => (w.rotation.z = 0)); car.updateMatrixWorld(true); }
  function setDestination(name) { dest = name && places[name] ? name : null; routeT = 0; routeTick(0, true); if (hud) hud.last.here = undefined; }
  function dispose() {
    if (!alive) return;
    release(); alive = false; action = null; cw.clear();
    if (useKeys) { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('blur', onBlur); }
    if (hud) { hud.off.forEach((f) => f()); hud.root.remove(); }
    clearTimeout(toastT);
    for (const ms of [fx.shadow, fx.pillar, fx.ring]) { ms.removeFromParent(); ms.geometry.dispose(); ms.material.dispose(); }
    fx.beacon.removeFromParent(); fx.texs.forEach((t) => t.dispose());
  }
  const telemetry = () => ({ x: st.x, z: st.z, heading: st.th, v: st.v, kmh: Math.abs(st.v) * 3.6, rpm: st.rpm, gear: st.rev ? -1 : st.gear + 1, throttle: st.cut > 0 ? 0 : st.thrEff, load: paused ? 0 : st.load,
    brake: Math.max(st.rev ? st.thr : st.brk, st.hb), steer: st.steer, surface: st.surf, cap: Math.min(999, Math.round(st.cap * 36) / 10), reversing: st.rev, bumps: st.bumps, shifts: st.shifts, zone: zoneNow, dest, destDist: routeData ? Math.max(0, routeData.len - routeS) : null, auto: !!auto, paused });

  const api = {
    update, telemetry, setDestination, setCameraMode, teleport, parkAt, pause, resume, release, dispose, toast, setAction,
    addColliders: (list, tag) => cw.add(Array.isArray(list) ? list : [list], tag ?? null),
    removeColliders: (tag) => cw.remove(tag),
    setInput: (i) => { forced = i ? { thr: +i.throttle || 0, brk: +i.brake || 0, hb: +i.handbrake || 0, steer: clamp(+i.steer || 0, -1, 1) } : null; },
    get cameraMode() { return mode; }, get route() { return routeData; }, get action() { return action ? action.label : null; },
    carInfo: { nose: info.nose, tail: info.tail, len: info.len, halfW: info.halfW, wheelbase: L, vmax: P.vmax }, hud: hud && hud.root,
  };
  teleport({ x: st.x, z: st.z, heading: st.th });
  setCameraMode('chase');
  return api;
}
return { createDrive };
})();

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
  wings: { gt: (paint, mats) => gtWing({ mats, x: -2.04, y: 1.255, deck: 0.972, span: 1.62, chord: 0.30 }) }, wing: 'none', // 端板要高過後葉子板（原本插進去 8 公分）
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
  ep.moveTo(-1.76, 0.962); ep.lineTo(-1.84, 1.03); ep.quadraticCurveTo(-1.95, 1.20, -1.975, 1.255); ep.quadraticCurveTo(-1.99, 1.275, -2.03, 1.272);
  ep.lineTo(-2.12, 1.255); ep.quadraticCurveTo(-2.145, 1.25, -2.14, 1.22); ep.lineTo(-2.10, 1.05); ep.quadraticCurveTo(-2.09, 0.995, -2.05, 0.948); ep.closePath(); // 底邊貼著行李箱蓋、稍微插進去一點（原本浮 2 公分）
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
function P918_sync(paint, parts) { // 照目前的顏色套漆面，零件跟著車身同色同漆面；車庫選了別的漆面（setFinish，paint.userData.finish 不是 stock）就不照顏色改
  const fin = paint.userData.finish;
  if (!fin || fin === 'stock') {
    const f = P918_FINISH[paint.color.getHexString()] || [0.3, 0.12, 1];
    paint.roughness = f[0]; paint.metalness = f[1]; paint.clearcoat = f[2]; paint.clearcoatRoughness = f[2] < 0.5 ? 0.6 : 0.03;
  }
  for (const m of parts) {
    m.color.copy(paint.color); m.roughness = paint.roughness; m.metalness = paint.metalness; m.clearcoat = paint.clearcoat; m.clearcoatRoughness = paint.clearcoatRoughness;
    m.iridescence = paint.iridescence; m.iridescenceIOR = paint.iridescenceIOR; m.iridescenceThicknessRange = paint.iridescenceThicknessRange;
  }
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

// ---- carlod.js ----
// 輕量車（LOD）：車庫六個車位停的車、車行展示的車、之後路上別人開的車用的「輕的整台車」
// 一台約 2～2.5 萬個三角形、4 個 draw call（車身＋零件、玻璃、輪胎＋煞車、輪框），沒有車內（深色玻璃擋住，看進去是暗的車殼）
// 車身檔 body-<key>-lod.glb（node make-lod.mjs 從完整的車做的；試做頁用 base64 的 car-<key>-lod.txt，App 用 tune/<key>-lod.glb）：
//   node「body」＝右半邊車身（extras.lod＝'body'、half），每個分類一個 primitive（車漆、玻璃、黑飾條、消光、燈、燈裡的暗玻璃、網子、方向燈、尾燈、倒車燈），材質名字＝角色
//   node「nose_<名字>」＝Supra 的車頭（lod＝'nose'、half、kits＝哪些套件用它）；node「part_<n>」＝零件（整台，lod＝'part'），extras＝{ kits, wing, wide } 看得到的條件
//   材質 extras＝{ role, cc }：角色固定的（paint、trim、rim⋯）顏色在這裡決定，custom 用 glb 裡的顏色／粗糙度／金屬感
// 輪子（輪胎、輪框筒內側、碟盤、卡鉗）這裡照 spec.wheels 做低面數的；輪框是一片圓盤＋外圈輪唇，貼「輪框圖」：
//   parts.js 的 wheel()（輪框面＋輪框筒，跟完整的車同一個樣式）從正面光柵化成 128×128 的顏色／透明度＋法線貼圖（第一次用到那個樣式時做，之後共用）
// 用法：
//   const scene = await LOD_CARS.gc8.load();                          // 下載＋解析一次（同一台之後組幾台都共用）
//   const lod = buildLodCar('gc8', scene, CARS.gc8.state); world.add(lod.car);
//   lod.setLook({ paint: '#c8141e', finish: 'matte', rim: 'gold', wing: 'gt' });   // 只給要改的
//   lod.setRoll(公尺)（輪框轉：開了多遠）、lod.dispose()（網格、輪框圖大家共用，放掉自己的那份）
//   外觀（跟車庫 CARS[key].state 一樣的鍵）：paint、finish（stock|gloss|metal|matte|pearl）、rim（chrome|gunmetal|black|gold|white 或 #hex）、rimStyle（stock|five|six|multi|mesh|dish|fan）、
//     caliper、tint（light|dark）、wing、kit、wide（on|off）、height、glow（none|#hex）、livery（只有 Jesko 的點綴色：red|green|none；其他台不畫拉花）；另外 lights（大燈尾燈亮）、brake（煞車燈）
// 擺法跟 buildCar 的 car 一樣：車的中心在原點、車頭朝 +x、輪子踩在 y=0，軸距、輪距、輪子大小、車高照 spec（跟完整的車換來換去不會跳）
// 打包（build-art.mjs／build-app.mjs 拿掉 import／export，接在每台車的 spec 後面）：最上層只有 buildLodCar、LOD_CARS，其他都在 IIFE 裡
//   檔名要照字面寫（build-app.mjs 把 'car-<key>-lod.txt' 換成 'tune/<key>-lod.glb?h=<雜湊>'），下面 SIZES 的大小由 build 填（那個記號整個檔只能出現一次，註解裡也不能寫）

const { buildLodCar, LOD_CARS } = (() => {
  // spec、預設外觀用 switch 拿（只算到用到的那一個）：沒打包 Yaris 的版本（build-art.mjs 沒加 --yaris）拿 YARIS_SPEC 會丟 ReferenceError → 那台就不列在 LOD_CARS
  // 打包時這個檔要接在每台車的 spec 後面（build-art.mjs／build-app.mjs 是這樣接的）
  const SPEC = (k) => { switch (k) { case 'supra': return SUPRA_SPEC; case 'gtr': return GTR_SPEC; case 'gc8': return GC8_SPEC; case 'yaris': return YARIS_SPEC; case 'p918': return P918_SPEC; case 'sp3': return SP3_SPEC; case 'jesko': return JESKO_SPEC; } return null; };
  const KEYS = ['supra', 'gtr', 'gc8', 'yaris', 'p918', 'sp3', 'jesko'].filter((k) => { try { return !!SPEC(k); } catch { return false; } });
  const DEF = (k) => { switch (k) { // Supra、GT-R 的預設寫在車庫頁（garage.src.html CARS），這裡抄一份；其他台用 <KEY>_GARAGE.state
    case 'supra': return { paint: '#ff7414', rim: 'chrome', caliper: '#9da1a6', wing: 'gt', kit: 'bomex', height: '0', livery: 'ff', tint: 'light' };
    case 'gtr': return { paint: '#1d4fc9', rim: 'gunmetal', caliper: '#c8141e', wing: 'stock', kit: 'bomex', height: '-0.03', livery: 'none', tint: 'light' };
    case 'gc8': return GC8_GARAGE.state; case 'yaris': return YARIS_GARAGE.state; case 'p918': return P918_GARAGE.state; case 'sp3': return SP3_GARAGE.state; case 'jesko': return JESKO_GARAGE.state;
  } return {}; };
  const BASE = { wide: 'off', finish: 'stock', rimStyle: 'stock', glow: 'none', lights: false, brake: false };
  const FILES = { supra: 'tune/supra-lod.glb?h=1ff75170', gtr: 'tune/gtr-lod.glb?h=4bd6b3dc', gc8: 'tune/gc8-lod.glb?h=19a13ada', yaris: 'tune/yaris-lod.glb?h=d9db9130', p918: 'tune/p918-lod.glb?h=0ee9057b', sp3: 'tune/sp3-lod.glb?h=312b720a', jesko: 'tune/jesko-lod.glb?h=f98af4da' };
  const SIZES = {"supra":245812,"gtr":224380,"sp3":246392,"jesko":242384,"yaris":240240,"gc8":206068,"p918":224292};
  const LOADED = new Map(); // key → Promise<gltf.scene>
  function load(k) { // 下載（.txt＝base64、.glb 直接用）＋解析；失敗了下次再試
    if (!LOADED.has(k)) {
      LOADED.set(k, (async () => {
        const res = await fetch(FILES[k]);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        let buf = await res.arrayBuffer();
        if (/\.txt(\?|$)/.test(FILES[k])) {
          const s = atob(new TextDecoder().decode(buf).trim()), u = new Uint8Array(s.length);
          for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
          buf = u.buffer;
        }
        return (await new GLTFLoader().parseAsync(buf, '')).scene;
      })().catch((e) => { LOADED.delete(k); throw e; }));
    }
    return LOADED.get(k);
  }
  const LOD_CARS = Object.fromEntries(KEYS.map((k) => [k, {
    key: k, file: FILES[k], size: SIZES[k] || 0, load: () => load(k),
    get spec() { return SPEC(k); }, get look() { return { ...BASE, ...DEF(k) }; },
  }]));

  // ---- 材質角色 → 類別編號（頂點帶 lodCls，shader 查表拿顏色、粗糙度、金屬感、清漆、發光）----
  const ROLES = ['paint', 'glass', 'trim', 'matte', 'lamp', 'lens', 'wire', 'amber', 'red', 'rev', 'chrome', 'black', 'gloss', 'carbon', 'alu', 'rim', 'polish',
    'barrelIn', 'mirrorGlass', 'accent', 'rubber', 'disc', 'caliper', 'seat', 'cage', 'hub'];
  const ALIAS = { jeskoAcc: 'accent' }; // mats 裡叫別的名字的（chrome 在烘焙時就改叫 rim 了；這裡的 chrome＝車身上低的鍍鉻）
  const NC = 32, CUSTOM0 = ROLES.length; // 後面幾格給每台車自己的材質（custom）
  const R = Object.fromEntries(ROLES.map((r, i) => [r, i]));
  const lin = (h) => new THREE.Color(h); // sRGB hex → 線性
  const grey = (v) => new THREE.Color(v, v, v);
  // [顏色, 粗糙度, 金屬感, 清漆]：車身遮罩那幾類照 masks.js patchPaint 的值（線性色），零件照 parts.js MAT
  const FIXED = {
    trim: [grey(0.012), 0.2, 0, 0.2], matte: [grey(0.02), 0.8, 0, 0], lamp: [new THREE.Color(0.86, 0.88, 0.9), 0.14, 1, 1], chrome: [new THREE.Color(0.86, 0.88, 0.9), 0.14, 1, 1],
    amber: [new THREE.Color(1, 0.45, 0.05), 0.12, 0, 1], red: [new THREE.Color(0.38, 0, 0.01), 0.12, 0.1, 1], rev: [grey(0.85), 0.2, 0, 1], hub: [lin(0x34363a), 0.6, 0.3, 0],
    black: [lin(0x0a0a0b), 0.5, 0, 0], gloss: [lin(0x050506), 0.15, 0, 1], carbon: [lin(0x17181b), 0.3, 0.1, 1], alu: [lin(0xc9ccd0), 0.28, 1, 0],
    polish: [lin(0xdadde2), 0.1, 1, 0], barrelIn: [lin(0x9aa0a6), 0.35, 1, 0], mirrorGlass: [lin(0xffffff), 0.02, 1, 0], rubber: [lin(0x0c0c0d), 0.82, 0, 0],
    disc: [lin(0x6d6f72), 0.45, 0.9, 0], seat: [lin(0x1c1d20), 0.8, 0, 0], cage: [lin(0xd8dadc), 0.45, 0.2, 0],
  };
  const RIM_LOOK = { chrome: [0xe8eaec, 1, 0.07], gunmetal: [0x4b4f55, 1, 0.3], black: [0x16171a, 0.5, 0.35], gold: [0xd2a646, 1, 0.18], white: [0xf0f0f0, 0, 0.3] }; // 跟車庫一樣
  // 漆面 [粗糙度, 金屬感, 清漆, 清漆粗糙度, 珍珠]（跟 supra.js buildCar 的 FIN 一樣，少了亮片）
  const FIN = { gloss: [0.16, 0.02, 1, 0.012, 0], metal: [0.3, 0.6, 1, 0.03, 0], matte: [0.62, 0.12, 0.001, 0.6, 0], pearl: [0.22, 0.3, 1, 0.02, 1] };
  const ACCENT = { red: '#d3142a', green: '#5fd12a' }; // Jesko 的點綴色（jesko-look.js），none＝碳纖維黑
  // lens、wire 照這台車的比例混（make-lod.mjs 算好放在材質 extras.mix）：燈裡暗玻璃蓋在鍍鉻上、網子（金屬線）蓋在黑底上，跟 patchPaint 的 mix 一樣
  const LENS = (m) => [new THREE.Color(0.86, 0.88, 0.9).lerp(new THREE.Color(0.1, 0.11, 0.13), m), 0.14 + (0.05 - 0.14) * m, (1 - m) * (1 - m), 1];
  const WIRE = (c) => [grey(0.012).lerp(new THREE.Color(0.22, 0.23, 0.24), c), 0.2 + 0.2 * c, 0.8 * c, 1 - Math.max(c, 0.8 * (1 - c))];
  const INSIDE = lin(0x2c2e33); // 車殼背面＝從玻璃看進去的車內（沒有座椅、儀表，用中間偏暗的灰代替）

  // ---- 讀 glb（同一個 gltf.scene 只讀一次，組很多台共用）----
  const PREP = new WeakMap();
  function prep(root) {
    let d = PREP.get(root);
    if (d) return d;
    root.updateMatrixWorld(true);
    const nodes = new Map(), customs = [], mix = { lens: 1, wire: 0.45 };
    const toCar = (attr, m, normal) => { // 量化的 glb 頂點 → 車身座標（公尺）
      const n = attr.count, o = new Float32Array(n * 3), v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m);
      for (let i = 0; i < n; i++) { v.fromBufferAttribute(attr, i); if (normal) v.applyMatrix3(nm).normalize(); else v.applyMatrix4(m); o[i * 3] = v.x; o[i * 3 + 1] = v.y; o[i * 3 + 2] = v.z; }
      return o;
    };
    root.traverse((o) => {
      if (!o.isMesh) return;
      let nd = o; while (nd && !nd.userData.lod) nd = nd.parent;
      if (!nd) return;
      const mat = o.material, role = mat.userData.role || mat.name;
      if ((role === 'lens' || role === 'wire') && mat.userData.mix !== undefined) mix[role] = mat.userData.mix;
      let cls = R[ALIAS[role] || role];
      if (cls === undefined) { // 這台車自己的材質（最多 6 種，再多的用第一種）
        let j = customs.findIndex((c) => c.mat === mat);
        if (j < 0 && customs.length < NC - CUSTOM0) {
          const c = mat.color;
          j = customs.length;
          customs.push({ mat, col: c.clone(), rough: mat.roughness, metal: mat.metalness, cc: mat.userData.cc || 0, emi: mat.emissive.clone(), red: c.r > 0.05 && c.g < 0.1 * c.r && c.b < 0.1 * c.r }); // 紅的（尾燈）：開燈、踩煞車會亮
        }
        cls = CUSTOM0 + Math.max(0, j);
      }
      if (!nodes.has(nd)) nodes.set(nd, { ud: nd.userData, P: toCar(o.geometry.attributes.position, o.matrixWorld, false), N: toCar(o.geometry.attributes.normal, o.matrixWorld, true), prims: [] });
      nodes.get(nd).prims.push({ cls, idx: o.geometry.index.array }); // 同一個 node 的 primitive 共用頂點
    });
    const pieces = [];
    for (const nd of nodes.values()) {
      let P = nd.P, N = nd.N, prims = nd.prims;
      const n = P.length / 3;
      if (nd.ud.half) { // 半邊 → 整台（z 鏡射，三角形反過來繞）
        const P2 = new Float32Array(n * 6), N2 = new Float32Array(n * 6);
        P2.set(P); N2.set(N);
        for (let i = 0; i < n; i++) { P2[(n + i) * 3] = P[i * 3]; P2[(n + i) * 3 + 1] = P[i * 3 + 1]; P2[(n + i) * 3 + 2] = -P[i * 3 + 2]; N2[(n + i) * 3] = N[i * 3]; N2[(n + i) * 3 + 1] = N[i * 3 + 1]; N2[(n + i) * 3 + 2] = -N[i * 3 + 2]; }
        prims = prims.map(({ cls, idx }) => { const I = new Uint32Array(idx.length * 2); I.set(idx); for (let t = 0; t < idx.length; t += 3) { I[idx.length + t] = idx[t] + n; I[idx.length + t + 1] = idx[t + 2] + n; I[idx.length + t + 2] = idx[t + 1] + n; } return { cls, idx: I }; });
        P = P2; N = N2;
      }
      const C = new Uint8Array(P.length / 3), op = [], gl = [];
      for (const { cls, idx } of prims) { for (let t = 0; t < idx.length; t++) C[idx[t]] = cls; (cls === R.glass ? gl : op).push(idx); }
      const cat = (L) => { const o = new Uint32Array(L.reduce((a, x) => a + x.length, 0)); let k = 0; for (const x of L) { o.set(x, k); k += x.length; } return o; };
      pieces.push({ lod: nd.ud.lod, kits: nd.ud.kits || ['*'], wing: nd.ud.wing ?? null, wide: !!nd.ud.wide, P, N, C, I: cat(op), G: cat(gl) });
    }
    const bb = new THREE.Box3(), v = new THREE.Vector3(); // 車身＋車頭的外框（底盤燈用）
    for (const p of pieces) if (p.lod !== 'part') for (let i = 0; i < p.P.length; i += 3) bb.expandByPoint(v.fromArray(p.P, i));
    d = { pieces, customs, mix, bb, geos: new Map() };
    PREP.set(root, d);
    return d;
  }
  // 這組外觀（套件、尾翼、寬體）要的車身網格：不透明的＋玻璃（共用頂點）；同一台車同樣組合的共用（算引用數）
  function bodyGeo(d, kit, wing, wide) {
    const vk = `${kit}|${wing}|${wide}`;
    let e = d.geos.get(vk);
    if (e) { e.refs++; return e; }
    const use = d.pieces.filter((p) => (p.kits.includes('*') || p.kits.includes(kit)) && (p.wing === null || p.wing === wing) && (!p.wide || wide));
    const nv = use.reduce((a, p) => a + p.P.length / 3, 0), P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Uint8Array(nv);
    const I = new Uint32Array(use.reduce((a, p) => a + p.I.length, 0)), G = new Uint32Array(use.reduce((a, p) => a + p.G.length, 0));
    let o = 0, oi = 0, og = 0;
    for (const p of use) {
      P.set(p.P, o * 3); N.set(p.N, o * 3); C.set(p.C, o);
      for (let t = 0; t < p.I.length; t++) I[oi + t] = p.I[t] + o;
      for (let t = 0; t < p.G.length; t++) G[og + t] = p.G[t] + o;
      o += p.P.length / 3; oi += p.I.length; og += p.G.length;
    }
    const pa = new THREE.BufferAttribute(P, 3), na = new THREE.BufferAttribute(N, 3), ca = new THREE.BufferAttribute(C, 1);
    const mk = (idx) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', pa); g.setAttribute('normal', na); g.setAttribute('lodCls', ca); g.setIndex(new THREE.BufferAttribute(nv < 65536 ? new Uint16Array(idx) : idx, 1)); g.computeBoundingSphere(); g.computeBoundingBox(); return g; };
    e = { opaque: mk(I), glass: mk(G), refs: 1, key: vk };
    d.geos.set(vk, e);
    return e;
  }
  function releaseGeo(d, e) {
    if (--e.refs > 0) return;
    e.opaque.dispose(); e.glass.dispose(); d.geos.delete(e.key);
  }

  // ---- 輪子（低面數）：輪胎、輪框筒內側、碟盤＋帽、卡鉗 → 跟車身同一個材質（類別表）；輪框：輪唇＋輪框面（貼輪框圖）----
  // 右輪外側朝 +z；左輪是右輪對 z 鏡射（跟完整的車一樣：卡鉗都在碟盤後上方）
  function axles(spec, wide) {
    const W = spec.wheels;
    return [[W.xf, W.trackF, W.wF, W.RF ?? W.R, W.rimF ?? W.rim, 'f'], [W.xr, W.trackR, W.wR, W.RR ?? W.R, W.rimR ?? W.rim, 'r']]
      .map(([x, track, w, Rr, rim, ax]) => ({ x, z: track + (wide ? WIDE_PUSH[ax] : 0), w, R: Rr, rim, ax }));
  }
  function builder() {
    const P = [], N = [], C = [], U = [], K = [], I = [];
    return {
      P, N, C, U, K, I,
      // 一圈旋轉面：prof＝[[r, 軸向 z], ...]（右輪座標），seg 段；s＝±1（左輪鏡射）；cls 類別；uvR：有的話給貼圖座標（輪框用），k：輪框轉的倍數（1／半徑）
      // 面朝「角度方向 × 剖面方向」那邊（＝算出來的法線那邊）
      lathe(prof, seg, c, s, cls, { uvR = 0, k = 0, a0 = 0, a1 = Math.PI * 2 } = {}) {
        const o = P.length / 3, full = a1 - a0 >= Math.PI * 2 - 1e-6, cols = full ? seg : seg + 1;
        const tn = prof.map((p, i) => { const a = prof[Math.max(0, i - 1)], b = prof[Math.min(prof.length - 1, i + 1)]; const dr = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dr, dz) || 1; return [dz / l, -dr / l]; }); // 剖面法線
        for (let i = 0; i < prof.length; i++) for (let j = 0; j < cols; j++) {
          const a = a0 + ((a1 - a0) * j) / seg, ca = Math.cos(a), sa = Math.sin(a), [r, z] = prof[i], [nr, nz] = tn[i];
          P.push(c.x + ca * r, c.y + sa * r, c.z + s * z); N.push(ca * nr, sa * nr, s * nz); C.push(cls);
          U.push(0.5 + (ca * r) / (2 * (uvR || 1)), 0.5 + (sa * r) / (2 * (uvR || 1))); K.push(k);
        }
        for (let i = 0; i < prof.length - 1; i++) for (let j = 0; j < seg; j++) {
          const a = o + i * cols + j, b = o + i * cols + ((j + 1) % cols), cc = a + cols, dd = b + cols;
          if (s > 0) I.push(a, b, cc, b, dd, cc); else I.push(a, cc, b, b, cc, dd);
        }
      },
      // 平的面（多邊形，右輪座標的 [x, y]，逆時針；法線 +z，back＝朝 −z）
      cap(pts, z, c, s, cls, back = false) {
        const o = P.length / 3;
        for (const [x, y] of pts) { P.push(c.x + x, c.y + y, c.z + s * z); N.push(0, 0, s * (back ? -1 : 1)); C.push(cls); U.push(0, 0); K.push(0); }
        for (let i = 1; i < pts.length - 1; i++) { if ((s > 0) !== back) I.push(o, o + i, o + i + 1); else I.push(o, o + i + 1, o + i); }
      },
      geo(uv) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
        if (uv) { g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('aRimK', new THREE.Float32BufferAttribute(K, 1)); } else g.setAttribute('lodCls', new THREE.Float32BufferAttribute(C, 1));
        g.setIndex(I); g.computeBoundingSphere(); return g;
      },
    };
  }
  const WGEO = new Map(); // 輪子網格：同一台車、同樣寬體共用
  function wheelGeo(key, spec, wide) {
    const k = `${key}|${wide}`;
    let e = WGEO.get(k);
    if (e) { e.refs++; return e; }
    const B = builder();
    for (const A of axles(spec, wide)) for (const s of [1, -1]) {
      const c = { x: A.x, y: A.R, z: s * A.z }, w = A.w, Rr = A.R, rim = A.rim;
      // 輪胎剖面（跟 parts.js wheel() 一樣，少幾個點）：內側胎唇 → 胎壁 → 胎面 → 外側胎壁 → 外側胎唇
      B.lathe([[rim + 0.004, -w / 2 + 0.012], [Rr - 0.045, -w / 2], [Rr - 0.006, -w / 2 + 0.024], [Rr, -w / 2 + 0.05], [Rr, w / 2 - 0.05], [Rr - 0.006, w / 2 - 0.024],
        [Rr - 0.03, w / 2 - 0.004], [Rr - 0.055, w / 2], [rim + 0.02, w / 2 - 0.002], [rim + 0.004, w / 2 - 0.012]], 32, c, s, R.rubber);
      // 輪框筒內側（從輪框的縫、斜斜的看進去；完整的車從外面看進去是背面、畫不出來，看到的是後面暗暗的輪胎內側、煞車，所以用暗灰）
      B.lathe([[rim - 0.012, w / 2 - 0.004], [rim - 0.018, w / 2 - 0.03], [rim - 0.018, -w / 2 + 0.03]], 24, c, s, R.hub);
      // 碟盤（正面）＋碟盤帽
      const disc = [], hat = [];
      for (let j = 0; j < 24; j++) { const a = (j / 24) * Math.PI * 2; disc.push([Math.cos(a) * 0.17, Math.sin(a) * 0.17]); hat.push([Math.cos(a) * 0.085, Math.sin(a) * 0.085]); }
      B.cap(disc, w / 2 - 0.096, c, s, R.disc);
      B.lathe([[0.085, w / 2 - 0.096], [0.085, w / 2 - 0.06]], 16, c, s, R.disc);
      B.cap(hat, w / 2 - 0.06, c, s, R.disc);
      // 卡鉗：r 0.118–0.198 的一段弧，在碟盤後上方（轉 0.64π）
      const a0 = Math.PI * 0.64 - 0.31, a1 = Math.PI * 0.64 + 0.31, zf = w / 2 - 0.073, zb = w / 2 - 0.147, arc = [];
      for (let j = 0; j <= 6; j++) arc.push(a0 + ((a1 - a0) * j) / 6);
      B.cap([...arc.map((a) => [Math.cos(a) * 0.198, Math.sin(a) * 0.198]), ...arc.slice().reverse().map((a) => [Math.cos(a) * 0.118, Math.sin(a) * 0.118])], zf, c, s, R.caliper);
      B.lathe([[0.198, zb], [0.198, zf]], 6, c, s, R.caliper, { a0, a1 });
      B.lathe([[0.118, zf], [0.118, zb]], 6, c, s, R.caliper, { a0, a1 });
      for (const a of [a0, a1]) { // 兩端（法線朝弧的外面）
        const e0 = [Math.cos(a), Math.sin(a)], o = B.P.length / 3, sgn = a === a0 ? -1 : 1, nx = -Math.sin(a) * sgn, ny = Math.cos(a) * sgn;
        for (const [r, z] of [[0.118, zb], [0.198, zb], [0.198, zf], [0.118, zf]]) { B.P.push(c.x + e0[0] * r, c.y + e0[1] * r, c.z + s * z); B.N.push(nx, ny, 0); B.C.push(R.caliper); B.U.push(0, 0); B.K.push(0); }
        if ((sgn > 0) === (s > 0)) B.I.push(o, o + 2, o + 1, o, o + 3, o + 2); else B.I.push(o, o + 1, o + 2, o, o + 2, o + 3);
      }
    }
    e = { geo: B.geo(false), refs: 1, key: k };
    WGEO.set(k, e);
    return e;
  }
  function releaseWheel(e) {
    if (--e.refs > 0) return;
    e.geo.dispose(); WGEO.delete(e.key);
  }
  // 輪框：每個輪子一片輪唇（輪框筒外緣，r rim±0.013，貼在胎唇前面）＋一片輪框面（r＜rim−0.013，在輻條的平均深度）
  function rimGeo(spec, wide, zFace) {
    const B = builder();
    for (const A of axles(spec, wide)) {
      const Rt = A.rim + 0.015, z = zFace + (A.w - spec.wheels.wF) / 2; // 輪框面的深度跟外緣走（後輪比較寬就往外）
      for (const s of [1, -1]) {
        const c = { x: A.x, y: A.R, z: s * A.z };
        B.lathe([[A.rim + 0.013, A.w / 2 + 0.001], [A.rim - 0.013, A.w / 2 + 0.001]], 32, c, s, 0, { uvR: Rt, k: 1 / A.R });
        B.lathe([[A.rim - 0.013, z], [0.0001, z]], 32, c, s, 0, { uvR: Rt, k: 1 / A.R });
      }
    }
    return B.geo(true);
  }

  // ---- 輪框圖：把完整的車那個樣式的輪框（parts.js wheel()，不含輪胎）從正面光柵化 ----
  // 顏色貼圖 RGBA：rgb＝自己的顏色（跟輪框同色的部分是白的）、a＝有沒有東西（alphaTest）
  // 法線貼圖 RGBA：rgb＝法線（切線空間 x→u、y→v）、a＝材質：1＝輪框色（mats.chrome）、0.5＝自己顏色的金屬（拋光輪唇、鋁）、0＝自己顏色的不是金屬（黑、碳纖維⋯）
  // 縮圖（mipmap）的透明度會照原本的覆蓋率放大，遠看輻條才不會變細不見
  // 前後輪框大小不一樣的（918、SP3、Jesko）用前輪的圖（樣式一樣，貼圖座標照各自的大小，只差一點比例）
  const RIMTEX = new Map();
  function rimTex(styleKey, style, Rr, w, rim) {
    const key = `${styleKey}|${rim.toFixed(4)}|${w.toFixed(3)}`;
    if (RIMTEX.has(key)) return RIMTEX.get(key);
    const tag = (code, c = 0xffffff) => { const m = new THREE.MeshBasicMaterial({ color: c }); m.userData.lodRim = code; return m; };
    const mats = { chrome: tag(1), polish: tag(0.5, 0xdadde2), alu: tag(0.5, 0xc9ccd0), black: tag(0, 0x0a0a0b), gloss: tag(0, 0x050506), carbon: tag(0, 0x17181b), rubber: tag(0, 0x0c0c0d),
      disc: tag(0.5, 0x6d6f72), caliper: tag(0, 0x9da1a6), barrelIn: tag(0.5, 0x9aa0a6), mirrorGlass: tag(0.5), seat: tag(0, 0x1c1d20), cage: tag(0, 0xd8dadc) };
    const { wheel: g } = wheel({ R: Rr, width: w, rim, mats, style });
    if (typeof style === 'string' && RIM_POLISH[style]) g.getObjectByName('barrel').material = mats.polish; // 跟 buildCar setRim 一樣：這些樣式的輪唇是拋光的
    g.updateMatrixWorld(true);
    const S = 256, H = 128, Rt = rim + 0.015;
    const v = new THREE.Vector3(), nm = new THREE.Matrix3();
    const D4 = [1, 0, -1, 0, 0, 1, 0, -1]; // 上下左右（迴圈裡不要一直做新的陣列：手機上 GC 很貴）
    // 從正面光柵化（N×N），留最前面的那一面；zb：深度、nb：法線、cb：rgb＋材質碼
    const raster = (N) => {
      const k = N / (2 * Rt), zb = new Float32Array(N * N).fill(-1e9), nb = new Float32Array(N * N * 3), cb = new Float32Array(N * N * 4);
      g.traverse((o) => {
        if (!o.isMesh || o.name === 'tire') return;
        const geo = o.geometry, pos = geo.attributes.position, nor = geo.attributes.normal, idx = geo.index, m = o.material, n = pos.count;
        const code = m.userData.lodRim ?? 0, own = code < 1, col = m.color || new THREE.Color(1, 1, 1), cr = own ? col.r : 1, cg = own ? col.g : 1, cbv = own ? col.b : 1;
        nm.getNormalMatrix(o.matrixWorld);
        // 頂點先轉好（x、y 換成像素，z 留公尺）、法線轉到輪子座標；沒有法線的用面法線
        const X = new Float32Array(n * 3), NN = nor ? new Float32Array(n * 3) : null;
        for (let i = 0; i < n; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); X[i * 3] = (v.x + Rt) * k; X[i * 3 + 1] = (v.y + Rt) * k; X[i * 3 + 2] = v.z;
          if (nor) { v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); NN[i * 3] = v.x; NN[i * 3 + 1] = v.y; NN[i * 3 + 2] = v.z; }
        }
        const ia = idx ? idx.array : null, nt = (idx ? idx.count : n) / 3;
        for (let t = 0; t < nt; t++) {
          const i0 = (ia ? ia[t * 3] : t * 3) * 3, i1 = (ia ? ia[t * 3 + 1] : t * 3 + 1) * 3, i2 = (ia ? ia[t * 3 + 2] : t * 3 + 2) * 3;
          const ax = X[i0], ay = X[i0 + 1], az = X[i0 + 2], bx = X[i1], by = X[i1 + 1], bz = X[i1 + 2], cx = X[i2], cy = X[i2 + 1], cz = X[i2 + 2];
          const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
          if (area <= 1e-9) continue; // 背面、側面（跟視線平行）不畫
          let fx = 0, fy = 0, fz = 1;
          if (!nor) { const ux = (bx - ax) / k, uy = (by - ay) / k, uz = bz - az, wx = (cx - ax) / k, wy = (cy - ay) / k, wz = cz - az; fx = uy * wz - uz * wy; fy = uz * wx - ux * wz; fz = ux * wy - uy * wx; const l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l; }
          const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx, cx))), y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(N - 1, Math.ceil(Math.max(ay, by, cy)));
          for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
            const PX = px + 0.5, PY = py + 0.5;
            const w0 = ((bx - PX) * (cy - PY) - (by - PY) * (cx - PX)) / area, w1 = ((cx - PX) * (ay - PY) - (cy - PY) * (ax - PX)) / area, w2 = 1 - w0 - w1;
            if (w0 < 0 || w1 < 0 || w2 < 0) continue;
            const z = w0 * az + w1 * bz + w2 * cz, p = py * N + px;
            if (z <= zb[p]) continue;
            zb[p] = z;
            let nx = fx, ny = fy, nz = fz;
            if (nor) { nx = w0 * NN[i0] + w1 * NN[i1] + w2 * NN[i2]; ny = w0 * NN[i0 + 1] + w1 * NN[i1 + 1] + w2 * NN[i2 + 1]; nz = w0 * NN[i0 + 2] + w1 * NN[i1 + 2] + w2 * NN[i2 + 2]; }
            if (nz < 0.05) nz = 0.05; const l = Math.hypot(nx, ny, nz); nb[p * 3] = nx / l; nb[p * 3 + 1] = ny / l; nb[p * 3 + 2] = nz / l;
            cb[p * 4] = cr; cb[p * 4 + 1] = cg; cb[p * 4 + 2] = cbv; cb[p * 4 + 3] = code;
          }
        }
      });
      return { zb, nb, cb };
    };
    const { zb, nb, cb } = raster(S), k = S / (2 * Rt);
    // 256 → 128（2×2 平均）；輪框面的平均深度（r 0.3～0.85 輪框）
    const col = new Float32Array(H * H * 4), nrm = new Float32Array(H * H * 4), zAt = new Float32Array(H * H);
    let zs = 0, zn = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < H; x++) {
      let a = 0, c0 = 0, c1 = 0, c2 = 0, c3 = 0, n0 = 0, n1 = 0, n2 = 0, zz = 0;
      for (let s = 0; s < 4; s++) {
        const dx = s & 1, dy = s >> 1, p = (y * 2 + dy) * S + x * 2 + dx;
        if (zb[p] < -1e8) continue;
        a++; c0 += cb[p * 4]; c1 += cb[p * 4 + 1]; c2 += cb[p * 4 + 2]; c3 += cb[p * 4 + 3]; n0 += nb[p * 3]; n1 += nb[p * 3 + 1]; n2 += nb[p * 3 + 2]; zz += zb[p];
        const r = Math.hypot((x * 2 + dx + 0.5) / k - Rt, (y * 2 + dy + 0.5) / k - Rt);
        if (r > 0.3 * rim && r < 0.85 * rim) { zs += zb[p]; zn++; }
      }
      const q = (y * H + x) * 4;
      if (a) { col[q] = c0 / a; col[q + 1] = c1 / a; col[q + 2] = c2 / a; nrm[q + 3] = c3 / a; const l = Math.hypot(n0, n1, n2) || 1; nrm[q] = n0 / l; nrm[q + 1] = n1 / l; nrm[q + 2] = n2 / l; zAt[y * H + x] = zz / a; } else { nrm[q + 2] = 1; }
      col[q + 3] = a / 4;
    }
    const zFace = zn ? zs / zn : w / 2 - 0.03;
    // 斜斜的看（上下左右 15°）：輻條有深度，斜看會比正面粗（看得到側面）→ 每個有東西的像素照它離輪框面的深度往四個方向「拖」一段
    //（拖過的地方算有，顏色、法線、材質用拖它的那個像素）；完整的車停在車位上多半是斜斜的看
    const T = Math.tan((15 * Math.PI) / 180), kH = H / (2 * Rt), src = col.slice(), srcN = nrm.slice();
    for (let p = 0; p < H * H; p++) {
      if (src[p * 4 + 3] < 0.5) continue;
      const len = Math.abs(zAt[p] - zFace) * T * kH, x = p % H, y = (p / H) | 0;
      if (len < 0.5) continue;
      for (let d = 0; d < 8; d += 2) for (let st = 0.5; st <= len; st += 0.5) {
        const X = Math.round(x + D4[d] * st), Y = Math.round(y + D4[d + 1] * st);
        if (X < 0 || Y < 0 || X >= H || Y >= H) break;
        const q = (Y * H + X) * 4;
        if (col[q + 3] >= 0.5) continue;
        for (let j = 0; j < 3; j++) { col[q + j] = src[p * 4 + j]; nrm[q + j] = srcN[p * 4 + j]; }
        nrm[q + 3] = srcN[p * 4 + 3]; col[q + 3] = 0.75;
      }
    }
    g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    // 沒東西的像素：顏色、法線抄旁邊有東西的（邊緣內插才不會變黑）
    for (let pass = 0; pass < 2; pass++) for (let y = 0; y < H; y++) for (let x = 0; x < H; x++) {
      const q = (y * H + x) * 4; if (col[q + 3] > 0) continue;
      for (let d = 0; d < 8; d += 2) { const X = x + D4[d], Y = y + D4[d + 1]; if (X < 0 || Y < 0 || X >= H || Y >= H) continue; const r = (Y * H + X) * 4; if (col[r + 3] > 0) { for (let j = 0; j < 3; j++) { col[q + j] = col[r + j]; nrm[q + j] = nrm[r + j]; } nrm[q + 3] = nrm[r + 3]; break; } }
    }
    for (let i = 0; i < nrm.length; i += 4) for (let j = 0; j < 3; j++) nrm[i + j] = nrm[i + j] * 0.5 + 0.5;
    const tex = (arr, isCol) => { // 自己做 mipmap：顏色圖的透明度照覆蓋率放大；法線圖重新正規化
      const levels = []; let W = H, cur = arr;
      let cov0 = 0; for (let i = 3; i < arr.length; i += 4) if (arr[i] >= 0.5) cov0++; cov0 /= arr.length / 4;
      for (;;) {
        const u8 = new Uint8ClampedArray(W * W * 4); // 自己會夾在 0～255、四捨五入
        for (let i = 0; i < cur.length; i++) u8[i] = cur[i] * 255;
        levels.push({ data: new Uint8Array(u8.buffer), width: W, height: W });
        if (W === 1) break;
        const w2 = W / 2, nx = new Float32Array(w2 * w2 * 4);
        for (let y = 0; y < w2; y++) for (let x = 0; x < w2; x++) for (let j = 0; j < 4; j++) {
          nx[(y * w2 + x) * 4 + j] = (cur[((y * 2) * W + x * 2) * 4 + j] + cur[((y * 2) * W + x * 2 + 1) * 4 + j] + cur[((y * 2 + 1) * W + x * 2) * 4 + j] + cur[((y * 2 + 1) * W + x * 2 + 1) * 4 + j]) / 4;
        }
        if (isCol) {
          let lo = 1, hi = 8;
          for (let it = 0; it < 12; it++) { const m = (lo + hi) / 2; let c = 0; for (let i = 3; i < nx.length; i += 4) if (nx[i] * m >= 0.5) c++; if (c / (w2 * w2) < cov0) lo = m; else hi = m; }
          for (let i = 3; i < nx.length; i += 4) nx[i] = Math.min(1, nx[i] * hi);
        } else for (let i = 0; i < nx.length; i += 4) { const l = Math.hypot(nx[i] * 2 - 1, nx[i + 1] * 2 - 1, nx[i + 2] * 2 - 1) || 1; for (let j = 0; j < 3; j++) nx[i + j] = ((nx[i + j] * 2 - 1) / l) * 0.5 + 0.5; }
        cur = nx; W = w2;
      }
      const t = new THREE.DataTexture(levels[0].data, H, H, THREE.RGBAFormat);
      t.mipmaps = levels; t.generateMipmaps = false; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4; t.needsUpdate = true;
      return t;
    };
    const out = { map: tex(col, true), nmap: tex(nrm, false), z: zFace };
    RIMTEX.set(key, out);
    return out;
  }

  // ---- 材質 ----
  // 車身（也給輪胎＋煞車用）：MeshPhysical＋類別表；背面＝車內（暗的）；珍珠只上在車漆
  function bodyMaterial(tab) {
    const m = new THREE.MeshPhysicalMaterial({ roughness: 0.5, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, tab.U);
      sh.vertexShader = `#define LOD_N ${NC}\nattribute float lodCls; uniform vec4 uLodC[LOD_N]; uniform vec4 uLodM[LOD_N]; uniform vec3 uLodE[LOD_N];\nvarying vec3 vLodC; varying vec4 vLodM; varying vec3 vLodE;\n`
        + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  { int ci = int(lodCls + 0.5); vLodC = uLodC[ci].rgb; vLodM = vec4(uLodM[ci].xyz, uLodC[ci].a); vLodE = uLodE[ci]; }`);
      sh.fragmentShader = 'uniform vec3 uLodIn;\nvarying vec3 vLodC; varying vec4 vLodM; varying vec3 vLodE;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = gl_FrontFacing ? vLodC : uLodIn;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = gl_FrontFacing ? vLodM.x : 0.9;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = gl_FrontFacing ? vLodM.y : 0.0;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  if (gl_FrontFacing) totalEmissiveRadiance += vLodE;')
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= gl_FrontFacing ? vLodM.z : 0.0;
#endif
#ifdef USE_IRIDESCENCE
  material.iridescence *= vLodM.w;
#endif`);
    };
    m.customProgramCacheKey = () => 'lodcar';
    return m;
  }
  function glassMaterial() { // 跟 masks.js patchGlass 一樣：反光越亮越不透明；只畫正面（雙面透明要畫兩次；對面的窗從裡面看不到也沒關係，看過去是車殼裡面或外面的景）
    const m = new THREE.MeshPhysicalMaterial({ color: 0x0b0d10, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.55, side: THREE.FrontSide, depthWrite: false, envMapIntensity: 1.8 });
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
  gl_FragColor.a = clamp(diffuseColor.a + max(max(outgoingLight.r, outgoingLight.g), outgoingLight.b) * 0.9, 0.0, 1.0);`);
    };
    m.customProgramCacheKey = () => 'lodglass';
    return m;
  }
  function rimMaterial() { // 輪框：顏色貼圖＋法線貼圖（a＝跟輪框同色）；uRoll 轉輪框（貼圖座標繞中心轉 開的距離／半徑）
    const u = { uRoll: { value: 0 }, uRimCol: { value: new THREE.Color(1, 1, 1) } };
    const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.1, metalness: 1, alphaTest: 0.5, side: THREE.FrontSide });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = 'attribute float aRimK; uniform float uRoll;\n' + sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
  { float ra = uRoll * aRimK; mat2 rr = mat2(cos(ra), sin(ra), -sin(ra), cos(ra));
#ifdef USE_MAP
  vMapUv = rr * (vMapUv - 0.5) + 0.5;
#endif
#ifdef USE_NORMALMAP
  vNormalMapUv = rr * (vNormalMapUv - 0.5) + 0.5;
#endif
  }`);
      sh.fragmentShader = 'uniform vec3 uRimCol;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
  float rimCode = 1.0;
#ifdef USE_NORMALMAP
  rimCode = texture2D(normalMap, vNormalMapUv).a;
#endif
  float rimW = clamp(rimCode * 2.0 - 1.0, 0.0, 1.0), metW = clamp(rimCode * 2.0, 0.0, 1.0);
  diffuseColor.rgb *= mix(vec3(1.0), uRimCol, rimW);`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(mix(0.45, 0.12, metW), roughnessFactor, rimW);')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = mix(mix(0.1, 1.0, metW), metalnessFactor, rimW);');
    };
    m.customProgramCacheKey = () => 'lodrim';
    m.userData.u = u;
    return m;
  }

  // ---- 組一台 ----
  function buildLodCar(key, gltfScene, look = {}) {
    const spec = KEYS.includes(key) ? SPEC(key) : null;
    if (!spec) throw new Error('沒有這台車：' + key);
    const d = prep(gltfScene);
    const cur = { ...BASE, ...DEF(key), ...look };
    const car = new THREE.Group(); car.name = 'lodcar-' + key;
    const body = new THREE.Group(); body.name = 'body'; car.add(body);
    // 類別表（這台車自己的，換外觀只改數字）
    const tab = { C: new Float32Array(NC * 4), M: new Float32Array(NC * 4), E: new Float32Array(NC * 3) };
    tab.U = { uLodC: { value: tab.C }, uLodM: { value: tab.M }, uLodE: { value: tab.E }, uLodIn: { value: INSIDE } };
    const setCls = (i, col, rough, metal, cc, paintW = 0) => { tab.C.set([col.r, col.g, col.b, paintW], i * 4); tab.M.set([rough, metal, cc, 0], i * 4); };
    for (const [r, v] of Object.entries(FIXED)) setCls(R[r], ...v);
    setCls(R.lens, ...LENS(d.mix.lens)); setCls(R.wire, ...WIRE(d.mix.wire));
    d.customs.forEach((c, j) => setCls(CUSTOM0 + j, c.col, c.rough, c.metal, c.cc));
    const bm = bodyMaterial(tab), gm = glassMaterial(), rm = rimMaterial();
    const bodyMesh = new THREE.Mesh(undefined, bm), glassMesh = new THREE.Mesh(undefined, gm), wheelMesh = new THREE.Mesh(undefined, bm), rimMesh = new THREE.Mesh(undefined, rm);
    bodyMesh.name = 'lod-body'; glassMesh.name = 'lod-glass'; glassMesh.renderOrder = 2; wheelMesh.name = 'lod-wheels'; rimMesh.name = 'lod-rims';
    body.add(bodyMesh, glassMesh); car.add(wheelMesh, rimMesh);
    let geo = null, wgeo = null, glow = null;
    const applied = {};

    const paintCol = new THREE.Color();
    function paint() {
      paintCol.set(cur.paint || spec.paint);
      let f = FIN[cur.finish];
      if (!f) { // 原廠漆面：918 照顏色（P918_FINISH），其他台跟 buildCar 一樣
        const p = key === 'p918' ? P918_FINISH[paintCol.getHexString()] || [0.3, 0.12, 1] : null;
        f = p ? [p[0], p[1], p[2], p[2] < 0.5 ? 0.6 : 0.03, 0] : [0.3, spec.metal ?? 0.2, 1, 0.03, 0];
      }
      setCls(R.paint, paintCol, f[0], f[1], f[2], 1);
      bm.clearcoatRoughness = f[3];
      bm.iridescence = f[4]; bm.iridescenceIOR = 2; bm.iridescenceThicknessRange = [100, 380];
      tab.M[R.trim * 4 + 2] = 0.2 * f[2]; // 黑飾條的清漆跟著車漆（patchPaint：×0.2）
    }
    function lights() {
      tab.E.fill(0);
      for (const [i, c] of d.customs.entries()) tab.E.set([c.emi.r, c.emi.g, c.emi.b], (CUSTOM0 + i) * 3);
      if (cur.lights) { tab.E.set([2.2, 2.1, 1.9], R.lamp * 3); tab.E.set([1.6, 1.55, 1.45], R.lens * 3); } // 低的鍍鉻（chrome）不亮
      const red = cur.brake ? 3.2 : cur.lights ? 1.2 : 0;
      if (red) { tab.E.set([red, red * 0.03, red * 0.02], R.red * 3); d.customs.forEach((c, j) => { if (c.red) tab.E.set([red * 0.8, red * 0.02, red * 0.01], (CUSTOM0 + j) * 3); }); }
    }
    function rimLook() {
      const rv = cur.rim || 'chrome', l = RIM_LOOK[rv] || [rv, 1, 0.15];
      const c = new THREE.Color(l[0]);
      rm.userData.u.uRimCol.value.copy(c); rm.metalness = l[1]; rm.roughness = l[2];
      setCls(R.rim, c, l[2], l[1], 0);
    }
    function rimStyle() { // 輪框樣式（貼圖）、寬體（輪框位置）有變才重做
      const k = cur.rimStyle && cur.rimStyle !== 'stock' ? cur.rimStyle : 'stock';
      if (applied.rimStyle === k && applied.rimWide === applied.wideOn) return;
      const A = axles(spec, false)[0], f = rimTex(k === 'stock' ? key + ':stock' : k, k === 'stock' ? spec.wheels.style : k, A.R, A.w, A.rim);
      rm.map = f.map; rm.normalMap = f.nmap; rm.needsUpdate = true;
      if (rimMesh.geometry) rimMesh.geometry.dispose();
      rimMesh.geometry = rimGeo(spec, applied.wideOn, f.z);
      applied.rimStyle = k; applied.rimWide = applied.wideOn;
    }
    function shape() { // 套件、尾翼、寬體 → 車身網格；寬體 → 輪子往外
      const wide = cur.wide === 'on' && d.pieces.some((p) => p.wide);
      const wing = cur.wing || spec.wing, kit = cur.kit || spec.kit;
      if (!geo || applied.kit !== kit || applied.wing !== wing || applied.wideOn !== wide) {
        const g = bodyGeo(d, kit, wing, wide);
        if (geo) releaseGeo(d, geo);
        geo = g; bodyMesh.geometry = g.opaque; glassMesh.geometry = g.glass;
      }
      if (!wgeo || applied.wideOn !== wide) {
        const w = wheelGeo(key, spec, wide);
        if (wgeo) releaseWheel(wgeo);
        wgeo = w; wheelMesh.geometry = w.geo;
      }
      applied.kit = kit; applied.wing = wing; applied.wideOn = wide;
    }
    function setLook(l = {}) {
      Object.assign(cur, l);
      paint(); lights();
      setCls(R.caliper, new THREE.Color(cur.caliper || '#9da1a6'), 0.3, 0.3, 0.8);
      const acc = key === 'jesko' && cur.livery !== 'none' ? ACCENT[cur.livery] || ACCENT.red : '#17181b';
      setCls(R.accent, new THREE.Color(acc), 0.3, 0.1, 1);
      rimLook();
      shape();
      rimStyle();
      gm.opacity = cur.tint === 'dark' ? 0.74 : 0.46; // 沒有車內：比完整的車（0.34／0.66）深一點
      body.position.y = +cur.height || 0;
      if (cur.glow && cur.glow !== 'none') {
        if (!glow) { const bb = d.bb; glow = neonPad(bb.min.x, bb.max.x, Math.max(bb.max.z, -bb.min.z)); car.add(glow); }
        glow.setColor(cur.glow); glow.visible = true;
      } else if (glow) glow.visible = false;
      if (glow) glow.scale.y = applied.wideOn ? 1 + Math.max(WIDE_PUSH.f, WIDE_PUSH.r) / (Math.max(d.bb.max.z, -d.bb.min.z) + 0.5) : 1; // 寬體：光也寬一點
      api.tris = [bodyMesh, glassMesh, wheelMesh, rimMesh].reduce((a, m) => a + m.geometry.index.count / 3, 0) + (glow && glow.visible ? 2 : 0);
      return api;
    }
    const api = {
      car, body, key, tris: 0, look: cur, meshes: { body: bodyMesh, glass: glassMesh, wheels: wheelMesh, rims: rimMesh },
      setLook,
      setRoll(dist) { rm.userData.u.uRoll.value = dist; }, // 開了多遠（公尺）：輪框轉 dist／半徑
      get draws() { return 4 + (glow && glow.visible ? 1 : 0); },
      dispose() {
        car.removeFromParent();
        if (geo) releaseGeo(d, geo); geo = null;
        if (wgeo) releaseWheel(wgeo); wgeo = null;
        if (rimMesh.geometry) rimMesh.geometry.dispose();
        if (glow) { glow.geometry.dispose(); glow.material.dispose(); }
        bm.dispose(); gm.dispose(); rm.dispose(); // 輪框圖是大家共用的（不放掉：7 台 × 7 種樣式也才幾 MB）
      },
    };
    setLook();
    return api;
  }
  return { buildLodCar, LOD_CARS };
})();


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
// 豪華車庫（room.js）：第一次用到才蓋。鏡面地板要把車再畫一次，手機太慢就換成不反射的亮面地板（記在手機裡，下次直接用）
let seat = null; // 坐在車裡（cabin.js）：{ 原本的鏡頭, yaw, pitch }；null＝在車外
const ROOMQ_KEY = 'carid.roomq';
let room = null, roomQ = (() => { try { return localStorage.getItem(ROOMQ_KEY) === 'low' ? 'low' : 'high'; } catch { return 'high'; } })();
let onCars = null; // town.src.js：換車、買車、車庫重蓋的時候把你其他的車停到車位（輕量車）
function makeRoom() {
  room = buildRoom(renderer, { quality: roomQ }); scene.add(room.group); room.resize();
  if (roomQ === 'high' && window.__roomWatch !== false) watchRoom(room);
  onCars?.();
}
function watchRoom(R) { // 看車庫畫面前 90 張的間隔（先跳過 40 張，第一次要編譯），中位數超過 45 毫秒（一秒不到 22 張）就換
  const ts = []; let last = 0, skip = 40;
  const tick = (now) => {
    if (room !== R) return;
    if (!R.group.visible || RACE.on || DRIVE.on || document.hidden) { last = 0; requestAnimationFrame(tick); return; } // 比賽、開車出門的時候沒在畫車庫
    if (last && skip-- <= 0) ts.push(now - last);
    last = now;
    if (ts.length < 90) { requestAnimationFrame(tick); return; }
    ts.sort((a, b) => a - b);
    if (ts[45] <= 45) return;
    roomQ = 'low'; try { localStorage.setItem(ROOMQ_KEY, 'low'); } catch { /* 不給存就算了 */ }
    scene.environment = ENV.dark; R.group.removeFromParent(); R.interior.clear(); R.dispose(); room = null; // 車位上的車先拿下來（makeRoom 再停回去）
    makeRoom(); setStudio(studioKind);
  };
  requestAnimationFrame(tick);
}
function setStudio(kind) {
  const isRoom = kind === 'room';
  if (isRoom && !room) makeRoom();
  if (room) room.group.visible = isRoom;
  floor.visible = !isRoom; // 攝影棚的地板會跟鏡面地板打架
  if (isRoom) {
    room.setTrophies(trophyCount());
    scene.environment = room.env; scene.background = new THREE.Color(0x060708); scene.fog = null;
    stage.style.background = '#060708'; status.style.color = '#9AA1AC';
    return;
  }
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
  if (room) room.resize();
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (seat) { camera.fov = cabinFov(cur, camera.aspect); camera.updateProjectionMatrix(); return; } // 車內的視角另外算（fitD 要用車外的）
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
const trophyCount = () => Object.values(GAME.wins).filter((n) => n > 0).length; // 豪華車庫的獎盃：贏過幾個不同的對手
const partsOf = (k) => (GAME.parts[k] ||= []);
const tyresOf = (k) => (GAME.tyres[k] ||= { own: [], use: 0 });
const tyreOf = (k) => GAME.tyres[k]?.use ?? 0;
const hpOf = (k) => PERF[k].hp + PERF[k].parts.reduce((a, p) => a + (partsOf(k).includes(p[0]) ? p[3] : 0), 0);
const money = (w) => (w >= 10000 ? `${+(w / 10000).toFixed(2)} 億` : `${w.toLocaleString('en-US')} 萬`);
const byPrice = (keys) => [...keys].sort((a, b) => PERF[a].price - PERF[b].price); // 照價錢排（便宜的在前面）
const COMMON_OPTS = { wide: [['off', '原廠'], ['on', '寬體']], tint: [['light', '淺'], ['dark', '深']], studio: [['room', '豪華車庫'], ['light', '亮攝影棚'], ['dark', '暗攝影棚']],
  finish: [['stock', '原廠'], ['gloss', '亮面'], ['metal', '金屬'], ['matte', '消光'], ['pearl', '珍珠']],
  rimStyle: [['stock', '原廠'], ['five', '五輻'], ['six', '六輻'], ['multi', '多輻'], ['mesh', '網狀'], ['dish', '深碟'], ['fan', '風扇']] };
// 底盤燈：車底下地上的光（'none'＝不要）
const GLOWS = [['none', '不要', 'linear-gradient(135deg, transparent 44%, #e0413b 44% 56%, transparent 56%), #2a2c31'],
  ...[['#2f7bff', '藍'], ['#9b4dff', '紫'], ['#22e07a', '綠'], ['#ff2d3d', '紅'], ['#ff7a1a', '橘'], ['#f2f3f5', '白']].map(([c, n]) => [c, n, `radial-gradient(circle, #fff 0 14%, ${c} 44%, #15161a 100%)`])];
for (const C of Object.values(CARS)) Object.assign(C.state, { wide: 'off', finish: 'stock', rimStyle: 'stock', glow: 'none', ...C.state }); // 寬體、烤漆、輪框樣式、底盤燈每台都有，預設原廠／不要（加在最後，套用順序跟以前一樣）
// 每台車都多幾個顏色（那台車本來就有很像的顏色、或同名的就不重複加）
const EXTRA_PAINTS = [['#ff5fa2', '粉紅'], ['#39a7ff', '天空藍'], ['#9bea1a', '螢光綠'], ['#c8a45d', '香檳金'], ['#ff7414', '橘'], ['#5b2d9e', '紫']];
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const alike = (a, b) => { const x = rgbOf(a), y = rgbOf(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 48; };
for (const C of Object.values(CARS)) C.paints = [...C.paints, ...EXTRA_PAINTS.filter(([hex, name]) => !C.paints.some((p) => alike(p[0], hex) || p[1] === name))];
// 每台車多幾種尾翼（wings.js 照每台車的車尾做的；Yaris 是掀背沒有鴨尾），加在「不要」前面
const WING_NAMES = { gt: 'GT 大尾翼', duck: '鴨尾', swan: '鵝頸尾翼', double: '雙層尾翼', lip: '碳纖維小尾翼' };
for (const [k, C] of Object.entries(CARS)) {
  const have = new Set(C.opts.wing.map((o) => o[0]));
  const more = Object.keys(extraWings(k)).filter((w) => !have.has(w)).map((w) => [w, WING_NAMES[w] || w]);
  const i = C.opts.wing.findIndex((o) => o[0] === 'none');
  C.opts.wing = [...C.opts.wing.slice(0, i < 0 ? undefined : i), ...more, ...(i < 0 ? [] : C.opts.wing.slice(i))];
}
for (const C of Object.values(CARS)) C.opts.livery = livOptions(C.opts.livery); // 通用拉花：火焰、賽車條紋、大便龍車隊（名字撞到車子自己的，用 'gen:' 開頭）
const DEFAULT_LOOK = Object.fromEntries(Object.entries(CARS).map(([k, C]) => [k, { ...C.state }])); // 每台車原本的樣子（對手的車從這個改）
const CALIPERS = [['#9da1a6', '銀'], ['#c8141e', '紅'], ['#f2b705', '黃'], ['#1f54c9', '藍'], ['#ff6a1f', '橘'], ['#9bd400', '螢光綠'], ['#17181b', '黑']];
const RIMS = [['chrome', '鍍鉻', 'conic-gradient(#8a9099, #f4f6f8, #8a9099, #f4f6f8, #8a9099)'], ['gunmetal', '槍灰', '#4b4f55'], ['black', '黑', '#1a1c20'], ['gold', '金', '#c9a043'], ['white', '白', '#f2f3f5']];
const RIM_LOOK = { chrome: [0xe8eaec, 1, 0.07], gunmetal: [0x4b4f55, 1, 0.3], black: [0x16171a, 0.5, 0.35], gold: [0xd2a646, 1, 0.18], white: [0xf0f0f0, 0, 0.3] };
let studioKind = 'room', cur = 'gc8', rideY = 0;
const SAVE_KEY = 'carid.tune';
// 存在這支手機：v2 起多了錢、車、零件、輪胎、贏過誰（now＝馬上存，錢有變的時候用）
function save(now) {
  clearTimeout(save.t);
  const write = () => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 2, cur, scene: studioKind, money: GAME.money, owned: [...GAME.owned], parts: GAME.parts, tyres: GAME.tyres, wins: GAME.wins,
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
  if (o === 'glow') return has(GLOWS);
  return has(C.opts[o] || COMMON_OPTS[o]);
}
(function restore() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { d = null; }
  if (!d || typeof d !== 'object') return;
  if (['room', 'light', 'dark'].includes(d.scene)) studioKind = d.scene; // 場景存在 scene；舊存檔的 studio 不管（以前都自動存了亮的，大家會看不到豪華車庫）
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
  if (CARS[d.cur] && GAME.owned.has(d.cur)) cur = d.cur; // 車庫裡只停你的車（還沒買的在車店）
})();
setStudio(studioKind); // 預設豪華車庫
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
  if (key === 'rimStyle') S.setRim(v);
  if (key === 'finish') S.setFinish(v);
  if (key === 'glow') S.setGlow(v);
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
  const car = buildCar({ ...C.spec, wings: { ...C.spec.wings, ...extraWings(key) } }, carGeos(gltf.scene), { wide: WIDE[key] }); // 多的尾翼（wings.js）
  for (const [k, v] of Object.entries(look)) if (k !== 'height') apply(car, k, v);
  car.body.position.y = +look.height;
  const cab = buildCabin(key, C.spec, car.mats); // 細的車內（儀表、方向盤、座椅⋯）換掉原本簡單的
  if (cab.children.length) {
    const old = car.body.getObjectByName('interior');
    if (old) { car.body.remove(old); old.traverse((o) => o.geometry && o.geometry.dispose()); }
    car.body.add(cab); car.cabin = cab; cab.userData.setGauges(0.13, 0);
  }
  return car;
}

const carsEl = document.getElementById('cars');
async function showCar(key) {
  cur = key; save();
  carsEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.car === key)));
  document.getElementById('carName').textContent = CARS[key].name;
  document.getElementById('carSub').textContent = CARS[key].sub;
  renderOptions(); onCars?.();
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
  b.append(t, s2); b.addEventListener('click', () => {
    if (!GAME.owned.has(k)) { gtoast(`${C.btn[0]} 在車店：開車出門去車店買`, 2200); return; } // 車庫裡只有你的車
    if (k !== cur) showCar(k);
  });
  carsEl.append(b);
}
// 車子按鈕：你的車寫「你的車」，還沒買的寫價錢（鎖起來）
function refreshCarBtns() {
  carsEl.querySelectorAll('button').forEach((b) => {
    const k = b.dataset.car, own = GAME.owned.has(k);
    b.classList.toggle('locked', !own);
    b.querySelector('span').textContent = own ? '你的車' : `車店 ${money(PERF[k].price)}`;
  });
  onCars?.();
}
refreshCarBtns();

// ---- 引擎聲（sound.js）：車庫的「聽引擎聲」、開車出門、賽道共用；聲音開關記在這支手機 ----
const SOUND_KEY = 'carid.sound';
const engineAudio = createEngineAudio({ muted: (() => { try { return localStorage.getItem(SOUND_KEY) === 'off'; } catch { return false; } })() });
const sndBtns = document.querySelectorAll('.snd'); // 聲音開關：賽道一個、開車一個（一起變）
function setSound(on) {
  engineAudio.setMuted(!on);
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* 不給存就算了 */ }
  sndBtns.forEach((b) => b.setAttribute('aria-pressed', String(on)));
}
sndBtns.forEach((b) => {
  b.setAttribute('aria-pressed', String(!engineAudio.muted));
  b.addEventListener('click', () => { engineAudio.resume(); setSound(engineAudio.muted); });
});
// 聽引擎聲：怠速 → 踩到底到紅線 → 放掉回怠速（裝的排氣、渦輪、頭段會改變聲音），車子跟著抖一下
const revBtn = document.getElementById('revBtn');
let rev = null;
function stopRev() {
  if (!rev) return;
  cancelAnimationFrame(rev.raf); rev.v.dispose(); if (rev.S) { rev.S.body.rotation.x = 0; rev.S.cabin?.userData.setGauges(0.13, 0); }
  rev = null; revBtn.setAttribute('aria-pressed', 'false');
}
revBtn.addEventListener('click', () => {
  if (rev) { stopRev(); return; }
  if (!S) return;
  if (engineAudio.muted) setSound(true); // 按了就是想聽
  engineAudio.resume();
  const key = cur, idle = 0.13, T0 = 0.7, T1 = T0 + 1.3, END = 4.8;
  rev = { v: engineAudio.voice(key, { parts: partsOf(key) }), S, t0: performance.now(), rpm: idle, last: performance.now() };
  revBtn.setAttribute('aria-pressed', 'true');
  const tick = (now) => {
    if (!rev) return;
    const t = (now - rev.t0) / 1000, dt = Math.min(0.05, (now - rev.last) / 1000); rev.last = now;
    const thr = t >= T0 && t < T1 ? 1 : 0;
    if (thr) { rev.rpm += (1.04 - rev.rpm) * Math.min(1, dt * 3.2); if (rev.rpm > 1) rev.rpm = 0.985 + Math.random() * 0.02; }
    else rev.rpm += (idle - rev.rpm) * Math.min(1, dt * (rev.rpm > 0.5 ? 1.5 : 2.2));
    rev.v.set({ rpm: rev.rpm, throttle: thr }); rev.S.cabin?.userData.setGauges(rev.rpm, 0); // 坐在車裡看得到轉速表跳
    rev.th = (rev.th || 0) + (thr - (rev.th || 0)) * Math.min(1, dt * 6); // 踩油門車身往一邊側一點（引擎扭力），轉速越高抖越快
    if (rev.S === S && !calm) rev.S.body.rotation.x = -0.012 * rev.th + Math.sin(t * (40 + 90 * rev.rpm)) * 0.0012 * rev.rpm;
    if (t > END || rev.S !== S || RACE.on) { stopRev(); return; }
    rev.raf = requestAnimationFrame(tick);
  };
  rev.raf = requestAnimationFrame(tick);
});

// 手指一碰就停止自動轉
const spinBtn = document.getElementById('spin');
const stopSpin = () => { controls.autoRotate = false; spinBtn.setAttribute('aria-pressed', 'false'); hint.style.opacity = '0'; };
renderer.domElement.addEventListener('pointerdown', stopSpin);
spinBtn.addEventListener('click', () => {
  if (seat) { getOut(); controls.autoRotate = true; } else controls.autoRotate = !controls.autoRotate;
  spinBtn.setAttribute('aria-pressed', String(controls.autoRotate));
});
document.querySelectorAll('#views button[data-a]').forEach((b) => b.addEventListener('click', () => { getOut(); stopSpin(); view(+b.dataset.a); }));
// 坐進車裡：鏡頭放到駕駛的眼睛（cabinCamera 每一格跟著車身），手指拖著畫面轉頭；按其他視角、再按一次「車內」或去比賽就下車
const HINT = hint.textContent, seatBtn = document.getElementById('seatBtn');
let headDrag = null;
function sitIn() {
  if (seat || !S) return;
  seat = { pos: camera.position.clone(), q: camera.quaternion.clone(), up: camera.up.clone(), fov: camera.fov, near: camera.near, spin: controls.autoRotate, yaw: 0, pitch: 0, key: cur };
  controls.enabled = false; controls.autoRotate = false; spinBtn.setAttribute('aria-pressed', 'false');
  camera.near = 0.02; camera.fov = cabinFov(cur, camera.aspect); camera.updateProjectionMatrix();
  seatBtn.setAttribute('aria-pressed', 'true'); hint.textContent = '手指拖著畫面可以轉頭看'; hint.style.opacity = '1';
}
function getOut() {
  if (!seat) return;
  camera.position.copy(seat.pos); camera.quaternion.copy(seat.q); camera.up.copy(seat.up);
  camera.fov = seat.fov; camera.near = seat.near; camera.updateProjectionMatrix();
  controls.enabled = true; controls.autoRotate = seat.spin; spinBtn.setAttribute('aria-pressed', String(seat.spin));
  seat = null; headDrag = null; resize(); controls.update();
  seatBtn.setAttribute('aria-pressed', 'false'); hint.textContent = HINT;
}
seatBtn.addEventListener('click', () => { if (seat) getOut(); else sitIn(); });
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!seat) return;
  headDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: seat.yaw, pitch: seat.pitch };
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* 沒有就算了 */ }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!seat || !headDrag || e.pointerId !== headDrag.id) return;
  const k = camera.fov / stage.clientHeight; // 抓著畫面拖：手指移多少，畫面就跟著移多少
  seat.yaw = Math.max(-130, Math.min(130, headDrag.yaw - (e.clientX - headDrag.x) * k));
  seat.pitch = Math.max(-60, Math.min(50, headDrag.pitch + (e.clientY - headDrag.y) * k));
});
for (const t of ['pointerup', 'pointercancel']) renderer.domElement.addEventListener(t, (e) => { if (headDrag && e.pointerId === headDrag.id) headDrag = null; });

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
// 錢（車庫上面、改車廠裡面各一個）
const cashEl = document.getElementById('cash'), shopCashEl = document.getElementById('shopCash'), dealerCashEl = document.getElementById('dealerCash');
function renderWallet() { cashEl.textContent = shopCashEl.textContent = dealerCashEl.textContent = `NT$ ${money(GAME.money)}`; }
// 車庫裡的提示（買了什麼、錢不夠）
const gtoastEl = document.getElementById('gtoast');
function gtoast(text, ms = 1400) {
  gtoastEl.textContent = text; gtoastEl.classList.add('show');
  clearTimeout(gtoast.t); gtoast.t = setTimeout(() => gtoastEl.classList.remove('show'), ms);
}
const short = (cost) => `還差 ${money(cost - GAME.money)}，去比賽贏錢`;
// 引擎零件、輪胎要開車去改車廠（town.src.js）才買得到：shop＝畫在改車廠裡（可以買）；車庫裡只看得到裝了哪些
// 改車廠裡的話寫在零件上面那行（手機上畫面在上面，捲下來看零件的時候看不到畫面裡的提示）
const shopMsgEl = document.getElementById('shopMsg');
const say = (shop, text) => { if (shop) shopMsgEl.textContent = text; else gtoast(text, 1800); };
// 要花錢的按兩次才買（跟「買這台」一樣，免得按錯）：第一次按價錢變「再按一次」，3.5 秒內再按一次才買
function twoTap(b) {
  const p = b.querySelector('.p');
  if (b.classList.contains('armed')) { clearTimeout(twoTap.t); return true; }
  document.querySelectorAll('#shop .armed').forEach((x) => { x.classList.remove('armed'); x.querySelector('.p').textContent = x.dataset.p; });
  b.dataset.p = p.textContent; b.classList.add('armed'); p.textContent = '再按一次';
  clearTimeout(twoTap.t); twoTap.t = setTimeout(() => { b.classList.remove('armed'); p.textContent = b.dataset.p; }, 3500);
  return false;
}
function shopItems() { partsOpts(true); tyreOpts(true); }
// 引擎零件：每台車不一樣，買了就裝上（馬力加上去），比賽照這個算
function partsOpts(shop = false) {
  const el = document.getElementById(shop ? 'shopParts' : 'parts'), P = PERF[cur], have = partsOf(cur);
  document.getElementById(shop ? 'shopEng' : 'engName').textContent = `${P.eng} · 現在 ${hpOf(cur).toLocaleString('en-US')} 匹`;
  el.replaceChildren();
  for (const [id, name, what, hp, cost] of P.parts) {
    const on = have.includes(id), b = document.createElement('button');
    b.type = 'button'; b.className = 'part ' + (on ? 'on' : shop && GAME.money >= cost ? 'can' : 'cant'); b.setAttribute('aria-pressed', String(on));
    const t = document.createElement('b'), d = document.createElement('span'), h = document.createElement('span'), p = document.createElement('span');
    t.textContent = name; d.className = 'd'; d.textContent = what; h.className = 'hp'; h.textContent = `+${hp} 匹`;
    p.className = 'p'; p.textContent = on ? '已裝' : money(cost);
    b.append(t, h, d, p);
    b.addEventListener('click', () => {
      if (have.includes(id)) { say(shop, '這個已經裝好了'); return; }
      if (!shop) { say(shop, '引擎零件要開車去改車廠買'); return; }
      if (GAME.money < cost) { say(shop, short(cost)); return; }
      if (!twoTap(b)) { say(shop, `${name}要 ${money(cost)}，再按一次就裝上去`); return; }
      GAME.money -= cost; have.push(id); save(true);
      renderWallet(); renderOptions(); shopItems(); say(shop, `裝好${name}了，+${hp} 匹！`);
    });
    el.append(b);
  }
}
// 輪胎：原廠胎／半熱熔胎／直線加速胎，在改車廠買；買過的在改車廠換回來不用錢
function tyreOpts(shop = false) {
  const el = document.getElementById(shop ? 'shopTyres' : 'tyres'), T = tyresOf(cur), prices = PERF[cur].tyres;
  el.replaceChildren();
  for (const [n, name, what] of TYRES) {
    const own = n === 0 || T.own.includes(n), cost = n ? prices[n - 1] : 0, b = document.createElement('button');
    b.type = 'button'; b.setAttribute('aria-pressed', String(T.use === n));
    if (shop ? !own && GAME.money < cost : T.use !== n) b.className = 'cant'; // 車庫裡：沒在用的都暗一點
    const t = document.createElement('b'), d = document.createElement('span'), p = document.createElement('span');
    t.textContent = name; d.className = 'd'; d.textContent = what; p.className = 'p';
    p.textContent = T.use === n ? '用這個' : own ? (shop ? '換上' : '買過了') : money(cost);
    b.append(t, d, p);
    b.addEventListener('click', () => {
      if (T.use === n) return;
      if (!shop) { say(shop, '輪胎要開車去改車廠換'); return; }
      if (!own) {
        if (GAME.money < cost) { say(shop, short(cost)); return; }
        if (!twoTap(b)) { say(shop, `${name}要 ${money(cost)}，再按一次就換上`); return; }
        GAME.money -= cost; T.own.push(n);
      }
      T.use = n; save(true);
      renderWallet(); renderOptions(); shopItems(); say(shop, `換上${name}了`);
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
  document.getElementById('driveOut').hidden = !own; buyBtn.hidden = true; // 買車要開去車店（town.src.js）
  if (!own) return;
  partsOpts(); tyreOpts();
  chips(document.getElementById('paints'), CARS[cur].paints, 'paint');
  chips(document.getElementById('rims'), RIMS, 'rim');
  chips(document.getElementById('calipers'), CALIPERS, 'caliper');
  chips(document.getElementById('glows'), GLOWS, 'glow');
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
  Object.assign(GAME, { money: 0, owned: new Set(['gc8']), parts: {}, tyres: {}, wins: {} }); room?.setTrophies(0);
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
// 要自己開車去（town.src.js）：開進起跑區，車子停到起跑線就交給這裡（enterRace）；「開回村子」「直接回車庫」也在 town.src.js
// 賽道和小村莊（village.js）在同一個場景（TR.scene）：村子在起跑線西邊（x < −55）
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
  { id: 'courier', name: '送貨小哥', sub: '趕著送貨', key: 'gc8', hp: 400, tyre: 1, drv: 'good', prize: 25, parts: ['exhaust', 'turbo'], look: { paint: '#c3c8ce', rim: 'gunmetal', wing: 'lip', livery: 'none' } },
  { id: 'nightmarket', name: '夜市小霸王', sub: '車子整台都是紫的', key: 'supra', hp: 650, tyre: 1, drv: 'good', prize: 60, parts: ['exhaust', 'intake', 'ecu'], look: { paint: '#5b2d9e', rim: 'chrome', rimStyle: 'fan', glow: '#9b4dff', wing: 'gt', kit: 'bomex', livery: 'flames' } },
  { id: 'shop', name: '修車廠老闆', sub: '自己改的 R34', key: 'gtr', hp: 750, tyre: 1, drv: 'good', prize: 150, parts: ['exhaust', 'turbo', 'ecu'], look: { paint: '#141518', rim: 'gunmetal', rimStyle: 'mesh', wing: 'swan', kit: 'stock', livery: 'none' } },
  { id: 'club', name: '超跑俱樂部會長', sub: '車庫停滿超跑', key: 'p918', hp: 887, tyre: 1, drv: 'good', prize: 800, look: { paint: '#c5c9ce', finish: 'pearl', livery: 'none' } },
  { id: 'touge', name: '山道之王', sub: '山路沒輸過', key: 'gtr', hp: 900, tyre: 2, drv: 'pro', prize: 1200, parts: ['exhaust', 'intake', 'turbo', 'ecu', 'cams'], look: { paint: '#1d4fc9', rimStyle: 'six', wing: 'gt', kit: 'track', livery: 'ff' } },
  { id: 'racer', name: '職業賽車手', sub: '每個週末都在比賽', key: 'sp3', hp: 1100, tyre: 2, drv: 'pro', prize: 2000, look: { livery: 'daytona' } },
  { id: 'boss', name: '大魔王', sub: '最後一關', key: 'jesko', hp: 1920, tyre: 2, drv: 'good', prize: 3000, parts: ['exhaust', 'turbo', 'ecu'], look: { paint: '#16171a', finish: 'matte', glow: '#ff2d3d', livery: 'red' } },
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
// 引擎聲：你一個、對手一個（engineAudio 在車庫那段）；進賽道就怠速，比賽時跟著轉速、油門、換檔
const snd = { me: null, op: null, opId: null };
function sndOpp(o) {
  if (snd.opId === o.id && snd.op?.alive) return;
  snd.op?.dispose(); snd.op = engineAudio.voice(o.key, { gain: 0.5, pan: -0.25, parts: o.parts || [] }); snd.opId = o.id;
}
function sndStop() { snd.me?.dispose(); snd.op?.dispose(); snd.me = snd.op = snd.opId = null; }

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
  const plane = (w, h, m, x, y, z, sx = 1, sz = 1) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h, sx, sz), m); p.rotation.x = -Math.PI / 2; p.position.set(x, y, z); T.add(p); return p; };
  // 草地：只鋪 x −62…1250（西邊是小村莊自己的草地，village.js）；切成 60 公尺左右的格子
  plane(1312, 900, mat({ color: 0x62704a, roughness: 1, map: canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#7d8c5d'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${40 + Math.random() * 40},${60 + Math.random() * 50},${25 + Math.random() * 25},0.35)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  }, [190, 130]) }), 594, -0.02, 0, 22, 15);
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
  // 樹（遠一點，兩邊；村子那邊 x < −55 不種，村子有自己的樹）＋遠山
  const NT = 170, cone = new THREE.ConeGeometry(1.6, 5, 7); cone.translate(0, 4.2, 0);
  const trunk = new THREE.CylinderGeometry(0.18, 0.25, 1.8, 6); trunk.translate(0, 0.9, 0);
  const trees = new THREE.InstancedMesh(cone, mat({ color: 0x3f5a32, roughness: 1 }), NT), trunks = new THREE.InstancedMesh(trunk, mat({ color: 0x5a4332, roughness: 1 }), NT);
  const q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
  for (let i = 0; i < NT; i++) {
    const s = i % 2 ? 1 : -1, x = -55 + Math.random() * (L1 + 80 + 55), z = s * (20 + Math.random() * 50), k = 0.7 + Math.random() * 0.8;
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
  sndOpp(o);
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
  stopRev(); getOut(); engineAudio.resume(); // 在點擊裡、await 之前；坐在車裡就先下車
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
  snd.me?.dispose(); snd.me = engineAudio.voice(cur, { parts: partsOf(cur) });
  TR.scene.add(S.car); S.car.visible = true; S.body.position.y = +CARS[cur].state.height;
  putCar(S, race.me, LANE, race.meInfo);
  hudIdle();
  showOpp();
  lastT = performance.now();
  stage.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
}
// village＝開回村子（車子留在賽道的場景，town.src.js 的開車接手）；沒有＝車子放回車庫
function exitRace(village = false) {
  if (!RACE.on) return;
  RACE.on = false; controls.enabled = !village;
  document.body.classList.remove('racing');
  raceEl.hidden = true; hudEl.hidden = true;
  if (!village) for (const Sx of [race.meS]) {
    if (!Sx || !Object.values(built).includes(Sx)) continue;
    scene.add(Sx.car); Sx.car.position.set(0, 0, 0); Sx.car.visible = Sx === S; Sx.wheels.forEach((w) => (w.rotation.z = 0));
  }
  dropOppCar(); sndStop();
  for (const f of TR.flames) f.visible = false;
  for (const s of TR.shadows) s.visible = false; // 開車的時候看得到賽道：比賽的影子收掉、燈樹熄掉
  lights(0, false, false);
  race = null;
  renderOptions(); refreshCarBtns(); // 錢可能變多了：零件、車子買不買得起要重畫
}
async function startRace() {
  if (!race || ['intro', 'stage', 'run'].includes(race.phase)) return;
  engineAudio.resume();
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
  sndOpp(o); if (!snd.me?.alive) snd.me = engineAudio.voice(cur, { parts: partsOf(cur) });
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
  if (q) snd.me?.shift();
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
    GAME.wins[o.id] = (GAME.wins[o.id] || 0) + 1; GAME.money += o.prize; save(true); renderWallet(); room?.setTrophies(trophyCount());
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
    note.textContent = race.foul ? '綠燈還沒亮就按了起步。等三個黃燈亮完、綠燈一亮再按。' : '沒拿到獎金。開去改車廠裝零件、換輪胎，或先挑一個慢一點的對手賺錢。';
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
        if (op.shiftT <= 0 && op.gear < 5 && op.rpm >= ai.shiftAt) { if (shift(op)) snd.op?.shift(); ai.shiftAt = ai.d.shift[0] + Math.random() * (ai.d.shift[1] - ai.d.shift[0]); }
        if (ai.nitroAt != null && !op.nitroUsed && R.t - op.go > ai.nitroAt) useNitro(op);
      }
    }
    const steps = Math.max(1, Math.ceil(dt / (1 / 240))), hs = dt / steps;
    for (let i = 0; i < steps; i++) { R.ts = R.t - dt + (i + 1) * hs; stepRacer(me, hs, R); if (op) stepRacer(op, hs, R); }
    if (R.phase === 'run' && me.fin != null && (op.fin != null || R.t - R.green - me.fin > 4)) finishRace();
    if (R.phase === 'run' && me.go == null && op.fin != null && R.t - R.green > op.fin + 2) finishRace();
  }
  // 引擎聲：起跑線上踩著等（起步控制頂在 0.6）、跑的時候全油門、換檔和過終點放油門；對手離越遠越小聲
  const feed = (v, c) => v?.set({ rpm: c.rpm, speed: c.v, limit: c.go == null ? 0.6 : 1,
    throttle: c.go == null ? (R.phase === 'stage' || R.phase === 'run' ? 1 : 0) : c.fin != null || c.shiftT > 0 ? 0 : 1 });
  if (R.phase === 'idle') { snd.me?.set({ rpm: 0.13, throttle: 0 }); snd.op?.set({ rpm: 0.13, throttle: 0 }); snd.op?.setGain(0.5); }
  else { feed(snd.me, me); if (op) { feed(snd.op, op); snd.op?.setGain(0.5 / (1 + Math.abs(op.x - me.x) / 25)); } }
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
$('raceGo').addEventListener('click', startRace); // 「開回村子」「直接回車庫」在 town.src.js


// ---- town.src.js ----
// ---- 開車出門：從你家的白色大理石車庫開鐵捲門開出去，在村子裡自己開：改車廠、車店都自己開進去，賽道比賽，快速道路開到極速 ----
// Nick 2026-09-27：「有小村莊有改車廠要比賽要自己開去小村莊裡的賽道」
// Nick 2026-09-28：「車庫要真的可以停車然後要可以開鐵捲門自己開出去⋯買車要的話是要開去車店然後就放那些還沒買到車他買完自己開回去然後打開鐵捲門然後就可以把它開進去自己的車庫⋯
//   修車廠那些的話是真的要自己開進去不是按按鈕然後直接傳送進去」
// 村子、賽道、你家在同一個場景（TR.scene，世界座標一樣）；村子和你家（room.js 另外蓋一棟低畫質的，擺在 places.garage.lot）第一次出門才蓋，蓋好就留著
// 出門：車子停在你家中間的轉盤上（車頭朝鐵捲門）→ 按「開鐵捲門」→ 自己開出去；你其他的車停在後牆的車位（輕量車 carlod.js）
// 改車廠、車店：自己開進去，停在「改車區／買車區」→ 下面打開改車廠（引擎零件、輪胎）／車店（還沒買的車擺在店裡）→「開走」自己開出去
//   車店買了車：新車停到店門口，開它回家；原本那台車行幫你送回車庫（停在車位）
// 回家：開到鐵捲門前面按「開鐵捲門」→ 開進去 →「停好熄火」：停到轉盤上，轉盤把車頭轉向門、鐵捲門關上 → 回到車庫頁
// 賽道：開進起跑區（慢一點）自己停到起跑線 → race.src.js 的 enterRace()；比完「開回村子」接著開，「直接回車庫」一下回到車庫
// 引擎聲：開車一個聲音（dvoice；踩著油門就一直有聲浪：drive.js 的 load）；比賽有自己的兩個，交給賽道前先收掉
// build-art.mjs 把這個檔案接在 race.src.js 後面（用得到 TR、buildTrack、enterRace、exitRace、S、GAME、engineAudio、room、built⋯）
const DRIVE = { on: false, frame: driveFrame };
const SHOP_NAME = '阿輝改車廠';
const driveBar = $('drivebar'), shopEl = $('shop'), dealerEl = $('dealer'), driveOutBtn = $('driveOut'), destBtns = [...document.querySelectorAll('#dests button')];
let VIL = null, GAR = null, drv = null, dcam = null, dvoice = null, trip = false, tripS = null, lastD = 0;
let home = null; // 你家：{ left（開出去過了才有「停好熄火」）, open（門的碰撞現在是開的還是關的）, park（停好了在轉盤上轉）, hw（說過快速道路了） }
let panelCam = 'chase', camGo = null; // 進改車廠、車店前的視角；鏡頭慢慢移過去（看車店的車）
const camAt = new THREE.Vector3(); // 鏡頭現在看的點（camGo 從這裡移）
const snooze = {}; // 剛比完：離開起跑區 30 公尺以前開回去不會又去比賽
const bayLock = {}; // 改車區、買車區：開走以後要先開出去，下次停進來才會再打開
$('shopName').textContent = SHOP_NAME;
const inBox = (r, x, z, m = 0) => { const dx = x - r.x, dz = z - r.z, c = Math.cos(r.rot || 0), s = Math.sin(r.rot || 0); return Math.abs(dx * c - dz * s) <= r.hx + m && Math.abs(dx * s + dz * c) <= r.hz + m; };
const forSale = () => byPrice(Object.keys(CARS).filter((k) => !GAME.owned.has(k))); // 車店擺的：還沒買的車（便宜的在前面）
const canBuy = () => forSale().some((k) => GAME.money >= PERF[k].price);
const dealerName = () => VIL?.places.dealer?.name || '阿財車行';

// ---- 停著的車（輕量車 carlod.js）：你的其他車停在車庫後牆的車位，還沒買的擺在車店 ----
// 一台車一份（LODS[key]），看現在在哪裡就搬過去：車庫頁的車庫（room，原點）、開車出門時村子裡你家（GAR）、車店的展示台
const LODS = {};
function lodFor(k) { // 有了就給；沒有就開始載入（載好了再排一次）
  if (LODS[k]) return LODS[k].lod;
  LODS[k] = { lod: null };
  LOD_CARS[k].load().then((sc) => {
    if (!LODS[k] || LODS[k].lod) return;
    const lod = buildLodCar(k, sc, CARS[k].state), box = new THREE.Box3().setFromObject(lod.car);
    LODS[k] = { lod, sig: JSON.stringify(CARS[k].state), cx: (box.min.x + box.max.x) / 2, cz: (box.min.z + box.max.z) / 2, hx: (box.max.x - box.min.x) / 2, hz: (box.max.z - box.min.z) / 2 };
    const sd = sh.clone(); // 車店轉盤上的影子（車位的影子車庫自己畫）：跟頁面那片同一個網格、材質，照車身大小放大
    sd.position.set(LODS[k].cx, 0.004, LODS[k].cz); sd.scale.set(LODS[k].hx / 2.2, LODS[k].hz / 0.97, 1); sd.visible = false;
    lod.car.add(sd); LODS[k].shadow = sd;
    arrangeCars();
  }).catch((e) => { console.error(e); delete LODS[k]; }); // 沒載到：下次排的時候再試
  return null;
}
function arrangeCars() {
  const inTown = !!(trip && GAR), R = inTown ? GAR : room; // 車庫頁是攝影棚（不是豪華車庫）就沒有車位
  const bays = byPrice([...GAME.owned].filter((k) => k !== cur)).slice(0, 6);
  const shows = inTown ? VIL.places.dealer?.display || [] : [], pads = forSale().slice(0, shows.length);
  const at = new Map();
  if (R) bays.forEach((k, i) => at.set(k, [R.interior || R.group, R.spots.bays[i]]));
  pads.forEach((k, i) => at.set(k, [VIL.group, shows[i]]));
  for (const k of Object.keys(CARS)) {
    const w = at.get(k);
    if (!w) { LODS[k]?.lod?.car.removeFromParent(); continue; }
    const lod = lodFor(k); if (!lod) continue;
    const sig = JSON.stringify(CARS[k].state);
    if (LODS[k].sig !== sig) { lod.setLook(CARS[k].state); LODS[k].sig = sig; } // 在車庫頁改過外觀
    w[0].add(lod.car); lod.car.position.set(w[1].x, w[1].y || 0, w[1].z); lod.car.rotation.set(0, w[1].heading || 0, 0); // 車店的轉盤比地面高一點（y）
    LODS[k].shadow.visible = w[0] === VIL?.group;
  }
  if (R) {
    const names = bays.map((k) => (LODS[k]?.lod ? CARS[k].btn[0] : null)), sig = names.join('|');
    if (R.baySig !== sig) { R.baySig = sig; R.setBays(names); } // 車位的名牌、地上的影子（有車才有）
  }
  if (inTown && drv) { // 停著的車開過去會撞到
    const list = [];
    const add = (k, p) => { const L = LODS[k]; if (!L?.lod) return; const c = Math.cos(p.heading || 0), s = Math.sin(p.heading || 0);
      list.push({ t: 'box', x: p.x + L.cx * c + L.cz * s, z: p.z - L.cx * s + L.cz * c, hx: L.hx, hz: L.hz, rot: p.heading || 0, h: 1.3 }); };
    bays.forEach((k, i) => add(k, garWorld(GAR.spots.bays[i])));
    pads.forEach((k, i) => add(k, shows[i]));
    drv.removeColliders('parked'); drv.addColliders(list, 'parked');
  }
}
onCars = arrangeCars; // 車庫頁換車、買車、重新開始、車庫重蓋的時候叫（garage.src.html）
arrangeCars();

// ---- 你家（村子裡那棟）：車庫裡的座標 ↔ 世界座標（車庫裡 x 往門外、z＝車頭朝門時車子的右邊）----
function garWorld(p) {
  const L = VIL.places.garage.lot, c = Math.cos(L.heading), s = Math.sin(L.heading);
  return { x: L.x + p.x * c + p.z * s, z: L.z - p.x * s + p.z * c, heading: (p.heading || 0) + L.heading };
}
function garLocal(x, z) {
  const L = VIL.places.garage.lot, c = Math.cos(L.heading), s = Math.sin(L.heading), dx = x - L.x, dz = z - L.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}
const garCols = (open) => GAR.colliders(open).map((b) => { const w = garWorld(b); return { ...b, x: w.x, z: w.z, rot: (b.rot || 0) + VIL.places.garage.lot.heading }; });

// ---- 開車出門：村子、你家第一次要蓋（等招牌的字型、蓋一下子），蓋好再出門 ----
async function enterDrive() {
  if (DRIVE.on || RACE.on || trip || enterDrive.busy) return;
  if (!S) { gtoast('車子還在開進車庫，等一下'); return; }
  if (!GAME.owned.has(cur)) return;
  stopRev(); getOut(); engineAudio.resume(); // 在點擊裡、await 之前；坐在車裡就先下車
  trip = true; controls.enabled = false;
  document.body.classList.add('driving'); // 車庫的東西先收起來（換車、選項），畫面變高
  if (!VIL) {
    enterDrive.busy = true;
    status.hidden = false; msg.textContent = '開出車庫中⋯'; prog.parentElement.hidden = true;
    await Promise.race([Promise.all([document.fonts.load('700 58px "Noto Sans TC"', '終點').catch(() => {}), villageFonts()]), new Promise((r) => setTimeout(r, 1600))]);
    await new Promise((r) => setTimeout(r, 30)); // 讓「開出車庫中」先畫出來（蓋村子要一下子，這時候畫面不會動）
    try {
      if (!TR) TR = buildTrack();
      VIL = buildVillage({ renderer }); TR.scene.add(VIL.group);
      const L = VIL.places.garage.lot;
      GAR = buildRoom(renderer, { quality: 'low', exterior: true }); // 村子裡看得到外牆、屋頂、招牌；地板不反射（省）
      GAR.group.position.set(L.x, 0, L.z); GAR.group.rotation.y = L.heading; TR.scene.add(GAR.group);
      $('dealerName').textContent = dealerName();
    } catch (e) {
      console.error(e); enterDrive.busy = false; msg.textContent = '村子沒蓋好，重新整理再試一次';
      if (VIL && !GAR) { VIL.group.removeFromParent(); VIL = null; } // 下次整個重蓋
      trip = false; controls.enabled = true; document.body.classList.remove('driving');
      return;
    }
    enterDrive.busy = false; status.hidden = true;
  }
  startDrive();
}
// 村子比較大：霧推遠一點、鏡頭看遠一點（賽道比賽用原本的）
let FOG0 = null;
function townFog(on) {
  const f = TR.scene.fog; if (!f) return;
  if (!FOG0) FOG0 = [f.near, f.far];
  [f.near, f.far] = on ? [150, 1500] : FOG0;
}
function startDrive() {
  tripS = S;
  DRIVE.on = true; controls.enabled = false;
  document.body.classList.add('driving'); driveBar.hidden = false;
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!dcam) dcam = new THREE.PerspectiveCamera(60, 1, 0.1, 2500);
  dcam.aspect = w / h; dcam.updateProjectionMatrix(); dcam.userData.w = w; dcam.userData.h = h;
  for (const s of TR.shadows) s.visible = false;
  for (const f of TR.flames) f.visible = false;
  townFog(true);
  for (const k of Object.keys(snooze)) delete snooze[k];
  for (const k of Object.keys(bayLock)) delete bayLock[k];
  GAR.door.t = 0; GAR.setTrophies(trophyCount());
  home = { left: false, open: null, park: null, hw: false };
  makeDrv(VIL.places.garage.spawn); // 停在你家中間的轉盤上，車頭朝鐵捲門；你其他的車搬到村子這棟的車位、還沒買的擺到車店
  setDest(canShop() ? 'shop' : canBuy() ? 'dealer' : 'track'); // 買得起東西就先帶你去買
  drv.toast('按「開鐵捲門」，開出去！', 2600);
  lastD = performance.now();
  stage.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
}
// 開車的（drive.js）：出門、改車廠開走（裝了零件馬力變了）、車店換新車都重新做一個
function makeDrv(pose) {
  const Sx = tripS;
  TR.scene.add(Sx.car); Sx.car.visible = true; Sx.body.position.y = +CARS[cur].state.height;
  // 駕駛座視角：車內（cabin.js）的眼睛；手機直拿畫面窄，視角放大一點（跟車庫的「車內」一樣）
  const eye = CABIN_VIEW[cur] ? { ...CABIN_VIEW[cur], fov: cabinFov(cur, dcam.aspect) } : undefined;
  drv = createDrive({ car: Sx, scene: TR.scene, camera: dcam, perf: { ...PERF[cur], hp: hpOf(cur) }, world: VIL, colliders: stripColliders(), hudParent: stage,
    onZone: arrive, onShift: () => dvoice?.shift(), onBump: bump, eye, keyboard: true, camButton: true });
  drv.teleport(pose);
  home.open = null; // 門的碰撞下一格放（照門現在開著還是關著）
  arrangeCars(); // 停著的車：搬到村子這棟的車位、車店，也放碰撞（開車的是新的）
  dvoice?.dispose(); dvoice = engineAudio.voice(cur, { parts: partsOf(cur) });
}
// 改車廠有沒有買得起的（還沒裝的引擎零件、還沒買的輪胎）
function canShop() {
  const P = PERF[cur], T = tyresOf(cur);
  return P.parts.some((p) => !partsOf(cur).includes(p[0]) && GAME.money >= p[4]) || [1, 2].some((n) => !T.own.includes(n) && GAME.money >= P.tyres[n - 1]);
}
function setDest(d) {
  drv?.setDestination(d);
  destBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.d === d)));
}
destBtns.forEach((b) => b.addEventListener('click', () => { if (DRIVE.on) setDest(b.dataset.d); }));
// 撞到東西：手機震一下（按過畫面才可以震）
function bump(s) {
  if (s > 3 && navigator.vibrate && navigator.userActivation?.hasBeenActive) try { navigator.vibrate(Math.min(60, s * 8)); } catch { /* 不能震就算了 */ }
}
// 開進哪裡（drive.js 的 onZone）：上快速道路說一聲可以開多快
function arrive(name, inside) {
  if (!inside || !DRIVE.on || !home) return;
  if (name === 'highway' && !home.hw) { home.hw = true; drv.toast(`上快速道路了：${CARS[cur].btn[0]} 可以開到 ${PERF[cur].vmax} km/h！`, 2800); }
}

// ---- 你家：鐵捲門（碰撞跟著門開關）、HUD 的大按鈕（開鐵捲門／停好熄火）、開遠了門自己關 ----
function homeAct(t) {
  const open = GAR.door.t >= 0.9;
  if (open !== home.open) { drv.removeColliders('garage'); drv.addColliders(garCols(open), 'garage'); home.open = open; }
  const p = garLocal(t.x, t.z), Z = GAR.zones, D = Z.door.x; // 門在 x = D
  const inside = inBox(Z.inside, p.x, p.z), front = p.x > D && p.x < D + 16 && Math.abs(p.z) < 9; // 門前面那塊
  if (!inside && p.x > D + 12) home.left = true;
  if (GAR.door.t === 1 && Math.hypot(p.x - D, p.z) > 30) GAR.door.close(); // 開遠了：遙控器關門
  if ((inside || front) && GAR.door.t === 0 && !GAR.door.moving) return { label: '開鐵捲門', icon: 'door', onClick: openDoor };
  if (inside && home.left && open && Math.hypot(p.x, p.z) < 9 && Math.abs(t.v) < 3) return { label: '停好熄火', icon: 'key', onClick: parkHome };
  return null;
}
function openDoor() {
  if (!GAR || GAR.door.t > 0 || GAR.door.moving) return;
  GAR.door.open(calm ? 1.2 : 2.2); drv?.setAction(null);
}
// 停好熄火：自己停到轉盤上（車頭朝裡面），熄火，轉盤把車頭轉向門、鐵捲門關上 → 回到車庫頁
function parkHome() {
  if (!DRIVE.on || home.park) return;
  home.park = { t: -1 }; drv.setAction(null);
  const L = VIL.places.garage.lot;
  drv.parkAt({ x: L.x, z: L.z, heading: L.heading + Math.PI }, () => {
    if (!DRIVE.on || !home?.park) return;
    drv.pause(); dvoice?.dispose(); dvoice = null;
    GAR.door.close(calm ? 1 : 1.8);
    home.park = { t: 0, T: calm ? 0.01 : 2.6, h0: tripS.car.rotation.y };
    drv.setCameraMode('none'); // 鏡頭站在門邊（裡面）看轉盤轉
    const c = garWorld({ x: 3.4, z: 5.6 }), a = garWorld({ x: -0.4, z: 0 });
    dcam.near = 0.1; dcam.fov = 58; dcam.updateProjectionMatrix();
    dcam.position.set(c.x, 2.3, c.z); camAt.set(a.x, 0.7, a.z); dcam.lookAt(camAt);
  });
}
function parkStep(dt) {
  const P = home.park; if (!P || P.t < 0) return;
  P.t = Math.min(P.T, P.t + dt);
  const s = P.t / P.T, e = s * s * (3 - 2 * s);
  tripS.car.rotation.y = P.h0 + Math.PI * e; // 轉半圈：車頭朝門（下次出門直接開出去）
  if (P.t >= P.T && GAR.door.t === 0 && !GAR.door.moving) leaveDrive();
}

// ---- 改車廠、車店：自己開進去，停在「改車區／買車區」就打開（開慢一點經過不會開）----
function bayAct(t) {
  for (const name of ['shop', 'dealer']) {
    const P = VIL.places[name]; if (!P?.bay) continue;
    if (bayLock[name]) { if (!inBox(P.bay, t.x, t.z, 2)) bayLock[name] = false; continue; }
    if (!inBox(P.bay, t.x, t.z)) continue;
    const go = name === 'shop' ? intoShop : intoDealer;
    if (Math.abs(t.v) < 1.2) { go(); return null; }
    return { label: name === 'shop' ? '停在這裡改車' : '停在這裡看車', icon: 'hand', onClick: go };
  }
  return null;
}
function panelOpen(el) {
  dvoice?.dispose(); dvoice = null; // 停好熄火（開走的時候再發動：剛裝的排氣、渦輪聽得到）
  document.body.classList.add('shopping'); driveBar.hidden = true; el.hidden = false;
  panelCam = drv.cameraMode; drv.setCameraMode('none'); // 畫面變矮變寬：鏡頭自己擺（開車暫停了不會跟著改視角）
  dcam.near = 0.1; dcam.fov = 50; dcam.updateProjectionMatrix();
  requestAnimationFrame(() => stage.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' })); // 畫面變矮了：畫面、下面的東西一起看得到
}
function panelClose() { document.body.classList.remove('shopping'); shopEl.hidden = true; dealerEl.hidden = true; camGo = null; }
// 鏡頭擺到 to、看 look（T 秒慢慢移過去；0＝直接跳過去）
function camTo(to, look, T) {
  if (!T || calm) { camGo = null; dcam.position.copy(to); camAt.copy(look); dcam.lookAt(camAt); return; }
  camGo = { p0: dcam.position.clone(), p1: to, a0: camAt.clone(), a1: look, t: 0, T };
}
// 從停好的地方看過去：前面偏右（f 往前、r 往右幾公尺），看車子中間
function viewCar(p, f, r, y, T) {
  const c = Math.cos(p.heading || 0), s = Math.sin(p.heading || 0);
  camTo(new THREE.Vector3(p.x + f * c + r * s, y, p.z - f * s + r * c), new THREE.Vector3(p.x, 0.62, p.z), T);
}
// 村子給的鏡頭（改車廠、車店展示間）：{ pos, look, fov }
function viewPlace(v, T) { dcam.fov = v.fov || 50; dcam.updateProjectionMatrix(); camTo(new THREE.Vector3(...v.pos), new THREE.Vector3(...v.look), T); }
// 開走：停在哪裡就從哪裡自己開出去（不會傳送）；裝了零件馬力變了，開車的重新做一個
function driveOff(lock, dest) {
  if (!DRIVE.on) return;
  engineAudio.resume(); panelClose(); driveBar.hidden = false;
  const t = drv.telemetry();
  drv.dispose(); makeDrv({ x: t.x, z: t.z, heading: t.heading });
  drv.setCameraMode(panelCam === 'eye' ? 'eye' : 'chase');
  bayLock[lock] = true; setDest(dest);
  stage.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
}

// 改車廠：停進改車區 → 下面打開改車廠（引擎零件、輪胎）→「開走」從出口開出去
function intoShop() {
  bayLock.shop = true; drv.setAction(null);
  drv.parkAt(VIL.places.shop.park, () => { if (!DRIVE.on) return; drv.pause(); openShop(); });
}
function openShop() {
  panelOpen(shopEl);
  if (VIL.places.shop.view) viewPlace(VIL.places.shop.view); else viewCar(VIL.places.shop.park, 5.2, 3.4, 1.8); // 改車區旁邊看車子，改車廠的裡面在後面
  say(true, GAME.money > 0 ? '想裝什麼？按一下看價錢，再按一次就裝上去' : '你現在沒有錢：先開去賽道比賽贏獎金，再回來買');
  renderWallet(); shopItems();
}
$('shopGo').addEventListener('click', () => { if (!shopEl.hidden) driveOff('shop', canBuy() ? 'dealer' : 'track'); });

// 車店：停進買車區 → 下面是還沒買的車（按一下鏡頭移過去看那台）→ 買了新車停到店門口，開它回家
let dealerSel = null, buying = false;
function intoDealer() {
  bayLock.dealer = true; drv.setAction(null);
  drv.parkAt(VIL.places.dealer.park, () => { if (!DRIVE.on) return; drv.pause(); openDealer(); });
}
function openDealer() {
  panelOpen(dealerEl);
  const list = forSale();
  dealerSel = list.includes(dealerSel) ? dealerSel : list.find((k) => GAME.money >= PERF[k].price) || list[0] || null;
  $('dealerMsg').textContent = !list.length ? '車都買齊了！你的車都停在車庫' : GAME.money < PERF[list[0]].price ? '錢還不夠：先開去賽道比賽贏獎金' : '按一下看那台車，買了自己開回家';
  renderWallet(); renderDealer();
  dcam.fov = 60; dcam.updateProjectionMatrix(); lookAtCar(dealerSel, 0); // 先看選好的那台（畫面變寬變矮了，整間看車子太小），按了別台再移過去
}
function lookAtCar(k, T = 0.8) {
  const D = VIL.places.dealer, i = forSale().indexOf(k), pad = D.display[i];
  if (!pad) { viewCar(D.park, 5.2, 3.4, 1.8, T); return; }
  // 從那台車往展示間的鏡頭那邊（門口）退 5.5 公尺、高 1.6 公尺看過去：鏡頭一定在展示間裡面、中間沒有別台車
  const v = D.view?.pos || [pad.x + 5, 0, pad.z + 5], dx = v[0] - pad.x, dz = v[2] - pad.z, l = Math.hypot(dx, dz) || 1;
  camTo(new THREE.Vector3(pad.x + (dx / l) * 5.5, 1.6, pad.z + (dz / l) * 5.5), new THREE.Vector3(pad.x, 0.55, pad.z), T);
}
function renderDealer() {
  const el = $('dealerCars'), list = forSale();
  el.replaceChildren();
  for (const k of list) {
    const P = PERF[k], b = document.createElement('button');
    b.type = 'button'; b.className = 'part ' + (k === dealerSel ? 'sel ' : '') + (GAME.money >= P.price ? 'can' : 'cant'); b.setAttribute('aria-pressed', String(k === dealerSel));
    const t = document.createElement('b'), d = document.createElement('span'), h = document.createElement('span'), p = document.createElement('span');
    t.textContent = CARS[k].btn[0]; h.className = 'hp'; h.textContent = `${P.hp.toLocaleString('en-US')} 匹`;
    d.className = 'd'; d.textContent = `${CARS[k].name} · 極速 ${P.vmax} km/h`; p.className = 'p'; p.textContent = money(P.price);
    b.append(t, h, d, p);
    b.addEventListener('click', () => { if (buying) return; dealerSel = k; renderDealer(); lookAtCar(k); });
    el.append(b);
  }
  buyCtaD();
}
const dBuy = $('dealerBuy'), dBuyHead = $('dealerBuyHead'), dBuyNote = $('dealerBuyNote');
function buyCtaD() {
  clearTimeout(buyCtaD.t); dBuy.classList.remove('armed');
  dBuy.hidden = !dealerSel; if (!dealerSel) return;
  const P = PERF[dealerSel], lack = P.price - GAME.money;
  dBuy.disabled = lack > 0 || buying;
  dBuyHead.textContent = lack > 0 ? `還差 ${money(lack)}` : `買 ${CARS[dealerSel].btn[0]} · NT$ ${money(P.price)}`;
  dBuyNote.textContent = lack > 0 ? `這台要 NT$ ${money(P.price)}，去賽道比賽贏錢` : `買了還剩 NT$ ${money(GAME.money - P.price)}，自己開回家`;
}
dBuy.addEventListener('click', async () => {
  const k = dealerSel;
  if (!k || buying || GAME.owned.has(k) || GAME.money < PERF[k].price || dealerEl.hidden) return;
  if (!dBuy.classList.contains('armed')) { // 按兩次才買（免得按錯）
    dBuy.classList.add('armed'); dBuyHead.textContent = `確定要買 ${CARS[k].btn[0]}？再按一次`;
    clearTimeout(buyCtaD.t); buyCtaD.t = setTimeout(buyCtaD, 3500); return;
  }
  clearTimeout(buyCtaD.t); buying = true; buyCtaD();
  dBuyHead.textContent = '車子開出來中⋯'; $('dealerMsg').textContent = `${CARS[k].btn[0]} 開到店門口中⋯`;
  let car = null;
  try { car = await loadCar(k); } catch (e) { console.error(e); }
  buying = false;
  if (!car) { $('dealerMsg').textContent = '車子沒開出來，再按一次試試'; buyCtaD(); return; }
  if (!DRIVE.on || dealerEl.hidden || GAME.owned.has(k) || GAME.money < PERF[k].price) { disposeCar(car); buyCtaD(); return; } // 等的時候離開了
  GAME.money -= PERF[k].price; GAME.owned.add(k); save(true);
  swapTripCar(k, car);
});
// 換開新車：舊的那台車行幫你送回車庫（停車位的輕量車），新車停在店門口，開它回家
function swapTripCar(k, car) {
  const old = tripS, oldName = CARS[cur].btn[0];
  panelClose(); driveBar.hidden = false;
  drv.dispose(); drv = null; dvoice?.dispose(); dvoice = null;
  scene.add(old.car); old.car.visible = false; // 車庫頁那邊留著（還在 built 裡：車庫頁切回來不用再載）
  if (built[k]) dispose(k);
  built[k] = car; scene.add(car.car);
  const ri = recent.indexOf(k); if (ri >= 0) recent.splice(ri, 1); recent.push(k);
  while (recent.length > 3) dispose(recent.shift());
  cur = k; S = car; tripS = car; save(true);
  home.left = true; // 從車店開回家：到了就可以停進去
  makeDrv(VIL.places.dealer.exit);
  drv.setCameraMode(panelCam === 'eye' ? 'eye' : 'chase');
  bayLock.dealer = true; setDest('garage');
  engineAudio.resume(); renderWallet(); refreshCarBtns();
  const d = drv; d.toast(`買到 ${CARS[k].btn[0]} 了！開回家停進車庫`, 3000);
  setTimeout(() => { if (drv === d) d.toast(`${oldName} 車行幫你送回車庫了`, 2600); }, 3200);
  stage.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
}
$('dealerGo').addEventListener('click', () => { if (!dealerEl.hidden && !buying) driveOff('dealer', 'track'); });

// ---- 賽道：開進起跑區（慢一點）自己停到起跑線，交給比賽（race.src.js）；比完開回村子 ----
function trackStep(t) {
  if (snooze.track || t.auto || !inBox(VIL.places.track.zone, t.x, t.z)) { home.slow = false; return; }
  if (Math.abs(t.v) > 22) { if (!home.slow) { home.slow = true; drv.toast('開慢一點，才停得進起跑線'); } return; }
  drv.toast('到賽道了！'); snooze.track = true;
  drv.parkAt(VIL.places.track.start, toRace);
}
function toRace() {
  if (!DRIVE.on) return;
  dvoice?.dispose(); dvoice = null; // 比賽有自己的兩個聲音
  drv.release(); // 車子放回原點、不轉、輪子歸零（carSize、putCar 要）
  DRIVE.on = false; document.body.classList.remove('driving'); driveBar.hidden = true;
  townFog(false);
  enterRace(); // 賽道已經蓋好了：不用等，這一行就進去了
  if (!RACE.on) resumeDrive(VIL.places.track.spawn, 'garage'); // 進不去（不會發生）：接著開
}
function resumeDrive(pose, dest) {
  DRIVE.on = true; controls.enabled = false;
  document.body.classList.add('driving'); driveBar.hidden = false;
  townFog(true);
  // 比賽可能贏了錢：開車的重新做（馬力照現在的零件），車子停在起跑區外面
  drv.dispose(); makeDrv(pose); setDest(dest);
  lastD = performance.now();
  stage.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
}
function backToVillage() {
  if (!RACE.on) return;
  if (!trip || !drv) { exitRace(); return; }
  engineAudio.resume();
  exitRace(true); // 比賽收掉（對手的車、兩個聲音），車子留在賽道的場景
  snooze.track = true; // 剛從起跑區出來：離開 30 公尺以前開回去不會又去比賽
  resumeDrive(VIL.places.track.spawn, canShop() ? 'shop' : canBuy() ? 'dealer' : 'garage');
}
$('raceBack').addEventListener('click', backToVillage);

// ---- 回車庫：開回家停好（上面 parkHome），或「直接回車庫」（不用開，一下就回去）----
function goHome() {
  if (!trip || enterDrive.busy || buying) return;
  if (RACE.on) exitRace(); // 比賽收掉、車子放回車庫
  leaveDrive();
}
// 離開開車：開車的收掉（HUD、按鍵、影子、光柱、聲音），車子放回車庫頁的原點、不轉，車庫的鏡頭、場景回來
function leaveDrive() {
  if (!trip) return;
  trip = false; DRIVE.on = false;
  panelClose(); driveBar.hidden = true;
  document.body.classList.remove('driving');
  dvoice?.dispose(); dvoice = null;
  drv?.dispose(); drv = null; home = null;
  if (GAR) GAR.door.t = 0;
  if (TR) townFog(false);
  const Sx = tripS; tripS = null;
  if (Sx && Object.values(built).includes(Sx)) {
    scene.add(Sx.car); Sx.car.position.set(0, 0, 0); Sx.car.rotation.set(0, 0, 0); Sx.car.visible = Sx === S;
    Sx.wheels.forEach((w) => (w.rotation.z = 0)); Sx.cabin?.userData.setGauges(0.13, 0);
  }
  controls.enabled = true; controls.update();
  showCar(cur); // 在車店買了新車：車庫頁換成新車（名字、選項），其他的車停回車位
  renderWallet(); refreshCarBtns();
  window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
}
for (const id of ['driveHome', 'raceHome', 'shopHome', 'dealerHome']) $(id).addEventListener('click', goHome);
driveOutBtn.addEventListener('click', enterDrive);

// ---- 每一幀 ----
function driveStep(dt) {
  GAR.door.update(dt); // 門在動（開、關）每一格都要跟著
  if (home?.park) parkStep(dt);
  if (!drv) return; // 停好了回車庫頁
  drv.update(dt); // 開進賽道、快速道路的事（arrive）在這裡面叫
  if (!drv) return;
  const t = drv.telemetry();
  dvoice?.set({ rpm: t.rpm, throttle: t.load, speed: Math.abs(t.v) });
  tripS?.cabin?.userData.setGauges(t.rpm, t.kmh); // 駕駛座視角看得到轉速表、速度表
  if (!t.paused && !home.park) {
    drv.setAction(homeAct(t) || bayAct(t)); // HUD 的大按鈕：一次一個
    if (drv && !drv.telemetry().paused) trackStep(t);
  }
  if (snooze.track && Math.hypot(t.x - VIL.places.track.zone.x, t.z - VIL.places.track.zone.z) > 30) snooze.track = false;
}
function driveFrame(now) {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (dcam.userData.w !== w || dcam.userData.h !== h) { dcam.aspect = w / h; dcam.updateProjectionMatrix(); dcam.userData.w = w; dcam.userData.h = h; }
  const dt = Math.min(0.1, (now - lastD) / 1000 || 0); lastD = now;
  driveStep(dt);
  if (!DRIVE.on) return; // 交給賽道、回車庫了這一格就不畫（車子已經放回原點）
  if (camGo) { // 車店：鏡頭慢慢移去看選的那台車
    camGo.t = Math.min(camGo.T, camGo.t + dt); const s = camGo.t / camGo.T, e = s * s * (3 - 2 * s);
    dcam.position.lerpVectors(camGo.p0, camGo.p1, e); camAt.lerpVectors(camGo.a0, camGo.a1, e); dcam.lookAt(camAt);
    if (camGo.t >= camGo.T) camGo = null;
  }
  GAR.cull(dcam); // 門關著、鏡頭在外面就不畫裡面；鏡頭在裡面不畫外殼
  renderer.render(TR.scene, dcam);
}


renderer.setAnimationLoop((now) => {
  if (RACE.on) { RACE.frame(now); return; }
  if (DRIVE.on) { DRIVE.frame(now); return; } // 開車出門：畫村子（車庫不畫）
  if (S && Math.abs(S.body.position.y - rideY) > 1e-4) S.body.position.y += (rideY - S.body.position.y) * 0.12;
  if (seat) {
    if (seat.key !== cur) { seat.key = cur; camera.fov = cabinFov(cur, camera.aspect); camera.updateProjectionMatrix(); } // 坐在車裡換車
    if (S) cabinCamera(camera, S.body, cur, seat.yaw, seat.pitch); // 車子還在載入就先不動
  } else { controls.update(); if (room?.baySig) keepOutOfBays(); }
  renderer.render(scene, camera);
});
// 後面車位停了車：鏡頭轉到車後面、拉遠的時候不要鑽進那些車的車頭（車頭在 x −7.55）
const bayOff = new THREE.Vector3();
function keepOutOfBays() {
  const p = camera.position, t = controls.target;
  if (p.x >= -7.1) return;
  bayOff.subVectors(p, t); if (bayOff.x > -1e-3) return;
  p.copy(t).addScaledVector(bayOff, (-7.1 - t.x) / bayOff.x);
}

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
