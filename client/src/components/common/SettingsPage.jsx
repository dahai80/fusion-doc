// F8 修复: SPA 仅 3 路由缺设置页。设置页: 账号信息 + 系统状态 + 外观偏好。
import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../lib/api';

export default function SettingsPage() {
    const { user } = useAuthStore();
    const [health, setHealth] = useState(null);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');

    useEffect(() => {
        api('GET', '/health').then(setHealth).catch(() => {});
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await api('POST', '/theme', { mode: 'dark' });
            setMsg('设置已保存');
        } catch (e) {
            setMsg(`保存失败: ${e.message}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex-1 overflow-auto p-8">
            <div className="max-w-2xl mx-auto">
                <h1 className="text-3xl font-bold mb-6">设置</h1>

                <div className="bg-surface-1 border border-surface-3 rounded-xl p-5 mb-4">
                    <h2 className="text-lg font-semibold mb-3">账号</h2>
                    <div className="space-y-1 text-sm text-gray-300">
                        <div>名称: {user?.name || '-'}</div>
                        <div>邮箱: {user?.email || '-'}</div>
                        <div>角色: <span className="text-brand-400">{user?.role || 'user'}</span></div>
                    </div>
                </div>

                {health && (
                    <div className="bg-surface-1 border border-surface-3 rounded-xl p-5 mb-4">
                        <h2 className="text-lg font-semibold mb-3">系统状态</h2>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>服务: <span className={health.status === 'ok' ? 'text-green-400' : 'text-yellow-400'}>{health.status}</span></div>
                            <div>版本: {health.version || '-'}</div>
                            <div>Fusion-MLX: <span className={health.checks?.mlx?.ok ? 'text-green-400' : 'text-yellow-400'}>{health.checks?.mlx?.ok ? '已连接' : '未连接'}</span></div>
                            <div>DB: <span className={health.checks?.db?.ok ? 'text-green-400' : 'text-red-400'}>{health.checks?.db?.mode || '-'}</span></div>
                        </div>
                    </div>
                )}

                <div className="bg-surface-1 border border-surface-3 rounded-xl p-5 mb-4">
                    <h2 className="text-lg font-semibold mb-3">外观</h2>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-2 bg-brand-600 hover:bg-brand-500 rounded-lg text-sm disabled:opacity-50"
                    >
                        {saving ? '保存中...' : '保存偏好'}
                    </button>
                    {msg && <div className="mt-2 text-xs text-gray-400">{msg}</div>}
                </div>
            </div>
        </div>
    );
}
