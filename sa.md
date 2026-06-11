# 系統設計與架構分析說明書 (SA) - API 金鑰多組管理與 Live Demo 模式 (v1.6.0)

本文件詳述 StockGenie v1.6.0 的系統架構設計、後端 API 規格、子進程管理機制，以及前端仿真攔截設計。

---

## 1. 系統架構圖 (Architecture Overview)

```
                     +---------------------------------------+
                     |            瀏覽器前端 (Web UI)        |
                     |  - UI State Manager  - Mock Ticker    |
                     +-------------------+-------------------+
                                         |
                                         | HTTP / SSE
                                         v
                     +-------------------+-------------------+
                     |       後端伺服器 (dashboard.py)       |
                     |  - REST API       - Config Handler    |
                     |  - Web Proxy      - Process Manager   |
                     +---------+-------------------+---------+
                               |                   |
                     Reads/    | Writes            | Spawns /
                     Restarts  | .env              | Terminates
                               v                   v
                     +---------+---------+   +-----+---------+
                     |  credentials.json |   |  shioaji.exe  |
                     |  (金鑰多組設定檔)  |   |  (API 守護進程)|
                     +-------------------+   +---------------+
```

### 運作模式對比：

1. **真實連線模式 (Real Mode)**:
   - 前端發送請求給 `dashboard.py`。
   - 歷史與公告請求由 `dashboard.py` 本身處理。
   - 帳務與即時報價（`/proxy/api/v1/...`）轉發至 `shioaji.exe` 守護進程（Port 8080）。
   - `shioaji.exe` 透過 TLS 連接永豐 Solace 雲端伺服器。

2. **Demo 演示模式 (Demo Mode)**:
   - 前端偵測 `state.demoMode === true`。
   - 前端攔截所有會發往後端 `/proxy/` 的網路請求，直接在記憶體中生成高仿真數據返回。
   - 前端定時器隨機擾動自選股報價（進行 Random Walk 隨機漫步價格波動），並定時重新繪製 Canvas 圖表，模擬即時盤中。

---

## 2. 設定檔設計 (Configuration Design)

### 2.1 `credentials.json`
本機端的多組金鑰存放檔，放置在專案根目錄下，由 `.gitignore` 自動忽略。
```json
{
  "active_index": 0,
  "profiles": [
    {
      "name": "預設實盤帳戶",
      "api_key": "API_KEY_PLACEHOLDER_DO_NOT_USE_REAL_VALUE_1",
      "secret_key": "SECRET_KEY_PLACEHOLDER_DO_NOT_USE_REAL_VAL_1",
      "ca_cert_path": "C:/path/to/Sinopac.pfx",
      "ca_password": "CA_PASSWORD_VALUE"
    },
    {
      "name": "備用唯讀帳戶",
      "api_key": "API_KEY_PLACEHOLDER_DO_NOT_USE_REAL_VALUE_2",
      "secret_key": "SECRET_KEY_PLACEHOLDER_DO_NOT_USE_REAL_VAL_2",
      "ca_cert_path": "",
      "ca_password": ""
    }
  ]
}
```

### 2.2 `.env` (寫入覆寫)
當使用者切換使用中的帳戶時，後端會將啟用設定的值寫入本機 `.env`，以防 `dashboard.py` 重啟時設定跑掉，並確保系統其他腳本（如 `monitor.py`）維持一致的密鑰存取。

**寫入策略**：採「合併更新」而非整檔覆蓋——僅覆寫金鑰相關欄位（`API_KEY`、`SECRET_KEY`、`CA_CERT_PATH`、`CA_PASSWORD`），保留 `.env` 中其他既有設定。注意：執行中的 `monitor.py` 不會即時載入新 `.env`，須於下次啟動時方能生效。

---

## 3. 後端 API 規格 (Backend API Specification)

後端將由 `dashboard.py` 中的 `DashboardHandler` 類別解析新增的 API 路由。

### 3.1 獲取設定檔清單
- **Endpoint**: `GET /api/credentials`
- **Response**: `200 OK`
```json
{
  "active_index": 0,
  "profiles": [
    {
      "name": "預設實盤帳戶",
      "api_key": "ABCDEF...WXYZ",
      "secret_key": "●●●●●●●●●●●●",
      "ca_cert_path": "C:/path/to/Sinopac.pfx",
      "ca_password": "●●●●●●●●"
    }
  ]
}
```

