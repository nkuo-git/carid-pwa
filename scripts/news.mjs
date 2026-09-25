// 車訊產生器 —— 每週三（汽車介紹，挑的都是豪車）、六（新車快訊）、日（汽車原理）各一篇。
//
// 原則照「每日新聞」那套：事實只從真實來源來（新聞走 RSS，豪車和原理走維基百科），
// Gemini 只負責挑選和改寫成繁體中文，不准加來源裡沒有的事實。
// 連結、來源名稱、照片一律由這支程式從原始資料帶回，不經 AI 之手。
//
// 用法（GitHub Actions 會替你跑，見 .github/workflows/news.yml）：
//   node scripts/news.mjs                 照台北今天星期幾決定寫哪一種，今天已經有了就不做
//   node scripts/news.mjs --kind lux      指定種類：lux 汽車介紹 / new 新車快訊 / how 汽車原理
//   node scripts/news.mjs --force         今天已經有了也重做一篇蓋掉
//   node scripts/news.mjs --date 2026-09-23 補發時排到那天那一格（沒給 --kind 就照那天星期幾）
//   node scripts/news.mjs --probe         只試抓所有來源，印出抓到幾筆，不叫 Gemini、不寫檔
//   node scripts/news.mjs --mock out.json 不叫 Gemini，拿檔案內容當模型的回答（本機測試用）
//
// 需要環境變數 GEMINI_API_KEY（放在 repo 的 Secrets，絕對不要寫進程式或 repo）。

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const DIR = new URL("../news/", import.meta.url);
const INDEX = new URL("index.json", DIR);
const META = new URL("meta.json", DIR);
const KEEP_ITEMS = 60;
const KEEP_USED = 300;
const UA = "carid-news/1.0 (https://github.com/nkuo-git/carid-pwa)";
const MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest"];

const KIND_BY_WEEKDAY = { 3: "lux", 6: "new", 0: "how" };
const KIND_NAME = { lux: "週三汽車介紹", new: "週六新車快訊", how: "週日汽車原理" };

/* ---------- 參數 ---------- */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes("--" + name);
const opt = (name) => { const i = argv.indexOf("--" + name); return i >= 0 ? argv[i + 1] : ""; };

function taipeiNow() {
  const d = new Date(Date.now() + 8 * 3600e3);
  return { date: d.toISOString().slice(0, 10), wd: d.getUTCDay() };
}

/* ---------- 來源 ---------- */

// 新車快訊的 RSS。個別掛掉只記警告，不影響整體。
const FEEDS = [
  { name: "Google 新聞（台灣）", lang: "zh", url: "https://news.google.com/rss/search?q=%E6%96%B0%E8%BB%8A+%E7%99%BC%E8%A1%A8+when:7d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant" },
  { name: "Google 新聞（台灣）", lang: "zh", url: "https://news.google.com/rss/search?q=%E6%96%B0%E8%BB%8A+%E4%B8%8A%E5%B8%82+%E5%8F%B0%E7%81%A3+when:7d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant" },
  { name: "Motor1", lang: "en", url: "https://www.motor1.com/rss/news/all/" },
  { name: "Carscoops", lang: "en", url: "https://www.carscoops.com/feed/" },
  { name: "Car and Driver", lang: "en", url: "https://www.caranddriver.com/rss/all.xml/" },
];

