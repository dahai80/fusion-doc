// F8/O2/O3 修复: 管理后台页。原 SPA 无 admin 路由, 备份/恢复无 UI, 用户无法运维。
// admin 角色网关: 非 admin 显示拒绝。备份列表 + 触发备份 + 恢复 (调 POST /api/system/restore)。
import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../lib/api';

function fmtSize(n) {
    if (!n && n !== 0) return '-';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default function AdminPage() {
    const { user } = useAuthStore();
    const [backups, setBackups] = useState([]);
    const [schedule, setSchedule] = useState(null);
    const [busy, setBusy] = useState('');
    const [msg, setMsg] = useState('');
    const [restoreName, setRestoreName] = useState('');

    const loadBackups = async () => {
        try {
            const res = await api('GET', '/system/backups');
            setBackups(res?.backups || []);
        } catch (e) { setMsg(`加载备份列表失败: ${e.message}`); }
    };

    const loadSchedule = async () => {
        try {
            const res = await api('GET', '/system/backup-schedule');
            setSchedule(res);
        } catch { /* 静默 */ }
    };

    useEffect(() => { loadBackups(); loadSchedule(); }, []);

    const handleBackup = async () => {
        setBusy('backup');
        setMsg('');
        try {
            await api('POST', '/system/backup', {});
            setMsg('备份完成');
            loadBackups();
        } catch (e) { setMsg(`备份失败: ${e.message}`); }
        finally { setBusy(''); }
    };

    const handleRestore = async (name) => {
        if (!window.confirm(`确认从 ${name} 恢复? 当前库将先存为回滚点。`)) return;
        setBusy('restore');
        setMsg('');
        try {
            const res = await api('POST', '/system/restore', { name });
            setMsg(`恢复完成: ${res?.restored || name}`);
            setRestoreName('');
        } catch (e) { setMsg(`恢复失败: ${e.message}`); }
        finally { setBusy(''); }
    };

    if (user?.role !== 'admin') {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-400 p-8">
                需要管理员权限访问此页面
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto p-8">
            <div className="max-w-3xl mx-auto">
                <h1 className="text-3xl font-bold mb-6">管理后台</h1>

                <div className="bg-surface-1 border border-surface-3 rounded-xl p-5 mb-4">
                    <h2 className="text-lg font-semibold mb-3">数据备份</h2>
                    {schedule && (
                        <div className="text-xs text-gray-400 mb-3">
                            自动备份: {schedule.enabled ? `每 ${schedule.intervalHours} 小时` : '未启用'} ·
                            上次: {schedule.lastAutoBackupAt || '从未'}
                        </div>
                    )}
                    <button
                        onClick={handleBackup}
                        disabled={busy === 'backup'}
                        className="px-4 py-2 bg-brand-600 hover:bg-brand-500 rounded-lg text-sm disabled:opacity-50 mb-4"
                    >
                        {busy === 'backup' ? '备份中...' : '立即备份'}
                    </button>

                    <div className="text-sm text-gray-300 mb-2">备份列表</div>
                    {backups.length === 0 ? (
                        <div className="text-xs text-gray-500">暂无备份</div>
                    ) : (
                        <div className="space-y-2">
                            {backups.map((b) => (
                                <div key={b.name} className="flex items-center gap-3 bg-surface-2 rounded-lg px-3 py-2 text-xs">
                                    <span className="flex-1 truncate text-gray-200">{b.name}</span>
                                    <span className="text-gray-400">{fmtSize(b.size)}</span>
                                    <span className="text-gray-500">{b.createdAt?.slice(0, 19).replace('T', ' ')}</span>
                                    <button
                                        onClick={() => handleRestore(b.name)}
                                        disabled={busy === 'restore'}
                                        className="px-2 py-1 bg-yellow-600/80 hover:bg-yellow-500 rounded text-white disabled:opacity-50"
                                    >
                                        恢复
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {msg && <div className="text-sm text-gray-400">{msg}</div>}
            </div>
        </div>
    );
}
