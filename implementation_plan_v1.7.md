# Implementation Plan - v1.7.0【功能 2、3 已完工；功能 1 待 P0 盤中驗證】

## 完工狀態（2026-06-11）

* **功能 3 預估金額試算**：完成。抽屜 `#order-est-amount` 即時試算 + 確認 Modal `#conf-est-amount`；MKT 顯示參考提示。
* **功能 2 委託紀錄**：完成。後端 `append_trade_log`（lock + 原子寫入 + 損壞自復原）、`GET /api/trade-logs`、place_order 成功攔截；前端 `tradelogs` 卡片（納入卡片自訂）、Demo 假紀錄閉環。`trade_logs.json` 已被 .gitignore 既有 `*.json` 規則涵蓋。
* **功能 1 未成交委託**：未動工，待盤中實測 `/order/trades`（見 P0 章節，Console 驗證碼可直接貼）。
* **驗證紀錄**：py_compile ✓、node --check ✓、後端隔離測試 13/13（追加/裁切 30/損壞復原/並發 40 筆/端點 200/上游 500 不寫入/權限關閉 400 零上游/非下單端點不寫入）、前端 Node 斷言 14/14（試算邊界、Demo 紀錄閉環、上限 30、賣出超量不記錄、攔截零實體請求、非 Demo 直通）、新元素 id 交叉比對全數 1:1。
* 注意：本機 sandbox 掛載快照曾出現過期截斷視圖；實際檔案（Windows 端）已逐一確認完整。若 git 操作見異常 diff，先重新整理工作目錄再判讀。

> 本文件為技術設計與 Pseudocode。v1.6.0 完工紀錄見 `implementation_plan.md`。
> 文件內所有行號以 2026-06-11 的程式碼為準（dashboard.py 1088 行、web/app.js 3741 行）。

## 範圍

| # | 功能 | 影響檔案 | 後端改動 |
|---|---|---|---|
| 1 | 未成交委託區塊 | index.html / app.js / style.css | 無（通用 proxy 直通） |
| 2 | 最新 30 筆委託 Log | dashboard.py / index.html / app.js | 新增攔截寫檔 + 1 個本機端點 |
| 3 | 下單預估金額試算 | index.html / app.js / style.css | 無 |

**Non-goals（明確不做）**：未成交委託的線上刪單/改價；Log 的成交狀態回填；預估金額含手續費/證交稅計算。

---

## P0 前置驗證（功能 1 的開工前提）

shioaji Python API 的 `list_trades()` 回傳快取，需 `update_status()` 才會刷新。HTTP daemon 的
`POST /api/v1/order/trades` 是否自動刷新 **未驗證**，且盤後行為未知（參考 `trading_limits` 盤後永遠回 500 的前例）。

盤中以瀏覽器 Console 實測一次（走既有 8081 proxy，零新程式碼）：

```js
fetch('http://127.0.0.1:8081/proxy/api/v1/order/trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})   // 若 400，改試帶 account 物件（格式同 place_order 的 account）
}).then(r => r.json()).then(console.log);
```

確認三件事：(a) 端點存在與必要參數；(b) 委託後立即查詢，狀態是否即時（PendingSubmit→Submitted）；
(c) 回傳結構中 `status.status`、`order.id`、`contract.code`、成交均價/數量欄位的實際名稱。
**回傳欄位若與本文假設不符，以實測為準修正 pseudocode 後再動工。**

---

## 功能 1：未成交委託區塊

### 1.1 設計決策

* **單一資料來源**：未成交清單一律由 `POST /order/trades` 重新拉取。SSE `order_event` 只當「觸發器」
  （收到事件 → debounce 後重拉），不手動 patch 本地狀態，避免 SSE 與輪詢競態造成清單不一致。
* **輪詢頻率**：併入 `fetchData()` 既有帳務輪次（每 4 輪 ≈ 60s），不另開 timer，符合既有流量控制。
* **proxy timeout**：`order/` 前綴不在 `portfolio/` 之列 → 沿用 10s，免改。
* **盤後**：若實測盤後回 500，比照 `trading_limits` 以 `isTradingHours()` 跳過。

