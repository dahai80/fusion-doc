import React from 'react';
import { t } from '../../stores/langStore';

export default function EditorToolbar({ editor }) {
    if (!editor) return null;

    const btn = (title, icon, command, className = '') => (
        <button
            title={title}
            onClick={() => command()}
            className={`px-2 py-1 text-sm rounded hover:bg-surface-2 text-gray-300 hover:text-white transition-colors ${className}`}
        >
            {icon}
        </button>
    );

    return (
        <div className="border-b border-surface-3 px-4 py-1.5 flex items-center gap-1 flex-wrap bg-surface-1/50">
            {btn(t('加粗', 'Bold') + ' Cmd+B', <b>B</b>, () => editor.chain().focus().toggleBold().run(), // i18n: user-facing
                editor.isActive('bold') ? 'bg-surface-2 text-white' : '')}
            {btn(t('斜体', 'Italic') + ' Cmd+I', <i>I</i>, () => editor.chain().focus().toggleItalic().run(), // i18n: user-facing
                editor.isActive('italic') ? 'bg-surface-2 text-white' : '')}
            {btn(t('下划线', 'Underline') + ' Cmd+U', <u>U</u>, () => editor.chain().focus().toggleUnderline().run(), // i18n: user-facing
                editor.isActive('underline') ? 'bg-surface-2 text-white' : '')}
            {btn(t('删除线', 'Strikethrough'), <s>S</s>, () => editor.chain().focus().toggleStrike().run(), // i18n: user-facing
                editor.isActive('strike') ? 'bg-surface-2 text-white' : '')}
            <Divider />
            {btn(t('标题1', 'Heading 1'), 'H1', () => editor.chain().focus().toggleHeading({ level: 1 }).run(), // i18n: user-facing
                editor.isActive('heading', { level: 1 }) ? 'bg-surface-2 text-white' : '')}
            {btn(t('标题2', 'Heading 2'), 'H2', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), // i18n: user-facing
                editor.isActive('heading', { level: 2 }) ? 'bg-surface-2 text-white' : '')}
            {btn(t('标题3', 'Heading 3'), 'H3', () => editor.chain().focus().toggleHeading({ level: 3 }).run(), // i18n: user-facing
                editor.isActive('heading', { level: 3 }) ? 'bg-surface-2 text-white' : '')}
            <Divider />
            {btn(t('无序列表', 'Bullet list'), '•', () => editor.chain().focus().toggleBulletList().run(), // i18n: user-facing
                editor.isActive('bulletList') ? 'bg-surface-2 text-white' : '')}
            {btn(t('有序列表', 'Ordered list'), '1.', () => editor.chain().focus().toggleOrderedList().run(), // i18n: user-facing
                editor.isActive('orderedList') ? 'bg-surface-2 text-white' : '')}
            {btn(t('任务列表', 'Task list'), '☑', () => editor.chain().focus().toggleTaskList().run(), // i18n: user-facing
                editor.isActive('taskList') ? 'bg-surface-2 text-white' : '')}
            {btn(t('引用', 'Quote'), '❝', () => editor.chain().focus().toggleBlockquote().run(), // i18n: user-facing
                editor.isActive('blockquote') ? 'bg-surface-2 text-white' : '')}
            {btn(t('代码块', 'Code block'), '</>', () => editor.chain().focus().toggleCodeBlock().run(), // i18n: user-facing
                editor.isActive('codeBlock') ? 'bg-surface-2 text-white' : '')}
            <Divider />
            {/* i18n: user-facing */}
            {btn(t('插入表格', 'Insert table'), '⊞', () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
            {btn(t('插入图片', 'Insert image'), '🖼', () => { // i18n: user-facing
                const url = window.prompt(t('图片 URL:', 'Image URL:')); // i18n: user-facing
                if (url) editor.chain().focus().setImage({ src: url }).run();
            })}
            {btn(t('插入链接', 'Insert link'), '🔗', () => { // i18n: user-facing
                const url = window.prompt(t('链接 URL:', 'Link URL:')); // i18n: user-facing
                if (url) editor.chain().focus().setLink({ href: url }).run();
            })}
            {/* i18n: user-facing */}
            {btn(t('分割线', 'Divider'), '—', () => editor.chain().focus().setHorizontalRule().run())}
            <Divider />
            {/* i18n: user-facing */}
            {btn(t('撤销', 'Undo'), '↩', () => editor.chain().focus().undo().run())}
            {/* i18n: user-facing */}
            {btn(t('重做', 'Redo'), '↪', () => editor.chain().focus().redo().run())}
        </div>
    );
}

function Divider() {
    return <div className="w-px h-5 bg-surface-3 mx-1" />;
}
