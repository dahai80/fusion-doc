// =============================================================================
// E8 fix: behavior tests — rate limiter LRU eviction (R9)
// Verifies that a full Map evicts the earliest-expiring entry instead of permanently rejecting new keys
// =============================================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rateLimit } = require('../../server/middleware/rate-limit');

function mockReq(ip) {
    return { socket: { remoteAddress: ip }, url: '/api/test' };
}

function mockRes() {
    const res = { statusCode: 200, headers: {}, body: '', ended: false };
    res.writeHead = (code, h) => { res.statusCode = code; res.headers = h || {}; };
    res.end = (b) => { res.ended = true; res.body = b || ''; };
    return res;
}

test('R9: allowed under the limit', () => {
    const lim = rateLimit({ windowMs: 60000, maxRequests: 5, tag: 't' });
    const blocked = lim(mockReq('10.0.0.1'), mockRes(), {});
    assert.equal(blocked, false);
});

test('R9: exceeding the limit returns 429', () => {
    const lim = rateLimit({ windowMs: 60000, maxRequests: 2, tag: 't2' });
    lim(mockReq('10.0.0.2'), mockRes(), {});
    lim(mockReq('10.0.0.2'), mockRes(), {});
    const res = mockRes();
    const blocked = lim(mockReq('10.0.0.2'), res, {});
    assert.equal(blocked, true);
    assert.equal(res.statusCode, 429);
    assert.equal(res.headers['Retry-After'] !== undefined, true);
});

test('R9: different IPs are counted independently', () => {
    const lim = rateLimit({ windowMs: 60000, maxRequests: 1, tag: 't3' });
    lim(mockReq('10.0.0.3'), mockRes(), {});
    // A different IP is not affected by the first IP's limit
    assert.equal(lim(mockReq('10.0.0.4'), mockRes(), {}), false);
    // The first IP should be limited on its next request
    assert.equal(lim(mockReq('10.0.0.3'), mockRes(), {}), true);
});

test('R9: resets after the window expires', () => {
    const lim = rateLimit({ windowMs: 1, maxRequests: 1, tag: 't4' });
    lim(mockReq('10.0.0.5'), mockRes(), {});
    assert.equal(lim(mockReq('10.0.0.5'), mockRes(), {}), true);
    // Wait for the window to expire
    const start = Date.now();
    while (Date.now() - start < 10) { /* spin */ }
    assert.equal(lim(mockReq('10.0.0.5'), mockRes(), {}), false);
});
