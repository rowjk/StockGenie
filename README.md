# SinoPac Genie

本專案為專門為辦公室環境設計的**「低調、防窺、高質感」**永豐證券股票交易與資產監控儀表板。外觀精緻偽裝成系統效能監控工具，並擁有安全鎖與自訂確認彈窗雙重保障，防止任何下單交易誤會。為了方便您查閱專案的所有規格與說明書，本文件將所有相關檔案與文檔整理並索引如下：

---

## 📂 文件導覽與快速跳轉連結

* 📖 **[專案操作與使用手冊 (walkthrough.md)](./walkthrough.md)**：
  * **內容**：包含詳細的環境配置（`.env`）、啟動步驟、防窺配色切換、歷史數據手動補錄以及安全下單機制的詳細操作指引。
* 📐 **[設計規格書 (dashboard_design.md)](./dashboard_design.md)**：
  * **內容**：詳細記錄專案的防窺配色原則、佈局架構設計、CORS 反向代理同源通訊規避手段、多執行緒併發設計原則。
* 🔍 **[全面代碼評審報告 (code_review.md)](./code_review.md)**：
  * **內容**：由資深架構師對專案在多執行緒併發、子進程 lifecycle 生命週期管理（防止緩衝區死鎖）、前端 Robustness 數據防禦性編程等角度做出的深入 Code Review 報告與未來迭代優化建議。
* 📝 **[任務清單 (task.md)](./task.md)**：
  * **內容**：開發階段各項功能調試、中文化細修與漏洞修正的完整檢核進度表（全數通過）。

---

## 🗂️ 專案實體代碼結構

* 🚀 **[啟動儀表板.bat](./啟動儀表板.bat)**：雙擊即可一鍵啟動後端代理伺服器與 Shioaji API。
* 🐍 **[dashboard.py](./dashboard.py)**：Python 後端。提供靜態資源、`/proxy/` 反向代理與 `/api/asset-history` 歷史資產數據讀寫服務。
* 🖥️ **[web/index.html](./web/index.html)**：前端網頁結構，包含自訂確認 Modal。
* 🎨 **[web/style.css](./web/style.css)**：外觀樣式表（含 Slate / Stealth / Muted 配色變數）。
* ⚙️ **[web/app.js](./web/app.js)**：網頁交互邏輯與輪詢、Canvas 折線圖及自選 Sparkline 繪製邏輯。
* 📡 **[持倉監控.bat](./持倉監控.bat)** / **[monitor.py](./monitor.py)**：獨立的控制台彩色持倉輪詢監控工具。v1.3.0 起，登入後 session 等待改為主動輪詢就緒，取代固定 sleep(8)。

---

## ⚡ 快速啟動指引

1. **配置環境**：
   確保工作區根目錄下的 **[.env](./.env)** 檔案內配置了正確的永豐 API 密鑰、憑證路徑及密碼。
2. **雙擊啟動**：
   雙擊執行 **[啟動儀表板.bat](./啟動儀表板.bat)**。系統偵測到 Shioaji API 伺服器就緒後，會自動在您的預設瀏覽器中開啟 `http://127.0.0.1:8081`（通常在 10 秒內，最多等待 30 秒）。
3. **優雅停止**：
   在 CMD 控制台視窗中按下 `Ctrl + C`，系統將會優雅安全地中止背景運行的 `shioaji.exe` 伺服器並釋放 Port `8080` 與 `8081`。

---

## ⚠️ 系統開發與版本更動守則

為了落實專案的追蹤與管理，本專案特別制定以下規範：
* **版本號同步更新限制**：未來在進行任何系統功能升級、修補 bug 或修改程式碼時，**版本號必須同步跟著更新**（目前版本為 `v1.3.19`）。請在修改完成後，主動更新：
  1. [index.html](./web/index.html) 的頁尾 Footer 版本標籤。
  2. 本 [README.md](./README.md) 的版本表記與指引說明。

---

## 📋 版本更新紀錄

### v1.3.19 (2026-06-10)
**大盤指數監控支援**
- **動態 Security Type 適配**：支援大盤加權指數 `TSE001` (或代碼 `001`) 監控。新增自選股時自動 fallback 以 `IND` (指數) 商品類別向後端查詢。
- **自選清單交易限制**：當監控商品為指數 (`IND`) 時，自動隱藏「下單」按鈕，避免使用者誤觸點擊。
- **全方位圖表支援**：大盤加權指數的實時分時圖 (Tick Chart)、歷史日 K 線圖 (Kbar Chart) 與 MA 均線指標均能完整載入與流暢繪製。

### v1.3.18 (2026-06-10)
**介面排版優化**
- **響應式天區（Header）收縮**：當瀏覽器視窗縮小時，自動隱藏系統標題（SinoPac Genie）與連線狀態文字（僅留下運作燈號與倒數時鐘），如同側邊欄收縮般，釋放大量水平空間，解決窄螢幕跑版問題。
- **防止文字折行**：為標題、連線狀態及倒數計時增加 `white-space: nowrap`，徹底防範小寬度下產生的直列式文字折行。

### v1.3.17 (2026-06-09)
**安全性增強**
- **唯讀金鑰安全檢核與攔截**：按下下單按鈕時自動檢核是否有下單權限，若無權限，在前端顯示「下單權限關閉」。
- **雙重安全檢核機制**：
  - 前端：開單時檢查 `state.tradingPermitted`，若無權限則跳出提示並阻斷下單抽屜開啟。
  - 後端：在 API 代理層（`/proxy/api/v1/order/place_order`）攔截下單請求。若金鑰屬唯讀金鑰，主動拒絕交易並回傳 400 錯誤。
  - 支援在 `.env` 中使用 `TRADING_ENABLED=false` 顯式停用交易功能。

### v1.3.16 (2026-06-09)
**Bug 修正**
- `drawCanvasLoading` 函數宣告遺失 → 整個 `app.js` 語法錯誤，JS 完全無法執行（伺服器顯示離線）
- `renderDetailTickChart` 畫圖前未呼叫 `clearRect` → 「載入中...」文字與折線圖疊加殘留
- 自選股「昨日參考價」顯示 `--`：snapshot API 不回傳此欄位，改為在點選股票時從 `/data/contracts/{code}` 補抓並快取至 `item.reference`
- 自選監控清單排版歪斜：`watchlist-info` 缺少 `flex:1`，導致各列 sparkline 和價格欄位位置不齊

**效能優化**
- 新增 `fetchKbarsWithCache(code)`：`loadMAStats` 與 `renderDetailMAChart` 共用同一份 2 年 kbars 快取（1 小時有效），避免每次點選股票重複發送大量歷史資料請求
- `checkServerStatus` 輪詢間隔 10 秒 → 60 秒（每小時減少 300 次 `/auth/usage` 呼叫）
- 新增 `isTradingHours()`：盤後（09:00–13:35 以外）自動跳過 `trading_limits` API（盤後永遠回傳 500）
- 新增 `_fetchCount` 降頻計數器：`account_balance`、`position_unit`、`settlements`、`margin` 改為每 4 次 snapshot 週期執行一次（約 60 秒），snapshot 快照仍維持原頻率確保即時報價

**快取機制說明**
| 資料 | 快取策略 |
|------|----------|
| kbars（2 年日線） | session 內快取 1 小時，多處共用 |
| 昨日參考價 | 快取至 watchlist item，重新整理前不重複抓取 |
| Snapshot 快照 | 不快取，每次 fetchData 均更新 |

### v1.3.x 之前
詳見 `app.js` 檔頭版本歷史與 `task.md` 任務清單。
