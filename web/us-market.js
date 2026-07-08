// us-market.js — 美股自選監控（v1.10.0 自 app.js 拆出；普通 script，與 app.js 共用全域）
// 依賴：app.js 的 state/LOCAL_API_BASE/格式化工具、demo.js 的 smartFetch（皆為執行期呼叫）

// ── 美股自選監控（Yahoo Finance 經 dashboard.py 代理）────────────────────
// 資料路徑：前端 → /api/us-chart（代碼格式驗證 + 後端快取）→ Yahoo Finance
const US_DEFAULT_ITEMS = [
    { symbol: '^GSPC', name: 'S&P 500 指數' },
    { symbol: 'VOO',   name: 'Vanguard S&P 500 ETF' },
];
const US_WATCHLIST_MAX = 20;     // 自選上限，避免輪詢量失控
const US_REFRESH_MS = 60 * 1000; // 與後端盤中快取 TTL (60s) 對齊
const usState = {
    watchlist: loadUsWatchlistLocal(), // [{symbol, name}]，存於 localStorage
    quotes: {},     // symbol -> 最新盤中 payload (1d/5m)
    daily: {},      // symbol -> { closes, fetchedAt }，2y 日線快取 30 分鐘
    selected: null, // 目前明細面板顯示的 symbol
    timer: null,    // 輪詢計時器（僅美股分頁啟用）
};

function loadUsWatchlistLocal() {
    try {
        const raw = JSON.parse(localStorage.getItem('usWatchlist'));
        // 僅在 key 不存在/格式錯誤時帶入預設；使用者清空清單應維持空清單
        if (Array.isArray(raw)) {
            return raw.filter(i => i && typeof i.symbol === 'string')
                      .map(i => ({ symbol: i.symbol, name: i.name || i.symbol }));
        }
    } catch (e) { /* 格式錯誤視同未設定 */ }
    return [...US_DEFAULT_ITEMS];
}

function saveUsWatchlistLocal() {
    localStorage.setItem('usWatchlist', JSON.stringify(usState.watchlist));
}

function initUsMarket() {
    renderUsList();

    // 新增自選：按鈕 + Enter
    const addBtn = document.getElementById('btn-add-us');
    const input = document.getElementById('us-search-input');
    if (addBtn && input) {
        addBtn.addEventListener('click', addUsWatchlistItem);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addUsWatchlistItem();
        });
    }

    // 美股明細分時 / 均線 tab 切換（獨立於台股自選的 tab）
    document.querySelectorAll('#us-chart-tabs .detail-tab').forEach(tab => {
        tab.addEventListener('click', async () => {
            document.querySelectorAll('#us-chart-tabs .detail-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabName = tab.getAttribute('data-tab');
            document.getElementById('us-tick-panel').style.display = tabName === 'tick' ? '' : 'none';
            document.getElementById('us-ma-panel').style.display   = tabName === 'ma'   ? '' : 'none';
            if (usState.selected) {
                if (tabName === 'tick') renderUsTickChart(usState.selected);
                else await renderUsMAChart(usState.selected);
            }
        });
    });

    // 綁定美股手動更新按鈕
    const refreshUsBtn = document.getElementById('btn-refresh-us');
    if (refreshUsBtn) {
        refreshUsBtn.addEventListener('click', () => {
            handleRefreshAction('btn-refresh-us', async () => {
                await updateUsQuotes();
            });
        });
    }

    const refreshUsDetailBtn = document.getElementById('btn-refresh-us-detail');
    if (refreshUsDetailBtn) {
        refreshUsDetailBtn.addEventListener('click', () => {
            handleRefreshAction('btn-refresh-us-detail', async () => {
                if (usState.selected) {
                    await updateUsQuotes();
                    const activeTab = document.querySelector('#us-chart-tabs .detail-tab.active');
                    const tabName = activeTab ? activeTab.getAttribute('data-tab') : 'tick';
                    if (tabName === 'ma') {
                        await renderUsMAChart(usState.selected);
                    } else {
                        renderUsTickChart(usState.selected);
                    }
                }
            });
        });
    }
}

