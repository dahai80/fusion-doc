// =============================================================================
// Fusion-Doc — issue #69 long-context unit tests
// Covers: boundary-aware truncation (no mid-sentence cuts for CJK/Latin) / TOC extraction / buildContext
//       long-doc summary path / server-side selection hard cap / summary staleness check
// Zero external dependencies (node:test + node:assert).
// =============================================================================

const test = require('node:test');
const assert = require('node:assert');
const {
    buildContext, truncateAtBoundary, extractToc, stripHtml,
    MAX_SELECTION_CHARS, DOC_BUDGET_CHARS, HEAD_BUDGET_CHARS,
} = require('../../server/services/ai-copilot');
const { isStale, SUMMARY_MIN_CHARS } = require('../../server/services/page-summary');

test('issue#69: truncateAtBoundary CJK does not cut mid-sentence (ends on sentence punctuation)', () => {
    const text = Array.from({ length: 60 }, (_, i) => `这是第${i}个句子，包含一些中文内容与细节描述。`).join(''); // i18n: user-facing
    const out = truncateAtBoundary(text, 200);
    assert.ok(out.length <= 200, `len=${out.length} over budget`);
    assert.match(out, /[。！？]$/, `does not end on sentence punctuation: ...${out.slice(-10)}`); // i18n: user-facing
});

test('issue#69: truncateAtBoundary Latin does not cut mid-sentence/mid-word', () => {
    const sents = ['The quick brown fox jumps over the lazy dog. ', 'Machine learning models run locally. ', 'Local-first design keeps data on device. '];
    const text = sents.join('').repeat(10);
    const out = truncateAtBoundary(text, 150);
    assert.ok(out.length <= 150, `len=${out.length} over budget`);
    // Cut point must be a word/sentence boundary: ends on sentence punctuation, or the source has whitespace right after the cut (trailing whitespace removed by trimEnd is expected)
    assert.ok(
        /[.!?]\s*$/.test(out) || /^\s/.test(text.slice(out.length)),
        `cut point is not a word/sentence boundary: ...${out.slice(-10)}`,
    );
});

test('issue#69: truncateAtBoundary returns short text unchanged', () => {
    assert.strictEqual(truncateAtBoundary('短文本。', 200), '短文本。'); // i18n: user-facing
    assert.strictEqual(truncateAtBoundary('', 200), '');
});

test('issue#69: truncateAtBoundary no-boundary fallback stays within budget', () => {
    const text = 'x'.repeat(5000);
    const out = truncateAtBoundary(text, 1000);
    assert.strictEqual(out.length, 1000);
});

test('issue#69: extractToc h1-h3 extraction + indentation', () => {
    const html = '<h1>总览</h1><p>x</p><h2 class="x">架构</h2><h3>细节 &amp; 实现</h3>'; // i18n: user-facing
    const toc = extractToc(html);
    assert.ok(toc.includes('- 总览'), toc); // i18n: user-facing
    assert.ok(toc.includes('  - 架构'), toc); // i18n: user-facing
    assert.ok(toc.includes('    - 细节 & 实现'), toc); // i18n: user-facing
    assert.ok(toc.startsWith('目录:')); // i18n: user-facing
});

test('issue#69: buildContext long doc uses summary + TOC + head excerpt', async () => {
    const paragraphs = Array.from({ length: 400 }, (_, i) => `<p>第${i}段内容，包含足够的文字长度以超过文档预算阈值，从而触发长文档路径。</p>`).join(''); // i18n: user-facing
    const fakeDb = {
        prepare: () => ({
            get: () => ({
                title: '长文档', // i18n: user-facing
                content: `<h1>概要</h1>${paragraphs}`, // i18n: user-facing
                summary: '本文讨论本地优先文档系统的长上下文处理。', // i18n: user-facing
            }),
        }),
    };
    const ctx = await buildContext(fakeDb, 'p1', '', '', '');
    assert.ok(ctx.includes('长文档, 以下为摘要+目录+开头片段'), ctx.slice(0, 120)); // i18n: user-facing
    // i18n: user-facing
    assert.ok(ctx.includes('本文讨论本地优先文档系统'), 'missing summary');
    assert.ok(ctx.includes('- 概要'), 'missing TOC'); // i18n: user-facing
    const head = ctx.split('开头片段:\n')[1] || ''; // i18n: user-facing
    assert.ok(head.length <= HEAD_BUDGET_CHARS + 20, `head=${head.length} over budget`);
    assert.ok(ctx.length < DOC_BUDGET_CHARS + HEAD_BUDGET_CHARS + 800, `total length ${ctx.length} out of control`);
});

test('issue#69: buildContext short doc still uses raw-text truncation ending on a boundary', async () => {
    const content = '<p>' + Array.from({ length: 500 }, (_, i) => `第${i}段句子内容，细节描述${i * 7}。`).join('') + '</p>'; // i18n: user-facing
    const fakeDb = { prepare: () => ({ get: () => ({ title: '短文', content, summary: '' }) }) }; // i18n: user-facing
    const ctx = await buildContext(fakeDb, 'p1', '', '', '');
    const plain = stripHtml(content);
    assert.ok(ctx.includes(plain.slice(0, 100)), 'should contain the start of the source text');
    assert.ok(!ctx.includes(plain.slice(-50)), 'should not contain the end of the source text (truncated)');
});

test('issue#69: buildContext server-side selection hard cap (a 50k selection can never fully enter the prompt)', async () => {
    const fakeDb = { prepare: () => ({ get: () => null }) };
    const big = '字'.repeat(50000); // i18n: user-facing
    const ctx = await buildContext(fakeDb, '', '', big, '');
    const selPart = ctx.split('选中内容:\n')[1] || ''; // i18n: user-facing
    assert.ok(selPart.length <= MAX_SELECTION_CHARS, `selection ${selPart.length} > ${MAX_SELECTION_CHARS}`);
    // Document body is likewise bounded by DOC_BUDGET
    const longContent = '<p>' + '内'.repeat(10000) + '</p>'; // i18n: user-facing
    const fakeDb2 = { prepare: () => ({ get: () => ({ title: 'T', content: longContent, summary: '' }) }) };
    const ctx2 = await buildContext(fakeDb2, 'p1', '', '', '');
    const docPart = ctx2.split('」:\n')[1]?.split('\n\n')[0] || ''; // i18n: user-facing
    assert.ok(docPart.length <= DOC_BUDGET_CHARS, `body ${docPart.length} > ${DOC_BUDGET_CHARS}`);
});

test('issue#69: isStale summary staleness check', () => {
    assert.strictEqual(isStale(6000, 0), true, 'no source length → stale');
    assert.strictEqual(isStale(6100, 6000), false, '1.7% drift → fresh');
    assert.strictEqual(isStale(7300, 6000), true, '21.7% drift → stale');
    assert.strictEqual(isStale(4700, 6000), true, '21.7% shrink → stale');
    assert.ok(SUMMARY_MIN_CHARS >= 4000, 'a threshold too small would call the LLM too often');
});
