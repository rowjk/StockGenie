# StockGenie

基於永豐證券 Shioaji API 的本機股票交易與資產監控儀表板。為辦公室防窺情境設計：安全鎖、二次確認、多種偽裝配色。三層架構：瀏覽器前端（Port 8081 靜態頁）→ `dashboard.py`（Web Proxy + 本機 API）→ `shioaji.exe` 守護進程（Port 8080，TLS 連永豐雲端）。另由後端代理 TWSE OpenAPI（公告/除權息，快取 10 分）與 Yahoo Finance（美股，盤中快取 60 秒/日線 30 分）。SSE 成交回報由前端直連 8080（不經 proxy）。

## 檔案結構

* `dashboard.py`：後端。靜態服務、`/proxy/` 反向代理（profit_loss 自動補 365 天、帳務端點 30s 等待）、`/api/asset-history`（匯入嚴格校驗 + .bak 備份）、`/api/twse-*`、`/api/us-chart`、`/api/credentials`（v1.6 多組金鑰管理）、Shioaji 子進程生命週期管理。
* `web/index.html` / `web/style.css` / `web/app.js`：前端（原生 JS + Canvas，無第三方依賴）。`smartFetch` 統一網路收口（v1.6）。
* `啟動儀表板.bat`：一鍵啟動。`持倉監控.bat` / `monitor.py`：獨立控制台持倉監控（讀 `.env`）。`sdk_probe.py`：SDK 層帳務診斷（區分本機 vs 永豐後台問題）。
* `credentials.json`（gitignore）：多組 API 金鑰設定檔。`asset_history.json`：每日資產歷史。

## 快速啟動

1. `.env` 或設定頁配置永豐 API 金鑰與 CA 憑證。
2. 雙擊 `啟動儀表板.bat`，就緒後自動開 `http://127.0.0.1:8081`（最多等 30 秒）。
3. 控制台 `Ctrl+C` 優雅停止（自動回收 shioaji.exe 與 Port）。

## 開發守則

* 任何程式修改**必須同步更新版本號**（目前 `v1.6.2`）：`index.html` footer + 本 README 版本紀錄。
* 文件詳情：操作手冊 `walkthrough.md`、設計規格 `dashboard_design.md`、任務清單 `task.md`、設計評審 `design_review.md` 與實作計畫 `implementation_plan.md`。

## 版本紀錄

* **v1.6.2**（2026-06-11）：優化數值顯示（前端所有數值包含自選股、歷史走勢、庫存部位等均加入千分位分隔號，提升閱讀清晰度與舒適度）。
* **v1.6.1**（2026-06-11）：修復與收尾（修復殘留 `shioaji.exe` 佔用 Port 8080 造成切換金鑰失效 Bug；修復切換至真實模式時，自選股清單自動清除 Demo 模式所遺留下之「演示股」快取名稱，並新增 STK/IND 雙重類型 fallback 重新向後端查詢真實名稱；擴充 Demo 模式字典避免 placeholder）。
* **v1.6.0**（2026-06-11）：API 金鑰多組管理（`credentials.json`、遮蔽傳輸、二次安全驗證、切換自動重啟 shioaji + 30s 輪詢遮罩、刪除保護、`.env` 合併寫入、設定 API 不依賴 Shioaji 防鎖死）＋ Demo 演示模式（`smartFetch` 前端攔截、零實體請求可離線、隨機漫步行情、資產趨勢終值校準＝假餘額+假市值、下單閉環模擬賣出限庫存、DEMO 徽章、關閉需安全驗證）。
* **v1.5.2**：修正 TWSE SSL lock NameError；歷史清理改 >3000 筆才保留最新 3000 筆。
* **v1.5.1**：美股分頁時暫停台股快照輪詢，切回立即補抓。
* **v1.5.0**：美股自選分頁（`/api/us-chart` Yahoo 代理、格式驗證、固定查詢組合、雙層快取、localStorage `usWatchlist`、上限 20 檔）；漲跌徽章統一「點數 (百分比)」格式。
* **v1.4.5-6**：進入系統設定需問答驗證（答對預設驗證碼，6 選項洗牌）。
* **v1.4.4**：Page Visibility 背景暫停輪詢；TWSE gzip。
* **v1.4.0-4.3**：期貨退場；總市值/總資產卡片；T+2 違約警示；Boss Key（Esc 全遮蔽）；Terminal Log Mode（雙擊 Space 偽裝日誌）；卡片自訂顯示；委買賣力道條；月度已實現損益圖；TWSE 公告/除權息看板；歷史匯出匯入嚴格校驗；自選 20 檔分批快照；Matrix 配色（強制暗色）；帳務 API 並行；TWSE 憑證鏈寬鬆 SSL 降級。
* **v1.3.x**：基礎功能、大盤指數監控（TSE001/IND）、自選排序、唯讀金鑰下單攔截（前後端雙重）、kbars 快取 1hr、盤後跳過 trading_limits、帳務 60 秒降頻。
