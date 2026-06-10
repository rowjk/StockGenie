/* ==========================================================================
   StockGenie API Stock Dashboard - Core Frontend JavaScript (Traditional Chinese)
   ==========================================================================
   版本歷史：
   v1.3.25 (2026-06-10)
   - [快取] 伺服器端 DashboardHandler 新增 Cache-Control 停用快取標頭，解決瀏覽器快取舊網頁與樣式問題
   - [排版] 強力修正隱形黑白模式下，白底按鈕及 hovered tabs 字體偏白導致文字看不見的問題，將文字顏色強制設為 bg-primary
   - [自選] 自選清單將「顯示走勢圖」字眼修訂為「顯示趨勢圖」，以切合使用者語意
   v1.3.24 (2026-06-10)
   - [自選] 新增「顯示走勢圖」Toggle 切換開關，預設隱藏自選監控卡片微型走勢圖以省去 CPU 渲染與定時更新負荷
   - [排版] 修正隱形黑白模式下，白底按鈕（新增監控按鈕、代號下單按鈕及分時/均線切換 Tab）字體偏白導致文字重疊消失的問題，將文字顏色強制指定為 bg-primary 產生黑白極簡對比
   v1.3.23 (2026-06-10)
   - [排版] 修正隱形黑白模式下，大盤指數卡片的漲跌幅徽章背景色（與卡片背景色重疊融合）之對比度，將指數徽章背景色強制指定為 bg-secondary
   v1.3.22 (2026-06-10)
   - [排版] 新增自選指數商品卡片最右側的預留佔位區塊（Placeholder），使無下單按鈕的大盤指數價格區塊能與其他普通股票對齊
   v1.3.21 (2026-06-10)
   - [排版] 優化自選監控卡片於寬螢幕下的排版對齊，使微型走勢圖（Sparkline）優雅置中，並增加視窗 resize 時重繪走勢圖的防禦機制
   v1.3.20 (2026-06-10)
   - [自選] 支援自選監控清單自訂排序，於卡片左側提供微型上移（▲）/下移（▼）按鈕
   - [大盤] 大盤指數（IND）卡片加上淡灰底色，且漲跌幅徽章調整為顯示「漲跌點數 (漲跌百分比)」
   v1.3.19 (2026-06-10)
   - [大盤] 支援大盤加權指數 (TSE001 / 001) 的監控與圖表繪製，自選股新增時自動 fallback 支援 IND 合約，並自動隱藏其交易下單按鈕
   v1.3.18 (2026-06-10)
   - [排版] 修正天區（Header）在畫面縮小寬度時的跑版，隱藏標題與狀態文字（僅留圖示與燈號），實現類似側邊欄的響應式收縮
   v1.3.17 (2026-06-09)
   - [安全性] 新增唯讀 API 金鑰安全攔截，並在前端/後端雙重檢查，無權限時顯示「下單權限關閉」
   v1.3.16 (2026-06-09)
   - [修正] drawCanvasLoading 函數宣告遺失造成整個 JS 語法錯誤
   - [修正] renderDetailTickChart 畫圖前未 clearRect，導致「載入中...」殘留
   - [修正] 自選股昨日參考價：snapshot API 無此欄位，改從 contracts API 補抓並快取
   - [修正] 自選監控清單價格欄位對齊（watchlist-info flex:1，price-block 固定寬度）
   - [效能] 新增 fetchKbarsWithCache：loadMAStats 與 renderDetailMAChart 共用同一份
            2 年 kbars，避免每次點選股票都重複抓取（快取 1 小時）
   - [效能] checkServerStatus 輪詢間隔 10s → 60s（每小時減少 300 次 /auth/usage）
   - [效能] 新增 isTradingHours()：盤後完全跳過 trading_limits（永遠 500）
   - [效能] 新增 _fetchCount：balance / position_unit / settlements / margin 降頻為
            每 4 次 snapshot 週期執行一次（≈ 60s），snapshot 仍維持高頻即時更新
   ========================================================================== */

const API_BASE = 'http://127.0.0.1:8081/proxy/api/v1';
const LOCAL_API_BASE = 'http://127.0.0.1:8081/api';

// ── Kbars 快取（session 內共用，避免重複抓 2 年歷史資料）──────────────────
// key: code, value: { closes: [], fetchedAt: Date }
const kbarsCache = {};

// ── 應用程式狀態管理 ──────────────────────────────────────────────────────
let state = {
    accounts: [],
    selectedAccount: null,
    stockPositions: [],
    futuresPositions: [],
    balance: 0,
    margin: null,
    limit: null,
    settlements: [],
    watchlist: [], // 包含 {code, name, exchange, prices: []}
    assetHistory: [], // 包含 {date, value}
    activeView: 'dashboard',
    refreshInterval: 15000,
    pollingTimer: null,
    sseConnection: null,
    drawerExchange: 'TSE',
    showSparkline: false,
    idleTimer: null,
    stockPositionUnit: 'Lot', // 'Share' 表示 API 已回傳股數（含零股）
    tradingPermitted: true,
};

// ── 初始化載入 ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // 逐一初始化，任一失敗不中斷後續（防止快取版 HTML 缺少元素時全崩）
    for (const fn of [initSettings, initNavigation, initWatchlistControls,
                      initDrawerControls, initHistoryControls, initIdleTimeout, initQuickOrder]) {
        try { fn(); } catch (e) { console.error(`[init] ${fn.name} 失敗:`, e); }
    }

    // 檢查與永豐 API 伺服器的連線狀態
    await checkServerStatus();

    // 定時監控伺服器狀態 (每 60 秒，降低 /auth/usage 呼叫頻率)
    setInterval(checkServerStatus, 60000);

    // 視窗調整大小時，重繪自選股微型走勢圖
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            renderWatchlist();
        }, 150);
    });
});

// ── 系統環境與主題設定 ────────────────────────────────────────────────────
function initSettings() {
    // 讀取本地儲存的主題與配色
    const savedTheme = localStorage.getItem('theme') || 'dark';
    const savedScheme = localStorage.getItem('scheme') || 'slate';
    const savedInterval = localStorage.getItem('refreshInterval') || '15000';
    
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.documentElement.setAttribute('data-scheme', savedScheme);
    state.refreshInterval = parseInt(savedInterval);
    
    // 設定 UI 控制項預設值
    document.getElementById('scheme-selector').value = savedScheme;
    document.getElementById('settings-scheme-selector').value = savedScheme;
    document.getElementById('settings-refresh-selector').value = savedInterval;
    
    // 亮暗主題切換按鈕
    document.getElementById('theme-toggle').addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
    });
    
    // 配色方案下拉選單更動事件
    const handleSchemeChange = (e) => {
        const val = e.target.value;
        document.documentElement.setAttribute('data-scheme', val);
        localStorage.setItem('scheme', val);
        document.getElementById('scheme-selector').value = val;
        document.getElementById('settings-scheme-selector').value = val;
        // 重新繪製圖表
        renderAssetChart();
        renderWatchlist();
    };
    
    document.getElementById('scheme-selector').addEventListener('change', handleSchemeChange);
    document.getElementById('settings-scheme-selector').addEventListener('change', handleSchemeChange);
    
    // 更新頻率下拉選單更動事件
    document.getElementById('settings-refresh-selector').addEventListener('change', (e) => {
        state.refreshInterval = parseInt(e.target.value);
        localStorage.setItem('refreshInterval', e.target.value);
        restartPolling();
    });
}

// ── 側邊欄導覽切換 ────────────────────────────────────────────────────────
function initNavigation() {
    const items = document.querySelectorAll('.sidebar-item');
    items.forEach(item => {
        item.addEventListener('click', () => {
            const targetView = item.getAttribute('data-view');
            if (!targetView) return;
            
            // 更新選取狀態的樣式
            items.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            // 切換對應的面板視窗
            document.querySelectorAll('.view-section').forEach(section => {
                section.classList.remove('active');
            });
            document.getElementById(`view-${targetView}`).classList.add('active');
            
            state.activeView = targetView;
            
            // 特定視窗切換時的數據刷新
            if (targetView === 'dashboard') {
                renderAssetChart();
            } else if (targetView === 'settings') {
                renderHistoryTable();
            }
        });
    });
}

// ── API 伺服器狀態與登入連線管理 ──────────────────────────────────────────
async function checkServerStatus() {
    const dot = document.getElementById('server-status-dot');
    const text = document.getElementById('server-status-text');
    
    try {
        const response = await fetch(`${API_BASE}/auth/usage`);
        if (response.ok) {
            dot.classList.add('online');
            text.textContent = '伺服器已連線';
            
            // 首次成功連線載入帳號
            if (state.accounts.length === 0) {
                await loadSession();
            }
            
            // 更新流量數據 UI
            const usage = await response.json();
            updateUsageUI(usage);
        } else {
            throw new Error();
        }
    } catch (e) {
        dot.classList.remove('online');
        text.textContent = '伺服器已斷線';
        setOfflineState();
    }
}

