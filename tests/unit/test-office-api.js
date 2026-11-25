// =============================================================================
// Fusion-Doc — office-api integration tests (issue #82)
// Spins a local HTTP stub mimicking fusion-office office-api endpoints and
// verifies the client contract: health, xlsx/parse, docx/fill (SHA-256
// integrity + unfilled headers), error mapping, status capability shape.
// =============================================================================

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');

const officeApi = require('../../server/integrations/office-api');
const { getOfficeStatus } = require('../../server/services/office');

// ── multipart helper: extract file bytes + fields from raw body ────────────
// Splits on the boundary in latin1 space (byte-preserving for binary parts).
function parseMultipart(body, contentType) {
    const boundary = /boundary=(.+)$/.exec(contentType)[1];
    const raw = body.toString('latin1');
    const parts = raw.split(`--${boundary}`).filter((p) => p.length > 4 && p !== '--');
    const out = { fields: {}, files: {} };
    for (const part of parts) {
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd < 0) continue;
        const headerStr = part.slice(0, headerEnd);
        let value = part.slice(headerEnd + 4);
        if (value.endsWith('\r\n')) value = value.slice(0, -2);
        const nameMatch = headerStr.match(/name="([^"]+)"/);
        if (!nameMatch) continue;
        if (/filename=/.test(headerStr)) out.files[nameMatch[1]] = Buffer.from(value, 'latin1');
        else out.fields[nameMatch[1]] = value;
    }
    return out;
}

// ── Stub server: configurable per-test handlers ────────────────────────────
let handlers = {};
const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
        const h = handlers[`${req.method} ${req.url.split('?')[0]}`];
        if (!h) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ detail: 'not found' }));
            return;
        }
        h(req, res, Buffer.concat(chunks));
    });
});

test.before(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
});

test.after(() => server.close());

function base() {
    return { url: `http://127.0.0.1:${server.address().port}` };
}

test('health returns available + version from /healthz', async () => {
    handlers = {
        'GET /healthz': (req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', version: '0.1.0' }));
        },
    };
    const h = await officeApi.health(base());
    assert.equal(h.available, true);
    assert.equal(h.version, '0.1.0');
});

test('health degrades on connection refused', async () => {
    const h = await officeApi.health({ url: 'http://127.0.0.1:1' });
    assert.equal(h.available, false);
    assert.ok(h.error);
});

test('parseXlsx posts multipart file and returns sheets', async () => {
    let seen = null;
    handlers = {
        'POST /v1/xlsx/parse': (req, res, body) => {
            seen = parseMultipart(body, req.headers['content-type']);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ sheets: [{ name: 'S1', tables: [{ headers: ['a'], rows: [['1']] }] }] }));
        },
    };
    const data = await officeApi.parseXlsx(Buffer.from('XLSXBYTES'), 'book.xlsx', base());
    assert.ok(seen, 'server should have received the request');
    assert.equal(data.sheets.length, 1);
    assert.equal(data.sheets[0].name, 'S1');
    assert.equal(seen.files.file.toString(), 'XLSXBYTES');
});

test('parseXlsx maps 422 detail into OfficeApiError with status', async () => {
    handlers = {
        'POST /v1/xlsx/parse': (req, res) => {
            res.writeHead(422, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ detail: 'malformed xlsx' }));
        },
    };
    await assert.rejects(
        () => officeApi.parseXlsx(Buffer.from('bad'), 'bad.xlsx', base()),
        (e) => e instanceof officeApi.OfficeApiError && e.status === 422 && /malformed xlsx/.test(e.message)
    );
});

test('fillDocx returns content, verifies sha256 header, parses unfilled', async () => {
    const filled = Buffer.from('FILLED-DOCX');
    const sha = crypto.createHash('sha256').update(filled).digest('hex');
    let seen = null;
    handlers = {
        'POST /v1/docx/fill': (req, res, body) => {
            seen = parseMultipart(body, req.headers['content-type']);
            res.writeHead(200, {
                'X-Office-Doc-SHA256': sha,
                'X-Office-Unfilled': 'missing_a, missing_b',
            });
            res.end(filled);
        },
    };
    const r = await officeApi.fillDocx(Buffer.from('TEMPLATE'), 't.docx', { name: 'dahai' }, base());
    assert.ok(seen, 'server should have received the request');
    assert.equal(seen.files.file.toString(), 'TEMPLATE');
    assert.deepEqual(JSON.parse(seen.fields.values), { name: 'dahai' });
    assert.equal(r.content.toString(), 'FILLED-DOCX');
    assert.equal(r.sha256, sha);
    assert.deepEqual(r.unfilled, ['missing_a', 'missing_b']);
});

test('fillDocx rejects body tampered after signing', async () => {
    const sha = crypto.createHash('sha256').update('ORIGINAL').digest('hex');
    handlers = {
        'POST /v1/docx/fill': (req, res) => {
            res.writeHead(200, { 'X-Office-Doc-SHA256': sha });
            res.end('TAMPERED');
        },
    };
    await assert.rejects(
        () => officeApi.fillDocx(Buffer.from('T'), 't.docx', {}, base()),
        (e) => /integrity mismatch/.test(e.message)
    );
});

test('getOfficeStatus exposes backend + capability map', async () => {
    handlers = {
        'GET /healthz': (req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ version: '0.1.0' }));
        },
    };
    const s = await getOfficeStatus(base());
    assert.equal(s.available, true);
    assert.equal(s.backend, 'office-api');
    assert.equal(s.capabilities.xlsx_import, true);
    assert.equal(s.capabilities.docx_fill, true);
    assert.equal(s.capabilities.docx_import, false);
    assert.equal(s.capabilities.export, false);
    assert.equal(s.capabilities.pptx, false);
});
