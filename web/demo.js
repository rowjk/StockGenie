// demo.js — Demo 演示模式假數據 + smartFetch 唯一網路收口（v1.10.0 自 app.js 拆出）
// smartFetch 為全站網路出口，本檔須在其他 script 之後、DOMContentLoaded 之前載入完成

// ── Demo 演示模式 (v1.6.0)：smartFetch 攔截器與高擬真假數據 ─────────────────
// 啟用時，所有對 Shioaji Proxy 與本機帳務端點的請求都在前端以記憶體假數據回應，
// 不發送任何實體 API 請求；可完全離線演示。驗收標準：DevTools Network 零實體請求。

const DEMO_KNOWN_TW = {
    // 指數 / 大盤
    '001': { name: '加權指數', price: 22000.0 },
    'TSE001': { name: '加權指數', price: 22000.0 },
    'OTC101': { name: '櫃買指數', price: 260.0 },
    
    // 大型權值股
    '2330': { name: '台積電', price: 950.0 },
    '2317': { name: '鴻海', price: 180.0 },
    '2454': { name: '聯發科', price: 1310.0 },
    '2603': { name: '長榮', price: 198.5 },
    '2303': { name: '聯電', price: 55.0 },
    '2382': { name: '廣達', price: 280.0 },
    '2301': { name: '光寶科', price: 105.0 },
    '2409': { name: '友達', price: 18.0 },
    '3481': { name: '群創', price: 15.0 },
    '2308': { name: '台達電', price: 380.0 },
    '2324': { name: '仁寶', price: 35.0 },
    '2353': { name: '宏碁', price: 45.0 },
    '2357': { name: '華碩', price: 480.0 },
    '3231': { name: '緯創', price: 110.0 },
    '2337': { name: '旺宏', price: 26.0 },

    // 熱門 ETF / 槓桿型
    '0050': { name: '元大台灣50', price: 205.0 },
    '0056': { name: '元大高股息', price: 38.2 },
    '00878': { name: '國泰永續高股息', price: 22.8 },
    '00919': { name: '群益台灣精選高息', price: 25.5 },
    '00929': { name: '復華台灣科技優息', price: 20.0 },
    '00940': { name: '元大台灣價值高息', price: 9.8 },
    '00713': { name: '元大台灣高息低波', price: 57.5 },
    '006208': { name: '富邦台50', price: 120.0 },
    '00631L': { name: '元大台灣50正2', price: 230.0 },
    '00632R': { name: '元大台灣50反1', price: 3.5 },
    '00679B': { name: '元大美債20年', price: 30.5 },
    '00680L': { name: '元大美債20年正2', price: 9.2 },
    '00715L': { name: '期街口布蘭特正2', price: 14.5 },

    // 金融股
    '2881': { name: '富邦金', price: 92.5 },
    '2882': { name: '國泰金', price: 60.0 },
    '2884': { name: '玉山金', price: 28.5 },
    '2886': { name: '兆豐金', price: 40.0 },
    '2891': { name: '中信金', price: 37.0 },
    '2892': { name: '第一金', price: 28.0 },
    '5880': { name: '合庫金', price: 26.5 },
    
    // 傳產與其他
    '2412': { name: '中華電', price: 126.0 },
    '2002': { name: '中鋼', price: 23.0 },
    '1301': { name: '台塑', price: 60.0 },
    '2609': { name: '陽明', price: 75.0 },
    '2615': { name: '萬海', price: 80.0 },
    '2618': { name: '長榮航', price: 36.0 },
    '2610': { name: '華航', price: 23.0 },
};

const DEMO_KNOWN_US = {
    '^GSPC': { name: 'S&P 500 指數', price: 6105.3, type: 'INDEX' },
    '^IXIC': { name: 'NASDAQ 綜合指數', price: 19987.6, type: 'INDEX' },
    '^DJI':  { name: '道瓊工業指數', price: 44310.2, type: 'INDEX' },
    'VOO':   { name: 'Vanguard S&P 500 ETF', price: 561.2, type: 'ETF' },
    'QQQ':   { name: 'Invesco QQQ Trust', price: 529.8, type: 'ETF' },
    'AAPL':  { name: 'Apple Inc.', price: 236.4, type: 'EQUITY' },
};

