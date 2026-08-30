// =============================================================================
// AI Slash Command — / 命令面板
// =============================================================================
import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy from 'tippy.js';

const COMMANDS = [
    { title: 'AI 续写', description: '继续当前内容', command: 'complete', icon: '✨' },
    { title: 'AI 改写', description: '改写选中/前文', command: 'rewrite', icon: '✏️' },
    { title: '翻译为英文', description: '翻译选中内容', command: 'translate', language: '英文', icon: '🌐' },
    { title: '翻译为中文', description: '翻译选中内容', command: 'translate', language: '中文', icon: '🌐' },
    { title: '生成摘要', description: '对前文生成摘要', command: 'summarize', icon: '📋' },
    { title: '内容展开', description: '展开详细阐述', command: 'expand', icon: '↔️' },
    { title: '自定义指令', description: '输入自然语言指令', command: 'custom', icon: '💬' },
];

export const AISlashCommand = Extension.create({
    name: 'aiSlashCommand',

    addOptions() {
        return {
            suggestion: {
                char: '/',
                command: ({ editor, range, props }) => {
                    editor.chain().focus().deleteRange(range).run();
                    if (props.onSelect) props.onSelect(editor);
                },
                items: ({ query }) => {
                    return COMMANDS.filter(c =>
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
        const prompt = window.prompt('输入 AI 指令:');
        if (!prompt) return;
        endpoint = '/copilot/command';
        body = { ...body, command: 'custom', prompt };
    }

    const { apiStream } = await import('../../lib/api');
    let result = '';
    await apiStream(endpoint, body, (chunk) => {
        if (chunk.choices?.[0]?.delta?.content) {
            result += chunk.choices[0].delta.content;
        }
    });
    if (result.trim()) {
        if (selectedText && from !== to) {
            editor.chain().focus().deleteSelection().insertContent(result).run();
        } else {
            editor.chain().focus().insertContent(result).run();
        }
    }
}
