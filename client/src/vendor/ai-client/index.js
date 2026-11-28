import { log, error as logError } from './log.js'
import { getSelectedModel, createModelPicker as rawModelPicker } from './model-picker.js'
import { shellModel, inShell } from './shell-model.js'
import { fetchModelPolicy, moduleFromPath } from './model-policy.js'

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}

// Dev servers proxy the gateway under the app origin; the gateway's CORS
// allowlist does not cover arbitrary localhost ports.
const DEV_PROXY = env.DEV ? '/__fusion_gateway' : null

const DEFAULTS = {
    baseUrl: env.VITE_FUSION_GATEWAY_URL || DEV_PROXY || 'http://127.0.0.1:11432',
    apiKey: env.VITE_FUSION_GATEWAY_KEY || '',
    defaultModel: env.VITE_FUSION_MODEL || 'mlx-community/Qwen3.8-27B-8bit',
    timeoutMs: 300000,
}

// Cap every user message before it leaves the browser so a paste-heavy
// session cannot blow the daily token budget in one call (cloud-try parity).
const MAX_INPUT_CHARS = Number(env.VITE_FUSION_MAX_INPUT_CHARS) || 4000

function capMessages(messages) {
    if (!Array.isArray(messages)) return messages
    let trimmed = false
    const out = messages.map((m) => {
        if (m && m.role === 'user' && typeof m.content === 'string' && m.content.length > MAX_INPUT_CHARS) {
            trimmed = true
            return { ...m, content: m.content.slice(-MAX_INPUT_CHARS) }
        }
        return m
    })
    if (trimmed) log('ai', `input capped to last ${MAX_INPUT_CHARS} chars per user message`)
    return out
}

// The fixed ports scripts/shell-serve.cjs uses for the five apps. Served
// there, AI calls go through its same-origin /__fusion_gateway relay, because
// the gateway's CORS allowlist does not cover these origins. Downstream
// packages hosting apps on other fixed ports extend the set through
// VITE_FUSION_SHELL_PORTS (comma-separated) instead of forking the module.
const OFFICE_PORTS = new Set([
    '11485', '11486', '11487', '11488', '11489',
    ...(env.VITE_FUSION_SHELL_PORTS || '').split(',').map((p) => p.trim()).filter(Boolean),
])

let config = { ...DEFAULTS }

function baseUrlFor(loc) {
    const where = loc === undefined ? (typeof window !== 'undefined' ? window.location : null) : loc
    try {
        if (where && OFFICE_PORTS.has(where.port)) return '/__fusion_gateway'
        // Served by the gateway under /shell/<id>/, the gateway itself is the
        // page origin: relative requests dodge any localhost-vs-127.0.0.1
        // origin mismatch and the CORS allowlist entirely.
        if (where && where.pathname.startsWith('/shell/')) return ''
    } catch (err) {
        // Odd location object: keep the configured base.
    }
    return config.baseUrl
}

export function configure(overrides) {
    config = { ...config, ...overrides }
    log('ai', 'configured', config.baseUrl, config.defaultModel || '(no default model)')
}

export function getConfig() {
    return { ...config }
}

export function isConfigured() {
    return !!config.apiKey || inShell()
}

// Issue #10: inside the union shell the apps are same-origin with the
// gateway, so AI calls go to the session-gated endpoints and authenticate
// with the HttpOnly shell-session cookie — no key in the bundle, per-user
// attribution, quota and model-policy enforced. Standalone/dev keeps the
// static-key /v1/* path.
function chatPath() {
    return inShell() ? '/api/v1/shell/chat/completions' : '/v1/chat/completions'
}

function modelsPath() {
    return inShell() ? '/api/v1/shell/models' : '/v1/models'
}

let warnedStaticKey = false
function warnStaticKey() {
    if (warnedStaticKey || inShell() || !config.apiKey) return
    warnedStaticKey = true
    logError('ai', 'using the static gateway key baked into this build; inside the union shell calls should ride the session-gated endpoints instead')
}

export function resetStaticKeyWarning() {
    warnedStaticKey = false
}

/* ---- The platform policy layer (issue #9) ---- */

// Inside the shell, the gateway resolves the four-layer chain for this
// module's shell session (module override > user preference > tenant
// default); standalone/dev has no shell session and skips the fetch entirely.
// Success caches for 5 minutes, a failure for 60, so a policy change applies
// within minutes without a rebuild and a down gateway adds no latency.
const POLICY_TTL_OK = 300000
const POLICY_TTL_FAIL = 60000
let policyCache = { at: 0, policy: null }

export function resetPolicyCache() {
    policyCache = { at: 0, policy: null }
}

