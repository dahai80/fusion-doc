import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Highlight from '@tiptap/extension-highlight';
import Typography from '@tiptap/extension-typography';
import Image from '@tiptap/extension-image';
import { Placeholder, CharacterCount } from '@tiptap/extensions';
import { usePageStore } from '../../stores/pageStore';
import { useUIStore } from '../../stores/uiStore';
import { useT } from '../../stores/langStore';
import EditorToolbar from './EditorToolbar';
import { AIGhostText } from './AIGhostText';
import AIBubbleMenu from './AIBubbleMenu';
import { AISlashCommand } from './AISlashCommand';
import { BiLinkNode, BiLinkExtension } from './BiLinkExtension';
// F6 fix: WorkflowBadge / OfficePanel were implemented but never mounted, i.e. dead code.
// Wired into the editor: header gets the workflow status badge + a collapsible Office panel drawer.
import WorkflowBadge from '../workflow/WorkflowBadge';
import OfficePanel from '../office/OfficePanel';
// P0-F3 fix: the real-time collaboration (Yjs) protocol layer is not implemented (client y-websocket binary vs server JSON relay);
// the old UI "collaborate" button toggled collabEnabled but never wired a provider: dead code + a false feature claim.
// Removed the misleading UI and unwired imports; collaboration is listed as an unreleased feature (see audit report A1/A2 known limitations).

export default function EditorPage() {
    const { id } = useParams();
    const { currentPage, fetchPage, updatePage } = usePageStore();
    const toggleAIPanel = useUIStore((s) => s.toggleAIPanel);
    const t = useT();
    // F6: Office panel drawer toggle (collapsed by default)
    const [officeOpen, setOfficeOpen] = useState(false);
    const saveTimerRef = useRef(null);
    const lastContentRef = useRef('');
    // R28 fix: the onUpdate/handleKeyDown closures of useEditor are frozen when the editor is created;
    // after currentPage changes the old closures still point to the old page, so saves write to the old page.
    // Use a ref that always reads the latest currentPage; closures only read the ref and never capture page.
    const currentPageRef = useRef(currentPage);
    useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);

    useEffect(() => {
        if (id) fetchPage(id);
    }, [id]);

    const handleContentChange = useCallback((html) => {
        // R28: read the ref instead of the closure's currentPage
        const page = currentPageRef.current;
        if (!page) return;
        lastContentRef.current = html;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            updatePage(page.id, { content: html });
        }, 2000);
    }, []);

    const handleTitleChange = useCallback((title) => {
        const page = currentPageRef.current;
        if (!page) return;
        updatePage(page.id, { title });
    }, []);

    const handleSave = useCallback(() => {
        const page = currentPageRef.current;
        if (!page) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        updatePage(page.id, { content: lastContentRef.current });
    }, []);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
                codeBlock: { HTMLAttributes: { class: 'rounded-lg' } },
                // v3 StarterKit ships link/underline; configure them inside the kit to avoid duplicate registration
                link: {
                    openOnClick: false,
                    HTMLAttributes: { class: 'text-brand-400 underline' },
                },
            }),
            Table.configure({ resizable: true }),
            TableRow,
            TableCell,
            TableHeader,
            TaskList,
            TaskItem.configure({ nested: true }),
            Highlight.configure({ multicolor: true }),
            Typography,
            Image.configure({ inline: false, allowBase64: true }),
            Placeholder.configure({
                placeholder: t('开始输入，或按 / 触发 AI 命令...', 'Start typing, or press / for AI commands...'), // i18n: user-facing
            }),
            CharacterCount,
            BiLinkNode,
            BiLinkExtension,
            AIGhostText,
            AISlashCommand,
        ],
        content: currentPage?.content || '',
        onUpdate: ({ editor }) => {
            handleContentChange(editor.getHTML());
        },
        editorProps: {
            attributes: {
                class: 'tiptap-editor prose prose-invert max-w-none',
            },
            handleKeyDown: (view, event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 's') {
                    event.preventDefault();
                    handleSave();
                    return true;
                }
            },
        },
    });

    useEffect(() => {
        if (editor && currentPage) {
            editor.storage.pageId = currentPage.id;
        }
    }, [editor, currentPage?.id]);

    // Expose the live editor so the AI chat panel can insert generated
    // content (tables, code blocks, paragraphs) into the open document.
    useEffect(() => {
        window.__fusionDocEditor = editor || null;
        return () => { window.__fusionDocEditor = null; };
    }, [editor]);

    // R23 fix: initialize content only once when switching pages (id changes), avoiding a setContent/typing jitter loop.
    // P0-F3: collaboration mode removed (not implemented), so no CRDT conflicts; setContent only on id change.
    useEffect(() => {
        if (!editor || !currentPage) return;
        const current = editor.getHTML();
        const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
        if (norm(current) !== norm(currentPage.content || '')) {
            editor.commands.setContent(currentPage.content || '', false);
        }
    }, [currentPage?.id, editor]);

    if (!currentPage) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-400">
                {t('选择或创建一个文档开始编辑', 'Select or create a document to start editing')}{/* i18n: user-facing */}
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <div className="border-b border-surface-3 px-6 py-3 flex items-center gap-4">
                <input
                    type="text"
                    value={currentPage.title || ''}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    placeholder={t("文档标题", "Document title")} // i18n: user-facing
                    className="text-xl font-semibold bg-transparent border-none outline-none flex-1 text-gray-100 placeholder-gray-500"
                />
                <button
                    onClick={toggleAIPanel}
                    className="text-xs bg-brand-600 hover:bg-brand-500 px-3 py-1.5 rounded-lg flex items-center gap-1"
                >
                    🤖 AI
                </button>
                <button
                    onClick={() => setOfficeOpen((v) => !v)}
                    className="text-xs bg-surface-2 hover:bg-surface-3 px-3 py-1.5 rounded-lg"
                >
                    📄 Office
                </button>
                <WorkflowBadge pageId={currentPage.id} />
            </div>
            <EditorToolbar editor={editor} />
            <div className="flex-1 overflow-auto relative">
                <div className="max-w-4xl mx-auto">
                    <EditorContent editor={editor} />
                </div>
                <AIBubbleMenu editor={editor} pageId={currentPage.id} />
            </div>
            {officeOpen && (
                <div className="border-t border-surface-3 bg-surface-1 max-h-72 overflow-auto">
                    <OfficePanel pageId={currentPage.id} pageTitle={currentPage.title} />
                </div>
            )}
            <div className="border-t border-surface-3 px-4 py-1 flex items-center gap-4 text-xs text-gray-500">
                <span>{t('字符', 'Chars')}: {editor?.storage.characterCount?.characters() ?? 0}</span>{/* i18n: user-facing */}
                <span>{t('词数', 'Words')}: {editor?.storage.characterCount?.words() ?? 0}</span>{/* i18n: user-facing */}
                <span className="ml-auto">{t('Cmd+J AI续写 | / 命令 | [[ 双向链接 | Tab 接受', 'Cmd+J AI complete | / commands | [[ bi-links | Tab accept')}</span>{/* i18n: user-facing */}
            </div>
        </div>
    );
}
