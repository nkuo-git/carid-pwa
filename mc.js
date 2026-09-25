// 麥塊建築設計 — 自己擺方塊，算材料
// 方塊材質是程式當場畫出來的 16×16 像素圖，沒有用到遊戲本身的圖檔。

/* ================= 材質 ================= */

const MATS = [
  { id: "grass",       name: "草地",   cat: "自然", base: "#6FBF4A" },
  { id: "stone",       name: "石頭",   cat: "建材", base: "#8A8F96" },
  { id: "stone_brick", name: "石磚",   cat: "建材", base: "#767C84" },
  { id: "planks",      name: "木板",   cat: "建材", base: "#C2884A" },
  { id: "log",         name: "原木",   cat: "建材", base: "#8A5E33" },
  { id: "brick",       name: "紅磚",   cat: "建材", base: "#A6503C" },
  { id: "sand",        name: "沙子",   cat: "自然", base: "#E0CE96" },
  { id: "leaves",      name: "樹葉",   cat: "自然", base: "#5AA33F" },
  { id: "water",       name: "水",     cat: "自然", base: "#4A84C4" },
  { id: "wool",        name: "白羊毛", cat: "裝飾", base: "#E8E8E4" },
  { id: "glass",       name: "玻璃",   cat: "裝飾", base: "#9FD8E6" },
  { id: "glowstone",   name: "螢石",   cat: "光源", base: "#F0D27A" },
];
const CATS = ["全部", "建材", "自然", "裝飾", "光源"];
const TILE = 16;

