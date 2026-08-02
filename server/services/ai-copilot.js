// =============================================================================
// Fusion-Doc — AI Copilot 服务层
// 上下文构建 + 系统提示词模板
// =============================================================================

// ── 上下文构建 ──────────────────────────────────────────────────────────────
async function buildContext(db, pageId, textBefore, selectedText, textAfter) {
    let docContext = '';
    if (db && pageId) {
        try {
            const page = db.prepare('SELECT title, content FROM pages WHERE id = ?').get(pageId);
            if (page) {
                const plain = (page.content || '').replace(/<[^>]+>/g, '').slice(0, 2000);
                docContext = `当前文档「${page.title}」:\n${plain}\n\n`;
            }
        } catch (e) {
            console.warn('[AI Copilot] buildContext DB error:', e.message);
        }
    }

    let parts = [];
    if (docContext) parts.push(docContext);
    if (textBefore) parts.push(`光标前文:\n${textBefore.slice(-1500)}`);
    if (selectedText) parts.push(`选中内容:\n${selectedText}`);
    if (textAfter) parts.push(`光标后文:\n${textAfter.slice(0, 500)}`);
    return parts.join('\n\n');
}

// ── 系统提示词 ──────────────────────────────────────────────────────────────
function buildSystemPrompt(action, extra) {
    const prompts = {
        complete: `你是文档续写助手。根据上下文续写内容，保持语气风格一致。
只输出续写内容，不要解释、不要重复已有内容，直接输出文本。`,

        rewrite: `你是文档改写助手。根据指令改写选中内容，保持语义不变。
只输出改写后的文本，不要解释。${extra ? `\n改写要求: ${extra}` : ''}`,

        translate: `你是翻译助手。将选中内容翻译为${extra || '英文'}。
只输出翻译结果，不要解释，不要添加额外内容。`,

        summarize: `你是摘要助手。对选中内容生成精炼摘要。
用中文输出，不超过200字，保留关键信息。`,

        expand: `你是内容扩展助手。对选中内容进行展开和详细阐述。
保持原有风格，只输出扩展内容，不要解释。`,
    };

    if (prompts[action]) return prompts[action];

    return `你是AI文档助手。用户指令: ${action}${extra ? ` — ${extra}` : ''}
根据指令和上下文完成任务。只输出结果，不要解释。`;
}

module.exports = { buildContext, buildSystemPrompt };
