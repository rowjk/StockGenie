# -*- coding: utf-8 -*-
"""dashboard.py 純邏輯單元測試（v1.10.0）。

執行：python -m unittest discover tests -v
原則：每組測試對應一個「改壞會賠錢或洩密」的業務意圖，不只驗證現行為。
不啟動 HTTP server、不碰網路與 shioaji。
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import dashboard  # noqa: E402


class TestTradePermission(unittest.TestCase):
    """下單權限：任何一道閘門失守都可能用錯誤的帳戶送出真實委託。"""

    BASE = {"API_KEY": "normal-key", "CA_CERT_PATH": "Sinopac.pfx", "CA_PASSWORD": "x"}

    def test_fully_configured_key_can_trade(self):
        ok, reason = dashboard.evaluate_trade_permission(dict(self.BASE))
        self.assertTrue(ok)
        self.assertEqual(reason, "")

    def test_trading_enabled_false_blocks_everything(self):
        # 使用者明確關閉下單 → 即使金鑰與憑證齊全也必須擋
        env = dict(self.BASE, TRADING_ENABLED="False")
        ok, reason = dashboard.evaluate_trade_permission(env)
        self.assertFalse(ok)
        self.assertIn("TRADING_ENABLED", reason)

    def test_read_only_key_blocked_via_env_list(self):
        # 唯讀金鑰清單改自 .env 載入（v1.10.0 不再硬編碼）；清單內金鑰禁止下單
        env = dict(self.BASE, API_KEY="ro-key",
                   READ_ONLY_API_KEYS=" ro-key , other-key ")
        ok, reason = dashboard.evaluate_trade_permission(env)
        self.assertFalse(ok)
        self.assertIn("read-only", reason)

    def test_missing_ca_cert_blocks_trading(self):
        # 無 CA 憑證時簽章必失敗，預先擋下避免送出注定被拒的單
        for missing in ("CA_CERT_PATH", "CA_PASSWORD"):
            env = dict(self.BASE)
            env[missing] = ""
            ok, _ = dashboard.evaluate_trade_permission(env)
            self.assertFalse(ok, f"{missing} 為空仍允許下單")

    def test_empty_read_only_list_does_not_block(self):
        # READ_ONLY_API_KEYS 空字串不得誤判（split(',') 會產生空元素）
        env = dict(self.BASE, READ_ONLY_API_KEYS="")
        ok, _ = dashboard.evaluate_trade_permission(env)
        self.assertTrue(ok)


class TestSameOriginGuard(unittest.TestCase):
    """同源防護常數：白名單收錄錯誤會讓 CSRF 防線形同虛設或把自己鎖在門外。"""

    def test_allowed_hosts_cover_both_local_names(self):
        # 使用者可能以 127.0.0.1 或 localhost 開啟頁面，兩者都必須放行
        self.assertIn("127.0.0.1:8081", dashboard.ALLOWED_HOSTS)
        self.assertIn("localhost:8081", dashboard.ALLOWED_HOSTS)

    def test_foreign_host_not_allowed(self):
        # DNS rebinding：evil.com 解析到 127.0.0.1 時，Host header 仍是 evil.com
        self.assertNotIn("evil.com:8081", dashboard.ALLOWED_HOSTS)

    def test_origins_are_http_of_allowed_hosts(self):
        self.assertEqual(
            dashboard.ALLOWED_ORIGINS,
            {f"http://{h}" for h in dashboard.ALLOWED_HOSTS},
        )


class TestHistoryImportValidation(unittest.TestCase):
    """資產歷史匯入：整批通過才寫入，壞資料混入會汙染長期趨勢圖。"""

    V = staticmethod(dashboard.DashboardHandler._validate_history_payload)

    def test_valid_payload_passes(self):
        self.assertEqual(self.V([{"date": "2026-01-02", "value": 1234.5}]), [])

    def test_rejects_non_list_and_empty(self):
        self.assertTrue(self.V({"date": "2026-01-02", "value": 1}))
        self.assertTrue(self.V([]))

    def test_rejects_bad_date_format(self):
        # 非 YYYY-MM-DD 會破壞以字串排序為前提的歷史合併邏輯
        for bad in ("2026/01/02", "20260102", "2026-13-01", "近期"):
            self.assertTrue(self.V([{"date": bad, "value": 1}]), f"{bad} 未被拒絕")

    def test_rejects_non_finite_negative_and_bool_values(self):
        # 資產值必須為非負有限數；bool 是 int 子類，須明確排除
        for bad in (float("nan"), float("inf"), -1, True):
            self.assertTrue(self.V([{"date": "2026-01-02", "value": bad}]), f"{bad!r} 未被拒絕")

    def test_rejects_unknown_fields_and_over_limit(self):
        self.assertTrue(self.V([{"date": "2026-01-02", "value": 1, "x": 2}]))
        big = [{"date": "2026-01-02", "value": 1}] * 5001
        self.assertTrue(self.V(big))


class TestMasking(unittest.TestCase):
    """金鑰遮蔽：遮蔽輸出會回流到「儲存」請求，誤存遮蔽字串等於弄丟金鑰。"""

    def test_mask_api_key_keeps_prefix_suffix_only(self):
        masked = dashboard.mask_api_key("ABCDEF0123456789WXYZ")
        self.assertEqual(masked, "ABCDEF...WXYZ")

    def test_short_key_fully_masked(self):
        # 短金鑰若仍保留前後段，等於整把外洩
        self.assertEqual(dashboard.mask_api_key("short"), "●" * 8)

    def test_mask_fixed_hides_length(self):
        # 固定長度遮蔽：不可洩漏密碼長度
        self.assertEqual(dashboard.mask_fixed("a"), "●" * 8)
        self.assertEqual(dashboard.mask_fixed("a" * 40), "●" * 8)
        self.assertEqual(dashboard.mask_fixed(""), "")

    def test_masked_value_roundtrip_detected(self):
        # 遮蔽後的字串必須被 is_masked_value 識別 → 儲存時保留原值而非覆寫
        for v in (dashboard.mask_api_key("ABCDEF0123456789WXYZ"),
                  dashboard.mask_fixed("secret")):
            self.assertTrue(dashboard.is_masked_value(v), f"{v!r} 未被識別為遮蔽格式")


class TestRocDateConversion(unittest.TestCase):
    """民國日期轉換：TWSE 公告/除權息排序依賴 ISO 格式。"""

    def test_standard_conversion(self):
        self.assertEqual(dashboard._roc_to_iso("1150420"), "2026-04-20")

    def test_malformed_returns_original(self):
        # 轉換失敗回原值（顯示原始字串優於丟例外中斷整批公告）
        for bad in ("", "abc", "115042", None, 1150420.5):
            self.assertEqual(dashboard._roc_to_iso(bad), bad)


class TestUsSymbolValidation(unittest.TestCase):
    """美股代碼驗證：這是 Yahoo 代理唯一的輸入閘門，放寬即成開放代理。"""

    def test_accepts_known_forms(self):
        for s in ("VOO", "^GSPC", "BRK-B", "ES=F", "BF.B"):
            self.assertTrue(dashboard.is_valid_us_symbol(s), s)

    def test_rejects_injection_and_garbage(self):
        for s in ("", "A" * 13, "../etc", "AAPL/1d", "AAPL?x=1", "AAPL&b=2", "中文"):
            self.assertFalse(dashboard.is_valid_us_symbol(s), s)


class TestDpapi(unittest.TestCase):
    """DPAPI 包裝層：格式辨識與降級行為。真實加解密 roundtrip 僅能在 Windows 驗證。"""

    def test_prefix_detected(self):
        import dpapi
        self.assertTrue(dpapi.is_encrypted(dpapi.ENC_PREFIX + "QUJD"))
        self.assertFalse(dpapi.is_encrypted("plain-secret"))
        self.assertFalse(dpapi.is_encrypted(""))

    def test_plaintext_passthrough_on_decrypt(self):
        # 向後相容：明文舊檔（無前綴）原樣返回，不得報錯
        import dpapi
        self.assertEqual(dpapi.decrypt_str("legacy-plain"), "legacy-plain")
        self.assertEqual(dpapi.decrypt_str(""), "")

    def test_encrypted_format_not_mistaken_for_masked(self):
        # 加密格式若被 is_masked_value 誤判，儲存時會錯誤保留舊值
        import dpapi
        sample = dpapi.ENC_PREFIX + "QUJDREVGRw=="
        self.assertFalse(dashboard.is_masked_value(sample))

    def test_double_encrypt_is_noop(self):
        import dpapi
        sample = dpapi.ENC_PREFIX + "QUJD"
        self.assertEqual(dpapi.encrypt_str(sample), sample)

    @unittest.skipUnless(sys.platform == "win32", "DPAPI 僅 Windows")
    def test_roundtrip_windows(self):
        import dpapi
        secret = "測試secret-123!@#"
        enc = dpapi.encrypt_str(secret)
        self.assertTrue(dpapi.is_encrypted(enc))
        self.assertNotIn(secret, enc)
        self.assertEqual(dpapi.decrypt_str(enc), secret)

    @unittest.skipUnless(sys.platform == "win32", "DPAPI 僅 Windows")
    def test_save_credentials_never_writes_plaintext_secret(self):
        # 落地檔案絕不可含明文 secret——這是本功能存在的理由
        import json
        import tempfile
        from pathlib import Path
        db = {"active_index": 0, "profiles": [{
            "name": "t", "api_key": "AK", "secret_key": "PLAINTEXT-SECRET",
            "ca_cert_path": "x.pfx", "ca_password": "PLAINTEXT-PW"}]}
        orig = dashboard.CREDENTIALS_FILE
        try:
            with tempfile.TemporaryDirectory() as td:
                dashboard.CREDENTIALS_FILE = Path(td) / "credentials.json"
                dashboard.save_credentials(db)
                raw = dashboard.CREDENTIALS_FILE.read_text(encoding="utf-8")
                self.assertNotIn("PLAINTEXT-SECRET", raw)
                self.assertNotIn("PLAINTEXT-PW", raw)
                # 記憶體中的 db 不得被改成密文（深複製驗證）
                self.assertEqual(db["profiles"][0]["secret_key"], "PLAINTEXT-SECRET")
                # 讀回後自動解密
                loaded = json.loads(raw)
                import dpapi
                self.assertEqual(dpapi.decrypt_str(loaded["profiles"][0]["secret_key"]),
                                 "PLAINTEXT-SECRET")
        finally:
            dashboard.CREDENTIALS_FILE = orig


if __name__ == "__main__":
    unittest.main()
