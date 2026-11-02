// =============================================================================
// Fusion-Doc — AI Copilot 服务层
// 上下文构建 + 系统提示词模板
// issue #69 (long-context audit): 选区上限 + 边界感知截断 + 长文档摘要/目录上下文
// 字符→token 预算: CJK 字符 ≈ 1 token/字, 拉丁文 ≈ 0.25 token/字符。
//   选区上限 8000 字符 ≈ CJK 8k token (P1: 50k 全选不再直达 LLM)
//   文档上下文 2000 字符 ≈ CJK 2k token; 长文档改用 摘要(≤400字)+目录+开头800字符
// =============================================================================

// ── 预算常量 (issue #69) ────────────────────────────────────────────────────
const MAX_SELECTION_CHARS = 8000;   // 选区上限: 超出服务端直接 413 拒绝
const DOC_BUDGET_CHARS = 2000;      // 短文档上下文预算 (原文截断)
const HEAD_BUDGET_CHARS = 800;      // 长文档走摘要时附带的原文开头片段预算

// ── HTML 剥离 + 常见实体解码 (context 里 &amp; 应显示为 &) ──────────────────
function stripHtml(s) {
    return (s || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

// ── 边界感知截断 (issue #69 P2) ─────────────────────────────────────────────
// 优先级: 段落(\n\n) > 换行 > 句末(。！？!? ; ;) > 逗号(，,、) > 空格 > 硬切。
// 在预算窗内取最靠后的命中边界 (且不早于窗长一半), 尽量不切半个句子/词。
// CJK 无空格 → 依赖句末标点兜底; 拉丁文依赖句末+空格兜底。
function truncateAtBoundary(text, max) {
    if (!text) return '';
    if (text.length <= max) return text;
    const window = text.slice(0, max);
    const patterns = [/\n\s*\n/g, /\n/g, /[。！？!?；;…]+/g, /[，,、]/g, /[ \t]/g];
    for (const pat of patterns) {
        let idx = -1;
        let m;
        pat.lastIndex = 0;
        while ((m = pat.exec(window)) !== null) idx = m.index + m[0].length;
        if (idx >= Math.floor(max * 0.5)) return window.slice(0, idx).trimEnd();
    }
    return window.trimEnd();
}

// ── 目录提取 (issue #69 P3): h1-h3 标题 → 缩进列表, 最多 maxEntries 条 ──────
function extractToc(content, maxEntries = 20) {
    const out = [];
    const re = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
    let m;
    while ((m = re.exec(content || '')) !== null && out.length < maxEntries) {
        const text = stripHtml(m[2]).trim().replace(/\s+/g, ' ').slice(0, 80);
        if (text) out.push(`${'  '.repeat(Number(m[1]) - 1)}- ${text}`);
    }
    return out.length ? `目录:\n${out.join('\n')}` : '';
}

// ── 上下文构建 ──────────────────────────────────────────────────────────────
// 长文档 (plain > DOC_BUDGET_CHARS 且已有摘要): 摘要 + 目录 + 开头片段 代替 盲目前2000字符
async function buildContext(db, pageId, textBefore, selectedText, textAfter) {
    let docContext = '';
    if (db && pageId) {
        try {
            const page = db.prepare('SELECT title, content, summary FROM pages WHERE id = ?').get(pageId);
            if (page) {
                const plain = stripHtml(page.content);
                if (plain.length > DOC_BUDGET_CHARS && page.summary) {
                    const toc = extractToc(page.content);
                    docContext = `当前文档「${page.title}」(长文档, 以下为摘要+目录+开头片段):\n${String(page.summary).slice(0, 500)}\n\n${toc}\n\n开头片段:\n${truncateAtBoundary(plain, HEAD_BUDGET_CHARS)}\n\n`;
                } else {
                    docContext = `当前文档「${page.title}」:\n${truncateAtBoundary(plain, DOC_BUDGET_CHARS)}\n\n`;
                }
            }
        } catch (e) {
            console.warn('[AI Copilot] buildContext DB error:', e.message);
        }
    }

    let parts = [];
    if (docContext) parts.push(docContext);
    if (textBefore) parts.push(`光标前文:\n${truncateAtBoundary(textBefore.slice(-1500), 1500)}`);
    if (selectedText) parts.push(`选中内容:\n${selectedText.slice(0, MAX_SELECTION_CHARS)}`);
    if (textAfter) parts.push(`光标后文:\n${truncateAtBoundary(textAfter.slice(0, 500), 500)}`);
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

module.exports = { buildContext, buildSystemPrompt, truncateAtBoundary, extractToc, stripHtml, MAX_SELECTION_CHARS, DOC_BUDGET_CHARS, HEAD_BUDGET_CHARS };
