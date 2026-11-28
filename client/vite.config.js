import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    // issue #51: relative base — the same build can be deployed standalone at the root path, or mounted by the gateway
    // under the /shell/fusion-doc/ subpath (Union Web iframe same-origin proxy)
    base: './',
    server: {
        // issue #51: 5173 is a port-registry reserved port (off-limits for app ports); moved to the registered 11477
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
            // issue #90: office ai-client dev relay — same convention as the office apps,
            // so browser AI calls reach fusion-gateway :11432 without CORS setup in dev
            '/__fusion_gateway': {
                target: 'http://127.0.0.1:11432',
                changeOrigin: true,
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
                        '@tiptap/react', '@tiptap/react/menus', '@tiptap/starter-kit',
                        '@tiptap/extension-table', '@tiptap/extension-task-list',
                        '@tiptap/extension-highlight', '@tiptap/extension-image',
                        '@tiptap/extensions', '@tiptap/suggestion',
                    ],
                    'vendor-d3': ['d3'],
                },
            },
        },
    },
});
