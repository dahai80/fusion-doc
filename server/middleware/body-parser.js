// =============================================================================
// Fusion-Doc — 请求体解析中间件 (商用级: 大小上限 + 超时 + 防内存耗尽)
// =============================================================================

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1MB JSON 上限
const BODY_TIMEOUT_MS = 15000; // 解析超时
// E9 修复: JSON 嵌套深度上限, 防深度嵌套对象耗尽 V8 栈 / DoS
const MAX_JSON_DEPTH = 64;

// 扫描原始文本的括号深度 (跳过字符串字面量内的括号), 超 MAX_JSON_DEPTH 即拒。
// 比 reviver 精确 — reviver 自底向上, 无法在解析中途按总深度截断。
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
                if (raw) {
                    assertJsonDepth(raw); // E9: 深度守卫先于 JSON.parse
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
