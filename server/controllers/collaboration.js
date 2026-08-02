// =============================================================================
// Fusion-Doc — 实时协作控制器
// WebSocket + Yjs 协作编辑
// =============================================================================

function register(app) {
    if (!app.ws) {
        console.log('[Collaboration] WebSocket not available, skipping');
        return;
    }

    app.ws('/ws/collab/:pageId', (ws, req) => {
        const { pageId } = req.params;
        const clientId = req.query.clientId || `client-${Date.now()}`;

        console.log(`[Collaboration] Client ${clientId} connected to page ${pageId}`);

        if (!app.collabRooms) app.collabRooms = {};
        if (!app.collabRooms[pageId]) app.collabRooms[pageId] = new Map();

        const room = app.collabRooms[pageId];
        room.set(clientId, ws);

        // 通知其他用户
        broadcastToRoom(room, clientId, {
            type: 'user-joined',
            clientId,
            userCount: room.size,
        });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                switch (msg.type) {
                    case 'sync-step-1':
                    case 'sync-step-2':
                    case 'update':
                        broadcastToRoom(room, clientId, msg);
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

function broadcastToRoom(room, senderId, message) {
    const data = JSON.stringify(message);
    for (const [clientId, ws] of room) {
        if (clientId !== senderId && ws.readyState === 1) {
            ws.send(data);
        }
    }
}

module.exports = { register };
