"""
StockGenie API Stock Dashboard Orchestrator
Python Backend Server and Launcher
"""

import os
import sys
import json
import shutil
import subprocess
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timedelta
from pathlib import Path
import threading

# 解決 Windows 主控台 Unicode 輸出錯誤 (CP950 編碼問題)
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

WORKSPACE_DIR = Path(__file__).parent.resolve()
WEB_DIR = WORKSPACE_DIR / "web"
HISTORY_FILE = WORKSPACE_DIR / "asset_history.json"
CREDENTIALS_FILE = WORKSPACE_DIR / "credentials.json"
ENV_FILE = WORKSPACE_DIR / ".env"
VERIFICATION_CODE = "PEA6"  # 變更設定的二次安全驗證碼（防肉眼窺視，非防本機抓包）

# Shioaji 守護進程全域引用（由 start_shioaji_server 管理；lock 防併發重啟）
shioaji_proc = None
shioaji_proc_lock = threading.Lock()

# ── v1.7.0 委託紀錄（記錄「委託成功送出」，非成交；含真實交易資料，勿入版控）──
TRADE_LOG_FILE = WORKSPACE_DIR / "trade_logs.json"
TRADE_LOG_MAX = 30
trade_log_lock = threading.Lock()


def _read_trade_logs_unlocked():
    """讀取委託紀錄；不存在或損壞一律回空清單重建（Log 為輔助資料，不得影響下單主流程）。"""
    try:
        logs = json.loads(TRADE_LOG_FILE.read_text(encoding='utf-8'))
        return logs if isinstance(logs, list) else []
    except Exception:
        return []


def append_trade_log(entry):
    """追加一筆委託紀錄（新者在前，僅保留最新 TRADE_LOG_MAX 筆；temp file + os.replace 原子寫入）。"""
    with trade_log_lock:
        logs = _read_trade_logs_unlocked()
        logs.insert(0, entry)
        logs = logs[:TRADE_LOG_MAX]
        tmp = TRADE_LOG_FILE.with_suffix('.json.tmp')
        tmp.write_text(json.dumps(logs, ensure_ascii=False, indent=2), encoding='utf-8')
        os.replace(tmp, TRADE_LOG_FILE)


def read_trade_logs():
    with trade_log_lock:
        return _read_trade_logs_unlocked()

# ── TWSE OpenAPI 來源與快取 ──────────────────────────────────────────────
TWSE_ANNOUNCEMENT_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap04_L"
TWSE_DIVIDEND_URL = "https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL"
TWSE_CACHE_TTL = 600  # 10 分鐘，避免高頻打 TWSE 公開 API
_twse_cache = {}      # url -> (fetched_at_epoch, parsed_json)
_twse_cache_lock = threading.Lock()
_twse_needs_relaxed_ssl_lock = threading.Lock()
_twse_needs_relaxed_ssl = False  # 一旦偵測到 TWSE 憑證鏈問題，之後直接走寬鬆模式（省去每次先失敗一輪 ~6 秒）

def _roc_to_iso(roc_str):
    """民國日期字串 (如 1150420) 轉 ISO 西元日期 (2026-04-20)。失敗回傳原值。"""
    try:
        s = str(roc_str).strip()
        if len(s) == 7 and s.isdigit():
            year = int(s[:3]) + 1911
            return f"{year:04d}-{s[3:5]}-{s[5:7]}"
    except Exception:
        pass
    return roc_str

def fetch_twse_json(url):
    """帶快取地抓取 TWSE OpenAPI JSON（失敗時回傳快取舊資料或空清單）。

    注意：TWSE 憑證鏈缺少 Subject Key Identifier，OpenSSL 3.x 嚴格驗證會失敗
    （CERTIFICATE_VERIFY_FAILED: Missing Subject Key Identifier）。
    先以正常驗證嘗試，失敗時改用寬鬆 SSL context 重試並印出提示。
    此 API 僅用於讀取公開市場公告，無任何帳務或交易資料外洩風險。
    """
    global _twse_needs_relaxed_ssl
    import urllib.request
    import ssl
    now = time.time()
    with _twse_cache_lock:
        cached = _twse_cache.get(url)
        if cached and now - cached[0] < TWSE_CACHE_TTL:
            return cached[1]

    def _relaxed_ctx():
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx

    def _do_fetch(ctx=None):
        req = urllib.request.Request(url, headers={
            "accept": "application/json",
            "Accept-Encoding": "gzip",
            "User-Agent": "StockGenie-Dashboard/1.0"
        })
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            content = resp.read()
            if resp.info().get('Content-Encoding') == 'gzip':
                import gzip
                content = gzip.decompress(content)
            return json.loads(content.decode("utf-8"))

    try:
        if _twse_needs_relaxed_ssl:
            # 已知需要寬鬆模式：直接走，不再每次先失敗一輪
            data = _do_fetch(_relaxed_ctx())
        else:
            try:
                try:
                    data = _do_fetch()
                except ssl.SSLError:
                    raise
                except Exception as e:
                    # urlopen 會把 SSLError 包成 URLError，檢查內層原因
                    if isinstance(getattr(e, 'reason', None), ssl.SSLError):
                        raise ssl.SSLError(str(e))
                    raise
            except ssl.SSLError:
                with _twse_needs_relaxed_ssl_lock:
                    if not _twse_needs_relaxed_ssl:
                        print(f"\033[93m⚠ TWSE 憑證驗證失敗（已知的 TWSE 憑證鏈問題），本次起改用寬鬆 SSL 模式：{url}\033[0m")
                        _twse_needs_relaxed_ssl = True
                data = _do_fetch(_relaxed_ctx())
    except Exception as e:
        print(f"⚠ TWSE OpenAPI 抓取失敗（{url}）：{e}")
        with _twse_cache_lock:
            cached = _twse_cache.get(url)
        return cached[1] if cached else []

    if not isinstance(data, list):
        data = []
    with _twse_cache_lock:
        _twse_cache[url] = (now, data)
    return data

