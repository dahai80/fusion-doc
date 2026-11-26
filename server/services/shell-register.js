// =============================================================================
// Fusion-Doc — Union Web shell registration orchestration (issue #51, PRD R-6)
// On startup reads client/manifest.json → overrides version (package.json is authoritative) +
// upstream + api_key → POSTs to fusion-gateway; then sends heartbeats at an interval.
// Design constraint: fire-and-forget throughout — an unreachable gateway only warns, never blocks fusion-doc startup.
// =============================================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const gateway = require('../integrations/fusion-gateway');
const { version: APP_VERSION } = require('../../package.json');

const MANIFEST_PATH = path.join(__dirname, '..', '..', 'client', 'manifest.json');
const SERVICE_KEY_FILE = path.join(__dirname, '..', '..', 'data', 'shell-api-key.json');

// ── Service key: env first; if missing, auto-generate and persist (0600, gitignored data/) ──
// Written back to config.shellGateway.apiKey — that is what the auth middleware's shell service key branch reads.
function loadServiceKey(config) {
    if (config?.shellGateway?.apiKey) return config.shellGateway.apiKey;
    let key = '';
    try {
        const raw = fs.readFileSync(SERVICE_KEY_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed?.key) key = parsed.key;
    } catch (_) { /* first-generation path */ }
    if (!key) {
        key = 'fdshell-' + crypto.randomBytes(24).toString('hex');
        try {
            fs.mkdirSync(path.dirname(SERVICE_KEY_FILE), { recursive: true });
            fs.writeFileSync(SERVICE_KEY_FILE, JSON.stringify({ key, createdAt: new Date().toISOString() }, null, 4), { mode: 0o600 });
            console.log('  [Shell] FUSION_DOC_SHELL_API_KEY not set; auto-generated and persisted to data/shell-api-key.json');
        } catch (e) {
            console.error(`  [✗] Failed to persist Shell service key: ${e.message}`);
        }
    }
    if (config?.shellGateway) config.shellGateway.apiKey = key;
    return key;
}

// ── Registration body: manifest.json + version override + upstream + api_key ────────────
function buildRegistrationBody(config, serviceKey) {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const port = config?.port || 11449;
    const body = {
        ...manifest,
        version: APP_VERSION,
        upstream: `http://127.0.0.1:${port}`,
        api_key: serviceKey,
    };
    return body;
}

// ── Single registration + heartbeat loop ───────────────────────────────────────────────────
async function registerOnce(config, serviceKey) {
    const body = buildRegistrationBody(config, serviceKey);
    const resp = await gateway.registerManifest({ config: config.shellGateway, manifest: body });
    if (resp?.code && resp.code !== 'ok') {
        throw new Error(`gateway rejected registration: ${resp.code} ${resp.message || ''}`);
    }
    console.log(`  [✓] Shell manifest registered: id=${body.id} entry=${body.entry} v${body.version}`);
    return body;
}

async function heartbeatOnce(config, moduleId) {
    const resp = await gateway.sendHeartbeat({ config: config.shellGateway, moduleId });
    if (resp?.code && resp.code !== 'ok') {
        throw new Error(`gateway rejected heartbeat: ${resp.code} ${resp.message || ''}`);
    }
}

// Entry point: called at startup, never throws (everything caught internally)
async function startShellRegistration(config) {
    const sg = config?.shellGateway;
    if (!sg?.adminKey) {
        console.warn('  [⚠] FUSION_ADMIN_KEY not set: skipping Union Web shell registration (standalone operation unaffected)');
        return;
    }
    // The service key must be written back to config first regardless of registration outcome (auth middleware shell branch depends on it)
    const serviceKey = loadServiceKey(config);
    const interval = Math.max(5000, sg.heartbeatInterval || 30000);
    let registered = false;

    // Registration failure does not block: if the gateway starts later, the heartbeat loop re-registers as a fallback (gateway upserts idempotently by id)
    const tryRegister = async () => {
        try {
            await registerOnce(config, serviceKey);
            registered = true;
        } catch (e) {
            console.warn(`  [⚠] Shell registration failed (will retry on the next heartbeat cycle): ${e.message}`);
        }
    };
    await tryRegister();

    const timer = setInterval(async () => {
        if (!registered) {
            await tryRegister();
            return;
        }
        try {
            await heartbeatOnce(config, 'fusion-doc');
        } catch (e) {
            console.warn(`  [⚠] Shell heartbeat failed: ${e.message}`);
            registered = false;
        }
    }, interval);
    timer.unref();
    console.log(`  [i] Shell heartbeat started: ${interval}ms`);
}

module.exports = {
    MANIFEST_PATH,
    SERVICE_KEY_FILE,
    loadServiceKey,
    buildRegistrationBody,
    registerOnce,
    heartbeatOnce,
    startShellRegistration,
};
