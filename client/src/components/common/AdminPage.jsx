// F8/O2/O3 修复: 管理后台页。原 SPA 无 admin 路由, 备份/恢复无 UI, 用户无法运维。
// admin 角色网关: 非 admin 显示拒绝。备份列表 + 触发备份 + 恢复 (调 POST /api/system/restore)。
import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../lib/api';
import { useT } from '../../stores/langStore';

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
    const t = useT();

    const loadBackups = async () => {
        try {
            const res = await api('GET', '/system/backups');
            setBackups(res?.backups || []);
        } catch (e) { setMsg(`${t('加载备份列表失败', 'Failed to load backups')}: ${e.message}`); }
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
            setMsg(t('备份完成', 'Backup complete'));
            loadBackups();
        } catch (e) { setMsg(`${t('备份失败', 'Backup failed')}: ${e.message}`); }
        finally { setBusy(''); }
    };

    const handleRestore = async (name) => {
        if (!window.confirm(t(`确认从 ${name} 恢复? 当前库将先存为回滚点。`, `Restore from ${name}? Current DB will be snapshotted first.`))) return;
        setBusy('restore');
        setMsg('');
        try {
            const res = await api('POST', '/system/restore', { name });
            setMsg(`${t('恢复完成', 'Restore complete')}: ${res?.restored || name}`);
            setRestoreName('');
        } catch (e) { setMsg(`${t('恢复失败', 'Restore failed')}: ${e.message}`); }
        finally { setBusy(''); }
    };

    if (user?.role !== 'admin') {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-400 p-8">
                {t('需要管理员权限访问此页面', 'Admin access required for this page')}
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto p-8">
            <div className="max-w-3xl mx-auto">
                <h1 className="text-3xl font-bold mb-6">{t('管理后台', 'Admin Console')}</h1>

                <div className="bg-surface-1 border border-surface-3 rounded-xl p-5 mb-4">
                    <h2 className="text-lg font-semibold mb-3">{t('数据备份', 'Data Backup')}</h2>
                    {schedule && (
                        <div className="text-xs text-gray-400 mb-3">
                            {t('自动备份', 'Auto backup')}: {schedule.enabled ? t(`每 ${schedule.intervalHours} 小时`, `every ${schedule.intervalHours}h`) : t('未启用', 'disabled')} ·
                            {t('上次', 'Last')}: {schedule.lastAutoBackupAt || t('从未', 'never')}
                        </div>
                    )}
                    <button
                        onClick={handleBackup}
                        disabled={busy === 'backup'}
                        className="px-4 py-2 bg-brand-600 hover:bg-brand-500 rounded-lg text-sm disabled:opacity-50 mb-4"
                    >
                        {busy === 'backup' ? t('备份中...', 'Backing up...') : t('立即备份', 'Back up now')}
                    </button>

                    <div className="text-sm text-gray-300 mb-2">{t('备份列表', 'Backup list')}</div>
                    {backups.length === 0 ? (
                        <div className="text-xs text-gray-500">{t('暂无备份', 'No backups yet')}</div>
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
                                        {t('恢复', 'Restore')}
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