function startUsMarket() {
    updateUsQuotes();
    if (!usState.timer) usState.timer = setInterval(updateUsQuotes, US_REFRESH_MS);
}

function stopUsMarket() {
    if (usState.timer) {
        clearInterval(usState.timer);
        usState.timer = null;
    }
}

async function fetchUsChart(symbol, range, interval) {
    const url = `${LOCAL_API_BASE}/us-chart?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`;
    const resp = await smartFetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
}

// 顯示短暫狀態訊息（新增成功/失敗回饋）
function setUsStatusMessage(msg, isError = false) {
    const statusEl = document.getElementById('us-market-status');
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isError ? 'var(--color-down, #ef4444)' : '';
    if (isError) {
        setTimeout(() => { statusEl.style.color = ''; }, 4000);
    }
}

async function addUsWatchlistItem() {
    const input = document.getElementById('us-search-input');
    if (!input) return;
    const symbol = input.value.trim().toUpperCase();
    if (!symbol) return;
    if (usState.watchlist.some(i => i.symbol === symbol)) {
        setUsStatusMessage(`${symbol} 已在監控清單中`, true);
        return;
    }
    if (usState.watchlist.length >= US_WATCHLIST_MAX) {
        setUsStatusMessage(`自選清單已達上限 ${US_WATCHLIST_MAX} 檔`, true);
        return;
    }
    setUsStatusMessage(`正在查詢 ${symbol}...`);
    try {
        const q = await fetchUsChart(symbol, '1d', '5m');
        usState.quotes[symbol] = q;
        usState.watchlist.push({ symbol, name: q.name || symbol });
        saveUsWatchlistLocal();
        renderUsList();
        input.value = '';
        setUsStatusMessage(`已加入 ${symbol} (${q.name || symbol})`);
    } catch (e) {
        setUsStatusMessage(`查無商品代碼 ${symbol}，請確認後重試`, true);
        console.warn(`[美股] 新增 ${symbol} 失敗:`, e);
    }
}

function moveUsItemUp(index) {
    if (index <= 0) return;
    const temp = usState.watchlist[index];
    usState.watchlist[index] = usState.watchlist[index - 1];
    usState.watchlist[index - 1] = temp;
    saveUsWatchlistLocal();
    renderUsList();
}

function moveUsItemDown(index) {
    if (index >= usState.watchlist.length - 1) return;
    const temp = usState.watchlist[index];
    usState.watchlist[index] = usState.watchlist[index + 1];
    usState.watchlist[index + 1] = temp;
    saveUsWatchlistLocal();
    renderUsList();
}

function removeUsItem(symbol) {
    usState.watchlist = usState.watchlist.filter(i => i.symbol !== symbol);
    delete usState.quotes[symbol];
    delete usState.daily[symbol];
    saveUsWatchlistLocal();
    renderUsList();
    if (usState.selected === symbol) resetUsDetailCard();
}

function resetUsDetailCard() {
    usState.selected = null;
    document.getElementById('us-detail-code').textContent = '----';
    document.getElementById('us-detail-name').textContent = '請從左側清單點選商品以載入走勢圖';
    ['us-detail-ref', 'us-detail-open', 'us-detail-high', 'us-detail-low',
     'us-detail-volume', 'us-detail-ma5', 'us-detail-ma20', 'us-detail-ma60', 'us-detail-ma240'
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '--';
    });
    const closeEl = document.getElementById('us-detail-close');
    closeEl.textContent = '--';
    closeEl.className = '';
    document.getElementById('btn-remove-us').style.display = 'none';

    const canvas = document.getElementById('us-tick-chart');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const card = document.getElementById('us-detail-card');
    card.style.opacity = '0.5';
    card.style.pointerEvents = 'none';
}

