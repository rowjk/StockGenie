# StockGenie - 設計規格書（精簡版）

## 偽裝配色（CSS Variables）
| 模式 | 上漲 | 下跌 | 備註 |
|---|---|---|---|
| Slate（預設） | `#3b82f6` | `#94a3b8` | 似 AWS/Jira 監控 |
| Stealth | 無色差 | 無色差 | 僅 +/- 識別，最防窺 |
| Muted | `#e11d48` | `#16a34a` | 低飽和紅綠 |
| Matrix | `#00ff41` | `#1f8a3d` | 黑底綠字輝光；強制暗色並鎖定主題鈕 |

## 佈局
64px 極簡側欄（總覽/庫存/自選/美股/API 狀態/設定，系統圖示偽裝）；Header：帳號遮蔽顯示（`證券 (*763)`）、連線燈號、DEMO 徽章（v1.6）、快速下單框、配色切換、Boss Key 與 Terminal Mode 鈕。總覽卡片可自訂顯示（localStorage）。

## 關鍵技術決策
1. **原生技術棧**：無第三方庫，HTML5 + CSS Variables + ES6 + Canvas。
2. **CORS 規避**：8081 `/proxy/` 同源反向代理轉發至 8080（ThreadingHTTPServer 多執行緒防阻塞）。
3. **SSE 直連 8080**：長連線不佔用 Python 後端執行緒。
4. **流量控制**：行情輪詢 15s（可調）；帳務每 4 輪（~60s）並行發出（Promise.allSettled）；自選快照每 10 檔分批；kbars 快取 1hr；Page Visibility 背景全停。
5. **美股代理安全**：非開放代理——代碼格式驗證（1-12 字元、大寫英數+`.^-=`）、僅允許 `1d/5m` 與 `2y/1d` 查詢組合、後端雙層快取（60s/30min）、null bar 後端清洗。
6. **Sparkline**：無座標軸無刻度 Canvas 折線，似伺服器負載圖。
7. **下單雙重防護**：安全鎖覆蓋層 + 自訂確認 Modal，全中文欄位，整張/零股明確區分。