function hex2rgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgb2hex(r) {
  return "#" + r.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
function shade(h, f) {
  const r = hex2rgb(h);
  return rgb2hex(f >= 0 ? r.map((v) => v + (255 - v) * f) : r.map((v) => v * (1 + f)));
}
/* 固定的偽亂數，同一格每次畫出來都一樣 */
function hash(...ks) {
  let h = 2166136261;
  for (const k of ks) h = Math.imul(h ^ (k | 0), 16777619) >>> 0;
  return ((h >>> 8) & 0xffff) / 65535;
}
const jit = (base, amt, ...ks) => shade(base, (hash(...ks) - 0.5) * 2 * amt);

/* kind: 0 頂面 1 側面 2 底面 */
function pixel(mat, kind, i, j) {
  const n = TILE;
  switch (mat.id) {
    case "grass":
      if (kind === 0) return jit("#6FBF4A", 0.1, i, j);
      if (kind === 2) return jit("#8A6642", 0.09, i, j, 3);
      if (j < 2 || (j < 5 && hash(i, j, 4) > 0.35 + j * 0.2)) return jit("#6FBF4A", 0.11, i, j, 5);
      return jit("#8A6642", 0.09, i, j, 7);
    case "leaves":
      return hash(i, j) > 0.82 ? jit("#3F7A2C", 0.1, i, j) : jit("#5AA33F", 0.15, i, j);
    case "log": {
      if (kind !== 1) {
        const m = (n - 1) / 2;
        const d = Math.max(Math.abs(i - m), Math.abs(j - m)) / m;
        if (d < 0.25) return "#C9A068";
        if (d < 0.5) return jit("#B08A55", 0.05, i, j);
        if (d < 0.78) return jit("#9A7345", 0.05, i, j);
        return jit("#8A5E33", 0.06, i, j);
      }
      const band = i % 5;
      if (band === 0) return jit("#5E3E21", 0.1, i, j);
      if (band === 3) return jit("#6F4A28", 0.12, i, j);
      return jit("#8A5E33", 0.13, i, j);
    }
    case "planks": {
      if (kind === 0) return i % 8 === 0 ? shade("#C2884A", -0.3) : jit("#C2884A", 0.08, i, j);
      if (j % 4 === 0) return shade("#C2884A", -0.32);
      if (j % 8 === 2 && i % 9 === 3) return shade("#C2884A", -0.2);
      return jit("#C2884A", 0.08, i, j, (j / 4) | 0);
    }
    case "brick":
    case "stone_brick": {
      const isB = mat.id === "brick";
      const body = isB ? "#A6503C" : "#767C84";
      const gap = isB ? "#8E6E60" : "#5D636B";
      const rowH = isB ? 4 : 8;
      const colW = isB ? 8 : 8;
      if (j % rowH === 0) return gap;
      const row = Math.floor(j / rowH);
      if ((i + (row % 2 ? colW / 2 : 0)) % colW === 0) return gap;
      return jit(body, 0.11, i, j, row);
    }
    case "stone":
      return hash(i, j) > 0.9 ? shade("#8A8F96", -0.18) : jit("#8A8F96", 0.12, i, j);
    case "sand":
      return jit("#E0CE96", 0.07, i, j);
    case "wool":
      return jit("#E8E8E4", 0.045, i, j);
    case "glowstone":
      return hash(i, j) > 0.6 ? "#FFF3C4" : jit("#E8C46A", 0.1, i, j);
    case "glass": {
      const edge = i === 0 || j === 0 || i === n - 1 || j === n - 1;
      if (edge) return "#CFEAF2";
      if ((i === 3 && j < 7) || (j === 3 && i > 8)) return "#BCE3EE";
      return "#A8DCE9";
    }
    case "water":
      return jit("#4A84C4", 0.09, i, (j / 3) | 0);
    default:
      return jit(mat.base, 0.08, i, j);
  }
}

/* 六個面的方向：+X -X +Y -Y +Z -Z。亮度讓形狀看得出來。 */
const DIRS = [
  { n: [1, 0, 0],  kind: 1, lit: -0.10, q: [[1,1,0],[1,1,1],[1,0,1],[1,0,0]] },
  { n: [-1, 0, 0], kind: 1, lit: -0.28, q: [[0,1,1],[0,1,0],[0,0,0],[0,0,1]] },
  { n: [0, 1, 0],  kind: 0, lit:  0.14, q: [[0,1,0],[1,1,0],[1,1,1],[0,1,1]] },
  { n: [0, -1, 0], kind: 2, lit: -0.45, q: [[0,0,1],[1,0,1],[1,0,0],[0,0,0]] },
  { n: [0, 0, 1],  kind: 1, lit: -0.20, q: [[1,1,1],[0,1,1],[0,0,1],[1,0,1]] },
  { n: [0, 0, -1], kind: 1, lit: -0.02, q: [[0,1,0],[1,1,0],[1,0,0],[0,0,0]] },
];

const TILES = [];   // TILES[matIndex][dirIndex] = canvas
const AVG = [];     // 平均色，用來墊在材質底下擋接縫
const TOPURL = [];  // 頂面的圖，平面模式的格子直接拿來當背景

function makeTiles() {
  MATS.forEach((mat, mi) => {
    TILES[mi] = [];
    AVG[mi] = [];
    DIRS.forEach((dir, di) => {
      const c = document.createElement("canvas");
      c.width = c.height = TILE;
      const g = c.getContext("2d");
      let rs = 0, gs = 0, bs = 0;
      for (let j = 0; j < TILE; j++) {
        for (let i = 0; i < TILE; i++) {
          const col = shade(pixel(mat, dir.kind, i, j), dir.lit);
          g.fillStyle = col;
          g.fillRect(i, j, 1, 1);
          const p = hex2rgb(col);
          rs += p[0]; gs += p[1]; bs += p[2];
        }
      }
      TILES[mi][di] = c;
      const k = TILE * TILE;
      AVG[mi][di] = rgb2hex([rs / k, gs / k, bs / k]);
    });
    TOPURL[mi] = TILES[mi][2].toDataURL();
  });
}

/* ================= 世界 ================= */

const LIMIT = { xz: 40, y: 48, max: 20000 };
const key = (x, y, z) => x + "," + y + "," + z;

class World {
  constructor() {
    this.b = new Map();
    this.undoStack = [];
    this.redoStack = [];
  }
  get(x, y, z) { return this.b.get(key(x, y, z)); }
  has(x, y, z) { return this.b.has(key(x, y, z)); }
  inside(x, y, z) {
    return Math.abs(x) <= LIMIT.xz && Math.abs(z) <= LIMIT.xz && y >= 0 && y <= LIMIT.y;
  }
  apply(changes, remember = true) {
    if (!changes.length) return false;
    for (const c of changes) {
      if (c.after === undefined) this.b.delete(c.k);
      else this.b.set(c.k, c.after);
    }
    if (remember) {
      this.undoStack.push(changes);
      if (this.undoStack.length > 60) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    return true;
  }
  edit(list) {
    const changes = [];
    for (const [k, after] of list) {
      const before = this.b.get(k);
      if (before === after) continue;
      changes.push({ k, before, after });
    }
    if (this.b.size + changes.length > LIMIT.max) return false;
    return this.apply(changes);
  }
  undo() {
    const c = this.undoStack.pop();
    if (!c) return false;
    for (const ch of c) {
      if (ch.before === undefined) this.b.delete(ch.k);
      else this.b.set(ch.k, ch.before);
    }
    this.redoStack.push(c);
    return true;
  }
  redo() {
    const c = this.redoStack.pop();
    if (!c) return false;
    this.apply(c, false);
    this.undoStack.push(c);
    return true;
  }
  bounds() {
    if (!this.b.size) return { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 };
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const k of this.b.keys()) {
      const [x, y, z] = k.split(",").map(Number);
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    return { x0, x1, y0, y1, z0, z1 };
  }
  counts() {
    const c = new Map();
    for (const m of this.b.values()) c.set(m, (c.get(m) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }
  toJSON() {
    const o = {};
    for (const [k, v] of this.b) o[k] = v;
    return o;
  }
  static fromJSON(o) {
    const w = new World();
    for (const k in o) w.b.set(k, o[k]);
    return w;
  }
}

/* ================= 投影與繪製 ================= */

const view = { yaw: Math.PI / 4, pitch: 0.615, zoomMul: 1, panX: 0, panY: 0 };

function project(p, v) {
  const ca = Math.cos(v.yaw), sa = Math.sin(v.yaw);
  const cb = Math.cos(v.pitch), sb = Math.sin(v.pitch);
  const right = p[0] * ca - p[2] * sa;
  const into = p[0] * sa + p[2] * ca;
  return [right * v.scale, (into * sb - p[1] * cb) * v.scale];
}
/* 指向鏡頭的方向。點積越大表示越靠近鏡頭。 */
function camVec(v) {
  const ca = Math.cos(v.yaw), sa = Math.sin(v.yaw);
  const cb = Math.cos(v.pitch), sb = Math.sin(v.pitch);
  return [sa * cb, sb, ca * cb];
}
function depthOf(p, v) {
  const f = camVec(v);
  return p[0] * f[0] + p[1] * f[1] + p[2] * f[2];
}

/* 回傳這個視角下看得到的面，由遠到近排好 */
function visibleFaces(world, v) {
  const f = camVec(v);
  const out = [];
  for (const [k, mi] of world.b) {
    const [x, y, z] = k.split(",").map(Number);
    const d = depthOf([x + 0.5, y + 0.5, z + 0.5], v);
    for (let di = 0; di < 6; di++) {
      const dir = DIRS[di];
      // 貼著別的方塊的面看不到，背對鏡頭的面也看不到
      if (world.has(x + dir.n[0], y + dir.n[1], z + dir.n[2])) continue;
      const nd = dir.n[0] * f[0] + dir.n[1] * f[1] + dir.n[2] * f[2];
      if (nd <= 0) continue;
      // 同一個方塊的幾個面，朝著鏡頭的那面最後畫
      out.push({ x, y, z, mi, di, d: d + nd * 0.01 });
    }
  }
  out.sort((a, b) => a.d - b.d);   // 遠的先畫，近的蓋上去
  return out;
}

/* 四邊留白（裝置像素）。立體畫面是整片的，尺和按鈕浮在上面，
   所以要留位子；方塊條上的小圖示則是能塞多大就多大。 */
const PAD_TIGHT = { l: 1, r: 1, t: 1, b: 1, max: Infinity };
let stagePad = { l: 24, r: 24, t: 24, b: 24, max: 30 };

function fitView(world, w, h, v, pad) {
  const b = world.bounds();
  const probe = Object.assign({}, v, { scale: 1 });
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const cx of [b.x0, b.x1 + 1]) {
    for (const cy of [b.y0, b.y1 + 1]) {
      for (const cz of [b.z0, b.z1 + 1]) {
        const p = project([cx, cy, cz], probe);
        if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
      }
    }
  }
  const sw = (x1 - x0) || 1, sh = (y1 - y0) || 1;
  const bw = Math.max(8, w - pad.l - pad.r), bh = Math.max(8, h - pad.t - pad.b);
  // 立體畫面一塊最多 30pt，不然剛開新的只有一片地板時會大到看不出是方塊
  const scale = Math.min(bw / sw, bh / sh, pad.max);
  return { scale, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/* 把世界畫到 ctx 上。pickList 有給的話就改畫成識別色，用來判斷點到哪一面。 */
function draw(ctx, world, v, w, h, pickList, pad) {
  pad = pad || PAD_TIGHT;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;

  const fit = fitView(world, w, h, v, pad);
  const s = fit.scale * v.zoomMul;
  const vv = Object.assign({}, v, { scale: s });
  const ox = pad.l + (w - pad.l - pad.r) / 2 - fit.cx * s + v.panX;
  const oy = pad.t + (h - pad.t - pad.b) / 2 - fit.cy * s + v.panY;

  const faces = visibleFaces(world, vv);
  for (let n = 0; n < faces.length; n++) {
    const fc = faces[n];
    const dir = DIRS[fc.di];
    const p = dir.q.map((c) => {
      const q = project([fc.x + c[0], fc.y + c[1], fc.z + c[2]], vv);
      return [q[0] + ox, q[1] + oy];
    });
    if (pickList) {
      const id = pickList.length + 1;
      pickList.push(fc);
      ctx.fillStyle = "rgb(" + (id & 255) + "," + ((id >> 8) & 255) + "," + ((id >> 16) & 255) + ")";
      ctx.beginPath();
      ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(p[i][0], p[i][1]);
      ctx.closePath();
      ctx.fill();
      continue;
    }
    const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1];
    const vx = p[3][0] - p[0][0], vy = p[3][1] - p[0][1];
    // 先用平均色把整面塗滿，蓋掉相鄰面之間可能出現的一條細縫
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = AVG[fc.mi][fc.di];
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(p[i][0], p[i][1]);
    ctx.closePath();
    ctx.fill();
    ctx.setTransform(ux / TILE, uy / TILE, vx / TILE, vy / TILE, p[0][0], p[0][1]);
    ctx.globalAlpha = MATS[fc.mi].id === "glass" ? 0.72 : 1;
    ctx.drawImage(TILES[fc.mi][fc.di], -0.3, -0.3, TILE + 0.6, TILE + 0.6);
    ctx.globalAlpha = 1;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/* ================= 畫面狀態 ================= */

const $ = (id) => document.getElementById(id);
const screens = { builds: $("scBuilds"), edit: $("scEdit"), plane: $("scPlane"), mats: $("scMats") };

let world = new World();
let build = { id: null, name: "新的建築" };
let tool = "place";
let matIndex = 3;
let recent = [3, 5, 4, 10, 2];
let layer = 1;
let dirty = false;

view.zoomMul = 1;

function show(name) {
  for (const k in screens) screens[k].hidden = k !== name;
  if (name === "edit") requestAnimationFrame(render);
  if (name === "plane") paintPlane();
  if (name === "mats") paintMats();
  if (name === "builds") paintBuilds();
  window.scrollTo(0, 0);
}

/* ================= 儲存 ================= */

const LS = {
  read(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 空間滿了就算了 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 忽略 */ } },
};

function listBuilds() { return LS.read("mc.builds", []); }

function saveBuild() {
  if (!build.id) build.id = "b" + Date.now().toString(36);
  LS.write("mc.build." + build.id, { name: build.name, blocks: world.toJSON() });
  const list = listBuilds().filter((b) => b.id !== build.id);
  list.unshift({ id: build.id, name: build.name, updated: Date.now(), n: world.b.size });
  LS.write("mc.builds", list.slice(0, 40));
  dirty = false;
}

function openBuild(id) {
  const d = LS.read("mc.build." + id, null);
  if (!d) return;
  build = { id, name: d.name || "沒有名字" };
  world = World.fromJSON(d.blocks || {});
  layer = 1;
  view.yaw = Math.PI / 4;
  view.pitch = 0.615;
  view.panX = view.panY = 0;
  view.zoomMul = 1;
  show("edit");
}

function newBuild() {
  build = { id: null, name: "新的建築" };
  world = new World();
  const first = [];
  const g = MATS.findIndex((m) => m.id === "grass");
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) first.push([key(x, 0, z), g]);
  world.edit(first);
  world.undoStack.length = 0;
  layer = 1;
  view.yaw = Math.PI / 4;
  view.pitch = 0.615;
  view.panX = view.panY = 0;
  view.zoomMul = 1;
  saveBuild();
  show("edit");
}

/* ================= 立體畫面 ================= */

const canvas = $("view");
const ctx = canvas.getContext("2d");
let pickFaces = null;
let pickCanvas = null;

function sizeCanvas() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  stagePad = { l: 14 * dpr, r: 76 * dpr, t: 14 * dpr, b: 72 * dpr, max: 30 * dpr };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function render() {
  if (screens.edit.hidden) return;
  sizeCanvas();
  draw(ctx, world, view, canvas.width, canvas.height, null, stagePad);
  pickFaces = null;
  $("editName").textContent = build.name;
  $("editSize").textContent = world.b.size + " BLOCKS";
  const deg = ((Math.round(view.yaw * 180 / Math.PI) % 360) + 360) % 360;
  const names = ["SE", "SW", "NW", "NE"];
  $("degText").textContent = names[(Math.round(view.yaw / (Math.PI / 2)) % 4 + 4) % 4] + " " + deg + "°";
  $("undoBtn").disabled = !world.undoStack.length;
  $("redoBtn").disabled = !world.redoStack.length;
  paintRail();
}

function ensurePick() {
  if (pickFaces) return;
  if (!pickCanvas) pickCanvas = document.createElement("canvas");
  pickCanvas.width = canvas.width;
  pickCanvas.height = canvas.height;
  const pctx = pickCanvas.getContext("2d", { willReadFrequently: true });
  pickFaces = [];
  draw(pctx, world, view, pickCanvas.width, pickCanvas.height, pickFaces, stagePad);
}

function pickAt(cx, cy) {
  ensurePick();
  const r = canvas.getBoundingClientRect();
  const dpr = canvas.width / r.width;
  const x = Math.round((cx - r.left) * dpr);
  const y = Math.round((cy - r.top) * dpr);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
  const d = pickCanvas.getContext("2d", { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
  const id = d[0] | (d[1] << 8) | (d[2] << 16);
  if (!id || d[3] === 0) return null;
  return pickFaces[id - 1] || null;
}

function tapFace(face) {
  if (!face) return;
  const dir = DIRS[face.di];
  if (tool === "pick") {
    setMat(face.mi);
    toast("換成「" + MATS[face.mi].name + "」");
    return;
  }
  if (tool === "erase") {
    world.edit([[key(face.x, face.y, face.z), undefined]]);
  } else if (tool === "place") {
    const nx = face.x + dir.n[0], ny = face.y + dir.n[1], nz = face.z + dir.n[2];
    if (!world.inside(nx, ny, nz)) { toast("超出範圍了"); return; }
    world.edit([[key(nx, ny, nz), matIndex]]);
  } else if (tool === "fill") {
    const nx = face.x + dir.n[0], ny = face.y + dir.n[1], nz = face.z + dir.n[2];
    floodFill(nx, ny, nz);
  }
  dirty = true;
  saveBuild();
  render();
}

/* 同一層裡相連的空格一次填滿，蓋地板很好用 */
function floodFill(sx, sy, sz) {
  if (!world.inside(sx, sy, sz) || world.has(sx, sy, sz)) return;
  const seen = new Set();
  const list = [];
  const stack = [[sx, sz]];
  // 不超出現有建築的範圍再往外一格，不然在地面那層會整片暴衝出去
  const bb = world.bounds();
  const x0 = bb.x0 - 1, x1 = bb.x1 + 1, z0 = bb.z0 - 1, z1 = bb.z1 + 1;
  while (stack.length && list.length < 600) {
    const [x, z] = stack.pop();
    const k = x + "," + z;
    if (seen.has(k)) continue;
    seen.add(k);
    if (x < x0 || x > x1 || z < z0 || z > z1) continue;
    if (!world.inside(x, sy, z) || world.has(x, sy, z)) continue;
    // 這一層要填的地方，底下得有東西撐著，才不會浮在半空中
    if (sy > 0 && !world.has(x, sy - 1, z)) continue;
    list.push([key(x, sy, z), matIndex]);
    stack.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]);
  }
  if (!list.length) { toast("這裡沒有可以填的地方"); return; }
  world.edit(list);
}

/* ---------- 手指操作 ---------- */

const stage = $("stage");
let ptrs = new Map();
let dragging = false;
let startPt = null;
let pinchBase = 0;

stage.addEventListener("pointerdown", (e) => {
  // 尺和按鈕也在 stage 裡面，抓了指標它們就按不下去了
  if (e.target !== canvas) return;
  stage.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 1) {
    dragging = false;
    startPt = { x: e.clientX, y: e.clientY, t: Date.now(), yaw: view.yaw, pitch: view.pitch };
  } else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    pinchBase = Math.hypot(a.x - b.x, a.y - b.y) / view.zoomMul;
  }
});

stage.addEventListener("pointermove", (e) => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchBase > 0) view.zoomMul = Math.max(0.4, Math.min(4, d / pinchBase));
    dragging = true;
    render();
    return;
  }
  if (!startPt) return;
  const dx = e.clientX - startPt.x, dy = e.clientY - startPt.y;
  if (!dragging && Math.hypot(dx, dy) < 9) return;
  dragging = true;
  view.yaw = startPt.yaw - dx * 0.011;
  view.pitch = Math.max(0.12, Math.min(1.45, startPt.pitch + dy * 0.008));
  render();
});

