import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:11449',
                changeOrigin: true,
            },
            '/ws': {
                target: 'ws://localhost:11449',
                ws: true,
            },
        },
    },
    build: {
        outDir: '../gateway/public',
        emptyOutDir: true,
        rollupOptions: {
            output: {
                manualChunks: {
                    'vendor-react': ['react', 'react-dom', 'react-router-dom'],
                    'vendor-tiptap': [
                        '@tiptap/react', '@tiptap/starter-kit', '@tiptap/extension-table',
                        '@tiptap/extension-task-list', '@tiptap/extension-highlight',
                        '@tiptap/extension-image', '@tiptap/extension-link',
                        '@tiptap/extension-placeholder', '@tiptap/extension-character-count',
                        '@tiptap/suggestion',
                    ],
                    'vendor-d3': ['d3'],
                },
            },
        },
    },
});
