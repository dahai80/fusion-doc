// issue #60: SPA fallback 深链修复 — serveSPA 注入 <base>, 修复 ./assets 相对解析
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { serveSPA } = require('../../server/utils/static');

function makePublicDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fusion-doc-spa-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html><head><title>t</title></head><body></body></html>');
    return dir;
}

function fetchSPA(publicDir, baseHref) {
    return new Promise((resolve, reject) => {
        const res = {
            headers: null,
            body: '',
            writeHead(status, headers) { this.headers = { status, ...headers }; },
            end(chunk) { this.body = chunk ? this.body + chunk.toString() : this.body; resolve(this); },
        };
        serveSPA(res, publicDir, baseHref);
        setTimeout(() => reject(new Error('serveSPA timeout')), 2000);
    });
}

test('root-mode deep link gets base href "/"', async () => {
    const dir = makePublicDir();
    const res = await fetchSPA(dir, '/');
    assert.equal(res.headers.status, 200);
    assert.match(res.body, /<base href="\/">/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('shell proxy request gets mount-prefixed base href', async () => {
    const dir = makePublicDir();
    const res = await fetchSPA(dir, '/shell/fusion-doc/');
    assert.equal(res.headers.status, 200);
    assert.match(res.body, /<base href="\/shell\/fusion-doc\/">/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('null base (root path, no shell) serves index.html without base tag', async () => {
    const dir = makePublicDir();
    const res = await fetchSPA(dir, null);
    assert.equal(res.headers.status, 200);
    assert.doesNotMatch(res.body, /<base href/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('traversal-looking base href is rejected, no injection', async () => {
    const dir = makePublicDir();
    const res = await fetchSPA(dir, '/a/../../etc');
    assert.equal(res.headers.status, 200);
    assert.doesNotMatch(res.body, /<base href/);
    // 危险值被拒, 页面仍可服务 (退回原相对行为)
    assert.match(res.body, /<html>/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('missing index.html returns 404 envelope', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fusion-doc-spa-'));
    const res = await fetchSPA(dir, '/');
    assert.equal(res.headers.status, 404);
    assert.match(res.body, /SPA index.html not found/);
    fs.rmSync(dir, { recursive: true, force: true });
});