function updateUsageUI(usage) {
    document.getElementById('api-connections').textContent = usage.connections;
    const mbUsed = (usage.bytes / 1024 / 1024).toFixed(2);
    const mbLimit = (usage.limit_bytes / 1024 / 1024).toFixed(0);
    
    document.getElementById('api-bytes-val').textContent = `${mbUsed} MB`;
    document.getElementById('api-bytes-summary').textContent = `已用流量: ${mbUsed} MB / 每日上限: ${mbLimit} MB`;
    
    const pct = Math.min(100, (usage.bytes / usage.limit_bytes) * 100);
    document.getElementById('api-bytes-progress').style.width = `${pct}%`;
}

function setOfflineState() {
    document.getElementById('account-selector').innerHTML = '<option value="">無啟動的連線</option>';
    state.accounts = [];
    state.selectedAccount = null;
    stopPolling();
    closeSSE();
}

async function loadSession() {
    try {
        // 檢查交易權限
        try {
            const permResp = await fetch(`${LOCAL_API_BASE}/trade-permission`);
            if (permResp.ok) {
                const permData = await permResp.json();
                state.tradingPermitted = permData.trading_permitted;
            }
        } catch (e) {
            console.error("無法獲取交易權限資訊", e);
        }

        const response = await fetch(`${API_BASE}/auth/accounts`);
        if (!response.ok) return;
        
        state.accounts = await response.json();
        
        // 渲染帳號選擇器
        const selector = document.getElementById('account-selector');
        selector.innerHTML = '';
        
        state.accounts.forEach(acc => {
            const opt = document.createElement('option');
            let typeStr = '證券';
            if (acc.account_type === 'F') typeStr = '期貨';
            if (acc.account_type === 'H') typeStr = '複委託';
            
            opt.value = `${acc.account_type}:${acc.broker_id}:${acc.account_id}`;
            opt.textContent = `${typeStr} (*${acc.account_id.slice(-4)})`;
            selector.appendChild(opt);
        });
        
        // 預設選取第一個證券帳戶
        const stockAcc = state.accounts.find(a => a.account_type === 'S');
        if (stockAcc) {
            selector.value = `S:${stockAcc.broker_id}:${stockAcc.account_id}`;
            state.selectedAccount = stockAcc;
        } else if (state.accounts.length > 0) {
            selector.value = `${state.accounts[0].account_type}:${state.accounts[0].broker_id}:${state.accounts[0].account_id}`;
            state.selectedAccount = state.accounts[0];
        }
        
        // 設定帳戶更換時的重新載入
        selector.onchange = (e) => {
            const [type, broker, id] = e.target.value.split(':');
            state.selectedAccount = state.accounts.find(a => a.account_type === type && a.broker_id === broker && a.account_id === id);
            restartPolling();
        };

        // 輸出帳號資訊至流量狀態頁面
        document.getElementById('api-session-details').textContent = 
            `已驗證的永豐 API 連線帳戶：\n` + 
            state.accounts.map(a => {
                let t = a.account_type === 'S' ? '證券' : (a.account_type === 'F' ? '期貨' : '複委託');
                return ` - 類型: ${t} | 分公司代碼: ${a.broker_id} | 帳號: *${a.account_id.slice(-4)} | 簽署同意書: ${a.signed ? '已簽署' : '未簽署'}`;
            }).join('\n');
        
        // 啟動定時輪詢與即時 SSE 回報
        restartPolling();
        startSSE();
        
        // 載入本地資產歷史紀錄
        await loadAssetHistory();
        
        // 初始化自選股清單
        initWatchlist();

    } catch (e) {
        console.error("載入 API 會話資訊失敗", e);
    }
}

// ── SSE 即時成交與委託回報接收 ──────────────────────────────────────────
function startSSE() {
    closeSSE();
    
    // 連線至永豐即時回報 SSE 端點 (直連 8080 避免 proxy 阻塞)
    state.sseConnection = new EventSource(`http://127.0.0.1:8080/api/v1/stream/data/order_event`);
    
    state.sseConnection.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            showOrderNotification(data);
        } catch (e) {
            console.error("解析即時回報事件失敗", e);
        }
    };
    
    state.sseConnection.onerror = (e) => {
        console.warn("SSE 即時連線中斷，正在自動重新連線...");
    };
}

function closeSSE() {
    if (state.sseConnection) {
        state.sseConnection.close();
        state.sseConnection = null;
    }
}

function showOrderNotification(data) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    
    const time = new Date().toLocaleTimeString();
    
    // 將下單委託通知以系統日誌 Log 的低調外觀呈現
    toast.innerHTML = `
        <div class="toast-header">
            <span>[委託異動日誌] 單號 #${data.order?.id || '事件'}</span>
            <span class="toast-time">${time}</span>
        </div>
        <div style="margin-top: 4px;">商品：${data.contract?.code} (${data.contract?.name || '股票'})</div>
        <div>委託狀態：<span class="val-up">${data.status?.status || '已送出'}</span></div>
        <div style="color: var(--text-secondary);">數量：${data.order?.quantity} | 價格：$${data.order?.price}</div>
    `;
    
    container.appendChild(toast);
    
    // 6 秒後自動關閉通知
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 6000);
}

// ── 定時拉取資料控制 ────────────────────────────────────────────────────
function restartPolling() {
    stopPolling();
    fetchData(); // 立即重新抓取一次
    state.pollingTimer = setInterval(fetchData, state.refreshInterval);
}

function stopPolling() {
    if (state.pollingTimer) {
        clearInterval(state.pollingTimer);
        state.pollingTimer = null;
    }
}

// 計算目前是否在台灣交易時段（09:00–13:35）
function isTradingHours() {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes();
    const mins = h * 60 + m;
    return mins >= 9 * 60 && mins <= 13 * 60 + 35;
}

// fetchData 呼叫計數器，用於降頻控制
let _fetchCount = 0;

