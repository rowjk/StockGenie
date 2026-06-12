# -*- coding: utf-8 -*-
"""Windows DPAPI 字串加解密（v1.11.0，dashboard.py 與 monitor.py 共用）。

設計原則：
* 以 ctypes 呼叫 CryptProtectData/CryptUnprotectData，不需安裝 pywin32。
* CurrentUser 範圍：密文綁定「Windows 登入帳戶」，同帳戶可解、他人/他機不可解。
* 加密格式 "enc:dpapi:v1:<base64>"——前綴可辨識，與遮蔽格式（●/.../*）不衝突。
* 非 Windows 平台：encrypt 原樣返回（開發/測試環境直通），decrypt 遇密文明確報錯。
* 解密失敗（換 Windows 帳戶/重灌）：拋 ValueError，由呼叫端決定降級行為，不靜默。
"""
import base64
import sys

ENC_PREFIX = "enc:dpapi:v1:"
_IS_WINDOWS = sys.platform == "win32"


def is_encrypted(val):
    return isinstance(val, str) and val.startswith(ENC_PREFIX)


if _IS_WINDOWS:
    import ctypes
    import ctypes.wintypes as wt

    class _DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", wt.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    _crypt32 = ctypes.windll.crypt32
    _kernel32 = ctypes.windll.kernel32
    _CRYPTPROTECT_UI_FORBIDDEN = 0x01

    def _blob_to_bytes(blob):
        try:
            return ctypes.string_at(blob.pbData, blob.cbData)
        finally:
            _kernel32.LocalFree(blob.pbData)

    def _bytes_to_blob(data):
        buf = ctypes.create_string_buffer(data, len(data))
        return _DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_byte)))

    def _protect(data: bytes) -> bytes:
        blob_in = _bytes_to_blob(data)
        blob_out = _DATA_BLOB()
        if not _crypt32.CryptProtectData(ctypes.byref(blob_in), None, None, None,
                                         None, _CRYPTPROTECT_UI_FORBIDDEN,
                                         ctypes.byref(blob_out)):
            raise OSError("CryptProtectData 失敗")
        return _blob_to_bytes(blob_out)

    def _unprotect(data: bytes) -> bytes:
        blob_in = _bytes_to_blob(data)
        blob_out = _DATA_BLOB()
        if not _crypt32.CryptUnprotectData(ctypes.byref(blob_in), None, None, None,
                                           None, _CRYPTPROTECT_UI_FORBIDDEN,
                                           ctypes.byref(blob_out)):
            raise OSError("CryptUnprotectData 失敗")
        return _blob_to_bytes(blob_out)


def encrypt_str(plain):
    """明文 → "enc:dpapi:v1:<b64>"。空值或已加密原樣返回；非 Windows 直通返回明文。"""
    if not plain or is_encrypted(plain):
        return plain
    if not _IS_WINDOWS:
        return plain
    raw = _protect(plain.encode("utf-8"))
    return ENC_PREFIX + base64.b64encode(raw).decode("ascii")


def decrypt_str(val):
    """"enc:dpapi:v1:<b64>" → 明文。非加密格式原樣返回（向後相容明文舊檔）。

    失敗時拋 ValueError（含人話原因），呼叫端自行決定降級，不可吞掉。
    """
    if not is_encrypted(val):
        return val
    if not _IS_WINDOWS:
        raise ValueError("此值以 Windows DPAPI 加密，僅能在加密當時的 Windows 帳戶下解密")
    try:
        raw = base64.b64decode(val[len(ENC_PREFIX):])
        return _unprotect(raw).decode("utf-8")
    except Exception as e:
        raise ValueError(
            "DPAPI 解密失敗——此檔案可能是在其他 Windows 使用者帳戶（或重灌前的系統）加密的。"
            f"請在設定頁重新輸入金鑰。原因：{e}"
        ) from e