### 1.2 index.html

`#view-dashboard` 卡片區新增（建議放 settlements 卡之後）：

```html
<div class="card" data-card-key="pendingorders">
    <div class="card-header"><span class="card-title">未成交委託</span></div>
    <table class="data-table">
        <thead><tr>
            <th>時間</th><th>代號</th><th>買賣</th><th>價格</th>
            <th>委託量</th><th>已成交</th><th>狀態</th>
        </tr></thead>
        <tbody id="pending-orders-tbody"></tbody>
    </table>
    <div id="pending-orders-empty" class="empty-hint">目前無未成交委託</div>
</div>
```

卡片自訂設定表單同步新增 `<input type="checkbox" data-card-key="pendingorders">`
（沿用 app.js:2516/2528 的既有機制，無新邏輯）。

### 1.3 app.js Pseudocode

```text
const PENDING_STATUSES = new Set(['PreSubmitted', 'PendingSubmit', 'Submitted', 'PartFilled'])

state 新增:
    pendingOrders: []
    pendingOrdersTimer: null      // SSE debounce 用

async function fetchPendingOrders():
    if not isTradingHours() and 實測確認盤後回 500: 清空並 return   // 視 P0 結果決定保留與否
    resp = await smartFetch(`${API_BASE}/order/trades`, { method:'POST', body:'{}' })
    if not resp.ok: return                          // 失敗保留舊清單，不閃爍
    trades = await resp.json()
    state.pendingOrders = trades
        .filter(t => PENDING_STATUSES.has(t.status?.status))
        .map(t => ({ id, code, name, action, price, qty, filledQty, status, ts }))  // 欄位以 P0 實測為準
    renderPendingOrders()

function renderPendingOrders():
    tbody = #pending-orders-tbody
    清空 tbody；若 state.pendingOrders 為空 → 顯示 #pending-orders-empty 並 return
    逐筆建 <tr>：狀態欄上色（PartFilled 用 val-up；其餘 text-secondary）
    金額欄套用既有 .mask-money 防窺 class

掛載點:
    fetchData() 的帳務輪次（與 settlements 同批 Promise.allSettled）加入 fetchPendingOrders()

    startSSE() 的 onmessage 內、showOrderNotification(data) 之後加:
        clearTimeout(state.pendingOrdersTimer)
        state.pendingOrdersTimer = setTimeout(fetchPendingOrders, 2000)   // debounce 2s
```

### 1.4 Demo 模式配套

```text
demoState 新增:
    pendingOrders: []    // { id, code, action, price, shares, qty, lotType, status, ts }

demoPlaceOrder() 修改（app.js:3615）:
    送出時:  demoState.pendingOrders.push({ id: orderId, status: 'Submitted', ... })
    setTimeout 成交回呼內（既有更新庫存/餘額處）:
        demoState.pendingOrders = demoState.pendingOrders.filter(o => o.id !== orderId)

smartFetch() proxy 區段新增（置於 place_order 攔截之前或之後皆可）:
    if url.includes('/order/trades'):
        return mockResponse(demoState.pendingOrders.map(轉成與真實 API 同構的形狀))

注意: Demo 不建立 SSE（startSSE 已有 demoMode guard，免改），
     假清單更新由 demoPlaceOrder 成交回呼末端既有的 fetchData() 帶動重繪。
```

---

## 功能 2：最新 30 筆委託 Log

### 2.1 設計決策

* **語意**：記錄「委託成功送出」（上游回 2xx 且含 order id），**非成交**。UI 標題用「委託紀錄」。
* **掛點**：`dashboard.py handle_proxy_request()`（547 行起）已攔截 `place_order` 做權限檢核，
  在上游回應成功後同一函式內追加寫檔，不另設端點攔截層。
