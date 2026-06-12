# StockGenie - 任務清單

## 待辦（後續優化）

* **Demo 模式無法操作 v1.7.x／v1.8.0 新功能**（2026-06-11 使用者實測回報）：
  未成交委託的改價/減量/刪單、停利停損試算等今日新增功能，在 Demo 模式下無法操作。
  攔截器與假資料閉環已寫好且 Node 斷言通過（demoPlaceOrder→pendingOrders、demoCancelOrder/demoUpdateOrder、
  contracts 假參考價），但實際 UI 操作不通——待重現排查。可能方向：
  (a) Demo 下單後 1~2 秒即模擬成交，pendingOrders 存活時間太短，幾乎來不及點操作鈕（可考慮 Demo 成交延遲拉長或改手動觸發）；
  (b) renderTpsl/renderPendingOrders 在 Demo 的資料鏈路（state.stockPositions 由 demoPositions 供應）某環節未刷新；
  (c) tradingPermitted 或其他 guard 在 Demo 初始化順序下未就緒。
  排查時先開 Demo 開 DevTools Console 看 [DEMO] 警告與錯誤。

* ~~已修（v1.8.1）~~ **被拒單無聲消失**（2026-06-12 實測發現）：盤前市價單被券商拒絕（status=Cancelled, status_code=X），
  但委託紀錄只顯示「下單」成功、無任何拒單提示，使用者無從得知委託已死。優化方向：
  (a) SSE order_event 收到 Cancelled/Failed 時 toast 顯示拒單與原因；
  (b) fetchPendingOrders 偵測「紀錄裡有、清單裡無、狀態為 Cancelled/Failed 且非自己刪的單」主動警示；
  (c) 注意：daemon 回傳的 msg 編碼已損壞（全問號），顯示時只能依 status_code 對照表轉中文。

## 盤中待驗證（2026-06-12 開盤）

* ~~已驗（2026-06-12 盤前）~~ 減量實測：App「已改量」、daemon order_qty 2→1 / cancel_qty 1。**定案：請求 quantity=減少數；回報 order_quantity=淨額有效量**（與 Python 文件範例不同），v1.8.5 已依實測修正計算。
* 預約單開盤自動轉「已送出」；成交後未成交清單自動移除。
* 部分成交時「已成交」欄與狀態顯示（可遇不可求）。
* 零股預估金額（×1）；停利停損頁現價盤中更新（~60s）。

# 歷程（全數完成）

各版本開發任務皆已完成驗收，詳細變更見 README 版本紀錄。本檔僅保留歷程摘要：

* **v1.7.0**：未成交委託區塊（OpenAPI 確認端點行為、SSE 觸發重拉、Demo 閉環、前端斷言 16 項）、委託紀錄 30 筆（後端隔離測試 10 項）、下單預估金額試算。
* **v1.6.0**：多組金鑰管理後端（22 項端點測試通過）、設定頁 UI 與重啟遮罩、Demo 模式（36 項邏輯測試通過）、文件版號收尾。
* **v1.5.x**：美股自選分頁、跨分頁輪詢降頻、Code Review 修正（SSL lock、歷史清理）。
* **v1.4.x**：14 項防窺與功能變更（期貨退場、Boss Key、Terminal Mode、TWSE 看板、損益圖、匯入校驗 15 項單元測試、Matrix 配色、並行加速、設定問答鎖）。
* **v1.3.x**：基礎儀表板、安全下單、指數監控、效能降頻。

注意事項（保留供未來開發參考）：

* Shioaji HTTP snapshot 僅提供最佳一檔委買/委賣量（非五檔加總）。
* 整張 quantity 單位為張（×lotMultiplier），零股為股；unit=Share 模式 quantity 已是總股數。
* 盤後 trading_limits 永遠回 500，前端以 isTradingHours() 跳過。
