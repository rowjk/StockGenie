# 專案協作規則（Claude 必讀）

## Git
- **未經 James 明確指令，不得 `git push`。** commit 可以照常在本地做。
- Push 與 Windows 實機操作走 Desktop Commander（本機有 git 憑證）；沙箱內無憑證。

## 開發守則
- 任何程式修改必須同步更新版本號（`web/index.html` footer + `README.md` 版本紀錄）並先跑過 `python -m unittest discover tests`。
- 機密（SECRET_KEY / CA_PASSWORD）以 DPAPI 加密落地（`dpapi.py`），絕不可明文寫入檔案或印出。

## 環境注意
- Cowork 沙箱掛載寫入偶發「檔案尾端截斷」：每次寫完 .py/.js 後必須驗證（py_compile / node --check + 檢查檔尾），發現截斷立即重建尾段。
- 沙箱掛載無法 unlink 檔案；git lock 殘留時改名移開（或改由 Desktop Commander 在 Windows 端操作 git）。
