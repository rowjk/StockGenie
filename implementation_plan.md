# Multi-Profile API Management & Live Demo Mode (v1.6.0)

Implement a feature allowing users to manage, save, switch, and delete multiple sets of SinoPac API credentials (API Key, Secret Key, CA Path, CA Password) in the settings view with security verification.

Additionally, implement a comprehensive **Demo Mode** that intercepts all API requests in the frontend and provides highly realistic, simulated live-updating mock data (including fluctuating stock ticks, asset history charts, settlements, realized PnL charts, and detail charts) to allow safe software demonstrations without revealing real assets.

## User Review Required

> [!WARNING]
> **Subprocess Restart & Network Offline Time**
> Switching profiles or saving changes to the active profile requires restarting the local `shioaji.exe` daemon server. During this restart (approx. 5-10 seconds), API queries to SinoPac will temporarily fail. We will implement a blocking loading overlay in the frontend to guide the user and block operations until the new connection is established.

> [!IMPORTANT]
> **Credential Storage Security**
> Credentials will be stored in a local JSON file `credentials.json` in the root workspace directory. This file is added to `.gitignore` automatically via the generic `*.json` gitignore rule, preventing keys from being committed to Git. The backend will mask all API keys, Secret keys, and CA passwords when returning them to the frontend to prevent screen leaks.

> [!TIP]
> **Demo Mode Privacy & Offline Capability**
> Demo Mode runs entirely on the frontend by intercepting `fetch` calls in `app.js`. When active, it displays simulated live-updating asset metrics and ticker prices. This means:
> 1. No real credentials are sent or verified.
> 2. Real account values are completely hidden.
> 3. The dashboard can be demonstrated fully offline or when the server is disconnected.
> 
> To prevent accidental exposure of real assets, Demo Mode toggle is placed inside the protected "System Settings" panel (which requires answering the security question to enter).

## Open Questions

None. The proposed design integrates seamlessly with the existing stealth/matrix design patterns and security locks.

## Proposed Changes

---

### Backend (Python Server)

#### [MODIFY] [dashboard.py](file:///C:/Users/USER/Claude/Projects/SinPac/dashboard.py)
- Introduce global variable `shioaji_proc` and a lock `shioaji_proc_lock` to manage the Shioaji API server subprocess dynamically.
- Implement `start_shioaji_server(env_dict)` to cleanly terminate any existing Shioaji daemon subprocess, print warnings, and launch the daemon subprocess with the new environment configuration.
- Implement `load_credentials()`, `save_credentials(data)` and `save_env(env_vars)` functions:
  - `credentials.json` will store the array of profiles and the `active_index`.
  - If `credentials.json` does not exist, initialize it automatically using values from the existing `.env` file for backwards compatibility.
  - `save_env` performs a merge-update on `.env`: only credential variables (API_KEY, SECRET_KEY, CA_CERT_PATH, CA_PASSWORD) are overwritten; all other existing entries are preserved.
- Implement new HTTP API endpoints inside `DashboardHandler`:
  - `GET /api/credentials`: Retrieve list of profiles (with masked API Keys, Secret Keys, and CA Passwords) and the `active_index`.
  - `POST /api/credentials/save`: Add or update a profile. Requires `verification_code` ("PEA6"). Handles updating only fields that are unmasked.
  - `POST /api/credentials/switch`: Switch the active profile index. Requires `verification_code` ("PEA6"). Reloads the configuration, saves to `.env` and calls `start_shioaji_server()`.
  - `POST /api/credentials/delete`: Delete a profile. Requires `verification_code` ("PEA6"). Rejects deleting the active profile or the last remaining profile (returns 400).
- Update `main()` to initialize credentials and start the initial Shioaji daemon with the active profile configuration.

---

### Frontend (Web UI)

