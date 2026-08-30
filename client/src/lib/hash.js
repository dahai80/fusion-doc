// =============================================================================
// Fusion-Doc — 共享哈希工具 (客户端)
// E27 修复: 原 hashCode 在 yjs-provider.js / CollabCursors.jsx 重复定义。
// 此处为单一来源, 仅用于协作光标颜色取模 (非密码学用途, 弱哈希可接受)。
// =============================================================================

// 32 位有符号字符串哈希 (djb2 变体)。仅用于颜色取模等非安全场景。
export function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}
