# StockGenie - 實行任務與優化清單 (v1.5.2)

## v1.5.2 — Code Review 問題修正
- [x] 修正 `dashboard.py` 中 `_twse_needs_relaxed_ssl_lock` 鎖變數未定義 NameError 隱患，於檔頭正確聲明並調用 ([dashboard.py](dashboard.py))
- [x] 修正資產歷史資料自動清理邏輯與手動導入衝突：放寬限制至大於 3000 筆才啟動清理，清理方式改為保留最新 3000 筆以避免過期清理直接截斷數據，同時修正 `pruned_dict` 未定義 NameError 閃退 Bug ([dashboard.py](dashboard.py))
- [x] 配合專案規範，升級版本號至 v1.5.2 ([index.html](web/index.html), [app.js](web/app.js), [README.md](README.md), [task.md](task.md))

## v1.5.1 — 跨分頁行情輪詢降頻
- [x] 停在美股分頁時暫停台股自選快照輪詢（`fetchData` 依 `state.activeView` 判斷），帳務 API 與 T+2 警示照常 ([app.js](web/app.js))
- [x] 離開美股分頁時立即補抓一次台股自選快照，避免舊報價殘留 ([app.js](web/app.js))
- [x] 配合專案規範，升級版本號至 v1.5.1 ([index.html](web/index.html), [app.js](web/app.js), [README.md](README.md), [task.md](task.md))

## v1.5.0 — 美股自選監控分頁
- [x] 後端新增 `/api/us-chart` Yahoo Finance 代理路由：代碼格式驗證（1-12 字元，限大寫字母/數字/`.^-=`）、固定查詢組合（盤中 1d/5m 快取 60 秒、日線 2y/1d 快取 30 分鐘）、gzip 傳輸、查無代碼回 404、上游失敗回退快取 ([dashboard.py](dashboard.py))
- [x] 側邊欄新增「美股指數」分頁（地球圖示）與美股自選 view section：搜尋框、清單容器、明細卡（開高低收/量/MA 數值格、分時與均線雙 tab 圖表、移除按鈕） ([index.html](web/index.html))
- [x] 美股自選管理：任意代碼新增（名稱自動帶入）、垃圾桶移除、▲▼ 排序、localStorage（`usWatchlist`）持久化、預設 `^GSPC`+`VOO`、上限 20 檔 ([app.js](web/app.js))
- [x] 美股明細圖表：分時走勢（當日 5 分 K）與均線走勢（2 年日線、MA5/20/60/240），繪圖風格與台股一致，支援 Boss Key 遮蔽與全配色 ([app.js](web/app.js))
- [x] 輪詢節流：美股行情每 60 秒更新，僅於美股分頁開啟且網頁前景時運作（Page Visibility 整合） ([app.js](web/app.js))
- [x] 指數/個股樣式區分：依 Yahoo `instrumentType`（INDEX 套淡灰底），行情未載入時以 `^` 前綴回退判斷 ([app.js](web/app.js))
- [x] 漲跌徽章格式統一：台股與美股個股/ETF 升級為「漲跌點數 (漲跌百分比)」雙顯示，價格區塊 80px → 140px 防折行 ([app.js](web/app.js), [style.css](web/style.css))
- [x] 修正台股分時/均線 tab 全域綁定問題：限定 `#view-watchlist` 範圍，避免與美股分頁同名元件互相干擾 ([app.js](web/app.js))
- [x] 驗證：任意代碼（AAPL/QQQ）200、小寫自動轉大寫、查無代碼 404、非法格式 400、快取命中、JS/Python 語法檢查
- [x] 配合專案規範，升級版本號至 v1.5.0 ([index.html](web/index.html), [app.js](web/app.js), [README.md](README.md), [task.md](task.md))

## v1.4.6 — 移除安全驗證問題提示標籤
- [x] 於 `index.html` 移除 `問題：機車+生命靈數` 文字標籤，以提升防護機制隱蔽性 ([index.html](web/index.html))
- [x] 配合專案規範，升級版本號至 v1.4.6 ([index.html](web/index.html), [app.js](web/app.js), [README.md](README.md), [task.md](task.md))