async function fetchData() {
    if (!state.selectedAccount) return;
    _fetchCount++;
    // 每 4 次才執行一次慢速 API（庫存、交割款、額度）≈ 每 60 秒
    const doSlowApis = (_fetchCount % 4 === 1);

    const stockAcc = state.accounts.find(a => a.account_type === 'S');
    const futAcc = state.accounts.find(a => a.account_type === 'F');
    
    // 1–4 慢速 API：僅在 doSlowApis 週期執行（約每 60 秒一次）
    if (stockAcc && doSlowApis) {
        try {
            const resp = await fetch(`${API_BASE}/portfolio/account_balance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    broker_id: stockAcc.broker_id,
                    account_id: stockAcc.account_id,
                    person_id: stockAcc.person_id
                })
            });
            if (resp.ok) {
                const bal = await resp.json();
                state.balance = bal.acc_balance;
                document.getElementById('cash-balance').textContent = formatCurrency(state.balance);
            }
        } catch (e) {
            console.error("獲取餘額失敗", e);
        }
        
        // 2. 取得交易額度（盤後 API 永遠 500，直接跳過）
        if (isTradingHours()) try {
            const resp = await fetch(`${API_BASE}/portfolio/trading_limits`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    account_type: 'S',
                    broker_id: stockAcc.broker_id,
                    account_id: stockAcc.account_id,
                    person_id: stockAcc.person_id
                })
            });
            if (resp.ok) {
                const limit = await resp.json();
                state.limit = limit;
                
                const limitEl = document.getElementById('limit-available');
                limitEl.textContent = formatCurrency(limit.trading_available);
                limitEl.classList.remove('fallback-text');
                const used = limit.trading_used;
                const total = limit.trading_limit;
                const pct = total > 0 ? ((used / total) * 100).toFixed(0) : 0;
                
                document.getElementById('limit-pct').textContent = `${pct}%`;
                document.getElementById('limit-summary').textContent = `已用: ${formatCurrency(used)} / 總額: ${formatCurrency(total)}`;
                document.getElementById('limit-progress').style.width = `${pct}%`;
            } else {
                const limitEl = document.getElementById('limit-available');
                limitEl.textContent = '盤後暫停服務';
                limitEl.classList.add('fallback-text');
                document.getElementById('limit-summary').textContent = '（非交易時段永豐 API 不開放查詢交易額度）';
                document.getElementById('limit-pct').textContent = '0%';
                document.getElementById('limit-progress').style.width = '0%';
            }
        } catch (e) {
            console.error("獲取交易額度失敗", e);
            const limitEl = document.getElementById('limit-available');
            limitEl.textContent = '盤後暫停服務';
            limitEl.classList.add('fallback-text');
            document.getElementById('limit-summary').textContent = '（非交易時段永豐 API 不開放查詢交易額度）';
            document.getElementById('limit-pct').textContent = '0%';
            document.getElementById('limit-progress').style.width = '0%';
        } // end isTradingHours block

        // 3. 取得股票庫存
        // 依序嘗試：unit=1 (int) → unit="Share" (string) → 無 unit (Lot 模式)
        // 開啟瀏覽器 Console 可看到詳細錯誤，有助診斷版本相容性問題
        try {
            const basePayload = {
                account_type: 'S',
                broker_id: stockAcc.broker_id,
                account_id: stockAcc.account_id,
                person_id: stockAcc.person_id,
            };

            const tryFetch = (extraBody) => fetch(`${API_BASE}/portfolio/position_unit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...basePayload, ...extraBody })
            });

            // 優先 unit="Share"（字串），Shioaji HTTP server 回傳總股數含零股
            // 若失敗則 fallback 至無 unit（Lot 模式，僅整張）
            let resp = await tryFetch({ unit: 'Share' });

            if (!resp.ok) {
                const errBody = await resp.text().catch(() => '');
                console.warn(`[庫存] unit=Share 失敗 HTTP${resp.status}: ${errBody}，改用 Lot 模式`);
                resp = await tryFetch({});
                if (resp.ok) {
                    state.stockPositions = await resp.json();
                    state.stockPositionUnit = 'Lot';
                } else {
                    console.error('[庫存] 所有模式均失敗');
                }
            } else {
                state.stockPositions = await resp.json();
                state.stockPositionUnit = 'Share';
            }

            await enrichPositionNames();
            renderStockPositions();
        } catch (e) {
            console.error("獲取股票庫存失敗", e);
            renderStockPositions();
        }

        // 4. 取得近三日交割款
        try {
            const resp = await fetch(`${API_BASE}/portfolio/settlements`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    broker_id: stockAcc.broker_id,
                    account_id: stockAcc.account_id,
                    person_id: stockAcc.person_id
                })
            });
            if (resp.ok) {
                state.settlements = await resp.json();
                renderSettlements();
            }
        } catch (e) {
            console.error("獲取交割款數據失敗", e);
        }
    }
    
    // 期貨卡片顯示/隱藏（每次都跑）
    if (!futAcc) {
        document.getElementById('futures-card').style.display = 'none';
        document.getElementById('futures-positions-card').style.display = 'none';
    }
    // 5–6. 期貨資料（降頻）
    if (futAcc && doSlowApis) {
        document.getElementById('futures-card').style.display = 'block';
        document.getElementById('futures-positions-card').style.display = 'block';
        
        try {
            const resp = await fetch(`${API_BASE}/portfolio/margin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    broker_id: futAcc.broker_id,
                    account_id: futAcc.account_id,
                    person_id: futAcc.person_id
                })
            });
            if (resp.ok) {
                state.margin = await resp.json();
                
                document.getElementById('futures-balance').textContent = formatCurrency(state.margin.today_balance);
                const openPnl = state.margin.future_open_position || 0;
                
                const pnlEl = document.getElementById('futures-open-pnl');
                pnlEl.textContent = formatCurrency(openPnl);
                pnlEl.className = openPnl >= 0 ? 'val-up' : 'val-down';
                
                const riskBadge = document.getElementById('futures-risk-badge');
                riskBadge.textContent = `風險指標: ${state.margin.risk_indicator.toFixed(1)}%`;
                riskBadge.className = state.margin.risk_indicator > 80 ? 'badge-up' : 'badge-down';
            }
        } catch (e) {
            console.error("獲取期貨保證金失敗", e);
        }
        
        // 6. 取得期貨部位
        try {
            const resp = await fetch(`${API_BASE}/portfolio/position_unit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    account_type: 'F',
                    broker_id: futAcc.broker_id,
                    account_id: futAcc.account_id,
                    person_id: futAcc.person_id
                })
            });
            if (resp.ok) {
                state.futuresPositions = await resp.json();
                renderFuturesPositions();
            }
        } catch (e) {
            console.error("獲取期貨部位失敗", e);
        }
    }

    // 7. 更新自選股即時資訊（每次都跑，這是最需要即時的資料）
    await updateWatchlistSnapshots();
    
    // 8. 儲存每日收盤財產總額
    await saveDailyAssetTotal();
}

