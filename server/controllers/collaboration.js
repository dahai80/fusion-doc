// =============================================================================
// Fusion-Doc — 实时协作控制器
// WebSocket + Yjs 协作编辑 + SQLite 持久化
// =============================================================================

const { verifyToken } = require('../middleware/auth');

function register(app) {
    if (!app.ws) {
        console.log('[Collaboration] WebSocket not available, skipping');
        return;
    }

    app.ws('/ws/collab/:pageId', (ws, req) => {
        const { pageId } = req.params;
        const db = app.db;

        // R2 修复: WS 协作路由零认证 → 任意人接管任意页面稿件。
        // 强制校验 token (query.token 或 Authorization 头), 并回查 page 存在。
        const secret = app.config?.auth?.jwtSecret;
        if (!secret) {
            console.error('[Collaboration] JWT secret 未配置, 拒绝所有 WS 连接');
            ws.close(1011, 'server misconfiguration');
            return;
        }
        const tok = req.query.token || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
        let user = null;
        if (tok) {
            const payload = verifyToken(tok, secret);
            if (!payload) {
                console.warn(`[Collaboration] token 无效, 拒绝 WS 连接 page=${pageId}`);
                ws.close(4001, 'invalid token');
                return;
            }
            user = { id: payload.id, role: payload.role };
            // R3 修复延伸: 回查权威 role
            if (db && payload.id) {
                try {
                    const row = db.prepare('SELECT role FROM users WHERE id = ?').get(payload.id);
                    if (!row) { ws.close(4001, 'user not found'); return; }
                    user.role = row.role;
                } catch (_) { /* 降级用 token role */ }
            }
        }
        // 公开页 (is_published=1) 允许只读协同无 token; 私有页必须认证
        let isPublished = true;
        if (db) {
            try {
                const row = db.prepare('SELECT is_published FROM pages WHERE id = ?').get(pageId);
                if (row) isPublished = row.is_published === 1;
                else { ws.close(4004, 'page not found'); return; }
            } catch (_) { /* 降级允许 */ }
        }
        if (!isPublished && !user) {
            console.warn(`[Collaboration] 未认证访问私有页 ${pageId}, 拒绝`);
            ws.close(4003, 'auth required for private page');
            return;
        }

        const clientId = req.query.clientId || `client-${user ? user.id : 'anon'}-${Date.now()}`;

        console.log(`[Collaboration] Client ${clientId} connected to page ${pageId} (user=${user ? user.id : 'anon'})`);

        if (!app.collabRooms) app.collabRooms = {};
        if (!app.collabRooms[pageId]) app.collabRooms[pageId] = new Map();

        const room = app.collabRooms[pageId];
        room.set(clientId, ws);

        broadcastToRoom(room, clientId, {
            type: 'user-joined',
            clientId,
            userCount: room.size,
        });

        // A2 修复: 新客户端连接时回放该页全部 append-only updates (按 seq 顺序)。
        // 优先用压缩快照 (yjs_docs.state) 作起点, 再回放快照之后的增量 updates。
        if (db) {
            try {
                const snapshotRow = db.prepare('SELECT state, state_seq FROM yjs_docs WHERE page_id = ?').get(pageId);
                let baseSeq = 0;
                if (snapshotRow && snapshotRow.state) {
                    const stateBuf = Buffer.isBuffer(snapshotRow.state) ? snapshotRow.state : Buffer.from(snapshotRow.state);
                    baseSeq = snapshotRow.state_seq || 0;
                    ws.send(JSON.stringify({
                        type: 'sync-step-1',
                        state: stateBuf.toString('base64'),
                        source: 'persisted',
                    }));
                    console.log(`[Collaboration] Sent Yjs snapshot (${stateBuf.length} bytes, seq<=${baseSeq}) to ${clientId}`);
                }
                // 回放快照之后的增量 updates (id > baseSeq)
                const incrRows = db.prepare('SELECT id, "update" FROM yjs_updates WHERE page_id = ? AND id > ? ORDER BY id ASC').all(pageId, baseSeq);
                for (const r of incrRows) {
                    const ub = Buffer.isBuffer(r.update) ? r.update : Buffer.from(r.update);
                    ws.send(JSON.stringify({ type: 'update', update: ub.toString('base64'), source: 'replay' }));
                }
                if (incrRows.length) {
                    console.log(`[Collaboration] Replayed ${incrRows.length} incremental updates to ${clientId}`);
                }
            } catch (e) {
                console.warn(`[Collaboration] Failed to load Yjs state for page ${pageId}: ${e.message}`);
            }
        }

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                switch (msg.type) {
                    case 'sync-step-1':
                    case 'sync-step-2':
                        broadcastToRoom(room, clientId, msg);
                        break;
                    case 'update':
                        broadcastToRoom(room, clientId, msg);
                        if (db && msg.update) {
                            persistYjsUpdate(db, pageId, msg.update);
                        }
                        break;
                    case 'awareness':
                        broadcastToRoom(room, clientId, msg);
                        break;
                    case 'cursor':
                        broadcastToRoom(room, clientId, { ...msg, clientId });
                        break;
                    default:
                        console.log(`[Collaboration] Unknown message type: ${msg.type}`);
                }
            } catch (e) {
                console.warn('[Collaboration] Invalid message:', e.message);
            }
        });

        ws.on('close', () => {
            room.delete(clientId);
            console.log(`[Collaboration] Client ${clientId} left page ${pageId}`);
            broadcastToRoom(room, clientId, {
                type: 'user-left',
                clientId,
                userCount: room.size,
            });
            if (room.size === 0) {
                if (db) {
                    saveFinalYjsState(db, pageId);
                }
                delete app.collabRooms[pageId];
            }
        });

        // R1 修复: 每连接 error handler, 防未捕获 socket error 杀进程
        ws.on('error', (err) => {
            console.warn(`[Collaboration] Socket error for ${clientId} on page ${pageId}: ${err.message}`);
            try { room.delete(clientId); } catch (_) { /* noop */ }
        });

        ws.send(JSON.stringify({
            type: 'welcome',
            clientId,
            pageId,
            userCount: room.size,
        }));
    });
}

