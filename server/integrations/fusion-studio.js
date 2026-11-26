// =============================================================================
// Fusion-Doc — Fusion-Studio JSON-RPC bridge
// Communicates with the Fusion-Studio desktop app over a Unix Domain Socket
// Protocol: JSON-RPC 2.0 over Unix Domain Socket
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
            // P2-E12 fix: createConnection hangs forever if the peer never responds (no connect timeout), and after call's 10s
            // request timeout rejects the socket stays open → fd leak. Add a connect timeout + a unified destroy fallback.
            let settled = false;
            const done = () => {
                if (settled) return;
                settled = true;
                try { socket.destroy(); } catch (_) { /* noop */ }
            };
            const connectTimer = setTimeout(() => {
                reject(new Error('Fusion-Studio socket connect timeout'));
                done();
            }, REQUEST_TIMEOUT);
            const socket = net.createConnection(this.socketPath, () => {
                clearTimeout(connectTimer);
                socket.write(message + '\n');
                resolve();
            });
            // R17 fix: line buffering across chunks. A JSON-RPC response may arrive across multiple TCP segments;
            // split('\n') + JSON.parse per data event throws on half lines and gets swallowed → pending never resolves.
            // Accumulate in a socket-level buffer, parse only complete lines, keep half lines for the next segment.
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
                        console.warn(`[Fusion-Studio] failed to parse response line (buffered across segments): ${e.message}`);
                    }
                }
                // R17: do not socket.end() on the first data event — multi-response/streaming cases must keep the connection until the peer closes or times out
            });
            socket.on('end', () => {
                if (socket._fdBuffer && socket._fdBuffer.trim()) {
                    // Leftover half line when the connection closes: try to parse the final response
                    try {
                        const resp = JSON.parse(socket._fdBuffer.trim());
                        if (resp.id && this._pending.has(resp.id)) {
                            const { resolve: r, reject: j, timer } = this._pending.get(resp.id);
                            clearTimeout(timer);
                            this._pending.delete(resp.id);
                            if (resp.error) j(new Error(resp.error.message || 'RPC error'));
                            else r(resp.result);
                        }
                    } catch (_) { /* leftover is not JSON, ignore */ }
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
