// =============================================================================
// Fusion-Doc — AI Copilot service layer
// Context building + system prompt templates
// issue #69 (long-context audit): selection cap + boundary-aware truncation + summary/TOC context for long docs
// Char→token budget: CJK ≈ 1 token/char, Latin ≈ 0.25 token/char.
//   Selection cap 8000 chars ≈ 8k CJK tokens (P1: a 50k select-all no longer reaches the LLM directly)
//   Doc context 2000 chars ≈ 2k CJK tokens; long docs use summary (≤400 chars) + TOC + first 800 chars instead
// =============================================================================

// ── Budget constants (issue #69) ────────────────────────────────────────────────────
const MAX_SELECTION_CHARS = 8000;   // Selection cap: server rejects anything larger with 413
const DOC_BUDGET_CHARS = 2000;      // Short-doc context budget (raw text truncated)
const HEAD_BUDGET_CHARS = 800;      // Budget for the leading raw-text excerpt attached when a long doc uses its summary

// ── HTML stripping + common entity decoding (&amp; in context should read as &) ──────────────────
function stripHtml(s) {
    return (s || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

// ── Boundary-aware truncation (issue #69 P2) ─────────────────────────────────────────────
// Priority: paragraph (\n\n) > newline > sentence end (CJK/ASCII terminators) > comma (CJK/ASCII commas) > space > hard cut.
// Take the last matching boundary within the budget window (no earlier than half the window), avoiding cutting sentences/words in half.
// CJK has no spaces → falls back on sentence-ending punctuation; Latin text falls back on sentence ends + spaces.
function truncateAtBoundary(text, max) {
    if (!text) return '';
    if (text.length <= max) return text;
    const window = text.slice(0, max);
    const patterns = [/\n\s*\n/g, /\n/g, /[。！？!?；;…]+/g, /[，,、]/g, /[ \t]/g]; // i18n: user-facing
    for (const pat of patterns) {
        let idx = -1;
        let m;
        pat.lastIndex = 0;
        while ((m = pat.exec(window)) !== null) idx = m.index + m[0].length;
        if (idx >= Math.floor(max * 0.5)) return window.slice(0, idx).trimEnd();
    }
    return window.trimEnd();
}

// ── TOC extraction (issue #69 P3): h1-h3 headings → indented list, at most maxEntries entries ──────
function extractToc(content, maxEntries = 20) {
    const out = [];
    const re = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
    let m;
    while ((m = re.exec(content || '')) !== null && out.length < maxEntries) {
        const text = stripHtml(m[2]).trim().replace(/\s+/g, ' ').slice(0, 80);
        if (text) out.push(`${'  '.repeat(Number(m[1]) - 1)}- ${text}`);
    }
    return out.length ? `目录:\n${out.join('\n')}` : ''; // i18n: user-facing
}

// ── Context building ──────────────────────────────────────────────────────────────
// Long docs (plain > DOC_BUDGET_CHARS with an existing summary): summary + TOC + leading excerpt instead of blindly taking the first 2000 chars
async function buildContext(db, pageId, textBefore, selectedText, textAfter) {
    let docContext = '';
    if (db && pageId) {
        try {
            const page = db.prepare('SELECT title, content, summary FROM pages WHERE id = ?').get(pageId);
            if (page) {
                const plain = stripHtml(page.content);
                if (plain.length > DOC_BUDGET_CHARS && page.summary) {
                    const toc = extractToc(page.content);
                    docContext = `当前文档「${page.title}」(长文档, 以下为摘要+目录+开头片段):\n${String(page.summary).slice(0, 500)}\n\n${toc}\n\n开头片段:\n${truncateAtBoundary(plain, HEAD_BUDGET_CHARS)}\n\n`; // i18n: user-facing
                } else {
                    docContext = `当前文档「${page.title}」:\n${truncateAtBoundary(plain, DOC_BUDGET_CHARS)}\n\n`; // i18n: user-facing
                }
            }
        } catch (e) {
            console.warn('[AI Copilot] buildContext DB error:', e.message);
        }
    }

    let parts = [];
    if (docContext) parts.push(docContext);
    if (textBefore) parts.push(`光标前文:\n${truncateAtBoundary(textBefore.slice(-1500), 1500)}`); // i18n: user-facing
    if (selectedText) parts.push(`选中内容:\n${selectedText.slice(0, MAX_SELECTION_CHARS)}`); // i18n: user-facing
    if (textAfter) parts.push(`光标后文:\n${truncateAtBoundary(textAfter.slice(0, 500), 500)}`); // i18n: user-facing
    return parts.join('\n\n');
}

// ── System prompts ──────────────────────────────────────────────────────────────
function buildSystemPrompt(action, extra) {
    const prompts = {
        // i18n: user-facing
        complete: `你是文档续写助手。根据上下文续写内容，保持语气风格一致。
只输出续写内容，不要解释、不要重复已有内容，直接输出文本。`, // i18n: user-facing

        // i18n: user-facing
        rewrite: `你是文档改写助手。根据指令改写选中内容，保持语义不变。
只输出改写后的文本，不要解释。${extra ? `\n改写要求: ${extra}` : ''}`, // i18n: user-facing

        // i18n: user-facing
        translate: `你是翻译助手。将选中内容翻译为${extra || '英文'}。
只输出翻译结果，不要解释，不要添加额外内容。`, // i18n: user-facing

        // i18n: user-facing
        summarize: `你是摘要助手。对选中内容生成精炼摘要。
用中文输出，不超过200字，保留关键信息。`, // i18n: user-facing

        // i18n: user-facing
        expand: `你是内容扩展助手。对选中内容进行展开和详细阐述。
保持原有风格，只输出扩展内容，不要解释。`, // i18n: user-facing
    };

    if (prompts[action]) return prompts[action];

    // i18n: user-facing
    return `你是AI文档助手。用户指令: ${action}${extra ? ` — ${extra}` : ''}
根据指令和上下文完成任务。只输出结果，不要解释。`; // i18n: user-facing
}

module.exports = { buildContext, buildSystemPrompt, truncateAtBoundary, extractToc, stripHtml, MAX_SELECTION_CHARS, DOC_BUDGET_CHARS, HEAD_BUDGET_CHARS };
