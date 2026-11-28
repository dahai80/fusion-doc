// Issue #57: execution-consistency selection for high-stakes write steps
// (SheetAlign, arXiv 2611.26069). Zero-training: re-sample the write-class
// round k extra times at temperature > 0 and compare the proposed tool plans.
// Full execution-consistency would run each candidate in a workspace sandbox
// and grade the results; no sandbox exists yet, so this is plan-level
// consistency: agreement across samples is recorded, disagreement is logged
// and reported into the tap jsonl, and the greedy plan still executes.

// Issue #61: small models drift benignly between 42 and "42" and between
// "=A1*2" and "A1*2"; the plans are the same write. Canonicalize scalar
// strings before signing so type drift and formula-prefix omission do not
// count as disagreement — plain text is untouched.
const NUMERIC = /^-?\d+(?:\.\d+)?$/;

const canonicalScalar = (value) => {
    if (typeof value !== 'string') return value;
    let text = value.trim();
    while (text.startsWith('=')) text = text.slice(1).trim();
    return NUMERIC.test(text) ? Number(text) : text;
};

const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
        return Object.keys(value).sort().map(key => [key, stable(value[key])]);
    }
    return canonicalScalar(value);
};

/** A key-order-insensitive signature of one tool call's arguments. */
export function argSignature(args) {
    return JSON.stringify(stable(args ?? {}));
}

/** A key-order- and order-insensitive signature of a whole tool plan. */
export function planSignature(calls) {
    return JSON.stringify((calls || []).map(call => [call.name, argSignature(call.input)]).sort());
}

/**
 * One extra sample of the current round: drain the chat stream and keep only
 * the proposed tool calls. Best-effort — a failed or stopped sample simply
 * does not count as a candidate. `stopped` is a promise resolving to true
 * when the user stops the assistant mid-sample.
 */
export async function sampleToolPlan(chat, messages, options, stopped) {
    const calls = [];
    try {
        const iter = chat(messages, options)[Symbol.asyncIterator]();
        for (;;) {
            const next = await Promise.race([iter.next(), stopped]);
            if (next === true) {
                Promise.resolve(iter.return?.()).catch(() => {});
                return { stopped: true, calls: null };
            }
            if (next.done) break;
            const part = next.value;
            if (part?.type === 'tool') {
                calls.push({ id: '', name: String(part.name || ''), input: part.input && typeof part.input === 'object' ? part.input : {} });
            }
        }
    } catch {
        return { stopped: false, calls: null };
    }
    return { stopped: false, calls };
}

/**
 * Compare the greedy plan against the extra samples. With no valid extra
 * sample there is no verdict — the turn reports nothing.
 */
export function consistencyVerdict(greedyCalls, samples) {
    const valid = samples.filter(sample => sample && sample.calls);
    if (!valid.length) return null;
    const base = planSignature(greedyCalls);
    const agreeing = valid.filter(sample => planSignature(sample.calls) === base).length;
    return {
        samples: valid.length,
        agreement: agreeing === valid.length,
        agreeCount: agreeing,
    };
}
