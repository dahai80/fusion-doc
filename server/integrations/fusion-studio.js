// =============================================================================
// Fusion-Doc — Fusion-Studio JSON-RPC 桥接
// 通过 Unix Domain Socket 与 Fusion-Studio 桌面端通信
// 协议: JSON-RPC 2.0 over Unix Domain Socket
// =============================================================================

const net = require('net');
const path = require('path');
const os = require('os');

const DEFAULT_SOCKET_PATH = path.join(os.homedir(), '.fusion', 'studio.sock');
const REQUEST_TIMEOUT = 10000;

let _nextId = 1;

class FusionStudioBridge {
    constructor(config) {
        this.socketPath = config?.socketPath || DEFAULT_SOCKET_PATH;
        this.connected = false;
        this._pending = new Map();
    }

    async call(method, params) {
        const id = _nextId++;
        const message = JSON.stringify({
            jsonrpc: '2.0',
            id,
            method,
            params: params || {},
        });

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(new Error(`Fusion-Studio RPC timeout: ${method}`));
            }, REQUEST_TIMEOUT);

            this._pending.set(id, { resolve, reject, timer });

            this._send(message).catch((e) => {
                clearTimeout(timer);
                this._pending.delete(id);
                reject(e);
            });
        });
    }

    async _send(message) {
        return new Promise((resolve, reject) => {
            // P2-E12 修复: createConnection 对端无响应会永久挂起 (无连接超时), 且 call 的 10s
            // 请求超时 reject 后 socket 仍打开 → fd 泄漏。加连接超时 + 统一 destroy 兜底。
            let settled = false;
            const done = () => {
                if (settled) return;
                settled = true;
                try { socket.destroy(); } catch (_) { /* noop */ }
            };
            const connectTimer = setTimeout(() => {
                reject(new Error('Fusion-Studio socket 连接超时'));
                done();
            }, REQUEST_TIMEOUT);
            const socket = net.createConnection(this.socketPath, () => {
                clearTimeout(connectTimer);
                socket.write(message + '\n');
                resolve();
            });
            // R17 修复: 跨 chunk 行缓冲。JSON-RPC 响应可能跨多个 TCP 段到达,
            // 逐 data 事件 split('\n') 直接 JSON.parse 会因半行抛错被吞 → pending 永不 resolve。
            // 用 socket 级 buffer 累积, 仅解析完整行, 半行留待下一段拼接。
            if (!socket._fdBuffer) socket._fdBuffer = '';
            socket.on('error', (e) => {
                clearTimeout(connectTimer);
                reject(new Error(`Fusion-Studio socket error: ${e.message}`));
                done();
            });
            socket.on('data', (data) => {
                socket._fdBuffer += data.toString();
                let idx;
                while ((idx = socket._fdBuffer.indexOf('\n')) >= 0) {
                    const line = socket._fdBuffer.slice(0, idx).trim();
                    socket._fdBuffer = socket._fdBuffer.slice(idx + 1);
                    if (!line) continue;
                    try {
                        const resp = JSON.parse(line);
                        if (resp.id && this._pending.has(resp.id)) {
                            const { resolve: r, reject: j, timer } = this._pending.get(resp.id);
                            clearTimeout(timer);
                            this._pending.delete(resp.id);
                            if (resp.error) j(new Error(resp.error.message || 'RPC error'));
                            else r(resp.result);
                            done();
                        }
                    } catch (e) {
                        console.warn(`[Fusion-Studio] 解析响应行失败 (已缓冲跨段): ${e.message}`);
                    }
                }
                // R17: 不在首个 data 即 socket.end() — 多响应/流式场景需保持连接直到对方关闭或超时
            });
            socket.on('end', () => {
                if (socket._fdBuffer && socket._fdBuffer.trim()) {
                    // 连接关闭时残留半行: 尝试解析最后一次响应
                    try {
                        const resp = JSON.parse(socket._fdBuffer.trim());
                        if (resp.id && this._pending.has(resp.id)) {
                            const { resolve: r, reject: j, timer } = this._pending.get(resp.id);
                            clearTimeout(timer);
                            this._pending.delete(resp.id);
                            if (resp.error) j(new Error(resp.error.message || 'RPC error'));
                            else r(resp.result);
                        }
                    } catch (_) { /* 残留非 JSON, 忽略 */ }
                }
                done();
            });
        });
    }

    async healthCheck() {
        try {
            const result = await this.call('system.ping');
            this.connected = true;
            return { available: true, ...result };
        } catch (e) {
            this.connected = false;
            console.warn(`[Fusion-Studio] Health check failed: ${e.message}`);
            return { available: false, error: e.message };
        }
    }

    async openDocument(docPath) {
        return this.call('doc.open', { path: docPath });
    }

    async notifyPageChange(pageId, title) {
        return this.call('doc.pageChanged', { pageId, title });
    }
}

module.exports = { FusionStudioBridge, DEFAULT_SOCKET_PATH };
