// 大便龍的萬能軟體 — 帳號與雲端紀錄
// 用 email 連結登入（不用密碼）；登入後，紀錄跟 Firestore 對齊，換手機登入同一個 email 就拿得回來。
// 畫面一律讀手機裡的 IndexedDB，這裡只負責把手機和雲端對齊。
//
// 雲端長這樣（Firestore 規則只准本人、而且 email 驗證過的人讀寫 users/{uid} 底下）：
//   users/{uid}                    { claimed }             第一次登入時建立
//   users/{uid}/history/{id}       { t, j, n, thumb, del, u }
//   users/{uid}/photos/{id}_{i}    { b, t }                一張照片一份，點開紀錄才下載
//   users/{uid}/trips/{id}         { mode, start, end, …, p, del, u }   行車紀錄（內容 47 起），p 是路線點的 JSON 字串
// j 是辨識結果的 JSON 字串（Firestore 不收巢狀陣列、undefined，存字串最省事）；
// del 是刪除標記，留著讓別支手機知道要刪；u 是寫進雲端的時間，每次只抓比上次新的。

const PAGE = 20;
const EMAIL_KEY = "carid.loginEmail";
const pullKey = (uid) => "carid.pull." + uid;
const delKey = (uid) => "carid.del." + uid;
const tpullKey = (uid) => "carid.tpull." + uid;
const tdelKey = (uid) => "carid.tdel." + uid;

let env = null;        // { firebaseApp, hist: { all, get, put, del, patch }, trips: { 同上 }, inApp }
let fb = null;         // 載好的 Firebase：{ auth, db, A, F }
let ready = null;
let user = null;       // { uid, email }；沒登入是 null
// rounds：登入後對齊完成了幾次；pulled／pushed：登入後拿回來、傳上去幾筆
const IDLE = { phase: "idle", done: 0, total: 0, pulled: 0, pushed: 0, rounds: 0, error: null };
let state = { ...IDLE };
let claiming = Promise.resolve();   // 第一次登入時換密碼，換好之前先不同步
const listeners = new Set();

const getLS = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const setLS = (k, v) => {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 無痕視窗等，忽略 */ }
};

/** app.js 啟動時交代：怎麼拿 Firebase app、IndexedDB 的存取函式、是不是跑在新版 App 裡 */
export function init(options) { env = options; }

/** 登入狀態或同步進度有變就通知畫面 */
export function onChange(cb) { listeners.add(cb); }
function emit() {
  const snap = { user, sync: { ...state } };
  for (const cb of listeners) { try { cb(snap); } catch { /* 畫面出錯不影響同步 */ } }
}
function setState(patch) { state = { ...state, ...patch }; emit(); }

export const current = () => user;
export const syncState = () => ({ ...state });

function recPhotos(r) {
  if (Array.isArray(r?.photos) && r.photos.length) return r.photos;
  return r?.photo ? [r.photo] : [];
}

/* ---------- 載 Firebase（第一次要用才載） ---------- */

function load() {
  if (!fb) {
    fb = (async () => {
      const { app, sdk } = await env.firebaseApp();
      const [A, F] = await Promise.all([
        import(sdk + "firebase-auth.js"),
        import(sdk + "firebase-firestore-lite.js"),
      ]);
      let auth;
      try {
        // 不用 popup / redirect（WebView 裡不能用），所以不帶 popupRedirectResolver
        auth = A.initializeAuth(app, { persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence] });
      } catch {
        auth = A.getAuth(app);          // 上一次載到一半失敗、已經初始化過了
      }
      auth.languageCode = "zh-TW";      // 登入信用繁體中文
      return { auth, db: F.getFirestore(app), A, F };
    })();
    fb.catch(() => { fb = null; });
  }
  return fb;
}