// PRD §2.2 初始值；其後隨輪詢以隨機漫步波動
const demoState = {
    balance: 1250300,
    positions: [
        { code: '2330', name: '台積電', avg: 910.0, shares: 2000 },
        { code: '2317', name: '鴻海',   avg: 185.0, shares: 5000 },
        { code: '2454', name: '聯發科', avg: 1280.0, shares: 1000 },
        { code: '2603', name: '長榮',   avg: 190.0, shares: 3000 },
    ],
    quotes: {},        // code -> { ref, last, totalVol }
    usQuotes: {},      // symbol -> { prev, last }
    historyShape: null,
    demoKbars: {},     // code -> Close 陣列
    orderSeq: 1,
    tradeLogs: [],     // v1.7 假委託紀錄（demo 下單成功時 unshift，上限 99）
    pendingOrders: [], // v1.7 假未成交委託（與真實 /order/trades 回傳同構）
    cancelledIds: new Set(), // v1.7.1 已刪單號（模擬成交 timer 據此放棄成交）
    todayRealizedPnl: 0,     // Demo 模式下今日模擬已實現損益累計
    credentials: {
        active_index: 0,
        profiles: [
            {
                name: '演示帳戶 (預設金鑰已加密)',
                api_key: 'DEMO_API_KEY_12345',
                secret_key: 'enc:dpapi:v1:dGVzdF9zZWNyZXRfa2V5',
                ca_cert_path: 'C:\\Sinopac.pfx',
                ca_password: 'enc:dpapi:v1:dGVzdF9jYV9wYXNzd29yZA=='
            }
        ]
    },
};

function mockResponse(data, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => data,
        text: async () => (typeof data === 'string' ? data : (data && data.error) || JSON.stringify(data)),
    };
}

// 以代碼決定基準價：精選股用擬真價，其他代碼以雜湊產生 20~1000 的穩定假價
function demoSeedPrice(code) {
    if (DEMO_KNOWN_TW[code]) return DEMO_KNOWN_TW[code].price;
    let hsum = 0;
    for (const ch of String(code)) hsum = (hsum * 31 + ch.charCodeAt(0)) % 99991;
    return Math.round((20 + (hsum % 9800) / 10) * 100) / 100;
}

function demoName(code) {
    if (DEMO_KNOWN_TW[code]) return DEMO_KNOWN_TW[code].name;
    const pos = demoState.positions.find(p => p.code === code);
    return (pos && pos.name) || `演示股 ${code}`;
}

function demoQuote(code) {
    let q = demoState.quotes[code];
    if (!q) {
        const ref = demoSeedPrice(code);
        q = demoState.quotes[code] = { ref, last: ref, totalVol: 1200 + Math.floor(Math.random() * 8000) };
    }
    return q;
}

// 隨機漫步：每次擾動 ±0.1% ~ ±0.3%（PRD §2.2 第 8 點）
function demoWalk(price) {
    const mag = 0.001 + Math.random() * 0.002;
    const pct = mag * (Math.random() < 0.5 ? -1 : 1);
    return Math.max(1, Math.round(price * (1 + pct) * 100) / 100);
}

// 擾動一檔報價並累加成交量（偏離參考價以 ±9.5% 模擬漲跌停限制）
function demoTickQuote(code) {
    const q = demoQuote(code);
    q.last = demoWalk(q.last);
    const cap = q.ref * 0.095;
    q.last = Math.round(Math.min(q.ref + cap, Math.max(q.ref - cap, q.last)) * 100) / 100;
    q.totalVol += 50 + Math.floor(Math.random() * 450);
    return q;
}

function demoMarketValue() {
    return demoState.positions.reduce((s, p) => s + demoQuote(p.code).last * p.shares, 0);
}