function renderStockPositions() {
    const tbody = document.querySelector('#stock-positions-table tbody');
    tbody.innerHTML = '';
    
    if (state.stockPositions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">此帳戶目前無證券庫存部位。</td></tr>';
        return;
    }
    
    state.stockPositions.forEach(pos => {
        const tr = document.createElement('tr');
        tr.onclick = () => openOrderDrawer(pos.code, 'STK', pos.last_price, pos.exchange || 'TSE');
        
        const pnl = pos.pnl || 0;
        const pnlClass = pnl >= 0 ? 'val-up' : 'val-down';
        const pnlRateVal = pos.pnl_rate !== undefined ? pos.pnl_rate : (pos.price > 0 ? ((pos.last_price - pos.price) / pos.price) * 100 : 0);
        const pnlPct = `${pnlRateVal >= 0 ? '+' : ''}${pnlRateVal.toFixed(2)}%`;
        const dirStr = (pos.direction === 'Buy' || pos.direction === 'B') ? '買進' : '賣出';
        // unit=Share 時 quantity 已是股數（含零股）；Lot 時需 ×1000
        const qtyShares = state.stockPositionUnit === 'Share'
            ? pos.quantity
            : pos.quantity * lotMultiplier(pos);
        const qtyStr = `${qtyShares.toLocaleString()}股`;

        tr.innerHTML = `
            <td class="mono" style="font-weight: 600; color: var(--color-accent);">${pos.code}</td>
            <td>${pos.name || '證券'}</td>
            <td>${dirStr}</td>
            <td class="mono">${qtyStr}</td>
            <td class="mono">${pos.price.toFixed(2)}</td>
            <td class="mono">${pos.last_price.toFixed(2)}</td>
            <td class="mono ${pnlClass}">${formatCurrency(pnl)}</td>
            <td class="mono ${pnlClass}">${pnlPct}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderFuturesPositions() {
    const tbody = document.querySelector('#futures-positions-table tbody');
    tbody.innerHTML = '';
    
    if (state.futuresPositions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">此帳戶目前無期貨部位。</td></tr>';
        return;
    }
    
    state.futuresPositions.forEach(pos => {
        const tr = document.createElement('tr');
        tr.onclick = () => openOrderDrawer(pos.code, 'FUT', pos.last_price);
        
        const pnl = pos.pnl || 0;
        const pnlClass = pnl >= 0 ? 'val-up' : 'val-down';
        const dirStr = (pos.direction === 'Buy' || pos.direction === 'B') ? '多頭' : '空頭';
        
        tr.innerHTML = `
            <td class="mono" style="font-weight: 600; color: var(--color-accent);">${pos.code}</td>
            <td>${dirStr}</td>
            <td class="mono">${pos.quantity}</td>
            <td class="mono">${pos.price.toFixed(2)}</td>
            <td class="mono">${pos.last_price.toFixed(2)}</td>
            <td class="mono ${pnlClass}">${formatCurrency(pnl)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderSettlements() {
    const container = document.getElementById('settlements-container');
    container.innerHTML = '';
    
    if (state.settlements.length === 0) {
        for (let i = 0; i < 3; i++) {
            const div = document.createElement('div');
            div.className = 'settlement-item';
            div.innerHTML = `<div class="settlement-date">T+${i}</div><div class="settlement-amount">--</div>`;
            container.appendChild(div);
        }
        return;
    }
    
    // Sort settlements by T ascending to ensure progressive calculation
    const sorted = [...state.settlements].sort((a, b) => a.T - b.T);
    
    let runningBalance = state.balance !== undefined && state.balance !== null ? state.balance : null;
    
    sorted.forEach(s => {
        const div = document.createElement('div');
        div.className = 'settlement-item';
        const amt = s.amount || 0;
        
        // T+0 balance is current bank balance
        // T+1 balance = T+0 balance + T+1 settlement
        // T+2 balance = T+1 balance + T+2 settlement
        if (runningBalance !== null && s.T > 0) {
            runningBalance += amt;
        }
        
        const balanceText = runningBalance !== null ? formatCurrency(runningBalance) : '--';
        const colorClass = amt > 0 ? 'val-up' : (amt < 0 ? 'val-down' : '');
        const amountPrefix = amt > 0 ? '+' : '';
        
        div.innerHTML = `
            <div class="settlement-date">${s.date} (T+${s.T})</div>
            <div class="settlement-amount ${colorClass}" style="font-size: 1.15rem; margin-top: 4px;">
                <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal; display: block; margin-bottom: 2px;">交割淨額</span>
                ${amountPrefix}${formatCurrency(amt)}
            </div>
            <div class="settlement-balance" style="margin-top: 10px; font-family: var(--font-mono); font-size: 1rem; font-weight: 600; color: var(--text-primary);">
                <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal; display: block; margin-bottom: 2px;">預估餘額</span>
                ${balanceText}
            </div>
        `;
        container.appendChild(div);
    });
}

// ── 自選股監控管理 ──────────────────────────────────────────────────────
async function initWatchlist() {
    const defaultList = ['2330', '2317', '0050'];
    const saved = localStorage.getItem('watchlist');

    if (saved) {
        state.watchlist = JSON.parse(saved);
    } else {
        state.watchlist = defaultList.map(code => ({ code, name: '', exchange: 'TSE', prices: [] }));
        saveWatchlistLocal();
    }

    // snapshot API 不保證有名稱，針對缺名稱的項目補查 contracts endpoint
    const nameless = state.watchlist.filter(item => !item.name);
    if (nameless.length > 0) {
        await Promise.all(nameless.map(async item => {
            try {
                const resp = await fetch(`${API_BASE}/data/contracts/${item.code}?security_type=STK`);
                if (resp.ok) {
                    const contract = await resp.json();
                    item.name = contract.name || item.code;
                    item.exchange = contract.exchange || item.exchange;
                }
            } catch (e) {
                console.warn(`無法查詢 ${item.code} 合約資訊`, e);
            }
        }));
        saveWatchlistLocal(); // 快取名稱，下次載入不需再查
    }

    renderWatchlist();
}

function saveWatchlistLocal() {
    localStorage.setItem('watchlist', JSON.stringify(state.watchlist));
}

function initWatchlistControls() {
    document.getElementById('btn-add-watchlist').addEventListener('click', async () => {
        const input = document.getElementById('watchlist-search-input');
        const code = input.value.trim();
        if (!code) return;
        
        try {
            // 查詢合約資訊，優先用 STK (股票) 查，若查無則用 IND (指數) 查
            let secType = 'STK';
            let resp = await fetch(`${API_BASE}/data/contracts/${code}?security_type=STK`);
            if (!resp.ok) {
                resp = await fetch(`${API_BASE}/data/contracts/${code}?security_type=IND`);
                if (resp.ok) secType = 'IND';
            }
            if (resp.ok) {
                const contract = await resp.json();
                
                // 避免重複加入
                if (state.watchlist.some(item => item.code === contract.code)) {
                    input.value = '';
                    return;
                }
                
                state.watchlist.push({
                    code: contract.code,
                    name: contract.name,
                    exchange: contract.exchange,
                    security_type: secType,
                    reference: contract.reference || 0,
                    prices: []
                });
                
                saveWatchlistLocal();
                input.value = '';
                renderWatchlist();
                await updateWatchlistSnapshots();
            } else {
                alert(`在商品檔中找不到股票代號 ${code}`);
            }
        } catch (e) {
            console.error("查詢商品合約失敗", e);
        }
    });
    
    // 按下 Enter 新增自選股
    document.getElementById('watchlist-search-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('btn-add-watchlist').click();
        }
    });

    // 分時 / 均線 Tab 切換（若元素不存在則略過，防快取舊 HTML 崩潰）
    document.querySelectorAll('.detail-tab').forEach(tab => {
        tab.addEventListener('click', async () => {
            document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabName = tab.getAttribute('data-tab');
            document.getElementById('detail-tick-panel').style.display = tabName === 'tick' ? '' : 'none';
            document.getElementById('detail-ma-panel').style.display   = tabName === 'ma'   ? '' : 'none';
            const code = document.getElementById('detail-code').textContent;
            if (code && code !== '----') {
                if (tabName === 'tick') await renderDetailTickChart(code);
                else await renderDetailMAChart(code);
            }
        });
    });

    // 初始化自選走勢圖顯示切換開關 (預設關閉)
    const toggleSpark = document.getElementById('toggle-sparkline');
    if (toggleSpark) {
        const savedShow = localStorage.getItem('showSparkline') === 'true';
        state.showSparkline = savedShow;
        toggleSpark.checked = savedShow;
        
        toggleSpark.addEventListener('change', (e) => {
            state.showSparkline = e.target.checked;
            localStorage.setItem('showSparkline', e.target.checked);
            renderWatchlist();
        });
    }
}

async function updateWatchlistSnapshots() {
    if (state.watchlist.length === 0) return;
    
    const contracts = state.watchlist.map(item => ({
        security_type: item.security_type || 'STK',
        exchange: item.exchange,
        code: item.code
    }));
    
    try {
        const resp = await fetch(`${API_BASE}/data/snapshots`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contracts })
        });
        if (resp.ok) {
            const snapshots = await resp.json();
            
            snapshots.forEach(snap => {
                const item = state.watchlist.find(w => w.code === snap.code);
                if (item) {
                    if (snap.name) item.name = snap.name; // 只在 snapshot 有名稱時更新，避免覆蓋掉已從 contracts 查到的名稱
                    item.close = snap.close;
                    item.change_rate = snap.change_rate;
                    item.change_price = snap.change_price;
                    item.open = snap.open;
                    item.high = snap.high;
                    item.low = snap.low;
                    item.volume = snap.volume;
                    item.total_volume = snap.total_volume;
                    item.yesterday_volume = snap.yesterday_volume;
                    // 昨日參考價（Shioaji HTTP API 可能用 reference_price 或 reference）
                    const refVal = snap.reference_price ?? snap.reference;
                    if (refVal != null && refVal !== 0) item.reference = refVal;
                    
                    // 記錄價格陣列用於繪製 sparkline 走勢圖
                    if (!item.prices) item.prices = [];
                    if (item.prices.length === 0 || item.prices[item.prices.length - 1] !== snap.close) {
                        item.prices.push(snap.close);
                        if (item.prices.length > 30) item.prices.shift(); // 最多保存 30 個報價點
                    }
                }
            });
            
            renderWatchlist();
            
            // 如果細節視窗有開啟自選股，同步更新
            const activeDetailCode = document.getElementById('detail-code').textContent;
            if (activeDetailCode && activeDetailCode !== '----') {
                updateDetailView(activeDetailCode);
            }
        }
    } catch (e) {
        console.error("更新自選股快照失敗", e);
    }
}

function renderWatchlist() {
    const container = document.getElementById('watchlist-list');
    container.innerHTML = '';
    
    if (state.watchlist.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 12px;">自選清單目前無監控股票。</div>';
        return;
    }
    
    state.watchlist.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'watchlist-item';
        const isIndex = item.security_type === 'IND';
        if (isIndex) {
            div.classList.add('watchlist-item-index');
        }
        div.onclick = () => selectWatchlistItem(item.code);
        
        const priceStr = item.close ? item.close.toFixed(2) : '--';
        const rateVal = item.change_rate || 0;
        
        let rateStr = '';
        if (isIndex) {
            const diffVal = item.change_price ?? (item.close && item.reference ? item.close - item.reference : null);
            const diffStr = diffVal != null ? `${diffVal >= 0 ? '+' : ''}${diffVal.toFixed(2)}` : '--';
            const ratePctStr = item.change_rate ? `${rateVal >= 0 ? '+' : ''}${rateVal.toFixed(2)}%` : '--';
            rateStr = `${diffStr} (${ratePctStr})`;
        } else {
            rateStr = item.change_rate ? `${rateVal >= 0 ? '+' : ''}${rateVal.toFixed(2)}%` : '--';
        }
        const rateClass = rateVal > 0 ? 'badge-up' : (rateVal < 0 ? 'badge-down' : 'metric-subtitle');
        
        const orderBtnHtml = isIndex 
            ? `<div class="watchlist-order-btn-placeholder"></div>` 
            : `<button class="watchlist-order-btn" title="開啟下單面板">下單</button>`;

        const upDisabled = index === 0 ? 'disabled style="visibility:hidden;"' : '';
        const downDisabled = index === state.watchlist.length - 1 ? 'disabled style="visibility:hidden;"' : '';

        const canvasHtml = state.showSparkline
            ? `<canvas class="watchlist-chart" id="spark-${item.code}"></canvas>`
            : '';

        div.innerHTML = `
            <div class="watchlist-order-actions">
                <button class="watchlist-order-up" ${upDisabled} title="上移">▲</button>
                <button class="watchlist-order-down" ${downDisabled} title="下移">▼</button>
            </div>
            <div class="watchlist-info">
                <span class="watchlist-code">${item.code}</span>
                <span class="watchlist-name">${item.name || '讀取中...'}</span>
            </div>
            ${canvasHtml}
            <div class="watchlist-price-block">
                <span class="watchlist-price">${priceStr}</span>
                <span class="${rateClass}">${rateStr}</span>
            </div>
            ${orderBtnHtml}
        `;
        container.appendChild(div);

        // 排序按鈕點擊事件（阻斷冒泡）
        const btnUp = div.querySelector('.watchlist-order-up');
        const btnDown = div.querySelector('.watchlist-order-down');
        if (btnUp) {
            btnUp.addEventListener('click', (e) => {
                e.stopPropagation();
                moveWatchlistItemUp(index);
            });
        }
        if (btnDown) {
            btnDown.addEventListener('click', (e) => {
                e.stopPropagation();
                moveWatchlistItemDown(index);
            });
        }

        // 下單按鈕：不觸發 selectWatchlistItem
        const orderBtn = div.querySelector('.watchlist-order-btn');
        if (orderBtn) {
            orderBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openOrderDrawer(item.code, 'STK', item.close || 0, item.exchange || 'TSE');
            });
        }
        
        // 繪製微型走勢圖 (若有啟用)
        if (state.showSparkline) {
            const canvas = document.getElementById(`spark-${item.code}`);
            drawSparkline(canvas, item.prices, rateVal >= 0);
        }
    });
}

