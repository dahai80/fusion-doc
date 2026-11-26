// ── Language store (issue #58 prerequisite): zh/en bilingual, persisted as fusion-doc-lang ──
// When embedded in the shell, shell-bridge takes over (follows host lang events); standalone mode reads the local preference
import { create } from 'zustand';

const KEY = 'fusion-doc-lang';

function getInitialLang() {
    try {
        const saved = localStorage.getItem(KEY);
        if (saved === 'zh' || saved === 'en') return saved;
    } catch (e) { /* fall back to the browser language when localStorage is unavailable */ }
    return (navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export const useLangStore = create((set) => ({
    lang: getInitialLang(),
    setLang(lang) {
        if (lang !== 'zh' && lang !== 'en') return;
        set({ lang });
        try { localStorage.setItem(KEY, lang); } catch (e) { /* only affects persistence, does not block switching */ }
        console.log('[Lang] switched to', lang);
    },
}));

// For non-component contexts (event callbacks/constant tables): reads current state directly, no subscription
export function t(zh, en) {
    return useLangStore.getState().lang === 'en' ? en : zh;
}

// For components: subscribes to lang changes to re-render, returns a stable function reference
const tZh = (zh, en) => zh;
const tEn = (zh, en) => en;
export function useT() {
    const lang = useLangStore((s) => s.lang);
    return lang === 'en' ? tEn : tZh;
}
