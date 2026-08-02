import { create } from 'zustand';

function getInitialTheme() {
    try {
        const saved = localStorage.getItem('fusion-doc-theme');
        if (saved) return saved;
    } catch {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { localStorage.setItem('fusion-doc-theme', theme); } catch {}
}

applyTheme(getInitialTheme());

export const useUIStore = create((set) => ({
    sidebarOpen: true,
    aiPanelOpen: false,
    aiPanelMode: 'chat',
    theme: getInitialTheme(),
    activeView: 'editor',

    toggleSidebar() {
        set((s) => ({ sidebarOpen: !s.sidebarOpen }));
    },
    toggleAIPanel() {
        set((s) => ({ aiPanelOpen: !s.aiPanelOpen }));
    },
    setAIPanelMode(mode) {
        set({ aiPanelMode: mode, aiPanelOpen: true });
    },
    setTheme(theme) {
        applyTheme(theme);
        set({ theme });
    },
    toggleTheme() {
        set((s) => {
            const next = s.theme === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            return { theme: next };
        });
    },
    setActiveView(view) {
        set({ activeView: view });
    },
}));