## v1.4.5 — 系統設定問答防護驗證
- [x] 於 `index.html` 新增安全驗證對話框 HTML 結構 ([index.html](web/index.html))
- [x] 重構 `initNavigation` 抽離 `switchView` 導覽切換函式，攔截設定導覽並呼叫驗證對話框 ([app.js](web/app.js))
- [x] 實作隨機錯誤答案生成與洗牌邏輯，驗證成功才切換，驗證失敗顯示錯誤，取消則維持原畫面 ([app.js](web/app.js))
- [x] 配合專案規範，升級版本號至 v1.4.5 ([index.html](web/index.html), [app.js](web/app.js), [README.md](README.md), [task.md](task.md))

## v1.4.4 — Page Visibility 流量與效能優化、TWSE 下載壓縮
- [x] 引入 Page Visibility API，在網頁處於背景/最小化（`hidden`）時自動暫停 API 輪詢，回到前景（`visible`）時重啟，節省大量頻寬流量與 CPU 負荷 ([app.js](web/app.js))
- [x] 後端 fetch_twse_json 加入 `Accept-Encoding: gzip` 請求頭與 gzip 解壓縮，使 TWSE 公告與除權息 OpenAPI 的下載流量減少 80% 以上 ([dashboard.py](dashboard.py))
- [x] 配合專案規範，升級版本號至 v1.4.4 ([index.html](web/index.html), [app.js](web/app.js), [README.md](README.md), [task.md](task.md))

## v1.4.3 — 歷史資產備份與 TWSE 併發警告修正
- [x] 修正手動導入歷史資產與每日自動 Pruning 90 天清理之設計衝突，限制總筆數大於 1000 筆才啟動清理且清理範圍放寬至 365 天 ([dashboard.py](dashboard.py))
- [x] 修正 TWSE 憑證鏈 SSLError 降級警告之執行緒安全問題，使用 `_twse_cache_lock` 鎖定避免多重列印 ([dashboard.py](dashboard.py))
- [x] 配合專案規範，升級版本號至 v1.4.3 ([index.html](web/index.html), [app.js](web/app.js), [README.md](README.md), [task.md](task.md))

## v1.4.2 — Matrix 風格與損益圖優化
- [x] 新增「駭客任務 The Matrix」配色：黑底螢光綠、數值輝光、全 Canvas 圖表綠化 ([style.css](web/style.css), [app.js](web/app.js), [index.html](web/index.html))
- [x] Matrix 僅支援暗色：選用時強制 dark 主題並鎖定主題切換按鈕，切回時還原偏好 (`applyThemeLockForScheme`)
- [x] 已實現月度損益 bar 上顯示每月金額（正上負下）
- [x] 修正主題/配色切換未重繪損益圖，淺色背景下舊色 bar 隱形的問題

## v1.4.1 — 效能並行與排障強化
- [x] fetchData 帳務 API（餘額/額度/庫存/交割款）改為 Promise.allSettled 並行；快照獨立不被卡住 ([app.js](web/app.js))
- [x] 自選清單初始化後立即補打快照，開頁即有報價
- [x] TWSE 憑證鏈缺 SKI：自動降級寬鬆 SSL 並記住狀態（僅首次慢） ([dashboard.py](dashboard.py))
- [x] Proxy 上游錯誤/逾時印詳細原因；帳務端點等待 10s→30s
- [x] 新增 `sdk_probe.py` SDK 層帳務診斷腳本（區分 toolkit vs 永豐後台問題）
- [x] favicon 404 消除

## v1.4.0 — 系統優化實施計畫（終極防窺自訂版）14 項變更

- [x] 1. 期貨功能全面退場 ([index.html](web/index.html), [app.js](web/app.js))
  - [x] 移除期貨保證金卡片與期貨部位表格 HTML。
  - [x] 移除 `/portfolio/margin` 與 `F` 帳戶持倉輪詢，`state` 清除 `margin` / `futuresPositions`。
- [x] 2. 憑證存在性預檢與警告 ([dashboard.py](dashboard.py))
  - [x] `main()` 啟動時檢查 `CA_CERT_PATH`，憑證遺失印出黃色警告但不中斷伺服器。