# ── 美股行情（Yahoo Finance 公開 chart API）────────────────────────────────
# 商品代碼採格式驗證（非白名單）：僅限定 Yahoo chart 端點與固定查詢組合，
# 不轉發任意 URL，因此不構成開放代理。
US_KNOWN_NAMES = {
    "^GSPC": "S&P 500 指數",
    "VOO": "Vanguard S&P 500 ETF",
}
US_SYMBOL_ALLOWED_CHARS = set(".^-=")  # 字母數字以外允許的符號（如 ^GSPC、BRK-B、ES=F）

def is_valid_us_symbol(symbol):
    """美股代碼格式驗證：1-12 字元，限大寫字母/數字/.^-= 。"""
    return (
        1 <= len(symbol) <= 12
        and all(c.isascii() and (c.isalnum() or c in US_SYMBOL_ALLOWED_CHARS) for c in symbol)
    )
YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/"
# 允許的查詢組合：盤中分時 / 長期日線（供 MA 計算）
US_ALLOWED_QUERIES = {
    ("1d", "5m"): 60,      # 盤中走勢，快取 60 秒
    ("2y", "1d"): 1800,    # 日 K 與均線，快取 30 分鐘
}
_us_cache = {}             # (symbol, range, interval) -> (fetched_at_epoch, payload)
_us_cache_lock = threading.Lock()

