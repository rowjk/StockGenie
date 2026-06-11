# SA - API 金鑰多組管理與 Demo 模式 (v1.6.0)【已實作】

## 架構
真實模式：前端 → dashboard.py（8081）→ `/proxy/` 轉發 shioaji.exe（8080）→ 永豐雲端；憑證管理為 dashboard.py 本機 API（**完全不依賴 Shioaji 進程**，防鎖死）。
Demo 模式：前端 `smartFetch` 攔截，記憶體生成假數據 + Random Walk 定時擾動重繪。

## credentials.json
```json
{ "active_index": 0, "profiles": [ { "name": "...", "api_key": "...", "secret_key": "...", "ca_cert_path": "...", "ca_password": "..." } ] }
```
原子寫入（tmp + os.replace）。`.env` 採合併更新：僅覆寫 API_KEY/SECRET_KEY/CA_CERT_PATH/CA_PASSWORD，保留其他設定與註解；執行中的 monitor.py 下次啟動才生效。

## 後端 API（dashboard.py DashboardHandler）
| 端點 | 方法 | 說明 |
|---|---|---|
| `/api/credentials` | GET | 回遮蔽後清單 + active_index |
| `/api/credentials/save` | POST | index=-1 新增（金鑰必填且非遮蔽）；否則修改（遮蔽欄位保留原值）。需 `verification_code:"PEA6"`（錯誤 403）。改到啟用中 → 熱套用 |
| `/api/credentials/switch` | POST | 改 active_index、寫 .env、背景重啟 shioaji。回應含 `restarting:true` |
| `/api/credentials/delete` | POST | 最後一組/啟用中拒絕（400）；刪除 index < active 時 active 自動 -1 |

## 子進程管理
全域 `shioaji_proc` + `threading.Lock`。`start_shioaji_server(env_dict)`：terminate → wait(5) → kill → `_wait_port_released`(8080, 5s) → Popen（環境變數 SJ_API_KEY/SJ_SEC_KEY/SJ_CA_PATH/SJ_CA_PASSWD/SJ_PRODUCTION）。啟動失敗回 False 不致命（設定 API 照常運作）。重啟由背景 thread 執行，HTTP 回應不阻塞。

## 前端
* 遮蔽判定 `MASK_TOKENS = ("...", "●", "*")`；mask_api_key 前 6...後 4、mask_fixed 固定 8 點。
* 重啟遮罩 `#server-restart-overlay`：等 3 秒（防誤測舊進程）後每秒 fetch `/proxy/api/v1/auth/usage`（**真實 fetch，不過 smartFetch**），30 次逾時顯示錯誤 + 強制解鎖鈕；成功後 `state.accounts=[]` 重載 session。
* `smartFetch(url, options)`：demo 關閉時直通 fetch。開啟時攔截：auth/usage、auth/accounts、account_balance、trading_limits、position_unit（unit=Share 股數）、settlements、profit_loss、snapshots、contracts、kbars（`{Close:[250]}`）、ticks（`{close:[54]}` 09:00-13:30 5分）、place_order、trade-permission、asset-history（所有方法回唯讀假歷史）、twse-announcements/dividends、us-chart。未知端點 console.warn。credentials 端點不攔截（保持真實）。
* Demo 引擎：`demoState`（balance/positions/quotes/usQuotes/historyShape/orderSeq）；未知代碼以字串雜湊產生 20~1000 穩定假價；隨機漫步 ±0.1~0.3%、偏離參考價上限 ±9.5%；趨勢圖形狀正規化使終點=1 再乘（餘額+市值）達成校準；下單成交以 setTimeout 1-2 秒模擬，成交後 `_fetchCount=0; fetchData()` 立即刷新；Demo 中 startSSE 與 saveDailyAssetTotal 寫入皆跳過。