// 豪車與原理的題目，照順序輪，寫過的跳過。標題是英文維基百科的條目名稱。
const TOPICS = {
  lux: [
    "Rolls-Royce Spectre", "Ferrari F40", "Lamborghini Countach", "McLaren F1", "Porsche 918 Spyder",
    "Bugatti Veyron", "Pagani Zonda", "Koenigsegg Jesko", "Aston Martin Valkyrie", "Lexus LFA",
    "Mercedes-AMG One", "Rolls-Royce Phantom VIII", "Ferrari SF90 Stradale", "Lamborghini Revuelto",
    "Bentley Continental GT", "Porsche Carrera GT", "Bugatti Chiron", "Pagani Huayra", "McLaren P1",
    "Ferrari LaFerrari", "Rimac Nevera", "Aston Martin DB5", "Mercedes-Benz 300 SL", "Ford GT",
    "Lamborghini Aventador", "Koenigsegg Regera", "Porsche 959", "Ferrari Purosangue", "Rolls-Royce Cullinan",
    "McLaren Senna", "Bugatti Tourbillon", "Pagani Utopia", "Maserati MC20", "Lotus Evija",
    "Cadillac Celestiq", "Bentley Bentayga", "Lamborghini Urus", "Porsche Taycan", "Mercedes-Benz G-Class",
    "Ferrari 12Cilindri",
  ],
  how: [
    "Turbocharger", "Dual-clutch transmission", "Anti-lock braking system", "Differential (mechanical device)",
    "Regenerative braking", "Continuously variable transmission", "Hybrid electric vehicle", "Supercharger",
    "Variable valve timing", "Electronic stability control", "Four-stroke engine", "Wankel engine",
    "Disc brake", "Limited-slip differential", "Fuel injection", "Intercooler", "Torque converter",
    "Plug-in hybrid", "Flat engine", "Catalytic converter", "MacPherson strut", "Double wishbone suspension",
    "Power steering", "Crumple zone", "Airbag", "Adaptive cruise control", "Diesel engine", "Four-wheel drive",
    "Manual transmission", "Traction control system", "Start-stop system", "Cylinder deactivation",
    "Automotive aerodynamics", "Downforce", "Head-up display", "Fuel cell vehicle", "Lithium-ion battery",
    "Active suspension", "Collision avoidance system", "Straight-six engine",
  ],
};