function demoPositions() {
    return demoState.positions.map(p => {
        const q = demoTickQuote(p.code);
        const pnl = Math.round((q.last - p.avg) * p.shares);
        return {
            code: p.code,
            name: p.name,
            direction: 'Buy',
            quantity: p.shares,   // unit=Share 模式：股數
            price: p.avg,
            last_price: q.last,
            pnl,
            pnl_rate: Math.round((q.last - p.avg) / p.avg * 10000) / 100,
            exchange: 'TSE',
        };
    });
}

function demoSettlements() {
    const amounts = [12500, -25000, 80000]; // PRD §2.2 第 4 點
    return amounts.map((amount, t) => {
        const d = new Date();
        d.setDate(d.getDate() + t);
        return { T: t, date: _demoLocalDate(d), amount };
    });
}

function demoProfitLoss() {
    // 近 12 個月合理起伏的已實現損益（每月一筆，月中日期）
    const seeds = [42000, -18000, 65000, 31000, -8500, 92000, 12000, 47000, -26000, 58000, 23000, 76500];
    const now = new Date();
    const out = [];
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 15);
        out.push({ date: _demoLocalDate(d), pnl: seeds[11 - i] });
    }
    return out;
}

// 90 天震盪向上、帶微幅回檔的資產趨勢；終值動態校準 = 假餘額 + 假庫存市值
function demoAssetHistory() {
    const finalVal = Math.round(demoState.balance + demoMarketValue());
    if (!demoState.historyShape) {
        const pts = [];
        let v = 0.62;
        for (let i = 0; i < 90; i++) {
            v += (Math.random() - 0.42) * 0.025;
            if (i === 35 || i === 64) v -= 0.05; // 兩次明顯回檔
            v = Math.max(0.45, Math.min(1.05, v));
            pts.push(v);
        }
        const lastV = pts[pts.length - 1];
        demoState.historyShape = pts.map(x => x / lastV); // 正規化：最後一點 = 1
    }
    const today = new Date();
    return demoState.historyShape.map((shape, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (89 - i));
        return { date: _demoLocalDate(d), value: Math.round(finalVal * shape) };
    });
}

function demoSnapshots(bodyText) {
    let contracts = [];
    try { contracts = (JSON.parse(bodyText || '{}').contracts) || []; } catch (e) { /* 忽略 */ }
    return contracts.map(c => {
        const q = demoTickQuote(c.code);
        const change = Math.round((q.last - q.ref) * 100) / 100;
        return {
            code: c.code,
            name: demoName(c.code),
            close: q.last,
            change_price: change,
            change_rate: Math.round(change / q.ref * 10000) / 100,
            open: Math.round(q.ref * 1.002 * 100) / 100,
            high: Math.round(Math.max(q.last, q.ref * 1.012) * 100) / 100,
            low: Math.round(Math.min(q.last, q.ref * 0.991) * 100) / 100,
            volume: 50 + Math.floor(Math.random() * 450),
            total_volume: q.totalVol,
            yesterday_volume: 15000,
            buy_volume: 10 + Math.floor(Math.random() * 500),
            sell_volume: 10 + Math.floor(Math.random() * 500),
            reference: q.ref,
        };
    });
}

// 分時走勢：09:00–13:30 每 5 分鐘共 54 點，終點貼齊現價
function demoTicks(code) {
    const q = demoQuote(code);
    const n = 54;
    const closes = [];
    let v = q.ref;
    for (let i = 0; i < n; i++) {
        v = demoWalk(v);
        closes.push(v);
    }
    const offset = q.last - closes[n - 1];
    return { close: closes.map(x => Math.round((x + offset) * 100) / 100) };
}

// 日 K 線：250 個交易日收盤價（長期微升），供 MA5/20/60/240 計算
function demoKbars(code) {
    if (!demoState.demoKbars[code]) {
        const q = demoQuote(code);
        const n = 250;
        const arr = new Array(n);
        let v = q.ref;
        for (let i = n - 1; i >= 0; i--) {
            arr[i] = Math.round(v * 100) / 100;
            v = v / (1 + (Math.random() - 0.47) * 0.018);
        }
        demoState.demoKbars[code] = arr;
    }
    return { Close: demoState.demoKbars[code] };
}

