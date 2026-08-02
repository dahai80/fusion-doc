import React, { useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { useUIStore } from '../../stores/uiStore';
import Sidebar from '../sidebar/Sidebar';
import AIChatPanel from '../ai/AIChatPanel';
import StatusBar from './StatusBar';
import SearchModal from './SearchModal';

export default function AppLayout() {
    const sidebarOpen = useUIStore((s) => s.sidebarOpen);
    const aiPanelOpen = useUIStore((s) => s.aiPanelOpen);
    const [searchOpen, setSearchOpen] = useState(false);

    const closeSearch = useCallback(() => setSearchOpen(false), []);
    const openSearch = useCallback(() => setSearchOpen(true), []);
    closeSearch.__open = openSearch;

    return (
        <div className="h-screen flex flex-col bg-surface-0">
            <div className="flex flex-1 overflow-hidden">
                {sidebarOpen && <Sidebar />}
                <main className="flex-1 flex flex-col overflow-hidden">
                    <Outlet />
                </main>
                {aiPanelOpen && <AIChatPanel />}
            </div>
            <StatusBar />
            <SearchModal open={searchOpen} onClose={closeSearch} />
        </div>
    );
}
