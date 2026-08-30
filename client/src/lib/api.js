// E20 修复: 所有 fetch 加超时 + AbortController, 防后端卡死时前端无限挂起。
// 超时默认 20s, 可经第四参 opts.timeout 覆盖 (0/负值 = 不超时, 供流式调用)。
// P0-F1 修复: 自动附 Authorization: Bearer <token> (从 localStorage 读), 处理 401 清 token 触发登录。
const API_BASE = '/api';
const DEFAULT_TIMEOUT = 20000;
const TOKEN_KEY = 'fusion-doc-token';

function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}

function clearTokenOn401() {
    try {
        if (localStorage.getItem(TOKEN_KEY)) {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem('fusion-doc-user');
            // 触发刷新让 App 网关回到登录页
            window.dispatchEvent(new Event('fusion-doc-logout'));
        }
    } catch {}
}

function withTimeout(opts, timeout) {
    const ms = timeout === undefined ? DEFAULT_TIMEOUT : timeout;
    if (ms <= 0) return { ...opts, _timer: null };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    if (opts.signal) {
        if (opts.signal.aborted) controller.abort();
        else opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    return { ...opts, signal: controller.signal, _timer: timer };
}

export async function api(method, path, body = null, reqOpts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(reqOpts.headers || {}) };
    // P0-F1: 认证路径自身不带 token (登录/setup); 其余路径自动附 Bearer
    const isAuthPath = path.startsWith('/auth/') || path.startsWith('/system/setup');
    if (!isAuthPath) {
        const token = getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    const opts = { method, headers };
    if (body && method !== 'GET') {
        opts.body = JSON.stringify(body);
    }
    const timed = withTimeout(opts, reqOpts.timeout);
    let res;
    try {
        res = await fetch(`${API_BASE}${path}`, timed);
    } catch (e) {
        if (timed._timer) clearTimeout(timed._timer);
        if (e.name === 'AbortError') throw new Error(`请求超时 (${reqOpts.timeout ?? DEFAULT_TIMEOUT}ms): ${method} ${path}`);
        throw e;
    }
    if (timed._timer) clearTimeout(timed._timer);
    if (!res.ok) {
        // P0-F1: 401 清 token, 让 App 网关回到登录页
        if (res.status === 401 && !isAuthPath) clearTokenOn401();
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || `API ${res.status}`);
    }
    return res.json();
}

// E20 修复: 流式支持外部 AbortController (reqOpts.signal), 加空闲心跳:
// 连续 IDLE_MS 无数据视为后端卡死, abort 防永久挂起。
export async function apiStream(path, body, onChunk, onDone, reqOpts = {}) {
    const IDLE_MS = reqOpts.idleTimeout ?? 60000;
    const controller = new AbortController();
    if (reqOpts.signal) {
        if (reqOpts.signal.aborted) controller.abort();
        else reqOpts.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    let idleTimer = null;
    const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (IDLE_MS > 0) idleTimer = setTimeout(() => controller.abort(), IDLE_MS);
    };
    resetIdle();
    let res;
    try {
        const streamHeaders = { 'Content-Type': 'application/json' };
        const token = getToken();
        if (token) streamHeaders['Authorization'] = `Bearer ${token}`;
        res = await fetch(`${API_BASE}${path}`, {
            method: 'POST',
            headers: streamHeaders,
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (e) {
        if (idleTimer) clearTimeout(idleTimer);
        if (e.name === 'AbortError') throw new Error(`流式请求超时/取消: ${path}`);
        throw e;
    }
    if (!res.ok) {
        if (idleTimer) clearTimeout(idleTimer);
        throw new Error(`API ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdle();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                    onDone?.();
                    return;
                }
                try {
                    const parsed = JSON.parse(data);
                    onChunk(parsed);
                } catch {
                    onChunk({ text: data });
                }
            }
        }
    }
    if (idleTimer) clearTimeout(idleTimer);
    onDone?.();
}

export async function apiUpload(path, file) {
    const formData = new FormData();
    formData.append('file', file);
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers,
        body: formData,
    });
    if (!res.ok) {
        if (res.status === 401) clearTokenOn401();
        throw new Error(`Upload failed: ${res.status}`);
    }
    return res.json();
}

export function searchPages(q) {
    return api('GET', `/search?q=${encodeURIComponent(q)}`);
}