async function policySnapshot() {
    if (!inShell()) return null
    const now = Date.now()
    if (policyCache.at && now - policyCache.at < (policyCache.policy ? POLICY_TTL_OK : POLICY_TTL_FAIL)) return policyCache.policy
    const fetched = await fetchModelPolicy({ baseUrl: baseUrlFor(), headers: headers(), moduleId: moduleFromPath(window.location.pathname) })
    // Fail-closed: inside the shell, a policy that cannot be read is treated
    // as an empty allowlist — no model is offered or sent, never the full
    // catalog. Standalone/dev (no shell session) has no policy plane at all.
    const policy = fetched || { allowlist: [], resolvedModel: '', source: 'unavailable' }
    policyCache = { at: now, policy }
    if (fetched) log('ai', 'model-policy', policy.source, policy.resolvedModel)
    else log('ai', 'model-policy unavailable, no model will be offered')
    return policy
}

// The full runtime chain: explicit call > per-app picker > shell preference >
// tenant-resolved policy model > build-time default. Every non-explicit
// candidate is clamped against the tenant policy allowlist (issue #14): a
// stored choice or build default from before the policy landed must not
// reach the gateway and 403 on every message — it falls through to the
// policy-resolved model instead. An explicit opts.model stays untouched: it
// is the agent cores' deliberate tool-choice, and the gateway remains the
// enforcement point. Fail-closed: in the shell, a tenant without a non-empty
// allowlist resolves to no model at all.
async function resolvedModel(opts) {
    const policy = await policySnapshot()
    if (opts.model) return opts.model
    if (policy && !(policy.allowlist && policy.allowlist.length)) return ''
    const allowed = policy ? new Set(policy.allowlist.map((id) => id.toLowerCase())) : null
    const inAllowlist = (id) => !allowed || allowed.has(String(id).toLowerCase())
    const stored = getSelectedModel() || shellModel()
    if (stored && inAllowlist(stored)) return stored
    if (policy && policy.resolvedModel) return policy.resolvedModel
    if (config.defaultModel && inAllowlist(config.defaultModel)) return config.defaultModel
    if (allowed) return policy.allowlist[0]
    return stored || config.defaultModel
}

export { getSelectedModel, setSelectedModel } from './model-picker.js'
export { inShell, shellModel } from './shell-model.js'
export { baseUrlFor }

export function createModelPicker(options) {
    return rawModelPicker(options, { isConfigured, listModels, getConfig, logError, fetchPolicy: () => policySnapshot() })
}

// Issue #28: a request with no model is a policy or build gap, not something the
// gateway can answer — sending model: "" only produces a rejection the panel
// cannot explain. Fail here, in words a customer can act on, instead.
async function modelFor(opts) {
    const model = await resolvedModel(opts)
    if (!model) throw new Error('No AI model is available for this app. Ask your administrator to allow a model for it in the AI settings.')
    return model
}

function headers() {
    const h = { 'Content-Type': 'application/json' }
    // Shell-session routes authenticate by the HttpOnly cookie; a Bearer
    // header here would carry the static key and make withShellSession try
    // to validate it as a session token.
    if (config.apiKey && !inShell()) h.Authorization = 'Bearer ' + config.apiKey
    return h
}

// Issue #38: an agent turn carries one rollout id on every chat request it
// makes, so the gateway's rollout tap can correlate its records with the
// outcomes the app reports to office-api for the same turn. Unknown headers
// are ignored until the gateway adopts the id (tracked upstream).
function rolloutHeaders(rolloutId) {
    return rolloutId ? { 'X-Fusion-Rollout-Id': String(rolloutId) } : {}
}

function fetchOpts(init) {
    const opts = { ...init, headers: { ...headers(), ...(init.headers || {}) } }
    if (inShell()) opts.credentials = 'include'
    return opts
}

async function request(path, init, timeoutMs) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs || config.timeoutMs)
    try {
        const res = await fetch(baseUrlFor() + path, { ...fetchOpts(init), signal: controller.signal })

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            throw new Error('gateway ' + res.status + ': ' + body.slice(0, 500))
        }
        return res
    } finally {
        clearTimeout(timer)
    }
}

export async function chat(opts) {
    const body = {
        model: await modelFor(opts),
        messages: capMessages(opts.messages),
        stream: false,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
    }
    warnStaticKey()
    const t0 = Date.now()
    const res = await request(chatPath(), { method: 'POST', body: JSON.stringify(body), headers: rolloutHeaders(opts.rolloutId) }, opts.timeoutMs)
    const data = await res.json()
    const text = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : ''
    log('ai', 'chat ok', (Date.now() - t0) + 'ms', text.length + ' chars')
    return text
}

