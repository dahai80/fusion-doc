import React from 'react';
import { usePageStore } from '../../stores/pageStore';
import { useUIStore } from '../../stores/uiStore';

export default function StatusBar() {
    const currentPage = usePageStore((s) => s.currentPage);
    const aiPanelOpen = useUIStore((s) => s.aiPanelOpen);

    return (
        <div className="h-7 bg-surface-1 border-t border-surface-3 flex items-center px-4 text-xs text-gray-400 gap-4">
            <span>📄 {currentPage ? '1 页面' : '0 页面'}</span>
            {currentPage && <span>💬 {currentPage.comment_count || 0} 评论</span>}
            <span>🔄 自动保存</span>
            <span className="ml-auto">🤖 Fusion-MLX</span>
        </div>
    );
}
