// =============================================================================
// Fusion-Doc — fusion-office office-api integration (issue #82)
// Replaces the nonexistent `officecli` binary. Mirrors the OfficeClient shape
// proven in ai-envipermit (parse_xlsx / fill_docx) over HTTP :11492.
// Endpoints currently exposed by fusion-office services/office-api:
//   GET  /healthz          liveness (returns service version)
//   POST /v1/xlsx/parse    multipart file -> { sheets: [...] }
//   POST /v1/docx/fill     multipart file + values -> filled .docx binary
// Missing upstream (feature degrades visibly, see services/office.js):
//   docx parse (import), html->docx write (export), xlsx write, pptx (fusion-office#32)
// =============================================================================

const httpFetch = globalThis.fetch;
const AbortCtrl = globalThis.AbortController;
const { fetchWithRetry } = require('./http-retry');
const crypto = require('crypto');

const DEFAULT_URL = 'http://127.0.0.1:11492';
const DEFAULT_TIMEOUT_MS = 60000;

function baseUrl(config) {
    return (config?.url || DEFAULT_URL).replace(/\/+$/, '');
}

// Error carrying an HTTP status so controllers can map it to the response.
class OfficeApiError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'OfficeApiError';
        this.status = status || 502;
    }
}

function buildMultipart(fields, fileField, filename, content) {
    const boundary = '----fusiondocoffice' + crypto.randomBytes(12).toString('hex');
    const parts = [];
    for (const [name, value] of Object.entries(fields || {})) {
        parts.push(
            Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
            )
        );
    }
    parts.push(
        Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
        )
    );
    parts.push(content, Buffer.from(`\r\n--${boundary}--\r\n`));
    return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

// Shared request path: fetchWithRetry + status-carrying error conversion.
// http-retry throws plain Error("<status>: <body>") for non-ok responses —
// converted here so controllers can map e.status to the HTTP response.
async function request(op, path, init, config) {
    try {
        return await fetchWithRetry(() => {
            const controller = new AbortCtrl();
            const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
            if (timer.unref) timer.unref();
            return httpFetch(`${baseUrl(config)}${path}`, {
                ...init,
                signal: controller.signal,
            }).finally(() => clearTimeout(timer));
        });
    } catch (e) {
        if (e && e.status) {
            const detail = e.message.replace(/^\d{3}: /, '');
            throw new OfficeApiError(`office-api ${op} failed with ${e.status}: ${detail}`, e.status >= 500 ? 502 : e.status);
        }
        if (e && e.name === 'AbortError') {
            throw new OfficeApiError(`office-api ${op}: request timed out after ${DEFAULT_TIMEOUT_MS}ms`, 504);
        }
        throw e;
    }
}

// ── Liveness: GET /healthz -> { available, version } ───────────────────────
async function health(config) {
    try {
        const resp = await httpFetch(`${baseUrl(config)}/healthz`, {
            method: 'GET',
            signal: globalThis.AbortSignal?.timeout(5000),
        });
        if (!resp.ok) return { available: false, error: `healthz ${resp.status}` };
        const body = await resp.json().catch(() => ({}));
        return { available: true, version: body.version || 'unknown' };
    } catch (e) {
        console.warn('[OfficeAPI] health check failed:', e.message);
        return { available: false, error: e.message };
    }
}

// ── POST /v1/xlsx/parse -> { sheets: [{ name, tables: [...] }] } ───────────
async function parseXlsx(content, filename, config) {
    const { body, contentType } = buildMultipart({}, 'file', filename, content);
    const resp = await request('xlsx/parse', '/v1/xlsx/parse', {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
    }, config);
    const data = await resp.json();
    if (!Array.isArray(data.sheets)) {
        throw new OfficeApiError('office-api /v1/xlsx/parse response missing sheets array');
    }
    return data;
}

// ── POST /v1/docx/fill -> filled .docx binary ──────────────────────────────
// Verifies X-Office-Doc-SHA256 integrity; returns { content, unfilled }.
async function fillDocx(content, filename, values, config) {
    const { body, contentType } = buildMultipart(
        { values: JSON.stringify(values || {}) },
        'file',
        filename,
        content
    );
    const resp = await request('docx/fill', '/v1/docx/fill', {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
    }, config);
    const out = Buffer.from(await resp.arrayBuffer());
    if (!out.length) throw new OfficeApiError('office-api /v1/docx/fill returned empty body');
    const expected = (resp.headers.get('x-office-doc-sha256') || '').toLowerCase();
    const actual = crypto.createHash('sha256').update(out).digest('hex');
    if (expected && expected !== actual) {
        throw new OfficeApiError(`office-api docx integrity mismatch: header ${expected} != body ${actual}`);
    }
    const unfilled = (resp.headers.get('x-office-unfilled') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return { content: out, sha256: actual, unfilled };
}

module.exports = { health, parseXlsx, fillDocx, OfficeApiError, DEFAULT_URL };