function endPointer(e) {
  const had = ptrs.has(e.pointerId);
  ptrs.delete(e.pointerId);
  if (!had) return;
  if (ptrs.size === 0 && startPt) {
    if (!dragging && Date.now() - startPt.t < 600) tapFace(pickAt(e.clientX, e.clientY));
    startPt = null;
    dragging = false;
  }
}
stage.addEventListener("pointerup", endPointer);
stage.addEventListener("pointercancel", endPointer);

$("rotL").addEventListener("click", () => { view.yaw -= Math.PI / 12; render(); });
$("rotR").addEventListener("click", () => { view.yaw += Math.PI / 12; render(); });

/* ---------- 層數尺 ---------- */

function maxLayer() { return Math.max(1, world.bounds().y1 + 2); }

function paintRail() {
  const top = maxLayer();
  layer = Math.max(1, Math.min(top, layer));
  const pct = top > 1 ? (layer - 1) / (top - 1) : 0;
  $("layNum").textContent = layer;
  $("layFill").style.height = (pct * 100) + "%";
  $("layKnob").style.bottom = "calc(" + (pct * 100) + "% - 11px)";
}
$("layUp").addEventListener("click", () => { layer = Math.min(maxLayer(), layer + 1); paintRail(); });
$("layDown").addEventListener("click", () => { layer = Math.max(1, layer - 1); paintRail(); });

