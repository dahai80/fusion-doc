// =============================================================================
// Fusion-Doc — YAML workflow engine
// parseYAML → validateWorkflow → executeWorkflow → executeStep
// =============================================================================

const { uid } = require('../utils/helpers');

const STEP_TYPES = new Set([
    'ai.generate',
    'ai.translate',
    'ai.summarize',
    'officecli.import',
    'officecli.merge',
    'officecli.export',
    'page.create',
    'page.update',
    'page.search',
    'rag.query',
    'transform',
    'condition',
]);

function parseYAML(yamlStr) {
    if (!yamlStr || typeof yamlStr !== 'string') {
        throw new Error('YAML definition is required');
    }

    const lines = yamlStr.split('\n');
    const def = { name: '', description: '', steps: [] };
    let currentStep = null;
    let currentKey = null;
    let inSteps = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trimStart();
        const indent = line.length - trimmed.length;

        if (!trimmed || trimmed.startsWith('#')) continue;

        if (indent === 0) {
            inSteps = false;
            if (trimmed.startsWith('name:')) {
                def.name = trimmed.split(':').slice(1).join(':').trim();
            } else if (trimmed.startsWith('description:')) {
                def.description = trimmed.split(':').slice(1).join(':').trim();
            } else if (trimmed === 'steps:') {
                inSteps = true;
            }
            continue;
        }

        if (inSteps) {
            if (indent <= 2 && trimmed.startsWith('- ')) {
                const stepLine = trimmed.slice(2);
                if (stepLine.includes(':')) {
                    const [k, ...v] = stepLine.split(':');
                    currentStep = { id: `step_${def.steps.length}`, [k.trim()]: v.join(':').trim() };
                } else {
                    currentStep = { id: `step_${def.steps.length}`, name: stepLine };
                }
                def.steps.push(currentStep);
                currentKey = null;
                continue;
            }

            if (currentStep && indent >= 4) {
                const colonIdx = trimmed.indexOf(':');
                if (colonIdx > 0) {
                    const k = trimmed.slice(0, colonIdx).trim();
                    const v = trimmed.slice(colonIdx + 1).trim();
                    currentStep[k] = v;
                    currentKey = k;
                } else if (currentKey === 'input' && currentStep.input) {
                    currentStep.input += '\n' + trimmed;
                }
            }
        }
    }

    console.log(`[WorkflowEngine] Parsed workflow "${def.name}" with ${def.steps.length} steps`);
    return def;
}

// A4 fix: normalize depends_on. The home-grown YAML parser stores "depends_on: [outline, draft]" as the string
// "[outline, draft]", so later Array.isArray checks fail and the dependency graph breaks. Always parse to an array.
function normalizeDeps(dep) {
    if (!dep) return [];
    if (Array.isArray(dep)) return dep.map(d => String(d).trim()).filter(Boolean);
    const s = String(dep).trim();
    if (s.startsWith('[') && s.endsWith(']')) {
        return s.slice(1, -1).split(',').map(d => d.trim()).filter(Boolean);
    }
    return [s];
}

function validateWorkflow(def) {
    const errors = [];

    if (!def.name) errors.push('Workflow name is required');
    if (!def.steps || def.steps.length === 0) errors.push('At least one step is required');

    const stepIds = new Set();
    for (const step of def.steps || []) {
        if (!step.id) step.id = `step_${def.steps.indexOf(step)}`;
        stepIds.add(step.id);

        if (!step.type && !step.action) {
            errors.push(`Step "${step.id}" missing type/action`);
        }

        const stepType = step.type || step.action || '';
        if (stepType && !STEP_TYPES.has(stepType) && !stepType.startsWith('ai.') && !stepType.startsWith('page.') && !stepType.startsWith('officecli.') && !stepType.startsWith('rag.')) {
            errors.push(`Step "${step.id}" unknown type: ${stepType}`);
        }

        if (step.depends_on) {
            const deps = normalizeDeps(step.depends_on);
            for (const dep of deps) {
                if (!stepIds.has(dep) && !def.steps.some(s => s.name === dep)) {
                    errors.push(`Step "${step.id}" depends on unknown step: ${dep}`);
                }
            }
        }
    }

    const visited = new Set();
    const stack = new Set();
    for (const step of def.steps || []) {
        if (detectCycle(step, def.steps, visited, stack)) {
            errors.push('Circular dependency detected');
            break;
        }
    }

    if (errors.length) {
        console.warn('[WorkflowEngine] Validation errors:', errors);
    }
    return { valid: errors.length === 0, errors };
}

