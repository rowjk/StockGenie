// credentials.js — API 憑證多組管理與重啟遮罩（v1.10.0 自 app.js 拆出；普通 script）
// 依賴：app.js 的 LOCAL_API_BASE/showToastNotification、demo.js 的 smartFetch（執行期呼叫）

// ── API 憑證多組管理 (v1.6.0) ──────────────────────────────────────────────
let credentialsCache = { active_index: 0, profiles: [] };
let credEditIndex = -1; // -1 = 新增模式
let restartPollTimer = null;

function initCredentialsMgmt() {
    document.getElementById('btn-add-credential').addEventListener('click', () => openCredentialForm(-1));
    document.getElementById('btn-cred-cancel').addEventListener('click', hideCredentialForm);
    document.getElementById('btn-cred-save').addEventListener('click', () => {
        const name = document.getElementById('cred-name').value.trim();
        if (!name) {
            showToastNotification('設定名稱不可為空。');
            return;
        }
        openCredentialsLockModal(saveCredentialForm);
    });
    document.getElementById('btn-restart-force-unlock').addEventListener('click', hideRestartOverlay);
}

async function loadCredentials() {
    const statusEl = document.getElementById('credentials-status');
    try {
        const resp = await fetch(`${LOCAL_API_BASE}/credentials`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        credentialsCache = await resp.json();
        renderCredentialsTable();
        if (statusEl) statusEl.textContent = `共 ${credentialsCache.profiles.length} 組設定`;
    } catch (e) {
        console.error('[憑證] 讀取設定檔清單失敗', e);
        if (statusEl) statusEl.textContent = '讀取失敗';
    }
}

function renderCredentialsTable() {
    const tbody = document.querySelector('#credentials-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    credentialsCache.profiles.forEach((p, i) => {
        const isActive = i === credentialsCache.active_index;
        const caName = p.ca_cert_path ? p.ca_cert_path.split(/[\\/]/).pop() : '--';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${isActive ? '<span style="color: var(--color-accent); font-weight: 600;">● 使用中</span>' : ''}</td>
            <td>${escapeHtml(p.name || '')}</td>
            <td class="mono">${escapeHtml(p.api_key || '--')}</td>
            <td class="mono" title="${escapeHtml(p.ca_cert_path || '')}">${escapeHtml(caName)}</td>
            <td class="cred-actions"></td>
        `;
        const actionTd = tr.querySelector('.cred-actions');
        if (!isActive) {
            const btnSwitch = document.createElement('button');
            btnSwitch.className = 'btn-secondary btn-table-action';
            btnSwitch.textContent = '切換使用';
            btnSwitch.onclick = () => openCredentialsLockModal(() => doSwitchCredential(i));
            actionTd.appendChild(btnSwitch);
        }
        const btnEdit = document.createElement('button');
        btnEdit.className = 'btn-secondary btn-table-action';
        btnEdit.textContent = '編輯';
        btnEdit.onclick = () => openCredentialForm(i);
        actionTd.appendChild(btnEdit);
        const btnDel = document.createElement('button');
        btnDel.className = 'btn-secondary btn-table-action';
        btnDel.textContent = '刪除';
        btnDel.onclick = () => {
            // 前端先擋（後端亦有同樣校驗）
            if (credentialsCache.profiles.length <= 1) {
                showToastNotification('不可刪除最後一組設定檔。');
                return;
            }
            if (i === credentialsCache.active_index) {
                showToastNotification('不可刪除啟用中的設定檔，請先切換至其他設定檔。');
                return;
            }
            openCredentialsLockModal(() => doDeleteCredential(i));
        };
        actionTd.appendChild(btnDel);
        tbody.appendChild(tr);
    });
}

function openCredentialForm(index) {
    credEditIndex = index;
    const p = index >= 0 ? credentialsCache.profiles[index] : null;
    document.getElementById('credential-form-title').textContent = p ? `編輯設定檔：${p.name}` : '新增設定檔';
    document.getElementById('cred-name').value = p ? (p.name || '') : '';
    // 編輯時帶入遮蔽值：維持遮蔽（或留空）代表不變更，後端會保留原值
    document.getElementById('cred-api-key').value = p ? (p.api_key || '') : '';
    document.getElementById('cred-secret-key').value = p ? (p.secret_key || '') : '';
    document.getElementById('cred-ca-path').value = p ? (p.ca_cert_path || '') : '';
    document.getElementById('cred-ca-password').value = p ? (p.ca_password || '') : '';
    document.getElementById('credential-form-wrap').style.display = 'block';
}

function hideCredentialForm() {
    credEditIndex = -1;
    document.getElementById('credential-form-wrap').style.display = 'none';
}

async function postCredentials(path, payload, failPrefix) {
    const resp = await fetch(`${LOCAL_API_BASE}/credentials/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, verification_code: 'PEA6' }),
    });
    let data = {};
    try { data = await resp.json(); } catch (e) { /* 非 JSON 回應 */ }
    if (!resp.ok) throw new Error(data.error || `${failPrefix}（HTTP ${resp.status}）`);
    return data;
}

