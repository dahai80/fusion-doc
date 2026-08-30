// =============================================================================
// Fusion-Doc — AI Copilot 控制器
// 编辑器内嵌 AI 操作：续写、改写、翻译、摘要、命令面板
// =============================================================================
/* global AbortController */

const { parseBody } = require('../middleware/body-parser');
const { callFusionMLXStream } = require('../integrations/fusion-mlx');
const { json, error } = require('../utils/response');
const { buildContext, buildSystemPrompt } = require('../services/ai-copilot');
// S5 修复: Copilot 读页内容须校验归属, 杜绝以他人私有页内容续写/改写/翻译 (IDOR)
const { canReadPage } = require('../middleware/authz');

function register(app) {
    const { db } = app;

    // S5: 校验 page_id 归属读权限。返 { allowed: bool }。无 page_id 视为允许 (仅用用户自传文本)。
    function canReadCopilotPage(req, page_id) {
        if (!page_id || !db) return true;
        const page = db.prepare('SELECT id, is_published, created_by FROM pages WHERE id = ?').get(page_id);
        if (!page) return true; // 不存在页 → buildContext 自身取不到, 无泄露面
        if (req.user?.role === 'admin') return true;
        if (page.is_published === 1 || page.is_published === '1') return true;
        const owner = page.created_by;
        if (!owner) return true;
        return owner === (req.user?.id || 'local');
    }

    // ── 内联续写 ────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/copilot/complete', async (req, res) => {
        const body = await parseBody(req);
        const { page_id, text_before, text_after } = body;
        if (!canReadCopilotPage(req, page_id)) return error(res, '无权读取该页面', 403, 'FORBIDDEN');
        const context = await buildContext(db, page_id, text_before, '', text_after);
        streamCopilotResponse(app, res, context, 'complete');
    });

    // ── 改写 ────────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/copilot/rewrite', async (req, res) => {
        const body = await parseBody(req);
        const { page_id, text_before, selected_text, text_after, instruction } = body;
        if (!canReadCopilotPage(req, page_id)) return error(res, '无权读取该页面', 403, 'FORBIDDEN');
        const context = await buildContext(db, page_id, text_before, selected_text, text_after);
        streamCopilotResponse(app, res, context, 'rewrite', instruction);
    });

    // ── 翻译 ────────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/copilot/translate', async (req, res) => {
        const body = await parseBody(req);
        const { page_id, text_before, selected_text, text_after, language } = body;
        if (!canReadCopilotPage(req, page_id)) return error(res, '无权读取该页面', 403, 'FORBIDDEN');
        const context = await buildContext(db, page_id, text_before, selected_text, text_after);
        streamCopilotResponse(app, res, context, 'translate', language);
    });

    // ── 摘要 ────────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/copilot/summarize', async (req, res) => {
        const body = await parseBody(req);
        const { page_id, text_before, selected_text, text_after } = body;
        if (!canReadCopilotPage(req, page_id)) return error(res, '无权读取该页面', 403, 'FORBIDDEN');
        const context = await buildContext(db, page_id, text_before, selected_text, text_after);
        streamCopilotResponse(app, res, context, 'summarize');
    });

    // ── 扩展 ────────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/copilot/expand', async (req, res) => {
        const body = await parseBody(req);
        const { page_id, text_before, selected_text, text_after } = body;
        if (!canReadCopilotPage(req, page_id)) return error(res, '无权读取该页面', 403, 'FORBIDDEN');
        const context = await buildContext(db, page_id, text_before, selected_text, text_after);
        streamCopilotResponse(app, res, context, 'expand');
    });

    // ── 命令面板 ────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/copilot/command', async (req, res) => {
        const body = await parseBody(req);
        const { page_id, command, prompt, text_before, selected_text, text_after } = body;
        if (!canReadCopilotPage(req, page_id)) return error(res, '无权读取该页面', 403, 'FORBIDDEN');
        const context = await buildContext(db, page_id, text_before, selected_text || '', text_after);
        const systemPrompt = buildSystemPrompt(command, prompt);
        streamCopilotResponse(app, res, context, command, prompt);
    });

    // ── 获取页面上下文 (S5: 加读归属校验) ─────────────────────────────
    app.registerRoute('GET', '/api/copilot/context/:id', async (req, res) => {
        const { id } = req.params;
        try {
            let page = db ? db.prepare('SELECT * FROM pages WHERE id = ?').get(id) : null;
            if (!page) return json(res, { context: '' });
            if (!canReadPage(req, res, page)) return;
            const content = (page.content || '').replace(/<[^>]+>/g, '').slice(0, 3000);
            json(res, { context: `文档: ${page.title}\n${content}` });
        } catch (e) {
            error(res, `Context fetch failed: ${e.message}`, 500);
        }
    });
}

// ── SSE 流式响应 ────────────────────────────────────────────────────────────
async function streamCopilotResponse(app, res, context, action, extra) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    const systemPrompt = buildSystemPrompt(action, extra);
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: context },
    ];

    // R7 修复: 客户端断开时真正 abort 上游 MLX 流 (原设计零 close 监听, 连接泄漏致 EMFILE)
    let aborted = false;
    const abortController = new AbortController();
    const onClose = () => { aborted = true; abortController.abort(); };
    res.on('close', onClose);
    try {
        const streamIter = callFusionMLXStream({
            model: app.config.fusionMlx.chatModel,
            messages,
            config: app.config.fusionMlx,
            abortSignal: abortController.signal,
        });
        for await (const chunk of streamIter) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
    } catch (e) {
        console.error('[AI Copilot] Stream error:', e.message);
        if (!aborted && !res.writableEnded) {
            res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
            res.end();
        }
    } finally {
        res.off('close', onClose);
    }
}

module.exports = { register };
