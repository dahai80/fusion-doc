import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Highlight from '@tiptap/extension-highlight';
import Typography from '@tiptap/extension-typography';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { usePageStore } from '../../stores/pageStore';
import { useUIStore } from '../../stores/uiStore';
import EditorToolbar from './EditorToolbar';
import { AIGhostText } from './AIGhostText';
import AIBubbleMenu from './AIBubbleMenu';
import { AISlashCommand } from './AISlashCommand';
import { BiLinkNode, BiLinkExtension } from './BiLinkExtension';
import { getCollabExtensions, destroyYjsConnection } from '../../lib/yjs-provider';

export default function EditorPage() {
    const { id } = useParams();
    const { currentPage, fetchPage, updatePage } = usePageStore();
    const toggleAIPanel = useUIStore((s) => s.toggleAIPanel);
    const saveTimerRef = useRef(null);
    const lastContentRef = useRef('');
    const [collabEnabled, setCollabEnabled] = useState(false);

    useEffect(() => {
        if (id) fetchPage(id);
    }, [id]);

    useEffect(() => {
        return () => { destroyYjsConnection(); };
    }, []);

    const handleContentChange = useCallback((html) => {
        if (!currentPage) return;
        lastContentRef.current = html;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            updatePage(currentPage.id, { content: html });
        }, 2000);
    }, [currentPage]);

    const handleTitleChange = useCallback((title) => {
        if (!currentPage) return;
        updatePage(currentPage.id, { title });
    }, [currentPage]);

    const handleSave = useCallback(() => {
        if (!currentPage) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        updatePage(currentPage.id, { content: lastContentRef.current });
    }, [currentPage]);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
                codeBlock: { HTMLAttributes: { class: 'rounded-lg' } },
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
            Link.configure({
                openOnClick: false,
                HTMLAttributes: { class: 'text-brand-400 underline' },
            }),
            Underline,
            Placeholder.configure({
                placeholder: '开始输入，或按 / 触发 AI 命令...',
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

    useEffect(() => {
        if (editor && currentPage && currentPage.content !== editor.getHTML()) {
            editor.commands.setContent(currentPage.content || '');
        }
    }, [currentPage?.id]);

    if (!currentPage) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-400">
                选择或创建一个文档开始编辑
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
                    placeholder="文档标题"
                    className="text-xl font-semibold bg-transparent border-none outline-none flex-1 text-gray-100 placeholder-gray-500"
                />
                <button
                    onClick={() => setCollabEnabled(prev => !prev)}
                    className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 ${collabEnabled ? 'bg-green-600 hover:bg-green-500' : 'bg-surface-2 hover:bg-surface-3'}`}
                >
                    {collabEnabled ? '🟢 协作中' : '👥 协作'}
                </button>
                <button
                    onClick={toggleAIPanel}
                    className="text-xs bg-brand-600 hover:bg-brand-500 px-3 py-1.5 rounded-lg flex items-center gap-1"
                >
                    🤖 AI
                </button>
            </div>
            <EditorToolbar editor={editor} />
            <div className="flex-1 overflow-auto relative">
                <div className="max-w-4xl mx-auto">
                    <EditorContent editor={editor} />
                </div>
                <AIBubbleMenu editor={editor} pageId={currentPage.id} />
            </div>
            <div className="border-t border-surface-3 px-4 py-1 flex items-center gap-4 text-xs text-gray-500">
                <span>字符: {editor?.storage.characterCount?.characters() ?? 0}</span>
                <span>词数: {editor?.storage.characterCount?.words() ?? 0}</span>
                <span className="ml-auto">Cmd+J AI续写 | / 命令 | [[ 双向链接 | Tab 接受</span>
            </div>
        </div>
    );
}
