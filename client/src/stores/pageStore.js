import { create } from 'zustand';
import { api } from '../lib/api';

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
            set({ pages: data.data || data, loading: false });
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
            set((s) => ({ pages: [...s.pages, newPage] }));
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