async function updateUsQuotes() {
    for (const item of usState.watchlist) {
        try {
            usState.quotes[item.symbol] = await fetchUsChart(item.symbol, '1d', '5m');
        } catch (e) {
            console.warn(`[美股] ${item.symbol} 行情更新失敗:`, e);
        }
    }
    renderUsList();

    const statusEl = document.getElementById('us-market-status');
    if (statusEl) {
        const t = new Date().toLocaleTimeString('zh-TW', { hour12: false });
        statusEl.textContent = `行情來源: Yahoo Finance (延遲約 15 分鐘)・更新 ${t}`;
    }

    // 明細面板若開啟中，同步更新欄位與分時圖
    if (usState.selected) {
        updateUsDetailFields(usState.selected);
        const activeTab = document.querySelector('#us-chart-tabs .detail-tab.active');
        if (!activeTab || activeTab.getAttribute('data-tab') === 'tick') {
            renderUsTickChart(usState.selected);
        }
    }
}

function renderUsList() {
    const container = document.getElementById('us-list');
    if (!container) return;
    container.innerHTML = '';

    if (usState.watchlist.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 12px;">自選清單目前無監控商品。</div>';
        return;
    }

    usState.watchlist.forEach((item, index) => {
        const q = usState.quotes[item.symbol];
        const div = document.createElement('div');
        // 與台股一致：指數套淡灰底專屬樣式，股票/ETF 用一般樣式
        // Yahoo 指數代碼以 ^ 開頭；行情載入後改以 instrumentType 為準
        const isIndex = (q && q.instrument_type)
            ? q.instrument_type === 'INDEX'
            : item.symbol.startsWith('^');
        div.className = isIndex ? 'watchlist-item watchlist-item-index' : 'watchlist-item';
        div.onclick = () => selectUsItem(item.symbol);

        const priceStr = q && q.price != null ? formatDecimal(q.price, 2) : '--';
        const chg = q && q.change != null ? q.change : 0;
        const ratePctStr = q && q.change_rate != null ? `${q.change_rate >= 0 ? '+' : ''}${formatDecimal(q.change_rate, 2)}%` : '--';
        // 與台股一致：指數與個股統一顯示「漲跌點數 (漲跌百分比)」雙格式
        const diffStr = q && q.change != null ? `${chg >= 0 ? '+' : ''}${formatDecimal(chg, 2)}` : '--';
        const rateStr = `${diffStr} (${ratePctStr})`;
        const rateClass = chg > 0 ? 'badge-up' : (chg < 0 ? 'badge-down' : 'metric-subtitle');

        const upDisabled = index === 0 ? 'disabled style="visibility:hidden;"' : '';
        const downDisabled = index === usState.watchlist.length - 1 ? 'disabled style="visibility:hidden;"' : '';

        div.innerHTML = `
            <div class="watchlist-order-actions">
                <button class="watchlist-order-up" ${upDisabled} title="上移">▲</button>
                <button class="watchlist-order-down" ${downDisabled} title="下移">▼</button>
            </div>
            <div class="watchlist-info">
                <span class="watchlist-code">${item.symbol}</span>
                <span class="watchlist-name">${item.name}</span>
            </div>
            <div class="watchlist-price-block">
                <span class="watchlist-price">${priceStr}</span>
                <span class="${rateClass}">${rateStr}</span>
            </div>
            <div class="watchlist-order-btn-placeholder"></div>
        `;
        container.appendChild(div);

        // 排序按鈕（阻斷冒泡，避免觸發明細開啟）
        const btnUp = div.querySelector('.watchlist-order-up');
        const btnDown = div.querySelector('.watchlist-order-down');
        if (btnUp) {
            btnUp.addEventListener('click', (e) => {
                e.stopPropagation();
                moveUsItemUp(index);
            });
        }
        if (btnDown) {
            btnDown.addEventListener('click', (e) => {
                e.stopPropagation();
                moveUsItemDown(index);
            });
        }
    });
}

async function selectUsItem(symbol) {
    usState.selected = symbol;
    const card = document.getElementById('us-detail-card');
    card.style.opacity = '1';
    card.style.pointerEvents = 'auto';

    updateUsDetailFields(symbol);
    loadUsMAStats(symbol); // 非阻塞補 MA 數值格

    const activeTab = document.querySelector('#us-chart-tabs .detail-tab.active');
    const tabName = activeTab ? activeTab.getAttribute('data-tab') : 'tick';
    if (tabName === 'ma') await renderUsMAChart(symbol);
    else renderUsTickChart(symbol);
}

