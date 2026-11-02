// =============================================================================
// Fusion-Doc — 页面滚动摘要服务 (issue #69 P3)
// 长文档保存达阈值 → 异步生成 ≤400字摘要存 pages.summary (fire-and-forget,
// 绝不阻塞保存); copilot buildContext 对长文档改用 摘要+目录+开头片段。
// 过期判定: 原文 plain 长度相对 summary_source_len 漂移 > STALE_RATIO 即重生成。
// 仅 SQLite 路径生效 (JSON fallback 部署无列, 直接跳过)。
// =============================================================================

const { chat } = require('../integrations/fusion-mlx');
const { stripHtml, truncateAtBoundary } = require('./ai-copilot');

const SUMMARY_MIN_CHARS = 6000;   // plain 长度触发阈值 (≈ CJK 6k token 原文)
const SUMMARY_MAX_CHARS = 400;    // 摘要存储上限
const SOURCE_HEAD_CHARS = 8000;   // 送 LLM 的原文开头预算 (≈ CJK 8k token)
const STALE_RATIO = 0.2;          // 长度漂移 >20% 视为摘要过期
const inflight = new Set();       // 页级去重, 防连击保存重复请求 LLM

function isStale(plainLen, sourceLen) {
    if (!sourceLen) return true;
    return Math.abs(plainLen - sourceLen) / sourceLen > STALE_RATIO;
}

// fire-and-forget 入口。page 须含 { id, title, content, summary, summary_source_len }。
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
            { role: 'system', content: '你是文档摘要助手。对给定长文档生成精炼摘要，用中文输出，不超过300字，保留核心论点与关键结论，不要解释。' },
            { role: 'user', content: `文档「${page.title}」:\n${truncateAtBoundary(plain, SOURCE_HEAD_CHARS)}` },
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
        // 商用级 fail visibly: 记日志不吞, 但摘要失败不影响保存主流程
        console.error('[Page Summary] generate failed:', e.message);
    } finally {
        if (page?.id) inflight.delete(page.id);
    }
}

module.exports = { maybeGeneratePageSummary, SUMMARY_MIN_CHARS, SUMMARY_MAX_CHARS, STALE_RATIO, isStale };
