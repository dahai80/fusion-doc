import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Extension, Node, mergeAttributes } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy from 'tippy.js';
import { api } from '../../lib/api';

// ---------------------------------------------------------------------------
// BiLink Node — inline [[Page Title]] link with data-bi-link attribute
// ---------------------------------------------------------------------------
export const BiLinkNode = Node.create({
    name: 'biLink',
    group: 'inline',
    inline: true,
    attrs: { pageId: { default: '' }, pageTitle: { default: '' } },

    parseHTML() { return [{ tag: 'a[data-bi-link]' }]; },

    renderHTML({ HTMLAttributes }) {
        return ['a', mergeAttributes(HTMLAttributes, {
            'data-bi-link': '',
            href: `/page/${HTMLAttributes.pageId}`,
            class: 'bi-link text-brand-400 underline cursor-pointer hover:text-brand-300',
            'data-page-id': HTMLAttributes.pageId,
        }), `[[${HTMLAttributes.pageTitle}]]`];
    },

    addNodeView() {
        return ({ node }) => {
            const a = document.createElement('a');
            a.href = `/page/${node.attrs.pageId}`;
            a.className = 'bi-link text-brand-400 underline cursor-pointer hover:text-brand-300';
            a.dataset.biLink = '';
            a.dataset.pageId = node.attrs.pageId;
            a.textContent = `[[${node.attrs.pageTitle}]]`;
            a.addEventListener('click', (e) => {
                e.preventDefault();
                window.location.href = `/page/${node.attrs.pageId}`;
            });
            return { dom: a };
        };
    },
});

// ---------------------------------------------------------------------------
// Back-link helper — POST reverse link to server
// ---------------------------------------------------------------------------
async function createBackLink(sourcePageId, targetPageId) {
    if (!sourcePageId || !targetPageId || sourcePageId === targetPageId) return;
    try {
        await api('POST', `/api/pages/${targetPageId}/links`, {
            target_page_id: sourcePageId,
            link_type: 'backlink',
        });
        console.log('[BiLink] back-link created:', sourcePageId, '→', targetPageId);
    } catch (e) {
        console.warn('[BiLink] back-link creation failed:', e.message);
    }
}

// ---------------------------------------------------------------------------
// Suggestion dropdown component
// ---------------------------------------------------------------------------
const BiLinkSuggestionList = forwardRef(function BiLinkSuggestionList({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => { setSelectedIndex(0); }, [items]);

    const selectItem = (index) => {
        const item = items[index];
        if (item) command(item);
    };

    useImperativeHandle(ref, () => ({
        onKeyDown: ({ key }) => {
            if (key === 'ArrowUp') { setSelectedIndex(i => (i - 1 + items.length) % items.length); return true; }
            if (key === 'ArrowDown') { setSelectedIndex(i => (i + 1) % items.length); return true; }
            if (key === 'Enter') { selectItem(selectedIndex); return true; }
            return false;
        },
    }));

    if (!items.length) return <div className="text-xs text-gray-500 p-2">无匹配页面</div>;

    return (
        <div className="bg-surface-1 border border-surface-2 rounded-lg shadow-2xl py-1 w-64 max-h-48 overflow-y-auto">
            {items.map((item, i) => (
                <button
                    key={item.pageId}
                    onClick={() => selectItem(i)}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${i === selectedIndex ? 'bg-surface-2 text-white' : 'text-gray-300 hover:bg-surface-2'}`}
                >
                    [[{item.pageTitle}]]
                </button>
            ))}
        </div>
    );
});

// ---------------------------------------------------------------------------
// BiLink Extension — [[ trigger → Suggestion dropdown → insert link + backlink
// ---------------------------------------------------------------------------
export const BiLinkExtension = Extension.create({
    name: 'biLinkExtension',

    addOptions() {
        return {
            suggestion: {
                char: '[[',
                command: ({ editor, range, props }) => {
                    const { pageId, pageTitle } = props;
                    editor.chain().focus().deleteRange(range).insertContent({
                        type: 'biLink',
                        attrs: { pageId, pageTitle },
                    }).run();
                    createBackLink(editor.storage.pageId, pageId);
                },
                items: async ({ query }) => {
                    try {
                        const data = await api('GET', `/api/search?q=${encodeURIComponent(query)}`);
                        return (data.results || []).slice(0, 8).map(p => ({
                            pageId: p.id,
                            pageTitle: p.title,
                        }));
                    } catch (e) {
                        console.warn('[BiLink] search failed:', e.message);
                        return [];
                    }
                },
                render: () => {
                    let reactRenderer;
                    let popup;
                    return {
                        onStart(props) {
                            reactRenderer = new ReactRenderer(BiLinkSuggestionList, { props, editor: props.editor });
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
                            popup[0]?.setProps({ getReferenceClientRect: props.clientRect });
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
        return [
            Suggestion({ editor: this.editor, ...this.options.suggestion }),
        ];
    },
});
