import { create } from 'zustand';
import { api } from '../lib/api';

// E21 修复: pages 数组无上限, 大库长期运行 (createPage 累积) 会无限增长致前端 OOM。
// 设硬上限, 超出按 FIFO 丢弃最旧项。
const MAX_PAGES = 2000;
function capPages(arr) {
    return arr.length > MAX_PAGES ? arr.slice(arr.length - MAX_PAGES) : arr;
}

export const usePageStore = create((set, get) => ({
    pages: [],
    currentPage: null,
    loading: false,
    error: null,

    async fetchPages(bookId = null) {
        set({ loading: true, error: null });
        try {
            const path = bookId ? `/pages?book_id=${bookId}` : '/pages';
            const data = await api('GET', path);
            const arr = data.data || data;
            set({ pages: capPages(Array.isArray(arr) ? arr : []), loading: false });
        } catch (e) {
            set({ error: e.message, loading: false });
        }
    },

    async fetchPage(id) {
        set({ loading: true, error: null });
        try {
            const data = await api('GET', `/pages/${id}`);
            set({ currentPage: data.data || data, loading: false });
        } catch (e) {
            set({ error: e.message, loading: false });
        }
    },

    async createPage(pageData) {
        try {
            const data = await api('POST', '/pages', pageData);
            const newPage = data.data || data;
            set((s) => ({ pages: capPages([...s.pages, newPage]) }));
            return newPage;
        } catch (e) {
            set({ error: e.message });
            throw e;
        }
    },

    async updatePage(id, updates) {
        try {
            const data = await api('PUT', `/pages/${id}`, updates);
            const updated = data.data || data;
            set((s) => ({
                pages: s.pages.map((p) => (p.id === id ? updated : p)),
                currentPage: s.currentPage?.id === id ? updated : s.currentPage,
            }));
            return updated;
        } catch (e) {
            set({ error: e.message });
            throw e;
        }
    },

    async deletePage(id) {
        try {
            await api('DELETE', `/pages/${id}`);
            set((s) => ({
                pages: s.pages.filter((p) => p.id !== id),
                currentPage: s.currentPage?.id === id ? null : s.currentPage,
            }));
        } catch (e) {
            set({ error: e.message });
        }
    },

    setCurrentPage(page) {
        set({ currentPage: page });
    },
}));
