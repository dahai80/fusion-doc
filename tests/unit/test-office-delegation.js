// =============================================================================
// Fusion-Doc — office-api delegation boundary tests (issue #90, RFC office#64 H2)
// office-api (:11492) is the single office-format engine. These tests pin the
// delegation boundaries: xlsx import reaches office-api, docx/pptx import and
// all-format export fail fast with the actionable capability message, and the
// legacy pandoc/libreoffice docx export path on /api/export is gone.
// =============================================================================

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const officeApi = require('../../server/integrations/office-api');
const { officeImport, officeExport } = require('../../server/services/office');
const exportController = require('../../server/controllers/export');

// ── Stub office-api server: records calls, serves /v1/xlsx/parse ───────────
let stubCalls = [];
const stub = http.createServer((req, res) => {
    let body = [];
    req.on('data', (c) => body.push(c));
    req.on('end', () => {
        stubCalls.push(`${req.method} ${req.url}`);
        if (req.url === '/v1/xlsx/parse') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ sheets: [{ name: 'S1', tables: [] }] }));
            return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'no such endpoint' }));
    });
});

test.before(async () => {
    await new Promise((r) => stub.listen(0, '127.0.0.1', r));
});
test.after(() => stub.close());

function stubConfig() {
    return { fusionOfficeApi: { url: `http://127.0.0.1:${stub.address().port}` } };
}

// Minimal app stub: only needs to create a page row for a successful import.
function appStub(config) {
    return {
        config,
        db: {
            prepare: () => ({
                run: () => {},
            }),
        },
    };
}

test('xlsx import delegates to office-api /v1/xlsx/parse', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-office-'));
    const file = path.join(dir, 'book.xlsx');
    fs.writeFileSync(file, 'XLSXBYTES');
    try {
        const result = await officeImport(appStub(stubConfig()), { file_path: file });
        assert.equal(result.success, true);
        assert.ok(stubCalls.includes('POST /v1/xlsx/parse'), 'office-api parse endpoint must be called');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('docx import fails fast: office-api has no docx parse endpoint yet', async () => {
    await assert.rejects(
        () => officeImport(appStub(stubConfig()), { file_path: '/tmp/nope.docx' }),
        (e) => e instanceof officeApi.OfficeApiError && e.status === 422 && /docx parse/.test(e.message)
    );
});

test('all-format export fails fast: office-api has no document write endpoint yet', async () => {
    await assert.rejects(
        () => officeExport(appStub(stubConfig()), { format: 'docx' }),
        (e) => e instanceof officeApi.OfficeApiError && e.status === 422 && /document write/.test(e.message)
    );
});

// ── /api/export/:format/docx must return the visible capability error ──────
function resStub() {
    return {
        statusCode: null,
        headers: null,
        body: '',
        writableEnded: false,
        writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
        end(payload) { this.writableEnded = true; if (payload) this.body += payload; },
    };
}

test('GET /api/export/docx/:id returns the office-api capability error, not pandoc output', async () => {
    const routes = {};
    exportController.register({
        registerRoute: (method, pattern, handler) => { routes[`${method} ${pattern}`] = handler; },
        db: {
            prepare: () => ({ get: () => ({ id: 'p1', title: 'T', slug: 't', markdown: 'body' }) }),
        },
        config: { dataDir: os.tmpdir() },
    });
    const handler = routes['GET /api/export/:format/:id'];
    assert.ok(handler, 'export route must be registered');
    const res = resStub();
    await handler({ params: { format: 'docx', id: 'p1' }, user: null }, res);
    assert.equal(res.statusCode, 422);
    const payload = JSON.parse(res.body);
    assert.match(payload.error, /office-api has no document write/);
    assert.match(payload.error, /fusion-office upstream/);
});
