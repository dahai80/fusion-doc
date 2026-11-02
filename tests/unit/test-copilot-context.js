// =============================================================================
// Fusion-Doc — issue #69 long-context 单元测试
// 覆盖: 边界感知截断 (CJK/Latin 不切半句) / 目录提取 / buildContext
//       长文档摘要路径 / 选区服务端硬上限 / 摘要过期判定
// 零外部依赖 (node:test + node:assert)。
// =============================================================================

const test = require('node:test');
const assert = require('node:assert');
const {
    buildContext, truncateAtBoundary, extractToc, stripHtml,
    MAX_SELECTION_CHARS, DOC_BUDGET_CHARS, HEAD_BUDGET_CHARS,
} = require('../../server/services/ai-copilot');
const { isStale, SUMMARY_MIN_CHARS } = require('../../server/services/page-summary');

test('issue#69: truncateAtBoundary CJK 不切半句 (句末标点收尾)', () => {
    const text = Array.from({ length: 60 }, (_, i) => `这是第${i}个句子，包含一些中文内容与细节描述。`).join('');
    const out = truncateAtBoundary(text, 200);
    assert.ok(out.length <= 200, `len=${out.length} 超预算`);
    assert.match(out, /[。！？]$/, `结尾非句末标点: ...${out.slice(-10)}`);
});

test('issue#69: truncateAtBoundary Latin 不切半句/半词', () => {
    const sents = ['The quick brown fox jumps over the lazy dog. ', 'Machine learning models run locally. ', 'Local-first design keeps data on device. '];
    const text = sents.join('').repeat(10);
    const out = truncateAtBoundary(text, 150);
    assert.ok(out.length <= 150, `len=${out.length} 超预算`);
    // 切点须为词/句边界: 句末标点收尾, 或原文在切点处紧跟空白 (尾部空白被 trimEnd 移除属正常)
    assert.ok(
        /[.!?]\s*$/.test(out) || /^\s/.test(text.slice(out.length)),
        `非词/句边界切点: ...${out.slice(-10)}`,
    );
});

test('issue#69: truncateAtBoundary 短文本原样返回', () => {
    assert.strictEqual(truncateAtBoundary('短文本。', 200), '短文本。');
    assert.strictEqual(truncateAtBoundary('', 200), '');
});

test('issue#69: truncateAtBoundary 无边界兜底不超预算', () => {
    const text = 'x'.repeat(5000);
    const out = truncateAtBoundary(text, 1000);
    assert.strictEqual(out.length, 1000);
});

test('issue#69: extractToc h1-h3 提取 + 缩进', () => {
    const html = '<h1>总览</h1><p>x</p><h2 class="x">架构</h2><h3>细节 &amp; 实现</h3>';
    const toc = extractToc(html);
    assert.ok(toc.includes('- 总览'), toc);
    assert.ok(toc.includes('  - 架构'), toc);
    assert.ok(toc.includes('    - 细节 & 实现'), toc);
    assert.ok(toc.startsWith('目录:'));
});

test('issue#69: buildContext 长文档走 摘要+目录+开头片段', async () => {
    const paragraphs = Array.from({ length: 400 }, (_, i) => `<p>第${i}段内容，包含足够的文字长度以超过文档预算阈值，从而触发长文档路径。</p>`).join('');
    const fakeDb = {
        prepare: () => ({
            get: () => ({
                title: '长文档',
                content: `<h1>概要</h1>${paragraphs}`,
                summary: '本文讨论本地优先文档系统的长上下文处理。',
            }),
        }),
    };
    const ctx = await buildContext(fakeDb, 'p1', '', '', '');
    assert.ok(ctx.includes('长文档, 以下为摘要+目录+开头片段'), ctx.slice(0, 120));
    assert.ok(ctx.includes('本文讨论本地优先文档系统'), '缺摘要');
    assert.ok(ctx.includes('- 概要'), '缺目录');
    const head = ctx.split('开头片段:\n')[1] || '';
    assert.ok(head.length <= HEAD_BUDGET_CHARS + 20, `head=${head.length} 超预算`);
    assert.ok(ctx.length < DOC_BUDGET_CHARS + HEAD_BUDGET_CHARS + 800, `总长 ${ctx.length} 失控`);
});

test('issue#69: buildContext 短文档仍走原文截断且边界收尾', async () => {
    const content = '<p>' + Array.from({ length: 500 }, (_, i) => `第${i}段句子内容，细节描述${i * 7}。`).join('') + '</p>';
    const fakeDb = { prepare: () => ({ get: () => ({ title: '短文', content, summary: '' }) }) };
    const ctx = await buildContext(fakeDb, 'p1', '', '', '');
    const plain = stripHtml(content);
    assert.ok(ctx.includes(plain.slice(0, 100)), '应含原文开头');
    assert.ok(!ctx.includes(plain.slice(-50)), '不应含原文结尾 (被截断)');
});

test('issue#69: buildContext 选区服务端硬上限 (50k 选区不可能完整入 prompt)', async () => {
    const fakeDb = { prepare: () => ({ get: () => null }) };
    const big = '字'.repeat(50000);
    const ctx = await buildContext(fakeDb, '', '', big, '');
    const selPart = ctx.split('选中内容:\n')[1] || '';
    assert.ok(selPart.length <= MAX_SELECTION_CHARS, `选区 ${selPart.length} > ${MAX_SELECTION_CHARS}`);
    // 文档正文同样受 DOC_BUDGET 约束
    const longContent = '<p>' + '内'.repeat(10000) + '</p>';
    const fakeDb2 = { prepare: () => ({ get: () => ({ title: 'T', content: longContent, summary: '' }) }) };
    const ctx2 = await buildContext(fakeDb2, 'p1', '', '', '');
    const docPart = ctx2.split('」:\n')[1]?.split('\n\n')[0] || '';
    assert.ok(docPart.length <= DOC_BUDGET_CHARS, `正文 ${docPart.length} > ${DOC_BUDGET_CHARS}`);
});

test('issue#69: isStale 摘要过期判定', () => {
    assert.strictEqual(isStale(6000, 0), true, '无来源长度 → 过期');
    assert.strictEqual(isStale(6100, 6000), false, '漂移 1.7% → 新鲜');
    assert.strictEqual(isStale(7300, 6000), true, '漂移 21.7% → 过期');
    assert.strictEqual(isStale(4700, 6000), true, '缩短 21.7% → 过期');
    assert.ok(SUMMARY_MIN_CHARS >= 4000, '阈值过小会频繁调 LLM');
});