function moveWatchlistItemUp(index) {
    if (index <= 0) return;
    const temp = state.watchlist[index];
    state.watchlist[index] = state.watchlist[index - 1];
    state.watchlist[index - 1] = temp;
    saveWatchlistLocal();
    renderWatchlist();
}

function moveWatchlistItemDown(index) {
    if (index >= state.watchlist.length - 1) return;
    const temp = state.watchlist[index];
    state.watchlist[index] = state.watchlist[index + 1];
    state.watchlist[index + 1] = temp;
    saveWatchlistLocal();
    renderWatchlist();
}

function drawSparkline(canvas, prices, isUp) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth;
    const h = canvas.height = canvas.clientHeight;
    
    ctx.clearRect(0, 0, w, h);
    
    let data = [...prices];
    if (data.length < 5) {
        // 沒有足夠報價時使用水平參考線
        data = [10, 10.1, 9.9, 10.0, 10.2];
        if (!isUp) data = [10, 9.9, 10.1, 9.8, 9.5];
    }
    
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min === 0 ? 1 : max - min;
    
    const scheme = document.documentElement.getAttribute('data-scheme');
    let strokeColor = '#64748b'; // 隱形模式預設灰
    if (scheme === 'slate') {
        strokeColor = isUp ? '#3b82f6' : '#64748b';
    } else if (scheme === 'muted') {
        strokeColor = isUp ? '#e11d48' : '#16a34a';
    } else if (scheme === 'stealth') {
        const theme = document.documentElement.getAttribute('data-theme');
        strokeColor = theme === 'dark' ? '#f8fafc' : '#0f172a';
    }
    
    ctx.beginPath();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    
    data.forEach((p, idx) => {
        const x = (idx / (data.length - 1)) * w;
        const y = h - ((p - min) / range) * (h - 4) - 2;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
}

async function selectWatchlistItem(code) {
    const card = document.getElementById('watchlist-detail-card');
    card.style.opacity = '1';
    card.style.pointerEvents = 'auto';

    document.getElementById('btn-remove-watchlist').style.display = 'block';

    // 若 reference（昨日參考價）尚未快取，從 contracts API 補抓（非阻塞）
    const item = state.watchlist.find(w => w.code === code);
    if (item && !item.reference) {
        fetch(`${API_BASE}/data/contracts/${code}?security_type=STK`)
            .then(r => r.ok ? r.json() : null)
            .then(c => {
                if (c && c.reference) {
                    item.reference = c.reference;
                    // 如果細節視窗仍顯示此股票，即時更新
                    if (document.getElementById('detail-code').textContent === code) {
                        document.getElementById('detail-ref').textContent = c.reference;
                    }
                }
            })
            .catch(() => {});
    }

    // 更新即時行情文字欄位
    updateDetailView(code);

    // 不論哪個 tab，都立即抓取 MA 數值顯示於資料格（非阻塞）
    loadMAStats(code);

    // 依目前選取的 tab 決定渲染哪張圖
    const activeTab = document.querySelector('.detail-tab.active');
    const tabName = activeTab ? activeTab.getAttribute('data-tab') : 'tick';
    if (tabName === 'ma') await renderDetailMAChart(code);
    else await renderDetailTickChart(code);
}

function updateDetailView(code) {
    const item = state.watchlist.find(w => w.code === code);
    if (!item) return;
    
    document.getElementById('detail-code').textContent = item.code;
    document.getElementById('detail-name').textContent = item.name || '自選股';
    document.getElementById('detail-ref').textContent = item.reference || '--';
    document.getElementById('detail-open').textContent = item.open || '--';
    document.getElementById('detail-high').textContent = item.high || '--';
    document.getElementById('detail-low').textContent = item.low || '--';
    
    const closeEl = document.getElementById('detail-close');
    closeEl.textContent = item.close || '--';
    const rateVal = item.change_rate || 0;
    closeEl.className = rateVal > 0 ? 'val-up' : (rateVal < 0 ? 'val-down' : '');
    
    document.getElementById('detail-volume').textContent = item.total_volume || '--';
    
    // 設定移除自選股按鈕功能
    document.getElementById('btn-remove-watchlist').onclick = () => {
        state.watchlist = state.watchlist.filter(w => w.code !== code);
        saveWatchlistLocal();
        renderWatchlist();
        
        // 重設自選明細卡片
        document.getElementById('detail-code').textContent = '----';
        document.getElementById('detail-name').textContent = '請從自選清單點選股票以載入即時 Ticks 圖表';
        document.getElementById('detail-ref').textContent = '--';
        document.getElementById('detail-open').textContent = '--';
        document.getElementById('detail-high').textContent = '--';
        document.getElementById('detail-low').textContent = '--';
        document.getElementById('detail-close').textContent = '--';
        document.getElementById('detail-close').className = '';
        document.getElementById('detail-volume').textContent = '--';
        ['detail-ma5','detail-ma20','detail-ma60','detail-ma240'].forEach(id => {
            document.getElementById(id).textContent = '--';
        });
        document.getElementById('btn-remove-watchlist').style.display = 'none';
        
        const canvas = document.getElementById('detail-tick-chart');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        card.style.opacity = '0.5';
        card.style.pointerEvents = 'none';
    };
}

// 共用 kbars 抓取（快取 1 小時，loadMAStats 與 renderDetailMAChart 共用）
async function fetchKbarsWithCache(code) {
    const CACHE_MS = 60 * 60 * 1000; // 1 小時
    const cached = kbarsCache[code];
    if (cached && (Date.now() - cached.fetchedAt < CACHE_MS)) {
        return cached.closes;
    }
    const item = state.watchlist.find(wi => wi.code === code);
    const exchange = item ? (item.exchange || 'TSE') : 'TSE';
    const end = new Date().toISOString().split('T')[0];
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 2);
    const start = startDate.toISOString().split('T')[0];
    const secType = item ? (item.security_type || 'STK') : 'STK';
    const resp = await fetch(`${API_BASE}/data/kbars`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contract: { security_type: secType, exchange, code }, start, end, frequency: '1D' })
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const closes = (data.Close || data.close || []).map(Number);
    kbarsCache[code] = { closes, fetchedAt: Date.now() };
    return closes;
}

// 只更新 MA 數值欄位，不繪製圖表（selectWatchlistItem 一律呼叫）
async function loadMAStats(code) {
    const MA_PERIODS = [5, 20, 60, 240];
    const idMap = { 5: 'detail-ma5', 20: 'detail-ma20', 60: 'detail-ma60', 240: 'detail-ma240' };
    try {
        const closes = await fetchKbarsWithCache(code);
        if (!closes || closes.length < 5) return;
        MA_PERIODS.forEach(period => {
            const el = document.getElementById(idMap[period]);
            if (!el) return;
            if (closes.length < period) { el.textContent = '--'; return; }
            const ma = closes.slice(-period).reduce((a, b) => a + b, 0) / period;
            el.textContent = ma.toFixed(2);
        });
    } catch (e) {
        console.warn('loadMAStats 失敗', e);
    }
}


