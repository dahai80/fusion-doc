import { create } from 'zustand';
import { api } from '../lib/api';

export const useBookStore = create((set, get) => ({
    books: [],
    chapters: [],
    loading: false,
    error: null,

    async fetchBooks(workspaceId = null) {
        set({ loading: true });
        try {
            const path = workspaceId ? `/books?workspace_id=${workspaceId}` : '/books';
            const data = await api('GET', path);
            set({ books: data.data || data, loading: false });
        } catch (e) {
            set({ error: e.message, loading: false });
        }
    },

    async fetchChapters(bookId) {
        set({ loading: true });
        try {
            const data = await api('GET', `/chapters?book_id=${bookId}`);
            set({ chapters: data.data || data, loading: false });
        } catch (e) {
            set({ error: e.message, loading: false });
        }
    },

    async createBook(bookData) {
        try {
            const data = await api('POST', '/books', bookData);
            const newBook = data.data || data;
            set((s) => ({ books: [...s.books, newBook] }));
            return newBook;
        } catch (e) {
            set({ error: e.message });
            throw e;
        }
    },

    async createChapter(chapterData) {
        try {
            const data = await api('POST', '/chapters', chapterData);
            const newChapter = data.data || data;
            set((s) => ({ chapters: [...s.chapters, newChapter] }));
            return newChapter;
        } catch (e) {
            set({ error: e.message });
            throw e;
        }
    },
}));
