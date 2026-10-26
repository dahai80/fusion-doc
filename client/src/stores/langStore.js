// ── 语言 store (issue #58 前置): zh/en 双语, 持久化 fusion-doc-lang ──
// shell 内嵌时由 shell-bridge 接管 (跟随宿主 lang 事件); 独立模式读本地偏好
import { create } from 'zustand';

const KEY = 'fusion-doc-lang';

function getInitialLang() {
    try {
        const saved = localStorage.getItem(KEY);
        if (saved === 'zh' || saved === 'en') return saved;
    } catch (e) { /* localStorage 不可用时回退浏览器语言 */ }
    return (navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export const useLangStore = create((set) => ({
    lang: getInitialLang(),
    setLang(lang) {
        if (lang !== 'zh' && lang !== 'en') return;
        set({ lang });
        try { localStorage.setItem(KEY, lang); } catch (e) { /* 只影响持久化, 不阻塞切换 */ }
        console.log('[Lang] switched to', lang);
    },
}));

// 非组件上下文用 (事件回调/常量表): 直读当前 state, 无订阅
export function t(zh, en) {
    return useLangStore.getState().lang === 'en' ? en : zh;
}

// 组件内用: 订阅 lang 变化触发重渲染, 返回稳定函数引用
const tZh = (zh, en) => zh;
const tEn = (zh, en) => en;
export function useT() {
    const lang = useLangStore((s) => s.lang);
    return lang === 'en' ? tEn : tZh;
}
