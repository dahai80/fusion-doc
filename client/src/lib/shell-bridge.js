// ── Shell 桥接 (issue #58): 内嵌 fusion-web-shell 时跟随宿主主题/语言 ──
// 协议见 fusion-web-shell packages/sdk/src/host.ts:
//   宿主 → 模块: {type:'event', event:'theme'|'visibility'|'lang', payload}
//   模块 → 宿主: {type:'request', id, method:'theme'|'ping', payload} → {type:'response', id, ok, result}
// 宿主在 iframe onLoad 时主动 push 全量状态, 请求仅作兜底; 心跳 ping 应答保持 bridge 存活
import { isEmbedded } from './embedded';
import { useUIStore } from '../stores/uiStore';
import { useLangStore } from '../stores/langStore';

let inited = false;

function postToHost(msg) {
    try {
        window.parent.postMessage(msg, window.location.origin);
    } catch (e) {
        console.warn('[ShellBridge] postMessage to host failed:', e.message);
    }
}

function applyTheme(mode) {
    if (mode === 'dark' || mode === 'light') {
        useUIStore.getState().setTheme(mode);
        console.log('[ShellBridge] theme synced from host:', mode);
    }
}

function applyLang(lang) {
    if (lang === 'zh' || lang === 'en') {
        useLangStore.getState().setLang(lang);
        console.log('[ShellBridge] lang synced from host:', lang);
    }
}

export function initShellSync() {
    if (!isEmbedded || inited) return;
    inited = true;

    window.addEventListener('message', (ev) => {
        if (ev.origin !== window.location.origin) return;
        const msg = ev.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'event') {
            if (msg.event === 'theme') applyTheme(msg.payload);
            else if (msg.event === 'lang') applyLang(msg.payload);
            // 'visibility' 暂不消费 — 无全屏/隐藏态逻辑
        } else if (msg.type === 'request' && msg.method === 'ping') {
            // 宿主心跳: 应答 pong 标记 sdkAlive, 防宿主误判模块假死
            postToHost({ type: 'response', id: msg.id, ok: true, result: 'pong' });
        }
    });

    // 初始主题兜底: 宿主 handleRequest case 'theme' 直接返回 'dark'|'light'
    const reqId = 'fusion-doc-init-' + Date.now();
    const onInitResp = (ev) => {
        if (ev.origin !== window.location.origin) return;
        const msg = ev.data;
        if (msg?.type !== 'response' || msg.id !== reqId) return;
        window.removeEventListener('message', onInitResp);
        if (msg.ok) applyTheme(typeof msg.result === 'string' ? msg.result : msg.result?.mode);
    };
    window.addEventListener('message', onInitResp);
    postToHost({ type: 'request', id: reqId, method: 'theme' });

    console.log('[ShellBridge] host sync initialized (embedded mode)');
}
