import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useUIStore } from './stores/uiStore';
import { useAuthStore } from './stores/authStore';
import AppLayout from './components/common/AppLayout';
import EditorPage from './components/editor/EditorPage';
import GraphPage from './components/graph/GraphPage';
import HomePage from './components/common/HomePage';
import AuthPage from './components/common/AuthPage';
// F8 修复: SPA 仅 3 路由缺设置/管理页, 接入。
import SettingsPage from './components/common/SettingsPage';
import AdminPage from './components/common/AdminPage';

export default function App() {
    const { token, user } = useAuthStore();
    const bootstrap = useAuthStore((s) => s.bootstrap);
    const logout = useAuthStore((s) => s.logout);
    const [booted, setBooted] = useState(false);
    const [needsSetup, setNeedsSetup] = useState(false);

    // P0-F1: 启动 bootstrap 探测安装状态 + 校验已有 token
    useEffect(() => {
        let active = true;
        bootstrap().then((r) => {
            if (!active) return;
            setNeedsSetup(!!r?.needsSetup);
            setBooted(true);
        });
        // api.js 401 时派发 fusion-doc-logout, 同步清 store
        const onLogout = () => logout();
        window.addEventListener('fusion-doc-logout', onLogout);
        return () => { active = false; window.removeEventListener('fusion-doc-logout', onLogout); };
    }, []);

    if (!booted) {
        return <div className="h-screen flex items-center justify-center bg-surface-0 text-surface-fg">加载中…</div>;
    }

    // P0-F1: 未安装 → 安装页; 已安装但未登录 → 登录页
    if (needsSetup) return <AuthPage mode="setup" />;
    if (!token || !user) return <AuthPage mode="login" />;

    return (
        <Routes>
            <Route path="/" element={<AppLayout />}>
                <Route index element={<HomePage />} />
                <Route path="page/:id" element={<EditorPage />} />
                <Route path="graph" element={<GraphPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="admin" element={<AdminPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
        </Routes>
    );
}
