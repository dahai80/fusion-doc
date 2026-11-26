// E20 fix: every fetch gets a timeout + AbortController, so the frontend never hangs forever when the backend stalls.
// Default timeout is 20s, overridable via the fourth arg opts.timeout (0/negative = no timeout, for streaming calls).
// P0-F1 fix: automatically attach Authorization: Bearer <token> (read from localStorage); on 401 clear the token to trigger login.
// issue #51: shell embedded mode — API goes through the same-origin /shell/<id>/api proxy (gateway injects the service key);
// the client attaches no token, and 401 does not trigger a local logout (the session belongs to the shell host).
import { isEmbedded, shellBasePath } from './embedded';

const API_BASE = isEmbedded ? `${shellBasePath()}/api` : '/api';
const DEFAULT_TIMEOUT = 20000;
const TOKEN_KEY = 'fusion-doc-token';

function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}

function clearTokenOn401() {
    if (isEmbedded) return; // issue #51: embedded session belongs to the shell host, no local logout redirect
    try {
        if (localStorage.getItem(TOKEN_KEY)) {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem('fusion-doc-user');
            // Trigger a refresh so the App gate returns to the login page
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
    // P0-F1: auth paths themselves carry no token (login/setup); all other paths get Bearer automatically
    // issue #51: zero tokens in embedded mode — the gateway /shell/ proxy injects the service key
    const isAuthPath = path.startsWith('/auth/') || path.startsWith('/system/setup');
    if (!isAuthPath && !isEmbedded) {
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
        if (e.name === 'AbortError') throw new Error(`Request timed out (${reqOpts.timeout ?? DEFAULT_TIMEOUT}ms): ${method} ${path}`);
        throw e;
    }
    if (timed._timer) clearTimeout(timed._timer);
    if (!res.ok) {
        // P0-F1: on 401 clear the token so the App gate returns to the login page
        if (res.status === 401 && !isAuthPath) clearTokenOn401();
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || `API ${res.status}`);
    }
    return res.json();
}

// issue #71: binary download (page export) — same auth/base as api(), blob response.
export async function apiBlob(path, timeoutMs = 60000) {
    const headers = {};
    const token = isEmbedded ? null : getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${API_BASE}${path}`, { headers, signal: controller.signal });
        if (!res.ok) {
            if (res.status === 401 && !isEmbedded) clearTokenOn401();
            const err = await res.json().catch(() => ({ message: res.statusText }));
            throw new Error(err.message || `API ${res.status}`);
        }
        return await res.blob();
    } catch (e) {
        if (e.name === 'AbortError') throw new Error(`Download timeout: ${path}`);
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

// E20 fix: streaming supports an external AbortController (reqOpts.signal), plus an idle heartbeat:
// no data for IDLE_MS in a row is treated as a stalled backend and aborted to avoid hanging forever.
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
        const token = isEmbedded ? null : getToken();
        if (token) streamHeaders['Authorization'] = `Bearer ${token}`;
        res = await fetch(`${API_BASE}${path}`, {
            method: 'POST',
            headers: streamHeaders,
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (e) {
        if (idleTimer) clearTimeout(idleTimer);
        if (e.name === 'AbortError') throw new Error(`Streaming request timed out/cancelled: ${path}`);
        throw e;
    }
    if (!res.ok) {
        if (idleTimer) clearTimeout(idleTimer);
        // issue #69: pass through the backend error body message (e.g. the actionable SELECTION_TOO_LONG hint) instead of a bare status code
        const err = await res.json().catch(() => ({ message: `API ${res.status}` }));
        throw new Error(err.message || `API ${res.status}`);
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
    const token = isEmbedded ? null : getToken();
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
