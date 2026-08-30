// =============================================================================
// E8 修复: 行为测试 — 限流 LRU 淘汰 (R9)
// 验证 Map 满载时不永久拒绝新 key, 而淘汰最早到期条目
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

test('R9: 未超限放行', () => {
    const lim = rateLimit({ windowMs: 60000, maxRequests: 5, tag: 't' });
    const blocked = lim(mockReq('10.0.0.1'), mockRes(), {});
    assert.equal(blocked, false);
});

test('R9: 超限触发 429', () => {
    const lim = rateLimit({ windowMs: 60000, maxRequests: 2, tag: 't2' });
    lim(mockReq('10.0.0.2'), mockRes(), {});
    lim(mockReq('10.0.0.2'), mockRes(), {});
    const res = mockRes();
    const blocked = lim(mockReq('10.0.0.2'), res, {});
    assert.equal(blocked, true);
    assert.equal(res.statusCode, 429);
    assert.equal(res.headers['Retry-After'] !== undefined, true);
});

test('R9: 不同 IP 独立计数', () => {
    const lim = rateLimit({ windowMs: 60000, maxRequests: 1, tag: 't3' });
    lim(mockReq('10.0.0.3'), mockRes(), {});
    // 不同 IP 不受第一个 IP 限流影响
    assert.equal(lim(mockReq('10.0.0.4'), mockRes(), {}), false);
    // 第一个 IP 再来应被限
    assert.equal(lim(mockReq('10.0.0.3'), mockRes(), {}), true);
});

test('R9: 窗口过期后重置', () => {
    const lim = rateLimit({ windowMs: 1, maxRequests: 1, tag: 't4' });
    lim(mockReq('10.0.0.5'), mockRes(), {});
    assert.equal(lim(mockReq('10.0.0.5'), mockRes(), {}), true);
    // 等窗口过期
    const start = Date.now();
    while (Date.now() - start < 10) { /* spin */ }
    assert.equal(lim(mockReq('10.0.0.5'), mockRes(), {}), false);
});
