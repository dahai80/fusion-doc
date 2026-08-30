// =============================================================================
// AI Ghost Text — 内联续写 (Cmd+J)
// R22 修复: ghostText/ghostFrom/ghostTimeout 原为模块级全局变量, 多 editor 实例
// (StrictMode 双挂载/同时开两页) 共享同一状态 → A 编辑器续写渲染进 B 编辑器,
// Tab 插入错位。改为存于 editor.storage (per-editor 作用域), 各实例隔离。
// =============================================================================
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { apiStream } from '../../lib/api';

const ghostKey = new PluginKey('ai-ghost-text');

function getGhostState(editor) {
    if (!editor.storage.aiGhostState) {
        editor.storage.aiGhostState = { text: '', from: 0, timeout: null };
    }
    return editor.storage.aiGhostState;
}

export const AIGhostText = Extension.create({
    name: 'aiGhostText',

    addOptions() {
        return { delay: 1500 };
    },

    addProseMirrorPlugins() {
        const editor = this.editor;
        return [
            new Plugin({
                key: ghostKey,
                state: {
                    init: () => DecorationSet.empty,
                    apply(tr, old) {
                        if (tr.getMeta(ghostKey)) {
                            const gs = getGhostState(editor);
                            if (!gs.text) return DecorationSet.empty;
                            const pos = tr.getMeta(ghostKey).from || gs.from;
                            const widget = document.createElement('span');
                            widget.className = 'ai-ghost-text';
                            widget.textContent = gs.text;
                            widget.style.color = 'var(--ai-ghost, #888)';
                            widget.style.pointerEvents = 'none';
                            return DecorationSet.create(tr.doc, [
                                Decoration.widget(pos, widget, { side: 1 }),
                            ]);
                        }
                        if (tr.docChanged) return DecorationSet.empty;
                        return old.map(tr.mapping, tr.doc);
                    },
                },
                props: {
                    decorations(state) {
                        return this.getState(state);
                    },
                },
            }),
        ];
    },

    addCommands() {
        return {
            // R22 修复: accept 用 ghostFrom (续写起始位) 而非 tr.selection.from,
            // 光标移动后不致在错误位置插入。
            acceptGhostText: () => ({ tr, dispatch }) => {
                const gs = getGhostState(this.editor);
                if (!gs.text) return false;
                const pos = gs.from;
                dispatch(tr.insertText(gs.text, pos, pos).setMeta(ghostKey, { from: pos, clear: true }));
                gs.text = '';
                gs.from = 0;
                return true;
            },
            rejectGhostText: () => ({ tr, dispatch }) => {
                const gs = getGhostState(this.editor);
                gs.text = '';
                gs.from = 0;
                dispatch(tr.setMeta(ghostKey, { from: 0, clear: true }));
                return true;
            },
            triggerGhostText: () => ({ editor }) => {
                requestGhostCompletion(editor);
                return true;
            },
        };
    },

    addKeyboardShortcuts() {
        return {
            'Mod-j': () => this.editor.commands.triggerGhostText(),
            Tab: () => {
                const gs = getGhostState(this.editor);
                if (gs.text) {
                    this.editor.commands.acceptGhostText();
                    return true;
                }
                return false;
            },
            Escape: () => {
                const gs = getGhostState(this.editor);
                if (gs.text) {
                    this.editor.commands.rejectGhostText();
                    return true;
                }
                return false;
            },
        };
    },
});

async function requestGhostCompletion(editor) {
    const gs = getGhostState(editor);
    if (gs.timeout) clearTimeout(gs.timeout);
    const { from } = editor.state.selection;
    const textBefore = editor.state.doc.textBetween(0, from, '\n');
    const textAfter = editor.state.doc.textBetween(from, editor.state.doc.content.size, '\n').slice(0, 500);
    const pageId = editor.storage.pageId || '';
    let result = '';
    gs.from = from;
    try {
        await apiStream('/copilot/complete', { page_id: pageId, text_before: textBefore, text_after: textAfter }, (chunk) => {
            if (chunk.choices?.[0]?.delta?.content) {
                result += chunk.choices[0].delta.content;
                gs.text = result;
                gs.from = from;
                editor.view.dispatch(editor.state.tr.setMeta(ghostKey, { from }));
            }
        });
    } catch (e) {
        console.warn('[GhostText] Error:', e.message);
        gs.text = '';
    }
}