/** 開始看登入狀態；第一次知道有沒有登入時 resolve */
export function start() {
  if (!ready) {
    ready = load().then(({ auth, A }) => new Promise((resolve) => {
      A.onAuthStateChanged(auth, (u) => {
        const before = user?.uid;
        // 只認用 email 連結登入過的（email 已驗證）；其他情況一律當沒登入
        user = u && u.emailVerified ? { uid: u.uid, email: u.email || "" } : null;
        if (user?.uid !== before) state = { ...IDLE };   // 換了人，進度從頭算
        emit();
        resolve();
        if (user && user.uid !== before) syncSoon(0);
      });
    }));
    ready.catch(() => { ready = null; });
  }
  return ready;
}

/* ---------- 登入、登出 ---------- */

/** 寄登入信。App 裡寄的信要跳回 App 完成登入，瀏覽器寄的就在瀏覽器完成 */
export async function sendLink(email) {
  const { auth, A } = await load();
  const url = new URL("login.html", location.href);
  url.search = "?via=" + (env.inApp() ? "app" : "web");
  url.hash = "";
  await A.sendSignInLinkToEmail(auth, email, { url: url.href, handleCodeInApp: true });
  setLS(EMAIL_KEY, email);
}

/** 剛剛寄信時填的 email（同一支手機才有） */
export const savedEmail = () => getLS(EMAIL_KEY) || "";

/** 網址看起來是不是登入連結（不用先載 Firebase） */
export function looksLikeLink(url) {
  // 參數有時被包在 link= 裡面（編碼過），兩種都認
  return /oobCode(=|%3D)/i.test(url) && /mode(=|%3D)signIn/i.test(url);
}

/** 點了信裡的連結回來：完成登入 */
export async function finishLink(link, email) {
  const { auth, A } = await load();
  if (!A.isSignInWithEmailLink(auth, link)) {
    const e = new Error("not a sign-in link");
    e.code = "auth/argument-error";
    throw e;
  }
  let claimed;
  claiming = new Promise((resolve) => { claimed = resolve; });
  try {
    const cred = await A.signInWithEmailLink(auth, email, link);
    setLS(EMAIL_KEY, null);
    await claim(cred.user).catch(() => { /* 下次登入會再試 */ });
    return cred.user;
  } finally {
    claimed();
  }
}

/* 第一次用這個 email 登入時，換一組沒有人知道的密碼：
   就算有人先拿這個 email 設過密碼帳號，也再也登不進來（改密碼也會踢掉他的登入）。
   App 本身從來不用密碼登入。 */
async function claim(u) {
  const { db, A, F } = await load();
  const ref = F.doc(db, "users", u.uid);
  const snap = await F.getDoc(ref);
  if (snap.exists() && snap.get("claimed")) return;
  const raw = new Uint8Array(24);
  crypto.getRandomValues(raw);
  try { await A.updatePassword(u, btoa(String.fromCharCode(...raw))); } catch { /* 換不了就算了，規則還要 email 驗證過 */ }
  await F.setDoc(ref, { claimed: true, at: F.serverTimestamp() }, { merge: true });
}

export async function logout() {
  const { auth, A } = await load();
  await A.signOut(auth);
}

/* ---------- 同步 ---------- */

let syncing = null;
let again = false;
let timer = 0;

/** 過一下再同步（連續好幾個變動只跑一次） */
export function syncSoon(delay = 800) {
  if (!user) return;
  clearTimeout(timer);
  timer = setTimeout(() => { sync().catch(() => { /* 狀態裡有錯誤，畫面自己顯示 */ }); }, delay);
}

