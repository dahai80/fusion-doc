// F8 修复: SPA 仅 3 路由缺设置页。设置页: 账号信息 + 系统状态 + 外观/语言偏好。
// issue #58: 主题/语言双向 — 独立模式本地切换; 内嵌模式跟随 shell 宿主 (shell-bridge 同步)
import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { useLangStore, useT } from '../../stores/langStore';
import { api } from '../../lib/api';

export default function SettingsPage() {
    const { user } = useAuthStore();
    const [health, setHealth] = useState(null);
    const theme = useUIStore((s) => s.theme);
    const setTheme = useUIStore((s) => s.setTheme);
    const lang = useLangStore((s) => s.lang);
    const setLang = useLangStore((s) => s.setLang);
    const t = useT();

    useEffect(() => {
        api('GET', '/health').then(setHealth).catch(() => {});
    }, []);

    return (
        <div className="flex-1 overflow-auto p-8">
            <div className="max-w-2xl mx-auto">
                <h1 className="text-3xl font-bold mb-6">{t('设置', 'Settings')}</h1>

                <div className="bg-surface-1 border border-surface-3 rounded-xl p-5 mb-4">
                    <h2 className="text-lg font-semibold mb-3">{t('账号', 'Account')}</h2>
                    <div className="space-y-1 text-sm text-gray-300">
                        <div>{t('名称', 'Name')}: {user?.name || '-'}</div>
                        <div>{t('邮箱', 'Email')}: {user?.email || '-'}</div>
                        <div>{t('角色', 'Role')}: <span className="text-brand-400">{user?.role || 'user'}</span></div>
                    </div>
                </div>

                {health && (
                    <div className="bg-surface-1 border border-surface-3 rounded-xl p-5 mb-4">
                        <h2 className="text-lg font-semibold mb-3">{t('系统状态', 'System Status')}</h2>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>{t('服务', 'Service')}: <span className={health.status === 'ok' ? 'text-green-400' : 'text-yellow-400'}>{health.status}</span></div>
                            <div>{t('版本', 'Version')}: {health.version || '-'}</div>
                            <div>Fusion-MLX: <span className={health.checks?.mlx?.ok ? 'text-green-400' : 'text-yellow-400'}>{health.checks?.mlx?.ok ? t('已连接', 'connected') : t('未连接', 'disconnected')}</span></div>
                            <div>DB: <span className={health.checks?.db?.ok ? 'text-green-400' : 'text-red-400'}>{health.checks?.db?.mode || '-'}</span></div>
                        </div>
                    </div>
                )}

                <div className="bg-surface-1 border border-surface-3 rounded-xl p-5 mb-4">
                    <h2 className="text-lg font-semibold mb-3">{t('外观', 'Appearance')}</h2>
                    <div className="space-y-4 text-sm">
                        <div className="flex items-center gap-3">
                            <span className="text-gray-400 w-16">{t('主题', 'Theme')}</span>
                            {['dark', 'light'].map((mode) => (
                                <button
                                    key={mode}
                                    onClick={() => setTheme(mode)}
                                    className={`px-3 py-1.5 rounded-lg border transition-colors ${
                                        theme === mode
                                            ? 'bg-brand-600 border-brand-600 text-white'
                                            : 'bg-surface-0 border-surface-3 text-gray-400 hover:text-gray-200'
                                    }`}
                                >
                                    {mode === 'dark' ? t('暗色', 'Dark') : t('亮色', 'Light')}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-gray-400 w-16">{t('语言', 'Language')}</span>
                            {['zh', 'en'].map((l) => (
                                <button
                                    key={l}
                                    onClick={() => setLang(l)}
                                    className={`px-3 py-1.5 rounded-lg border transition-colors ${
                                        lang === l
                                            ? 'bg-brand-600 border-brand-600 text-white'
                                            : 'bg-surface-0 border-surface-3 text-gray-400 hover:text-gray-200'
                                    }`}
                                >
                                    {l === 'zh' ? '中文' : 'English'}
                                </button>
                            ))}
                        </div>
                        <div className="text-xs text-gray-500">
                            {t('内嵌于 Fusion Shell 时以上设置自动跟随宿主。', 'When embedded in Fusion Shell, these follow the host automatically.')}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
