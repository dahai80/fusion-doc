// =============================================================================
// Fusion-Doc — Webhook 控制器（Teedy 自动化 / 事件驱动）
// 商用级: SSRF 防护 (URL 白名单) + 密钥不外泄 + 错误不静默
// =============================================================================
/* global AbortController */

const { parseBody } = require('../middleware/body-parser');
const { uid, now } = require('../utils/helpers');
const { json, list, error } = require('../utils/response');
const { requireAdmin } = require('../middleware/require-admin');
const dns = require('dns').promises;
const net = require('net');
const httpFetch = globalThis.fetch;

// 校验 webhook URL: 仅 http/https, 拒私网/环回/链路本地/元数据 IP (IPv4 + IPv6)。
// S7 修复: 原仅 resolve4 + 仅拦 IPv4, 漏 IPv6 私有/链路本地 (::1, fc00::/7, fe80::/10)
// 及 IPv4-mapped IPv6 (::ffff:127.0.0.1)。同时解析 A(IPv4) 与 AAAA(IPv6)。
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
    // 字面量 IP (v4/v6) 直接校验
    if (net.isIP(hostname)) {
        if (isPrivateIP(hostname)) return { ok: false, reason: 'private ip' };
        return { ok: true };
    }
    // 域名解析后校验所有 A + AAAA 记录
    const addrs = [];
    try {
        addrs.push(...(await dns.resolve4(hostname)));
    } catch (_) { /* 无 A 记录可能仅 AAAA, 继续 */ }
    try {
        addrs.push(...(await dns.resolve6(hostname)));
    } catch (_) { /* 无 AAAA 记录, 继续 */ }
    if (addrs.length === 0) return { ok: false, reason: 'dns resolve failed' };
    for (const a of addrs) {
        if (isPrivateIP(a)) return { ok: false, reason: `resolved to private ip ${a}` };
    }
    return { ok: true };
}

// S7 修复: 同时拦 IPv4 与 IPv6 私有/保留段。
// IPv4: 10/8, 172.16-31, 192.168, 127/8, 169.254, 0/8, 100.64/10 (CGNAT), 224-255 (多播/保留)。
// IPv6: ::1 (环回), :: (未指定), fc00::/7 (ULA 私有), fe80::/10 (链路本地),
//       ::ffff:x.x.x.x (IPv4-mapped, 须回退查内嵌 IPv4)。
function isPrivateIP(ip) {
    if (net.isIPv6(ip)) {
        const h = ip.toLowerCase();
        if (h === '::1') return true; // 环回
        if (h === '::') return true; // 未指定
        if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA 私有 fc00::/7
        if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) return true; // fe80::/10 链路本地
        // IPv4-mapped IPv6: ::ffff:a.b.c.d → 提取内嵌 IPv4 复查
        const m = h.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
        if (m) return isPrivateIPv4(m[1]);
        return false;
    }
    return isPrivateIPv4(ip);
}

function isPrivateIPv4(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return true; // 畸形按私有不放行
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true; // loopback
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local + cloud metadata
    if (parts[0] === 0) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // CGNAT 100.64/10
    if (parts[0] >= 224) return true; // 多播 224/4 + 保留 240/4
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
                    // S7 修复: 投递前复验 URL (防 DNS-rebind TOCTOU: 创建时校验通过, 触发时解析已指向内网)
                    const recheck = await isSafeWebhookUrl(hook.url);
                    if (!recheck.ok) {
                        console.warn(`  [Webhook] 投递前 SSRF 复验拒绝 (${recheck.reason}): ${hook.url}`);
                        continue;
                    }
                    // E5 修复: fetch 加超时 + abort, 防目标不响应致 socket 永挂泄漏
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), 10000);
                    httpFetch(hook.url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': hook.secret || '' },
                        body: JSON.stringify({ event: body.event, data: body.data, timestamp: now() }),
                        signal: controller.signal,
                    }).then(r => {
                        clearTimeout(timer);
                        if (!r.ok) console.warn(`  [Webhook] 投递非 2xx: ${hook.url} → ${r.status}`);
                    }).catch(e => {
                        clearTimeout(timer);
                        console.warn(`  [Webhook] 投递失败 ${hook.url}: ${e.message}`);
                    });
                }
            }
        }
        json(res, { triggered: true });
    });
}

module.exports = { register };