/* ================= 工具列與方塊條 ================= */

const TOOLS = [
  { id: "place", name: "放置", d: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5"/><path d="M12 12v9"/>' },
  { id: "erase", name: "刪除", d: '<path d="M8 19h11"/><path d="M5.5 15.5l6-6 5 5-4.5 4.5H8z"/><path d="M11.5 9.5l3-3 5 5-3 3"/>' },
  { id: "pick",  name: "吸取", d: '<path d="M5 19l4-1 8.5-8.5a2 2 0 0 0-2.8-2.8L6 15.2z"/><path d="M14 7l3 3"/>' },
  { id: "fill",  name: "填滿", d: '<path d="M4 13l7-7 7 7-7 7z"/><path d="M19 15.5c1.2 1.6 1.8 2.6 1.8 3.2a1.8 1.8 0 1 1-3.6 0c0-.6.6-1.6 1.8-3.2z"/>' },
];

function svg(d, sw) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.8) +
         '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>";
}

function buildTools(host) {
  host.innerHTML = "";
  for (const t of TOOLS) {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = svg(t.d) + t.name;
    b.className = t.id === tool ? "on" : "";
    b.addEventListener("click", () => { tool = t.id; paintTools(); });
    host.appendChild(b);
  }
}
function paintTools() { buildTools($("tools")); buildTools($("tools2")); }

