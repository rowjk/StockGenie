# SinoPac Genie - 實行任務與優化清單 (v1.3.25)

- [x] 1. 停用伺服器端靜態檔案快取 ([dashboard.py](file:///d:/AntigravityProjects/SinoPac_API/dashboard.py))
  - [x] 於 `DashboardHandler.end_headers()` 中新增 `Cache-Control`、`Pragma`、`Expires` 標頭，徹底解決瀏覽器快取 HTML/CSS/JS 的問題。
- [x] 2. 前端樣式微調與對比度修正 ([style.css](file:///d:/AntigravityProjects/SinoPac_API/web/style.css))
  - [x] 擴充 stealth 隱形黑白模式按鈕的對比度規則，加入 `.detail-tab:hover` 及特定按鈕 ID (`#btn-quick-order`, `#btn-add-watchlist`, `#btn-confirm-submit`)，將文字顏色強制設為 `var(--bg-primary)`
- [x] 3. 前端結構與標籤優化 ([index.html](file:///d:/AntigravityProjects/SinoPac_API/web/index.html))
  - [x] 修改自選標題開關標籤，將「顯示走勢圖」正式修訂為「顯示趨勢圖」並加入說明 Tooltip。
  - [x] 移除 `#btn-confirm-submit` 的冗餘行內樣式，防止其干擾 CSS 主題覆寫。
  - [x] 於 `<head>` 區段新增防快取 `meta` 標籤。
  - [x] 將 CSS 與 JS 的快取參數升級至 `v=1.3.25`。
- [x] 4. 前端指令更新 ([app.js](file:///d:/AntigravityProjects/SinoPac_API/web/app.js))
  - [x] 於 app.js 檔頭歷史記錄中新增 `v1.3.25` 之更新說明。
- [x] 5. 變更紀錄與說明文件更新
  - [x] 更新 `walkthrough.md` 以及 `task.md` 說明內容。
- [x] 6. Git 提交與推送
  - [x] 執行 `git add .` 與 `git commit`
  - [x] 執行 `git push` 同步至遠端倉庫

