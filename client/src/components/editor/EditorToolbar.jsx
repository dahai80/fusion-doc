import React from 'react';

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
            {btn('加粗 Cmd+B', <b>B</b>, () => editor.chain().focus().toggleBold().run(),
                editor.isActive('bold') ? 'bg-surface-2 text-white' : '')}
            {btn('斜体 Cmd+I', <i>I</i>, () => editor.chain().focus().toggleItalic().run(),
                editor.isActive('italic') ? 'bg-surface-2 text-white' : '')}
            {btn('下划线 Cmd+U', <u>U</u>, () => editor.chain().focus().toggleUnderline().run(),
                editor.isActive('underline') ? 'bg-surface-2 text-white' : '')}
            {btn('删除线', <s>S</s>, () => editor.chain().focus().toggleStrike().run(),
                editor.isActive('strike') ? 'bg-surface-2 text-white' : '')}
            <Divider />
            {btn('标题1', 'H1', () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
                editor.isActive('heading', { level: 1 }) ? 'bg-surface-2 text-white' : '')}
            {btn('标题2', 'H2', () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
                editor.isActive('heading', { level: 2 }) ? 'bg-surface-2 text-white' : '')}
            {btn('标题3', 'H3', () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
                editor.isActive('heading', { level: 3 }) ? 'bg-surface-2 text-white' : '')}
            <Divider />
            {btn('无序列表', '•', () => editor.chain().focus().toggleBulletList().run(),
                editor.isActive('bulletList') ? 'bg-surface-2 text-white' : '')}
            {btn('有序列表', '1.', () => editor.chain().focus().toggleOrderedList().run(),
                editor.isActive('orderedList') ? 'bg-surface-2 text-white' : '')}
            {btn('任务列表', '☑', () => editor.chain().focus().toggleTaskList().run(),
                editor.isActive('taskList') ? 'bg-surface-2 text-white' : '')}
            {btn('引用', '❝', () => editor.chain().focus().toggleBlockquote().run(),
                editor.isActive('blockquote') ? 'bg-surface-2 text-white' : '')}
            {btn('代码块', '</>', () => editor.chain().focus().toggleCodeBlock().run(),
                editor.isActive('codeBlock') ? 'bg-surface-2 text-white' : '')}
            <Divider />
            {btn('插入表格', '⊞', () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
            {btn('插入图片', '🖼', () => {
                const url = window.prompt('图片 URL:');
                if (url) editor.chain().focus().setImage({ src: url }).run();
            })}
            {btn('插入链接', '🔗', () => {
                const url = window.prompt('链接 URL:');
                if (url) editor.chain().focus().setLink({ href: url }).run();
            })}
            {btn('分割线', '—', () => editor.chain().focus().setHorizontalRule().run())}
            <Divider />
            {btn('撤销', '↩', () => editor.chain().focus().undo().run())}
            {btn('重做', '↪', () => editor.chain().focus().redo().run())}
        </div>
    );
}

function Divider() {
    return <div className="w-px h-5 bg-surface-3 mx-1" />;
}
