// =============================================================================
// AI BubbleMenu — 选中文本的 AI 操作浮窗
// =============================================================================
import { BubbleMenu } from '@tiptap/react';
import { useState } from 'react';

const ACTIONS = [
    { key: 'rewrite', label: '改写', icon: '✏️' },
    { key: 'translate', label: '翻译', icon: '🌐' },
    { key: 'summarize', label: '摘要', icon: '📋' },
    { key: 'expand', label: '展开', icon: '↔️' },
];

export default function AIBubbleMenu({ editor, pageId }) {
    const [loading, setLoading] = useState(false);

    if (!editor) return null;

    const handleAction = async (action, extra) => {
        const { from, to } = editor.state.selection;
        const selectedText = editor.state.doc.textBetween(from, to, '\n');
        if (!selectedText.trim()) return;
        const textBefore = editor.state.doc.textBetween(0, from, '\n');
        const textAfter = editor.state.doc.textBetween(to, editor.state.doc.content.size, '\n');

        setLoading(true);
        let result = '';
        try {
            const { apiStream } = await import('../../lib/api');
            await apiStream(`/api/copilot/${action}`, {
                page_id: pageId,
                text_before: textBefore,
                selected_text: selectedText,
                text_after: textAfter,
                language: action === 'translate' ? (extra || '英文') : undefined,
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
        } finally {
            setLoading(false);
        }
    };

    return (
        <BubbleMenu editor={editor} tippyOptions={{ duration: 150 }} shouldShow={({ state }) => {
            const { from, to } = state.selection;
            return from !== to;
        }}>
            <div className="ai-bubble-menu flex items-center gap-1 bg-surface-1 border border-surface-2 rounded-lg px-2 py-1 shadow-xl">
                {ACTIONS.map(a => (
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
        </BubbleMenu>
    );
}