* **併發**：proxy 為 ThreadingHTTPServer，寫檔加 `threading.Lock`（仿 `shioaji_proc_lock`）。
* **原子寫入**：temp file + `os.replace`，防止寫入中斷產生半截 JSON。
* **損壞自復原**：讀取失敗視為空清單重建，不拋錯（log 是輔助資料，不能影響下單主流程）。
* **防窺**：`trade_logs.json` 含真實交易紀錄，若專案日後納入 git，須加入 `.gitignore`
  （同 credentials.json 等級看待）。

### 2.2 dashboard.py Pseudocode

```text
全域:
    TRADE_LOG_PATH = Path(__file__).parent / "trade_logs.json"
    TRADE_LOG_MAX = 30
    trade_log_lock = threading.Lock()

def append_trade_log(entry):
    with trade_log_lock:
        try:    logs = json.loads(TRADE_LOG_PATH.read_text(encoding='utf-8'))
                if not isinstance(logs, list): logs = []
        except Exception: logs = []                     # 不存在或損壞 → 重建
        logs.insert(0, entry)                           # 新者在前
        logs = logs[:TRADE_LOG_MAX]
        tmp = TRADE_LOG_PATH.with_suffix('.json.tmp')
        tmp.write_text(json.dumps(logs, ensure_ascii=False, indent=2), encoding='utf-8')
        os.replace(tmp, TRADE_LOG_PATH)

handle_proxy_request() 修改 — 成功回應分支（urlopen 成功、wfile.write 之後）:
    if method == "POST" and rel_path == "api/v1/order/place_order" and resp.status == 200:
        try:
            req_body  = json.loads(req_data)        # 委託參數（價格/數量/買賣）
            resp_body = json.loads(resp_data)       # order id
            so = req_body.get("stock_order", {})
            append_trade_log({
                "ts":        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "order_id":  resp_body.get("order", {}).get("id", ""),
                "code":      req_body.get("contract", {}).get("code", ""),
                "action":    so.get("action", ""),          # Buy / Sell
                "price":     so.get("price", 0),
                "quantity":  so.get("quantity", 0),
                "order_lot": so.get("order_lot", ""),       # Common / IntradayOdd（前端據此換算股數）
            })
        except Exception as e:
            print(f"⚠ 委託 Log 寫入失敗（不影響下單）：{e}")   # fail-loud 到終端機，但不回錯給前端

do_GET 路由新增:
    elif self.path == '/api/trade-logs':
        self.handle_get_trade_logs()

def handle_get_trade_logs():
    with trade_log_lock: 讀檔（同 append 的容錯邏輯）
    回 200 + JSON list
```

### 2.3 前端呈現

放儀表板新卡 `data-card-key="tradelogs"`（與未成交委託相鄰，可經卡片自訂隱藏）：

```text
async function fetchTradeLogs():
    resp = await smartFetch('/api/trade-logs')       // 本機端點，走 8081 同源
    logs = await resp.json()
    renderTradeLogs(logs)   // 欄位: 時間/買賣/代號/價格/數量(依 order_lot 標示 張/股)/單號
                            // 買進 val-up、賣出 val-down；金額套 .mask-money

掛載: fetchData() 帳務輪次一併呼叫（每 60s 一次足夠）
```

### 2.4 Demo 模式配套

Demo 定位是「不洩漏真實資料」，本機真實 Log 也不得露出 → 攔截：

```text
demoState 新增: tradeLogs: []
demoPlaceOrder(): 送出成功時 unshift 一筆假 log，slice(0, 30)
smartFetch() 本機端點區段新增:
    if url.includes('/api/trade-logs'): return mockResponse(demoState.tradeLogs)
```

---

## 功能 3：下單預估金額試算

### 3.1 設計決策

* 純前端、即時計算。公式依 task.md 既有規則：
  **整張 = 價格 × 張數 × 1000；零股 = 價格 × 股數**。
* 市價單（MKT）以輸入框現值估算，標註「僅供參考」。
* 不含手續費/證交稅，UI 固定標註「未含費用」。
* 融資/融券不另算自備款（v1.7 不做，金額僅為價 × 股數）。

### 3.2 index.html

