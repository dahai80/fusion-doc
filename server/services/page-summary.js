// =============================================================================
// Fusion-Doc — rolling page summary service (issue #69 P3)
// When a long doc save crosses the threshold → asynchronously generate a ≤400-char summary into pages.summary (fire-and-forget,
// never blocks the save); copilot buildContext uses summary + TOC + leading excerpt for long docs.
// Staleness: regenerate when the plain-text length drifts from summary_source_len by more than STALE_RATIO.
// Only applies on the SQLite path (JSON fallback deployments lack the column and are skipped).
// =============================================================================

const { chat } = require('../integrations/fusion-mlx');
const { stripHtml, truncateAtBoundary } = require('./ai-copilot');

const SUMMARY_MIN_CHARS = 6000;   // plain-length trigger threshold (≈ 6k CJK tokens of source)
const SUMMARY_MAX_CHARS = 400;    // Max stored summary length
const SOURCE_HEAD_CHARS = 8000;   // Budget for the leading source text sent to the LLM (≈ 8k CJK tokens)
const STALE_RATIO = 0.2;          // Length drift >20% means the summary is stale
const inflight = new Set();       // Per-page dedup, so rapid repeated saves do not trigger duplicate LLM requests

function isStale(plainLen, sourceLen) {
    if (!sourceLen) return true;
    return Math.abs(plainLen - sourceLen) / sourceLen > STALE_RATIO;
}

// fire-and-forget entry point. page must contain { id, title, content, summary, summary_source_len }.
async function maybeGeneratePageSummary(app, page) {
    try {
        if (!app?.db || !page?.id || !page.content) return;
        const plain = stripHtml(page.content);
        if (plain.length < SUMMARY_MIN_CHARS) return;
        if (page.summary && !isStale(plain.length, page.summary_source_len)) return;
        if (inflight.has(page.id)) return;
        inflight.add(page.id);

        const config = app.config.fusionMlx;
        const messages = [
            { role: 'system', content: '你是文档摘要助手。对给定长文档生成精炼摘要，用中文输出，不超过300字，保留核心论点与关键结论，不要解释。' }, // i18n: user-facing
            { role: 'user', content: `文档「${page.title}」:\n${truncateAtBoundary(plain, SOURCE_HEAD_CHARS)}` }, // i18n: user-facing
        ];
        const data = await chat({ model: config.chatModel, messages, config });
        const summary = String(data?.choices?.[0]?.message?.content || '').trim().slice(0, SUMMARY_MAX_CHARS);
        if (!summary) {
            console.warn(`[Page Summary] empty summary for ${page.id}, skip`);
            return;
        }
        app.db.prepare('UPDATE pages SET summary = ?, summary_source_len = ? WHERE id = ?').run(summary, plain.length, page.id);
        console.log(`[Page Summary] generated for ${page.id} (source ${plain.length} chars, summary ${summary.length} chars)`);
    } catch (e) {
        // Production-grade fail visibly: log instead of swallowing, but a summary failure does not affect the main save flow
        console.error('[Page Summary] generate failed:', e.message);
    } finally {
        if (page?.id) inflight.delete(page.id);
    }
}

module.exports = { maybeGeneratePageSummary, SUMMARY_MIN_CHARS, SUMMARY_MAX_CHARS, STALE_RATIO, isStale };
