// The model the person picked for this app, kept across sessions. Empty means
// "follow the shell preference, or the default". Each app is its own origin
// (its own dev port or shell path), so the choice is per app, which is what a
// person expects.

import { shellModel } from './shell-model.js'
import { applyPolicyToModels } from './model-policy.js'

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}

const STORAGE_KEY = 'fusion-office.ai-model'

// Issue #29: a customer-facing build shows no model picker at all — model
// choice is an administrator concern. The resolution chain (picker, shell
// preference, policy, build default) is untouched; only the dropdown dies.
export function customerMode() {
    return env.VITE_FUSION_CUSTOMER_MODE === '1' || env.VITE_FUSION_CUSTOMER_MODE === 'true'
}

export function getSelectedModel() {
    try {
        return localStorage.getItem(STORAGE_KEY) || ''
    } catch (err) {
        return ''
    }
}

export function setSelectedModel(id) {
    try {
        if (id) localStorage.setItem(STORAGE_KEY, id)
        else localStorage.removeItem(STORAGE_KEY)
    } catch (err) {
        // A blocked localStorage just means the choice does not survive a reload.
    }
}

function options(models, selected, fallback) {
    const ids = new Set(models.map(m => m.id))
    const list = [...models]
    if (selected && !ids.has(selected)) list.unshift({ id: selected, loaded: false })
    if (fallback && !list.some(m => m.id === fallback)) list.unshift({ id: fallback, loaded: false })
    return list
}

function fill(select, models, fallback, policy) {
    // The policy allowlist (and privacy_mode local_only) constrains what the
    // picker offers; with no stored choice the shell preference wins, then
    // the policy-resolved model, then a loaded model. A restrictive
    // allowlist (issue #11) also drops the build-time fallback and any
    // stored choice outside the list — the gateway rejects those anyway.
    const allowed = applyPolicyToModels(models, policy)
    const loaded = allowed.find(m => m.loaded)
    const restrictive = !!(policy && policy.allowlist && policy.allowlist.length)
    // Fail-closed: a policy without an allowlist offers nothing at all —
    // never fall back to the stored choice or the build-time default.
    if (policy && !restrictive) {
        select.replaceChildren()
        select.value = ''
        select.title = 'No model policy configured'
        select.hidden = true
        return
    }
    let selected = getSelectedModel() || shellModel() || (policy && policy.resolvedModel) || loaded?.id || fallback
    if (restrictive && !allowed.some(m => m.id === selected)) selected = (policy && policy.resolvedModel) || loaded?.id || allowed[0]?.id || ''
    const list = options(allowed, selected, restrictive ? '' : fallback)
    const sorted = [...list].sort((a, b) => (b.loaded ? 1 : 0) - (a.loaded ? 1 : 0) || a.id.localeCompare(b.id))
    select.replaceChildren(...sorted.map(m => {
        const option = document.createElement('option')
        option.value = m.id
        option.textContent = m.id + (m.loaded ? ' ✓' : '')
        return option
    }))
    select.value = selected
    select.title = selected
    // Issue #11: with exactly one selectable model (a single-entry policy
    // allowlist) the dropdown carries no choice, so hide it — the value the
    // calls will use is still readable through the option.
    select.hidden = sorted.length <= 1
}

/**
 * A small select that lists the gateway's models and remembers the choice.
 * Returns null when AI is not configured, so callers can skip it entirely.
 */
export function createModelPicker({ onChange } = {}, deps = {}) {
    const { isConfigured, listModels, getConfig, logError, fetchPolicy } = deps
    if (!isConfigured || !isConfigured()) return null
    if (customerMode()) return null
    const select = document.createElement('select')
    select.className = 'ai-model-picker'
    select.setAttribute('aria-label', 'AI model')
    select.style.maxWidth = '150px'
    select.style.fontSize = '12px'
    select.style.textOverflow = 'ellipsis'
    fill(select, [], getConfig().defaultModel)
    Promise.all([listModels(), fetchPolicy ? fetchPolicy() : Promise.resolve(null)])
        .then(([models, policy]) => fill(select, models, getConfig().defaultModel, policy))
        .catch(err => logError?.('ai', 'model list unavailable', String(err).slice(0, 120)))
    select.addEventListener('change', () => {
        setSelectedModel(select.value)
        select.title = select.value
        onChange?.(select.value)
    })
    return select
}