function detectCycle(step, allSteps, visited, stack) {
    if (stack.has(step.id)) return true;
    if (visited.has(step.id)) return false;
    visited.add(step.id);
    stack.add(step.id);

    if (step.depends_on) {
        const deps = normalizeDeps(step.depends_on);
        for (const dep of deps) {
            const depStep = allSteps.find(s => s.id === dep || s.name === dep);
            if (depStep && detectCycle(depStep, allSteps, visited, stack)) return true;
        }
    }

    stack.delete(step.id);
    return false;
}

// E30 fix: execute in topological order of the dependency graph instead of YAML declaration order (Object.values/array order).
// The old for (const step of def.steps) ran steps in YAML order; if a step was declared before its dependency,
// previousResults had no upstream result, {{dep}} template variables were passed to the LLM verbatim, and output was garbled.
// Reversed DFS post-order = valid topological order; steps without dependencies keep their relative (declaration) order.
function topologicalSort(def) {
    const order = [];
    const visited = new Set();
    const inStack = new Set();
    function dfs(step) {
        const key = step.id || step.name;
        if (visited.has(key)) return;
        if (inStack.has(key)) return; // cycle — detectCycle already rejects this; defensive guard
        inStack.add(key);
        if (step.depends_on) {
            const deps = normalizeDeps(step.depends_on);
            for (const dep of deps) {
                const depStep = def.steps.find(s => s.id === dep || s.name === dep);
                if (depStep) dfs(depStep);
            }
        }
        inStack.delete(key);
        visited.add(key);
        order.push(step);
    }
    for (const step of def.steps) dfs(step);
    return order;
}

async function executeWorkflow(app, workflowId, input) {
    const { db } = app;
    if (!db) throw new Error('DB not available');

    const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
    if (!workflow) throw new Error('Workflow not found');

    const def = parseYAML(workflow.yaml_def);
    const validation = validateWorkflow(def);
    if (!validation.valid) throw new Error(`Invalid workflow: ${validation.errors.join(', ')}`);

    const runId = uid();
    const nowISO = new Date().toISOString();

    db.prepare(`INSERT INTO workflow_runs (id, workflow_id, status, input, steps, started_at)
        VALUES (?, ?, 'running', ?, ?, ?)`).run(
        runId, workflowId, JSON.stringify(input || {}),
        JSON.stringify([]), nowISO
    );

    db.prepare('UPDATE workflows SET status = ?, last_run_at = ? WHERE id = ?')
        .run('running', nowISO, workflowId);

    console.log(`[WorkflowEngine] Starting workflow "${def.name}" (run: ${runId})`);

    const stepResults = {};
    const stepStatuses = [];
    let finalOutput;

    try {
        // E30 fix: run in topological order so upstream steps run before dependents and previousResults resolves reliably.
        const orderedSteps = topologicalSort(def);
        for (const step of orderedSteps) {
            const stepResult = await executeStep(app, step, stepResults, input);
            // A4 fix: key results by both name and id so depends_on references by name resolve.
            // Originally keyed only by step.id ("step_N"), while depends_on references step.name ("outline") and never matched.
            if (step.name) stepResults[step.name] = stepResult;
            stepResults[step.id || step.name] = stepResult;
            stepStatuses.push({
                id: step.id,
                name: step.name,
                status: 'completed',
                result: typeof stepResult === 'string' ? stepResult : JSON.stringify(stepResult),
            });

            db.prepare('UPDATE workflow_runs SET steps = ? WHERE id = ?')
                .run(JSON.stringify(stepStatuses), runId);
        }

        finalOutput = stepResults;
        const lastKey = Object.keys(stepResults).pop();
        if (lastKey) finalOutput = stepResults[lastKey];

        db.prepare("UPDATE workflow_runs SET status = 'completed', output = ?, completed_at = ? WHERE id = ?")
            .run(JSON.stringify(finalOutput), new Date().toISOString(), runId);
        db.prepare("UPDATE workflows SET status = 'idle' WHERE id = ?").run(workflowId);

        console.log(`[WorkflowEngine] Workflow "${def.name}" completed (run: ${runId})`);
    } catch (e) {
        console.error(`[WorkflowEngine] Step failed: ${e.message}`);
        db.prepare("UPDATE workflow_runs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?")
            .run(e.message, new Date().toISOString(), runId);
        db.prepare("UPDATE workflows SET status = 'idle' WHERE id = ?").run(workflowId);
        throw e;
    }

    return { run_id: runId, output: finalOutput, steps: stepStatuses };
}