async function get(url, type = "text") {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": type === "json" ? "application/json" : "*/*" },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
  return type === "json" ? res.json() : res.text();
}

const decode = (s) => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/\s+/g, " ").trim();

function tag(block, name) {
  const m = block.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"));
  return m ? m[1] : "";
}

/* 抓一個 RSS，回傳 [{title, desc, link, source, img, time}] */
async function readFeed(feed) {
  const xml = await get(feed.url);
  const out = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const b = m[0];
    const title = decode(tag(b, "title"));
    const link = decode(tag(b, "link")) || (b.match(/<guid[^>]*>(https?:[^<]+)<\/guid>/i)?.[1] ?? "");
    if (!title || !/^https?:\/\//.test(link)) continue;
    // 同一張圖常列好幾種尺寸，由小到大，取最後一個
    const imgs = [...b.matchAll(/<(?:media:content|media:thumbnail|enclosure)[^>]*\surl="([^"]+)"/gi)]
      .map((x) => x[1].replace(/&amp;/g, "&"))
      .filter((u) => /^https:\/\//.test(u) && !/\.(mp4|mp3|m4a)(\?|$)/i.test(u));
    const time = Date.parse(decode(tag(b, "pubDate")) || decode(tag(b, "dc:date"))) || 0;
    out.push({
      title,
      desc: decode(tag(b, "description")).slice(0, 600),
      link,
      source: decode(tag(b, "source")) || feed.name,
      img: imgs.at(-1) || "",
      lang: feed.lang,
      time,
    });
  }
  return out;
}

async function newsCandidates(used) {
  const seenLinks = new Set(used.map((u) => u.k));
  const cutoff = Date.now() - 8 * 864e5;
  const all = [];
  for (const f of FEEDS) {
    try {
      const items = (await readFeed(f))
        .filter((x) => !seenLinks.has(x.link) && (!x.time || x.time >= cutoff))
        .slice(0, 10);
      console.log(`  ${f.name}（${f.lang}）：${items.length} 筆`);
      all.push(...items);
    } catch (e) {
      console.log(`::warning::${f.name} 抓不到：${e.message}`);
    }
  }
  // 同一個標題（常見於 Google 新聞轉載）只留一筆
  const byTitle = new Map();
  for (const x of all) if (!byTitle.has(x.title)) byTitle.set(x.title, x);
  const list = [...byTitle.values()];
  let z = 0, e = 0;
  for (const x of list) x.id = x.lang === "zh" ? "Z" + (++z) : "E" + (++e);
  return list;
}

/* 維基百科：英文全文當主要事實來源，中文條目（有的話）用來對照譯名；再帶回首圖與授權 */
async function wikiSource(title) {
  const api = "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1" +
    "&prop=extracts|pageimages|langlinks|info&inprop=url&explaintext=1&exsectionformat=plain" +
    "&piprop=name&lllang=zh&titles=" + encodeURIComponent(title);
  const j = await get(api, "json");
  const p = j?.query?.pages?.[0];
  if (!p || p.missing || !p.extract) throw new Error("維基百科沒有這個條目：" + title);

  const src = {
    title: p.title,
    en: cleanExtract(p.extract).slice(0, 9000),
    enUrl: p.fullurl || "https://en.wikipedia.org/wiki/" + encodeURIComponent(p.title.replace(/ /g, "_")),
    zh: "", zhTitle: "", zhUrl: "",
    img: "", imgCredit: "",
  };

  const zhTitle = p.langlinks?.[0]?.title;
  if (zhTitle) {
    try {
      const z = await get("https://zh.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1" +
        "&prop=extracts&explaintext=1&exsectionformat=plain&variant=zh-tw&titles=" + encodeURIComponent(zhTitle), "json");
      const zp = z?.query?.pages?.[0];
      if (zp?.extract) {
        src.zh = cleanExtract(zp.extract).slice(0, 4000);
        src.zhTitle = zp.title;
        src.zhUrl = "https://zh.wikipedia.org/zh-tw/" + encodeURIComponent(zp.title.replace(/ /g, "_"));
      }
    } catch (e) { console.log("::warning::中文維基抓不到：" + e.message); }
  }

  // 首圖只用 Wikimedia Commons 上有自由授權的；只在英文維基本地的（通常是合理使用）就不用
  if (p.pageimage) {
    try {
      const c = await get("https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2" +
        "&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1280&titles=" + encodeURIComponent("File:" + p.pageimage), "json");
      const cp = c?.query?.pages?.[0];
      const info = cp && !cp.missing ? cp.imageinfo?.[0] : null;
      const meta = info?.extmetadata || {};
      const license = decode(meta.LicenseShortName?.value);
      if (info && license && !/fair use|non-free/i.test(license)) {
        src.img = info.thumburl || info.url;
        const artist = decode(meta.Artist?.value).slice(0, 80) || "佚名";
        src.imgCredit = `${artist}／${license}，Wikimedia Commons`;
      }
    } catch (e) { console.log("::warning::照片授權查不到：" + e.message); }
  }
  return src;
}

function cleanExtract(t) {
  // 砍掉參考資料、外部連結之後的東西，那些對寫文章沒用
  const cut = t.search(/\n(References|See also|External links|Notes|Further reading|參考文獻|參考資料|參見|外部連結|注釋)\n/);
  return (cut > 0 ? t.slice(0, cut) : t).replace(/\n{3,}/g, "\n\n").trim();
}

/* ---------- Gemini ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gemini(prompt) {
  const mock = opt("mock");
  if (mock) return JSON.parse(await readFile(mock, "utf8"));

  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("還沒設定 GEMINI_API_KEY：到 GitHub repo 的 Settings → Secrets and variables → Actions 新增一個");

  let lastErr;
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      let res;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.6, maxOutputTokens: 12000 },
          }),
          signal: AbortSignal.timeout(120000),
        });
      } catch (e) {
        lastErr = e; console.log(`::warning::${model} 連線失敗：${e.message}`); break;   // 網路層錯誤：換下一個模型
      }
      if (res.status === 429 || res.status === 503) {
        lastErr = new Error(`${model} HTTP ${res.status}`);
        console.log(`::warning::${model} 忙線（${res.status}），35 秒後再試（第 ${attempt} 次）`);
        await sleep(35000);
        continue;
      }
      if (!res.ok) {
        const msg = (await res.json().catch(() => null))?.error?.message || res.statusText;
        lastErr = new Error(`${model} HTTP ${res.status}：${msg}`);
        console.log("::warning::" + lastErr.message);
        break;
      }
      const j = await res.json();
      const text = (j?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      const parsed = parseJson(text);
      if (parsed) return parsed;
      lastErr = new Error(`${model} 回傳的不是合法 JSON`);
      console.log("::warning::" + lastErr.message);
      break;
    }
  }
  throw lastErr || new Error("Gemini 沒有回應");
}

function parseJson(text) {
  const t = String(text || "").replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(t); } catch { /* 寬鬆版 */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* 放棄 */ } }
  return null;
}

