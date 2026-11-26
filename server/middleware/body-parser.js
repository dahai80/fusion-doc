// =============================================================================
// Fusion-Doc — request body parsing middleware (production-grade: size cap + timeout + memory exhaustion protection)
// =============================================================================

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1MB JSON cap
const BODY_TIMEOUT_MS = 15000; // parse timeout
// E9 fix: JSON nesting depth cap, prevents deeply nested objects from exhausting the V8 stack / DoS
const MAX_JSON_DEPTH = 64;

// Scan bracket depth of the raw text (skipping brackets inside string literals), reject when over MAX_JSON_DEPTH.
// More precise than a reviver — a reviver runs bottom-up and cannot cut off mid-parse by total depth.
function assertJsonDepth(raw) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (inStr) {
            if (esc) { esc = false; continue; }
            if (ch === '\\') { esc = true; continue; }
            if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{' || ch === '[') {
            depth++;
            if (depth > MAX_JSON_DEPTH) throw new Error('JSON nesting too deep');
        } else if (ch === '}' || ch === ']') {
            depth--;
        }
    }
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        if (req.body) return resolve(req.body);

        // Content-Length pre-check
        const declared = parseInt(req.headers['content-length'] || '0', 10);
        if (declared && declared > MAX_BODY_BYTES) {
            const err = new Error('Request body too large');
            err.statusCode = 413;
            return reject(err);
        }

        const chunks = [];
        let received = 0;
        let aborted = false;
        let timer = null;

        const cleanup = () => {
            if (timer) { clearTimeout(timer); timer = null; }
            req.removeListener('data', onData);
            req.removeListener('end', onEnd);
            req.removeListener('error', onError);
        };

        const onData = c => {
            if (aborted) return;
            received += c.length;
            if (received > MAX_BODY_BYTES) {
                aborted = true;
                cleanup();
                req.destroy();
                const err = new Error('Request body too large');
                err.statusCode = 413;
                reject(err);
                return;
            }
            chunks.push(c);
        };

        const onEnd = () => {
            if (aborted) return;
            cleanup();
            try {
                const raw = Buffer.concat(chunks).toString('utf-8');
                if (raw) {
                    assertJsonDepth(raw); // E9: depth guard runs before JSON.parse
                    req.body = JSON.parse(raw);
                } else {
                    req.body = {};
                }
                resolve(req.body);
            } catch (e) {
                const msg = e.message === 'JSON nesting too deep' ? e.message : 'Invalid JSON in request body';
                const err = new Error(msg);
                err.statusCode = 400;
                reject(err);
            }
        };

        const onError = e => {
            if (aborted) return;
            aborted = true;
            cleanup();
            reject(e);
        };

        timer = setTimeout(() => {
            if (aborted) return;
            aborted = true;
            cleanup();
            req.destroy();
            const err = new Error('Request body timeout');
            err.statusCode = 408;
            reject(err);
        }, BODY_TIMEOUT_MS);

        req.on('data', onData);
        req.on('end', onEnd);
        req.on('error', onError);
    });
}

module.exports = { parseBody };
