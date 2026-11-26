// =============================================================================
// Fusion-Doc — HTTP retry utility (fallback for sibling service calls)
// E19 fix: fusion-kb/cowork used a single fetch, so transient upstream jitter (startup/load spikes) failed immediately.
// Provides exponential backoff retry, only for retryable errors (network drop/timeout/5xx); 4xx fails immediately.
// =============================================================================

const DEFAULT_RETRIES = 2;          // extra retries (total attempts = retries + 1)
const DEFAULT_BASE_DELAY = 300;     // first backoff ms
const DEFAULT_MAX_DELAY = 3000;     // backoff cap

// Decide whether to retry: network errors/timeouts/5xx are retryable, 4xx client errors are not
function isRetryable(err, status) {
    if (status && status >= 500 && status < 600) return true;
    if (status && status >= 400 && status < 500) return false;
    // No status = network-level failure (ECONNREFUSED/abort/timeout), retryable
    return true;
}

function sleep(ms) {
    return new Promise((r) => {
        const t = setTimeout(r, ms);
        if (typeof t.unref === 'function') t.unref();
    });
}

// Run fetch with retries. attemptFn: () => Promise<{ok, status, text(), json()}>
// P2-E6 fix: add a totalDeadlineMs overall deadline and give up when exceeded — prevents slow 5xx retries (3×30s) from stretching requests to minutes.
async function fetchWithRetry(buildRequest, opts = {}) {
    const retries = opts.retries ?? DEFAULT_RETRIES;
    const baseDelay = opts.baseDelay ?? DEFAULT_BASE_DELAY;
    const maxDelay = opts.maxDelay ?? DEFAULT_MAX_DELAY;
    const totalDeadlineMs = opts.totalDeadlineMs ?? 30000;

    const deadline = Date.now() + totalDeadlineMs;
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        if (Date.now() >= deadline) {
            console.warn(`[HTTP-Retry] total deadline ${totalDeadlineMs}ms exceeded, giving up`);
            throw lastErr || new Error('retry deadline exceeded');
        }
        try {
            const resp = await buildRequest();
            if (resp.ok) return resp;
            // Not ok: read the body, then decide whether to retry based on status
            const text = await resp.text().catch(() => '');
            if (!isRetryable(null, resp.status) || attempt === retries) {
                const e = new Error(`${resp.status}: ${text}`);
                e.status = resp.status;
                throw e;
            }
            lastErr = new Error(`${resp.status}: ${text}`);
            lastErr.status = resp.status;
        } catch (e) {
            // Network-level error (abort/refused) — retryable
            if (!isRetryable(e, e.status) || attempt === retries) throw e;
            lastErr = e;
        }
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        console.warn(`[HTTP-Retry] attempt ${attempt + 1}/${retries + 1} failed (${lastErr.message}), retrying in ${delay}ms`);
        await sleep(delay);
    }
    throw lastErr || new Error('retry exhausted');
}

module.exports = { fetchWithRetry, isRetryable, DEFAULT_RETRIES };