/* ---------- 提示詞 ---------- */

const COMMON = `
共同規則：
- 讀者是台灣一般人，不一定懂車。用台灣的繁體中文與用語（例如「馬力」「扭力」「變速箱」「油電」），口吻像懂車的朋友在聊天，清楚、不浮誇、不用驚嘆號。
- 絕對不可以編造或加入下面資料沒有提到的事實、數字、價格或日期。資料沒寫的就不要寫。
- 品牌與車型名稱保留原文（例如 Ferrari、Porsche 911）。
- 只輸出純 JSON，不要 markdown。`;

function promptNews(cands, recentTitles) {
  const fmt = (x) => `${x.id} [${x.source}] ${x.title}\n   ${x.desc}`;
  return `你是汽車 App「大便龍的萬能軟體」的編輯，今天要出「週六新車快訊」。
以下是這週的真實汽車新聞候選，各有編號。請挑「一則」最值得台灣讀者知道的新車消息（新車發表、改款、上市、首度亮相優先；
避免純銷量報表、召回、人事、股價、廣告業配），然後用候選內容改寫成一篇短文。

【中文候選】
${cands.filter((x) => x.lang === "zh").map(fmt).join("\n") || "（無）"}

【英文候選】
${cands.filter((x) => x.lang === "en").map(fmt).join("\n") || "（無）"}

【最近已寫過的（嚴禁再選同一事件或同一台車）】
${recentTitles.map((t) => "- " + t).join("\n") || "（無）"}

輸出格式：{"src":"候選編號，例如 Z2 或 E5","title":"標題，20 字內","lede":"一句話重點，40 字內","sections":[{"h":"","p":["第一段","第二段"]}]}
- sections 只放一個，h 留空字串；p 是 2 段，合計約 220–300 字。
- 只能用你選的那一則候選的標題與摘要裡的內容；摘要太短就寫短一點，不要自己補充規格或價格。
${COMMON}`;
}

function promptLux(src) {
  return `你是汽車 App「大便龍的萬能軟體」的編輯，今天要出「週三汽車介紹」，介紹這台豪車：${src.title}。
下面是維基百科的條目內容，是你唯一可以用的事實來源。

【英文維基百科：${src.title}】
${src.en}

${src.zh ? `【中文維基百科：${src.zhTitle}】（對照譯名用）\n${src.zh}\n` : ""}
輸出格式：
{"make":"品牌原文，例如 Rolls-Royce","title":"車型名稱原文，例如 Spectre","lede":"一兩句話說這台車為什麼特別，60 字內",
 "specs":[["項目","內容"]],
 "sections":[{"h":"為什麼值得認識","p":["段落","段落"]},{"h":"在路上怎麼認出它","p":["段落"]}]}
- specs 3–8 列，只放資料裡明確寫出的規格（引擎或馬達、馬力、扭力、極速、0–100、產量、生產年份等），每格 24 字內，數字照抄資料的單位；資料沒有就少放幾列。
- 「為什麼值得認識」2 段，講它在品牌或汽車史上的位置、設計或技術上的看點。
- 「在路上怎麼認出它」1 段，只寫資料裡提到的外觀特徵；資料完全沒提到外觀就把這一節整個拿掉。
- 全文（lede 加所有段落）約 350–450 字。
${COMMON}`;
}