function updateUsDetailFields(symbol) {
    const q = usState.quotes[symbol];
    if (!q) return;
    const item = usState.watchlist.find(i => i.symbol === symbol);

    document.getElementById('us-detail-code').textContent = symbol;
    document.getElementById('us-detail-name').textContent = (item && item.name) || q.name || symbol;

    // 移除自選按鈕
    const removeBtn = document.getElementById('btn-remove-us');
    removeBtn.style.display = 'block';
    removeBtn.onclick = () => removeUsItem(symbol);
    document.getElementById('us-detail-ref').textContent = formatDecimal(q.prev_close, 2);

    const opens = (q.open || []).filter(v => v != null);
    const highs = (q.high || []).filter(v => v != null);
    const lows  = (q.low  || []).filter(v => v != null);
    document.getElementById('us-detail-open').textContent = opens.length ? formatDecimal(opens[0], 2) : '--';
    document.getElementById('us-detail-high').textContent = highs.length ? formatDecimal(Math.max(...highs), 2) : '--';
    document.getElementById('us-detail-low').textContent  = lows.length  ? formatDecimal(Math.min(...lows), 2)  : '--';

    const closeEl = document.getElementById('us-detail-close');
    closeEl.textContent = formatDecimal(q.price, 2);
    const rateVal = q.change_rate || 0;
    closeEl.className = rateVal > 0 ? 'val-up' : (rateVal < 0 ? 'val-down' : '');

    // 指數 (^GSPC) 的 volume 多為 0/null，ETF (VOO) 為實際成交股數
    const vol = (q.volume || []).reduce((a, b) => a + (b || 0), 0);
    document.getElementById('us-detail-volume').textContent = vol ? vol.toLocaleString('en-US') : '--';
}

// 2 年日線收盤價（供 MA 計算，前端快取 30 分鐘，與後端 TTL 對齊）
async function fetchUsDailyCloses(symbol) {
    const CACHE_MS = 30 * 60 * 1000;
    const cached = usState.daily[symbol];
    if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached.closes;
    const data = await fetchUsChart(symbol, '2y', '1d');
    const closes = (data.close || []).map(Number).filter(v => !Number.isNaN(v));
    usState.daily[symbol] = { closes, fetchedAt: Date.now() };
    return closes;
}

async function loadUsMAStats(symbol) {
    const MA_PERIODS = [5, 20, 60, 240];
    const idMap = { 5: 'us-detail-ma5', 20: 'us-detail-ma20', 60: 'us-detail-ma60', 240: 'us-detail-ma240' };
    try {
        const closes = await fetchUsDailyCloses(symbol);
        if (!closes || closes.length < 5) return;
        MA_PERIODS.forEach(period => {
            const el = document.getElementById(idMap[period]);
            if (!el) return;
            if (closes.length < period) { el.textContent = '--'; return; }
            const ma = closes.slice(-period).reduce((a, b) => a + b, 0) / period;
            el.textContent = formatDecimal(ma, 2);
        });
    } catch (e) {
        console.warn('[美股] loadUsMAStats 失敗', e);
    }
}

