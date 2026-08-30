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
    // R28 修复: useEditor 的 onUpdate/handleKeyDown 闭包在 editor 创建时冻结,
    // currentPage 变化后旧闭包仍指向旧 page, 保存写入旧 page。
    // 用 ref 始终读最新 currentPage, 闭包只读 ref 不捕获 page。
    const currentPageRef = useRef(currentPage);
    useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
    // R23 修复: setContent 节流标志。远端更新触发 onUpdate 回写时不重入 setContent。
    const applyingRemoteRef = useRef(false);

    useEffect(() => {
        if (id) fetchPage(id);
    }, [id]);

    // R24 修复: 卸载时只销毁本页连接, 不清全部 (多 tab 编辑其他页不应被波及)
    useEffect(() => {
        return () => { if (id) destroyYjsConnection(id); };
    }, [id]);

    const handleContentChange = useCallback((html) => {
        // R28: 读 ref 而非闭包 currentPage
        const page = currentPageRef.current;
        if (!page) return;
        // R23: 若是远端 setContent 回触发的 onUpdate, 不回写服务端 (避免来回抖动)
        if (applyingRemoteRef.current) return;
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

    // R23 修复: setContent 与 Yjs CRDT 冲突。原实现字符串比较 HTML 恒触发 setContent 抖动循环,
    // 协同模式下覆盖远端 update。改为: 仅在切换页面 (id 变化) 时初始化一次内容,
    // 用 applyingRemoteRef 标记防止 onUpdate 回写服务端; 协作开启时交由 Yjs sync, 不 setContent。
    useEffect(() => {
        if (!editor || !currentPage) return;
        // 协作模式由 Yjs provider 同步内容, setContent 会破坏 CRDT, 跳过
        if (collabEnabled) return;
        applyingRemoteRef.current = true;
        try {
            const current = editor.getHTML();
            // 仅当内容实质不同 (非空白归一后) 才 setContent, 避免格式差异恒触发
            const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
            if (norm(current) !== norm(currentPage.content || '')) {
                editor.commands.setContent(currentPage.content || '', false);
            }
        } finally {
            // 下个 tick 解除标记, 让后续用户输入正常回写
            setTimeout(() => { applyingRemoteRef.current = false; }, 0);
        }
    }, [currentPage?.id, currentPage?.content, collabEnabled, editor]);

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
