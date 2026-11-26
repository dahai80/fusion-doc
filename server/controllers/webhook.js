// =============================================================================
// Fusion-Doc — Webhook controller (Teedy automation / event-driven)
// Production-grade: SSRF protection (URL allowlist) + no secret leakage + no silent errors
// =============================================================================
/* global AbortController */

const { parseBody } = require('../middleware/body-parser');
const { uid, now } = require('../utils/helpers');
const { json, list, error } = require('../utils/response');
const { requireAdmin } = require('../middleware/require-admin');
const dns = require('dns').promises;
const net = require('net');
const httpFetch = globalThis.fetch;

// Validate webhook URL: http/https only; reject private/loopback/link-local/metadata IPs (IPv4 + IPv6).
// S7 fix: previously only resolve4 + IPv4 blocking, missing IPv6 private/link-local (::1, fc00::/7, fe80::/10)
// and IPv4-mapped IPv6 (::ffff:127.0.0.1). Now resolves both A (IPv4) and AAAA (IPv6).
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
    // Literal IP (v4/v6): check directly
    if (net.isIP(hostname)) {
        if (isPrivateIP(hostname)) return { ok: false, reason: 'private ip' };
        return { ok: true };
    }
    // Hostname: resolve and check every A + AAAA record
    const addrs = [];
    try {
        addrs.push(...(await dns.resolve4(hostname)));
    } catch (_) { /* no A record, may be AAAA only; continue */ }
    try {
        addrs.push(...(await dns.resolve6(hostname)));
    } catch (_) { /* no AAAA record; continue */ }
    if (addrs.length === 0) return { ok: false, reason: 'dns resolve failed' };
    for (const a of addrs) {
        if (isPrivateIP(a)) return { ok: false, reason: `resolved to private ip ${a}` };
    }
    return { ok: true };
}

// S7 fix: block both IPv4 and IPv6 private/reserved ranges.
// IPv4: 10/8, 172.16-31, 192.168, 127/8, 169.254, 0/8, 100.64/10 (CGNAT), 224-255 (multicast/reserved).
// IPv6: ::1 (loopback), :: (unspecified), fc00::/7 (ULA private), fe80::/10 (link-local),
//       ::ffff:x.x.x.x (IPv4-mapped, must fall back to checking the embedded IPv4).
function isPrivateIP(ip) {
    if (net.isIPv6(ip)) {
        const h = ip.toLowerCase();
        if (h === '::1') return true; // loopback
        if (h === '::') return true; // unspecified
        if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA private fc00::/7
        if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) return true; // fe80::/10 link-local
        // IPv4-mapped IPv6: ::ffff:a.b.c.d → extract the embedded IPv4 and recheck
        const m = h.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
        if (m) return isPrivateIPv4(m[1]);
        return false;
    }
    return isPrivateIPv4(ip);
}

function isPrivateIPv4(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return true; // malformed: treat as private, reject
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true; // loopback
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local + cloud metadata
    if (parts[0] === 0) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // CGNAT 100.64/10
    if (parts[0] >= 224) return true; // multicast 224/4 + reserved 240/4
    return false;
}

function register(app) {
    const { db } = app;

    // ── List: never return secret (P2-18) ─────────────────────────────────────
    app.registerRoute('GET', '/api/webhooks', (req, res) => {
        const data = db
            ? db.prepare('SELECT id, name, url, events, enabled, created_at FROM webhooks ORDER BY created_at DESC').all()
            : [];
        list(res, data);
    });

    // ── Create (admin only, SSRF check) ───────────────────────────────────
    app.registerRoute('POST', '/api/webhooks', async (req, res) => {
        if (!requireAdmin(req, res)) return;
        const body = await parseBody(req);
        if (!body.url || typeof body.url !== 'string') return error(res, 'url required', 400);
        const check = await isSafeWebhookUrl(body.url);
        if (!check.ok) {
            console.warn(`  [Webhook] URL rejected (${check.reason}): ${body.url}`);
            return error(res, `url not allowed: ${check.reason}`, 403);
        }
        if (db) {
            db.prepare('INSERT INTO webhooks (id, name, url, events, enabled, secret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
                uid(), String(body.name || '').slice(0, 200), body.url,
                JSON.stringify(Array.isArray(body.events) ? body.events : []),
                body.enabled !== false, String(body.secret || '').slice(0, 512), now()
            );
        }
        console.log(`  [Webhook] Created webhook: ${body.url}`);
        json(res, { created: true }, 201);
    });

    // ── Trigger (admin only, errors logged, never silent) ────────────────────────────
    app.registerRoute('POST', '/api/webhooks/trigger', async (req, res) => {
        if (!requireAdmin(req, res)) return;
        const body = await parseBody(req);
        if (!body.event) return error(res, 'event required', 400);
        if (db) {
            const hooks = db.prepare('SELECT * FROM webhooks WHERE enabled = 1').all();
            for (const hook of hooks) {
                const events = JSON.parse(hook.events || '[]');
                if (events.length === 0 || events.includes(body.event)) {
                    // S7 fix: recheck URL before delivery (DNS-rebind TOCTOU: passes at creation, resolves to internal network at trigger time)
                    const recheck = await isSafeWebhookUrl(hook.url);
                    if (!recheck.ok) {
                        console.warn(`  [Webhook] Pre-delivery SSRF recheck rejected (${recheck.reason}): ${hook.url}`);
                        continue;
                    }
                    // E5 fix: fetch with timeout + abort so an unresponsive target can't leak a forever-hanging socket
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), 10000);
                    httpFetch(hook.url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': hook.secret || '' },
                        body: JSON.stringify({ event: body.event, data: body.data, timestamp: now() }),
                        signal: controller.signal,
                    }).then(r => {
                        clearTimeout(timer);
                        if (!r.ok) console.warn(`  [Webhook] Delivery non-2xx: ${hook.url} → ${r.status}`);
                    }).catch(e => {
                        clearTimeout(timer);
                        console.warn(`  [Webhook] Delivery failed ${hook.url}: ${e.message}`);
                    });
                }
            }
        }
        json(res, { triggered: true });
    });
}

module.exports = { register };