### 3.2 儲存/新增設定檔
- **Endpoint**: `POST /api/credentials/save`
- **Request Body**:
```json
{
  "index": 0,  // 若 index 為 -1，則代表新增；其餘為修改指定索引的設定
  "name": "修改後的帳戶名稱",
  "api_key": "API_KEY_PLACEHOLDER_DO_NOT_USE_REAL_VALUE_1", // 若為遮蔽格式，則後端不更新此欄位
  "secret_key": "●●●●●●●●●●●●", // 若為遮蔽格式，則後端不更新此欄位
  "ca_cert_path": "C:/newpath.pfx",
  "ca_password": "●●●●●●●●", // 若為遮蔽格式，則後端不更新此欄位
  "verification_code": "PEA6" // 安全問答驗證碼
}
```
- **Response**: `200 OK` / `403 Forbidden` / `400 Bad Request`

### 3.3 切換使用設定檔
- **Endpoint**: `POST /api/credentials/switch`
- **Request Body**:
```json
{
  "index": 1,
  "verification_code": "PEA6"
}
```
- **Response**: `200 OK` (並同步於後端非同步重啟子進程)

### 3.4 刪除設定檔
- **Endpoint**: `POST /api/credentials/delete`
- **Request Body**:
```json
{
  "index": 1,
  "verification_code": "PEA6"
}
```
- **Response**: `200 OK` / `400 Bad Request`
- **限制**：不允許刪除最後一組設定檔，亦不允許刪除目前啟用中（`active_index`）之設定檔；違反時回傳 `400`。

---

## 4. 後端子進程重啟管理 (Subprocess Management)

### 4.1 全域進程引用與同步
為了解決原本 `api_proc` 作為 `main()` 區域變數無法從 `Handler` 線程操作的問題，作以下架構性重構：
1. 定義全域變數 `shioaji_proc = None`。
2. 定義線程鎖 `shioaji_proc_lock = threading.Lock()` 防止切換過頻或併發重啟導致死鎖或出現殭屍進程。

### 4.2 重啟生命週期 (Restart Lifecycle)
```python
def start_shioaji_server(env_dict):
    global shioaji_proc
    shioaji_bin = resolve_shioaji_bin()
    run_env = os.environ.copy()
    run_env["SJ_API_KEY"] = env_dict.get("API_KEY", "")
    run_env["SJ_SEC_KEY"] = env_dict.get("SECRET_KEY", "")
    
    ca_cert = env_dict.get("CA_CERT_PATH", "")
    if ca_cert:
        ca_path = Path(ca_cert)
        if not ca_path.is_absolute():
            ca_path = WORKSPACE_DIR / ca_path
        run_env["SJ_CA_PATH"] = str(ca_path.resolve())
    run_env["SJ_CA_PASSWD"] = env_dict.get("CA_PASSWORD", "")
    run_env["SJ_PRODUCTION"] = "true"
    
    with shioaji_proc_lock:
        if shioaji_proc:
            print("正在中止舊的 Shioaji API 伺服器...")
            shioaji_proc.terminate()
            try:
                shioaji_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                shioaji_proc.kill()
        
        print(f"正在啟動新的 Shioaji API 伺服器...")
        shioaji_proc = subprocess.Popen(
            [shioaji_bin, "server", "start", "--no-open"],
            env=run_env
        )
```

---

## 5. 前端仿真攔截與數據波動設計 (Frontend Interception & Mocking)

### 5.1 攔截與靜態注入
在前端 `app.js` 中實作一個攔截機制。如果 `state.demoMode === true`：
- 將原本發往實體後端的 API 呼叫導向本地假數據生成器：
  - `accounts` 返回包含隨機交易額度限制的假證券帳號。
  - `account_balance` 與 `trading_limits` 直接以靜態仿真物件返回。
  - `positions` 返回 4 檔精選股票（以 PRD §2.2 定義之初始值起算），其現價與損益在每次輪詢時以隨機漫步動態計算。
  - `profit_loss` 依據 12 個月前起之月份，動態合成損益值以填充 Canvas 長條圖。
  - 資產歷史趨勢（90 天）之終值動態校準為「假餘額 + 假庫存市值」總和，確保圖表與總覽數值一致。