function drawCanvasLoading(canvas, msg = '載入中...') {
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth;
    const h = canvas.height = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.font = '13px var(--font-sans)';
    ctx.fillStyle = 'var(--text-muted, #64748b)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(msg, w / 2, h / 2);
    return { ctx, w, h };
}

async function renderDetailTickChart(code) {
    const canvas = document.getElementById('detail-tick-chart');
    drawCanvasLoading(canvas);
    const ctx = canvas.getContext('2d');
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    
    const today = new Date().toISOString().split('T')[0];
    
    try {
        const item = state.watchlist.find(w => w.code === code);
        const secType = item ? (item.security_type || 'STK') : 'STK';
        const exchange = item ? (item.exchange || 'TSE') : 'TSE';
        const resp = await fetch(`${API_BASE}/data/ticks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contract: { security_type: secType, exchange, code },
                date: today,
                query_type: 'AllDay'
            })
        });
        
        if (resp.ok) {
            const data = await resp.json();
            const closes = data.close || [];
            if (closes.length === 0) return;
            
            const min = Math.min(...closes);
            const max = Math.max(...closes);
            const range = max - min === 0 ? 1 : max - min;
            
            const theme = document.documentElement.getAttribute('data-theme');
            const scheme = document.documentElement.getAttribute('data-scheme');
            
            let lineColor = '#6366f1';
            if (scheme === 'stealth') {
                lineColor = theme === 'dark' ? '#f8fafc' : '#0f172a';
            }
            
            ctx.clearRect(0, 0, w, h);

            const grad = ctx.createLinearGradient(0, 0, 0, h);
            if (theme === 'dark') {
                grad.addColorStop(0, 'rgba(99, 102, 241, 0.2)');
                grad.addColorStop(1, 'rgba(99, 102, 241, 0)');
            } else {
                grad.addColorStop(0, 'rgba(99, 102, 241, 0.1)');
                grad.addColorStop(1, 'rgba(99, 102, 241, 0)');
            }

            ctx.beginPath();
            closes.forEach((val, idx) => {
                const x = (idx / (closes.length - 1)) * w;
                const y = h - ((val - min) / range) * (h - 20) - 10;
                if (idx === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            
            // 填滿下方陰影區
            ctx.lineTo(w, h);
            ctx.lineTo(0, h);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();
        }
    } catch (e) {
        console.error("獲取即時 Ticks 圖表失敗", e);
    }
}

async function renderDetailMAChart(code) {
    const canvas = document.getElementById('detail-ma-chart');
    const legendEl = document.getElementById('detail-ma-legend');
    drawCanvasLoading(canvas, '正在載入均線資料...');
    legendEl.innerHTML = '';
    const ctx = canvas.getContext('2d');
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    try {
        // 使用快取（與 loadMAStats 共用，避免重複抓 2 年資料）
        const allCloses = await fetchKbarsWithCache(code);
        if (!allCloses) { legendEl.innerHTML = '<span style="color:var(--text-muted);font-size:0.78rem;">無法取得歷史資料</span>'; return; }

        // 重新取得畫布尺寸（fetch 期間可能被重繪過）
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        if (allCloses.length < 5) { legendEl.innerHTML = '<span style="color:var(--text-muted);font-size:0.78rem;">資料不足</span>'; return; }

        // 計算 MA，不足 period 的位置回傳 null
        const calcMA = (arr, period) => arr.map((_, i) =>
            i < period - 1 ? null : arr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period
        );

        const MA_DEFS = [
            { period: 5,   label: '周線 MA5',   color: '#3b82f6' },
            { period: 20,  label: '月線 MA20',  color: '#f59e0b' },
            { period: 60,  label: '季線 MA60',  color: '#10b981' },
            { period: 240, label: '年線 MA240', color: '#e11d48' },
        ];
        const maLines = MA_DEFS.map(d => ({ ...d, values: calcMA(allCloses, d.period) }));

        // 顯示最近 1 年 (~252 個交易日)
        const displayN = Math.min(allCloses.length, 252);
        const offset = allCloses.length - displayN;
        const closes = allCloses.slice(offset);
        const mas = maLines.map(ma => ({ ...ma, values: ma.values.slice(offset) }));

        // Y 軸範圍
        const allVals = [
            ...closes,
            ...mas.flatMap(ma => ma.values.filter(v => v !== null))
        ];
        const minY = Math.min(...allVals) * 0.997;
        const maxY = Math.max(...allVals) * 1.003;
        const rangeY = maxY - minY || 1;

        const toX = i => (i / (displayN - 1)) * (w - 10) + 5;
        const toY = v => h - 20 - ((v - minY) / rangeY) * (h - 28);

        const theme = document.documentElement.getAttribute('data-theme');

        // 收盤價細線（底層，灰色）
        ctx.beginPath();
        ctx.strokeStyle = theme === 'dark' ? 'rgba(148,163,184,0.35)' : 'rgba(100,116,139,0.35)';
        ctx.lineWidth = 1;
        closes.forEach((v, i) => { if (i === 0) ctx.moveTo(toX(i), toY(v)); else ctx.lineTo(toX(i), toY(v)); });
        ctx.stroke();

        // 四條 MA 線
        mas.forEach(ma => {
            ctx.beginPath();
            ctx.strokeStyle = ma.color;
            ctx.lineWidth = 1.6;
            let started = false;
            ma.values.forEach((v, i) => {
                if (v === null) { started = false; return; }
                if (!started) { ctx.moveTo(toX(i), toY(v)); started = true; }
                else ctx.lineTo(toX(i), toY(v));
            });
            ctx.stroke();
        });

        // 最高/最低標籤
        ctx.font = '10px var(--font-mono)';
        ctx.fillStyle = theme === 'dark' ? 'rgba(148,163,184,0.7)' : 'rgba(100,116,139,0.8)';
        ctx.textAlign = 'right';
        ctx.fillText(`高 ${Math.max(...closes).toFixed(2)}`, w - 5, 14);
        ctx.fillText(`低 ${Math.min(...closes).toFixed(2)}`, w - 5, h - 6);

        // 圖例
        legendEl.innerHTML = MA_DEFS.map(d =>
            `<span style="color:${d.color};font-size:0.72rem;font-family:var(--font-mono);">─ ${d.label}</span>`
        ).join('');

        // 填入最新 MA 數值到資料格
        const maIdMap = { 5: 'detail-ma5', 20: 'detail-ma20', 60: 'detail-ma60', 240: 'detail-ma240' };
        mas.forEach(ma => {
            const el = document.getElementById(maIdMap[ma.period]);
            if (!el) return;
            const latest = [...ma.values].reverse().find(v => v !== null);
            el.textContent = latest !== undefined ? latest.toFixed(2) : '--';
        });

    } catch (e) {
        console.error('獲取均線資料失敗', e);
        legendEl.innerHTML = '<span style="color:var(--text-muted);font-size:0.78rem;">載入失敗</span>';
    }
}

// ── 系統設定（Config Update）隱藏下單抽屜 ──────────────────────────────
async function initDrawerControls() {
    const overlay = document.getElementById('drawer-overlay');
    const drawer = document.getElementById('order-drawer');
    const lock = document.getElementById('drawer-lock-overlay');
    const confirmOverlay = document.getElementById('confirm-modal-overlay');
    
    const closeDrawer = () => {
        overlay.classList.remove('active');
        drawer.classList.remove('active');
        confirmOverlay.classList.remove('active');
    };
    
    document.getElementById('btn-close-drawer').onclick = closeDrawer;
    document.getElementById('btn-drawer-cancel').onclick = closeDrawer;
    overlay.onclick = closeDrawer;
    
    // 安全鎖按鈕點擊解鎖
    document.getElementById('btn-unlock-drawer').onclick = () => {
        lock.classList.remove('active');
    };

    // 取消確認彈窗
    document.getElementById('btn-confirm-cancel').onclick = () => {
        confirmOverlay.classList.remove('active');
    };
    
    // 確認下單按鈕點擊處理 (開啟自訂彈出視窗)
    document.getElementById('btn-drawer-submit').onclick = () => {
        const code = document.getElementById('order-code').value;
        const action = document.getElementById('order-action').value;
        const lotType = document.getElementById('order-lot').value;
        const condType = document.getElementById('order-cond').value;
        const priceType = document.getElementById('order-price-type').value;
        const priceInput = document.getElementById('order-price').value;
        const qtyInput = document.getElementById('order-qty').value;
        
        if (!priceInput || isNaN(priceInput)) {
            alert("請輸入有效的委託價格。");
            return;
        }
        if (!qtyInput || isNaN(qtyInput) || parseInt(qtyInput) <= 0) {
            alert("請輸入有效的委託數量。");
            return;
        }
        
        const price = parseFloat(priceInput);
        const qty = parseInt(qtyInput);
        
        const orderLotText = lotType === 'Common' ? '整張 (以張為單位，1張=1000股)' : '零股 (以股為單位)';
        const orderCondText = condType === 'Standard' ? '現股交易' : (condType === 'Margin' ? '融資交易' : '融券交易');
        const actionText = action === 'Buy' ? '買進' : '賣出';
        
        // 灌入 Modal 確認資料
        document.getElementById('conf-code').textContent = code;
        document.getElementById('conf-action').textContent = actionText;
        document.getElementById('conf-action').className = action === 'Buy' ? 'confirm-value val-up' : 'confirm-value val-down';
        document.getElementById('conf-lot').textContent = orderLotText;
        document.getElementById('conf-cond').textContent = orderCondText;
        document.getElementById('conf-price-type').textContent = priceType === 'LMT' ? '限價 (LMT)' : '市價 (MKT)';
        document.getElementById('conf-price').textContent = `${price.toFixed(2)} 元`;
        document.getElementById('conf-qty').textContent = `${qty} ${lotType === 'Common' ? '張' : '股'}`;
        
        // 顯示 Modal 遮罩與本體
        confirmOverlay.classList.add('active');
    };

    // Modal 確認送出按鈕點擊處理
    document.getElementById('btn-confirm-submit').onclick = async () => {
        confirmOverlay.classList.remove('active');
        
        const code = document.getElementById('order-code').value;
        const action = document.getElementById('order-action').value;
        const lotType = document.getElementById('order-lot').value;
        const condType = document.getElementById('order-cond').value;
        const priceType = document.getElementById('order-price-type').value;
        const price = parseFloat(document.getElementById('order-price').value);
        const qty = parseInt(document.getElementById('order-qty').value);
        
        if (!state.selectedAccount) {
            alert("目前沒有啟動中的登入會話。");
            return;
        }
        
        const stockAcc = state.accounts.find(a => a.account_type === 'S');
        const orderCond = condType === 'Standard' ? 'Cash' : condType;
        
        const payload = {
            contract: {
                security_type: 'STK',
                exchange: state.drawerExchange,
                code: code
            },
            stock_order: {
                action: action,
                price: price,
                quantity: qty,
                price_type: priceType,
                order_type: 'ROD',
                order_lot: lotType,
                order_cond: orderCond,
                account: {
                    broker_id: stockAcc.broker_id,
                    account_id: stockAcc.account_id,
                    person_id: stockAcc.person_id
                }
            }
        };
        
        try {
            console.log("正在發送委託要求", payload);
            const resp = await fetch(`${API_BASE}/order/place_order`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (resp.ok) {
                const res = await resp.json();
                closeDrawer();
                
                // 彈出中文化日誌通知
                showToastNotification(`委託單 #${res.order?.id || '建立'} 已成功送出，正在等待交易所成交回報...`);
                
                // 延遲 1 秒後刷新數據
                setTimeout(fetchData, 1000);
            } else {
                const err = await resp.text();
                alert(`委託單發送失敗：${err}`);
            }
        } catch (e) {
            console.error("下單 API 調用失敗", e);
        }
    };
}