function promptHow(src) {
  return `你是汽車 App「大便龍的萬能軟體」的編輯，今天要出「週日汽車原理」，主題是：${src.title}。
下面是維基百科的條目內容，是你唯一可以用的事實來源。

【英文維基百科：${src.title}】
${src.en}

${src.zh ? `【中文維基百科：${src.zhTitle}】（對照譯名用）\n${src.zh}\n` : ""}
輸出格式：{"title":"用問句或白話講這個原理，20 字內，例如「渦輪增壓：怎麼把更多空氣塞進引擎」","lede":"一句話說清楚它是什麼，50 字內",
 "sections":[{"h":"它在做什麼","p":["段落"]},{"h":"怎麼運作","p":["段落","段落"]},{"h":"開起來有什麼差別","p":["段落"]}]}
- 小標可以依主題調整，但維持 3 節。用生活化的比喻幫忙理解，比喻不算事實，但不能跟資料矛盾。
- 全文（lede 加所有段落）約 400–500 字。
${COMMON}`;
}

/* ---------- 驗證 ---------- */

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const hanCount = (s) => (String(s).match(/[一-鿿]/g) || []).length;

function clean(out, kind) {
  const a = {
    title: clip(out?.title, 60),
    lede: clip(out?.lede, 160),
    sections: [],
  };
  if (kind === "lux") {
    a.make = clip(out?.make, 30);
    a.specs = (Array.isArray(out?.specs) ? out.specs : [])
      .filter((r) => Array.isArray(r) && r[0] && r[1])
      .slice(0, 8)
      .map((r) => [clip(r[0], 16), clip(r[1], 40)]);
  }
  for (const s of (Array.isArray(out?.sections) ? out.sections : []).slice(0, 5)) {
    const p = (Array.isArray(s?.p) ? s.p : [s?.p]).map((x) => clip(x, 900)).filter(Boolean).slice(0, 4);
    if (p.length) a.sections.push({ h: clip(s?.h, 30), p });
  }
  if (!a.title || !a.sections.length) throw new Error("模型輸出缺標題或內文");
  a._han = hanCount(a.lede + a.sections.map((s) => s.p.join("")).join(""));
  return a;
}

const MIN_HAN = { new: 150, lux: 240, how: 280 };

async function write(prompt, kind) {
  let a = clean(await gemini(prompt), kind);
  if (a._han < MIN_HAN[kind] && !opt("mock")) {
    console.log(`::warning::字數不足（${a._han} 字），再寫一次`);
    try {
      const b = clean(await gemini(prompt + "\n\n上一次的輸出字數不足，務必寫滿規定的字數。"), kind);
      if (b._han > a._han) a = b;          // 第二次無論如何接受比較長的那個（有文章比沒文章好）
    } catch (e) { console.log("::warning::補寫失敗，用第一次的：" + e.message); }
  }
  delete a._han;
  return a;
}

/* ---------- 主程式 ---------- */

async function readJson(url, fallback) {
  try { return JSON.parse(await readFile(url, "utf8")); } catch { return fallback; }
}

