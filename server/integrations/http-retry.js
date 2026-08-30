// =============================================================================
// Fusion-Doc — HTTP 重试工具 (兄弟服务调用兜底)
// E19 修复: 原 fusion-kb/cowork 单次 fetch, 上游瞬时抖动 (启动期/负载尖峰) 直接失败。
// 提供指数退避重试, 仅对可重试错误 (网络中断/超时/5xx) 重试, 4xx 立即失败。
// =============================================================================

const DEFAULT_RETRIES = 2;          // 额外重试次数 (总尝试 = retries + 1)
const DEFAULT_BASE_DELAY = 300;     // 首次退避 ms
const DEFAULT_MAX_DELAY = 3000;     // 退避上限

// 判断是否值得重试: 网络错误/超时/5xx 可重试, 4xx 客户端错误不重试
function isRetryable(err, status) {
    if (status && status >= 500 && status < 600) return true;
    if (status && status >= 400 && status < 500) return false;
    // 无 status = 网络层失败 (ECONNREFUSED/abort/timeout), 可重试
    return true;
}

function sleep(ms) {
    return new Promise((r) => {
        const t = setTimeout(r, ms);
        if (typeof t.unref === 'function') t.unref();
    });
}

// 执行带重试的 fetch。attemptFn: () => Promise<{ok, status, text(), json()}>
// P2-E6 修复: 加 totalDeadlineMs 总 deadline, 超时即放弃 — 防慢 5xx 重试 3×30s 拉请求至分钟级。
async function fetchWithRetry(buildRequest, opts = {}) {
    const retries = opts.retries ?? DEFAULT_RETRIES;
    const baseDelay = opts.baseDelay ?? DEFAULT_BASE_DELAY;
    const maxDelay = opts.maxDelay ?? DEFAULT_MAX_DELAY;
    const totalDeadlineMs = opts.totalDeadlineMs ?? 30000;

    const deadline = Date.now() + totalDeadlineMs;
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        if (Date.now() >= deadline) {
            console.warn(`[HTTP-Retry] 总 deadline ${totalDeadlineMs}ms 超限, 放弃`);
            throw lastErr || new Error('retry deadline exceeded');
        }
        try {
            const resp = await buildRequest();
            if (resp.ok) return resp;
            // 非 ok: 读 body 后按 status 决定是否重试
            const text = await resp.text().catch(() => '');
            if (!isRetryable(null, resp.status) || attempt === retries) {
                const e = new Error(`${resp.status}: ${text}`);
                e.status = resp.status;
                throw e;
            }
            lastErr = new Error(`${resp.status}: ${text}`);
            lastErr.status = resp.status;
        } catch (e) {
            // 网络层错误 (abort/refused) — 可重试
            if (!isRetryable(e, e.status) || attempt === retries) throw e;
            lastErr = e;
        }
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        console.warn(`[HTTP-Retry] attempt ${attempt + 1}/${retries + 1} 失败 (${lastErr.message}), ${delay}ms 后重试`);
        await sleep(delay);
    }
    throw lastErr || new Error('retry exhausted');
}

module.exports = { fetchWithRetry, isRetryable, DEFAULT_RETRIES };
