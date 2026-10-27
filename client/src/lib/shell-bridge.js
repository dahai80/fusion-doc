// ── Shell 桥接 (issue #58 → #62): 内嵌 fusion-web-shell 时跟随宿主主题/语言 ──
// #62 起改用 vendored @fusion/web-sdk v0.1.2 (client/src/vendor/fusion-web-sdk.js),
// 不再手写 postMessage 协议: 心跳 ping/pong、theme 后台补拉 (宿主 mount 时 push
// 可能落在 about:blank 上丢失, fusion-web-shell#77)、origin 校验均由 SDK 内部处理。
// 消费方式见 fusion-web-shell docs/module-integration-notes.md §2:
//   theme.get() 同步一次性读 (可能滞后), theme.subscribe() 为唯一事实来源。
import { isEmbedded } from './embedded';
import { createShellSdk } from '../vendor/fusion-web-sdk';
import { useUIStore } from '../stores/uiStore';
import { useLangStore } from '../stores/langStore';

let inited = false;

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

    const sdk = createShellSdk();

    // 主题: 首帧仍用模块自身初始绘制 (中性兜底), 订阅宿主变化为唯一事实来源;
    // SDK 内部后台拉取宿主真实值, 与首帧不一致时订阅回调会纠正。
    applyTheme(sdk.theme.get());
    sdk.theme.subscribe(applyTheme);

    // 语言: 走 SDK i18n 通道 (宿主 lang 事件 → subscribe 回调), 与标签标题同步机制一致
    applyLang(sdk.i18n.lang());
    sdk.i18n.subscribe(applyLang);

    // 心跳 ping/pong 由 SDK 应答, 宿主 liveness 检测标记本模块存活
    console.log('[ShellBridge] host sync initialized via @fusion/web-sdk (embedded mode)');
}