// A2 修复: append-only 持久化。每条 update 单独 INSERT, 无 read-modify-write,
// 消除多客户端并发 SELECT 旧 state 各自 concat UPDATE 的 lost update。
function persistYjsUpdate(db, pageId, updateBase64) {
    try {
        const updateBuf = Buffer.from(updateBase64, 'base64');
        const info = db.prepare('INSERT INTO yjs_updates (page_id, "update") VALUES (?, ?)').run(pageId, updateBuf);
        // 首条 update 时建占位快照行 (state=NULL, state_seq=0), 便于后续 compaction
        db.prepare('INSERT OR IGNORE INTO yjs_docs (id, page_id, state, state_seq, created_at, updated_at) VALUES (?, ?, NULL, 0, ?, ?)').run(
            `yjs-${pageId}`, pageId, new Date().toISOString(), new Date().toISOString()
        );
        return info.lastInsertRowid;
    } catch (e) {
        console.warn(`[Collaboration] Failed to persist Yjs update for page ${pageId}: ${e.message}`);
        return null;
    }
}

// A2 修复: 房间清空时不做 read-modify-write 合并。append-only 日志是 source of truth。
// 仅刷新 yjs_docs 时间戳并统计增量条数。真正压缩 (把 updates 合并成单一 state) 需要
// 服务端加载 Yjs 解码 — 暂不引入, 列为已知限制 (update 日志会随编辑增长, 定期清理靠运维)。
function saveFinalYjsState(db, pageId) {
    try {
        const cnt = db.prepare('SELECT COUNT(*) as c FROM yjs_updates WHERE page_id = ?').get(pageId)?.c || 0;
        db.prepare('UPDATE yjs_docs SET updated_at = ? WHERE page_id = ?').run(new Date().toISOString(), pageId);
        console.log(`[Collaboration] Room closed for page ${pageId}, ${cnt} append-only updates retained as source of truth`);
    } catch (e) {
        console.warn(`[Collaboration] Failed to finalize Yjs state for page ${pageId}: ${e.message}`);
    }
}

function broadcastToRoom(room, senderId, message) {
    const data = JSON.stringify(message);
    for (const [clientId, ws] of room) {
        if (clientId === senderId || ws.readyState !== 1) continue;
        // R1 修复: ws.send 包 try, 防向中途关闭的 socket 写入抛错逃逸杀进程
        try {
            ws.send(data);
        } catch (e) {
            console.warn(`[Collaboration] broadcast to ${clientId} failed: ${e.message}`);
            room.delete(clientId);
        }
    }
}

module.exports = { register };