### 5.2 Live 行情波動算法 (Random Walk)
為了讓 Demo 看起來像真實運作，我們將實作行情波動計時器：
- 當 Demo 模式啟用時，系統在每 15 秒（根據設定的同步頻率）對自選股代碼進行數據「擾動」：
  - **新價格計算**：`New_Price = Current_Price * (1 + random_pct)`，其中 `random_pct` 隨機介於 `[-0.003, +0.003]` 之間。
  - **點數與漲跌幅計算**：`Change = New_Price - Ref_Price`，`Change_Rate = Change / Ref_Price * 100`。
  - **成交量**：每次隨機累加 `[50, 500]` 張。
  - **委買委賣力道條**：模擬買賣方最佳一檔掛單量以呈現力道條的浮動。
  - **微型走勢圖 (Sparkline)**：每次更新將新價格 push 進 prices 陣列中，並重新渲染 Canvas，展現線條逐漸延伸與起伏的效果！

### 5.3 走勢圖與均線圖生成
- 當在 Demo 模式點擊某股票時，系統會動態合成：
  - **分時圖**：產生當天 9:00 至 13:30 每 5 分鐘的虛擬分時收盤價陣列，使折線圖填滿。
  - **日均線圖**：合成過去 250 天的假收盤價，並計算其 MA5, MA20, MA60, MA240 並呈現在圖表上，提供完美的均線展示。

### 5.4 下單閉環模擬 (Demo Order Simulation)

- Demo 模式下攔截所有下單請求，不發送實體 POST。送出後顯示「[DEMO 模式] 委託已送出」Toast，1~2 秒後隨機模擬成交提示。
- 買進：假庫存增加該部位（既有持股則重新計算均價）、假餘額扣減成交金額。
- 賣出：僅允許既有假庫存之股票，股數不得超過持有量（超出時顯示錯誤提示）；成交後減少部位、增加假餘額。

---

## 6. 防禦性編程與邊界校驗 (Defensive Programming)

1. **遮蔽字元解析**：後端處理 `api_key`、`secret_key`、`ca_password` 時，若傳入字串包含遮蔽符（如 `'...'`、`'●'`、`'*'`），代表前端使用者沒有變更該欄位，後端在寫入 JSON 前必須保留資料庫中的原值，防止空值或損毀的金鑰覆蓋資料。
2. **重啟狀態鎖定**：切換金鑰重啟時，前端將展示遮蔽對話框 `server-restart-overlay`。前端會每秒嘗試 fetch `/proxy/api/v1/auth/usage`。如 30 秒內重啟成功，則解鎖畫面；如重啟失敗或超時，遮罩內會跳出「重啟逾時，請手動檢查憑證路徑與終端機錯誤日誌」按鈕，並提供「強制解鎖返回」選項，確保介面強健性。
3. **Demo 關閉防線**：當在 Demo 模式下勾選關閉時，必須觸發安全問答 `credentials-lock-modal-overlay`，答對才關閉，答錯不變，防止誤操作直接曝露真實資產。

---

## 7. 虛擬碼設計 (Pseudo-code Design)

### 7.1 後端金鑰與憑證維護邏輯 (Python)

