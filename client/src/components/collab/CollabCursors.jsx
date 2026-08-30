// =============================================================================
// 协作光标显示
// =============================================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { hashCode } from '../../lib/hash';

const CURSOR_COLORS = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#60a5fa', '#a78bfa', '#f472b6'];

export default function CollabCursors({ pageId }) {
    const [cursors, setCursors] = useState({});
    const [connected, setConnected] = useState(false);
    const wsRef = useRef(null);

    useEffect(() => {
        if (!pageId) return;

        const clientId = `user-${Date.now()}`;
        const ws = new WebSocket(`ws://${window.location.host}/ws/collab/${pageId}?clientId=${clientId}`);
        wsRef.current = ws;

        ws.onopen = () => setConnected(true);
        ws.onclose = () => setConnected(false);

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'cursor') {
                    setCursors(prev => ({
                        ...prev,
                        [msg.clientId]: {
                            x: msg.x,
                            y: msg.y,
                            name: msg.name || msg.clientId,
                            color: CURSOR_COLORS[Math.abs(hashCode(msg.clientId)) % CURSOR_COLORS.length],
                        },
                    }));
                } else if (msg.type === 'user-left') {
                    setCursors(prev => {
                        const next = { ...prev };
                        delete next[msg.clientId];
                        return next;
                    });
                }
            } catch (e) {
                // ignore
            }
        };

        return () => {
            ws.close();
            wsRef.current = null;
        };
    }, [pageId]);

    return (
        <>
            {connected && (
                <div className="fixed top-2 right-2 z-40 flex items-center gap-1 px-2 py-1 bg-green-600/20 text-green-400 text-xs rounded-full">
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                    在线协作中
                </div>
            )}
            {Object.entries(cursors).map(([id, cursor]) => (
                <div
                    key={id}
                    className="fixed z-50 pointer-events-none"
                    style={{ left: cursor.x, top: cursor.y }}
                >
                    <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
                        <path d="M0 0L16 12L8 12L4 20L0 0Z" fill={cursor.color} />
                    </svg>
                    <span
                        className="absolute left-4 top-0 text-xs px-1.5 py-0.5 rounded whitespace-nowrap"
                        style={{ backgroundColor: cursor.color, color: '#fff' }}
                    >
                        {cursor.name}
                    </span>
                </div>
            ))}
        </>
    );
}
