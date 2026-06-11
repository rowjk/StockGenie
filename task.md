# StockGenie - 任務清單（全數完成）

各版本開發任務皆已完成驗收，詳細變更見 README 版本紀錄。本檔僅保留歷程摘要：

* **v1.6.0**：多組金鑰管理後端（22 項端點測試通過）、設定頁 UI 與重啟遮罩、Demo 模式（36 項邏輯測試通過）、文件版號收尾。
* **v1.5.x**：美股自選分頁、跨分頁輪詢降頻、Code Review 修正（SSL lock、歷史清理）。
* **v1.4.x**：14 項防窺與功能變更（期貨退場、Boss Key、Terminal Mode、TWSE 看板、損益圖、匯入校驗 15 項單元測試、Matrix 配色、並行加速、設定問答鎖）。
* **v1.3.x**：基礎儀表板、安全下單、指數監控、效能降頻。

注意事項（保留供未來開發參考）：

* Shioaji HTTP snapshot 僅提供最佳一檔委買/委賣量（非五檔加總）。
* 整張 quantity 單位為張（×lotMultiplier），零股為股；unit=Share 模式 quantity 已是總股數。
* 盤後 trading_limits 永遠回 500，前端以 isTradingHours() 跳過。
