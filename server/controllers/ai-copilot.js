// =============================================================================
// Fusion-Doc — AI Copilot controller
// In-editor AI actions: continue, rewrite, translate, summarize, command palette
// =============================================================================
/* global AbortController */

const { parseBody } = require('../middleware/body-parser');
const { callFusionMLXStream } = require('../integrations/fusion-mlx');
const { json, error } = require('../utils/response');
const { buildContext, buildSystemPrompt, truncateAtBoundary, MAX_SELECTION_CHARS } = require('../services/ai-copilot');
// S5 fix: Copilot must verify ownership before reading page content, preventing continue/rewrite/translate on others' private pages (IDOR)
const { canReadPage } = require('../middleware/authz');
// issue #45: report AI token usage to fusion-identity (fire-and-forget)
const identity = require('../integrations/fusion-identity');

function register(app) {
    const { db } = app;

    // S5: verify read permission on page_id ownership. Returns { allowed: bool }. No page_id counts as allowed (only user-supplied text is used).
    // issue #45: tenant boundary on top — cross-tenant pages are always denied (red line 2)
    function canReadCopilotPage(req, page_id) {
        if (!page_id || !db) return true;
        const page = db.prepare('SELECT id, tenant_id, is_published, created_by FROM pages WHERE id = ?').get(page_id);
        if (!page) return true; // nonexistent page → buildContext cannot fetch it either, no leak surface
        const tid = req.user?.tid;
        if (tid && page.tenant_id && page.tenant_id !== tid) return false;
        if (req.user?.role === 'admin' || req.user?.role === 'tenant_admin') return true;
        if (page.is_published === 1 || page.is_published === '1') return true;
        const owner = page.created_by;
        if (!owner) return true;
        return owner === (req.user?.id || 'local');
    }

    // issue #69 P1: strict server-side cap on selection size. Over the cap → 413 + actionable hint (summarize/split first),
    // so a 50k select-all no longer reaches the LLM (blown context window / gateway timeout / runaway tenant token bill).
    function checkSelectionSize(res, selected_text) {
        if (selected_text && selected_text.length > MAX_SELECTION_CHARS) {
            console.warn(`[AI Copilot] selection too long: ${selected_text.length} chars > ${MAX_SELECTION_CHARS}`);
            error(res, `Selection too long (${selected_text.length} chars, limit ${MAX_SELECTION_CHARS}); summarize or split it first`, 413, 'SELECTION_TOO_LONG');
            return false;
        }
        return true;
    }

    // ── Inline continuation ────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/copilot/complete', async (req, res) => {
        const body = await parseBody(req);
        const { page_id, text_before, text_after } = body;
        if (!canReadCopilotPage(req, page_id)) return error(res, 'No permission to read this page', 403, 'FORBIDDEN');
        const context = await buildContext(db, page_id, text_before, '', text_after);
        streamCopilotResponse(req, app, res, context, 'complete');
    });

    // ── Rewrite ────────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/copilot/rewrite', async (req, res) => {
        const body = await parseBody(req);
        const { page_id, text_before, selected_text, text_after, instruction } = body;
        if (!canReadCopilotPage(req, page_id)) return error(res, 'No permission to read this page', 403, 'FORBIDDEN');
        if (!checkSelectionSize(res, selected_text)) return;
        const context = await buildContext(db, page_id, text_before, selected_text, text_after);
        streamCopilotResponse(req, app, res, context, 'rewrite', instruction);
    });

    // ── Translate ────────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/copilot/translate', async (req, res) => {
        const body = await parseBody(req);
        const { page_id, text_before, selected_text, text_after, language } = body;
        if (!canReadCopilotPage(req, page_id)) return error(res, 'No permission to read this page', 403, 'FORBIDDEN');
        if (!checkSelectionSize(res, selected_text)) return;
        const context = await buildContext(db, page_id, text_before, selected_text, text_after);
        streamCopilotResponse(req, app, res, context, 'translate', language);
    });

    // ── Summarize ────────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/copilot/summarize', async (req, res) => {
        const body = await parseBody(req);
        const { page_id, text_before, selected_text, text_after } = body;
        if (!canReadCopilotPage(req, page_id)) return error(res, 'No permission to read this page', 403, 'FORBIDDEN');
        if (!checkSelectionSize(res, selected_text)) return;
        const context = await buildContext(db, page_id, text_before, selected_text, text_after);
        streamCopilotResponse(req, app, res, context, 'summarize');
    });

    // ── Expand ────────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/copilot/expand', async (req, res) => {
        const body = await parseBody(req);
        const { page_id, text_before, selected_text, text_after } = body;
        if (!canReadCopilotPage(req, page_id)) return error(res, 'No permission to read this page', 403, 'FORBIDDEN');
        if (!checkSelectionSize(res, selected_text)) return;
        const context = await buildContext(db, page_id, text_before, selected_text, text_after);
        streamCopilotResponse(req, app, res, context, 'expand');
    });

    // ── Command palette ────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/copilot/command', async (req, res) => {
        const body = await parseBody(req);
        const { page_id, command, prompt, text_before, selected_text, text_after } = body;
        if (!canReadCopilotPage(req, page_id)) return error(res, 'No permission to read this page', 403, 'FORBIDDEN');
        if (!checkSelectionSize(res, selected_text)) return;
        const context = await buildContext(db, page_id, text_before, selected_text || '', text_after);
        const systemPrompt = buildSystemPrompt(command, prompt);
        streamCopilotResponse(req, app, res, context, command, prompt);
    });

    // ── Get page context (S5: read ownership check added) ─────────────────────────────
    app.registerRoute('GET', '/api/copilot/context/:id', async (req, res) => {
        const { id } = req.params;
        try {
            let page = db ? db.prepare('SELECT * FROM pages WHERE id = ?').get(id) : null;
            if (!page) return json(res, { context: '' });
            if (!canReadPage(req, res, page)) return;
            // issue #69 P2: boundary-aware truncation instead of blind cutting
            const content = truncateAtBoundary((page.content || '').replace(/<[^>]+>/g, ''), 3000);
            json(res, { context: `文档: ${page.title}\n${content}` }); // i18n: user-facing
        } catch (e) {
            error(res, `Context fetch failed: ${e.message}`, 500);
        }
    });
}

// ── SSE streaming response ────────────────────────────────────────────────────────────
async function streamCopilotResponse(req, app, res, context, action, extra) {
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

    // R7 fix: actually abort the upstream MLX stream on client disconnect (original design had no close listener; leaked connections caused EMFILE)
    let aborted = false;
    let lastUsage = null;
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
            if (chunk?.usage) lastUsage = chunk.usage;
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
        // issue #45: fire-and-forget token usage report after the stream ends
        const _tid = req?.user?.tid;
        if (_tid && _tid !== 'local-tenant' && lastUsage) {
            const _t = Number(lastUsage.total_tokens) || 0;
            if (_t) identity.reportUsage({ tid: _tid, usage: { tokens: _t, prompt_tokens: Number(lastUsage.prompt_tokens) || 0, completion_tokens: Number(lastUsage.completion_tokens) || 0 }, config: app.config.fusionIdentity }).catch(() => {});
        }
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
