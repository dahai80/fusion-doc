// =============================================================================
// Fusion-Doc — AI Copilot 控制器
// 编辑器内嵌 AI 操作：续写、改写、翻译、摘要、命令面板
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { callFusionMLXStream } = require('../integrations/fusion-mlx');
const { json, error } = require('../utils/response');
const { buildContext, buildSystemPrompt } = require('../services/ai-copilot');

function register(app) {
    const { db } = app;

    // ── 内联续写 ────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/copilot/complete', async (req, res) => {
        const body = await parseBody(req);
        const { page_id, text_before, text_after } = body;
        const context = await buildContext(db, page_id, text_before, '', text_after);
        streamCopilotResponse(app, res, context, 'complete');
    });

    // ── 改写 ────────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/copilot/rewrite', async (req, res) => {
        const body = await parseBody(req);
        const { page_id, text_before, selected_text, text_after, instruction } = body;
        const context = await buildContext(db, page_id, text_before, selected_text, text_after);
        streamCopilotResponse(app, res, context, 'rewrite', instruction);
    });

    // ── 翻译 ────────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/copilot/translate', async (req, res) => {
        const body = await parseBody(req);
        const { page_id, text_before, selected_text, text_after, language } = body;
        const context = await buildContext(db, page_id, text_before, selected_text, text_after);
        streamCopilotResponse(app, res, context, 'translate', language);
    });

    // ── 摘要 ────────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/copilot/summarize', async (req, res) => {
        const body = await parseBody(req);
        const { page_id, text_before, selected_text, text_after } = body;
        const context = await buildContext(db, page_id, text_before, selected_text, text_after);
        streamCopilotResponse(app, res, context, 'summarize');
    });

    // ── 扩展 ────────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/copilot/expand', async (req, res) => {
        const body = await parseBody(req);
        const { page_id, text_before, selected_text, text_after } = body;
        const context = await buildContext(db, page_id, text_before, selected_text, text_after);
        streamCopilotResponse(app, res, context, 'expand');
    });

    // ── 命令面板 ────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/copilot/command', async (req, res) => {
        const body = await parseBody(req);
        const { page_id, command, prompt, text_before, selected_text, text_after } = body;
        const context = await buildContext(db, page_id, text_before, selected_text || '', text_after);
        const systemPrompt = buildSystemPrompt(command, prompt);
        streamCopilotResponse(app, res, context, command, prompt);
    });

    // ── 获取页面上下文 ──────────────────────────────────────────────────
    app.registerRoute('GET', '/api/copilot/context/:id', async (req, res) => {
        const { id } = req.params;
        try {
            let page = db ? db.prepare('SELECT id, title, content FROM pages WHERE id = ?').get(id) : null;
            if (!page) return json(res, { context: '' });
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

    try {
        const streamIter = callFusionMLXStream({
            model: app.config.fusionMlx.chatModel,
            messages,
            config: app.config.fusionMlx,
        });
        for await (const chunk of streamIter) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
    } catch (e) {
        console.error('[AI Copilot] Stream error:', e.message);
        res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
        res.end();
    }
}

module.exports = { register };
