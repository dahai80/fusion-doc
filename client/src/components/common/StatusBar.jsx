import React from 'react';
import { usePageStore } from '../../stores/pageStore';
import { useUIStore } from '../../stores/uiStore';
import { useT } from '../../stores/langStore';

export default function StatusBar() {
    const currentPage = usePageStore((s) => s.currentPage);
    const aiPanelOpen = useUIStore((s) => s.aiPanelOpen);
    const t = useT();

    return (
        <div className="h-7 bg-surface-1 border-t border-surface-3 flex items-center px-4 text-xs text-gray-400 gap-4">
            <span>📄 {currentPage ? t('1 页面', '1 page') : t('0 页面', '0 pages')}</span>
            {currentPage && <span>💬 {currentPage.comment_count || 0} {t('评论', 'comments')}</span>}
            <span>🔄 {t('自动保存', 'Auto-save')}</span>
            <span className="ml-auto">🤖 Fusion-MLX</span>
        </div>
    );
}