async function executeStep(app, step, previousResults, globalInput) {
    const stepType = step.type || step.action || '';
    const context = buildStepContext(step, previousResults, globalInput);

    console.log(`[WorkflowEngine] Executing step "${step.name || step.id}" (${stepType})`);

    switch (stepType) {
        case 'ai.generate':
        case 'ai.translate':
        case 'ai.summarize':
            return await executeAIStep(app, stepType, step, context);

        case 'page.create':
            return await executePageCreate(app, step, context);

        case 'page.update':
            return await executePageUpdate(app, step, context);

        case 'page.search':
            return await executePageSearch(app, step, context);

        case 'rag.query':
            return await executeRAGQuery(app, step, context);

        case 'transform':
            return executeTransform(step, context);

        case 'condition':
            return executeCondition(step, context);

        default:
            console.warn(`[WorkflowEngine] Unknown step type: ${stepType}, skipping`);
            return { skipped: true, type: stepType };
    }
}

function buildStepContext(step, previousResults, globalInput) {
    const context = { ...globalInput };

    if (step.depends_on) {
        const deps = normalizeDeps(step.depends_on);
        for (const dep of deps) {
            if (previousResults[dep]) {
                context[dep] = previousResults[dep];
            }
        }
    }

    if (step.input && typeof step.input === 'string') {
        step.input = step.input.replace(/\{\{(\w+)\}\}/g, (_, key) => {
            return context[key] !== undefined ? String(context[key]) : `{{${key}}}`;
        });
    }

    if (step.prompt && typeof step.prompt === 'string') {
        step.prompt = step.prompt.replace(/\{\{(\w+)\}\}/g, (_, key) => {
            return context[key] !== undefined ? String(context[key]) : `{{${key}}}`;
        });
    }

    return context;
}

async function executeAIStep(app, stepType, step, context) {
    const config = require('../config');
    const fusionMLX = require('../integrations/fusion-mlx');

    const prompt = step.prompt || step.input || '';
    if (!prompt) throw new Error(`AI step "${step.name}" requires prompt/input`);

    const model = step.model || config.AI_CHAT_MODEL || 'Qwen3.5-9B-4bit';

    let systemPrompt = 'You are a helpful assistant.';
    if (stepType === 'ai.translate') systemPrompt = 'Translate the following text. Output only the translation.';
    if (stepType === 'ai.summarize') systemPrompt = 'Summarize the following text concisely.';

    try {
        const result = await fusionMLX.chat({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt },
            ],
            temperature: step.temperature || 0.7,
            max_tokens: step.max_tokens || 2000,
        });
        return result.content || result;
    } catch (e) {
        console.error(`[WorkflowEngine] AI step failed: ${e.message}`);
        throw new Error(`AI step "${step.name}" failed: ${e.message}`, { cause: e });
    }
}

