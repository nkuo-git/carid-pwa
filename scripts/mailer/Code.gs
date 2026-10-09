// 大便龍的萬能軟體：車訊寄信（Google Apps Script 網頁應用程式）
// 用 sl2827.bot@gmail.com 部署：執行身分「我」、存取權「所有人」。
// App 送來 {to, id}，這裡自己去網站拿那篇車訊組成信，所以只能寄車訊、不能寄別的內容。

const NEWS_URL = 'https://nkuo-git.github.io/carid-pwa/news/index.json';
const SITE = 'https://nkuo-git.github.io/carid-pwa/';
const PER_ADDRESS_HOUR = 5;   // 同一個信箱一小時最多幾封
const PER_DAY = 60;           // 一天最多幾封（Gmail 一般帳號一天大約 100 封）

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const to = String(req.to || '').trim().toLowerCase();
    const id = String(req.id || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 254) return out_({ ok: false, err: 'bad-to' });
    if (!/^[\w-]{1,40}$/.test(id)) return out_({ ok: false, err: 'bad-id' });

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const cache = CacheService.getScriptCache();
      const k = 'to:' + Utilities.base64EncodeWebSafe(to);
      const n = Number(cache.get(k) || 0);
      if (n >= PER_ADDRESS_HOUR) return out_({ ok: false, err: 'too-many' });
      const props = PropertiesService.getScriptProperties();
      const day = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
      const used = props.getProperty('day') === day ? Number(props.getProperty('count') || 0) : 0;
      if (used >= PER_DAY || MailApp.getRemainingDailyQuota() < 1) return out_({ ok: false, err: 'quota' });

      const a = findArticle_(id);
      if (!a) return out_({ ok: false, err: 'no-article' });
      const mail = compose_(a);
      MailApp.sendEmail({ to: to, subject: mail.subject, body: mail.text, htmlBody: mail.html, name: '大便龍的萬能軟體' });

      cache.put(k, String(n + 1), 3600);
      props.setProperties({ day: day, count: String(used + 1) });
    } finally {
      lock.releaseLock();
    }
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, err: 'server' });
  }
}

// 打開網址看得到這行就是部署好了
function doGet() {
  return out_({ ok: true, hello: '車訊寄信' });
}

function findArticle_(id) {
  const res = UrlFetchApp.fetch(NEWS_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const items = (JSON.parse(res.getContentText()).items) || [];
  return items.filter(function (x) { return x.id === id; })[0] || null;
}

function compose_(a) {
  const name = a.make && a.title.indexOf(a.make) < 0 ? a.make + ' ' + a.title : a.title;
  const link = SITE + '#news/' + a.id;
  const specs = (a.specs || []).map(function (s) { return s[0] + '：' + s[1]; });
  const text = [a.lede || '', specs.join('\n'), '看整篇（有照片）：\n' + link, '— 從「大便龍的萬能軟體」寄出']
    .filter(String).join('\n\n');
  const rows = (a.specs || []).map(function (s) {
    return '<tr><td style="padding:6px 12px 6px 0;color:#6B7280;white-space:nowrap">' + esc_(s[0]) +
      '</td><td style="padding:6px 0">' + esc_(s[1]) + '</td></tr>';
  }).join('');
  const img = /^https:\/\//.test(a.img || '') ? '<p><img src="' + esc_(a.img) + '" alt="" style="max-width:100%;border-radius:10px"></p>' +
    (a.imgCredit ? '<p style="font-size:12px;color:#6B7280">照片：' + esc_(a.imgCredit) + '</p>' : '') : '';
  const html = '<div style="font-family:sans-serif;font-size:15px;line-height:1.7;color:#1F2329;max-width:560px">' +
    '<h2 style="margin:0 0 8px">' + esc_(name) + '</h2>' + img +
    '<p>' + esc_(a.lede || '') + '</p>' +
    (rows ? '<table style="border-collapse:collapse;font-size:14px">' + rows + '</table>' : '') +
    '<p><a href="' + link + '" style="color:#E35A12;font-weight:bold">看整篇 →</a></p>' +
    '<p style="color:#6B7280;font-size:13px">— 從「大便龍的萬能軟體」寄出</p></div>';
  return { subject: '【車訊】' + name, text: text, html: html };
}

function esc_(s) {
  return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
