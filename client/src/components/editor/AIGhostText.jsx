// =============================================================================
// AI Ghost Text — 内联续写 (Cmd+J)
// =============================================================================
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { apiStream } from '../../lib/api';

const ghostKey = new PluginKey('ai-ghost-text');

let ghostTimeout = null;
let ghostText = '';
let ghostFrom = 0;

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
                            if (!ghostText) return DecorationSet.empty;
                            const pos = tr.getMeta(ghostKey).from || ghostFrom;
                            const widget = document.createElement('span');
                            widget.className = 'ai-ghost-text';
                            widget.textContent = ghostText;
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
            acceptGhostText: () => ({ tr, dispatch }) => {
                if (!ghostText) return false;
                const pos = tr.selection.from;
                dispatch(tr.insertText(ghostText, pos, pos).setMeta(ghostKey, { from: pos, clear: true }));
                ghostText = '';
                return true;
            },
            rejectGhostText: () => ({ tr, dispatch }) => {
                ghostText = '';
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
                if (ghostText) {
                    this.editor.commands.acceptGhostText();
                    return true;
                }
                return false;
            },
            Escape: () => {
                if (ghostText) {
                    this.editor.commands.rejectGhostText();
                    return true;
                }
                return false;
            },
        };
    },
});

async function requestGhostCompletion(editor) {
    clearTimeout(ghostTimeout);
    const { from } = editor.state.selection;
    const textBefore = editor.state.doc.textBetween(0, from, '\n');
    const textAfter = editor.state.doc.textBetween(from, editor.state.doc.content.size, '\n').slice(0, 500);
    const pageId = editor.storage.pageId || '';
    let result = '';
    try {
        await apiStream('/api/copilot/complete', { page_id: pageId, text_before: textBefore, text_after: textAfter }, (chunk) => {
            if (chunk.choices?.[0]?.delta?.content) {
                result += chunk.choices[0].delta.content;
                ghostText = result;
                ghostFrom = from;
                editor.view.dispatch(editor.state.tr.setMeta(ghostKey, { from }));
            }
        });
    } catch (e) {
        console.warn('[GhostText] Error:', e.message);
    }
}
