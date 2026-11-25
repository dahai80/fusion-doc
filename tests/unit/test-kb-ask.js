// =============================================================================
// Fusion-Doc — fusion-kb askKb integration tests (issue #84)
// fusion-rag is the single knowledge layer: in-document QA calls
// POST /kb/bases/{kbId}/ask. Stub server verifies path, payload, X-API-Key
// passthrough, and non-ok error mapping.
// =============================================================================

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const kb = require('../../server/integrations/fusion-kb');

let handlers = {};
let seen = null;
const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
        seen = {
            url: req.url,
            apiKey: req.headers['x-api-key'] || null,
            body: Buffer.concat(chunks).toString('utf-8'),
        };
        const h = handlers[`${req.method} ${req.url}`];
        if (!h) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ detail: 'not found' }));
            return;
        }
        h(res);
    });
});

test.before(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
});
test.after(() => server.close());

function base(apiKey) {
    return { url: `http://127.0.0.1:${server.address().port}`, kbId: 'fusion-doc', apiKey: apiKey || '' };
}

test('askKb posts to /kb/bases/{id}/ask with question and top_k', async () => {
    handlers = {
        'POST /kb/bases/fusion-doc/ask': (res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ answer: 'from fusion-rag', sources: [], citations: [{ doc_name: 'a', text: 't' }], has_low_confidence: false }));
        },
    };
    const data = await kb.askKb(base(), { kbId: 'fusion-doc', question: 'what?', topK: 5 });
    assert.equal(data.answer, 'from fusion-rag');
    assert.equal(seen.url, '/kb/bases/fusion-doc/ask');
    assert.deepEqual(JSON.parse(seen.body), { question: 'what?', top_k: 5 });
});

test('askKb sends X-API-Key when configured, omits when not', async () => {
    handlers = {
        'POST /kb/bases/fusion-doc/ask': (res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ answer: 'ok', sources: [], citations: [] }));
        },
    };
    await kb.askKb(base('secret-key'), { kbId: 'fusion-doc', question: 'q', topK: 3 });
    assert.equal(seen.apiKey, 'secret-key');
    await kb.askKb(base(''), { kbId: 'fusion-doc', question: 'q', topK: 3 });
    assert.equal(seen.apiKey, null);
});

test('askKb maps 4xx/5xx to errors carrying status', async () => {
    handlers = {
        'POST /kb/bases/fusion-doc/ask': (res) => {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ detail: 'no such base' }));
        },
    };
    await assert.rejects(
        () => kb.askKb(base(), { kbId: 'fusion-doc', question: 'q', topK: 3 }),
        (e) => e.status === 404 && /no such base|404/.test(e.message)
    );
});