/* 一顆小小的等角方塊圖示，直接用同一套材質畫 */
function cubeCanvas(mi, px) {
  const c = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = px * dpr;
  c.height = px * dpr;
  c.style.width = px + "px";
  c.style.height = px + "px";
  const one = new World();
  one.b.set(key(0, 0, 0), mi);
  draw(c.getContext("2d"), one, { yaw: Math.PI / 4, pitch: 0.615, panX: 0, panY: 0, zoomMul: 1 }, c.width, c.height, null);
  return c;
}

function buildStrip(host) {
  host.innerHTML = "";
  for (const mi of recent) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", MATS[mi].name);
    b.className = mi === matIndex ? "on" : "";
    b.appendChild(cubeCanvas(mi, 24));
    b.addEventListener("click", () => setMat(mi));
    host.appendChild(b);
  }
  const more = document.createElement("button");
  more.type = "button";
  more.className = "more";
  more.setAttribute("aria-label", "更多方塊");
  more.innerHTML = svg('<path d="M12 5v14"/><path d="M5 12h14"/>', 2);
  more.addEventListener("click", openPalette);
  host.appendChild(more);
}
function paintStrip() { buildStrip($("strip")); buildStrip($("strip2")); }

function setMat(mi) {
  matIndex = mi;
  recent = [mi, ...recent.filter((m) => m !== mi)].slice(0, 5);
  LS.write("mc.recent", recent);
  LS.write("mc.mat", mi);
  paintStrip();
  paintPalette();
  $("legNow").style.background = MATS[mi].base;
}

