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

WORKSPACE_DIR = Path(__file__).parent.resolve()
WEB_DIR = WORKSPACE_DIR / "web"
HISTORY_FILE = WORKSPACE_DIR / "asset_history.json"

# ── TWSE OpenAPI 來源與快取 ──────────────────────────────────────────────
TWSE_ANNOUNCEMENT_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap04_L"
TWSE_DIVIDEND_URL = "https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL"
TWSE_CACHE_TTL = 600  # 10 分鐘，避免高頻打 TWSE 公開 API
_twse_cache = {}      # url -> (fetched_at_epoch, parsed_json)
_twse_cache_lock = threading.Lock()
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
                with _twse_needs_relaxed_ssl_lock if 'show_warning' in globals() else _twse_cache_lock:
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
        elif self.path.startswith('/api/twse-announcements'):
            self.handle_twse_announcements()
        elif self.path.startswith('/api/twse-dividends'):
            self.handle_twse_dividends()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith('/proxy/'):
            self.handle_proxy_request("POST")
        elif self.path == '/api/asset-history/import':
            self.handle_import_history()
        elif self.path == '/api/asset-history':
            self.handle_post_history()
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
        if method == "POST" and rel_path == "api/v1/order/place_order":
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
            # 只有在總筆數大於 1000 筆時，才啟動過期清理，且清理範圍放寬至 365 天（1年），至少保留 10 筆
            if len(history_dict) > 1000:
                cutoff = datetime.now() - timedelta(days=365)
                pruned_dict = {}
                for k, v in history_dict.items():
                    try:
                        dt = datetime.strptime(k, "%Y-%m-%d")
                        if dt >= cutoff:
                            pruned_dict[k] = v
                    except ValueError:
                        pass

                if len(pruned_dict) < 10:
                    # 清理後不足 10 筆：改取全部紀錄中最近的 10 筆（按日期遞減）
                    recent = sorted(history_dict.keys(), reverse=True)[:10]
                    pruned_dict = {k: history_dict[k] for k in recent}
                history_dict = pruned_dict

            self._write_history(history_dict)
            
            # Return sorted list
            updated_list = [{"date": k, "value": v} for k, v in sorted(pruned_dict.items())]
            
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
    env = load_env()
    
    # Map environment variables for Shioaji Server
    run_env = os.environ.copy()
    run_env["SJ_API_KEY"] = env.get("API_KEY", "")
    run_env["SJ_SEC_KEY"] = env.get("SECRET_KEY", "")
    
    ca_cert = env.get("CA_CERT_PATH", "")
    if ca_cert:
        ca_path = Path(ca_cert)
        if not ca_path.is_absolute():
            ca_path = WORKSPACE_DIR / ca_path
        if not ca_path.exists():
            # 黃色警告：憑證遺失只影響下單，不中斷伺服器啟動
            print(f"\033[93m⚠ 警告：找不到 CA 憑證檔案：{ca_path.resolve()}\n"
                  f"  行情查詢不受影響，但「下單」將因簽章失敗而無法使用。\n"
                  f"  請確認 .env 中 CA_CERT_PATH 設定是否正確。\033[0m")
        run_env["SJ_CA_PATH"] = str(ca_path.resolve())
    else:
        print("\033[93m⚠ 警告：.env 未設定 CA_CERT_PATH，下單功能將無法使用（僅供行情查詢）。\033[0m")
    
    run_env["SJ_CA_PASSWD"] = env.get("CA_PASSWORD", "")
    run_env["SJ_PRODUCTION"] = "true"  # Run in production mode by default

    # Start Shioaji API server
    try:
        shioaji_bin = resolve_shioaji_bin()
    except Exception as e:
        print(f"錯誤：{e}")
        input("請按 Enter 鍵關閉視窗...")
        return
        
    print(f"正在啟動 Shioaji API 伺服器，執行檔路徑：{shioaji_bin}")
    
    # Start the daemon / server
    api_proc = subprocess.Popen(
        [shioaji_bin, "server", "start", "--no-open"],
        env=run_env
    )
    
    # Start web server thread
    web_thread = threading.Thread(target=run_web_server, args=(8081,), daemon=True)
    web_thread.start()
    
    # Wait for Shioaji server initialization
    print("正在等待 Shioaji API 伺服器初始化...")
    import urllib.request as _ur
    for _ in range(30):
        try:
            _ur.urlopen("http://127.0.0.1:8080/api/v1/auth/usage", timeout=1)
            print("✅ Shioaji API 伺服器已就緒")
            break
        except Exception:
            time.sleep(1)
    else:
        print("⚠ 等待 Shioaji API 伺服器逾時，繼續嘗試開啟瀏覽器...")
    
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
        api_proc.terminate()
        try:
            api_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            api_proc.kill()
        print("所有程序已安全停止。謝謝使用！")

if __name__ == "__main__":
    main()