```html
<!-- 下單抽屜，數量欄之後 -->
<div class="order-est-row">
    預估交易金額：<span class="mono mask-money" id="order-est-amount">--</span>
    <span class="est-hint" id="order-est-hint">未含手續費及交易稅</span>
</div>

<!-- 確認 Modal：confirm-details-grid 內、conf-qty（index.html:796）之後，沿用既有 confirm-item 結構 -->
<div class="confirm-item">
    <span class="confirm-label">預估金額</span>
    <span class="confirm-value mono mask-money" id="conf-est-amount">--</span>
</div>
```

新增 class（`.order-est-row`、`.est-hint`、`.empty-hint`）須於 style.css 補樣式；
`.mask-money` 為既有防窺機制（`body.boss-mode .mask-money` 規則，style.css:1198），動態列金額欄一律套用。

### 3.3 app.js Pseudocode

```text
function calcOrderAmount(price, qty, lotType):
    if isNaN(price) or isNaN(qty) or price <= 0 or qty <= 0: return null
    return price * qty * (lotType === 'Common' ? 1000 : 1)

function updateOrderEstimate():
    amount = calcOrderAmount(parseFloat(#order-price.value),
                             parseInt(#order-qty.value),
                             #order-lot.value)
    #order-est-amount.textContent = amount === null ? '--'
                                  : `$${Math.round(amount).toLocaleString()}`
    #order-est-hint = (#order-price-type.value === 'MKT')
                    ? '市價單以輸入價估算，僅供參考（未含費用）' : '未含手續費及交易稅'

綁定（initDrawerControls() 既有初始化處，app.js:1517）:
    ['order-price','order-qty'].forEach(id => #id.addEventListener('input',  updateOrderEstimate))
    ['order-lot','order-price-type'].forEach(id => #id.addEventListener('change', updateOrderEstimate))

openOrderDrawer() 末端: updateOrderEstimate()        // 帶入預設值後即顯示

btn-drawer-submit onclick（app.js:1544 灌 Modal 處）追加:
    #conf-est-amount.textContent = 同 updateOrderEstimate 的金額字串
```

---

## 測試計畫

* **後端**：`py_compile`；隔離環境測試 `/api/trade-logs` 與 `append_trade_log`——
  正常追加、第 31 筆裁切、損壞 JSON 自復原、tmp 原子替換、place_order 上游 4xx/5xx 不寫入、
  並發寫入（兩執行緒各 20 筆無交錯損壞）。
* **前端**：`node --check`；新元素 id 交叉比對（pending-orders-tbody / order-est-amount /
  conf-est-amount / tradelogs 卡片 checkbox）；Demo Node 斷言新增——
  demo 下單後 pendingOrders 出現且狀態 Submitted → 模擬成交後移除、tradeLogs unshift 且上限 30、
  `/order/trades` 與 `/api/trade-logs` 攔截回假資料、非 Demo 直通真實 fetch；
  calcOrderAmount 邊界（整張×1000、零股×1、0/負數/NaN 回 null）。
* **驗收標準**：Demo 模式 DevTools Network 維持零實體請求（除靜態資源）；
  實機盤中：下單後未成交清單 2 秒內出現新委託、成交後 2 秒內移除；委託 Log 出現對應紀錄。

## 風險與待決事項

1. **（P0）`/order/trades` 行為未實測**：端點參數、狀態即時性、盤後行為、回傳欄位名。功能 1 全部 pseudocode 的欄位映射以實測為準。
2. **SSE 競態**：已用「事件僅觸發重拉」收斂為單一資料來源；debounce 2s 防止連續回報轟炸。
3. **委託 ≠ 成交**：Log 與未成交區塊的標題、欄位文案須明確區分，避免使用者誤讀。
4. **trade_logs.json 隱私**：含真實交易紀錄；納入 git 前須 .gitignore。
5. **實作順序**：功能 3 → 功能 2 → 功能 1（1 受 P0 阻塞）。三項互不依賴，可分批驗收。

## 版號

完工後 index.html 版號、README 版本紀錄、task.md 歷程摘要更新至 v1.7.0。
