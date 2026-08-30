// P0-F1 修复: 登录/安装页。未认证或系统未安装时由 App 网关渲染。
// mode='login' | 'setup'。setup 首次安装管理员, 之后走 login。
import React, { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';

export default function AuthPage({ mode = 'login' }) {
    const { login, setup, error, loading } = useAuthStore();
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const isSetup = mode === 'setup';

    const submit = async (e) => {
        e.preventDefault();
        try {
            if (isSetup) await setup(email, name, password);
            else await login(email, password);
        } catch (_) { /* error 已入 store */ }
    };

    return (
        <div className="h-screen flex items-center justify-center bg-surface-0">
            <form onSubmit={submit} className="w-full max-w-sm bg-surface-1 rounded-xl shadow-lg p-8 space-y-4">
                <h1 className="text-xl font-semibold text-surface-fg">
                    {isSetup ? '初始化 Fusion-Doc 管理员' : '登录 Fusion-Doc'}
                </h1>
                {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 rounded p-2">{error}</div>}
                <input
                    type="email"
                    placeholder="邮箱"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded border border-surface-2 bg-surface-0 text-surface-fg outline-none focus:border-primary"
                />
                {isSetup && (
                    <input
                        type="text"
                        placeholder="显示名称"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full px-3 py-2 rounded border border-surface-2 bg-surface-0 text-surface-fg outline-none focus:border-primary"
                    />
                )}
                <input
                    type="password"
                    placeholder={isSetup ? '密码 (至少 8 位)' : '密码'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded border border-surface-2 bg-surface-0 text-surface-fg outline-none focus:border-primary"
                />
                <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2 rounded bg-primary text-white font-medium disabled:opacity-50"
                >
                    {loading ? '处理中…' : (isSetup ? '完成安装' : '登录')}
                </button>
            </form>
        </div>
    );
}
