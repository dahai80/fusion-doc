// =============================================================================
// AI Ghost Text — inline continuation (Cmd+J)
// R22 fix: ghostText/ghostFrom/ghostTimeout used to be module-level globals, so multiple editor instances
// (StrictMode double mount / two pages open at once) shared the same state → editor A's continuation rendered into editor B,
// and Tab inserted at the wrong place. Now stored in editor.storage (per-editor scope), isolating each instance.
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
            // R22 fix: accept uses ghostFrom (the continuation start position) rather than tr.selection.from,
            // so it doesn't insert at the wrong position after the cursor moves.
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
