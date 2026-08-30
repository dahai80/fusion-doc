// =============================================================================
// Yjs Provider — WebSocket 连接 + TipTap Collaboration 桥接
// R24 修复: 取消模块级全局单例 ydoc/wsProvider, 改 per-pageId 实例 Map。
// 原全局单例在页面切换/StrictMode 双调用时被新 Doc 覆盖, 旧 editor 的 Collaboration
// 仍持有已 destroy 的 doc, 编辑写入已销毁 Y.Doc → 协同数据损坏无报错。
// 每页独立 doc/provider, getCollabExtensions 返回的 Collaboration 与 Cursor 绑定同一实例。
// =============================================================================

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCursor } from '@tiptap/extension-collaboration-cursor';
import { hashCode } from './hash';

const CURSOR_COLORS = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#60a5fa', '#a78bfa', '#f472b6'];

// R24: per-pageId 连接实例, 取代全局单例
const _connections = new Map();

export function createYjsConnection(pageId, userName) {
    if (!pageId) return null;

    // 复用同页已有连接 (StrictMode 双挂载/重渲染), 避免重复建连覆盖
    if (_connections.has(pageId)) {
        return _connections.get(pageId);
    }

    const ydoc = new Y.Doc();

    // A3 修复: pageId 进路径以匹配服务端 /ws/collab/:pageId 路由。
    // 传 token 供服务端 R2 认证校验。注意: y-websocket 客户端发二进制 Yjs sync 协议,
    // 服务端当前收 JSON — 协议层不匹配仍待服务端实现 y-sync (见审计 A3/P0), 此处先修正路由+认证。
    const token = localStorage.getItem('fusion_doc_token') || '';
    const wsUrl = `ws://${window.location.host}/ws/collab/page-${pageId}`;
    const wsProvider = new WebsocketProvider(wsUrl, `page-${pageId}`, ydoc, {
        connect: true,
        params: { clientId: userName || `user-${Date.now()}`, token },
    });

    wsProvider.on('status', (event) => {
        console.log(`[Yjs:${pageId}] Connection status:`, event.status);
    });

    wsProvider.on('synced', () => {
        console.log(`[Yjs:${pageId}] Synced with server`);
    });

    const conn = { ydoc, wsProvider, pageId };
    _connections.set(pageId, conn);
    return conn;
}

// 销毁指定页连接 (页面卸载时调用)。无参则销毁全部 (退出登录)。
export function destroyYjsConnection(pageId) {
    if (pageId) {
        const conn = _connections.get(pageId);
        if (!conn) return;
        conn.wsProvider.disconnect();
        conn.wsProvider.destroy();
        conn.ydoc.destroy();
        _connections.delete(pageId);
        return;
    }
    for (const conn of _connections.values()) {
        conn.wsProvider.disconnect();
        conn.wsProvider.destroy();
        conn.ydoc.destroy();
    }
    _connections.clear();
}

export function getCollabExtensions(pageId, userName) {
    const conn = createYjsConnection(pageId, userName);
    // R24 修复: Collaboration 与 CollaborationCursor 必须绑定同一 doc/provider 实例。
    // 原实现 Collaboration 用闭包 doc, Cursor 用全局 wsProvider, 两者可能指向不同实例。
    const doc = conn ? conn.ydoc : new Y.Doc();
    const provider = conn ? conn.wsProvider : null;

    const colorIndex = Math.abs(hashCode(userName || 'anonymous')) % CURSOR_COLORS.length;

    return [
        Collaboration.configure({ document: doc }),
        CollaborationCursor.configure({
            provider,
            user: {
                name: userName || 'Anonymous',
                color: CURSOR_COLORS[colorIndex],
                colorLight: CURSOR_COLORS[colorIndex] + '33',
            },
        }),
    ];
}

export function getYjsDoc(pageId) {
    if (pageId) return _connections.get(pageId)?.ydoc || null;
    // 无参: 返回首个 (兼容旧调用, 但已不推荐)
    const first = _connections.values().next();
    return first.done ? null : first.value.ydoc;
}

export function getWsProvider(pageId) {
    if (pageId) return _connections.get(pageId)?.wsProvider || null;
    const first = _connections.values().next();
    return first.done ? null : first.value.wsProvider;
}