// 分時走勢圖（畫法與台股 renderDetailTickChart 一致，但資料來自記憶體中的盤中 payload）
function renderUsTickChart(symbol) {
    const canvas = document.getElementById('us-tick-chart');
    if (!canvas) return;
    if (state.bossKey) { maskCanvas(canvas); return; }

    const q = usState.quotes[symbol];
    const closes = q ? (q.close || []) : [];
    if (closes.length === 0) {
        drawCanvasLoading(canvas, '暫無盤中資料');
        return;
    }

    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth;
    const h = canvas.height = canvas.clientHeight;

    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const range = max - min === 0 ? 1 : max - min;

    const theme = document.documentElement.getAttribute('data-theme');
    const scheme = document.documentElement.getAttribute('data-scheme');

    let lineColor = '#6366f1';
    if (scheme === 'stealth') {
        lineColor = theme === 'dark' ? '#f8fafc' : '#0f172a';
    } else if (scheme === 'matrix') {
        lineColor = '#00ff41';
    }

    ctx.clearRect(0, 0, w, h);

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    if (scheme === 'matrix') {
        grad.addColorStop(0, 'rgba(0, 255, 65, 0.18)');
        grad.addColorStop(1, 'rgba(0, 255, 65, 0)');
    } else if (theme === 'dark') {
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

    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
}

// 均線走勢圖（畫法與台股 renderDetailMAChart 一致，資料來自 Yahoo 2 年日線）
async function renderUsMAChart(symbol) {
    const canvas = document.getElementById('us-ma-chart');
    const legendEl = document.getElementById('us-ma-legend');
    if (!canvas || !legendEl) return;
    if (state.bossKey) { maskCanvas(canvas); legendEl.innerHTML = ''; return; }
    drawCanvasLoading(canvas, '正在載入均線資料...');
    legendEl.innerHTML = '';
    const ctx = canvas.getContext('2d');
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    try {
        const allCloses = await fetchUsDailyCloses(symbol);
        if (!allCloses || allCloses.length === 0) {
            legendEl.innerHTML = '<span style="color:var(--text-muted);font-size:0.78rem;">無法取得歷史資料</span>';
            return;
        }

        // 重新取得畫布尺寸（fetch 期間可能被重繪過）
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        if (allCloses.length < 5) {
            legendEl.innerHTML = '<span style="color:var(--text-muted);font-size:0.78rem;">資料不足</span>';
            return;
        }

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
        const scheme = document.documentElement.getAttribute('data-scheme');

        // 收盤價細線（底層，灰色）
        ctx.beginPath();
        ctx.strokeStyle = theme === 'dark' ? 'rgba(148,163,184,0.35)' : 'rgba(100,116,139,0.35)';
        ctx.lineWidth = 1;
        closes.forEach((v, i) => { if (i === 0) ctx.moveTo(toX(i), toY(v)); else ctx.lineTo(toX(i), toY(v)); });
        ctx.stroke();

        // 四條 MA 線
        mas.forEach(ma => {
            ctx.beginPath();
            
            let lineColor = ma.color;
            if (scheme === 'stealth') {
                if (theme === 'dark') {
                    const grayMap = { 5: '#f8fafc', 20: '#cbd5e1', 60: '#64748b', 240: '#475569' };
                    lineColor = grayMap[ma.period] || '#94a3b8';
                } else {
                    const grayMap = { 5: '#0f172a', 20: '#475569', 60: '#94a3b8', 240: '#cbd5e1' };
                    lineColor = grayMap[ma.period] || '#64748b';
                }
            } else if (scheme === 'matrix') {
                const greenMap = { 5: '#00ff41', 20: '#00cc33', 60: '#009922', 240: '#006611' };
                lineColor = greenMap[ma.period] || '#00ff41';
            }
            
            ctx.strokeStyle = lineColor;
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
        ctx.fillText(`高 ${formatDecimal(Math.max(...closes), 2)}`, w - 5, 14);
        ctx.fillText(`低 ${formatDecimal(Math.min(...closes), 2)}`, w - 5, h - 6);

        // 圖例 (使用 CSS 樣式類別以符合隱形黑白/駭客任務模式)
        legendEl.innerHTML = MA_DEFS.map(d =>
            `<span class="ma-${d.period}" style="font-size:0.72rem;font-family:var(--font-mono);margin-right:12px;">─ ${d.label}</span>`
        ).join('');

        // 填入最新 MA 數值到資料格
        const maIdMap = { 5: 'us-detail-ma5', 20: 'us-detail-ma20', 60: 'us-detail-ma60', 240: 'us-detail-ma240' };
        mas.forEach(ma => {
            const el = document.getElementById(maIdMap[ma.period]);
            if (!el) return;
            const latest = [...ma.values].reverse().find(v => v !== null);
            el.textContent = latest !== undefined && latest !== null ? formatDecimal(latest, 2) : '--';
        });

    } catch (e) {
        console.error('[美股] 獲取均線資料失敗', e);
        legendEl.innerHTML = '<span style="color:var(--text-muted);font-size:0.78rem;">載入失敗</span>';
    }
}