def fetch_us_chart(symbol, range_, interval):
    """抓取 Yahoo Finance chart API 並整理為精簡 payload（帶快取，失敗回快取舊資料）。

    回傳格式：{symbol, name, currency, price, prev_close, change, change_rate,
              market_state, timestamps[], open[], high[], low[], close[], volume[]}
    """
    import urllib.request
    import urllib.parse
    ttl = US_ALLOWED_QUERIES[(range_, interval)]
    key = (symbol, range_, interval)
    now = time.time()
    with _us_cache_lock:
        cached = _us_cache.get(key)
        if cached and now - cached[0] < ttl:
            return cached[1]

    url = (f"{YAHOO_CHART_BASE}{urllib.parse.quote(symbol)}"
           f"?range={range_}&interval={interval}")
    try:
        import urllib.error
        req = urllib.request.Request(url, headers={
            "accept": "application/json",
            "Accept-Encoding": "gzip",
            # Yahoo 對無 UA 或非瀏覽器 UA 的請求可能回 429/403
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read()
            if resp.info().get('Content-Encoding') == 'gzip':
                import gzip
                content = gzip.decompress(content)
            raw = json.loads(content.decode("utf-8"))

        result = raw["chart"]["result"][0]
        meta = result.get("meta", {})
        quote = (result.get("indicators", {}).get("quote") or [{}])[0]
        timestamps = result.get("timestamp") or []

        # 同步剔除 close 為 null 的點（Yahoo 盤中常見缺漏 bar）
        cleaned = {"timestamps": [], "open": [], "high": [], "low": [], "close": [], "volume": []}
        closes_raw = quote.get("close") or []
        for i, ts in enumerate(timestamps):
            c = closes_raw[i] if i < len(closes_raw) else None
            if c is None:
                continue
            cleaned["timestamps"].append(ts)
            cleaned["close"].append(c)
            for fld in ("open", "high", "low", "volume"):
                arr = quote.get(fld) or []
                cleaned[fld].append(arr[i] if i < len(arr) else None)

        price = meta.get("regularMarketPrice")
        prev_close = meta.get("chartPreviousClose") or meta.get("previousClose")
        change = (price - prev_close) if (price is not None and prev_close) else None
        change_rate = (change / prev_close * 100) if (change is not None and prev_close) else None

        payload = {
            "symbol": symbol,
            # 名稱優先序：本地中文名 > Yahoo 商品名 > 代碼
            "name": US_KNOWN_NAMES.get(symbol) or meta.get("shortName") or meta.get("longName") or symbol,
            "currency": meta.get("currency", "USD"),
            # INDEX / EQUITY / ETF 等，供前端區分指數與一般商品樣式
            "instrument_type": meta.get("instrumentType", ""),
            "price": price,
            "prev_close": prev_close,
            "change": change,
            "change_rate": change_rate,
            "market_state": meta.get("marketState") or "",
            **cleaned,
        }
    except Exception as e:
        # Yahoo 對不存在的代碼回 HTTP 404，明確轉成 LookupError 供路由回 404
        if isinstance(e, urllib.error.HTTPError) and e.code == 404:
            raise LookupError(f"查無美股商品代碼: {symbol}")
        print(f"⚠ Yahoo Finance 抓取失敗（{symbol} {range_}/{interval}）：{e}")
        with _us_cache_lock:
            cached = _us_cache.get(key)
        if cached:
            return cached[1]
        raise

    with _us_cache_lock:
        _us_cache[key] = (now, payload)
    return payload

# ── Load and Map Environment ──────────────────────────────────────────────
def load_env():
    env_path = WORKSPACE_DIR / ".env"
    if not env_path.exists():
        raise FileNotFoundError(f"找不到 .env 檔：{env_path}")
    env = {}
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, val = line.partition("=")
                env[key.strip()] = val.strip()
    return env

def resolve_shioaji_bin():
    # 1. Check if shioaji is on system PATH
    shioaji_bin = shutil.which("shioaji")
    if shioaji_bin:
        return shioaji_bin

    # 2. Search user Scripts directory (e.g. AppData\Roaming\Python\PythonXX\Scripts)
    appdata = os.environ.get("APPDATA")
    if appdata:
        python_dir = Path(appdata) / "Python"
        if python_dir.exists():
            for scripts_dir in python_dir.glob("**/Scripts"):
                bin_path = scripts_dir / "shioaji.exe"
                if bin_path.exists():
                    return str(bin_path)

    # 3. Fallback to standard Python folder
    py_exe = Path(sys.executable)
    bin_path = py_exe.parent / "Scripts" / "shioaji.exe"
    if bin_path.exists():
        return str(bin_path)
        
    bin_path_user = py_exe.parent.parent / "Scripts" / "shioaji.exe"
    if bin_path_user.exists():
        return str(bin_path_user)

    raise FileNotFoundError("找不到 shioaji.exe 執行檔。請確認 shioaji 已正確安裝。")

# ── 多組 API 金鑰設定檔管理 (credentials.json) ────────────────────────────
MASK_TOKENS = ("...", "●", "*")

def is_masked_value(val):
    """判斷字串是否為遮蔽格式（代表前端未變更該欄位）。"""
    return any(t in val for t in MASK_TOKENS)

def mask_api_key(val):
    """API Key 遮蔽：保留前 6 與後 4 字元；過短時回固定長度遮蔽。"""
    if not val:
        return ""
    if is_masked_value(val):
        return val
    if len(val) <= 10:
        return "●" * 8
    return f"{val[:6]}...{val[-4:]}"

def mask_fixed(val):
    """Secret Key / 密碼遮蔽：固定長度，不洩漏原始字串長度。"""
    return "●" * 8 if val else ""

def _atomic_write_text(path, text):
    """temp file + os.replace 原子寫入，防寫到一半損毀。"""
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)

def save_credentials(db):
    _atomic_write_text(CREDENTIALS_FILE, json.dumps(db, indent=2, ensure_ascii=False))

def load_credentials():
    """讀取 credentials.json；不存在或損毀時自 .env 初始化第一組設定檔（無縫升級）。"""
    if CREDENTIALS_FILE.exists():
        try:
            with open(CREDENTIALS_FILE, encoding="utf-8") as f:
                db = json.load(f)
            profiles = db.get("profiles")
            if isinstance(profiles, list) and profiles:
                idx = db.get("active_index", 0)
                if not isinstance(idx, int) or not (0 <= idx < len(profiles)):
                    db["active_index"] = 0
                return db
            print("⚠ credentials.json 結構異常，將自 .env 重新初始化")
        except Exception as e:
            print(f"⚠ credentials.json 讀取失敗（{e}），將自 .env 重新初始化")
    try:
        env = load_env()
    except Exception:
        env = {}
    db = {
        "active_index": 0,
        "profiles": [{
            "name": "預設帳戶",
            "api_key": env.get("API_KEY", ""),
            "secret_key": env.get("SECRET_KEY", ""),
            "ca_cert_path": env.get("CA_CERT_PATH", ""),
            "ca_password": env.get("CA_PASSWORD", ""),
        }],
    }
    save_credentials(db)
    return db

def save_env(env_vars):
    """合併更新 .env：僅覆寫傳入的金鑰欄位，保留其他既有設定與註解。"""
    lines = []
    if ENV_FILE.exists():
        with open(ENV_FILE, encoding="utf-8") as f:
            lines = f.read().splitlines()
    remaining = dict(env_vars)
    out = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.partition("=")[0].strip()
            if key in remaining:
                out.append(f"{key}={remaining.pop(key)}")
                continue
        out.append(line)
    for key, val in remaining.items():
        out.append(f"{key}={val}")
    _atomic_write_text(ENV_FILE, "\n".join(out) + "\n")

def profile_env(profile):
    """設定檔 → .env 風格的金鑰字典。"""
    return {
        "API_KEY": profile.get("api_key", ""),
        "SECRET_KEY": profile.get("secret_key", ""),
        "CA_CERT_PATH": profile.get("ca_cert_path", ""),
        "CA_PASSWORD": profile.get("ca_password", ""),
    }

def _wait_port_released(host="127.0.0.1", port=8080, timeout=5.0):
    """等待 port 釋放（最多 timeout 秒），避免新進程因 Port 8080 占用啟動失敗。"""
    import socket
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            if s.connect_ex((host, port)) != 0:
                return True
        time.sleep(0.3)
    return False

def _kill_shioaji_on_port(port=8080):
    """尋找並強制結束佔用 Port 8080 的 shioaji 進程（防範前次異常殘留的進程阻礙重啟）。"""
    import subprocess
    try:
        # 僅適用於 Windows
        if sys.platform != "win32":
            return
        cmd = f'netstat -ano | findstr :{port}'
        output = subprocess.check_output(cmd, shell=True).decode('utf-8', errors='ignore')
        pids = set()
        for line in output.strip().split('\n'):
            parts = line.split()
            if len(parts) >= 5 and ('LISTENING' in parts or 'LISTEN' in parts):
                pids.add(parts[-1])
        
        for pid in pids:
            # 檢查是否為 shioaji.exe 或 python 進程
            try:
                proc_info = subprocess.check_output(f'tasklist /FI "PID eq {pid}"', shell=True).decode('utf-8', errors='ignore')
                if "shioaji" in proc_info.lower() or "python" in proc_info.lower():
                    print(f"\033[93m⚠ 偵測到殘留的 Shioaji/Python 進程 (PID: {pid}) 佔用 Port {port}，強制結束中...\033[0m")
                    subprocess.run(f'taskkill /F /PID {pid}', shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except Exception:
                # 備用方案：直接嘗試 taskkill
                subprocess.run(f'taskkill /F /PID {pid}', shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        print(f"嘗試清除 Port {port} 殘留進程時發生錯誤: {e}")

def start_shioaji_server(env_dict):
    """終止既有 Shioaji 守護進程並以新環境變數重啟。

    啟動失敗不致命（回傳 False）：確保金鑰錯誤或執行檔缺失時，
    設定 API 與網頁伺服器仍可運作，使用者可修正設定（防鎖死）。
    """
    global shioaji_proc
    try:
        shioaji_bin = resolve_shioaji_bin()
    except Exception as e:
        print(f"\033[93m⚠ 無法啟動 Shioaji 伺服器：{e}\n"
              f"  設定頁面仍可使用，修正後請重新切換設定檔。\033[0m")
        return False

    run_env = os.environ.copy()
    run_env["SJ_API_KEY"] = env_dict.get("API_KEY", "")
    run_env["SJ_SEC_KEY"] = env_dict.get("SECRET_KEY", "")
    ca_cert = env_dict.get("CA_CERT_PATH", "")
    if ca_cert:
        ca_path = Path(ca_cert)
        if not ca_path.is_absolute():
            ca_path = WORKSPACE_DIR / ca_path
        if not ca_path.exists():
            # 黃色警告：憑證遺失只影響下單，不中斷伺服器啟動
            print(f"\033[93m⚠ 警告：找不到 CA 憑證檔案：{ca_path.resolve()}\n"
                  f"  行情查詢不受影響，但「下單」將因簽章失敗而無法使用。\033[0m")
        run_env["SJ_CA_PATH"] = str(ca_path.resolve())
    else:
        print("\033[93m⚠ 警告：未設定 CA_CERT_PATH，下單功能將無法使用（僅供行情查詢）。\033[0m")
    run_env["SJ_CA_PASSWD"] = env_dict.get("CA_PASSWORD", "")
    run_env["SJ_PRODUCTION"] = "true"

    with shioaji_proc_lock:
        if shioaji_proc is not None:
            print("正在中止舊的 Shioaji API 伺服器...")
            try:
                shioaji_proc.terminate()
                try:
                    shioaji_proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    shioaji_proc.kill()
                    shioaji_proc.wait(timeout=3)
            except Exception as e:
                print(f"⚠ 終止舊進程時發生異常：{e}")
            shioaji_proc = None
        
        # 額外清理：確保 Port 8080 無殘留 shioaji.exe / python 進程
        _kill_shioaji_on_port(8080)

        if not _wait_port_released():
            print("\033[93m⚠ Port 8080 在等待時間內未釋放，仍嘗試啟動新進程...\033[0m")
        try:
            print(f"正在啟動 Shioaji API 伺服器，執行檔路徑：{shioaji_bin}")
            shioaji_proc = subprocess.Popen(
                [shioaji_bin, "server", "start", "--no-open"],
                env=run_env
            )
            return True
        except Exception as e:
            print(f"\033[91m✖ Shioaji 伺服器啟動失敗：{e}\033[0m")
            shioaji_proc = None
            return False

def apply_active_profile(db):
    """將啟用中設定寫入 .env（供 monitor.py 等腳本同步）並於背景重啟 Shioaji。"""
    profile = db["profiles"][db["active_index"]]
    env_dict = profile_env(profile)
    save_env(env_dict)
    threading.Thread(target=start_shioaji_server, args=(env_dict,), daemon=True).start()

# ── Custom HTTP Request Handler ──────────────────────────────────────────
class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # Serve static files from './web' directory
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def end_headers(self):
        # Add CORS headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        # Disable caching for frontend development/realtime updates
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def send_json_error(self, code, message):
        try:
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            err_body = json.dumps({"error": str(message)}, ensure_ascii=False).encode('utf-8')
            self.wfile.write(err_body)
        except Exception as e:
            print(f"發送 JSON 錯誤時發生異常: {e}")

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/proxy/'):
            self.handle_proxy_request("GET")
        elif self.path == '/api/asset-history':
            self.handle_get_history()
        elif self.path == '/api/trade-permission':
            self.handle_get_trade_permission()
        elif self.path == '/api/credentials':
            self.handle_get_credentials()
        elif self.path.startswith('/api/twse-announcements'):
            self.handle_twse_announcements()
        elif self.path.startswith('/api/twse-dividends'):
            self.handle_twse_dividends()
        elif self.path == '/api/trade-logs':
            self.handle_get_trade_logs()
        elif self.path.startswith('/api/us-chart'):
            self.handle_us_chart()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith('/proxy/'):
            self.handle_proxy_request("POST")
        elif self.path == '/api/asset-history/import':
            self.handle_import_history()
        elif self.path == '/api/asset-history':
            self.handle_post_history()
        elif self.path == '/api/credentials/save':
            self.handle_save_credentials()
        elif self.path == '/api/credentials/switch':
            self.handle_switch_credentials()
        elif self.path == '/api/credentials/delete':
            self.handle_delete_credentials()
        else:
            self.send_error(404, "Not Found")

    def do_DELETE(self):
        if self.path.startswith('/proxy/'):
            self.handle_proxy_request("DELETE")
        elif self.path.startswith('/api/asset-history/'):
            date_str = self.path.split('/')[-1]
            self.handle_delete_history(date_str)
        else:
            self.send_error(404, "Not Found")

    def handle_proxy_request(self, method):
        import urllib.request
        import urllib.error
        
        # 將 /proxy/api/v1/... 轉為 http://127.0.0.1:8080/api/v1/...
        rel_path = self.path.partition('/proxy/')[2]
        target_url = f"http://127.0.0.1:8080/{rel_path}"
        
        # Intercept order placement to enforce read-only protection
        # v1.7.1：改價/減量同樣受權限管制；刪單(cancel_order)刻意豁免——屬風險降低操作，
        # 即使 TRADING_ENABLED=false 也應允許撤回既有委託（上游 daemon 仍有憑證層把關）
        ORDER_MUTATION_PATHS = ("api/v1/order/place_order", "api/v1/order/update_price", "api/v1/order/update_qty")
        if method == "POST" and rel_path in ORDER_MUTATION_PATHS:
            try:
                env = load_env()
                read_only_keys = {"HBUcuTmf3ZHa96vcVbhfCYUmtwQtofTHq9HJ2YRh64T"}
                api_key = env.get("API_KEY", "")
                
                trading_permitted = True
                if env.get("TRADING_ENABLED", "").lower() == "false":
                    trading_permitted = False
                elif api_key in read_only_keys:
                    trading_permitted = False
                elif not env.get("CA_CERT_PATH") or not env.get("CA_PASSWORD"):
                    trading_permitted = False
                
                if not trading_permitted:
                    self.send_json_error(400, "下單權限關閉")
                    return
            except Exception as e:
                self.send_json_error(500, f"下單權限檢核異常: {e}")
                return

        content_length = int(self.headers.get('Content-Length', 0))
        req_data = self.rfile.read(content_length) if content_length > 0 else None

        # 已實現損益查詢：前端未帶時間參數時，預設自動補上前 365 天區間
        if method == "POST" and rel_path == "api/v1/portfolio/profit_loss" and req_data:
            try:
                body = json.loads(req_data.decode('utf-8'))
                if isinstance(body, dict) and not body.get("begin_date") and not body.get("end_date"):
                    body["begin_date"] = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")
                    body["end_date"] = datetime.now().strftime("%Y-%m-%d")
                    req_data = json.dumps(body).encode('utf-8')
            except Exception as e:
                print(f"⚠ profit_loss 預設參數補充失敗（依原請求轉發）：{e}")

        headers = {
            "Content-Type": self.headers.get("Content-Type", "application/json")
        }
        
        req = urllib.request.Request(target_url, data=req_data, headers=headers, method=method)
        # 帳務類 RPC 經永豐 Solace 通道，偶發回應緩慢（實測 trading_limits 曾達 6.2 秒），
        # 給予較長等待時間；行情與其他端點維持 10 秒
        proxy_timeout = 30 if rel_path.startswith('api/v1/portfolio/') else 10
        try:
            with urllib.request.urlopen(req, timeout=proxy_timeout) as resp:
                resp_data = resp.read()
                self.send_response(resp.status)
                self.send_header('Content-Type', resp.headers.get('Content-Type', 'application/json'))
                self.end_headers()
                self.wfile.write(resp_data)

                # v1.7.0 委託成功 → 寫入委託紀錄（任何失敗只印終端機，不影響已回傳的下單回應）
                if method == "POST" and rel_path == "api/v1/order/place_order" and resp.status == 200:
                    try:
                        req_body = json.loads(req_data.decode('utf-8')) if req_data else {}
                        resp_body = json.loads(resp_data.decode('utf-8'))
                        so = req_body.get("stock_order", {}) or {}
                        append_trade_log({
                            "ts": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                            "order_id": (resp_body.get("order") or {}).get("id", ""),
                            "code": (req_body.get("contract") or {}).get("code", ""),
                            "action": so.get("action", ""),
                            "price": so.get("price", 0),
                            "quantity": so.get("quantity", 0),
                            "order_lot": so.get("order_lot", ""),
                        })
                    except Exception as log_err:
                        print(f"\033[93m⚠ 委託紀錄寫入失敗（不影響下單）：{log_err}\033[0m")

                # v1.7.2 改價/減量/刪單成功 → 也追加一筆紀錄（type 區分；顯示資訊由前端
                # X-Log-Info header 提供——上游 schema 僅收 trade_id，proxy 讀取此 header 但不轉發）
                MGMT_LOG_TYPES = {
                    "api/v1/order/update_price": "update_price",
                    "api/v1/order/update_qty": "update_qty",
                    "api/v1/order/cancel_order": "cancel",
                }
                if method == "POST" and rel_path in MGMT_LOG_TYPES and resp.status == 200:
                    try:
                        import urllib.parse as _up
                        req_body = json.loads(req_data.decode('utf-8')) if req_data else {}
                        info = {}
                        raw_info = self.headers.get('X-Log-Info', '')
                        if raw_info:
                            try:
                                info = json.loads(_up.unquote(raw_info))
                            except Exception:
                                info = {}
                        log_type = MGMT_LOG_TYPES[rel_path]
                        new_price = req_body.get("price")
                        reduce_qty = req_body.get("quantity")
                        old_price = info.get("old_price")
                        if log_type == "update_price":
                            detail = f"{old_price}→{new_price}" if old_price is not None else f"→{new_price}"
                        elif log_type == "update_qty":
                            detail = f"-{reduce_qty}"
                        else:
                            detail = "剩餘全數取消"
                        append_trade_log({
                            "ts": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                            "type": log_type,
                            "order_id": req_body.get("trade_id", ""),
                            "code": info.get("code", ""),
                            "action": info.get("action", ""),
                            "price": new_price if new_price is not None else (old_price or 0),
                            "quantity": reduce_qty if reduce_qty is not None else (info.get("remaining") or 0),
                            "order_lot": info.get("order_lot", ""),
                            "detail": detail,
                        })
                    except Exception as log_err:
                        print(f"\033[93m⚠ 改單紀錄寫入失敗（不影響改單）：{log_err}\033[0m")
        except urllib.error.HTTPError as e:
            try:
                err_data = e.read()
                # 將上游錯誤內容印至終端機，便於排障（截斷至 300 字）
                try:
                    err_preview = err_data.decode('utf-8', errors='replace')[:300]
                    print(f"\033[93m⚠ Proxy 上游錯誤 HTTP{e.code} [{rel_path}]：{err_preview}\033[0m")
                except Exception:
                    pass
                self.send_response(e.code)
                self.send_header('Content-Type', e.headers.get('Content-Type', 'application/json'))
                self.end_headers()
                self.wfile.write(err_data)
            except Exception as ex:
                self.send_json_error(e.code, str(ex))
        except Exception as e:
            # 逾時或連線層級錯誤也印至終端機，便於排障
            print(f"\033[93m⚠ Proxy 連線失敗 [{rel_path}]（等待上限 {proxy_timeout}s）：{e}\033[0m")
            self.send_json_error(500, f"Proxy error: {e}")

    def handle_get_trade_logs(self):
        """v1.7.0 回傳最新委託紀錄（新者在前，最多 TRADE_LOG_MAX 筆）。"""
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(read_trade_logs(), ensure_ascii=False).encode('utf-8'))
        except Exception as e:
            self.send_json_error(500, str(e))

    def handle_get_trade_permission(self):
        try:
            env = load_env()
            read_only_keys = {"HBUcuTmf3ZHa96vcVbhfCYUmtwQtofTHq9HJ2YRh64T"}
            api_key = env.get("API_KEY", "")
            
            trading_permitted = True
            reason = ""
            
            if env.get("TRADING_ENABLED", "").lower() == "false":
                trading_permitted = False
                reason = "TRADING_ENABLED=false in config"
            elif api_key in read_only_keys:
                trading_permitted = False
                reason = "API Key is read-only"
            elif not env.get("CA_CERT_PATH") or not env.get("CA_PASSWORD"):
                trading_permitted = False
                reason = "CA cert not configured"
                
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "trading_permitted": trading_permitted,
                "reason": reason
            }).encode('utf-8'))
        except Exception as e:
            self.send_json_error(500, str(e))

    # ── 多組 API 金鑰設定檔端點（不依賴 Shioaji 進程，防鎖死）──────────────
    def _read_json_body(self):
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length <= 0:
            return {}
        raw = self.rfile.read(content_length)
        data = json.loads(raw.decode('utf-8'))
        return data if isinstance(data, dict) else {}

    def _check_verification(self, body):
        """二次安全驗證碼校驗；失敗時直接回 403 並回傳 False。"""
        if body.get("verification_code") != VERIFICATION_CODE:
            self.send_json_error(403, "安全驗證失敗")
            return False
        return True

    def handle_get_credentials(self):
        try:
            db = load_credentials()
            masked = [{
                "name": p.get("name", ""),
                "api_key": mask_api_key(p.get("api_key", "")),
                "secret_key": mask_fixed(p.get("secret_key", "")),
                "ca_cert_path": p.get("ca_cert_path", ""),
                "ca_password": mask_fixed(p.get("ca_password", "")),
            } for p in db["profiles"]]
            self._send_json({"active_index": db["active_index"], "profiles": masked})
        except Exception as e:
            self.send_json_error(500, f"讀取設定檔失敗: {e}")

    def handle_save_credentials(self):
        try:
            body = self._read_json_body()
        except Exception as e:
            self.send_json_error(400, f"請求格式錯誤: {e}")
            return
        if not self._check_verification(body):
            return
        try:
            index = body.get("index", -1)
            name = str(body.get("name", "")).strip()
            api_key = str(body.get("api_key", "")).strip()
            secret_key = str(body.get("secret_key", "")).strip()
            ca_path = str(body.get("ca_cert_path", "")).strip()
            ca_pass = str(body.get("ca_password", "")).strip()
            if not name:
                self.send_json_error(400, "名稱不可為空")
                return
            db = load_credentials()
            profiles = db["profiles"]
            if isinstance(index, int) and 0 <= index < len(profiles):
                # 修改既有設定檔；遮蔽格式或空值代表未變更，保留原值
                profile = profiles[index]
                profile["name"] = name
                profile["ca_cert_path"] = ca_path
                if api_key and not is_masked_value(api_key):
                    profile["api_key"] = api_key
                if secret_key and not is_masked_value(secret_key):
                    profile["secret_key"] = secret_key
                if ca_pass and not is_masked_value(ca_pass):
                    profile["ca_password"] = ca_pass
            else:
                # 新增設定檔：金鑰必填且不可為遮蔽格式
                if not api_key or is_masked_value(api_key):
                    self.send_json_error(400, "無效的 API Key")
                    return
                if not secret_key or is_masked_value(secret_key):
                    self.send_json_error(400, "無效的 Secret Key")
                    return
                profiles.append({
                    "name": name,
                    "api_key": api_key,
                    "secret_key": secret_key,
                    "ca_cert_path": ca_path,
                    "ca_password": "" if is_masked_value(ca_pass) else ca_pass,
                })
                index = len(profiles) - 1
            save_credentials(db)
            restarting = (index == db["active_index"])
            if restarting:
                # 更新的是啟用中設定 → 熱套用（寫 .env + 背景重啟）
                apply_active_profile(db)
            self._send_json({"ok": True, "index": index, "restarting": restarting})
        except Exception as e:
            self.send_json_error(500, f"儲存設定檔失敗: {e}")

    def handle_switch_credentials(self):
        try:
            body = self._read_json_body()
        except Exception as e:
            self.send_json_error(400, f"請求格式錯誤: {e}")
            return
        if not self._check_verification(body):
            return
        try:
            index = body.get("index")
            db = load_credentials()
            if not isinstance(index, int) or not (0 <= index < len(db["profiles"])):
                self.send_json_error(400, "無效的設定檔索引")
                return
            db["active_index"] = index
            save_credentials(db)
            apply_active_profile(db)
            self._send_json({"ok": True, "active_index": index, "restarting": True})
        except Exception as e:
            self.send_json_error(500, f"切換設定檔失敗: {e}")

    def handle_delete_credentials(self):
        try:
            body = self._read_json_body()
        except Exception as e:
            self.send_json_error(400, f"請求格式錯誤: {e}")
            return
        if not self._check_verification(body):
            return
        try:
            index = body.get("index")
            db = load_credentials()
            profiles = db["profiles"]
            if not isinstance(index, int) or not (0 <= index < len(profiles)):
                self.send_json_error(400, "無效的設定檔索引")
                return
            if len(profiles) <= 1:
                self.send_json_error(400, "不可刪除最後一組設定檔")
                return
            if index == db["active_index"]:
                self.send_json_error(400, "不可刪除啟用中的設定檔，請先切換至其他設定檔")
                return
            profiles.pop(index)
            if index < db["active_index"]:
                db["active_index"] -= 1
            save_credentials(db)
            self._send_json({"ok": True, "active_index": db["active_index"]})
        except Exception as e:
            self.send_json_error(500, f"刪除設定檔失敗: {e}")

    def _query_codes(self):
        """從 query string 解析 ?codes=2330,2317 參數。"""
        from urllib.parse import urlparse, parse_qs
        qs = parse_qs(urlparse(self.path).query)
        raw = qs.get('codes', [''])[0]
        return {c.strip() for c in raw.split(',') if c.strip()}

    def _send_json(self, obj, code=200):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps(obj, ensure_ascii=False).encode('utf-8'))

    def handle_us_chart(self):
        """美股行情查詢（Yahoo Finance 代理，代碼格式驗證 + 固定查詢組合）。"""
        from urllib.parse import urlparse, parse_qs
        try:
            qs = parse_qs(urlparse(self.path).query)
            symbol = qs.get('symbol', [''])[0].strip().upper()
            range_ = qs.get('range', ['1d'])[0]
            interval = qs.get('interval', ['5m'])[0]
            if not is_valid_us_symbol(symbol):
                self.send_json_error(400, f"無效的美股商品代碼格式: {symbol}")
                return
            if (range_, interval) not in US_ALLOWED_QUERIES:
                self.send_json_error(400, f"不支援的查詢組合: range={range_}, interval={interval}")
                return
            self._send_json(fetch_us_chart(symbol, range_, interval))
        except LookupError as e:
            self.send_json_error(404, str(e))
        except Exception as e:
            self.send_json_error(502, f"美股行情查詢失敗: {e}")

    def handle_twse_announcements(self):
        """自選股即時重大訊息（TWSE OpenAPI t187ap04_L，快取 10 分鐘）。"""
        try:
            codes = self._query_codes()
            rows = fetch_twse_json(TWSE_ANNOUNCEMENT_URL)
            result = []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                # TWSE 欄位名稱可能帶尾隨空白（如「主旨 」），統一去除
                r = {str(k).strip(): v for k, v in row.items()}
                code = str(r.get('公司代號', '')).strip()
                if codes and code not in codes:
                    continue
                result.append({
                    'code': code,
                    'name': r.get('公司名稱', ''),
                    'date': _roc_to_iso(r.get('發言日期', '')),
                    'time': str(r.get('發言時間', '')).zfill(6),
                    'subject': r.get('主旨', ''),
                    'clause': r.get('符合條款', ''),
                })
            result.sort(key=lambda x: (x['date'], x['time']), reverse=True)
            self._send_json(result)
        except Exception as e:
            self.send_json_error(500, f"TWSE 公告查詢失敗: {e}")

    def handle_twse_dividends(self):
        """自選股除權息預告（TWSE OpenAPI TWT48U_ALL，快取 10 分鐘）。"""
        try:
            codes = self._query_codes()
            rows = fetch_twse_json(TWSE_DIVIDEND_URL)
            result = []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                code = str(row.get('Code', '')).strip()
                if codes and code not in codes:
                    continue
                cash_raw = str(row.get('CashDividend', '')).strip()
                try:
                    cash = float(cash_raw) if cash_raw else None
                except ValueError:
                    cash = None
                result.append({
                    'code': code,
                    'name': row.get('Name', ''),
                    'date': _roc_to_iso(row.get('Date', '')),
                    'type': row.get('Exdividend', ''),
                    'cash_dividend': cash,
                    'stock_dividend_ratio': str(row.get('StockDividendRatio', '')).strip() or None,
                })
            result.sort(key=lambda x: x['date'])
            self._send_json(result)
        except Exception as e:
            self.send_json_error(500, f"TWSE 除權息查詢失敗: {e}")

    # ── 歷史資料匯入：嚴格 Schema 校驗，整批通過才寫入 ────────────────────
    MAX_IMPORT_BYTES = 1024 * 1024  # 1 MB 上限，防異常大檔

    def handle_import_history(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length <= 0 or content_length > self.MAX_IMPORT_BYTES:
                print("匯入拒絕：檔案大小不合法")
                self.send_json_error(400, "匯入拒絕：檔案為空或超過 1MB 上限")
                return
            raw = self.rfile.read(content_length)
            try:
                data = json.loads(raw.decode('utf-8'))
            except Exception:
                print("匯入拒絕：非合法 JSON")
                self.send_json_error(400, "匯入拒絕：檔案不是合法的 JSON 格式")
                return

            errors = self._validate_history_payload(data)
            if errors:
                print(f"匯入拒絕：{errors[0]}（共 {len(errors)} 項錯誤）")
                self.send_json_error(400, "匯入拒絕：" + "；".join(errors[:5]))
                return

            # 全部通過才合併寫入（_write_history 內含 .bak 備份）
            history_dict = self._read_history_dict()
            for item in data:
                history_dict[item['date']] = float(item['value'])
            self._write_history(history_dict)
            updated = [{"date": k, "value": v} for k, v in sorted(history_dict.items())]
            print(f"✅ 歷史資料匯入成功：{len(data)} 筆（合併後共 {len(updated)} 筆）")
            self._send_json(updated)
        except Exception as e:
            self.send_json_error(500, f"匯入處理異常: {e}")

    @staticmethod
    def _validate_history_payload(data):
        """回傳錯誤訊息清單；空清單代表通過。格式：[{date:'YYYY-MM-DD', value:number}, ...]"""
        import math
        errors = []
        if not isinstance(data, list):
            return ["最外層必須是 JSON 陣列 [{date, value}, ...]"]
        if len(data) == 0:
            return ["陣列不可為空"]
        if len(data) > 5000:
            return ["筆數超過 5000 筆上限"]
        for i, item in enumerate(data):
            if not isinstance(item, dict):
                errors.append(f"第 {i + 1} 筆不是物件")
                continue
            extra_keys = set(item.keys()) - {'date', 'value'}
            if extra_keys:
                errors.append(f"第 {i + 1} 筆含未知欄位 {sorted(extra_keys)}")
            date_str = item.get('date')
            if not isinstance(date_str, str):
                errors.append(f"第 {i + 1} 筆缺少 date 字串欄位")
            else:
                try:
                    datetime.strptime(date_str, "%Y-%m-%d")
                except ValueError:
                    errors.append(f"第 {i + 1} 筆日期格式錯誤（{date_str}，需為 YYYY-MM-DD）")
            val = item.get('value')
            if isinstance(val, bool) or not isinstance(val, (int, float)):
                errors.append(f"第 {i + 1} 筆缺少數值 value 欄位")
            elif not math.isfinite(val) or val < 0:
                errors.append(f"第 {i + 1} 筆 value 必須為非負的有限數值")
        return errors

    def handle_get_history(self):
        history = self._read_history()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(history).encode('utf-8'))

    def handle_post_history(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        try:
            data = json.loads(post_data.decode('utf-8'))
            date_str = data['date']
            val = float(data['value'])
            
            history_dict = self._read_history_dict()
            history_dict[date_str] = val
            
            # 為了防範導入大批歷史資料後被每日自動存檔（POST）截斷，
            # 只有在總筆數大於 3000 筆（約 8 年的每日資料）時，才啟動清理，只保留最近 3000 筆
            if len(history_dict) > 3000:
                sorted_dates = sorted(history_dict.keys(), reverse=True)
                history_dict = {k: history_dict[k] for k in sorted_dates[:3000]}

            self._write_history(history_dict)
            
            # Return sorted list
            updated_list = [{"date": k, "value": v} for k, v in sorted(history_dict.items())]
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(updated_list).encode('utf-8'))
        except Exception as e:
            self.send_error(400, f"Bad Request: {e}")

    def handle_delete_history(self, date_str):
        history_dict = self._read_history_dict()
        if date_str in history_dict:
            del history_dict[date_str]
            self._write_history(history_dict)
            
            updated_list = [{"date": k, "value": v} for k, v in sorted(history_dict.items())]
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(updated_list).encode('utf-8'))
        else:
            self.send_error(404, "Date not found")

    def _read_history(self):
        history_dict = self._read_history_dict()
        return [{"date": k, "value": v} for k, v in sorted(history_dict.items())]

    def _read_history_dict(self):
        if not HISTORY_FILE.exists():
            return {}
        try:
            with open(HISTORY_FILE, encoding='utf-8') as f:
                data = json.load(f)
                return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _write_history(self, data):
        try:
            if HISTORY_FILE.exists():
                shutil.copy2(HISTORY_FILE, HISTORY_FILE.with_name('asset_history.bak.json'))
            with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Error writing asset history: {e}")