#### [MODIFY] [index.html](file:///C:/Users/USER/Claude/Projects/SinPac/web/index.html)
- Add a new settings section/card in `view-settings` containing:
  - A table of configured profiles (displaying Active Indicator, Name, Masked API Key, and actions: Switch, Edit, Delete).
  - A form to Add/Edit credentials (fields: Name, API Key, Secret Key, CA Certificate Path, CA Password).
- Add a "DEMO 模式" (Demo Mode) toggle switch in the "系統與配色設定" card.
- Add a clean neon-blue `DEMO` badge in the header next to the connection status (`#demo-badge`) to indicate when Demo Mode is active.
- Add a dedicated security verification modal `#credentials-lock-modal-overlay` with a select dropdown to answer the security question (matching the style of the settings lock modal).
- Add a loading overlay `#server-restart-overlay` to block user interactions with a spinner during Shioaji server restarts.
- Upgrade the version label in the footer to `v1.6.0`.

#### [MODIFY] [app.js](file:///C:/Users/USER/Claude/Projects/SinPac/web/app.js)
- Add `demoMode` state (defaulting to `false`, saved in `localStorage`).
- Implement comprehensive mock data templates for:
  - Accounts: simulated Stock and Re-consigned accounts.
  - Balance: $1,250,300 TWD.
  - Limits: Total: $5,000,000 / Used: $850,000 / Available: $4,150,000 (per PRD).
  - Positions: 4 simulated stocks (e.g., 2330 TSMC, 2317 Foxconn, 2454 MediaTek, 2603 Evergreen) with changing un-realized gains/losses (initial values per PRD, then random-walk fluctuation).
  - Settlements: T+0, T+1, T+2 amounts.
  - Monthly realized PnL: 12 months of bar-chart data.
  - Asset history: a nice 90-day growth curve.
  - Watchlist & US Watchlist snapshot: live fluctuating ticks (fluctuating ±0.1% to ±0.3% every refresh tick).
  - Intraday K-bars and Ticks: mock data to render stock detail charts when a watchlist item is clicked.
  - TWSE Major Announcements & Dividend Calendars.
- Modify all API fetching methods (like `fetchData()`, `loadSession()`, `updateWatchlistSnapshots()`, `loadProfitLoss()`, `loadTwseFeeds()`, etc.) to return mock data immediately when `state.demoMode` is `true`.
- Implement `initCredentialsMgmt()` to bind profile editing/saving/deleting/switching UI and trigger safety checks.
- Add state-handling for server restart:
  - Display a blocking modal when switching/editing active keys.
  - Repeatedly poll `/auth/usage` (every 1 second) until the server is back online, then hide the restart overlay and reload accounts/session data. Times out after 30 seconds with an error message and a force-unlock option.
- Adjust the footer version metadata to `v1.6.0`.

#### [MODIFY] [README.md](file:///C:/Users/USER/Claude/Projects/SinPac/README.md)
- Update the version logs to document `v1.6.0` and its new capabilities.

## Verification Plan

### Automated Tests
- Verify compilation/syntax of `dashboard.py` by launching:
  ```powershell
  python -m py_compile dashboard.py
  ```

### Manual Verification
1. Open the settings panel (answering the security question `PEA6`).
2. Add a new mock API profile. Attempt to save without entering the correct verification option (should fail with verification error).
3. Select the correct option and save the new profile (should show in the list).
4. Edit the new profile and save (should update the name/details).
5. Switch to the new profile:
   - Verification modal should pop up.
   - Upon answering correctly, the restart overlay should block the screen showing "交易伺服器重啟中...".
   - The terminal should output the server termination and launch logs.
   - The UI should resume once Shioaji is back online.
6. Delete the mock profile (should prompt verification and delete it). Attempting to delete the active profile or the last remaining profile must be rejected with an error — switch to another profile first.
7. Enable **Demo Mode** via the checkbox in settings:
   - The `DEMO` badge should appear in the header.
   - All charts and numbers should immediately update with beautiful, safe mock values (e.g. cash balance of $1,250,300 TWD).
   - Ticker prices in the watchlist should begin fluctuating slightly every 15 seconds to simulate live market data.
   - Clicking on a stock should open the details drawer and render simulated K-line and Tick-line charts.
