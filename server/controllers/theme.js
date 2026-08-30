// =============================================================================
// Fusion-Doc — 主题控制器（BookStack 主题管理）
// 商用级: 白名单键 + 校验, 防 mass assignment 与磁盘耗尽
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { json, error } = require('../utils/response');

const DEFAULT_THEME = { primary: '#6366f1', secondary: '#06b6d4', background: '#0f172a', surface: '#1e293b', text: '#f1f5f9', mode: 'dark' };

// 允许的主题键及其校验
const THEME_KEYS = {
    primary: { type: 'hex' },
    secondary: { type: 'hex' },
    background: { type: 'hex' },
    surface: { type: 'hex' },
    text: { type: 'hex' },
    mode: { type: 'enum', values: ['light', 'dark'] },
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function validateTheme(body) {
    const out = {};
    if (!body || typeof body !== 'object') return { ok: false, reason: 'invalid body' };
    for (const [key, rule] of Object.entries(THEME_KEYS)) {
        if (!(key in body)) continue;
        const val = body[key];
        if (typeof val !== 'string') return { ok: false, reason: `${key} must be string` };
        if (rule.type === 'hex' && !HEX_RE.test(val)) return { ok: false, reason: `${key} invalid hex` };
        if (rule.type === 'enum' && !rule.values.includes(val)) return { ok: false, reason: `${key} invalid value` };
        out[key] = val;
    }
    if (Object.keys(out).length === 0) return { ok: false, reason: 'no valid keys' };
    return { ok: true, value: out };
}

function register(app) {
    const { db } = app;

    // ── 读取主题 (公开, 仅返回白名单键) ────────────────────────────────
    app.registerRoute('GET', '/api/theme', (req, res) => {
        let theme = { ...DEFAULT_THEME };
        if (db) {
            const row = db.prepare("SELECT value FROM settings WHERE key = 'theme'").get();
            if (row) {
                try {
                    const stored = JSON.parse(row.value);
                    // 仅透传白名单键, 防历史脏数据泄漏
                    for (const k of Object.keys(THEME_KEYS)) {
                        if (k in stored) theme[k] = stored[k];
                    }
                } catch (_) { /* 坏数据用默认 */ }
            }
        }
        json(res, theme);
    });

    // ── 保存主题 (须认证, 白名单校验) ──────────────────────────────────
    app.registerRoute('POST', '/api/theme', async (req, res) => {
        const body = await parseBody(req);
        const check = validateTheme(body);
        if (!check.ok) return error(res, `invalid theme: ${check.reason}`, 400);
        if (db) {
            // 合并已有主题, 部分更新
            const existing = db.prepare("SELECT value FROM settings WHERE key = 'theme'").get();
            let merged = { ...DEFAULT_THEME };
            if (existing) {
                try { merged = { ...DEFAULT_THEME, ...JSON.parse(existing.value) }; } catch (_) { /* 用默认 */ }
            }
            Object.assign(merged, check.value);
            db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('theme', ?)").run(JSON.stringify(merged));
        }
        console.log(`  [Theme] 主题已更新 by ${req.user?.id || 'anon'}: ${Object.keys(check.value).join(',')}`);
        json(res, { saved: true });
    });
}

module.exports = { register };
