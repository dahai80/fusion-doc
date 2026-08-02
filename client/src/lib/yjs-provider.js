// =============================================================================
// Yjs Provider — WebSocket 连接 + TipTap Collaboration 桥接
// =============================================================================

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCursor } from '@tiptap/extension-collaboration-cursor';

const CURSOR_COLORS = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#60a5fa', '#a78bfa', '#f472b6'];

let ydoc = null;
let wsProvider = null;

export function createYjsConnection(pageId, userName) {
    if (!pageId) return null;

    ydoc = new Y.Doc();

    const wsUrl = `ws://${window.location.host}/ws/collab`;
    wsProvider = new WebsocketProvider(wsUrl, `page-${pageId}`, ydoc, {
        connect: true,
        params: { clientId: userName || `user-${Date.now()}` },
    });

    wsProvider.on('status', (event) => {
        console.log('[Yjs] Connection status:', event.status);
    });

    wsProvider.on('synced', () => {
        console.log('[Yjs] Synced with server');
    });

    return { ydoc, wsProvider };
}

export function destroyYjsConnection() {
    if (wsProvider) {
        wsProvider.disconnect();
        wsProvider.destroy();
        wsProvider = null;
    }
    if (ydoc) {
        ydoc.destroy();
        ydoc = null;
    }
}

export function getCollabExtensions(pageId, userName) {
    const { ydoc: doc } = createYjsConnection(pageId, userName)
        || { ydoc: new Y.Doc() };

    const colorIndex = Math.abs(hashCode(userName || 'anonymous')) % CURSOR_COLORS.length;

    return [
        Collaboration.configure({ document: doc }),
        CollaborationCursor.configure({
            provider: wsProvider,
            user: {
                name: userName || 'Anonymous',
                color: CURSOR_COLORS[colorIndex],
                colorLight: CURSOR_COLORS[colorIndex] + '33',
            },
        }),
    ];
}

export function getYjsDoc() { return ydoc; }
export function getWsProvider() { return wsProvider; }

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}
