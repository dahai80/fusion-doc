// The platform model-policy chain (issue #9; gateway #486/#487). Inside the
// union shell the module asks the gateway, same-origin under its shell
// session, for the policy-resolved model (module override > user preference >
// tenant default), the effective allowlist, and the privacy mode. Per the
// #491 contract this is best-effort: unreachable, 401 or 404 means the
// build-time default applies, exactly as before this layer existed.

const SHELL_PATH = /^\/shell\/([^/]+)/

// The module id the shell knows this app by, from the /shell/<id>/ pathname.
// Empty outside the shell — standalone builds have no policy to consult.
export function moduleFromPath(pathname) {
    const match = String(pathname || '').match(SHELL_PATH)
    return match ? decodeURIComponent(match[1]) : ''
}

export function parseModelPolicy(data) {
    if (!data || typeof data !== 'object') return null
    const out = {
        resolvedModel: typeof data.resolved_model === 'string' ? data.resolved_model : '',
        source: typeof data.source === 'string' ? data.source : '',
        privacyMode: typeof data.privacy_mode === 'string' ? data.privacy_mode : '',
        privacyFiltered: !!data.privacy_filtered,
        allowlist: Array.isArray(data.allowlist) ? data.allowlist.filter((id) => typeof id === 'string') : null,
    }
    if (!out.resolvedModel && !out.allowlist) return null
    return out
}

// Keeps the models the picker may offer. A set allowlist filters the list;
// privacy_mode local_only with no allowlist hides everything that is not
// visibly local (loaded now, or in the local mlx namespace). For local_only
// narrowing an empty result keeps the unfiltered list — a picker with no
// options helps nobody, and the gateway still enforces the policy at
// inference time. An explicit allowlist never falls back (issue #13): the
// catalog may not even contain the allowlisted local model, and resetting to
// the full catalog is exactly what issue #11 forbids; missing allowlist
// entries are surfaced as unloaded options instead.
export function applyPolicyToModels(models, policy) {
    if (!Array.isArray(models)) return models
    // No policy object at all means no policy plane (standalone/dev) — the
    // catalog passes through. A policy that is present but carries no
    // allowlist is fail-closed: nothing is offered.
    if (!policy) return models
    if (!(policy.allowlist && policy.allowlist.length)) return []
    if (policy.allowlist.length) {
        const allowed = new Set(policy.allowlist)
        const hit = models.filter((m) => allowed.has(m.id))
        const present = new Set(hit.map((m) => m.id))
        const missing = policy.allowlist.filter((id) => !present.has(id)).map((id) => ({ id, loaded: false }))
        return [...hit, ...missing]
    }
    if (!Array.isArray(models) || !models.length) return models
    let list = models
    if (policy.privacyMode === 'local_only') {
        const local = list.filter((m) => m.loaded || m.id.startsWith('mlx-community/'))
        if (local.length) list = local
    }
    return list.length ? list : models
}

export async function fetchModelPolicy({ baseUrl, headers, moduleId, timeoutMs = 3000, fetchImpl = fetch } = {}) {
    const query = moduleId ? '?module=' + encodeURIComponent(moduleId) : ''
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const res = await fetchImpl(baseUrl + '/api/v1/shell/model-policy' + query, { headers, signal: controller.signal })
        if (!res.ok) return null
        return parseModelPolicy(await res.json())
    } catch (err) {
        return null
    } finally {
        clearTimeout(timer)
    }
}
