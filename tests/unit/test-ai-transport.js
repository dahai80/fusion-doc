// =============================================================================
// Fusion-Doc — ai-client transport contract tests (issue #90, RFC office#64 H3)
// The chat panel streams via the vendored @fusion-office/ai-client straight to
// fusion-gateway. These tests mirror the ai-client contract from the consumer
// side: SSE text events, gateway error mapping, and rollout-tap outcome
// reporting (schema v1) for fusion-doc agentic steps.
// =============================================================================

const { test } = require('node:test');
const assert = require('node:assert');

let aiClient;

test.before(async () => {
    aiClient = await import('../../client/src/vendor/ai-client/index.js');
});

// ── fetch stub helper: SSE stream with scripted chunks ─────────────────────
function sseResponse(chunks, status = 200) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            for (const c of chunks) controller.enqueue(encoder.encode(c));
            controller.close();
        },
    });
    return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

function withFetchStub(stub) {
    const original = globalThis.fetch;
    globalThis.fetch = stub;
    return () => { globalThis.fetch = original; };
}

function setUp() {
    aiClient.resetPolicyCache();
    aiClient.configure({ baseUrl: 'http://ai-stub.test', apiKey: 'test-key', defaultModel: 'test-model' });
}

test('chatStreamEvents yields text deltas from the gateway SSE stream', async () => {
    setUp();
    const seen = { url: '', auth: '', body: null };
    const restore = withFetchStub(async (url, init) => {
        seen.url = url;
        seen.auth = init.headers.Authorization || '';
        seen.body = JSON.parse(init.body);
        return sseResponse([
            'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] }) + '\n\n',
            'data: ' + JSON.stringify({ choices: [{ delta: { content: ' world' } }] }) + '\n\n',
            'data: [DONE]\n\n',
        ]);
    });
    try {
        const texts = [];
        for await (const ev of aiClient.chatStreamEvents({ messages: [{ role: 'user', content: 'hi' }] })) {
            if (ev.type === 'text') texts.push(ev.text);
        }
        assert.equal(seen.url, 'http://ai-stub.test/v1/chat/completions');
        assert.equal(seen.auth, 'Bearer test-key');
        assert.equal(seen.body.stream, true);
        assert.equal(seen.body.model, 'test-model');
        assert.deepEqual(texts, ['Hello', ' world']);
    } finally {
        restore();
    }
});

test('chatStreamEvents maps gateway errors into a thrown error with status', async () => {
    setUp();
    const restore = withFetchStub(async () => sseResponse(['model busy'], 503));
    try {
        await assert.rejects(
            () => aiClient.chatStreamEvents({ messages: [{ role: 'user', content: 'hi' }] }).next(),
            (e) => /gateway 503/.test(e.message)
        );
    } finally {
        restore();
    }
});

test('outcome reporter emits rollout-tap schema v1 records for fusion-doc', async () => {
    const posted = [];
    const reporter = aiClient.createOutcomeReporter({
        app: 'fusion-doc',
        endpoint: 'http://outcomes-stub.test/v1/outcomes',
        fetchImpl: async (url, init) => {
            posted.push({ url, record: JSON.parse(init.body) });
            return { ok: true };
        },
    });
    reporter.report({ signal: 'task_success', detail: 'chat turn completed', messages: [{ role: 'user', content: 'secret prompt' }] });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(posted.length, 1);
    assert.equal(posted[0].url, 'http://outcomes-stub.test/v1/outcomes');
    const rec = posted[0].record;
    assert.equal(rec.schema_version, 1);
    assert.equal(rec.source, 'fusion-office/fusion-doc');
    assert.equal(rec.outcome.signal, 'task_success');
    assert.equal(rec.outcome.score, 1.0);
    assert.ok(rec.rollout_id.startsWith('ro-'));
    // default content mode is redact: message bodies must not leave raw
    assert.ok(!JSON.stringify(rec.messages).includes('secret prompt'));
});

test('outcome reporter drops unknown signals and never surfaces failures', async () => {
    const posted = [];
    const reporter = aiClient.createOutcomeReporter({
        app: 'fusion-doc',
        endpoint: 'http://outcomes-stub.test/v1/outcomes',
        fetchImpl: async () => { throw new Error('sink down'); },
    });
    reporter.report({ signal: 'bogus_signal' });
    assert.equal(posted.length, 0);
    // failed emit is a warning, never an exception
    reporter.report({ signal: 'error', detail: 'chat turn failed' });
    await new Promise((r) => setTimeout(r, 10));
});
