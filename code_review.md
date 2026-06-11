# StockGenie - 代碼評審紀錄（精簡版，至 v1.5.2 全數已處理）

歷次第三方視角評審的結論與已落實事項。供未來開發避坑參考：

## 架構要點（評審認可，勿隨意更動）
* `ThreadingHTTPServer`：高頻輪詢下單執行緒伺服器會卡死，必用多執行緒版。
* `subprocess.Popen` 啟動 shioaji **不可**設 `stdout/stderr=PIPE`：Windows 64KB 緩衝區塞滿會死鎖。退出採 terminate → wait(5) → kill。
* SSE 直連 8080 不經 proxy：防長連線佔死後端執行緒。
* 自訂 `send_json_error` 強制 UTF-8：原生 send_error 遇中文 Windows 錯誤訊息（如 WinError 10053）會 latin-1 編碼崩潰。
* Shioaji 就緒採輪詢 `/auth/usage`（30 秒上限），不可用固定 sleep。
* `asset_history.json` 寫入前自動 `.bak` 備份。

## 安全設計（已驗證）
* 匯入校驗：限陣列 `[{date,value}]`、拒未知欄位、`isinstance bool` 排除、`math.isfinite` 阻 NaN/Inf、value≥0、上限 5000 筆/1MB。
* 美股代理防 SSRF：固定 `YAHOO_CHART_BASE` 前綴 + quote 編碼 + 代碼格式驗證 + 查詢組合白名單。
* TWSE 憑證鏈缺 SKI：捕獲 SSLError 後降級寬鬆 SSL 並以 `_twse_needs_relaxed_ssl_lock`（threading.Lock）記住狀態；僅公開資料，降級可接受。
* 唯讀金鑰：前端 `state.tradingPermitted` + 後端 place_order 代理層雙重攔截。

## 歷史問題（皆已修復，防止回歸）
* v1.5.2 前：`_twse_needs_relaxed_ssl_lock` 未定義（NameError 隱患）→ 已於檔頭定義。
* v1.5.2 前：歷史清理 >1000 筆即砍 365 天前資料，會吞掉手動匯入的長歷史 → 改 >3000 筆才清理且保留最新 3000 筆；同時修復 `pruned_dict` NameError。
* 零股市值曾被 ×1000 放大 → `lotMultiplier()` 依 order_lot 區分張/股。
* 下單 payload 曾缺 `person_id`（500 錯誤）、exchange 曾寫死 TSE → 已動態帶入。

（v1.6.0 的子進程重啟線程安全、防鎖死設計、Demo 防洩漏等審查見 `design_review.md`。）
