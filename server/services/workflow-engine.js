// =============================================================================
// Fusion-Doc — YAML 工作流引擎
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
            const deps = Array.isArray(step.depends_on) ? step.depends_on : [step.depends_on];
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
        const deps = Array.isArray(step.depends_on) ? step.depends_on : [step.depends_on];
        for (const dep of deps) {
            const depStep = allSteps.find(s => s.id === dep || s.name === dep);
            if (depStep && detectCycle(depStep, allSteps, visited, stack)) return true;
        }
    }

    stack.delete(step.id);
    return false;
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
        for (const step of def.steps) {
            const stepResult = await executeStep(app, step, stepResults, input);
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
        const deps = Array.isArray(step.depends_on) ? step.depends_on : [step.depends_on];
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
                const re = new RegExp(step.pattern || '(.+)');
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
const PRESET_WORKFLOWS = [
    {
        name: '报告生成',
        description: 'outline → sections → content → charts → summary',
        yaml_def: `name: 报告生成
description: 从大纲到完整报告的自动化生成流程
steps:
  - name: outline
    type: ai.generate
    prompt: "根据以下主题生成报告大纲：{{topic}}"
  - name: sections
    type: ai.generate
    prompt: "根据大纲展开各章节要点：{{outline}}"
    depends_on: [outline]
  - name: content
    type: ai.generate
    prompt: "根据章节要点撰写完整报告内容：{{sections}}"
    max_tokens: 4000
    depends_on: [sections]
  - name: summary
    type: ai.summarize
    prompt: "为以下报告生成执行摘要：{{content}}"
    depends_on: [content]
  - name: save
    type: page.create
    title: "报告：{{topic}}"
    content: "{{content}}"
    depends_on: [content]`,
    },
    {
        name: '文档翻译',
        description: 'extract → segment → translate → proofread → format',
        yaml_def: `name: 文档翻译
description: 分段翻译+校对+格式化的文档翻译流程
steps:
  - name: extract
    type: page.search
    query: "{{source_title}}"
  - name: translate
    type: ai.translate
    prompt: "将以下内容翻译为{{target_lang}}，保持格式：{{extract}}"
    depends_on: [extract]
  - name: proofread
    type: ai.generate
    prompt: "校对以下翻译，修正语法和术语错误：{{translate}}"
    depends_on: [translate]
  - name: save
    type: page.create
    title: "翻译：{{source_title}}"
    content: "{{proofread}}"
    depends_on: [proofread]`,
    },
    {
        name: '知识提取',
        description: 'parse → entity recognition → relation extraction → card generation',
        yaml_def: `name: 知识提取
description: 从文档中提取实体、关系并生成知识卡片
steps:
  - name: parse
    type: rag.query
    query: "{{topic}}"
    top_k: 5
  - name: entities
    type: ai.generate
    prompt: "从以下文本中提取所有实体（人名、组织、概念、术语），以JSON数组输出：{{parse}}"
    depends_on: [parse]
  - name: relations
    type: ai.generate
    prompt: "分析以下实体间的关系，输出为三元组JSON数组：{{entities}}"
    depends_on: [entities]
  - name: cards
    type: ai.generate
    prompt: "根据实体和关系生成知识卡片Markdown：{{entities}} {{relations}}"
    depends_on: [relations]
  - name: save
    type: page.create
    title: "知识卡片：{{topic}}"
    content: "{{cards}}"
    depends_on: [cards]`,
    },
    {
        name: '周报生成',
        description: 'collect → classify → summarize → write → format',
        yaml_def: `name: 周报生成
description: 自动汇总周工作内容并生成周报
steps:
  - name: collect
    type: page.search
    query: "{{week_range}}"
  - name: classify
    type: ai.generate
    prompt: "将以下工作内容按类别分类（完成/进行中/计划/问题）：{{collect}}"
    depends_on: [collect]
  - name: summarize
    type: ai.summarize
    prompt: "为每个类别生成简明摘要：{{classify}}"
    depends_on: [classify]
  - name: write
    type: ai.generate
    prompt: "根据分类和摘要撰写正式周报Markdown：{{summarize}}"
    max_tokens: 3000
    depends_on: [summarize]
  - name: save
    type: page.create
    title: "周报 {{week_range}}"
    content: "{{write}}"
    depends_on: [write]`,
    },
    {
        name: '论文审阅',
        description: 'parse → structure analysis → logic check → suggestions',
        yaml_def: `name: 论文审阅
description: 自动化论文审阅：结构分析+逻辑检查+改进建议
steps:
  - name: parse
    type: rag.query
    query: "{{paper_title}}"
    top_k: 10
  - name: structure
    type: ai.generate
    prompt: "分析以下论文的结构完整性，检查是否包含：摘要、引言、方法、实验、结论：{{parse}}"
    depends_on: [parse]
  - name: logic
    type: ai.generate
    prompt: "检查论文逻辑连贯性，识别论点支撑不足之处：{{parse}}"
    depends_on: [parse]
  - name: suggestions
    type: ai.generate
    prompt: "综合结构和逻辑分析，给出具体改进建议：{{structure}} {{logic}}"
    depends_on: [structure, logic]
  - name: save
    type: page.create
    title: "审阅：{{paper_title}}"
    content: "{{suggestions}}"
    depends_on: [suggestions]`,
    },
];

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
    PRESET_WORKFLOWS,
    seedPresetWorkflows,
};
