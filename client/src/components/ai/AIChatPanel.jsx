import React, { useState, useRef, useEffect } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { usePageStore } from '../../stores/pageStore';
import { apiStream } from '../../lib/api';

export default function AIChatPanel() {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [streaming, setStreaming] = useState(false);
    const messagesEndRef = useRef(null);
    const aiPanelMode = useUIStore((s) => s.aiPanelMode);
    const setAIPanelMode = useUIStore((s) => s.setAIPanelMode);
    const toggleAIPanel = useUIStore((s) => s.toggleAIPanel);
    const currentPage = usePageStore((s) => s.currentPage);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || streaming) return;
        const userMsg = { role: 'user', content: input.trim() };
        setMessages((prev) => [...prev, userMsg]);
        setInput('');
        setStreaming(true);

        const assistantMsg = { role: 'assistant', content: '' };
        setMessages((prev) => [...prev, assistantMsg]);

        try {
            const chatMessages = [...messages, userMsg].map((m) => ({
                role: m.role,
                content: m.content,
            }));
            // F5 修复: RAG 模式不再装饰 — 实发 /ai/rag/query 走知识库检索增强回答。
            // /rag/query 非流式返回 { answer, sources }; chat 模式仍走 /ai/chat 流式。
            const rawInput = userMsg.content;
            const ragQuestion = aiPanelMode === 'rag'
                ? rawInput.replace(/^\?\s*/, '')
                : rawInput;
            if (aiPanelMode === 'rag' && ragQuestion) {
                const { api } = await import('../../lib/api');
                const data = await api('POST', '/ai/rag/query', { question: ragQuestion, top_k: 5 });
                const answer = data.answer || '(知识库无相关结果)';
                const sources = Array.isArray(data.sources) && data.sources.length
                    ? `\n\n---\n📚 来源:\n${data.sources.slice(0, 3).map((s, i) => `${i + 1}. ${String(s).slice(0, 80)}`).join('\n')}`
                    : '';
                setMessages((prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = { ...updated[updated.length - 1], content: answer + sources };
                    return updated;
                });
                setStreaming(false);
            } else {
                await apiStream(
                    '/ai/chat',
                    { messages: chatMessages, stream: true },
                    (chunk) => {
                        const text = chunk.choices?.[0]?.delta?.content || chunk.text || '';
                        if (text) {
                            setMessages((prev) => {
                                const updated = [...prev];
                                updated[updated.length - 1] = {
                                    ...updated[updated.length - 1],
                                    content: updated[updated.length - 1].content + text,
                                };
                                return updated;
                            });
                        }
                    },
                    () => setStreaming(false)
                );
            }
        } catch (e) {
            setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                    role: 'assistant',
                    content: `错误: ${e.message}`,
                };
                return updated;
            });
            setStreaming(false);
        }
    };

    return (
        <aside className="w-80 bg-surface-1 border-l border-surface-3 flex flex-col">
            <div className="p-3 border-b border-surface-3 flex items-center justify-between">
                <div className="flex gap-1">
                    <button
                        onClick={() => setAIPanelMode('chat')}
                        className={`px-2 py-1 text-xs rounded ${aiPanelMode === 'chat' ? 'bg-brand-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                        💬 对话
                    </button>
                    <button
                        onClick={() => setAIPanelMode('rag')}
                        className={`px-2 py-1 text-xs rounded ${aiPanelMode === 'rag' ? 'bg-brand-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                        🔍 RAG
                    </button>
                </div>
                <button onClick={toggleAIPanel} className="text-gray-400 hover:text-gray-200">
                    ✕
                </button>
            </div>

            <div className="flex-1 overflow-auto p-3 space-y-3">
                {messages.length === 0 && (
                    <div className="text-center text-gray-500 mt-8">
                        <div className="text-2xl mb-2">🤖</div>
                        <div className="text-sm">AI Copilot</div>
                        <div className="text-xs mt-1">
                            {aiPanelMode === 'rag' ? '输入 ? 开头进行知识库问答' : '在编辑器中按 Cmd+J 续写'}
                        </div>
                    </div>
                )}
                {messages.map((msg, i) => (
                    <div key={i} className={`text-sm ${msg.role === 'user' ? 'text-right' : ''}`}>
                        <div
                            className={`inline-block max-w-[85%] rounded-lg px-3 py-2 ${
                                msg.role === 'user'
                                    ? 'bg-brand-600 text-white'
                                    : 'bg-surface-2 text-gray-200'
                            }`}
                        >
                            <pre className="whitespace-pre-wrap font-sans text-sm">{msg.content}</pre>
                        </div>
                    </div>
                ))}
                {streaming && (
                    <div className="text-xs text-gray-500">AI 正在生成...</div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="p-3 border-t border-surface-3">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                        placeholder={aiPanelMode === 'rag' ? '? 知识库问答...' : '输入消息...'}
                        className="flex-1 bg-surface-0 border border-surface-3 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-brand-500"
                        disabled={streaming}
                    />
                    <button
                        onClick={handleSend}
                        disabled={streaming || !input.trim()}
                        className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 px-3 py-2 rounded-lg text-sm"
                    >
                        发送
                    </button>
                </div>
            </div>
        </aside>
    );
}
