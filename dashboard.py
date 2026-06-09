"""
SinoPac API Stock Dashboard Orchestrator
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
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith('/proxy/'):
            self.handle_proxy_request("POST")
        elif self.path == '/api/asset-history':
            self.handle_post_history()
        elif self.path == '/api/remote-log':
            self.handle_remote_log()
        else:
            self.send_error(404, "Not Found")

    def handle_remote_log(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        try:
            data = json.loads(post_data.decode('utf-8'))
            log_type = data.get('type', 'LOG')
            message = data.get('message', '')
            print(f"[瀏覽器 {log_type.upper()}] {message}")
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        except Exception as e:
            print(f"處理遠端日誌出錯: {e}")
            self.send_error(400, "Bad Request")

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
        
        content_length = int(self.headers.get('Content-Length', 0))
        req_data = self.rfile.read(content_length) if content_length > 0 else None
        
        headers = {
            "Content-Type": self.headers.get("Content-Type", "application/json")
        }
        
        req = urllib.request.Request(target_url, data=req_data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                resp_data = resp.read()
                self.send_response(resp.status)
                self.send_header('Content-Type', resp.headers.get('Content-Type', 'application/json'))
                self.end_headers()
                self.wfile.write(resp_data)
        except urllib.error.HTTPError as e:
            try:
                err_data = e.read()
                self.send_response(e.code)
                self.send_header('Content-Type', e.headers.get('Content-Type', 'application/json'))
                self.end_headers()
                self.wfile.write(err_data)
            except Exception as ex:
                self.send_json_error(e.code, str(ex))
        except Exception as e:
            self.send_json_error(500, f"Proxy error: {e}")

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
            
            # Prune records older than 90 days
            cutoff = datetime.now() - timedelta(days=90)
            pruned_dict = {}
            for k, v in history_dict.items():
                try:
                    dt = datetime.strptime(k, "%Y-%m-%d")
                    if dt >= cutoff:
                        pruned_dict[k] = v
                except ValueError:
                    pass
            
            self._write_history(pruned_dict)
            
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
        run_env["SJ_CA_PATH"] = str(ca_path.resolve())
    
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
    print("正在等待 Shioaji API 伺服器初始化（預估 8 秒）...")
    time.sleep(8)
    
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
