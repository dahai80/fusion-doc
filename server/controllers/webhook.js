// =============================================================================
// Fusion-Doc — Webhook 控制器（Teedy 自动化 / 事件驱动）
// 商用级: SSRF 防护 (URL 白名单) + 密钥不外泄 + 错误不静默
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid, now } = require('../utils/helpers');
const { json, list, error } = require('../utils/response');
const { requireAdmin } = require('../middleware/require-admin');
const dns = require('dns').promises;
const net = require('net');
const httpFetch = globalThis.fetch;

// 校验 webhook URL: 仅 http/https, 拒私网/环回/链路本地/元数据 IP
async function isSafeWebhookUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch (_) {
        return { ok: false, reason: 'invalid url' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, reason: 'scheme not allowed' };
    }
    const hostname = parsed.hostname;
    // 字面量 IP 直接校验
    if (net.isIP(hostname)) {
        if (isPrivateIP(hostname)) return { ok: false, reason: 'private ip' };
        return { ok: true };
    }
    // 域名解析后校验所有 A 记录
    let addrs;
    try {
        addrs = await dns.resolve4(hostname);
    } catch (e) {
        return { ok: false, reason: 'dns resolve failed' };
    }
    for (const a of addrs) {
        if (isPrivateIP(a)) return { ok: false, reason: `resolved to private ip ${a}` };
    }
    return { ok: true };
}

function isPrivateIP(ip) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true; // loopback
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local + cloud metadata
    if (parts[0] === 0) return true;
    return false;
}

function register(app) {
    const { db } = app;

    // ── 列表: 不返回 secret (P2-18) ─────────────────────────────────────
    app.registerRoute('GET', '/api/webhooks', (req, res) => {
        const data = db
            ? db.prepare('SELECT id, name, url, events, enabled, created_at FROM webhooks ORDER BY created_at DESC').all()
            : [];
        list(res, data);
    });

    // ── 创建 (admin only, SSRF 校验) ───────────────────────────────────
    app.registerRoute('POST', '/api/webhooks', async (req, res) => {
        if (!requireAdmin(req, res)) return;
        const body = await parseBody(req);
        if (!body.url || typeof body.url !== 'string') return error(res, 'url required', 400);
        const check = await isSafeWebhookUrl(body.url);
        if (!check.ok) {
            console.warn(`  [Webhook] URL 被拒 (${check.reason}): ${body.url}`);
            return error(res, `url not allowed: ${check.reason}`, 403);
        }
        if (db) {
            db.prepare('INSERT INTO webhooks (id, name, url, events, enabled, secret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
                uid(), String(body.name || '').slice(0, 200), body.url,
                JSON.stringify(Array.isArray(body.events) ? body.events : []),
                body.enabled !== false, String(body.secret || '').slice(0, 512), now()
            );
        }
        console.log(`  [Webhook] 创建 webhook: ${body.url}`);
        json(res, { created: true }, 201);
    });

    // ── 触发 (admin only, 错误记日志不静默) ────────────────────────────
    app.registerRoute('POST', '/api/webhooks/trigger', async (req, res) => {
        if (!requireAdmin(req, res)) return;
        const body = await parseBody(req);
        if (!body.event) return error(res, 'event required', 400);
        if (db) {
            const hooks = db.prepare('SELECT * FROM webhooks WHERE enabled = 1').all();
            for (const hook of hooks) {
                const events = JSON.parse(hook.events || '[]');
                if (events.length === 0 || events.includes(body.event)) {
                    httpFetch(hook.url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': hook.secret || '' },
                        body: JSON.stringify({ event: body.event, data: body.data, timestamp: now() }),
                    }).then(r => {
                        if (!r.ok) console.warn(`  [Webhook] 投递非 2xx: ${hook.url} → ${r.status}`);
                    }).catch(e => {
                        console.warn(`  [Webhook] 投递失败 ${hook.url}: ${e.message}`);
                    });
                }
            }
        }
        json(res, { triggered: true });
    });
}

module.exports = { register };
