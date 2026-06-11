"""
永豐證券持倉監控腳本
使用方式：
  python monitor.py
  python monitor.py --interval 30
"""

import os
import time
import argparse
from pathlib import Path
from datetime import datetime


def load_env():
    env_path = Path(__file__).parent / ".env"
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


# ── 格式化輸出 ─────────────────────────────────────────────────
def fmt_pnl(pnl: float) -> str:
    sign = "+" if pnl >= 0 else ""
    color = "\033[92m" if pnl >= 0 else "\033[91m"
    reset = "\033[0m"
    return f"{color}{sign}{pnl:,.0f}{reset}"


def print_header(title: str):
    print(f"\n\033[1m{'─' * 60}\033[0m")
    print(f"\033[1m  {title}\033[0m")
    print(f"{'─' * 60}")


def print_stock_positions(positions):
    if not positions:
        print("  （無持股）")
        return
    print(f"  {'代碼':<8} {'方向':<6} {'數量':>6} {'均價':>10} {'現價':>10} {'損益':>12} {'交易條件'}")
    print(f"  {'─'*8} {'─'*6} {'─'*6} {'─'*10} {'─'*10} {'─'*12} {'─'*8}")
    for p in positions:
        print(f"  {p.code:<8} {p.direction.value:<6} {p.quantity:>6} "
              f"{p.price:>10.2f} {p.last_price:>10.2f} "
              f"{fmt_pnl(p.pnl):>20} {p.cond.value}")


def print_future_positions(positions):
    if not positions:
        print("  （無部位）")
        return
    print(f"  {'代碼':<22} {'方向':<6} {'數量':>5} {'均價':>10} {'現價':>10} {'損益':>12}")
    print(f"  {'─'*22} {'─'*6} {'─'*5} {'─'*10} {'─'*10} {'─'*12}")
    for p in positions:
        print(f"  {p.code:<22} {p.direction.value:<6} {p.quantity:>5} "
              f"{p.price:>10.2f} {p.last_price:>10.2f} "
              f"{fmt_pnl(p.pnl):>20}")


# ── 主監控邏輯 ────────────────────────────────────────────────
def fetch_and_display(api):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"\n\033[1m永豐持倉監控\033[0m  更新時間：{now}")

    # 現貨帳戶餘額
    try:
        bal = api.account_balance()
        print_header("現貨帳戶餘額")
        print(f"  餘額：{bal.acc_balance:>12,.0f} TWD")
        if bal.errmsg:
            print(f"  ⚠ {bal.errmsg}")
    except Exception as e:
        print_header("現貨帳戶餘額")
        print(f"  ⚠ 查詢失敗：{e}")

    # 股票持倉
    try:
        stock_pos = api.list_positions(account=api.stock_account)
        print_header("股票持倉（整股）")
        print_stock_positions(stock_pos)

        from shioaji import Unit
        share_pos = api.list_positions(account=api.stock_account, unit=Unit.Share)
        # Unit.Share 把整股也換算成股數（1張=1000股），用 % 1000 != 0 判斷是否含零股
        odd_positions = [p for p in share_pos if p.quantity % 1000 != 0]
        if odd_positions:
            print_header("股票持倉（含零股，以股為單位）")
            print_stock_positions(odd_positions)
    except Exception as e:
        print(f"  ⚠ 查詢股票持倉失敗：{e}")

    # 期貨保證金與持倉（只在有期貨帳戶時查詢）
    if api.futopt_account:
        try:
            margin = api.margin()
            print_header("期貨保證金")
            print(f"  今日餘額：   {margin.today_balance:>12,.0f} TWD")
            print(f"  原始保證金： {margin.initial_margin:>12,.0f} TWD")
            print(f"  維持保證金： {margin.maintenance_margin:>12,.0f} TWD")
            print(f"  可動用保證金：{margin.available_margin:>11,.0f} TWD")
            print(f"  風險指標：   {margin.risk_indicator:>12.2f} %")
            print(f"  未沖銷期貨浮動損益：{fmt_pnl(margin.future_open_position):>18}")
        except Exception as e:
            print(f"  ⚠ 查詢期貨保證金失敗：{e}")

        try:
            fut_pos = api.list_positions(account=api.futopt_account)
            print_header("期貨／選擇權持倉")
            print_future_positions(fut_pos)
        except Exception as e:
            print(f"  ⚠ 查詢期貨持倉失敗：{e}")

    print(f"\n{'─' * 60}\n")


def main():
    parser = argparse.ArgumentParser(description="永豐持倉監控")
    parser.add_argument("--interval", type=int, default=0,
                        help="自動刷新間隔（秒），0 = 只執行一次")
    args = parser.parse_args()

    env = load_env()

    import shioaji as sj

    print("🔐 登入永豐 API...")
    api = sj.Shioaji(simulation=False)
    try:
        api.login(
            api_key=env["API_KEY"],
            secret_key=env["SECRET_KEY"],
        )
        print("✅ 登入成功")
    except Exception as e:
        print(f"❌ 登入失敗：{e}")
        return

    # 啟用憑證
    try:
        ca_path = Path(env["CA_CERT_PATH"])
        if not ca_path.is_absolute():
            ca_path = (Path(__file__).parent / ca_path).resolve()
        result = api.activate_ca(
            ca_path=str(ca_path),
            ca_passwd=env["CA_PASSWORD"],
        )
        print(f"🔑 憑證啟用：{result}")
    except Exception as e:
        print(f"⚠ 憑證啟用失敗：{e}")

    print("⏳ 等待 session 建立...")
    for _ in range(30):
        try:
            api.account_balance()
            break
        except Exception:
            time.sleep(1)
    else:
        print("⚠ Session 建立逾時，繼續嘗試查詢...")

    try:
        if args.interval > 0:
            print(f"📡 每 {args.interval} 秒刷新一次，按 Ctrl+C 停止\n")
            while True:
                fetch_and_display(api)
                time.sleep(args.interval)
        else:
            fetch_and_display(api)
    except KeyboardInterrupt:
        print("\n⏹ 監控已停止")
    except Exception as e:
        print(f"\n❌ 發生錯誤：{e}")
    finally:
        try:
            api.logout()
            print("👋 已登出")
        except Exception:
            pass


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n❌ 發生錯誤：{e}")
    input("\n按 Enter 關閉...")
