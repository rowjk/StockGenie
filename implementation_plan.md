# Implementation Plan - v1.6.0【已完工，含驗證紀錄】

## 變更摘要
* `dashboard.py`（765→1056 行）：全域 shioaji_proc + lock、start_shioaji_server、credentials 讀寫/遮蔽/.env 合併、四個 /api/credentials 端點、main() 重構（web server 先起，shioaji 失敗不致命）。
* `web/index.html`：憑證管理卡（表格+表單）、`#credentials-lock-modal-overlay`、`#server-restart-overlay`、DEMO 徽章、Demo 開關、版號 v1.6.0。
* `web/app.js`（3057→3700+ 行）：initCredentialsMgmt、重啟輪詢（30s 逾時）、smartFetch 收口（18 個 proxy + 9 個本機端點；credentials 與重啟輪詢保留真實 fetch）、Demo 攔截器與假數據引擎、initDemoMode。
* `web/style.css`：重啟遮罩/spinner、.demo-badge、.btn-table-action。
* Demo 額度數據以 PRD 為準（5M/850k/4.15M）。

## 驗證紀錄（皆通過）
* 後端：py_compile + 隔離環境 22 項端點測試（遮蔽格式、403/400 邊界、遮蔽欄位跳過、.env 合併保留無關設定、刪除保護、active_index 調整）。
* 前端：node --check、元素 id 交叉比對、Demo 模組 Node 斷言 36 項（PRD 初始值、終值校準精確相等、波動範圍、下單閉環、賣出/餘額邊界、非 Demo 直通真實 fetch）。
* 實機：使用者驗證 Phase 1-3 全部通過（含切換假金鑰逾時防鎖死流程）。
* 驗收標準：Demo 模式 DevTools Network 零實體請求（除靜態資源）。

## 殘留注意
* 重啟輪詢開始前延遲 3 秒，防止把垂死舊進程誤判為就緒。
* `.git/HEAD.lock`、`.git/objects/maintenance.lock` 若擋 git 操作，於 Windows 手動刪除。