8. Disable **Demo Mode**:
   - The dashboard should revert back to displaying the real SinoPac connection details.

## Refinements from Design Review

The following enhancements have been integrated into the plan to ensure robust security and a premium user experience:
1. **Settings Panel Fail-Safe**: Ensure the local `/api/credentials` endpoints do not depend on the Shioaji API server. Even if Shioaji fails to start due to invalid credentials, the settings UI must remain responsive so the user can correct their settings.
2. **Demo Mode Order & Execution Simulation**: When Demo Mode is active, clicking "Place Order" will not submit a real request to the backend. Instead, it will simulate a successful order submission, show realistic notifications, dynamically update the mock cash balance, and add the purchased shares to the mock portfolio holdings list. Sell orders are limited to existing mock holdings and cannot exceed the held quantity.
3. **Data Consistency Calibration**: Ensure that the terminal value of the simulated 90-day asset graph dynamically aligns with the sum of the mock cash balance and the mock portfolio market value for a 100% consistent look.
4. **Deletion Guard & Parameter Adjustments**: Deleting the active profile or the last remaining profile is rejected (switch to another profile first). Restart polling timeout relaxed from 15s to 30s. `.env` writes are merge-updates that preserve non-credential entries.


## Development Phases (開發階段評估)

基於現況分析：`dashboard.py` 765 行（`api_proc` 目前為 `main()` 區域變數，第 717 行）；`app.js` 3,057 行、27 個分散的 `fetch()` 呼叫點、無統一封裝；`index.html` 800 行。

### Phase 1 — 後端 (dashboard.py)
1. 重構 `main()`：`api_proc` 改為全域 `shioaji_proc` + `threading.Lock`，抽出 `start_shioaji_server(env_dict)`（含 Port 8080 釋放等待）。
2. `credentials.json` 讀寫、遮蔽、`.env` 合併寫入（採 temp file + `os.replace` 原子寫入）、自 `.env` 初始化。
3. 四個 `/api/credentials` 端點（完全不依賴 Shioaji 進程）。

**驗證**：`py_compile` + `curl` 端點測試（403 驗證碼錯誤、400 刪除保護、遮蔽欄位跳過、新增/修改/切換）。本階段可獨立於前端完整驗證。

### Phase 2 — 前端設定 UI (index.html + app.js)
Profiles 表格、編輯表單、PEA6 驗證 modal、重啟遮罩 + 30 秒輪詢。
**驗證**：Manual Verification 步驟 1–6。

### Phase 3 — Demo 模式 (app.js，工作量最大)
**關鍵決策**：先做 `smartFetch` 機械式替換（27 個呼叫點統一收口），再集中攔截——而非在各函式內分支判斷 `demoMode`，後者遺漏風險高。替換後真實模式行為必須零變化（回歸基準）。
其後實作：mock 生成器、Random Walk 計時器、分時/K 線合成、下單閉環、資產趨勢終值校準。
**驗證**：Manual Verification 步驟 7–8；另以 DevTools Network 確認 Demo 模式下零實體 API 請求（僅靜態資源）；關閉 `shioaji.exe` 離線測試。

### Phase 4 — 收尾
README v1.6.0 版本紀錄、footer 版號、真實模式回歸測試。

### 風險與限制
1. **smartFetch 替換遺漏**：任一漏網 fetch 會使 Demo 模式洩漏實體請求。以 Network 面板零請求為驗收標準，並於攔截器加 `console.warn` 捕捉未知路徑。
2. **Windows 子進程行為**：`terminate()` 對 `shioaji.exe` 的結束乾淨度與 Port 釋放時間，無法在非 Windows 環境驗證，需實機測試（Manual Verification 步驟 5）。
3. **回歸風險**：Phase 3 的 fetch 收口觸及大量既有程式碼，完成後須以真實帳戶完整跑一輪主要畫面。
