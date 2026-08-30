// =============================================================================
// Fusion-Doc — 请求体解析中间件 (商用级: 大小上限 + 超时 + 防内存耗尽)
// =============================================================================

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1MB JSON 上限
const BODY_TIMEOUT_MS = 15000; // 解析超时

function parseBody(req) {
    return new Promise((resolve, reject) => {
        if (req.body) return resolve(req.body);

        // Content-Length 预检
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
                req.body = raw ? JSON.parse(raw) : {};
                resolve(req.body);
            } catch (e) {
                const err = new Error('Invalid JSON in request body');
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
