import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ManagePage from './components/common/ManagePage';
import { useUIStore } from './stores/uiStore';
import { useAuthStore } from './stores/authStore';
import { isEmbedded } from './lib/embedded';
import { t } from './stores/langStore';
import AppLayout from './components/common/AppLayout';
import EditorPage from './components/editor/EditorPage';
import GraphPage from './components/graph/GraphPage';
import HomePage from './components/common/HomePage';
import AuthPage from './components/common/AuthPage';
// F8 fix: the SPA had only 3 routes and no settings/admin pages; wire them in.
import SettingsPage from './components/common/SettingsPage';
import AdminPage from './components/common/AdminPage';

export default function App() {
    const { token, user } = useAuthStore();
    const bootstrap = useAuthStore((s) => s.bootstrap);
    const logout = useAuthStore((s) => s.logout);
    const [booted, setBooted] = useState(false);
    const [needsSetup, setNeedsSetup] = useState(false);

    // P0-F1: bootstrap at startup probes install state + validates any existing token
    useEffect(() => {
        let active = true;
        bootstrap().then((r) => {
            if (!active) return;
            setNeedsSetup(!!r?.needsSetup);
            setBooted(true);
        });
        // api.js dispatches fusion-doc-logout on 401; clear the store in sync
        const onLogout = () => logout();
        window.addEventListener('fusion-doc-logout', onLogout);
        return () => { active = false; window.removeEventListener('fusion-doc-logout', onLogout); };
    }, []);

    if (!booted) {
        return <div className="h-screen flex items-center justify-center bg-surface-0 text-surface-fg">{t('加载中…', 'Loading…')}</div>; // i18n: user-facing
    }

    // P0-F1: not installed → install page; installed but not logged in → login page
    // issue #51: shell-embedded mode skips the local login/install gates (host manages the session, gateway injects the service credential)
    if (!isEmbedded && needsSetup) return <AuthPage mode="setup" />;
    if (!isEmbedded && (!token || !user)) return <AuthPage mode="login" />;

    return (
        <Routes>
            <Route path="/" element={<AppLayout />}>
                <Route index element={<HomePage />} />
                <Route path="page/:id" element={<EditorPage />} />
                <Route path="graph" element={<GraphPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="admin" element={<AdminPage />} />
<Route path="manage" element={<ManagePage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
        </Routes>
    );
}
