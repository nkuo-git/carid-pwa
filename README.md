# 大便龍的辨車軟體 — 可安裝版（PWA）

拍一張汽車照片，辨識出品牌、車型、動力規格與行情，結果整理成一張表。
這個版本是可以「安裝」到手機主畫面的獨立 App：有自己的圖示、開起來沒有瀏覽器網址列、離線也開得起來（但辨識本身一定要連網）。

跟 Claude 對話裡那個版本的差別：**不需要登入 Claude**，改成直接呼叫 Google Gemini API，用你自己的 Gemini 金鑰（有免費額度）。

---

## 一、放上網（擇一）

PWA 必須從 **HTTPS** 網址開啟才能安裝，所以要先放到一個網站上。

### Firebase Hosting（專案裡已經附好設定）

```bash
npm install -g firebase-tools     # 只要裝一次
firebase login                    # 只要登入一次
cd carid-pwa
firebase deploy --only hosting --project <你的專案 ID>
```

`firebase.json` 已經寫好了，包含 Service Worker 不要被快取的 header，不用再 `firebase init`。
如果這個 Firebase 專案還沒開過 Hosting，先到 Firebase 主控台把 Hosting 打開，或跑一次 `firebase init hosting`（public 目錄選 `.`、single-page app 選 No、**不要**讓它覆蓋 `index.html`）。

### 其他靜態空間

整個資料夾原樣上傳即可，沒有 build 步驟，也沒有後端。GitHub Pages、Cloudflare Pages、Netlify 都可以。
唯一要求是 HTTPS，而且 `sw.js` 要能從網站根目錄（或 App 所在的子目錄）讀到。

### 在電腦上先看看

```bash
cd carid-pwa
npx http-server -p 8080 .
# 開 http://localhost:8080
```

`localhost` 也算安全來源，Service Worker 會正常註冊。

---

## 二、裝到手機

1. 用手機瀏覽器開剛才的 HTTPS 網址。
2. **Android / Chrome**：右上角選單選「安裝應用程式」，或直接按 App 標題列右上角的下載圖示。
3. **iPhone / Safari**：分享按鈕 →「加入主畫面」。
4. 主畫面會多一個圖示，開起來是全螢幕，沒有網址列。

---

## 三、設定 Gemini 金鑰

第一次開啟會要求輸入 Gemini API 金鑰：

1. 到 <https://aistudio.google.com/apikey> 用 Google 帳號建立一組金鑰（新的金鑰是 `AQ.` 開頭，舊的是 `AIza` 開頭，兩種都可以），建立金鑰本身免費。
2. 貼進 App 按「存起來」。
3. 之後要換或清掉，按右上角齒輪 →「金鑰」那一列。

金鑰存在這支手機瀏覽器的 `localStorage`，只有這個網域讀得到，不會送到 Google 以外的任何地方，也不在原始碼裡。
清除瀏覽器資料或換手機就要重新輸入一次。

**關於 Google AI Pro 訂閱**：Gemini App 的訂閱和 Gemini API 是兩套計費，訂閱不會自動給你 API 額度。
免費額度是逐個模型算的，實測 `gemini-3.8-flash` 只有每天 20 次，所以才做成兩個模型接力。自己每個模型的實際額度可以在 <https://aistudio.google.com/rate-limit> 看到，要更多就在那裡升級成付費方案。

## 四、檔案結構

```
carid-pwa/
├── index.html                  App 的畫面
├── styles.css                  樣式（含深色模式與自訂主色）
├── app.js                      全部邏輯：選照片、縮圖、呼叫 API、畫表格
├── manifest.webmanifest        App 名稱、圖示、啟動方式
├── sw.js                       Service Worker，快取 App 本體
├── firebase.json               Firebase Hosting 設定
└── icons/                      主畫面圖示
```

### 它怎麼運作

照片在手機上先縮到最長邊 1600px、轉成 JPEG，再以 base64 直接 POST 到
`https://generativelanguage.googleapis.com/v1beta/interactions`（`x-goog-api-key` 帶金鑰），
模型依序試 `gemini-flash-lite-latest` → `gemini-flash-latest`，前一個失敗（例如額度用完）就自動換下一個，兩個都失敗才顯示錯誤。使用者不用選。「深入」才帶 `generation_config.thinking_level: "high"`，「標準」不帶，讓每個模型用自己的預設值（有些模型不收這個欄位會回 400）。
回應的文字在 `steps` 裡 `type: "model_output"` 那一段，取出來解析成 JSON 後畫成表格；解析失敗會提示再試一次。照片不會被存到任何地方。

### 要改辨識內容

改 `app.js` 裡的 `PROMPT`（JSON 欄位與規則都寫在那裡），再改 `renderResult()` 裡對應的那幾行 `row(...)`。

### 改版之後

改完推上 `main`，GitHub Pages 過一兩分鐘就是新版；順手把 `sw.js` 開頭的 `CACHE = "carid-v5"` 加一號，
新的 Service Worker 才會重新抓一份乾淨的檔案。

App 那邊不用重裝也不用手動清快取：每次開啟、每次從背景切回來，都會去問有沒有新版（最多一分鐘一次）。
抓到新版時，如果使用者手上沒有照片也沒在辨識，就直接換過去並重新載入；
正在用的話會跳一條「有新版本可以用了」的橫幅，按了才換，不會把做到一半的事情洗掉。

---

## 五、驗證到哪裡

**已經用真的金鑰打過 Gemini API**（2026-09-20，Nick 提供的那把，之後已請他撤銷）：
端點、`x-goog-api-key` 驗證、模型名稱 `gemini-3.8-flash` 都正確，回應 200。
那次實測修掉了兩個會讓 App 直接壞掉的錯誤：

- `thinking_level` 原本「標準」模式送的是 `"minimal"`，這個模型不收，回 400。已改成 low / high。
- 回應裡其實**沒有** `output_text` 欄位，文字在 `steps` 裡 `type: "model_output"` 那一段。解析已改成先讀那一段，並跳過 `thought` 步驟。

**還沒驗證的**：用真金鑰跑完整的一次照片辨識（我這邊沒有車的照片可以送），
以及瀏覽器直連的 CORS。所以第一次部署後請先拿一張車的照片實測一次。
如果跳「連不到 Gemini API」，就是 CORS 被擋了；解法是加一層很薄的後端代理
（Cloud Function 或 Cloudflare Worker），App 改打那個網址即可，畫面完全不用動。

其餘用假回應驗證過的部分不變：App 開得起來、金鑰畫面與拍照畫面會正確切換、
Service Worker 註冊成功、回來的 JSON 能正確畫成表格、403 之類的錯誤會顯示成看得懂的中文訊息。

## 六、之後想包成 APK

這個 PWA 可以用 [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) 或 PWABuilder 包成 TWA 的 APK，
畫面和邏輯完全沿用，不需要重寫成 Flutter。需要的話再說。
