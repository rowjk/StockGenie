# SinoPac Genie - 交易儀表板全面繁體中文任務清單

- [x] 系統程式碼繁體中文細調與安全性漏洞修正
  - [x] 修改 [dashboard.py](./dashboard.py) 控制台 Log 輸出與狀態提示為繁體中文，並優化 `CA_CERT_PATH` 安全解析路徑以相容相對與絕對路徑
  - [x] 修改 [啟動儀表板.bat](./啟動儀表板.bat) 啟動提示與錯誤指示為繁體中文
  - [x] 修改 [web/index.html](./web/index.html) 移除下單抽屜與 API 狀態中殘留的英文標記
  - [x] 修改 [web/app.js](./web/app.js) 調整彈出確認視窗（confirmMsg）與 Toast 通知為純中文，並在 `/order/place_order` payload 中補上 `person_id` 以確保正式環境下單成功
  - [x] 修改 [monitor.py](./monitor.py) 持倉監控腳本，中文化所有主控台輸出，並優化憑證路徑安全解析
- [x] 系統文檔 (Artifacts) 翻譯與內容校對
  - [x] 將 `dashboard_design.md` 翻譯為繁體中文並更新內容與代碼欄位一致
  - [x] 將 `walkthrough.md` 說明文檔翻譯為繁體中文並補充最新修改
- [x] 系統功能驗證
  - [x] 執行 [啟動儀表板.bat](./啟動儀表板.bat) 驗證主控台全繁體中文輸出與語法編譯
  - [x] 測試下單流程之自訂 HTML Modal 彈出式繁體中文安全確認視窗，確認點擊「確認送出」時發送的 payload 中完整包含 `person_id` 欄位
  - [x] 驗證 [monitor.py](./monitor.py) 語法編譯與相對/絕對路徑的憑證啟動邏輯
  - [x] 清理工作目錄，安全刪除所有不需要的臨時、調試及安全性敏感備份檔案（如 `env.txt`, `debug_raw.py` 等）
  - [x] 配置 [.gitignore](./.gitignore) 安全排除敏感憑證與 API Key，並成功推送至 GitHub 遠端版控倉庫