function demoAnnouncements() {
    const subjects = [
        '公告本公司董事會決議通過第二季合併財務報告',
        '澄清媒體報導本公司海外擴產進度相關訊息',
        '公告本公司受邀參加法人說明會之相關資訊',
        '公告本公司發言人異動',
        '公告本公司取得機器設備之重大資產交易',
    ];
    const codes = state.watchlist.slice(0, 5);
    const today = new Date();
    return codes.map((w, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        return {
            code: w.code,
            name: demoName(w.code),
            date: _demoLocalDate(d),
            time: `${String(9 + i).padStart(2, '0')}3000`,
            subject: subjects[i % subjects.length],
            clause: '第 51 款',
        };
    });
}

function demoDividends() {
    const codes = state.watchlist.slice(0, 4);
    const today = new Date();
    return codes.map((w, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() + 7 + i * 9);
        const q = demoQuote(w.code);
        return {
            code: w.code,
            name: demoName(w.code),
            date: _demoLocalDate(d),
            type: i % 3 === 0 ? '息' : '權息',
            cash_dividend: Math.round(q.ref * 0.025 * 100) / 100,
            stock_dividend_ratio: null,
        };
    });
}

// 美股行情仿真（指數/ETF/個股），分時與日線皆動態合成
function demoUsChart(urlStr) {
    const u = new URL(urlStr, 'http://localhost');
    const symbol = (u.searchParams.get('symbol') || '').toUpperCase();
    const range = u.searchParams.get('range') || '1d';
    const known = DEMO_KNOWN_US[symbol];
    let q = demoState.usQuotes[symbol];
    if (!q) {
        let base = known ? known.price : null;
        if (base == null) {
            let hsum = 0;
            for (const ch of symbol) hsum = (hsum * 31 + ch.charCodeAt(0)) % 99991;
            base = Math.round((30 + (hsum % 6000) / 10) * 100) / 100;
        }
        q = demoState.usQuotes[symbol] = { prev: base, last: base };
    }
    q.last = demoWalk(q.last);
    const n = range === '2y' ? 500 : 78;
    const closes = [];
    let v = q.prev;
    for (let i = 0; i < n; i++) {
        v = demoWalk(v);
        closes.push(Math.round(v * 100) / 100);
    }
    closes[n - 1] = q.last;
    const nowSec = Math.floor(Date.now() / 1000);
    const step = range === '2y' ? 86400 : 300;
    const change = Math.round((q.last - q.prev) * 100) / 100;
    return {
        symbol,
        name: known ? known.name : `${symbol} (DEMO)`,
        currency: 'USD',
        instrument_type: known ? known.type : 'EQUITY',
        price: q.last,
        prev_close: q.prev,
        change,
        change_rate: Math.round(change / q.prev * 10000) / 100,
        market_state: 'REGULAR',
        timestamps: closes.map((_, i) => nowSec - (n - 1 - i) * step),
        close: closes,
        open: closes.slice(),
        high: closes.map(x => Math.round(x * 1.002 * 100) / 100),
        low: closes.map(x => Math.round(x * 0.998 * 100) / 100),
        volume: closes.map(() => 100000 + Math.floor(Math.random() * 900000)),
    };
}

