// Outcome signals for the rollout-tap training data plane (issue #33). Every
// confirmed or failed agent action is reported as one rollout-tap schema v1
// record; office-api appends it to the sink file fusion-trainer's
// rollout_ingest reads. Signals and their default rewards match
// fusion-trainer's SIGNAL_SCORES exactly. Reporting is fire-and-forget: a
// failed emit is a log line, never an error the user sees.

export const OUTCOME_SIGNALS = Object.freeze({
    task_success: 1.0,
    user_accepted: 1.0,
    user_edited: 0.5,
    user_rejected: 0.0,
    error: 0.0,
});

export function outcomeScore(signal) {
    return Object.prototype.hasOwnProperty.call(OUTCOME_SIGNALS, signal) ? OUTCOME_SIGNALS[signal] : null;
}

/** "ro-<16 hex>" as the gateway mints them; a time fallback keeps ids unique enough. */
export function newRolloutId() {
    const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
    return `ro-${hex()}${hex()}${hex()}${hex()}`;
}

const REDACT_MAX_MESSAGES = 40;
const RAW_MAX_MESSAGES = 200;
const RAW_MAX_CONTENT = 8000;

function redactContent(content) {
    return `[redacted:${String(content ?? '').length}]`;
}

function rawContent(content) {
    const text = String(content ?? '');
    return text.length > RAW_MAX_CONTENT ? `${text.slice(0, RAW_MAX_CONTENT)}…` : text;
}

/** Task id for outcome records (#59): explicit option first, then the
 * `?task=` query param a task runner appends when driving a defined run. */
function resolveTaskId(explicit) {
    if (explicit != null && String(explicit).trim()) return String(explicit).trim();
    try {
        const fromQuery = new URLSearchParams(globalThis.location?.search ?? '').get('task');
        if (fromQuery && fromQuery.trim()) return fromQuery.trim();
    } catch { /* non-browser context: no task tag */ }
    return null;
}

/**
 * One reporter per app. contentMode defaults to the gateway tap's "redact":
 * message content is dropped, the length survives. "raw" keeps verbatim
 * content (capped) for SFT/GRPO quality — opt in per build.
 */
export function createOutcomeReporter({ app, taskId, endpoint = 'http://127.0.0.1:11492/v1/outcomes', fetchImpl = globalThis.fetch?.bind(globalThis), contentMode = 'redact' } = {}) {
    const reported = new Set(); // rollout ids already emitted — a second report for one is dropped
    let warned = 0;
    const defaultTaskId = resolveTaskId(taskId);

    function buildRecord({ signal, detail, model, messages = [], rolloutId, taskId: reportTaskId }) {
        const maxMessages = contentMode === 'raw' ? RAW_MAX_MESSAGES : REDACT_MAX_MESSAGES;
        const shape = contentMode === 'raw' ? rawContent : redactContent;
        const outcome = { signal, score: outcomeScore(signal), ...(detail ? { detail: String(detail).slice(0, 500) } : {}) };
        const taskTag = resolveTaskId(reportTaskId) || defaultTaskId;
        if (taskTag) outcome.task_id = taskTag;
        const record = {
            schema_version: 1,
            rollout_id: rolloutId || newRolloutId(),
            source: `fusion-office/${app || 'unknown'}`,
            created_at: new Date().toISOString(),
            messages: messages.slice(-maxMessages).map(m => ({ role: String(m.role || 'user'), content: shape(m.content) })),
            outcome,
        };
        if (model) record.model = model;
        return record;
    }

    /**
     * Emit one outcome. Idempotent per rolloutId, never throws, never blocks:
     * the caller awaits nothing and a failed POST only logs.
     */
    function report({ signal, detail, model, messages = [], rolloutId, taskId } = {}) {
        if (!Object.prototype.hasOwnProperty.call(OUTCOME_SIGNALS, signal)) {
            console.warn(`[ai-client] dropped unknown outcome signal "${signal}"`);
            return;
        }
        if (rolloutId && reported.has(rolloutId)) return;
        if (rolloutId) reported.add(rolloutId);
        if (reported.size > 500) {
            for (const id of reported) { reported.delete(id); if (reported.size <= 250) break; }
        }
        if (!fetchImpl) return;
        const record = buildRecord({ signal, detail, model, messages, rolloutId, taskId });
        try {
            Promise.resolve(fetchImpl(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(record),
                keepalive: true,
            })).catch((err) => {
                // One warning per streak, not per dropped record: an offline
                // session must not flood the console.
                warned += 1;
                if (warned === 1 || warned % 50 === 0) {
                    console.warn(`[ai-client] outcome report dropped (${warned} total): ${err?.message || err}`);
                }
            });
        } catch (err) {
            console.warn(`[ai-client] outcome report dropped: ${err?.message || err}`);
        }
    }

    return { report, buildRecord, OUTCOME_SIGNALS };
}