```python
# credentials_helper.py

def mask_key(val, show_chars=6):
    if not val: return ""
    # 若已有遮蔽字元則不重複處理
    if "..." in val or "●" in val or "*" in val: return val
    if len(val) <= 10: return "●" * len(val)
    return f"{val[:show_chars]}...{val[-4:]}"

def save_credentials_route(request_json):
    # 1. 驗證安全驗證碼
    if request_json.get("verification_code") != "PEA6":
        return HTTP_Error(403, "安全驗證失敗")
        
    index = request_json.get("index", -1)
    name = request_json.get("name", "").strip()
    api_key = request_json.get("api_key", "").strip()
    secret_key = request_json.get("secret_key", "").strip()
    ca_path = request_json.get("ca_cert_path", "").strip()
    ca_pass = request_json.get("ca_password", "").strip()
    
    if not name:
        return HTTP_Error(400, "名稱不可為空")
        
    db = load_credentials_from_json()
    profiles = db["profiles"]
    
    # 判斷是新增還是修改
    if 0 <= index < len(profiles):
        # 修改既有
        profile = profiles[index]
        profile["name"] = name
        profile["ca_cert_path"] = ca_path
        
        # 防禦性檢查：若輸入非遮蔽格式，才進行覆寫更新
        if api_key and not ("..." in api_key or "●" in api_key or "*" in api_key):
            profile["api_key"] = api_key
        if secret_key and not ("..." in secret_key or "●" in secret_key or "*" in secret_key):
            profile["secret_key"] = secret_key
        if ca_pass and not ("..." in ca_pass or "●" in ca_pass or "*" in ca_pass):
            profile["ca_password"] = ca_pass
    else:
        # 新增設定檔
        if not api_key or "..." in api_key: return HTTP_Error(400, "無效的 API Key")
        if not secret_key or "●" in secret_key: return HTTP_Error(400, "無效的 Secret Key")
        
        new_profile = {
            "name": name,
            "api_key": api_key,
            "secret_key": secret_key,
            "ca_cert_path": ca_path,
            "ca_password": ca_pass
        }
        profiles.append(new_profile)
        
    db["profiles"] = profiles
    save_credentials_to_json(db)
    
    # 若更新的是當前啟用中設定，觸發熱套用
    if index == db["active_index"]:
        apply_active_profile(db)
        
    return HTTP_Success()
```

### 7.2 前端 API 仿真攔截與價格隨機波動 (JavaScript)

```javascript
// app.js - Demo Mode Interceptor

// 自訂 fetch 封裝器，若 Demo 模式啟用則完全攔截向後端發送的請求
async function smartFetch(url, options = {}) {
    if (state.demoMode) {
        // 解析路徑
        if (url.includes('/proxy/api/v1/auth/accounts')) {
            return mockResponse([{ account_type: 'S', broker_id: '9A95', account_id: '8888888', name: '演示帳戶' }]);
        }
        if (url.includes('/proxy/api/v1/portfolio/account_balance')) {
            return mockResponse({ acc_balance: 1250300 });
        }
        if (url.includes('/proxy/api/v1/portfolio/trading_limits')) {
            return mockResponse({ trading_limit: 5000000, trading_used: 850000, trading_available: 4150000 });
        }
        if (url.includes('/proxy/api/v1/portfolio/position_unit')) {
            return mockResponse(getMockPositions());
        }
        if (url.includes('/proxy/api/v1/portfolio/settlements')) {
            return mockResponse([
                { T: 0, amount: 12500 },
                { T: 1, amount: -25000 },
                { T: 2, amount: 80000 }
            ]);
        }
        if (url.includes('/proxy/api/v1/portfolio/profit_loss')) {
            return mockResponse(getMockProfitLoss());
        }
        if (url.includes('/proxy/api/v1/data/snapshots')) {
            return mockResponse(getMockWatchlistSnapshots(options.body));
        }
        // ... 其餘端點比照處理
    }
    
    // 非 Demo 模式，走正常網路 fetch
    return fetch(url, options);
}

// 仿真隨機漫步價格波動 (Random Walk Price Tick)
function simulatePriceFluctuations() {
    if (!state.demoMode) return;
    
    // 遍歷當前暫存在 state 中的自選股
    state.watchlist.forEach(item => {
        if (!item.last_price) item.last_price = item.ref_price || 100.0;
        
        // 隨機生成波動比例 -0.3% ~ +0.3%
        const pct = (Math.random() * 0.006) - 0.003;
        const oldPrice = item.last_price;
        const newPrice = oldPrice * (1 + pct);
        
        // 四捨五入至合理小數點
        item.last_price = parseFloat(newPrice.toFixed(2));
        item.change = parseFloat((item.last_price - item.ref_price).toFixed(2));
        item.change_rate = parseFloat((item.change / item.ref_price * 100).toFixed(2));
        
        // 隨機累加成交量
        item.volume = (item.volume || 100) + Math.floor(Math.random() * 30) + 1;
        
        // 模擬買賣量波動
        item.bid_vol = Math.floor(Math.random() * 500) + 10;
        item.ask_vol = Math.floor(Math.random() * 500) + 10;
    });
    
    // 觸發前端重新渲染畫面與微型走勢圖
    renderWatchlist();
    if (state.activeView === 'dashboard') {
        renderSettlements();
    }
}
```

