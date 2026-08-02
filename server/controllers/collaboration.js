// =============================================================================
// Fusion-Doc — 实时协作控制器
// WebSocket + Yjs 协作编辑 + SQLite 持久化
// =============================================================================

function register(app) {
    if (!app.ws) {
        console.log('[Collaboration] WebSocket not available, skipping');
        return;
    }

    app.ws('/ws/collab/:pageId', (ws, req) => {
        const { pageId } = req.params;
        const clientId = req.query.clientId || `client-${Date.now()}`;
        const db = app.db;

        console.log(`[Collaboration] Client ${clientId} connected to page ${pageId}`);

        if (!app.collabRooms) app.collabRooms = {};
        if (!app.collabRooms[pageId]) app.collabRooms[pageId] = new Map();

        const room = app.collabRooms[pageId];
        room.set(clientId, ws);

        broadcastToRoom(room, clientId, {
            type: 'user-joined',
            clientId,
            userCount: room.size,
        });

        // 发送持久化的 Yjs 状态给新连接的客户端
        if (db) {
            try {
                const row = db.prepare('SELECT state FROM yjs_docs WHERE page_id = ?').get(pageId);
                if (row && row.state) {
                    const stateBuf = Buffer.isBuffer(row.state) ? row.state : Buffer.from(row.state);
                    ws.send(JSON.stringify({
                        type: 'sync-step-1',
                        state: stateBuf.toString('base64'),
                        source: 'persisted',
                    }));
                    console.log(`[Collaboration] Sent persisted Yjs state (${stateBuf.length} bytes) to ${clientId}`);
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

        ws.send(JSON.stringify({
            type: 'welcome',
            clientId,
            pageId,
            userCount: room.size,
        }));
    });
}

function persistYjsUpdate(db, pageId, updateBase64) {
    try {
        const updateBuf = Buffer.from(updateBase64, 'base64');
        const row = db.prepare('SELECT state FROM yjs_docs WHERE page_id = ?').get(pageId);
        if (row && row.state) {
            const existing = Buffer.isBuffer(row.state) ? row.state : Buffer.from(row.state);
            const merged = Buffer.concat([existing, updateBuf]);
            db.prepare('UPDATE yjs_docs SET state = ?, updated_at = ? WHERE page_id = ?').run(merged, new Date().toISOString(), pageId);
        } else {
            db.prepare('INSERT OR REPLACE INTO yjs_docs (id, page_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
                `yjs-${pageId}`, pageId, updateBuf, new Date().toISOString(), new Date().toISOString()
            );
        }
    } catch (e) {
        console.warn(`[Collaboration] Failed to persist Yjs update for page ${pageId}: ${e.message}`);
    }
}

function saveFinalYjsState(db, pageId) {
    try {
        const row = db.prepare('SELECT state FROM yjs_docs WHERE page_id = ?').get(pageId);
        if (row) {
            db.prepare('UPDATE yjs_docs SET updated_at = ? WHERE page_id = ?').run(new Date().toISOString(), pageId);
            const stateSize = row.state ? (Buffer.isBuffer(row.state) ? row.state.length : Buffer.from(row.state).length) : 0;
            console.log(`[Collaboration] Saved final Yjs state for page ${pageId} (${stateSize} bytes)`);
        }
    } catch (e) {
        console.warn(`[Collaboration] Failed to save final Yjs state for page ${pageId}: ${e.message}`);
    }
}

function broadcastToRoom(room, senderId, message) {
    const data = JSON.stringify(message);
    for (const [clientId, ws] of room) {
        if (clientId !== senderId && ws.readyState === 1) {
            ws.send(data);
        }
    }
}

module.exports = { register };
