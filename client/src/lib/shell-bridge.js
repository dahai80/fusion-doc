// ── Shell bridge (issue #58 → #62): follow the host theme/language when embedded in fusion-web-shell ──
// Since #62 this uses the vendored @fusion/web-sdk v0.1.2 (client/src/vendor/fusion-web-sdk.js)
// instead of a hand-written postMessage protocol: heartbeat ping/pong, background theme re-fetch (a push at host mount
// can land on about:blank and be lost, fusion-web-shell#77), and origin checks are all handled inside the SDK.
// Usage: see fusion-web-shell docs/module-integration-notes.md §2:
//   theme.get() is a one-off synchronous read (may lag); theme.subscribe() is the single source of truth.
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

    // Theme: the first frame still uses the module's own initial paint (neutral fallback); host changes via subscribe are the single source of truth;
    // the SDK fetches the host's real value in the background, and the subscribe callback corrects it if it differs from the first frame.
    applyTheme(sdk.theme.get());
    sdk.theme.subscribe(applyTheme);

    // Language: goes through the SDK i18n channel (host lang event → subscribe callback), same sync mechanism as tab titles
    applyLang(sdk.i18n.lang());
    sdk.i18n.subscribe(applyLang);

    // Heartbeat ping/pong is answered by the SDK; the host's liveness check marks this module alive
    console.log('[ShellBridge] host sync initialized via @fusion/web-sdk (embedded mode)');
}