const NEWLINE = String.fromCharCode(10)

export async function chatStream(opts, onDelta) {
    const body = {
        model: await modelFor(opts),
        messages: capMessages(opts.messages),
        stream: true,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
    }
    warnStaticKey()
    const res = await fetch(baseUrlFor() + chatPath(), fetchOpts({
        method: 'POST',
        body: JSON.stringify(body),
        headers: rolloutHeaders(opts.rolloutId),
    }))
    if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error('gateway ' + res.status + ': ' + text.slice(0, 500))
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''
    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(NEWLINE)
        buffer = lines.pop()
        for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const payload = trimmed.slice(5).trim()
            if (payload === '[DONE]') continue
            let chunk = null
            try {
                chunk = JSON.parse(payload)
            } catch (err) {
                logError('ai', 'bad SSE chunk skipped', payload.slice(0, 120))
                continue
            }
            const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta ? chunk.choices[0].delta.content : ''
            if (delta) {
                full += delta
                if (onDelta) onDelta(delta, full)
            }
        }
    }
    log('ai', 'chatStream done', full.length + ' chars')
    return full
}

/** One non-streaming chat, yielded in the same event shape as the stream:
 *  text first, then the message's tool calls. The empty-stream fallback uses
 *  it, and it is the shape every event consumer already understands. */
async function* nonStreamEvents(body) {
    warnStaticKey()
    const res = await fetch(baseUrlFor() + chatPath(), fetchOpts({
        method: 'POST',
        body: JSON.stringify({ ...body, stream: false }),
    }))
    if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error('gateway ' + res.status + ': ' + text.slice(0, 500))
    }
    const data = await res.json()
    const message = (data.choices && data.choices[0] && data.choices[0].message) || {}
    if (message.content) yield { type: 'text', text: message.content }
    for (const call of message.tool_calls || []) {
        let input = {}
        const raw = call.function && call.function.arguments
        if (raw) {
            try {
                input = JSON.parse(raw)
            } catch (err) {
                input = { __unreadable: raw }
            }
        }
        yield { type: 'tool', id: call.id, name: (call.function && call.function.name) || '', input }
    }
}

export async function* chatStreamEvents(opts) {
    const body = {
        model: await modelFor(opts),
        messages: capMessages(opts.messages),
        stream: true,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
    }
    if (opts.tools && opts.tools.length) {
        body.tools = opts.tools
        body.tool_choice = opts.toolChoice || 'auto'
    }
    const controller = new AbortController()
    // An idle timeout, not a total one: a slow local model may legitimately
    // stream a large tool call for many minutes, so every chunk rearms the
    // timer and only true silence aborts the request.
    const idleMs = opts.timeoutMs || config.timeoutMs
    let timer = setTimeout(abortIdle, idleMs)
    function abortIdle() {
        controller.abort()
    }
    function rearmIdle() {
        clearTimeout(timer)
        timer = setTimeout(abortIdle, idleMs)
    }
    let full = ''
    let toolCount = 0
    let completionTokens = 0
    try {
        warnStaticKey()
        const res = await fetch(baseUrlFor() + chatPath(), {
            ...fetchOpts({
                method: 'POST',
                body: JSON.stringify(body),
                headers: rolloutHeaders(opts.rolloutId),
            }),
            signal: controller.signal,
        })
        if (!res.ok) {
            const text = await res.text().catch(() => '')
            throw new Error('gateway ' + res.status + ': ' + text.slice(0, 500))
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        const calls = new Map()
        let buffer = ''
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split(NEWLINE)
            buffer = lines.pop()
            for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed.startsWith('data:')) continue
                const payload = trimmed.slice(5).trim()
                if (payload === '[DONE]') continue
                let chunk = null
                try {
                    chunk = JSON.parse(payload)
                } catch (err) {
                    logError('ai', 'bad SSE chunk skipped', payload.slice(0, 120))
                    continue
                }
                // Only a real event proves the model is alive. Keepalive comments and
                // whitespace keep the connection open without producing anything, so
                // they must not rearm the idle timer or a hung stream never aborts (#26).
                rearmIdle()
                const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta
                if (chunk.usage && typeof chunk.usage.completion_tokens === 'number') completionTokens = chunk.usage.completion_tokens
                if (!delta) continue
                if (delta.content) {
                    full += delta.content
                    yield { type: 'text', text: delta.content }
                }
                for (const call of delta.tool_calls || []) {
                    const index = call.index === undefined ? calls.size : call.index
                    const current = calls.get(index) || { id: '', name: '', arguments: '' }
                    if (call.id) current.id = call.id
                    if (call.function && call.function.name) current.name = call.function.name
                    if (call.function && call.function.arguments) current.arguments += call.function.arguments
                    calls.set(index, current)
                }
            }
        }
        // Some Anthropic-protocol relays drop tool-call deltas on the stream
        // (they forward text_delta but not content_block_start tool_use or
        // input_json_delta), so the reply arrives as a short preface — or
        // nothing at all — and the tools never fire. When tools were sent
        // and the stream produced none, though the model spent tokens, the
        // same request without streaming returns the tool calls: ask once
        // more, non-streaming, and keep the stream's text when the retry
        // shows the model really did answer in prose.
        if (opts.tools && opts.tools.length && calls.size === 0 && completionTokens > 0 && full.length < 400) {
            let sawTool = false
            for await (const part of nonStreamEvents(body)) {
                if (part.type === 'tool') {
                    sawTool = true
                    toolCount++
                    yield part
                } else if (part.type === 'text' && !full) {
                    full += part.text
                    yield part
                }
            }
            if (sawTool || !full) {
                log('ai', 'chatStreamEvents recovered from a dropped tool call', toolCount + ' tools')
                return
            }
            log('ai', 'chatStreamEvents stream ended in prose; keeping it')
        }
        for (const call of calls.values()) {
            let input = {}
            if (call.arguments.trim()) {
                try {
                    input = JSON.parse(call.arguments)
                } catch (err) {
                    input = { __unreadable: call.arguments }
                }
            }
            toolCount++
            yield { type: 'tool', id: call.id, name: call.name, input }
        }
        log('ai', 'chatStreamEvents done', full.length + ' chars', toolCount + ' tools')
    } catch (err) {
        if (err && (err.name === 'AbortError' || /aborted/i.test(String(err?.message)))) {
            logError('ai', 'chatStreamEvents aborted by idle timeout')
            throw new Error('The model stopped replying mid-answer, so the request was aborted. Try again; if it keeps happening, ask for smaller steps or pick a faster model.')
        }
        throw err
    } finally {
        clearTimeout(timer)
    }
}

