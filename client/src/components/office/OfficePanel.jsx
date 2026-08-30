// =============================================================================
// Office 导入导出面板
// =============================================================================
import { useState, useEffect } from 'react';
import { api, apiUpload } from '../../lib/api';

export default function OfficePanel({ pageId, pageTitle }) {
    const [status, setStatus] = useState(null);
    const [importing, setImporting] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [format, setFormat] = useState('docx');

    useEffect(() => {
        api('GET', '/api/office/status').then(setStatus).catch(() => setStatus({ available: false }));
    }, []);

    const handleExport = async () => {
        if (!pageId) return;
        setExporting(true);
        try {
            const res = await fetch(`/api/office/export/${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ format }),
            });
            if (res.ok) {
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${pageTitle || 'export'}.${format}`;
                a.click();
                URL.revokeObjectURL(url);
            }
        } catch (e) {
            console.error('[Office] Export error:', e);
        } finally {
            setExporting(false);
        }
    };

    const handleImport = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImporting(true);
        try {
            // F7 修复: 原 /api/office/import 走 JSON parseBody, 客户端发 multipart 契约断裂。
            // 改用 /api/office/upload-import (服务端 multipart 端点) + apiUpload 助手。
            const result = await apiUpload('/office/upload-import', file);
            if (result.success || result.page_id) {
                window.location.href = `/page/${result.page_id}`;
            }
        } catch (e) {
            console.error('[Office] Import error:', e);
        } finally {
            setImporting(false);
        }
    };

    return (
        <div className="space-y-4 p-4">
            <h3 className="text-sm font-semibold text-gray-300">Office 文档</h3>
            {status && !status.available && (
                <div className="text-xs text-yellow-500 bg-yellow-500/10 rounded p-2">
                    OfficeCLI 不可用 — 导入导出功能需安装 @officecli/sdk
                </div>
            )}
            <div className="space-y-2">
                <label className="block text-xs text-gray-400">导出格式</label>
                <div className="flex gap-2">
                    {['docx', 'xlsx', 'pptx'].map(f => (
                        <button
                            key={f}
                            onClick={() => setFormat(f)}
                            className={`px-3 py-1 text-xs rounded ${format === f ? 'bg-brand-600 text-white' : 'bg-surface-2 text-gray-400'}`}
                        >
                            .{f}
                        </button>
                    ))}
                </div>
                <button
                    onClick={handleExport}
                    disabled={exporting || !pageId || !status?.available}
                    className="w-full py-2 text-xs bg-brand-600 hover:bg-brand-500 rounded-lg disabled:opacity-40"
                >
                    {exporting ? '导出中...' : `导出为 .${format}`}
                </button>
            </div>
            <div className="border-t border-surface-3 pt-3">
                <label className="block text-xs text-gray-400 mb-2">导入文档</label>
                <input
                    type="file"
                    accept=".docx,.xlsx,.pptx"
                    onChange={handleImport}
                    disabled={importing || !status?.available}
                    className="block w-full text-xs text-gray-400 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-surface-2 file:text-gray-300"
                />
            </div>
        </div>
    );
}