async function saveCredentialForm() {
    const payload = {
        index: credEditIndex,
        name: document.getElementById('cred-name').value.trim(),
        api_key: document.getElementById('cred-api-key').value.trim(),
        secret_key: document.getElementById('cred-secret-key').value.trim(),
        ca_cert_path: document.getElementById('cred-ca-path').value.trim(),
        ca_password: document.getElementById('cred-ca-password').value.trim(),
    };
    try {
        const data = await postCredentials('save', payload, '儲存失敗');
        showToastNotification('設定檔已儲存。');
        hideCredentialForm();
        if (data.restarting) showRestartOverlay();
        await loadCredentials();
    } catch (e) {
        showToastNotification(`儲存失敗：${e.message}`);
    }
}

async function doSwitchCredential(index) {
    const target = credentialsCache.profiles[index];
    try {
        await postCredentials('switch', { index }, '切換失敗');
        showToastNotification(`已切換至「${target ? target.name : index}」，交易伺服器重啟中...`);
        showRestartOverlay();
        await loadCredentials();
    } catch (e) {
        showToastNotification(`切換失敗：${e.message}`);
    }
}

async function doDeleteCredential(index) {
    const target = credentialsCache.profiles[index];
    try {
        await postCredentials('delete', { index }, '刪除失敗');
        showToastNotification(`設定檔「${target ? target.name : index}」已刪除。`);
        await loadCredentials();
    } catch (e) {
        showToastNotification(`刪除失敗：${e.message}`);
    }
}

// 變更設定安全驗證 Modal（與系統設定鎖共用題型：洗牌選項中選出 PEA6）
function openCredentialsLockModal(onSuccess) {
    const overlay = document.getElementById('credentials-lock-modal-overlay');
    const select = document.getElementById('credentials-lock-select');
    const errorEl = document.getElementById('credentials-lock-error');
    const submitBtn = document.getElementById('btn-credentials-lock-submit');
    const cancelBtn = document.getElementById('btn-credentials-lock-cancel');
    if (!overlay || !select || !errorEl) return;

    errorEl.style.display = 'none';
    select.innerHTML = '<option value="">-- 請選擇正確答案 --</option>';

    const correctAnswer = 'PEA6';
    const options = [correctAnswer, ...generateIncorrectAnswers()];
    for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
    }
    options.forEach(opt => {
        const op = document.createElement('option');
        op.value = opt;
        op.textContent = opt;
        select.appendChild(op);
    });

    overlay.classList.add('active');

    submitBtn.onclick = () => {
        if (select.value === correctAnswer) {
            overlay.classList.remove('active');
            onSuccess();
        } else {
            errorEl.style.display = 'block';
        }
    };
    cancelBtn.onclick = () => overlay.classList.remove('active');
}

// ── 重啟鎖定遮罩與就緒輪詢 ──────────────────────────────────────────────────
function showRestartOverlay() {
    const overlay = document.getElementById('server-restart-overlay');
    const titleEl = document.getElementById('restart-title');
    const msgEl = document.getElementById('restart-msg');
    const forceBtn = document.getElementById('btn-restart-force-unlock');
    if (!overlay) return;

    titleEl.textContent = '交易伺服器重啟中...';
    msgEl.textContent = '正在以新的 API 憑證重新啟動 Shioaji 伺服器，請稍候（最長 30 秒）。';
    forceBtn.style.display = 'none';
    overlay.classList.add('active');

    stopPolling(); // 暫停一般帳務輪詢，避免重啟期間產生大量錯誤請求
    if (restartPollTimer) clearInterval(restartPollTimer);

    let attempts = 0;
    const maxAttempts = 30;     // 30 秒逾時（Shioaji 登入＋CA 驗證可能逾 10 秒）
    const startDelayMs = 3000;  // 先等舊進程終止，避免誤把舊進程當成「已就緒」

    setTimeout(() => {
        restartPollTimer = setInterval(async () => {
            attempts += 1;
            try {
                // 注意：重啟輪詢必須走真實 fetch（檢查實體伺服器，不可被 Demo 攔截）
                const resp = await fetch(`${API_BASE}/auth/usage`);
                if (resp.ok) {
                    clearInterval(restartPollTimer);
                    restartPollTimer = null;
                    hideRestartOverlay();
                    showToastNotification('交易伺服器重啟完成，連線已恢復。');
                    // 以新帳戶重新載入 session 與帳務資料
                    state.accounts = [];
                    await checkServerStatus();
                    return;
                }
            } catch (e) { /* 尚未就緒，繼續輪詢 */ }
            if (attempts >= maxAttempts) {
                clearInterval(restartPollTimer);
                restartPollTimer = null;
                titleEl.textContent = '重啟逾時';
                msgEl.textContent = '請手動檢查憑證路徑與終端機錯誤日誌（金鑰或 CA 設定可能有誤）。修正後可於設定頁重新切換設定檔。';
                forceBtn.style.display = 'inline-block';
            }
        }, 1000);
    }, startDelayMs);
}

function hideRestartOverlay() {
    if (restartPollTimer) {
        clearInterval(restartPollTimer);
        restartPollTimer = null;
    }
    const overlay = document.getElementById('server-restart-overlay');
    if (overlay) overlay.classList.remove('active');
}