function openOrderDrawer(code, type, lastPrice, exchange) {
    if (!state.tradingPermitted) {
        alert("下單權限關閉");
        return;
    }
    if (type !== 'STK') {
        alert("目前介面暫不支援期貨線上委託交易。");
        return;
    }

    state.drawerExchange = exchange || 'TSE';

    // 初始化安全鎖
    document.getElementById('drawer-lock-overlay').classList.add('active');
    
    // 設定預設帶入的值
    document.getElementById('order-code').value = code;
    document.getElementById('order-price').value = lastPrice ? lastPrice.toFixed(2) : '';
    document.getElementById('order-qty').value = '1';
    document.getElementById('order-lot').value = 'Common';
    
    // 開啟抽屜滑出
    document.getElementById('drawer-overlay').classList.add('active');
    document.getElementById('order-drawer').classList.add('active');
}

function showToastNotification(msg) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    
    const time = new Date().toLocaleTimeString();
    toast.innerHTML = `
        <div class="toast-header">
            <span>[系統訊息] 委託日誌</span>
            <span class="toast-time">${time}</span>
        </div>
        <div style="margin-top: 4px; color: var(--text-secondary);">${msg}</div>
    `;
    
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// ── 財產總額歷史追蹤 ──────────────────────────────────────────────────────
async function loadAssetHistory() {
    try {
        const resp = await fetch(`${LOCAL_API_BASE}/asset-history`);
        if (resp.ok) {
            state.assetHistory = await resp.json();
            renderAssetChart();
        }
    } catch (e) {
        console.error("載入資產歷史紀錄失敗", e);
    }
}

async function saveDailyAssetTotal() {
    // 阻擋尚未連線 API 的空資料寫入
    if (state.balance === 0 && state.stockPositions.length === 0) return;
    
    // 計算證券持股總市值
    // unit=Share：quantity 已是總股數（含零股），直接乘均價
    // unit=Lot：quantity 為張數，需 ×lotMultiplier 換算為股
    let totalStockMarketVal = 0;
    state.stockPositions.forEach(p => {
        const shares = state.stockPositionUnit === 'Share'
            ? p.quantity
            : p.quantity * lotMultiplier(p);
        const cost = shares * p.price;
        totalStockMarketVal += cost + (p.pnl || 0); // 成本 + 損益 = 當前市值
    });
    
    const futuresBalance = state.margin ? state.margin.today_balance : 0;
    const totalAssets = state.balance + totalStockMarketVal + futuresBalance;
    
    const today = new Date().toISOString().split('T')[0];

    // 每次都更新即時顯示
    document.getElementById('trend-summary').textContent = `資產加總: ${formatCurrency(totalAssets)} TWD`;

    // 每天只寫入 JSON 一次，避免每 15 秒重複覆寫
    if (localStorage.getItem('lastSavedDate') === today) return;
    
    try {
        const resp = await fetch(`${LOCAL_API_BASE}/asset-history`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: today, value: totalAssets })
        });
        if (resp.ok) {
            const updated = await resp.json();
            state.assetHistory = updated;
            localStorage.setItem('lastSavedDate', today);

            if (state.activeView === 'dashboard') {
                renderAssetChart();
            }
        }
    } catch (e) {
        console.warn("自動寫入每日資產紀錄失敗", e);
    }
}

