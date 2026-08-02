import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useUIStore } from './stores/uiStore';
import AppLayout from './components/common/AppLayout';
import EditorPage from './components/editor/EditorPage';
import GraphPage from './components/graph/GraphPage';
import HomePage from './components/common/HomePage';

export default function App() {
    return (
        <Routes>
            <Route path="/" element={<AppLayout />}>
                <Route index element={<HomePage />} />
                <Route path="page/:id" element={<EditorPage />} />
                <Route path="graph" element={<GraphPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
        </Routes>
    );
}