# ── Main Thread and Launcher ──────────────────────────────────────────────
def run_web_server(server_port=8081):
    server_address = ('127.0.0.1', server_port)
    httpd = ThreadingHTTPServer(server_address, DashboardHandler)
    print(f"網頁伺服器已啟動，正在提供前端網頁服務：http://127.0.0.1:{server_port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()

def main():
    # 多組設定檔：不存在時自 .env 無縫升級建立第一組
    db = load_credentials()
    profile = db["profiles"][db["active_index"]]
    print(f"使用設定檔：[{db['active_index']}] {profile.get('name', '')}")

    # 先啟動網頁伺服器：即使 Shioaji 啟動失敗，設定頁面仍可修正金鑰（防鎖死）
    web_thread = threading.Thread(target=run_web_server, args=(8081,), daemon=True)
    web_thread.start()

    started = start_shioaji_server(profile_env(profile))

    if started:
        # Wait for Shioaji server initialization
        print("正在等待 Shioaji API 伺服器初始化...")
        import urllib.request as _ur
        for _ in range(30):
            try:
                _ur.urlopen("http://127.0.0.1:8080/api/v1/auth/usage", timeout=1)
                print("[OK] Shioaji API 伺服器已就緒")
                break
            except Exception:
                time.sleep(1)
        else:
            print("[WARN] 等待 Shioaji API 伺服器逾時，繼續嘗試開啟瀏覽器...")
    
    # Auto-open browser
    print("正在自動開啟瀏覽器至 http://127.0.0.1:8081...")
    webbrowser.open("http://127.0.0.1:8081")
    
    print("\n" + "="*50)
    print("永豐證券交易儀表板已成功運行！")
    print("前端網頁網址：http://127.0.0.1:8081")
    print("API 伺服器網址：http://127.0.0.1:8080")
    print("請在此主控台按下 Ctrl+C 以停止所有服務。")
    print("="*50 + "\n")
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n正在停止服務...")
    finally:
        # Cleanly stop Shioaji API server
        with shioaji_proc_lock:
            if shioaji_proc is not None:
                shioaji_proc.terminate()
                try:
                    shioaji_proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    shioaji_proc.kill()
        print("所有程序已安全停止。謝謝使用！")

if __name__ == "__main__":
    main()