- [x] 3. 新增「庫存證券總市值」與「總資產」卡片 ([index.html](web/index.html), [app.js](web/app.js))
  - [x] 於 `saveDailyAssetTotal()` 即時更新兩張新卡片。
- [x] 4. T+2 違約交割缺口主動警示 ([index.html](web/index.html), [app.js](web/app.js))
  - [x] `renderSettlements()` 逐日累計交割款，最終預估餘額 < 0 時顯示橘黃警戒條與缺口金額。
- [x] 5. 一鍵隱私遮蔽 (Boss Key) 與圖表安全防禦 ([index.html](web/index.html), [app.js](web/app.js), [style.css](web/style.css))
  - [x] 金額以 CSS `*****` 遮蔽（輪詢更新也不洩漏）；所有 Canvas 清空並印 `[DATA MASKED]`。
  - [x] 各繪圖函式（資產趨勢 / 損益 / 分時 / 均線 / sparkline）加入 bossKey guard 阻止重繪。
- [x] 6. 緊急避開鍵盤快捷鍵與滾動阻斷 ([app.js](web/app.js))
  - [x] `Esc` 切換 Boss Key（終端機模式開啟時優先關閉終端機）。
  - [x] 雙擊 `Space`（400ms 內）切換 Terminal Log Mode；非輸入框時一律 `preventDefault()` 阻斷滾動跳動。
- [x] 7. 資訊總覽卡片客製化顯示開關 ([index.html](web/index.html), [app.js](web/app.js), [style.css](web/style.css))
  - [x] 設定面板 9 張卡片核取方塊，即時生效並持久化於 `localStorage('cardVisibility')`。
- [x] 8. 終端機日誌看盤模式 Terminal Log Mode ([index.html](web/index.html), [app.js](web/app.js), [style.css](web/style.css))
  - [x] 黑底綠字全螢幕 Overlay，行情/損益偽裝為 heartbeat 與系統日誌；關閉時清空不留殘跡。
- [x] 9. 盤中委買委賣力道分析 ([index.html](web/index.html), [app.js](web/app.js), [style.css](web/style.css))
  - [x] 個股明細新增「多空力道對比條」，以 snapshot 最佳一檔委買/委賣張數計算買方力道比例。
  - 注意：Shioaji HTTP snapshot 僅提供最佳一檔委託量，非完整五檔加總。
- [x] 10. 歷史已實現損益月度條形圖 ([dashboard.py](dashboard.py), [index.html](web/index.html), [app.js](web/app.js))
  - [x] 後端 Proxy 攔截 `profit_loss`，未帶時間參數自動補前 365 天。
  - [x] 前端按月聚合並以 Canvas 繪製正負雙色條形圖。
- [x] 11. 自選股即時重大訊息看板 ([dashboard.py](dashboard.py), [index.html](web/index.html), [app.js](web/app.js))
  - [x] 後端 `/api/twse-announcements` 介接 TWSE OpenAPI（t187ap04_L，快取 10 分鐘）。
  - [x] 前端以系統 Log 形式顯示，每 10 分鐘自動更新。
- [x] 12. 自選股除權息與股利行事曆 ([dashboard.py](dashboard.py), [index.html](web/index.html), [app.js](web/app.js))
  - [x] 後端 `/api/twse-dividends` 介接 TWSE OpenAPI（TWT48U_ALL），民國日期轉 ISO。
  - [x] 前端顯示即期（今日含以後）除權息日期與預估股利。
- [x] 13. 歷史數據手動匯出與匯入安全校驗 ([dashboard.py](dashboard.py), [index.html](web/index.html), [app.js](web/app.js))
  - [x] 匯出 JSON 下載；匯入端點 `/api/asset-history/import` 嚴格校驗 Schema / 日期 / 數值，整批通過才寫入（含 `.bak` 備份）。
  - [x] 校驗邏輯通過 15 項單元測試（含 NaN / Infinity / bool / 多餘欄位 / 非法日期）。
- [x] 14. 自選股分批 Snapshots 流量優化 ([app.js](web/app.js))
  - [x] 自選上限 20 檔；快照查詢以每 10 檔為一組分批傳送。
- [x] 附加：`handle_post_history` 清理 90 天歷史時至少保留最近 10 筆。
- [x] 文件更新：`walkthrough.md`、`task.md`。