async function main() {
  const now = taipeiNow();
  const date = opt("date") || now.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日期要寫成 2026-09-23 這樣：" + date);
  const wd = new Date(date + "T00:00:00Z").getUTCDay();
  const kind = opt("kind") || KIND_BY_WEEKDAY[wd];

  if (flag("probe")) return probe();
  if (!kind) { console.log(`台北 ${date}（星期${"日一二三四五六"[wd]}）不出刊。`); return; }
  if (!KIND_NAME[kind]) throw new Error("不認得的種類：" + kind);

  const index = await readJson(INDEX, { v: 1, items: [] });
  const meta = await readJson(META, { used: [] });
  const id = `${date}-${kind}`;
  if (index.items.some((x) => x.id === id) && !flag("force")) {
    console.log(`${id} 已經有了，不重做（要重做加 --force）。`);
    return;
  }
  console.log(`產生 ${KIND_NAME[kind]}（${date}）`);

  let article, usedKey;
  if (kind === "new") {
    const cands = await newsCandidates(meta.used.filter((u) => u.kind === "new"));
    if (cands.length < 3) throw new Error(`候選新聞只有 ${cands.length} 筆，不出刊，等補跑`);
    const recent = meta.used.filter((u) => u.kind === "new").slice(0, 20).map((u) => u.t);
    const out = await gemini(promptNews(cands, recent));
    const pick = cands.find((x) => x.id === String(out?.src || "").trim());
    if (!pick) throw new Error("模型回的候選編號對不到：" + out?.src);
    article = clean(out, "new");
    delete article._han;
    if (hanCount(article.lede + article.sections.map((s) => s.p.join("")).join("")) < MIN_HAN.new) {
      console.log("::warning::字數偏少，照樣出刊");
    }
    article.sources = [{ name: pick.source, url: pick.link }];
    if (pick.img) article.img = pick.img;
    usedKey = pick.link;
  } else {
    const usedTopics = new Set(meta.used.filter((u) => u.kind === kind).map((u) => u.k));
    let src = null;
    for (const t of TOPICS[kind].filter((t) => !usedTopics.has(t))) {
      try { src = await wikiSource(t); usedKey = t; break; } catch (e) { console.log("::warning::" + e.message); }
    }
    if (!src) throw new Error("題目用完了或維基百科都抓不到，要補題目清單");
    console.log(`  題目：${src.title}（中文條目：${src.zhTitle || "無"}，照片：${src.img ? "有" : "無"}）`);
    article = await write(kind === "lux" ? promptLux(src) : promptHow(src), kind);
    article.sources = [{ name: "維基百科：" + src.title, url: src.enUrl }];
    // 中文條目的標題常是簡體，顯示時不帶標題
    if (src.zhUrl) article.sources.push({ name: "中文維基百科", url: src.zhUrl });
    if (src.img) { article.img = src.img; article.imgCredit = src.imgCredit; }
  }

  const item = { id, date, kind, ...article };
  index.items = [item, ...index.items.filter((x) => x.id !== id)].slice(0, KEEP_ITEMS);
  index.updated = new Date().toISOString();
  meta.used = [{ kind, k: usedKey, t: item.title, d: date }, ...meta.used.filter((u) => !(u.kind === kind && u.k === usedKey))]
    .slice(0, KEEP_USED);

  if (!existsSync(DIR)) await mkdir(DIR, { recursive: true });
  await writeFile(INDEX, JSON.stringify(index, null, 1) + "\n");
  await writeFile(META, JSON.stringify(meta, null, 1) + "\n");
  console.log(`完成：${item.title}`);
}

async function probe() {
  console.log("試抓新車快訊的 RSS：");
  const c = await newsCandidates([]);
  console.log(`  合計候選 ${c.length} 筆，有照片的 ${c.filter((x) => x.img).length} 筆`);
  for (const x of c.slice(0, 6)) console.log(`   ${x.id} ${x.source}｜${x.title}`);
  for (const kind of ["lux", "how"]) {
    const t = TOPICS[kind][0];
    try {
      const s = await wikiSource(t);
      console.log(`${kind} 維基百科「${s.title}」：英文 ${s.en.length} 字元，中文「${s.zhTitle || "無"}」${s.zh.length} 字元，照片 ${s.img ? "有（" + s.imgCredit + "）" : "無"}`);
    } catch (e) { console.log(`::warning::${kind} 維基百科抓不到：${e.message}`); }
  }
  // 題目清單逐一確認條目存在
  for (const kind of ["lux", "how"]) {
    const bad = [];
    for (const t of TOPICS[kind]) {
      try {
        const j = await get("https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&titles=" + encodeURIComponent(t), "json");
        if (j?.query?.pages?.[0]?.missing) bad.push(t);
      } catch { bad.push(t + "（抓不到）"); }
    }
    console.log(`${kind} 題目 ${TOPICS[kind].length} 個，找不到的：${bad.join("、") || "無"}`);
  }
}

main().catch((e) => { console.error("::error::" + e.message); process.exit(1); });