/** 把手機和雲端對齊一次：先送刪除、再傳新的紀錄、最後抓雲端比上次新的 */
export function sync() {
  if (!user) return Promise.resolve();
  if (syncing) { again = true; return syncing; }
  syncing = (async () => {
    try {
      do {
        again = false;
        await claiming;
        const uid = user?.uid;
        if (!uid) break;
        await pushDeletes(uid);
        await pushRecords(uid);
        await pull(uid);
        if (env.trips) {
          await pushTripDeletes(uid);
          await pushTrips(uid);
          await pullTrips(uid);
        }
      } while (again && user);
      setState({ phase: "idle", done: 0, total: 0, error: null, rounds: state.rounds + 1 });
    } catch (err) {
      if (user) console.warn("雲端同步沒成功", err?.code || err);
      setState({ phase: "idle", done: 0, total: 0, error: err });
      throw err;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

async function bytesOf(F, blob) {
  return F.Bytes.fromUint8Array(new Uint8Array(await blob.arrayBuffer()));
}
function blobOf(bytes) {
  return bytes?.toUint8Array ? new Blob([bytes.toUint8Array()], { type: "image/jpeg" }) : null;
}
function parse(j) {
  try { return JSON.parse(j); } catch { return null; }
}

// Firestore 一份文件最多 1 MiB；照片都縮過，正常遠小於這個，萬一超過就不傳那一張
const MAX_PHOTO = 1000000;

/** 這支手機上還沒傳的紀錄：自己的、標了 dirty；或是沒主人的（登入前辨的） */
async function pushRecords(uid) {
  const all = await env.hist.all();
  const todo = all.filter((r) => (r.owner === uid && r.dirty) || !r.owner).sort((a, b) => a.t - b.t);
  if (!todo.length) return;
  const { db, F } = await load();
  setState({ phase: "up", done: 0, total: todo.length, error: null });
  for (const r of todo) {
    if (user?.uid !== uid) return;                   // 傳到一半登出了
    const photos = recPhotos(r).filter((b) => b && b.size <= MAX_PHOTO);
    // 先傳照片再寫紀錄，別支手機看到紀錄時照片一定已經在了
    for (let i = 0; i < photos.length; i++) {
      await F.setDoc(F.doc(db, "users", uid, "photos", `${r.id}_${i}`), { b: await bytesOf(F, photos[i]), t: r.t });
    }
    await F.setDoc(F.doc(db, "users", uid, "history", r.id), {
      t: r.t,
      j: JSON.stringify(r.data ?? null),
      n: photos.length,
      thumb: r.thumb && r.thumb.size <= MAX_PHOTO ? await bytesOf(F, r.thumb) : null,
      del: false,
      u: F.serverTimestamp(),
    });
    // 讀和寫在同一個交易裡，傳的時候被刪掉的紀錄才不會又被寫回來
    const still = await env.hist.patch(r.id, (fresh) => {
      fresh.owner = uid;
      delete fresh.dirty;
    });
    if (!still) queueDelete(uid, r.id, photos.length);   // 傳的時候被刪掉了，雲端也要刪
    setState({ done: state.done + 1, pushed: state.pushed + 1 });
  }
}

/** 抓雲端比上次新的：新的紀錄存進手機（照片先不抓），有刪除標記的從手機刪掉 */
async function pull(uid) {
  const { db, F } = await load();
  const since = Number(getLS(pullKey(uid)) || 0);
  const col = F.collection(db, "users", uid, "history");
  const base = F.query(col, F.where("u", ">", F.Timestamp.fromMillis(since)), F.orderBy("u"));

  // 第一次（例如換了新手機）才算要拿幾筆，畫面可以顯示「8 / 24」；這支手機剛傳上去的不算
  let total = 0;
  if (!since) {
    try {
      const inCloud = (await F.getCount(F.query(col, F.where("del", "==", false)))).data().count;
      const here = (await env.hist.all()).filter((r) => r.owner === uid).length;
      total = Math.max(0, inCloud - here);
    } catch {
      total = 0;
    }
  }
  if (total) setState({ phase: "down", done: 0, total });

  let cursor = null;
  let newest = since;
  let got = 0;
  for (;;) {
    const page = cursor ? F.query(base, F.startAfter(cursor), F.limit(PAGE)) : F.query(base, F.limit(PAGE));
    const snap = await F.getDocs(page);
    for (const d of snap.docs) {
      if (user?.uid !== uid) return;
      const v = d.data();
      const u = v.u?.toMillis?.() ?? 0;
      if (u > newest) newest = u;
      const local = await env.hist.get(d.id);
      if (v.del) {
        if (local && local.owner === uid) await env.hist.del(d.id);
        continue;
      }
      if (local) continue;                           // 已經有了（多半是這支手機自己傳上去的）
      await env.hist.put({
        id: d.id, t: v.t, data: parse(v.j), thumb: blobOf(v.thumb), photos: [], n: v.n || 0, owner: uid,
      });
      got++;
      if (total) setState({ done: Math.min(total, state.done + 1) });
    }
    if (snap.docs.length < PAGE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  setLS(pullKey(uid), String(newest));
  if (got) setState({ pulled: state.pulled + got });
}

/* ---------- 刪除 ---------- */

function readDel(uid) {
  try { return JSON.parse(getLS(delKey(uid)) || "[]"); } catch { return []; }
}
function queueDelete(uid, id, n) {
  const list = readDel(uid).filter((x) => x.id !== id);
  list.push({ id, n });
  setLS(delKey(uid), JSON.stringify(list));
}

/** 畫面上刪了一筆：傳上去過的，雲端也要刪（記在手機裡，沒網路就等下次同步） */
export function recordDeleted(rec) {
  const uid = rec?.owner;
  if (!uid) return;                                  // 還沒傳上去過，雲端本來就沒有
  queueDelete(uid, rec.id, Math.max(rec.n || 0, recPhotos(rec).length));
  if (user?.uid === uid) syncSoon(0);
}

async function pushDeletes(uid) {
  const list = readDel(uid);
  if (!list.length) return;
  const { db, F } = await load();
  for (const { id, n } of list) {
    for (let i = 0; i < (n || 0); i++) await F.deleteDoc(F.doc(db, "users", uid, "photos", `${id}_${i}`));
    // 紀錄本身留一個刪除標記，別支手機同步時才知道要刪
    await F.setDoc(F.doc(db, "users", uid, "history", id), { del: true, u: F.serverTimestamp() });
    setLS(delKey(uid), JSON.stringify(readDel(uid).filter((x) => x.id !== id)));
  }
}

/* ---------- 行車紀錄（trip.js 的每一趟） ---------- */

// 路線點 [t, lat, lon, v, acc] 存成字串：時間改成從開始算起的毫秒、小數少幾位，一趟 4000 點大約 150 KB
function packPts(start, pts) {
  return JSON.stringify((pts || []).map((p) => [p[0] - start, +Number(p[1]).toFixed(6), +Number(p[2]).toFixed(6), +Number(p[3] || 0).toFixed(2), Math.round(p[4] || 0)]));
}
function unpackPts(start, j) {
  const a = parse(j);
  return Array.isArray(a) ? a.map((p) => [start + p[0], p[1], p[2], p[3], p[4]]) : [];
}
// Firestore 一份文件最多 1 MiB；點太多就隔一個丟一個，直到塞得下
const MAX_DOC = 900000;

/** 這支手機上還沒傳的趟：自己的、標了 dirty；或是沒主人的（登入前記的） */
async function pushTrips(uid) {
  const all = await env.trips.all();
  const todo = all.filter((t) => (t.owner === uid && t.dirty) || !t.owner).sort((a, b) => a.start - b.start);
  if (!todo.length) return;
  const { db, F } = await load();
  setState({ phase: "tup", done: 0, total: todo.length, error: null });
  for (const t of todo) {
    if (user?.uid !== uid) return;
    let pts = t.pts || [];
    let p = packPts(t.start, pts);
    while (p.length > MAX_DOC && pts.length > 2) {
      pts = pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
      p = packPts(t.start, pts);
    }
    await F.setDoc(F.doc(db, "users", uid, "trips", t.id), {
      mode: t.mode, start: t.start, end: t.end, pausedMs: t.pausedMs || 0, elapsed: t.elapsed, moving: t.moving,
      dist: t.dist, maxV: t.maxV, maxAt: t.maxAt ?? null, launch: t.launch ?? null,
      p, del: false, u: F.serverTimestamp(),
    });
    const still = await env.trips.patch(t.id, (fresh) => {
      fresh.owner = uid;
      delete fresh.dirty;
    });
    if (!still) queueTripDelete(uid, t.id);        // 傳的時候被刪掉了，雲端也要刪
    setState({ done: state.done + 1 });
  }
}

/** 抓雲端比上次新的趟：新的存進手機，有刪除標記的從手機刪掉 */
async function pullTrips(uid) {
  const { db, F } = await load();
  const since = Number(getLS(tpullKey(uid)) || 0);
  const col = F.collection(db, "users", uid, "trips");
  const base = F.query(col, F.where("u", ">", F.Timestamp.fromMillis(since)), F.orderBy("u"));
  let total = 0;
  if (!since) {
    try {
      const inCloud = (await F.getCount(F.query(col, F.where("del", "==", false)))).data().count;
      const here = (await env.trips.all()).filter((t) => t.owner === uid).length;
      total = Math.max(0, inCloud - here);
    } catch {
      total = 0;
    }
  }
  if (total) setState({ phase: "tdown", done: 0, total });

  let cursor = null;
  let newest = since;
  for (;;) {
    const page = cursor ? F.query(base, F.startAfter(cursor), F.limit(PAGE)) : F.query(base, F.limit(PAGE));
    const snap = await F.getDocs(page);
    for (const d of snap.docs) {
      if (user?.uid !== uid) return;
      const v = d.data();
      const u = v.u?.toMillis?.() ?? 0;
      if (u > newest) newest = u;
      const local = await env.trips.get(d.id);
      if (v.del) {
        if (local && local.owner === uid) await env.trips.del(d.id);
        continue;
      }
      if (local) continue;
      await env.trips.put({
        id: d.id, mode: v.mode, start: v.start, end: v.end, pausedMs: v.pausedMs || 0, elapsed: v.elapsed, moving: v.moving,
        dist: v.dist, maxV: v.maxV, maxAt: v.maxAt ?? null, launch: v.launch ?? null,
        pts: unpackPts(v.start, v.p), owner: uid,
      });
      if (total) setState({ done: Math.min(total, state.done + 1) });
    }
    if (snap.docs.length < PAGE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  setLS(tpullKey(uid), String(newest));
}

function readTripDel(uid) {
  try { return JSON.parse(getLS(tdelKey(uid)) || "[]"); } catch { return []; }
}
function queueTripDelete(uid, id) {
  const list = readTripDel(uid).filter((x) => x !== id);
  list.push(id);
  setLS(tdelKey(uid), JSON.stringify(list));
}
/** 畫面上刪了一趟：傳上去過的，雲端也要刪（沒網路就等下次同步） */
export function tripDeleted(t) {
  const uid = t?.owner;
  if (!uid) return;
  queueTripDelete(uid, t.id);
  if (user?.uid === uid) syncSoon(0);
}
async function pushTripDeletes(uid) {
  const list = readTripDel(uid);
  if (!list.length) return;
  const { db, F } = await load();
  for (const id of list) {
    await F.setDoc(F.doc(db, "users", uid, "trips", id), { del: true, u: F.serverTimestamp() });
    setLS(tdelKey(uid), JSON.stringify(readTripDel(uid).filter((x) => x !== id)));
  }
}

/* ---------- 照片 ---------- */

/** 一筆紀錄的照片；從雲端拿回來的紀錄第一次點開才下載，下載後存在手機 */
export async function photosFor(rec) {
  const have = recPhotos(rec);
  if (have.length || !rec?.n || !user || rec.owner !== user.uid) return have;
  const { db, F } = await load();
  const blobs = [];
  for (let i = 0; i < rec.n; i++) {
    const s = await F.getDoc(F.doc(db, "users", user.uid, "photos", `${rec.id}_${i}`));
    const b = s.exists() ? blobOf(s.get("b")) : null;
    if (b) blobs.push(b);
  }
  if (blobs.length) await env.hist.patch(rec.id, (fresh) => { fresh.photos = blobs; });
  return blobs;
}