// 下單閉環模擬：買進加庫存扣餘額；賣出限假庫存內，成交後減庫存增餘額
// ── v1.7.1 Demo 委託單管理 ──────────────────────────────────────────────
// v1.10.2 本地時間 helpers：先前用 toISOString() 是 UTC，紀錄時間戳差 8 小時
function _demoLocalTs(d = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function _demoLocalDate(d = new Date()) { return _demoLocalTs(d).slice(0, 10); }

function _demoFindPending(tradeId) {
    // v1.10.2 已成交/已取消的單仍留在清單（對齊真實 daemon），管理操作僅限掛單中狀態
    const t = demoState.pendingOrders.find(t => t.order.id === tradeId);
    return (t && PENDING_STATUSES.has(t.status.status)) ? t : null;
}

function _demoMgmtLog(t, type, price, quantity, detail) {
    demoState.tradeLogs.unshift({
        ts: _demoLocalTs(),
        type,
        order_id: t.order.id,
        seqno: t.order.seqno || '',
        code: t.contract.code,
        action: t.order.action,
        price,
        quantity,
        order_lot: t.order.order_lot,
        detail,
    });
    demoState.tradeLogs = demoState.tradeLogs.slice(0, 99);
}

function demoCancelOrder(bodyText) {
    let trade_id = '';
    try { trade_id = JSON.parse(bodyText || '{}').trade_id; } catch (e) { /* 忽略 */ }
    const t = _demoFindPending(trade_id);
    if (!t) return mockResponse({ error: '[DEMO 模式] 查無此委託或已成交' }, 400);
    _demoMgmtLog(t, 'cancel', t.status.modified_price > 0 ? t.status.modified_price : t.order.price,
        t.status.order_quantity - (t.status.cancel_quantity || 0) - (t.status.deal_quantity || 0), '剩餘全數取消');
    demoState.cancelledIds.add(trade_id);
    t.status.status = 'Cancelled';
    t.status.cancel_quantity = t.status.order_quantity - (t.status.deal_quantity || 0);
    return mockResponse(t);
}

function demoUpdateOrder(bodyText, kind) {
    let body = {};
    try { body = JSON.parse(bodyText || '{}'); } catch (e) { /* 忽略 */ }
    const t = _demoFindPending(body.trade_id);
    if (!t) return mockResponse({ error: '[DEMO 模式] 查無此委託或已成交' }, 400);
    if (kind === 'price') {
        const p = Number(body.price);
        if (!(p > 0)) return mockResponse({ error: '[DEMO 模式] 無效的新價格' }, 400);
        const oldP = t.status.modified_price > 0 ? t.status.modified_price : t.order.price;
        _demoMgmtLog(t, 'update_price', p, 0, `${oldP}→${p}`);
        t.status.modified_price = p;
        t.order.price = t.order.price; // 原始價保留，顯示層以 modified_price 為準
    } else {
        const q = parseInt(body.quantity);
        const remaining = t.status.order_quantity - (t.status.deal_quantity || 0);
        if (!(q > 0) || q > remaining) return mockResponse({ error: `[DEMO 模式] 減量數須為 1 ~ ${remaining}` }, 400);
        _demoMgmtLog(t, 'update_qty', t.status.modified_price > 0 ? t.status.modified_price : t.order.price, q, `-${q}`);
        // 對齊真實 daemon 語意：order_quantity 直接遞減為有效量，cancel_quantity 累計減量
        t.status.cancel_quantity = (t.status.cancel_quantity || 0) + q;
        t.status.order_quantity = t.status.order_quantity - q;
        if (t.status.order_quantity - (t.status.deal_quantity || 0) <= 0) {
            // 全數減量 → 等同刪單
            demoState.cancelledIds.add(t.order.id);
            t.status.status = 'Cancelled';
        }
    }
    return mockResponse(t);
}

function demoPlaceOrder(bodyText) {
    let payload = {};
    try { payload = JSON.parse(bodyText || '{}'); } catch (e) { /* 忽略 */ }
    const code = payload.contract && payload.contract.code;
    const so = payload.stock_order || {};
    const shares = (so.order_lot === 'IntradayOdd') ? (so.quantity || 0) : (so.quantity || 0) * 1000;
    const action = so.action;
    const price = so.price || (code ? demoQuote(code).last : 0);

    if (!code || shares <= 0) {
        return mockResponse({ error: '[DEMO 模式] 無效的委託參數' }, 400);
    }
    if (action === 'Sell') {
        const pos = demoState.positions.find(p => p.code === code);
        if (!pos || pos.shares < shares) {
            return mockResponse({ error: `[DEMO 模式] 賣出失敗：假庫存僅持有 ${pos ? pos.shares.toLocaleString() : 0} 股，不足 ${shares.toLocaleString()} 股` }, 400);
        }
    }
    if (action === 'Buy' && price * shares > demoState.balance) {
        return mockResponse({ error: `[DEMO 模式] 買進失敗：假可用餘額不足（需 ${Math.round(price * shares).toLocaleString()} 元，餘 ${demoState.balance.toLocaleString()} 元）` }, 400);
    }

    const orderId = `DEMO-${String(demoState.orderSeq++).padStart(4, '0')}`;
    const demoSeqno = String(600000 + demoState.orderSeq); // v1.8.6 模擬與 App 一致的流水序號

    // v1.7 假委託紀錄（與後端 trade_logs.json 同構）
    demoState.tradeLogs.unshift({
        ts: _demoLocalTs(),
        order_id: orderId,
        seqno: demoSeqno,
        code,
        action,
        price,
        quantity: so.quantity,
        order_lot: so.order_lot || 'Common',
        price_type: so.price_type || 'LMT',
        order_cond: so.order_cond || 'Cash',
    });
    demoState.tradeLogs = demoState.tradeLogs.slice(0, 99);

    // v1.7 假未成交委託（v1.10.2 起成交/取消後保留並改狀態，對齊真實 daemon）
    demoState.pendingOrders.push({
        contract: { code, exchange: 'TSE', security_type: 'STK' },
        order: { id: orderId, seqno: demoSeqno, action, price, quantity: so.quantity, order_lot: so.order_lot || 'Common', price_type: so.price_type || 'LMT', order_cond: so.order_cond || 'Cash' },
        status: { id: orderId, status: 'Submitted', order_quantity: so.quantity, deal_quantity: 0, cancel_quantity: 0, modified_price: 0, order_ts: Date.now() / 1000 },
    });

    // 5~10 秒後模擬成交並更新假庫存/假餘額，演示完整下單閉環（v1.10.2 延長以便觀察未成交狀態）
    setTimeout(() => {
        if (!state.demoMode) return; // 期間若已關閉 Demo，放棄模擬成交
        if (demoState.cancelledIds.has(orderId)) return; // v1.7.1 已刪單 → 放棄模擬成交
        if (action === 'Buy') {
            demoState.balance = Math.round(demoState.balance - price * shares);
            const pos = demoState.positions.find(p => p.code === code);
            if (pos) {
                pos.avg = Math.round(((pos.avg * pos.shares + price * shares) / (pos.shares + shares)) * 100) / 100;
                pos.shares += shares;
            } else {
                demoState.positions.push({ code, name: demoName(code), avg: price, shares });
            }
        } else {
            demoState.balance = Math.round(demoState.balance + price * shares);
            const pos = demoState.positions.find(p => p.code === code);
            if (pos) {
                const tradePnl = Math.round((price - pos.avg) * shares);
                demoState.todayRealizedPnl = (demoState.todayRealizedPnl || 0) + tradePnl;
                pos.shares -= shares;
                if (pos.shares <= 0) {
                    demoState.positions = demoState.positions.filter(p => p.code !== code);
                }
            }
        }

        // v1.10.2 對齊真實 daemon：成交後保留於 /order/trades 並標 Filled（結果欄顯示「已成交」），不再移除
        const filled = demoState.pendingOrders.find(t => t.order.id === orderId);
        if (filled) {
            filled.status.status = 'Filled';
            filled.status.deal_quantity = filled.status.order_quantity - (filled.status.cancel_quantity || 0);
        }
        showToastNotification(`[DEMO 模式] 委託 ${orderId} 已成交：${action === 'Buy' ? '買進' : '賣出'} ${code} ${shares.toLocaleString()} 股 @ ${formatDecimal(price, 2)}`);
        _fetchCount = 0;  // 讓下一輪 fetchData 立即執行帳務 API（更新餘額/庫存/交割款）
        fetchData();
        const stockAcc = state.accounts.find(a => a.account_type === 'S');
        if (stockAcc) {
            fetchTodayRealizedPnl(stockAcc);
        }
    }, 5000 + Math.random() * 5000); // v1.10.2 原 1~2 秒太快，未成交卡幾乎不可見

    return mockResponse({ order: { id: orderId, price, quantity: so.quantity }, status: { status: 'PendingSubmit' } });
}

// ── smartFetch：唯一網路收口。Demo 啟用時攔截，否則走真實 fetch ────────────
async function smartFetch(url, options = {}) {
    if (!state.demoMode) return fetch(url, options);

    const method = (options.method || 'GET').toUpperCase();
    const body = options.body;

    // Shioaji Proxy 端點
    if (url.includes('/proxy/api/v1/')) {
        if (url.includes('/auth/usage')) return mockResponse({ connections: 1, bytes: 8421376, limit_bytes: 536870912 });
        if (url.includes('/auth/accounts')) return mockResponse([{ account_type: 'S', broker_id: '9A95', account_id: '8888888', person_id: 'DEMO000000', signed: true, name: '演示帳戶' }]);
        if (url.includes('/portfolio/account_balance')) return mockResponse({ acc_balance: demoState.balance });
        if (url.includes('/portfolio/trading_limits')) return mockResponse({ trading_limit: 5000000, trading_used: 850000, trading_available: 4150000 });
        if (url.includes('/portfolio/position_unit')) return mockResponse(demoPositions());
        if (url.includes('/portfolio/settlements')) return mockResponse(demoSettlements());
        if (url.includes('/portfolio/profit_loss')) {
            try {
                const parsedBody = JSON.parse(body || '{}');
                if (parsedBody.begin_date && parsedBody.end_date) {
                    const mockPnl = getDemoPnlForRange(parsedBody.begin_date, parsedBody.end_date);
                    return mockResponse([{ date: parsedBody.begin_date, pnl: mockPnl }]);
                }
            } catch (e) {
                // Ignore and fallback
            }
            return mockResponse(demoProfitLoss());
        }
        if (url.includes('/data/snapshots')) return mockResponse(demoSnapshots(body));
        if (url.includes('/data/contracts/')) {
            const code = url.split('/data/contracts/')[1].split('?')[0];
            const ref = demoQuote(code).ref;
            return mockResponse({ code, name: demoName(code), exchange: 'TSE', reference: ref,
                limit_up: Math.round(ref * 1.1 * 100) / 100, limit_down: Math.round(ref * 0.9 * 100) / 100 });
        }
        if (url.includes('/data/kbars')) {
            let code = '';
            try { code = JSON.parse(body || '{}').contract.code; } catch (e) { /* 忽略 */ }
            return mockResponse(demoKbars(code));
        }
        if (url.includes('/data/ticks')) {
            let code = '';
            try { code = JSON.parse(body || '{}').contract.code; } catch (e) { /* 忽略 */ }
            return mockResponse(demoTicks(code));
        }

        if (url.includes('/order/trades')) return mockResponse(demoState.pendingOrders); // v1.7 假未成交委託
        if (url.includes('/order/cancel_order')) return demoCancelOrder(body); // v1.7.1
        if (url.includes('/order/update_price')) return demoUpdateOrder(body, 'price'); // v1.7.1
        if (url.includes('/order/update_qty')) return demoUpdateOrder(body, 'qty'); // v1.7.1
        // v1.10.1 修復：本行先前被吃掉換行、整句併入上行註解成死碼——Demo 下單從未進假閉環
        if (url.includes('/order/place_order')) return demoPlaceOrder(body);
        console.warn(`[DEMO] 未攔截的 proxy 端點（回傳空物件防洩漏）: ${method} ${url}`);
        return mockResponse({});
    }

    // 本機後端端點
    if (url.includes('/api/credentials')) {
        if (method === 'POST') {
            try {
                const parts = url.split('/api/credentials/');
                const subAction = parts[parts.length - 1];
                const payload = JSON.parse(body || '{}');
                
                if (subAction === 'save') {
                    const idx = payload.index;
                    const newProfile = {
                        name: payload.name,
                        api_key: payload.api_key,
                        secret_key: payload.secret_key || 'enc:dpapi:v1:dGVzdF9zZWNyZXRfa2V5',
                        ca_cert_path: payload.ca_cert_path,
                        ca_password: payload.ca_password || 'enc:dpapi:v1:dGVzdF9jYV9wYXNzd29yZA=='
                    };
                    if (idx === -1) {
                        demoState.credentials.profiles.push(newProfile);
                    } else if (idx >= 0 && idx < demoState.credentials.profiles.length) {
                        const old = demoState.credentials.profiles[idx];
                        if (payload.secret_key === '******' || !payload.secret_key) newProfile.secret_key = old.secret_key;
                        if (payload.ca_password === '*****' || !payload.ca_password) newProfile.ca_password = old.ca_password;
                        demoState.credentials.profiles[idx] = newProfile;
                    }
                    return mockResponse({ success: true, restarting: true });
                } else if (subAction === 'switch') {
                    const idx = payload.index;
                    if (idx >= 0 && idx < demoState.credentials.profiles.length) {
                        demoState.credentials.active_index = idx;
                    }
                    return mockResponse({ success: true, restarting: true });
                } else if (subAction === 'delete') {
                    const idx = payload.index;
                    if (idx >= 0 && idx < demoState.credentials.profiles.length) {
                        demoState.credentials.profiles.splice(idx, 1);
                        if (demoState.credentials.active_index >= demoState.credentials.profiles.length) {
                            demoState.credentials.active_index = 0;
                        }
                    }
                    return mockResponse({ success: true, restarting: false });
                }
            } catch (e) {
                return mockResponse({ error: `[DEMO 模式] 操作失敗：${e.message}` }, 400);
            }
        }
        return mockResponse(demoState.credentials);
    }
    if (url.includes('/api/trade-permission')) return mockResponse({ trading_permitted: true, reason: '' });
    if (url.includes('/api/trade-logs')) return mockResponse(demoState.tradeLogs); // v1.7 不洩漏真實委託紀錄
    if (url.includes('/api/asset-history')) return mockResponse(demoAssetHistory()); // GET/POST/匯入/刪除一律回傳唯讀假歷史
    if (url.includes('/api/twse-announcements')) return mockResponse(demoAnnouncements());
    if (url.includes('/api/twse-dividends')) return mockResponse(demoDividends());
    if (url.includes('/api/us-chart')) return mockResponse(demoUsChart(url));

    console.warn(`[DEMO] 未攔截的端點（改走真實請求）: ${method} ${url}`);
    return fetch(url, options);
}

// ── Demo 開關 UI 與徽章 ─────────────────────────────────────────────────────
function initDemoMode() {
    updateDemoBadge();
    const toggle = document.getElementById('demo-mode-toggle');
    if (!toggle) return;
    toggle.checked = state.demoMode;
    toggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            // 開啟：重新載入頁面，所有資料改以攔截器供應
            localStorage.setItem('demoMode', 'true');
            showToastNotification('[DEMO 模式] 已啟用，頁面即將重新載入...');
            setTimeout(() => location.reload(), 600);
        } else {
            // 關閉會還原真實資產，須先通過安全驗證（答對 PEA6）
            e.target.checked = true; // 先還原勾選，驗證通過才真正關閉
            openCredentialsLockModal(() => {
                localStorage.setItem('demoMode', 'false');
                showToastNotification('已關閉 Demo 模式，正在還原真實帳戶資料...');
                setTimeout(() => location.reload(), 600);
            });
        }
    });
}

function updateDemoBadge() {
    const badge = document.getElementById('demo-badge');
    if (badge) badge.style.display = state.demoMode ? 'inline-block' : 'none';
}
