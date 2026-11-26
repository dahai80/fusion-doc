// =============================================================================
// Fusion-Doc — real-time collaboration controller (unreleased feature, routes disabled)
// =============================================================================
// P0-F3/P1-A1/A2 fix: the real-time collaboration (Yjs) protocol layer is not implemented (client y-websocket binary vs
// the server's original JSON relay), plus multi-instance in-memory split-brain (A1) + unbounded uncompacted yjs_updates replay (A2).
// Enterprise-grade handling: explicitly disable collaboration routes (reject with 410 Gone), create no rooms, write no yjs_updates.
// Removing reachable collaboration → removes the split-brain and bloat risks with it. Client collab dead code has been cleaned up.
//
// Enabling collaboration first requires (tracked as enterprise follow-up work, not a current release blocker):
//   1. A persistent Yjs provider (server-side yjs library + state compaction, fixes A2)
//   2. A cross-instance message bus (Redis pub/sub or Yjs y-redis, fixes A1 multi-instance split-brain)
//   3. Client re-wiring of the provider + collaboration UI
// The original implementation (append-only relay + rooms) is in git history; only the route disabling is kept here.
// =============================================================================

function register(app) {
    if (!app.ws) {
        console.log('[Collaboration] WebSocket not available, skipping');
        return;
    }
    // Collaboration unreleased: reject all connections (410 Gone)
    // issue #45: even if enabled in future, the verified tid must be checked first — reject any connection without tenant context (red line 2)
    app.ws('/ws/collab/:pageId', (ws, req) => {
        const tid = req.user?.tid;
        const tidNote = tid ? `tid=${tid}` : 'no tenant context (unverified token)';
        console.warn(`[Collaboration] rejected connection to unreleased collaboration route page=${req.params.pageId} ${tidNote} (410 Gone)`);
        try { ws.close(4011, 'collaboration is an unreleased feature'); } catch { /* socket already closed */ }
    });
    console.log('[Collaboration] collaboration routes disabled (unreleased feature, rejecting with 410)');
}

module.exports = { register };
