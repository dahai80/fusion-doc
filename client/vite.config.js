import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    // issue #51: 相对 base — 同一构建产物既可独立部署于根路径, 也可由 gateway
    // 挂载到 /shell/fusion-doc/ 子路径 (Union Web iframe 同源代理)
    base: './',
    server: {
        // issue #51: 5173 属 port-registry 保留端口 (业务端口禁占), 迁至注册的 11477
        port: 11477,
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
