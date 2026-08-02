const { uid } = require('../utils/helpers');

const PRESET_TEMPLATES = [
    {
        name: '空白文档',
        category: 'basic',
        description: '从空白开始自由创作',
        content: '',
        schema: {},
    },
    {
        name: '季度报告',
        category: 'business',
        description: '季度工作总结与规划模板',
        content: `# {{quarter}}季度报告

## 概述

本季度围绕{{department}}核心目标，完成了以下关键工作。

## 关键成果

### 1. {{achievement_1}}

### 2. {{achievement_2}}

### 3. {{achievement_3}}

## 数据指标

| 指标 | 目标 | 实际 | 完成率 |
|------|------|------|--------|
| {{metric_1}} | {{target_1}} | {{actual_1}} | {{rate_1}} |
| {{metric_2}} | {{target_2}} | {{actual_2}} | {{rate_2}} |

## 问题与挑战

{{challenges}}

## 下季度规划

{{next_quarter_plan}}

---

报告人: {{author}}
日期: {{date}}`,
        schema: {
            quarter: { type: 'text', label: '季度' },
            department: { type: 'text', label: '部门' },
            achievement_1: { type: 'text', label: '成果1' },
            achievement_2: { type: 'text', label: '成果2' },
            achievement_3: { type: 'text', label: '成果3' },
            metric_1: { type: 'text', label: '指标1' },
            target_1: { type: 'text', label: '目标1' },
            actual_1: { type: 'text', label: '实际1' },
            rate_1: { type: 'text', label: '完成率1' },
            metric_2: { type: 'text', label: '指标2' },
            target_2: { type: 'text', label: '目标2' },
            actual_2: { type: 'text', label: '实际2' },
            rate_2: { type: 'text', label: '完成率2' },
            challenges: { type: 'textarea', label: '问题与挑战' },
            next_quarter_plan: { type: 'textarea', label: '下季度规划' },
            author: { type: 'text', label: '报告人' },
            date: { type: 'text', label: '日期' },
        },
    },
    {
        name: '会议纪要',
        category: 'business',
        description: '会议记录与行动项跟踪模板',
        content: `# 会议纪要

## 基本信息

- 会议主题: {{topic}}
- 会议时间: {{date}} {{time}}
- 会议地点: {{location}}
- 主持人: {{host}}
- 参会人: {{participants}}

## 议题与讨论

### 议题1: {{agenda_1}}

讨论要点:
{{discussion_1}}

### 议题2: {{agenda_2}}

讨论要点:
{{discussion_2}}

## 决议

{{decisions}}

## 行动项

| 序号 | 行动项 | 负责人 | 截止日期 | 状态 |
|------|--------|--------|----------|------|
| 1 | {{action_1}} | {{owner_1}} | {{deadline_1}} | 待开始 |
| 2 | {{action_2}} | {{owner_2}} | {{deadline_2}} | 待开始 |

## 下次会议

- 时间: {{next_date}}
- 议题: {{next_agenda}}

---

记录人: {{recorder}}`,
        schema: {
            topic: { type: 'text', label: '会议主题' },
            date: { type: 'text', label: '日期' },
            time: { type: 'text', label: '时间' },
            location: { type: 'text', label: '地点' },
            host: { type: 'text', label: '主持人' },
            participants: { type: 'text', label: '参会人' },
            agenda_1: { type: 'text', label: '议题1' },
            discussion_1: { type: 'textarea', label: '讨论1' },
            agenda_2: { type: 'text', label: '议题2' },
            discussion_2: { type: 'textarea', label: '讨论2' },
            decisions: { type: 'textarea', label: '决议' },
            action_1: { type: 'text', label: '行动项1' },
            owner_1: { type: 'text', label: '负责人1' },
            deadline_1: { type: 'text', label: '截止1' },
            action_2: { type: 'text', label: '行动项2' },
            owner_2: { type: 'text', label: '负责人2' },
            deadline_2: { type: 'text', label: '截止2' },
            next_date: { type: 'text', label: '下次时间' },
            next_agenda: { type: 'text', label: '下次议题' },
            recorder: { type: 'text', label: '记录人' },
        },
    },
    {
        name: '技术方案',
        category: 'engineering',
        description: '技术架构与实施方案文档模板',
        content: `# {{project_name}} 技术方案

## 1. 背景与目标

### 1.1 项目背景

{{background}}

### 1.2 目标

{{goals}}

## 2. 技术架构

### 2.1 整体架构

{{architecture_overview}}

### 2.2 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| {{component_1}} | {{choice_1}} | {{reason_1}} |
| {{component_2}} | {{choice_2}} | {{reason_2}} |

## 3. 详细设计

### 3.1 {{module_1}}

{{design_1}}

### 3.2 {{module_2}}

{{design_2}}

## 4. 接口定义

{{api_spec}}

## 5. 数据模型

{{data_model}}

## 6. 性能与扩展

{{performance}}

## 7. 风险与应对

| 风险 | 影响 | 应对方案 |
|------|------|----------|
| {{risk_1}} | {{impact_1}} | {{mitigation_1}} |
| {{risk_2}} | {{impact_2}} | {{mitigation_2}} |

## 8. 里程碑

| 阶段 | 时间 | 交付物 |
|------|------|--------|
| {{phase_1}} | {{timeline_1}} | {{deliverable_1}} |
| {{phase_2}} | {{timeline_2}} | {{deliverable_2}} |

---

作者: {{author}}
评审人: {{reviewer}}
版本: {{version}}`,
        schema: {
            project_name: { type: 'text', label: '项目名称' },
            background: { type: 'textarea', label: '背景' },
            goals: { type: 'textarea', label: '目标' },
            architecture_overview: { type: 'textarea', label: '架构概览' },
            component_1: { type: 'text', label: '组件1' },
            choice_1: { type: 'text', label: '选型1' },
            reason_1: { type: 'text', label: '理由1' },
            component_2: { type: 'text', label: '组件2' },
            choice_2: { type: 'text', label: '选型2' },
            reason_2: { type: 'text', label: '理由2' },
            module_1: { type: 'text', label: '模块1' },
            design_1: { type: 'textarea', label: '设计1' },
            module_2: { type: 'text', label: '模块2' },
            design_2: { type: 'textarea', label: '设计2' },
            api_spec: { type: 'textarea', label: '接口定义' },
            data_model: { type: 'textarea', label: '数据模型' },
            performance: { type: 'textarea', label: '性能' },
            risk_1: { type: 'text', label: '风险1' },
            impact_1: { type: 'text', label: '影响1' },
            mitigation_1: { type: 'text', label: '应对1' },
            risk_2: { type: 'text', label: '风险2' },
            impact_2: { type: 'text', label: '影响2' },
            mitigation_2: { type: 'text', label: '应对2' },
            phase_1: { type: 'text', label: '阶段1' },
            timeline_1: { type: 'text', label: '时间1' },
            deliverable_1: { type: 'text', label: '交付1' },
            phase_2: { type: 'text', label: '阶段2' },
            timeline_2: { type: 'text', label: '时间2' },
            deliverable_2: { type: 'text', label: '交付2' },
            author: { type: 'text', label: '作者' },
            reviewer: { type: 'text', label: '评审人' },
            version: { type: 'text', label: '版本' },
        },
    },
    {
        name: '项目提案',
        category: 'business',
        description: '项目立项与可行性分析模板',
        content: `# {{project_name}} 项目提案

## 1. 项目概述

{{overview}}

## 2. 需求分析

### 2.1 现状

{{current_situation}}

### 2.2 需求

{{requirements}}

## 3. 可行性分析

### 3.1 技术可行性

{{technical_feasibility}}

### 3.2 经济可行性

{{economic_feasibility}}

## 4. 方案概述

{{solution_overview}}

## 5. 预期收益

| 收益类型 | 描述 | 预估价值 |
|----------|------|----------|
| {{benefit_type_1}} | {{benefit_desc_1}} | {{benefit_value_1}} |
| {{benefit_type_2}} | {{benefit_desc_2}} | {{benefit_value_2}} |

## 6. 资源需求

- 人员: {{team}}
- 预算: {{budget}}
- 周期: {{duration}}

## 7. 风险评估

{{risk_assessment}}

---

提案人: {{proposer}}
日期: {{date}}`,
        schema: {
            project_name: { type: 'text', label: '项目名称' },
            overview: { type: 'textarea', label: '概述' },
            current_situation: { type: 'textarea', label: '现状' },
            requirements: { type: 'textarea', label: '需求' },
            technical_feasibility: { type: 'textarea', label: '技术可行性' },
            economic_feasibility: { type: 'textarea', label: '经济可行性' },
            solution_overview: { type: 'textarea', label: '方案' },
            benefit_type_1: { type: 'text', label: '收益类型1' },
            benefit_desc_1: { type: 'text', label: '收益描述1' },
            benefit_value_1: { type: 'text', label: '收益价值1' },
            benefit_type_2: { type: 'text', label: '收益类型2' },
            benefit_desc_2: { type: 'text', label: '收益描述2' },
            benefit_value_2: { type: 'text', label: '收益价值2' },
            team: { type: 'text', label: '团队' },
            budget: { type: 'text', label: '预算' },
            duration: { type: 'text', label: '周期' },
            risk_assessment: { type: 'textarea', label: '风险评估' },
            proposer: { type: 'text', label: '提案人' },
            date: { type: 'text', label: '日期' },
        },
    },
    {
        name: '产品PRD',
        category: 'product',
        description: '产品需求文档模板',
        content: `# {{product_name}} PRD

## 1. 产品概述

### 1.1 产品定位

{{positioning}}

### 1.2 目标用户

{{target_users}}

### 1.3 核心价值

{{core_value}}

## 2. 功能需求

### 2.1 P0 — 必做

{{p0_features}}

### 2.2 P1 — 应做

{{p1_features}}

### 2.3 P2 — 可做

{{p2_features}}

## 3. 用户故事

{{user_stories}}

## 4. 交互设计

{{interaction_design}}

## 5. 非功能需求

- 性能: {{performance_req}}
- 安全: {{security_req}}
- 兼容性: {{compatibility_req}}

## 6. 数据指标

| 指标 | 定义 | 目标值 |
|------|------|--------|
| {{kpi_1}} | {{kpi_def_1}} | {{kpi_target_1}} |
| {{kpi_2}} | {{kpi_def_2}} | {{kpi_target_2}} |

## 7. 发布计划

| 版本 | 时间 | 功能范围 |
|------|------|----------|
| MVP | {{mvp_date}} | {{mvp_scope}} |
| V1.0 | {{v1_date}} | {{v1_scope}} |

---

产品经理: {{pm}}
日期: {{date}}`,
        schema: {
            product_name: { type: 'text', label: '产品名称' },
            positioning: { type: 'textarea', label: '定位' },
            target_users: { type: 'textarea', label: '目标用户' },
            core_value: { type: 'textarea', label: '核心价值' },
            p0_features: { type: 'textarea', label: 'P0功能' },
            p1_features: { type: 'textarea', label: 'P1功能' },
            p2_features: { type: 'textarea', label: 'P2功能' },
            user_stories: { type: 'textarea', label: '用户故事' },
            interaction_design: { type: 'textarea', label: '交互设计' },
            performance_req: { type: 'text', label: '性能需求' },
            security_req: { type: 'text', label: '安全需求' },
            compatibility_req: { type: 'text', label: '兼容性' },
            kpi_1: { type: 'text', label: 'KPI1' },
            kpi_def_1: { type: 'text', label: 'KPI定义1' },
            kpi_target_1: { type: 'text', label: 'KPI目标1' },
            kpi_2: { type: 'text', label: 'KPI2' },
            kpi_def_2: { type: 'text', label: 'KPI定义2' },
            kpi_target_2: { type: 'text', label: 'KPI目标2' },
            mvp_date: { type: 'text', label: 'MVP时间' },
            mvp_scope: { type: 'text', label: 'MVP范围' },
            v1_date: { type: 'text', label: 'V1时间' },
            v1_scope: { type: 'text', label: 'V1范围' },
            pm: { type: 'text', label: '产品经理' },
            date: { type: 'text', label: '日期' },
        },
    },
    {
        name: '学术论文',
        category: 'academic',
        description: '学术论文写作模板',
        content: `# {{title}}

**作者**: {{author}}
**机构**: {{institution}}
**日期**: {{date}}

## 摘要

{{abstract}}

**关键词**: {{keywords}}

## 1. 引言

{{introduction}}

## 2. 相关工作

{{related_work}}

## 3. 方法

### 3.1 问题定义

{{problem_definition}}

### 3.2 方法概述

{{methodology}}

### 3.3 算法/模型

{{algorithm}}

## 4. 实验

### 4.1 实验设置

{{experimental_setup}}

### 4.2 结果

{{results}}

### 4.3 分析

{{analysis}}

## 5. 讨论

{{discussion}}

## 6. 结论

{{conclusion}}

## 参考文献

{{references}}`,
        schema: {
            title: { type: 'text', label: '标题' },
            author: { type: 'text', label: '作者' },
            institution: { type: 'text', label: '机构' },
            date: { type: 'text', label: '日期' },
            abstract: { type: 'textarea', label: '摘要' },
            keywords: { type: 'text', label: '关键词' },
            introduction: { type: 'textarea', label: '引言' },
            related_work: { type: 'textarea', label: '相关工作' },
            problem_definition: { type: 'textarea', label: '问题定义' },
            methodology: { type: 'textarea', label: '方法' },
            algorithm: { type: 'textarea', label: '算法' },
            experimental_setup: { type: 'textarea', label: '实验设置' },
            results: { type: 'textarea', label: '结果' },
            analysis: { type: 'textarea', label: '分析' },
            discussion: { type: 'textarea', label: '讨论' },
            conclusion: { type: 'textarea', label: '结论' },
            references: { type: 'textarea', label: '参考文献' },
        },
    },
    {
        name: '周报',
        category: 'business',
        description: '周工作汇报模板',
        content: `# 周报 — {{week_range}}

**姓名**: {{name}}
**部门**: {{department}}

## 本周完成

1. {{done_1}}
2. {{done_2}}
3. {{done_3}}

## 进行中

1. {{wip_1}}
2. {{wip_2}}

## 下周计划

1. {{plan_1}}
2. {{plan_2}}
3. {{plan_3}}

## 需要协助

{{help_needed}}

## 学习与思考

{{learnings}}`,
        schema: {
            week_range: { type: 'text', label: '周范围' },
            name: { type: 'text', label: '姓名' },
            department: { type: 'text', label: '部门' },
            done_1: { type: 'text', label: '完成1' },
            done_2: { type: 'text', label: '完成2' },
            done_3: { type: 'text', label: '完成3' },
            wip_1: { type: 'text', label: '进行1' },
            wip_2: { type: 'text', label: '进行2' },
            plan_1: { type: 'text', label: '计划1' },
            plan_2: { type: 'text', label: '计划2' },
            plan_3: { type: 'text', label: '计划3' },
            help_needed: { type: 'textarea', label: '需要协助' },
            learnings: { type: 'textarea', label: '学习思考' },
        },
    },
];

function seedTemplates(db) {
    if (!db) return;
    try {
        const existing = db.prepare('SELECT COUNT(*) as cnt FROM templates').get();
        if (existing.cnt > 0) {
            console.log('  [Seed] 模板已存在，跳过初始化');
            return;
        }
        const now = Date.now();
        const insert = db.prepare(`
            INSERT INTO templates (id, name, category, description, content, schema, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const tpl of PRESET_TEMPLATES) {
            insert.run(
                uid(), tpl.name, tpl.category, tpl.description,
                tpl.content, JSON.stringify(tpl.schema), now, now,
            );
        }
        console.log(`  [Seed] 已初始化 ${PRESET_TEMPLATES.length} 个预设模板`);
    } catch (e) {
        console.error(`  [Seed] 模板初始化失败: ${e.message}`);
    }
}

module.exports = { seedTemplates, PRESET_TEMPLATES };
