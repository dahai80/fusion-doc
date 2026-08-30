// =============================================================================
// Fusion-Doc — 实时协作控制器 (未发布特性, 路由已关闭)
// =============================================================================
// P0-F3/P1-A1/A2 修复: 实时协作 (Yjs) 协议层未实现 (客户端 y-websocket 二进制 vs
// 服务端原 JSON 中继), 且多实例内存态脑裂 (A1) + yjs_updates 无界回放不压缩 (A2)。
// 企业级处置: 显式关闭协作路由 (拒连 410 Gone), 不建房间、不写 yjs_updates。
// 可触达协作消除 → 脑裂与膨胀风险随之消除。客户端 collab 死代码已清。
//
// 启用协作须先实现 (列为企业级后续工程, 非当前发布阻断):
//   1. 持久化 Yjs provider (服务端 yjs 库 + state 压缩/compaction, 解 A2)
//   2. 跨实例消息总线 (Redis pub/sub 或 Yjs y-redis, 解 A1 多实例脑裂)
//   3. 客户端重新接线 provider + 协作 UI
// 原实现 (append-only 中继 + 房间) 见 git 历史, 此处仅保留路由禁用。
// =============================================================================

function register(app) {
    if (!app.ws) {
        console.log('[Collaboration] WebSocket not available, skipping');
        return;
    }
    // 协作未发布: 拒绝一切连接 (410 Gone)
    app.ws('/ws/collab/:pageId', (ws, req) => {
        console.warn(`[Collaboration] 拒连未发布协作路由 page=${req.params.pageId} (410 Gone)`);
        try { ws.close(4011, 'collaboration is an unreleased feature'); } catch { /* socket 已断 */ }
    });
    console.log('[Collaboration] 协作路由已关闭 (未发布特性, 拒连 410)');
}

module.exports = { register };