export function extractJson(text) {
    if (!text) return null
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    const candidate = fenced ? fenced[1] : text
    const start = candidate.search(/[[{]/)
    if (start === -1) return null
    const opener = candidate[start]
    const closer = opener === '{' ? '}' : ']'
    const end = candidate.lastIndexOf(closer)
    if (end <= start) return null
    const slice = candidate.slice(start, end + 1)
    try {
        return JSON.parse(slice)
    } catch (err) {
        logError('ai', 'json extract failed', String(err).slice(0, 120))
        return null
    }
}

export async function jsonChat(opts, retries) {
    const attempts = retries === undefined ? 2 : retries
    let lastRaw = ''
    for (let i = 0; i <= attempts; i++) {
        const raw = await chat({ ...opts, messages: opts.messages })
        lastRaw = raw
        const parsed = extractJson(raw)
        if (parsed !== null) return parsed
        log('ai', 'jsonChat retry', String(i + 1))
    }
    logError('ai', 'jsonChat failed after retries')
    throw new Error('jsonChat: no parseable JSON in model output: ' + lastRaw.slice(0, 200))
}

export async function listModels() {
    warnStaticKey()
    const res = await request(modelsPath(), { method: 'GET' })
    const data = await res.json()
    const models = (data.data || []).map((m) => ({ id: m.id, loaded: !!m.loaded }))
    log('ai', 'listModels ok', models.length + ' models')
    return models
}

export { createAgent, requestMessages, userContent, userText } from './agent.js'
export { argSignature, planSignature, sampleToolPlan, consistencyVerdict } from './consistency.js'
export { parseMarkdownTable, parseMarkdownTableParts } from './markdown-table.js'
export { createOutcomeReporter, newRolloutId, outcomeScore, OUTCOME_SIGNALS } from './outcomes.js'

export async function ensureModelLoaded(modelId) {
    const models = await listModels()
    const found = models.find((m) => m.id === modelId)
    if (!found) throw new Error('model not found on gateway: ' + modelId)
    if (found.loaded) return true
    if (inShell() && !config.apiKey) {
        throw new Error('model ' + modelId + ' is not loaded; inside the union shell ask the gateway administrator to load it (the session-gated surface has no model-load endpoint)')
    }
    log('ai', 'loading model', modelId)
    await request('/v1/models/' + encodeURIComponent(modelId) + '/load', { method: 'POST' }, 600000)
    return true
}