/* ================= 選方塊 ================= */

let palCat = "全部";

function openPalette() { $("sheetPal").hidden = false; paintPalette(); }
function closePalette() { $("sheetPal").hidden = true; }
$("palClose").addEventListener("click", closePalette);
$("palDone").addEventListener("click", closePalette);

function paintPalette() {
  const cats = $("palCats");
  cats.innerHTML = "";
  for (const c of CATS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = c;
    b.className = c === palCat ? "on" : "";
    b.addEventListener("click", () => { palCat = c; paintPalette(); });
    cats.appendChild(b);
  }
  const tiles = $("palTiles");
  tiles.innerHTML = "";
  MATS.forEach((m, mi) => {
    if (palCat !== "全部" && m.cat !== palCat) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tile" + (mi === matIndex ? " on" : "");
    b.appendChild(cubeCanvas(mi, 30));
    const s = document.createElement("span");
    s.textContent = m.name;
    b.appendChild(s);
    b.addEventListener("click", () => { setMat(mi); });
    tiles.appendChild(b);
  });
  const rec = $("palRecent");
  rec.innerHTML = "";
  for (const mi of recent) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", MATS[mi].name);
    b.appendChild(cubeCanvas(mi, 22));
    b.addEventListener("click", () => setMat(mi));
    rec.appendChild(b);
  }
}

/* ================= 平面模式 ================= */

