// =============================================================================
// AI Slash Command — / command palette
// =============================================================================
import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy from 'tippy.js';
import { t } from '../../stores/langStore';

// Locale-sensitive command table — built on every filter, so a language switch takes effect on the next palette
const commands = () => ([
    { title: t('AI 续写', 'AI Continue'), description: t('继续当前内容', 'Continue current content'), command: 'complete', icon: '✨' }, // i18n: user-facing
    { title: t('AI 改写', 'AI Rewrite'), description: t('改写选中/前文', 'Rewrite selection/context'), command: 'rewrite', icon: '✏️' }, // i18n: user-facing
    { title: t('翻译为英文', 'Translate to English'), description: t('翻译选中内容', 'Translate selection'), command: 'translate', language: '英文', icon: '🌐' }, // i18n: user-facing
    { title: t('翻译为中文', 'Translate to Chinese'), description: t('翻译选中内容', 'Translate selection'), command: 'translate', language: '中文', icon: '🌐' }, // i18n: user-facing
    { title: t('生成摘要', 'Summarize'), description: t('对前文生成摘要', 'Summarize preceding text'), command: 'summarize', icon: '📋' }, // i18n: user-facing
    { title: t('内容展开', 'Expand'), description: t('展开详细阐述', 'Elaborate in detail'), command: 'expand', icon: '↔️' }, // i18n: user-facing
    { title: t('自定义指令', 'Custom instruction'), description: t('输入自然语言指令', 'Enter a natural-language instruction'), command: 'custom', icon: '💬' }, // i18n: user-facing
]);

export const AISlashCommand = Extension.create({
    name: 'aiSlashCommand',

    addOptions() {
        return {
            suggestion: {
                // v3: the two Suggestion instances (slash + biLink) share pluginKey 'suggestion$' by default,
                // and ProseMirror rejects duplicate keyed plugins — a unique key must be set explicitly
                pluginKey: new PluginKey('aiSlashSuggestion'),
                char: '/',
                command: ({ editor, range, props }) => {
                    editor.chain().focus().deleteRange(range).run();
                    if (props.onSelect) props.onSelect(editor);
                },
                items: ({ query }) => {
                    return commands().filter(c =>
                        c.title.toLowerCase().includes(query.toLowerCase()) ||
                        c.description.includes(query)
                    );
                },
                render: () => {
                    let reactRenderer;
                    let popup;
                    return {
                        onStart(props) {
                            reactRenderer = new ReactRenderer(SlashCommandList, { props, editor: props.editor });
                            popup = tippy('body', {
                                getReferenceClientRect: props.clientRect,
                                appendTo: () => document.body,
                                content: reactRenderer.element,
                                showOnCreate: true,
                                interactive: true,
                                trigger: 'manual',
                                placement: 'bottom-start',
                            });
                        },
                        onUpdate(props) {
                            reactRenderer.updateProps(props);
                            popup[0].setProps({ getReferenceClientRect: props.clientRect });
                        },
                        onKeyDown(props) {
                            return reactRenderer.ref?.onKeyDown(props.event);
                        },
                        onExit() {
                            popup[0]?.destroy();
                            reactRenderer?.destroy();
                        },
                    };
                },
            },
        };
    },

    addProseMirrorPlugins() {
        return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
    },
});

import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';

const SlashCommandList = forwardRef(function SlashCommandList({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => { setSelectedIndex(0); }, [items]);

    const selectItem = (index) => {
        const item = items[index];
        if (!item) return;
        command({ ...item, onSelect: (editor) => handleSlashAction(editor, item) });
    };

    useImperativeHandle(ref, () => ({
        onKeyDown: ({ key }) => {
            if (key === 'ArrowUp') { setSelectedIndex(i => (i - 1 + items.length) % items.length); return true; }
            if (key === 'ArrowDown') { setSelectedIndex(i => (i + 1) % items.length); return true; }
            if (key === 'Enter') { selectItem(selectedIndex); return true; }
            return false;
        },
    }));

    if (!items.length) return null;

    return (
        <div className="slash-command-list bg-surface-1 border border-surface-2 rounded-lg shadow-2xl py-1 w-64 max-h-64 overflow-y-auto">
            {items.map((item, i) => (
                <button
                    key={item.command + item.title}
                    onClick={() => selectItem(i)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${i === selectedIndex ? 'bg-surface-2 text-white' : 'text-gray-300 hover:bg-surface-2'}`}
                >
                    <span className="text-base">{item.icon}</span>
                    <div>
                        <div className="font-medium">{item.title}</div>
                        <div className="text-xs text-gray-500">{item.description}</div>
                    </div>
                </button>
            ))}
        </div>
    );
});

async function handleSlashAction(editor, item) {
    const { from, to } = editor.state.selection;
    const selectedText = from !== to ? editor.state.doc.textBetween(from, to, '\n') : '';
    const textBefore = editor.state.doc.textBetween(0, from, '\n');
    const textAfter = editor.state.doc.textBetween(to || from, editor.state.doc.content.size, '\n');
    const pageId = editor.storage.pageId || '';

    let endpoint = `/copilot/${item.command}`;
    let body = { page_id: pageId, text_before: textBefore, selected_text: selectedText, text_after: textAfter };
    if (item.language) body.language = item.language;
    if (item.command === 'custom') {
        const prompt = window.prompt(t('输入 AI 指令:', 'Enter AI instruction:')); // i18n: user-facing
        if (!prompt) return;
        endpoint = '/copilot/command';
        body = { ...body, command: 'custom', prompt };
    }

    const { apiStream } = await import('../../lib/api');
    let result = '';
    try {
        await apiStream(endpoint, body, (chunk) => {
            if (chunk.choices?.[0]?.delta?.content) {
                result += chunk.choices[0].delta.content;
            }
        });
    } catch (e) {
        // issue #69: show server rejections (e.g. 413 selection too large) visibly instead of failing silently
        console.error('[AISlashCommand] Error:', e);
        window.alert(e.message || 'AI 请求失败'); // i18n: user-facing
        return;
    }
    if (result.trim()) {
        if (selectedText && from !== to) {
            editor.chain().focus().deleteSelection().insertContent(result).run();
        } else {
            editor.chain().focus().insertContent(result).run();
        }
    }
}
