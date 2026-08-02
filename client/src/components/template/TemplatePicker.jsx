import { useState, useEffect } from 'react';
import { api } from '../../lib/api';

export default function TemplatePicker({ onSelect, onClose }) {
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [category, setCategory] = useState('all');

    useEffect(() => {
        api('GET', '/api/templates').then(list => {
            setTemplates(list);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, []);

    const categories = ['all', ...new Set(templates.map(t => t.category))];
    const filtered = category === 'all' ? templates : templates.filter(t => t.category === category);

    const handleSelect = async (tpl) => {
        const title = window.prompt('文档标题:', tpl.name);
        if (!title) return;
        try {
            const result = await api('POST', `/api/templates/${tpl.id}/instantiate`, { title });
            if (result.page_id) onSelect(result.page_id);
        } catch (e) {
            console.error('[Template] Instantiate error:', e);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-surface-1 rounded-xl shadow-2xl w-[640px] max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="px-6 py-4 border-b border-surface-3 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-200">选择模板</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-200">✕</button>
                </div>
                <div className="px-6 py-3 flex gap-2 border-b border-surface-3">
                    {categories.map(c => (
                        <button key={c} onClick={() => setCategory(c)}
                            className={`px-3 py-1 text-xs rounded-full ${category === c ? 'bg-brand-600 text-white' : 'bg-surface-2 text-gray-400'}`}>
                            {c === 'all' ? '全部' : c}
                        </button>
                    ))}
                </div>
                <div className="p-6 grid grid-cols-2 gap-3 overflow-y-auto max-h-[60vh]">
                    {loading ? (
                        <div className="col-span-2 text-center text-gray-500 py-8">加载中...</div>
                    ) : filtered.length === 0 ? (
                        <div className="col-span-2 text-center text-gray-500 py-8">暂无模板</div>
                    ) : filtered.map(tpl => (
                        <button key={tpl.id} onClick={() => handleSelect(tpl)}
                            className="text-left p-4 bg-surface-2 hover:bg-surface-3 rounded-lg border border-surface-3 transition-colors">
                            <div className="font-medium text-gray-200 text-sm">{tpl.name}</div>
                            <div className="text-xs text-gray-500 mt-1">{tpl.description || tpl.category}</div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
