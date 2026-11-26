// =============================================================================
// AI BubbleMenu — floating AI actions for selected text
// =============================================================================
import { BubbleMenu } from '@tiptap/react/menus';
import { useState } from 'react';
import { t } from '../../stores/langStore';

// Language-sensitive action table — rebuilt on every render so language switches take effect immediately
const actions = () => ([
    { key: 'rewrite', label: t('改写', 'Rewrite'), icon: '✏️' }, // i18n: user-facing
    { key: 'translate', label: t('翻译', 'Translate'), icon: '🌐' }, // i18n: user-facing
    { key: 'summarize', label: t('摘要', 'Summarize'), icon: '📋' }, // i18n: user-facing
    { key: 'expand', label: t('展开', 'Expand'), icon: '↔️' }, // i18n: user-facing
]);

export default function AIBubbleMenu({ editor, pageId }) {
    const [loading, setLoading] = useState(false);
    // issue #69: server rejections (selection over limit 413, etc.) are shown directly, not just logged to the console
    const [err, setErr] = useState('');

    if (!editor) return null;

    const handleAction = async (action, extra) => {
        const { from, to } = editor.state.selection;
        const selectedText = editor.state.doc.textBetween(from, to, '\n');
        if (!selectedText.trim()) return;
        const textBefore = editor.state.doc.textBetween(0, from, '\n');
        const textAfter = editor.state.doc.textBetween(to, editor.state.doc.content.size, '\n');

        setLoading(true);
        setErr('');
        let result = '';
        try {
            const { apiStream } = await import('../../lib/api');
            await apiStream(`/copilot/${action}`, {
                page_id: pageId,
                text_before: textBefore,
                selected_text: selectedText,
                text_after: textAfter,
                language: action === 'translate' ? (extra || '英文') : undefined, // i18n: user-facing
                instruction: action === 'rewrite' ? extra : undefined,
            }, (chunk) => {
                if (chunk.choices?.[0]?.delta?.content) {
                    result += chunk.choices[0].delta.content;
                }
            });
            if (result.trim()) {
                editor.chain().focus().deleteSelection().insertContent(result).run();
            }
        } catch (e) {
            console.error('[AIBubbleMenu] Error:', e);
            setErr(e.message || 'AI 请求失败'); // i18n: user-facing
            setTimeout(() => setErr(''), 5000);
        } finally {
            setLoading(false);
        }
    };

    return (
        <BubbleMenu editor={editor} tippyOptions={{ duration: 150 }} shouldShow={({ state }) => {
            const { from, to } = state.selection;
            return from !== to;
        }}>
            <div className="ai-bubble-menu flex flex-col gap-1 bg-surface-1 border border-surface-2 rounded-lg px-2 py-1 shadow-xl">
                <div className="flex items-center gap-1">
                    {actions().map(a => (
                        <button
                            key={a.key}
                            disabled={loading}
                            onClick={() => handleAction(a.key)}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-300 hover:bg-surface-2 rounded transition-colors disabled:opacity-40"
                            title={a.label}
                        >
                            <span>{a.icon}</span>
                            <span>{a.label}</span>
                        </button>
                    ))}
                </div>
                {err && (
                    <div className="px-2 py-1 text-xs text-red-400 max-w-xs break-all" role="alert">
                        {err}
                    </div>
                )}
            </div>
        </BubbleMenu>
    );
}
