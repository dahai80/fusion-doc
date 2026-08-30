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
// F6 修复: WorkflowBadge / OfficePanel 已实现但从未挂载, 是死代码。
// 接入编辑器: 头部挂工作流状态徽章 + 可折叠 Office 面板抽屉。
import WorkflowBadge from '../workflow/WorkflowBadge';
import OfficePanel from '../office/OfficePanel';
// P0-F3 修复: 实时协作 (Yjs) 协议层未实现 (客户端 y-websocket 二进制 vs 服务端 JSON 中继),
// 原 UI "协作" 按钮切换 collabEnabled 但从不接线 provider, 是死代码 + 功能谎言。
// 移除误导 UI 与未接线导入, 协作列为未发布特性 (见审计报告 A1/A2 已知限制)。

export default function EditorPage() {
    const { id } = useParams();
    const { currentPage, fetchPage, updatePage } = usePageStore();
    const toggleAIPanel = useUIStore((s) => s.toggleAIPanel);
    // F6: Office 面板抽屉开关 (默认收起)
    const [officeOpen, setOfficeOpen] = useState(false);
    const saveTimerRef = useRef(null);
    const lastContentRef = useRef('');
    // R28 修复: useEditor 的 onUpdate/handleKeyDown 闭包在 editor 创建时冻结,
    // currentPage 变化后旧闭包仍指向旧 page, 保存写入旧 page。
    // 用 ref 始终读最新 currentPage, 闭包只读 ref 不捕获 page。
    const currentPageRef = useRef(currentPage);
    useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);

    useEffect(() => {
        if (id) fetchPage(id);
    }, [id]);

    const handleContentChange = useCallback((html) => {
        // R28: 读 ref 而非闭包 currentPage
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

    // R23 修复: 仅在切换页面 (id 变化) 时初始化一次内容, 避免 setContent 与输入抖动循环。
    // P0-F3: 协作模式已移除 (未实现), 不再有 CRDT 冲突; 仅按 id 变化 setContent。
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
                <span>字符: {editor?.storage.characterCount?.characters() ?? 0}</span>
                <span>词数: {editor?.storage.characterCount?.words() ?? 0}</span>
                <span className="ml-auto">Cmd+J AI续写 | / 命令 | [[ 双向链接 | Tab 接受</span>
            </div>
        </div>
    );
}