function planeRange() {
  const b = world.bounds();
  let x0 = Math.min(b.x0, -4) - 1, x1 = Math.max(b.x1, 4) + 1;
  let z0 = Math.min(b.z0, -4) - 1, z1 = Math.max(b.z1, 4) + 1;
  const n = Math.min(16, Math.max(x1 - x0 + 1, z1 - z0 + 1));
  const cx = Math.round((x0 + x1) / 2), cz = Math.round((z0 + z1) / 2);
  const h = Math.floor(n / 2);
  return { x0: cx - h, x1: cx - h + n - 1, z0: cz - h, z1: cz - h + n - 1, n };
}

function paintPlane() {
  const r = planeRange();
  const y = layer - 1;
  const host = $("plane");
  host.style.gridTemplateColumns = "repeat(" + r.n + ", minmax(0, 1fr))";
  host.innerHTML = "";
  $("planeName").textContent = build.name;
  $("planeSub").textContent = "LAYER " + layer;
  $("planeLayer").textContent = layer;
  for (let z = r.z0; z <= r.z1; z++) {
    for (let x = r.x0; x <= r.x1; x++) {
      const b = document.createElement("button");
      b.type = "button";
      const here = world.get(x, y, z);
      const below = y > 0 && world.has(x, y - 1, z);
      if (here !== undefined) {
        b.className = "has";
        b.style.backgroundImage = "url(" + TOPURL[here] + ")";
        b.style.backgroundSize = "100% 100%";
        b.style.imageRendering = "pixelated";
        b.setAttribute("aria-label", MATS[here].name);
      } else if (below) {
        b.className = "below";
        b.setAttribute("aria-label", "空的，下面有方塊");
      } else {
        b.setAttribute("aria-label", "空的");
      }
      b.addEventListener("click", () => {
        if (tool === "pick") {
          if (here !== undefined) { setMat(here); toast("換成「" + MATS[here].name + "」"); }
          return;
        }
        if (tool === "erase" || (tool === "place" && here !== undefined && here === matIndex)) {
          world.edit([[key(x, y, z), undefined]]);
        } else if (tool === "fill") {
          floodFill(x, y, z);
        } else {
          if (!world.inside(x, y, z)) return;
          world.edit([[key(x, y, z), matIndex]]);
        }
        dirty = true;
        saveBuild();
        paintPlane();
      });
      host.appendChild(b);
    }
  }
  $("undoBtn2").disabled = !world.undoStack.length;
  $("redoBtn2").disabled = !world.redoStack.length;
}

$("planeUp").addEventListener("click", () => { layer = Math.min(maxLayer(), layer + 1); paintPlane(); });
$("planeDown").addEventListener("click", () => { layer = Math.max(1, layer - 1); paintPlane(); });
$("toPlane").addEventListener("click", () => show("plane"));
$("planeBack").addEventListener("click", () => show("edit"));

/* ================= 材料清單 ================= */

function matsText() {
  const lines = [build.name + "　材料清單"];
  for (const [mi, n] of world.counts()) {
    const st = Math.floor(n / 64), rest = n % 64;
    lines.push(MATS[mi].name + "　" + n + " 個" + (st ? "（" + st + " 組" + (rest ? " " + rest + " 個" : "") + "）" : ""));
  }
  lines.push("總共 " + world.b.size + " 個方塊");
  return lines.join("\n");
}

function paintMats() {
  $("matsName").textContent = build.name;
  const cs = world.counts();
  const sums = [["個方塊", world.b.size], ["種材料", cs.length], ["組", Math.floor(world.b.size / 64) + "+"]];
  $("matsSums").innerHTML = sums.map((s) =>
    '<div class="sum"><b>' + s[1] + "</b><span>" + s[0] + "</span></div>").join("");
  const body = $("matsBody");
  body.innerHTML = "";
  for (const [mi, n] of cs) {
    const tr = document.createElement("tr");
    const td0 = document.createElement("td");
    td0.className = "ic";
    td0.appendChild(cubeCanvas(mi, 26));
    const td1 = document.createElement("td");
    td1.textContent = MATS[mi].name;
    const td2 = document.createElement("td");
    td2.className = "n";
    td2.textContent = n;
    const td3 = document.createElement("td");
    td3.className = "st";
    const st = Math.floor(n / 64), rest = n % 64;
    td3.textContent = st ? st + " 組" + (rest ? " " + rest + " 個" : "") : rest + " 個";
    tr.append(td0, td1, td2, td3);
    body.appendChild(tr);
  }
}

$("copyMats").addEventListener("click", async () => {
  const text = matsText();
  try {
    await navigator.clipboard.writeText(text);
    toast("已經複製了");
  } catch {
    toast("這支手機不讓複製，請自己看著抄");
  }
});
$("matsBtn").addEventListener("click", () => show("mats"));
$("matsBack").addEventListener("click", () => show("edit"));
$("matsBack2").addEventListener("click", () => show("edit"));