function renderAssetChart() {
    const canvas = document.getElementById('trend-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth;
    const h = canvas.height = canvas.clientHeight;
    
    ctx.clearRect(0, 0, w, h);
    
    let sortedHistory = [...state.assetHistory].sort((a, b) => new Date(a.date) - new Date(b.date));
    
    if (sortedHistory.length === 0) {
        ctx.fillStyle = '#64748b';
        ctx.font = '14px var(--font-sans)';
        ctx.textAlign = 'center';
        ctx.fillText('目前無歷史數據。每日開盤連線時，收盤後將自動記錄當天資產淨值。', w / 2, h / 2);
        return;
    }
    
    const values = sortedHistory.map(d => d.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min === 0 ? 1 : max - min;
    
    const theme = document.documentElement.getAttribute('data-theme');
    const scheme = document.documentElement.getAttribute('data-scheme');
    
    let strokeColor = '#3b82f6';
    if (scheme === 'stealth') {
        strokeColor = theme === 'dark' ? '#f8fafc' : '#0f172a';
    } else if (scheme === 'muted') {
        strokeColor = '#e11d48';
    }
    
    const len = sortedHistory.length;
    if (len === 1) {
        ctx.fillStyle = 'var(--text-muted)';
        ctx.font = '13px var(--font-sans)';
        ctx.textAlign = 'center';
        ctx.fillText('目前僅有今日首筆數據。您可以至左側「系統設定」手動補錄過去資產，以繪製趨勢折線。', w / 2, h / 2 - 30);
    }
    ctx.beginPath();
    sortedHistory.forEach((item, idx) => {
        const x = len <= 1 ? (w - 80) / 2 + 10 : (idx / (len - 1)) * (w - 80) + 10;
        const y = h - ((item.value - min) / range) * (h - 60) - 40;
        if (idx === 0) {
            ctx.moveTo(x, y);
            if (len === 1) {
                ctx.arc(x, y, 3, 0, 2 * Math.PI);
            }
        } else {
            ctx.lineTo(x, y);
        }
    });
    
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // 繪製網格輔助線
    ctx.strokeStyle = theme === 'dark' ? 'rgba(51, 65, 85, 0.4)' : 'rgba(226, 232, 240, 0.6)';
    ctx.lineWidth = 1;
    ctx.font = '10px var(--font-mono)';
    ctx.fillStyle = 'var(--text-muted)';
    ctx.textAlign = 'right';
    
    ctx.beginPath();
    ctx.moveTo(10, h - 40);
    ctx.lineTo(w - 10, h - 40);
    ctx.moveTo(10, 20);
    ctx.lineTo(w - 10, 20);
    ctx.stroke();
    
    ctx.fillText(`最高: ${formatCurrency(max)}`, w - 10, 15);
    ctx.fillText(`最低: ${formatCurrency(min)}`, w - 10, h - 25);
    
    // 繪製日期座標軸
    ctx.textAlign = 'center';
    const numLabels = Math.min(len, 5);
    for (let i = 0; i < numLabels; i++) {
        const idx = len <= 1 ? 0 : Math.floor((i / (numLabels - 1)) * (len - 1));
        const item = sortedHistory[idx];
        if (item) {
            const x = len <= 1 ? (w - 80) / 2 + 10 : (idx / (len - 1)) * (w - 80) + 10;
            ctx.fillText(item.date, x, h - 5);
        }
    }
}

// ── 手動歷史補錄 ────────────────────────────────────────────────────────
function initHistoryControls() {
    document.getElementById('btn-save-history').onclick = async () => {
        const dateInput = document.getElementById('history-date-input').value;
        const valInput = document.getElementById('history-val-input').value;
        
        if (!dateInput) {
            alert("請選擇有效的日期。");
            return;
        }
        if (!valInput || isNaN(valInput) || parseFloat(valInput) < 0) {
            alert("請輸入正確的資產總值。");
            return;
        }
        
        try {
            const resp = await fetch(`${LOCAL_API_BASE}/asset-history`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: dateInput, value: parseFloat(valInput) })
            });
            if (resp.ok) {
                state.assetHistory = await resp.json();
                renderHistoryTable();
                
                // 清空輸入框
                document.getElementById('history-date-input').value = '';
                document.getElementById('history-val-input').value = '';
            }
        } catch (e) {
            console.error("手動記錄歷史資產失敗", e);
        }
    };
}

function renderHistoryTable() {
    const tbody = document.querySelector('#history-backfill-table tbody');
    tbody.innerHTML = '';
    
    let sortedHistory = [...state.assetHistory].sort((a, b) => new Date(b.date) - new Date(a.date)); // 遞減排序
    
    if (sortedHistory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">無歷史補錄紀錄。</td></tr>';
        return;
    }
    
    sortedHistory.forEach(item => {
        const tr = document.createElement('tr');
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-icon';
        deleteBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        `;
        deleteBtn.onclick = async () => {
            if (!confirm(`確定要刪除 ${item.date} 的歷史資產紀錄嗎？`)) return;
            
            try {
                const resp = await fetch(`${LOCAL_API_BASE}/asset-history/${item.date}`, {
                    method: 'DELETE'
                });
                if (resp.ok) {
                    state.assetHistory = await resp.json();
                    renderHistoryTable();
                }
            } catch (e) {
                console.error("刪除歷史資產紀錄失敗", e);
            }
        };
        
        tr.innerHTML = `
            <td class="mono">${item.date}</td>
            <td class="mono">${formatCurrency(item.value)} TWD</td>
            <td id="actions-${item.date}"></td>
        `;
        tbody.appendChild(tr);
        document.getElementById(`actions-${item.date}`).appendChild(deleteBtn);
    });
}

// ── 閒置逾時機制 ────────────────────────────────────────────────────────
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 分鐘

function initIdleTimeout() {
    const overlay = document.getElementById('idle-modal-overlay');
    const countdownEl = document.getElementById('idle-countdown-text');
    const countdownWrap = document.getElementById('idle-countdown');
    let deadlineTs = Date.now() + IDLE_TIMEOUT_MS;
    let countdownTimer = null;

    function updateCountdown() {
        const remaining = Math.max(0, deadlineTs - Date.now());
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        countdownEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        // 剩 5 分鐘以下變黃色警示
        if (remaining <= 5 * 60 * 1000) {
            countdownWrap.classList.add('idle-warning');
        } else {
            countdownWrap.classList.remove('idle-warning');
        }
    }

    function startCountdownDisplay() {
        clearInterval(countdownTimer);
        countdownTimer = setInterval(updateCountdown, 1000);
        updateCountdown();
    }

    function handleIdleTimeout() {
        clearInterval(countdownTimer);
        stopPolling();
        closeSSE();
        overlay.style.display = 'flex';
    }

    function resetIdleTimer() {
        clearTimeout(state.idleTimer);
        deadlineTs = Date.now() + IDLE_TIMEOUT_MS;
        state.idleTimer = setTimeout(handleIdleTimeout, IDLE_TIMEOUT_MS);
    }

    // 監聽使用者任何互動即重置計時器（節流：每秒最多重置一次）
    let throttled = false;
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(evt => {
        document.addEventListener(evt, () => {
            if (throttled) return;
            throttled = true;
            setTimeout(() => { throttled = false; }, 1000);
            resetIdleTimer();
        }, { passive: true });
    });

    // 重新整理頁面按鈕
    document.getElementById('btn-idle-reconnect').addEventListener('click', () => {
        location.reload();
    });

    // 啟動計時與倒數顯示
    resetIdleTimer();
    startCountdownDisplay();
}

// ── 快速下單輸入框 ────────────────────────────────────────────────────────
function initQuickOrder() {
    const input = document.getElementById('quick-order-input');
    const btn = document.getElementById('btn-quick-order');
    if (!input || !btn) return; // 防止舊版快取 HTML 缺少元素時崩潰

    const doQuickOrder = async () => {
        const code = input.value.trim().toUpperCase();
        if (!code) return;

        // 1. 查自選股快取
        const wItem = state.watchlist.find(w => w.code === code);
        if (wItem) {
            openOrderDrawer(code, 'STK', wItem.close || 0, wItem.exchange || 'TSE');
            input.value = '';
            return;
        }

        // 2. 查持倉快取
        const pos = state.stockPositions.find(p => p.code === code);
        if (pos) {
            openOrderDrawer(code, 'STK', pos.last_price || 0, pos.exchange || 'TSE');
            input.value = '';
            return;
        }

        // 3. 打 contracts API
        try {
            const resp = await fetch(`${API_BASE}/data/contracts/${code}?security_type=STK`);
            if (resp.ok) {
                const contract = await resp.json();
                openOrderDrawer(contract.code, 'STK', contract.reference || 0, contract.exchange || 'TSE');
                input.value = '';
            } else {
                alert(`找不到股票代號 ${code}`);
            }
        } catch (e) {
            console.error('快速下單查詢失敗', e);
        }
    };

    btn.addEventListener('click', doQuickOrder);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doQuickOrder(); });
}

// ── 持倉名稱補查 ─────────────────────────────────────────────────────────
// API 在 unit=Share 模式下回傳的 position 可能無 name 欄位
// 先查 watchlist 快取，再打 contracts API 補齊
async function enrichPositionNames() {
    const nameless = state.stockPositions.filter(p => !p.name);
    if (nameless.length === 0) return;

    await Promise.all(nameless.map(async pos => {
        // 先查自選股快取
        const cached = state.watchlist.find(w => w.code === pos.code);
        if (cached && cached.name) {
            pos.name = cached.name;
            return;
        }
        // 再打 contracts API
        try {
            const resp = await fetch(`${API_BASE}/data/contracts/${pos.code}?security_type=STK`);
            if (resp.ok) {
                const contract = await resp.json();
                pos.name = contract.name || pos.code;
                // 順便寫回 exchange（下單時用到）
                if (contract.exchange) pos.exchange = contract.exchange;
            }
        } catch (e) {
            console.warn(`無法查詢 ${pos.code} 名稱`, e);
        }
    }));
}

// ── 格式化小工具 ────────────────────────────────────────────────────────

// 判斷持倉是否為零股（Shioaji 零股 order_lot 值為 IntradayOdd / Odd / BulkOdd）
const ODD_LOT_TYPES = new Set(['IntradayOdd', 'Odd', 'BulkOdd']);
function isOddLot(pos) {
    return ODD_LOT_TYPES.has(pos.order_lot);
}
// 整張 quantity 單位為張（×1000 換成股），零股單位本身就是股
function lotMultiplier(pos) {
    return isOddLot(pos) ? 1 : 1000;
}

function formatCurrency(val) {
    if (val === null || val === undefined) return '--';
    return Number(val).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