async function executePageCreate(app, step, context) {
    const { db } = app;
    if (!db) throw new Error('DB not available');

    const pageId = uid();
    const title = step.title || step.input || 'Untitled';
    const content = step.content || '';
    const bookId = step.book_id || context.book_id || null;

    db.prepare('INSERT INTO pages (id, title, content, book_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(pageId, title, content, bookId, Date.now(), Date.now());

    console.log(`[WorkflowEngine] Created page: ${pageId} "${title}"`);
    return { page_id: pageId, title };
}

async function executePageUpdate(app, step, context) {
    const { db } = app;
    if (!db) throw new Error('DB not available');

    const pageId = step.page_id || context.page_id;
    if (!pageId) throw new Error('page_id required for page.update');

    if (step.title) {
        db.prepare('UPDATE pages SET title = ?, updated_at = ? WHERE id = ?')
            .run(step.title, Date.now(), pageId);
    }
    if (step.content) {
        db.prepare('UPDATE pages SET content = ?, updated_at = ? WHERE id = ?')
            .run(step.content, Date.now(), pageId);
    }

    console.log(`[WorkflowEngine] Updated page: ${pageId}`);
    return { page_id: pageId, updated: true };
}

async function executePageSearch(app, step, context) {
    const { db } = app;
    if (!db) throw new Error('DB not available');

    const query = step.query || step.input || '';
    const results = db.prepare(
        "SELECT id, title FROM pages WHERE title LIKE ? OR content LIKE ? LIMIT 10"
    ).all(`%${query}%`, `%${query}%`);

    return results;
}

async function executeRAGQuery(app, step, context) {
    try {
        const ragHybrid = require('./rag-hybrid');
        const query = step.query || step.input || '';
        const topK = step.top_k || 5;
        const results = await ragHybrid.hybridSearch(app, query, topK);
        return results;
    } catch (e) {
        console.warn(`[WorkflowEngine] RAG query failed: ${e.message}`);
        return [];
    }
}

function executeTransform(step, context) {
    const input = step.input || '';
    const op = step.op || step.operation || 'identity';

    switch (op) {
        case 'identity': return input;
        case 'json_parse':
            try { return JSON.parse(input); } catch { return input; }
        case 'json_stringify':
            try { return JSON.stringify(input); } catch { return String(input); }
        case 'split': return String(input).split(step.separator || '\n');
        case 'join': return Array.isArray(input) ? input.join(step.separator || '\n') : input;
        case 'extract':
            try {
                // ReDoS guard: user patterns must be restricted (P2-25). Reject nested quantifiers/backtracking traps; no enforced timeout is available, so cap pattern complexity
                const pat = String(step.pattern || '(.+)');
                if (pat.length > 200) return input;
                // Detect classic catastrophic backtracking: quantifier right after quantifier (e.g. (a+)+ ) or repeated .+ inside a group
                if (/(\\.|[\w)\]])\?*\+\+|\(.*[+*].*[+*].*\)/.test(pat)) {
                    console.warn('[WorkflowEngine] extract pattern looks like ReDoS, rejected:', pat);
                    return input;
                }
                const re = new RegExp(pat);
                const match = String(input).match(re);
                return match ? match[1] || match[0] : null;
            } catch { return input; }
        default: return input;
    }
}

function executeCondition(step, context) {
    const condition = step.condition || step.if || '';
    if (!condition) return true;

    // Safe evaluation: only support simple comparisons (==, !=, >, <, >=, <=)
    // Format: "key operator value"  e.g. "status == completed"
    const safeRe = /^(\w+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/;
    const match = condition.match(safeRe);
    if (!match) {
        console.warn(`[WorkflowEngine] Unsafe condition rejected: ${condition}`);
        return false;
    }

    const [, key, op, valStr] = match;
    const left = context[key];
    const right = valStr.trim().replace(/^['"]|['"]$/g, '');

    switch (op) {
        case '==': return String(left) === right;
        case '!=': return String(left) !== right;
        case '>': return Number(left) > Number(right);
        case '<': return Number(left) < Number(right);
        case '>=': return Number(left) >= Number(right);
        case '<=': return Number(left) <= Number(right);
        default: return false;
    }
}

// ── Preset workflow YAML definitions ────────────────────────────────────
// Preset names and YAML bodies (step prompts, default page titles) are user-facing
// product content (Chinese), kept as data in preset-workflows.json rather than in source.
const PRESET_WORKFLOWS = require('./preset-workflows.json');

function seedPresetWorkflows(db) {
    if (!db) return;
    for (const preset of PRESET_WORKFLOWS) {
        const existing = db.prepare('SELECT id FROM workflows WHERE name = ?').get(preset.name);
        if (!existing) {
            const id = uid();
            db.prepare('INSERT INTO workflows (id, name, description, yaml_def, status) VALUES (?, ?, ?, ?, ?)')
                .run(id, preset.name, preset.description, preset.yaml_def, 'idle');
            console.log(`[WorkflowEngine] Seeded preset workflow: ${preset.name}`);
        }
    }
}

module.exports = {
    parseYAML,
    validateWorkflow,
    executeWorkflow,
    executeStep,
    buildStepContext,
    normalizeDeps,
    detectCycle,
    PRESET_WORKFLOWS,
    seedPresetWorkflows,
};
