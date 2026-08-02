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
            const socket = net.createConnection(this.socketPath, () => {
                socket.write(message + '\n');
                resolve();
            });
            socket.on('error', (e) => {
                reject(new Error(`Fusion-Studio socket error: ${e.message}`));
            });
            socket.on('data', (data) => {
                const lines = data.toString().split('\n').filter(Boolean);
                for (const line of lines) {
                    try {
                        const resp = JSON.parse(line);
                        if (resp.id && this._pending.has(resp.id)) {
                            const { resolve, reject, timer } = this._pending.get(resp.id);
                            clearTimeout(timer);
                            this._pending.delete(resp.id);
                            if (resp.error) reject(new Error(resp.error.message || 'RPC error'));
                            else resolve(resp.result);
                        }
                    } catch (_) { /* ignore non-JSON lines */ }
                }
                socket.end();
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