/* ================= 作品列表 ================= */

function whenText(t) {
  const d = Date.now() - t;
  if (d < 60000) return "剛剛";
  if (d < 3600000) return Math.floor(d / 60000) + " 分鐘前";
  if (d < 86400000) return Math.floor(d / 3600000) + " 小時前";
  if (d < 7 * 86400000) return Math.floor(d / 86400000) + " 天前";
  return new Date(t).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" });
}

function paintBuilds() {
  const list = listBuilds();
  const host = $("cards");
  host.innerHTML = "";
  $("buildsEmpty").hidden = list.length > 0;
  for (const b of list) {
    const d = LS.read("mc.build." + b.id, null);
    if (!d) continue;
    const w = World.fromJSON(d.blocks || {});
    const bb = w.bounds();
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card";
    const shot = document.createElement("div");
    shot.className = "shot";
    const c = document.createElement("canvas");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.style.width = "150px";
    c.style.height = "110px";
    c.width = 150 * dpr;
    c.height = 110 * dpr;
    draw(c.getContext("2d"), w, { yaw: Math.PI / 4, pitch: 0.615, panX: 0, panY: 0, zoomMul: 1 }, c.width, c.height, null);
    shot.appendChild(c);
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = '<div class="name"></div><div class="size"></div><div class="when"></div>';
    meta.querySelector(".name").textContent = b.name;
    meta.querySelector(".size").textContent =
      (bb.x1 - bb.x0 + 1) + " × " + (bb.y1 - bb.y0 + 1) + " × " + (bb.z1 - bb.z0 + 1);
    meta.querySelector(".when").textContent = w.b.size + " 個方塊　" + whenText(b.updated);
    card.append(shot, meta);
    card.addEventListener("click", () => openBuild(b.id));
    let timer = null;
    card.addEventListener("pointerdown", () => {
      timer = setTimeout(() => { timer = null; manageBuild(b); }, 550);
    });
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
    card.addEventListener("pointerup", clear);
    card.addEventListener("pointercancel", clear);
    card.addEventListener("pointerleave", clear);
    host.appendChild(card);
  }
}

function manageBuild(b) {
  const name = prompt("改名字（清空然後按確定就是刪掉這個作品）", b.name);
  if (name === null) return;
  if (name.trim() === "") {
    if (!confirm("確定要刪掉「" + b.name + "」？")) return;
    LS.del("mc.build." + b.id);
    LS.write("mc.builds", listBuilds().filter((x) => x.id !== b.id));
    if (build.id === b.id) { build.id = null; }
    paintBuilds();
    return;
  }
  const d = LS.read("mc.build." + b.id, null);
  if (d) { d.name = name.trim(); LS.write("mc.build." + b.id, d); }
  LS.write("mc.builds", listBuilds().map((x) => (x.id === b.id ? Object.assign({}, x, { name: name.trim() }) : x)));
  if (build.id === b.id) build.name = name.trim();
  paintBuilds();
}

$("newBuild").addEventListener("click", newBuild);
$("editBack").addEventListener("click", () => { saveBuild(); show("builds"); });

/* ================= 復原、重做、提示 ================= */

function wireUndo(undoId, redoId, after) {
  $(undoId).addEventListener("click", () => { if (world.undo()) { saveBuild(); after(); } });
  $(redoId).addEventListener("click", () => { if (world.redo()) { saveBuild(); after(); } });
}
wireUndo("undoBtn", "redoBtn", render);
wireUndo("undoBtn2", "redoBtn2", paintPlane);

let toastTimer = null;
function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.remove(); }, 1800);
}

/* ================= 起動 ================= */

// 標題旁的版本號，跟汽車那頁一樣是 0.外殼.內容：外殼看 User-Agent 裡的 CaridApp/<版號>，
// 內容就是這支檔案網址上的 ?v=（每次換版都跟 app.js 的 WEB_BUILD 一起加）
(function paintVersion() {
  const el = $("brandVer");
  const web = new URL(import.meta.url).searchParams.get("v");
  if (!el || !web) return;
  const app = /CaridApp\/(\d+)/.exec(navigator.userAgent || "");
  el.textContent = "0." + (app ? app[1] : 0) + "." + web;
})();

window.addEventListener("resize", () => { if (!screens.edit.hidden) render(); });

(function start() {
  makeTiles();
  matIndex = LS.read("mc.mat", 3);
  recent = LS.read("mc.recent", [3, 5, 4, 10, 2]);
  if (!recent.includes(matIndex)) recent = [matIndex, ...recent].slice(0, 5);
  paintTools();
  paintStrip();
  $("legNow").style.background = MATS[matIndex].base;
  const list = listBuilds();
  if (list.length) { show("builds"); } else { show("builds"); }
})();
